// Interface : saisie, réglages, liste des trajets, carte schématique, exports.
import { DEF, USURE_DEF, usureParKm, analyse, dedupe, cost, along, domines, marche, escalier, choixLimite, LIMITE_DEF, auDessusLigne } from './cost.js';
import { PROFILES, DELAI_VALHALLA, geocode, route, suggest } from './routing.js';
import { candidats, reglagesMixte, joindre } from './mixtes.js';
import { villesTraversees, villesEtapes } from './villes.js';
import { planExploration, coutPlan, produit, assembler, cleMorceau } from './explore.js';
import { ouvragesTraverses } from './ouvrages.js';
import { TARIFS_KM } from './peages-data.js';
import { prixDuJour } from './carburant.js';

// Réglages Valhalla des deux moitiés d'un trajet mixte.
const RAPIDE = { auto: { use_tolls: 1, use_highways: 1 } };
const LIBRE = { auto: { use_tolls: 0, use_highways: 0 } };

/** Version affichée en haut de la page : à augmenter à chaque modification publiée. */
export const VERSION = '1.15.0';
export const VERSION_DATE = '25/11/2026';

const $ = id => document.getElementById(id);
$('ver').textContent = `v${VERSION} · ${VERSION_DATE}`;
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#6250d6', '#e34948'];
const FUEL_DEF = { 'SP95-E10': 2.05, 'Gazole': 2.20 };
const OLD_KEY = 'vpt-set2', PKEY = 'rr-profils', CKEY = 'rr-reglages';
const KEYS = Object.keys(DEF).filter(k => k !== 'vh');   // champs du formulaire (la valeur de l'heure n'en est plus un)
const PROF_KEYS = ['usure', 'cville', 'croute', 'cauto'];   // propres à chaque voiture
const CRIT_KEYS = ['peage'];                                 // propres à l'utilisateur
let prices = {};               // prix du litre par carburant, partagé entre les voitures
let profils = null;            // {list: [{id, nom, carbu, usure, cville, croute, cauto, wiz}], actif}
let choix = { from: null, to: null };   // lieux choisis dans les suggestions
const suggTimer = {};                   // délais de frappe en cours, par champ
let routes = [], ends = null, hot = -1, voirDomines = false;
let trouves = [];                 // tous les trajets calculés pour la recherche en cours
let expl = { etat: 'aucun' };     // exploration approfondie : aucun, pret, encours, fini
let rech = { etat: 'aucune' };    // recherche normale : aucune, encours (libelle, fait, total), fini (sec, echecs)
let derniersNeufs = 0;            // trajets de l'exploration dans l'escalier, au dernier affichage
let dejaFete = 0;                 // nombre de trouvailles déjà fêtées (une montagne de billets par nouvelle trouvaille)
let limite = LIMITE_DEF;   // temps en plus accepté (minutes), Infinity : peu importe

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
};
const num = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) && v >= 0 ? v : DEF[id]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtT = min => { const m = Math.round(min), h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${String(r).padStart(2, '0')}` : `${r} min`; };
const fmtE = e => `${Math.round(e)} €`;

function settings() { const s = { vh: DEF.vh }; for (const k of KEYS) s[k] = num(k); return s; }
const actif = () => profils.list.find(p => p.id === profils.actif) || profils.list[0];

/** Recopie les champs dans le profil actif et les critères, puis mémorise. */
function save() {
  const s = settings(), p = actif();
  for (const k of PROF_KEYS) p[k] = s[k];
  p.carbu = $('carbu').value;
  if (!$('prixauto').checked) prices[p.carbu] = s.prix;   // le prix du jour ne remplace pas ton prix manuel
  store.set(PKEY, profils);
  store.set(CKEY, { peage: s.peage, limite: isFinite(limite) ? limite : null, prices, prixAuto: $('prixauto').checked });
  const fr = n => String(n).replace('.', ',');
  $('sum').textContent = `${p.nom} · ${fr(s.prix)} €/L · ${fr(Math.round(s.usure * 1000) / 10)} c€/km`;
}

function gmaps(r) {
  const ll = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  // Trajet mixte : le point de bascule devient l'étape du milieu, encadrée par un point de chaque moitié.
  let etapes;
  if (r.mixte) { const f = r.mixte.kmVia / r.km; etapes = [along(r.pts, [f / 2])[0], r.mixte.via, along(r.pts, [f + (1 - f) / 2])[0]]; }
  else etapes = along(r.pts, [0.25, 0.5, 0.75]);
  const w = etapes.map(ll).join('|');
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${ll(r.pts[0])}&destination=${ll(r.pts[r.pts.length - 1])}&waypoints=${encodeURIComponent(w)}`;
}

