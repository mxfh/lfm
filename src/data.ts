/**
 * data.ts — typed access to the build-time program data. Imported by both the
 * server-rendered pages (instant, no-JS) and the client island (interactivity).
 * The same JSON also ships as static files under public/data/ for live refresh.
 */
import eventsJson from "../public/data/events.json";
import venuesJson from "../public/data/venues.json";
import distancesJson from "../public/data/distances.json";
import authorsJson from "../public/data/authors.json";

export interface LfmEvent {
  id: string; stableId: string; mkey: string; stableKey: string; date: string; weekday: string; start: string; startSort: string;
  end: string; durationMinutes: number;
  who: string; role: string; sourceBadge: string; featured: boolean; verb: string; title: string; genre: string; genreGroup: string; status: string;
  venueNo: string; venue: string; changed: boolean; languages: string[];
  bookAuthor: string; work: string; allDay: boolean;
}
export interface Venue { key: string; no: string; venue: string; lat: number; lon: number; display: string; source: string; }
export interface Distances { model: string; order: string[]; minutes: number[][]; meters: number[][]; }
export interface AuthorLink { name: string | null; url: string | null; }

export const events = (eventsJson.events as unknown) as LfmEvent[];
export const sourceUrl = eventsJson.source as string;
export const sourceModified = eventsJson.sourceModified as string;
export const venues = (venuesJson.venues as unknown) as Venue[];
export const distances = (distancesJson as unknown) as Distances;
export const authors = (authorsJson.authors as unknown) as Record<string, AuthorLink>;

/** A venue's stable key: its festival number, else the printed name. */
export const venueKeyOf = (e: { venueNo: string; venue: string }): string => e.venueNo || e.venue;

export const venuesByKey: ReadonlyMap<string, Venue> = new Map(venues.map((v) => [v.key, v]));
const distIndex = new Map(distances.order.map((k, i) => [k, i]));

/** Walking minutes between two venue keys (precomputed matrix); null if unknown. */
export function walkMinutes(fromKey: string, toKey: string): number | null {
  const i = distIndex.get(fromKey), j = distIndex.get(toKey);
  return i == null || j == null ? null : distances.minutes[i][j];
}
export function walkMeters(fromKey: string, toKey: string): number | null {
  const i = distIndex.get(fromKey), j = distIndex.get(toKey);
  return i == null || j == null ? null : distances.meters[i][j];
}

export interface Day { date: string; weekday: string }
export const days: Day[] = [...new Map(events.map((e) => [e.date, { date: e.date, weekday: e.weekday }])).values()]
  .sort((a, b) => a.date.localeCompare(b.date));

/** Languages actually present in the program (de first, then by frequency). */
export const languagesPresent: string[] = (() => {
  const c = new Map<string, number>();
  for (const e of events) for (const l of e.languages) c.set(l, (c.get(l) ?? 0) + 1);
  return [...c.keys()].sort((a, b) => (a === "de" ? -1 : b === "de" ? 1 : (c.get(b) ?? 0) - (c.get(a) ?? 0)));
})();

export const genres: string[] = [...new Set(events.map((e) => e.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));

/** Consolidated genre buckets for the filter (Sonstiges last). */
export const genreGroups: string[] = [...new Set(events.map((e) => e.genreGroup).filter(Boolean))]
  .sort((a, b) => (a === "Sonstiges" ? 1 : b === "Sonstiges" ? -1 : a.localeCompare(b, "de")));
