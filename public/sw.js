self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  event.waitUntil(self.registration.showNotification(payload.title || 'PROYEKTA · Actividad de agencia', {
    body: payload.body || 'Hay una novedad en el portal de agencias.',
    icon: '/cuentas/icon.svg',
    badge: '/cuentas/icon.svg',
    tag: payload.tag || `proyekta-${Date.now()}`,
    renotify: true,
    data: { url: payload.url || '/admin' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.navigate(target).then(() => existing.focus());
    return clients.openWindow(target);
  }));
});
