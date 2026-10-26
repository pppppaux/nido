import { useEffect, useRef, type ReactNode } from "react";
import { Apple, Bath, CupSoda, Lamp, Package, Snowflake, SprayCan, Wheat, X, type LucideIcon } from "lucide-react";
import type { User } from "../lib/types";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  fresco: Apple,
  nevera: Snowflake,
  despensa: Wheat,
  bebidas: CupSoda,
  limpieza: SprayCan,
  bano: Bath,
  hogar: Lamp,
  otros: Package,
};

export function Avatar({ user, size = 28, ring = false }: { user?: User; size?: number; ring?: boolean }) {
  const initial = user?.display_name.trim().charAt(0).toUpperCase() ?? "?";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${ring ? "ring-2 ring-paper" : ""}`}
      style={{ width: size, height: size, background: user?.color ?? "var(--faint)", fontSize: size * 0.44 }}
      title={user?.display_name}
      aria-hidden
    >
      {initial}
    </span>
  );
}

/** De quién es algo: "Casa" si es común, o el nombre de la persona con su color. */
export function OwnerTag({ owner, meId }: { owner?: User; meId: number }) {
  if (!owner) {
    return <span className="rounded-md bg-pine-soft px-1.5 py-0.5 text-[12px] font-medium text-pine">Casa</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium"
      style={{ background: `color-mix(in srgb, ${owner.color} 14%, transparent)`, color: owner.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: owner.color }} />
      {owner.id === meId ? "Tuyo" : owner.display_name}
    </span>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input, textarea, button:not([data-close])")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={title}>
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className="anim-sheet pb-safe relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-surface shadow-card sm:rounded-[28px]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-surface px-5 pt-5 pb-3">
          <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
          <button
            data-close
            onClick={onClose}
            className="-mr-2 rounded-full p-2 text-muted hover:bg-surface-2"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[16px] outline-none transition-colors placeholder:text-faint focus:border-pine focus:bg-surface";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "soft" }) {
  const styles = {
    primary: "bg-pine text-pine-ink hover:brightness-110",
    soft: "bg-surface-2 text-ink border border-line hover:bg-pine-soft",
    ghost: "text-muted hover:bg-surface-2",
    danger: "text-danger hover:bg-danger/10",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-semibold transition disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Para quién es algo: la casa o cualquiera de los compañeros. */
export function OwnerPicker({
  value,
  onChange,
  members,
  meId,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  members: User[];
  meId: number;
}) {
  const options: { id: number | null; label: string; color?: string }[] = [
    { id: null, label: "Casa" },
    ...[...members]
      .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0))
      .map((m) => ({ id: m.id, label: m.id === meId ? "Para mí" : m.display_name, color: m.color })),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id ?? "casa"}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[14px] font-medium transition ${
              active ? "border-transparent bg-ink text-paper" : "border-line bg-surface-2 text-ink hover:border-faint"
            }`}
          >
            {o.color && <span className="size-2 rounded-full" style={{ background: o.color }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function CategoryPicker({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: { id: string; name: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {categories.map((c) => {
        const Icon = CATEGORY_ICONS[c.id] ?? Package;
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            aria-pressed={active}
            className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-[14px] transition ${
              active ? "border-pine bg-pine-soft text-ink" : "border-line bg-surface-2 hover:border-faint"
            }`}
          >
            <Icon size={16} className={active ? "text-pine" : "text-muted"} />
            <span className="truncate">{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; count?: number }[];
}) {
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-medium transition ${
              active ? "bg-ink text-paper" : "text-muted hover:bg-surface"
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`tabular text-[12px] ${active ? "opacity-70" : "text-faint"}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-[18px] font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-xs text-[15px] text-muted">{children}</p>}
    </div>
  );
}
