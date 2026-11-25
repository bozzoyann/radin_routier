// Fichier généré par outils/peages.mjs : ne pas modifier à la main.
// Tarif médian au kilomètre (voitures, classe 1) par autoroute, tarifs au 1er février 2026.
// Sources : data.gouv.fr, « Tarifs autoroutes APRR » (APRR et AREA, Licence Ouverte 2.0)
// et « Gares de péage du réseau routier national concédé » (ODC-BY).
export const TARIFS_ANNEE = 2026;
/** Autoroute → [€/km, nombre de couples entrée-sortie mesurés]. */
export const TARIFS_KM = {
  A5: [0.085, 68],
  A6: [0.091, 196],
  A19: [0.183, 8],
  A26: [0.097, 6],
  A31: [0.088, 50],
  A36: [0.09, 28],
  A39: [0.092, 24],
  A40: [0.127, 49],
  A41: [0.125, 18],
  A42: [0.109, 12],
  A43: [0.136, 42],
  A49: [0.125, 6],
  A71: [0.096, 80]
};
