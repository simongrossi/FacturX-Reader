# Factur-X Reader

Visualiseur **100 % local** de factures électroniques (Factur-X, UBL, CII / EN 16931), en
application de bureau légère pour **Windows, macOS et Linux**.

Déposez une facture — ou un dossier entier — et l'outil affiche :

- le **PDF d'origine** (zoom, navigation page par page, enregistrement) ;
- toutes les **valeurs du XML** en tableaux, avec des titres lisibles en français ;
- les **lignes de facturation** (références, désignations, quantités, prix, TVA, totaux),
  triables, filtrables et **pointables** ;
- le **XML complet** (filtrable par champ, valeur ou chemin) et le **XML brut** (recherche
  avec surlignage).

L'application propose aussi un **accueil avec reprise de session**, des **onglets par
document**, une **recherche rapide avec regex**, un **tableau multi-factures**, le **suivi
de vérification avec commentaires**, une **vue PDF et données côte à côte** et des
**contrôles de cohérence avec rapport JSON exportable**.

Les données ne quittent jamais la machine : aucun serveur, aucun appel réseau, PDF.js embarqué.

## Stack

- **Tauri 2** — fenêtre native s'appuyant sur la WebView du système (exécutable ≈ 7 Mo,
  installeur ≈ 2 Mo) ;
- **Rust** — moteur d'analyse des factures et persistance des pointages ;
- **HTML / CSS / JS sans framework** — le front de `web/` est servi tel quel, sans étape de
  compilation ;
- **PDF.js 3.11** — rendu des PDF.

## Installation

