"""Lo que comparten varios routers: miembros, feed de actividad y cuentas."""

import json

import psycopg

COLORS = ["#4C6EF5", "#E8590C", "#2F9E44", "#AE3EC9", "#F08C00", "#0C8599", "#E03131", "#5C7CFA"]


def log(cur: psycopg.Cursor, user_id: int | None, kind: str, subject: str, **detail) -> None:
    cur.execute(
        "INSERT INTO activity (user_id, kind, subject, detail) VALUES (%s, %s, %s, %s::jsonb)",
        (user_id, kind, subject, json.dumps(detail, ensure_ascii=False)),
    )


def member_ids(cur: psycopg.Cursor) -> list[int]:
    cur.execute("SELECT id FROM users ORDER BY id")
    return [row["id"] for row in cur.fetchall()]


def split_cents(amount_cents: int, user_ids: list[int]) -> dict[int, int]:
    """Reparto a partes iguales. Los céntimos que sobran van, de uno en uno, a los de
    id más bajo: siempre igual para la misma gente, y la suma cuadra exacta."""
    ids = sorted(set(user_ids))
    if not ids:
        raise ValueError("el reparto necesita al menos una persona")
    base, rest = divmod(amount_cents, len(ids))
    return {uid: base + (1 if i < rest else 0) for i, uid in enumerate(ids)}


def create_expense(
    cur: psycopg.Cursor,
    *,
    kind: str,
    description: str,
    amount_cents: int,
    paid_by: int,
    shares: dict[int, int],
    created_by: int,
    item_id: int | None = None,
    spent_on=None,
) -> int:
    cur.execute(
        "INSERT INTO expenses (kind, description, amount_cents, paid_by, item_id, created_by, spent_on)"
        " VALUES (%s, %s, %s, %s, %s, %s, COALESCE(%s, CURRENT_DATE)) RETURNING id",
        (kind, description, amount_cents, paid_by, item_id, created_by, spent_on),
    )
    expense_id = cur.fetchone()["id"]
    for uid, share in shares.items():
        cur.execute(
            "INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (%s, %s, %s)",
            (expense_id, uid, share),
        )
    return expense_id


def balances(cur: psycopg.Cursor) -> dict[int, int]:
    """Saldo de cada uno en céntimos: positivo = le deben, negativo = debe."""
    result = {uid: 0 for uid in member_ids(cur)}
    cur.execute("SELECT paid_by, SUM(amount_cents) AS total FROM expenses GROUP BY paid_by")
    for row in cur.fetchall():
        result[row["paid_by"]] = result.get(row["paid_by"], 0) + int(row["total"])
    cur.execute("SELECT user_id, SUM(share_cents) AS total FROM expense_shares GROUP BY user_id")
    for row in cur.fetchall():
        result[row["user_id"]] = result.get(row["user_id"], 0) - int(row["total"])
    return result


def settle_up(balance: dict[int, int]) -> list[dict]:
    """Pagos mínimos para quedar a cero: el que más debe le paga al que más le deben,
    y así hasta que no queda nada. Con tres personas da como mucho dos pagos."""
    debtors = sorted(([uid, -b] for uid, b in balance.items() if b < 0), key=lambda x: -x[1])
    creditors = sorted(([uid, b] for uid, b in balance.items() if b > 0), key=lambda x: -x[1])
    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        amount = min(debtors[i][1], creditors[j][1])
        transfers.append({"from": debtors[i][0], "to": creditors[j][0], "amount_cents": amount})
        debtors[i][1] -= amount
        creditors[j][1] -= amount
        if debtors[i][1] == 0:
            i += 1
        if creditors[j][1] == 0:
            j += 1
    return transfers
