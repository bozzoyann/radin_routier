# 🐢💸 Radin routier

> Parce qu'une minute ne vaut pas 15 € de péage.

Waze te fait faire 50 km de détour et payer 15 € de péage pour gagner une minute ? Radin routier compare plusieurs itinéraires et affiche, pour chacun, **le temps et le vrai coût** : carburant (selon le type de route), usure de la voiture et péage. Il classe les trajets, et c'est toi qui choisis.

## Mode d'emploi

1. Ouvre la page (GitHub Pages). En local, sers le dossier (`python3 -m http.server`) : les modules JavaScript ne se chargent pas en double-cliquant sur `index.html`.
2. Règle ta voiture une fois (un profil par voiture) : carburant, prix du litre, consommation en ville, sur route et sur autoroute, usure au km. L'assistant calcule l'usure à partir de tes factures. Tes réglages restent dans ton navigateur.
3. Tape le départ et l'arrivée, puis trie par temps, par euros ou par compromis. Le bouton « Google Maps ↗ » ou le fichier GPX t'emmène sur la route choisie.

## Comment ça calcule

En plus de 6 calculs classiques, l'appli cherche des **trajets mixtes** : sans autoroute là où elle fait un détour, autoroute là où elle est directe. Elle repère seule les points de bascule, sans qu'on lui indique d'étape.


Les euros d'un trajet = carburant + usure + péage.

- **Carburant** : chaque tronçon est classé en autoroute, route ou ville, avec la consommation correspondante.
- **Usure** : 7 c€/km par défaut, estimé pour une compacte essence à fort kilométrage.
- **Péage** : estimé à 0,09 €/km sur les tronçons payants.

Le classement « compromis » ajoute le temps passé, compté au prix de ton heure. Le détail est dans [`docs/BRIEF.md`](docs/BRIEF.md).

## État du projet

v1 en cours : testée contre les vrais serveurs (Toulouse → Lyon : 7 trajets en 10 s). Reste la mise en ligne sur GitHub Pages. La feuille de route est dans le brief.

## Tests

```sh
node --test
```

Sans dépendance. Couvre le décodage des tracés, le classement des tronçons, les totaux, la suppression des doublons et la construction des requêtes.

## Crédits

- Itinéraires : [Valhalla](https://valhalla.github.io/valhalla/), via le serveur public FOSSGIS.
- Adresses : [Photon](https://photon.komoot.io).
- Carte : [Leaflet](https://leafletjs.com) (licence BSD-2, copié dans `vendor/leaflet/`) et tuiles OpenStreetMap.
- Données : © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright).

## Licence

© 2026 bozzoyann. Le code de Radin routier est publié sous licence **GNU AGPL-3.0 ou ultérieure** (fichier [`LICENSE`](LICENSE)) : il peut être réutilisé et modifié, mais toute version modifiée, y compris mise en ligne comme service web, doit publier son code sous la même licence.

Éléments tiers, qui gardent leur propre licence :

- [Leaflet](https://leafletjs.com) (`vendor/leaflet`) : licence BSD 2-Clause, voir `vendor/leaflet/LICENSE`.
- Fond de carte et données d'itinéraire : © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Tarifs APRR et AREA : data.gouv.fr, Licence Ouverte ; gares de péage : data.gouv.fr, ODC-BY ; tarifs VINCI Autoroutes : publiés par la société.
- Villes : Insee (Licence Ouverte) et GeoNames (CC-BY 4.0).
- Prix des carburants : ministère de l'Économie (Licence Ouverte).