function gpx(r, i) {
  const pts = r.pts.map(p => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('');
  const name = `${ends.a.name} - ${ends.b.name} (trajet ${i + 1})`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="radin-routier" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
  a.download = `trajet-${i + 1}.gpx`; document.body.appendChild(a); a.click(); a.remove();
}

const fmtEur = v => `${v.toFixed(2).replace('.', ',')} €`;

function render() {
  save();
  if (!routes.length) return;
  const s = settings();
  const auj = new Date();
  for (const r of routes) if (!r.ouvrages) r.ouvrages = ouvragesTraverses(r, auj);   // ponts et tunnels : prix fixe, calculé une fois
  const rows = routes.map((r, i) => ({ r, i, c: cost(r, s) }));
  const items = rows.map(x => ({ min: x.r.min, eur: x.c.eur }));
  const dom = domines(items), garde = new Set(escalier(items));
  rows.forEach((x, j) => { x.domine = dom.has(j); x.dom = !garde.has(j); });   // x.dom : replié sous « autres trajets »
  domMap = new Set(rows.filter(x => x.dom).map(x => x.i));
  // L'escalier : du plus rapide au moins cher, chaque marche faisant gagner au moins 12 % (voir cost.js escalier).
  const utiles = rows.filter(x => !x.dom).sort((a, b) => a.r.min - b.r.min);
  const tousAutres = rows.filter(x => x.dom).sort((a, b) => a.r.min - b.r.min);
  const avant = x => [...utiles].reverse().find(u => u.r.min <= x.r.min) || utiles[0];   // trajet de l'escalier juste avant
  // Plus cher que le plus rapide : on y perd du temps ET de l'argent. Masqués (liste et carte), seulement comptés.
  const prixRapide = utiles[0].c.eur;
  // Sans intérêt (plus cher que le plus rapide, ou plus lent ET plus cher qu'un autre) : masqués, en pointillés sur la carte.
  // Seuls restent dans le pli les trajets écartés de peu (marche de moins de 12 %), utiles à analyser.
  // Aussi : moins de 1 € gagné pour plus de 5 min perdues par rapport au trajet de l'escalier juste plus rapide.
  const derisoire = x => { const ref = [...utiles].reverse().find(u => u.r.min <= x.r.min); return ref && ref.c.eur - x.c.eur < 1 && x.r.min - ref.r.min > 5; };
  // Et un trajet qui dure presque autant (moins de 2 min d'écart) qu'un trajet de l'escalier moins cher.
  const doublon = x => utiles.some(u => Math.abs(u.r.min - x.r.min) < 2 && u.c.eur <= x.c.eur);
  // Et une variante au-dessus de la ligne qui relie ses deux voisins de l'escalier (temps → prix) :
  // elle est moins bonne que l'un ou l'autre, quelle que soit la valeur qu'on donne au temps.
  const pt = y => y && { min: y.r.min, eur: y.c.eur };
  const auDessus = x => { const p = avant(x); return auDessusLigne(pt(p), pt(utiles[utiles.indexOf(p) + 1]), pt(x)); };
  const plusChers = tousAutres.filter(x => x.c.eur >= prixRapide || x.domine || derisoire(x) || doublon(x) || auDessus(x)), autres = tousAutres.filter(x => !plusChers.includes(x));
  masques = new Set(plusChers.map(x => x.i));
  // Ton choix : le moins cher dans ta limite de temps ; à considérer : un peu au-delà (voir cost.js choixLimite).
  const cl = choixLimite(utiles.map(x => ({ min: x.r.min, eur: x.c.eur })), limite);
  const best = utiles[cl.choix], sugg = cl.suggestion >= 0 ? utiles[cl.suggestion] : null, t0 = utiles[0].r.min;
  for (const b of document.querySelectorAll('#lim button')) b.setAttribute('aria-pressed', String(b.dataset.l === (isFinite(limite) ? String(limite) : 'inf')));
  const ordre = [...utiles, ...autres, ...plusChers];
  const num = new Map(ordre.map((x, k) => [x.i, k + 1]));

  const carte = ({ r, i, c, dom: estDomine, domine }) => {
    const star = (best.i === i ? '<span class="bdg star">⭐ Ton choix</span>' : sugg && sugg.i === i ? '<span class="bdg idee">💡 À considérer</span>' : '')
      + (r.explore ? '<span class="bdg neuf">🆕 Exploration</span>' : '');
    let note = '';
    if (domine) {
      const meilleur = utiles.find(u => u.r.min <= r.min && u.c.eur <= c.eur) || rows.find(u => !u.domine && u.r.min <= r.min && u.c.eur <= c.eur);
      note = `<p class="note">Plus lent et plus cher que le trajet ${num.get(meilleur.i)}.</p>`;
    } else if (estDomine) {
      // Variante intermédiaire, affichée sous le trajet de l'escalier qui la précède ; comparée au plus proche
      // en durée des deux trajets qui l'encadrent.
      const prec = avant({ r }), suiv = utiles[utiles.indexOf(prec) + 1];
      if (suiv && suiv.r.min - r.min < r.min - prec.r.min) {
        note = `<p class="note">${fmtT(suiv.r.min - r.min)} plus rapide que le trajet ${num.get(suiv.i)}, mais ${fmtE(c.eur - suiv.c.eur)} plus cher.</p>`;
      } else {
        const de = prec.c.eur - c.eur;
        note = `<p class="note">${fmtT(r.min - prec.r.min)} de plus que le trajet ${num.get(prec.i)}, pour ${de < 0.5 ? 'à peine moins cher' : `seulement ${fmtE(de)} de moins`}.</p>`;
      }
    }
    if (!r.villes) r.villes = villesTraversees(r.pts);   // calculé une fois par trajet
    const via = r.villes.length ? `<span class="via">par ${r.villes.map(esc).join(' · ')}</span>` : '';
    const refs = r.refs.slice(0, 4).map(x => `<span class="c${x[0] === 'D' ? ' cD' : ''}">${esc(x)}</span>`).join('');
    const payants = r.ouvrages.filter(o => !o.gratuit);
    const dont = payants.map(o => `dont ${esc(o.nom)} ${fmtEur(o.prix)}${o.verifier ? ' <span title="sources en désaccord">⚠️ à vérifier</span>' : ''}`).join(', ');
    const gratuits = r.ouvrages.filter(o => o.gratuit).map(o => `${esc(o.nom)} gratuit dans ce sens`).join(', ');
    // Tarif réel (grilles officielles) ou estimé à la main (Sanef, SAPN), voir outils/peages.mjs.
    const estime = a => String(TARIFS_KM[a]?.[2] || '').startsWith('estimé');
    const reels = c.tarifsReels.filter(a => !estime(a)), estimes = c.tarifsReels.filter(estime);
    const precis = [dont, reels.length ? `tarif réel ${reels.join(', ')}` : '', estimes.length ? `tarif estimé ${estimes.join(', ')}` : ''].filter(Boolean).join(' ; ');
    const peage = c.toll >= 0.5 ? `péage ${fmtE(c.toll)} <small>(${precis || `~${Math.round(r.tollKm)} km au tarif estimé`})</small>` : 'sans péage';
    const notePeage = gratuits ? `<p>${gratuits}</p>` : '';
    return `<li class="row${hot === i ? ' on' : ''}${estDomine ? ' dom' : ''}" data-i="${i}" style="--rc:${COLORS[i % COLORS.length]}"${estDomine && !voirDomines ? ' hidden' : ''}>
<div class="r1"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span><strong>Trajet ${num.get(i)}</strong><span class="te"><span class="nw">${fmtT(r.min)}</span> · <span class="nw">${fmtE(c.eur)}</span></span>${star}</div>
<div class="refs">${via}${refs}</div>${note}
<div class="act"><a class="btn" href="${gmaps(r)}" target="_blank" rel="noopener">Google Maps ↗</a>
<details class="dt"><summary>Détail</summary>
${r.mixte ? `<p class="mx">🔀 ${esc(r.mixte.texte)}</p>` : ''}<p><span class="nw">carburant ${fmtE(c.fuel)}</span> + <span class="nw">usure ${fmtE(c.wear)}</span> + <span class="nw">${peage}</span> = <b>${fmtE(c.eur)}</b></p>${notePeage}
<p><span class="nw">${Math.round(r.km)} km :</span> <span class="nw">autoroute ${Math.round(r.hwKm)}</span> · <span class="nw">route ${Math.round(r.routeKm)}</span> · <span class="nw">ville ${Math.round(r.villeKm)}</span></p>
<button type="button" class="btn" data-gpx="${i}">Télécharger le GPX</button>
</details></div>
</li>`;
  };

  // Une marche entre deux trajets successifs de l'escalier, colorée selon ta limite de temps.
  const pas = (haut, bas) => {
    const m = marche({ min: haut.r.min, eur: haut.c.eur }, { min: bas.r.min, eur: bas.c.eur }, 0);
    const plus = bas.r.min - t0;
    const [cls, mot] = plus <= limite ? ['y', '✅ dans ta limite'] : sugg && bas.r.min <= sugg.r.min ? ['m', '💡 un peu au-delà'] : ['n', '⏳ au-delà de ta limite'];
    const temps = m.dt > 0.5 ? `+${fmtT(m.dt)}` : 'même durée';
    const taux = isFinite(m.parMin) ? `${fmtEur(m.parMin)} par minute en plus` : 'sans perdre de temps';
    return `<li class="step ${cls}" aria-label="Du trajet ${num.get(haut.i)} au trajet ${num.get(bas.i)}">
<span class="arr" aria-hidden="true">▼</span><span class="sd"><b>${temps}</b> · <b>−${fmtE(m.de)}</b></span><span class="sr">${taux} · ${mot}</span></li>`;
  };

  let html = '';
  // L'escalier, avec les variantes intermédiaires en retrait sous le trajet qu'elles suivent (si dépliées).
  const nDom = autres.length;
  if (nDom) html += `<li class="more"><button type="button" id="vdom" aria-expanded="${voirDomines}">${voirDomines ? 'Masquer' : 'Voir'} ${nDom > 1 ? `les ${nDom} variantes intermédiaires` : 'la variante intermédiaire'} <small>(quelques euros de moins seulement, affichée${nDom > 1 ? 's' : ''} en retrait à ${nDom > 1 ? 'leur' : 'sa'} place)</small></button></li>`;
  // Une variante proche du trajet suivant s'affiche juste au-dessus de lui ; sinon, juste sous le précédent.
  const versSuivant = v => { const p = avant(v), n = utiles[utiles.indexOf(p) + 1]; return !!n && n.r.min - v.r.min < v.r.min - p.r.min; };
  utiles.forEach((x, k) => {
    if (k) {
      html += pas(utiles[k - 1], x);
      html += autres.filter(v => avant(v) === utiles[k - 1] && versSuivant(v)).map(carte).join('');
    }
    html += carte(x);
    html += autres.filter(v => avant(v) === x && !versSuivant(v)).map(carte).join('');
  });
  // Bandeau : temps perdu, puis argent gagné, puis le trajet concerné (touchable pour le sélectionner).
  const rapide = utiles[0], lim = isFinite(limite) ? (limite ? fmtT(limite) : '') : '';
  const lien = x => `<button type="button" class="vers" data-sel="${x.i}">→ Trajet ${num.get(x.i)} : ${fmtT(x.r.min)} · ${fmtE(x.c.eur)}${x.r.villes && x.r.villes.length ? `, par ${x.r.villes.map(esc).join(' · ')}` : ''}</button>`;
  let bandeau = best === rapide
    ? `<p>⭐ <b>Le plus rapide est ton meilleur choix</b>${lim ? ` : en acceptant de perdre ${lim}, aucun trajet ne te fait gagner d'argent.` : '.'}</p>${lien(rapide)}`
    : `<p>⭐ <b>En acceptant de perdre ${fmtT(best.r.min - t0)}, tu gagnes ${fmtE(rapide.c.eur - best.c.eur)} !</b></p>${lien(best)}`;
  if (sugg) bandeau += `<p>💡 <b>En perdant ${fmtT(sugg.r.min - best.r.min)} de plus, tu pourrais gagner encore ${fmtE(best.c.eur - sugg.c.eur)} !</b></p>${lien(sugg)}`;
  // Trouvaille de l'exploration : mise en avant (et montagne de billets la première fois).
  const neufs = utiles.filter(x => x.r.explore);
  derniersNeufs = neufs.length;
  if (neufs.length) {
    const top = [best, sugg].find(x => x && x.r.explore) || neufs.reduce((p, q) => q.c.eur < p.c.eur ? q : p);
    const role = top === best ? ' Et c\'est ton meilleur choix ! 🏆' : top === sugg ? ' C\'est même celui à considérer 💡' : '';
    bandeau = `<p class="trouve">🆕 <b>L'exploration a déniché ${neufs.length > 1 ? `${neufs.length} trajets` : 'un trajet'} que personne ne voyait !</b>${role}</p>${lien(top)}` + bandeau;
    if (neufs.length > dejaFete) { dejaFete = neufs.length; pluieDeBillets(); }
  }
  $('list').innerHTML = `<li class="choix${neufs.length ? ' bravo' : ''}">${bandeau}<p class="nb">${routes.length} trajets comparés : ${utiles.length} dans l'escalier${autres.length ? `, ${autres.length} variante${autres.length > 1 ? 's' : ''} intermédiaire${autres.length > 1 ? 's' : ''}` : ''}${plusChers.length ? `, ${plusChers.length} sans intérêt (en pointillés sur la carte)` : ''}.</p>${blocAvancement(neufs.length)}</li>` + html;
  draw();
}

// ---------- Carte : fond OpenStreetMap (Leaflet, copié dans vendor/leaflet) ----------
let domMap = new Set();
let masques = new Set();   // trajets sans intérêt : hors de la liste, en pointillés sur la carte
let carte = null, calque = null, cadrage = '';
const TUILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';   // conditions : attribution visible, usage modéré

function creerCarte() {
  carte = L.map('carte', { scrollWheelZoom: false, zoomSnap: 0.25 });
  L.tileLayer(TUILES, { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>' }).addTo(carte);
  calque = L.layerGroup().addTo(carte);
  carte.on('click', () => { if (hot !== -1) { hot = -1; render(); } });   // toucher le fond désélectionne
  new ResizeObserver(() => carte.invalidateSize()).observe($('carte'));
}

// Tracé allégé (800 points au plus) : bien assez pour l'écran, et plus fluide sur téléphone.
const allege = pts => { const step = Math.max(1, Math.ceil(pts.length / 800)); return pts.filter((_, j) => j % step === 0 || j === pts.length - 1); };

function draw() {
  if (!routes.length || typeof L === 'undefined') return;
  if (!carte) creerCarte();
  calque.clearLayers();
  // Trajets sans intérêt : fins pointillés gris, dessous, pour montrer tout ce qui a été exploré.
  for (const i of masques) L.polyline(allege(routes[i].pts), { color: '#7a808c', weight: 2, dashArray: '4 6', opacity: 0.7, interactive: false }).addTo(calque);
  const order = routes.map((_, i) => i).filter(i => !masques.has(i)).sort((a, b) => (a === hot) - (b === hot));
  for (const i of order) {
    const pts = allege(routes[i].pts), on = hot === i || (hot === -1 && !(domMap.has(i) && !voirDomines));
    if (hot === i) L.polyline(pts, { color: '#ffffff', weight: 10, opacity: 0.9, interactive: false }).addTo(calque);   // liseré blanc
    L.polyline(pts, { color: COLORS[i % COLORS.length], weight: hot === i ? 6 : 4, opacity: on ? 0.95 : 0.25, interactive: false, lineJoin: 'round' }).addTo(calque);
    // Un trait large et invisible par-dessus, pour toucher facilement le tracé au doigt.
    if (!(domMap.has(i) && !voirDomines)) {
      L.polyline(pts, { color: '#000', weight: 22, opacity: 0, className: 'touche' })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); choisirSurCarte(i); }).addTo(calque);
    }
  }
  const A = routes[0].pts[0], B = routes[0].pts.at(-1);
  for (const [p, nom] of [[A, ends.a.name], [B, ends.b.name]]) {
    L.circleMarker(p, { radius: 7, color: '#ffffff', weight: 3, fillColor: '#14181f', fillOpacity: 1, interactive: false })
      .bindTooltip(esc(nom), { permanent: true, direction: 'top', offset: [0, -8], className: 'etiquette' }).addTo(calque);
  }
  // On recadre quand de nouveaux trajets élargissent la zone, pas à chaque sélection (pour garder ton zoom).
  const tous = L.latLngBounds(routes.flatMap(r => [r.pts[0], r.pts.at(-1), ...allege(r.pts).filter((_, j) => j % 20 === 0)]));
  const cle = tous.toBBoxString();
  if (cle !== cadrage) { cadrage = cle; carte.fitBounds(tous, { padding: [24, 24] }); }
}

