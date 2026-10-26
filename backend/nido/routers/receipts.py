"""Tickets: se lee la foto con IA y se devuelve un borrador; nada se apunta hasta que quien
lo sube lo revisa (quita lo que es solo suyo, corrige un precio) y lo confirma."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from nido import ai
from nido.auth import current_user
from nido.db import bump, tx
from nido.house import log
from nido.routers.items import check_category, check_owner, guess_category, mark_bought

router = APIRouter(prefix="/api/receipts")

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
# La web la reduce antes de subirla (lado largo de 2000 px, JPEG): una foto normal llega
# en unos cientos de KB. Esto solo para lo que venga sin pasar por ahí.
MAX_IMAGE_BYTES = 5 * 1024 * 1024


class LineIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: str = Field(default="", max_length=40)
    price_cents: int = Field(gt=0, le=10_000_000)
    item_id: int | None = None
    owner_id: int | None = None
    category: str | None = None


class ConfirmIn(BaseModel):
    store: str | None = Field(default=None, max_length=60)
    lines: list[LineIn] = Field(min_length=1, max_length=150)


@router.post("/read")
def read(photo: UploadFile = File(...), user: dict = Depends(current_user)):
    if not ai.enabled():
        raise HTTPException(503, "La lectura de tickets no está configurada")
    if photo.content_type not in IMAGE_TYPES:
        raise HTTPException(415, "Sube una foto (JPEG, PNG o WebP)")
    data = photo.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "La foto es demasiado grande")

    with tx() as cur:
        cur.execute("SELECT * FROM items WHERE bought_at IS NULL ORDER BY created_at")
        pending = {item["id"]: item for item in cur.fetchall()}

    # Fuera de la transacción: la IA tarda decenas de segundos y no hay que tener una
    # conexión de Neon ocupada mientras tanto.
    result = ai.read_receipt(photo.content_type, data, list(pending.values()))

    with tx() as cur:
        for line in result["lines"]:
            item = pending.get(line["item_id"])
            # Lo que ya estaba en la lista conserva su dueño y su categoría.
            line["owner_id"] = item["owner_id"] if item else None
            line["category"] = item["category"] if item else guess_category(cur, line["name"])
    result["sum_cents"] = sum(line["price_cents"] for line in result["lines"])
    return result


@router.post("/confirm")
def confirm(body: ConfirmIn, user: dict = Depends(current_user)):
    for line in body.lines:
        check_category(line.category)
    with tx() as cur:
        for owner_id in {line.owner_id for line in body.lines}:
            check_owner(cur, owner_id)
        matched = 0
        for line in body.lines:
            item = None
            if line.item_id is not None:
                cur.execute("SELECT * FROM items WHERE id = %s AND bought_at IS NULL", (line.item_id,))
                item = cur.fetchone()
            else:
                # La IA no lo casó, pero si hay algo pendiente que se llama igual y es del mismo
                # dueño, es eso: si no, se quedaría en la lista algo que ya está comprado.
                cur.execute(
                    "SELECT * FROM items WHERE bought_at IS NULL AND lower(name) = lower(%s)"
                    " AND owner_id IS NOT DISTINCT FROM %s ORDER BY created_at LIMIT 1",
                    (line.name.strip(), line.owner_id),
                )
                item = cur.fetchone()
            if item:
                matched += 1
                if item["owner_id"] != line.owner_id:
                    cur.execute("UPDATE items SET owner_id = %s WHERE id = %s RETURNING *", (line.owner_id, item["id"]))
                    item = cur.fetchone()
            else:
                # No estaba en la lista (o alguien lo tachó mientras tanto): se apunta ya comprado.
                name = line.name.strip()
                cur.execute(
                    "INSERT INTO items (name, quantity, category, owner_id, created_by)"
                    " VALUES (%s, %s, %s, %s, %s) RETURNING *",
                    (name, line.quantity.strip(), line.category or guess_category(cur, name), line.owner_id, user["id"]),
                )
                item = cur.fetchone()
            mark_bought(cur, item, user["id"], line.price_cents)

        total = sum(line.price_cents for line in body.lines)
        # Una sola línea en el feed por ticket, no una por producto.
        log(cur, user["id"], "receipt", body.store or "Ticket", count=len(body.lines), matched=matched,
            total_cents=total)
        bump(cur)
    return {"count": len(body.lines), "matched": matched, "total_cents": total}
