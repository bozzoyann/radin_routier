// Interface : saisie, réglages, liste des trajets, carte schématique, exports.
import { DEF, USURE_DEF, usureParKm, analyse, dedupe, cost, along, marche, classer, LIMITE_DEF, margePro } from './cost.js';
import { PROFILES, DELAI_VALHALLA, geocode, route, suggest, lienMaps, lienTrajet, lireTrajet, lieuPourLien } from './routing.js';
import { candidats, reglagesMixte, joindre, pointsDePassage } from './mixtes.js';
import { villesTraversees, villesEtapes, nomsTrajets } from './villes.js';
import { planExploration, coutPlan, produit, assembler, cleMorceau, RAPIDE, LIBRE, vautExplorer } from './explore.js';
import { ouvragesTraverses } from './ouvrages.js';
import { TARIFS_KM } from './peages-data.js';
import { prixDuJour } from './carburant.js';

/** Version affichée en haut de la page : à augmenter à chaque modification publiée. */
export const VERSION = '1.35.0';
export const VERSION_DATE = '27/11/2026';

const $ = id => document.getElementById(id);
$('ver').textContent = `v${VERSION} · ${VERSION_DATE}`;
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#6250d6', '#e34948'];
const FUEL_DEF = { 'SP95-E10': 2.05, 'Gazole': 2.20, 'Électrique': 0.25 };
// Voiture électrique (prototype) : le « carburant » est le kWh, la conso en kWh/100 km ; pas de prix du jour.
const ELEC = 'Électrique', CONSO_ELEC = { cville: 15, croute: 14, cauto: 19 };
const unite = c => (c === ELEC ? 'kWh' : 'L');
function majLibelles(c) {
  $('prixl').textContent = c === ELEC ? 'Prix du kWh' : `Prix du ${c}`;
  $('prixu').textContent = `€/${unite(c)}`;
  $('consot').textContent = `Consommation (${unite(c)}/100 km)`;
}
const PKEY = 'rr-profils', CKEY = 'rr-reglages';
const KEYS = Object.keys(DEF);   // champs du formulaire
const PROF_KEYS = ['usure', 'cville', 'croute', 'cauto'];   // propres à chaque voiture
const CRIT_KEYS = ['peage', 'ik'];                                 // propres à l'utilisateur
let prices = {};               // prix du litre par carburant, partagé entre les voitures
let profils = null;            // {list: [{id, nom, carbu, usure, cville, croute, cauto, wiz}], actif}
let choix = { from: null, to: null };   // lieux choisis dans les suggestions
const suggTimer = {};                   // délais de frappe en cours, par champ
let ecartMax = 0;   // écart de prix entre le plus rapide et le moins cher (pour « Explorer encore »)
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

function settings() { const s = { rembourse: $('rembourse').checked }; for (const k of KEYS) s[k] = num(k); return s; }
const actif = () => profils.list.find(p => p.id === profils.actif) || profils.list[0];

/** Recopie les champs dans le profil actif et les critères, puis mémorise. */
function save() {
  const s = settings(), p = actif();
  for (const k of PROF_KEYS) p[k] = s[k];
  p.carbu = $('carbu').value;
  if (!$('prixauto').checked) prices[p.carbu] = s.prix;   // le prix du jour ne remplace pas ton prix manuel
  store.set(PKEY, profils);
  $('pro').hidden = !s.rembourse;
  $('proRapide').setAttribute('aria-pressed', String(s.rembourse));
  store.set(CKEY, { peage: s.peage, ik: s.ik, ikDef: DEF.ik, rembourse: s.rembourse, limite: isFinite(limite) ? limite : null, prices, prixAuto: $('prixauto').checked });
  const fr = n => String(n).replace('.', ',');
  $('sum').textContent = `${p.nom} · ${fr(s.prix)} €/${unite(p.carbu)} · ${fr(Math.round(s.usure * 1000) / 10)} c€/km${s.rembourse ? ' · péage remboursé' : ''}`;
}

function gmaps({ r, c }, ref) {
  // 3 points de passage là où le trajet s'écarte du plus rapide `ref` (mixtes.js pointsDePassage) : le GPS est
  // obligé de suivre le détour au lieu de reprendre l'autoroute.
  const cle = ref && ref !== r ? ref.id : -1;
  if (!r.passage || r.passage.cle !== cle) r.passage = { cle, pts: cle !== -1 ? pointsDePassage(r.pts, ref.pts) : along(r.pts, [0.25, 0.5, 0.75]) };
  // Départ « Ma position » : on ne l'envoie pas, Maps part du téléphone (bouton « Démarrer » direct).
  const ici = ends && ends.a && ends.a.name === 'Ma position';
  return lienMaps({ de: ici ? null : r.pts[0], a: r.pts.at(-1), passages: r.passage.pts, sansPeage: c.toll < 0.5 });
}

