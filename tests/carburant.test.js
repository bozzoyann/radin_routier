import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlPrix, lirePrix, prixDuJour, API_CARBU } from '../carburant.js';

test('urlPrix : moyenne autour d\'un point, prix récents', () => {
  const u = new URL(urlPrix('SP95-E10', { lat: 47.903, lon: 1.9093 }));
  assert.equal(u.origin + u.pathname, API_CARBU);
  assert.equal(u.searchParams.get('select'), 'count(*) as n, avg(e10_prix) as prix');
  assert.equal(u.searchParams.get('where'), "within_distance(geom, geom'POINT(1.9093 47.9030)', 30km) and e10_maj >= now(days=-7) and e10_prix > 0");
  assert.ok(!new URL(urlPrix('Gazole', null)).searchParams.get('where').includes('within_distance'));   // France entière
  assert.equal(urlPrix('Kérosène', null), null);
});

test('lirePrix : au moins 5 stations', () => {
  assert.deepEqual(lirePrix({ results: [{ n: 47, prix: 1.962340425 }] }), { prix: 1.962, n: 47 });
  assert.equal(lirePrix({ results: [{ n: 3, prix: 1.9 }] }), null);
  assert.equal(lirePrix({ results: [] }), null);
});

const reponse = body => async () => ({ ok: true, json: async () => body });

test('prixDuJour : local, sinon national, sinon rien', async () => {
  assert.deepEqual(await prixDuJour('SP95-E10', { lat: 47.9, lon: 1.9 }, reponse({ results: [{ n: 47, prix: 1.962 }] })), { prix: 1.962, n: 47, zone: 'local' });
  let appels = 0;
  const peu = async () => ({ ok: true, json: async () => (appels++ ? { results: [{ n: 5748, prix: 1.934 }] } : { results: [{ n: 2, prix: 2.1 }] }) });
  assert.deepEqual(await prixDuJour('SP95-E10', { lat: 47.9, lon: 1.9 }, peu), { prix: 1.934, n: 5748, zone: 'France' });
  assert.equal(await prixDuJour('SP95-E10', null, async () => { throw new Error('hors ligne'); }), null);
});
