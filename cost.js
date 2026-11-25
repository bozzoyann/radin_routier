// Modèle de coût : fonctions pures, sans DOM, testées sous Node (tests/cost.test.js).

/** Valeurs par défaut du profil et des critères (voir docs/BRIEF.md). */
export const DEF = {prix: 2.05, usure: 0.07, cville: 7.5, croute: 5.5, cauto: 6.5, peage: 0.10, vh: 15};

/** Sous ce seuil de vitesse moyenne (km/h), une manœuvre hors autoroute compte comme « ville ». */
export const SEUIL_VILLE = 50;

/** Décode une polyline encodée (Valhalla : précision 6). Renvoie [[lat, lon], …]. */
export function decode(str, prec = 6) {
  let i = 0, lat = 0, lon = 0;
  const out = [], f = Math.pow(10, prec);
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b, s = 0, r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
      const d = (r & 1) ? ~(r >> 1) : (r >> 1);
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / f, lon / f]);
  }
  return out;
}

const estAutoroute = m => !!m.highway || (m.street_names || []).some(n => /^A\s?\d/.test(n.trim()));

/** Classe une manœuvre : 'autoroute', 'ville' ou 'route'. */
export function classe(m) {
  if (estAutoroute(m)) return 'autoroute';
  const L = m.length || 0;
  const vitesse = m.time > 0 ? L / (m.time / 3600) : Infinity;
  return vitesse < SEUIL_VILLE ? 'ville' : 'route';
}

/** Numéros de routes A, N et D (A81, N157, D924… ; les numéros européens E sont ignorés) parcourus sur au moins `minKm` km cumulés, par longueur décroissante. */
export function refsOf(man, minKm = 5, max = 6) {
  const seen = new Map();
  for (const m of man) {
    const L = m.length || 0;
    for (const n of (m.street_names || [])) {
      const x = /^([AND])\s?(\d+[a-z]?)\b/i.exec(n.trim());
      if (x) { const k = x[1].toUpperCase() + x[2]; seen.set(k, (seen.get(k) || 0) + L); }
    }
  }
  return [...seen.entries()].filter(([, km]) => km >= minKm).sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/** Résume un trajet Valhalla : distances par type de route, péage, durée, tracé, entrées et sorties d'autoroute. */
export function analyse(trip) {
  const leg = trip.legs[0], man = leg.maneuvers || [], pts = decode(leg.shape);
  const km = { autoroute: 0, ville: 0, route: 0 };
  let tollKm = 0, sum = 0, avant = null;
  const ech = [];   // entrées et sorties d'autoroute : {p: [lat, lon], type: 'entree'|'sortie', at: km}
  const peages = [];   // tronçons payants : {km, i0, i1} (indices dans pts)
  for (const m of man) {
    const L = m.length || 0, k = classe(m);
    const hw = k === 'autoroute';
    if (avant !== null && hw !== avant && pts[m.begin_shape_index]) ech.push({ p: pts[m.begin_shape_index], type: hw ? 'entree' : 'sortie', at: sum });
    avant = hw; sum += L;
    km[k] += L;
    if (m.toll) { tollKm += L; peages.push({ km: L, i0: m.begin_shape_index || 0, i1: m.end_shape_index || 0 }); }
  }
  const total = trip.summary.length;
  if (sum === 0) km.route = total;
  if (trip.summary.has_toll && tollKm === 0) tollKm = km.autoroute;
  // Les longueurs des manœuvres sont arrondies : on les recale sur la distance totale du résumé.
  const f = sum > 0 ? total / sum : 1;
  return {
    km: total, min: trip.summary.time / 60,
    hwKm: km.autoroute * f, villeKm: km.ville * f, routeKm: km.route * f, tollKm: tollKm * f,
    refs: refsOf(man), pts, ech, peages: peages.map(p => ({ ...p, km: p.km * f }))
  };
}

/** Supprime les doublons : moins de 1 % d'écart en distance ET en temps. Garde le premier vu. */
export function dedupe(list, tol = 0.01) {
  const out = [];
  for (const r of list) {
    if (!out.some(o => Math.abs(o.km - r.km) / o.km < tol && Math.abs(o.min - r.min) / o.min < tol)) out.push(r);
  }
  return out;
}

/** Coût d'un trajet analysé avec les réglages `s` (voir DEF). Euros et « compromis ». */
export function cost(r, s) {
  const litres = (r.villeKm * s.cville + r.routeKm * s.croute + r.hwKm * s.cauto) / 100;
  // Ouvrages traversés (voir ouvrages.js) : prix fixe, et leurs tronçons sortent du péage au kilomètre.
  const ouv = r.ouvrages || [], kmOuv = ouv.reduce((t, o) => t + o.km, 0), prixOuv = ouv.reduce((t, o) => t + o.prix, 0);
  const fuel = litres * s.prix, wear = r.km * s.usure, toll = Math.max(0, r.tollKm - kmOuv) * s.peage + prixOuv;
  const eur = fuel + wear + toll;
  return { litres, fuel, wear, toll, eur, mix: eur + r.min / 60 * s.vh };
}

/**
 * Ce que rapporte l'heure perdue par rapport au plus rapide, en €/h.
 * null si le trajet coûte autant ou plus ; Infinity s'il n'est pas plus lent (moins de 30 s).
 */
export function tauxHoraire(trajet, rapide) {
  const de = rapide.eur - trajet.eur, dt = trajet.min - rapide.min;
  if (de <= 0) return null;
  return dt > 0.5 ? de / (dt / 60) : Infinity;
}

/** Points situés à des fractions données de la longueur du tracé (pour les points de passage). */
export function along(pts, fracs) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180)));
  }
  const tot = cum[cum.length - 1];
  return fracs.map(f => { const i = cum.findIndex(c => c >= f * tot); return pts[i < 0 ? pts.length - 1 : i]; });
}

