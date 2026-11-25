import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, classe, refsOf, analyse, dedupe, cost, tauxHoraire, along, DEF } from '../cost.js';

// Encodeur de polyline (inverse de decode), pour fabriquer des tracés de test.
function encode(pts, prec = 6) {
  const f = Math.pow(10, prec); let out = '', pl = 0, pn = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lon] of pts) { const a = Math.round(lat * f), b = Math.round(lon * f); out += enc(a - pl) + enc(b - pn); pl = a; pn = b; }
  return out;
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('decode : exemple de référence Google (précision 5)', () => {
  assert.deepEqual(decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('decode : aller-retour en précision 6 (Valhalla)', () => {
  const pts = [[43.604652, 1.444209], [44.350000, 2.575000], [45.764043, 4.835659]];
  decode(encode(pts)).forEach((p, i) => { near(p[0], pts[i][0], 1e-6); near(p[1], pts[i][1], 1e-6); });
  assert.deepEqual(decode(''), []);
});

test('classe : autoroute, ville, route', () => {
  assert.equal(classe({ highway: true, length: 1, time: 600 }), 'autoroute');       // drapeau Valhalla, même lent
  assert.equal(classe({ street_names: ['A 75'], length: 10, time: 300 }), 'autoroute'); // nom « A » + numéro
  assert.equal(classe({ street_names: ['Avenue Foch'], length: 1, time: 120 }), 'ville'); // 30 km/h
  assert.equal(classe({ street_names: ['N88'], length: 20, time: 900 }), 'route');       // 80 km/h
  assert.equal(classe({ length: 5, time: 360 }), 'route');                               // 50 km/h pile : route
  assert.equal(classe({ length: 0, time: 0 }), 'route');                                 // pas de durée
});

test('refsOf : numéros de routes cumulés, petits tronçons compris', () => {
  const man = [
    { length: 2, street_names: ['N88'] }, { length: 2, street_names: ['N 88'] }, { length: 2, street_names: ['N88'] },
    { length: 40, street_names: ['A75', 'E11'] }, { length: 3, street_names: ['D911'] }, { length: 10, street_names: ['Rue de la Paix'] }
  ];
  assert.deepEqual(refsOf(man), ['A75', 'N88']); // N88 = 3 × 2 km ≥ 5 km ; D911 trop court
});

const trip = (man, summary, shape = encode([[43.6, 1.44], [45.76, 4.84]])) => ({ summary, legs: [{ maneuvers: man, shape }] });

test('analyse : répartition et recalage sur la distance du résumé', () => {
  const r = analyse(trip([
    { length: 100, time: 3600, highway: true, toll: true }, // autoroute à péage
    { length: 50, time: 2400 },                             // 75 km/h : route
    { length: 10, time: 1200 }                              // 30 km/h : ville
  ], { length: 176, time: 7200, has_toll: true }));
  // Somme des manœuvres 160 km, résumé 176 km : facteur 1,1.
  near(r.hwKm, 110); near(r.routeKm, 55); near(r.villeKm, 11); near(r.tollKm, 110);
  near(r.hwKm + r.routeKm + r.villeKm, r.km);
  assert.equal(r.min, 120);
  assert.equal(r.pts.length, 2);
});

test('analyse : entrées et sorties d\'autoroute', () => {
  const shape = encode([[0, 0], [0, 0.1], [0, 0.2], [0, 0.3]]);
  const r = analyse(trip([
    { length: 10, time: 600, begin_shape_index: 0 },                 // route
    { length: 80, time: 2400, highway: true, begin_shape_index: 1 }, // on monte sur l'autoroute
    { length: 20, time: 900, begin_shape_index: 2 }                  // on en descend
  ], { length: 110, time: 3900 }, shape));
  assert.deepEqual(r.ech.map(e => [e.type, e.at]), [['entree', 10], ['sortie', 90]]);
  assert.deepEqual(r.ech[0].p, [0, 0.1]);
});

test('analyse : péage signalé sans manœuvre marquée → kilomètres d\'autoroute', () => {
  const r = analyse(trip([{ length: 80, time: 2400, highway: true }, { length: 20, time: 900 }], { length: 100, time: 3300, has_toll: true }));
  near(r.tollKm, 80);
  const g = analyse(trip([{ length: 80, time: 2400, highway: true }], { length: 80, time: 2400, has_toll: false }));
  near(g.tollKm, 0);
});

test('analyse : sans manœuvres, tout compte comme route', () => {
  const r = analyse(trip([], { length: 42, time: 1800 }));
  near(r.routeKm, 42); near(r.hwKm, 0);
});

test('cost : totaux vérifiables à la main', () => {
  const r = { km: 200, min: 150, hwKm: 120, routeKm: 70, villeKm: 10, tollKm: 100 };
  const c = cost(r, DEF);
  // litres = (10×7,5 + 70×5,5 + 120×6,5)/100 = (75 + 385 + 780)/100 = 12,4 L
  near(c.litres, 12.4);
  near(c.fuel, 12.4 * 2.05);   // 25,42 €
  near(c.wear, 200 * 0.07);    // 14 €
  near(c.toll, 100 * 0.09);    // 9 €
  near(c.eur, c.fuel + c.wear + c.toll);
  near(c.eur, 48.42);
  near(c.mix, 48.42 + 2.5 * 15); // + 2 h 30 à 15 €/h
});

test('tauxHoraire : ce que rapporte l\'heure perdue', () => {
  const rapide = { eur: 60, min: 300 };
  near(tauxHoraire({ eur: 40, min: 360 }, rapide), 20);           // 20 € pour 1 h
  assert.equal(tauxHoraire({ eur: 70, min: 360 }, rapide), null);  // plus cher et plus lent
  assert.equal(tauxHoraire({ eur: 50, min: 300.2 }, rapide), Infinity); // moins cher sans être plus lent
});

test('dedupe : moins de 1 % d\'écart en distance ET en temps', () => {
  const a = { km: 500, min: 300 };
  const out = dedupe([a, { km: 504, min: 302 }, { km: 520, min: 301 }, { km: 501, min: 320 }]);
  assert.deepEqual(out, [a, { km: 520, min: 301 }, { km: 501, min: 320 }]);
  assert.deepEqual(dedupe([]), []);
});

test('along : points de passage à 25, 50 et 75 %', () => {
  const pts = [0, 1, 2, 3, 4].map(i => [0, i]); // équateur : pas de déformation
  assert.deepEqual(along(pts, [0, 0.25, 0.5, 0.75, 1]), [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
});

import { usureParKm, USURE_DEF } from '../cost.js';

test('usureParKm : exemple par défaut, vérifiable à la main', () => {
  const u = usureParKm(USURE_DEF);
  // 480/40000 + 800/80000 + 800/160000 + 1500/100000 = 0,012 + 0,010 + 0,005 + 0,015
  near(u.postes.reduce((a, b) => a + b), 0.042);
  near(u.decote, 2500 / 100000);        // 0,025 €/km
  near(u.revision, 0);                  // moins de 20 000 km/an : coût fixe, exclu
  near(u.total, 0.067);                 // ≈ 7 c€/km, comme le brief
});

test('usureParKm : révision au km et valeurs absurdes ignorées', () => {
  const u = usureParKm({ ...USURE_DEF, revision: { actif: true, prix: 150, km: 20000 } });
  near(u.revision, 0.0075); near(u.total, 0.0745);
  const z = usureParKm({ postes: [{ prix: 500, km: 0 }, { prix: -3, km: 1000 }], decote: { actuelle: 3000, future: 5000, km: 1000 }, revision: { actif: true, prix: 100, km: 0 } });
  near(z.total, 0); // durée nulle, prix négatif, voiture qui prend de la valeur : rien
});

import { domines } from '../cost.js';

test('domines : plus lent ET plus cher qu\'un autre', () => {
  const t = [
    { min: 220, eur: 106 }, // 0 le plus rapide
    { min: 227, eur: 83 },  // 1
    { min: 309, eur: 55 },  // 2
    { min: 334, eur: 65 },  // 3 dominé par 2
    { min: 233, eur: 110 }, // 4 dominé par 0 et 1
    { min: 344, eur: 54 }   // 5 le moins cher
  ];
  assert.deepEqual([...domines(t)].sort(), [3, 4]);
  assert.deepEqual([...domines([{ min: 1, eur: 1 }, { min: 1, eur: 1 }])], []); // égalité parfaite : aucun ne domine
});

import { marche } from '../cost.js';

test('marche : minutes en plus, euros économisés, euros par minute', () => {
  const autoroute = { min: 219, eur: 106 }, mixte = { min: 227, eur: 83 }, petites = { min: 309, eur: 55 };
  const m1 = marche(autoroute, mixte, 15);
  near(m1.dt, 8); near(m1.de, 23); near(m1.parMin, 23 / 8); assert.equal(m1.verdict, 'oui'); // 172 €/h
  const m2 = marche(mixte, petites, 25);
  near(m2.dt, 82); near(m2.de, 28); assert.equal(m2.verdict, 'bof');   // 20,5 €/h : entre 12,5 et 25
  assert.equal(marche(mixte, petites, 50).verdict, 'non');             // moins de 25 €/h
  assert.equal(marche(mixte, petites, 15).verdict, 'oui');
  assert.equal(marche({ min: 100, eur: 50 }, { min: 100.2, eur: 40 }, 15).parMin, Infinity); // même durée
});

import { escalier } from '../cost.js';

test('escalier : les marches trop petites (moins de 12 %) sautent', () => {
  const t = [
    { min: 200, eur: 90 },  // 0 le plus rapide
    { min: 235, eur: 68 },  // 1 −24 %       : gardé
    { min: 260, eur: 64 },  // 2 −6 % de 68  : saute
    { min: 290, eur: 61 },  // 3 −10 % de 68 : saute
    { min: 315, eur: 53 },  // 4 −22 % de 68 : gardé
    { min: 330, eur: 70 }   // 5 dominé
  ];
  assert.deepEqual(escalier(t), [0, 1, 4]);
  assert.deepEqual(escalier(t, 0), [0, 1, 2, 3, 4]); // sans seuil : tous les non dominés
  assert.deepEqual(escalier([{ min: 10, eur: 5 }]), [0]);
});

test('escalier : 12 % pile suffit', () => {
  assert.deepEqual(escalier([{ min: 100, eur: 100 }, { min: 130, eur: 88 }]), [0, 1]);
  assert.deepEqual(escalier([{ min: 100, eur: 100 }, { min: 130, eur: 88.5 }]), [0]);
});

test('escalier : une suite de petites marches ne fait pas tout disparaître', () => {
  // Chaque trajet ne fait gagner que 5 € (environ 5 %) sur le précédent, mais les écarts
  // se cumulent par rapport au dernier trajet RETENU : 100 → 85 (−15 %) → 70 (−18 %).
  const t = [100, 95, 90, 85, 80, 75, 70].map((eur, k) => ({ min: 100 + 10 * k, eur }));
  assert.deepEqual(escalier(t), [0, 3, 6]);
});

import { choixLimite, LIMITE_DEF } from '../cost.js';

test('choixLimite : le moins cher dans la limite, chaque pas rapportant au moins 3 € et 1 € toutes les 3 min', () => {
  assert.equal(LIMITE_DEF, 30);
  // Une variante à +19 min pour −7 € (1 € toutes les 2,7 min), puis +1 h 30 pour −17 € en tout.
  const t = [{ min: 264, eur: 121 }, { min: 283, eur: 114 }, { min: 354, eur: 104 }];
  assert.deepEqual(choixLimite(t, 60), { choix: 1, suggestion: -1 });   // la suite : 10 € pour 71 min, non
  assert.deepEqual(choixLimite(t, 15), { choix: 0, suggestion: 1 });    // +19 min : au-delà, mais suggéré
  assert.deepEqual(choixLimite(t, Infinity), { choix: 1, suggestion: -1 });
  assert.deepEqual(choixLimite(t, 0), { choix: 0, suggestion: -1 });    // pressé : le plus rapide
  // 7 € pour 1 h : non. 14,50 € pour 2 h : non plus. 2 €, même en 2 min : trop peu.
  assert.deepEqual(choixLimite([{ min: 100, eur: 100 }, { min: 160, eur: 93 }], 60).choix, 0);
  assert.deepEqual(choixLimite([{ min: 0, eur: 121 }, { min: 120, eur: 106.5 }], 120).choix, 0);
  assert.deepEqual(choixLimite([{ min: 0, eur: 100 }, { min: 2, eur: 98 }], 30).choix, 0);
});

test('choixLimite : on avance pas à pas, et la suggestion va jusqu\'à 3 fois la limite si vrai gain (20 %)', () => {
  // +8 min pour −24 €, puis +1 h 21 pour −27 € de plus (pile 1 € toutes les 3 min).
  const t = [{ min: 230, eur: 115 }, { min: 238, eur: 91 }, { min: 319, eur: 64 }];
  assert.deepEqual(choixLimite(t, 90), { choix: 2, suggestion: -1 });
  // Limite 30 : rien jusqu'à 60 min ; jusqu'à 90 min, 64 € fait −30 % sur 91 € : suggéré.
  assert.deepEqual(choixLimite(t, 30), { choix: 1, suggestion: 2 });
  // Un pas qui rapporte gros (3 € en 1 min), puis 9 € pour 29 min de plus : pas assez, on s'arrête.
  assert.deepEqual(choixLimite([{ min: 0, eur: 100 }, { min: 1, eur: 97 }, { min: 30, eur: 88 }], 60).choix, 1);
});

test('choixLimite : entre 2 et 3 fois la limite, un petit gain ne suffit pas', () => {
  const t = [{ min: 200, eur: 100 }, { min: 225, eur: 80 }, { min: 275, eur: 70 }];
  // Limite 30 : choix +25 min (80 €). +75 min est entre 60 et 90 min, −12,5 % seulement : pas de suggestion.
  assert.deepEqual(choixLimite(t, 30), { choix: 1, suggestion: -1 });
  // Même trajet à 55 € (−31 %) : vrai gain, suggéré.
  assert.deepEqual(choixLimite([t[0], t[1], { min: 275, eur: 55 }], 30), { choix: 1, suggestion: 2 });
  // Cas réel rencontré : 28 € de moins sur 111 € (≈ 25 %), entre 2 et 3 fois la limite : suggéré.
  assert.deepEqual(choixLimite([{ min: 285, eur: 130 }, { min: 317, eur: 111.4 }, { min: 384, eur: 83.6 }], 45), { choix: 1, suggestion: 2 });
  // 18 % de gain ne suffit toujours pas.
  assert.deepEqual(choixLimite([t[0], t[1], { min: 275, eur: 65.6 }], 30), { choix: 1, suggestion: -1 });
});

test('cost : tarif réel au km de l\'autoroute du tronçon (peages-data.js), sinon tarif estimé', () => {
  const tarifs = { A43: [0.136, 42], A6: [0.091, 196] };
  const r = { km: 200, min: 120, hwKm: 200, routeKm: 0, villeKm: 0, tollKm: 160,
    peages: [{ km: 100, i0: 0, i1: 1, ref: 'A43' }, { km: 50, i0: 1, i1: 2, ref: 'A75' }] };   // + 10 km sans tronçon
  const c = cost(r, DEF, tarifs);
  near(c.toll, 100 * 0.136 + 50 * 0.09 + 10 * 0.09);
  assert.deepEqual(c.tarifsReels, ['A43']);
  near(cost({ ...r, peages: [] }, DEF, tarifs).toll, 160 * 0.09);   // ancien trajet sans tronçons : tout au tarif estimé
});

test('analyse : numéro d\'autoroute des tronçons payants', () => {
  const r = analyse(trip([
    { length: 50, time: 1800, highway: true, toll: true, street_names: ['A 43', 'E 70'], begin_shape_index: 0, end_shape_index: 1 },
    { length: 10, time: 600, toll: true, street_names: ['N 205'], begin_shape_index: 1, end_shape_index: 1 }
  ], { length: 60, time: 2400, has_toll: true }));
  assert.deepEqual(r.peages.map(p => p.ref), ['A43', null]);
});

test('escalier : bonne affaire en absolu, même si moins de 12 %', () => {
  // 15 € de moins pour 8 min sur un trajet à 136 € : 11 % seulement, mais 1,9 €/min.
  assert.deepEqual(escalier([{ min: 260, eur: 136 }, { min: 268, eur: 121 }]), [0, 1]);
  // 4 € pour 2 min (2 €/min) : moins de 5 €, pas retenu.
  assert.deepEqual(escalier([{ min: 260, eur: 136 }, { min: 262, eur: 132 }]), [0]);
  // 6 € pour 20 min (0,3 €/min) : pas une affaire.
  assert.deepEqual(escalier([{ min: 260, eur: 136 }, { min: 280, eur: 130 }]), [0]);
});

test('escalier : presque le même temps et moins cher, il remplace le précédent', () => {
  const t = [{ min: 268, eur: 121 }, { min: 334, eur: 73 }, { min: 334.4, eur: 72 }];
  assert.deepEqual(escalier(t), [0, 2]);
  // Le plus rapide reste la référence, même si un trajet à 1 min de plus coûte moins cher.
  assert.deepEqual(escalier([{ min: 100, eur: 50 }, { min: 101, eur: 49 }]), [0]);
});

import { auDessusLigne } from '../cost.js';

test('auDessusLigne : variante moins bonne que ses deux voisins', () => {
  const p = { min: 268, eur: 121 }, n = { min: 334, eur: 72 };
  assert.equal(auDessusLigne(p, n, { min: 329, eur: 112 }), true);    // 1 h de plus pour 9 € : sans intérêt
  assert.equal(auDessusLigne(p, n, { min: 278, eur: 113 }), false);   // sous la ligne : vraie variante
  assert.equal(auDessusLigne(p, null, { min: 300, eur: 100 }), false); // pas de voisin suivant
});
