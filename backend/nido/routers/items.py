"""La lista de la compra."""

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from nido import push
from nido.auth import current_user
from nido.categories import CATEGORY_IDS, guess_from_keywords
from nido.db import bump, tx
from nido.house import create_expense, log, member_ids, split_cents

router = APIRouter(prefix="/api/items")

ITEM_SELECT = "SELECT * FROM items"


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=200)
    category: str | None = None
    owner_id: int | None = None
    urgent: bool = False


class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    quantity: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=200)
    category: str | None = None
    # Hace falta distinguir "no lo toco" de "pásalo a común" (null): ver model_fields_set.
    owner_id: int | None = None
    urgent: bool | None = None


class PriceIn(BaseModel):
    price_cents: int | None = Field(default=None, gt=0, le=10_000_000)


def guess_category(cur: psycopg.Cursor, name: str) -> str:
    """Lo que ya se usó en casa para ese nombre manda sobre las palabras clave."""
    cur.execute(
        "SELECT category FROM ("
        "  SELECT category, created_at FROM items WHERE lower(name) = lower(%s)"
        "  UNION ALL SELECT category, updated_at FROM pantry WHERE lower(name) = lower(%s)"
        ") t ORDER BY created_at DESC LIMIT 1",
        (name, name),
    )
    row = cur.fetchone()
    return row["category"] if row else guess_from_keywords(name)


def check_owner(cur: psycopg.Cursor, owner_id: int | None) -> None:
    if owner_id is not None and owner_id not in member_ids(cur):
        raise HTTPException(422, "Esa persona no vive aquí")


def check_category(category: str | None) -> None:
    if category is not None and category not in CATEGORY_IDS:
        raise HTTPException(422, "Categoría desconocida")


def get_item(cur: psycopg.Cursor, item_id: int) -> dict:
    cur.execute(ITEM_SELECT + " WHERE id = %s", (item_id,))
    item = cur.fetchone()
    if not item:
        raise HTTPException(404, "Eso ya no está en la lista")
    return item


def add_item(
    cur: psycopg.Cursor, user_id: int, body: ItemIn, pantry_id: int | None = None
) -> tuple[dict, bool, bool]:
    """Apunta algo en la lista. Si ya estaba pendiente (mismo nombre y mismo dueño), no
    lo duplica: devuelve el que había, y si ahora corre prisa, lo marca urgente.

    Devuelve (elemento, ya estaba, acaba de pasar a urgente): lo último decide el aviso push."""
    name = body.name.strip()
    cur.execute(
        ITEM_SELECT + " WHERE bought_at IS NULL AND lower(name) = lower(%s)"
        " AND owner_id IS NOT DISTINCT FROM %s",
        (name, body.owner_id),
    )
    existing = cur.fetchone()
    if existing:
        if body.urgent and not existing["urgent"]:
            cur.execute("UPDATE items SET urgent = true WHERE id = %s RETURNING *", (existing["id"],))
            existing = cur.fetchone()
            bump(cur)
            return existing, True, True
        return existing, True, False
    category = body.category or guess_category(cur, name)
    cur.execute(
        "INSERT INTO items (name, quantity, note, category, owner_id, urgent, pantry_id, created_by)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
        (name, body.quantity.strip(), body.note.strip(), category, body.owner_id, body.urgent, pantry_id, user_id),
    )
    item = cur.fetchone()
    log(cur, user_id, "added", name, item_id=item["id"], owner_id=body.owner_id, urgent=body.urgent)
    bump(cur)
    return item, False, body.urgent


def apply_price(cur: psycopg.Cursor, item: dict, price_cents: int | None, user_id: int) -> dict:
    """Guarda el precio y rehace su gasto en las cuentas. Lo común se reparte entre
    todos; lo de alguien, se lo debe esa persona al que lo compró."""
    cur.execute("DELETE FROM expenses WHERE item_id = %s", (item["id"],))
    cur.execute("UPDATE items SET price_cents = %s WHERE id = %s RETURNING *", (price_cents, item["id"]))
    item = cur.fetchone()
    if price_cents is None or item["bought_by"] is None:
        return item
    beneficiaries = member_ids(cur) if item["owner_id"] is None else [item["owner_id"]]
    if beneficiaries == [item["bought_by"]]:
        return item
    create_expense(
        cur,
        kind="purchase",
        description=item["name"],
        amount_cents=price_cents,
        paid_by=item["bought_by"],
        shares=split_cents(price_cents, beneficiaries),
        created_by=user_id,
        item_id=item["id"],
    )
    return item


