/**
 * app.ts — the single client island. Pure DOM + localStorage; no framework.
 * The program is the default view; the big date button is also a time-jump.
 * Hydrates bookmarks, the day navigator + time-jump, the filter sheet, tap-a-
 * venue / tap-a-topic filtering with pills, "saved" (clones with walk feasibility),
 * UI-language switching (incl. RTL), theme, and a best-effort live refresh.
 */
import { translator, UI_LANGS, RTL, DEFAULT_LANG, type Lang, type T } from "../i18n";
import { cx, uiClass } from "../ui-classes";

interface Dist { order: string[]; minutes: number[][] }
interface WalkNetworkPayload {
  speedKmh: number;
  snapRadiusM: number;
  coordinateScale?: number;
  distancePrecisionM?: number;
  nodes: Array<[number, number]>;
  edges: Array<[number, number, number, string]>;
  venues: Record<string, [number, number, number]>;
}
interface PreparedWalkNetwork {
  payload: WalkNetworkPayload;
  lat: Float64Array;
  lon: Float64Array;
  x: Float64Array;
  y: Float64Array;
  originLat: number;
  originLon: number;
  adj: Array<Array<{ to: number; cost: number }>>;
}
interface WalkSnap { edge: number; t: number; offset: number; costA: number; costB: number }
type GpsRoutingWindow = Window & { lfmWalkMinutesFromGps?: (lat: number, lon: number, venueKey: string) => Promise<number | null> };
interface AppMeta {
  id: string;
  uidDomain: string;
  prodId: string;
  fileName: string;
  name: string;
  defaultEventTitle: string;
  sourceLabelKey: string;
  validationNoteKey: string;
}
interface SourceLink { id: string; labelKey: string; href: string }
interface Meta { sourceModified: string; sourceUrl: string; base: string; app: AppMeta; sources: SourceLink[] }
interface VenueAccessibilityNote { kind: "warning" | "info"; noteKey: string }
interface Labels { days: { date: string; label: string }[]; venues: Record<string, string>; venueAccessibility?: Record<string, VenueAccessibilityNote> }
interface PersonLink { label: string; url: string; kind?: string }
interface PersonProfile { name: string; links: PersonLink[]; events: string[] }
interface PeopleData { profiles: Record<string, PersonProfile> }
interface Saved { id: string; stableId?: string; mkey: string; stableKey?: string }
type SearchSuggestionKind = "author" | "venue" | "event";
interface SearchSuggestion {
  kind: SearchSuggestionKind;
  key: string;
  title: string;
  subtitle?: string;
  card?: HTMLElement;
  distance?: number | null;
}
type AppView = "program" | "saved" | "author" | "venue" | "event";
type RouteProvider = "apple" | "google";
type TransitionDocument = Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void> } };
type ShareCapableNavigator = Navigator & { share?: (data: { text: string }) => Promise<void> };
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string; platform?: string }>;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const toMin = (s: string): number => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const $ = <E extends Element = HTMLElement>(s: string, r: ParentNode = document): E | null => r.querySelector<E>(s);
const $$ = <E extends Element = HTMLElement>(s: string, r: ParentNode = document): E[] => [...r.querySelectorAll<E>(s)];
const readJSON = <X,>(id: string): X => JSON.parse(document.getElementById(id)?.textContent ?? "null") as X;
const save = (k: string, v: unknown): void => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const load = <X,>(k: string, d: X): X => { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as X) : d; } catch { return d; } };
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_EVENT_RUNNING_MINUTES = 60;
const FEATURE_FLAGS = { nearbyPlaces: false } as const;
const ENABLE_NEARBY_PLACES = FEATURE_FLAGS.nearbyPlaces;
const todayISO = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const canUseAppleMaps = (): boolean =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const googleRouteHref = (lat: number, lon: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
const appleRouteHref = (lat: number, lon: number, label: string): string =>
  `maps://?ll=${lat},${lon}&q=${encodeURIComponent(label)}&dirflg=w`;

const installDocumentOverscrollGuard = (): void => {
  let lastTouchY = 0;
  const rootScroller = (): HTMLElement => (document.querySelector("main") ?? document.scrollingElement ?? document.documentElement) as HTMLElement;
  const canScrollNested = (target: EventTarget | null, deltaY: number): boolean => {
    let el = target instanceof HTMLElement ? target : null;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if (deltaY > 0 && el.scrollTop > 0) return true;
        if (deltaY < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      }
      el = el.parentElement;
    }
    return false;
  };
  document.addEventListener("touchstart", (ev) => {
    if (ev.touches.length === 1) lastTouchY = ev.touches[0]?.clientY ?? 0;
  }, { passive: true });
  document.addEventListener("touchmove", (ev) => {
    if (ev.touches.length !== 1) return;
    const y = ev.touches[0]?.clientY ?? lastTouchY;
    const deltaY = y - lastTouchY;
    lastTouchY = y;
    if (deltaY === 0 || canScrollNested(ev.target, deltaY)) return;
    const root = rootScroller();
    const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
    if ((deltaY > 0 && root.scrollTop <= 0) || (deltaY < 0 && root.scrollTop >= maxScroll - 1)) ev.preventDefault();
  }, { passive: false });
};
installDocumentOverscrollGuard();
const smsHref = (text: string): string =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ? `sms:&body=${encodeURIComponent(text)}` : `sms:?body=${encodeURIComponent(text)}`;
const icsEscape = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const compactDate = (date: string): string => date.replaceAll("-", "");
const compactDateTime = (date: string, start: string): string => `${compactDate(date)}T${start.replace(":", "")}00`;
const addMinutes = (date: string, start: string, minutes: number): string => {
  const d = new Date(`${date}T${start}:00`);
  d.setMinutes(d.getMinutes() + minutes);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
};
const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};
const foldIcs = (line: string): string => line.length <= 73 ? line : line.match(/.{1,73}/g)?.join("\r\n ") ?? line;
const geoToLocal = (lat: number, lon: number, originLat: number, originLon: number): { x: number; y: number } => {
  const r = 6371000, rad = Math.PI / 180;
  return { x: (lon - originLon) * rad * r * Math.cos(originLat * rad), y: (lat - originLat) * rad * r };
};

const prepareWalkNetwork = (payload: WalkNetworkPayload): PreparedWalkNetwork => {
  const lat = new Float64Array(payload.nodes.length);
  const lon = new Float64Array(payload.nodes.length);
  let originLat = 0, originLon = 0;
  const coordinateScale = payload.coordinateScale ?? 1e6;
  payload.nodes.forEach(([la, lo], i) => { lat[i] = la / coordinateScale; lon[i] = lo / coordinateScale; originLat += lat[i]; originLon += lon[i]; });
  originLat /= Math.max(1, payload.nodes.length); originLon /= Math.max(1, payload.nodes.length);
  const x = new Float64Array(payload.nodes.length), y = new Float64Array(payload.nodes.length);
  for (let i = 0; i < payload.nodes.length; i++) { const p = geoToLocal(lat[i], lon[i], originLat, originLon); x[i] = p.x; y[i] = p.y; }
  const adj = Array.from({ length: payload.nodes.length }, () => [] as Array<{ to: number; cost: number }>);
  payload.edges.forEach(([a, b, cost]) => { adj[a].push({ to: b, cost }); adj[b].push({ to: a, cost }); });
  return { payload, lat, lon, x, y, originLat, originLon, adj };
};

