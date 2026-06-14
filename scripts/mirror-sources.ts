/**
 * mirror-sources.ts — local, unpublished mirror of official source material used
 * for human review and title-translation context. Nothing under prep/source-mirror
 * is published.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "prep/source-mirror");
const PROGRAM_URL = "https://literaturfest-meissen.de/programm/";
const API_URL = "https://literaturfest-meissen.de/wp-json/wp/v2/pages?slug=programm&_fields=id,modified,link,content";
const UA = "literaturfest-meissen-companion-source-mirror/0.1 (+https://github.com/mxfh/lfm)";

interface MirrorEntry {
  url: string;
  path: string;
  bytes: number;
  contentType: string;
}

function safeName(url: string, index = 0): string {
  const u = new URL(url);
  const base = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || `asset-${index}`);
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || `asset-${index}`;
  return clean.includes(".") ? clean : `${clean}${extname(u.pathname) || ".bin"}`;
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "",
  };
}

function collectAssetUrls(html: string): string[] {
  const root = parse(html);
  const urls = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(raw, PROGRAM_URL).toString();
      if (!/literaturfest-meissen\.de/i.test(url)) return;
      if (/\.(pdf|jpe?g|png|webp|gif|svg)([?#].*)?$/i.test(url) || /\/wp-content\/uploads\//i.test(url)) urls.add(url);
    } catch {
      // ignore malformed links in source markup
    }
  };
  root.querySelectorAll("a[href]").forEach((el) => add(el.getAttribute("href")));
  root.querySelectorAll("img[src]").forEach((el) => add(el.getAttribute("src")));
  root.querySelectorAll("source[srcset],img[srcset]").forEach((el) => {
    const srcset = el.getAttribute("srcset") ?? "";
    srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).forEach(add);
  });
  return [...urls].sort();
}

mkdirSync(OUT, { recursive: true });
mkdirSync(resolve(OUT, "assets"), { recursive: true });

const page = await fetchBytes(PROGRAM_URL);
const pageHtml = new TextDecoder().decode(page.bytes);
writeFileSync(resolve(OUT, "programm.html"), pageHtml);

const api = await fetchBytes(API_URL);
const apiText = new TextDecoder().decode(api.bytes);
writeFileSync(resolve(OUT, "programm.wp-api.json"), apiText);
const apiJson = JSON.parse(apiText) as Array<{ id: number; modified: string; link: string; content: { rendered: string } }>;
const rendered = apiJson[0]?.content?.rendered ?? "";
writeFileSync(resolve(OUT, "programm.rendered.html"), rendered);

const assetUrls = [...new Set([...collectAssetUrls(pageHtml), ...collectAssetUrls(rendered)])];
const mirrored: MirrorEntry[] = [];
for (const [index, url] of assetUrls.entries()) {
  try {
    const asset = await fetchBytes(url);
    const name = `${String(index + 1).padStart(3, "0")}-${safeName(url, index)}`;
    const path = resolve(OUT, "assets", name);
    writeFileSync(path, asset.bytes);
    mirrored.push({ url, path: path.replace(`${ROOT}/`, ""), bytes: asset.bytes.length, contentType: asset.contentType });
  } catch (error) {
    console.warn(`skip ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const manifest = {
  mirroredAt: new Date().toISOString(),
  source: PROGRAM_URL,
  api: API_URL,
  pageModified: apiJson[0]?.modified ?? null,
  files: [
    { url: PROGRAM_URL, path: "prep/source-mirror/programm.html", bytes: page.bytes.length, contentType: page.contentType },
    { url: API_URL, path: "prep/source-mirror/programm.wp-api.json", bytes: api.bytes.length, contentType: api.contentType },
    { url: "wp-api:content.rendered", path: "prep/source-mirror/programm.rendered.html", bytes: Buffer.byteLength(rendered), contentType: "text/html" },
    ...mirrored,
  ],
};
writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`mirrored ${manifest.files.length} files to prep/source-mirror`);
console.log(`source modified: ${manifest.pageModified ?? "unknown"}`);
