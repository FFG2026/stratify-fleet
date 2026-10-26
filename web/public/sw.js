// Minimal service worker so the portal can be installed as an app.
// It deliberately caches nothing: every page and every record comes live from the server,
// so signed-in data is never stored on the phone by the app. If the phone is offline, show a plain message.
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stratify is offline</title><body style="font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f6f2;color:#193830;text-align:center;padding:24px"><div><h1 style="font-size:22px">You are offline</h1><p>Stratify needs a connection to show your records. Check your signal and try again.</p></div>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
