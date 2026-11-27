// Accès aux serveurs publics : Photon (adresses) et Valhalla FOSSGIS (itinéraires).

export const VALHALLA = 'https://valhalla1.openstreetmap.de/route?json=';
export const PHOTON_BASE = 'https://photon.komoot.io/api/?lang=fr&lat=46.6&lon=2.4';
export const PHOTON = PHOTON_BASE + '&limit=1&q=';

/** Délai minimal entre deux requêtes Valhalla (serveur public partagé). */
export const DELAI_VALHALLA = 1100;

/** 10 réglages pour obtenir des trajets variés. Les plus contrastés d'abord, pour afficher vite des choix différents. */
export const PROFILES = [
  { auto: { use_tolls: 1, use_highways: 1 }, alt: 2 },
  { auto: { use_tolls: 0, use_highways: 0 }, alt: 0 },
  { auto: { use_tolls: 0, use_highways: 1 }, alt: 1 },
  { auto: { shortest: true }, alt: 0 },
  { auto: { use_tolls: 0.5, use_highways: 1 }, alt: 0 },
  { auto: { use_tolls: 0, use_highways: 0.4 }, alt: 0 },
  // Ajoutés en v1.7 après un banc d'essai : péage faible ou autoroute modérée, avec variantes.
  { auto: { use_tolls: 0.2, use_highways: 1 }, alt: 2 },
  { auto: { use_tolls: 1, use_highways: 0.6 }, alt: 2 },
  { auto: { use_tolls: 0.2, use_highways: 0.6 }, alt: 2 },
  { auto: { use_tolls: 1, use_highways: 0.2 }, alt: 2 }
];

/** Lit « lat, lon » saisi directement. Renvoie null si ce n'en est pas. */
export function parseLatLon(q) {
  const ll = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (!ll) return null;
  const lat = +ll[1], lon = +ll[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon, name: q.trim() } : null;
}

/** Construit l'URL GET Valhalla (GET : pas de requête préalable CORS). */
export function routeUrl(a, b, prof) {
  const req = {
    locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }],
    costing: 'auto', costing_options: { auto: prof.auto },
    units: 'kilometers', language: 'fr-FR', directions_type: 'maneuvers'
  };
  if (prof.alt) req.alternates = prof.alt;
  return VALHALLA + encodeURIComponent(JSON.stringify(req));
}

export async function geocode(q, fetchFn = fetch) {
  const ll = parseLatLon(q);
  if (ll) return ll;
  const r = await fetchFn(PHOTON + encodeURIComponent(q));
  if (!r.ok) throw new Error('recherche d\'adresse indisponible');
  const d = await r.json(), f = d.features && d.features[0];
  if (!f) throw new Error(`lieu introuvable : « ${q} »`);
  return lieu(f, q);
}

/** Départements de métropole : repli quand Photon ne donne pas de code postal (cas des villes entières). */
const DEPARTEMENTS = Object.fromEntries('Ain=01|Aisne=02|Allier=03|Alpes-de-Haute-Provence=04|Hautes-Alpes=05|Alpes-Maritimes=06|Ardèche=07|Ardennes=08|Ariège=09|Aube=10|Aude=11|Aveyron=12|Bouches-du-Rhône=13|Calvados=14|Cantal=15|Charente=16|Charente-Maritime=17|Cher=18|Corrèze=19|Corse-du-Sud=2A|Haute-Corse=2B|Côte-d\'Or=21|Côtes-d\'Armor=22|Creuse=23|Dordogne=24|Doubs=25|Drôme=26|Eure=27|Eure-et-Loir=28|Finistère=29|Gard=30|Haute-Garonne=31|Gers=32|Gironde=33|Hérault=34|Ille-et-Vilaine=35|Indre=36|Indre-et-Loire=37|Isère=38|Jura=39|Landes=40|Loir-et-Cher=41|Loire=42|Haute-Loire=43|Loire-Atlantique=44|Loiret=45|Lot=46|Lot-et-Garonne=47|Lozère=48|Maine-et-Loire=49|Manche=50|Marne=51|Haute-Marne=52|Mayenne=53|Meurthe-et-Moselle=54|Meuse=55|Morbihan=56|Moselle=57|Nièvre=58|Nord=59|Oise=60|Orne=61|Pas-de-Calais=62|Puy-de-Dôme=63|Pyrénées-Atlantiques=64|Hautes-Pyrénées=65|Pyrénées-Orientales=66|Bas-Rhin=67|Haut-Rhin=68|Rhône=69|Haute-Saône=70|Saône-et-Loire=71|Sarthe=72|Savoie=73|Haute-Savoie=74|Paris=75|Seine-Maritime=76|Seine-et-Marne=77|Yvelines=78|Deux-Sèvres=79|Somme=80|Tarn=81|Tarn-et-Garonne=82|Var=83|Vaucluse=84|Vendée=85|Vienne=86|Haute-Vienne=87|Vosges=88|Yonne=89|Territoire de Belfort=90|Essonne=91|Hauts-de-Seine=92|Seine-Saint-Denis=93|Val-de-Marne=94|Val-d\'Oise=95'.split('|').map(x => x.split('=')));
// Variantes rencontrées dans OpenStreetMap.
DEPARTEMENTS['Rhône'] = '69'; DEPARTEMENTS['Métropole de Lyon'] = '69';

