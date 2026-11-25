// Interface : saisie, réglages, liste des trajets, carte schématique, exports.
import { DEF, USURE_DEF, usureParKm, analyse, dedupe, cost, along, domines, marche, escalier, choixLimite, LIMITE_DEF } from './cost.js';
import { PROFILES, DELAI_VALHALLA, geocode, route, suggest } from './routing.js';
import { candidats, reglagesMixte, joindre } from './mixtes.js';
import { villesTraversees, villesEtapes } from './villes.js';
import { planExploration, coutPlan, produit, assembler, cleMorceau } from './explore.js';

// Réglages Valhalla des deux moitiés d'un trajet mixte.
const RAPIDE = { auto: { use_tolls: 1, use_highways: 1 } };
const LIBRE = { auto: { use_tolls: 0, use_highways: 0 } };

/** Version affichée en haut de la page : à augmenter à chaque modification publiée. */
export const VERSION = '1.7.1';
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
  prices[p.carbu] = s.prix;
  store.set(PKEY, profils);
  store.set(CKEY, { peage: s.peage, limite: isFinite(limite) ? limite : null, prices });
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
  const rows = routes.map((r, i) => ({ r, i, c: cost(r, s) }));
  const items = rows.map(x => ({ min: x.r.min, eur: x.c.eur }));
  const dom = domines(items), garde = new Set(escalier(items));
  rows.forEach((x, j) => { x.domine = dom.has(j); x.dom = !garde.has(j); });   // x.dom : replié sous « autres trajets »
  domMap = new Set(rows.filter(x => x.dom).map(x => x.i));
  // L'escalier : du plus rapide au moins cher, chaque marche faisant gagner au moins 12 % (voir cost.js escalier).
  const utiles = rows.filter(x => !x.dom).sort((a, b) => a.r.min - b.r.min);
  const tousAutres = rows.filter(x => x.dom).sort((a, b) => a.r.min - b.r.min);
  // Plus cher que le plus rapide : on y perd du temps ET de l'argent. Masqués (liste et carte), seulement comptés.
  const prixRapide = utiles[0].c.eur;
  const autres = tousAutres.filter(x => x.c.eur < prixRapide), plusChers = tousAutres.filter(x => x.c.eur >= prixRapide);
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
      // Marche trop petite : on la compare au trajet de l'escalier juste plus rapide.
      const ref = [...utiles].reverse().find(u => u.r.min <= r.min);
      note = `<p class="note">Seulement ${fmtE(ref.c.eur - c.eur)} de moins que le trajet ${num.get(ref.i)}, pour ${fmtT(r.min - ref.r.min)} de plus.</p>`;
    }
    if (!r.villes) r.villes = villesTraversees(r.pts);   // calculé une fois par trajet
    const via = r.villes.length ? `<span class="via">par ${r.villes.map(esc).join(' · ')}</span>` : '';
    const refs = r.refs.slice(0, 4).map(x => `<span class="c${x[0] === 'D' ? ' cD' : ''}">${esc(x)}</span>`).join('');
    const peage = c.toll >= 0.5 ? `péage ${fmtE(c.toll)} <small>(~${Math.round(r.tollKm)} km)</small>` : 'sans péage';
    return `<li class="row${hot === i ? ' on' : ''}${estDomine ? ' dom' : ''}" data-i="${i}" style="--rc:${COLORS[i % COLORS.length]}"${estDomine && !voirDomines ? ' hidden' : ''}>
<div class="r1"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span><strong>Trajet ${num.get(i)}</strong><span class="te"><span class="nw">${fmtT(r.min)}</span> · <span class="nw">${fmtE(c.eur)}</span></span>${star}</div>
<div class="refs">${via}${refs}</div>${note}
<div class="act"><a class="btn" href="${gmaps(r)}" target="_blank" rel="noopener">Google Maps ↗</a>
<details class="dt"><summary>Détail</summary>
${r.mixte ? `<p class="mx">🔀 ${esc(r.mixte.texte)}</p>` : ''}<p><span class="nw">carburant ${fmtE(c.fuel)}</span> + <span class="nw">usure ${fmtE(c.wear)}</span> + <span class="nw">${peage}</span> = <b>${fmtE(c.eur)}</b></p>
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
  utiles.forEach((x, k) => { if (k) html += pas(utiles[k - 1], x); html += carte(x); });
  const nDom = autres.length;
  if (nDom) {
    html += `<li class="more"><button type="button" id="vdom" aria-expanded="${voirDomines}">${voirDomines ? 'Masquer' : 'Voir'} ${nDom > 1 ? `les ${nDom} trajets écartés` : 'le trajet écarté'} <small>(moins cher${nDom > 1 ? 's' : ''} que le plus rapide, mais pas retenu${nDom > 1 ? 's' : ''})</small></button></li>`;
    html += autres.map(carte).join('');
  }
  // Bandeau : temps perdu, puis argent gagné, puis le trajet concerné (touchable pour le sélectionner).
  const rapide = utiles[0], lim = isFinite(limite) ? (limite ? fmtT(limite) : '') : '';
  const lien = x => `<button type="button" class="vers" data-sel="${x.i}">→ Trajet ${num.get(x.i)} : ${fmtT(x.r.min)} · ${fmtE(x.c.eur)}${x.r.villes && x.r.villes.length ? `, par ${x.r.villes.map(esc).join(' · ')}` : ''}</button>`;
  let bandeau = best === rapide
    ? `<p>⭐ <b>Le plus rapide est ton meilleur choix</b>${lim ? ` : en acceptant de perdre ${lim}, aucun trajet ne te fait gagner d'argent.` : '.'}</p>${lien(rapide)}`
    : `<p>⭐ <b>En acceptant de perdre ${fmtT(best.r.min - t0)}, tu gagnes ${fmtE(rapide.c.eur - best.c.eur)} !</b></p>${lien(best)}`;
  if (sugg) bandeau += `<p>💡 <b>En perdant ${fmtT(sugg.r.min - best.r.min)} de plus, tu pourrais gagner encore ${fmtE(best.c.eur - sugg.c.eur)} !</b></p>${lien(sugg)}`;
  // Trouvaille de l'exploration : mise en avant (et montagne de billets la première fois).
  const neufs = utiles.filter(x => x.r.explore);
  if (neufs.length) {
    const top = [best, sugg].find(x => x && x.r.explore) || neufs.reduce((p, q) => q.c.eur < p.c.eur ? q : p);
    const role = top === best ? ' Et c\'est ton meilleur choix ! 🏆' : top === sugg ? ' C\'est même celui à considérer 💡' : '';
    bandeau = `<p class="trouve">🆕 <b>L'exploration a déniché ${neufs.length > 1 ? `${neufs.length} trajets` : 'un trajet'} que personne ne voyait !</b>${role}</p>${lien(top)}` + bandeau;
    if (neufs.length > dejaFete) { dejaFete = neufs.length; pluieDeBillets(); }
  }
  $('list').innerHTML = `<li class="choix${neufs.length ? ' bravo' : ''}">${bandeau}<p class="nb">${routes.length} trajets comparés : ${utiles.length} dans l'escalier, ${autres.length} écarté${autres.length > 1 ? 's' : ''}${plusChers.length ? `, ${plusChers.length} plus cher${plusChers.length > 1 ? 's' : ''} que le plus rapide (masqué${plusChers.length > 1 ? 's' : ''})` : ''}.</p></li>` + blocExploration(neufs.length) + html;
  draw();
}

