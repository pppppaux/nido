import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { Button, Field, inputCls } from "../components/ui";

type Mode = "login" | "register";

export function AuthScreen({ onSession }: { onSession: (user: User, token: string) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("codigo") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Hasta saberlo, sin pestaña de registro: mejor que aparezca que verla desaparecer.
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    api<{ registration_open: boolean }>("/api/auth/options")
      .then((o) => setRegistrationOpen(o.registration_open))
      .catch(() => setRegistrationOpen(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await api<{ user: User; token: string }>("/api/auth/login", { body: { username, password } })
          : await api<{ user: User; token: string }>("/api/auth/register", {
              body: { invite_code: code, username, password, display_name: displayName || username },
            });
      onSession(res.user, res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Algo ha fallado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-5 py-10">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="mb-8 size-16 rounded-[18px] shadow-card" />
      <h1 className="display text-[64px]">Nido</h1>
      <p className="mt-3 mb-8 max-w-[30ch] text-[17px] text-muted">
        Lo que falta en casa, lo que hay y quién ha pagado qué. Entre todos.
      </p>

      {registrationOpen && (
        <div className="mb-5 flex rounded-full bg-surface p-1 shadow-card" role="tablist">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className={`flex-1 rounded-full py-2.5 text-[15px] font-medium transition ${mode === m ? "bg-ink text-paper" : "text-muted"}`}
            >
              {m === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="space-y-3.5">
        {mode === "register" && (
          <>
            <Field label="Código de la casa">
              <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
            </Field>
            <Field label="Cómo te llaman">
              <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Pablo" maxLength={40} required />
            </Field>
          </>
        )}
        <Field label="Usuario">
          <input
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
            autoComplete="username"
            autoCapitalize="none"
            maxLength={32}
            required
          />
        </Field>
        <Field label="Contraseña">
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 8 : undefined}
            required
          />
        </Field>
        {mode === "register" && <p className="text-[13px] text-faint">Mínimo 8 caracteres.</p>}
        {error && <p className="text-[14px] text-danger" role="alert">{error}</p>}
        <Button type="submit" className="w-full !py-3.5" disabled={busy}>
          {mode === "login" ? "Entrar" : "Crear cuenta"}
        </Button>
      </form>
    </main>
  );
}