`npm run build` produit les installeurs pour le système utilisé (voir
[Développement](#développement)). Le workflow `release.yml` est configuré pour construire
les trois plateformes à chaque tag `vX.Y.Z` et joindre les paquets à un brouillon de release :

| Système | Formats |
|---|---|
| Windows | `.msi`, `-setup.exe` |
| macOS | `.dmg` (universel Intel + Apple Silicon) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Les builds ne sont pas signés : Windows SmartScreen et macOS Gatekeeper affichent un
avertissement au premier lancement.

Les derniers builds et tests natifs ont été réalisés sous **Windows**. Les tests natifs
macOS/Linux ainsi que l'installation et la désinstallation des paquets restent à réaliser.
Les changements locaux figurent dans **Non publié** ; leur présence dans une release
GitHub n'est pas confirmée. Voir [VALIDATION.md](VALIDATION.md) pour les résultats détaillés.

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

### Vue multi-factures

L'onglet **Toutes les factures** récapitule les documents ouverts (fournisseur, numéro, dates,
HT, TVA, TTC, devise et vérification). Les filtres de la liste s'appliquent aussi au tableau
et à ses totaux : texte dans les références, montants, lignes et commentaires, statut,
masquage des PDF sans XML. Un clic sur un document ouvre sa lecture.

Les totaux sont additionnés en décimal exact et séparés par devise. Les avoirs (racine UBL
CreditNote ou code 381) contribuent négativement, même si leurs montants XML sont déjà
négatifs. Le signe des factures est conservé. Les montants affichés dans chaque ligne restent
ceux du XML. Les valeurs manquantes, devises inconnues et types non identifiés sont exclus
des contributions, avec leur nombre indiqué. Les contrôles détaillés sont disponibles dans
la vue Données et restent indépendants des totaux du tableau et du statut manuel.

### Suivi de vérification

Dans **Données** ou **PDF et données**, le suivi manuel propose **À vérifier**, **Vérifiée**,
**Anomalie**, un commentaire de facture et des commentaires par ligne. Ces informations
restent locales (`fx-review:<empreinte XML>` en localStorage), survivent à la fermeture du
document et sont partagées entre copies du même XML. Elles ne modifient pas la facture et
ne confirment pas son paiement. **Pointer toutes les lignes** utilise le stockage des
pointages existant. Un échec d'enregistrement du suivi est signalé à l'écran.

### Lecture PDF et données côte à côte

**PDF et données** apparaît lorsqu'un PDF est disponible : défilements indépendants et
zoom du PDF mémorisés dans la session. Sur une fenêtre étroite, les panneaux se superposent.
Les filtres du lot se réinitialisent à la relance ; le tableau peut être repris comme vue
de session. Recherche dans le PDF, bibliothèque et dossier surveillé
restent prévus dans [ROADMAP.md](ROADMAP.md).

### Contrôles de cohérence et rapport

Dans **Données** et **PDF et données**, **Contrôles de cohérence** compare les valeurs XML
d'origine : quantité × prix net / quantité de base, remises/frais des lignes, somme des
lignes, remises/frais globaux, bases de TVA par catégorie/taux, TVA, HT/TTC et net à payer
après acomptes et arrondi. Les avoirs conservent leur signe XML pour ces contrôles.
Chaque résultat indique **Conforme au contrôle**, **Écart détecté**, **Non vérifiable** ou
**Non applicable**. L'absence de lignes ne devient pas une anomalie. Cliquer sur un chemin
ouvre le champ XML surligné. **Exporter le rapport de contrôle** propose un fichier JSON
par la boîte native Enregistrer sous : formules, montants, écarts, provenance et politique
de calcul. Une échéance passée est signalée séparément, sans déduire un impayé.

Les calculs utilisent des fractions exactes, puis un arrondi local à deux décimales,
demi-unité éloignée de zéro ; les lignes admettent une tolérance annoncée de 0,02 unité
monétaire. Les nombres XML sont limités à 40 chiffres entiers et 12 décimales ; valeur
invalide, devise incompatible, catégorie ambiguë ou taux absent : non vérifiable.
Les variantes CII anciennes peuvent rester partiellement non vérifiables. Une taxe
explicitement différente de VAT est non applicable au contrôle de TVA.
Ce diagnostic local est distinct de la validation normative EN 16931/PDF/A et du paiement.
Il peut signaler un écart accepté par les tolérances de certaines règles normatives.
Formules de référence : [BR-CO-13](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-13/),
[BR-CO-16](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-16/),
[R120](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/PEPPOL-EN16931-R120/)
et [BR-CO-17](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-17/).
Les contrôles ne sont pas une exécution complète de ces référentiels.

### Formats pris en charge

| Format | Détection | PDF affiché |
|---|---|---|
| Factur-X (PDF) | PDF avec pièce jointe XML (`/Filespec`) UBL ou CII | le PDF lui-même |
| Factur-X (archive ZIP) | ZIP contenant un XML UBL/CII (+ PDF) | extrait du ZIP |
| UBL 2.x (`Invoice`, `CreditNote`) | racine du XML | base64 intégré (`EmbeddedDocumentBinaryObject`) |
| CII (`CrossIndustryInvoice`) | racine du XML, variantes EN 16931 et UN/CEFACT classique | base64 intégré |

Types de facture, unités (UN/ECE), modes de paiement, catégories de TVA et profils sont
traduits en français. Un champ non reconnu est affiché avec son étiquette brute et son chemin.
Les libellés français sont accentués dans les tableaux, synthèses et messages. Pour les
modes de paiement, la valeur source reste visible avec sa traduction (par exemple
`58` : virement SEPA, `59` : prélèvement SEPA), issue du référentiel UNCL4461.

### Recherche rapide

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

### Vues du document

- **PDF** — rendu du PDF (pages, ajuster, zoom, enregistrer).
- **PDF du XML** — présent quand le XML embarque un PDF distinct du fichier déposé.
- **Données** — synthèse (n°, dates, vendeur, acheteur, totaux), lignes de facture, puis détail
  vendeur / acheteur / livraison / paiement / totaux, suivi manuel et contrôles de cohérence.
  Chaque cellule de données est cliquable : valeur,
  chemin XML, copie, saut vers la ligne correspondante dans « XML complet ».
- **PDF et données** — affichage côte à côte avec défilements séparés, lorsqu'un PDF est disponible.
- **XML complet** — toutes les valeurs du document dans l'ordre, avec filtre instantané.
- **XML brut** — XML réindenté (préfixes d'origine conservés), recherche avec surlignage.

Sur le tableau des **lignes de facture** :

- **Tri** par clic sur un en-tête de colonne ;
- **Recherche** en direct (compteur « N / total ») ;
- **Pointage** d'une ligne (pastille à gauche), filtre *Toutes / Pointées / Non pointées*,
  effacement des pointages et commande **Pointer toutes les lignes** dans le suivi de vérification ;
- **Détail** d'une ligne : tous ses champs XML, y compris les balises propres à un fournisseur ;
- **Colonnes de note** : une note de ligne de la forme `libellé : valeur | libellé : valeur`
  est éclatée en colonnes.

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
- **Au démarrage** — reprendre la dernière session (défaut) ou afficher l'accueil ;
- **Copies locales** — taille du cache, nettoyage des copies inutilisées et effacement de l'historique ;
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
  workspace.js, batch.js    session, vue multi-factures et suivi manuel
  checks.js                contrôles rationnels sur les feuilles XML
  search-worker.js         recherche regex hors du fil de l'interface
  pdfjs/                   PDF.js embarqué
src-tauri/
  src/facturx.rs           moteur : PDF Factur-X, ZIP, UBL, CII
  src/tables.rs            libellés français et tables de codes
  src/pointages.rs         persistance des pointages
  src/lib.rs               commandes exposées au front
  examples/dump.rs         export JSON d'une facture
  tests/samples.rs         test sur les factures de samples/
  tauri.conf.json          fenêtre, CSP, bundles
samples/                   factures réelles pour les tests locaux (non versionné)
tests/                     fixtures synthétiques, calculs, navigateur et test natif Windows
.github/workflows/         vérifications CI et builds Windows / macOS / Linux
```

### Tests

Les tests de l'interface ont leur dépendance Playwright dans `package-lock.json` :

```bash
npm ci
npx playwright install chromium
npm run check:js
npm run test:checks
npm run test:ui
npm run test:rust
```

Pour utiliser Edge déjà installé sous PowerShell :

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:ui
```

Le workflow `.github/workflows/checks.yml` lance les tests de calcul, navigateur et Rust à chaque push
et pull request. Les tests navigateur simulent uniquement les commandes Rust ; le rendu
PDF utilise le vrai PDF.js et une facture synthétique de deux pages. Ils couvrent aussi
les deux portées de recherche, quotas et copie manquante, historique, session invalide et
restauration de 500 documents, tableau multi-factures, suivi manuel, double lecture,
contrôles et rapport JSON. Les tests de calcul couvrent notamment UBL/CII, avoirs, TVA
par taux, remises/frais, acomptes, arrondis et données manquantes.

Sous Windows, un test distinct lance le véritable exécutable dans un profil WebView2 jetable,
sans changer la session de l'utilisateur. Il valide Rust, PDF, zoom/position, arrêt du processus
et relance, reprise des copies locales, fichier manquant, recherche, tableau CII,
contrôles TTC, absence de lignes et suivi manuel :

```powershell
cargo build --manifest-path src-tauri/Cargo.toml
npm run test:native
# Pour le binaire de production déjà construit :
$env:FACTURX_TEST_EXE = 'src-tauri/target/release/facturx-reader.exe'
npm run test:native
```

Le port de débogage WebView2 est activé uniquement par ce processus de test, avec un profil
temporaire supprimé à la fin. La vérification native macOS/Linux et l'installation des
paquets se font séparément sur leurs systèmes respectifs. Le dialogue d'enregistrement
du rapport n'est pas automatisé dans ce scénario ; son contenu et ses erreurs sont
vérifiés avec la commande simulée dans les tests navigateur.

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
| `save_control_report` | boîte « Enregistrer sous » et écriture du rapport JSON (20 Mo maximum) |
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

Les travaux locaux du **2 octobre 2026** couvrent P0, les libellés français de P1 et les
deux premiers lots P2 : tableau multi-factures, suivi manuel, double lecture, contrôles de
cohérence et rapport JSON. Ils figurent dans **Non publié** du changelog.

Dernière validation : **12 tests de calcul**, **9 scénarios navigateur**, **10 tests
unitaires Rust**, analyse des factures locales et **test natif Windows** réussis.
Voir [VALIDATION.md](VALIDATION.md) pour la portée et les limites de ces vérifications.

Prochaine étape prévue : **recherche dans le texte du PDF avec surlignage**. L'export
CSV/Excel, les associations de fichiers et l'instance unique, la bibliothèque persistante,
le dossier surveillé, la validation normative, la signature des builds et les connecteurs
API/MCP restent dans la roadmap. Les connecteurs ne sont pas implémentés actuellement.
