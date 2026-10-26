import { api } from "./api";

export type PushState =
  | "unsupported" // el navegador no tiene Web Push
  | "needs-install" // iPhone/iPad: solo con la app añadida a la pantalla de inicio
  | "denied" // el permiso se negó: se cambia en los ajustes del navegador
  | "off"
  | "on";

const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration(SW_URL)) ?? navigator.serviceWorker.register(SW_URL);
}

/** Se llama al arrancar: deja el service worker registrado y, si el navegador ya tiene
 * suscripción, se la vuelve a mandar a la API (por si se borró allí o cambió de usuario). */
export async function syncPush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === "granted") await api("/api/push/subscribe", { body: sub.toJSON() });
  } catch {
    /* sin avisos no se rompe nada */
  }
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "off";
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Pide permiso y suscribe. Tiene que llamarse desde un toque del usuario (Safari lo exige). */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { key } = await api<{ key: string | null }>("/api/push/key");
  if (!key) throw new Error("Los avisos no están configurados en el servidor");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api("/api/push/subscribe", { body: sub.toJSON() });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("/api/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}
