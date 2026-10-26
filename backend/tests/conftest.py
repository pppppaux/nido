import os
from pathlib import Path

import pytest
from dotenv import dotenv_values

# Una base aparte (backend/.env.test): los tests la vacían entera antes de cada uno.
_test_env = dotenv_values(Path(__file__).resolve().parent.parent / ".env.test")
os.environ["DATABASE_URL"] = _test_env.get("TEST_DATABASE_URL") or os.environ["TEST_DATABASE_URL"]
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ["INVITE_CODE"] = "codigo"

from fastapi.testclient import TestClient  # noqa: E402

from nido.db import run_migrations, tx  # noqa: E402
from nido.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    run_migrations()
    with tx() as cur:
        cur.execute(
            "TRUNCATE activity, expense_shares, expenses, items, pantry, users RESTART IDENTITY CASCADE"
        )
    yield


def make_client(username: str, name: str) -> TestClient:
    client = TestClient(app)
    res = client.post(
        "/api/auth/register",
        json={"invite_code": "codigo", "username": username, "display_name": name, "password": "contraseña1"},
    )
    assert res.status_code == 200, res.text
    client.user = res.json()["user"]
    client.headers["Authorization"] = f"Bearer {res.json()['token']}"
    return client


@pytest.fixture
def trio():
    return make_client("ana", "Ana"), make_client("bea", "Bea"), make_client("carlos", "Carlos")
