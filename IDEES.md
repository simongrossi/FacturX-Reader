# Idées de développement — usage comptable

État au 4 octobre 2026. Ce document regroupe des pistes à étudier : aucune des fonctions ci-dessous n'est annoncée comme disponible. Les priorités tiennent compte du moteur existant (montants en décimaux exacts, TVA par taux, avoirs, provenance XML, bibliothèque locale, doublons et revue de lot).

## Priorité 1 — Préparer des écritures comptables

Transformer une facture **contrôlée** en proposition d'écriture, avec aperçu et correction avant export. Commencer par les achats et leurs avoirs ; traiter les ventes dans une étape distincte. Le comptable choisit le journal, les comptes de tiers, de charge et de TVA, la date comptable et la référence de pièce. Il peut enregistrer une règle d'affectation pour un fournisseur ou une nature d'achat. Une pièce sans compte fiable reste « à compléter ».

La revue en lot vérifie au minimum l'équilibre débit/crédit au centime, la présence des comptes et références, les devises, les avoirs et les factures déjà exportées. Elle conserve le lien vers la facture et les valeurs XML utilisées. Le CSV est un **fichier d'import d'écritures proposées**, ni un FEC réglementaire ni une comptabilisation automatique. L'application ne déduit pas seule la déductibilité de la TVA, le compte de charge ou la bonne période comptable.

### Profils d'export

Construire d'abord un modèle interne unique d'écriture, puis des profils d'export testés avec un logiciel et une version précis. Paramètres possibles : ordre et noms des colonnes, séparateur, encodage, format des dates et montants, code journal, compte auxiliaire, référence de pièce, devise et éventuel axe analytique. Fournir un aperçu du fichier et un contrôle avant enregistrement. Conserver le modèle choisi par dossier comptable.

1. **EBP Comptabilité** : premier profil candidat. L'assistant officiel accepte les fichiers TXT/CSV et permet d'associer les colonnes du fichier aux champs de destination. Vérifier l'import sur un jeu de factures et d'avoirs synthétiques avant de qualifier le profil de compatible.
2. **Sage** : identifier d'abord le produit utilisé (**Sage 50 ou Sage 100**, puis sa version). Ce ne sont pas un format unique. Les deux proposent des imports paramétrables ; réaliser et tester un profil séparé pour chacun selon la demande réelle.
3. **Autres logiciels** : envisager Pennylane ou Cegid Loop après les premiers retours utilisateurs, avec leurs modèles et règles propres. Aucun connecteur réseau n'est requis pour le premier lot.

Références éditeurs consultées le 4 octobre 2026 : [EBP, import TXT/CSV](https://support.ebp.com/hc/fr/articles/360009788457-Importer-un-fichier-txt-ou-csv-dans-EBP-Comptabilit%C3%A9), [Sage 50, import d'écritures](https://fr-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=211010160107108), [Sage 100, format paramétrable](https://fr-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=210905150071308&view=print), [Pennylane, import d'écritures](https://help.pennylane.com/fr/articles/18793-importer-des-ecritures), [Cegid Loop, import personnalisé](https://developers.cegid.com/docreference/BusinessUnits/Loop-Api-Management-Docs/EcritureComptableImport.html). Ces pages confirment des possibilités d'import, pas une compatibilité déjà validée de Factur-X Reader.

## Fonctions à développer après le premier export

1. **Affectations mémorisées** : proposer les comptes et axes analytiques déjà validés pour le même fournisseur ou type d'achat ; montrer la règle appliquée et laisser la modifier. Aucune affectation silencieuse quand les indices sont ambigus.
2. **File de précomptabilisation** : statuts « à compléter », « prêt », « exporté » et « import rejeté », revue et correction en lot, suivi de la date et du fichier d'export. Signaler un réexport potentiel de la même facture ou du même avoir.
3. **Rapprochement bancaire** : importer localement un relevé, suggérer des correspondances avec les factures et avoirs par montant, référence et date, puis faire confirmer le règlement. L'échéancier actuel est indicatif et ne connaît pas les paiements effectués.
4. **Dossiers multi-sociétés** : séparer bibliothèque, plan de comptes, journaux, règles d'affectation, statuts d'export et historiques par société ; éviter toute écriture dans le mauvais dossier.
5. **Pièces justificatives prêtes pour l'import** : conserver une référence stable entre écriture et PDF/XML, et produire un lot de pièces lorsque le logiciel cible le permet. Tester les limites et conventions de nommage du logiciel avant d'ajouter un profil.

## Autres chantiers utiles

- **Comparer PDF et XML** : rechercher dans le texte du PDF les montants et références clés du XML, afficher les écarts avec leur page et leur provenance. Commencer sans OCR et signaler les ambiguïtés. La recherche PDF existe déjà ; cette comparaison reste à développer.
- **Rechercher dans toutes les lignes** : filtrer les articles et prestations de l'ensemble des factures, puis retrouver immédiatement la facture source.
- **Jeu de tests anonymisé** : achats, ventes, avoirs, plusieurs taux de TVA, remises, acomptes, devises et formats CII/UBL/PDF pour fiabiliser les écritures proposées et les profils d'export.

## Décisions à prendre avant le chantier comptable

- Logiciel et version à cibler d'abord : EBP, Sage 50 ou Sage 100 ; obtenir un modèle d'import et un essai de validation sur un dossier de test.
- Périmètre initial : achats et avoirs, ou aussi ventes ; règles de comptes et de TVA fournies par le comptable.
- Organisation : un seul dossier ou plusieurs sociétés dès la première version.
