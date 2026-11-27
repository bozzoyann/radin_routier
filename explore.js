// Exploration approfondie (bouton « Explorer encore ») : de nouvelles combinaisons de morceaux de trajet.
// Fonctions pures, sans réseau ni DOM, testées sous Node (tests/explore.test.js).
import { dkm, joindre } from './mixtes.js';
import { villesEtapes } from './villes.js';

export const RAPIDE = { auto: { use_tolls: 1, use_highways: 1 } };
export const LIBRE = { auto: { use_tolls: 0, use_highways: 0 } };
export const MODERE = { auto: { use_tolls: 0.5, use_highways: 1 } };
export const RAPIDE_VARIANTES = { auto: { use_tolls: 1, use_highways: 1 }, alt: 2 };

/** Clé d'un morceau de trajet : chaque morceau n'est calculé qu'une fois, puis réutilisé. */
export const cleMorceau = (a, b, prof) => `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}|${JSON.stringify(prof)}`;

const pt = p => ({ lat: p[0], lon: p[1] });

/**
 * Le plan d'exploration : une liste de combinaisons, chacune faite de morceaux [de, vers, réglage].
 *  - G1, entrées et sorties d'autoroute des trajets trouvés : « sans autoroute jusqu'à l'entrée, puis
 *    le plus rapide », et « le plus rapide jusqu'à la sortie, puis sans autoroute » (8 de chaque au plus) ;
 *  - G2, double bascule : sans autoroute, autoroute de l'entrée à la sortie, puis sans autoroute (10 paires) ;
 *  - G3, 5 villes étapes, variantes des deux côtés (3 réglages × 3 réglages).
 * `routes` : trajets analysés (avec `ech`, voir cost.js analyse) ; `a`, `b` : {lat, lon}.
 */
export function planExploration(routes, a, b, { marge = 20, ecart = 15, maxEch = 8, maxPaires = 10, villes } = {}) {
  const A = [a.lat, a.lon], B = [b.lat, b.lon], plan = [];
  const ech = [];
  for (const r of routes) for (const e of r.ech || []) {
    if (dkm(e.p, A) < marge || dkm(e.p, B) < marge) continue;
    if (!ech.some(x => x.type === e.type && dkm(x.p, e.p) < ecart)) ech.push(e);
  }
  const entrees = ech.filter(e => e.type === 'entree').slice(0, maxEch);
  const sorties = ech.filter(e => e.type === 'sortie').slice(0, maxEch);
  for (const e of entrees) plan.push({ gen: 'entree', morceaux: [[a, pt(e.p), LIBRE], [pt(e.p), b, RAPIDE]], points: [e.p] });
  for (const s of sorties) plan.push({ gen: 'sortie', morceaux: [[a, pt(s.p), RAPIDE], [pt(s.p), b, LIBRE]], points: [s.p] });
  let paires = 0;
  for (const e of entrees) for (const s of sorties) {
    if (paires >= maxPaires || dkm(e.p, s.p) < 30 || dkm(A, e.p) >= dkm(A, s.p)) continue;
    paires++;
    plan.push({ gen: 'double', morceaux: [[a, pt(e.p), LIBRE], [pt(e.p), pt(s.p), RAPIDE], [pt(s.p), b, LIBRE]], points: [e.p, s.p] });
  }
  for (const v of villesEtapes(routes, { n: 5, popMin: 30000, ...(villes ? { villes } : {}) })) {
    const V = { lat: v.lat, lon: v.lon };
    for (const p1 of [RAPIDE_VARIANTES, MODERE, LIBRE]) for (const p2 of [RAPIDE, MODERE, LIBRE]) {
      plan.push({ gen: 'ville', ville: v.nom, morceaux: [[a, V, p1], [V, b, p2]], points: [[v.lat, v.lon]] });
    }
  }
  return plan;
}

/** Nombre de morceaux distincts à calculer pour un plan (le coût en requêtes, hors cache). */
export const coutPlan = plan => new Set(plan.flatMap(c => c.morceaux.map(m => cleMorceau(...m)))).size;

/** Toutes les façons d'enchaîner les variantes de chaque morceau : [[a1, a2], [b1]] → [[a1, b1], [a2, b1]]. */
export const produit = listes => listes.reduce((acc, l) => acc.flatMap(x => l.map(y => [...x, y])), [[]]);

/** Assemble une suite de morceaux analysés en un trajet, décrit selon le générateur. */
export function assembler(parts, comb) {
  const ref = r => r.refs.find(x => x[0] === 'A') || r.refs[0] || 'autoroute';
  let t = parts[0];
  for (let k = 1; k < parts.length; k++) t = joindre(t, parts[k], { sens: 'etape', p: comb.points[Math.min(k - 1, comb.points.length - 1)] });
  const texte = {
    entree: `Sans autoroute sur ${Math.round(parts[0].km)} km, puis ${ref(parts[1])}`,
    sortie: `${ref(parts[0])} sur ${Math.round(parts[0].km)} km, puis sans autoroute`,
    double: `Sans autoroute, puis ${ref(parts[1])} sur ${Math.round(parts[1].km)} km, puis sans autoroute`,
    ville: `Par ${comb.ville}, variantes des deux côtés`
  }[comb.gen];
  t.mixte = { ...t.mixte, texte, via: comb.points[0], kmVia: parts[0].km };
  t.explore = true;
  return t;
}

