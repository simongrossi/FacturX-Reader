# Factur-X Reader

Visualiseur **100 % local** de factures électroniques (Factur-X, UBL, CII / EN 16931), en
application de bureau légère pour **Windows, macOS et Linux**.

Déposez une facture — ou un dossier entier — et l'outil affiche :

- le **PDF d'origine** (zoom, navigation page par page, enregistrement) ;
- toutes les **valeurs du XML** en tableaux, avec des titres lisibles en français ;
- les **lignes de facturation** (références, désignations, quantités, prix, TVA, totaux),
  triables, filtrables, **pointables** et **exportables en CSV** ;
- des **contrôles de cohérence** : calculs, mentions, identifiants, échéance, doublons ;
- le **XML complet** (filtrable par champ, valeur ou chemin) et le **XML brut** (recherche
  avec surlignage).

Les données ne quittent jamais la machine : aucun serveur, aucun appel réseau, PDF.js embarqué.

## Stack

- **Tauri 2** — fenêtre native s'appuyant sur la WebView du système (exécutable ≈ 7 Mo,
  installeur ≈ 2 Mo) ;
- **Rust** — moteur d'analyse des factures et persistance des pointages ;
- **HTML / CSS / JS sans framework** — le front de `web/` est servi tel quel, sans étape de
  compilation ;
- **PDF.js 3.11** — rendu des PDF.

## Installation

Les installeurs sont produits par `npm run build` (voir [Développement](#développement)) ou
par le workflow GitHub à chaque tag `vX.Y.Z` :

| Système | Formats |
|---|---|
| Windows | `.msi`, `-setup.exe` |
| macOS | `.dmg` (universel Intel + Apple Silicon) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Les builds ne sont pas signés : Windows SmartScreen et macOS Gatekeeper affichent un
avertissement au premier lancement.

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

**Mode portable** : si un `pointages.json` se trouve à côté de l'exécutable, c'est lui qui est
utilisé. Le chemin effectif est affiché dans les Paramètres.

### Paramètres

Le bouton **⚙** (ou `Ctrl+,`) ouvre les Paramètres ; chaque réglage est appliqué immédiatement
et mémorisé :

- **Thème** — Clair (défaut), Sombre, Système (suit l'OS) ou Girl ;
- **Densité des tableaux** — Confortable ou Compacte ;
- **Onglet affiché en premier** — PDF ou Données ;
- **Zoom du PDF par défaut** — 75 % à 200 %, ou « Ajuster à la largeur » ;
- **Fichier des pointages** — emplacement, avec copie du chemin.

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
  menu.js                  menus contextuels (tableaux, onglets)
  menubar.js               barre de menus
  pdfjs/                   PDF.js embarqué
src-tauri/
  src/facturx.rs           moteur : PDF Factur-X, ZIP, UBL, CII
  src/facturx/controles.rs contrôles de cohérence (décimaux exacts)
  src/tables.rs            libellés français et tables de codes
  src/pointages.rs         persistance des pointages
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
temporaire supprimé à la fin. La vérification native macOS/Linux et l'installation des
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
| `save_pdf` | boîte « Enregistrer sous » et écriture du PDF |
| `save_text` | boîte « Enregistrer sous » et écriture d'un export CSV |
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
