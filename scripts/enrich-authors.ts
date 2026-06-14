/**
 * enrich-authors.ts — best-effort link from authors to their German Wikipedia
 * page, verified by BOTH name and work. Candidates come from the reader ("who")
 * and, more reliably, the author parsed from "Name «Werk»" titles. A match must
 * (a) share first+last name tokens with the page title, and (b) be confirmed by
 * the work appearing on the page ("name+work") or the page being a person
 * ("name"). Cached + overridable (data/authors.overrides.json via prep/).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/data"); // derived data (published)
const PREP = resolve(HERE, "../prep");       // manual inputs (not published)
const UA = "literaturfest-meissen-companion/0.1 (+https://github.com/mxfh/literaturfest-meissen)";

const ROLE = /^(Autor(in)?|Schriftsteller(in)?|Schauspieler(in)?|Dr\.|Prof\.|Pfarrer(in)?|Dichter(in)?|Lyriker(in)?|Übersetzer(in)?|Herausgeber(in)?|Verleger(in)?|Kabarettist(in)?|Journalist(in)?|MDR[- ]\S+)\s+/i;

interface AuthorLink { name: string | null; url: string | null; basis: string }
interface WikiHit { title: string; link: string }

function cleanName(who: string): string | null {
  let s = who.replace(/\s*\(.*?\)\s*/g, " ").trim();
  s = (s.split(/\s+(?:und|&|mit|sowie|feat\.?)\s+|,/i)[0] ?? s).trim();
  s = s.replace(ROLE, "").replace(/\s+(liest|lesen|erzählt|singt|liefert)$/i, "").trim();
  if (s.length < 3 || s.length > 50 || !/^[A-ZÄÖÜ]/.test(s) || /[?!:„"»]/.test(s)) return null;
  const words = s.split(/\s+/);
  return words.length < 2 || words.length > 5 ? null : s;
}

async function search(name: string): Promise<WikiHit | null> {
  const url = `https://de.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&namespace=0&format=json&redirects=resolve`;
  try {
    const j = (await (await fetch(url, { headers: { "User-Agent": UA } })).json()) as [string, string[], string[], string[]];
    const title = j[1]?.[0], link = j[3]?.[0];
    if (!title || !link) return null;
    const toks = (s: string): Set<string> => new Set(s.toLowerCase().match(/\p{L}+/gu) ?? []);
    const n = (name.toLowerCase().match(/\p{L}+/gu) ?? []), t = toks(title);
    const first = n[0] ?? "", last = n[n.length - 1] ?? "";
    return first && last && t.has(first) && t.has(last) ? { title, link } : null;
  } catch { return null; }
}

async function summary(title: string): Promise<{ type?: string; description?: string; extract?: string } | null> {
  const url = `https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** "name+work" if a read work appears on the page; "name" if it's clearly a person; else "" (reject). */
function verify(s: { type?: string; description?: string; extract?: string } | null, works: Set<string>): string {
  if (!s || s.type === "disambiguation") return "";
  const text = `${s.description ?? ""} ${s.extract ?? ""}`;
  const lower = text.toLowerCase();
  if (/(begriffsklärung|organisation|\bverein\b|hilfsorganisation|unternehmen|gemeinde|ortsteil|fluss|gattung)/i.test(text)
      && !/(schriftsteller|autor|dichter)/i.test(text)) return "";
  const workHit = [...works].some((wk) => {
    const w = wk.toLowerCase();
    return w.length > 3 && (lower.includes(w) || w.split(/\s+/).some((tok) => tok.length >= 6 && lower.includes(tok)));
  });
  if (workHit) return "name+work";
  const isPerson = /\b1[5-9]\d\d\b|\b20[0-2]\d\b/.test(text)
    || /(schriftsteller|autor|dichter|lyriker|journalist|schauspiel|musiker|publizist|kabarettist|moderator|politiker|übersetzer|writer|author|geboren)/i.test(text);
  return isPerson ? "name" : "";
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function run(): Promise<void> {
  const events = (JSON.parse(readFileSync(resolve(OUT, "events.json"), "utf8")).events) as Array<{ who: string; bookAuthor: string; work: string }>;

  // candidates keyed by the exact lookup string the UI has (raw who / bookAuthor)
  const cand = new Map<string, { query: string; works: Set<string> }>();
  const add = (key: string, query: string | null, work: string): void => {
    if (!key || !query) return;
    const c = cand.get(key) ?? { query, works: new Set<string>() };
    if (work) c.works.add(work);
    cand.set(key, c);
  };
  for (const e of events) {
    add(e.who, cleanName(e.who), e.work);
    add(e.bookAuthor, e.bookAuthor, e.work);
  }

  const cachePath = resolve(OUT, "authors.json");
  const cache: Record<string, AuthorLink> = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")).authors ?? {}) : {};
  const ovPath = resolve(PREP, "authors.overrides.json");
  const ov: Record<string, { url?: string | null; name?: string }> = existsSync(ovPath) ? JSON.parse(readFileSync(ovPath, "utf8")) : {};

  const out: Record<string, AuthorLink> = {};
  let queried = 0, byWork = 0, byName = 0;
  for (const [key, { query, works }] of cand) {
    if (ov[key]) { out[key] = { name: ov[key].name ?? key, url: ov[key].url ?? null, basis: "override" }; continue; }
    if (cache[key]) { out[key] = cache[key]; if (cache[key].url) (cache[key].basis === "name+work" ? byWork++ : byName++); continue; }
    const hit = await search(query); queried++;
    await sleep(140);
    if (!hit) { out[key] = { name: query, url: null, basis: "" }; continue; }
    const basis = verify(await summary(hit.title), works); queried++;
    await sleep(140);
    out[key] = { name: query, url: basis ? hit.link : null, basis };
    if (basis === "name+work") byWork++; else if (basis === "name") byName++;
  }

  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  writeFileSync(cachePath, JSON.stringify({ attribution: "Autorenlinks: Wikipedia (CC BY-SA)", authors: sorted }, null, 2) + "\n");
  console.log(`authors: ${cand.size} candidates, ${queried} api calls; linked by work ${byWork}, by name ${byName}`);
  for (const [who, v] of Object.entries(sorted).filter(([, v]) => v.basis === "name+work").slice(0, 12)) console.log(`  [work] ${who} -> ${v.url}`);
}

const RUN_DIRECT = process.argv[1]?.endsWith("enrich-authors.ts") ?? false;
if (RUN_DIRECT) run().catch((e) => { console.error(e); process.exit(1); });
