// Réponses réelles du serveur Valhalla FOSSGIS (Paris → Rouen, 25 novembre 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse, cost, dedupe, DEF } from '../cost.js';

const lire = n => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const peage = analyse(lire('valhalla-paris-rouen-peage').trip);
const gratuit = analyse(lire('valhalla-paris-rouen-sans-peage').trip);

test('réponse réelle : par l\'A13 à péage', () => {
  assert.ok(peage.km > 120 && peage.km < 150, `${peage.km} km`);
  assert.ok(peage.tollKm > 80, `${peage.tollKm} km à péage`);
  assert.ok(peage.refs.includes('A13'));
  assert.ok(peage.pts.length > 100);
  // Le tracé part de Paris et arrive à Rouen.
  assert.ok(Math.abs(peage.pts[0][0] - 48.85) < 0.05 && Math.abs(peage.pts.at(-1)[0] - 49.44) < 0.05);
});

test('réponse réelle : la répartition retombe sur la distance totale', () => {
  for (const r of [peage, gratuit]) assert.ok(Math.abs(r.hwKm + r.routeKm + r.villeKm - r.km) < 1e-9);
});

test('réponse réelle : sans péage, plus lent mais moins cher', () => {
  assert.equal(gratuit.tollKm, 0);
  assert.ok(gratuit.min > peage.min);
  assert.ok(cost(gratuit, DEF).eur < cost(peage, DEF).eur);
  assert.equal(dedupe([peage, gratuit, peage]).length, 2);
});
