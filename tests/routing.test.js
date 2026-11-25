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
  assert.deepEqual(g, { lat: 45.76, lon: 4.83, name: 'Lyon (69)' });
  await assert.rejects(geocode('Zzz', fakeFetch(200, { features: [] })), /introuvable/);
});
