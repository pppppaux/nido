import { useEffect, useRef, useState } from "react";
import { Check, Plus, ScanLine, X } from "lucide-react";
import { api } from "../lib/api";
import { centsToInput, money, parseEuros } from "../lib/format";
import { shrinkPhoto } from "../lib/image";
import { useStore } from "../lib/store";
import type { ReceiptDraft, ReceiptLine } from "../lib/types";
import { Button, Sheet } from "./ui";

type Row = ReceiptLine & { key: number; included: boolean; priceText: string };

/** Botón "Ticket": abre la cámara (o la galería), lee la foto con IA y enseña la revisión. */
export function ReceiptButton() {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  if (!s.house.receipts_enabled) return null;
  return (
    <>
      <button
        onClick={() => input.current?.click()}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-[14px] font-medium shadow-card hover:bg-pine-soft"
      >
        <ScanLine size={16} className="text-pine" /> Ticket
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) setPhoto(file);
        }}
      />
      {photo && <ReceiptSheet photo={photo} onClose={() => setPhoto(null)} />}
    </>
  );
}

function ReceiptSheet({ photo, onClose }: { photo: File; onClose: () => void }) {
  const s = useStore();
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview] = useState(() => URL.createObjectURL(photo));
  const nextKey = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const form = new FormData();
        form.append("photo", await shrinkPhoto(photo), "ticket.jpg");
        const res = await api<ReceiptDraft>("/api/receipts/read", { body: form });
        if (cancelled) return;
        setDraft(res);
        setRows(res.lines.map((l) => ({ ...l, key: nextKey.current++, included: true, priceText: centsToInput(l.price_cents) })));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "No se ha podido leer el ticket");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photo]);

  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);

  const update = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const owners: (number | null)[] = [null, s.me.id, ...s.house.members.filter((m) => m.id !== s.me.id).map((m) => m.id)];

  const chosen = rows.filter((r) => r.included);
  const invalid = chosen.some((r) => !r.name.trim() || parseEuros(r.priceText) === null);
  const total = chosen.reduce((sum, r) => sum + (parseEuros(r.priceText) ?? 0), 0);
  const allSum = rows.reduce((sum, r) => sum + (parseEuros(r.priceText) ?? 0), 0);
  const shared = chosen.filter((r) => r.owner_id === null).reduce((sum, r) => sum + (parseEuros(r.priceText) ?? 0), 0);

  async function confirm() {
    setSaving(true);
    const res = await s.run(() =>
      api<{ count: number; matched: number }>("/api/receipts/confirm", {
        body: {
          store: draft?.store ?? null,
          lines: chosen.map((r) => ({
            name: r.name,
            quantity: r.quantity,
            price_cents: parseEuros(r.priceText),
            item_id: r.item_id,
            owner_id: r.owner_id,
            category: r.category,
          })),
        },
      }),
    );
    setSaving(false);
    if (res) {
      s.toast(`Ticket apuntado: ${res.count} ${res.count === 1 ? "compra" : "compras"}`);
      onClose();
    }
  }

  if (!draft) {
    return (
      <Sheet title="Ticket" onClose={onClose}>
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <img src={preview} alt="" className={`max-h-56 rounded-2xl object-contain shadow-card ${error ? "" : "animate-pulse"}`} />
          {error ? (
            <>
              <p className="text-[15px] text-danger">{error}</p>
              <Button variant="soft" onClick={onClose}>
                Cerrar
              </Button>
            </>
          ) : (
            <p className="text-[15px] text-muted">Leyendo el ticket… suele tardar unos segundos.</p>
          )}
        </div>
      </Sheet>
    );
  }

  const ticketTotal = draft.total_cents;
  const mismatch = ticketTotal !== null && Math.abs(ticketTotal - allSum) > 1;

  return (
    <Sheet title={draft.store ?? "Ticket"} onClose={onClose}>
      <p className="text-[15px] text-muted">
        Revisa antes de apuntar. Quita lo que sea solo tuyo, o cámbialo a «Para mí»: así no se reparte. Lo de «Casa» se divide entre
        todos.
      </p>
      {mismatch && (
        <p className="mt-3 rounded-2xl bg-saffron-soft px-4 py-2.5 text-[14px]">
          Las líneas suman {money(allSum)} y el ticket dice {money(ticketTotal!)}. Revisa si falta o sobra algo.
        </p>
      )}

      <ul className="mt-4 overflow-hidden rounded-3xl border border-line">
        {rows.map((r, idx) => {
          const owner = s.member(r.owner_id);
          const matched = r.item_id !== null ? s.items.pending.find((i) => i.id === r.item_id) : undefined;
          return (
            <li key={r.key} className={`flex items-start gap-2 py-2.5 pr-3 pl-2 ${idx ? "border-t border-line" : ""} ${r.included ? "" : "opacity-45"}`}>
              <button
                onClick={() => update(r.key, { included: !r.included })}
                className="flex size-10 shrink-0 items-center justify-center"
                aria-label={r.included ? `Quitar ${r.name}` : `Volver a incluir ${r.name}`}
                aria-pressed={r.included}
              >
                <span
                  className={`flex size-[22px] items-center justify-center rounded-md border-2 transition ${
                    r.included ? "border-pine bg-pine text-pine-ink" : "border-faint"
                  }`}
                >
                  {r.included && <Check size={14} strokeWidth={3} />}
                </span>
              </button>
              <div className="min-w-0 flex-1 pt-1.5">
                <input
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  className={`w-full bg-transparent text-[16px] outline-none ${r.included ? "" : "line-through"}`}
                  aria-label="Qué"
                  maxLength={80}
                />
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                  <button
                    onClick={() => update(r.key, { owner_id: owners[(owners.indexOf(r.owner_id) + 1) % owners.length] })}
                    disabled={!r.included}
                    className="rounded-md px-1.5 py-0.5 font-medium"
                    style={
                      owner
                        ? { background: `color-mix(in srgb, ${owner.color} 14%, transparent)`, color: owner.color }
                        : { background: "var(--pine-soft)", color: "var(--pine)" }
                    }
                    title="Para quién es: toca para cambiar"
                  >
                    {owner ? (owner.id === s.me.id ? "Para mí" : `Para ${owner.display_name}`) : "Casa"}
                  </button>
                  {matched ? (
                    <span className="text-faint">tacha «{matched.name}»</span>
                  ) : (
                    <span className="text-faint">no estaba en la lista</span>
                  )}
                  {r.quantity && <span className="text-faint">· {r.quantity}</span>}
                </div>
              </div>
              <div className="relative w-[5.5rem] shrink-0 pt-0.5">
                <input
                  value={r.priceText}
                  onChange={(e) => update(r.key, { priceText: e.target.value })}
                  inputMode="decimal"
                  disabled={!r.included}
                  aria-label={`Precio de ${r.name}`}
                  aria-invalid={r.included && parseEuros(r.priceText) === null}
                  className="tabular w-full rounded-xl border border-line bg-surface-2 py-2 pr-6 pl-2 text-right text-[15px] outline-none focus:border-pine aria-[invalid=true]:border-danger"
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 pt-0.5 text-[13px] text-muted">€</span>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        onClick={() =>
          setRows((all) => [
            ...all,
            { key: nextKey.current++, name: "", quantity: "", price_cents: 0, priceText: "", item_id: null, owner_id: null, category: "otros", included: true },
          ])
        }
        className="mt-2 flex items-center gap-1.5 rounded-xl px-2 py-2 text-[14px] font-medium text-muted hover:text-ink"
      >
        <Plus size={16} /> Añadir una línea que falte
      </button>

      <div className="sticky bottom-0 -mx-5 mt-3 border-t border-line bg-surface px-5 pt-3 pb-1">
        <p className="mb-2 flex justify-between text-[14px] text-muted">
          <span>De la casa, a repartir</span>
          <span className="tabular">{money(shared)}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            <X size={16} /> Descartar
          </Button>
          <Button className="flex-1" disabled={saving || chosen.length === 0 || invalid} onClick={confirm}>
            Apuntar {chosen.length} · {money(total)}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
