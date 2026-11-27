# Radin routier : consignes pour Claude Code

- Le cahier des charges complet est dans `docs/BRIEF.md`. Lis-le avant toute modification et suis sa feuille de route, version par version.
- Le prototype de départ est `index.html` (un seul fichier). La première tâche de la v1 est de le tester contre les vrais serveurs Photon et Valhalla.
- Réponds et commente en français.
- Pile technique : HTML, CSS et JavaScript simples, sans framework, sans dépendance et sans étape de compilation. L'appli doit rester publiable telle quelle sur GitHub Pages.
- Tests : sous Node, sans dépendance (`node --test`). Le modèle de coût doit être testé : décodage des tracés, classement des tronçons, totaux, suppression des doublons.
- Garde visible l'attribution « © contributeurs OpenStreetMap ».
- Ne bombarde pas le serveur public Valhalla : laisse au moins une seconde entre deux requêtes.
- Mobile d'abord : boutons d'au moins 44 px, et un affichage lisible en mode clair comme en mode sombre.
- Version : à chaque modification publiée, augmente `VERSION` et `VERSION_DATE` en tête de `app.js` (1.0.x pour une correction, 1.x.0 pour une nouveauté). Elle s'affiche en haut de la page pour vérifier que le navigateur a la dernière version.
- Appli installable (PWA) : `sw.js` reste minimal, sans cache (l'appli ne peut rien calculer hors ligne, et on veut toujours la dernière version).
- Style : appli de navigation, moderne et sobre (carte plein écran, recherche flottante, pilules, panneau arrondi par-dessus la carte ou sur le côté en écran large ; bleu roi #1c3f94, coins arrondis, ombres douces, police Inter). Pas d'émoji dans l'interface (pictogrammes SVG dessinés), textes courts, factuels et impersonnels, sans tutoiement ni vouvoiement (« −65 € pour +1 h 19 », « Recommandé », « Saisir le départ »), une seule page (« Comment c'est calculé » se déplie sur place), rien à tirer ou glisser pour voir l'essentiel.