const svg = $('map');
let domMap = new Set();
let masques = new Set();   // trajets plus chers que le plus rapide : ni dans la liste, ni sur la carte
function draw() {
  if (!routes.length) return;
  const W = svg.clientWidth || 600, H = svg.clientHeight || 300, pad = 28;
  const all = routes.flatMap(r => r.pts);
  const lat0 = all.reduce((a, p) => a + p[0], 0) / all.length, k = Math.cos(lat0 * Math.PI / 180);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of all) { const x = p[1] * k; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, p[0]); y1 = Math.max(y1, p[0]); }
  const sc = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((y1 - y0) || 1));
  const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
  const P = p => [ox + (p[1] * k - x0) * sc, H - oy - (p[0] - y0) * sc];
  const order = routes.map((_, i) => i).filter(i => !masques.has(i)).sort((a, b) => (a === hot) - (b === hot));
  const chemin = r => { const step = Math.max(1, Math.floor(r.pts.length / 1500)); return r.pts.filter((_, j) => j % step === 0 || j === r.pts.length - 1).map((p, j) => (j ? 'L' : 'M') + P(p).map(v => v.toFixed(1)).join(' ')).join(''); };
  // Trajets plus chers que le plus rapide : fins pointillés gris, dessous, pour montrer tout ce qui a été exploré.
  const explores = [...masques].map(i => `<path d="${chemin(routes[i])}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 4" stroke-linecap="round" opacity="0.35" pointer-events="none"/>`).join('');
  const lines = explores + order.map(i => {
    const r = routes[i], d = chemin(r);
    const on = hot === i || (hot === -1 && !(domMap.has(i) && !voirDomines));
    // Un trait large et invisible par-dessus, pour toucher facilement le tracé au doigt.
    return `<path d="${d}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="${hot === i ? 6 : 3}" stroke-linejoin="round" stroke-linecap="round" opacity="${on ? 1 : 0.2}"/>`
      + (domMap.has(i) && !voirDomines ? '' : `<path d="${d}" fill="none" stroke="transparent" stroke-width="18" data-i="${i}" style="cursor:pointer;pointer-events:stroke"/>`);
  }).join('');
  const A = P(routes[0].pts[0]), B = P(routes[0].pts[routes[0].pts.length - 1]);
  const ink = getComputedStyle(document.body).color;
  const lab = (p, t) => { const left = p[0] > W / 2; return `<circle cx="${p[0]}" cy="${p[1]}" r="7" fill="${ink}"/><text x="${p[0] + (left ? -12 : 12)}" y="${p[1] - 10}" text-anchor="${left ? 'end' : 'start'}" font-family="Barlow Semi Condensed,sans-serif" font-weight="600" font-size="15" fill="${ink}">${esc(t)}</text>`; };
  svg.style.color = getComputedStyle(document.body).color;
  svg.innerHTML = lines + lab(A, ends.a.name) + lab(B, ends.b.name);
}
new ResizeObserver(draw).observe(svg);

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
function blocExploration(nouveaux) {
  if (expl.etat === 'pret') {
    const n = coutPlan(planExploration(trouves, ends.a, ends.b));
    if (!n) return '';
    return `<li class="explo"><button type="button" id="explo">🔍 Explorer encore <small>(≈ ${String(Math.max(0.5, Math.round(n * 1.5 / 30) / 2)).replace('.', ',')} min, ${n} calculs de plus)</small></button></li>`;
  }
  if (expl.etat === 'encours') {
    const pc = Math.round(100 * expl.fait / Math.max(1, expl.total));
    return `<li class="explo"><p>🔍 Exploration : ${pc} % · ${expl.testes} trajets testés${nouveaux ? ` · <b>${nouveaux} nouveau${nouveaux > 1 ? 'x' : ''} 🆕</b>` : ''}</p>
<div class="barre"><span style="width:${pc}%"></span></div><button type="button" id="stopx">Arrêter</button></li>`;
  }
  if (expl.etat === 'fini') {
    return `<li class="explo"><p>${nouveaux ? `✅ Exploration terminée : <b>${nouveaux} nouveau${nouveaux > 1 ? 'x' : ''} trajet${nouveaux > 1 ? 's' : ''} 🆕</b>` : '✅ Exploration terminée : rien de mieux à trouver'}, ${expl.testes} trajets de plus testés${expl.stop ? ' (arrêtée avant la fin)' : ''}.</p></li>`;
  }
  return '';
}

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
      cache.set(k, res); moi.fait++;
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

