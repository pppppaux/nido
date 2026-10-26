"""Acceso a Postgres: un pool de conexiones y las migraciones al arrancar."""

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from nido.settings import settings

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            settings.database_url,
            min_size=1,
            max_size=5,
            # Neon suspende el cómputo tras unos minutos sin uso y corta las conexiones
            # abiertas: se cierran antes por inactividad y se comprueban al sacarlas.
            max_idle=240,
            check=ConnectionPool.check_connection,
            # Sin sentencias preparadas: el pooler de Neon (PgBouncer en modo transacción)
            # no las lleva bien. ClientCursor interpola los parámetros en el cliente.
            kwargs={"cursor_factory": psycopg.ClientCursor, "row_factory": dict_row},
            open=True,
            name="nido",
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def tx() -> Iterator[psycopg.Cursor]:
    """Una transacción: commit al salir bien, rollback si algo lanza."""
    with get_pool().connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                yield cur


def bump(cur: psycopg.Cursor) -> None:
    """Marca que algo ha cambiado: los clientes lo ven en /api/pulse y recargan."""
    cur.execute("SELECT nextval('change_seq')")


def run_migrations() -> None:
    with tx() as cur:
        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        # Dos procesos arrancando a la vez no aplican la misma migración dos veces.
        cur.execute("SELECT pg_advisory_xact_lock(4242)")
        cur.execute("SELECT name FROM schema_migrations")
        applied = {row["name"] for row in cur.fetchall()}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            cur.execute(path.read_text())
            cur.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
