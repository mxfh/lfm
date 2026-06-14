import type { LfmEvent } from "./data";

const ORG_RE = /angestellte|kinder|schüler|stadtelternrat|familie|verein|gruppe|partnerschaft|bahn|chor|orchester|ensemble|bibliothek|team|klasse|deutsche/i;
const AUTHOR_ROLE_RE = /autor|autorin|bestseller|schriftsteller|dichter|lyrik|übersetzer|uebersetzer/i;

export function personKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isAuthorRole(role: string): boolean {
  return AUTHOR_ROLE_RE.test(role);
}

export function cleanPersonName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\b(autor(?:in|en)?|bestsellerautor(?:in)?|spiegel|meißner|meissner|sächsische|schauspieler|künstler|professor|redakteur|moderator(?:in)?|übersetzer(?:in)?|uebersetzer(?:in)?|illustrator(?:in)?|verleger(?:in)?|der|die|das|dem|den|ein|eine|mit|am|an der)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitPersonNames(raw: string): string[] {
  const cleaned = cleanPersonName(raw)
    .replace(/[,;/&+]| und | sowie /gi, " | ");
  return cleaned
    .split("|")
    .map((part) => part.trim())
    .filter((name) => name && !ORG_RE.test(name) && /[A-ZÄÖÜ][a-zäöüß]/.test(name) && name.split(/\s+/).length <= 4);
}

export function authorNamesForEvent(event: LfmEvent): string[] {
  const names = new Set<string>();
  if (event.bookAuthor) names.add(cleanPersonName(event.bookAuthor));
  if (isAuthorRole(event.role)) splitPersonNames(event.who).forEach((name) => names.add(name));
  return [...names].filter(Boolean);
}

export function presenterNamesForEvent(event: LfmEvent): string[] {
  if (isAuthorRole(event.role)) return [];
  return splitPersonNames(event.who);
}
