# Factur-X Reader — mentions légales

Required Notice: Copyright (c) 2026 Christophe Mehault (idée originale et version initiale)
Required Notice: Copyright (c) 2026 Simon Grossi (réécriture Rust / Tauri)

Ce logiciel est distribué sous licence **PolyForm Noncommercial 1.0.0** : voir
[LICENSE.md](LICENSE.md). Seul le texte anglais de la licence fait foi ; le résumé ci-dessous
n'a pas de valeur juridique.

## En résumé

- Le code source est consultable. Chacun peut l'utiliser, le modifier et le redistribuer pour
  un usage **non commercial** (personnel, recherche, enseignement, associations, organismes
  publics).
- Tout **usage commercial** par un tiers est interdit sans accord écrit des titulaires des
  droits.
- Toute copie ou version modifiée doit conserver la licence et les lignes `Required Notice:`
  ci-dessus.

## Droits des auteurs

La licence encadre ce que les **tiers** peuvent faire. Les titulaires des droits, Christophe
Mehault et Simon Grossi, ne sont pas limités par elle : ils restent libres d'utiliser le
logiciel à toutes fins, y compris commerciales, et d'accorder d'autres licences.

Pour un usage commercial : simon.grossi@gmail.com

## Composants tiers embarqués

La licence PolyForm Noncommercial ne couvre que le code de Factur-X Reader. L'application embarque
deux composants qui ne lui appartiennent pas, redistribués sans modification, chacun sous sa
propre licence. Leurs textes sont dans `web/schematron/`, donc dans l'application installée, et
consultables par le menu **Aide → Licences des composants tiers**.

### SaxonJS 2 — moteur XSLT

- Fichier : `web/schematron/SaxonJS2.rt.js`. © Saxonica Ltd. Gratuit, non open source.
- Licence : *SaxonJS Public License* v1.0 —
  [web/schematron/LICENSE-SAXONJS.txt](web/schematron/LICENSE-SAXONJS.txt).
- Ce que la licence permet : la redistribution sous forme binaire, sans modification, en tant
  que partie d'une application qui utilise le logiciel, à condition de reproduire la mention de
  copyright et l'avertissement.
- Ce qu'elle interdit : la rétro-ingénierie, l'usage du nom de Saxonica pour promouvoir
  l'application, et la copie du logiciel sur un site dont le but premier est de le mettre à
  disposition de tiers. Ce dépôt a pour but de distribuer Factur-X Reader, pas SaxonJS ; pour
  obtenir SaxonJS, s'adresser à [saxonica.com](https://www.saxonica.com/).

### Règles de validation EN 16931

- Fichiers : `web/schematron/cii-validation.sef.json` et `ubl-validation.sef.json`.
  © Union européenne, 2017-2026.
- Source : dépôt [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931),
  version 1.3.16. Les fichiers embarqués sont les feuilles XSLT officielles, compilées au format
  SEF de SaxonJS, sans modification des règles. Le code source correspondant est disponible
  librement dans ce dépôt officiel.
- Licence : **EUPL 1.2** — [web/schematron/NOTICE-EINVOICING.txt](web/schematron/NOTICE-EINVOICING.txt).
  Ces fichiers restent sous EUPL 1.2 : la restriction d'usage non commercial de Factur-X Reader
  ne s'y applique pas, et chacun peut les réutiliser aux conditions de l'EUPL.

### Autres dépendances

Les bibliothèques Rust et JavaScript (Tauri, PDF.js, SQLite, lopdf, etc.) restent sous leurs
licences respectives.
