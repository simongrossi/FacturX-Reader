/*
 * Aperçu local du site : sert site/ sur un port éphémère, capture le rendu
 * desktop et mobile, et rasterise l'icône Apple Touch depuis le SVG.
 *
 * Usage : node site/tools/preview.js
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "preview");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(fs.existsSync(path.join(ROOT, "404.html")) ? fs.readFileSync(path.join(ROOT, "404.html")) : "404");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();

  // Icône Apple Touch, rendue depuis le SVG officiel.
  const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await icon.setContent(
    `<style>html,body{margin:0;width:180px;height:180px;overflow:hidden;background:#0b6bcb}svg{width:180px;height:180px;display:block}</style>` +
      fs.readFileSync(path.join(ROOT, "assets/img/favicon.svg"), "utf8")
  );
  await icon.screenshot({ path: path.join(ROOT, "assets/img/apple-touch-icon.png"), omitBackground: true });
  await icon.close();

  const shots = [
    { name: "desktop", width: 1440, height: 900, full: true },
    { name: "desktop-fold", width: 1440, height: 900, full: false },
    { name: "mobile", width: 390, height: 844, full: true },
    { name: "tablet", width: 820, height: 1100, full: false },
  ];

  // Déclenche le chargement différé des images et l'apparition des blocs.
  async function settle(page) {
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.75);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 45));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
  }

  const errors = [];
  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 1,
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[${shot.name}] console: ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[${shot.name}] pageerror: ${err.message}`));
    page.on("requestfailed", (req) => errors.push(`[${shot.name}] requestfailed: ${req.url()}`));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), fullPage: shot.full });
    await page.close();
  }

  // Détail de quelques sections en pleine largeur.
  const detail = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await detail.goto(base + "/", { waitUntil: "networkidle" });
  await settle(detail);
  // L'en-tête collant recouvrirait les captures de section.
  await detail.addStyleTag({ content: ".site-header{display:none!important}" });
  for (const [name, selector] of [
    ["section-atouts", "#atouts"],
    ["section-apercu", "#apercu"],
    ["section-comparatif", "#comparatif"],
  ]) {
    const el = await detail.$(selector);
    if (el) await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  await detail.close();

  // Sections vues depuis un téléphone.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.emulateMedia({ reducedMotion: "reduce" });
  await phone.goto(base + "/", { waitUntil: "networkidle" });
  await settle(phone);
  await phone.addStyleTag({ content: ".site-header{display:none!important}" });
  for (const [name, selector] of [
    ["mobile-comparatif", "#comparatif"],
    ["mobile-formats", "#faq"],
  ]) {
    const el = await phone.$(selector);
    if (el) await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  await phone.close();

  // Pages légales et 404.
  for (const name of ["mentions-legales", "confidentialite", "404"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const response = await page.goto(`${base}/${name}.html`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    if (!response || response.status() >= 400) errors.push(`[${name}] HTTP ${response && response.status()}`);
    await page.close();
  }

  // Tous les liens internes doivent répondre.
  const linkPage = await browser.newPage();
  await linkPage.goto(base + "/", { waitUntil: "networkidle" });
  const hrefs = await linkPage.evaluate(() =>
    [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")))]
  );
  const internal = hrefs.filter((h) => h && !/^(https?:|mailto:|#)/.test(h));
  const brokenLinks = [];
  for (const href of internal) {
    const target = new URL(href, base + "/").href;
    const res = await linkPage.request.get(target);
    if (!res.ok()) brokenLinks.push(`${href} → ${res.status()}`);
  }
  await linkPage.close();

  // Vérifications de structure.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const report = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    return {
      title: document.title,
      h1: document.querySelectorAll("h1").length,
      overflowX: overflow,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      imagesWithoutAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).map((i) => i.src),
      brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
      firstPaintText: document.querySelector("h1")?.textContent?.trim().slice(0, 80),
    };
  });

  // Thème sombre.
  await settle(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "dark-fold.png"), fullPage: false });

  await page.addStyleTag({ content: ".site-header{display:none!important}" });
  for (const [name, selector] of [
    ["dark-fonctionnalites", "#fonctionnalites"],
    ["dark-comparatif", "#comparatif"],
  ]) {
    const el = await page.$(selector);
    if (el) await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  }

  console.log(JSON.stringify({ report, errors, brokenLinks }, null, 2));
  await browser.close();
  server.close();
})();
