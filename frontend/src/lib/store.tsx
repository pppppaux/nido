import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Activity, House, Item, Money, PantryEntry, Suggestion, User } from "./types";

type Toast = { id: number; text: string; action?: { label: string; run: () => void } };

type Data = {
  house: House;
  items: { pending: Item[]; bought: Item[] };
  pantry: PantryEntry[];
  money: Money;
  activity: Activity[];
  suggestions: Suggestion[];
};

type Store = Data & {
  me: User;
  member: (id: number | null | undefined) => User | undefined;
  reload: () => Promise<void>;
  /** Llama a la API, recarga y, si falla, lo dice en un aviso. Devuelve null si falló. */
  run: <T>(call: () => Promise<T>) => Promise<T | null>;
  patchLocal: (fn: (d: Data) => Data) => void;
  toast: (text: string, action?: Toast["action"]) => void;
  setMe: (u: User) => void;
  logout: () => void;
};

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore fuera de StoreProvider");
  return s;
}

async function fetchAll(): Promise<Data> {
  const [house, items, pantry, money, activity, suggestions] = await Promise.all([
    api<House>("/api/house"),
    api<Data["items"]>("/api/items"),
    api<PantryEntry[]>("/api/pantry"),
    api<Money>("/api/money"),
    api<Activity[]>("/api/activity"),
    api<Suggestion[]>("/api/suggestions"),
  ]);
  return { house, items, pantry, money, activity, suggestions };
}

const POLL_MS = 6000;

export function StoreProvider({
  me: initialMe,
  onLogout,
  children,
}: {
  me: User;
  onLogout: () => void;
  children: (state: "loading" | "ready" | "error") => ReactNode;
}) {
  const [me, setMe] = useState(initialMe);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pulse = useRef<number | null>(null);

  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3200);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [fresh, p] = await Promise.all([fetchAll(), api<{ v: number }>("/api/pulse")]);
      pulse.current = p.v;
      setData(fresh);
      setFailed(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      // Solo se enseña si todavía no hay nada pintado; si ya lo hay, se sigue con lo que había.
      else setFailed(true);
    }
  }, [onLogout]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    reloadRef.current();
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const p = await api<{ v: number }>("/api/pulse");
          if (pulse.current !== null && p.v !== pulse.current) await reloadRef.current();
          pulse.current = p.v;
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) onLogout();
        }
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    // Al volver a la pestaña (o desbloquear el móvil) se recarga al momento.
    const onVisible = () => document.visibilityState === "visible" && reloadRef.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onLogout]);

  const run = useCallback(
    async <T,>(call: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await call();
        await reloadRef.current();
        return result;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onLogout();
        else toast(e instanceof Error ? e.message : "Algo ha fallado");
        await reloadRef.current();
        return null;
      }
    },
    [onLogout, toast],
  );

  const patchLocal = useCallback((fn: (d: Data) => Data) => setData((d) => (d ? fn(d) : d)), []);

  const value = useMemo<Store | null>(() => {
    if (!data) return null;
    const byId = new Map(data.house.members.map((m) => [m.id, m]));
    return {
      ...data,
      me,
      member: (id) => (id == null ? undefined : byId.get(id)),
      reload,
      run,
      patchLocal,
      toast,
      setMe,
      logout: onLogout,
    };
  }, [data, me, reload, run, patchLocal, toast, onLogout]);

  if (!value) return <>{children(failed ? "error" : "loading")}</>;

  return (
    <Ctx.Provider value={value}>
      {children("ready")}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 148px)" }}
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="anim-sheet pointer-events-auto flex max-w-md items-center gap-4 rounded-2xl bg-ink py-3 pr-3 pl-4 text-[15px] text-paper shadow-card"
          >
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <button
                className="shrink-0 rounded-xl px-3 py-1.5 font-semibold text-saffron hover:bg-white/10"
                onClick={() => {
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
