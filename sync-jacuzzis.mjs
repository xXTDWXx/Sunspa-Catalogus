// scripts/sync-jacuzzis.mjs
// Node 18+ (heeft fetch ingebouwd). Installeer: npm i cheerio
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const BASE = "https://www.sunspabenelux.nl";
const CATEGORY = "/cat/jacuzzis/"; // bron voor jacuzzi's
const OUTFILE = path.resolve("products.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normUrl = (u) => new URL(u, BASE).toString();

function slugFromUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  // verwacht /p/<slug>/
  const i = parts.indexOf("p");
  return i >= 0 && parts[i + 1] ? parts[i + 1] : parts.at(-1);
}

function makeId(type, url) {
  return `${type}::${slugFromUrl(url)}`;
}

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

function pickJsonLd($) {
  const nodes = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get()
    .map((t) => t.trim())
    .filter(Boolean);

  for (const raw of nodes) {
    try {
      const data = JSON.parse(raw);
      // kan een object of array zijn
      const arr = Array.isArray(data) ? data : [data];
      const product = arr.find((x) => x && (x["@type"] === "Product" || (Array.isArray(x["@type"]) && x["@type"].includes("Product"))));
      if (product) return product;
    } catch {}
  }
  return null;
}

function parsePriceFromJsonLd(jsonLd) {
  // JSON-LD Offer(s) kan verschillen
  const offers = jsonLd?.offers;
  if (!offers) return null;
  const pick = Array.isArray(offers) ? offers[0] : offers;
  const p = pick?.price;
  if (p == null) return null;
  const n = Number(String(p).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseImageFromJsonLd(jsonLd) {
  const img = jsonLd?.image;
  if (!img) return null;
  if (Array.isArray(img)) return img[0] ?? null;
  return img;
}

function parseTitleFromJsonLd(jsonLd) {
  return jsonLd?.name ?? null;
}

function parseSpecsFromTable($) {
  // Veel productpagina's hebben specs als tabel (th/td) of list; we nemen een brede aanpak.
  const specs = [];

  // 1) Probeer tabel-achtige rijen
  $("table tr").each((_, tr) => {
    const cells = cheerio.load(tr)("th,td").map((_, td) => cheerio.load(td).text().trim()).get();
    if (cells.length >= 2) {
      const label = cells[0];
      const value = cells.slice(1).join(" ").trim();
      if (label && value) specs.push({ label, value });
    }
  });

  // 2) Fallback: definition lists
  $("dl").each((_, dl) => {
    const $dl = $(dl);
    const dts = $dl.find("dt").map((_, x) => $(x).text().trim()).get();
    const dds = $dl.find("dd").map((_, x) => $(x).text().trim()).get();
    for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
      if (dts[i] && dds[i]) specs.push({ label: dts[i], value: dds[i] });
    }
  });

  // Dedupe
  const key = (s) => `${s.label}::${s.value}`.toLowerCase();
  const seen = new Set();
  return specs.filter((s) => {
    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseProductLinksFromCategory($) {
  const links = new Set();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    const abs = normUrl(href);
    const u = new URL(abs);
    if (u.hostname.endsWith("sunspabenelux.nl") && u.pathname.startsWith("/p/")) {
      links.add(abs);
    }
  });
  return [...links];
}

function findNextPage($, currentUrl) {
  const relNext = $('link[rel="next"]').attr("href");
  if (relNext) return normUrl(relNext);

  // thema-afhankelijk: probeer "next" in paginatie
  const next = $("a.next, a.next.page-numbers, a[rel=next]").attr("href");
  if (next) return normUrl(next);

  return null;
}

async function collectAllJacuzziProductUrls() {
  const out = new Set();
  let url = normUrl(CATEGORY);

  while (url) {
    const html = await getHtml(url);
    const $ = cheerio.load(html);

    parseProductLinksFromCategory($).forEach((u) => out.add(u));

    const next = findNextPage($, url);
    url = next && !out.has(next) ? next : next; // safe; loop stopt als next null
    // rate limit
    await sleep(700);
    // als next == currentUrl -> stop
    if (next === null) break;
    if (next === url && next === normUrl(CATEGORY)) break;
  }

  return [...out];
}

async function parseProduct(url) {
  const html = await getHtml(url);
  const $ = cheerio.load(html);

  const jsonLd = pickJsonLd($);

  const title =
    parseTitleFromJsonLd(jsonLd) ||
    $("h1").first().text().trim() ||
    slugFromUrl(url);

  const image =
    parseImageFromJsonLd(jsonLd) ||
    $("img").first().attr("src") ||
    null;

  const price = parsePriceFromJsonLd(jsonLd);

  const specs = parseSpecsFromTable($);

  return {
    id: makeId("spa", url),
    type: "spa",
    title,
    url,
    image,
    price,
    bullets: [],
    specs
  };
}

async function main() {
  // 1) Lees huidige products.json (jouw app verwacht array-root) :contentReference[oaicite:2]{index=2}
  const currentRaw = await fs.readFile(OUTFILE, "utf-8");
  const current = JSON.parse(currentRaw);
  if (!Array.isArray(current)) throw new Error("products.json moet een array zijn.");

  // 2) Index op URL en ID
  const byUrl = new Map(current.filter(Boolean).map((p) => [p.url, p]));
  const byId = new Map(current.filter(Boolean).map((p) => [p.id, p]));

  // 3) Crawl alle jacuzzi product-urls
  const urls = await collectAllJacuzziProductUrls();

  let added = 0;
  let updated = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const parsed = await parseProduct(url);

    const existing = byUrl.get(url) || byId.get(parsed.id);

    if (!existing) {
      current.push(parsed);
      byUrl.set(url, parsed);
      byId.set(parsed.id, parsed);
      added++;
    } else {
      // “sync”: werk velden bij (maar behoud evt. handmatige toevoegingen als bullets)
      existing.title = parsed.title ?? existing.title;
      existing.image = parsed.image ?? existing.image;
      existing.price = parsed.price ?? existing.price;
      existing.specs = (parsed.specs && parsed.specs.length) ? parsed.specs : existing.specs;
      existing.type = existing.type || parsed.type;
      existing.id = existing.id || parsed.id;
      existing.url = existing.url || parsed.url;
      existing.bullets = Array.isArray(existing.bullets) ? existing.bullets : [];
      updated++;
    }

    await sleep(650);
  }

  // 4) Schrijf terug
  await fs.writeFile(OUTFILE, JSON.stringify(current, null, 2) + "\n", "utf-8");

  console.log(`Done. Jacuzzi URLs gevonden: ${urls.length}`);
  console.log(`Toegevoegd: ${added}, bijgewerkt: ${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