function choisirSurCarte(i) {
  hot = i; render();
  const li = document.querySelector(`#list .row[data-i="${hot}"]`);
  if (li) li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

// Montagne de billets : ils tombent du haut de l'écran et s'empilent en pyramide, puis s'effacent.
export function pluieDeBillets() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fete = document.createElement('div');
  fete.className = 'fete'; fete.setAttribute('aria-hidden', 'true');
  let html = '', k = 0;
  for (let rang = 0; rang < 7; rang++) {            // 7 rangées : 7 billets en bas, 1 au sommet
    const n = 7 - rang;
    for (let j = 0; j < n; j++, k++) {
      const x = (j - (n - 1) / 2) * 30, y = -rang * 20;
      html += `<span style="--x:${x}px;--y:${y}px;--r:${Math.round(Math.random() * 360)}deg;--r2:${Math.round(Math.random() * 30 - 15)}deg;--d:${(k * 0.06).toFixed(2)}s">${k % 3 ? '💶' : '💸'}</span>`;
    }
  }
  fete.innerHTML = html + '<b>Ka-ching !</b>';
  document.body.appendChild(fete);
  setTimeout(() => fete.classList.add('fin'), 3200);
  setTimeout(() => fete.remove(), 3900);
}

// ---------- Exploration approfondie (bouton « Explorer encore ») ----------
// Avancement de la recherche puis de l'exploration : un seul bloc, en bas de la synthèse, avec barre.
const barre = (pc, txt, bouton = '') => `<div class="avance"><p>${txt}</p><div class="barre"><span style="width:${pc}%"></span></div>${bouton}</div>`;
function blocAvancement(nouveaux = derniersNeufs) {
  let h = '';
  if (rech.etat === 'encours') {
    const pc = Math.min(99, Math.round(100 * rech.fait / Math.max(1, rech.total)));
    h = barre(pc, `🔍 ${rech.libelle} <span class="pc">${pc} %</span>`);
  } else if (expl.etat === 'encours') {
    const pc = Math.round(100 * expl.fait / Math.max(1, expl.total));
    h = barre(pc, `🔍 Exploration : ${expl.testes} trajets testés${nouveaux ? ` · <b>${nouveaux} nouveau${nouveaux > 1 ? 'x' : ''} 🆕</b>` : ''} <span class="pc">${pc} %</span>`, '<button type="button" id="stopx">Arrêter</button>');
  } else if (rech.etat === 'fini') {
    const fin = `✅ Recherche terminée en ${rech.sec} s${rech.echecs ? ` (${rech.echecs} calcul${rech.echecs > 1 ? 's' : ''} en échec)` : ''}.`;
    if (expl.etat === 'fini') {
      h = `<p>${nouveaux ? `✅ Exploration terminée : <b>${nouveaux} nouveau${nouveaux > 1 ? 'x' : ''} trajet${nouveaux > 1 ? 's' : ''} 🆕</b>` : '✅ Exploration terminée : rien de mieux à trouver'}, ${expl.testes} trajets de plus testés${expl.stop ? ' (arrêtée avant la fin)' : ''}.</p>`;
    } else {
      const n = expl.etat === 'pret' ? coutPlan(planExploration(trouves, ends.a, ends.b)) : 0;
      h = `<p>${fin}</p>` + (n ? `<button type="button" id="explo">🔍 Explorer encore <small>(≈ ${String(Math.max(0.5, Math.round(n * 1.5 / 30) / 2)).replace('.', ',')} min, ${n} calculs de plus)</small></button>` : '');
    }
  }
  return `<div id="avancement">${h}</div>`;
}
function majAvancement() { const el = $('avancement'); if (el) el.outerHTML = blocAvancement(); }

