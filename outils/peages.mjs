// Génère peages-data.js : tarif réel au kilomètre (voitures, classe 1) des autoroutes à péage.
// À lancer une fois par an, après la hausse du 1er février et la mise à jour des fichiers ci-dessous.
//
// Sources :
//   - data.gouv.fr « Tarifs autoroutes APRR » : grilles APRR et AREA par couple entrée-sortie, avec la
//     distance tarifaire (Licence Ouverte 2.0)
//   - data.gouv.fr « Gares de péage du réseau routier national concédé » : autoroute et coordonnées
//     (Lambert 93) de chaque gare (ODC-BY)
//   - VINCI Autoroutes, tarifs internes publiés au format texte : ASF, Escota, Cofiroute / Arcour
//     (prix par couple entrée-sortie, sans distance)
// Méthode :
//   - APRR et AREA : tarif ÷ distance tarifaire ;
//   - Vinci : tarif ÷ (distance à vol d'oiseau entre les deux gares × facteur de détour mesuré sur APRR) ;
//   - couples de 15 km ou plus, deux gares sur la même autoroute ; médiane par autoroute (5 couples au moins) ;
//   - autoroute d'une société sans assez de mesures : médiane de la société.
// Sanef et SAPN : grilles PDF difficiles à lire automatiquement, estimation à la main (ESTIMATIONS). Pas d'Arcos (tarif selon l'heure).
//
// Usage : node outils/peages.mjs > peages-data.js
//   Les adresses changent parfois : vérifier SOURCES (data.gouv.fr et la page « tarifs de péage » de VINCI Autoroutes).
//   Ou : node outils/peages.mjs dossier > peages-data.js, le dossier contenant aprr.csv, area.csv, gares.csv,
//   asf.txt, escota.txt et cofiroute.txt.
import { readFileSync } from 'node:fs';

const VINCI = 'https://public-content.vinci-autoroutes.com/PDF';
const SOURCES = {
  aprr: 'https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv',
  area: 'https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131936/2026-02.csv',
  gares: 'https://static.data.gouv.fr/resources/gares-de-peage-du-reseau-routier-national-concede/20250728-140859/gares-peage-2025.csv',
  asf: `${VINCI}/Tarifs-peage-asf/Tarifs_ASF.txt`,
  escota: `${VINCI}/Tarifs-peage-Escota/Tarifs_ESCOTA.txt`,
  cofiroute: `${VINCI}/Tarifs-peage-Cofiroute/Tarifs_Cofiroute_Arcour.txt`
};
const EXT = { aprr: 'csv', area: 'csv', gares: 'csv', asf: 'txt', escota: 'txt', cofiroute: 'txt' };
const ANNEE = 2026, MIN_KM = 15, MIN_COUPLES = 5;
// Sanef et SAPN : grilles PDF illisibles automatiquement. Estimation grossière, relevée à la main sur de longs trajets
// des grilles au 1er février 2026, distance à vol d'oiseau entre les villes × 1,12. À revoir chaque année.
const ESTIMATIONS = {
  A1: 0.10,     // Sanef : pas de long trajet lisible, médiane Sanef
  A2: 0.10,     // Sanef : idem
  A4: 0.099,    // Paris (péage de Coutevroult) → Metz : 29,50 € pour ~298 km
  A13: 0.088,   // Caen → Chaufour : 15,00 € pour ~171 km
  A14: 0.54,    // péage de Montesson : 10,80 € (6,60 € en heures creuses) pour ~20 km payants
  A16: 0.122,   // Boulogne (péage d'Herquelingue) → Beauvais Nord : 20,10 € pour ~165 km
  A26: 0.098,   // Calais (péage de Setques) → Reims (péage de Courcy) : 26,60 € pour ~271 km
  A29: 0.10     // Le Havre → Saint-Saëns : 9,50 € pour ~95 km
};

// Autoroutes gratuites hormis un ouvrage (compté à part dans ouvrages.js) : jamais de tarif au km.
const GRATUITES = new Set(['A75']);

