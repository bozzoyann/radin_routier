// Génère villes-data.js : villes repères de métropole (préfectures, sous-préfectures, communes de 25 000 habitants et plus),
// avec leurs coordonnées. Script lancé une fois à la main, pas à chaque publication.
//
// Sources :
//   - population et préfectures : @etalab/decoupage-administratif (Insee, Licence Ouverte 2.0)
//   - coordonnées : cities.json (GeoNames, CC-BY 4.0)
// Usage :
//   mkdir /tmp/v && cd /tmp/v && npm pack @etalab/decoupage-administratif@6.1.0 cities.json@1.1.66
//   for f in *.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
//   node outils/villes.mjs /tmp/v/etalab-decoupage-administratif-6.1.0/package/data /tmp/v/cities.json-1.1.66/package/cities.json > villes-data.js
import { readFileSync } from 'node:fs';

const [dossierEtalab, fichierGeonames] = process.argv.slice(2);
const communes = JSON.parse(readFileSync(`${dossierEtalab}/communes.json`));
const departements = JSON.parse(readFileSync(`${dossierEtalab}/departements.json`));
const geonames = JSON.parse(readFileSync(fichierGeonames)).filter(c => c.country === 'FR');

const MIN = 25000;
const arrondissements = JSON.parse(readFileSync(`${dossierEtalab}/arrondissements.json`));
// Préfectures et sous-préfectures : de bons repères sur la route, même petites.
const prefectures = new Set([...departements, ...arrondissements].map(d => d.chefLieu));
const cle = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^saint/, 'st').replace(/[^a-z]/g, '');
const parDep = new Map();
for (const g of geonames) { const k = g.admin2 + '|' + cle(g.name); if (!parDep.has(k)) parDep.set(k, g); }

// Noms différents dans GeoNames (anglais, ou commune avant fusion).
const ALIAS = { 'Dunkerque': ['Dunkirk'], 'Cherbourg-en-Cotentin': ['Cherbourg-Octeville', 'Cherbourg'], 'Bourgoin-Jallieu': ['Bourgoin'],
  'Évry-Courcouronnes': ['Évry', 'Evry'], 'Saint-Ouen-sur-Seine': ['Saint-Ouen'], 'Oullins-Pierre-Bénite': ['Oullins'],
  'Le Chesnay-Rocquencourt': ['Le Chesnay'], 'Sèvremoine': ['Saint-Macaire-en-Mauges'],
  'Vire Normandie': ['Vire'], 'Florac Trois Rivières': ['Florac'], 'Segré-en-Anjou Bleu': ['Segré'],
  'Château-Gontier-sur-Mayenne': ['Château-Gontier'], 'Val de Briey': ['Briey'], 'Montreuil-sur-Mer': ['Montreuil'],
  'Louhans-Châteaurenaud': ['Louhans'] };
const out = [], manquantes = [];
for (const c of communes) {
  if (c.type !== 'commune-actuelle' || c.zone !== 'metro') continue;
  if (!((c.population || 0) >= MIN || prefectures.has(c.code))) continue;
  const g = [c.nom, ...(ALIAS[c.nom] || [])].map(n => parDep.get(c.departement + '|' + cle(n))).find(Boolean);
  if (!g) { manquantes.push(`${c.nom} (${c.departement})`); continue; }
  out.push([c.nom, +(+g.lat).toFixed(3), +(+g.lng).toFixed(3), c.population || 0]);
}
out.sort((a, b) => b[3] - a[3]);
console.error(`${out.length} villes, ${manquantes.length} sans coordonnées : ${manquantes.join(', ')}`);
console.log(`// Fichier généré par outils/villes.mjs : ne pas modifier à la main.
// Villes repères de métropole (préfectures, sous-préfectures, 25 000 habitants et plus) : [nom, lat, lon, population].
// Sources : Insee via @etalab/decoupage-administratif (Licence Ouverte 2.0), coordonnées GeoNames (CC-BY 4.0).
export const VILLES = ${JSON.stringify(out).replace(/\],\[/g, '],\n[')};`);
