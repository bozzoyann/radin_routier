import { test } from 'node:test';
import assert from 'node:assert/strict';
import { villesTraversees } from '../villes.js';
import { VILLES } from '../villes-data.js';

// Petit jeu de villes fictives à l'équateur (1° ≈ 111 km).
const villes = [
  ['Départ-Ville', 0, 0.01, 500000],
  ['Grande', 0.02, 0.3, 200000],      // à ~2 km du tracé
  ['Moyenne', 0, 0.6, 80000],
  ['Petite', 0.01, 0.45, 5000],
  ['Loin', 0.5, 0.5, 900000],         // à ~55 km : ignorée
  ['Arrivée-Ville', 0, 0.99, 300000]
];
const trace = Array.from({ length: 101 }, (_, k) => [0, k / 100]);

test('villesTraversees : grandes villes proches, dans l\'ordre du trajet', () => {
  assert.deepEqual(villesTraversees(trace, { villes, ecart: 0 }), ['Grande', 'Petite', 'Moyenne']);
  assert.deepEqual(villesTraversees(trace, { villes, max: 2, ecart: 0 }), ['Grande', 'Moyenne']); // les 2 plus peuplées, remises dans l'ordre
});

test('villesTraversees : villes espacées d\'au moins 25 % du trajet', () => {
  const voisines = [['A', 0, 0.4, 100000], ['B', 0, 0.42, 90000], ['C', 0, 0.8, 50000]];
  assert.deepEqual(villesTraversees(trace, { villes: voisines }), ['A', 'C']);           // B à 2 km de A
  assert.deepEqual(villesTraversees(trace, { villes: voisines, ecart: 0 }), ['A', 'B', 'C']);
});

test('villesTraversees : départ, arrivée et villes lointaines ignorés', () => {
  const v = villesTraversees(trace, { villes, max: 10 });
  assert.ok(!v.includes('Départ-Ville') && !v.includes('Arrivée-Ville') && !v.includes('Loin'));
  assert.deepEqual(villesTraversees([[0, 0]], { villes }), []);
});

test('VILLES : données intégrées plausibles', () => {
  assert.ok(VILLES.length > 400);
  const paris = VILLES.find(v => v[0] === 'Paris');
  assert.ok(Math.abs(paris[1] - 48.85) < 0.05 && Math.abs(paris[2] - 2.35) < 0.05);
  for (const [nom, la, lo] of VILLES) assert.ok(la > 41 && la < 51.2 && lo > -5.2 && lo < 9.7, nom); // métropole
});

import { villesEtapes } from '../villes.js';

test('villesEtapes : grandes villes au milieu des trajets, espacées', () => {
  const long = Array.from({ length: 301 }, (_, k) => [0, 3 * k / 300]);   // ~333 km
  const villes = [
    ['Debut', 0, 0.3, 900000],     // à 10 % du trajet : trop tôt
    ['Milieu', 0, 1.5, 300000],
    ['Voisine', 0, 1.52, 250000],  // à 2 km de Milieu : écartée
    ['Fin', 0, 2.25, 120000],      // à 75 % du trajet
    ['Petite', 0, 1.8, 20000],     // moins de 50 000 habitants
    ['Ailleurs', 1, 1.5, 800000]   // loin du tracé
  ];
  assert.deepEqual(villesEtapes([{ pts: long }], { villes }).map(v => v.nom), ['Milieu', 'Fin']);
  assert.deepEqual(villesEtapes([{ pts: long }], { villes, n: 1 }).map(v => v.nom), ['Milieu']);
  assert.deepEqual(villesEtapes([], { villes }), []);
});

import { nomsTrajets } from '../villes.js';

test('nomsTrajets : la ville la plus distinctive, puis une 2e ville, puis un numéro', () => {
  assert.deepEqual(nomsTrajets([['Carcassonne', 'Montpellier', 'Valence'], ['Albi', 'Clermont-Ferrand'], ['Albi', 'Mende', 'Saint-Étienne']]),
    ['par Carcassonne', 'par Clermont-Ferrand', 'par Mende']);
  assert.deepEqual(nomsTrajets([['Tours', 'Saumur'], ['Tours'], []]), ['par Saumur', 'par Tours', '']);
  // Même ville la plus rare pour deux trajets : on ajoute leur 2e ville.
  assert.deepEqual(nomsTrajets([['Albi', 'Rodez'], ['Albi', 'Rodez', 'Millau'], ['Albi', 'Millau']]), ['par Rodez · Albi', 'par Rodez · Millau', 'par Millau']);
  // Mêmes villes dans un autre ordre : la ville prise suit l'ordre du trajet, les noms restent distincts.
  assert.deepEqual(nomsTrajets([['Albi', 'Rodez'], ['Rodez', 'Albi']]), ['par Albi', 'par Rodez']);
  // Une seule ville en commun et rien d'autre : un numéro.
  assert.deepEqual(nomsTrajets([['Albi'], ['Albi']]), ['par Albi', 'par Albi (2)']);
});

test('nomsTrajets : mêmes villes, routes différentes : la route qui fait la différence', () => {
  // Le plus rapide et un trajet sans péage passent par les mêmes villes : on les nomme par leur route propre.
  assert.deepEqual(nomsTrajets([['Tours', 'Saumur'], ['Tours', 'Saumur'], ['Blois']], [['A10', 'A85', 'D960'], ['D952', 'D960'], ['N10']]),
    ['par l\'A10', 'par la D952', 'par Blois']);
  // Mêmes routes aussi : on garde le numéro.
  assert.deepEqual(nomsTrajets([['Albi'], ['Albi']], [['N88'], ['N88']]), ['par Albi', 'par Albi (2)']);
});
