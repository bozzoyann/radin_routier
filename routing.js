// Accès aux serveurs publics : Photon (adresses) et Valhalla FOSSGIS (itinéraires).

export const VALHALLA = 'https://valhalla1.openstreetmap.de/route?json=';
export const PHOTON = 'https://photon.komoot.io/api/?limit=1&lang=fr&lat=46.6&lon=2.4&q=';

/** Délai minimal entre deux requêtes Valhalla (serveur public partagé). */
export const DELAI_VALHALLA = 1100;

/** 6 réglages pour obtenir des trajets variés. Les plus contrastés d'abord, pour afficher vite des choix différents. */
export const PROFILES = [
  { auto: { use_tolls: 1, use_highways: 1 }, alt: 2 },
  { auto: { use_tolls: 0, use_highways: 0 }, alt: 0 },
  { auto: { use_tolls: 0, use_highways: 1 }, alt: 1 },
  { auto: { shortest: true }, alt: 0 },
  { auto: { use_tolls: 0.5, use_highways: 1 }, alt: 0 },
  { auto: { use_tolls: 0, use_highways: 0.4 }, alt: 0 }
];

/** Lit « lat, lon » saisi directement. Renvoie null si ce n'en est pas. */
export function parseLatLon(q) {
  const ll = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (!ll) return null;
  const lat = +ll[1], lon = +ll[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon, name: q.trim() } : null;
}

/** Construit l'URL GET Valhalla (GET : pas de requête préalable CORS). */
export function routeUrl(a, b, prof) {
  const req = {
    locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }],
    costing: 'auto', costing_options: { auto: prof.auto },
    units: 'kilometers', language: 'fr-FR', directions_type: 'maneuvers'
  };
  if (prof.alt) req.alternates = prof.alt;
  return VALHALLA + encodeURIComponent(JSON.stringify(req));
}

export async function geocode(q, fetchFn = fetch) {
  const ll = parseLatLon(q);
  if (ll) return ll;
  const r = await fetchFn(PHOTON + encodeURIComponent(q));
  if (!r.ok) throw new Error('recherche d\'adresse indisponible');
  const d = await r.json(), f = d.features && d.features[0];
  if (!f) throw new Error(`lieu introuvable : « ${q} »`);
  const p = f.properties || {}, dep = p.postcode ? ` (${String(p.postcode).slice(0, 2)})` : '';
  return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: (p.name || q) + dep };
}

/** Un calcul Valhalla : renvoie le trajet principal et ses variantes. */
export async function route(a, b, prof, fetchFn = fetch) {
  const r = await fetchFn(routeUrl(a, b, prof));
  let d = {};
  try { d = await r.json(); } catch (e) { /* réponse non JSON (serveur saturé) */ }
  if (r.status === 429) throw new Error('serveur saturé');
  if (!r.ok || !d.trip) throw new Error(d.error || `erreur ${r.status}`);
  return [d.trip, ...(d.alternates || []).map(x => x.trip)];
}
