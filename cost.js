// Modèle de coût : fonctions pures, sans DOM, testées sous Node (tests/cost.test.js).
import { TARIFS_KM } from './peages-data.js';

/** Valeurs par défaut du profil et des critères (voir docs/BRIEF.md). */
export const DEF = {prix: 2.05, usure: 0.07, cville: 7.5, croute: 5.5, cauto: 6.5, peage: 0.09, ik: 0.665};

/** Indemnités kilométriques par défaut : 6 CV, 0,665 €/km (barème fiscal 2026, gelé depuis 2023, jusqu'à 5 000 km par an ; 5 CV : 0,636). */

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

/**
 * Valhalla (serveur FOSSGIS) compte trop lentement les routes hors autoroute. Comparé à Waze en circulation normale,
 * 0,74 × son temps tombe à ±6 % sur 3 trajets par nationales (N20 ; A77 puis N7, deux variantes), alors que
 * l'autoroute tombe juste (A10 : 78 min contre 77). Calage de novembre 2026, à affiner avec d'autres mesures.
 */
export const K_HORS_AUTOROUTE = 0.74;

/** Classe une manœuvre : 'autoroute', 'ville' ou 'route' (vitesse calculée avec le temps corrigé par `k`). */
export function classe(m, k = 1) {
  if (estAutoroute(m)) return 'autoroute';
  const L = m.length || 0, t = (m.time || 0) * k;
  const vitesse = t > 0 ? L / (t / 3600) : Infinity;
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

/** Résume un trajet Valhalla : distances par type de route, péage, durée, tracé, entrées et sorties d'autoroute.
 *  Le temps hors autoroute est corrigé par `k` (voir K_HORS_AUTOROUTE ; {k: 1} : temps brut de Valhalla).
 *  Réglage passé dans un objet : `liste.map(analyse)` passe l'indice en 2e argument, qui doit être sans effet. */
export function analyse(trip, { k = K_HORS_AUTOROUTE } = {}) {
  const leg = trip.legs[0], man = leg.maneuvers || [], pts = decode(leg.shape);
  const km = { autoroute: 0, ville: 0, route: 0 };
  let tollKm = 0, sum = 0, avant = null;
  const ech = [];   // entrées et sorties d'autoroute : {p: [lat, lon], type: 'entree'|'sortie', at: km}
  const peages = [];   // tronçons payants : {km, i0, i1, ref} (indices dans pts, numéro d'autoroute)
  let gain = 0;   // secondes retirées par la correction hors autoroute
  for (const m of man) {
    const L = m.length || 0, c = classe(m, k);
    const hw = c === 'autoroute';
    if (!hw) gain += (m.time || 0) * (1 - k);
    if (avant !== null && hw !== avant && pts[m.begin_shape_index]) ech.push({ p: pts[m.begin_shape_index], type: hw ? 'entree' : 'sortie', at: sum });
    avant = hw; sum += L;
    km[c] += L;
    if (m.toll) {
      // Numéro d'autoroute du tronçon payant (« A 75 » → A75), pour lui appliquer son tarif réel (peages-data.js).
      const a = (m.street_names || []).map(n => /^A\s?(\d+)\b/.exec(n.trim())).find(Boolean);
      tollKm += L; peages.push({ km: L, i0: m.begin_shape_index || 0, i1: m.end_shape_index || 0, ref: a ? 'A' + a[1] : null });
    }
  }
  const total = trip.summary.length;
  if (sum === 0) km.route = total;
  if (trip.summary.has_toll && tollKm === 0) tollKm = km.autoroute;
  // Les longueurs des manœuvres sont arrondies : on les recale sur la distance totale du résumé.
  const f = sum > 0 ? total / sum : 1;
  return {
    km: total, min: (trip.summary.time - gain) / 60,
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

/** Coût d'un trajet analysé avec les réglages `s` (voir DEF), en euros, poste par poste.
 *  `s.rembourse` (déplacement pro) : le péage est remboursé, il reste calculé (`toll`) mais sort du prix (`eur`). */
export function cost(r, s, tarifs = TARIFS_KM) {
  const litres = (r.villeKm * s.cville + r.routeKm * s.croute + r.hwKm * s.cauto) / 100;
  // Péage : chaque tronçon payant au tarif réel de son autoroute s'il est connu (peages-data.js), sinon au tarif
  // estimé s.peage ; un tronçon qui porte un ouvrage (ouvrages.js) est remplacé par le prix de l'ouvrage.
  const ouv = r.ouvrages || [], surOuvrage = new Set(ouv.map(o => o.i)), reels = new Set();
  let peageTroncons = 0, kmTroncons = 0;
  (r.peages || []).forEach((seg, k) => {
    kmTroncons += seg.km;
    if (surOuvrage.has(k)) return;
    const t = seg.ref && tarifs[seg.ref];
    if (t) reels.add(seg.ref);
    peageTroncons += seg.km * (t ? t[0] : s.peage);
  });
  const prixOuv = ouv.reduce((t, o) => t + o.prix, 0);
  // Kilomètres payants sans tronçon identifié (résumé « péage » sans manœuvre marquée) : tarif estimé.
  const fuel = litres * s.prix, wear = r.km * s.usure;
  const toll = peageTroncons + Math.max(0, r.tollKm - kmTroncons) * s.peage + prixOuv;
  const eur = fuel + wear + (s.rembourse ? 0 : toll);
  return { litres, fuel, wear, toll, eur, rembourse: !!s.rembourse, tarifsReels: [...reels] };
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
 * Renvoie les minutes en plus, les euros économisés et les euros gagnés par minute en plus
 * (Infinity si le trajet n'est pas plus lent : moins de 30 s d'écart).
 */
export function marche(haut, bas) {
  const dt = bas.min - haut.min, de = haut.eur - bas.eur;
  return { dt, de, parMin: dt > 0.5 ? de / dt : Infinity };
}

/** Une marche doit faire économiser au moins cette part du prix du trajet d'où elle part. */
export const MARCHE_MIN = 0.12;
/** …ou être une bonne affaire en absolu : au moins 5 €, à au moins 1 € par minute perdue. */
export const AFFAIRE_EUR = 5, AFFAIRE_PAR_MIN = 1;
/** En dessous de 2 min d'écart, deux trajets prennent « le même temps » : le moins cher l'emporte. */
export const MEME_TEMPS = 2;

/**
 * L'escalier : parmi les trajets `items` ([{min, eur}]), ceux qu'on montre, du plus rapide au moins cher.
 * On part du plus rapide ; un trajet plus lent n'est retenu que s'il fait économiser au moins
 * `seuil` (12 %) du prix du dernier trajet retenu, ou au moins 5 € à 1 €/min ou plus (bonne affaire).
 * Un trajet presque aussi rapide (moins de 2 min) et moins cher remplace le dernier retenu (sauf le plus
 * rapide, qui reste la référence). Les trajets dominés sont exclus d'office.
 * Renvoie les indices retenus, dans l'ordre de l'escalier.
 */
export function escalier(items, seuil = MARCHE_MIN) {
  const dom = domines(items);
  const ordre = items.map((x, i) => i).filter(i => !dom.has(i)).sort((a, b) => items[a].min - items[b].min);
  const out = [];
  for (const i of ordre) {
    const dernier = out.length ? items[out.at(-1)] : null, x = items[i];
    if (!dernier) { out.push(i); continue; }
    const de = dernier.eur - x.eur, dt = x.min - dernier.min;
    // Presque le même temps (moins de 2 min de plus) et moins cher : il remplace le précédent.
    if (dt < MEME_TEMPS && de > 0 && out.length > 1) { out[out.length - 1] = i; continue; }
    // Marche retenue : 12 % d'économie, ou bonne affaire en absolu (5 € au moins, à 1 €/min au moins).
    if (de >= seuil * dernier.eur || (de >= AFFAIRE_EUR && de / Math.max(dt, 0.5) >= AFFAIRE_PAR_MIN)) out.push(i);
  }
  return out;
}

/** Temps en plus accepté par défaut (minutes), par rapport au trajet le plus rapide. */
export const LIMITE_DEF = 30;

/** Au-delà de 2 fois la limite (et jusqu'à 3 fois), une suggestion doit faire économiser au moins 20 % de plus. */
export const VRAI_GAIN = 0.20;

/** Garde-fou du choix (radin, mais pas trop) : chaque pas doit faire gagner au moins 2 €, quel que soit
 *  le prix du trajet (l'erreur sur l'écart vient de la partie des trajets qui diffère, pas du prix total)… */
export const PAS_EUR = 2;
/** …et au moins 1 € toutes les 3 minutes perdues (soit 20 € de l'heure). */
export const MIN_PAR_EURO = 3;

/** Vrai si passer du trajet `a` au trajet `b`, plus lent, rapporte assez (voir PAS_EUR et MIN_PAR_EURO). */
export function rentable(a, b) {
  const de = a.eur - b.eur, dt = b.min - a.min;
  return de >= PAS_EUR && de * MIN_PAR_EURO >= dt;
}

// Depuis le trajet `depart`, on avance tant qu'un trajet plus lent (jusqu'à `maxMin`) est rentable ;
// à chaque pas, on prend celui qui rapporte le plus par minute, puis on repart de lui.
function avancer(items, depart, maxMin) {
  let cur = depart;
  for (;;) {
    let next = -1, mieux = -Infinity;
    items.forEach((x, i) => {
      const c = items[cur];
      if (x.min <= c.min || x.min > maxMin || !rentable(c, x)) return;
      const taux = (c.eur - x.eur) / Math.max(x.min - c.min, 0.5);
      if (taux > mieux) { mieux = taux; next = i; }
    });
    if (next < 0) return cur;
    cur = next;
  }
}

/**
 * Le choix dans la limite de temps de l'utilisateur, et une suggestion au-delà.
 * `items` : les trajets gardés ([{min, eur}]), triés du plus rapide au plus lent ; `limite` : minutes en plus
 * acceptées (Infinity : peu importe). Le choix est le trajet le moins cher qu'on atteint dans la limite en
 * partant du plus rapide, chaque pas rapportant au moins 2 € et 1 € toutes les 3 min (voir rentable).
 * La suggestion continue de la même façon jusqu'à 2 fois la limite ; jusqu'à 3 fois seulement si elle fait
 * économiser au moins 20 % (VRAI_GAIN) du prix du choix. -1 s'il n'y en a pas.
 */
export function choixLimite(items, limite) {
  if (!items.length) return { choix: -1, suggestion: -1 };
  const t0 = items[0].min;
  const choix = avancer(items, 0, t0 + limite);
  let suggestion = avancer(items, choix, t0 + 2 * limite);
  if (suggestion === choix) {
    const loin = avancer(items, choix, t0 + 3 * limite);
    suggestion = items[choix].eur - items[loin].eur >= VRAI_GAIN * items[choix].eur ? loin : choix;
  }
  return { choix, suggestion: suggestion === choix ? -1 : suggestion };
}

/**
 * Vrai si `x` ({min, eur}) est au-dessus de la ligne droite qui relie `p` et `n` dans le plan temps → prix :
 * il est alors moins bon que l'un ou l'autre, quelle que soit la valeur donnée au temps.
 */
export function auDessusLigne(p, n, x) {
  if (!n || n.min <= p.min) return false;
  return x.eur > p.eur + (n.eur - p.eur) * (x.min - p.min) / (n.min - p.min);
}

/**
 * Range les trajets pour l'affichage. `items` : [{min, eur}] ; `limite` : minutes en plus acceptées.
 *  - l'escalier (voir escalier) ;
 *  - les variantes intermédiaires, montrées à la demande ;
 *  - les trajets sans intérêt, seulement en pointillés sur la carte : plus chers que le plus rapide,
 *    dominés, dérisoires (moins de 1 € gagné pour plus de 5 min perdues par rapport au trajet de l'escalier
 *    juste plus rapide), doublons (moins de 2 min d'écart avec un trajet de l'escalier pas plus cher)
 *    ou au-dessus de la ligne qui relie leurs deux voisins de l'escalier (voir auDessusLigne) ;
 *  - le choix et la suggestion (voir choixLimite), variantes comprises : une variante retenue
 *    « monte » dans l'escalier (`promus`).
 * Les numéros des trajets (`numeros` : indice → n°) ne dépendent pas de la limite : changer de pilule
 * ne renumérote rien. Tous les indices renvoyés sont ceux de `items`.
 */
export function classer(items, limite = LIMITE_DEF) {
  const parTemps = (a, b) => items[a].min - items[b].min;
  const dom = domines(items);
  const esc = escalier(items).sort(parTemps);
  const autres = items.map((_, i) => i).filter(i => !esc.includes(i)).sort(parTemps);
  const avant = i => [...esc].reverse().find(j => items[j].min <= items[i].min) ?? esc[0];
  const prixRapide = items[esc[0]].eur;
  const derisoire = i => { const r = avant(i); return items[r].eur - items[i].eur < 1 && items[i].min - items[r].min > 5; };
  const doublon = i => esc.some(j => Math.abs(items[j].min - items[i].min) < 2 && items[j].eur <= items[i].eur);
  const auDessus = i => { const p = avant(i), n = esc[esc.indexOf(p) + 1]; return auDessusLigne(items[p], n == null ? null : items[n], items[i]); };
  const masques = autres.filter(i => items[i].eur >= prixRapide || dom.has(i) || derisoire(i) || doublon(i) || auDessus(i));
  const variantes = autres.filter(i => !masques.includes(i));
  const numeros = new Map([...esc, ...variantes, ...masques].map((i, k) => [i, k + 1]));
  const cands = [...esc, ...variantes].sort(parTemps);
  const cl = choixLimite(cands.map(i => items[i]), limite);
  const choix = cands[cl.choix], suggestion = cl.suggestion >= 0 ? cands[cl.suggestion] : -1;
  const promus = [choix, suggestion].filter(i => i >= 0 && variantes.includes(i));
  return {
    rapide: esc[0],
    escalier: [...esc, ...promus].sort(parTemps),
    variantes: variantes.filter(i => !promus.includes(i)),
    masques, choix, suggestion, promus, numeros
  };
}

/**
 * Déplacement pro : ce que rapporte un trajet une fois remboursé. Les IK (`ik` €/km) se comptent sur une
 * distance de référence fixe `refKm` (celle du trajet le plus rapide, que l'employeur peut vérifier) ;
 * le péage est remboursé au réel, il s'annule. Montants arrondis pour que les additions tombent juste.
 * Renvoie {ik, peage, note (note de frais), reel (coût réel), marge}.
 */
export function margePro(c, ik, refKm) {
  const ikTot = Math.round(ik * refKm), peage = Math.round(c.toll), roule = Math.round(c.fuel + c.wear);
  return { ik: ikTot, peage, note: ikTot + peage, reel: roule + peage, marge: ikTot - roule };
}
