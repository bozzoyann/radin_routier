// Ouvrages à péage (ponts, tunnels, viaducs) : un prix fixe au lieu du péage estimé au kilomètre.
// Fonctions pures, testées sous Node (tests/ouvrages.test.js).
import { dkm, dSegment } from './mixtes.js';

/** Année des tarifs : à mettre à jour chaque année (les péages changent au 1er février). */
export const TARIFS_OUVRAGES = 2026;

const entre = (date, [m1, j1], [m2, j2]) => {   // date comprise entre deux jours de l'année (bornes incluses)
  const x = (date.getMonth() + 1) * 100 + date.getDate();
  return x >= m1 * 100 + j1 && x <= m2 * 100 + j2;
};

/**
 * Prix voiture (classe 1) en 2026. `p` : un point sur l'ouvrage, relevé sur les tracés Valhalla.
 * `verifier` : sources en désaccord, prix à confirmer. `paye` : sens payant seulement (de → vers).
 */
export const OUVRAGES = [
  { nom: 'Viaduc de Millau', p: [44.079, 3.022], prix: d => (entre(d, [6, 15], [9, 15]) ? 13.8 : 11.3) },
  { nom: 'Pont de Normandie', p: [49.432, 0.274], prix: () => 6.1 },
  { nom: 'Pont de Tancarville', p: [49.473, 0.465], prix: () => 2.9 },
  { nom: 'Tunnel du Mont-Blanc', p: [45.859, 6.908], prix: () => 55.5 },
  { nom: 'Tunnel du Fréjus', p: [45.139, 6.693], prix: () => 55.5 },
  { nom: "Pont de l'île de Ré", p: [46.169, -1.237], prix: d => (entre(d, [6, 20], [9, 11]) ? 16 : 8), verifier: true,
    paye: { de: [46.1756, -1.2162], vers: [46.1623, -1.2581] } },   // payé vers l'île seulement
  { nom: 'Tunnel Maurice-Lemaire', p: [48.2726, 7.1565], prix: () => 6.8, verifier: true },
  { nom: 'Tunnel du Puymorens', p: [42.5646, 1.8112], prix: () => 7.8, verifier: true },
  { nom: 'Tunnel Prado-Carénage', p: [43.2873, 5.3824], prix: () => 3.3, verifier: true },
  { nom: 'Duplex A86', p: [48.8274, 2.157], prix: () => 8, verifier: true }   // de 2 à 15 € selon l'heure : prix moyen
];

/**
 * Ouvrages traversés par un trajet analysé (voir cost.js analyse : `pts` et `peages`, les tronçons payants).
 * Un ouvrage compte s'il est à moins de `tol` km d'un tronçon payant ; ce tronçon est alors facturé
 * au prix de l'ouvrage au lieu du prix au kilomètre. Renvoie [{nom, prix, km, verifier, gratuit}].
 */
export function ouvragesTraverses(r, date = new Date(), { tol = 1, ouvrages = OUVRAGES } = {}) {
  const out = [];
  for (const o of ouvrages) {
    for (const seg of r.peages || []) {
      let d = Infinity;
      for (let j = Math.max(seg.i0 + 1, 1); j <= seg.i1 && j < r.pts.length; j++) d = Math.min(d, dSegment(o.p, r.pts[j - 1], r.pts[j]));
      if (d > tol) continue;
      // Sens gratuit (pont de Ré au retour) : le tronçon ne coûte rien, mais il est retiré du prix au kilomètre.
      const debut = r.pts[seg.i0];
      const gratuit = !!o.paye && dkm(debut, o.paye.de) > dkm(debut, o.paye.vers);
      out.push({ nom: o.nom, prix: gratuit ? 0 : o.prix(date), km: seg.km, verifier: !!o.verifier, gratuit });
      break;
    }
  }
  return out;
}
