import hmac
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from nido.auth import check_password, current_user, hash_password, public_user, session
from nido.db import bump, tx
from nido.house import COLORS, log
from nido.settings import settings

router = APIRouter(prefix="/api/auth")

USERNAME_RE = re.compile(r"^[a-z0-9._-]{2,32}$")
HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


class RegisterIn(BaseModel):
    invite_code: str = Field(max_length=200)
    username: str = Field(max_length=32)
    display_name: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(max_length=200)


class ProfileIn(BaseModel):
    # El nombre (y el usuario) solo se cambian en la base, a mano: desde la app, solo el
    # color. forbid: mandar display_name da un 422 en vez de ignorarse sin decir nada.
    model_config = ConfigDict(extra="forbid")
    color: str


class PasswordIn(BaseModel):
    current: str = Field(max_length=200)
    new: str = Field(min_length=8, max_length=200)


@router.post("/register")
def register(body: RegisterIn):
    if not hmac.compare_digest(body.invite_code.strip().encode(), settings.invite_code.encode()):
        raise HTTPException(403, "Ese código de casa no es el bueno")
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(422, "El usuario solo puede llevar letras, números, punto y guiones")
    with tx() as cur:
        cur.execute("SELECT 1 FROM users WHERE username = %s", (username,))
        if cur.fetchone():
            raise HTTPException(409, "Ese usuario ya existe")
        cur.execute("SELECT color FROM users")
        taken = {row["color"] for row in cur.fetchall()}
        color = next((c for c in COLORS if c not in taken), COLORS[0])
        cur.execute(
            "INSERT INTO users (username, display_name, password_hash, color)"
            " VALUES (%s, %s, %s, %s) RETURNING *",
            (username, body.display_name.strip(), hash_password(body.password), color),
        )
        user = cur.fetchone()
        log(cur, user["id"], "joined", user["display_name"])
        bump(cur)
    return session(user)


@router.post("/login")
def login(body: LoginIn):
    with tx() as cur:
        cur.execute("SELECT * FROM users WHERE username = %s", (body.username.strip().lower(),))
        user = cur.fetchone()
    if not user or not check_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    return session(user)


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return public_user(user)


@router.patch("/me")
def update_me(body: ProfileIn, user: dict = Depends(current_user)):
    if not HEX_COLOR_RE.match(body.color):
        raise HTTPException(422, "Color no válido")
    with tx() as cur:
        cur.execute(
            "UPDATE users SET color = %s"
            " WHERE id = %s RETURNING *",
            (body.color, user["id"]),
        )
        updated = cur.fetchone()
        bump(cur)
    return public_user(updated)


@router.post("/password")
def change_password(body: PasswordIn, user: dict = Depends(current_user)):
    if not check_password(body.current, user["password_hash"]):
        raise HTTPException(403, "La contraseña actual no es esa")
    with tx() as cur:
        # token_version + 1 cierra la sesión en el resto de dispositivos.
        cur.execute(
            "UPDATE users SET password_hash = %s, token_version = token_version + 1"
            " WHERE id = %s RETURNING *",
            (hash_password(body.new), user["id"]),
        )
        updated = cur.fetchone()
    # Un token nuevo para este dispositivo; el resto se queda fuera.
    return session(updated)
