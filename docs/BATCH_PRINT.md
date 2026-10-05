# Impression groupée des factures ouvertes

Chantier du 5 octobre 2026, sur la branche `Print_Facility`. Fonctionnalité en cours d’intégration (non publiée).

## Utilisation

Dans la **barre de fichiers**, chaque facture analysée qui porte au moins un PDF affiche une **icône imprimante** au survol, à gauche du bouton de retrait. Un clic sur l’icône ajoute ou retire la facture de la sélection d’impression ; les factures cochées sont entourées et l’icône reste visible. La sélection est conservée tant qu’on ne retire pas les fichiers.

L’entrée **Fichier → Impression groupée…** est grisée sans sélection. Elle ouvre la boîte de dialogue **Impression groupée** :

- **PDF du XML, sinon PDF du document** (par défaut) : chaque facture imprime son PDF généré depuis le XML ; si ce PDF est absent, son PDF de document est utilisé.
- **PDF du XML uniquement** : seules les factures portant un PDF du XML sont imprimées ; les autres sont signalées « ignorées (PDF absent) ».
- **PDF du document uniquement** : chaque facture imprime son PDF de document.

La ligne d’information compte en direct les factures sélectionnées, les PDF imprimables et les factures ignorées. Le bouton **IMPRIMER N Fichier(s) PDF ?** lance l’impression ; il est désactivé quand aucun PDF n’est imprimable.

L’impression passe par la **boîte d’impression système** : toutes les pages des PDF sélectionnés sont regroupées en **un seul job**, chaque PDF commençant sur une nouvelle page. Le mode choisi est mémorisé pour la prochaine ouverture de la boîte.

## Rendu et limites

- Chaque page est rendue sur un canevas (échelle 2, soit environ 1587 × 2245 px au format A4) puis convertie en image avant impression, pour limiter la mémoire du document pendant l’impression.
- Le nombre de pages est compté avant le rendu. Au-delà d’un seuil de confort (400 pages), une confirmation demande si l’on continue.
- Les factures sans aucun PDF (ni XML, ni document) ne sont pas imprimables et sont comptées dans les « ignorées ».
- L’application ne fusionne pas les PDF au sens fichier : elle compose une feuille d’images imprimable, sans produire de nouveau PDF. Aucun fichier n’est transmis à un service.
- La sélection d’impression est propre à la session en cours et n’est pas sauvegardée.

`web/print-batch.js` contient la sélection, la boîte de dialogue, la composition du lot et le lancement de l’impression. Le scénario navigateur dédié vérifie la sélection par icône, la grisaille du menu, les trois modes et leurs compteurs, la mémorisation du mode, l’impression en un seul job, le masquage de l’interface à l’impression et la conservation de la sélection. Voir [VALIDATION.md](../VALIDATION.md) pour les résultats.
