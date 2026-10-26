import { useMemo, useState } from "react";
import { Check, ChevronDown, Flame, Plus } from "lucide-react";
import { api } from "../lib/api";
import { ago, centsToInput, money, normalize, parseEuros } from "../lib/format";
import { useStore } from "../lib/store";
import type { Item } from "../lib/types";
import {
  Avatar,
  Button,
  CategoryPicker,
  CATEGORY_ICONS,
  Chips,
  Empty,
  Field,
  inputCls,
  OwnerPicker,
  OwnerTag,
  Sheet,
} from "../components/ui";
import { PushPrompt } from "../components/PushControl";

type Filter = "all" | "house" | "mine" | "others";

export function ListScreen() {
  const s = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Item | null>(null);
  const [pricing, setPricing] = useState<Item | null>(null);
  const [showBought, setShowBought] = useState(false);

  const pending = s.items.pending;
  const matches = (i: Item) =>
    filter === "all" ||
    (filter === "house" && i.owner_id === null) ||
    (filter === "mine" && i.owner_id === s.me.id) ||
    (filter === "others" && i.owner_id !== null && i.owner_id !== s.me.id);
  const count = (f: Filter) =>
    pending.filter((i) =>
      f === "all" ? true : f === "house" ? i.owner_id === null : f === "mine" ? i.owner_id === s.me.id : i.owner_id !== null && i.owner_id !== s.me.id,
    ).length;

  const groups = useMemo(() => {
    const visible = pending.filter(matches);
    return s.house.categories
      .map((c) => ({ category: c, items: visible.filter((i) => i.category === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [pending, filter, s.house.categories, s.me.id]);

  async function buy(item: Item) {
    // Se tacha al momento; la API confirma detrás.
    s.patchLocal((d) => ({
      ...d,
      items: {
        pending: d.items.pending.filter((i) => i.id !== item.id),
        bought: [{ ...item, bought_by: s.me.id, bought_at: new Date().toISOString() }, ...d.items.bought],
      },
    }));
    const done = await s.run(() => api<Item>(`/api/items/${item.id}/buy`, { body: {} }));
    if (done) s.toast(`Comprado: ${item.name}`, { label: "Añadir precio", run: () => setPricing(done) });
  }

  const urgentCount = pending.filter((i) => i.urgent).length;

  return (
    <div className="pb-44">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h1 className="display text-[56px]">Lista</h1>
        <p className="pb-1.5 text-right text-[15px] leading-tight text-muted">
          {pending.length === 0 ? "Nada pendiente" : `${pending.length} por comprar`}
          {urgentCount > 0 && (
            <span className="block font-medium text-saffron">
              {urgentCount} {urgentCount === 1 ? "corre prisa" : "corren prisa"}
            </span>
          )}
        </p>
      </div>

      <PushPrompt />

      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "Todo", count: count("all") },
          { id: "house", label: "Casa", count: count("house") },
          { id: "mine", label: "Lo mío", count: count("mine") },
          { id: "others", label: "De otros", count: count("others") },
        ]}
      />

      {groups.length === 0 ? (
        <Empty title={pending.length === 0 ? "No falta nada" : "Aquí no hay nada"}>
          {pending.length === 0
            ? "Apunta abajo lo que se vaya acabando y lo verán todos."
            : "Prueba con otro filtro."}
        </Empty>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map(({ category, items }) => {
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <section key={category.id}>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-[14px] font-medium text-muted">
                  <Icon size={15} />
                  {category.name}
                </h2>
                <ul className="overflow-hidden rounded-3xl bg-surface shadow-card">
                  {items.map((item, idx) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      first={idx === 0}
                      onBuy={() => buy(item)}
                      onOpen={() => setEditing(item)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {s.items.bought.length > 0 && (
        <section className="mt-8">
          <button
            onClick={() => setShowBought((v) => !v)}
            className="flex w-full items-center gap-2 px-1 py-2 text-[14px] font-medium text-muted"
            aria-expanded={showBought}
          >
            <ChevronDown size={16} className={`transition-transform ${showBought ? "" : "-rotate-90"}`} />
            Comprado últimamente
            <span className="tabular text-faint">{s.items.bought.length}</span>
          </button>
          {showBought && (
            <ul className="anim-fade mt-1 overflow-hidden rounded-3xl bg-surface/60">
              {s.items.bought.map((item, idx) => {
                const buyer = s.member(item.bought_by);
                return (
                  <li key={item.id} className={idx ? "border-t border-line" : ""}>
                    <button onClick={() => setPricing(item)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                      <Avatar user={buyer} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-muted line-through decoration-faint">{item.name}</span>
                        <span className="block text-[13px] text-faint">
                          {buyer?.id === s.me.id ? "Tú" : buyer?.display_name} · {item.bought_at && ago(item.bought_at)}
                        </span>
                      </span>
                      <span className={`tabular text-[14px] ${item.price_cents ? "text-ink" : "text-faint"}`}>
                        {item.price_cents ? money(item.price_cents) : "Sin precio"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <Composer />

      {editing && <ItemSheet item={editing} onClose={() => setEditing(null)} onBought={(it) => setPricing(it)} />}
      {pricing && <BoughtSheet item={pricing} onClose={() => setPricing(null)} />}
    </div>
  );
}

function ItemRow({ item, first, onBuy, onOpen }: { item: Item; first: boolean; onBuy: () => void; onOpen: () => void }) {
  const s = useStore();
  const owner = s.member(item.owner_id);
  const author = s.member(item.created_by);
  const [ticking, setTicking] = useState(false);
  return (
    <li className={`flex items-stretch ${first ? "" : "border-t border-line"}`}>
      <button
        onClick={() => {
          setTicking(true);
          setTimeout(onBuy, 240);
        }}
        className="group flex w-14 shrink-0 items-center justify-center"
        aria-label={`Marcar ${item.name} como comprado`}
      >
        <span
          className={`flex size-[26px] items-center justify-center rounded-full border-2 transition-colors ${
            ticking ? "anim-pop border-transparent" : "border-faint group-hover:border-pine"
          }`}
          style={ticking ? { background: s.me.color } : undefined}
        >
          {ticking && <Check size={15} strokeWidth={3} className="text-white" />}
        </span>
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 py-3 pr-4 text-left">
        <span className="flex items-baseline gap-2">
          <span className={`truncate text-[17px] ${ticking ? "text-muted line-through" : ""}`}>{item.name}</span>
          {item.quantity && <span className="shrink-0 text-[14px] text-muted">{item.quantity}</span>}
          {item.urgent && <Flame size={15} className="shrink-0 self-center text-saffron" aria-label="Corre prisa" />}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-faint">
          <OwnerTag owner={owner} meId={s.me.id} />
          {item.note && <span className="truncate text-muted">{item.note}</span>}
          {author && author.id !== item.owner_id && (
            <span>
              apuntó {author.id === s.me.id ? "tú" : author.display_name}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

const QTY_RE = /^(\d+(?:[.,]\d+)?\s?(?:kg|g|gr|l|ml|cl|uds?\.?|paquetes?|packs?|botes?|latas?|botellas?|docenas?|x)?)\s+(.+)$/i;

function Composer() {
  const s = useStore();
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<number | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);

  const ownerCycle: (number | null)[] = [null, s.me.id, ...s.house.members.filter((m) => m.id !== s.me.id).map((m) => m.id)];
  const ownerUser = s.member(owner);

  const query = normalize(text);
  const pendingNames = new Set(s.items.pending.map((i) => normalize(i.name)));
  const suggestions =
    query.length < 1
      ? []
      : s.suggestions.filter((x) => normalize(x.name).includes(query) && !pendingNames.has(normalize(x.name))).slice(0, 6);

  async function add(raw: string, category?: string) {
    const clean = raw.trim();
    if (!clean || busy) return;
    const m = clean.match(QTY_RE);
    const [quantity, name] = m ? [m[1], m[2]] : ["", clean];
    setBusy(true);
    const res = await s.run(() =>
      api<{ item: Item; duplicate: boolean }>("/api/items", {
        body: { name: name.charAt(0).toUpperCase() + name.slice(1), quantity, owner_id: owner, urgent, category },
      }),
    );
    setBusy(false);
    if (res) {
      setText("");
      setUrgent(false);
      if (res.duplicate) s.toast(`${res.item.name} ya estaba en la lista`);
    }
  }

  return (
    <div
      className="fixed inset-x-0 z-30 px-3"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 72px)" }}
    >
      <div className="mx-auto max-w-[600px]">
        {suggestions.length > 0 && (
          <div className="anim-fade mb-2 flex flex-wrap gap-1.5 px-1">
            {suggestions.map((x) => (
              <button
                key={x.name}
                onClick={() => add(x.name, x.category)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[14px] shadow-card hover:border-pine"
              >
                {x.name}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
          className="flex items-center gap-1.5 rounded-[22px] border border-line bg-surface p-1.5 shadow-card"
        >
          <button
            type="button"
            onClick={() => setOwner(ownerCycle[(ownerCycle.indexOf(owner) + 1) % ownerCycle.length])}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-2xl px-3 text-[14px] font-medium"
            style={
              ownerUser
                ? { background: `color-mix(in srgb, ${ownerUser.color} 15%, transparent)`, color: ownerUser.color }
                : { background: "var(--pine-soft)", color: "var(--pine)" }
            }
            aria-label="Para quién es"
            title="Para quién es: toca para cambiar"
          >
            {ownerUser ? (ownerUser.id === s.me.id ? "Para mí" : ownerUser.display_name) : "Casa"}
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Apunta lo que falta…"
            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-[16px] outline-none placeholder:text-faint"
            enterKeyHint="done"
            aria-label="Qué falta"
          />
          <button
            type="button"
            onClick={() => setUrgent((u) => !u)}
            aria-pressed={urgent}
            className={`flex size-10 shrink-0 items-center justify-center rounded-2xl transition ${
              urgent ? "bg-saffron-soft text-saffron" : "text-faint hover:text-muted"
            }`}
            aria-label="Corre prisa"
            title="Corre prisa"
          >
            <Flame size={19} />
          </button>
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-pine text-pine-ink transition disabled:opacity-35"
            aria-label="Añadir"
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>
        </form>
      </div>
    </div>
  );
}

function ItemSheet({ item, onClose, onBought }: { item: Item; onClose: () => void; onBought: (i: Item) => void }) {
  const s = useStore();
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [note, setNote] = useState(item.note);
  const [category, setCategory] = useState(item.category);
  const [owner, setOwner] = useState<number | null>(item.owner_id);
  const [urgent, setUrgent] = useState(item.urgent);

  async function save() {
    const ok = await s.run(() =>
      api(`/api/items/${item.id}`, {
        method: "PATCH",
        body: { name, quantity, note, category, owner_id: owner, urgent },
      }),
    );
    if (ok) onClose();
  }

  return (
    <Sheet title="Editar" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Qué">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Cuánto">
            <input className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="2 l" maxLength={40} />
          </Field>
        </div>
        <Field label="Nota">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="La marca, el sitio…" maxLength={200} />
        </Field>
        <Field label="Para quién">
          <OwnerPicker value={owner} onChange={setOwner} members={s.house.members} meId={s.me.id} />
        </Field>
        <Field label="Categoría">
          <CategoryPicker value={category} onChange={setCategory} categories={s.house.categories} />
        </Field>
        <button
          type="button"
          onClick={() => setUrgent((u) => !u)}
          aria-pressed={urgent}
          className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
            urgent ? "border-saffron bg-saffron-soft" : "border-line bg-surface-2"
          }`}
        >
          <Flame size={18} className={urgent ? "text-saffron" : "text-faint"} />
          <span className="flex-1">Corre prisa</span>
          <span className="text-[13px] text-muted">{urgent ? "Sí" : "No"}</span>
        </button>
        <div className="flex gap-2 pt-2">
          <Button variant="danger" onClick={async () => (await s.run(() => api(`/api/items/${item.id}`, { method: "DELETE" }))) && onClose()}>
            Quitar
          </Button>
          <Button
            variant="soft"
            className="flex-1"
            onClick={async () => {
              const done = await s.run(() => api<Item>(`/api/items/${item.id}/buy`, { body: {} }));
              if (done) {
                onClose();
                onBought(done);
              }
            }}
          >
            <Check size={17} /> Comprado
          </Button>
          <Button className="flex-1" onClick={save} disabled={!name.trim()}>
            Guardar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function BoughtSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const s = useStore();
  const [price, setPrice] = useState(centsToInput(item.price_cents));
  const cents = price.trim() ? parseEuros(price) : null;
  const invalid = price.trim() !== "" && cents === null;
  const owner = s.member(item.owner_id);
  const buyer = s.member(item.bought_by);
  const others = s.house.members.length - 1;

  let explain = "";
  if (cents && buyer) {
    if (!owner) explain = `Se reparte entre los ${s.house.members.length}: ${money(Math.round(cents / s.house.members.length))} cada uno.`;
    else if (owner.id !== buyer.id) explain = `${owner.id === s.me.id ? "Se lo debes" : `${owner.display_name} se lo debe`} a ${buyer.id === s.me.id ? "ti" : buyer.display_name}.`;
    else explain = "Lo pagó quien lo va a usar: no entra en las cuentas.";
  }

  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[15px] text-muted">
          Lo compró {buyer?.id === s.me.id ? "tú" : buyer?.display_name} {item.bought_at && ago(item.bought_at)}.
          {others > 0 && " Con el precio, las cuentas se ajustan solas."}
        </p>
        <Field label="Cuánto costó">
          <div className="relative">
            <input
              className={`${inputCls} tabular pr-10 text-[20px]`}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0,00"
              aria-invalid={invalid}
            />
            <span className="absolute top-1/2 right-4 -translate-y-1/2 text-muted">€</span>
          </div>
        </Field>
        {invalid && <p className="text-[14px] text-danger">Escribe un importe, como 3,50.</p>}
        {explain && <p className="text-[14px] text-muted">{explain}</p>}
        <div className="flex gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={async () => (await s.run(() => api(`/api/items/${item.id}/unbuy`, { body: {} }))) && onClose()}
          >
            Devolver a la lista
          </Button>
          <Button
            className="flex-1"
            disabled={invalid}
            onClick={async () =>
              (await s.run(() => api(`/api/items/${item.id}/price`, { method: "PUT", body: { price_cents: cents } }))) && onClose()
            }
          >
            Guardar precio
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