/**
 * Exemple de départ de l'assistant usure : compacte essence d'une dizaine d'années
 * à fort kilométrage (voir le tableau de docs/BRIEF.md). Prix en €, durée de vie en km.
 */
export const USURE_DEF = {
  postes: [
    { nom: 'Pneus', prix: 480, km: 40000 },
    { nom: 'Freins', prix: 800, km: 80000 },
    { nom: 'Embrayage', prix: 800, km: 160000 },
    { nom: 'Autres pièces et imprévus', prix: 1500, km: 100000 }
  ],
  decote: { actuelle: 6000, future: 3500, km: 100000 },
  revision: { actif: false, prix: 150, km: 20000 }
};

const parKm = (prix, km) => (prix > 0 && km > 0 ? prix / km : 0);

/** Usure en €/km : somme des postes, décote, et révision si on dépasse 20 000 km par an. */
export function usureParKm(u) {
  const postes = u.postes.map(p => parKm(p.prix, p.km));
  const decote = parKm(u.decote.actuelle - u.decote.future, u.decote.km);
  const revision = u.revision.actif ? parKm(u.revision.prix, u.revision.km) : 0;
  return { postes, decote, revision, total: postes.reduce((a, b) => a + b, 0) + decote + revision };
}

/**
 * Trajets « sans intérêt » : un autre trajet est à la fois au moins aussi rapide
 * et au moins aussi bon marché, et strictement meilleur sur l'un des deux.
 * `items` : [{min, eur}] ; renvoie les indices dominés.
 */
export function domines(items) {
  const out = new Set();
  items.forEach((x, i) => {
    if (items.some((o, j) => j !== i && o.min <= x.min && o.eur <= x.eur && (o.min < x.min || o.eur < x.eur))) out.add(i);
  });
  return out;
}

/**
 * Une marche de l'escalier : passer du trajet `haut` (plus rapide) au trajet `bas` (moins cher).
 * Renvoie les minutes en plus, les euros économisés, les euros gagnés par minute en plus
 * et un verdict par rapport au seuil de l'utilisateur (€ à économiser pour 1 h de route en plus) :
 * 'oui' si la minute est payée au moins au seuil, 'bof' à partir de la moitié, 'non' en dessous.
 */
export function marche(haut, bas, seuil) {
  const dt = bas.min - haut.min, de = haut.eur - bas.eur;
  const parMin = dt > 0.5 ? de / dt : Infinity;
  const parHeure = parMin * 60;
  const verdict = parHeure >= seuil ? 'oui' : parHeure >= seuil / 2 ? 'bof' : 'non';
  return { dt, de, parMin, verdict };
}

/** Une marche doit faire économiser au moins cette part du prix du trajet d'où elle part. */
export const MARCHE_MIN = 0.12;

/**
 * L'escalier : parmi les trajets `items` ([{min, eur}]), ceux qu'on montre, du plus rapide au moins cher.
 * On part du plus rapide ; un trajet plus lent n'est retenu que s'il fait économiser au moins
 * `seuil` (12 %) du prix du dernier trajet retenu. Les trajets dominés sont exclus d'office.
 * Renvoie les indices retenus, dans l'ordre de l'escalier.
 */
export function escalier(items, seuil = MARCHE_MIN) {
  const dom = domines(items);
  const ordre = items.map((x, i) => i).filter(i => !dom.has(i)).sort((a, b) => items[a].min - items[b].min);
  const out = [];
  for (const i of ordre) {
    const dernier = out.length ? items[out.at(-1)] : null;
    if (!dernier || dernier.eur - items[i].eur >= seuil * dernier.eur) out.push(i);
  }
  return out;
}

/** Temps en plus accepté par défaut (minutes), par rapport au trajet le plus rapide. */
export const LIMITE_DEF = 30;

/** Au-delà de 2 fois la limite (et jusqu'à 3 fois), une suggestion doit faire économiser au moins 20 % de plus. */
export const VRAI_GAIN = 0.20;

/**
 * Le choix dans la limite de temps de l'utilisateur, et une suggestion au-delà.
 * `items` : l'escalier ([{min, eur}]), du plus rapide au moins cher ; `limite` : minutes en plus acceptées
 * (Infinity : peu importe). Le choix est le trajet le moins cher qui ne dépasse pas la limite.
 * La suggestion est le moins cher jusqu'à 2 fois la limite ; jusqu'à 3 fois seulement s'il fait économiser
 * au moins 20 % (VRAI_GAIN) du prix du choix. -1 s'il n'y en a pas.
 */
export function choixLimite(items, limite) {
  if (!items.length) return { choix: -1, suggestion: -1 };
  const t0 = items[0].min;
  let choix = 0, suggestion = -1;
  items.forEach((x, i) => { if (x.min - t0 <= limite) choix = i; });
  items.forEach((x, i) => {
    const plus = x.min - t0;
    if (i <= choix || plus > 3 * limite) return;
    if (plus <= 2 * limite || items[choix].eur - x.eur >= VRAI_GAIN * items[choix].eur) suggestion = i;
  });
  return { choix, suggestion };
}
