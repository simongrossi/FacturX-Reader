# Validation — après la version 0.5.0, 2 octobre 2026

État de la branche `main`, qui contient le Schematron officiel, le conteneur PDF et les filtres
métier, non encore publiés.

Bilan de ce qui a été vérifié avant la publication, et de ce qui ne l'a pas été.
Les commandes sont décrites dans [README.md](README.md#tests).

## Vérifications réalisées

| Vérification | Résultat / portée |
|---|---|
| `npm run check:js` | Syntaxe de tous les scripts de l'interface |
| `npm run test:rust` | 32 tests unitaires : moteur UBL/CII, contrôles en décimaux exacts, règles EN 16931, conteneur PDF (déclarations lues, écarts), pointages et suivi (corruption, sauvegarde, restauration, fusion), bibliothèque SQLite |
| Test Rust `samples.rs` | Factures réelles locales, hors dépôt : toutes analysées, sauf celles marquées sans XML |
| `npm run test:ui` | 13 scénarios navigateur sous Chromium et Edge, commandes Rust simulées, PDF.js réel, Schematron officiel réel |
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

- Exécuté pour de vrai dans le navigateur de test et dans la fenêtre native Windows.
- Une facture CII fictive complète est respectée ; la même avec un total faux d'un centime
  enfreint `BR-CO-15` ; sans nom d'acheteur, `BR-07`.
- Un XML sans rapport avec une facture, ou une facture CII soumise aux règles UBL, est
  « non évalué » et jamais « respecté ».
- Sur 19 factures réelles : même résultat que les règles natives pour les règles métier (trois
  règles de calcul enfreintes sur une facture) ; deux factures UBL enfreignent en plus une règle
  de syntaxe (`UBL-SR-34`), que le moteur natif ne couvre pas ; la plupart reçoivent des
  avertissements de syntaxe. Durée : de 20 ms à 1,4 s par facture.

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
  pas avec 500 vraies factures ; la validation occupe l'interface pendant son exécution.
- **Schematron UBL** : exécuté sur les factures réelles, sans test automatisé sur une facture
  UBL fictive.
- **Conteneur PDF** : testé sur des PDF minimaux construits pour les tests et sur les factures
  réelles locales, pas sur des PDF protégés, chiffrés ou très volumineux.

## Limites de ce que l'application affirme

- Le **Schematron officiel EN 16931** est exécuté sur le XML réindenté par l'application. Ni le
  schéma XSD, ni les règles nationales ne sont contrôlés. Les profils MINIMUM et BASIC WL sont
  évalués avec les règles EN 16931, faute des Schematron propres à Factur-X.
- Le **conteneur PDF** n'est pas validé : seules ses déclarations (PDF/A-3 annoncé, pièce jointe
  déclarée, profil annoncé) sont lues.
- Les **règles EN 16931 natives** sont une implémentation d'après l'énoncé des règles ; en cas de
  désaccord, le Schematron officiel fait foi.
- Les factures de test et de capture sont synthétiques : elles prouvent la lecture et les
  calculs, pas la conformité d'un fichier à la norme.
- Les clés de contrôle SIREN/SIRET, TVA et IBAN vérifient la forme d'un identifiant, pas son
  existence ni son titulaire. Aucun appel réseau n'est effectué.
