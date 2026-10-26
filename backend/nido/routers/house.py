"""La casa en sí: quién vive, qué ha pasado y si hay algo nuevo que recargar."""

from fastapi import APIRouter, Depends

from nido.auth import current_user, public_user
from nido.categories import CATEGORIES
from nido.db import tx
from nido.settings import settings

router = APIRouter(prefix="/api")


@router.get("/house")
def house(user: dict = Depends(current_user)):
    with tx() as cur:
        cur.execute("SELECT * FROM users ORDER BY id")
        members = [public_user(row) for row in cur.fetchall()]
    return {
        "name": settings.house_name,
        "members": members,
        "categories": CATEGORIES,
        # Para invitar a alguien más desde la app sin tener que buscarlo.
        "invite_code": settings.invite_code,
    }


@router.get("/pulse")
def pulse(user: dict = Depends(current_user)):
    """Número que sube con cada cambio. El cliente lo consulta cada pocos segundos y
    solo recarga si ha cambiado: barato para la base y casi en tiempo real."""
    with tx() as cur:
        cur.execute("SELECT last_value, is_called FROM change_seq")
        row = cur.fetchone()
    return {"v": row["last_value"] if row["is_called"] else 0}


@router.get("/activity")
def activity(user: dict = Depends(current_user)):
    with tx() as cur:
        cur.execute("SELECT * FROM activity ORDER BY created_at DESC, id DESC LIMIT 80")
        return cur.fetchall()


@router.get("/suggestions")
def suggestions(user: dict = Depends(current_user)):
    """Lo que ya se ha apuntado alguna vez, de más a menos frecuente: autocompletado."""
    with tx() as cur:
        cur.execute(
            "SELECT DISTINCT ON (lower(name)) name, category, n FROM ("
            "  SELECT name, category, created_at, count(*) OVER (PARTITION BY lower(name)) AS n"
            "  FROM (SELECT name, category, created_at FROM items"
            "        UNION ALL SELECT name, category, created_at FROM pantry) all_names"
            ") t ORDER BY lower(name), created_at DESC"
        )
        rows = cur.fetchall()
    rows.sort(key=lambda r: -r["n"])
    return [{"name": r["name"], "category": r["category"]} for r in rows[:400]]
