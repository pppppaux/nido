from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from nido import push
from nido.auth import current_user
from nido.db import tx

router = APIRouter(prefix="/api/push")


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: SubscriptionKeys


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.get("/key")
def key(user: dict = Depends(current_user)):
    return {"key": push.public_key()}


@router.post("/subscribe")
def subscribe(body: SubscriptionIn, user: dict = Depends(current_user)):
    # El endpoint es del navegador: si otro usuario entra en el mismo, pasa a ser suyo.
    with tx() as cur:
        cur.execute(
            "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (%s, %s, %s, %s)"
            " ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,"
            " p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth",
            (user["id"], body.endpoint, body.keys.p256dh, body.keys.auth),
        )
    return {"ok": True}


@router.post("/unsubscribe")
def unsubscribe(body: EndpointIn, user: dict = Depends(current_user)):
    with tx() as cur:
        cur.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = %s AND user_id = %s", (body.endpoint, user["id"])
        )
    return {"ok": True}
