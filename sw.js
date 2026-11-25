// Service worker : rend l'appli installable et utilisable hors ligne (l'interface ; les calculs d'itinéraires
// demandent toujours le réseau). Stratégie « réseau d'abord » : en ligne, on a toujours la dernière version ;
// le cache ne sert que si le réseau manque. Les serveurs externes (Valhalla, Photon, prix des carburants)
// ne sont jamais mis en cache.
const CACHE = 'radin-routier';
const COQUILLE = ['./', 'index.html', 'styles.css', 'app.js', 'cost.js', 'routing.js', 'mixtes.js', 'villes.js',
  'villes-data.js', 'explore.js', 'ouvrages.js', 'peages-data.js', 'carburant.js', 'manifest.webmanifest',
  'icones/icone-192.png', 'icones/icone-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // serveurs externes : pas de cache
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const copie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./')))
  );
});
