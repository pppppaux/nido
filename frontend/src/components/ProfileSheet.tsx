import { useState } from "react";
import { Copy, LogOut } from "lucide-react";
import { api, tokenStore } from "../lib/api";
import { useStore } from "../lib/store";
import type { User } from "../lib/types";
import { disablePush } from "../lib/push";
import { PushSetting } from "./PushControl";
import { Avatar, Button, Field, inputCls, Sheet } from "./ui";

const PALETTE = ["#4C6EF5", "#E8590C", "#2F9E44", "#AE3EC9", "#F08C00", "#0C8599", "#E03131", "#5C7CFA"];

type Theme = "auto" | "light" | "dark";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("nido-theme");
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState(s.me.display_name);
  const [color, setColor] = useState(s.me.color);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const inviteLink = `${location.origin}${location.pathname}?codigo=${encodeURIComponent(s.house.invite_code)}`;

  function applyTheme(t: Theme) {
    setTheme(t);
    try {
      if (t === "auto") localStorage.removeItem("nido-theme");
      else localStorage.setItem("nido-theme", t);
    } catch {
      /* sin almacenamiento: vale solo para esta visita */
    }
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  async function saveProfile() {
    const user = await s.run(() => api<User>("/api/auth/me", { method: "PATCH", body: { display_name: name, color } }));
    if (user) {
      s.setMe(user);
      s.toast("Perfil guardado");
    }
  }

  async function changePassword() {
    const res = await s.run(() => api<{ token: string }>("/api/auth/password", { body: { current, new: next } }));
    if (res) {
      tokenStore.set(res.token);
      setCurrent("");
      setNext("");
      s.toast("Contraseña cambiada. Las demás sesiones se han cerrado.");
    }
  }

  return (
    <Sheet title="Tú y la casa" onClose={onClose}>
      <div className="space-y-7">
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar user={{ ...s.me, display_name: name || s.me.display_name, color }} size={52} />
            <div className="min-w-0">
              <p className="truncate text-[18px] font-semibold">{name || s.me.display_name}</p>
              <p className="text-[14px] text-muted">@{s.me.username}</p>
            </div>
          </div>
          <Field label="Nombre">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Tu color">
            <div className="flex flex-wrap gap-2.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  className={`size-9 rounded-full transition ${color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>
          <Button variant="soft" className="w-full" onClick={saveProfile} disabled={!name.trim()}>
            Guardar perfil
          </Button>
        </section>

        <section className="space-y-3 border-t border-line pt-6">
          <h3 className="text-[16px] font-semibold">{s.house.name}</h3>
          <ul className="flex flex-wrap gap-2">
            {s.house.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-[14px]">
                <Avatar user={m} size={24} />
                {m.display_name}
              </li>
            ))}
          </ul>
          <p className="text-[14px] text-muted">
            Para que alguien entre, pásale el enlace: lleva el código de la casa (<span className="font-medium text-ink">{s.house.invite_code}</span>).
          </p>
          <Button
            variant="soft"
            className="w-full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteLink);
                s.toast("Enlace copiado");
              } catch {
                s.toast(inviteLink);
              }
            }}
          >
            <Copy size={16} /> Copiar enlace de invitación
          </Button>
        </section>

        <PushSetting />

        <section className="space-y-3 border-t border-line pt-6">
          <h3 className="text-[16px] font-semibold">Apariencia</h3>
          <div className="flex rounded-full bg-surface-2 p-1">
            {(
              [
                ["auto", "Automático"],
                ["light", "Claro"],
                ["dark", "Oscuro"],
              ] as [Theme, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => applyTheme(id)}
                aria-pressed={theme === id}
                className={`flex-1 rounded-full py-2 text-[14px] font-medium transition ${theme === id ? "bg-ink text-paper" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 border-t border-line pt-6">
          <h3 className="text-[16px] font-semibold">Contraseña</h3>
          <input className={inputCls} type="password" placeholder="La de ahora" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          <input className={inputCls} type="password" placeholder="La nueva (mínimo 8)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <Button variant="soft" className="w-full" onClick={changePassword} disabled={!current || next.length < 8}>
            Cambiar contraseña
          </Button>
        </section>

        <Button
          variant="danger"
          className="w-full"
          onClick={async () => {
            // Este dispositivo deja de recibir avisos de esta cuenta.
            await disablePush().catch(() => undefined);
            s.logout();
          }}
        >
          <LogOut size={17} /> Cerrar sesión
        </Button>
      </div>
    </Sheet>
  );
}