async function explorer() {
  const moi = expl = { etat: 'encours', fait: 0, testes: 0, total: 0, stop: false };
  const plan = planExploration(trouves, ends.a, ends.b);
  moi.total = coutPlan(plan);
  const cache = new Map();
  const morceau = async (de, vers, prof) => {
    const k = cleMorceau(de, vers, prof);
    if (!cache.has(k)) {
      await sleep(DELAI_VALHALLA);
      let res = [];
      try { res = (await route(de, vers, prof)).map(analyse); } catch (err) { /* morceau impossible : ignoré */ }
      cache.set(k, res); moi.fait++; majAvancement();
    }
    return cache.get(k);
  };
  render();
  for (const comb of plan) {
    if (moi.stop || expl !== moi) break;
    const listes = [];
    for (const m of comb.morceaux) { listes.push(await morceau(...m)); if (moi.stop || expl !== moi) break; }
    if (moi.stop || expl !== moi) break;
    for (const parts of produit(listes)) { trouves.push(assembler(parts, comb)); moi.testes++; }
    routes = dedupe(trouves).sort((x, y) => x.min - y.min);
    render();
  }
  if (expl === moi) { moi.etat = 'fini'; render(); }
}

const HORS_LIGNE = 'hors ligne';

async function run(e) {
  e.preventDefault();
  const st = $('st'), go = $('go'); st.className = ''; go.disabled = true;
  clearTimeout(suggTimer.from); clearTimeout(suggTimer.to);
  for (const u of document.querySelectorAll('.sugg')) u.hidden = true;
  const t0 = performance.now();
  if (document.activeElement) document.activeElement.blur();   // referme le clavier du téléphone
  let defile = false;
  try {
    if (!navigator.onLine) throw new Error(HORS_LIGNE);
    st.textContent = 'Recherche des adresses…';
    const a = await lieuDe('from'); await sleep(300);
    const b = await lieuDe('to');
    if ($('prixauto').checked) majPrixDuJour(a);   // en parallèle des itinéraires
    choix = { from: a, to: b };
    store.set('vpt-od', { from: $('from').value, to: $('to').value, cfrom: a, cto: b });
    ends = { a, b }; hot = -1; routes = [];
    if (expl.etat === 'encours') expl.stop = true;   // une nouvelle recherche arrête l'exploration en cours
    expl = { etat: 'aucun' }; dejaFete = 0;
    rech = { etat: 'encours', libelle: 'Calcul des itinéraires…', fait: 0, total: PROFILES.length + 8 + 6 };   // total affiné en route
    const found = []; let fails = 0;
    trouves = found;
    const calcul = async (...args) => { try { return await route(...args); } finally { rech.fait++; majAvancement(); } };
    for (let p = 0; p < PROFILES.length; p++) {
      rech.libelle = `Calcul des itinéraires ${p + 1}/${PROFILES.length}…`; majAvancement();
      try {
        found.push(...(await calcul(a, b, PROFILES[p])).map(analyse));
        if (!st.classList.contains('err')) st.textContent = '';   // l'avancement passe dans la synthèse
        // Affichage au fil de l'eau : la liste se remplit dès la première réponse.
        routes = dedupe(found).sort((x, y) => x.min - y.min);
        $('res').hidden = false; $('lim').hidden = false; render();
        // Aux premiers trajets, on fait défiler jusqu'à la carte (avec la progression juste au-dessus).
        if (!defile) {
          defile = true;
          $('st').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        }
      } catch (err) { fails++; }
      if (p < PROFILES.length - 1) await sleep(DELAI_VALHALLA);
    }
    if (!found.length) throw new Error('le serveur d\'itinéraires n\'a rien renvoyé (connexion coupée, ou serveur saturé : réessaie dans une minute)');

    // Phase 2 : trajets mixtes, là où un trajet sans autoroute rejoint (ou quitte) un trajet par autoroute.
    const pts = candidats(dedupe(found));
    rech.total = rech.fait + 2 * pts.length + 6;
    for (let k = 0; k < pts.length; k++) {
      rech.libelle = `Recherche de trajets mixtes ${k + 1}/${pts.length}…`; majAvancement();
      const c = pts[k], P = { lat: c.p[0], lon: c.p[1] }, [r1, r2] = reglagesMixte(c.sens, RAPIDE, LIBRE);
      try {
        await sleep(DELAI_VALHALLA); const m1 = analyse((await calcul(a, P, r1))[0]);
        await sleep(DELAI_VALHALLA); const m2 = analyse((await calcul(P, b, r2))[0]);
        found.push(joindre(m1, m2, c));
        routes = dedupe(found).sort((x, y) => x.min - y.min);
        render();
      } catch (err) { /* un point de bascule raté n'empêche pas les autres */ }
    }

    // Phase 3 : couper le trajet à une grande ville traversée. Sur le premier morceau, plus court,
    // le serveur propose des variantes qu'il ignore sur le trajet complet ; on finit par le plus rapide.
    const etapes = villesEtapes(dedupe(found));
    rech.total = rech.fait + 3 * etapes.length;
    for (let k = 0; k < etapes.length; k++) {
      const v = etapes[k], V = { lat: v.lat, lon: v.lon };
      rech.libelle = `Recherche par étapes (${v.nom}) ${k + 1}/${etapes.length}…`; majAvancement();
      try {
        const debuts = [];
        for (const p of [PROFILES[0], PROFILES[4]]) {   // rapide avec variantes, puis péage modéré
          await sleep(DELAI_VALHALLA); debuts.push(...(await calcul(a, V, p)).map(analyse));
        }
        await sleep(DELAI_VALHALLA); const fin = analyse((await calcul(V, b, RAPIDE))[0]);
        for (const d of dedupe(debuts)) found.push(joindre(d, fin, { sens: 'etape', p: [v.lat, v.lon], texte: `Variante jusqu'à ${v.nom}, puis le plus rapide` }));
        routes = dedupe(found).sort((x, y) => x.min - y.min);
        render();
      } catch (err) { /* une étape ratée n'empêche pas les autres */ }
    }
    const sec = Math.round((performance.now() - t0) / 1000);
    rech = { etat: 'fini', sec, echecs: fails };
    expl = { etat: 'pret' }; render();
  } catch (err) {
    rech = { etat: 'aucune' }; majAvancement();
    st.className = 'err';
    st.textContent = !navigator.onLine || (err && err.message === HORS_LIGNE)
      ? '📵 Pas de connexion : Radin routier a besoin d\'internet pour calculer les trajets.'
      : 'Oups : ' + (err && err.message ? err.message : 'erreur réseau') + '.';
  } finally { go.disabled = false; }
}

