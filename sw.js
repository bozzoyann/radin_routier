// Service worker minimal : il ne sert qu'à rendre l'appli installable sur l'écran d'accueil.
// Aucun cache : sans réseau, l'appli ne peut de toute façon rien calculer (itinéraires, adresses et prix
// viennent de serveurs en ligne), et on est sûr d'avoir toujours la dernière version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  // Supprime le cache laissé par la v1.13.0 (qui gardait une copie de l'interface).
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Certains navigateurs n'acceptent d'installer qu'une appli dont le service worker traite les requêtes :
// on les laisse simplement passer au réseau.
self.addEventListener('fetch', e => {
  // « no-cache » : le navigateur revérifie chaque fichier auprès du serveur (réponse 304 rapide si rien n'a changé),
  // au lieu de garder sa copie jusqu'à 10 minutes comme GitHub Pages l'autorise. Toujours la dernière version.
  if (e.request.method === 'GET' && new URL(e.request.url).origin === self.location.origin) {
    e.respondWith(fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })));
  }
});
