<div align="center">

<img src="web/logo/icon.svg" width="112" alt="Logo Factur-X Reader">

# Factur-X Reader

**Lisez, contrôlez et exploitez vos factures électroniques, sans que rien ne quitte votre poste.**

Application de bureau légère pour Factur-X, UBL et CII (EN 16931) — Windows, macOS et Linux.

[![Version](https://img.shields.io/github/v/release/simongrossi/FacturX-Reader?include_prereleases&label=version&color=0b6bcb)](https://github.com/simongrossi/FacturX-Reader/releases)
[![Tests](https://img.shields.io/github/actions/workflow/status/simongrossi/FacturX-Reader/checks.yml?branch=main&label=tests)](https://github.com/simongrossi/FacturX-Reader/actions/workflows/checks.yml)
[![Téléchargements](https://img.shields.io/github/downloads/simongrossi/FacturX-Reader/total?label=t%C3%A9l%C3%A9chargements&color=0f8a5f)](https://github.com/simongrossi/FacturX-Reader/releases)
[![Licence](https://img.shields.io/badge/licence-PolyForm%20Noncommercial-b4610a)](LICENSE.md)
![Plateformes](https://img.shields.io/badge/plateformes-Windows%20%7C%20macOS%20%7C%20Linux-5b6878)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-moteur-dea584?logo=rust&logoColor=white)

[**Télécharger**](https://github.com/simongrossi/FacturX-Reader/releases) ·
[Fonctionnalités](#fonctionnalités) ·
[Comparatif](#comparatif) ·
[Utilisation](#utilisation) ·
[Roadmap](ROADMAP.md) ·
[Changelog](CHANGELOG.md)

<img src="docs/screenshots/controles.png" width="900" alt="Onglet Données : synthèse de la facture et contrôles de cohérence, avec un écart d'un centime sur le total TTC">

</div>

## En bref

Déposez une facture, ou un dossier entier. Factur-X Reader affiche le PDF, traduit le XML en
tableaux lisibles en français, **recalcule les montants** et signale ce qui ne colle pas.

- **100 % local** : aucun serveur, aucun appel réseau, aucun compte. La bibliothèque est un
  fichier sur votre poste, désactivable.
- **Léger** : exécutable d'environ 7 Mo, installeur d'environ 2 Mo.
- **Pensé pour vérifier**, pas seulement pour afficher : contrôles, pointage, suivi, exports.

> Version de développement (0.y.z). Les builds ne sont pas signés : Windows SmartScreen et
> macOS Gatekeeper affichent un avertissement au premier lancement.

## Fonctionnalités

| | |
|---|---|
| 📄 **Lecture** | PDF Factur-X, archive ZIP, XML UBL 2.x et CII. PDF d'origine, données en tableaux, XML complet et XML brut. |
| 📐 **Règles EN 16931** | Une soixantaine de règles métier de la norme évaluées sur chaque facture : mentions obligatoires, calculs, décimales, catégories de TVA. |
| ✅ **Contrôles de cohérence** | Calculs en décimaux exacts : lignes, HT, TVA par taux, TTC, net à payer. Mentions essentielles, clés SIREN/SIRET, n° de TVA et IBAN, échéance, escompte. |
| 📊 **Tableau multi-factures** | Toutes les factures ouvertes sur une page : totaux par devise, avoirs déduits, filtres d'anomalies, export CSV. |
| 🗄️ **Bibliothèque locale** | Toutes les factures déjà ouvertes, retrouvables entre les sessions. Signale un IBAN nouveau pour un fournisseur, un doublon dans l'historique, une variation de prix unitaire. |
| 🪟 **PDF et données côte à côte** | Vérifiez une ligne sans changer d'onglet. |
| 🖊️ **Pointage et suivi** | Pointage des lignes, statut À vérifier / Vérifiée / Anomalie, commentaires par facture et par ligne. |
| 🔎 **Recherche** | Texte ou regex, dans le document ou dans tous les documents ouverts, avec surlignage. |
| 📤 **Exports** | Lignes et tableau en CSV, rapport de contrôle en JSON, copie en CSV, JSON ou Markdown par clic droit. |
| 🖨️ **Impression** | La vue affichée (données, contrôles, tableau, PDF) sans l'habillage de l'application. |
| 🗂️ **Confort** | Onglets par document, reprise de session, documents récents, barre de menus, thèmes clair et sombre. |

<table>
<tr>
<td width="50%"><img src="docs/screenshots/tableau.png" alt="Tableau des factures ouvertes avec totaux par devise et état des contrôles"></td>
<td width="50%"><img src="docs/screenshots/pdf-et-donnees.png" alt="Vue PDF et données côte à côte"></td>
</tr>
<tr>
<td align="center"><sub>Tableau multi-factures : totaux, avoirs déduits, anomalies</sub></td>
<td align="center"><sub>PDF et données côte à côte</sub></td>
</tr>
</table>

<sub>Captures réalisées avec des factures entièrement fictives (`npm run screenshots`).</sub>

## Comparatif

Comparaison avec des outils gratuits courants pour ouvrir une facture électronique. Même quand
une case est cochée des deux côtés, le niveau de détail peut différer.

| | Factur-X Reader | [Quba Viewer](https://github.com/ZUGFeRD/quba-viewer) | [Mustang](https://www.mustangproject.org/) | Lecteur PDF classique |
|---|:---:|:---:|:---:|:---:|
| Type | Application de bureau | Application de bureau | Bibliothèque et ligne de commande | Application de bureau |
| Technologie | Rust, Tauri | Electron, XSLT | Java | — |
| Windows, macOS, Linux | ✅ | ✅ | ✅ (Java) | ✅ |
| Fonctionne hors ligne | ✅ | ✅ | ✅ | ✅ |
| Affiche le PDF | ✅ | ✅ | — | ✅ |
| Affiche les données du XML | ✅ | ✅ | HTML (expérimental) | — |
| PDF et données côte à côte | ✅ | ✅ | — | — |
| Plusieurs factures en onglets | ✅ | ✅ | — | — |
| Recherche | ✅ texte et regex | ✅ | — | Texte du PDF |
| Impression | ✅ | ✅ | — | ✅ |
| Contrôles arithmétiques détaillés | ✅ | — | Via la validation | — |
| Règles métier EN 16931 | ✅ natif, hors ligne | ✅ en ligne | ✅ | — |
| Schematron officiel, XSD, PDF/A-3 | — *(prévu)* | ✅ en ligne | ✅ | — |
| Tableau multi-factures avec totaux | ✅ | — | — | — |
| Pointage, statuts et commentaires | ✅ | — | — | — |
| Historique : alerte de changement d'IBAN, prix, doublons | ✅ | — | — | — |
| Export CSV / rapport JSON | ✅ | — | — | — |
| Conversion (CII ↔ UBL, ZUGFeRD 1 → 2) | — | — | ✅ | — |
| Création de factures | — | — | ✅ | — |
| Interface en français | ✅ | ✅ | — | Selon l'outil |
| Licence | PolyForm Noncommercial | Apache 2.0 | Apache 2.0 | Selon l'outil |

<sub>Établi le 2 octobre 2026 d'après la documentation publique de chaque projet ; une case vide
signifie « non documenté à cette date », pas forcément « impossible ». Corrections bienvenues.
Factur-X Reader évalue les règles métier de la norme avec sa propre implémentation, pas avec le
Schematron officiel, et ne contrôle ni le schéma XSD ni le conteneur PDF/A-3 : pour une
validation de conformité opposable, Mustang ou Quba restent les bons outils.</sub>

## Téléchargement

Les installeurs sont sur la page [Releases](https://github.com/simongrossi/FacturX-Reader/releases) :

| Système | Fichier |
|---|---|
| Windows | `Factur-X.Reader_x.y.z_x64-setup.exe` ou `.msi` |
| macOS (Intel et Apple Silicon) | `Factur-X.Reader_x.y.z_universal.dmg` |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Ils sont produits par le workflow GitHub à chaque tag `vX.Y.Z`, ou localement par `npm run build`
(voir [Développement](#développement)).

## Stack

- **Tauri 2** — fenêtre native s'appuyant sur la WebView du système ;
- **Rust** — moteur d'analyse, contrôles de cohérence, persistance des pointages ;
- **SQLite** embarqué — bibliothèque locale ;
- **HTML / CSS / JS sans framework** — le front de `web/` est servi tel quel, sans étape de
  compilation ;
- **PDF.js 3.11** — rendu des PDF.

## Utilisation

### Accueil et reprise du travail

L'onglet **Accueil** propose l'ouverture de fichiers ou d'un dossier, les paramètres,
les douze derniers documents et la reprise de la dernière session. Chaque facture possède
son propre onglet, avec fermeture par la croix, clic central ou `Ctrl+W`.
`Ctrl+Tab` et `Ctrl+Maj+Tab` passent d'un document à l'autre.

Par défaut, les documents ouverts et le document actif sont restaurés au lancement, avec
leur vue PDF / Données / XML, leur position de défilement et leur zoom mémorisés.
Le réglage **Paramètres → Au démarrage → Afficher l'accueil** permet une reprise manuelle.
Les fichiers passés au lancement prennent priorité sur la restauration automatique.

Les fichiers ouverts par leur chemin sont relus sur le disque. Les fichiers choisis via
le sélecteur web ou déposés sont conservés en copie locale dans IndexedDB pour leur
réouverture ; cette copie ne suit pas les modifications du fichier d'origine.
Les métadonnées de session sont stockées localement dans la WebView. Un fichier manquant
est signalé sans bloquer les autres documents. Les pointages conservent leur stockage habituel.

La session est limitée à **500 documents** et les copies locales à **256 Mo**. Une copie qui
ne peut pas être enregistrée est signalée ; la lecture du document reste possible pour la
session courante, mais sa réouverture exige le fichier d'origine. Les copies qui ne servent
plus aux récents ni à la session sont nettoyées automatiquement. Dans les paramètres,
**Nettoyer les copies inutilisées** et **Effacer l'historique** conservent les documents
nécessaires à la session ; les pointages restent dans leur fichier habituel.

### Ouvrir des factures

| Action | Comment |
|---|---|
| Ajouter des fichiers | bouton **Ajouter des fichiers** ou `Ctrl+O` |
| Ouvrir un dossier (sous-dossiers compris) | bouton **Ouvrir un dossier** ou `Ctrl+Maj+O` |
| Glisser-déposer | des fichiers **ou un dossier** n'importe où dans la fenêtre |
| Ligne de commande | `facturx-reader facture.pdf dossier/ autre.xml` |

Dans un dossier, seuls les `.pdf`, `.xml` et `.zip` sont retenus (500 fichiers au maximum,
dossiers cachés ignorés). Un PDF sans XML de facture apparaît dans la liste avec son erreur.

Dans le panneau **Fichiers** : **🗑** vide la liste, **✕** (au survol) retire un fichier,
**‹ / ›** replie le panneau.

### Formats pris en charge

| Format | Détection | PDF affiché |
|---|---|---|
| Factur-X (PDF) | PDF avec pièce jointe XML (`/Filespec`) UBL ou CII | le PDF lui-même |
| Factur-X (archive ZIP) | ZIP contenant un XML UBL/CII (+ PDF) | extrait du ZIP |
| UBL 2.x (`Invoice`, `CreditNote`) | racine du XML | base64 intégré (`EmbeddedDocumentBinaryObject`) |
| CII (`CrossIndustryInvoice`) | racine du XML, variantes EN 16931 et UN/CEFACT classique | base64 intégré |

Types de facture, unités (UN/ECE), modes de paiement, catégories de TVA et profils sont
traduits en français. Un champ non reconnu est affiché avec son étiquette brute et son chemin.

### Onglets

La barre de recherche rapide (`Ctrl+F`, ou `Cmd+F`) recherche dans les champs, valeurs,
attributs et chemins XML. Le sélecteur de portée propose **Document sélectionné** (par défaut)
ou **Tous les documents ouverts**. En mode document, changer d'onglet de facture relance
la recherche sur cette facture. Sur l'accueil, sélectionnez une facture ou passez en mode tous
les documents ; la recherche ne change pas de portée implicitement.
L'option **Regex** accepte une
expression régulière, sans délimiteurs (ex. `FAC-2026-\d+`). La recherche ignore la casse.
Chaque résultat ouvre la facture dans **XML complet** et surligne l'élément en jaune.
Utilisez les flèches ou `Entrée` / `Maj+Entrée` pour naviguer ; `Échap` efface la recherche.
Les PDF et les contenus binaires ne sont pas recherchés. Les regex trop lentes sont interrompues.
Le compteur compte les éléments XML correspondants, pas les occurrences dans chaque valeur.
Le surlignage jaune porte sur la ligne de l'élément trouvé.

- **PDF** — rendu du PDF (pages, ajuster, zoom, enregistrer).
- **PDF du XML** — présent quand le XML embarque un PDF distinct du fichier déposé.
- **PDF et données** — les deux côte à côte, chacun avec son défilement (présent quand la
  facture a un PDF).
- **Données** — synthèse (n°, dates, vendeur, acheteur, totaux), lignes de facture, puis détail
  vendeur / acheteur / livraison / paiement / totaux. Chaque cellule est cliquable : valeur,
  chemin XML, copie, saut vers la ligne correspondante dans « XML complet ».
- **XML complet** — toutes les valeurs du document dans l'ordre, avec filtre instantané.
- **XML brut** — XML réindenté (préfixes d'origine conservés), recherche avec surlignage.

Sur le tableau des **lignes de facture** :

- **Tri** par clic sur un en-tête de colonne ;
- **Recherche** en direct (compteur « N / total ») ;
- **Pointage** d'une ligne (pastille à gauche), filtre *Toutes / Pointées / Non pointées*,
  effacement des pointages ;
- **Détail** d'une ligne : tous ses champs XML, y compris les balises propres à un fournisseur ;
- **Colonnes de note** : une note de ligne de la forme `libellé : valeur | libellé : valeur`
  est éclatée en colonnes.

### Contrôles

L'onglet **Données** affiche un bloc **Contrôles**, déplié dès qu'il y a un écart ou une alerte :

- **Calculs** en décimaux exacts : quantité × prix unitaire = total de ligne, somme des lignes,
  total HT, TVA par taux, total TVA, total TTC, net à payer. Un écart d'un centime est signalé ;
  seul l'arrondi du prix unitaire est toléré sur les lignes, et un centime sur la TVA par taux.
- **Mentions essentielles** : numéro, date, type, devise, vendeur, acheteur.
- **Identifiants** : clé de contrôle du SIREN/SIRET, du n° de TVA français et de l'IBAN.
- **Dates** : échéance dépassée ou à venir, gain d'escompte si le XML le décrit.
- **Doublons** parmi les documents ouverts : XML identique, ou même vendeur et même numéro.

Chaque ligne donne l'attendu, le constaté et l'écart ; un clic ouvre l'élément dans « XML complet ».
Les états sont *conforme*, *écart*, *alerte*, *info* et *non vérifiable* (donnée absente du XML).
Une facture avec écart porte une pastille rouge dans la liste des fichiers.

Ces contrôles ne sont pas une validation EN 16931 (XSD / Schematron) : voir la roadmap. Aucun
appel réseau : l'existence du SIREN ou la propriété de l'IBAN ne sont pas vérifiées.

### Règles EN 16931

Le bloc **Règles EN 16931** de l'onglet Données liste les règles métier de la norme évaluées
sur la facture, celles qui ne sont pas respectées en premier, avec leur identifiant officiel
(`BR-07`, `BR-CO-15`, `BR-S-08`…). Un clic ouvre l'élément concerné dans « XML complet ».

| Famille | Ce qui est vérifié |
|---|---|
| `BR-01` à `BR-16` | Mentions obligatoires : identifiant de spécification, numéro, date, type, devise, vendeur, acheteur, adresses, totaux, au moins une ligne |
| `BR-21` à `BR-27` | Chaque ligne : identifiant, quantité, unité, montant net, nom de l'article, prix net non négatif |
| `BR-31` à `BR-38`, `BR-45` à `BR-49`, `BR-61` | Remises et frais de niveau document, ventilation de TVA, moyen de paiement |
| `BR-CO-03` à `BR-CO-26` | Calculs et cohérence : sommes, total HT, TVA, TTC, montant à payer, échéance, identification du vendeur |
| `BR-DEC` | Montants à deux décimales au plus |
| `BR-S`, `BR-Z`, `BR-E`, `BR-AE`, `BR-IC`, `BR-G`, `BR-O` | Règles par catégorie de TVA : ventilation présente, identifiants fiscaux, taux, base, montant, motif d'exonération |

Limites, à connaître avant de s'y fier :

- c'est une **implémentation native** écrite d'après l'énoncé des règles, pas le Schematron
  officiel : elle peut diverger sur des cas particuliers ;
- **non couverts** : le schéma XSD, les listes de codes (hors catégories de TVA), les règles
  nationales (CIUS, XRechnung), le conteneur PDF/A-3 et ses métadonnées ;
- pour les profils Factur-X **MINIMUM** et **BASIC WL**, hors norme EN 16931, seules les règles
  qui ont un objet sont évaluées.

Les factures qui enfreignent une règle portent une pastille dans la liste et se filtrent dans le
tableau. Le rapport JSON contient le détail de toutes les règles.

### Impression

**Fichier → Imprimer** (`Ctrl+P`) imprime la vue affichée : données et contrôles, tableau des
factures, XML ou pages du PDF. L'habillage de l'application est retiré, les blocs repliés sont
dépliés et le thème clair est utilisé le temps de l'impression.

### Suivi de vérification et rapport

Sous les contrôles, le bloc **Suivi de vérification** porte un statut manuel (*À vérifier*,
*Vérifiée*, *Anomalie*), un commentaire de facture, des commentaires par ligne et le bouton
**Pointer toutes les lignes**. Ce suivi est enregistré localement, associé à l'empreinte du XML ;
il ne dit rien du paiement. Le statut se retrouve dans le tableau multi-factures. Voir
[Protection des pointages et du suivi](#protection-des-pointages-et-du-suivi).

**Rapport JSON** (en-tête du bloc Contrôles, ou menu Fichier) enregistre la synthèse de la
facture, tous les contrôles et le suivi de vérification.

### Export des lignes

**Exporter CSV** enregistre les lignes affichées (recherche, filtre de pointage et tri appliqués)
dans un fichier lisible par Excel : séparateur point-virgule, UTF-8, décimale française, devise
dans sa propre colonne, colonne « Pointée ». **Copier** place le même tableau dans le presse-papiers.

### Tableau multi-factures

Dès qu'un document est ouvert, l'onglet **Tableau** (à côté d'Accueil) liste toutes les factures
ouvertes : fichier, vendeur, numéro, type, date, échéance, HT, TVA, TTC, à payer, devise et état
des contrôles. Un clic sur une ligne ouvre la facture.

- **Tri** par clic sur un en-tête, **filtre** texte.
- **Filtre d'anomalies** : écart de calcul, alerte, échéance dépassée, sans TVA, émise un
  week-end, doublon, avoirs, documents non lus.
- **Totaux par devise** sur les lignes affichées ; les avoirs sont déduits.
- **Exporter CSV** / **Copier** : le tableau affiché, plus les jours avant échéance et le détail
  des contrôles en écart ou en alerte.

Les montants viennent du XML, sans recalcul. Le tableau porte sur les documents ouverts
(500 au maximum), pas sur un historique.

### Bibliothèque locale

Chaque facture analysée est enregistrée dans une base locale (`bibliotheque.sqlite`, dans le
dossier de données de l'application) : numéro, dates, vendeur, acheteur, montants, IBAN et lignes
(référence, désignation, quantité, prix unitaire). Le PDF et le XML n'y sont pas copiés.

L'onglet **Bibliothèque**, à côté d'Accueil et de Tableau, liste ces factures entre les sessions :

- **Recherche** par fournisseur, numéro, date, montant, nom de fichier, référence ou désignation
  d'article (1000 résultats au plus) ;
- un clic **rouvre la facture** depuis son emplacement d'origine. Un fichier ajouté par dépôt n'a
  pas d'emplacement connu : l'application le dit et demande de rouvrir le fichier ;
- **✕** retire une facture de la bibliothèque, sans toucher au fichier.

À l'ouverture d'une facture, la bibliothèque ajoute trois constats aux contrôles :

| Constat | Déclenchement |
|---|---|
| **IBAN différent des factures précédentes** (alerte) | Le fournisseur a déjà des factures avec un IBAN, et celui de cette facture n'y figure pas. À vérifier auprès du fournisseur par un canal connu avant de payer. |
| **Doublon probable dans la bibliothèque** (alerte) | Même fournisseur et même numéro qu'une facture déjà vue, avec un contenu différent. |
| **Prix unitaire modifié** (info) | Le prix d'un article diffère du dernier prix connu chez ce fournisseur, sur une facture antérieure. |

Le fournisseur est reconnu par son n° de TVA, à défaut son identifiant légal, à défaut son nom.
Un article est reconnu par sa référence, à défaut sa désignation. Dans le détail d'une ligne,
**Historique des prix** montre le prix de l'article sur toutes les factures du fournisseur.

Limites : la bibliothèque ne connaît que les factures ouvertes au moins une fois sur ce poste ;
la première facture d'un fournisseur ne peut donc déclencher aucune alerte. Elle n'est pas
incluse dans l'export des pointages et du suivi : rouvrir un dossier de factures la reconstitue,
sauf les dates de première vue.

*Paramètres → Données* permet de désactiver la bibliothèque, de la vider, ou de la réinitialiser
si la base est illisible (elle est alors conservée à côté, jamais supprimée).

### Barre de menus

La barre **Fichier / Édition / Affichage / Aide** regroupe les actions : ouvrir, exporter,
fermer, rechercher, copier, changer de vue ou de document. Les raccourcis y sont rappelés.
Les onglets **Accueil** et **Tableau** restent fixes à gauche de la barre d'onglets.

### Clic droit

Sur un onglet ou un fichier de la liste : ouvrir, fermer, fermer les autres, fermer les
documents en erreur, copier le nom ou le chemin.


Un clic droit sur une cellule de n'importe quel tableau propose : copier la cellule, la ligne
(avec ou sans en-têtes), la colonne ou le tableau affiché ; copier la ligne ou le tableau en
**CSV**, **JSON** ou **Markdown** ; copier le chemin XML, voir l'élément dans « XML complet »,
rechercher la valeur. Les champs de saisie gardent le menu du système (couper, copier, coller).

### Pointages

Les lignes pointées sont enregistrées automatiquement et retrouvées à la réouverture de la même
facture. Elles sont indexées par l'empreinte SHA-256 du XML, dans `pointages.json` :

| Système | Emplacement |
|---|---|
| Windows | `%APPDATA%\com.simongrossi.facturxreader\` |
| macOS | `~/Library/Application Support/com.simongrossi.facturxreader/` |
| Linux | `~/.local/share/com.simongrossi.facturxreader/` |

Le **suivi de vérification** (statuts et commentaires) est enregistré de la même façon dans
`suivi.json`, dans le même dossier.

**Mode portable** : si un `pointages.json` ou un `suivi.json` se trouve à côté de l'exécutable,
c'est lui qui est utilisé. Le chemin effectif est affiché dans les Paramètres.

### Protection des pointages et du suivi

- **Sauvegarde quotidienne** : avant la première modification de chaque jour, le fichier est copié
  en `pointages.sauvegarde-AAAA-MM-JJ.json` (ou `suivi.sauvegarde-…`). Les sept dernières sont
  conservées.
- **Un fichier illisible n'est jamais écrasé** : s'il est corrompu ou vide, l'application le
  signale dès le démarrage, refuse toute écriture et n'affiche pas un historique vide à la place.
- **Restauration** : *Paramètres → Données → Restaurer la dernière sauvegarde* remet en place la
  sauvegarde lisible la plus récente. Le fichier illisible est conservé à côté, renommé
  `…illisible-<date>.json`.
- **Exporter / Importer** : un seul fichier JSON contient pointages et suivi. L'import fusionne :
  une entrée absente est ajoutée, une entrée existante n'est remplacée que si celle du fichier
  est plus récente.

Les suivis saisis avec la version 0.4.0, alors stockés dans la WebView, sont repris dans
`suivi.json` au premier lancement.

### Paramètres

Le bouton **⚙** (ou `Ctrl+,`) ouvre les Paramètres ; chaque réglage est appliqué immédiatement
et mémorisé :

- **Thème** — Clair (défaut), Sombre, Système (suit l'OS) ou Girl ;
- **Densité des tableaux** — Confortable ou Compacte ;
- **Onglet affiché en premier** — PDF ou Données ;
- **Zoom du PDF par défaut** — 75 % à 200 %, ou « Ajuster à la largeur » ;
- **Fichier des pointages** — emplacement, avec copie du chemin ;
- **Pointages et suivi de vérification** — état des fichiers, export, import, restauration.

## Développement

Prérequis : [Rust](https://rustup.rs), Node.js et les
[dépendances système de Tauri](https://tauri.app/start/prerequisites/) (WebView2 sous Windows,
`libwebkit2gtk-4.1` sous Linux).

```bash
npm install      # une fois : installe la CLI Tauri
npm run dev      # lance l'application en développement
npm run build    # exécutable + installeurs dans src-tauri/target/release/bundle/
```

### Structure

```
web/                       interface (aucune étape de compilation)
  index.html, app.js, style.css
  workspace.js             accueil, onglets, session
  batch.js                 tableau multi-factures
  review.js                suivi de vérification, rapport de contrôle
  library.js               bibliothèque locale, historique des prix
  menu.js                  menus contextuels (tableaux, onglets)
  menubar.js               barre de menus
  pdfjs/                   PDF.js embarqué
src-tauri/
  src/facturx.rs           moteur : PDF Factur-X, ZIP, UBL, CII
  src/facturx/controles.rs contrôles de cohérence (décimaux exacts)
  src/facturx/en16931.rs   règles métier EN 16931
  src/tables.rs            libellés français et tables de codes
  src/pointages.rs         pointages et suivi : persistance, sauvegardes, export/import
  src/bibliotheque.rs      bibliothèque locale (SQLite) : historique, IBAN, doublons, prix
  src/lib.rs               commandes exposées au front
  examples/dump.rs         export JSON d'une facture
  tests/samples.rs         test sur les factures de samples/
  tauri.conf.json          fenêtre, CSP, bundles
samples/                   factures réelles pour les tests locaux (non versionné)
.github/workflows/         build des installeurs Windows / macOS / Linux
```

### Tests

Les tests de l'interface ont leur dépendance Playwright dans `package-lock.json` :

```bash
npm ci
npx playwright install chromium
npm run check:js
npm run test:ui
npm run test:rust
```

Pour utiliser Edge déjà installé sous PowerShell :

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:ui
```

Le workflow `.github/workflows/checks.yml` lance les tests navigateur et Rust à chaque push
et pull request. Les tests navigateur simulent uniquement les commandes Rust ; le rendu
PDF utilise le vrai PDF.js et une facture synthétique de deux pages. Ils couvrent aussi
les deux portées de recherche, quotas et copie manquante, historique, session invalide et
restauration de 500 documents.

Sous Windows, un test distinct lance le véritable exécutable dans un profil WebView2 jetable,
sans changer la session de l'utilisateur. Il valide Rust, PDF, zoom/position, arrêt du processus
et relance, reprise des copies locales, fichier manquant et recherche :

```powershell
cargo build --manifest-path src-tauri/Cargo.toml
npm run test:native
# Pour le binaire de production déjà construit :
$env:FACTURX_TEST_EXE = 'src-tauri/target/release/facturx-reader.exe'
npm run test:native
```

Le port de débogage WebView2 est activé uniquement par ce processus de test, avec un profil
temporaire supprimé à la fin. La variable `FACTURX_DATA_DIR` y place aussi pointages et suivi :
le test n'écrit jamais dans vos données. L'exécutable embarque l'interface à la compilation :
relancez `cargo build` après toute modification de `web/`. La vérification native macOS/Linux et l'installation des
paquets se font séparément sur leurs systèmes respectifs.

```bash
cd src-tauri
cargo test
```

- tests unitaires du moteur (UBL, CII, ZIP, PDF, fichiers rejetés, parcours de dossier) ;
- `tests/samples.rs` analyse chaque fichier de `samples/` : il doit donner une facture UBL ou
  CII avec des lignes. Un fichier dont le nom contient `PAS DE XML` doit au contraire être
  rejeté. Sans dossier `samples/`, ce test est sans effet.

`samples/` contient des **factures réelles** : il est exclu du dépôt par `.gitignore`. Pour
couvrir un nouveau fournisseur, il suffit d'y déposer une de ses factures.

Pour inspecter ce que le moteur extrait d'un fichier :

```bash
cd src-tauri
cargo run --example dump -- ../samples/facture.pdf > facture.json
```

### Commandes exposées au front

| Commande | Rôle |
|---|---|
| `parse_file` | analyse des octets reçus (fichier choisi ou déposé) |
| `parse_path` | analyse d'un fichier désigné par son chemin |
| `pick_folder` | sélecteur de dossier natif, renvoie les fichiers factures trouvés |
| `startup_paths` | fichiers et dossiers passés en ligne de commande |
| `get_pointage` / `set_pointage` / `clear_pointage` | pointages d'une facture |
| `get_reviews` / `set_review` | suivi de vérification |
| `data_status` / `restore_backup` | état des fichiers de données, restauration d'une sauvegarde |
| `export_data` / `import_data` | export et import des pointages et du suivi |
| `library_search` / `library_prices` | recherche dans la bibliothèque, historique des prix d'un article |
| `library_status` / `library_remove` / `library_clear` / `library_reset` | état et entretien de la bibliothèque |
| `save_pdf` | boîte « Enregistrer sous » et écriture du PDF |
| `save_text` | boîte « Enregistrer sous » et écriture d'un export CSV |
| `save_control_report` | boîte « Enregistrer sous » et écriture du rapport de contrôle JSON |
| `print_window` | boîte d'impression du système |
| `app_info` | version et emplacement des pointages |

## Auteurs et licence

- **Christophe Mehault** — idée originale et version initiale (moteur d'analyse, interface,
  pointage des lignes).
- **Simon Grossi** — reprise du projet et réécriture en application de bureau Rust / Tauri.

Licence **[PolyForm Noncommercial 1.0.0](LICENSE.md)** : code source consultable, usage non
commercial autorisé, usage commercial par un tiers soumis à l'accord écrit des auteurs. Les
auteurs restent libres de tout usage. Détails dans [NOTICE.md](NOTICE.md).

## Suite

Voir [ROADMAP.md](ROADMAP.md) pour les évolutions envisagées et [CHANGELOG.md](CHANGELOG.md)
pour l'historique.

Les travaux locaux du 2 octobre 2026 (recherche, accueil, onglets et reprise de session)
sont décrits dans la section **Non publié** du changelog. Leur test navigateur utilise des
commandes Tauri simulées. P0 inclut désormais une vérification native Windows et la gestion
du cache ; les vérifications natives sur macOS/Linux restent à réaliser.
Voir [VALIDATION.md](VALIDATION.md) pour le bilan P0 et les limites des vérifications.