// ---------- Profils véhicule ----------
const nouveauProfil = (nom, base = {}) => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nom, carbu: 'SP95-E10',
  usure: DEF.usure, cville: DEF.cville, croute: DEF.croute, cauto: DEF.cauto,
  wiz: structuredClone(USURE_DEF), ...base
});

function chargerReglages() {
  const c = store.get(CKEY), old = store.get(OLD_KEY);
  profils = store.get(PKEY);
  if (!profils || !Array.isArray(profils.list) || !profils.list.length) {
    // Reprise des réglages du prototype s'il y en a, sinon valeurs par défaut.
    const o = (old && old.s) || {}, base = {};
    for (const k of PROF_KEYS) if (o[k] != null) base[k] = o[k];
    if (old && old.fuel) base.carbu = old.fuel;
    const p = nouveauProfil('Compacte essence', base);
    profils = { list: [p], actif: p.id };
    $('regl').open = true;   // première visite : on montre les réglages
  }
  const crit = c || (old && old.s) || {};
  prices = (c && c.prices) || (old && old.prices) || {};
  for (const k of CRIT_KEYS) $(k).value = crit[k] != null ? crit[k] : DEF[k];
  if (+$('peage').value === 0.1) $('peage').value = DEF.peage;   // ancien défaut (0,10 €/km) : passe au nouveau
  limite = c && 'limite' in c ? (c.limite === null ? Infinity : c.limite) : LIMITE_DEF;
  $('prixauto').checked = !(c && c.prixAuto === false);   // prix du jour par défaut
  $('prix').disabled = $('prixauto').checked;
  afficherProfil();
}

