import { useCallback, useEffect, useState } from "react";
import { Activity, Home, ListChecks, Wallet, type LucideIcon } from "lucide-react";
import { api, ApiError, tokenStore } from "./lib/api";
import { StoreProvider, useStore } from "./lib/store";
import type { User } from "./lib/types";
import { Avatar, Button } from "./components/ui";
import { ProfileSheet } from "./components/ProfileSheet";
import { AuthScreen } from "./screens/AuthScreen";
import { ListScreen } from "./screens/ListScreen";
import { PantryScreen } from "./screens/PantryScreen";
import { MoneyScreen } from "./screens/MoneyScreen";
import { ActivityScreen } from "./screens/ActivityScreen";

type Tab = "lista" | "casa" | "cuentas" | "actividad";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "lista", label: "Lista", icon: ListChecks },
  { id: "casa", label: "Casa", icon: Home },
  { id: "cuentas", label: "Cuentas", icon: Wallet },
  { id: "actividad", label: "Actividad", icon: Activity },
];

// La pestaña va en el hash: el botón de atrás del móvil vuelve a la anterior y un
// enlace puede abrir directamente las cuentas.
function readTab(): Tab {
  const h = location.hash.slice(1) as Tab;
  return TABS.some((t) => t.id === h) ? h : "lista";
}

export default function App() {
  const [me, setMe] = useState<User | null | undefined>(tokenStore.get() ? undefined : null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (me !== undefined) return;
    api<User>("/api/auth/me")
      .then(setMe)
      .catch((e) => {
        // Solo un 401 echa al login; sin red, la sesión sigue siendo buena.
        if (e instanceof ApiError && e.status === 401) {
          tokenStore.set(null);
          setMe(null);
        } else setOffline(true);
      });
  }, [me]);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setMe(null);
  }, []);

  if (me === undefined) return offline ? <Unreachable /> : <Splash />;
  if (me === null)
    return (
      <AuthScreen
        onSession={(user, token) => {
          tokenStore.set(token);
          // El código de invitación ya no hace falta en la barra de direcciones.
          if (location.search) history.replaceState(null, "", location.pathname + location.hash);
          setMe(user);
        }}
      />
    );

  return (
    <StoreProvider me={me} onLogout={logout} key={me.id}>
      {(state) =>
        state === "ready" ? (
          <Shell />
        ) : state === "error" ? (
          <Unreachable />
        ) : (
          <Splash />
        )
      }
    </StoreProvider>
  );
}

function Unreachable() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-[18px] font-semibold">No se puede llegar al servidor</p>
      <p className="max-w-xs text-[15px] text-muted">Comprueba la conexión y vuelve a intentarlo.</p>
      <Button onClick={() => location.reload()}>Reintentar</Button>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Nido" className="anim-fade size-16 rounded-[18px]" />
    </div>
  );
}

function Shell() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>(readTab);
  const [profile, setProfile] = useState(false);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (t: Tab) => {
    if (t === tab) window.scrollTo({ top: 0, behavior: "smooth" });
    else location.hash = t;
  };

  const badges: Partial<Record<Tab, number>> = {
    lista: s.items.pending.length,
    casa: s.pantry.filter((p) => p.level === "out").length,
  };

  return (
    <div className="pt-safe mx-auto min-h-dvh max-w-[600px] px-4">
      <header className="flex items-center justify-between pt-4 pb-6">
        <span className="flex items-center gap-2 text-[15px] font-medium text-muted">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-6 rounded-[7px]" />
          {s.house.name}
        </span>
        <button onClick={() => setProfile(true)} className="flex -space-x-2 rounded-full p-1" aria-label="Tu perfil y la casa">
          {[s.me, ...s.house.members.filter((m) => m.id !== s.me.id)].map((m) => (
            <Avatar key={m.id} user={m.id === s.me.id ? s.me : m} size={32} ring />
          ))}
        </button>
      </header>

      <main key={tab} className="anim-fade">
        {tab === "lista" && <ListScreen />}
        {tab === "casa" && <PantryScreen />}
        {tab === "cuentas" && <MoneyScreen />}
        {tab === "actividad" && <ActivityScreen />}
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/85 backdrop-blur-xl">
        <ul className="mx-auto flex max-w-[600px]">
          {TABS.map((t) => {
            const active = t.id === tab;
            const badge = badges[t.id];
            return (
              <li key={t.id} className="flex-1">
                <button
                  onClick={() => go(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[12px] font-medium transition ${
                    active ? "text-ink" : "text-faint hover:text-muted"
                  }`}
                >
                  <span className="relative">
                    <t.icon size={22} strokeWidth={active ? 2.4 : 1.9} />
                    {!!badge && (
                      <span
                        className={`tabular absolute -top-1.5 left-4 min-w-[18px] rounded-full px-1 text-center text-[11px] leading-[18px] ${
                          t.id === "casa" ? "bg-danger text-white" : "bg-pine text-pine-ink"
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {profile && <ProfileSheet onClose={() => setProfile(false)} />}
    </div>
  );
}
