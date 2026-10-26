"""Avisos push (Web Push con VAPID) cuando alguien apunta algo urgente.

Sin VAPID_PRIVATE_KEY en el entorno los avisos están apagados: /api/push/key devuelve
null, la web no ofrece activarlos y notify_urgent no hace nada.
"""

import base64
import json
import logging
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from nido.db import tx
from nido.settings import settings

log = logging.getLogger("nido.push")

# Para quién es la clave VAPID. Los servicios de push piden un contacto: va la propia web,
# y no un correo, para no publicar ninguno. Solo el origen: py_vapid rechaza una URL con
# ruta ("Missing 'sub' from claims").
VAPID_SUBJECT = "https://pppppaux.github.io"


@lru_cache(maxsize=1)
def _vapid() -> Vapid02 | None:
    if not settings.vapid_private_key:
        return None
    return Vapid02.from_raw(settings.vapid_private_key.encode())


def public_key() -> str | None:
    """La applicationServerKey que pide el navegador para suscribirse (punto sin comprimir)."""
    vapid = _vapid()
    if vapid is None:
        return None
    raw = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _send(sub: dict, payload: dict) -> bool:
    """Manda un aviso. Devuelve False si la suscripción ya no existe y hay que borrarla."""
    try:
        webpush(
            {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
            json.dumps(payload, ensure_ascii=False),
            vapid_private_key=_vapid(),
            vapid_claims={"sub": VAPID_SUBJECT},
            # Un aviso de "falta X" que llega un día tarde ya no sirve.
            ttl=12 * 3600,
            timeout=10,
            headers={"Urgency": "high"},
        )
        return True
    except WebPushException as e:
        status = e.response.status_code if e.response is not None else None
        if status in (404, 410):
            return False
        log.warning("push fallido (%s) a %s…", status, sub["endpoint"][:40])
        return True
    except Exception:
        log.exception("push fallido")
        return True


def notify_urgent(item_id: int, actor_id: int, reason: str) -> None:
    """Avisa a todos menos a quien lo ha hecho. Corre en segundo plano, ya fuera de la
    transacción (BackgroundTasks de FastAPI), así que no retrasa la respuesta."""
    if _vapid() is None:
        return
    with tx() as cur:
        cur.execute("SELECT * FROM items WHERE id = %s", (item_id,))
        item = cur.fetchone()
        cur.execute("SELECT display_name FROM users WHERE id = %s", (actor_id,))
        actor = cur.fetchone()
        if not item or not actor or item["bought_at"] is not None:
            return
        owner_name = None
        if item["owner_id"] is not None:
            cur.execute("SELECT id, display_name FROM users WHERE id = %s", (item["owner_id"],))
            owner = cur.fetchone()
            owner_name = owner["display_name"] if owner else None
        cur.execute("SELECT * FROM push_subscriptions WHERE user_id <> %s", (actor_id,))
        subs = cur.fetchall()
    if not subs:
        return

    who = actor["display_name"]
    if reason == "out":
        body = f"{who} avisa de que se ha acabado"
    else:
        body = f"{who} lo ha apuntado como urgente"
    if owner_name and item["owner_id"] != actor_id:
        body += f" (para {owner_name})"
    elif owner_name:
        body += " (es suyo)"
    title = item["name"] + (f" · {item['quantity']}" if item["quantity"] else "")
    # tag: si se avisa dos veces de lo mismo, el móvil sustituye el aviso en vez de apilarlo.
    payload = {"title": title, "body": body, "tag": f"item-{item_id}"}

    dead = [s["id"] for s in subs if not _send(s, payload)]
    if dead:
        with tx() as cur:
            cur.execute("DELETE FROM push_subscriptions WHERE id = ANY(%s)", (dead,))
