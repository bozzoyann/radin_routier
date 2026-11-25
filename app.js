// Interface : saisie, réglages, liste des trajets, carte schématique, exports.
import { DEF, USURE_DEF, usureParKm, analyse, dedupe, cost, along, domines, marche } from './cost.js';
import { PROFILES, DELAI_VALHALLA, geocode, route, suggest } from './routing.js';
import { candidats, reglagesMixte, joindre } from './mixtes.js';

// Réglages Valhalla des deux moitiés d'un trajet mixte.
const RAPIDE = { auto: { use_tolls: 1, use_highways: 1 } };
const LIBRE = { auto: { use_tolls: 0, use_highways: 0 } };

/** Version affichée en haut de la page : à augmenter à chaque modification publiée. */
export const VERSION = '1.2.0';
export const VERSION_DATE = '25/11/2026';

const $ = id => document.getElementById(id);
$('ver').textContent = `v${VERSION} · ${VERSION_DATE}`;
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#6250d6', '#e34948'];
const FUEL_DEF = { 'SP95-E10': 2.05, 'Gazole': 2.20 };
const OLD_KEY = 'vpt-set2', PKEY = 'rr-profils', CKEY = 'rr-reglages';
const KEYS = Object.keys(DEF);
const PROF_KEYS = ['usure', 'cville', 'croute', 'cauto'];   // propres à chaque voiture
const CRIT_KEYS = ['peage', 'vh'];                          // propres à l'utilisateur
let prices = {};               // prix du litre par carburant, partagé entre les voitures
let profils = null;            // {list: [{id, nom, carbu, usure, cville, croute, cauto, wiz}], actif}
let choix = { from: null, to: null };   // lieux choisis dans les suggestions
const suggTimer = {};                   // délais de frappe en cours, par champ
let routes = [], ends = null, hot = -1, voirDomines = false;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
};
const num = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) && v >= 0 ? v : DEF[id]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtT = min => { const m = Math.round(min), h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${String(r).padStart(2, '0')}` : `${r} min`; };
const fmtE = e => `${Math.round(e)} €`;

function settings() { const s = {}; for (const k of KEYS) s[k] = num(k); return s; }
const actif = () => profils.list.find(p => p.id === profils.actif) || profils.list[0];

/** Recopie les champs dans le profil actif et les critères, puis mémorise. */
function save() {
  const s = settings(), p = actif();
  for (const k of PROF_KEYS) p[k] = s[k];
  p.carbu = $('carbu').value;
  prices[p.carbu] = s.prix;
  store.set(PKEY, profils);
  store.set(CKEY, { peage: s.peage, vh: s.vh, prices });
  const fr = n => String(n).replace('.', ',');
  $('sum').textContent = `${p.nom} · ${fr(s.prix)} €/L · ${fr(Math.round(s.usure * 1000) / 10)} c€/km · ${s.vh} €/h`;
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
const VERDICT = {
  oui: ['y', '👍', 'ça vaut le coup'],
  bof: ['m', '😐', 'à toi de voir'],
  non: ['n', '👎', 'mal payé']
};

function render() {
  save();
  if (!routes.length) return;
  const s = settings();
  const rows = routes.map((r, i) => ({ r, i, c: cost(r, s) }));
  const dom = domines(rows.map(x => ({ min: x.r.min, eur: x.c.eur })));
  rows.forEach((x, j) => { x.dom = dom.has(j); });
  domMap = new Set(rows.filter(x => x.dom).map(x => x.i));
  // L'escalier : les trajets utiles, du plus rapide au moins cher (plus lent = forcément moins cher).
  const utiles = rows.filter(x => !x.dom).sort((a, b) => a.r.min - b.r.min);
  const autres = rows.filter(x => x.dom).sort((a, b) => a.r.min - b.r.min);
  const best = utiles.reduce((a, b) => b.c.mix < a.c.mix ? b : a);
  const ordre = [...utiles, ...autres];
  const num = new Map(ordre.map((x, k) => [x.i, k + 1]));

  const carte = ({ r, i, c, dom: estDomine }) => {
    const star = best.i === i ? '<span class="bdg star">⭐ Meilleur choix pour toi</span>' : '';
    let note = '';
    if (estDomine) {
      const meilleur = utiles.find(u => u.r.min <= r.min && u.c.eur <= c.eur);
      note = `<p class="note">Plus lent et plus cher que le trajet ${num.get(meilleur.i)}.</p>`;
    }
    const refs = r.refs.slice(0, 4).map(x => `<span class="c${x[0] === 'D' ? ' cD' : ''}">${esc(x)}</span>`).join('');
    const peage = c.toll >= 0.5 ? `péage ${fmtE(c.toll)} <small>(~${Math.round(r.tollKm)} km)</small>` : 'sans péage';
    return `<li class="row${hot === i ? ' on' : ''}${estDomine ? ' dom' : ''}" data-i="${i}"${estDomine && !voirDomines ? ' hidden' : ''}>
<div class="r1"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span><strong>Trajet ${num.get(i)}</strong><span class="te"><span class="nw">${fmtT(r.min)}</span> · <span class="nw">${fmtE(c.eur)}</span></span>${star}</div>
<div class="refs">${refs}</div>${note}
<div class="act"><a class="btn" href="${gmaps(r)}" target="_blank" rel="noopener">Google Maps ↗</a>
<details class="dt"><summary>Détail</summary>
${r.mixte ? `<p class="mx">🔀 ${esc(r.mixte.texte)}</p>` : ''}<p><span class="nw">carburant ${fmtE(c.fuel)}</span> + <span class="nw">usure ${fmtE(c.wear)}</span> + <span class="nw">${peage}</span> = <b>${fmtE(c.eur)}</b></p>
<p><span class="nw">${Math.round(r.km)} km :</span> <span class="nw">autoroute ${Math.round(r.hwKm)}</span> · <span class="nw">route ${Math.round(r.routeKm)}</span> · <span class="nw">ville ${Math.round(r.villeKm)}</span></p>
<button type="button" class="btn" data-gpx="${i}">Télécharger le GPX</button>
</details></div>
</li>`;
  };

  // Une marche entre deux trajets successifs de l'escalier.
  const pas = (haut, bas) => {
    const m = marche({ min: haut.r.min, eur: haut.c.eur }, { min: bas.r.min, eur: bas.c.eur }, s.vh);
    const [cls, ico, mot] = VERDICT[m.verdict];
    const temps = m.dt > 0.5 ? `+${fmtT(m.dt)}` : 'même durée';
    const taux = isFinite(m.parMin) ? `${fmtEur(m.parMin)} par minute en plus` : 'sans perdre de temps';
    return `<li class="step ${cls}" aria-label="Du trajet ${num.get(haut.i)} au trajet ${num.get(bas.i)}">
<span class="arr" aria-hidden="true">▼</span><span class="sd"><b>${temps}</b> · <b>−${fmtE(m.de)}</b></span><span class="sr">${taux} ${ico} ${mot}</span></li>`;
  };

  let html = '';
  utiles.forEach((x, k) => { if (k) html += pas(utiles[k - 1], x); html += carte(x); });
  const nDom = autres.length;
  if (nDom) {
    html += `<li class="more"><button type="button" id="vdom" aria-expanded="${voirDomines}">${voirDomines ? 'Masquer' : 'Voir'} ${nDom} trajet${nDom > 1 ? 's' : ''} sans intérêt <small>(plus lent${nDom > 1 ? 's' : ''} et plus cher${nDom > 1 ? 's' : ''} qu'un autre)</small></button></li>`;
    html += autres.map(carte).join('');
  }
  $('list').innerHTML = html;
  draw();
}

