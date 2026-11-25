// Villes repères traversées par un trajet (« par Le Mans · Laval »), sans requête réseau.
import { VILLES } from './villes-data.js';
import { dkm, dSegment, reechantillonne } from './mixtes.js';

/**
 * Les `max` plus grandes villes à moins de `rayon` km du tracé, dans l'ordre du trajet.
 * Les villes à moins de `marge` km du départ ou de l'arrivée sont ignorées (on les connaît déjà),
 * et deux villes retenues sont espacées d'au moins `ecart` km le long du trajet (par défaut 25 % de sa longueur),
 * pour qu'elles soient réparties sur tout le parcours.
 * `villes` : [[nom, lat, lon, population], …] (par défaut, la liste intégrée).
 */
export function villesTraversees(pts, { rayon = 5, marge = 15, max = 3, ecart = null, villes = VILLES } = {}) {
  if (pts.length < 2) return [];
  const R = reechantillonne(pts, 2), A = pts[0], B = pts.at(-1);
  // Boîte englobante élargie (≈ 0,1° ≈ 8 à 11 km) pour écarter vite les villes lointaines.
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
  for (const [la, lo] of R) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const cum = [0];
  for (let j = 1; j < R.length; j++) cum.push(cum[j - 1] + dkm(R[j - 1], R[j]));
  const trouvees = [];
  for (const [nom, la, lo, pop] of villes) {
    if (la < la0 - 0.1 || la > la1 + 0.1 || lo < lo0 - 0.15 || lo > lo1 + 0.15) continue;
    const v = [la, lo];
    if (dkm(v, A) < marge || dkm(v, B) < marge) continue;
    let best = Infinity, at = 0;
    for (let j = 1; j < R.length; j++) {
      const d = dSegment(v, R[j - 1], R[j]);
      if (d < best) { best = d; at = cum[j]; }
    }
    if (best <= rayon) trouvees.push({ nom, pop, at });
  }
  const mini = ecart ?? 0.25 * cum.at(-1);
  const choisies = [];
  for (const v of trouvees.sort((x, y) => y.pop - x.pop)) {
    if (choisies.length < max && choisies.every(c => Math.abs(c.at - v.at) >= mini)) choisies.push(v);
  }
  return choisies.sort((x, y) => x.at - y.at).map(x => x.nom);
}
