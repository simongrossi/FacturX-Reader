# Échéancier indicatif des factures ouvertes

Chantier du 4 octobre 2026, après la [revue d’un lot](BATCH_REVIEW.md). Fonctionnalité disponible à partir de la 0.8.0.

## Utilisation

Dans **Tableau**, le bloc **Échéancier des factures** donne un solde indicatif par devise, le nombre d’échéances dépassées et les documents sans échéance. **Voir les échéances et les factures** affiche les groupes par date et devise. Chaque groupe montre son solde et ses factures ; un clic sur le nom ouvre la fiche. Les filtres **Situation** et **Devise** s’appliquent aux groupes et à **Exporter CSV**. Le filtre du tableau ne réduit pas l’échéancier : il porte sur tous les documents actuellement ouverts qui ont une synthèse.

Le CSV, encodé en UTF-8 avec BOM et séparateur `;`, contient les documents visibles et une ligne de total pour chaque date et devise. Les champs provenant des factures sont protégés contre une interprétation comme formules par le tableur. Le bouton d’export passe par la boîte de sauvegarde locale ; aucun fichier n’est transmis à un service.

## Calcul et limites

- Pour une facture, le montant signé est **À payer**. Pour un avoir, sa valeur **TTC** est soustraite. Les montants manquants restent « indisponibles » et ne sont pas comptés comme zéro dans les soldes. Les sommes sont faites en centimes entiers à partir des chaînes décimales du XML, avec arrondi au centime le plus proche (demi-centime à l'écart de zéro), comme dans le tableau ; le navigateur ne convertit plus ces montants en nombres flottants.
- Un avoir sans échéance réduit le **solde global** de sa devise mais n’est attribué à aucune date. Un avoir daté figure dans son groupe daté. Les devises ne sont jamais converties ni additionnées entre elles.
- Les dates d’échéance valides sont comparées au jour local au moment de l’affichage. Une date absente ou impossible est rangée dans **Sans échéance**. Les fichiers illisibles et sans synthèse sont comptés séparément, sans montant inventé.
- La situation « échéance dépassée » ne constate **aucun paiement**. L’application ne connaît ni le règlement effectif, ni l’affectation d’un avoir à une facture précise, ni les paiements partiels. Le solde est indicatif et doit être rapproché de la comptabilité avant une décision de paiement.
- Plusieurs copies d’une même facture ouvertes dans la session figurent plusieurs fois dans les soldes ; le tableau et le centre d’anomalies signalent les doublons à examiner. L’échéancier ne les retire pas automatiquement.

`web/schedule.js` contient le modèle, le rendu et l’export. Il ne change ni le XML, ni le moteur de validation, ni les statuts de suivi manuel. Le scénario navigateur dédié vérifie les échéances passée/du jour/future, deux devises, un avoir non affecté, une date invalide, un montant absent, un fichier illisible, l’indépendance du filtre du tableau, l’export CSV et la navigation. Voir [VALIDATION.md](../VALIDATION.md) pour les résultats.
