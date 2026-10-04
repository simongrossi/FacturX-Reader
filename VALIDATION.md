# Validation — 0.7.1 publiée et développements 0.8.0, 4 octobre 2026

Bilan de ce qui a été vérifié pour cette version, et de ce qui ne l'a pas été.
Les commandes sont décrites dans [README.md](README.md#tests).

## Livraison et vérification distante

Les PR #1 et #2 sont fusionnées dans `main` :
[préparation de la 0.7.1 (#1)](https://github.com/simongrossi/FacturX-Reader/pull/1), puis
[comparaison des validateurs et corrections XSD (#2)](https://github.com/simongrossi/FacturX-Reader/pull/2).
Les tests navigateur, Rust, natifs Windows et de comparaison aux références de la PR #2 sont
verts dans le [workflow Checks](https://github.com/simongrossi/FacturX-Reader/actions/runs/37161670374).
Ces travaux, les exports Excel/PDF (PR #3), le centre d’anomalies (PR #4) et la revue d’un lot
(PR #5) sont distribués dans la [préversion 0.7.1](https://github.com/simongrossi/FacturX-Reader/releases/tag/v0.7.1).
Le tag `v0.7.1` pointe sur `a9b2641`. Son [workflow Release](https://github.com/simongrossi/FacturX-Reader/actions/runs/37203787025)
a réussi sur macOS, Linux et Windows et a produit sept fichiers d’installation ou archives.
Tous les jobs de la
[PR #5](https://github.com/simongrossi/FacturX-Reader/actions/runs/37194887243) sont verts
(navigateur, Rust/natif Windows et références), comme ceux du
[contrôle de `main` après la PR #3](https://github.com/simongrossi/FacturX-Reader/actions/runs/37192860140).
L’échéancier de la [PR #6](https://github.com/simongrossi/FacturX-Reader/pull/6) a été fusionné ensuite (`b129daf`) pour la 0.8.0 ; ses jobs navigateur, Rust/natif Windows et références sont verts.

Pour le développement 0.8.0 de la provenance TVA par taux, les tests locaux passent :
`npm run check:js`, 26 scénarios Playwright, 69 tests Rust réussis (3 ignorés) et le test
`samples.rs`. Les nouveaux cas couvrent deux ventilations CII au même taux, une ventilation
UBL incomplète, et l’accès depuis l’anomalie à la bonne occurrence et à son champ XML. Le
contrôle de formatage Rust global reste non applicable sans reformater de nombreux fichiers
préexistants ; `git diff --check` est propre.
La [PR #9](https://github.com/simongrossi/FacturX-Reader/pull/9) est fusionnée (`cec5e33`) :
ses jobs navigateur, références et Rust/natif Windows sont verts. Le contrôle de `main` après
fusion est suivi séparément.

Le dossier surveillé et l’affichage décimal des lignes ont été vérifiés localement sur la branche
de développement 0.8.0 : `npm run check:js`, 28 scénarios navigateur (choix, stabilisation,
pause, annulation et reprise après redémarrage), 71 tests Rust réussis (3 ignorés) et
`samples.rs`. Les tests Rust couvrent le relevé borné du dossier et les prix/TVA de ligne UBL/CII
reconstitués en décimaux exacts. Le test natif Windows et les références seront vérifiés en CI.

L’[inventaire des branches](docs/BRANCHES.md) explique leur intégration et les repères d’archive.
Les résultats détaillés sont dans [tests/reference/REPORT.md](tests/reference/REPORT.md).

## Vérifications réalisées

| Vérification | Résultat / portée |
|---|---|
| `npm run check:js` | Syntaxe de tous les scripts de l'interface |
| `npm run test:rust` | 63 tests unitaires réussis sous macOS le 4 octobre (3 tests longs ignorés) : bibliothèque (filtres avant pagination sur 1002 factures, réassociation par empreinte), imports (archive ambiguë, plafonds de décompression), exemples officiels français, règles BR-FR (fonctions, périmètre), conteneur PDF (déclarations, sept contrôles de structure), schéma XSD (XML d'origine validé, chargement des huit schémas, facture et avoir UBL, choix d'après le profil, exemple officiel valide, élément inconnu, attribut inconnu, montant non numérique, jamais « valide » sans évaluation), Schematron officiel (compilation de toutes les règles, suite de tests officielle de la Commission, exemples officiels, règles enfreintes, file de travail, résultat repris de la bibliothèque entre deux sessions, résultats identiques avec et sans optimisations), moteur UBL/CII, contrôles en décimaux exacts, règles EN 16931, conteneur PDF (déclarations lues, écarts), pointages et suivi (corruption, sauvegarde, restauration, fusion), bibliothèque SQLite |
| Test Rust `samples.rs` | Factures réelles vérifiées sur le poste d’origine ; sous macOS le 4 octobre, test sans effet car `samples/` est absent |
| `npm run test:ui` | 22 scénarios navigateur pour la 0.7.1, puis 23 sur `main` après l’échéancier, sous Chromium/macOS le 4 octobre ; commandes Rust simulées, PDF.js réel |
| `npm run test:native` | Vrai exécutable Windows, vraies commandes Rust, profil WebView2 et dossier de données jetables. Vert en local et sur la machine de GitHub |
| Workflow `Checks` | Tests navigateur (Linux), Rust et test natif Windows, comparaison aux références (macOS) verts sur la PR #2 avant fusion et sur `main` après les exports (PR #3) |
| Essai manuel macOS (4 octobre 2026) | Fonctionnement général confirmé par l’utilisateur ; détails de présentation à améliorer. Fonctions précises et mode d’installation non documentés |
| `npm run test:reference` | 955 XML : 1 208 comparaisons Schematron concordent avec SaxonC-HE 12.9 ; 955 verdicts XSD concordent avec libxml2 2.9.13, dont 433 invalides. Exécution locale et job macOS de la PR #2 réussis |
| Workflow `Release` | Tag `v0.7.1` : jobs macOS, Linux et Windows verts ; sept fichiers publiés en préversion, non signés |

### Ce que couvre le test natif Windows

Reprise d'un PDF de deux pages après fermeture et relance (zoom, position), recherche, tableau
multi-factures et ses totaux, contrôles calculés par le moteur, vue PDF et données, suivi écrit
dans `suivi.json`, bibliothèque SQLite (enregistrement unique d'un même XML, recherche, filtres
appliqués dans la base, réouverture, réassociation d'un fichier par son empreinte), rapport JSON
complet, synthèse des vérifications, plafond de décompression, fichiers `pointages.json` et `suivi.json` corrompus à la main : signalés au
démarrage, laissés intacts à l'écriture, puis restaurés depuis une sauvegarde.

### Schematron officiel

- Les 806 règles CII et les 979 règles UBL officielles se compilent toutes (test automatisé).
- **Règles Factur-X 1.09.2** des profils MINIMUM, BASIC WL, BASIC et EXTENDED : 66, 337, 472 et
  1464 règles, toutes compilées. Le jeu appliqué suit le profil annoncé ; une devise hors liste
  de codes et des lignes dans une facture annoncée MINIMUM sont signalées (tests automatisés).
  L'évaluation optimisée donne les mêmes résultats que l'évaluation littérale sur ces règles.
- Sur les trois factures réelles EXTENDED locales, aucune règle bloquante Factur-X n'est
  enfreinte. L'une d'elles enfreignait trois règles EN 16931 de la Commission pour un centime
  d'écart, que le profil EXTENDED tolère.
- **Règles françaises EXTENDED-CTC-FR 1.4.0.04** : 773 règles CII et 953 règles UBL, toutes
  compilées ; évaluation optimisée identique à l'évaluation littérale. Trois exemples officiels
  sont rejoués à chaque `cargo test`.
- **Exemples officiels du FNFE-MPE** (dépôt France_RFE), essayés une fois hors dépôt : les 41
  factures d'exemple — CII et UBL aux profils EN 16931 et EXTENDED-CTC-FR, Factur-X BASIC WL,
  EN 16931 et EXTENDED — n'enfreignent aucune règle bloquante du jeu de règles de leur profil,
  n'ont aucune règle non évaluable et sont valides contre leur schéma XSD. Les six factures
  réelles locales au profil EXTENDED-CTC-FR non plus.
- **Règles BR-FR 1.4.0.04** : 171 règles CII et 175 règles UBL, toutes compilées, une fois leurs
  dix-neuf fonctions et leurs variables globales écrites dans les expressions. Les 41 exemples
  officiels les respectent toutes ; un numéro de facture trop long enfreint `BR-FR-01`, une
  facture franco-française sans mentions obligatoires enfreint `BR-FR-05` ; une facture adressée
  à l'étranger n'y est pas soumise (tests automatisés). Les 19 factures réelles locales, toutes
  franco-françaises, n'en enfreignent aucune.
- **Comparaison reproductible à SaxonC-HE** : Factur-X MINIMUM, BASIC WL, BASIC, EXTENDED,
  EXTENDED-CTC-FR et BR-FR CII/UBL, avec variantes invalides ; erreurs, gravités, occurrences,
  chemins et compteurs identiques. [Bilan et limites](tests/reference/REPORT.md). MINIMUM et
  BASIC sont couverts par des fixtures, sans facture réelle ni exemple officiel représentatif.
- Tests Rust : une facture CII fictive complète et les exemples officiels CII et UBL de la
  Commission ne enfreignent aucune règle bloquante ; un total faux d'un centime enfreint
  `BR-CO-15` ; un acheteur sans nom, `BR-07` ; une facture UBL sans date, `BR-03`.
- Un XML sans rapport avec une facture, une facture CII soumise aux règles UBL ou un texte qui
  n'est pas du XML sont « non évalués », jamais « respectés ».
- **Suite de tests officielle** de la Commission (v1.3.16, embarquée dans
  `src-tauri/schematron/tests-officiels`) : 1169 cas, tous au résultat attendu — règle respectée,
  enfreinte ou signalée en avertissement selon le cas, et aucune règle bloquante sur les 30
  factures complètes. Exécutée à chaque `cargo test`, donc par la CI. Elle couvre surtout UBL :
  la Commission n'y fournit que deux fichiers CII.
- **Comparaison avec SaxonJS**, moteur XSLT de référence, faite une fois hors dépôt sur 583
  documents : 32 exemples officiels, 19 factures réelles et leurs variantes abîmées (un élément
  supprimé ou une valeur altérée). 304 documents enfreignaient au moins une règle bloquante, 93
  règles distinctes étaient déclenchées. Accord complet, règle par règle et en nombre, sur 578
  documents. Sur les 5 autres, SaxonJS s'arrête sur une valeur illisible ; l'application continue
  et signale les règles non évaluables.
- Exécuté dans la fenêtre native Windows par le test natif.
- Durée de l'évaluation seule, mesurée en version optimisée sur 19 factures réelles de 6 à
  151 Ko : médiane de 33 ms, 0,37 à 0,40 s pour les plus grosses (145 Ko). L'évaluation de la
  0.6.0, rejouée sur le même poste : médiane de 336 ms, 3,1 à 3,2 s pour les plus grosses, soit
  huit à onze fois plus. La comparaison de durée avec SaxonJS n'a pas été refaite.
- Les optimisations ne changent aucun résultat : même verdict, mêmes règles en échec aux mêmes
  emplacements que l'évaluation littérale des règles, sur les exemples officiels (à chaque
  `cargo test`) et sur les 19 factures réelles et leurs variantes abîmées, 302 documents (test
  long, lancé à la main : `cargo test --release -- --ignored`).

### Schéma XSD

- Les huit schémas embarqués (cinq profils Factur-X 1.09.2, CII D22B, facture et avoir UBL 2.1)
  se chargent tous, et le schéma CII est choisi d'après le profil annoncé : une facture EN 16931 valide, réannoncée MINIMUM,
  est refusée pour ses lignes (tests automatisés).
- Les 15 exemples CII officiels de la Commission ont été validés une fois, hors dépôt, contre le
  schéma D22B : 14 sans erreur ; le quinzième (`huf_example_cii.xml`) contient des nombres écrits `100.`, valides en
  XSD, que le validateur `uppsala` refuse à tort. L'application écarte ce faux positif (test
  automatisé).
- Fichiers abîmés exprès : élément inconnu, élément renommé, éléments dans le mauvais ordre,
  attribut non prévu, montant non numérique — tous signalés, avec leur ligne.
- Les 7 factures CII réelles locales sont valides contre le schéma de leur profil : une EN 16931,
  trois EXTENDED, trois EXTENDED-CTC-FR (schéma D22B).
- Profils MINIMUM et BASIC : aucune facture réelle ni exemple officiel n'a été essayé. BASIC WL :
  les deux exemples officiels du dépôt France_RFE sont valides.
- **UBL** : les 12 factures UBL réelles locales (11 factures, un avoir) sont valides, ainsi que
  les 18 exemples UBL officiels de la Commission validés une fois, hors dépôt. Un élément inconnu
  est signalé, et une facture présentée comme un avoir est refusée (tests automatisés).
- Chargé et appliqué par le véritable exécutable Windows (test natif).
- **Comparaison à libxml2** : 955 XML, huit schémas, 522 valides et 433 invalides, mêmes
  verdicts après correction des types simples hérités UBL (`uppsala`, commit amont épinglé).
  Décimaux limites et enfants XML interdits également vérifiés.
  [Bilan et corrections](tests/reference/REPORT.md).

### Contrôles et règles sur des factures réelles

Sur 19 factures réelles lisibles : 18 respectent toutes les règles EN 16931 évaluées ; une
enfreint trois règles de calcul pour un écart d'un centime. Quatre factures d'un même émetteur
remontent des écarts de ligne, le prix unitaire et les frais déclarés ne redonnant pas le total.

## Non vérifié

- **Installeurs** : installation des paquets publiés non documentée ; le mode de lancement
  de l’essai macOS n’est pas précisé. Les builds ne sont pas signés.
- **macOS** : essai manuel général positif ; vérification exhaustive et test natif automatisé non réalisés.
- **Linux** : aucun test natif ; seule la compilation des installeurs est constatée.
- **Impression** : la mise en page est vérifiée en navigateur ; la boîte d'impression native
  n'a pas été ouverte, et le comportement sous macOS est inconnu.
- **Reprise du suivi de la 0.4.0** (stockage de la WebView vers `suivi.json`) : testée en
  navigateur simulé, pas sur une installation 0.4.0 réelle.
- **Bibliothèque sur un grand volume** : filtres et pagination testés sur 1002 factures
  synthétiques, pas sur des milliers de factures réelles.
- **Test natif sur la machine d'intégration** : il y passe, mais sur un exécutable compilé avec
  le port de débogage inscrit dans sa configuration, WebView2 y ignorant les arguments ajoutés de
  l'extérieur. La raison de cette différence avec un poste ordinaire n'est pas établie.
- **Plafonds d'import** : testés sur un ZIP et un PDF construits pour dépasser 32 Mo, pas sur de
  vrais fichiers volumineux. Un PDF valide portant une autre pièce jointe de plus de 32 Mo est
  refusé en entier.
- **Schematron sur un gros dossier** : la file d'attente est testée avec 500 documents simulés,
  pas avec 500 vraies factures.
- **Schematron en version de développement** : nettement plus lent qu'en version optimisée.
- **Conteneur PDF** : testé sur des PDF minimaux construits pour les tests et sur les factures
  réelles locales, pas sur des PDF protégés, chiffrés ou très volumineux.

## Limites de ce que l'application affirme

- Le **Schematron officiel** et le schéma XSD portent sur le XML d'origine, décodé par
  l'application (UTF-8, UTF-16 ou Latin-1). Sur les 19 factures réelles locales, l'original est lu
  dans tous les cas et donne les mêmes résultats que la version réindentée. Les
  règles nationales autres que françaises ne sont pas contrôlées. Les règles BR-FR sont
  évaluées selon un critère simple (profil français, ou vendeur et acheteur en France) qui
  ignore les cas particuliers de la réforme ; c'est pourquoi elles ont un verdict à part, en
  alerte, sans effet sur celui du Schematron. Les règles appliquées dépendent du profil que la
  facture annonce : un profil mal annoncé donne une évaluation avec le mauvais jeu de règles.
  Les règles Factur-X et françaises concordent avec SaxonC-HE sur le corpus documenté ;
  cette comparaison ne couvre pas individuellement toutes leurs assertions.
- Le **schéma XSD** concorde avec libxml2 sur le corpus documenté ; tous les types et
  contraintes XSD ne sont pas exercés. Pour le CII, le schéma est choisi d’après le profil que la facture
  annonce : un profil mal annoncé donne un contrôle contre le mauvais schéma.
- Le **conteneur PDF** n'est validé que partiellement : ses déclarations et sept points de
  structure. Aucun de ces contrôles n'a été comparé à veraPDF, et un fichier sans anomalie
  relevée n'est pas pour autant conforme à ISO 19005-3. Sur les 16 PDF réels locaux : trois sans
  profil de sortie, un avec une police non incorporée (Helvetica), deux factures CII sans
  métadonnées Factur-X.
- Les **règles EN 16931 natives** sont une implémentation d'après l'énoncé des règles ; en cas de
  désaccord, le Schematron officiel fait foi.
- Les factures de test et de capture sont synthétiques : elles prouvent la lecture et les
  calculs, pas la conformité d'un fichier à la norme.
- Les clés de contrôle SIREN/SIRET, TVA et IBAN vérifient la forme d'un identifiant, pas son
  existence ni son titulaire. Aucun appel réseau n'est effectué.

## Exports Excel et PDF — chantier du 4 octobre 2026

[PR #3](https://github.com/simongrossi/FacturX-Reader/pull/3) : les trois jobs
`browser`, `rust` (dont le test natif Windows existant) et `reference` ont réussi sur
`8fef64f`, [exécution Checks](https://github.com/simongrossi/FacturX-Reader/actions/runs/37191537060).
Le contrôle complet de `main` sur `e35e7cc` est également vert
([Checks](https://github.com/simongrossi/FacturX-Reader/actions/runs/37192860140)).
Le test navigateur des exports utilise de vrais générateurs ExcelJS/jsPDF et PDF.js ;
seule la boîte native d’enregistrement est simulée. Il relit le XLSX et vérifie les types,
la précision, les zéros initiaux, les filtres et un résultat vide ; il extrait toutes les
pages du PDF et vérifie les accents, les commentaires, le dernier contrôle et la pagination.
Annulation et erreur d’écriture sont simulées. Les neuf pages d’un rapport synthétique
ont été rendues avec Poppler et inspectées visuellement sous macOS.

Le test natif Windows existant ne pilote pas encore les nouvelles boîtes XLSX/PDF.
L’ouverture des fichiers produits dans Excel, LibreOffice et Aperçu reste à vérifier
manuellement sur les systèmes ciblés. Détails et limites : [docs/EXPORTS.md](docs/EXPORTS.md).

## Centre d’anomalies — chantier du 4 octobre 2026

- Suite navigateur : **21 scénarios verts** sous Chromium/macOS, commandes Rust simulées.
  Deux nouveaux scénarios couvrent les six sources, les valeurs et les valeurs inconnues,
  filtres combinés, presse-papiers, messages HTML inertes, seconde occurrence XML avec
  préfixes/indices, diagnostics XSD tronqués, états incomplets et actualisation avec focus conservé.
- Suite Rust : **63 tests réussis, 3 longs ignorés**. Le test de mentions/calculs est enrichi
  pour vérifier `attendu`/`constate` sur un nom d’acheteur absent et un TTC décalé d’un centime.
- Le test PDF/XLSX existant vérifie aussi la section d’aide à la correction et ses actions.
  Interface et section PDF inspectées visuellement ; les commandes JavaScript et les
  empreintes des distributions embarquées sont vérifiées par `npm run check:js`.
- Aucun nouveau test natif Windows spécifique au centre ; essais manuels macOS/Windows/Linux
  à effectuer. Le changement n’altère pas les moteurs Schematron/XSD ni leurs règles.

[Documentation complète et limites](docs/ANOMALIES.md).

## Revue d’un lot — chantier du 4 octobre 2026

- `npm run check:js` et `git diff --check` réussis ; **22 scénarios navigateur verts**.
- Le scénario ajouté vérifie l’import en attente, les étapes de validation Schematron, le blocage du rapport jusqu’à la fin, une facture avec 60 anomalies, un avoir, une autre devise et un fichier illisible.
- Il vérifie la pagination des points à examiner, la navigation vers le XML et l’indépendance du bilan et du PDF par rapport aux filtres du tableau. La relecture du PDF par PDF.js contrôle les quatre documents, les totaux EUR avec avoir déduit et CHF, les neuf pages et leur numérotation.
- Le PDF généré a été rendu et inspecté visuellement sur ses premières pages. Les moteurs Rust et les règles officielles n’ont pas été modifiés dans ce chantier ; les essais manuels de l’interface restent à faire sur macOS, Windows et Linux.

[Parcours, sens des chiffres et limites](docs/BATCH_REVIEW.md).

## Échéancier indicatif — chantier du 4 octobre 2026

- `npm run check:js` et `git diff --check` réussis ; **23 scénarios navigateur verts** sous Chromium/macOS, dont les 22 scénarios précédents.
- Le scénario ajouté vérifie une échéance passée, du jour et future, deux devises, un avoir sans échéance, une date impossible, un montant manquant et un fichier illisible. Il confirme le solde global EUR avec avoir déduit, les groupes datés distincts, les filtres, l’indépendance du filtre du tableau, le CSV filtré, la protection d’une valeur ressemblant à une formule et l’accès à la facture.
- Le scénario du menu contextuel existant s’exécute aussi à une hauteur de fenêtre de 600 px : il vérifie que les actions restent cliquables malgré le défilement nécessaire pour afficher le tableau et le menu.
- Capture de l’interface inspectée visuellement. Les moteurs Rust et les règles officielles ne sont pas modifiés. La vérification manuelle des nouvelles interactions sur macOS, Windows et Linux reste à faire.

[Calcul et limites](docs/SCHEDULE.md).

## Provenance des valeurs — chantier du 4 octobre 2026

- [PR #7 fusionnée dans `main`](https://github.com/simongrossi/FacturX-Reader/pull/7) ; jobs navigateur, références et Rust/natif Windows verts sur la branche.
- Les tests Rust vérifient les chemins XML des montants CII/UBL, la TVA calculée sur plusieurs taux, la séparation entre HT déclaré et HT attendu, les valeurs attendues des contrôles TTC et net à payer, et l’absence de provenance pour un montant non disponible.
- Le scénario navigateur ajouté vérifie l’ouverture de la provenance depuis une anomalie de TTC, la formule et ses entrées, la carte TVA créée lorsque le résumé n’en avait pas, et la navigation vers le champ XML. La suite compte désormais **24 scénarios**.
- Les dates peuvent être normalisées à l’extraction ; la carte les nomme donc « valeur extraite » et l’occurrence XML permet de consulter la forme d’origine. Les contrôles de ligne restent hors de ce premier périmètre.
- `npm run check:js` et `git diff --check` réussis. Les essais manuels de cette interaction sur les applications natives restent à faire.

[Fonctionnement et limites](docs/PROVENANCE.md).

## Provenance des lignes — chantier du 4 octobre 2026

- [PR #8 fusionnée dans `main`](https://github.com/simongrossi/FacturX-Reader/pull/8) ; jobs navigateur, références et Rust/natif Windows verts sur la branche.
- Les tests Rust couvrent une ligne UBL avec frais et une ligne CII avec remise, les chemins des valeurs, les deux résultats acceptés du contrôle, l’absence de calcul pour une ligne incomplète et l’index exact de la ligne en anomalie.
- Le scénario navigateur supplémentaire vérifie le détail d’une ligne et celui de son anomalie, même lorsque deux lignes portent le même numéro affiché, ainsi que l’accès au total déclaré dans le XML. La suite compte désormais **25 scénarios**.
- `npm run check:js` et `git diff --check` réussis. Les essais manuels de cette interaction dans les applications natives restent à faire.
- Le test natif Windows attend maintenant la création de la page Tauri après l’ouverture du port WebView2 ; un premier lancement lent ne provoque plus un échec après seulement dix secondes. Il attend aussi que le PDF soit assez haut avant de vérifier la reprise du défilement.

[Fonctionnement et limites](docs/PROVENANCE.md).
