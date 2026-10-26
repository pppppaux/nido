"""Lo que hay en casa. Marcar algo como "queda poco" o "se acabó" lo apunta solo en la
lista; comprarlo desde la lista lo devuelve a "hay" (routers/items.py, buy_item)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from nido.auth import current_user
from nido.db import bump, tx
from nido.house import log
from nido.routers.items import ItemIn, add_item, check_category, check_owner, guess_category

router = APIRouter(prefix="/api/pantry")

Level = Literal["ok", "low", "out"]


class PantryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: str | None = None
    owner_id: int | None = None
    level: Level = "ok"


class PantryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    category: str | None = None
    owner_id: int | None = None
    level: Level | None = None


def sync_with_list(cur, entry: dict, user_id: int) -> None:
    """Pone la lista de acuerdo con el nivel: si falta, que esté apuntado; si vuelve a
    haber, se quita lo que se apuntó desde aquí y nadie ha comprado todavía."""
    if entry["level"] in ("low", "out"):
        add_item(
            cur,
            user_id,
            ItemIn(name=entry["name"], category=entry["category"], owner_id=entry["owner_id"],
                   urgent=entry["level"] == "out"),
            pantry_id=entry["id"],
        )
    else:
        cur.execute("DELETE FROM items WHERE pantry_id = %s AND bought_at IS NULL", (entry["id"],))


@router.get("")
def list_pantry(user: dict = Depends(current_user)):
    with tx() as cur:
        cur.execute("SELECT * FROM pantry ORDER BY lower(name)")
        return cur.fetchall()


@router.post("")
def create_entry(body: PantryIn, user: dict = Depends(current_user)):
    check_category(body.category)
    name = body.name.strip()
    with tx() as cur:
        check_owner(cur, body.owner_id)
        cur.execute(
            "SELECT 1 FROM pantry WHERE lower(name) = lower(%s) AND owner_id IS NOT DISTINCT FROM %s",
            (name, body.owner_id),
        )
        if cur.fetchone():
            raise HTTPException(409, "Eso ya está en el inventario")
        cur.execute(
            "INSERT INTO pantry (name, category, owner_id, level, updated_by)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING *",
            (name, body.category or guess_category(cur, name), body.owner_id, body.level, user["id"]),
        )
        entry = cur.fetchone()
        if entry["level"] != "ok":
            sync_with_list(cur, entry, user["id"])
        bump(cur)
    return entry


@router.patch("/{entry_id}")
def update_entry(entry_id: int, body: PantryPatch, user: dict = Depends(current_user)):
    check_category(body.category)
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k == "owner_id"}
    with tx() as cur:
        cur.execute("SELECT * FROM pantry WHERE id = %s", (entry_id,))
        before = cur.fetchone()
        if not before:
            raise HTTPException(404, "Eso ya no está en el inventario")
        if "owner_id" in fields:
            check_owner(cur, fields["owner_id"])
        if not fields:
            return before
        assignments = ", ".join(f"{key} = %s" for key in fields)
        values = [v.strip() if isinstance(v, str) else v for v in fields.values()]
        cur.execute(
            f"UPDATE pantry SET {assignments}, updated_by = %s, updated_at = now() WHERE id = %s RETURNING *",
            (*values, user["id"], entry_id),
        )
        entry = cur.fetchone()
        if entry["level"] != before["level"]:
            sync_with_list(cur, entry, user["id"])
            if entry["level"] != "ok":
                log(cur, user["id"], f"pantry_{entry['level']}", entry["name"], owner_id=entry["owner_id"])
        bump(cur)
    return entry


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, user: dict = Depends(current_user)):
    with tx() as cur:
        cur.execute("DELETE FROM pantry WHERE id = %s RETURNING id", (entry_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Eso ya no está en el inventario")
        bump(cur)
    return {"ok": True}
