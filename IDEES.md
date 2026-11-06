# Idées de développement — usage comptable

État au 5 octobre 2026. Ce document regroupe des pistes à étudier : aucune des fonctions ci-dessous n'est annoncée comme disponible. Les priorités tiennent compte du moteur existant (montants en décimaux exacts, TVA par taux, avoirs, provenance XML, bibliothèque locale, doublons et revue de lot).

## Idées classées par priorité

Ordre proposé pour les prochains développements, à confronter aux fonctions déjà présentes avant chaque chantier. Les détails du chantier comptable sont conservés plus bas.

| Niveau | Ordre | Fonction à ajouter ou à compléter | Intérêt / exemples |
| --- | --- | --- | --- |
| P1 — Usage quotidien | 1 | Recherche globale dans toutes les lignes de factures | Retrouver une prestation, un abonnement Microsoft, une référence article ou un montant dans l'ensemble des factures. |
| P1 — Usage quotidien | 2 | Comparaison PDF ↔ XML | Vérifier la correspondance entre les données visibles dans le PDF et celles exploitées depuis le XML ; présenter les écarts et leur provenance. |
| P1 — Usage quotidien | 3 | Statut de paiement distinct du statut de contrôle | À payer / Partiellement payée / Payée / Litige / Bloquée. |
| P1 — Usage quotidien | 4 | Date de règlement et montant réglé | Rendre l'échéancier exploitable avec les règlements et distinguer retard théorique et retard réel. |
| P1 — Usage quotidien | 5 | Tags et catégories personnalisés | Immobilisation, Télécom, À voir avec Pierre, Litige, Contrat, Véhicule. |
| P1 — Usage quotidien | 6 | Actions en masse | Sélectionner plusieurs factures pour les marquer vérifiées, ajouter un tag, changer un statut ou exporter. |
| P1 — Usage quotidien | 7 | Colonnes configurables du tableau | Afficher ou masquer SIRET, IBAN, numéro de commande, statut, TTC et échéance selon le service. |
| P1 — Usage quotidien | 8 | Filtres et vues enregistrés | À payer cette semaine, montant supérieur à 5 000 €, Nouveaux IBAN, Anomalies, Non vérifiées. |
| P2 — Préparation comptable | 9 | Référence commande / PO mise en avant | Rendre la référence visible et filtrable ; prévoir une alerte si elle est requise et absente. |
| P2 — Préparation comptable | 10 | Référence BL / livraison | Rendre la référence visible et filtrable pour faciliter le rapprochement facture / livraison. |
| P2 — Préparation comptable | 11 | Affectation comptable | Journal, compte fournisseur, compte de charge, compte TVA et axe analytique. |
| P2 — Préparation comptable | 12 | Affectations mémorisées par fournisseur | Proposer, par exemple, Orange → 626xxx ou EDF → 6061xx, avec confirmation du comptable. |
| P2 — Préparation comptable | 13 | File de précomptabilisation | À compléter / Prête / Exportée / Rejetée, avec revue et correction. |
| P2 — Préparation comptable | 14 | Exports comptables EBP / Sage / Pennylane | Construire d'abord un modèle interne d'écriture, puis valider chaque profil d'import avec le logiciel et la version ciblés. |
| P3 — Contrôle fournisseur | 15 | Évolution des numéros de facture fournisseur | Repérer un format inhabituel, un doublon ou une rupture de séquence à examiner. |
| P3 — Contrôle fournisseur | 16 | Changement de SIREN, TVA ou coordonnées | Étendre les contrôles d'IBAN à l'identité et aux coordonnées du fournisseur. |
| P3 — Contrôle fournisseur | 17 | Référence commande obligatoire | Définir les fournisseurs qui doivent toujours renseigner un numéro de commande. |
| P3 — Contrôle fournisseur | 18 | Règles personnalisables par fournisseur | IBAN connu, commande obligatoire, échéance à 30 jours. |
| P3 — Contrôle fournisseur | 19 | Détection de facture inhabituelle | Signaler un montant très supérieur à l'historique, un nouveau taux de TVA ou un nouveau compte bancaire, sans présenter ces alertes comme une preuve de fraude. |
| P4 — Ergonomie | — | Copier en un clic | IBAN, SIRET, TVA, numéro de facture, montant TTC et échéance. |
| P4 — Ergonomie | — | Ouvrir le dossier contenant la facture | Accéder directement au fichier dans son dossier. |
| P4 — Ergonomie | — | Copier le chemin du fichier | Réutiliser facilement l'emplacement de la pièce. |
| P4 — Ergonomie | — | Renommer automatiquement une facture | Exemple : `2026-10-05_Fournisseur_FA123_1213.45EUR.pdf`. |
| P4 — Ergonomie | — | Facture précédente / suivante au clavier | Accélérer la revue des pièces. |
| P4 — Ergonomie | — | Afficher, masquer et réordonner les colonnes | Compléter les colonnes configurables prévues en P1. |
| P4 — Ergonomie | — | Mémoriser la largeur et l'ordre des colonnes | Retrouver son organisation à la prochaine ouverture. |
| P4 — Ergonomie | — | Tri multi-colonnes | Combiner plusieurs critères de classement. |
| P4 — Ergonomie | — | Menu contextuel de copie | Clic droit pour copier une ligne, une valeur ou une référence. |
| P4 — Ergonomie | — | Épingler une facture | Retrouver rapidement une pièce à suivre. |
| P4 — Ergonomie | — | Notes visibles dans le tableau | Consulter les annotations pendant la revue du lot. |
| P4 — Ergonomie | — | Historique simple des actions | Vérifiée le…, paiement renseigné le…, exportée le… |
| P5 — Plus tard | — | Rapprochement bancaire | Importer un relevé et confirmer les correspondances ; extension du périmètre après le suivi des règlements. |
| P5 — Plus tard | — | Multi-sociétés / dossiers comptables | Séparer les bibliothèques et paramètres, surtout pour la précomptabilisation. |
| P5 — Plus tard | — | API / MCP / connecteurs ERP | Étudier les intégrations selon les besoins. |
| P5 — Plus tard | — | Validation PDF/A complète | Évaluer la valeur quotidienne au regard du coût technique. |
| P5 — Plus tard | — | Conversion CII ↔ UBL | Étudier dans une étape ultérieure. |
| Hors périmètre proposé | — | Création de factures | Conserver le positionnement Reader ; ne pas prévoir ce chantier à ce stade. |

### Ordre concret proposé

| Étape | Chantier |
| --- | --- |
| 1 | Recherche globale dans les lignes |
| 2 | Comparaison PDF ↔ XML |
| 3 | Statut de paiement et règlements |
| 4 | Tags personnalisés |
| 5 | Actions en masse |
| 6 | Colonnes et vues personnalisables |
| 7 | Références commande / BL visibles et filtrables |
| 8 | Affectation comptable |
| 9 | Règles d'affectation fournisseur |
| 10 | Précomptabilisation et exports comptables |

## Détail du chantier — Préparer des écritures comptables

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