async function run(e) {
  e.preventDefault();
  const st = $('st'), go = $('go'); st.className = ''; go.disabled = true;
  clearTimeout(suggTimer.from); clearTimeout(suggTimer.to);
  for (const u of document.querySelectorAll('.sugg')) u.hidden = true;
  const t0 = performance.now();
  try {
    st.textContent = 'Recherche des adresses…';
    const a = await lieuDe('from'); await sleep(300);
    const b = await lieuDe('to');
    choix = { from: a, to: b };
    store.set('vpt-od', { from: $('from').value, to: $('to').value, cfrom: a, cto: b });
    ends = { a, b }; hot = -1; routes = [];
    if (expl.etat === 'encours') expl.stop = true;   // une nouvelle recherche arrête l'exploration en cours
    expl = { etat: 'aucun' }; dejaFete = 0;
    const found = []; let fails = 0;
    trouves = found;
    for (let p = 0; p < PROFILES.length; p++) {
      st.textContent = `Calcul des itinéraires ${p + 1}/${PROFILES.length}…`;
      try {
        found.push(...(await route(a, b, PROFILES[p])).map(analyse));
        // Affichage au fil de l'eau : la liste se remplit dès la première réponse.
        routes = dedupe(found).sort((x, y) => x.min - y.min);
        $('res').hidden = false; $('lim').hidden = false; render();
      } catch (err) { fails++; }
      if (p < PROFILES.length - 1) await sleep(DELAI_VALHALLA);
    }
    if (!found.length) throw new Error('le serveur d\'itinéraires n\'a rien renvoyé (connexion coupée, ou serveur saturé : réessaie dans une minute)');

    // Phase 2 : trajets mixtes, là où un trajet sans autoroute rejoint (ou quitte) un trajet par autoroute.
    const pts = candidats(dedupe(found));
    for (let k = 0; k < pts.length; k++) {
      st.textContent = `Recherche de trajets mixtes ${k + 1}/${pts.length}…`;
      const c = pts[k], P = { lat: c.p[0], lon: c.p[1] }, [r1, r2] = reglagesMixte(c.sens, RAPIDE, LIBRE);
      try {
        await sleep(DELAI_VALHALLA); const m1 = analyse((await route(a, P, r1))[0]);
        await sleep(DELAI_VALHALLA); const m2 = analyse((await route(P, b, r2))[0]);
        found.push(joindre(m1, m2, c));
        routes = dedupe(found).sort((x, y) => x.min - y.min);
        render();
      } catch (err) { /* un point de bascule raté n'empêche pas les autres */ }
    }

    // Phase 3 : couper le trajet à une grande ville traversée. Sur le premier morceau, plus court,
    // le serveur propose des variantes qu'il ignore sur le trajet complet ; on finit par le plus rapide.
    const etapes = villesEtapes(dedupe(found));
    for (let k = 0; k < etapes.length; k++) {
      const v = etapes[k], V = { lat: v.lat, lon: v.lon };
      st.textContent = `Recherche par étapes (${v.nom}) ${k + 1}/${etapes.length}…`;
      try {
        const debuts = [];
        for (const p of [PROFILES[0], PROFILES[4]]) {   // rapide avec variantes, puis péage modéré
          await sleep(DELAI_VALHALLA); debuts.push(...(await route(a, V, p)).map(analyse));
        }
        await sleep(DELAI_VALHALLA); const fin = analyse((await route(V, b, RAPIDE))[0]);
        for (const d of dedupe(debuts)) found.push(joindre(d, fin, { sens: 'etape', p: [v.lat, v.lon], texte: `Variante jusqu'à ${v.nom}, puis le plus rapide` }));
        routes = dedupe(found).sort((x, y) => x.min - y.min);
        render();
      } catch (err) { /* une étape ratée n'empêche pas les autres */ }
    }
    const sec = Math.round((performance.now() - t0) / 1000);
    st.textContent = `${a.name} → ${b.name} : ${routes.length} itinéraires différents en ${sec} s${fails ? ` (${fails} calcul${fails > 1 ? 's' : ''} en échec)` : ''}.`;
    expl = { etat: 'pret' }; render();
  } catch (err) {
    st.className = 'err'; st.textContent = 'Oups : ' + (err && err.message ? err.message : 'erreur réseau') + '.';
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
  limite = c && 'limite' in c ? (c.limite === null ? Infinity : c.limite) : LIMITE_DEF;
  afficherProfil();
}

function afficherProfil() {
  const p = actif();
  profils.actif = p.id;
  $('prof').innerHTML = profils.list.map(x => `<option value="${esc(x.id)}">${esc(x.nom)}</option>`).join('');
  $('prof').value = p.id;
  $('pnom').value = p.nom;
  $('carbu').value = p.carbu;
  $('prixl').textContent = `Prix du ${p.carbu}`;
  $('prix').value = prices[p.carbu] != null ? prices[p.carbu] : (FUEL_DEF[p.carbu] != null ? FUEL_DEF[p.carbu] : DEF.prix);
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
  prices[actif().carbu] = num('prix');
  const c = $('carbu').value; actif().carbu = c;
  $('prixl').textContent = `Prix du ${c}`;
  const p = prices[c] != null ? prices[c] : FUEL_DEF[c];
  if (p != null) $('prix').value = p;
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
// Toucher un tracé sur la carte sélectionne le trajet et fait défiler la liste jusqu'à lui.
svg.addEventListener('click', e => {
  const t = e.target.closest('[data-i]');
  if (!t) { if (hot !== -1) { hot = -1; render(); } return; }
  hot = +t.dataset.i; render();
  const li = document.querySelector(`#list .row[data-i="${hot}"]`);
  if (li) li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
});
