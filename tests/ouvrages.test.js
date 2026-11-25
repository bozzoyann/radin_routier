import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvragesTraverses, OUVRAGES } from '../ouvrages.js';
import { cost, DEF } from '../cost.js';
import { joindre } from '../mixtes.js';

const ligne = (from, to, n) => Array.from({ length: n + 1 }, (_, k) => [from[0] + (to[0] - from[0]) * k / n, from[1] + (to[1] - from[1]) * k / n]);
const ete = new Date(2026, 6, 14), hiver = new Date(2026, 0, 10);

// Un « A75 » : 330 km marqués payants d'un bloc par Valhalla, passant sur le viaduc de Millau.
const a75 = { km: 340, min: 200, hwKm: 330, routeKm: 10, villeKm: 0, tollKm: 330, refs: ['A75'],
  pts: [...ligne([45.7, 3.1], [44.079, 3.022], 50), ...ligne([44.079, 3.022], [43.35, 3.27], 50)], peages: [{ km: 330, i0: 0, i1: 101 }] };

test('ouvragesTraverses : le viaduc de Millau, tarif d\'été et d\'hiver', () => {
  assert.deepEqual(ouvragesTraverses(a75, hiver), [{ nom: 'Viaduc de Millau', prix: 11.3, km: 330, verifier: false, gratuit: false }]);
  assert.equal(ouvragesTraverses(a75, ete)[0].prix, 13.8);
  assert.equal(ouvragesTraverses(a75, new Date(2026, 8, 15))[0].prix, 13.8);   // 15 septembre inclus
  assert.equal(ouvragesTraverses(a75, new Date(2026, 8, 16))[0].prix, 11.3);
});

test('cost : le péage d\'un tronçon avec ouvrage est remplacé par le prix de l\'ouvrage', () => {
  near(cost(a75, DEF).toll, 33);                                          // sans ouvrage : 330 km × 0,10 €
  const r = { ...a75, ouvrages: ouvragesTraverses(a75, hiver) };
  near(cost(r, DEF).toll, 11.3);                                          // avec : le viaduc seul
  near(cost({ ...r, tollKm: 350 }, DEF).toll, 11.3 + 2);                  // + 20 km payants ailleurs
});

test('ouvragesTraverses : rien si l\'ouvrage est loin, ou sur un tronçon gratuit', () => {
  assert.deepEqual(ouvragesTraverses({ ...a75, peages: [] }, hiver), []);
  const loin = { pts: ligne([47, 1], [47, 2], 20), peages: [{ km: 70, i0: 0, i1: 20 }] };
  assert.deepEqual(ouvragesTraverses(loin, hiver), []);
});

test('ouvragesTraverses : pont de Ré payant vers l\'île, gratuit au retour', () => {
  const o = OUVRAGES.find(x => x.nom.includes('Ré'));
  const aller = { pts: ligne(o.paye.de, o.paye.vers, 10), peages: [{ km: 3.7, i0: 0, i1: 10 }] };
  const retour = { pts: ligne(o.paye.vers, o.paye.de, 10), peages: [{ km: 3.7, i0: 0, i1: 10 }] };
  assert.equal(ouvragesTraverses(aller, ete)[0].prix, 16);
  assert.equal(ouvragesTraverses(aller, hiver)[0].prix, 8);
  const r = ouvragesTraverses(retour, ete)[0];
  assert.equal(r.prix, 0); assert.ok(r.gratuit && r.verifier);
});

test('joindre : les tronçons payants suivent le tracé assemblé', () => {
  const x = { km: 10, min: 10, hwKm: 0, routeKm: 10, villeKm: 0, tollKm: 0, refs: [], pts: [[0, 0], [0, 0.1]], peages: [] };
  const j = joindre(x, a75, { sens: 'rejoint', p: [0, 0.1] });
  assert.deepEqual(j.peages, [{ km: 330, i0: 2, i1: 103 }]);
  assert.equal(ouvragesTraverses(j, hiver)[0].nom, 'Viaduc de Millau');
});

function near(a, b, eps = 1e-9) { assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`); }
