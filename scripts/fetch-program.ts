/**
 * fetch-program.ts — pull the Literaturfest Meissen program from the official
 * WordPress REST API and emit a clean, facts-only events.json.
 *
 * Source: https://literaturfest-meissen.de/programm/  (WP page, slug "programm")
 * API:    /wp-json/wp/v2/pages?slug=programm  -> content.rendered carries two
 *         TablePress tables: #23 = full program, #24 = changes/corrections.
 *
 * We republish only uncopyrightable facts (date, time, role, who, title,
 * genre tag, venue, status). The festival's descriptive "Info" blurb (col 7)
 * is NOT stored.
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type HTMLElement } from "node-html-parser";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "../public/data"); // derived data (published)
const SOURCE_PAGE = "https://literaturfest-meissen.de/programm/";
const API = "https://literaturfest-meissen.de/wp-json/wp/v2/pages?slug=programm&_fields=id,modified,content";
const YEAR = 2026;
const UA = "literaturfest-meissen-companion/0.1 (+https://github.com/mxfh/lfm; factual program listing)";

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, "märz": 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

export interface LfmEvent {
  id: string;
  stableId: string;    // deterministic UUID for this program point
  date: string;        // YYYY-MM-DD
  weekday: string;     // "Fr"
  start: string;       // "HH:MM" or ""
  end: string;         // inferred "HH:MM" or explicit fixture end; empty for all-day fixtures
  durationMinutes: number; // inferred from same-venue schedule, usually 30..60
  startSort: string;   // "YYYY-MM-DDTHH:MM" (HH:MM defaults 00:00 when missing)
  who: string;
  role: string;        // source column-3 role/badge with TiPP!/notices stripped
  sourceBadge: string; // raw source column-3 fact, including TiPP!/Hinweis/Achtung
  featured: boolean;   // highlighted as TiPP! by the official table
  verb: string;
  title: string;
  genre: string;
  genreGroup: string;  // consolidated genre bucket for filtering
  status: string;      // e.g. "Achtung! Lesung entfällt."
  venueNo: string;
  venue: string;       // name + street as printed
  changed: boolean;    // appeared in the changes table (#24)
  languages: string[]; // reading language(s); default ["de"], derived (high-precision)
  mkey: string;        // fuzzy match key (date+author+title) — legacy bookmark bridge
  stableKey: string;   // content key (author+title) — survives date/time/venue edits
  bookAuthor: string;  // author parsed from "Name «Werk»" titles (for Wikipedia linking)
  work: string;        // the «…» work title, if present
  allDay: boolean;     // permanent fixture (Ausstellung etc.) — pinned, excluded from now/next
}

/** Parse "Andrej Kurkow «Graue Bienen»" -> { bookAuthor:"Andrej Kurkow", work:"Graue Bienen" }. */
function parseBook(title: string): { bookAuthor: string; work: string } {
  const work = title.match(/«([^»]+)»/)?.[1]?.trim() ?? "";
  const m = title.match(/^([^«»]{2,48}?)\s*«/);
  let bookAuthor = (m?.[1] ?? "").replace(/[,–-]\s*$/, "").trim();
  const words = bookAuthor.split(/\s+/);
  if (!bookAuthor || words.length > 4 || !/^[A-ZÄÖÜ]/.test(bookAuthor) ||
      /(liest|lesen|lesung|abend|nachmittag|vorlese|gespräch|stimmen|geschichten)/i.test(bookAuthor)) bookAuthor = "";
  return { bookAuthor, work };
}

// High-precision reading-language detection. Most readings are German even when
// the book/author is foreign, so we only tag another language on an EXPLICIT
// signal ("…auf Arabisch", "ukrainischsprachig", native script). Derived fact;
// the source blurb itself is never stored. Correct edge cases via overrides.
const LANG_RX: ReadonlyArray<readonly [string, RegExp]> = [
  ["uk", /auf ukrainisch|ukrainischsprachig|ukrainische sprache|українськ/i],
  ["ar", /auf arabisch|arabischsprachig|arabische sprache|[؀-ۿ]/],
  ["es", /auf spanisch|spanischsprachig|spanische sprache|español/i],
  ["en", /auf englisch|englischsprachig|englische sprache/i],
  ["fr", /auf französisch|französischsprachig|französische sprache/i],
  ["ru", /auf russisch|russischsprachig/i],
  ["cs", /auf tschechisch|tschechischsprachig/i],
  ["pl", /auf polnisch|polnischsprachig/i],
];

