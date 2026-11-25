// Prix du carburant du jour : moyenne des stations autour du départ (flux officiel « Prix des carburants
// en France », ministère de l'Économie, data.economie.gouv.fr, Licence Ouverte), sinon moyenne nationale.

export const API_CARBU = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

/** Carburant de l'appli → champ du flux officiel. */
export const CHAMPS = { 'SP95-E10': 'e10', 'SP98': 'sp98', 'Gazole': 'gazole', 'E85': 'e85', 'GPL': 'gplc' };

/**
 * URL de la moyenne d'un carburant : stations à moins de `rayon` km de `pos` ({lat, lon}),
 * ou toute la France si `pos` est absent, prix mis à jour depuis moins de `jours` jours.
 */
export function urlPrix(carbu, pos, { rayon = 30, jours = 7 } = {}) {
  const c = CHAMPS[carbu];
  if (!c) return null;
  const ou = [`${c}_maj >= now(days=-${jours})`, `${c}_prix > 0`];
  if (pos) ou.unshift(`within_distance(geom, geom'POINT(${pos.lon.toFixed(4)} ${pos.lat.toFixed(4)})', ${rayon}km)`);
  const p = new URLSearchParams({ select: `count(*) as n, avg(${c}_prix) as prix`, where: ou.join(' and '), limit: '1' });
  return `${API_CARBU}?${p}`;
}

/** Lit la réponse : {prix, n}, ou null si trop peu de stations (moins de `min`). */
export function lirePrix(json, min = 5) {
  const r = json && json.results && json.results[0];
  if (!r || !(r.n >= min) || !(r.prix > 0)) return null;
  return { prix: Math.round(r.prix * 1000) / 1000, n: r.n };
}

/**
 * Prix du jour : autour du départ si au moins 5 stations ont un prix récent, sinon moyenne nationale.
 * Renvoie {prix, n, zone: 'local'|'France'} ou null (service injoignable, carburant inconnu).
 */
export async function prixDuJour(carbu, pos, fetchFn = fetch) {
  for (const [p, zone] of [[pos, 'local'], [null, 'France']]) {
    if (zone === 'local' && !pos) continue;
    const url = urlPrix(carbu, p);
    if (!url) return null;
    try {
      const r = await fetchFn(url);
      if (!r.ok) continue;
      const lu = lirePrix(await r.json());
      if (lu) return { ...lu, zone };
    } catch (e) { /* hors ligne ou service indisponible : on essaie la suite */ }
  }
  return null;
}
