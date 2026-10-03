# Comparaison aux validateurs de référence

Le test exécute les validateurs de l'application sur les XML d'origine, sans Tauri ni données
utilisateur, puis compare leurs résultats à deux moteurs indépendants :

- **SaxonC-HE 12.9** : feuilles XSLT officielles France_RFE pour EXTENDED-CTC-FR et BR-FR
  (CII et UBL), feuille officielle BASIC WL, feuilles officielles de la Commission pour EN 16931.
- **Compilateur ISO Schematron + SaxonC-HE** : règles Factur-X MINIMUM, BASIC et EXTENDED
  embarquées, sans réécriture des XPath, compilées en XSLT par l'implémentation ISO de Schematron.
- **libxml2 / xmllint** : les huit schémas XSD originaux du dépôt, avec leurs imports d'origine.
  Aucune copie aplatie ni adaptation du schéma n'est utilisée par la référence.

## Exécution

Sur macOS, `xmllint` est fourni par le système. Sous Linux, installer `libxml2-utils` et les
[dépendances de compilation Tauri](https://tauri.app/start/prerequisites/). Rust et Python 3.9+
sont requis ; aucun Java ni navigateur n'est nécessaire.

```bash
python3 -m venv tests/reference/cache/venv
source tests/reference/cache/venv/bin/activate
python3 -m pip install -r tests/reference/requirements.txt
python3 -m unittest discover -s tests/reference -p 'test_*.py'
npm run test:reference
```

Le premier lancement télécharge les sources officielles listées dans `sources.json`. Leurs
empreintes SHA-256 sont vérifiées à chaque exécution. Les règles françaises et BASIC WL
embarquées sont comparées aux sources épinglées avant de lancer les feuilles officielles.
Une source différente ou absente en mode hors ligne arrête le test.

```bash
npm run test:reference -- --offline  # après le premier téléchargement
npm run test:reference -- --quick   # exemples locaux et fixtures, corpus réduit
```

Le workflow `Checks` exécute le corpus complet sous macOS et conserve les résultats et les XML
évalués en artefact GitHub, même en cas d'écart. Le test sort avec le code 1 pour tout écart de
résultat ou échec de la référence. Un échec XSLT n'est jamais compté comme une validation réussie.

## Corpus et comparaison

Le corpus complet comprend les **41 exemples de factures France_RFE v1.4.0.04**, quatre fixtures
pour MINIMUM, BASIC, EXTENDED et le schéma D22B, deux exemples de la Commission et un avoir UBL.
Les documents de départ sont conservés octet pour octet et doivent être valides XSD.

Chaque document reçoit des altérations isolées lorsque le champ existe : numéro vide ou trop
long, devise ou pays inconnu, vendeur sans nom, date absente, unité ou catégorie de TVA inconnue,
total faux, précision excessive, attribut ou élément inconnu et ordre invalide. Les variantes
avec montant non numérique, notation exponentielle, double signe, virgule, fraction vide et
enfant XML sont comparées uniquement en XSD : un moteur XSLT peut s’arrêter avant de produire
un SVRL. Ces cas restent explicitement comptés dans les tests XSD.

Le même XML est fourni aux trois moteurs. Pour le Schematron, la comparaison porte sur :

- identifiant de règle, gravité, namespace du nœud, chemin et indice de chaque occurrence ;
- nombre de règles déclenchées, erreurs bloquantes, avertissements et verdict ;
- absence de règles non compilées ou non évaluables ; application distincte de BR-FR.

Les différences de préfixes et l'indice `[1]` omis sont normalisés, sans supprimer les namespaces
ni les répétitions. Le XSD compare le verdict et exige une évaluation effective ; il ne compare
pas les formulations ni le nombre des diagnostics, propres à chaque validateur.

`output/manifest.json` donne la source, la mutation et l'empreinte de chaque XML.
`output/results.json` conserve les résultats Rust, les SVRL et les diagnostics libxml2.
`output/summary.json` contient les écarts, les règles effectivement déclenchées, la couverture
des schémas et les versions des références. Ces fichiers et les sources téléchargées sont ignorés
par Git ; le bilan daté est conservé dans [REPORT.md](REPORT.md).

## Différence des artefacts EXTENDED

Le Schematron `FACTUR-X_EXTENDED.sch` de France_RFE v1.4.0.04 est une variante **fix-FR04** du
paquet Factur-X 1.09.2 embarqué. Il corrige les contextes des règles `BR-FXEXT-*-01` et ajoute des
conversions décimales dans `BR-FXEXT-CO-10`, `12`, `13`. Cette évolution des règles ne doit pas être
confondue avec une divergence de moteur : pour EXTENDED, le test compile le Schematron embarqué
avec l'implémentation ISO. Sa mise à jour éventuelle constitue un chantier distinct.

Le premier essai avec SaxonJS 2.7 a échoué sur une expression arithmétique EXTENDED mêlant
`xs:double` et `xs:decimal` (`XPTY0004`). Le même XSLT fonctionne avec SaxonC-HE ; c'est ce dernier
qui est retenu comme référence reproductible. SaxonJS ne fait pas partie des dépendances du projet.

## Origine et licences

- [France_RFE v1.4.0.04](https://github.com/fnfempe/France_RFE/tree/v1.4.0.04), commit
  `97ba0f3d4ef2abed5780e9490d5c3a2be832ab1d` : sources téléchargées, licence du dépôt Apache 2.0.
- [ISO Schematron](https://github.com/Schematron/schematron/tree/77dcd36c53d12ed786c144ece3b2af7694abdc56),
  commit épinglé, licence MIT figurant dans les fichiers téléchargés.
- [Commission européenne, validation-1.3.16](https://github.com/ConnectingEurope/eInvoicing-EN16931/tree/validation-1.3.16) :
  feuilles téléchargées et exemples déjà embarqués, EUPL 1.2.
- `fixtures/basic.xml`, `extended.xml` et `d22b.xml` sont dérivés de l'exemple
  `src-tauri/schematron/exemples/CII_example3.xml` de la Commission (© Union européenne ; exemple produit par Andreas Pelekies, EUPL 1.2). Le profil est changé ;
  les champs hors BASIC sont supprimés dans la fixture BASIC. Ce sont des données d'exemple.
- `fixtures/minimum.xml` est une facture entièrement synthétique créée pour ce projet.

Les références restent des outils de test. L'application conserve son moteur Rust hors ligne.
Le correctif `uppsala` est épinglé au [commit amont de la PR #44](https://github.com/kushaldas/uppsala/pull/44)
jusqu'à la publication d'une version contenant la correction des contenus simples hérités.

## Suivi du correctif `uppsala`

Pour revenir à une dépendance publiée, vérifier que la version retenue contient le correctif
#44, mettre à jour la dépendance `uppsala`, retirer son entrée de `[patch.crates-io]`, puis
mettre à jour `Cargo.lock`. Rejouer `npm run test:rust` et le corpus complet
`npm run test:reference` dans l'environnement Python avant de pousser. L'accord avec libxml2
sur les valeurs UBL invalides et sur les décimaux limites doit être conservé ; mettre ensuite
à jour le bilan et les empreintes de `verified-summary.json` à partir de cette exécution.
