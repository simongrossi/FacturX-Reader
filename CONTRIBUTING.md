# Contribuer à Factur-X Reader

Les corrections, les signalements et les propositions sont bienvenus.

## Signaler un problème

Ouvrez une [issue](https://github.com/simongrossi/FacturX-Reader/issues) avec la version de
l'application, le système, ce que vous attendiez et ce que vous avez obtenu.

**Ne joignez jamais une facture réelle** : elle contient des données personnelles et
commerciales, et les issues sont publiques. Décrivez le cas, ou joignez un fichier fictif qui
le reproduit.

## Proposer une modification

1. Pour un changement important, ouvrez d'abord une issue pour en discuter.
2. Créez une copie du dépôt (bouton *Fork* de GitHub), puis une branche.
3. Lancez les tests avant d'envoyer (voir [README.md](README.md#tests)) :

   ```bash
   npm run check:js
   npm run test:ui
   npm run test:rust
   ```

4. Ouvrez une *pull request* vers `main`, en disant ce qui change et comment vous l'avez vérifié.

La copie créée sur GitHub sert à préparer une contribution. La diffuser comme un produit à part
n'est pas permis par la [licence](LICENSE.md).

## Droits sur les contributions

Factur-X Reader est distribué sous licence [PolyForm Shield 1.0.0](LICENSE.md). Ses titulaires
des droits sont Christophe Mehault et Simon Grossi.

En proposant une contribution (code, documentation, test, fichier d'exemple), vous :

- certifiez en être l'auteur, ou avoir le droit de la proposer ;
- restez titulaire de vos droits d'auteur sur elle ;
- accordez à Christophe Mehault et Simon Grossi une licence gratuite, mondiale, non exclusive,
  perpétuelle et irrévocable pour l'utiliser, la modifier, la distribuer et la redistribuer
  sous toute licence, celle du projet ou une autre.

Cette règle permet aux auteurs de faire évoluer la licence du projet sans avoir à retrouver
chaque contributeur. Si elle ne vous convient pas, dites-le dans l'issue avant d'écrire du code.

Les contributeurs sont cités dans [AUTHORS.md](AUTHORS.md) s'ils le souhaitent.

## Composants tiers

Les règles Schematron et les schémas XSD embarqués sont repris sans modification de leurs
sources officielles et gardent leur licence (voir [NOTICE.md](NOTICE.md)). Ne les corrigez pas
ici : une erreur dans une règle se signale au projet d'origine.