const dossier = process.argv[2];
async function lire(nom) {
  if (dossier) return readFileSync(`${dossier}/${nom}.${EXT[nom]}`, 'utf8');
  for (let essai = 1; ; essai++) {
    try { const r = await fetch(SOURCES[nom]); if (r.ok) return await r.text(); throw new Error(`HTTP ${r.status}`); }
    catch (e) { if (essai >= 5) throw new Error(`${nom} : ${e.message}`); await new Promise(ok => setTimeout(ok, 3000)); }
  }
}
function csv(texte, sep) {
  const [tete, ...lignes] = texte.replace(/^﻿/, '').trim().split(/\r?\n/).map(l => l.split(sep));
  return lignes.map(l => Object.fromEntries(tete.map((c, i) => [c.trim(), (l[i] || '').trim()])));
}
const nombre = s => parseFloat(String(s).replace(',', '.'));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/N[°O]\s*\d+/g, '').replace(/S\//g, 'SUR').replace(/\bSTE?-/g, m => (m.startsWith('STE') ? 'SAINTE' : 'SAINT'))
  .replace(/[^A-Z0-9]/g, '');

// Gares du référentiel : nom → [{autoroute, x, y}]. Code route : département (2) + « A9 » + numéro sur 3 chiffres.
const gares = new Map();
for (const g of csv(await lire('gares'), ';')) {
  if (g.route?.slice(2, 4) !== 'A9') continue;
  const k = norm(g.nomGare);
  if (!gares.has(k)) gares.set(k, []);
  gares.get(k).push({ a: 'A' + parseInt(g.route.slice(4, 7), 10), x: nombre(g.x), y: nombre(g.y) });
}
// Gares correspondant à un nom de grille (« BEAUNE » ↔ « Beaune Nord » et « Beaune Sud »), sur une autoroute donnée ou non.
function trouver(nom, a) {
  const n = norm(nom), out = [];
  if (n.length < 3) return out;
  for (const [k, v] of gares) {
    if (k === n || (k.startsWith(n) && n.length >= 4) || (n.startsWith(k) && k.length >= 5)) out.push(...v.filter(g => !a || g.a === a));
  }
  return out;
}
const autoroutes = nom => new Set(trouver(nom).map(g => g.a));
const position = (nom, a) => { const g = trouver(nom, a); return g.length ? [g.reduce((s, p) => s + p.x, 0) / g.length, g.reduce((s, p) => s + p.y, 0) / g.length] : null; };
const vol = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) / 1000;   // Lambert 93 : en mètres
const mediane = v => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const taux = new Map(), societes = new Map();   // autoroute → [€/km] ; société → {autoroutes, taux}
const noter = (soc, a, t) => {
  if (!taux.has(a)) taux.set(a, []);
  taux.get(a).push(t);
  if (!societes.has(soc)) societes.set(soc, { autoroutes: new Set(), taux: [] });
  societes.get(soc).taux.push(t);
};
const declarer = (soc, a) => { if (!societes.has(soc)) societes.set(soc, { autoroutes: new Set(), taux: [] }); societes.get(soc).autoroutes.add(a); };

// 1. APRR et AREA : distance tarifaire connue. On en profite pour mesurer le facteur de détour.
const detours = [];
for (const [soc, ce, cs] of [['aprr', 'gare_entree', 'gare_sortie'], ['area', 'libelle_gare_entree', 'libelle_gare_sortie']]) {
  for (const r of csv(await lire(soc), ',')) {
    const km = nombre(r.distance_tarifaire_km), prix = nombre(r.tarif_classe_1);
    if (!(km >= MIN_KM) || !(prix > 0)) continue;
    const communes = [...autoroutes(r[ce])].filter(a => autoroutes(r[cs]).has(a));
    if (communes.length !== 1) continue;   // ambigu ou sur deux autoroutes : ignoré
    const a = communes[0];
    noter(soc, a, prix / km); declarer(soc, a);
    const p = position(r[ce], a), q = position(r[cs], a);
    if (p && q && vol(p, q) > 10) detours.push(km / vol(p, q));
  }
}
const DETOUR = mediane(detours);
console.error(`Facteur de détour (distance tarifaire ÷ vol d'oiseau, ${detours.length} couples APRR/AREA) : ${DETOUR.toFixed(3)}`);

// 2. Vinci : pas de distance, on l'estime à vol d'oiseau × facteur de détour.
for (const soc of ['asf', 'escota', 'cofiroute']) {
  for (const r of csv(await lire(soc), ';')) {
    const a = r.autoroute_entree, prix = nombre(r.classe1);
    if (!/^A\d+$/.test(a) || r.autoroute_sortie !== a || !(prix > 0)) continue;
    declarer(soc, a);   // la société exploite cette autoroute : un trajet y commence et y finit
    const p = position(r.nom_entree, a), q = position(r.nom_sortie, a);
    if (!p || !q) continue;
    const km = vol(p, q) * DETOUR;
    if (km >= MIN_KM) noter(soc, a, prix / km);
  }
}

// 3. Résultat : médiane mesurée, ou médiane de la société à défaut.
const resultat = new Map();
for (const [a, v] of taux) if (v.length >= MIN_COUPLES && !GRATUITES.has(a)) resultat.set(a, [+mediane(v).toFixed(3), v.length, 'mesuré']);
for (const [soc, s] of societes) {
  for (const a of s.autoroutes) if (!resultat.has(a) && !GRATUITES.has(a) && s.taux.length) resultat.set(a, [+mediane(s.taux).toFixed(3), 0, soc]);
}
for (const [a, t] of Object.entries(ESTIMATIONS)) if (!resultat.has(a)) resultat.set(a, [t, 0, 'estimé Sanef/SAPN']);
const liste = [...resultat].sort((x, y) => parseInt(x[0].slice(1), 10) - parseInt(y[0].slice(1), 10));
console.error(liste.map(([a, [t, n, o]]) => `${a} ${t} €/km (${o === 'mesuré' ? `${n} couples` : o.startsWith('estimé') ? o : `médiane ${o}`})`).join('\n'));
console.log(`// Fichier généré par outils/peages.mjs : ne pas modifier à la main.
// Tarif médian au kilomètre (voitures, classe 1) par autoroute, tarifs ${ANNEE}.
// Sources : data.gouv.fr (« Tarifs autoroutes APRR », Licence Ouverte 2.0 ; « Gares de péage du réseau routier
// national concédé », ODC-BY), tarifs internes publiés par VINCI Autoroutes (ASF, Escota, Cofiroute / Arcour)
// et, à la grosse, grilles Sanef et SAPN au 1er février ${ANNEE}.
export const TARIFS_ANNEE = ${ANNEE};
/** Autoroute → [€/km, nombre de couples mesurés (0 : médiane de la société), origine]. */
export const TARIFS_KM = {
${liste.map(([a, [t, n, o]]) => `  ${a}: [${t}, ${n}, '${o}']`).join(',\n')}
};`);