const prixManuel = c => (prices[c] != null ? prices[c] : FUEL_DEF[c] != null ? FUEL_DEF[c] : DEF.prix);

/** Prix du jour (carburant.js) : autour du lieu `pos` s'il est donné, sinon moyenne nationale. */
let demandePrix = 0;
async function majPrixDuJour(pos) {
  const c = actif().carbu, moi = ++demandePrix;
  $('prixinfo').textContent = 'Recherche du prix du jour…';
  const r = await prixDuJour(c, pos);
  if (moi !== demandePrix || !$('prixauto').checked) return;   // une demande plus récente, ou mode manuel entre-temps
  if (!r) { $('prixinfo').textContent = 'Prix du jour indisponible : prix saisi utilisé.'; $('prix').disabled = false; return; }
  $('prix').value = r.prix; $('prix').disabled = true;
  const jour = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  $('prixinfo').textContent = `Moyenne de ${r.n.toLocaleString('fr-FR')} stations ${r.zone === 'local' && pos ? `autour ${/^[aeiouyhéèêâîô]/i.test(pos.name) ? 'd\'' : 'de '}${pos.name}` : 'en France'}, le ${jour}.`;
  render();
}

function afficherProfil() {
  const p = actif();
  profils.actif = p.id;
  $('prof').innerHTML = profils.list.map(x => `<option value="${esc(x.id)}">${esc(x.nom)}</option>`).join('');
  $('prof').value = p.id;
  $('pnom').value = p.nom;
  $('carbu').value = p.carbu;
  $('prixl').textContent = `Prix du ${p.carbu}`;
  $('prix').value = prixManuel(p.carbu);
  if ($('prixauto').checked) majPrixDuJour();
  for (const k of PROF_KEYS) $(k).value = p[k] != null ? p[k] : DEF[k];
  $('pdel').disabled = profils.list.length < 2;
  afficherAssistant();
  render();
}

