// Fichier généré par outils/peages.mjs : ne pas modifier à la main.
// Tarif médian au kilomètre (voitures, classe 1) par autoroute, tarifs 2026.
// Sources : data.gouv.fr (« Tarifs autoroutes APRR », Licence Ouverte 2.0 ; « Gares de péage du réseau routier
// national concédé », ODC-BY) et tarifs internes publiés par VINCI Autoroutes (ASF, Escota, Cofiroute / Arcour).
export const TARIFS_ANNEE = 2026;
/** Autoroute → [€/km, nombre de couples mesurés (0 : médiane de la société), origine]. */
export const TARIFS_KM = {
  A5: [0.085, 68, 'mesuré'],
  A6: [0.091, 196, 'mesuré'],
  A7: [0.099, 116, 'mesuré'],
  A8: [0.118, 12, 'mesuré'],
  A9: [0.1, 101, 'mesuré'],
  A10: [0.109, 153, 'mesuré'],
  A11: [0.114, 34, 'mesuré'],
  A19: [0.175, 68, 'mesuré'],
  A20: [0.108, 10, 'mesuré'],
  A26: [0.097, 6, 'mesuré'],
  A28: [0.167, 56, 'mesuré'],
  A31: [0.088, 50, 'mesuré'],
  A36: [0.09, 28, 'mesuré'],
  A39: [0.092, 24, 'mesuré'],
  A40: [0.127, 49, 'mesuré'],
  A41: [0.125, 18, 'mesuré'],
  A42: [0.109, 12, 'mesuré'],
  A43: [0.136, 42, 'mesuré'],
  A48: [0.128, 0, 'area'],
  A49: [0.125, 6, 'mesuré'],
  A50: [0.119, 0, 'escota'],
  A51: [0.12, 17, 'mesuré'],
  A52: [0.119, 0, 'escota'],
  A54: [0.097, 0, 'asf'],
  A57: [0.119, 0, 'escota'],
  A61: [0.09, 19, 'mesuré'],
  A62: [0.1, 53, 'mesuré'],
  A63: [0.097, 0, 'asf'],
  A64: [0.088, 84, 'mesuré'],
  A66: [0.097, 0, 'asf'],
  A68: [0.097, 0, 'asf'],
  A71: [0.097, 188, 'mesuré'],
  A72: [0.097, 0, 'asf'],
  A81: [0.109, 0, 'cofiroute'],
  A83: [0.096, 34, 'mesuré'],
  A85: [0.079, 6, 'mesuré'],
  A87: [0.093, 7, 'mesuré'],
  A89: [0.111, 46, 'mesuré'],
  A837: [0.097, 0, 'asf']
};
