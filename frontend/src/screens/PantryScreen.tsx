import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api } from "../lib/api";
import { normalize } from "../lib/format";
import { useStore } from "../lib/store";
import type { Level, PantryEntry } from "../lib/types";
import { Button, CategoryPicker, CATEGORY_ICONS, Chips, Empty, Field, inputCls, OwnerPicker, OwnerTag, Sheet } from "../components/ui";

const LEVELS: { id: Level; label: string }[] = [
  { id: "ok", label: "Hay" },
  { id: "low", label: "Poco" },
  { id: "out", label: "Nada" },
];

type Filter = "all" | "missing" | "house" | "mine";

export function PantryScreen() {
  const s = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PantryEntry | "new" | null>(null);

  const missing = s.pantry.filter((p) => p.level !== "ok");
  const q = normalize(search);
  const visible = s.pantry.filter(
    (p) =>
      (filter === "all" ||
        (filter === "missing" && p.level !== "ok") ||
        (filter === "house" && p.owner_id === null) ||
        (filter === "mine" && p.owner_id === s.me.id)) &&
      (!q || normalize(p.name).includes(q)),
  );
  const groups = useMemo(
    () =>
      s.house.categories
        .map((c) => ({ category: c, entries: visible.filter((p) => p.category === c.id) }))
        .filter((g) => g.entries.length > 0),
    [visible, s.house.categories],
  );

  async function setLevel(entry: PantryEntry, level: Level) {
    if (entry.level === level) return;
    s.patchLocal((d) => ({ ...d, pantry: d.pantry.map((p) => (p.id === entry.id ? { ...p, level } : p)) }));
    const ok = await s.run(() => api(`/api/pantry/${entry.id}`, { method: "PATCH", body: { level } }));
    if (ok && level !== "ok") s.toast(`${entry.name}, apuntado en la lista`);
  }

  const out = missing.filter((p) => p.level === "out").length;
  const low = missing.length - out;

  return (
    <div className="pb-28">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h1 className="display text-[56px]">Casa</h1>
        <p className="pb-1.5 text-right text-[15px] leading-tight text-muted">
          {s.pantry.length === 0 ? "Inventario vacío" : missing.length === 0 ? "No falta nada" : (
            <>
              {out > 0 && <span className="block font-medium text-danger">{out} sin nada</span>}
              {low > 0 && <span className="block font-medium text-saffron">{low} con poco</span>}
            </>
          )}
        </p>
      </div>

      {s.pantry.length > 0 && (
        <>
          <div className="relative mb-3">
            <Search size={17} className="absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en casa"
              className="w-full rounded-2xl bg-surface py-2.5 pr-4 pl-11 text-[16px] shadow-card outline-none placeholder:text-faint"
              aria-label="Buscar en casa"
            />
          </div>
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: "Todo", count: s.pantry.length },
              { id: "missing", label: "Falta", count: missing.length },
              { id: "house", label: "Casa", count: s.pantry.filter((p) => p.owner_id === null).length },
              { id: "mine", label: "Lo mío", count: s.pantry.filter((p) => p.owner_id === s.me.id).length },
            ]}
          />
        </>
      )}

      {s.pantry.length === 0 ? (
        <Empty title="Apunta lo que soléis tener">
          Aceite, papel higiénico, café… Cuando algo se acabe, márcalo y pasará solo a la lista.
        </Empty>
      ) : groups.length === 0 ? (
        <Empty title="Aquí no hay nada">Prueba con otro filtro o búsqueda.</Empty>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map(({ category, entries }) => {
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <section key={category.id}>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-[14px] font-medium text-muted">
                  <Icon size={15} />
                  {category.name}
                </h2>
                <ul className="overflow-hidden rounded-3xl bg-surface shadow-card">
                  {entries.map((entry, idx) => (
                    <li key={entry.id} className={`flex items-center gap-3 py-2.5 pr-2.5 pl-4 ${idx ? "border-t border-line" : ""}`}>
                      <button onClick={() => setEditing(entry)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[17px]">{entry.name}</span>
                        <span className="mt-0.5 block">
                          <OwnerTag owner={s.member(entry.owner_id)} meId={s.me.id} />
                        </span>
                      </button>
                      <LevelControl value={entry.level} onChange={(l) => setLevel(entry, l)} name={entry.name} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setEditing("new")}
        className="fixed z-30 flex items-center gap-2 rounded-full bg-pine py-3.5 pr-5 pl-4 font-semibold text-pine-ink shadow-card transition hover:brightness-110"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 84px)", right: "max(16px, calc(50vw - 284px))" }}
      >
        <Plus size={20} strokeWidth={2.5} /> Añadir
      </button>

      {editing && <PantrySheet entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LevelControl({ value, onChange, name }: { value: Level; onChange: (l: Level) => void; name: string }) {
  const tone: Record<Level, string> = {
    ok: "bg-pine text-pine-ink",
    low: "bg-saffron text-white",
    out: "bg-danger text-white",
  };
  return (
    <div className="flex shrink-0 rounded-full bg-surface-2 p-0.5" role="radiogroup" aria-label={`Cuánto queda de ${name}`}>
      {LEVELS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={value === l.id}
          onClick={() => onChange(l.id)}
          className={`rounded-full px-2.5 py-1.5 text-[13px] font-medium transition ${
            value === l.id ? tone[l.id] : "text-muted hover:text-ink"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function PantrySheet({ entry, onClose }: { entry: PantryEntry | null; onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState(entry?.name ?? "");
  const [category, setCategory] = useState(entry?.category ?? "");
  const [owner, setOwner] = useState<number | null>(entry?.owner_id ?? null);
  const [level, setLevelState] = useState<Level>(entry?.level ?? "ok");

  async function save() {
    const body = { name, category: category || null, owner_id: owner, level };
    const ok = await s.run(() =>
      entry ? api(`/api/pantry/${entry.id}`, { method: "PATCH", body }) : api("/api/pantry", { body }),
    );
    if (ok) onClose();
  }

  return (
    <Sheet title={entry ? "Editar" : "Añadir a casa"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Qué">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Aceite de oliva" maxLength={80} />
        </Field>
        <Field label="De quién">
          <OwnerPicker value={owner} onChange={setOwner} members={s.house.members} meId={s.me.id} />
        </Field>
        <Field label="Cuánto queda">
          <div className="flex gap-2">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLevelState(l.id)}
                aria-pressed={level === l.id}
                className={`flex-1 rounded-2xl border py-2.5 text-[15px] font-medium transition ${
                  level === l.id ? "border-ink bg-ink text-paper" : "border-line bg-surface-2"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={entry ? "Categoría" : "Categoría (si no eliges, se adivina)"}>
          <CategoryPicker value={category} onChange={setCategory} categories={s.house.categories} />
        </Field>
        <div className="flex gap-2 pt-2">
          {entry && (
            <Button
              variant="danger"
              onClick={async () => (await s.run(() => api(`/api/pantry/${entry.id}`, { method: "DELETE" }))) && onClose()}
            >
              Quitar
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={!name.trim()}>
            {entry ? "Guardar" : "Añadir"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