$('prof').addEventListener('change', () => { profils.actif = $('prof').value; afficherProfil(); });
$('pnom').addEventListener('input', () => {
  actif().nom = $('pnom').value.trim() || 'Sans nom';
  $('prof').selectedOptions[0].textContent = actif().nom; save();
});
$('padd').addEventListener('click', () => {
  const p = nouveauProfil(`Voiture ${profils.list.length + 1}`);
  profils.list.push(p); profils.actif = p.id; afficherProfil();
  $('pnom').focus(); $('pnom').select();
});
$('pdel').addEventListener('click', () => {
  if (profils.list.length < 2 || !confirm(`Supprimer le profil « ${actif().nom} » ?`)) return;
  profils.list = profils.list.filter(p => p.id !== profils.actif);
  profils.actif = profils.list[0].id; afficherProfil();
});
$('carbu').addEventListener('change', () => {
  if (!$('prixauto').checked) prices[actif().carbu] = num('prix');
  const c = $('carbu').value; actif().carbu = c;
  $('prixl').textContent = `Prix du ${c}`;
  $('prix').value = prixManuel(c);
  if ($('prixauto').checked) majPrixDuJour(ends && ends.a);
  render();
});
$('prixauto').addEventListener('change', () => {
  if ($('prixauto').checked) majPrixDuJour(ends && ends.a);
  else { $('prix').value = prixManuel(actif().carbu); $('prixinfo').textContent = ''; }
  $('prix').disabled = $('prixauto').checked;
  render();
});
for (const k of KEYS) $(k).addEventListener('input', render);
$('lim').addEventListener('click', e => {
  const b = e.target.closest('button[data-l]'); if (!b) return;
  limite = b.dataset.l === 'inf' ? Infinity : +b.dataset.l; render();
});