function gpx(r, n) {
  const pts = r.pts.map(p => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('');
  const name = `${ends.a.name} - ${ends.b.name} (trajet ${n})`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="radin-routier" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
  a.download = `trajet-${n}.gpx`; document.body.appendChild(a); a.click(); a.remove();
}

const fmtEur = v => `${v.toFixed(2).replace('.', ',')} €`;
// Écart entre deux prix tel qu'on le lit à l'écran (prix arrondis) : 91 € − 70 € fait bien 21 €.
const ecartE = (a, b) => Math.round(a) - Math.round(b);
// Les parts d'un prix, arrondies pour que les additions tombent juste : conso (carburant) + usure + péage.
function parts(c) {
  const tot = Math.round(c.eur), conso = Math.round(c.fuel), roule = Math.round(c.fuel + c.wear);
  return { tot, conso, usure: roule - conso, peage: tot - roule };
}
// La jauge de chaque trajet (barre fine) : les mêmes parts que l'anneau, à la même échelle pour tous (le prix du plus rapide),
// pour comparer d'un coup d'œil (à kilométrage égal, l'usure a la même longueur ; le péage fond, le gris grandit).
function jauge(c, ref) {
  const p = parts(c), eco = Math.round(ref) - p.tot;
  const morceaux = [['conso', p.conso], ['usure', p.usure], ['peage', p.peage], ['eco', eco]].filter(m => m[1] >= 1);
  const nom = `Conso ${p.conso} €, usure ${p.usure} €, ${p.peage >= 1 ? `péage ${p.peage} €` : 'sans péage'}${eco >= 1 ? `, ${eco} € économisés` : ''}`;
  return `<div class="barre" role="img" aria-label="${nom}">${morceaux.map(([k, v]) => `<span class="b-${k}" style="flex:${v}"></span>`).join('')}</div>`;
}
// L'anneau des dépenses : conso, usure, péage et, en gris, l'économie par rapport au plus rapide (le tour complet
// vaut le prix du plus rapide). SVG, 2 px de vide entre deux parts, une part nulle ne se dessine pas ;
// couleurs (validées pour les daltoniens, en clair et en sombre) dans styles.css (.anneau).
function anneau(c, ref, { taille = 104, centre = true, etiquette = '' } = {}) {
  const p = parts(c), base = Math.max(Math.round(ref), p.tot), eco = Math.round(ref) - p.tot;
  const C = 2 * Math.PI * 40, jeu = 200 / taille;
  const morceaux = [['conso', p.conso, 'Conso'], ['usure', p.usure, 'Usure'], ['peage', p.peage, 'Péage'], ['eco', eco, 'Économie']].filter(m => m[1] >= 1);
  let pos = 0, arcs = '';
  for (const [cls, v, nom] of morceaux) {
    const L = v / base * C, trait = morceaux.length > 1 ? Math.max(L - jeu, 0.5) : C;
    arcs += `<circle cx="50" cy="50" r="40" class="a-${cls}" stroke-dasharray="${trait.toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-pos).toFixed(1)}"><title>${nom} ${v} €</title></circle>`;
    pos += L;
  }
  const texte = !centre ? '' : eco >= 1
    ? `<text x="50" y="49" class="a-gain">−${eco} €</text><text x="50" y="62" class="a-leg">économisés</text>`
    : `<text x="50" y="50" class="a-tot">${p.tot} €</text><text x="50" y="62" class="a-leg">au total</text>`;
  return `<svg class="anneau" viewBox="0 0 100 100" width="${taille}" height="${taille}" ${etiquette ? `role="img" aria-label="${esc(etiquette)}"` : 'aria-hidden="true"'}>`
    + `<g transform="rotate(-90 50 50)" fill="none" stroke-width="15">${arcs}</g>${texte}</svg>`;
}
// Ce que rapporte une marche, en minutes perdues par euro gagné : « 1 € toutes les 2,7 min ».
const tauxTxt = (dt, de) => {
  if (dt <= 0.5 || de <= 0) return '';
  const mpe = dt / de;
  if (mpe <= 1) return 'plus d\'1 € la minute';
  if (mpe > 30) return 'presque rien';
  return `1 € toutes les ${mpe < 10 ? mpe.toFixed(1).replace('.', ',') : Math.round(mpe)} min`;
};

function render() {
  save();
  if (!routes.length) return;
  const s = settings();
  const auj = new Date();
  for (const r of routes) {
    if (r.id == null) r.id = seq++;   // identifiant stable : couleur et sélection ne bougent pas quand la liste se réordonne
    if (!r.ouvrages) r.ouvrages = ouvragesTraverses(r, auj);   // ponts et tunnels : prix fixe, calculé une fois
  }
  const rows = routes.map(r => ({ r, id: r.id, c: cost(r, s) }));
  // Le rangement (escalier, variantes, trajets sans intérêt, choix) : cost.js classer, testé sous Node.
  const k = classer(rows.map(x => ({ min: x.r.min, eur: x.c.eur })), limite);
  const utiles = k.escalier.map(j => rows[j]), autres = k.variantes.map(j => rows[j]);
  for (const x of autres) x.dom = true;
  masques = new Set(k.masques.map(j => rows[j].id));
  domMap = new Set(autres.map(x => x.id));
  ecartMax = rows[k.rapide].c.eur - Math.min(...rows.map(x => x.c.eur));
  const rapide = rows[k.rapide], best = rows[k.choix], sugg = k.suggestion >= 0 ? rows[k.suggestion] : null, t0 = rapide.r.min;
  choixId = best.id;
  bulles = new Map(rows.map(x => [x.id, `${parts(x.c).tot} € · ${fmtT(x.r.min)}`]));   // étiquette sur la carte
  const numero = new Map([...k.numeros].map(([j, n]) => [rows[j].id, n]));   // ne change pas avec la pilule
  const avant = x => [...utiles].reverse().find(u => u.r.min <= x.r.min) || utiles[0];   // trajet de l'escalier juste avant
  // Les trajets montrés se nomment par leur ville repère la plus distinctive (« par Saumur ») ; « Trajet N » sinon.
  const montres = [...utiles, ...autres];
  for (const x of montres) if (!x.r.villes) x.r.villes = villesTraversees(x.r.pts);   // calculé une fois par trajet
  const noms = new Map(nomsTrajets(montres.map(x => x.r.villes), montres.map(x => x.r.refs)).map((n, j) => [montres[j].id, n]));
  const nom = x => noms.get(x.id) || `Trajet ${numero.get(x.id)}`;
  for (const b of document.querySelectorAll('#lim button')) b.setAttribute('aria-pressed', String(b.dataset.l === (isFinite(limite) ? String(limite) : 'inf')));

  const PIC = (d, cls = 'pic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

  // Un trajet : une carte avec sa pastille de couleur, prix puis durée, routes et villes, actions au toucher.
  const carte = ({ r, id, c, dom: estDomine }) => {
    const role = best.id === id ? 'Ton choix' : id === rapide.id ? 'Le plus rapide' : id === utiles.at(-1).id ? 'Le moins cher' : '';
    // Variante intermédiaire : son écart avec le trajet de l'escalier juste avant, en bout de 2e ligne.
    let ecartV = '';
    if (estDomine) {
      const prec = avant({ r }), de = ecartE(prec.c.eur, c.eur);
      ecartV = `<span class="ecart-v">+${fmtT(r.min - prec.r.min)} · ${de >= 1 ? `−${de} €` : 'même prix'}</span>`;
    }
    const via = r.villes.length ? `<span class="via">${r.villes.map(esc).join(' · ')}</span>` : '';
    const refs = r.refs.slice(0, 3).map(x => `<span class="c${x[0] === 'D' ? ' cD' : ''}">${esc(x)}</span>`).join('');
    const payants = r.ouvrages.filter(o => !o.gratuit);
    const dont = payants.map(o => `dont ${esc(o.nom)} ${fmtEur(o.prix)}${o.verifier ? ' (à vérifier)' : ''}`).join(', ');
    const gratuits = r.ouvrages.filter(o => o.gratuit).map(o => `${esc(o.nom)} gratuit dans ce sens`).join(', ');
    // Tarif réel (grilles officielles) ou estimé à la main (Sanef, SAPN), voir outils/peages.mjs.
    const estime = a => String(TARIFS_KM[a]?.[2] || '').startsWith('estimé');
    const reels = c.tarifsReels.filter(a => !estime(a)), estimes = c.tarifsReels.filter(estime);
    const precis = [dont, reels.length ? `tarif réel ${reels.join(', ')}` : '', estimes.length ? `tarif estimé ${estimes.join(', ')}` : ''].filter(Boolean).join(' ; ');
    const p = parts(c), eco = ecartE(rapide.c.eur, c.eur);
    const quoi = precis || `~${Math.round(r.tollKm)} km au tarif estimé`;
    const peage = c.rembourse && c.toll >= 0.5 ? `<i class="pt"></i>Péage <b>${fmtE(c.toll)}</b> remboursé, hors du total <small>(${quoi})</small>`
      : p.peage >= 1 ? `<i class="pt pt-peage"></i>Péage <b>${p.peage} €</b> <small>(${quoi})</small>` : '<i class="pt"></i>Sans péage';
    const couleur = COLORS[id % COLORS.length];
    const cls = ['tr', hot === id ? 'on' : '', best.id === id ? 'choisi' : '', estDomine ? 'variante' : ''].filter(Boolean).join(' ');
    return `<li class="${cls}" data-i="${id}" style="--rc:${couleur}"${estDomine && !voirDomines ? ' hidden' : ''}>
<div class="rail"><span class="point" style="background:${couleur}"></span></div>
<div class="corps">
<div class="tete-tr"><span class="prix">${fmtE(c.eur)}</span><span class="duree">${fmtT(r.min)}</span><span class="km">· ${Math.round(r.km)} km</span><span class="role">${role || nom({ id })}</span></div>
${jauge(c, rapide.c.eur)}
<div class="refs">${refs}${via}<span class="fin">${ecartV}<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></div>
<div class="act">${best.id === id ? '' : `<a class="maps" href="${gmaps({ r, c }, rapide.r)}" target="_blank" rel="noopener">Ouvrir dans Maps</a>`}
<details class="dt"${hot === id ? ' open' : ''}><summary>Détail du prix</summary>${r.explore ? '<p>Trouvé par l\'exploration.</p>' : ''}
${r.mixte ? `<p>${esc(r.mixte.texte)}</p>` : ''}<div class="repart-dt">${anneau(c, rapide.c.eur, { taille: 64, centre: false })}<div>
<p><i class="pt pt-conso"></i>Conso <b>${p.conso} €</b></p>
<p><i class="pt pt-usure"></i>Usure <b>${p.usure} €</b> <small>(${Math.round(r.km)} km)</small></p>
<p>${peage}</p>
<p>Total <b>${p.tot} €</b>${eco >= 1 ? ` · ${eco} € de moins que le plus rapide` : ''}</p>${s.rembourse ? (m => `<p>Ta marge <b>${m.marge >= 0 ? '+' : '−'}${Math.abs(m.marge)} €</b></p>`)(margePro(c, s.ik, rapide.r.km)) : ''}</div></div>${gratuits ? `<p>${gratuits}</p>` : ''}
<p>${Math.round(r.km)} km : autoroute ${Math.round(r.hwKm)} · route ${Math.round(r.routeKm)} · ville ${Math.round(r.villeKm)}</p>
<button type="button" class="gpx" data-gpx="${id}" data-n="${numero.get(id)}">Télécharger le GPX</button>
</details></div>
</div>
</li>`;
  };

  // Une marche entre deux trajets de l'escalier : vert jusqu'à ton choix, orange jusqu'à « au-delà », gris ensuite.
  const pas = (haut, bas) => {
    const m = marche({ min: haut.r.min, eur: haut.c.eur }, { min: bas.r.min, eur: bas.c.eur });
    const cls = bas.r.min <= best.r.min ? 'y' : sugg && bas.r.min <= sugg.r.min ? 'm' : 'n';
    const temps = m.dt > 0.5 ? `+${fmtT(m.dt)}` : 'même durée';
    return `<li class="marche ${cls}" aria-label="De ${esc(nom(haut))} à ${esc(nom(bas))}"><span class="ecart">${temps} · −${ecartE(haut.c.eur, bas.c.eur)} €<span>${tauxTxt(m.dt, m.de)}</span></span></li>`;
  };

  // L'escalier, avec les variantes intermédiaires en retrait à leur place (si dépliées).
  let html = '';
  const versSuivant = v => { const p = avant(v), n = utiles[utiles.indexOf(p) + 1]; return !!n && n.r.min - v.r.min < v.r.min - p.r.min; };
  utiles.forEach((x, j) => {
    if (j) {
      html += pas(utiles[j - 1], x);
      html += autres.filter(v => avant(v) === utiles[j - 1] && versSuivant(v)).map(v => carte(v)).join('');
    }
    html += carte(x);
    html += autres.filter(v => avant(v) === x && !versSuivant(v)).map(v => carte(v)).join('');
  });
  // Les autres trajets (variantes et trajets sans intérêt) : un seul repli, et rien sur la carte tant qu'il est fermé.
  const nAutres = autres.length + masques.size;
  if (nAutres) {
    html += `<li class="plus"><button type="button" id="vdom" aria-expanded="${voirDomines}">${PIC('M6 9l6 6 6-6')}${voirDomines ? 'Masquer les autres trajets' : `Voir les autres trajets (${nAutres})`}</button></li>`;
    if (voirDomines && masques.size) html += `<li class="info-autres">${masques.size > 1 ? `${masques.size} trajets sans intérêt` : '1 trajet sans intérêt'} (plus lents et pas moins chers) : en pointillés sur la carte.</li>`;
  }

  // Synthèse : en tête du panneau. Ton choix, au-delà, avancement et exploration, compteur.
  // Les trouvailles de l'exploration se comptent sans les variantes montées pour la pilule : changer de pilule
  // ne relance pas la pluie de billets.
  const neufs = k.escalier.filter(j => !k.promus.includes(j)).map(j => rows[j]).filter(x => x.r.explore);
  derniersNeufs = neufs.length;
  let synth = '';
  if (neufs.length) {
    const top = [best, sugg].find(x => x && x.r.explore) || neufs.reduce((p, q) => q.c.eur < p.c.eur ? q : p);
    synth += `<div class="ligne"><span class="neuf">Nouveau</span><button type="button" class="sel" data-sel="${top.id}">L'exploration a trouvé ${neufs.length > 1 ? `${neufs.length} trajets` : 'un trajet'} : ${esc(nom(top))}${top === best ? ', ton choix' : ''}</button></div>`;
    if (neufs.length > dejaFete) { dejaFete = neufs.length; pluieDeBillets(); }
  }
  const pb = parts(best.c), eco = ecartE(rapide.c.eur, best.c.eur);
  const ecart = best === rapide
    ? `<div class="ecart">${limite === 0 ? 'Aucune minute de plus acceptée' : `Aucun détour rentable${isFinite(limite) ? ` en ${fmtT(limite)} de plus` : ''}`}</div>`
    : `<div class="ecart">−${eco} € pour +${fmtT(best.r.min - t0)}</div>`;
  const mp = s.rembourse ? margePro(best.c, s.ik, rapide.r.km) : null;   // déplacement pro : note de frais − coût réel
  const marge = mp ? `<span class="marge">Marge pro <b>${mp.marge >= 0 ? '+' : '−'}${Math.abs(mp.marge)} €</b></span>` : '';
  const etiquette = `Ton choix coûte ${pb.tot} € : conso ${pb.conso} €, usure ${pb.usure} €, ${pb.peage >= 1 ? `péage ${pb.peage} €` : 'sans péage'}${eco >= 1 ? `, et tu économises ${eco} € par rapport au plus rapide` : ''}.`;
  synth += `<div class="choix-tete"><div class="choix-g">
<div class="ligne"><button type="button" class="sel titre" data-sel="${best.id}" aria-label="Ton choix : ${esc(nom(best))}">${esc(best === rapide ? `Le plus rapide${nom(best) ? ` · ${nom(best)}` : ''}` : nom(best) || `Trajet ${numero.get(best.id)}`)}</button></div>
<div class="ligne"><span class="prix">${pb.tot} €</span><span class="duree">${fmtT(best.r.min)}</span></div><div class="chips">${ecart}${marge}</div></div>
${anneau(best.c, rapide.c.eur, { etiquette, taille: 88 })}</div>
<div class="repart" aria-hidden="true"><span><i class="pt pt-conso"></i>Conso <b>${pb.conso} €</b></span><span><i class="pt pt-usure"></i>Usure <b>${pb.usure} €</b></span>${pb.peage >= 1 ? `<span><i class="pt pt-peage"></i>Péage <b>${pb.peage} €</b></span>` : `<span>${s.rembourse && best.c.toll >= 0.5 ? 'Péage remboursé' : 'Sans péage'}</span>`}${eco >= 1 ? `<span><i class="pt pt-eco"></i>Économie <b>${eco} €</b></span>` : ''}</div>`;
  synth += `<div class="actions"><a class="maps" href="${gmaps(best, rapide.r)}" target="_blank" rel="noopener">Ouvrir dans Maps</a><button type="button" class="icone partage" id="partage" aria-label="Partager ce trajet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M12 3v12M7 8l5-5 5 5"/></svg></button></div>`;
  if (sugg) synth += `<div class="sep"></div><div class="ligne"><span class="tag">Au-delà</span><button type="button" class="sel droite" data-sel="${sugg.id}">${esc(nom(sugg))} · −${ecartE(best.c.eur, sugg.c.eur)} € pour +${fmtT(sugg.r.min - best.r.min)}</button></div>`;
  compte = routes.length;
  // Avancement (recherche, exploration + Arrêter) sous la carte du résultat ; le bilan en bas de liste.
  $('list').innerHTML = `<li class="synth${neufs.length ? ' bravo' : ''}">${synth}</li><li class="explo-li">${blocAvancement(neufs.length)}</li>` + html + `<li class="bilan-li">${blocBilan(neufs.length)}</li>`;
  draw();
}

// ---------- Carte : fond OpenStreetMap (Leaflet, copié dans vendor/leaflet) ----------
let domMap = new Set();     // identifiants des variantes intermédiaires
let masques = new Set();   // identifiants des trajets sans intérêt : hors de la liste, en pointillés sur la carte
let bulles = new Map();   // prix et durée de chaque trajet, pour l'étiquette du trajet mis en avant
let choixId = -1;          // identifiant de « ton choix »
let seq = 0;               // prochain identifiant de trajet (remis à zéro à chaque recherche)
let carte = null, calque = null, cadrage = '';
// Fond OpenStreetMap, gratuit et sans clé (attribution visible, usage modéré), passé en gris dans styles.css
// pour que la couleur reste aux tracés. (CARTO, plus sobre, demande désormais une clé nominative : écarté.)
const TUILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function creerCarte() {
  carte = L.map('carte', { scrollWheelZoom: false, zoomSnap: 0.25, zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(carte);
  L.tileLayer(TUILES, { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>', className: 'tuiles' }).addTo(carte);
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
  // Trajets écartés : pointillés gris ronds, dessous, pour montrer tout ce qui a été exploré.
  // Toujours dessinés, même repli fermé : on voit tout ce qui a été calculé et écarté.
  const fond = matchMedia('(prefers-color-scheme: dark)').matches ? '#b4bac4' : '#4b5563';
  for (const r of routes) if (masques.has(r.id) || (!voirDomines && domMap.has(r.id))) L.polyline(allege(r.pts), { color: fond, weight: 4, dashArray: '1 8', lineCap: 'round', opacity: 0.9, interactive: false }).addTo(calque);
  // Le trajet mis en avant : celui que tu as touché, sinon ton choix. Dessiné en dernier, par-dessus les autres.
  const focus = hot !== -1 ? hot : choixId;
  const visibles = routes.filter(r => !masques.has(r.id) && (voirDomines || !domMap.has(r.id))).sort((a, b) => (a.id === focus) - (b.id === focus));
  for (const r of visibles) {
    const i = r.id, cache = domMap.has(i) && !voirDomines, enAvant = i === focus;
    const pts = allege(r.pts), opacite = enAvant ? 1 : cache || hot !== -1 ? 0.25 : 0.6;
    if (enAvant) L.polyline(pts, { color: '#ffffff', weight: 10, opacity: 0.9, interactive: false }).addTo(calque);   // liseré blanc
    // Encadré sur le trajet mis en avant : son prix et sa durée, pour le repérer au milieu des autres.
    if (enAvant && bulles.has(i)) L.tooltip({ permanent: true, direction: 'center', className: 'bulle', interactive: false })
      .setLatLng(along(r.pts, [0.5])[0]).setContent(esc(bulles.get(i))).addTo(calque);
    L.polyline(pts, { color: COLORS[i % COLORS.length], weight: enAvant ? 6 : 4, opacity: opacite, interactive: false, lineJoin: 'round' }).addTo(calque);
    // Un trait large et invisible par-dessus, pour toucher facilement le tracé au doigt.
    if (!cache) {
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
  // Cadrage sur les trajets dessinés : ceux qu'on cache ne doivent pas faire dézoomer.
  const dessines = voirDomines ? routes : visibles;
  const tous = L.latLngBounds(dessines.flatMap(r => [r.pts[0], r.pts.at(-1), ...allege(r.pts).filter((_, j) => j % 20 === 0)]));
  const cle = tous.toBBoxString();
  if (cle !== cadrage) { cadrage = cle; carte.fitBounds(tous, marges()); }
}

// Marges du cadrage : la carte est sous la barre de recherche et le panneau des trajets.
function marges() {
  const large = matchMedia('(min-width: 720px)').matches;
  if (large) return { paddingTopLeft: [$('f').closest('main').getBoundingClientRect().right + 24, 24], paddingBottomRight: [24, 24] };
  const h = $('carte').clientHeight, bas = $('lim').getBoundingClientRect().bottom + scrollY;
  return { paddingTopLeft: [16, Math.min(Math.max(16, bas + 8), h * 0.5)], paddingBottomRight: [16, 40] };
}

function choisirSurCarte(id) {
  hot = id; render();
  const li = document.querySelector(`#list .tr[data-i="${hot}"]`);
  if (li) li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

// Montagne de billets : ils tombent du haut de l'écran et s'empilent en pyramide, puis s'effacent.
function pluieDeBillets() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fete = document.createElement('div');
  fete.className = 'fete'; fete.setAttribute('aria-hidden', 'true');
  let html = '', k = 0;
  for (let rang = 0; rang < 7; rang++) {            // 7 rangées : 7 billets en bas, 1 au sommet
    const n = 7 - rang;
    for (let j = 0; j < n; j++, k++) {
      const x = (j - (n - 1) / 2) * 30, y = -rang * 20;
      html += `<span style="--x:${x}px;--y:${y}px;--r:${Math.round(Math.random() * 360)}deg;--r2:${Math.round(Math.random() * 30 - 15)}deg;--d:${(k * 0.06).toFixed(2)}s">€</span>`;
    }
  }
  fete.innerHTML = html + '<b>Ka-ching !</b>';
  document.body.appendChild(fete);
  setTimeout(() => fete.classList.add('fin'), 3200);
  setTimeout(() => fete.remove(), 3900);
}

// ---------- Exploration approfondie (bouton « Explorer encore ») ----------
// Avancement de la recherche puis de l'exploration : un seul bloc, en bas de la synthèse, avec barre.
const barre = (pc, txt, bouton = '') => `<div class="avance-txt"><span>${txt}</span><span class="pc">${pc} %</span></div>
<div class="route-barre" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc}"><span class="trace" style="width:${pc}%"></span><span class="voiture" style="left:${pc}%"></span></div>${bouton}`;
let compte = 0;   // nombre de trajets comparés, repris dans la ligne d'avancement
const LOUPE = '<svg class="pic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>';
function blocAvancement(nouveaux = derniersNeufs) {
  let h = '';
  if (rech.etat === 'encours') {
    h = barre(Math.min(99, Math.round(100 * rech.fait / Math.max(1, rech.total))), esc(rech.libelle));
  } else if (expl.etat === 'encours') {
    const pc = Math.round(100 * expl.fait / Math.max(1, expl.total));
    h = barre(pc, `Exploration · ${expl.testes} trajets testés${nouveaux ? ` · ${nouveaux} nouveau${nouveaux > 1 ? 'x' : ''}` : ''}`, '<button type="button" class="contour" id="stopx">Arrêter</button>');
  }
  return `<div id="avancement">${h}</div>`;
}
// Bilan, en bas de la liste après l'escalier : combien de trajets comparés, et « Explorer encore » si on n'a pas exploré.
function blocBilan(nouveaux = derniersNeufs) {
  let h = '';
  if (rech.etat === 'fini' && expl.etat !== 'encours') {
    if (expl.etat === 'fini') {
      h = `<span>${compte} trajets comparés · exploration${expl.stop ? ' arrêtée' : ''} : ${nouveaux ? `${nouveaux} nouveau${nouveaux > 1 ? 'x' : ''}` : 'rien de mieux'}</span>`;
    } else {
      const n = expl.etat === 'pret' ? coutPlan(planExploration(trouves, ends.a, ends.b)) : 0;
      h = `<span>${compte} trajets comparés en ${rech.sec} s${rech.echecs ? ` · ${rech.echecs} échec${rech.echecs > 1 ? 's' : ''}` : ''}</span>`
        + (n ? `<button type="button" class="lien" id="explo">${LOUPE}Explorer encore <small>≈ ${String(Math.max(0.5, Math.round(n * 1.5 / 30) / 2)).replace('.', ',')} min</small></button>` : '');
    }
  }
  return `<div id="bilan" class="avance-txt">${h}</div>`;
}
function majAvancement() {
  for (const [id, f] of [['avancement', blocAvancement], ['bilan', blocBilan]]) { const el = $(id); if (el) el.outerHTML = f(); }
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
    ends = { a, b }; hot = -1; routes = []; seq = 0;
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
        $('res').hidden = false; $('lim').hidden = false; $('fond').hidden = false;
        document.body.classList.add('resultats');
        $('pDep').textContent = a.name; $('pArr').textContent = b.name; $('f').classList.add('replie'); $('regl').open = false;
        render();
        // Aux premiers trajets, on remonte en haut : la carte plein écran et la synthèse en haut du panneau.
        if (!defile) {
          defile = true;
          scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
    // Il reste sûrement des économies : l'exploration démarre seule (bouton « Arrêter » pendant).
    if (vautExplorer(ecartMax, compte) && coutPlan(planExploration(trouves, ends.a, ends.b)) > 0) explorer();
  } catch (err) {
    rech = { etat: 'aucune' }; majAvancement();
    st.className = 'err';
    st.textContent = !navigator.onLine || (err && err.message === HORS_LIGNE)
      ? 'Pas de connexion : Radin routier a besoin d\'internet pour calculer les trajets.'
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
  const c = store.get(CKEY) || {};
  profils = store.get(PKEY);
  if (!profils || !Array.isArray(profils.list) || !profils.list.length) {
    const p = nouveauProfil('Compacte essence');
    profils = { list: [p], actif: p.id };
    $('regl').open = true;   // première visite : on montre les réglages
  }
  // Taux d'IK resté sur l'ancien défaut (0,636, 5 CV) sans avoir été touché : il passe au nouveau défaut.
  if (c.ik != null && c.ik === (c.ikDef ?? 0.636) && c.ikDef !== DEF.ik) c.ik = DEF.ik;
  prices = c.prices || {};
  for (const k of CRIT_KEYS) $(k).value = c[k] != null ? c[k] : DEF[k];
  limite = 'limite' in c ? (c.limite === null ? Infinity : c.limite) : LIMITE_DEF;
  $('prixauto').checked = c.prixAuto !== false;   // prix du jour par défaut
  $('rembourse').checked = c.rembourse === true;
  $('prix').disabled = $('prixauto').checked;
  afficherProfil();
}

const prixManuel = c => (prices[c] != null ? prices[c] : FUEL_DEF[c] != null ? FUEL_DEF[c] : DEF.prix);

/** Prix du jour (carburant.js) : autour du lieu `pos` s'il est donné, sinon moyenne nationale. */
let demandePrix = 0;
async function majPrixDuJour(pos) {
  const c = actif().carbu, moi = ++demandePrix;
  if (c === ELEC) {   // pas de flux officiel pour la recharge : prix saisi
    $('prixinfo').textContent = 'Pas de prix du jour pour l\'électricité : prix saisi (environ 0,25 €/kWh à la maison, 0,50 € et plus sur borne rapide).';
    $('prix').disabled = false; return;
  }
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
  $('profRapide').innerHTML = $('prof').innerHTML; $('profRapide').value = p.id;
  $('pnom').value = p.nom;
  $('carbu').value = p.carbu;
  majLibelles(p.carbu);
  $('prix').value = prixManuel(p.carbu);
  if ($('prixauto').checked) majPrixDuJour();
  for (const k of PROF_KEYS) $(k).value = p[k] != null ? p[k] : DEF[k];
  $('pdel').disabled = profils.list.length < 2;
  afficherAssistant();
  render();
}

$('prof').addEventListener('change', () => { profils.actif = $('prof').value; afficherProfil(); });
// Raccourcis : changer de voiture ou de mode recalcule tout de suite les trajets déjà trouvés (sans nouvelle recherche).
$('profRapide').addEventListener('change', () => { profils.actif = $('profRapide').value; afficherProfil(); });
$('proRapide').addEventListener('click', () => { $('rembourse').checked = !$('rembourse').checked; render(); });
$('pnom').addEventListener('input', () => {
  actif().nom = $('pnom').value.trim() || 'Sans nom';
  $('prof').selectedOptions[0].textContent = actif().nom; $('profRapide').selectedOptions[0].textContent = actif().nom; save();
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
  const c = $('carbu').value, avant = actif().carbu; actif().carbu = c;
  // Passage à l'électrique (ou retour au thermique) : si la conso est restée celle par défaut, on prend
  // celle par défaut de l'autre motorisation.
  const parDefaut = (from) => ['cville', 'croute', 'cauto'].every(k => num(k) === (from === ELEC ? CONSO_ELEC[k] : DEF[k]));
  if ((c === ELEC) !== (avant === ELEC) && parDefaut(avant)) for (const k of ['cville', 'croute', 'cauto']) $(k).value = c === ELEC ? CONSO_ELEC[k] : DEF[k];
  majLibelles(c);
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
$('rembourse').addEventListener('change', render);
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
  $('wapp').textContent = 'Appliqué'; setTimeout(() => { $('wapp').textContent = 'Appliquer au profil'; }, 1500);
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

// ---------- Liens de partage : …?de=…&a=…&temps=… remplit le trajet et lance la recherche ----------
function lienDuTrajet() {
  return lienTrajet(location.origin + location.pathname, lieuPourLien(choix.from, $('from').value), lieuPourLien(choix.to, $('to').value), limite);
}
async function partager() {
  const url = lienDuTrajet(), st = $('st');
  try {
    if (navigator.share) { await navigator.share({ title: `Radin routier : ${ends.a.name} → ${ends.b.name}`, url }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }   // partage annulé : rien à faire
  try { await navigator.clipboard.writeText(url); st.className = ''; st.textContent = 'Lien copié.'; setTimeout(() => { if (st.textContent === 'Lien copié.') st.textContent = ''; }, 3000); }
  catch (e) { prompt('Copie ce lien :', url); }
}
const lien = lireTrajet(location.search);
const od = store.get('vpt-od');
if (od) { $('from').value = od.from || ''; $('to').value = od.to || ''; choix = { from: od.cfrom || null, to: od.cto || null }; }
$('f').addEventListener('submit', run);
if (lien) {
  // Lien reçu : on remplit (avec les coordonnées du lien s'il en a : pas de recherche d'adresse) et on nettoie
  // l'adresse (recharger la page ne relance rien). La recherche attend « Comparer » : le temps de vérifier
  // sa voiture et le mode pro (raccourcis au-dessus du bouton).
  const lieu = l => (l.lat != null ? { lat: l.lat, lon: l.lon, name: l.nom } : null);
  $('from').value = lien.de.nom; $('to').value = lien.a.nom; choix = { from: lieu(lien.de), to: lieu(lien.a) };
  if (lien.limite !== null) limite = lien.limite;
  history.replaceState(null, '', location.pathname);
  $('st').className = ''; $('st').textContent = 'Trajet reçu : vérifie ta voiture et le mode, puis « Comparer ».';
}
$('swap').addEventListener('click', () => { const t = $('from').value; $('from').value = $('to').value; $('to').value = t; choix = { from: choix.to, to: choix.from }; });
$('list').addEventListener('click', e => {
  if (e.target.closest('#vdom')) { voirDomines = !voirDomines; render(); return; }
  if (e.target.closest('#explo')) { explorer(); return; }
  if (e.target.closest('#partage')) { partager(); return; }
  if (e.target.closest('#stopx')) { expl.stop = true; return; }
  const sel = e.target.closest('[data-sel]');
  if (sel) {
    hot = +sel.dataset.sel; render();
    const li = document.querySelector(`#list .tr[data-i="${hot}"]`);
    if (li) li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    return;
  }
  const g = e.target.closest('[data-gpx]'); if (g) { gpx(routes.find(r => r.id === +g.dataset.gpx), g.dataset.n); return; }
  if (e.target.closest('a, details')) return;
  const li = e.target.closest('.tr'); if (!li) return;
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

// Plaque départ / arrivée : le crayon rouvre la saisie ; « Calculer » ouvre l'assistant usure.
// « Ma position » : le départ est l'endroit où tu es, comme dans Waze (rien n'est envoyé ailleurs qu'au calcul d'itinéraire).
$('ici').addEventListener('click', () => {
  const st = $('st');
  if (!navigator.geolocation) { st.className = 'err'; st.textContent = 'Position indisponible sur cet appareil.'; return; }
  st.className = ''; st.textContent = 'Recherche de ta position…';
  navigator.geolocation.getCurrentPosition(p => {
    choix.from = { lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), name: 'Ma position' };
    $('from').value = choix.from.name; st.textContent = '';
  }, () => { st.className = 'err'; st.textContent = 'Position refusée ou indisponible : saisis le départ.'; },
  { timeout: 10000, maximumAge: 300000 });
});
$('edit').addEventListener('click', () => { $('f').classList.remove('replie'); $('from').focus(); });
$('reglbtn').addEventListener('click', () => { $('regl').open = !$('regl').open; });
$('regl').addEventListener('toggle', () => $('reglbtn').setAttribute('aria-expanded', String($('regl').open)));
$('wizbtn').addEventListener('click', () => { $('wiz').open = true; $('wiz').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
