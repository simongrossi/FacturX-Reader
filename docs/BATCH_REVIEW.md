# Revue d’un lot et rapport consolidé

Chantier du 4 octobre 2026, après le [centre d’anomalies](ANOMALIES.md) et les [exports Excel/PDF](EXPORTS.md). Fonctionnalité distribuée dans la [préversion 0.7.1](https://github.com/simongrossi/FacturX-Reader/releases/tag/v0.7.1).

## Parcours

Ouvrir un dossier, déposer un ensemble de fichiers ou ajouter plusieurs documents, puis ouvrir **Tableau**. Le bandeau **Bilan du lot** indique combien de documents sont analysés sur le nombre ouvert. Un document compte comme terminé lorsque sa lecture a échoué ou lorsque sa lecture et, pour CII/UBL, sa validation Schematron ont rendu un résultat. Le bandeau distingue les fichiers encore à lire et les validations Schematron en cours. Les lignes en lecture apparaissent dans le tableau.

Le bilan compte les documents à examiner, les anomalies, les documents dont certains contrôles sont incomplets et les fichiers non lus. Le volet **Points à examiner dans le lot** ouvre la liste commune ; il est replié initialement pour garder le tableau accessible. La liste se filtre par niveau et par texte ; elle affiche 50 cartes à la fois, avec **Afficher davantage**. Une carte ouvre la facture concernée et, pour une anomalie localisable, l’occurrence XML ou le contrôle. Les fichiers non lus restent visibles dans ce bilan même s’ils n’ont pas de centre d’anomalies par facture.

Quand tous les documents sont terminés, **Rapport du lot PDF** devient disponible, également depuis le menu **Fichier**. Il contient le total par devise, avoirs déduits, puis chaque document ouvert, ses anomalies, les actions conseillées, les contrôles incomplets et les erreurs de lecture. Le rapport est paginé et généré localement avec une police embarquée. Les filtres du tableau et de la liste des points ne réduisent **pas** son périmètre : ils ne changent que l’affichage. Le rapport d’une seule facture reste disponible dans sa fiche.

## Sens des chiffres

- **Documents analysés** : lecture échouée ou résultat de lecture et de validation Schematron disponible. « Terminé » décrit le processus, pas la conformité ; le Schematron peut conclure « non évalué ».
- **Anomalies** : écarts et alertes produits par les contrôles, selon la même normalisation que le centre par facture. Plusieurs moteurs peuvent signaler un même problème : leurs points restent distincts et traçables.
- **Contrôles incomplets** : nombre de documents avec au moins un contrôle non évalué ou partiel. Ces limites figurent dans la liste des points et dans le PDF, sans devenir des anomalies.
- **Documents à examiner** : documents avec anomalie, contrôle incomplet ou lecture impossible. Une facture peut appartenir à plusieurs catégories ; elle n’est comptée qu’une fois ici.
- **Totaux** : montants lus dans la synthèse de chaque facture, groupés par devise, calculés en centimes comme dans le tableau et avec les avoirs soustraits. Un fichier illisible n’apporte pas de montant. Les devises ne sont jamais converties.

## Mise en œuvre et vérification

`web/batch-report.js` construit le bilan depuis tous les fichiers de la session, réutilise `invoiceAnomalies()` et produit le PDF via jsPDF. `web/app.js` actualise la progression pendant la lecture et à chaque résultat Schematron. L’export reprend le mécanisme de sauvegarde binaire local déjà utilisé par les rapports individuels ; sa limite native est de 100 Mo. La session reste limitée à 500 documents. Aucun changement du moteur de validation ou de ses règles n’est introduit.

Le scénario navigateur dédié mélange facture, avoir, autre devise, fichier illisible et validation asynchrone. Il contrôle le blocage de l’export jusqu’à la fin, les compteurs, la pagination des points, l’indépendance aux filtres, les totaux avec avoir déduit, le contenu et la pagination du PDF relu par PDF.js, et la navigation vers l’anomalie. Voir [VALIDATION.md](../VALIDATION.md) pour les résultats effectifs.

Limites : les points communs ne fusionnent pas sémantiquement les diagnostics de plusieurs moteurs ; les contrôles non évalués restent tels quels dans le rapport. Le PDF est un bilan des contrôles exécutés, pas une certification. Les essais manuels des nouvelles fonctions sur macOS, Windows et Linux restent à effectuer.