// ---------- Assistant usure ----------
const cts = v => `${(v * 100).toFixed(2).replace('.', ',')} c€`;
function afficherAssistant() {
  const w = actif().wiz || (actif().wiz = structuredClone(USURE_DEF));
  $('wbody').innerHTML = w.postes.map((p, i) => `<tr>
<td>${esc(p.nom)}</td>
<td><input type="number" min="0" step="10" inputmode="numeric" data-w="${i}" data-f="prix" value="${p.prix}" aria-label="${esc(p.nom)} : prix en euros"></td>
<td><input type="number" min="0" step="1000" inputmode="numeric" data-w="${i}" data-f="km" value="${p.km}" aria-label="${esc(p.nom)} : durée de vie en km"></td>
<td data-out="${i}"></td></tr>`).join('');
  $('dva').value = w.decote.actuelle; $('dvf').value = w.decote.future; $('dkm').value = w.decote.km;
  $('rev').checked = w.revision.actif; $('rvp').value = w.revision.prix; $('rvk').value = w.revision.km;
  calculerAssistant();
}
function calculerAssistant() {
  const w = actif().wiz, u = usureParKm(w);
  u.postes.forEach((v, i) => { const td = document.querySelector(`[data-out="${i}"]`); if (td) td.textContent = (v * 100).toFixed(2).replace(".", ","); });
  $('dout').textContent = `${cts(u.decote)}/km`;
  $('revp').hidden = !w.revision.actif;
  $('wtot').textContent = `${cts(u.total)}/km`;
  return u.total;
}
const val = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : 0; };
$('wiz').addEventListener('input', e => {
  const w = actif().wiz, t = e.target;
  if (t.dataset.w != null) { const v = parseFloat(t.value); w.postes[+t.dataset.w][t.dataset.f] = isFinite(v) ? v : 0; }
  w.decote = { actuelle: val('dva'), future: val('dvf'), km: val('dkm') };
  w.revision = { actif: $('rev').checked, prix: val('rvp'), km: val('rvk') };
  calculerAssistant(); store.set(PKEY, profils);
});
$('wapp').addEventListener('click', () => {
  $('usure').value = Math.round(calculerAssistant() * 1000) / 1000;
  render();
  $('wapp').textContent = 'Appliqué ✓'; setTimeout(() => { $('wapp').textContent = 'Appliquer au profil'; }, 1500);
});

// ---------- Suggestions d'adresses ----------
function autocompletion(id) {
  const inp = $(id), ul = $(id + '-l');
  let items = [], sel = -1, timer = 0, ctrl = null;
  const fermer = () => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); sel = -1; };
  const surligner = i => {
    sel = i;
    [...ul.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) inp.setAttribute('aria-activedescendant', `${id}-o${i}`); else inp.removeAttribute('aria-activedescendant');
  };
  const choisir = i => { const l = items[i]; if (!l) return; choix[id] = l; inp.value = l.name; fermer(); };
  inp.addEventListener('input', () => {
    choix[id] = null; clearTimeout(timer); if (ctrl) ctrl.abort();
    if (inp.value.trim().length < 3) { fermer(); return; }
    timer = suggTimer[id] = setTimeout(async () => {
      ctrl = new AbortController();
      try { items = await suggest(inp.value, { signal: ctrl.signal }); } catch (e) { return; /* annulée ou hors ligne */ }
      if (!items.length || document.activeElement !== inp) { fermer(); return; }
      ul.innerHTML = items.map((l, i) => `<li role="option" id="${id}-o${i}" aria-selected="false" data-i="${i}">${esc(l.name)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</li>`).join('');
      ul.hidden = false; inp.setAttribute('aria-expanded', 'true'); sel = -1;
    }, 350);   // on attend une pause dans la frappe : Photon est un service partagé
  });
  inp.addEventListener('keydown', e => {
    if (ul.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); surligner((sel + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); surligner((sel - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); choisir(sel); }
    else if (e.key === 'Escape') fermer();
  });
  // pointerdown plutôt que click : il passe avant la perte du focus du champ.
  ul.addEventListener('pointerdown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); choisir(+li.dataset.i); } });
  inp.addEventListener('blur', () => setTimeout(fermer, 150));
}
autocompletion('from'); autocompletion('to');

/** Le lieu choisi dans les suggestions, sinon une recherche Photon classique. */
const lieuDe = id => (choix[id] && choix[id].name === $(id).value ? Promise.resolve(choix[id]) : geocode($(id).value));

chargerReglages();
const od = store.get('vpt-od');
if (od) { $('from').value = od.from || ''; $('to').value = od.to || ''; choix = { from: od.cfrom || null, to: od.cto || null }; }
$('f').addEventListener('submit', run);
$('swap').addEventListener('click', () => { const t = $('from').value; $('from').value = $('to').value; $('to').value = t; choix = { from: choix.to, to: choix.from }; });
$('list').addEventListener('click', e => {
  if (e.target.closest('#vdom')) { voirDomines = !voirDomines; render(); return; }
  if (e.target.closest('#explo')) { explorer(); return; }
  if (e.target.closest('#stopx')) { expl.stop = true; return; }
  const sel = e.target.closest('[data-sel]');
  if (sel) {
    hot = +sel.dataset.sel; render();
    const li = document.querySelector(`#list .row[data-i="${hot}"]`);
    if (li) li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    return;
  }
  const g = e.target.closest('[data-gpx]'); if (g) { gpx(routes[+g.dataset.gpx], +g.dataset.gpx); return; }
  if (e.target.closest('a, details')) return;
  const li = e.target.closest('.row'); if (!li) return;
  hot = hot === +li.dataset.i ? -1 : +li.dataset.i; render();
});

// ---------- Appli installable (PWA) ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* pas installable : l'appli marche quand même */ });
// Android (Chrome, Samsung Internet) : bouton « Installer » quand le navigateur le propose.
let invitation = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); invitation = e; $('installer').hidden = false; });
$('installer').addEventListener('click', async () => {
  if (!invitation) return;
  invitation.prompt(); await invitation.userChoice.catch(() => null);
  invitation = null; $('installer').hidden = true;
});
addEventListener('appinstalled', () => { $('installer').hidden = true; });
