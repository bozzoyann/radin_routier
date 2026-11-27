import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExploration, coutPlan, produit, assembler, cleMorceau, LIBRE, RAPIDE } from '../explore.js';

const a = { lat: 0, lon: 0 }, b = { lat: 0, lon: 3 };   // ~333 km à l'équateur
// Un trajet par autoroute : entrée à lon 0,5, sortie à lon 2,5 ; plus une entrée trop près du départ.
const route = { km: 333, pts: [[0, 0], [0, 3]], ech: [
  { p: [0, 0.1], type: 'entree', at: 11 },     // à 11 km du départ : ignorée
  { p: [0, 0.5], type: 'entree', at: 55 },
  { p: [0, 0.55], type: 'entree', at: 61 },    // à 5,5 km de la précédente : fusionnée
  { p: [0, 2.5], type: 'sortie', at: 278 }
] };

test('planExploration : entrées, sorties et double bascule', () => {
  const plan = planExploration([route], a, b, { villes: [] });
  assert.deepEqual(plan.map(c => c.gen), ['entree', 'sortie', 'double']);
  assert.deepEqual(plan[0].morceaux.map(m => m[2]), [LIBRE, RAPIDE]);       // sans autoroute, puis rapide
  assert.deepEqual(plan[1].morceaux.map(m => m[2]), [RAPIDE, LIBRE]);       // rapide, puis sans autoroute
  assert.deepEqual(plan[2].morceaux.map(m => m[2]), [LIBRE, RAPIDE, LIBRE]);
  assert.equal(coutPlan(plan), 5);   // A→E libre, E→B rapide, A→S rapide, S→B libre, E→S rapide (A→E et S→B réutilisés)
});

test('planExploration : villes étapes, 3 × 3 réglages', () => {
  const plan = planExploration([route], a, b, { villes: [['Milieu', 0, 1.5, 100000]] });
  const v = plan.filter(c => c.gen === 'ville');
  assert.equal(v.length, 9);
  assert.equal(coutPlan(v), 6);   // 3 débuts + 3 fins, combinés 9 fois
});

test('produit : toutes les combinaisons de variantes', () => {
  assert.deepEqual(produit([['a1', 'a2'], ['b1']]), [['a1', 'b1'], ['a2', 'b1']]);
  assert.deepEqual(produit([['a'], []]), []);
});

test('assembler : sommes et description', () => {
  const p = (km, min, refs) => ({ km, min, hwKm: 0, routeKm: km, villeKm: 0, tollKm: 0, refs, pts: [[0, 0], [0, 1]] });
  const t = assembler([p(50, 60, ['D955']), p(200, 120, ['A11']), p(80, 70, ['N24'])], { gen: 'double', points: [[0, 0.5], [0, 2.5]] });
  assert.equal(t.km, 330); assert.equal(t.min, 250);
  assert.equal(t.mixte.texte, 'Sans autoroute, puis A11 sur 200 km, puis sans autoroute');
  assert.deepEqual(t.mixte.via, [0, 0.5]);
  assert.ok(t.explore);
});

test('cleMorceau : identique pour le même morceau', () => {
  assert.equal(cleMorceau(a, b, LIBRE), cleMorceau({ lat: 0.00001, lon: 0 }, b, LIBRE));
  assert.notEqual(cleMorceau(a, b, LIBRE), cleMorceau(a, b, RAPIDE));
});

test('vautExplorer : mis en avant si gros écart et peu de trajets', async () => {
  const { vautExplorer } = await import('../explore.js');
  assert.equal(vautExplorer(64, 7), true);
  assert.equal(vautExplorer(12, 7), false);
  assert.equal(vautExplorer(64, 14), false);
});
