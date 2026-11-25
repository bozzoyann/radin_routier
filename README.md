# 🐢💸 Radin routier

> Parce qu'une minute ne vaut pas 15 € de péage.

Waze te fait faire 50 km de détour et payer 15 € de péage pour gagner une minute ? Radin routier compare plusieurs itinéraires et affiche, pour chacun, **le temps et le vrai coût** : carburant (selon le type de route), usure de la voiture et péage. Il classe les trajets, et c'est toi qui choisis.

## Mode d'emploi

1. Ouvre la page (GitHub Pages). En local, sers le dossier (`python3 -m http.server`) : les modules JavaScript ne se chargent pas en double-cliquant sur `index.html`.
2. Règle ta voiture une fois : carburant, prix du litre, consommation en ville, sur route et sur autoroute, usure au km, valeur de ton heure.
3. Tape le départ et l'arrivée, puis trie par temps, par euros ou par compromis. Le bouton « Google Maps ↗ » ou le fichier GPX t'emmène sur la route choisie.

## Comment ça calcule

Les euros d'un trajet = carburant + usure + péage.

- **Carburant** : chaque tronçon est classé en autoroute, route ou ville, avec la consommation correspondante.
- **Usure** : 7 c€/km par défaut, estimé pour une compacte essence à fort kilométrage.
- **Péage** : estimé à 0,10 €/km sur les tronçons payants.

Le classement « compromis » ajoute le temps passé, compté au prix de ton heure. Le détail est dans [`docs/BRIEF.md`](docs/BRIEF.md).

## État du projet

C'est un prototype : il n'a pas encore été testé contre les vrais serveurs. La feuille de route est dans le brief.

## Tests

```sh
node --test
```

Sans dépendance. Couvre le décodage des tracés, le classement des tronçons, les totaux, la suppression des doublons et la construction des requêtes.

## Crédits

- Itinéraires : [Valhalla](https://valhalla.github.io/valhalla/), via le serveur public FOSSGIS.
- Adresses : [Photon](https://photon.komoot.io).
- Données : © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright).