function detectLanguages(title: string, info: string): string[] {
  const blob = `${title} ${info}`;
  const found = new Set<string>();
  for (const [code, rx] of LANG_RX) if (rx.test(blob)) found.add(code);
  if (found.size === 0) return ["de"];
  const bilingual = /zweisprachig|mehrsprachig|deutsch\s*[-–/&]|deutsch und|und deutsch/i.test(blob);
  return bilingual ? ["de", ...found] : [...found];
}

const clean = (s: string): string =>
  s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

const stripGenre = (s: string): string => clean(s).replace(/^\/+|\/+$/g, "").trim();
const toMinutes = (time: string): number | null => {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};
const toTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fixtureEnd = (event: Pick<LfmEvent, "title" | "start" | "allDay">): string => {
  if (event.allDay) return "";
  if (/flohmarkt/i.test(event.title)) return "16:00";
  const start = toMinutes(event.start);
  return start == null ? "" : toTime(start + 60);
};

// Consolidate the ~50 fine-grained festival genre tags into a short filter list.
// First match wins, so order matters (specific before broad).
// Labels are the festival's own Thema terms (the dominant tag of each bucket).
const GENRE_GROUPS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Kinder", /kinder/i],
  ["Krimi", /krimi|thriller|dystop|steampunk|urban[- ]?fantasy|spannung/i],
  ["Lyrik", /lyrik|poesie|poetisch|gedicht/i],
  ["Humor", /humor|kabarett|satire|glossen|tacheles|kessel buntes|damenrock/i],
  ["interkulturell", /interkulturell|fremd|ankommen/i],
  ["Reisen", /reise|afrika|iran|lettland|spanien|entdeck|hoch hinaus|\bwelt/i],
  ["historisch", /histor|klassiker|biograf/i],
  ["Religion & Philosophie", /religion|philosoph|glaube|psyche/i],
  ["Musik & Kunst", /musik|konzert|kunst|ausstellung|\bklassik\b|bühne/i],
  ["Gesellschaft", /gesellschaft|aktuell|business|beobacht|sport|körper|lecker|politik|wissen|natur/i],
  ["Belletristik", /belletrist|roman|erzähl|kurzgeschicht|novelle|literatur|bestseller|schicksal/i],
  ["Highlight", /highlight|empfehlung|preisgekrönt|classic nerd|explizit/i],
  ["lokal", /\blokal/i],
];
function genreGroupOf(g: string): string {
  if (!g) return "";
  for (const [name, rx] of GENRE_GROUPS) if (rx.test(g)) return name;
  return "Sonstiges";
}

