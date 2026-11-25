// Génère peages-data.js : tarif réel au kilomètre (voitures, classe 1) de chaque autoroute APRR et AREA.
// À lancer une fois par an, après la hausse du 1er février et la mise à jour des données sur data.gouv.fr.
//
// Sources (data.gouv.fr) :
//   - « Tarifs autoroutes APRR » : grilles APRR et AREA par couple entrée-sortie (Licence Ouverte 2.0)
//   - « Gares de péage du réseau routier national concédé » : gare → autoroute (ODC-BY)
// Méthode : pour chaque couple entrée-sortie de 15 km ou plus dont les deux gares sont sur la même autoroute,
// tarif ÷ distance tarifaire ; on garde la médiane par autoroute (au moins 5 couples).
//
// Usage : node outils/peages.mjs > peages-data.js
//   Les adresses des fichiers changent à chaque mise à jour : relever les nouvelles sur data.gouv.fr
//   et les reporter ci-dessous (ou passer un dossier local contenant aprr.csv, area.csv et gares.csv).
import { readFileSync } from 'node:fs';

const SOURCES = {
  aprr: 'https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv',
  area: 'https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131936/2026-02.csv',
  gares: 'https://static.data.gouv.fr/resources/gares-de-peage-du-reseau-routier-national-concede/20250728-140859/gares-peage-2025.csv'
};
const ANNEE = 2026, MIN_KM = 15, MIN_COUPLES = 5;

const dossier = process.argv[2];
async function lire(nom) {
  if (dossier) return readFileSync(`${dossier}/${nom}.csv`, 'utf8');
  for (let essai = 1; ; essai++) {
    try { const r = await fetch(SOURCES[nom]); if (r.ok) return await r.text(); throw new Error(`HTTP ${r.status}`); }
    catch (e) { if (essai >= 5) throw e; await new Promise(ok => setTimeout(ok, 3000)); }
  }
}
function csv(texte, sep) {
  const [tete, ...lignes] = texte.trim().split(/\r?\n/).map(l => l.split(sep));
  return lignes.map(l => Object.fromEntries(tete.map((c, i) => [c, l[i]])));
}
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/S\//g, 'SUR').replace(/\bSTE?-/g, m => (m.startsWith('STE') ? 'SAINTE' : 'SAINT')).replace(/[^A-Z0-9]/g, '');

// Gare → autoroutes. Code route du référentiel : département (2) + « A9 » + numéro sur 3 chiffres (01A903905CD → A39).
const gares = new Map();
for (const g of csv(await lire('gares'), ';')) {
  if (g.route?.slice(2, 4) !== 'A9') continue;
  const a = 'A' + parseInt(g.route.slice(4, 7), 10), k = norm(g.nomGare);
  if (!gares.has(k)) gares.set(k, new Set());
  gares.get(k).add(a);
}
// Les grilles nomment « BEAUNE » ce que le référentiel appelle « Beaune Nord » et « Beaune Sud ».
const autoroutes = nom => {
  const n = norm(nom);
  if (gares.has(n)) return gares.get(n);
  const out = new Set();
  for (const [k, v] of gares) if (k.startsWith(n) || (n.startsWith(k) && k.length >= 5)) v.forEach(a => out.add(a));
  return out;
};

const taux = new Map();
for (const [nom, ce, cs] of [['aprr', 'gare_entree', 'gare_sortie'], ['area', 'libelle_gare_entree', 'libelle_gare_sortie']]) {
  for (const r of csv(await lire(nom), ',')) {
    const km = parseFloat(r.distance_tarifaire_km), prix = parseFloat(r.tarif_classe_1);
    if (!(km >= MIN_KM) || !(prix > 0)) continue;
    const communes = [...autoroutes(r[ce])].filter(a => autoroutes(r[cs]).has(a));
    if (communes.length !== 1) continue;   // ambigu ou sur deux autoroutes : ignoré
    if (!taux.has(communes[0])) taux.set(communes[0], []);
    taux.get(communes[0]).push(prix / km);
  }
}
const mediane = v => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const resultat = [...taux].filter(([, v]) => v.length >= MIN_COUPLES)
  .sort((x, y) => parseInt(x[0].slice(1), 10) - parseInt(y[0].slice(1), 10))
  .map(([a, v]) => [a, +mediane(v).toFixed(3), v.length]);

console.error(resultat.map(([a, t, n]) => `${a} ${t} €/km (${n} couples)`).join('\n'));
console.log(`// Fichier généré par outils/peages.mjs : ne pas modifier à la main.
// Tarif médian au kilomètre (voitures, classe 1) par autoroute, tarifs au 1er février ${ANNEE}.
// Sources : data.gouv.fr, « Tarifs autoroutes APRR » (APRR et AREA, Licence Ouverte 2.0)
// et « Gares de péage du réseau routier national concédé » (ODC-BY).
export const TARIFS_ANNEE = ${ANNEE};
/** Autoroute → [€/km, nombre de couples entrée-sortie mesurés]. */
export const TARIFS_KM = {
${resultat.map(([a, t, n]) => `  ${a}: [${t}, ${n}]`).join(',\n')}
};`);
