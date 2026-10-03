# Validation — version 0.7.0, 3 octobre 2026

Bilan de ce qui a été vérifié avant la publication, et de ce qui ne l'a pas été.
Les commandes sont décrites dans [README.md](README.md#tests).

## Vérifications réalisées

| Vérification | Résultat / portée |
|---|---|
| `npm run check:js` | Syntaxe de tous les scripts de l'interface |
| `npm run test:rust` | 57 tests unitaires : exemples officiels français, règles BR-FR (fonctions, périmètre), conteneur PDF (déclarations, sept contrôles de structure), schéma XSD (XML d'origine validé, chargement des huit schémas, facture et avoir UBL, choix d'après le profil, exemple officiel valide, élément inconnu, attribut inconnu, montant non numérique, jamais « valide » sans évaluation), Schematron officiel (compilation de toutes les règles, suite de tests officielle de la Commission, exemples officiels, règles enfreintes, file de travail, résultat repris de la bibliothèque entre deux sessions, résultats identiques avec et sans optimisations), moteur UBL/CII, contrôles en décimaux exacts, règles EN 16931, conteneur PDF (déclarations lues, écarts), pointages et suivi (corruption, sauvegarde, restauration, fusion), bibliothèque SQLite |
| Test Rust `samples.rs` | Factures réelles locales, hors dépôt : toutes analysées, sauf celles marquées sans XML |
| `npm run test:ui` | 14 scénarios navigateur (Edge le 3 octobre ; Chromium par la CI), commandes Rust simulées, PDF.js réel |
| `npm run test:native` | Vrai exécutable Windows, vraies commandes Rust, profil WebView2 et dossier de données jetables |
| Workflow `Checks` | Tests navigateur (Linux) et Rust (Windows) verts sur `main` |
| Workflow `Release` | Installeurs Windows, macOS et Linux construits à chaque tag |

### Ce que couvre le test natif Windows

Reprise d'un PDF de deux pages après fermeture et relance (zoom, position), recherche, tableau
multi-factures et ses totaux, contrôles calculés par le moteur, vue PDF et données, suivi écrit
dans `suivi.json`, bibliothèque SQLite (enregistrement unique d'un même XML, recherche,
réouverture), fichiers `pointages.json` et `suivi.json` corrompus à la main : signalés au
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
- **Non fait** pour les règles Factur-X : aucune comparaison avec un moteur de référence, aucune
  suite de tests officielle (le paquet n'en fournit pas), et aucun fichier réel ni exemple
  officiel aux profils MINIMUM ou BASIC.
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
- **Non fait** : comparaison avec un validateur de référence (Xerces, libxml2) sur un grand jeu
  de documents, comme cela a été fait pour le Schematron avec SaxonJS.

### Contrôles et règles sur des factures réelles

Sur 19 factures réelles lisibles : 18 respectent toutes les règles EN 16931 évaluées ; une
enfreint trois règles de calcul pour un écart d'un centime. Quatre factures d'un même émetteur
remontent des écarts de ligne, le prix unitaire et les frais déclarés ne redonnant pas le total.

## Non vérifié

- **Installeurs** : aucun `.exe`, `.msi`, `.dmg` ni paquet Linux téléchargé n'a été installé ni
  lancé. Les tests portent sur l'exécutable de développement. Les builds ne sont pas signés.
- **macOS et Linux** : aucun test natif ; seule la compilation des installeurs est constatée.
- **Impression** : la mise en page est vérifiée en navigateur ; la boîte d'impression native
  n'a pas été ouverte, et le comportement sous macOS est inconnu.
- **Reprise du suivi de la 0.4.0** (stockage de la WebView vers `suivi.json`) : testée en
  navigateur simulé, pas sur une installation 0.4.0 réelle.
- **Bibliothèque sur un grand volume** : testée sur quelques factures, pas sur des milliers.
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
  Les règles Factur-X et les règles françaises n'ont pas été comparées à un moteur de
  référence ; leur seul repère est qu'aucun exemple officiel ne les enfreint.
- Le **schéma XSD** est contrôlé par un validateur jeune, qui n'a pas été comparé à un
  validateur de référence. Pour le CII, le schéma est choisi d'après le profil que la facture
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
