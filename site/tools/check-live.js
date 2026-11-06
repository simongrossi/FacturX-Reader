/*
 * Contrôle après déploiement : charge l'URL publique dans un vrai navigateur,
 * vérifie les erreurs console, les requêtes échouées, les images cassées et
 * l'absence de débordement horizontal.
 *
 * Usage : node site/tools/check-live.js [url]
 */
const path = require("node:path");
const { chromium } = require("playwright");

const SITE = process.argv[2] || "https://facturexreader.simongrossi.com/";

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on("console", (m) => m.type() === "error" && errors.push(`${viewport.name} console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${viewport.name} pageerror: ${e.message}`));
    page.on("requestfailed", (r) => errors.push(`${viewport.name} requête échouée: ${r.url()}`));

    const response = await page.goto(SITE, { waitUntil: "networkidle", timeout: 45000 });
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.8) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);

    const info = await page.evaluate(() => ({
      title: document.title,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
      noAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length,
    }));

    console.log(JSON.stringify({ viewport: viewport.name, status: response.status(), ...info }));
    await page.screenshot({ path: path.join(__dirname, "preview", `live-${viewport.name}.png`), fullPage: false });
    await page.close();
  }

  // Ressources essentielles.
  const page = await browser.newPage();
  for (const asset of [
    "/assets/css/style.css",
    "/assets/js/main.js",
    "/assets/img/controles.webp",
    "/assets/img/og-image.jpg",
    "/favicon.ico",
    "/mentions-legales",
    "/confidentialite",
    "/page-inexistante",
  ]) {
    const res = await page.request.get(new URL(asset, SITE).href);
    console.log(`${res.status()}  ${asset}`);
  }
  await page.close();

  console.log(errors.length ? "ERREURS:\n" + errors.join("\n") : "Aucune erreur navigateur.");
  await browser.close();
})();
