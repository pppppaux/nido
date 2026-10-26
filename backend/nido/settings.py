"""Configuración por variables de entorno (backend/.env en local, plantilla de ansible en el servidor)."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"falta {name} en el entorno")
    return value


class Settings:
    def __init__(self) -> None:
        self.database_url = _required("DATABASE_URL")
        self.jwt_secret = _required("JWT_SECRET")
        # Código que hay que dar al registrarse: es lo que hace que solo entre la gente del piso.
        self.invite_code = _required("INVITE_CODE")
        # Con false nadie más puede crear cuenta, ni con el código: la casa ya está completa.
        self.registration_open = os.environ.get("REGISTRATION_OPEN", "true").lower() in ("1", "true", "yes")
        self.house_name = os.environ.get("HOUSE_NAME", "Nuestro piso").strip() or "Nuestro piso"
        # La web vive en otro dominio (GitHub Pages): solo esos orígenes pueden llamar a la API.
        self.allowed_origins = [
            o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
        ]
        self.session_days = int(os.environ.get("SESSION_DAYS", "180"))
        # Clave privada VAPID (base64url, 32 bytes) para los avisos push. Opcional: sin ella
        # los avisos están apagados.
        self.vapid_private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip()


settings = Settings()
