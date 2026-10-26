"""Cuentas del piso: quién ha puesto qué y quién le debe a quién."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from nido.auth import current_user
from nido.db import bump, tx
from nido.house import balances, create_expense, log, member_ids, settle_up, split_cents

router = APIRouter(prefix="/api")


class ExpenseIn(BaseModel):
    description: str = Field(min_length=1, max_length=80)
    amount_cents: int = Field(gt=0, le=10_000_000)
    paid_by: int
    # Entre quiénes se reparte. Vacío = entre todos.
    user_ids: list[int] = Field(default_factory=list)
    spent_on: date | None = None


class SettlementIn(BaseModel):
    from_user_id: int
    to_user_id: int
    amount_cents: int = Field(gt=0, le=10_000_000)


@router.get("/money")
def money(user: dict = Depends(current_user)):
    with tx() as cur:
        balance = balances(cur)
        cur.execute(
            "SELECT e.*, COALESCE(json_agg(json_build_object('user_id', s.user_id, 'share_cents', s.share_cents))"
            "   FILTER (WHERE s.user_id IS NOT NULL), '[]') AS shares"
            " FROM expenses e LEFT JOIN expense_shares s ON s.expense_id = e.id"
            " GROUP BY e.id ORDER BY e.spent_on DESC, e.id DESC LIMIT 150"
        )
        expenses = cur.fetchall()
        cur.execute(
            "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses"
            " WHERE kind <> 'settlement' AND spent_on >= date_trunc('month', CURRENT_DATE)"
        )
        month_total = int(cur.fetchone()["total"])
    return {
        "balances": [{"user_id": uid, "balance_cents": b} for uid, b in balance.items()],
        "transfers": settle_up(balance),
        "expenses": expenses,
        "month_total_cents": month_total,
    }


@router.post("/expenses")
def add_expense(body: ExpenseIn, user: dict = Depends(current_user)):
    with tx() as cur:
        members = member_ids(cur)
        beneficiaries = body.user_ids or members
        if body.paid_by not in members or any(uid not in members for uid in beneficiaries):
            raise HTTPException(422, "Esa persona no vive aquí")
        expense_id = create_expense(
            cur,
            kind="expense",
            description=body.description.strip(),
            amount_cents=body.amount_cents,
            paid_by=body.paid_by,
            shares=split_cents(body.amount_cents, beneficiaries),
            created_by=user["id"],
            spent_on=body.spent_on,
        )
        log(cur, user["id"], "expense", body.description.strip(), amount_cents=body.amount_cents,
            paid_by=body.paid_by)
        bump(cur)
    return {"id": expense_id}


@router.post("/settlements")
def add_settlement(body: SettlementIn, user: dict = Depends(current_user)):
    if body.from_user_id == body.to_user_id:
        raise HTTPException(422, "Un pago es entre dos personas distintas")
    with tx() as cur:
        members = member_ids(cur)
        if body.from_user_id not in members or body.to_user_id not in members:
            raise HTTPException(422, "Esa persona no vive aquí")
        # Pagar es un gasto del que paga cuyo único beneficiario es quien cobra: su saldo
        # sube y el del otro baja en lo mismo.
        create_expense(
            cur,
            kind="settlement",
            description="Pago",
            amount_cents=body.amount_cents,
            paid_by=body.from_user_id,
            shares={body.to_user_id: body.amount_cents},
            created_by=user["id"],
        )
        log(cur, user["id"], "settlement", "Pago", amount_cents=body.amount_cents,
            from_user_id=body.from_user_id, to_user_id=body.to_user_id)
        bump(cur)
    return {"ok": True}


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, user: dict = Depends(current_user)):
    with tx() as cur:
        cur.execute("SELECT * FROM expenses WHERE id = %s", (expense_id,))
        expense = cur.fetchone()
        if not expense:
            raise HTTPException(404, "Ese gasto ya no existe")
        if expense["item_id"] is not None:
            # El precio de una compra se quita desde la propia compra, para que la lista
            # y las cuentas digan lo mismo.
            cur.execute("UPDATE items SET price_cents = NULL WHERE id = %s", (expense["item_id"],))
        cur.execute("DELETE FROM expenses WHERE id = %s", (expense_id,))
        log(cur, user["id"], "expense_deleted", expense["description"], amount_cents=expense["amount_cents"])
        bump(cur)
    return {"ok": True}