/** Transforme un résultat Photon en lieu : coordonnées, nom court (avec département) et précision. */
export function lieu(f, q = '') {
  const p = f.properties || {};
  const code = p.postcode ? String(p.postcode).slice(0, 2) : DEPARTEMENTS[p.county] || DEPARTEMENTS[p.state];
  const dep = code && (!p.country || p.country === 'France') ? ` (${code})` : '';
  const nom = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || q;
  const ville = p.city && p.city !== nom ? p.city : '';
  const detail = [ville, p.postcode, p.country && p.country !== 'France' ? p.country : ''].filter(Boolean).join(' · ');
  return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: nom + dep, detail };
}

/** Suggestions d'adresses pendant la frappe (5 au plus, doublons retirés). */
export async function suggest(q, { signal, fetchFn = fetch } = {}) {
  if (q.trim().length < 3 || parseLatLon(q)) return [];
  const r = await fetchFn(`${PHOTON_BASE}&limit=6&q=${encodeURIComponent(q)}`, { signal });
  if (!r.ok) return [];
  const d = await r.json(), out = [], vus = new Set();
  for (const f of d.features || []) {
    const l = lieu(f, q), k = l.name + '|' + l.detail;
    if (!vus.has(k)) { vus.add(k); out.push(l); }
  }
  return out.slice(0, 5);
}

/** Un calcul Valhalla : renvoie le trajet principal et ses variantes. */
export async function route(a, b, prof, fetchFn = fetch) {
  const r = await fetchFn(routeUrl(a, b, prof));
  let d = {};
  try { d = await r.json(); } catch (e) { /* réponse non JSON (serveur saturé) */ }
  if (r.status === 429) throw new Error('serveur saturé');
  if (!r.ok || !d.trip) throw new Error(d.error || `erreur ${r.status}`);
  return [d.trip, ...(d.alternates || []).map(x => x.trip)];
}

/**
 * Lien de partage d'un trajet : …?de=…&dep=lat,lon&a=…&arr=lat,lon&temps=… (temps : minutes en plus acceptées,
 * « inf » : peu importe). Les coordonnées évitent qu'un nom soit mal retrouvé (« Gare d'Orléans » est aussi
 * l'ancien nom de Paris-Austerlitz). `de`, `a` : {nom, pos} (pos : « lat,lon » ou absent).
 */
export function lienTrajet(base, de, a, limite) {
  const q = new URLSearchParams({ de: de.nom });
  if (de.pos) q.set('dep', de.pos);
  q.set('a', a.nom);
  if (a.pos) q.set('arr', a.pos);
  q.set('temps', isFinite(limite) ? String(limite) : 'inf');
  return `${base}?${q}`;
}

/** Lit un lien de partage (la partie « ?… » de l'adresse). Renvoie {de, a, limite} ou null ;
 *  de, a : {nom, lat, lon} (coordonnées absentes si le lien n'en a pas) ; limite : null si absente. */
export function lireTrajet(search) {
  const q = new URLSearchParams(search), nomDe = (q.get('de') || '').trim(), nomA = (q.get('a') || '').trim();
  if (!nomDe || !nomA) return null;
  const lieu = (nom, pos) => { const p = pos && parseLatLon(pos); return p ? { nom, lat: p.lat, lon: p.lon } : { nom }; };
  const t = q.get('temps');
  const limite = t === 'inf' ? Infinity : t !== null && t !== '' && Number.isFinite(+t) && +t >= 0 ? +t : null;
  return { de: lieu(nomDe, q.get('dep')), a: lieu(nomA, q.get('arr')), limite };
}

/**
 * Un lieu pour un lien : son nom sans le département ajouté à l'affichage (« Lyon (69) » → « Lyon ») et ses
 * coordonnées à 4 décimales (une dizaine de mètres). « Ma position » devient « Position partagée », arrondie
 * à 3 décimales (une centaine de mètres). `l` : le lieu choisi ({lat, lon, name}) ou null ; `texte` : le champ.
 */
export function lieuPourLien(l, texte) {
  if (l && l.name === 'Ma position') return { nom: 'Position partagée', pos: `${l.lat.toFixed(3)},${l.lon.toFixed(3)}` };
  const nom = String(texte).replace(/\s*\((\d{2}|2A|2B)\)\s*$/, '');
  return l ? { nom, pos: `${l.lat.toFixed(4)},${l.lon.toFixed(4)}` } : { nom };
}
