# Site vitrine — facturxreader.com

Site statique du projet **Factur-X Reader** : une seule page d'accueil, deux pages légales,
aucune dépendance, aucun build. Le dossier se copie tel quel sur un serveur web.

## Contenu

```
site/
├── index.html                        page d'accueil (héros, atouts, fonctionnalités, aperçu, comparatif, FAQ)
├── verifier-facture-factur-x.html    guide : les 7 contrôles d'une facture Factur-X
├── recevoir-facture-electronique.html guide : obligations de la réforme 2026
├── alternative-quba-viewer.html      comparatif face à Quba Viewer
├── mentions-legales.html             éditeur, hébergeur, propriété intellectuelle
├── confidentialite.html              cookies, journaux, données, RGPD
├── 404.html                          page introuvable
├── robots.txt                        indexation + sitemap
├── sitemap.xml                       six URL
├── assets/
│   ├── css/style.css                 design system complet (clair et sombre)
│   ├── css/guide.css                 sommaire, encadrés et tableaux des guides
│   ├── js/main.js                    thème, menu mobile, apparitions au défilement
│   └── img/                          favicon, icône Apple, captures WebP/JPEG, image Open Graph
├── deploy/                           configurations Caddy, nginx et Apache prêtes à adapter
└── tools/                            scripts de génération (images, aperçu) — à ne pas publier
```

`tools/` sert uniquement au développement : **ne l'envoyez pas sur le serveur**
(le `rsync` ci-dessous l'exclut).

## Prévisualiser en local

```powershell
node site/tools/preview.js
```

Le script démarre un serveur local, écrit les captures dans `site/tools/preview/`
et vérifie au passage qu'aucune image ne casse et qu'il n'y a pas de débordement horizontal.

## Régénérer les images

Les captures viennent de `docs/screenshots/` et l'image Open Graph est composée à partir
d'elles. Après une nouvelle capture :

```powershell
python site/tools/build-images.py
```

Le script produit les versions WebP et JPEG, les variantes mobiles `-900` et
`assets/img/og-image.jpg` (1200 × 630).

## Mettre en ligne

### 1. DNS

Le domaine `facturxreader.com` est enregistré chez OVH, zone DNS OVH (anycast standard).
Enregistrements nécessaires :

| Type  | Nom                | Valeur                        |
|-------|--------------------|-------------------------------|
| A     | *(vide)* / `@`     | adresse IPv4 du serveur       |
| CNAME | `www`              | `facturxreader.com.`         |

Si le site est hébergé ailleurs (Netlify, Vercel, GitHub Pages…), utiliser un `CNAME`
vers la cible indiquée par cet hébergeur. La propagation prend de quelques minutes à
quelques heures.

> **Piège OVH** : la création du domaine installe par défaut deux « redirections »
> (`@` → `www`, puis `www` → page d'accueil OVH) qui interceptent le trafic avant
> qu'il n'atteigne le serveur. Il faut les supprimer dans l'onglet *Redirection*.

### 2. Fichiers

```bash
# Depuis la racine du dépôt
rsync -avz --delete \
  --exclude 'tools' --exclude 'deploy' --exclude 'README.md' \
  site/ user@serveur:/var/www/facturexreader/

# Droits lisibles par le serveur web
ssh user@serveur "chown -R www-data:www-data /var/www/facturexreader"
```

Variante FTP : envoyer le contenu de `site/` à la racine du domaine,
en conservant l'arborescence `assets/`.

### 3. Caddy (configuration du VPS)

Le VPS de production utilise Caddy comme reverse proxy ; le certificat Let's Encrypt est
obtenu et renouvelé automatiquement.

```bash
# Fichiers
sudo mkdir -p /var/www/facturexreader && sudo chown debian:debian /var/www/facturexreader
tar -xzf facturexreader-site.tar.gz -C /var/www/facturexreader

# Configuration
sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
sudo tee -a /etc/caddy/Caddyfile < site/deploy/caddy-facturexreader.conf
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

Le bloc à ajouter est conservé dans `deploy/caddy-facturexreader.conf`. Il sert les fichiers
directement (`file_server`), sans conteneur : pour un site statique de 1 Mo, un service
supplémentaire n'apporterait rien.

### 4. Nginx ou Apache (autre serveur)

Si le site est déployé sur une machine sans Caddy, utiliser `deploy/nginx-facturexreader.conf`
(avec `certbot --nginx`) ou `deploy/htaccess-apache.txt` (avec `certbot --apache`).

### 5. Vérifier

```bash
curl -I https://facturxreader.com/           # 200, text/html, zstd ou gzip
curl -I https://facturxreader.com/assets/css/style.css
curl -s -o /dev/null -w "%{http_code}\n" https://facturxreader.com/inexistant  # 404
```

Contrôle complet dans un vrai navigateur (console, requêtes échouées, images cassées) :

```powershell
node site/tools/check-live.js
```

## État du déploiement

| | |
|---|---|
| URL | <https://facturxreader.com> |
| Adresses redirigées | `www.facturxreader.com`, `facturexreader.com`, `www.facturexreader.com`, `facturexreader.simongrossi.com` → 301 |
| Domaine | `facturxreader.com` chez OVH, zone DNS OVH |
| Serveur | VPS (Infomaniak), Debian 13, Caddy 2.11 |
| Racine web | `/var/www/facturexreader` |
| Configuration | `site/deploy/caddy-facturxreader-com.conf`, ajouté à `/etc/caddy/Caddyfile` |
| Certificat | Let's Encrypt par domaine, renouvellement automatique par Caddy |
| Mise à jour | renvoyer les fichiers dans `/var/www/facturexreader` (aucun rechargement nécessaire) |

> Le nom du standard s'écrit **Factur-X**, sans « e » : le domaine canonique est
> `facturxreader.com`, en cohérence avec le dépôt `FacturX-Reader`. La variante
> `facturexreader.com` reste déposée et redirige.

## À compléter avant la publication

- **Adresse de l'éditeur** : non publiée (site édité à titre non professionnel, article 6 III 2
  de la LCEN). Si le site devient professionnel, publier une adresse postale et un SIRET.
- **Liens de téléchargement** : les boutons pointent vers la page des versions GitHub
  (`/releases`), ce qui reste valable à chaque nouvelle version. Pour un lien direct vers
  un installeur précis, remplacer l'URL par celle de l'asset :
  `https://github.com/simongrossi/FacturX-Reader/releases/latest/download/<fichier>`.
- **Domaine canonique** : les balises `canonical`, Open Graph et le `sitemap.xml` utilisent
  déjà `https://facturxreader.com/`. Si l'adresse change, les remplacer partout.

## Choix techniques

- **Aucun build, aucun framework** : le site s'ouvre par un simple serveur statique et reste
  lisible dans dix ans.
- **Aucune ressource distante** : pas de police Web, pas de CDN, pas d'analytics. La
  politique de confidentialité peut donc affirmer qu'aucun cookie n'est déposé.
- **Thème clair et sombre** avec mémorisation locale, sans flash au chargement.
- **Images** en WebP avec repli JPEG, dimensions déclarées pour éviter les sauts de mise en page.
- **Accessibilité** : lien d'évitement, contrastes vérifiés, focus visible, `prefers-reduced-motion`
  respecté, tableau comparatif avec en-têtes explicites.
