// Interface : saisie, réglages, liste des trajets, carte schématique, exports.
import { DEF, analyse, dedupe, cost, tauxHoraire, along } from './cost.js';
import { PROFILES, DELAI_VALHALLA, geocode, route } from './routing.js';

const $ = id => document.getElementById(id);
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#6250d6', '#e34948'];
const FUEL_DEF = { 'SP95-E10': 2.05, 'Gazole': 2.20 };
const SKEY = 'vpt-set2';
const KEYS = Object.keys(DEF);
let fuel = 'SP95-E10', prices = {};
let routes = [], ends = null, sortBy = 'mix', hot = -1;

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
function save() { const s = settings(); prices[fuel] = s.prix; store.set(SKEY, { s, fuel, prices }); }

function gmaps(r) {
  const ll = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`, w = along(r.pts, [0.25, 0.5, 0.75]).map(ll).join('|');
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

function render() {
  save();
  if (!routes.length) return;
  const s = settings();
  const rows = routes.map((r, i) => ({ r, i, c: cost(r, s) }));
  const fast = rows.reduce((a, b) => b.r.min < a.r.min ? b : a);
  const cheap = rows.reduce((a, b) => b.c.eur < a.c.eur ? b : a);
  const best = rows.reduce((a, b) => b.c.mix < a.c.mix ? b : a);
  const key = { temps: x => x.r.min, euros: x => x.c.eur, mix: x => x.c.mix }[sortBy];
  rows.sort((a, b) => key(a) - key(b));
  $('list').innerHTML = rows.map(({ r, i, c }) => {
    const badges = [fast.i === i ? 'Le plus rapide' : '', cheap.i === i ? 'Le moins cher' : '', best.i === i ? 'Meilleur compromis' : ''].filter(Boolean)
      .map(b => `<span class="bdg">${b}</span>`).join('');
    const kind = r.tollKm > 1 ? `<span class="kind kA">Péage ~${Math.round(r.tollKm)} km</span>` : `<span class="kind kN">Sans péage</span>`;
    let dl;
    if (i === fast.i) dl = 'Référence : c\'est le trajet le plus rapide.';
    else {
      const dt = r.min - fast.r.min, de = fast.c.eur - c.eur;
      const rate = tauxHoraire({ eur: c.eur, min: r.min }, { eur: fast.c.eur, min: fast.r.min });
      if (rate === null) dl = `<span class="n">+${fmtT(dt)} et +${fmtE(-de)}</span> par rapport au plus rapide : aucun intérêt.`;
      else {
        const ok = rate >= s.vh;
        dl = `+${fmtT(Math.max(dt, 0))} pour <b>${fmtE(de)} économisés</b>, soit <span class="${ok ? 'y' : 'n'}">${isFinite(rate) ? Math.round(rate) + ' €/h' : 'gratuit'}</span> ${ok ? '(mieux payé que ton heure)' : '(moins que ton heure)'}.`;
      }
    }
    const refs = r.refs.map(x => `<span class="c${x[0] === 'D' ? ' cD' : ''}">${esc(x)}</span>`).join('');
    return `<li class="row${hot === i ? ' on' : ''}" data-i="${i}">
<div class="r1"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span><strong>Trajet ${i + 1}</strong>${kind}${badges}</div>
<div class="big"><span class="t">${fmtT(r.min)}</span><span class="e">${fmtE(c.eur)}</span></div>
<div class="refs">${refs}</div>
<div class="det"><span class="nw">${Math.round(r.km)} km</span> · <span class="nw">carburant ${fmtE(c.fuel)}</span> · <span class="nw">usure ${fmtE(c.wear)}</span> · <span class="nw">péage ${fmtE(c.toll)}</span></div>
<div class="mixl"><span class="nw">autoroute ${Math.round(r.hwKm)} km</span> · <span class="nw">route ${Math.round(r.routeKm)} km</span> · <span class="nw">ville ${Math.round(r.villeKm)} km</span></div>
<div class="dl">${dl}</div>
<div class="act"><a class="btn" href="${gmaps(r)}" target="_blank" rel="noopener">Google Maps ↗</a><button type="button" class="btn" data-gpx="${i}">GPX</button></div>
</li>`;
  }).join('');
  draw();
}

const svg = $('map');
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
    const on = hot === -1 || hot === i;
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
  const t0 = performance.now();
  try {
    store.set('vpt-od', { from: $('from').value, to: $('to').value });
    st.textContent = 'Recherche des adresses…';
    const a = await geocode($('from').value); await sleep(300);
    const b = await geocode($('to').value);
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
    const sec = Math.round((performance.now() - t0) / 1000);
    st.textContent = `${a.name} → ${b.name} : ${routes.length} itinéraires différents en ${sec} s${fails ? ` (${fails} calcul${fails > 1 ? 's' : ''} en échec)` : ''}.`;
  } catch (err) {
    st.className = 'err'; st.textContent = 'Oups : ' + (err && err.message ? err.message : 'erreur réseau') + '.';
  } finally { go.disabled = false; }
}

// Restauration des réglages mémorisés.
const sv = store.get(SKEY) || {}, saved = sv.s || {};
for (const k of KEYS) $(k).value = saved[k] != null ? saved[k] : DEF[k];
if (sv.fuel) fuel = sv.fuel;
prices = sv.prices || {};
$('carbu').value = fuel; $('prixl').textContent = `Prix du ${fuel}`;
$('carbu').addEventListener('change', () => {
  prices[fuel] = num('prix'); fuel = $('carbu').value;
  $('prixl').textContent = `Prix du ${fuel}`;
  const p = prices[fuel] != null ? prices[fuel] : FUEL_DEF[fuel];
  if (p != null) $('prix').value = p;
  render();
});
const od = store.get('vpt-od'); if (od) { $('from').value = od.from || ''; $('to').value = od.to || ''; }
$('f').addEventListener('submit', run);
$('swap').addEventListener('click', () => { const t = $('from').value; $('from').value = $('to').value; $('to').value = t; });
for (const k of KEYS) $(k).addEventListener('input', render);
document.querySelector('.sort').addEventListener('click', e => {
  const b = e.target.closest('button[data-s]'); if (!b) return;
  sortBy = b.dataset.s;
  for (const x of document.querySelectorAll('.sort button')) x.setAttribute('aria-pressed', String(x === b));
  render();
});
$('list').addEventListener('click', e => {
  const g = e.target.closest('[data-gpx]'); if (g) { gpx(routes[+g.dataset.gpx], +g.dataset.gpx); return; }
  if (e.target.closest('a')) return;
  const li = e.target.closest('.row'); if (!li) return;
  hot = hot === +li.dataset.i ? -1 : +li.dataset.i; render();
});
