# Radin routier : consignes pour Claude Code

- Le cahier des charges complet est dans `docs/BRIEF.md`. Lis-le avant toute modification et suis sa feuille de route, version par version.
- Le prototype de départ est `index.html` (un seul fichier). La première tâche de la v1 est de le tester contre les vrais serveurs Photon et Valhalla.
- Réponds et commente en français.
- Pile technique : HTML, CSS et JavaScript simples, sans framework, sans dépendance et sans étape de compilation. L'appli doit rester publiable telle quelle sur GitHub Pages.
- Tests : sous Node, sans dépendance (`node --test`). Le modèle de coût doit être testé : décodage des tracés, classement des tronçons, totaux, suppression des doublons.
- Garde visible l'attribution « © contributeurs OpenStreetMap ».
- Ne bombarde pas le serveur public Valhalla : laisse au moins une seconde entre deux requêtes.
- Mobile d'abord : boutons d'au moins 44 px, et un affichage lisible en mode clair comme en mode sombre.