const svg = $('map');
let domMap = new Set();
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
  const order = routes.map((_, i) => i).sort((a, b) => (a === hot) - (b === hot));
  const lines = order.map(i => {
    const r = routes[i], step = Math.max(1, Math.floor(r.pts.length / 1500));
    const d = r.pts.filter((_, j) => j % step === 0 || j === r.pts.length - 1).map((p, j) => (j ? 'L' : 'M') + P(p).map(v => v.toFixed(1)).join(' ')).join('');
    const on = hot === i || (hot === -1 && !(domMap.has(i) && !voirDomines));
    return `<path d="${d}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="${hot === i ? 5 : 3}" stroke-linejoin="round" stroke-linecap="round" opacity="${on ? 1 : 0.25}"/>`;
  }).join('');
  const A = P(routes[0].pts[0]), B = P(routes[0].pts[routes[0].pts.length - 1]);
  const ink = getComputedStyle(document.body).color;
  const lab = (p, t) => { const left = p[0] > W / 2; return `<circle cx="${p[0]}" cy="${p[1]}" r="7" fill="${ink}"/><text x="${p[0] + (left ? -12 : 12)}" y="${p[1] - 10}" text-anchor="${left ? 'end' : 'start'}" font-family="Barlow Semi Condensed,sans-serif" font-weight="600" font-size="15" fill="${ink}">${esc(t)}</text>`; };
  svg.innerHTML = lines + lab(A, ends.a.name) + lab(B, ends.b.name);
}
new ResizeObserver(draw).observe(svg);

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
    const found = []; let fails = 0;
    for (let p = 0; p < PROFILES.length; p++) {
      st.textContent = `Calcul des itinéraires ${p + 1}/${PROFILES.length}…`;
      try {
        found.push(...(await route(a, b, PROFILES[p])).map(analyse));
        // Affichage au fil de l'eau : la liste se remplit dès la première réponse.
        routes = dedupe(found).sort((x, y) => x.min - y.min);
        $('res').hidden = false; render();
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
    const sec = Math.round((performance.now() - t0) / 1000);
    st.textContent = `${a.name} → ${b.name} : ${routes.length} itinéraires différents en ${sec} s${fails ? ` (${fails} calcul${fails > 1 ? 's' : ''} en échec)` : ''}.`;
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
  const g = e.target.closest('[data-gpx]'); if (g) { gpx(routes[+g.dataset.gpx], +g.dataset.gpx); return; }
  if (e.target.closest('a, details')) return;
  const li = e.target.closest('.row'); if (!li) return;
  hot = hot === +li.dataset.i ? -1 : +li.dataset.i; render();
});
