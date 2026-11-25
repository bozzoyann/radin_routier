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
  assert.deepEqual(refsOf(man), ['A75', 'E11', 'N88']); // N88 = 3 × 2 km ≥ 5 km ; D911 trop court
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
  near(c.toll, 100 * 0.10);    // 10 €
  near(c.eur, c.fuel + c.wear + c.toll);
  near(c.eur, 49.42);
  near(c.mix, 49.42 + 2.5 * 15); // + 2 h 30 à 15 €/h
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
