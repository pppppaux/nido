import { useState } from "react";
import { ArrowRight, Plus, Receipt, ShoppingBag, Handshake } from "lucide-react";
import { api } from "../lib/api";
import { dayLabel, money, parseEuros } from "../lib/format";
import { useStore } from "../lib/store";
import type { Expense } from "../lib/types";
import { Avatar, Button, Empty, Field, inputCls, Sheet } from "../components/ui";

export function MoneyScreen() {
  const s = useStore();
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<{ from: number; to: number; amount_cents: number } | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);

  const mine = s.money.balances.find((b) => b.user_id === s.me.id)?.balance_cents ?? 0;
  const maxAbs = Math.max(1, ...s.money.balances.map((b) => Math.abs(b.balance_cents)));
  const name = (id: number | undefined) => (id === s.me.id ? "Tú" : s.member(id)?.display_name ?? "Alguien");
  const paidLabel = (id: number) => (id === s.me.id ? "Pagaste tú" : `Pagó ${name(id)}`);

  return (
    <div className="pb-28">
      <h1 className="display mb-6 text-[56px]">Cuentas</h1>

      <section className="rounded-[28px] bg-surface p-5 shadow-card">
        <p className="text-[15px] text-muted">{mine > 0 ? "Te deben" : mine < 0 ? "Debes" : "Estás en paz"}</p>
        <p
          className={`display tabular mt-1 text-[48px] ${mine > 0 ? "text-pine" : mine < 0 ? "text-danger" : "text-ink"}`}
        >
          {money(Math.abs(mine))}
        </p>
        <p className="mt-2 text-[14px] text-faint">Este mes se han gastado {money(s.money.month_total_cents)} en total.</p>

        <ul className="mt-5 space-y-3 border-t border-line pt-4">
          {s.money.balances.map((b) => {
            const user = s.member(b.user_id);
            const pct = (Math.abs(b.balance_cents) / maxAbs) * 50;
            return (
              <li key={b.user_id} className="flex items-center gap-3">
                <Avatar user={user} size={28} />
                <span className="w-20 truncate text-[15px]">{name(b.user_id)}</span>
                {/* Barra centrada: a la derecha lo que le deben, a la izquierda lo que debe. */}
                <span className="relative h-2 flex-1 rounded-full bg-surface-2">
                  <span className="absolute top-[-3px] left-1/2 h-[14px] w-px bg-line" />
                  <span
                    className="absolute top-0 h-2 rounded-full"
                    style={{
                      width: `${pct}%`,
                      left: b.balance_cents >= 0 ? "50%" : `${50 - pct}%`,
                      background: b.balance_cents >= 0 ? "var(--pine)" : "var(--danger)",
                    }}
                  />
                </span>
                <span
                  className={`tabular w-24 text-right text-[15px] ${b.balance_cents > 0 ? "text-pine" : b.balance_cents < 0 ? "text-danger" : "text-muted"}`}
                >
                  {b.balance_cents > 0 ? "+" : ""}
                  {money(b.balance_cents)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {s.money.transfers.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 px-1 text-[14px] font-medium text-muted">Para quedar en paz</h2>
          <ul className="overflow-hidden rounded-3xl bg-surface shadow-card">
            {s.money.transfers.map((t, idx) => (
              <li key={`${t.from}-${t.to}`} className={`flex items-center gap-3 px-4 py-3 ${idx ? "border-t border-line" : ""}`}>
                <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px]">
                  <span className="truncate">{name(t.from)}</span>
                  <ArrowRight size={15} className="shrink-0 text-faint" />
                  <span className="truncate">{t.to === s.me.id ? "ti" : name(t.to)}</span>
                  <span className="tabular ml-auto font-semibold">{money(t.amount_cents)}</span>
                </span>
                <Button variant="soft" className="!px-3 !py-2 text-[14px]" onClick={() => setPaying(t)}>
                  Pagado
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-[14px] font-medium text-muted">Movimientos</h2>
        {s.money.expenses.length === 0 ? (
          <div className="rounded-3xl bg-surface shadow-card">
            <Empty title="Sin gastos todavía">
              Pon el precio al marcar algo como comprado, o añade un gasto suelto como la luz o internet.
            </Empty>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-3xl bg-surface shadow-card">
            {s.money.expenses.map((e, idx) => {
              const Icon = e.kind === "settlement" ? Handshake : e.kind === "purchase" ? ShoppingBag : Receipt;
              const showDay = idx === 0 || s.money.expenses[idx - 1].spent_on !== e.spent_on;
              return (
                <li key={e.id}>
                  {showDay && (
                    <p className={`bg-surface-2 px-4 py-1.5 text-[12px] font-medium text-muted ${idx ? "border-t border-line" : ""}`}>
                      {dayLabel(e.spent_on + "T12:00:00")}
                    </p>
                  )}
                  <button onClick={() => setViewing(e)} className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left first:border-t-0">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px]">
                        {e.kind === "settlement"
                          ? `${name(e.paid_by)} → ${name(e.shares[0]?.user_id)}`
                          : e.description}
                      </span>
                      <span className="block text-[13px] text-faint">
                        {e.kind === "settlement"
                          ? "Pago"
                          : `${paidLabel(e.paid_by)} · ${
                              e.shares.length === s.house.members.length ? "entre todos" : e.shares.map((x) => name(x.user_id)).join(", ")
                            }`}
                      </span>
                    </span>
                    <span className="tabular text-[15px] font-medium">{money(e.amount_cents)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button
        onClick={() => setAdding(true)}
        className="fixed z-30 flex items-center gap-2 rounded-full bg-pine py-3.5 pr-5 pl-4 font-semibold text-pine-ink shadow-card transition hover:brightness-110"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 84px)", right: "max(16px, calc(50vw - 284px))" }}
      >
        <Plus size={20} strokeWidth={2.5} /> Gasto
      </button>

      {adding && <ExpenseSheet onClose={() => setAdding(false)} />}
      {paying && <SettleSheet transfer={paying} onClose={() => setPaying(null)} />}
      {viewing && <ExpenseDetail expense={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ExpenseSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(s.me.id);
  const [between, setBetween] = useState<number[]>(s.house.members.map((m) => m.id));
  const cents = parseEuros(amount);

  const toggle = (id: number) => setBetween((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));

  async function save() {
    if (!cents) return;
    const ok = await s.run(() =>
      api("/api/expenses", { body: { description, amount_cents: cents, paid_by: paidBy, user_ids: between } }),
    );
    if (ok) onClose();
  }

  return (
    <Sheet title="Añadir gasto" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Qué">
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Internet de noviembre" maxLength={80} />
        </Field>
        <Field label="Cuánto">
          <div className="relative">
            <input className={`${inputCls} tabular pr-10 text-[20px]`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            <span className="absolute top-1/2 right-4 -translate-y-1/2 text-muted">€</span>
          </div>
        </Field>
        <Field label="Pagó">
          <div className="flex flex-wrap gap-2">
            {s.house.members.map((m) => (
              <PersonChip key={m.id} active={paidBy === m.id} onClick={() => setPaidBy(m.id)} label={m.id === s.me.id ? "Yo" : m.display_name} color={m.color} />
            ))}
          </div>
        </Field>
        <Field label="Se reparte entre">
          <div className="flex flex-wrap gap-2">
            {s.house.members.map((m) => (
              <PersonChip key={m.id} active={between.includes(m.id)} onClick={() => toggle(m.id)} label={m.id === s.me.id ? "Yo" : m.display_name} color={m.color} />
            ))}
          </div>
        </Field>
        {cents && between.length > 0 && (
          <p className="text-[14px] text-muted">
            {money(Math.round(cents / between.length))} cada uno.
          </p>
        )}
        <Button className="w-full" onClick={save} disabled={!description.trim() || !cents || between.length === 0}>
          Añadir gasto
        </Button>
      </div>
    </Sheet>
  );
}

function PersonChip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[14px] font-medium transition ${
        active ? "border-transparent bg-ink text-paper" : "border-line bg-surface-2 hover:border-faint"
      }`}
    >
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </button>
  );
}

function SettleSheet({ transfer, onClose }: { transfer: { from: number; to: number; amount_cents: number }; onClose: () => void }) {
  const s = useStore();
  const [amount, setAmount] = useState((transfer.amount_cents / 100).toFixed(2).replace(".", ","));
  const cents = parseEuros(amount);
  const from = s.member(transfer.from);
  const to = s.member(transfer.to);
  return (
    <Sheet title="Apuntar un pago" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-4 py-2">
          <Avatar user={from} size={44} />
          <ArrowRight className="text-faint" />
          <Avatar user={to} size={44} />
        </div>
        <p className="text-center text-[15px] text-muted">
          {from?.id === s.me.id ? "Tú le pagas" : `${from?.display_name} le paga`} a {to?.id === s.me.id ? "ti" : to?.display_name}
        </p>
        <Field label="Cuánto">
          <div className="relative">
            <input className={`${inputCls} tabular pr-10 text-[20px]`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="absolute top-1/2 right-4 -translate-y-1/2 text-muted">€</span>
          </div>
        </Field>
        <Button
          className="w-full"
          disabled={!cents}
          onClick={async () =>
            (await s.run(() =>
              api("/api/settlements", { body: { from_user_id: transfer.from, to_user_id: transfer.to, amount_cents: cents } }),
            )) && onClose()
          }
        >
          Apuntar pago
        </Button>
      </div>
    </Sheet>
  );
}

function ExpenseDetail({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const s = useStore();
  const name = (id: number) => (id === s.me.id ? "Tú" : s.member(id)?.display_name ?? "Alguien");
  return (
    <Sheet title={expense.kind === "settlement" ? "Pago" : expense.description} onClose={onClose}>
      <p className="display tabular text-[40px]">{money(expense.amount_cents)}</p>
      <p className="mt-1 text-[15px] text-muted">
        {dayLabel(expense.spent_on + "T12:00:00")} · {expense.paid_by === s.me.id ? "pagaste tú" : `pagó ${name(expense.paid_by)}`}
      </p>
      <ul className="mt-5 space-y-2.5 border-t border-line pt-4">
        {expense.shares.map((sh) => (
          <li key={sh.user_id} className="flex items-center gap-3 text-[15px]">
            <Avatar user={s.member(sh.user_id)} size={26} />
            <span className="flex-1">{expense.kind === "settlement" ? (sh.user_id === s.me.id ? "Lo recibes tú" : `Lo recibe ${name(sh.user_id)}`) : name(sh.user_id)}</span>
            <span className="tabular">{money(sh.share_cents)}</span>
          </li>
        ))}
      </ul>
      {expense.kind === "purchase" && (
        <p className="mt-4 text-[14px] text-faint">Viene de una compra de la lista: al borrarlo se le quita el precio.</p>
      )}
      <Button
        variant="danger"
        className="mt-5 w-full"
        onClick={async () => (await s.run(() => api(`/api/expenses/${expense.id}`, { method: "DELETE" }))) && onClose()}
      >
        Borrar {expense.kind === "settlement" ? "pago" : "gasto"}
      </Button>
    </Sheet>
  );
}