function parseDate(dayCell: string): { date: string; weekday: string } | null {
  // "Mi 10. Juni" | "Fr 12. Juni"
  const c = clean(dayCell);
  const m = c.match(/^([A-Za-zäöü]{2,3})?\.?\s*(\d{1,2})\.\s*([A-Za-zäöü]+)/);
  if (!m) return null;
  const day = Number(m[2]);
  const month = MONTHS[(m[3] ?? "").toLowerCase()];
  if (!month || !day) return null;
  const weekday = (m[1] ?? "").replace(/\.$/, "");
  const date = `${YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, weekday };
}

function hashId(parts: string[]): string {
  // small stable FNV-1a -> base36, so bookmarks survive data refreshes
  let h = 0x811c9dc5;
  const s = parts.join("|").toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function stableUuid(input: string): string {
  const hex = createHash("sha1").update(input).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

type Cell = { text: string; classes: Set<string> };

function rowsOf(table: HTMLElement): Cell[][] {
  return table.querySelectorAll("tr").map((tr) =>
    tr.querySelectorAll("th,td").map((c) => ({
      text: clean(c.text),
      classes: new Set(c.classNames),
    })),
  );
}

function badgeFacts(cell: Cell | undefined): Pick<LfmEvent, "role" | "sourceBadge" | "status" | "featured"> {
  const sourceBadge = clean(cell?.text ?? "");
  const notice = cell?.classes.has("highlight-achtung") || cell?.classes.has("highlight-hinweis") ||
    /^(achtung|hinweis)!?/i.test(sourceBadge);
  const featured = cell?.classes.has("highlight-tipp") || /^tipp!/i.test(sourceBadge);
  const role = notice ? "" : sourceBadge.replace(/^tipp!\s*/i, "").trim();
  return { role, sourceBadge, status: notice ? sourceBadge : "", featured };
}

function splitLeadingRole(who: string, existingRole: string): { who: string; role: string } {
  if (existingRole || !who) return { who, role: existingRole };
  const m = who.match(/^(Autor(?:in|en)?|Autor und [^ ]+|Autorin und [^ ]+|Schauspieler|Künstler|Verleger|Übersetzer(?:in)?|MDR-Kultur-Redakteur)\s+(.+)$/i);
  return m ? { role: clean(m[1] ?? ""), who: clean(m[2] ?? "") } : { who, role: existingRole };
}

function cellText(r: Cell[], index: number): string {
  return clean(r[index]?.text ?? "");
}

function toEvent(r: Cell[], changed: boolean): LfmEvent | null {
  // cols: 0 Tag 1 Beginn 2 Badge/notice 3 Wer 4 Verb 5 Titel 6 Thema 7 Info 8 Leseort 9 Adresse
  const d = parseDate(cellText(r, 0));
  if (!d) return null;
  const start = cellText(r, 1).match(/\d{1,2}[:.]\d{2}/)?.[0]?.replace(".", ":") ?? "";
  const badge = badgeFacts(r[2]);
  const whoRole = splitLeadingRole(cellText(r, 3), badge.role);
  const who = whoRole.who;
  const title = cellText(r, 5);
  if (!who && !title) return null; // not a real listing
  const venueNo = cellText(r, 8);
  const venue = cellText(r, 9);
  const info = cellText(r, 7); // creative blurb — used only to derive facts, never stored
  const genre = stripGenre(cellText(r, 6));
  const ev: LfmEvent = {
    id: "",
    stableId: "",
    date: d.date,
    weekday: d.weekday,
    start,
    end: "",
    durationMinutes: 0,
    startSort: `${d.date}T${start || "00:00"}`,
    who,
    role: whoRole.role,
    sourceBadge: badge.sourceBadge,
    featured: badge.featured,
    verb: cellText(r, 4),
    title,
    genre,
    genreGroup: genreGroupOf(genre),
    status: badge.status,
    venueNo,
    venue,
    changed,
    languages: detectLanguages(title, info),
    mkey: "",
    stableKey: "",
    allDay: /ausstellung|basar|büchertisch|buchmarkt|antiquariat/i.test(title),
    ...parseBook(title),
  };
  const norm = (s: string): string => s.toLowerCase().replace(/[«»„""'’.,!?:;–—()-]/g, "").replace(/\s+/g, " ").trim();
  ev.mkey = hashId([ev.date, norm(ev.who), norm(ev.title)]);            // legacy: survives time/venue edits
  ev.stableKey = hashId([norm(ev.who), norm(ev.title)]);                // survives date/time/venue edits
  ev.id = hashId([ev.date, ev.start, ev.venueNo || ev.venue, ev.mkey]); // session identity (distinct repeats)
  return ev;
}

function inferDurations(events: LfmEvent[]): void {
  const byVenueDay = new Map<string, LfmEvent[]>();
  for (const event of events) {
    if (!event.start || event.allDay) {
      event.end = "";
      event.durationMinutes = 0;
      continue;
    }
    const key = `${event.date}|${event.venueNo || event.venue}`;
    const list = byVenueDay.get(key) ?? [];
    list.push(event);
    byVenueDay.set(key, list);
  }
  for (const list of byVenueDay.values()) {
    list.sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
    for (let i = 0; i < list.length; i++) {
      const event = list[i];
      const start = toMinutes(event.start);
      if (start == null) continue;
      if (/flohmarkt/i.test(event.title)) {
        const end = toMinutes(fixtureEnd(event));
        const duration = end == null || end <= start ? 60 : end - start;
        event.durationMinutes = duration;
        event.end = toTime(start + duration);
        continue;
      }
      const nextStart = toMinutes(list[i + 1]?.start ?? "");
      const gap = nextStart == null || nextStart <= start ? 60 : nextStart - start;
      const duration = Math.max(30, Math.min(60, gap));
      event.durationMinutes = duration;
      event.end = toTime(start + duration);
    }
  }
}

export async function run(): Promise<void> {
  const res = await fetch(API, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  const pages = (await res.json()) as Array<{ id: number; modified: string; content: { rendered: string } }>;
  const page = pages[0];
  if (!page) throw new Error("page slug=programm not found");

  const root = parse(page.content.rendered);
  const t23 = root.querySelector("#tablepress-23");
  const t24 = root.querySelector("#tablepress-24");
  if (!t23) throw new Error("tablepress-23 not found");

  const base = rowsOf(t23).map((r) => toEvent(r, false)).filter((e): e is LfmEvent => !!e);
  const changes = t24 ? rowsOf(t24).map((r) => toEvent(r, true)).filter((e): e is LfmEvent => !!e) : [];

  // Overlay #24 (corrections) onto #23 by fuzzy key: a matching session is
  // replaced with the corrected row (new time/venue/status); unmatched = new reading.
  const byMkey = new Map<string, LfmEvent[]>();
  for (const e of base) { const a = byMkey.get(e.mkey) ?? []; a.push(e); byMkey.set(e.mkey, a); }
  let merged = 0, added = 0;
  const extra: LfmEvent[] = [];
  for (const c of changes) {
    const hits = byMkey.get(c.mkey);
    if (hits && hits.length) {
      const target = hits.shift();
      if (target) base[base.indexOf(target)] = c; // corrected row wins
      c.changed = true;
      merged++;
    } else { extra.push(c); added++; }
  }
  const events = [...new Map([...base, ...extra].map((e) => [e.id, e])).values()].sort((a, b) =>
    a.startSort < b.startSort ? -1 : a.startSort > b.startSort ? 1 : a.venueNo.localeCompare(b.venueNo),
  );
  inferDurations(events);
  const stableCounts = new Map<string, number>();
  for (const event of events) {
    const key = event.stableKey || event.mkey;
    const occurrence = stableCounts.get(key) ?? 0;
    stableCounts.set(key, occurrence + 1);
    event.stableId = stableUuid(`lfm:${YEAR}:${key}:${occurrence}`);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const out = {
    source: SOURCE_PAGE,
    pageId: page.id,
    sourceModified: page.modified,
    counts: { program: base.length, changes: changes.length, total: events.length },
    events,
  };
  writeFileSync(resolve(DATA_DIR, "events.json"), JSON.stringify(out, null, 2) + "\n");

  // unique venues for the geocoder
  const venues = new Map<string, { no: string; venue: string; count: number }>();
  for (const e of events) {
    const key = e.venueNo || e.venue;
    if (!key) continue;
    const v = venues.get(key) ?? { no: e.venueNo, venue: e.venue, count: 0 };
    v.count++;
    if (!v.venue && e.venue) v.venue = e.venue;
    venues.set(key, v);
  }

  // concise summary (no full dumps)
  console.log(`source modified: ${page.modified}  (page ${page.id})`);
  console.log(`events: ${events.length}  (program ${base.length}, changes ${changes.length} -> merged ${merged}, added ${added})`);
  const days = [...new Set(events.map((e) => `${e.weekday} ${e.date}`))].sort();
  console.log(`days: ${days.join(" | ")}`);
  console.log(`unique venues: ${venues.size}`);
  console.log("\n--- changes table (#24) rows ---");
  for (const c of changes) console.log(`  [${c.date} ${c.start}] no=${c.venueNo} "${c.title}" | status="${c.status}" | ${c.who}`);
  console.log("\n--- venue list (no -> name, #events) ---");
  for (const [key, v] of [...venues.entries()].sort((a, b) => (Number(a[1].no) || 999) - (Number(b[1].no) || 999)))
    console.log(`  ${String(v.no || key).padStart(4)} -> ${v.venue}  (${v.count})`);
}

const RUN_DIRECT = process.argv[1]?.endsWith("fetch-program.ts") ?? false;
if (RUN_DIRECT) run().catch((e) => { console.error(e); process.exit(1); });
