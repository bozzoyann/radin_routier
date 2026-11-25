import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLon, routeUrl, route, geocode, PROFILES, VALHALLA } from '../routing.js';

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

test('PROFILES : 6 réglages distincts', () => {
  assert.equal(PROFILES.length, 6);
  assert.equal(new Set(PROFILES.map(p => JSON.stringify(p.auto))).size, 6);
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