@router.get("")
def list_items(user: dict = Depends(current_user)):
    with tx() as cur:
        cur.execute(ITEM_SELECT + " WHERE bought_at IS NULL ORDER BY urgent DESC, created_at")
        pending = cur.fetchall()
        cur.execute(
            ITEM_SELECT + " WHERE bought_at > now() - interval '30 days' ORDER BY bought_at DESC LIMIT 60"
        )
        bought = cur.fetchall()
    return {"pending": pending, "bought": bought}


@router.post("")
def create_item(body: ItemIn, background: BackgroundTasks, user: dict = Depends(current_user)):
    check_category(body.category)
    with tx() as cur:
        check_owner(cur, body.owner_id)
        item, duplicate, became_urgent = add_item(cur, user["id"], body)
    if became_urgent:
        background.add_task(push.notify_urgent, item["id"], user["id"], "urgent")
    return {"item": item, "duplicate": duplicate}


@router.patch("/{item_id}")
def update_item(item_id: int, body: ItemPatch, background: BackgroundTasks, user: dict = Depends(current_user)):
    check_category(body.category)
    fields = body.model_dump(exclude_unset=True)
    # Solo owner_id admite null (= pasa a común); en el resto null es "no lo toco".
    fields = {k: v for k, v in fields.items() if v is not None or k == "owner_id"}
    with tx() as cur:
        item = get_item(cur, item_id)
        was_urgent = item["urgent"]
        if "owner_id" in fields:
            check_owner(cur, fields["owner_id"])
        if not fields:
            return item
        assignments = ", ".join(f"{key} = %s" for key in fields)
        values = [v.strip() if isinstance(v, str) else v for v in fields.values()]
        cur.execute(f"UPDATE items SET {assignments} WHERE id = %s RETURNING *", (*values, item_id))
        item = cur.fetchone()
        if item["bought_at"] is not None and "owner_id" in fields:
            # Cambia quién paga qué: el gasto se rehace con el mismo precio.
            item = apply_price(cur, item, item["price_cents"], user["id"])
        bump(cur)
    if item["urgent"] and not was_urgent and item["bought_at"] is None:
        background.add_task(push.notify_urgent, item_id, user["id"], "urgent")
    return item


@router.delete("/{item_id}")
def delete_item(item_id: int, user: dict = Depends(current_user)):
    with tx() as cur:
        item = get_item(cur, item_id)
        cur.execute("DELETE FROM expenses WHERE item_id = %s", (item_id,))
        cur.execute("DELETE FROM items WHERE id = %s", (item_id,))
        if item["bought_at"] is None:
            log(cur, user["id"], "removed", item["name"])
        bump(cur)
    return {"ok": True}


@router.post("/{item_id}/buy")
def buy_item(item_id: int, body: PriceIn, user: dict = Depends(current_user)):
    with tx() as cur:
        item = get_item(cur, item_id)
        if item["bought_at"] is not None:
            return item
        cur.execute(
            "UPDATE items SET bought_by = %s, bought_at = now(), urgent = false WHERE id = %s RETURNING *",
            (user["id"], item_id),
        )
        item = cur.fetchone()
        # Lo comprado vuelve a haber en casa: su entrada del inventario pasa a "hay".
        cur.execute(
            "UPDATE pantry SET level = 'ok', updated_by = %s, updated_at = now()"
            " WHERE level <> 'ok' AND (id = %s OR (lower(name) = lower(%s) AND owner_id IS NOT DISTINCT FROM %s))",
            (user["id"], item["pantry_id"], item["name"], item["owner_id"]),
        )
        if body.price_cents is not None:
            item = apply_price(cur, item, body.price_cents, user["id"])
        log(cur, user["id"], "bought", item["name"], item_id=item_id, owner_id=item["owner_id"],
            price_cents=item["price_cents"])
        bump(cur)
    return item


@router.put("/{item_id}/price")
def set_price(item_id: int, body: PriceIn, user: dict = Depends(current_user)):
    with tx() as cur:
        item = get_item(cur, item_id)
        if item["bought_at"] is None:
            raise HTTPException(409, "El precio se pone al comprarlo")
        item = apply_price(cur, item, body.price_cents, user["id"])
        bump(cur)
    return item


@router.post("/{item_id}/unbuy")
def unbuy_item(item_id: int, user: dict = Depends(current_user)):
    with tx() as cur:
        item = get_item(cur, item_id)
        cur.execute("DELETE FROM expenses WHERE item_id = %s", (item_id,))
        cur.execute(
            "UPDATE items SET bought_by = NULL, bought_at = NULL, price_cents = NULL"
            " WHERE id = %s RETURNING *",
            (item_id,),
        )
        item = cur.fetchone()
        # El "lo ha comprado" del feed sobra si al final no se compró.
        cur.execute(
            "DELETE FROM activity WHERE kind = 'bought' AND (detail->>'item_id')::bigint = %s",
            (item_id,),
        )
        bump(cur)
    return item
