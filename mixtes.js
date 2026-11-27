// Trajets mixtes : repérer où un trajet sans autoroute rejoint (ou quitte) un trajet par autoroute,
// pour proposer « sans autoroute jusque-là, puis autoroute » (et l'inverse).
// Fonctions pures, sans réseau ni DOM, testées sous Node (tests/mixtes.test.js).

/** Distance approchée en km entre deux points [lat, lon] (suffisant à l'échelle d'une région). */
export const dkm = (p, q) => 111.2 * Math.hypot(p[0] - q[0], (p[1] - q[1]) * Math.cos(p[0] * Math.PI / 180));

/** Garde un point environ tous les `pas` km, en conservant le premier et le dernier. */
export function reechantillonne(pts, pas = 1) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += dkm(pts[i - 1], pts[i]);
    if (acc >= pas) { out.push(pts[i]); acc = 0; }
  }
  if (out.at(-1) !== pts.at(-1)) out.push(pts.at(-1));
  return out;
}

/** Distance en km du point `p` au segment [a, b] (projection plane locale). */
export function dSegment(p, a, b) {
  const k = Math.cos(p[0] * Math.PI / 180);
  const ax = (a[1] - p[1]) * k, ay = a[0] - p[0], bx = (b[1] - p[1]) * k, by = b[0] - p[0];
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return 111.2 * Math.hypot(ax + t * dx, ay + t * dy);
}

/** Un trajet « libre » (sans péage, peu d'autoroute) et un trajet « autoroute ». */
export const estLibre = r => r.tollKm < 1 && r.hwKm < 0.3 * r.km;
export const estAutoroute = r => r.hwKm >= 0.3 * r.km;

/**
 * Points où le tracé libre `f` rejoint (sens 'rejoint') ou quitte (sens 'quitte') le tracé `m`.
 * `pres` : écart en km sous lequel les deux tracés sont confondus ; `marge` : km ignorés au départ et à l'arrivée.
 * Chaque point : {p: [lat, lon], sens, at (km depuis le départ, le long de f)}.
 */
export function bascules(f, m, { pres = 0.4, marge = 15 } = {}) {
  const F = reechantillonne(f.pts), M = reechantillonne(m.pts), out = [];
  let avant = null, dist = 0;
  for (let i = 0; i < F.length; i++) {
    if (i) dist += dkm(F[i - 1], F[i]);
    const p = F[i];
    let proche = false;
    for (let j = 1; j < M.length && !proche; j++) {
      const a = M[j - 1], b = M[j];
      // Filtre rapide : segment trop loin en latitude (0,02° ≈ 2 km).
      if (Math.min(a[0], b[0]) - 0.02 > p[0] || Math.max(a[0], b[0]) + 0.02 < p[0]) continue;
      proche = dSegment(p, a, b) < pres;
    }
    if (avant !== null && proche !== avant && dist > marge && f.km - dist > marge) {
      out.push({ p: F[i], sens: proche ? 'rejoint' : 'quitte', at: dist });
    }
    avant = proche;
  }
  return out;
}

/** Choisit `n` éléments répartis régulièrement dans une liste triée. */
function repartis(liste, n) {
  if (liste.length <= n) return liste;
  return Array.from({ length: n }, (_, k) => liste[Math.round(k * (liste.length - 1) / (n - 1 || 1))]);
}

/**
 * Points de bascule à essayer, au plus `max` : regroupés à 10 km près, répartis le long du trajet.
 * Priorité à « sans autoroute puis autoroute » (le cas le plus fréquent), une place gardée pour l'inverse.
 */
export function candidats(routes, max = 4) {
  const libres = routes.filter(estLibre), autos = routes.filter(estAutoroute), tous = [];
  // On ignore les bascules trop près du départ ou de l'arrivée : 8 % du trajet, 15 km au moins.
  for (const f of libres) for (const m of autos) tous.push(...bascules(f, m, { marge: Math.max(15, 0.08 * f.km) }));
  const uniques = [];
  for (const c of tous) if (!uniques.some(u => u.sens === c.sens && dkm(u.p, c.p) < 10)) uniques.push(c);
  const parSens = s => uniques.filter(c => c.sens === s).sort((a, b) => a.at - b.at);
  const quitte = repartis(parSens('quitte'), 1);
  const rejoint = repartis(parSens('rejoint'), max - quitte.length);
  return [...rejoint, ...quitte].slice(0, max);
}

