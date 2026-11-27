import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dkm, dSegment, reechantillonne, estLibre, estAutoroute, bascules, candidats, reglagesMixte, joindre } from '../mixtes.js';

// Tracés synthétiques à l'équateur (1° de longitude ≈ 111 km), un point tous les ~1 km.
const ligne = (from, to, n) => Array.from({ length: n + 1 }, (_, k) => [from[0] + (to[0] - from[0]) * k / n, from[1] + (to[1] - from[1]) * k / n]);
// Autoroute : tout droit de lon 0 à lon 1, sur la latitude 0.
const auto = { km: 111, hwKm: 111, tollKm: 111, pts: ligne([0, 0], [0, 1], 111) };
// Route libre : part vers le nord (lat 0,1, soit ~11 km à côté), revient sur l'autoroute à lon 0,6, puis la suit.
const libre = { km: 130, hwKm: 0, tollKm: 0, pts: [...ligne([0, 0], [0.1, 0.1], 15), ...ligne([0.1, 0.1], [0.1, 0.5], 45), ...ligne([0.1, 0.5], [0, 0.6], 15), ...ligne([0, 0.6], [0, 1], 45)] };

test('dkm et reechantillonne', () => {
  assert.ok(Math.abs(dkm([0, 0], [0, 1]) - 111.2) < 0.01);
  const r = reechantillonne(auto.pts, 5);
  assert.deepEqual(r[0], [0, 0]); assert.deepEqual(r.at(-1), [0, 1]);
  assert.ok(r.length > 20 && r.length < 26);
});

test('dSegment : distance à un segment', () => {
  assert.ok(Math.abs(dSegment([0.01, 0.5], [0, 0], [0, 1]) - 1.112) < 0.001); // au-dessus du milieu
  assert.ok(Math.abs(dSegment([0, 2], [0, 0], [0, 1]) - 111.2) < 0.01);        // au-delà du bout
});

test('estLibre / estAutoroute', () => {
  assert.ok(estLibre(libre) && !estAutoroute(libre));
  assert.ok(estAutoroute(auto) && !estLibre(auto));
});

test('bascules : la route libre rejoint l\'autoroute vers lon 0,6', () => {
  const b = bascules(libre, auto);
  assert.equal(b.length, 1);
  assert.equal(b[0].sens, 'rejoint');
  assert.ok(Math.abs(b[0].p[1] - 0.6) < 0.02 && Math.abs(b[0].p[0]) < 0.01, JSON.stringify(b[0].p));
  // Au départ, les deux tracés sont confondus puis se séparent : c'est dans la marge de 15 km, ignoré.
});

test('bascules : un départ commun hors marge donne une bascule « quitte »', () => {
  const b = bascules(libre, auto, { marge: 0.5 });
  assert.deepEqual(b.map(x => x.sens), ['quitte', 'rejoint']);
});

test('candidats : au plus 4, répartis, une place pour « quitte »', () => {
  const pts = [];
  // Route libre en dents de scie : 8 allers-retours vers l'autoroute.
  for (let k = 0; k < 8; k++) pts.push(...ligne([0, k / 8], [0.1, (k + 0.5) / 8], 7), ...ligne([0.1, (k + 0.5) / 8], [0, (k + 1) / 8], 7));
  const scie = { km: 150, hwKm: 0, tollKm: 0, pts };
  const c = candidats([scie, auto]);
  assert.equal(c.length, 4);
  assert.deepEqual(c.map(x => x.sens), ['rejoint', 'rejoint', 'rejoint', 'quitte']);
  const at = c.slice(0, 3).map(x => x.at);
  assert.ok(at[0] < at[1] && at[1] < at[2]);
  assert.deepEqual(candidats([auto]), []);   // pas de trajet libre : rien à essayer
});

test('reglagesMixte : ordre des deux moitiés', () => {
  assert.deepEqual(reglagesMixte('rejoint', 'R', 'L'), ['L', 'R']);
  assert.deepEqual(reglagesMixte('quitte', 'R', 'L'), ['R', 'L']);
});

test('joindre : sommes, tracé et description', () => {
  const a = { km: 156, min: 150, hwKm: 0, routeKm: 140, villeKm: 16, tollKm: 0, refs: ['D2157', 'D357'], pts: [[0, 0], [0, 1]] };
  const b = { km: 119, min: 71, hwKm: 115, routeKm: 2, villeKm: 2, tollKm: 115, refs: ['A81', 'D357'], pts: [[0, 1], [0, 2]] };
  const j = joindre(a, b, { sens: 'rejoint', p: [0, 1] });
  assert.equal(j.km, 275); assert.equal(j.min, 221); assert.equal(j.tollKm, 115);
  assert.equal(j.hwKm + j.routeKm + j.villeKm, j.km);
  assert.deepEqual(j.refs, ['D2157', 'D357', 'A81']);
  assert.equal(j.pts.length, 4);
  assert.equal(j.mixte.texte, 'Sans autoroute sur 156 km, puis A81');
  assert.equal(joindre(b, a, { sens: 'quitte', p: [0, 1] }).mixte.texte, 'A81 sur 119 km, puis sans autoroute');
});

import { pointsDePassage } from '../mixtes.js';

test('pointsDePassage : dans le détour, pas sur la portion commune avec le plus rapide', () => {
  // Le plus rapide : tout droit vers l'est (≈ 111 km). Le trajet choisi s'en écarte de ≈ 11 km entre 0,3 et 0,7.
  const ref = Array.from({ length: 101 }, (_, i) => [0, i / 100]);
  const choisi = [...Array.from({ length: 31 }, (_, i) => [0, i / 100]), ...Array.from({ length: 41 }, (_, i) => [0.1, 0.3 + i / 100]), ...Array.from({ length: 31 }, (_, i) => [0, 0.7 + i / 100])];
  const p = pointsDePassage(choisi, ref);
  assert.equal(p.length, 3);
  for (const q of p) assert.equal(q[0], 0.1);                          // tous dans le détour
  assert.ok(p[0][1] < 0.4 && p[2][1] > 0.6);                           // entrée et sortie du détour
  assert.ok(p[0][1] < p[1][1] && p[1][1] < p[2][1]);                  // dans l'ordre du trajet
  // Même trajet que le plus rapide : points répartis à 25, 50 et 75 %.
  const r = pointsDePassage(ref, ref);
  assert.equal(r.length, 3); assert.ok(Math.abs(r[1][1] - 0.5) < 0.02);
  assert.equal(pointsDePassage(choisi, ref, { n: 1 }).length, 1);
});
