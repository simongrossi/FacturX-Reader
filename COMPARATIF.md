# Comparatif — Factur-X Reader face aux outils locaux

Établi le 4 octobre 2026, pour la version 0.7.0 (travaux non publiés compris).
Voir [README.md](README.md#comparatif) pour le tableau court et [ROADMAP.md](ROADMAP.md) pour
le plan qui en découle.

## Méthode et limites

Ce bilan part d'une étude de marché fournie le 4 octobre 2026 (« État de l'art des solutions
locales de lecture et d'extraction Factur-X »). Elle a été confrontée :

- au code et aux tests de Factur-X Reader, pour tout ce qui nous concerne ;
- à la page publique de six outils, consultée le même jour : Quba Viewer, Treesoft, 7-PDF,
  GrandTotal, Aloaha, paperless-ngx-erechnung.

**Aucun outil concurrent n'a été installé ni essayé.** Une case « non documenté » veut dire que
la page consultée n'en parle pas, pas que l'outil ne le fait pas. Les outils marqués « non
vérifié » ne sont connus que par l'étude. Corrections bienvenues.

## Le paysage en quatre familles

| Famille | Outils | Ce qu'ils font | Rapport à Factur-X Reader |
|---|---|---|---|
| Visionneuses | Quba Viewer, Treesoft Viewer, 7-PDF E-Invoice Validator, Aloaha ZUGFeRD GUI, Ultramarin Viewer (non vérifié) | Ouvrir une facture, afficher ses données, parfois la valider | Concurrents directs |
| Gestion, comptabilité, GED | GrandTotal, Paperless-ngx avec son greffon, OpenConcerto, Fakturama, EBP, Sage (ces quatre derniers non vérifiés) | Intégrer la facture dans des écritures, un classement, un archivage | Aval : ils consomment la facture, ils ne servent pas à la contrôler |
| Ligne de commande et bibliothèques | Mustang, `pdfdetach` (Poppler), `factur-x` (Python), Securibox.FacturX (non vérifié) | Extraire, valider, créer, en lot et dans des scripts | Complémentaires ; Mustang reste la référence de validation |
| Lecteurs PDF | Acrobat Reader, Foxit, Okular… | Afficher le PDF, enregistrer la pièce jointe | Le point de départ que l'application remplace |

## Concurrents directs, d'après leur page publique

| | Factur-X Reader | Quba Viewer | Treesoft Viewer | 7-PDF Validator | Aloaha GUI |
|---|---|---|---|---|---|
| Prix et licence | Gratuit, PolyForm Noncommercial | Gratuit, Apache 2.0 | Gratuit | Partagiciel : 10 validations, puis licence sur demande | Payant |
| Systèmes | Windows ; macOS et Linux construits, non vérifiés | Windows, macOS, Linux | Non précisé sur la page | Windows | Windows, portable |
| Interface | Français | Allemand, anglais, français | Anglais, allemand | Non documenté | Non documenté |
| ZUGFeRD 1.x | — | ✅ | Non documenté | Non documenté | Non documenté |
| Order-X | — | ✅ | — | — | — |
| Validation EN 16931 | ✅ sur le poste | En ligne, avec un compte | Module séparé | Sur les serveurs de l'éditeur | Non documenté |
| Règles françaises (BR-FR, EXTENDED-CTC-FR) | ✅ sur le poste | — | — | — | — |
| PDF/A-3 | Partiel | En ligne | Non documenté | ✅ PDF/A-3b et 3u, côté serveur | Non documenté |
| Contrôles arithmétiques détaillés | ✅ | — | — | Via la validation | — |
| Plusieurs factures : tableau, totaux, filtres | ✅ | — | Registre des factures | — | — |
| Historique : IBAN, doublons, prix | ✅ | — | — | — | — |
| Pointage, statuts, commentaires | ✅ | — | — | — | — |
| Renommage et classement des fichiers | — | — | ✅ d'après les champs de la facture | — | — |
| Ligne de commande | Ouverture de fichiers seulement | — | — | ✅ modes console et caché, codes de retour | Non documenté |
| Rapport | JSON et PDF | — | Non documenté | ✅ rapport de validation | — |
| Création ou modification de factures | — | — | Modules payants (non vérifié) | — | ✅ |

Dans la deuxième famille, deux fonctions à retenir : GrandTotal (macOS, formules à 9,90 € et
14,90 € par mois) collecte les factures reçues depuis un **dossier surveillé**, une boîte mail ou
Peppol ; le greffon paperless-ngx-erechnung (GPL 3.0) extrait numéro, date, échéance, vendeur et
totaux à l'entrée d'une GED auto-hébergée.

## Ce que ce bilan fait ressortir

**Ce que Factur-X Reader est seul à faire, parmi les outils vérifiés :**

- valider **sans réseau** : Schematron officiel, schéma XSD et règles françaises tournent sur le
  poste. Quba passe par un serveur et un compte, 7-PDF envoie le fichier à ses serveurs, Treesoft
  vend la validation à part ;
- appliquer les **règles de la réforme française** (BR-FR, EXTENDED-CTC-FR) ;
- travailler sur un **lot** : tableau, totaux par devise, filtres d'anomalies, export ;
- garder un **historique** qui alerte sur un IBAN nouveau, un doublon, un prix modifié ;
- porter un **suivi de vérification** : pointage, statuts, commentaires.

Les autres visionneuses affichent une facture ; celle-ci sert à la vérifier.

**Ce que l'étude dit de Factur-X Reader et qui est inexact :**

| L'étude dit | En réalité |
|---|---|
| Validation « partielle (parsing syntaxique) », pas de Schematron | Schematron officiel EN 16931, profils Factur-X, EXTENDED-CTC-FR et BR-FR ; schéma XSD ; contrôle partiel du conteneur PDF |
| Pas de traitement par lots | Ouverture d'un dossier, 500 documents, tableau multi-factures, bibliothèque |
| Pas de rapport d'erreur | Rapport de contrôle JSON/PDF, exports CSV/XLSX |
| « Open Source (Libre) » | PolyForm Noncommercial : source consultable, usage commercial soumis à accord |
| Windows, macOS, Linux | Seul Windows est vérifié (voir [VALIDATION.md](VALIDATION.md)) |
| Démarrage en moins d'une seconde, 35 à 50 Mo de mémoire, 15 Mo | Démarrage et mémoire jamais mesurés. L'exécutable Windows 0.7.0 pèse 19 Mo, son installeur 5 Mo |

**Ce que l'étude dit des autres et que leur page contredit :**

- 7-PDF est présenté comme local : sa page indique que les fichiers sont transmis à ses serveurs
  en Allemagne pour la validation ;
- Quba est présenté avec un moteur de validation intégré : son dépôt parle de validation en
  ligne, avec un compte ;
- Treesoft est présenté avec une validation intégrée : c'est un module distinct ;
- GrandTotal est présenté avec un « Invoice Viewer » gratuit : la page consultée n'en fait pas
  mention ;
- l'étude situe le passage du CII D16B au D22B à Factur-X 1.08 ; nos notes le situent à 1.0.07.
  À revérifier dans la spécification.

## Ce qu'il nous manque

### Déjà au ROADMAP, confirmé par la concurrence

| Manque | Qui le fait | Où dans le ROADMAP | Avis |
|---|---|---|---|
| Comparaison PDF ↔ XML : montants clés cherchés dans le texte du PDF | Aucun outil vérifié ne le fait automatiquement | P3 | **À remonter.** C'est le risque que l'étude met le plus en avant, et personne n'y répond : un écart net avec toutes les visionneuses |
| Signature des builds, mise à jour automatique | Tous les éditeurs établis | P3 | Condition pour être installé en entreprise |
| Renommage et classement d'après les données | Treesoft | P2 | Demande courante, effort faible |
| Dossier surveillé | GrandTotal, Paperless-ngx | P2 | Utile après le renommage |
| Rapport lisible (PDF ou HTML), rapport consolidé | 7-PDF | P2 | Rapport PDF par facture réalisé (non publié) ; consolidation à développer |
| Interface en anglais | Quba, Treesoft | P3 | Nécessaire hors de France ; l'allemand viendrait avec XRechnung |
| Ligne de commande et `facturx-core` | Mustang, 7-PDF, `factur-x` | P4 | Un mode sans fenêtre (`--rapport dossier/`, code de retour) couvrirait l'usage en script |
| Validation PDF/A-3 complète | 7-PDF, Mustang | P3, non prioritaire | Inchangé : métier de veraPDF |
| Signature électronique du PDF | Aloaha (non vérifié) | P3 | Inchangé |

### Nouveaux, absents du ROADMAP jusqu'ici

| Manque | Constat | Effort | Avis |
|---|---|---|---|
| ZUGFeRD 1.x | Sa racine `CrossIndustryDocument` n'est pas reconnue : le PDF est annoncé « sans XML de facture », ce qui est faux | Faible pour le dire clairement, moyen pour le lire | Corriger le message d'abord ; la lecture seulement si des fichiers réels se présentent |
| Order-X (bons de commande) | Non lu | Moyen | Plus tard : ce n'est pas une facture |
| Règles allemandes XRechnung | Une XRechnung est lue et validée EN 16931, pas contre ses règles nationales | Moyen : le moteur Schematron existe | À décider avec l'ouverture hors de France |
| Âge des règles embarquées | Le jeu de règles appliqué est nommé, mais rien n'avertit qu'il est ancien. Sans réseau, seule une nouvelle version de l'application les met à jour | Faible | Afficher version et date des règles, avertir au-delà d'un an |
| Chiffres mesurés | Poids annoncé faux de 4 Mo, démarrage et mémoire jamais mesurés | Faible | Mesurer et publier : c'est l'argument face à Electron |
| Export vers la comptabilité | Les progiciels créent les écritures ; l'application fournit des exports CSV/XLSX | — | Hors périmètre, comme la création de factures |

### Une décision avant le reste : la licence

Quba est sous Apache 2.0, Treesoft est gratuit pour tous. Factur-X Reader interdit l'usage
commercial sans accord écrit : une entreprise qui l'emploierait pour contrôler ses factures
fournisseurs doit donc le demander. Or c'est le public visé. Ce n'est pas un défaut à corriger
d'office, c'est un choix à faire en connaissance de cause par les deux auteurs :

- garder la licence, et dire clairement dans le README comment obtenir un accord ;
- ou autoriser l'usage interne en entreprise tout en réservant la revente (PolyForm Internal Use
  ou PolyForm Shield, par exemple).

La licence de `facturx-core` (ROADMAP, P4) dépend de la même décision.

## Sources

Pages consultées le 4 octobre 2026 :
[Quba Viewer](https://github.com/ZUGFeRD/quba-viewer) (version 1.5.1 du 9 novembre 2025),
[Treesoft XRechnung Viewer](https://treesoft.de/en/software/treesoft-e-invoice-toolkit/xinvoice-viewer),
[7-PDF E-Invoice Validator](https://www.7-pdf.fr/produits/pdf-e-invoice-validator),
[GrandTotal](https://www.mediaatelier.com/fr-FR/GrandTotal/),
[Aloaha ZUGFeRD GUI](https://www.zugferdpro.com/aloaha-zugferd-gui-en/),
[paperless-ngx-erechnung](https://github.com/bitbetterde/paperless-ngx-erechnung).
Mustang : [mustangproject.org](https://www.mustangproject.org/), d'après le tableau du README
établi le 3 octobre 2026.
