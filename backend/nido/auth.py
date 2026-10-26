"""Sesiones: un JWT que la web guarda y manda en Authorization.

No va en cookie porque la web (GitHub Pages) y la API (la VM) están en dominios
distintos, y Safari bloquea las cookies de terceros: la sesión no llegaría nunca.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Header, HTTPException

from nido.db import tx
from nido.settings import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def issue_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(user["id"]),
            "ver": user["token_version"],
            "iat": now,
            "exp": now + timedelta(days=settings.session_days),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def public_user(row: dict) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "color": row["color"],
    }


def session(user: dict) -> dict:
    return {"user": public_user(user), "token": issue_token(user)}


def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Inicia sesión")
    try:
        claims = jwt.decode(authorization[7:].strip(), settings.jwt_secret, algorithms=["HS256"])
        user_id = int(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "La sesión ha caducado")
    with tx() as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
    if not user or user["token_version"] != claims.get("ver"):
        raise HTTPException(401, "La sesión ha caducado")
    return user
