import { useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { disablePush, enablePush, pushState, type PushState } from "../lib/push";
import { useStore } from "../lib/store";
import { Button } from "./ui";

const DISMISS_KEY = "nido-push-dismissed";

function usePushState(): [PushState | null, (s: PushState) => void] {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    pushState().then(setState);
  }, []);
  return [state, setState];
}

const HELP: Partial<Record<PushState, string>> = {
  "needs-install":
    "En iPhone los avisos solo llegan con Nido en la pantalla de inicio: botón Compartir → «Añadir a pantalla de inicio», y ábrela desde ahí.",
  denied: "Este navegador tiene los avisos bloqueados para Nido. Se activan en los ajustes del sitio, en el candado de la barra de direcciones.",
  unsupported: "Este navegador no admite avisos push.",
};

/** Interruptor para Perfil. */
export function PushSetting() {
  const s = useStore();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  if (state === null) return null;

  async function toggle() {
    setBusy(true);
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      setState(next);
      if (next === "on") s.toast("Avisos activados");
    } catch (e) {
      s.toast(e instanceof Error ? e.message : "No se han podido activar los avisos");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-line pt-6">
      <h3 className="text-[16px] font-semibold">Avisos</h3>
      <p className="text-[14px] text-muted">Un aviso en este dispositivo cuando otro apunte algo urgente o se acabe algo de casa.</p>
      {HELP[state] ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[14px] text-muted">{HELP[state]}</p>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={state === "on"}
          disabled={busy}
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-left disabled:opacity-60"
        >
          {state === "on" ? <Bell size={18} className="text-pine" /> : <BellOff size={18} className="text-faint" />}
          <span className="flex-1">Avisos de lo urgente</span>
          <span className={`relative h-6 w-10 rounded-full transition ${state === "on" ? "bg-pine" : "bg-line"}`}>
            <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${state === "on" ? "left-[18px]" : "left-0.5"}`} />
          </span>
        </button>
      )}
    </section>
  );
}

/** Tarjeta en la lista para quien todavía no los tiene. Se puede cerrar y no vuelve. */
export function PushPrompt() {
  const s = useStore();
  const [state, setState] = usePushState();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed || state === null || state === "on" || state === "unsupported" || state === "denied") return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* se volverá a ver la próxima vez, sin más */
    }
  };

  return (
    <div className="anim-fade relative mb-5 rounded-3xl bg-pine-soft p-4 pr-10">
      <button onClick={dismiss} className="absolute top-3 right-3 rounded-full p-1 text-muted hover:text-ink" aria-label="No, gracias">
        <X size={16} />
      </button>
      <p className="flex items-center gap-2 font-semibold">
        <Bell size={17} className="text-pine" /> Entérate de lo urgente
      </p>
      {state === "needs-install" ? (
        <p className="mt-1 text-[14px] text-muted">{HELP["needs-install"]}</p>
      ) : (
        <>
          <p className="mt-1 text-[14px] text-muted">Te avisamos cuando alguien apunte algo con prisa o se acabe algo de casa.</p>
          <Button
            className="mt-3 !py-2 text-[14px]"
            onClick={async () => {
              try {
                const next = await enablePush();
                setState(next);
                if (next === "on") s.toast("Avisos activados");
              } catch (e) {
                s.toast(e instanceof Error ? e.message : "No se han podido activar los avisos");
              }
            }}
          >
            Activar avisos
          </Button>
        </>
      )}
    </div>
  );
}
