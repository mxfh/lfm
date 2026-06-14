import type { LfmEvent } from "../data";
import { authors } from "../data";

/** Resolve a Wikipedia link for an event: prefer the work's author, else the reader. */
export function authorLinkFor(e: LfmEvent): { name: string; url: string } | null {
  for (const key of [e.bookAuthor, e.who]) {
    const a = key ? authors[key] : undefined;
    if (a?.url) return { name: a.name ?? key, url: a.url };
  }
  return null;
}

export const isCancelled = (e: LfmEvent): boolean => /entf[äa]llt/i.test(e.status);
export const isMoved = (e: LfmEvent): boolean =>
  !isCancelled(e) && /änderung|geändert/i.test(e.status) && !/neue\s+lesung/i.test(e.status);

/** Harmonized hue per genre bucket — one tonal system (consistent S/L, varied hue). */
const GENRE_HUE: Record<string, number> = {
  Kinder: 35, Belletristik: 222, Krimi: 352, Lyrik: 285, Humor: 330, Reisen: 175,
  historisch: 28, "Religion & Philosophie": 255, "Musik & Kunst": 305, Gesellschaft: 205,
  interkulturell: 145, Highlight: 48, lokal: 200, Sonstiges: 220,
};
export const hueOf = (g: string): number => GENRE_HUE[g] ?? 220;

/** "Fr 12.6." */
export function dayLabel(weekday: string, date: string): string {
  const [, m, d] = date.split("-");
  return `${weekday} ${Number(d)}.${Number(m)}.`;
}

/** Minutes since midnight for a HH:MM string. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
