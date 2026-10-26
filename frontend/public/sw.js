// Service worker de Nido: solo para los avisos push. No cachea nada (la app necesita
// red para todo), así que no hay versiones viejas que se queden pegadas.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nido", body: event.data ? event.data.text() : "" };
  }
  const base = self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(`🔥 ${data.title || "Algo urgente"}`, {
      body: data.body || "",
      tag: data.tag,
      // Con el mismo tag, el aviso nuevo sustituye al viejo: que vuelva a sonar.
      renotify: Boolean(data.tag),
      icon: base + "icon-192.png",
      badge: base + "icon-192.png",
      data: { url: base + "#lista" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope)) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
