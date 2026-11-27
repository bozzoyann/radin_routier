import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLon, routeUrl, route, geocode, PROFILES, VALHALLA, lienTrajet, lireTrajet, lieuPourLien } from '../routing.js';

test('parseLatLon : coordonnées saisies à la main', () => {
  assert.deepEqual(parseLatLon(' 43.6, 1.44 '), { lat: 43.6, lon: 1.44, name: '43.6, 1.44' });
  assert.deepEqual(parseLatLon('45.76;4.84'), { lat: 45.76, lon: 4.84, name: '45.76;4.84' });
  assert.equal(parseLatLon('Lyon'), null);
  assert.equal(parseLatLon('95, 10'), null); // latitude impossible
});

test('routeUrl : requête GET Valhalla complète', () => {
  const u = routeUrl({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, PROFILES[0]);
  assert.ok(u.startsWith(VALHALLA));
  const req = JSON.parse(decodeURIComponent(u.slice(VALHALLA.length)));
  assert.deepEqual(req.locations, [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]);
  assert.equal(req.units, 'kilometers');
  assert.equal(req.alternates, 2);
  assert.equal(JSON.parse(decodeURIComponent(routeUrl({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, PROFILES[1]).slice(VALHALLA.length))).alternates, undefined);
});

test('PROFILES : 10 réglages distincts', () => {
  assert.equal(PROFILES.length, 10);
  assert.equal(new Set(PROFILES.map(p => JSON.stringify(p.auto))).size, 10);
});

const fakeFetch = (status, body) => async () => ({ ok: status < 400, status, json: async () => { if (body === undefined) throw new Error('pas JSON'); return body; } });

test('route : trajet principal et variantes', async () => {
  const t = await route({}, {}, PROFILES[0], fakeFetch(200, { trip: { id: 1 }, alternates: [{ trip: { id: 2 } }] }));
  assert.deepEqual(t, [{ id: 1 }, { id: 2 }]);
});

test('route : serveur saturé ou en erreur', async () => {
  await assert.rejects(route({}, {}, PROFILES[0], fakeFetch(429)), /saturé/);
  await assert.rejects(route({}, {}, PROFILES[0], fakeFetch(400, { error: 'No path could be found' })), /No path/);
});

test('geocode : premier résultat Photon avec département', async () => {
  const g = await geocode('Lyon', fakeFetch(200, { features: [{ geometry: { coordinates: [4.83, 45.76] }, properties: { name: 'Lyon', postcode: '69001' } }] }));
  assert.deepEqual(g, { lat: 45.76, lon: 4.83, name: 'Lyon (69)', detail: '69001' });
  await assert.rejects(geocode('Zzz', fakeFetch(200, { features: [] })), /introuvable/);
});

import { suggest, lieu } from '../routing.js';

test('lieu : nom court, département et précision', () => {
  const f = (properties) => ({ geometry: { coordinates: [4.8, 45.7] }, properties });
  assert.deepEqual(lieu(f({ name: 'Lyon', postcode: '69001', city: 'Lyon', country: 'France' })), { lat: 45.7, lon: 4.8, name: 'Lyon (69)', detail: '69001' });
  assert.equal(lieu(f({ housenumber: '12', street: 'Rue Neuve', city: 'Lyon' })).name, '12 Rue Neuve');
  assert.equal(lieu(f({ name: 'Genève', country: 'Suisse' })).detail, 'Suisse');
});

test('suggest : pas de requête avant 3 lettres ni pour des coordonnées', async () => {
  let appels = 0; const ff = async () => { appels++; return { ok: true, json: async () => ({ features: [] }) }; };
  assert.deepEqual(await suggest('Ly', { fetchFn: ff }), []);
  assert.deepEqual(await suggest('45.7, 4.8', { fetchFn: ff }), []);
  assert.equal(appels, 0);
});

test('suggest : doublons retirés, 5 au plus', async () => {
  const feat = (name, postcode) => ({ geometry: { coordinates: [0, 0] }, properties: { name, postcode } });
  const features = [feat('Lyon', '69001'), feat('Lyon', '69001'), ...['a', 'b', 'c', 'd', 'e'].map(n => feat(n, '75001'))];
  const s = await suggest('Lyon', { fetchFn: async () => ({ ok: true, json: async () => ({ features }) }) });
  assert.equal(s.length, 5);
  assert.deepEqual(s.map(x => x.name), ['Lyon (69)', 'a (75)', 'b (75)', 'c (75)', 'd (75)']);
});

test('lieu : département retrouvé sans code postal (ville entière)', () => {
  const f = (properties) => ({ geometry: { coordinates: [0, 0] }, properties });
  assert.equal(lieu(f({ name: 'Brest', county: 'Finistère', country: 'France' })).name, 'Brest (29)');
  assert.equal(lieu(f({ name: 'Dijon', county: "Côte-d'Or", country: 'France' })).name, 'Dijon (21)');
  assert.equal(lieu(f({ name: 'Paris', state: 'Paris', country: 'France' })).name, 'Paris (75)');
  assert.equal(lieu(f({ name: 'Nulle-part', country: 'France' })).name, 'Nulle-part');
  assert.equal(lieu(f({ name: 'Genève', postcode: '1201', country: 'Suisse' })).name, 'Genève'); // pas de faux département
});

test('liens de partage : fabriquer, relire, nettoyer les lieux', () => {
  const lien = lienTrajet('https://exemple.fr/radin/', { nom: 'Place du Capitole, Toulouse', pos: '43.6045,1.4442' }, { nom: 'Lyon' }, 60);
  assert.equal(lien, 'https://exemple.fr/radin/?de=Place+du+Capitole%2C+Toulouse&dep=43.6045%2C1.4442&a=Lyon&temps=60');
  assert.deepEqual(lireTrajet(new URL(lien).search), { de: { nom: 'Place du Capitole, Toulouse', lat: 43.6045, lon: 1.4442 }, a: { nom: 'Lyon' }, limite: 60 });
  assert.deepEqual(lireTrajet('?de=Rouen&a=Paris&temps=inf'), { de: { nom: 'Rouen' }, a: { nom: 'Paris' }, limite: Infinity });
  assert.deepEqual(lireTrajet('?de=Rouen&a=Paris&dep=n%27importe+quoi'), { de: { nom: 'Rouen' }, a: { nom: 'Paris' }, limite: null });
  assert.deepEqual(lireTrajet('?de=Rouen&a=Paris&temps=abc').limite, null);
  assert.equal(lireTrajet('?de=Rouen'), null);
  assert.equal(lireTrajet(''), null);
  assert.deepEqual(lieuPourLien(null, 'Lyon (69)'), { nom: 'Lyon' });
  assert.deepEqual(lieuPourLien({ name: 'Ajaccio (2A)', lat: 41.919, lon: 8.7386 }, 'Ajaccio (2A)'), { nom: 'Ajaccio', pos: '41.9190,8.7386' });
  assert.deepEqual(lieuPourLien({ name: 'Ma position', lat: 45.123456, lon: 4.987654 }, 'Ma position'), { nom: 'Position partagée', pos: '45.123,4.988' });
});
