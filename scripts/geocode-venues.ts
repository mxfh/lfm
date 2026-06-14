/**
 * geocode-venues.ts — geocode the unique venues from events.json via Nominatim
 * (OpenStreetMap). Incremental + cached: only new/failed venues are queried, so
 * re-runs are cheap and polite (max 1 req/s per OSM policy).
 *
 * Manual fixes go in data/venues.overrides.json: { "<key>": { lat, lon, query?, note? } }.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/data"); // derived data (published)
const PREP = resolve(HERE, "../prep");       // manual inputs (not published)
const UA = "literaturfest-meissen-companion/0.1 (+https://github.com/mxfh/literaturfest-meissen)";
const PLZ_CITY = "01662 Meißen, Deutschland";
// Meißen viewbox (left,top,right,bottom) biases Nominatim toward the old town.
const VIEWBOX = "13.450,51.182,13.505,51.150";

export interface Venue {
  key: string; no: string; venue: string; query: string;
  lat: number; lon: number; display: string; source: string;
}

const STREET = "straße|gasse|platz|markt|berg|weg|stufen|freiheit|ufer|ring|allee|damm|hof|zeile|wall|tor|stieg|gang|reihe|brücke|steig|stieg|strasse";
const STREET_RE = new RegExp(`([A-ZÄÖÜ][A-Za-zäöüß.\\-]*(?:${STREET}))\\s+(\\d+\\s?[a-zA-Z]?)`, "i");

function tidy(venue: string): string {
  let s = venue.split(/\s+Ecke\s+/i)[0] ?? venue;  // "X Ecke Y" -> X
  s = s.replace(/\s*\(.*?\)\s*/g, " ");             // drop parentheticals
  s = s.replace(/\bStr\.?\b/g, "Straße").replace(/([a-zäöü])str\b/gi, "$1straße");
  return s.replace(/\s+/g, " ").trim();
}

/** Ordered candidate queries (best first). Nominatim chokes on business-name
 *  prefixes, so prefer the street; squares/churches fall back to the name. */
function buildCandidates(venue: string): string[] {
  const v = tidy(venue);
  const segs = v.split(",").map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  const push = (q?: string): void => { if (q && !out.includes(q)) out.push(q); };

  const segWithNum = segs.slice(1).find((s) => /\d/.test(s)) ?? (/\d/.test(segs[0] ?? "") ? segs[0] : undefined);
  push(segWithNum);                          // after-comma street segment
  push(v.match(STREET_RE)?.[0]);             // regex-extracted "Street Nr"
  push(segs[segs.length - 1]);               // last segment (named place)
  push(segs[0]);                             // first segment (named place)
  return out.map((q) => `${q}, ${PLZ_CITY}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function run(): Promise<void> {
  const events = (JSON.parse(readFileSync(resolve(OUT, "events.json"), "utf8")).events) as Array<{ venueNo: string; venue: string }>;
  const uniq = new Map<string, { no: string; venue: string }>();
  for (const e of events) {
    const key = e.venueNo || e.venue;
    if (key && !uniq.has(key)) uniq.set(key, { no: e.venueNo, venue: e.venue });
  }

  const cachePath = resolve(OUT, "venues.json");
  const cache = new Map<string, Venue>();
  if (existsSync(cachePath))
    for (const v of (JSON.parse(readFileSync(cachePath, "utf8")).venues as Venue[])) cache.set(v.key, v);

  const ovPath = resolve(PREP, "venues.overrides.json");
  const overrides: Record<string, { lat: number; lon: number; query?: string; note?: string }> =
    existsSync(ovPath) ? JSON.parse(readFileSync(ovPath, "utf8")) : {};

  const out: Venue[] = [];
  const failed: string[] = [];
  let geocoded = 0, cached = 0, overridden = 0;

  for (const [key, info] of uniq) {
    if (overrides[key]) {
      const o = overrides[key];
      out.push({ key, no: info.no, venue: info.venue, query: o.query ?? buildCandidates(info.venue || key)[0] ?? key, lat: o.lat, lon: o.lon, display: o.note ?? "(override)", source: "override" });
      overridden++;
      continue;
    }
    const hit = cache.get(key);
    if (hit && hit.lat && hit.lon && hit.source !== "failed") { out.push(hit); cached++; continue; }

    const candidates = buildCandidates(info.venue || key);
    let placed = false;
    for (const query of candidates) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&viewbox=${VIEWBOX}&q=${encodeURIComponent(query)}`;
      let arr: Array<{ lat: string; lon: string; display_name: string }> = [];
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
        arr = (await res.json()) as typeof arr;
      } catch { /* network hiccup -> try next candidate */ }
      await sleep(1100); // Nominatim: max 1 req/s
      if (arr[0]) {
        out.push({ key, no: info.no, venue: info.venue, query, lat: +arr[0].lat, lon: +arr[0].lon, display: arr[0].display_name, source: "nominatim" });
        geocoded++; placed = true; break;
      }
    }
    if (!placed) {
      out.push({ key, no: info.no, venue: info.venue, query: candidates[0] ?? key, lat: 0, lon: 0, display: "", source: "failed" });
      failed.push(`${key} :: ${info.venue}`);
    }
  }

  out.sort((a, b) => (Number(a.no) || 999) - (Number(b.no) || 999) || a.key.localeCompare(b.key));
  writeFileSync(cachePath, JSON.stringify({ attribution: "© OpenStreetMap contributors (geocoded via Nominatim)", venues: out }, null, 2) + "\n");

  console.log(`venues: ${out.length}  (geocoded ${geocoded}, cached ${cached}, override ${overridden}, failed ${failed.length})`);
  if (failed.length) {
    console.log("FAILED — add to data/venues.overrides.json:");
    for (const f of failed) console.log("  " + f);
  }
}

const RUN_DIRECT = process.argv[1]?.endsWith("geocode-venues.ts") ?? false;
if (RUN_DIRECT) run().catch((e) => { console.error(e); process.exit(1); });