export function initApp(): void {
  const appScroller = $<HTMLElement>("main");
  const updateVisualViewportInsets = (): void => {
    const vv = window.visualViewport;
    const focused = document.activeElement;
    const inputFocused = focused instanceof HTMLInputElement
      || focused instanceof HTMLTextAreaElement
      || focused instanceof HTMLSelectElement
      || (focused instanceof HTMLElement && focused.isContentEditable);
    const viewportLoss = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    const keyboardLikely = inputFocused && !!vv && viewportLoss > 80 && vv.height < window.innerHeight * 0.82;
    const top = keyboardLikely ? Math.max(0, vv.offsetTop) : 0;
    const bottom = keyboardLikely ? viewportLoss : 0;
    document.documentElement.style.setProperty("--lfm-visual-top", `${top}px`);
    document.documentElement.style.setProperty("--lfm-visual-bottom", `${bottom}px`);
  };
  const preventZoom = (ev: Event): void => ev.preventDefault();
  let preciseTouchScroll: { id: number; startY: number; startTop: number; y: number } | null = null;
  const nativeScrollTop = (): number => appScroller?.scrollTop ?? 0;
  const maxScrollTop = (): number => appScroller ? Math.max(0, appScroller.scrollHeight - appScroller.clientHeight) : 0;
  const scrollTop = (): number => {
    if (!preciseTouchScroll) return nativeScrollTop();
    const estimate = preciseTouchScroll.startTop + preciseTouchScroll.startY - preciseTouchScroll.y;
    return Math.max(0, Math.min(maxScrollTop(), estimate));
  };
  const appScrollTo = (top: number, behavior: ScrollBehavior = "auto"): void => {
    appScroller?.scrollTo({ top: Math.max(0, Math.min(maxScrollTop(), top)), behavior });
  };
  updateVisualViewportInsets();
  window.visualViewport?.addEventListener("resize", updateVisualViewportInsets, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateVisualViewportInsets, { passive: true });
  window.addEventListener("resize", updateVisualViewportInsets, { passive: true });
  window.addEventListener("focusin", updateVisualViewportInsets, { passive: true });
  window.addEventListener("focusout", () => window.setTimeout(updateVisualViewportInsets, 80), { passive: true });
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
    document.addEventListener(type, preventZoom, { passive: false });
  });
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (ev) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300) ev.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  const dist = readJSON<Dist>("lfm-dist");
  const meta = readJSON<Meta>("lfm-meta");
  const labels = readJSON<Labels>("lfm-labels");
  const people = readJSON<PeopleData>("lfm-people");
  let walkNetworkPromise: Promise<PreparedWalkNetwork> | null = null;
  const loadWalkNetwork = (): Promise<PreparedWalkNetwork> => {
    walkNetworkPromise ??= fetch(new URL("data/walk-network.json", new URL(meta.base, location.origin)).toString())
      .then((res) => {
        if (!res.ok) throw new Error(`walk network ${res.status}`);
        return res.json() as Promise<WalkNetworkPayload>;
      })
      .then(prepareWalkNetwork);
    return walkNetworkPromise;
  };
  const nearestWalkEdge = (net: PreparedWalkNetwork, lat: number, lon: number): WalkSnap | null => {
    const p = geoToLocal(lat, lon, net.originLat, net.originLon);
    let best: WalkSnap | null = null;
    net.payload.edges.forEach(([a, b, cost], edge) => {
      const dx = net.x[b] - net.x[a], dy = net.y[b] - net.y[a], len2 = dx * dx + dy * dy;
      if (len2 <= 0) return;
      const t = Math.max(0, Math.min(1, ((p.x - net.x[a]) * dx + (p.y - net.y[a]) * dy) / len2));
      const sx = net.x[a] + dx * t, sy = net.y[a] + dy * t;
      const offset = Math.hypot(p.x - sx, p.y - sy);
      if (!best || offset < best.offset) best = { edge, t, offset, costA: offset + cost * t, costB: offset + cost * (1 - t) };
    });
    const snap = best as WalkSnap | null;
    return snap && snap.offset <= net.payload.snapRadiusM ? snap : null;
  };
  const dijkstraFromSnap = (net: PreparedWalkNetwork, snap: WalkSnap): Float64Array => {
    const dist = new Float64Array(net.payload.nodes.length);
    dist.fill(Number.POSITIVE_INFINITY);
    const [a, b] = net.payload.edges[snap.edge];
    const queue: Array<{ node: number; cost: number }> = [{ node: a, cost: snap.costA }, { node: b, cost: snap.costB }];
    dist[a] = Math.min(dist[a], snap.costA); dist[b] = Math.min(dist[b], snap.costB);
    for (let qi = 0; qi < queue.length; qi++) {
      let best = qi;
      for (let j = qi + 1; j < queue.length; j++) if (queue[j].cost < queue[best].cost) best = j;
      [queue[qi], queue[best]] = [queue[best], queue[qi]];
      const item = queue[qi];
      if (item.cost !== dist[item.node]) continue;
      for (const edge of net.adj[item.node]) {
        const next = item.cost + edge.cost;
        if (next < dist[edge.to]) { dist[edge.to] = next; queue.push({ node: edge.to, cost: next }); }
      }
    }
    return dist;
  };
  (window as GpsRoutingWindow).lfmWalkMinutesFromGps = async (lat: number, lon: number, venueKey: string): Promise<number | null> => {
    const net = await loadWalkNetwork();
    const source = nearestWalkEdge(net, lat, lon);
    const venue = net.payload.venues[venueKey];
    if (!source || !venue) return null;
    const dist = dijkstraFromSnap(net, source);
    const [edgeIndex, t1000, offset] = venue;
    const [a, b, cost] = net.payload.edges[edgeIndex];
    const t = t1000 / 1000;
    const meters = Math.min(dist[a] + offset + cost * t, dist[b] + offset + cost * (1 - t));
    return Number.isFinite(meters) ? Math.max(1, Math.round((meters / 1000 / net.payload.speedKmh) * 60)) : null;
  };
  const distIdx = new Map(dist.order.map((k, i) => [k, i] as const));
  const walk = (a: string, b: string): number | null => {
    const i = distIdx.get(a), j = distIdx.get(b);
    return i == null || j == null ? null : dist.minutes[i][j];
  };
  const dayLabels = new Map(labels.days.map((d) => [d.date, d.label] as const));
  const venueLabels = new Map(Object.entries(labels.venues));
  const fdays = labels.days.map((d) => d.date);
  const cards = $$("[data-card]");
  const byId = new Map<string, HTMLElement>(cards.map((c) => [c.dataset.id ?? "", c] as const));
  const byStableId = new Map<string, HTMLElement>(cards
    .map((c) => [c.dataset.stableId ?? "", c] as const)
    .filter(([key]) => key.length > 0));
  const byMkey = new Map<string, HTMLElement[]>();
  for (const c of cards) { const m = c.dataset.mkey ?? ""; (byMkey.get(m) ?? byMkey.set(m, []).get(m)!).push(c); }
  const byStableKey = new Map<string, HTMLElement[]>();
  for (const c of cards) { const k = c.dataset.stableKey ?? ""; if (k) (byStableKey.get(k) ?? byStableKey.set(k, []).get(k)!).push(c); }

  // ---- bookmarks (re-link by mkey so corrections don't lose favourites) ----
  const SAVED = "lfm.saved";
  const savedForCard = (c: HTMLElement, fallback: Saved): Saved => ({
    id: c.dataset.id ?? fallback.id,
    stableId: c.dataset.stableId ?? fallback.stableId,
    mkey: c.dataset.mkey ?? fallback.mkey,
    stableKey: c.dataset.stableKey ?? fallback.stableKey,
  });
  let saved: Saved[] = load<Saved[]>(SAVED, []).map((s) => {
    const byExact = byId.get(s.id);
    if (byExact) return savedForCard(byExact, s);
    const stableId = s.stableId ? byStableId.get(s.stableId) : null;
    if (stableId) return savedForCard(stableId, s);
    const stable = s.stableKey ? byStableKey.get(s.stableKey) : null;
    if (stable && stable.length === 1) return savedForCard(stable[0], s);
    const m = byMkey.get(s.mkey);
    return m && m.length === 1 ? savedForCard(m[0], s) : s;
  });
  const savedIds = new Set(saved.map((s) => s.id));
  const persist = (): void => save(SAVED, saved);
  let updateActionButtons = (): void => {};
  let syncRoute = (_extra?: Record<string, string>, _replace?: boolean) => {};
  let applyingRoute = false;
  persist();

  const cardToIcs = (c: HTMLElement): string[] => {
    const id = c.dataset.stableId || c.dataset.id || String(Date.now());
    const title = c.dataset.calendarTitle || meta.app.defaultEventTitle;
    const who = c.dataset.calendarWho || "";
    const location = c.dataset.calendarLocation || "";
    const date = c.dataset.date || "";
    const start = c.dataset.start || "";
    const allDay = c.dataset.allday === "1" || !start;
    const lines = [
      "BEGIN:VEVENT",
      `UID:${id}@${meta.app.uidDomain}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
      `SUMMARY:${icsEscape(title)}`,
      location ? `LOCATION:${icsEscape(location)}` : "",
      `DESCRIPTION:${icsEscape([who, `${tt(meta.app.sourceLabelKey)}: ${meta.sourceUrl}`, tt(meta.app.validationNoteKey)].filter(Boolean).join("\n"))}`,
      `URL:${meta.sourceUrl}`,
    ].filter(Boolean);
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(date)}`, `DTEND;VALUE=DATE:${addDays(date, 1)}`);
    } else {
      const duration = Number(c.dataset.duration) || DEFAULT_EVENT_RUNNING_MINUTES;
      lines.push(`DTSTART;TZID=Europe/Berlin:${compactDateTime(date, start)}`, `DTEND;TZID=Europe/Berlin:${addMinutes(date, start, duration)}`);
    }
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(meta.app.name)}`, "TRIGGER:-PT30M", "END:VALARM", "END:VEVENT");
    return lines;
  };
  const downloadIcs = (items: HTMLElement[], filename: string): void => {
    if (!items.length) return;
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${meta.app.prodId}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(meta.app.name)}`, ...items.flatMap(cardToIcs), "END:VCALENDAR"];
    const blob = new Blob([lines.map(foldIcs).join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  };
  const routeUrl = (params: Record<string, string>): string => {
    const url = new URL(meta.base, location.origin);
    url.hash = new URLSearchParams(params).toString();
    return url.toString();
  };
  const entryShareUrl = (c: HTMLElement): string => {
    const entry = c.dataset.stableId || c.dataset.id || "";
    return routeUrl({
      view: "event",
      ...(entry ? { entry } : {}),
      ...(c.dataset.date ? { day: c.dataset.date } : {}),
    });
  };
  const cardWhenText = (c: HTMLElement, includeEnd = true): string => {
    const date = c.dataset.date ?? "";
    const timed = includeEnd ? [c.dataset.start, c.dataset.end].filter(Boolean).join("–") : (c.dataset.start ?? "");
    const time = c.dataset.allday === "1" ? tt("card.allday") : timed;
    return [dayLabels.get(date) ?? date, time].filter(Boolean).join(" · ");
  };
  const shareText = async (text: string): Promise<void> => {
    const nativeShare = (navigator as ShareCapableNavigator).share;
    if (nativeShare) {
      try {
        await nativeShare.call(navigator, { text });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    if (/iP(hone|ad|od)|Android/i.test(navigator.userAgent)) {
      location.href = smsHref(text);
      return;
    }
    try { await navigator.clipboard?.writeText(text); } catch { /* clipboard unavailable */ }
  };
  const messageText = (c: HTMLElement): string => {
    return [
      c.dataset.calendarTitle || meta.app.defaultEventTitle,
      c.dataset.calendarWho,
      cardWhenText(c),
      c.dataset.calendarLocation,
      entryShareUrl(c),
    ].filter(Boolean).join("\n");
  };
  const shareMessage = async (c: HTMLElement): Promise<void> => {
    await shareText(messageText(c));
  };
  const addSavedMessageAction = (clone: HTMLElement): void => {
    const action = $(".card-action", clone);
    if (!action || $("[data-message-share]", action)) return;
    const button = document.createElement("button");
    button.className = cx("message-entry", uiClass.ui);
    button.type = "button";
    button.dataset.messageShare = "1";
    button.setAttribute("aria-label", tt("saved.message"));
    button.setAttribute("title", tt("saved.message"));
    button.innerHTML = '<span class="ic ic-message"></span>';
    action.append(button);
  };

  const syncSaved = (id: string): void => {
    const on = savedIds.has(id);
    $$(`[data-id="${id}"]`).forEach((el) => { el.classList.toggle("is-saved", on); $("[data-bookmark]", el)?.setAttribute("aria-pressed", String(on)); });
  };
  const toggleSave = (id: string): void => {
    if (savedIds.has(id)) { savedIds.delete(id); saved = saved.filter((s) => s.id !== id); }
    else {
      const c = byId.get(id);
      savedIds.add(id);
      saved.push({ id, stableId: c?.dataset.stableId ?? "", mkey: c?.dataset.mkey ?? "", stableKey: c?.dataset.stableKey ?? "" });
    }
    persist(); syncSaved(id); if (!views.saved.hidden) renderSaved(); updateActionButtons();
  };
  savedIds.forEach(syncSaved);

  // ---- views (program | saved | author | venue | event) ----
  const views = { program: $("#view-program")!, saved: $("#view-saved")!, author: $("#view-author")!, venue: $("#view-venue")!, event: $("#view-event")! };
  const appHeader = $<HTMLElement>("#app-header");
  const timelineHead = $<HTMLElement>("#timeline-head");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeView: AppView = "program";
  let activeAuthorKey = "";
  let activeVenueKey = "";
  let activeEventId = "";
  const viewDepth: Record<AppView, number> = { program: 0, saved: 1, author: 1, venue: 1, event: 2 };
  const timelineViews = new Set<AppView>(["program", "author", "venue"]);
  const viewBackStack: string[] = [];
  const currentRouteTarget = (): string => location.hash || "#";
  const rememberBackTarget = (): void => {
    const target = currentRouteTarget();
    if (viewBackStack[viewBackStack.length - 1] !== target) viewBackStack.push(target);
    while (viewBackStack.length > 16) viewBackStack.shift();
  };
  const restoreRouteTarget = (target: string): void => {
    const next = target === "#" ? `${location.pathname}${location.search}` : target;
    history.pushState(null, "", next);
    applyRoute();
  };
  const navigateHome = (): void => {
    viewBackStack.length = 0;
    showView("program", false);
    syncRoute(undefined, false);
  };
  const navigateBack = (): void => {
    const target = viewBackStack.pop();
    if (target) {
      restoreRouteTarget(target);
      return;
    }
    showView("program", false);
    syncRoute(undefined, false);
  };
  ["filter-modal", "time-modal", "nearby-modal", "info-modal"].forEach((id) => {
    const dialog = document.getElementById(id);
    if (dialog) document.body.appendChild(dialog);
  });
  const timelineListForView = (view: AppView): HTMLElement | null => {
    if (view === "program") return $("#program-list");
    if (view === "author") return $("#author-events");
    if (view === "venue") return $("#venue-events");
    return null;
  };
  const placeTimelineHead = (view: AppView): void => {
    if (!timelineHead) return;
    const list = timelineListForView(view);
    timelineHead.hidden = !list;
    if (list && timelineHead.nextElementSibling !== list) list.before(timelineHead);
  };
  const cardByEntryKey = (key: string): HTMLElement | null => byStableId.get(key) ?? byId.get(key) ?? null;
  const activeEventCard = (): HTMLElement | null => activeEventId ? cardByEntryKey(activeEventId) : null;
  const visibleBox = (el: HTMLElement): DOMRect | null => {
    if (el.hidden) return null;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const visibleContentBottom = (root: HTMLElement): number => {
    const selectors = [
      "[data-card]",
      ".program-list-head",
      ".saved-head",
      ".view-head",
      ".saved-day-title",
      "#saved-empty",
      "#no-results",
    ].join(",");
    return $$<HTMLElement>(selectors, root).reduce((bottom, el) => {
      const rect = visibleBox(el);
      return rect ? Math.max(bottom, rect.bottom) : bottom;
    }, root.getBoundingClientRect().top);
  };
  const updateMainScrollState = (): void => {
    if (!appScroller) return;
    const root = views[activeView] ?? views.program;
    appScroller.classList.remove("is-scroll-locked", "needs-action-clearance");
    const mainRect = appScroller.getBoundingClientRect();
    const actionTops = $$<HTMLElement>(".thumb-jump")
      .map(visibleBox)
      .filter((rect): rect is DOMRect => !!rect)
      .map((rect) => rect.top);
    const actionTop = actionTops.length ? Math.min(...actionTops) : mainRect.bottom;
    const safeBottom = Math.min(mainRect.bottom, actionTop - 8);
    const contentBottom = visibleContentBottom(root);
    const needsActionClearance = contentBottom > safeBottom + 1;
    const actionClearanceHeight = needsActionClearance
      ? Math.max(0, mainRect.bottom - actionTop + 12)
      : 0;
    document.documentElement.style.setProperty("--lfm-action-clearance-height", `${Math.ceil(actionClearanceHeight)}px`);
    appScroller.classList.toggle("needs-action-clearance", needsActionClearance);
    const shouldLock = !needsActionClearance && contentBottom <= safeBottom + 1;
    appScroller.classList.toggle("is-scroll-locked", shouldLock);
    if (shouldLock && appScroller.scrollTop !== 0) appScroller.scrollTo({ top: 0, behavior: "auto" });
  };
  let mainScrollStateFrame = 0;
  const scheduleMainScrollState = (): void => {
    if (mainScrollStateFrame) return;
    mainScrollStateFrame = requestAnimationFrame(() => {
      mainScrollStateFrame = 0;
      updateMainScrollState();
    });
  };
  function updateStickyOffsets(): void {
    document.documentElement.style.setProperty("--lfm-sticky-header-height", `${appHeader?.offsetHeight ?? 0}px`);
    const activeRoot = views[activeView] ?? views.program;
    const viewHead = $(".sticky-view-head", activeRoot);
    document.documentElement.style.setProperty("--lfm-view-head-height", `${viewHead?.offsetHeight ?? 0}px`);
    const timeHeadHeight = timelineViews.has(activeView) && !timelineHead?.hidden ? timelineHead?.offsetHeight ?? 0 : 0;
    document.documentElement.style.setProperty("--lfm-time-sticky-top", `${timeHeadHeight}px`);
  }
  const renderGroupedCards = (cont: HTMLElement, items: HTMLElement[], enhanceSaved = false): void => {
    cont.innerHTML = "";
    let section: HTMLElement | null = null;
    let slot: HTMLElement | null = null;
    let currentDay = "";
    let currentTime = "";
    for (const c of items) {
      if (c.dataset.date !== currentDay) {
        currentDay = c.dataset.date ?? "";
        currentTime = "";
        section = document.createElement("section");
        section.className = "saved-day";
        const h = document.createElement("h3");
        h.className = cx("saved-day-title", uiClass.label);
        h.textContent = dayLabels.get(currentDay) ?? currentDay;
        section.appendChild(h);
        cont.appendChild(section);
      }
      const timeLabel = c.dataset.allday === "1" ? tt("card.allday") : (c.dataset.start || "—");
      if (timeLabel !== currentTime) {
        currentTime = timeLabel;
        slot = document.createElement("section");
        slot.className = "time-slot";
        slot.dataset.timeSlot = timeLabel;
        const h = document.createElement("h4");
        h.className = cx("time-slot-title", uiClass.clock);
        h.textContent = timeLabel;
        slot.appendChild(h);
        section?.appendChild(slot);
      }
      const clone = c.cloneNode(true) as HTMLElement;
      clone.removeAttribute("id");
      clone.hidden = false;
      if (enhanceSaved) addSavedMessageAction(clone);
      slot?.appendChild(clone);
    }
    refreshI18n(cont);
    refreshTitleTranslations(cont);
    savedIds.forEach(syncSaved);
  };
  const swapView = (v: AppView): void => {
    activeView = v;
    placeTimelineHead(v);
    (Object.keys(views) as AppView[]).forEach((k) => { views[k].hidden = k !== v; });
    $$("[data-tab]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.tab === v)));
    document.body.dataset.view = v;
    if (v === "saved") renderSaved();
    if (v === "author") renderAuthorView();
    if (v === "venue") renderVenueView();
    if (v === "event") renderEventView();
    markDatetimeMetricsDirty();
    updateStickyOffsets();
    updateDatetimeHeader();
    updateActionButtons();
    renderSearchSuggestions();
    updateStickyHeader();
  };
  const showView = (v: AppView, writeRoute = true): void => {
    if (v === activeView) {
      placeTimelineHead(v);
      if (v === "saved") renderSaved();
      if (v === "author") renderAuthorView();
      if (v === "venue") renderVenueView();
      if (v === "event") renderEventView();
      markDatetimeMetricsDirty();
      updateStickyOffsets();
      updateDatetimeHeader();
      updateActionButtons();
      renderSearchSuggestions();
      if (writeRoute) syncRoute(undefined, false);
      appScrollTo(0, reducedMotion.matches ? "auto" : "smooth");
      return;
    }
    if (writeRoute && !applyingRoute) rememberBackTarget();
    document.documentElement.dataset.viewDirection =
      v === "program" ? "back" : activeView === "program" || viewDepth[v] > viewDepth[activeView] ? "forward" : "back";
    const startViewTransition = (document as TransitionDocument).startViewTransition?.bind(document);
    const commitView = (): void => {
      swapView(v);
      if (writeRoute) syncRoute(undefined, false);
    };
    if (startViewTransition && !reducedMotion.matches && !applyingRoute) {
      startViewTransition(commitView).finished.finally(() => { delete document.documentElement.dataset.viewDirection; });
    } else {
      commitView();
      delete document.documentElement.dataset.viewDirection;
    }
    appScrollTo(0);
  };
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.tab as AppView)));
  $$("[data-back-program]").forEach((button) => button.addEventListener("click", navigateBack));
  $("#home-title")?.addEventListener("click", navigateHome);
  let stickyHeaderWatchUntil = 0;
  const watchStickyHeaderOffsets = (): void => {
    updateStickyOffsets();
    if (performance.now() < stickyHeaderWatchUntil) requestAnimationFrame(watchStickyHeaderOffsets);
  };
  const updateStickyHeader = (): void => {
    const next = scrollTop() > 48;
    const had = document.body.classList.contains("header-condensed");
    if (next === had) return;
    document.body.classList.toggle("header-condensed", next);
    stickyHeaderWatchUntil = performance.now() + 340;
    requestAnimationFrame(watchStickyHeaderOffsets);
    updateStickyOffsets();
  };
  appHeader?.addEventListener("transitionend", updateStickyOffsets);
  let savedSwipe: { x: number; y: number; lastX: number; lastY: number; id: number } | null = null;
  const finishSavedSwipe = (x: number, y: number): void => {
    if (!savedSwipe) return;
    const dx = x - savedSwipe.x;
    const dy = y - savedSwipe.y;
    savedSwipe = null;
    if (dx < -54 && Math.abs(dy) < 80) navigateBack();
  };
  views.saved.addEventListener("pointerdown", (ev) => {
    if (!ev.isPrimary || ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest("[data-back-program],button,a,input,select,textarea")) return;
    savedSwipe = { x: ev.clientX, y: ev.clientY, lastX: ev.clientX, lastY: ev.clientY, id: ev.pointerId };
    try { views.saved.setPointerCapture?.(ev.pointerId); } catch { /* synthetic or cancelled pointer */ }
  });
  views.saved.addEventListener("pointerup", (ev) => {
    if (!savedSwipe || savedSwipe.id !== ev.pointerId) return;
    finishSavedSwipe(ev.clientX, ev.clientY);
  });
  views.saved.addEventListener("pointercancel", () => { savedSwipe = null; });
  views.saved.addEventListener("touchstart", (ev) => {
    const t = ev.changedTouches[0];
    if (t) savedSwipe = { x: t.clientX, y: t.clientY, lastX: t.clientX, lastY: t.clientY, id: t.identifier };
  }, { passive: true });
  document.addEventListener("touchmove", (ev) => {
    if (!savedSwipe) return;
    const t = [...ev.changedTouches].find((touch) => touch.identifier === savedSwipe?.id);
    if (t) { savedSwipe.lastX = t.clientX; savedSwipe.lastY = t.clientY; }
  }, { passive: true });
  document.addEventListener("touchend", (ev) => {
    const t = [...ev.changedTouches].find((touch) => !savedSwipe || touch.identifier === savedSwipe.id);
    if (t) finishSavedSwipe(t.clientX, t.clientY);
    else if (savedSwipe) finishSavedSwipe(savedSwipe.lastX, savedSwipe.lastY);
  });

  const scrollToCard = (c: HTMLElement): void => {
    const activeRoot = views[activeView] ?? views.program;
    const viewHead = $(".sticky-view-head", activeRoot);
    const timeHead = timelineViews.has(activeView) && !timelineHead?.hidden ? timelineHead : null;
    const off = (viewHead?.offsetHeight ?? 0) + (timeHead?.offsetHeight ?? 0);
    const scrollerTop = appScroller?.getBoundingClientRect().top ?? 0;
    const top = c.getBoundingClientRect().top - scrollerTop + nativeScrollTop() - off - 8;
    appScrollTo(top, "smooth");
  };

  const cardSortKey = (c: HTMLElement): string => `${c.dataset.date ?? ""}${c.dataset.start ?? (c.dataset.allday === "1" ? "23:59" : "00:00")}`;
  const cardTime = (c: HTMLElement): number => {
    const start = c.dataset.start || (c.dataset.allday === "1" ? "23:59" : "00:00");
    return new Date(`${c.dataset.date ?? ""}T${start}:00`).getTime();
  };
  const cardEndTime = (c: HTMLElement): number => {
    if (c.dataset.allday === "1") return new Date(`${c.dataset.date ?? ""}T23:59:59`).getTime();
    if (c.dataset.end) return new Date(`${c.dataset.date ?? ""}T${c.dataset.end}:00`).getTime();
    const d = new Date(cardTime(c));
    d.setMinutes(d.getMinutes() + (Number(c.dataset.duration) || DEFAULT_EVENT_RUNNING_MINUTES));
    return d.getTime();
  };
  const coordValue = (value: string | undefined): number => value ? Number(value) : Number.NaN;
  const isCurrentOrSoonCard = (c: HTMLElement, now = Date.now()): boolean => {
    if (c.dataset.allday === "1") return c.dataset.date === todayISO();
    const start = cardTime(c);
    return Number.isFinite(start) && cardEndTime(c) >= now && start <= now + HOUR_MS;
  };

  // ---- profile and venue views ----
  const venueIndex = $("#venue-index");
  const venueTitle = $("#venue-title");
  const venueSwipe = $("#venue-swipe");
  const venueTitleTrack = $("#venue-title-track");
  const venuePrev = $<HTMLButtonElement>("#venue-prev");
  const venueNext = $<HTMLButtonElement>("#venue-next");
  const venueNextIndex = $("#venue-next-index");
  const venueAccessibility = $("#venue-accessibility");
  const venueListTrigger = $<HTMLButtonElement>("#venue-list-trigger");
  const venueRoute = $<HTMLButtonElement>("#venue-route");
  const routeModal = $<HTMLDialogElement>("#route-modal");
  const routeApple = $<HTMLAnchorElement>("#route-apple");
  const routeGoogle = $<HTMLAnchorElement>("#route-google");
  const routeSave = $<HTMLInputElement>("#route-save");
  const routeJump = $<HTMLButtonElement>("#route-jump");
  const viewShareJump = $<HTMLButtonElement>("#view-share-jump");
  const venueEvents = $("#venue-events");
  const authorTitle = $("#author-title");
  const authorListTrigger = $<HTMLButtonElement>("#author-list-trigger");
  const authorLinks = $("#author-links");
  const authorEvents = $("#author-events");
  const eventWhen = $("#event-when");
  const eventTitle = $("#event-title");
  const eventInfo = $("#event-info");
  const eventMeta = $("#event-meta");
  const eventAccessibility = $("#event-accessibility");
  const eventBookAuthor = $("#event-book-author");
  const eventBack = $<HTMLButtonElement>("#event-back");
  const eventSave = $<HTMLButtonElement>("#event-save");
  const eventShare = $<HTMLButtonElement>("#event-share");
  const eventRoute = $<HTMLButtonElement>("#event-route");
  const eventCalendar = $<HTMLButtonElement>("#event-calendar");
  const eventSource = $<HTMLAnchorElement>("#event-source");
  const ROUTE_PROVIDER = "lfm.routeProvider";
  const ROUTE_SAVE = "lfm.routeSaveSelection";
  const isRouteProvider = (value: string): value is RouteProvider => value === "apple" || value === "google";
  let routeProvider = load<string>(ROUTE_PROVIDER, "");
  let routeSaveSelection = load<boolean>(ROUTE_SAVE, false) && isRouteProvider(routeProvider);
  let routeAvailable = false;
  if (routeSave) routeSave.checked = routeSaveSelection;
  const routeProviderLinks = [routeApple, routeGoogle].filter((link): link is HTMLAnchorElement => !!link);
  const applyAccessibilityNote = (target: HTMLElement | null, venueKey: string): void => {
    if (!target) return;
    const note = labels.venueAccessibility?.[venueKey];
    target.hidden = !note;
    target.dataset.kind = note?.kind ?? "";
    target.textContent = note ? `${tt("access.prefix")}: ${tt(note.noteKey)}` : "";
  };
  const syncRouteProviderSelection = (): void => {
    routeProviderLinks.forEach((link) => {
      const selected = routeSaveSelection && link.dataset.routeProvider === routeProvider;
      link.dataset.selected = String(selected);
      link.setAttribute("aria-pressed", String(selected));
    });
  };
  const updateVenueRoute = (lat: number, lon: number, label: string): void => {
    const ok = Number.isFinite(lat) && Number.isFinite(lon);
    routeAvailable = ok;
    if (venueRoute) venueRoute.hidden = !ok;
    if (!ok) { syncRouteProviderSelection(); updateActionButtons(); return; }
    if (routeApple) {
      routeApple.href = appleRouteHref(lat, lon, label);
      routeApple.hidden = !canUseAppleMaps();
    }
    if (routeGoogle) routeGoogle.href = googleRouteHref(lat, lon);
    syncRouteProviderSelection();
    updateActionButtons();
  };
  const openRouteModal = (writeRoute = true): void => {
    routeModal?.showModal();
    if (writeRoute) syncRoute({ modal: "route" }, false);
  };
  venueRoute?.addEventListener("click", () => openRouteModal());
  routeJump?.addEventListener("click", () => openRouteModal());
  routeSave?.addEventListener("change", () => {
    routeSaveSelection = routeSave.checked && isRouteProvider(routeProvider);
    save(ROUTE_SAVE, routeSaveSelection);
    if (!routeSaveSelection) {
      routeProvider = "";
      save(ROUTE_PROVIDER, routeProvider);
    }
    syncRouteProviderSelection();
  });
  routeProviderLinks.forEach((link) => link.addEventListener("click", () => {
    const provider = link.dataset.routeProvider ?? "";
    if (!isRouteProvider(provider)) return;
    routeProvider = provider;
    if (routeSave?.checked) {
      routeSaveSelection = true;
      save(ROUTE_PROVIDER, routeProvider);
      save(ROUTE_SAVE, true);
    } else {
      routeSaveSelection = false;
      save(ROUTE_PROVIDER, "");
      save(ROUTE_SAVE, false);
    }
    syncRouteProviderSelection();
  }));

  const venueCards = (key: string): HTMLElement[] => cards.filter((c) => c.dataset.venue === key).sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b)));
  const venueLabelParts = (key: string, fallback = key): { index: string; title: string; label: string } => {
    const label = venueLabels.get(key) ?? fallback;
    const parts = label.match(/^(.+?)\s+—\s+(.+)$/);
    return { index: parts?.[1] ?? "", title: parts?.[2] ?? label, label };
  };
  const venueOrderSortKey = (key: string): string => {
    const { index, title } = venueLabelParts(key);
    const raw = index || key;
    const match = raw.match(/^([A-Za-z]*)(\d+)(.*)$/);
    if (!match) return `3:${raw}:${title}`;
    const prefix = match[1].toUpperCase();
    const group = prefix ? 0 : 1;
    return `${group}:${prefix}:${String(Number(match[2])).padStart(4, "0")}:${match[3] ?? ""}:${title}`;
  };
  const venueOrder = [...venueLabels.keys()]
    .filter((key) => venueCards(key).length > 0)
    .sort((a, b) => venueOrderSortKey(a).localeCompare(venueOrderSortKey(b), "de"));
  const venueNeighbor = (key: string, delta: -1 | 1): string => {
    const count = venueOrder.length;
    if (!count) return key;
    const index = venueOrder.indexOf(key);
    const start = index >= 0 ? index : 0;
    return venueOrder[(start + delta + count) % count] ?? key;
  };
  const renderVenueNeighbors = (): void => {
    const prevKey = venueNeighbor(activeVenueKey, -1);
    const nextKey = venueNeighbor(activeVenueKey, 1);
    const prev = venueLabelParts(prevKey);
    const next = venueLabelParts(nextKey);
    if (venueNextIndex) venueNextIndex.textContent = next.index;
    if (venuePrev) venuePrev.setAttribute("aria-label", `${prev.index ? `${prev.index} ` : ""}${prev.title}`);
    if (venueNext) venueNext.setAttribute("aria-label", `${next.index ? `${next.index} ` : ""}${next.title}`);
  };
  const savedCards = (): HTMLElement[] => cards.filter((c) => savedIds.has(c.dataset.id ?? ""))
    .sort((a, b) => ((a.dataset.date ?? "") + (a.dataset.start ?? "")).localeCompare((b.dataset.date ?? "") + (b.dataset.start ?? "")));
  const renderAuthorView = (): void => {
    const profile = people.profiles[activeAuthorKey];
    if (!profile || !authorEvents) return;
    if (authorTitle) authorTitle.textContent = profile.name;
    if (authorLinks) {
      authorLinks.innerHTML = "";
      for (const link of profile.links) {
        const a = document.createElement("a");
        a.className = cx(uiClass.control, "profile-link");
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = link.label;
        authorLinks.appendChild(a);
      }
    }
    const items = profile.events.map((id) => byStableId.get(id)).filter((item): item is HTMLElement => !!item).sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b)));
    renderGroupedCards(authorEvents, items);
    markDatetimeMetricsDirty();
    updateStickyOffsets();
    updateDatetimeHeader();
    scheduleMainScrollState();
  };
  const renderVenueView = (): void => {
    const first = venueCards(activeVenueKey)[0];
    if (!first || !venueEvents) return;
    const { index, title, label } = venueLabelParts(activeVenueKey, first.dataset.calendarLocation ?? activeVenueKey);
    if (venueIndex) {
      venueIndex.textContent = index;
      venueIndex.hidden = !index;
    }
    if (venueTitle) venueTitle.textContent = title;
    renderVenueNeighbors();
    applyAccessibilityNote(venueAccessibility, activeVenueKey);
    updateVenueRoute(coordValue(first.dataset.lat), coordValue(first.dataset.lon), label);
    renderGroupedCards(venueEvents, venueCards(activeVenueKey));
    markDatetimeMetricsDirty();
    updateStickyOffsets();
    updateDatetimeHeader();
    scheduleMainScrollState();
  };
  function renderEventView(): void {
    const c = activeEventCard();
    if (!c) return;
    const title = c.dataset.calendarTitle || meta.app.defaultEventTitle;
    const who = c.dataset.calendarWho || "";
    const role = c.dataset.sourceRole || c.dataset.role || "";
    const verb = c.dataset.verb || "";
    const bookAuthor = c.dataset.bookAuthor || "";
    const venueKey = c.dataset.venue || "";
    const venue = venueLabels.get(venueKey) ?? c.dataset.calendarLocation ?? "";
    const authorKey = (c.dataset.authorKeys ?? "").split(",").filter(Boolean).find((key) => !!people.profiles[key]) ?? "";
    if (eventWhen) {
      const time = c.dataset.allday === "1" || !c.dataset.start ? tt("card.allday") : `${c.dataset.start} Uhr`;
      eventWhen.textContent = [dayLabels.get(c.dataset.date ?? "") ?? c.dataset.date, time].filter(Boolean).join(" · ");
    }
    if (eventTitle) eventTitle.textContent = title;
    if (eventInfo) {
      eventInfo.innerHTML = "";
      if (who) {
        const row = document.createElement(authorKey ? "button" : "span");
        row.className = cx("event-info-line event-person-link event-byline", uiClass.person);
        if (row instanceof HTMLButtonElement) {
          row.type = "button";
          row.dataset.authorOpen = authorKey;
        }
        if (role) {
          const roleLabel = document.createElement("span");
          roleLabel.className = cx("role-badge event-role", uiClass.label);
          roleLabel.textContent = role;
          row.appendChild(roleLabel);
        }
        const label = document.createElement("span");
        label.className = cx("event-person-name", uiClass.person);
        label.textContent = who;
        row.appendChild(label);
        if (verb) {
          const verbLabel = document.createElement("span");
          verbLabel.className = cx("event-verb", uiClass.meta);
          verbLabel.textContent = verb;
          row.appendChild(verbLabel);
        }
        eventInfo.appendChild(row);
      }
    }
    if (eventMeta) {
      eventMeta.innerHTML = "";
      if (venue) {
        const row = document.createElement(venueKey ? "button" : "span");
        row.className = cx("event-info-line event-venue-link", uiClass.meta);
        if (row instanceof HTMLButtonElement) {
          row.type = "button";
          row.dataset.venueOpen = venueKey;
        }
        row.innerHTML = '<span class="ic ic-pin"></span>';
        const label = document.createElement("span");
        label.textContent = venue;
        row.appendChild(label);
        eventMeta.appendChild(row);
      }
    }
    applyAccessibilityNote(eventAccessibility, venueKey);
    if (eventBookAuthor) {
      const showBookAuthor = !!bookAuthor && !who.toLowerCase().includes(bookAuthor.toLowerCase());
      eventBookAuthor.hidden = !showBookAuthor;
      eventBookAuthor.textContent = showBookAuthor ? `von Autor·in ${bookAuthor}` : "";
    }
    const id = c.dataset.id ?? "";
    if (eventSave) {
      const on = savedIds.has(id);
      eventSave.dataset.eventSave = id;
      eventSave.hidden = false;
      eventSave.setAttribute("aria-pressed", String(on));
      eventSave.classList.toggle("is-saved", on);
      eventSave.querySelector(".ic")?.classList.toggle("ic-bookmark", true);
    }
    const lat = coordValue(c.dataset.lat);
    const lon = coordValue(c.dataset.lon);
    const hasRoute = Number.isFinite(lat) && Number.isFinite(lon);
    if (eventRoute) eventRoute.hidden = !hasRoute;
    if (hasRoute) updateVenueRoute(lat, lon, venue || title);
    if (eventSource) {
      eventSource.href = c.dataset.sourceUrl || meta.sourceUrl;
      eventSource.hidden = !eventSource.href;
    }
    updateActionButtons();
  }
  const openAuthorView = (key: string, writeRoute = true): void => {
    const profile = people.profiles[key];
    if (!profile) return;
    if (profile.events.length === 1 && profile.links.length === 0) {
      const eventCard = byStableId.get(profile.events[0]);
      if (eventCard) {
        activeAuthorKey = key;
        openEventView(eventCard, writeRoute);
        return;
      }
    }
    activeAuthorKey = key;
    showView("author", writeRoute);
    queueCurrentQuarterJumpInView("author");
  };
  const openVenueView = (c: HTMLElement, key: string, writeRoute = true): void => {
    activeVenueKey = key;
    const { index, title, label } = venueLabelParts(key, c.dataset.calendarLocation ?? key);
    if (venueIndex) {
      venueIndex.textContent = index;
      venueIndex.hidden = !index;
    }
    if (venueTitle) venueTitle.textContent = title;
    renderVenueNeighbors();
    applyAccessibilityNote(venueAccessibility, key);
    updateVenueRoute(coordValue(c.dataset.lat), coordValue(c.dataset.lon), label);
    showView("venue", writeRoute);
    queueCurrentQuarterJumpInView("venue");
  };
  const switchVenueKey = (key: string, writeRoute = true): void => {
    if (key === activeVenueKey || !venueCards(key).length) return;
    activeVenueKey = key;
    renderVenueView();
    updateActionButtons();
    renderSearchSuggestions();
    if (writeRoute) syncRoute(undefined, false);
  };
  const animateVenueSwitch = (delta: -1 | 1): void => {
    const nextKey = venueNeighbor(activeVenueKey, delta);
    if (nextKey === activeVenueKey) return;
    const direction = delta > 0 ? "next" : "prev";
    if (!venueSwipe || !venueTitleTrack || reducedMotion.matches) {
      switchVenueKey(nextKey);
      return;
    }
    const leavingClass = `is-leaving-${direction}`;
    const enteringClass = `is-entering-${direction}`;
    venueSwipe.classList.remove("is-leaving-next", "is-leaving-prev", "is-entering-next", "is-entering-prev");
    venueSwipe.classList.add(leavingClass);
    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
      venueTitleTrack.removeEventListener("transitionend", commit);
      switchVenueKey(nextKey);
      venueSwipe.classList.remove(leavingClass);
      venueSwipe.classList.add(enteringClass);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        venueSwipe.classList.remove(enteringClass);
      }));
    };
    venueTitleTrack.addEventListener("transitionend", commit);
    window.setTimeout(commit, 180);
  };
  venuePrev?.addEventListener("click", () => animateVenueSwitch(-1));
  venueNext?.addEventListener("click", () => animateVenueSwitch(1));
  let venueSwipeStart: { x: number; y: number; id: number } | null = null;
  venueSwipe?.addEventListener("pointerdown", (ev) => {
    if (!ev.isPrimary || ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest(".venue-step")) return;
    venueSwipeStart = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    try { venueSwipe.setPointerCapture?.(ev.pointerId); } catch { /* synthetic pointer */ }
  });
  venueSwipe?.addEventListener("pointerup", (ev) => {
    if (!venueSwipeStart || venueSwipeStart.id !== ev.pointerId) return;
    const dx = ev.clientX - venueSwipeStart.x;
    const dy = ev.clientY - venueSwipeStart.y;
    venueSwipeStart = null;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.25) animateVenueSwitch(dx < 0 ? 1 : -1);
  });
  venueSwipe?.addEventListener("pointercancel", () => { venueSwipeStart = null; });
  const openEventView = (c: HTMLElement, writeRoute = true): void => {
    activeEventId = c.dataset.stableId || c.dataset.id || "";
    if (c.dataset.date) setDay(c.dataset.date, false);
    showView("event", writeRoute);
  };
  const shareAuthorView = (): void => {
    const profile = people.profiles[activeAuthorKey];
    if (!profile) return;
    void shareText([profile.name, routeUrl({ view: "author", author: activeAuthorKey, ...(state.day ? { day: state.day } : {}) })].join("\n"));
  };
  const shareVenueView = (): void => {
    const first = venueCards(activeVenueKey)[0];
    if (!first) return;
    const label = venueLabels.get(activeVenueKey) ?? first.dataset.calendarLocation ?? activeVenueKey;
    void shareText([label, routeUrl({ view: "venue", venue: activeVenueKey, ...(state.day ? { day: state.day } : {}) })].join("\n"));
  };
  viewShareJump?.addEventListener("click", () => {
    if (activeView === "author") { shareAuthorView(); return; }
    if (activeView === "venue") shareVenueView();
  });
  eventSave?.addEventListener("click", () => {
    const c = activeEventCard();
    if (!c?.dataset.id) return;
    toggleSave(c.dataset.id);
    renderEventView();
  });
  eventBack?.addEventListener("click", navigateBack);
  eventShare?.addEventListener("click", () => {
    const c = activeEventCard();
    if (c) void shareMessage(c);
  });
  eventRoute?.addEventListener("click", () => {
    const c = activeEventCard();
    if (!c) return;
    updateVenueRoute(coordValue(c.dataset.lat), coordValue(c.dataset.lon), c.dataset.calendarLocation || c.dataset.calendarTitle || meta.app.name);
    openRouteModal();
  });
  eventCalendar?.addEventListener("click", () => {
    const c = activeEventCard();
    if (c) downloadIcs([c], `${c.dataset.stableId || c.dataset.id || "literaturfest-meissen-eintrag"}.ics`);
  });
  const filterPerson = (name: string): void => {
    state.q = name.toLowerCase();
    if (search) search.value = name;
    state.venue = "";
    renderActivePills();
    showView("program");
    applyFilters();
    syncRoute(undefined, true);
  };
  const cardAtPoint = (x: number, y: number): HTMLElement | null => {
    const root = views[activeView] ?? document;
    return $$<HTMLElement>("[data-card]", root).find((candidate) => {
      if (candidate.hidden || candidate.offsetParent === null) return false;
      const rect = candidate.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }) ?? null;
  };

  // ---- delegated clicks: bookmarks, people, venues, topics ----
  document.addEventListener("click", (ev) => {
    const el = ev.target as HTMLElement;
    const message = el.closest<HTMLElement>("[data-message-share]");
    if (message) { const c = message.closest<HTMLElement>("[data-card]"); if (c) void shareMessage(c); return; }
    const star = el.closest<HTMLElement>("[data-bookmark]");
    if (star) { const c = star.closest<HTMLElement>("[data-card]"); if (c?.dataset.id) toggleSave(c.dataset.id); return; }
    const author = el.closest<HTMLElement>("[data-author-open]");
    if (author) { openAuthorView(author.dataset.authorOpen ?? ""); return; }
    const person = el.closest<HTMLElement>("[data-person-filter]");
    if (person) { filterPerson(person.dataset.personFilter ?? ""); return; }
    const vb = el.closest<HTMLElement>("[data-venue-open]");
    if (vb) { const c = vb.closest<HTMLElement>("[data-card]") ?? activeEventCard(); if (c) openVenueView(c, vb.dataset.venueOpen ?? ""); return; }
    const gb = el.closest<HTMLElement>("[data-genre-filter]");
    if (gb) { toggleGenre(gb.dataset.genreFilter ?? ""); return; }
    const nearby = ENABLE_NEARBY_PLACES ? el.closest<HTMLElement>("[data-nearby-venue]") : null;
    if (nearby) { nearbyModal?.close(); setVenueFilter(nearby.dataset.nearbyVenue ?? ""); return; }
    const card = el.closest<HTMLElement>("[data-card]") ?? cardAtPoint(ev.clientX, ev.clientY);
    if (card && !el.closest("button,a,input,select,textarea,label")) openEventView(card);
  });

  // ---- filter state ----
  const state = { day: "", q: "", venue: "", langs: new Set<string>(), gInc: new Set<string>(), gExc: new Set<string>(), quickKinder: false, quickAuthor: false };
  let whoPref = "reader";
  const search = $<HTMLInputElement>("#search");
  const searchCancel = $<HTMLButtonElement>("#search-cancel");
  const searchSuggestions = $("#search-suggestions");
  let searchPicker: SearchSuggestionKind | "" = "";
  const cleanLabel = (label: string): string => label.replace(/^(.+?)\s+—\s+/, "").trim();
  const cardSuggestion = (card: HTMLElement): SearchSuggestion => ({
    kind: "event",
    key: card.dataset.id ?? "",
    card,
    title: card.dataset.calendarTitle?.replace(/\s+/g, " ").trim() || meta.app.defaultEventTitle,
    subtitle: [card.dataset.calendarWho?.replace(/\s+/g, " ").trim(), card.dataset.calendarLocation?.replace(/\s+/g, " ").trim()].filter(Boolean).join(" · "),
  });
  const currentVenueOrigin = (): string => {
    if (activeView === "venue") return activeVenueKey;
    if (activeView === "event") return activeEventCard()?.dataset.venue ?? "";
    if (activeView === "author") {
      const profile = people.profiles[activeAuthorKey];
      const items = profile?.events.map((id) => byStableId.get(id)).filter((item): item is HTMLElement => !!item) ?? [];
      const upcoming = items.filter((c) => cardEndTime(c) >= Date.now()).sort((a, b) => cardTime(a) - cardTime(b))[0];
      return upcoming?.dataset.venue ?? items.sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b)))[0]?.dataset.venue ?? "";
    }
    const visible = cards.filter((c) => !c.hidden && cardEndTime(c) >= Date.now()).sort((a, b) => cardTime(a) - cardTime(b))[0];
    return visible?.dataset.venue ?? "";
  };
  const venueIndexNo = (key: string): number => {
    const n = Number.parseInt((key.match(/\d+/) ?? [""])[0], 10);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  const authorSuggestions = (q: string, limit = q ? 18 : 28): SearchSuggestion[] =>
    Object.entries(people.profiles)
      .filter(([, profile]) => !q || profile.name.toLowerCase().includes(q))
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"))
      .slice(0, limit)
      .map(([key, profile]) => ({ kind: "author", key, title: profile.name, subtitle: String(profile.events.length) }));
  const venueSuggestions = (q: string, limit = q ? 18 : 16, includeOrigin = false): SearchSuggestion[] => {
    const origin = currentVenueOrigin();
    return [...venueLabels.entries()]
      .map(([key, label]) => ({ key, label, title: cleanLabel(label), distance: origin ? walk(origin, key) : null }))
      .filter((item) => {
        if (!q && origin && item.key === origin && !includeOrigin) return false;
        return !q || item.label.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const ad = a.distance ?? Number.MAX_SAFE_INTEGER;
        const bd = b.distance ?? Number.MAX_SAFE_INTEGER;
        if (ad !== bd) return ad - bd;
        const ai = venueIndexNo(a.key);
        const bi = venueIndexNo(b.key);
        if (ai !== bi) return ai - bi;
        return a.title.localeCompare(b.title, "de");
      })
      .slice(0, limit)
      .map((item) => ({ kind: "venue", key: item.key, title: item.title, subtitle: item.distance == null ? item.label : tt("nearby.minutes", { n: item.distance }), distance: item.distance }));
  };
  const eventSuggestions = (q: string): SearchSuggestion[] => {
    if (q.length < 2) return [];
    return cards
      .filter((card) => cardEndTime(card) >= Date.now() && (card.dataset.text ?? "").includes(q))
      .sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b)))
      .slice(0, 18)
      .map(cardSuggestion);
  };
  const hideSearchSuggestions = (): void => {
    if (searchSuggestions) {
      searchSuggestions.hidden = true;
      searchSuggestions.innerHTML = "";
    }
    searchPicker = "";
    search?.removeAttribute("data-search-picker");
    search?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("search-open");
  };
  const openSearchPicker = (kind: SearchSuggestionKind): void => {
    if (!search) return;
    searchPicker = kind;
    search.dataset.searchPicker = kind;
    search.value = "";
    document.body.classList.add("search-open");
    search.focus();
    renderSearchSuggestions();
  };
  function setSearch(value: string): void {
    if (search && search.value !== value) search.value = value;
    renderSearchSuggestions();
  }
  function renderSearchSuggestions(): void {
    if (!search || !searchSuggestions) return;
    const q = search.value.trim().toLowerCase();
    searchSuggestions.innerHTML = "";
    if (document.activeElement !== search) {
      searchSuggestions.hidden = true;
      return;
    }
    const fullPicker = searchPicker !== "";
    const allGroups: { kind: SearchSuggestionKind; label: string; items: SearchSuggestion[] }[] = [
      { kind: "author", label: tt("search.authors"), items: authorSuggestions(q, fullPicker && searchPicker === "author" ? Number.MAX_SAFE_INTEGER : undefined) },
      { kind: "venue", label: tt("search.venues"), items: venueSuggestions(q, fullPicker && searchPicker === "venue" ? Number.MAX_SAFE_INTEGER : undefined, fullPicker && searchPicker === "venue") },
      { kind: "event", label: tt("search.entries"), items: eventSuggestions(q) },
    ];
    const groups = searchPicker ? allGroups.filter((group) => group.kind === searchPicker) : allGroups;
    const ordered = searchPicker ? groups : activeView === "venue" || activeView === "event"
      ? [groups[1], groups[0], groups[2]]
      : activeView === "author"
        ? [groups[0], groups[1], groups[2]]
        : groups;
    let rendered = 0;
    for (const group of ordered) {
      const items = fullPicker ? group.items : group.items.slice(0, group.kind === "event" ? 10 : 12);
      if (!items.length) continue;
      const h = document.createElement("div");
      h.className = cx("search-group-title", uiClass.label);
      h.textContent = group.label;
      searchSuggestions.appendChild(h);
      for (const item of items) {
        rendered += 1;
        const b = document.createElement("button");
        b.className = cx("search-suggest", `search-suggest-${item.kind}`, uiClass.ui);
        b.type = "button";
        b.setAttribute("role", "option");
        b.dataset.searchKind = item.kind;
        b.dataset.searchValue = item.title;
        if (item.kind === "event") b.dataset.searchTarget = item.key;
        if (item.kind === "author") b.dataset.searchAuthor = item.key;
        if (item.kind === "venue") {
          b.dataset.searchVenue = item.key;
          if (item.distance != null) b.dataset.searchDistance = String(item.distance);
        }
        const title = document.createElement("span");
        title.className = cx("search-suggest-title", uiClass.title);
        title.textContent = item.title;
        b.appendChild(title);
        const aside = document.createElement("span");
        aside.className = cx("search-suggest-aside", uiClass.meta);
        const appendAsideLine = (iconClass: string, text?: string, className = ""): void => {
          const value = text?.trim();
          if (!value) return;
          const line = document.createElement("span");
          line.className = `search-suggest-line search-suggest-aside-line${className ? ` ${className}` : ""}`;
          const icon = document.createElement("span");
          icon.className = `ic ${iconClass}`;
          const label = document.createElement("span");
          label.textContent = value;
          line.append(icon, label);
          aside.appendChild(line);
        };
        if (item.kind === "event" && item.card) {
          appendAsideLine("ic-pen", item.card.dataset.calendarWho?.replace(/\s+/g, " ").trim());
          appendAsideLine("ic-pin", item.card.dataset.calendarLocation?.replace(/\s+/g, " ").trim());
          if (!aside.childElementCount) appendAsideLine("ic-now", item.subtitle || item.title);
        } else if (item.kind === "venue" && item.distance != null) {
          b.dataset.hasDistance = "1";
          appendAsideLine("ic-pin", tt("nearby.minutes", { n: item.distance }), "search-suggest-distance");
        } else {
          appendAsideLine(item.kind === "venue" ? "ic-pin" : "ic-pen", item.subtitle || item.title);
        }
        if (aside.childElementCount) b.appendChild(aside);
        searchSuggestions.appendChild(b);
      }
    }
    searchSuggestions.hidden = rendered === 0;
    search.setAttribute("aria-expanded", rendered > 0 ? "true" : "false");
  }
  search?.addEventListener("focus", () => {
    if (!search.dataset.searchPicker) searchPicker = "";
    document.body.classList.add("search-open");
    renderSearchSuggestions();
  });
  search?.addEventListener("input", () => setSearch(search.value));
  search?.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { hideSearchSuggestions(); search.blur(); }
    if (ev.key === "Enter") {
      const first = $<HTMLButtonElement>("[data-search-kind]", searchSuggestions ?? document);
      if (first) {
        ev.preventDefault();
        first.click();
      }
    }
  });
  search?.addEventListener("blur", () => setTimeout(() => { if (!searchSuggestions?.matches(":hover")) hideSearchSuggestions(); }, 240));
  searchCancel?.addEventListener("click", () => {
    if (search) search.value = "";
    hideSearchSuggestions();
    search?.blur();
  });
  authorListTrigger?.addEventListener("click", () => openSearchPicker("author"));
  venueListTrigger?.addEventListener("click", () => openSearchPicker("venue"));
  searchSuggestions?.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-search-kind]");
    if (!b) return;
    ev.preventDefault();
    if (search) search.value = "";
    hideSearchSuggestions();
    search?.blur();
    if (b.dataset.searchAuthor) { openAuthorView(b.dataset.searchAuthor); return; }
    if (b.dataset.searchVenue) {
      const key = b.dataset.searchVenue;
      const first = venueCards(key)[0];
      if (first) openVenueView(first, key);
      return;
    }
    const target = byId.get(b.dataset.searchTarget ?? "");
    if (target) openEventView(target);
  });

  function setVenueFilter(key: string, writeRoute = true): void {
    state.venue = key;
    if (key) showView("program", false);
    renderActivePills();
    applyFilters();
    if (writeRoute) syncRoute(undefined, false);
  }
  function setGenre(g: string, next: string): void {
    state.gInc.delete(g); state.gExc.delete(g);
    if (next === "include") state.gInc.add(g); else if (next === "exclude") state.gExc.add(g);
    const chip = $$("[data-row='genre'] [data-genre]").find((x) => x.dataset.genre === g);
    if (chip) { chip.dataset.state = next; chip.setAttribute("aria-pressed", String(next === "include")); }
    updateFilterCount(); renderActivePills(); applyFilters(); syncRoute(undefined, true);
  }
  function toggleGenre(g: string): void { const on = state.gInc.has(g); if (!on) showView("program"); setGenre(g, on ? "off" : "include"); }
  function renderActivePills(): void {
    const c = $("#active-filters"); if (!c) return;
    const items: { label: string; clear: () => void }[] = [];
    if (state.venue) items.push({ label: venueLabels.get(state.venue) ?? state.venue, clear: () => setVenueFilter("") });
    state.gInc.forEach((g) => items.push({ label: g, clear: () => setGenre(g, "off") }));
    state.gExc.forEach((g) => items.push({ label: "− " + g, clear: () => setGenre(g, "off") }));
    c.innerHTML = "";
    for (const it of items) {
      const b = document.createElement("button");
      b.className = cx(uiClass.control, "pill"); b.type = "button"; b.textContent = it.label + " ✕";
      b.addEventListener("click", it.clear); c.appendChild(b);
    }
  }
  let nearbyAvailable = false;
  function renderNearbyVenues(): void {
    const list = $("#nearby-list");
    const empty = $("#nearby-empty");
    if (!list) return;
    list.innerHTML = "";
    if (!ENABLE_NEARBY_PLACES || activeView !== "program") {
      nearbyAvailable = false;
      if (empty) empty.hidden = true;
      updateActionButtons();
      return;
    }
    const todayOrState = state.day || todayISO();
    const candidates = cards.filter((c) => c.dataset.date === todayOrState && cardEndTime(c) >= Date.now()).sort((a, b) => cardTime(a) - cardTime(b));
    const venueKeysWithEvents = new Set(candidates.map((c) => c.dataset.venue ?? "").filter(Boolean));
    const nearbyFor = (originKey: string): { key: string; minutes: number }[] => [...venueKeysWithEvents].map((key) => ({ key, minutes: walk(originKey, key) }))
      .filter((item): item is { key: string; minutes: number } => item.key !== originKey && item.minutes != null && item.minutes <= 10)
      .sort((a, b) => a.minutes - b.minutes || (venueLabels.get(a.key) ?? a.key).localeCompare(venueLabels.get(b.key) ?? b.key, "de"));
    const origins = [candidates.find((c) => isCurrentOrSoonCard(c)), ...candidates].map((c) => c?.dataset.venue ?? "").filter(Boolean);
    let nearby: { key: string; minutes: number }[] = [];
    for (const originKey of origins) {
      nearby = nearbyFor(originKey);
      if (nearby.length) break;
    }
    nearby = nearby.slice(0, 8);
    nearbyAvailable = nearby.length > 0;
    if (empty) empty.hidden = nearbyAvailable;
    for (const item of nearby) {
      const b = document.createElement("button");
      b.className = cx(uiClass.control, "nearby-chip");
      b.type = "button";
      b.dataset.nearbyVenue = item.key;
      const label = venueLabels.get(item.key) ?? item.key;
      b.textContent = `${label} · ${tt("nearby.minutes", { n: item.minutes })}`;
      list.appendChild(b);
    }
    updateActionButtons();
  }

  // ---- day navigator + time-jump (behind the big date button) ----
  const timeModal = $<HTMLDialogElement>("#time-modal");
  const nearbyModal = $<HTMLDialogElement>("#nearby-modal");
  const datetimeTime = $<HTMLButtonElement>("#datetime-time");
  const datetimeCurrent = datetimeTime ? $<HTMLElement>(".datetime-time-current", datetimeTime) : null;
  const datetimeNext = datetimeTime ? $<HTMLElement>(".datetime-time-next", datetimeTime) : null;
  let activeTimeSlot: HTMLElement | null = null;
  let initialTimeSlot: HTMLElement | null = null;
  let renderedTimeCurrent = "";
  let renderedTimeNext = "";
  let renderedTimeLabel = "";
  type TimeSlotMetric = { slot: HTMLElement; top: number; titleTop: number; label: string };
  let timeSlotMetrics: TimeSlotMetric[] = [];
  let timeSlotMetricsDirty = true;
  const markDatetimeMetricsDirty = (): void => { timeSlotMetricsDirty = true; };
  const clearTimeSlotState = (): void => {
    initialTimeSlot?.classList.remove("is-initial-time-slot");
    activeTimeSlot?.classList.remove("is-active-time-slot");
    initialTimeSlot = null;
    activeTimeSlot = null;
  };
  const rebuildDatetimeMetrics = (): TimeSlotMetric[] => {
    const list = timelineListForView(activeView);
    if (!list || !timelineViews.has(activeView)) {
      clearTimeSlotState();
      timeSlotMetrics = [];
      timeSlotMetricsDirty = false;
      return timeSlotMetrics;
    }
    const scrollY = nativeScrollTop();
    const scrollerTop = appScroller?.getBoundingClientRect().top ?? 0;
    const slots = $$<HTMLElement>(".time-slot", list)
      .filter((slot) => !slot.hidden && slot.offsetParent !== null);
    const initial = slots[0] ?? null;
    if (initial !== initialTimeSlot) {
      initialTimeSlot?.classList.remove("is-initial-time-slot");
      initial?.classList.add("is-initial-time-slot");
      initialTimeSlot = initial;
    }
    if (!slots.includes(activeTimeSlot as HTMLElement)) {
      activeTimeSlot?.classList.remove("is-active-time-slot");
      activeTimeSlot = null;
    }
    timeSlotMetrics = slots.map((slot) => {
      const title = $(".time-slot-title", slot);
      return {
        slot,
        top: slot.getBoundingClientRect().top - scrollerTop + scrollY,
        titleTop: (title ?? slot).getBoundingClientRect().top - scrollerTop + scrollY,
        label: slot.dataset.timeSlot ?? "—",
      };
    });
    timeSlotMetricsDirty = false;
    return timeSlotMetrics;
  };
  const subpixel = (value: number): string => `${Math.round(value * 1000) / 1000}px`;
  const setDatetimeValue = (current: string, next = current, progress = 0, travelPx = datetimeTime?.getBoundingClientRect().height ?? 0): void => {
    if (!datetimeTime) return;
    const clamped = Math.max(0, Math.min(1, progress));
    const travel = Math.max(1, travelPx);
    if (datetimeCurrent && datetimeNext) {
      if (current !== renderedTimeCurrent) {
        datetimeCurrent.textContent = current;
        datetimeTime.dataset.currentTime = current;
        renderedTimeCurrent = current;
      }
      if (next !== renderedTimeNext) {
        datetimeNext.textContent = next;
        renderedTimeNext = next;
      }
      datetimeCurrent.style.transform = `translate3d(0, ${subpixel(-travel * clamped)}, 0)`;
      datetimeNext.style.transform = `translate3d(0, ${subpixel(travel * (1 - clamped))}, 0)`;
    } else {
      datetimeTime.dataset.currentTime = current;
      datetimeTime.textContent = current;
    }
    const label = `${tt("now.time")}: ${clamped > .5 ? next : current}`;
    if (label !== renderedTimeLabel) {
      datetimeTime.setAttribute("aria-label", label);
      renderedTimeLabel = label;
    }
  };
  const updateDatetimeHeader = (): void => {
    if (!datetimeTime) return;
    if (!timelineViews.has(activeView)) {
      clearTimeSlotState();
      timeSlotMetrics = [];
      timeSlotMetricsDirty = true;
      return;
    }
    const shouldRebuildMetrics = timeSlotMetricsDirty || (!preciseTouchScroll && performance.now() < stickyHeaderWatchUntil);
    const metrics = shouldRebuildMetrics ? rebuildDatetimeMetrics() : timeSlotMetrics;
    if (!metrics.length) {
      clearTimeSlotState();
      return;
    }
    const scrollY = scrollTop();
    const scrollerTop = appScroller?.getBoundingClientRect().top ?? 0;
    const timeRect = datetimeTime.getBoundingClientRect();
    const timeTop = scrollY + timeRect.top - scrollerTop;
    const timeBottom = scrollY + timeRect.bottom - scrollerTop;
    let activeIndex = metrics.length - 1;
    while (activeIndex > 0 && metrics[activeIndex]?.top > timeTop + 1) activeIndex--;
    const active = metrics[activeIndex] ?? metrics[0];
    const next = metrics[activeIndex + 1] ?? null;
    const nextTop = next?.titleTop ?? Number.POSITIVE_INFINITY;
    const progress = Number.isFinite(nextTop) && timeRect.height > 0 ? (timeBottom - nextTop) / timeRect.height : 0;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const highlighted = next && clampedProgress > 0 ? next : active;
    if (highlighted.slot !== activeTimeSlot) {
      activeTimeSlot?.classList.remove("is-active-time-slot");
      highlighted.slot.classList.add("is-active-time-slot");
      activeTimeSlot = highlighted.slot;
    }
    setDatetimeValue(active.label, next?.label ?? active.label, clampedProgress, timeRect.height);
  };
  let datetimeFrame = 0;
  const scheduleDatetimeHeader = (): void => {
    if (datetimeFrame) return;
    datetimeFrame = requestAnimationFrame(() => {
      datetimeFrame = 0;
      updateDatetimeHeader();
    });
  };
  const syncScrollChrome = (): void => {
    if (datetimeFrame) {
      cancelAnimationFrame(datetimeFrame);
      datetimeFrame = 0;
    }
    updateStickyHeader();
    updateDatetimeHeader();
  };
  let scrollSyncFrame = 0;
  let scrollSyncUntil = 0;
  let lastScrollSyncY = Number.NaN;
  let stableScrollFrames = 0;
  const runScrollSyncLoop = (): void => {
    scrollSyncFrame = 0;
    syncScrollChrome();
    const scrollY = scrollTop();
    const changed = !Number.isFinite(lastScrollSyncY) || Math.abs(scrollY - lastScrollSyncY) > 0.5;
    stableScrollFrames = changed ? 0 : stableScrollFrames + 1;
    lastScrollSyncY = scrollY;
    if (performance.now() < scrollSyncUntil || stableScrollFrames < 2) {
      scrollSyncFrame = requestAnimationFrame(runScrollSyncLoop);
    }
  };
  const startScrollSyncLoop = (durationMs = 240): void => {
    scrollSyncUntil = Math.max(scrollSyncUntil, performance.now() + durationMs);
    stableScrollFrames = 0;
    if (!scrollSyncFrame) scrollSyncFrame = requestAnimationFrame(runScrollSyncLoop);
  };
  const firstTouch = (touches: TouchList): Touch | null => touches.length ? touches[0] ?? null : null;
  const trackedTouch = (touches: TouchList): Touch | null => {
    if (!preciseTouchScroll) return null;
    return [...touches].find((touch) => touch.identifier === preciseTouchScroll?.id) ?? null;
  };
  const beginPreciseTouchScroll = (ev: TouchEvent): void => {
    const touch = firstTouch(ev.touches);
    if (!touch) return;
    if (timeSlotMetricsDirty || !timeSlotMetrics.length) rebuildDatetimeMetrics();
    preciseTouchScroll = { id: touch.identifier, startY: touch.clientY, startTop: nativeScrollTop(), y: touch.clientY };
    syncScrollChrome();
    startScrollSyncLoop(720);
  };
  const updatePreciseTouchScroll = (ev: TouchEvent): void => {
    const touch = trackedTouch(ev.touches);
    if (!touch || !preciseTouchScroll) return;
    preciseTouchScroll.y = touch.clientY;
    syncScrollChrome();
    startScrollSyncLoop(240);
  };
  const endPreciseTouchScroll = (ev: TouchEvent): void => {
    if (preciseTouchScroll && !trackedTouch(ev.touches)) {
      preciseTouchScroll = null;
      markDatetimeMetricsDirty();
    }
    syncScrollChrome();
    startScrollSyncLoop(720);
  };
  const setDay = (date: string, writeRoute = true): void => {
    if (!fdays.includes(date)) date = fdays.includes(todayISO()) ? todayISO() : (fdays[0] ?? date);
    state.day = date;
    const lbl = $("#day-jump"); if (lbl) lbl.textContent = dayLabels.get(date) ?? date;
    const i = fdays.indexOf(date);
    $<HTMLButtonElement>("[data-day-prev]")?.toggleAttribute("disabled", i <= 0);
    $<HTMLButtonElement>("[data-day-next]")?.toggleAttribute("disabled", i >= fdays.length - 1);
    rebuildTimeJumps(); applyFilters();
    updateDatetimeHeader();
    if (writeRoute) syncRoute(undefined, true);
  };
  $("[data-day-prev]")?.addEventListener("click", () => { const i = fdays.indexOf(state.day); if (i > 0) setDay(fdays[i - 1]); });
  $("[data-day-next]")?.addEventListener("click", () => { const i = fdays.indexOf(state.day); if (i < fdays.length - 1) setDay(fdays[i + 1]); });
  $("#day-jump")?.addEventListener("click", () => timeModal?.showModal());
  datetimeTime?.addEventListener("click", () => timeModal?.showModal());
  appScroller?.addEventListener("scroll", () => {
    syncScrollChrome();
    startScrollSyncLoop(160);
  }, { passive: true });
  appScroller?.addEventListener("wheel", () => startScrollSyncLoop(320), { passive: true });
  document.addEventListener("touchstart", beginPreciseTouchScroll, { passive: true });
  document.addEventListener("touchmove", updatePreciseTouchScroll, { passive: true });
  document.addEventListener("touchend", endPreciseTouchScroll, { passive: true });
  document.addEventListener("touchcancel", endPreciseTouchScroll, { passive: true });
  window.addEventListener("resize", () => {
    markDatetimeMetricsDirty();
    scheduleDatetimeHeader();
    scheduleMainScrollState();
  }, { passive: true });

  function rebuildTimeJumps(): void {
    const cont = $("#time-jumps"); if (!cont) return;
    $$("[data-jump-time]", cont).forEach((b) => b.remove());
    const hours = [...new Set(cards.filter((c) => c.dataset.date === state.day && c.dataset.allday !== "1" && c.dataset.start).map((c) => (c.dataset.start ?? "").slice(0, 2)))].sort();
    for (const h of hours) {
      const b = document.createElement("button");
      b.className = uiClass.control; b.type = "button"; b.dataset.jumpTime = `${h}:00`; b.textContent = `${h}:00`;
      cont.appendChild(b);
    }
  }
  function jumpToTime(hhmm: string): void {
    const target = toMin(hhmm);
    const first = cards.filter((c) => c.dataset.date === state.day && c.dataset.allday !== "1" && !c.hidden && toMin(c.dataset.start ?? "0") >= target)
      .sort((a, b) => toMin(a.dataset.start ?? "0") - toMin(b.dataset.start ?? "0"))[0];
    if (!first) return;
    scrollToCard(first);
  }
  function jumpNow(): void {
    const iso = todayISO();
    if (iso !== state.day && fdays.includes(iso)) setDay(iso);
    const d = new Date();
    jumpToTime(state.day === iso ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "00:00");
  }
  timeModal?.addEventListener("click", (ev) => {
    const el = ev.target as HTMLElement;
    if (el === timeModal) { timeModal.close(); return; }
    const b = el.closest<HTMLElement>("[data-jump],[data-jump-time]"); if (!b) return;
    if (b.dataset.jump === "now") jumpToNowProgram(); else if (b.dataset.jumpTime) jumpToTime(b.dataset.jumpTime);
    timeModal.close();
  });

  // ---- filter sheet ----
  const filterModal = $<HTMLDialogElement>("#filter-modal");
  const infoModal = $<HTMLDialogElement>("#info-modal");
  const openNearbyModal = (writeRoute = true): void => {
    if (!ENABLE_NEARBY_PLACES) return;
    renderNearbyVenues();
    nearbyModal?.showModal();
    if (writeRoute) syncRoute({ modal: "nearby" }, false);
  };
  const openFilterModal = (writeRoute = true): void => {
    filterModal?.showModal();
    if (writeRoute) syncRoute({ modal: "filter" }, false);
  };
  const openInfoModal = (writeRoute = true): void => {
    infoModal?.showModal();
    if (writeRoute) syncRoute({ modal: "info" }, false);
  };
  $("#filter-btn")?.addEventListener("click", () => openFilterModal());
  $("#info-btn")?.addEventListener("click", () => openInfoModal());
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => { b.closest("dialog")?.close(); syncRoute(undefined, false); }));
  filterModal?.addEventListener("click", (ev) => { if (ev.target === filterModal) { filterModal.close(); syncRoute(undefined, false); } });
  infoModal?.addEventListener("click", (ev) => { if (ev.target === infoModal) { infoModal.close(); syncRoute(undefined, false); } });
  nearbyModal?.addEventListener("click", (ev) => { if (ev.target === nearbyModal) { nearbyModal.close(); syncRoute(undefined, false); } });
  routeModal?.addEventListener("click", (ev) => { if (ev.target === routeModal) { routeModal.close(); syncRoute(undefined, false); } });

  $$("[data-row='lang'] [data-lang]").forEach((b) => b.addEventListener("click", () => {
    const l = b.dataset.lang ?? "";
    state.langs.has(l) ? state.langs.delete(l) : state.langs.add(l);
    b.setAttribute("aria-pressed", String(state.langs.has(l)));
    updateFilterCount(); applyFilters(); syncRoute(undefined, true);
  }));
  $$("[data-row='genre'] [data-genre]").forEach((b) => b.addEventListener("click", () => {
    setGenre(b.dataset.genre ?? "", b.dataset.state === "off" ? "include" : b.dataset.state === "include" ? "exclude" : "off");
  }));
  $$("[data-row='who'] [data-who]").forEach((b) => b.addEventListener("click", () => {
    whoPref = b.dataset.who ?? "reader";
    $$("[data-row='who'] [data-who]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    document.body.classList.toggle("pref-author", whoPref === "author");
    updateFilterCount(); syncRoute(undefined, true);
  }));
  $$("[data-quick]").forEach((b) => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    if (b.dataset.quick === "kinder") state.quickKinder = on; else if (b.dataset.quick === "author") state.quickAuthor = on;
    updateFilterCount(); applyFilters(); syncRoute(undefined, true);
  }));
  function clearFilters(): void {
    state.langs.clear(); state.gInc.clear(); state.gExc.clear(); whoPref = "reader";
    state.quickKinder = false; state.quickAuthor = false; state.venue = "";
    $$("[data-quick]").forEach((x) => x.setAttribute("aria-pressed", "false"));
    $$("[data-row='lang'] [data-lang]").forEach((x) => x.setAttribute("aria-pressed", "false"));
    $$("[data-row='genre'] [data-genre]").forEach((x) => { x.dataset.state = "off"; x.setAttribute("aria-pressed", "false"); });
    $$("[data-row='who'] [data-who]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.who === "reader")));
    document.body.classList.remove("pref-author");
    updateFilterCount(); renderActivePills(); applyFilters(); syncRoute(undefined, true);
  }
  $("#filter-reset")?.addEventListener("click", clearFilters);
  $("#filter-clear-row")?.addEventListener("click", clearFilters);
  function updateFilterCount(): void {
    const n = state.langs.size + state.gInc.size + state.gExc.size + (whoPref === "author" ? 1 : 0)
      + (state.quickKinder ? 1 : 0) + (state.quickAuthor ? 1 : 0) + (state.venue ? 1 : 0);
    const el = $("#filter-count");
    if (el) { el.hidden = n === 0; el.textContent = String(n); }
    const clear = $("#filter-clear-row");
    if (clear) clear.hidden = n === 0;
  }

  const matches = (c: HTMLElement): boolean => {
    if (state.day && c.dataset.date !== state.day) return false;
    if (cardEndTime(c) < Date.now()) return false;
    if (state.venue && c.dataset.venue !== state.venue) return false;
    if (state.quickKinder && c.dataset.genre !== "Kinder") return false;
    if (state.quickAuthor && c.dataset.hasrole !== "1") return false;
    if (state.q && !(c.dataset.text ?? "").includes(state.q)) return false;
    if (state.langs.size) { const ls = (c.dataset.langs ?? "").split(","); if (![...state.langs].some((l) => ls.includes(l))) return false; }
    const g = c.dataset.genre ?? "";
    if (state.gExc.has(g)) return false;
    if (state.gInc.size && !state.gInc.has(g)) return false;
    return true;
  };
  const applyFilters = (): void => {
    let any = false;
    cards.forEach((c) => { const m = matches(c); c.hidden = !m; if (m) any = true; });
    $$("#program-list .time-slot").forEach((s) => { s.hidden = !$$("[data-card]", s).some((c) => !c.hidden); });
    $$("#program-list .day").forEach((d) => { d.hidden = !$$("[data-card]", d).some((c) => !c.hidden); });
    const nr = $("#no-results"); if (nr) nr.hidden = any;
    markDatetimeMetricsDirty();
    updateDatetimeHeader();
    renderNearbyVenues();
    scheduleMainScrollState();
  };

  // ---- saved (grouped by day; past entries hidden by default) ----
  let showPastSaved = false;
  const isPastCard = (c: HTMLElement): boolean => cardEndTime(c) < Date.now();
  function renderSaved(): void {
    const cont = $("#saved-results")!; cont.innerHTML = "";
    const allItems = savedCards();
    const pastItems = allItems.filter(isPastCard);
    const items = showPastSaved ? allItems : allItems.filter((c) => !isPastCard(c));
    const empty = $("#saved-empty")!;
    empty.textContent = allItems.length ? tt("saved.emptyUpcoming") : tt("saved.empty");
    empty.hidden = items.length > 0;
    $("#saved-calendar")!.hidden = allItems.length === 0;
    const past = $("#saved-past");
    if (past) {
      past.hidden = pastItems.length === 0;
      past.setAttribute("aria-pressed", String(showPastSaved));
    }
    let section: HTMLElement | null = null;
    let slot: HTMLElement | null = null;
    let currentDay = "";
    let currentTime = "";
    for (const c of items) {
      if (c.dataset.date !== currentDay) {
        currentDay = c.dataset.date ?? "";
        currentTime = "";
        section = document.createElement("section");
        section.className = "saved-day";
        const h = document.createElement("h3");
        h.className = cx("saved-day-title", uiClass.label);
        h.textContent = dayLabels.get(currentDay) ?? currentDay;
        section.appendChild(h);
        cont.appendChild(section);
      }
      const timeLabel = c.dataset.allday === "1" ? tt("card.allday") : (c.dataset.start || "—");
      if (timeLabel !== currentTime) {
        currentTime = timeLabel;
        slot = document.createElement("section");
        slot.className = "time-slot";
        slot.dataset.timeSlot = timeLabel;
        const h = document.createElement("h4");
        h.className = cx("time-slot-title", uiClass.clock);
        h.textContent = timeLabel;
        slot.appendChild(h);
        section?.appendChild(slot);
      }
      const clone = c.cloneNode(true) as HTMLElement;
      clone.hidden = false;
      addSavedMessageAction(clone);
      slot?.appendChild(clone);
    }
    refreshI18n(cont);
    refreshTitleTranslations(cont);
    savedIds.forEach(syncSaved);
    scheduleMainScrollState();
  }
  $("#saved-past")?.addEventListener("click", () => { showPastSaved = !showPastSaved; renderSaved(); updateActionButtons(); });
  $("#saved-calendar")?.addEventListener("click", () => {
    downloadIcs(savedCards(), meta.app.fileName);
  });

  const nowJump = $<HTMLButtonElement>("#now-jump");
  const nearbyJump = $<HTMLButtonElement>("#nearby-jump");
  const savedJump = $<HTMLButtonElement>("#saved-jump");
  const savedJumpIcon = savedJump ? $(".ic", savedJump) : null;
  const savedJumpLabel = savedJump ? $(".thumb-label", savedJump) : null;
  const setThumbLabel = (button: HTMLButtonElement | null, label: string): void => {
    if (!button) return;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    const text = $(".thumb-label", button);
    if (text) text.textContent = label;
  };
  const setActionButton = (button: HTMLButtonElement | null, visible: boolean, label: string, slot: number): void => {
    if (!button) return;
    button.hidden = !visible;
    if (visible) button.dataset.actionSlot = String(slot);
    else delete button.dataset.actionSlot;
    setThumbLabel(button, label);
  };
  const activeViewCards = (): HTMLElement[] => {
    if (activeView === "program") return cards.filter((c) => !c.hidden);
    return $$<HTMLElement>("[data-card]", views[activeView]).filter((c) => !c.hidden);
  };
  const nextProgramCard = (): HTMLElement | null =>
    cards.filter((c) => cardEndTime(c) >= Date.now()).sort((a, b) => cardTime(a) - cardTime(b))[0] ?? null;
  const currentQuarterStart = (now = Date.now()): number => {
    const d = new Date(now);
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    return d.getTime();
  };
  const currentQuarterCardIn = (items: HTMLElement[]): HTMLElement | null => {
    const start = currentQuarterStart();
    const now = Date.now();
    const iso = todayISO();
    const timedToday = items
      .filter((c) => c.dataset.date === iso && c.dataset.allday !== "1" && !c.hidden && cardEndTime(c) >= now)
      .sort((a, b) => cardTime(a) - cardTime(b));
    return timedToday.find((c) => cardTime(c) >= start && cardTime(c) <= now + HOUR_MS)
      ?? timedToday.filter((c) => cardTime(c) <= now).sort((a, b) => cardTime(b) - cardTime(a))[0]
      ?? timedToday[0]
      ?? items.filter((c) => !c.hidden && cardEndTime(c) >= now).sort((a, b) => cardTime(a) - cardTime(b))[0]
      ?? items.filter((c) => !c.hidden).sort((a, b) => cardTime(a) - cardTime(b))[0]
      ?? null;
  };
  const currentQuarterProgramCard = (): HTMLElement | null => currentQuarterCardIn(cards);
  const nowProgramCard = (): HTMLElement | null => {
    const now = Date.now();
    const currentTimed = cards.filter((c) => c.dataset.allday !== "1" && isCurrentOrSoonCard(c, now)).sort((a, b) => cardTime(a) - cardTime(b))[0];
    if (currentTimed) return currentTimed;
    return cards.filter((c) => c.dataset.allday === "1" && isCurrentOrSoonCard(c, now)).sort((a, b) => cardTime(a) - cardTime(b))[0] ?? nextProgramCard();
  };
  const upcomingSavedCards = (): HTMLElement[] =>
    savedCards().filter((c) => cardEndTime(c) >= Date.now()).sort((a, b) => cardTime(a) - cardTime(b));
  const jumpToNowProgram = (): void => {
    const next = nowProgramCard();
    state.venue = "";
    renderActivePills();
    showView("program");
    if (next) {
      setDay(next.dataset.date ?? state.day);
      requestAnimationFrame(() => scrollToCard(next));
    } else {
      jumpNow();
    }
  };
  const jumpToCurrentQuarterProgram = (): void => {
    const next = currentQuarterProgramCard() ?? nowProgramCard();
    state.venue = "";
    renderActivePills();
    showView("program");
    if (next) {
      setDay(next.dataset.date ?? state.day);
      requestAnimationFrame(() => scrollToCard(next));
    } else {
      jumpNow();
    }
  };
  const jumpToNowInActiveView = (): void => {
    if (activeView === "program") { jumpToNowProgram(); return; }
    const items = activeViewCards();
    const next = items.filter((c) => cardEndTime(c) >= Date.now()).sort((a, b) => cardTime(a) - cardTime(b))[0]
      ?? items.sort((a, b) => cardTime(a) - cardTime(b))[0];
    if (next) scrollToCard(next);
  };
  const jumpToCurrentQuarterInActiveView = (): void => {
    if (activeView === "program") { jumpToCurrentQuarterProgram(); return; }
    const next = currentQuarterCardIn(activeViewCards());
    if (next) scrollToCard(next);
  };
  const jumpToCurrentQuarterInView = (view: AppView): void => {
    if (activeView !== view) {
      requestAnimationFrame(() => { if (activeView === view) jumpToCurrentQuarterInActiveView(); });
      return;
    }
    jumpToCurrentQuarterInActiveView();
  };
  const queueCurrentQuarterJumpInView = (view: AppView): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => jumpToCurrentQuarterInView(view)));
  };
  updateActionButtons = (): void => {
    const eventCard = activeView === "event" ? activeEventCard() : null;
    const eventRouteAvailable = eventCard
      ? Number.isFinite(coordValue(eventCard.dataset.lat)) && Number.isFinite(coordValue(eventCard.dataset.lon))
      : false;
    const viewCanShare = (activeView === "author" && !!people.profiles[activeAuthorKey]) || (activeView === "venue" && venueCards(activeVenueKey).length > 0);
    const nowJumpable = activeView === "program" || (activeView !== "saved" && activeView !== "event" && activeViewCards().length > 1);
    setActionButton(nowJump, nowJumpable, tt("now.live"), 2);
    if (nowJump) nowJump.dataset.mode = activeView === "program" ? "program" : "view";
    setActionButton(nearbyJump, ENABLE_NEARBY_PLACES && activeView === "program" && nearbyAvailable, tt("nearby.heading"), 3);
    setActionButton(routeJump, routeAvailable && activeView === "venue", tt("venue.route"), 4);
    setActionButton(viewShareJump, viewCanShare, tt("share.view"), 3);
    setActionButton(eventBack, !!eventCard, tt("nav.back"), 1);
    setActionButton(eventSave, !!eventCard, tt("card.bookmark"), 2);
    setActionButton(eventShare, !!eventCard, tt("share.view"), 3);
    setActionButton(eventRoute, !!eventCard && eventRouteAvailable, tt("venue.route"), 4);
    setActionButton(eventCalendar, !!eventCard, tt("saved.calendar"), 5);
    const backMode = activeView !== "program";
    if (savedJumpIcon) savedJumpIcon.className = `ic ${backMode ? "ic-back" : "ic-bookmark"}`;
    if (savedJump) savedJump.dataset.mode = backMode ? "back" : "saved";
    setActionButton(savedJump, true, backMode ? tt("nav.back") : tt("nav.saved"), 1);
    if (savedJumpLabel) savedJumpLabel.textContent = backMode ? tt("nav.back") : tt("nav.saved");
    scheduleMainScrollState();
  };
  nowJump?.addEventListener("click", () => {
    jumpToNowInActiveView();
  });
  nearbyJump?.addEventListener("click", () => openNearbyModal());
  savedJump?.addEventListener("click", () => {
    if (savedJump.dataset.mode === "back") {
      navigateBack();
      return;
    }
    const savedUpcoming = upcomingSavedCards();
    const id = savedUpcoming[0]?.dataset.id ?? "";
    showView("saved");
    requestAnimationFrame(() => {
      const clone = id ? $$("#saved-results [data-card]").find((c) => c.dataset.id === id) : null;
      if (clone) scrollToCard(clone);
    });
  });

  // ---- "live now" accent stripe (today, inferred event duration) ----
  const markLive = (): void => {
    const iso = todayISO(); const now = Date.now();
    cards.forEach((c) => { c.classList.toggle("is-live", c.dataset.date === iso && c.dataset.allday !== "1" && cardTime(c) <= now && now < cardEndTime(c)); });
  };

  // ---- UI language ----
  const LANG = "lfm.lang";
  const stored = load<string | null>(LANG, null);
  let lang: Lang = stored && (UI_LANGS as readonly string[]).includes(stored) ? (stored as Lang) : DEFAULT_LANG;
  let tt: T = translator(lang);
  const uiLang = $<HTMLSelectElement>("#ui-lang");
  if (uiLang) { uiLang.value = lang; uiLang.addEventListener("change", () => { lang = uiLang.value as Lang; save(LANG, lang); applyLang(); }); }
  const refreshI18n = (root: ParentNode): void => $$("[data-i18n]", root).forEach((el) => { el.textContent = tt(el.getAttribute("data-i18n")!); });
  const refreshTitleTranslations = (root: ParentNode): void => $$<HTMLElement>("[data-title-translations]", root).forEach((el) => {
    let map: Record<string, string> = {};
    try { map = JSON.parse(el.dataset.titleTranslations ?? "{}") as Record<string, string>; } catch { /* bad translation payload */ }
    const title = lang === "de" || lang === "de-x-simple" ? "" : map[lang];
    el.hidden = !title;
    el.textContent = title ? ` [${title}]` : "";
  });
  function applyLang(): void {
    tt = translator(lang);
    document.documentElement.lang = lang === "de-x-simple" ? "de" : lang;
    document.documentElement.dir = RTL[lang] ? "rtl" : "ltr";
    refreshI18n(document);
    refreshTitleTranslations(document);
    if (search) search.placeholder = tt("filter.searchPlaceholder");
    renderNearbyVenues();
    updateActionButtons();
    if (!views.saved.hidden) renderSaved();
    if (!views.venue.hidden) renderVenueView();
    if (!views.event.hidden) renderEventView();
    updateInstallUi();
  }

  // ---- PWA install affordance (native prompt where available; iOS guidance otherwise) ----
  const installButton = $<HTMLButtonElement>("#pwa-install");
  const installButtonLabel = installButton ? $("[data-i18n]", installButton) : null;
  const installHint = $("#pwa-install-hint");
  let installPrompt: BeforeInstallPromptEvent | null = null;
  const isIosDevice = (): boolean => /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isInstalledPwa = (): boolean => window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  function updateInstallUi(): void {
    if (!installButton || !installHint || !installButtonLabel) return;
    const ios = isIosDevice();
    const visible = !isInstalledPwa() && (!!installPrompt || ios);
    installButton.hidden = !visible;
    installHint.hidden = !visible;
    const buttonKey = ios && !installPrompt ? "pwa.installIos" : "pwa.install";
    const hintKey = ios && !installPrompt ? "pwa.installIosHint" : "pwa.installHint";
    installButtonLabel.setAttribute("data-i18n", buttonKey);
    installButtonLabel.textContent = tt(buttonKey);
    installHint.setAttribute("data-i18n", hintKey);
    installHint.textContent = tt(hintKey);
  }
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    installPrompt = ev as BeforeInstallPromptEvent;
    updateInstallUi();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    updateInstallUi();
  });
  installButton?.addEventListener("click", () => {
    if (!installPrompt) {
      updateInstallUi();
      installHint?.focus?.();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    void prompt.prompt().then(() => prompt.userChoice).catch(() => undefined).finally(updateInstallUi);
  });

  // ---- theme (system / light / dark) ----
  const THEME = "lfm.theme";
  const themeIcon: Record<string, string> = { system: "ic-auto", light: "ic-sun", dark: "ic-moon" };
  let theme = load<string>(THEME, "system");
  const applyTheme = (): void => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    const ic = $("#theme-ic"); if (ic) ic.className = "ic " + (themeIcon[theme] ?? "ic-auto");
  };
  $("#theme-btn")?.addEventListener("click", () => { theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system"; save(THEME, theme); applyTheme(); });

  const routeParams = (): URLSearchParams => new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  syncRoute = (extra: Record<string, string> = {}, replace = true): void => {
    if (applyingRoute) return;
    const p = new URLSearchParams();
    if (activeView !== "program") p.set("view", activeView);
    if (activeView === "author" && activeAuthorKey) p.set("author", activeAuthorKey);
    if (activeView === "venue" && activeVenueKey) p.set("venue", activeVenueKey);
    if (activeView === "event" && activeEventId) p.set("entry", activeEventId);
    if (state.day) p.set("day", state.day);
    if (activeView !== "venue" && state.venue) p.set("venue", state.venue);
    if (state.langs.size) p.set("lang", [...state.langs].sort().join(","));
    if (state.gInc.size) p.set("genre", [...state.gInc].sort().join(","));
    if (state.gExc.size) p.set("notGenre", [...state.gExc].sort().join(","));
    if (state.quickKinder) p.set("quick", "kinder");
    if (state.quickAuthor) p.set("quickAuthor", "1");
    if (whoPref === "author") p.set("who", "author");
    for (const [key, value] of Object.entries(extra)) if (value) p.set(key, value);
    const hash = p.toString();
    const next = hash ? `#${hash}` : location.pathname + location.search;
    if (location.hash === (hash ? `#${hash}` : "")) return;
    if (replace) history.replaceState(null, "", next);
    else history.pushState(null, "", next);
  };
  const applyRoute = (): void => {
    applyingRoute = true;
    const p = routeParams();
    const requestedView = p.get("view");
    let nextView: AppView =
      requestedView === "saved" || requestedView === "author" || requestedView === "venue" || requestedView === "event" ? requestedView : "program";
    const day = p.get("day");
    if (day) setDay(day, false);
    if (search) search.value = "";
    state.venue = nextView === "venue" ? "" : (p.get("venue") ?? "");
    state.langs = new Set((p.get("lang") ?? "").split(",").filter(Boolean));
    state.gInc = new Set((p.get("genre") ?? "").split(",").filter(Boolean));
    state.gExc = new Set((p.get("notGenre") ?? "").split(",").filter(Boolean));
    state.quickKinder = p.get("quick") === "kinder";
    state.quickAuthor = p.get("quickAuthor") === "1";
    whoPref = p.get("who") === "author" ? "author" : "reader";
    $$("[data-row='lang'] [data-lang]").forEach((x) => x.setAttribute("aria-pressed", String(state.langs.has(x.dataset.lang ?? ""))));
    $$("[data-row='genre'] [data-genre]").forEach((x) => {
      const g = x.dataset.genre ?? "";
      const next = state.gInc.has(g) ? "include" : state.gExc.has(g) ? "exclude" : "off";
      x.dataset.state = next;
      x.setAttribute("aria-pressed", String(next === "include"));
    });
    $$("[data-row='who'] [data-who]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.who === whoPref)));
    $$("[data-quick='kinder']").forEach((x) => x.setAttribute("aria-pressed", String(state.quickKinder)));
    $$("[data-quick='author']").forEach((x) => x.setAttribute("aria-pressed", String(state.quickAuthor)));
    document.body.classList.toggle("pref-author", whoPref === "author");
    updateFilterCount();
    renderActivePills();
    applyFilters();
    if (nextView === "author") activeAuthorKey = p.get("author") ?? "";
    if (nextView === "venue") activeVenueKey = p.get("venue") ?? "";
    if (nextView === "event") activeEventId = p.get("entry") ?? "";
    if (nextView === "author" && people.profiles[activeAuthorKey]?.events.length === 1 && people.profiles[activeAuthorKey].links.length === 0) {
      const eventCard = byStableId.get(people.profiles[activeAuthorKey].events[0]);
      if (eventCard) {
        activeEventId = eventCard.dataset.stableId || eventCard.dataset.id || "";
        nextView = "event";
      }
    }
    if (nextView === "event") {
      const eventCard = activeEventCard();
      if (eventCard?.dataset.date) setDay(eventCard.dataset.date, false);
    }
    const canShowView =
      (nextView !== "author" || !!people.profiles[activeAuthorKey]) &&
      (nextView !== "venue" || venueCards(activeVenueKey).length > 0) &&
      (nextView !== "event" || !!activeEventCard());
    showView(canShowView ? nextView : "program", false);
    if (canShowView && (nextView === "author" || nextView === "venue")) queueCurrentQuarterJumpInView(nextView);
    const entryId = p.get("entry");
    const entry = entryId ? byId.get(entryId) ?? byStableId.get(entryId) : null;
    if (entry && nextView === "program") {
      setDay(entry.dataset.date ?? state.day, false);
      requestAnimationFrame(() => scrollToCard(entry));
    }
    const modal = p.get("modal");
    if (modal === "filter") openFilterModal(false);
    if (modal === "info") openInfoModal(false);
    if (modal === "nearby" && ENABLE_NEARBY_PLACES) openNearbyModal(false);
    if (modal === "route") openRouteModal(false);
    applyingRoute = false;
    updateActionButtons();
  };
  window.addEventListener("hashchange", applyRoute);
  window.addEventListener("resize", () => {
    updateStickyOffsets();
    scheduleMainScrollState();
  });

  // ---- boot ----
  const isLocalPreview = /^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname);
  if (import.meta.env.PROD && !isLocalPreview && "serviceWorker" in navigator) {
    const reloadKey = "lfm.swReloaded.v5";
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, "1");
      location.reload();
    });
    navigator.serviceWorker.register(`${meta.base}sw.js`).then((registration) => {
      void registration.update();
    }).catch(() => { /* offline unsupported */ });
  }
  applyLang();
  applyTheme();
  markLive();
  const iso = todayISO();
  setDay(fdays.includes(iso) ? iso : (fdays[0] ?? ""), !location.hash);
  showView("program", !location.hash);
  if (location.hash) applyRoute();
  else if (fdays.includes(iso)) requestAnimationFrame(jumpToCurrentQuarterProgram);
  updateDatetimeHeader();
  updateStickyHeader();

  // ---- best-effort live update check ----
  fetch(`${meta.base}data/events.json`, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j) => {
    if (j && j.sourceModified && j.sourceModified !== meta.sourceModified) showUpdateBanner();
  }).catch(() => { /* offline — fine */ });
  function showUpdateBanner(): void {
    const b = document.createElement("button");
    b.className = uiClass.control; b.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:50;background:var(--color-cobalt);color:#fff";
    b.textContent = tt("ui.updated") + " ↻"; b.onclick = () => location.reload();
    document.body.appendChild(b);
  }
}