/** Les deux réglages Valhalla d'un trajet mixte : [première moitié, seconde moitié]. */
export const reglagesMixte = (sens, rapide, libre) => (sens === 'rejoint' ? [libre, rapide] : [rapide, libre]);

/** Assemble deux moitiés analysées (voir cost.js analyse) en un seul trajet mixte. `c.texte` remplace la description automatique. */
export function joindre(a, b, c) {
  const route = r => r.refs.find(x => x[0] === 'A') || r.refs[0] || '';
  return {
    km: a.km + b.km, min: a.min + b.min,
    hwKm: a.hwKm + b.hwKm, routeKm: a.routeKm + b.routeKm, villeKm: a.villeKm + b.villeKm, tollKm: a.tollKm + b.tollKm,
    refs: [...new Set([...a.refs, ...b.refs])].slice(0, 6),
    pts: [...a.pts, ...b.pts],
    peages: [...(a.peages || []), ...(b.peages || []).map(p => ({ ...p, i0: p.i0 + a.pts.length, i1: p.i1 + a.pts.length }))],
    mixte: {
      sens: c.sens, via: c.p, kmVia: a.km,
      // ex. « Sans autoroute sur 156 km, puis A81 » ou « A10 sur 128 km, puis sans autoroute »
      texte: c.texte ? c.texte : c.sens === 'rejoint'
        ? `Sans autoroute sur ${Math.round(a.km)} km, puis ${route(b) || 'autoroute'}`
        : `${route(a) || 'Autoroute'} sur ${Math.round(a.km)} km, puis sans autoroute`
    }
  };
}

/**
 * Points de passage qui obligent un GPS (Google Maps…) à suivre le trajet `pts` plutôt que le trajet `ref`
 * (le plus rapide, que le GPS choisirait de lui-même). On repère les portions où `pts` s'écarte de `ref` de plus
 * de `seuil` km et on y répartit au plus `n` points : 1 par portion, les plus longues d'abord, le reste dans la
 * plus longue. Dans une portion, les points se placent à 15 %, 50 % et 85 % de sa longueur : un court détour est
 * verrouillé à l'entrée, au milieu et à la sortie, un long sur toute sa longueur. Points espacés d'au moins 5 km,
 * dans l'ordre du trajet. Si les deux trajets se confondent : points répartis (25 %, 50 %, 75 %).
 */
export function pointsDePassage(pts, ref, { n = 3, seuil = 2, pas = 1 } = {}) {
  const R = reechantillonne(pts, pas), F = reechantillonne(ref, 2);
  const repartis = () => [0.25, 0.5, 0.75].slice(0, n).map(f => R[Math.min(R.length - 1, Math.round(f * (R.length - 1)))]);
  if (R.length < 3 || F.length < 2) return repartis();
  const d = R.map(p => {
    let m = Infinity;
    for (let j = 1; j < F.length; j++) {
      const a = F[j - 1], b = F[j];
      if (Math.min(a[0], b[0]) - 0.05 > p[0] + m / 111 || Math.max(a[0], b[0]) + 0.05 < p[0] - m / 111) continue;   // trop loin en latitude
      m = Math.min(m, dSegment(p, a, b));
    }
    return m;
  });
  // Les portions qui s'écartent du trajet de référence : [début, fin].
  const sections = [];
  for (let i = 0; i < R.length; i++) {
    if (d[i] < seuil) continue;
    let j = i;
    while (j + 1 < R.length && d[j + 1] >= seuil) j++;
    sections.push({ s: i, e: j, long: j - i, c: 0 });
    i = j;
  }
  if (!sections.length) return repartis();
  sections.sort((x, y) => y.long - x.long);
  for (let k = 0; k < n; k++) sections[k < sections.length ? k : 0].c++;
  const fractions = { 1: [0.5], 2: [0.25, 0.75], 3: [0.15, 0.5, 0.85] };
  const choisis = [];
  for (const x of sections) {
    for (const f of fractions[Math.min(3, x.c)] || []) {
      const k = x.s + Math.round(f * (x.e - x.s));
      if (choisis.every(c => Math.abs(c - k) * pas >= 5)) choisis.push(k);
    }
  }
  return choisis.sort((x, y) => x - y).map(k => R[k]);
}
