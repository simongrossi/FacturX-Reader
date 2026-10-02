# Validation — version 0.5.0, 2 octobre 2026

Bilan de ce qui a été vérifié avant la publication, et de ce qui ne l'a pas été.
Les commandes sont décrites dans [README.md](README.md#tests).

## Vérifications réalisées

| Vérification | Résultat / portée |
|---|---|
| `npm run check:js` | Syntaxe de tous les scripts de l'interface |
| `npm run test:rust` | 30 tests unitaires : moteur UBL/CII, contrôles en décimaux exacts, règles EN 16931, pointages et suivi (corruption, sauvegarde, restauration, fusion), bibliothèque SQLite |
| Test Rust `samples.rs` | Factures réelles locales, hors dépôt : toutes analysées, sauf celles marquées sans XML |
| `npm run test:ui` | 12 scénarios navigateur sous Chromium et Edge, commandes Rust simulées, PDF.js réel |
| `npm run test:native` | Vrai exécutable Windows, vraies commandes Rust, profil WebView2 et dossier de données jetables |
| Workflow `Checks` | Tests navigateur (Linux) et Rust (Windows) verts sur `main` |
| Workflow `Release` | Installeurs Windows, macOS et Linux construits à chaque tag |

### Ce que couvre le test natif Windows

Reprise d'un PDF de deux pages après fermeture et relance (zoom, position), recherche, tableau
multi-factures et ses totaux, contrôles calculés par le moteur, vue PDF et données, suivi écrit
dans `suivi.json`, bibliothèque SQLite (enregistrement unique d'un même XML, recherche,
réouverture), fichiers `pointages.json` et `suivi.json` corrompus à la main : signalés au
démarrage, laissés intacts à l'écriture, puis restaurés depuis une sauvegarde.

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

## Limites de ce que l'application affirme

- Les **règles EN 16931** sont une implémentation native d'après l'énoncé des règles, pas le
  Schematron officiel. Ni le schéma XSD, ni les listes de codes (hors catégories de TVA), ni les
  règles nationales, ni le conteneur PDF/A-3 ne sont contrôlés.
- Les factures de test et de capture sont synthétiques : elles prouvent la lecture et les
  calculs, pas la conformité d'un fichier à la norme.
- Les clés de contrôle SIREN/SIRET, TVA et IBAN vérifient la forme d'un identifiant, pas son
  existence ni son titulaire. Aucun appel réseau n'est effectué.
