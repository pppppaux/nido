export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// La web (GitHub Pages) y la API (la VM) van en dominios distintos. En local se deja
// vacío y Vite pasa /api al backend (vite.config.ts).
const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const TOKEN_KEY = "nido-token";

// La sesión va en localStorage y no en cookie: Safari bloquea las cookies entre dominios.
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* modo privado: la sesión dura lo que la pestaña */
    }
  },
};

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  // FormData (fotos) lleva su propio Content-Type con el boundary: no hay que ponerlo.
  const isForm = init.body instanceof FormData;
  if (init.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "Sin conexión. Inténtalo otra vez en un momento.");
  }
  if (!res.ok) {
    let message = `Algo ha fallado (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = "Revisa los datos: hay algún campo que no vale";
    } catch {
      if (res.status === 429) message = "Demasiados intentos. Espera un minuto.";
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}
