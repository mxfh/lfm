import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("keeps event rows uncluttered", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-13T15:48:00+02:00"));
  await page.goto("/");

  await expect(page.locator(".app-footer")).toHaveCount(0);
  await expect(page.locator(".tabbar")).toHaveCount(0);
  await expect(page.locator("[data-calendar]")).toHaveCount(0);
  await expect(page.locator("[data-walk]")).toHaveCount(0);
  await expect(page.locator(".ic-route")).toHaveCount(0);
  await expect(page.locator("[data-back-program]")).toHaveCount(0);
  await expect(page.locator(".program-list-head")).toHaveCSS("position", "sticky");
  await expect(page.locator("#datetime-time")).toBeVisible();
  await expect(page.locator("#day-jump")).toBeVisible();
  await expect(page.locator("[data-day-prev]")).toBeVisible();
  await expect(page.locator("[data-day-next]")).toBeVisible();
  await expect(page.locator("#program-list .time-slot:visible:not(.is-initial-time-slot) .time-slot-title").first()).toBeVisible();
  await expect(page.locator("#program-list .time-slot:visible:not(.is-initial-time-slot) .time-slot-title").first()).toHaveCSS("position", "relative");
  await expect(page.locator("[data-card]:visible .type-time")).toHaveCount(0);
  await expect(page.locator("[data-card]:visible .bookmark-entry").first()).toBeVisible();
  const bookmarkSide = await page.locator("[data-card]:visible").first().evaluate((card) => {
    const bookmark = card.querySelector(".bookmark-entry")?.getBoundingClientRect();
    const body = card.querySelector(".card-body")?.getBoundingClientRect();
    return {
      bookmarkLeft: bookmark?.left ?? 0,
      bodyRight: body?.right ?? 999,
    };
  });
  expect(bookmarkSide.bookmarkLeft).toBeGreaterThanOrEqual(bookmarkSide.bodyRight - 1);
  await expect(page.locator("[data-card][data-hasrole='1']:visible .role-badge").first()).toBeVisible();
  await expect(page.locator(".status-head", { hasText: /Autor|TiPP/i })).toHaveCount(0);
  await expect(page.locator("#saved-tab")).toHaveCount(0);
  await expect(page.locator("#quick-jump")).toHaveCount(0);
  await expect(page.locator("#now-jump .ic-next")).toHaveCount(0);
  await expect(page.locator("#now-jump .thumb-label")).toBeHidden();
  await expect(page.locator("#now-jump .ic-now")).toBeVisible();
  await expect(page.locator("#saved-jump .ic-bookmark")).toBeVisible();
  await expect(page.locator("#view-program .card-out")).toHaveCount(0);
  await expect(page.locator("#view-program .ic-ext")).toHaveCount(0);
  await expect(page.locator("#nearby-venues")).toHaveCount(0);
  const headerState = await page.evaluate(() => {
    const list = document.querySelector("#program-list");
    if (!(list?.previousElementSibling instanceof HTMLElement) || list.previousElementSibling.className !== "program-list-head") {
      return { timeSize: 0, daySize: 1, timeLeft: 1, dayLeft: 0, timeText: "", timeWidth: 0, slotWidth: 1, numeric: "" };
    }
    const time = document.querySelector("#datetime-time");
    const day = document.querySelector("#day-jump");
    const slot = [...document.querySelectorAll("#program-list .time-slot:not(.is-initial-time-slot) .time-slot-title")]
      .find((el) => el.getClientRects().length > 0);
    return {
      timeSize: time ? Number.parseFloat(getComputedStyle(time).fontSize) : 0,
      daySize: day ? Number.parseFloat(getComputedStyle(day).fontSize) : 0,
      timeLeft: time?.getBoundingClientRect().left ?? 0,
      dayLeft: day?.getBoundingClientRect().left ?? 0,
      timeText: (time as HTMLElement | null)?.dataset.currentTime ?? "",
      timeWidth: time?.getBoundingClientRect().width ?? 0,
      slotWidth: slot?.getBoundingClientRect().width ?? 1,
      numeric: time ? getComputedStyle(time).fontVariantNumeric : "",
    };
  });
  expect(headerState.timeSize).toBeGreaterThan(28);
  expect(headerState.daySize).toBeGreaterThan(22);
  expect(headerState.timeLeft).toBeLessThan(headerState.dayLeft);
  expect(headerState.timeText).toMatch(/^\d{2}:\d{2}|ganztägig$/);
  expect(Math.abs(headerState.timeWidth - headerState.slotWidth)).toBeLessThan(1);
  expect(headerState.numeric).toContain("tabular-nums");
  const scrolledSlotState = await page.evaluate(() => {
    document.querySelector("main")?.scrollTo(0, 720);
    const activeSlot = document.querySelector(".time-slot.is-active-time-slot > .time-slot-title") as HTMLElement | null;
    return {
      titleCount: document.querySelectorAll("#program-list .time-slot-title").length,
      headerText: (document.querySelector("#datetime-time") as HTMLElement | null)?.dataset.currentTime ?? "",
      appHeaderPosition: getComputedStyle(document.querySelector("#app-header") as HTMLElement).position,
      appHeaderBackground: getComputedStyle(document.querySelector("#app-header") as HTMLElement).backgroundColor,
      filterInsideHeader: !!document.querySelector("#app-header #filter-btn"),
      filterVisible: (document.querySelector("#filter-btn") as HTMLElement | null)?.getClientRects().length ?? 0,
      topbarOpacity: getComputedStyle(document.querySelector(".topbar") as HTMLElement).opacity,
      topbarPointer: getComputedStyle(document.querySelector(".topbar") as HTMLElement).pointerEvents,
      activeSlotShadow: activeSlot ? getComputedStyle(activeSlot).boxShadow : "",
    };
  });
  await expect.poll(() => page.evaluate(() => document.body.classList.contains("header-condensed"))).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const initialTitle = document.querySelector("#program-list .time-slot.is-initial-time-slot > .time-slot-title") as HTMLElement | null;
    return initialTitle ? getComputedStyle(initialTitle).display : "";
  })).toBe("none");
  await expect.poll(() => page.evaluate(() => {
    const visibleTitle = [...document.querySelectorAll("#program-list .time-slot:not(.is-initial-time-slot) > .time-slot-title")]
      .find((el) => el.getClientRects().length > 0) as HTMLElement | undefined;
    if (!visibleTitle) return false;
    const style = getComputedStyle(visibleTitle);
    return style.display !== "none" && style.visibility !== "hidden";
  })).toBe(true);
  expect(scrolledSlotState.titleCount).toBeGreaterThan(1);
  expect(scrolledSlotState.headerText).toMatch(/^\d{2}:\d{2}|ganztägig$/);
  expect(scrolledSlotState.appHeaderPosition).toBe("fixed");
  expect(scrolledSlotState.appHeaderBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(scrolledSlotState.filterInsideHeader).toBe(true);
  expect(scrolledSlotState.filterVisible).toBeGreaterThan(0);
  expect(scrolledSlotState.topbarOpacity).toBe("1");
  expect(scrolledSlotState.topbarPointer).toBe("auto");
  await expect.poll(() => page.evaluate(() => {
    const activeSlot = document.querySelector(".time-slot.is-active-time-slot > .time-slot-title") as HTMLElement | null;
    return activeSlot ? getComputedStyle(activeSlot).boxShadow : "";
  })).toContain("rgb(178, 122, 0)");
  const overscrollState = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overscrollBehaviorY,
    body: getComputedStyle(document.body).overscrollBehaviorY,
    main: getComputedStyle(document.querySelector("main") as HTMLElement).overscrollBehaviorY,
  }));
  expect(overscrollState.html).toBe("none");
  expect(overscrollState.body).toBe("none");
  expect(overscrollState.main).toBe("contain");
  await expect(page.locator("#mini-home")).toHaveCount(0);
  await expect(page.locator("#home-title")).toContainText("Literaturfest");
  await expect(page.locator("#filter-clear-row")).toBeHidden();
  await page.locator("[data-quick='kinder']").click();
  await expect(page.locator("#filter-clear-row")).toBeVisible();
  await expect(page.locator("#filter-count")).toHaveText("1");
  await page.locator("#filter-clear-row").click();
  await expect(page.locator("#filter-clear-row")).toBeHidden();
  await expect(page.locator("[data-quick='kinder']")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#nearby-jump")).toBeHidden();
  await expect(page.locator("#nearby-modal")).toBeHidden();
  await expect(page.locator("[data-card]:visible").first()).toHaveAttribute("data-date", "2026-06-13");
  const endedVisible = await page.locator("[data-card]:visible").evaluateAll((els) => els.some((el) => {
    const c = el as HTMLElement;
    const end = c.dataset.allday === "1" ? new Date(`${c.dataset.date}T23:59:59`) : new Date(`${c.dataset.date}T${c.dataset.end || c.dataset.start || "00:00"}:00`);
    if (c.dataset.allday !== "1" && !c.dataset.end) end.setMinutes(end.getMinutes() + (Number(c.dataset.duration) || 60));
    return end.getTime() < Date.now();
  }));
  expect(endedVisible).toBe(false);
  const hiddenCurrentOrSoon = await page.locator("[data-card]").evaluateAll((els) => els.filter((el) => {
    const c = el as HTMLElement;
    if (c.dataset.date !== "2026-06-13") return false;
    const now = Date.now();
    const start = new Date(`${c.dataset.date}T${c.dataset.start || "00:00"}:00`).getTime();
    const end = c.dataset.allday === "1" ? new Date(`${c.dataset.date}T23:59:59`).getTime() : new Date(`${c.dataset.date}T${c.dataset.end || c.dataset.start || "00:00"}:00`).getTime();
    const currentOrSoon = c.dataset.allday === "1" || (end >= now && start <= now + 60 * 60 * 1000);
    return currentOrSoon && c.hidden;
  }).map((el) => (el as HTMLElement).dataset.id));
  expect(hiddenCurrentOrSoon).toEqual([]);
  const flohmarkt = await page.locator("[data-card]", { hasText: "BÜCHERFLOHMARKT" }).evaluateAll((els) => els.map((el) => {
    const c = el as HTMLElement;
    return { start: c.dataset.start, end: c.dataset.end, allDay: c.dataset.allday, duration: c.dataset.duration };
  }));
  expect(flohmarkt).toEqual(expect.arrayContaining([expect.objectContaining({ end: "16:00", allDay: "", duration: "360" })]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const radius = await page.locator("#now-jump").evaluate((el) => Number.parseFloat(getComputedStyle(el).borderRadius));
  expect(radius).toBeGreaterThan(20);
  const mobileShell = await page.evaluate(() => {
    const actions = document.querySelector(".thumb-actions");
    const search = document.querySelector(".searchbar");
    const now = document.querySelector("#now-jump");
    const saved = document.querySelector("#saved-jump");
    return {
      actionsPosition: actions ? getComputedStyle(actions).position : "",
      nowPosition: now ? getComputedStyle(now).position : "",
      savedPosition: saved ? getComputedStyle(saved).position : "",
      nowBox: now?.getBoundingClientRect().toJSON(),
      savedBox: saved?.getBoundingClientRect().toJSON(),
      searchBox: search?.getBoundingClientRect().toJSON(),
    };
  });
  expect(mobileShell.actionsPosition).toBe("fixed");
  expect(mobileShell.nowPosition).toBe("static");
  expect(mobileShell.savedPosition).toBe("static");
  expect(mobileShell.nowBox && Math.abs(mobileShell.nowBox.width - mobileShell.nowBox.height) < 1).toBeTruthy();
  expect(mobileShell.searchBox && mobileShell.savedBox && mobileShell.savedBox.bottom < mobileShell.searchBox.top).toBeTruthy();
});

test("places desktop context actions above the full-width search", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 820 });
  await page.clock.setFixedTime(new Date("2026-06-13T15:48:00+02:00"));
  await page.goto("/");

  const positions = await page.evaluate(() => {
    const actions = document.querySelector(".thumb-actions")?.getBoundingClientRect();
    const search = document.querySelector(".searchbar")?.getBoundingClientRect();
    const now = document.querySelector("#now-jump")?.getBoundingClientRect();
    const saved = document.querySelector("#saved-jump")?.getBoundingClientRect();
    return {
      actionPosition: getComputedStyle(document.querySelector(".thumb-actions") as HTMLElement).position,
      buttonPosition: getComputedStyle(document.querySelector("#now-jump") as HTMLElement).position,
      searchLeft: search?.left ?? 0,
      searchRight: search?.right ?? 0,
      searchTop: search?.top ?? 999,
      searchWidth: search?.width ?? 0,
      actionsBottom: actions?.bottom ?? 999,
      nowRight: now?.right ?? 0,
      savedRight: saved?.right ?? 0,
      nowTop: now?.top ?? 0,
      savedTop: saved?.top ?? 0,
    };
  });
  expect(positions.actionPosition).toBe("fixed");
  expect(positions.buttonPosition).toBe("static");
  expect(positions.searchWidth).toBeGreaterThan(600);
  expect(positions.searchLeft).toBeGreaterThan(100);
  expect(positions.searchRight).toBeLessThan(800);
  expect(positions.actionsBottom).toBeLessThan(positions.searchTop);
  expect(Math.abs(positions.nowTop - positions.savedTop)).toBeLessThan(2);
  expect(positions.nowRight).toBeGreaterThan(positions.savedRight);
});

test("starts the home list at the current quarter-hour slot", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-13T19:28:00+02:00"));
  await page.goto("/");
  await expect.poll(async () => page.locator("[data-card][data-start='19:15']").first().evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(240);

  await page.clock.setFixedTime(new Date("2026-06-13T19:32:00+02:00"));
  await page.goto("/");
  await expect.poll(async () => page.locator("[data-card][data-start='19:30']").first().evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(240);
});

test("locks desktop scrolling when the active view fits above fixed actions", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");
  await page.locator("#saved-jump").click();
  await expect(page.locator("#view-saved")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector("main")?.classList.contains("is-scroll-locked"))).toBe(true);
  const scrollState = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    main.scrollTo(0, 120);
    return {
      scrollTop: main.scrollTop,
      overflowY: getComputedStyle(main).overflowY,
      needsClearance: main.classList.contains("needs-action-clearance"),
      locked: main.classList.contains("is-scroll-locked"),
    };
  });
  expect(scrollState.locked).toBe(true);
  expect(scrollState.needsClearance).toBe(false);
  expect(scrollState.overflowY).toBe("hidden");
  expect(scrollState.scrollTop).toBe(0);
});

test("adds a transparent bottom slot so list bookmarks clear fixed actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-06-14T16:04:00+02:00"));
  await page.goto("/#view=venue&venue=34&day=2026-06-14");
  await expect(page.locator("#view-venue")).toBeVisible();
  await expect(page.locator("#venue-events [data-card]").last()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector("main")?.classList.contains("needs-action-clearance"))).toBe(true);

  const clearance = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    main.scrollTo(0, main.scrollHeight);
    const list = document.querySelector("#venue-events") as HTMLElement;
    const cards = [...list.querySelectorAll<HTMLElement>("[data-card]")].filter((card) => !card.hidden);
    const lastBookmark = cards.at(-1)?.querySelector(".bookmark-entry") as HTMLElement;
    const actionTops = [...document.querySelectorAll<HTMLElement>(".thumb-jump")]
      .filter((button) => !button.hidden && getComputedStyle(button).display !== "none")
      .map((button) => button.getBoundingClientRect().top);
    return {
      spacerHeight: Number.parseFloat(getComputedStyle(list, "::after").height),
      bookmarkBottom: lastBookmark.getBoundingClientRect().bottom,
      actionTop: Math.min(...actionTops),
      scrollTop: main.scrollTop,
      maxScroll: main.scrollHeight - main.clientHeight,
    };
  });
  expect(clearance.spacerHeight).toBeGreaterThan(70);
  expect(clearance.maxScroll).toBeGreaterThan(0);
  expect(clearance.scrollTop).toBeGreaterThan(0);
  expect(clearance.bookmarkBottom).toBeLessThan(clearance.actionTop - 4);
});

test("venue pages keep past events and scroll to the live slot", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-13T19:28:00+02:00"));
  await page.goto("/#view=venue&venue=B1&day=2026-06-13");
  await expect(page.locator("#view-venue")).toBeVisible();
  expect(await page.locator("#venue-events [data-card][data-start='18:00']").count()).toBeGreaterThan(0);
  await expect.poll(async () => page.locator("#venue-events [data-card][data-start='19:15']").first().evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(240);
});

test("author pages keep past events and scroll to the live slot", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-13T22:15:00+02:00"));
  await page.goto("/#view=author&author=david-wojnarowicz&day=2026-06-13");
  await expect(page.locator("#view-author")).toBeVisible();
  expect(await page.locator("#author-events [data-card][data-start='19:00']").count()).toBeGreaterThan(0);
  await expect.poll(async () => page.locator("#author-events [data-card][data-start='22:00']").first().evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(620);
});

test("shows mobile-safe search suggestions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-06-13T15:48:00+02:00"));
  await page.goto("/");
  const visibleBefore = await page.locator("[data-card]:visible").count();
  const search = page.locator("#search");
  await search.click();
  await expect(page.locator("#search-cancel")).toBeVisible();
  await expect(page.locator("#search-suggestions [data-search-kind='author']").first()).toBeVisible();
  await expect(page.locator("#search-suggestions [data-search-kind='venue']").first()).toBeVisible();
  await expect(page.locator("#search-suggestions .ic-pin").first()).toBeVisible();
  await expect(page.locator("#search-suggestions .ic-pen").first()).toBeVisible();
  await expect(page.locator("#search-suggestions [data-search-kind='author'] .search-suggest-aside").first()).toBeVisible();
  await expect(page.locator("#search-suggestions [data-search-kind='venue'] .search-suggest-aside").first()).toBeVisible();
  const firstTwoSuggestionBackgrounds = await page.locator("#search-suggestions .search-suggest").evaluateAll((els) =>
    els.slice(0, 2).map((el) => getComputedStyle(el).backgroundColor)
  );
  expect(firstTwoSuggestionBackgrounds[0]).not.toBe(firstTwoSuggestionBackgrounds[1]);
  const venueSuggestion = page.locator("#search-suggestions [data-search-kind='venue'][data-search-distance]").first();
  await expect(venueSuggestion.locator(".search-suggest-distance")).toBeVisible();
  const venueLayout = await venueSuggestion.evaluate((el) => {
    const row = el.getBoundingClientRect();
    const distance = el.querySelector(".search-suggest-distance")?.getBoundingClientRect();
    const title = el.querySelector(".search-suggest-title");
    const aside = el.querySelector(".search-suggest-aside")?.getBoundingClientRect();
    const titleStyle = title ? getComputedStyle(title) : null;
    return {
      rightGap: distance ? row.right - distance.right : 999,
      asideRightGap: aside ? row.right - aside.right : 999,
      titleWhiteSpace: titleStyle?.whiteSpace ?? "",
      titleOverflow: titleStyle?.overflow ?? "",
      leftGap: row.left,
      rightEdge: row.right,
      viewport: window.innerWidth,
    };
  });
  expect(venueLayout.rightGap).toBeLessThan(24);
  expect(venueLayout.asideRightGap).toBeLessThan(24);
  expect(venueLayout.titleWhiteSpace).toBe("normal");
  expect(venueLayout.titleOverflow).toBe("visible");
  expect(venueLayout.leftGap).toBeLessThan(1);
  expect(venueLayout.rightEdge).toBeGreaterThan(389);
  await search.fill("waterfront");
  await expect(page.locator("body")).toHaveClass(/search-open/);
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator("[data-card]:visible")).toHaveCount(visibleBefore);
  const suggestions = page.locator("#search-suggestions [data-search-kind]");
  expect(await suggestions.count()).toBeGreaterThan(0);
  await expect(page.locator("#search-suggestions .search-group-title").first()).toBeVisible();
  const suggestionBox = await page.locator("#search-suggestions").boundingBox();
  const searchBox = await page.locator(".searchbar").boundingBox();
  const overlayBox = await page.locator(".bottombar").boundingBox();
  expect(suggestionBox && searchBox && suggestionBox.y < searchBox.y).toBeTruthy();
  expect(suggestionBox && suggestionBox.height > 360).toBeTruthy();
  expect(overlayBox && overlayBox.y <= 1 && overlayBox.height > 820).toBeTruthy();
  expect(searchBox && searchBox.y + searchBox.height <= 844).toBeTruthy();
  const searchRadius = await page.locator(".searchbar").evaluate((el) => Number.parseFloat(getComputedStyle(el).borderRadius));
  expect(searchRadius).toBeGreaterThan(20);
  const eventSuggestion = page.locator("#search-suggestions [data-search-kind='event']").first();
  await eventSuggestion.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch", isPrimary: true, button: 0 });
  await expect(page.locator("#view-program")).toBeVisible();
  await expect(search).not.toHaveValue("");
  await eventSuggestion.click();
  await expect(search).toHaveValue("");
  await expect(page.locator("#view-event")).toBeVisible();
});

test("keeps bottom search pinned when visual viewport shrinks without keyboard focus", async ({ page }) => {
  await page.addInitScript(() => {
    const visualViewportStub = {
      offsetTop: 0,
      height: 420,
      width: 390,
      scale: 1,
      pageLeft: 0,
      pageTop: 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewportStub });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const idle = await page.evaluate(() => {
    const bottom = document.querySelector(".bottombar")?.getBoundingClientRect().bottom ?? 0;
    return {
      gapToBottom: window.innerHeight - bottom,
      visualBottom: getComputedStyle(document.documentElement).getPropertyValue("--lfm-visual-bottom").trim(),
    };
  });
  expect(idle.visualBottom).toBe("0px");
  expect(Math.abs(idle.gapToBottom)).toBeLessThanOrEqual(1);

  await page.locator("#search").click();
  await expect(page.locator("body")).toHaveClass(/search-open/);
  await expect.poll(() => page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--lfm-visual-bottom").trim(),
  )).toBe("424px");
});

test("keeps desktop search full-width in the bottom shell", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 820 });
  await page.clock.setFixedTime(new Date("2026-06-13T15:48:00+02:00"));
  await page.goto("/");

  const search = page.locator("#search");
  const headerLayout = await page.evaluate(() => {
    const searchbar = document.querySelector(".searchbar")?.getBoundingClientRect();
    return {
      searchLeft: searchbar?.left ?? 0,
      searchTop: searchbar?.top ?? 999,
      searchBottom: searchbar?.bottom ?? 0,
      searchWidth: searchbar?.width ?? 0,
    };
  });
  expect(headerLayout.searchWidth).toBeGreaterThan(600);
  expect(headerLayout.searchLeft).toBeGreaterThan(100);
  expect(headerLayout.searchBottom).toBeLessThanOrEqual(820);
  expect(headerLayout.searchTop).toBeGreaterThan(740);

  await search.click();
  await search.fill("Bühne");
  await expect(page.locator("#search-suggestions [data-search-kind='venue']").first()).toBeVisible();
  const dropdown = await page.evaluate(() => {
    const searchbar = document.querySelector(".searchbar")?.getBoundingClientRect();
    const suggestions = document.querySelector("#search-suggestions")?.getBoundingClientRect();
    const bottom = document.querySelector(".bottombar")?.getBoundingClientRect();
    return {
      searchBottom: searchbar?.bottom ?? 0,
      suggestionsTop: suggestions?.top ?? 0,
      suggestionsHeight: suggestions?.height ?? 0,
      bottomHeight: bottom?.height ?? 999,
    };
  });
  expect(dropdown.suggestionsTop).toBeLessThan(dropdown.searchBottom);
  expect(dropdown.suggestionsHeight).toBeGreaterThan(500);
  expect(dropdown.bottomHeight).toBeGreaterThan(780);
  await expect(search).toHaveAttribute("aria-expanded", "true");
});

test("prioritizes search suggestions by current view context", async ({ page }) => {
  await page.goto("/#view=author&author=christina-koenig&day=2026-06-13");
  await expect(page.locator("#view-author")).toBeVisible();
  await page.locator("#search").click();
  await expect(page.locator("#search-suggestions [data-search-kind]").first()).toHaveAttribute("data-search-kind", "author");

  await page.goto("/#view=venue&venue=45&day=2026-06-13");
  await expect(page.locator("#view-venue")).toBeVisible();
  await page.locator("#search").click();
  await expect(page.locator("#search-suggestions [data-search-kind]").first()).toHaveAttribute("data-search-kind", "venue");
  const venueDistances = await page.locator("#search-suggestions [data-search-kind='venue']").evaluateAll((els) => els.slice(0, 6).map((el) => {
    const value = (el as HTMLElement).dataset.searchDistance;
    return value == null ? null : Number(value);
  }).filter((value): value is number => Number.isFinite(value)));
  expect(venueDistances).toEqual([...venueDistances].sort((a, b) => a - b));
});

test("opens structured programme disclaimer and sources", async ({ page }) => {
  await expect(page.locator(".top-source-link")).toHaveAttribute("href", "https://literaturfest-meissen.de/programm/");
  await page.locator("#info-btn").click();
  await expect(page.locator("#info-modal")).toBeVisible();
  await expect(page).toHaveURL(/modal=info/);
  await expect(page.locator("#info-modal")).not.toContainText(/Barrierefreiheit|accessibility|Rollstuhl|wheelchair|Wheelmap/i);
  await expect(page.locator("#info-modal .source-link")).toHaveCount(4);
  await expect(page.locator("#info-modal .source-link").first()).toHaveAttribute("href", "https://literaturfest-meissen.de/programm/");
  await expect(page.locator("#info-modal .source-link", { hasText: /Programmdaten|programme data/i })).toHaveAttribute("href", /data\/events\.json$/);
  await expect(page.locator("#pwa-install")).toBeHidden();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string; platform: string }>;
    };
    Object.defineProperty(event, "prompt", {
      value: async () => {
        (window as Window & { __lfmInstallPrompted?: boolean }).__lfmInstallPrompted = true;
      },
    });
    Object.defineProperty(event, "userChoice", { value: Promise.resolve({ outcome: "accepted", platform: "web" }) });
    window.dispatchEvent(event);
  });
  await expect(page.locator("#pwa-install")).toBeVisible();
  await expect(page.locator("#pwa-install")).toContainText("App installieren");
  await page.locator("#pwa-install").click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __lfmInstallPrompted?: boolean }).__lfmInstallPrompted)).toBe(true);
  await expect(page.locator("#pwa-install")).toBeHidden();
  await page.reload();
  await expect(page.locator("#info-modal")).toBeVisible();
  await page.locator("#info-modal [data-close]").click();
  await expect(page.locator("#info-modal")).toBeHidden();
});

test("declares iOS full-screen metadata and follows system theme", async ({ page }) => {
  await expect(page.locator("meta[name='viewport']")).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator("meta[name='viewport']")).toHaveAttribute("content", /maximum-scale=1/);
  await expect(page.locator("meta[name='viewport']")).toHaveAttribute("content", /user-scalable=no/);
  await expect(page.locator("meta[name='apple-mobile-web-app-capable']")).toHaveAttribute("content", "yes");
  await expect(page.locator("meta[name='apple-mobile-web-app-status-bar-style']")).toHaveAttribute("content", "black-translucent");
  await expect(page.locator("meta[name='color-scheme']")).toHaveAttribute("content", "light dark");
  await expect(page.locator("meta[name='theme-color'][media='(prefers-color-scheme: light)']")).toHaveAttribute("content", "#f7f3ea");
  await expect(page.locator("meta[name='theme-color'][media='(prefers-color-scheme: dark)']")).toHaveAttribute("content", "#15130e");

  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim());
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const dark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim());
  expect(light).toBe("#f7f3ea");
  expect(dark).toBe("#15130e");
});

test("opens venue view and preserves routed state", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-13T15:48:00+02:00"));
  await page.goto("/");
  const firstCard = page.locator("[data-card]:visible").first();
  const firstId = await firstCard.getAttribute("data-stable-id");
  await firstCard.locator(".venue-btn").click();
  await expect(page.locator("#view-venue")).toBeVisible();
  await expect(page).toHaveURL(/view=venue/);
  await expect(page.locator("#venue-list-trigger")).toHaveText("Ort:");
  await expect(page.locator("#venue-index")).toBeVisible();
  await expect(page.locator("#venue-prev")).toBeVisible();
  await expect(page.locator("#venue-next")).toBeVisible();
  await expect(page.locator("#venue-prev-index")).toHaveCount(0);
  await expect(page.locator("#venue-next-index")).not.toHaveText("");
  const venueSwipeLayout = await page.evaluate(() => {
    const rect = (selector: string): DOMRect | null => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const prev = rect("#venue-prev");
    const track = rect("#venue-title-track");
    const nextIndex = rect("#venue-next-index");
    const next = rect("#venue-next");
    return {
      prevBeforeTrack: !!prev && !!track && prev.right <= track.left + 1,
      nextIndexBeforeNext: !!nextIndex && !!next && nextIndex.right <= next.left + 1,
      nextGap: nextIndex && next ? next.left - nextIndex.right : -1,
    };
  });
  expect(venueSwipeLayout.prevBeforeTrack).toBe(true);
  expect(venueSwipeLayout.nextIndexBeforeNext).toBe(true);
  expect(venueSwipeLayout.nextGap).toBeGreaterThanOrEqual(0);
  const originalVenueTitle = (await page.locator("#venue-title").textContent())?.trim() ?? "";
  await page.locator("#venue-next").click();
  await expect.poll(async () => (await page.locator("#venue-title").textContent())?.trim() ?? "").not.toBe(originalVenueTitle);
  await expect(page).toHaveURL(/view=venue/);
  await page.locator("#venue-prev").click();
  await expect.poll(async () => (await page.locator("#venue-title").textContent())?.trim() ?? "").toBe(originalVenueTitle);
  const swipeBox = await page.locator("#venue-title-track").boundingBox();
  expect(swipeBox).toBeTruthy();
  if (swipeBox) {
    await page.mouse.move(swipeBox.x + swipeBox.width * 0.75, swipeBox.y + swipeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(swipeBox.x + swipeBox.width * 0.2, swipeBox.y + swipeBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await page.locator("#venue-title").textContent())?.trim() ?? "").not.toBe(originalVenueTitle);
    await page.locator("#venue-prev").click();
    await expect.poll(async () => (await page.locator("#venue-title").textContent())?.trim() ?? "").toBe(originalVenueTitle);
  }
  await expect(page.locator("#venue-route")).toHaveCount(0);
  await expect(page.locator("#venue-share")).toHaveCount(0);
  await expect(page.locator("#route-jump")).toBeVisible();
  await expect(page.locator("#view-share-jump")).toBeVisible();
  await expect(page.locator("#nearby-jump")).toBeHidden();
  await expect(page.locator("#saved-jump")).toHaveAttribute("data-action-slot", "1");
  await expect(page.locator("#now-jump")).toHaveAttribute("data-action-slot", "2");
  await expect(page.locator("#view-share-jump")).toHaveAttribute("data-action-slot", "3");
  await expect(page.locator("#route-jump")).toHaveAttribute("data-action-slot", "4");
  const routeButton = await page.locator("#route-jump").boundingBox();
  const routeShell = await page.evaluate(() => {
    const search = document.querySelector(".searchbar")?.getBoundingClientRect();
    const share = document.querySelector("#view-share-jump")?.getBoundingClientRect();
    const route = document.querySelector("#route-jump")?.getBoundingClientRect();
    return {
      searchTop: search?.top ?? 0,
      shareX: share?.x ?? 0,
      routeX: route?.x ?? 0,
      shareCenterY: share ? share.y + share.height / 2 : 0,
      routeCenterY: route ? route.y + route.height / 2 : 1,
      routeBottom: route?.bottom ?? 999,
      routePosition: getComputedStyle(document.querySelector("#route-jump") as HTMLElement).position,
    };
  });
  expect(routeButton && routeButton.width >= 58).toBeTruthy();
  expect(routeShell.routePosition).toBe("static");
  expect(routeShell.routeX).toBeGreaterThan(routeShell.shareX);
  expect(Math.abs(routeShell.routeCenterY - routeShell.shareCenterY)).toBeLessThan(2);
  expect(routeShell.routeBottom).toBeLessThan(routeShell.searchTop);
  const routeRadius = await page.locator("#route-jump").evaluate((el) => Number.parseFloat(getComputedStyle(el).borderRadius));
  expect(routeRadius).toBeGreaterThan(25);
  const shareButton = await page.locator("#view-share-jump").boundingBox();
  expect(shareButton && routeButton && shareButton.x < routeButton.x).toBeTruthy();
  await page.locator("#route-jump").click();
  await expect(page.locator("#route-modal")).toBeVisible();
  await expect(page.locator("#route-save")).toBeVisible();
  await expect(page.locator("#route-google")).toHaveAttribute("href", /google/);
  await page.locator("#route-modal [data-close]").click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { __lfmVenueShare?: string }).__lfmVenueShare = data.text ?? "";
      },
    });
  });
  await page.locator("#view-share-jump").click();
  expect(await page.evaluate(() => (window as Window & { __lfmVenueShare?: string }).__lfmVenueShare ?? "")).toContain("#view=venue&venue=");
  const venueCount = await page.evaluate(() => Object.keys(JSON.parse(document.getElementById("lfm-labels")?.textContent ?? "{\"venues\":{}}").venues).length);
  await page.locator("#venue-list-trigger").click();
  await expect(page.locator("body")).toHaveClass(/search-open/);
  await expect(page.locator("#search-suggestions [data-search-kind='author']")).toHaveCount(0);
  await expect(page.locator("#search-suggestions [data-search-kind='venue']")).toHaveCount(venueCount);
  await page.keyboard.press("Escape");
  await expect(page.locator("#venue-events [data-card]").first()).toBeVisible();
  await expect(page.locator("#venue-events .venue-btn").first()).toBeHidden();
  await page.reload();
  await expect(page.locator("#view-venue")).toBeVisible();
  await page.locator("#saved-jump").click();
  await expect(page.locator("#view-program")).toBeVisible();
  await page.evaluate((id) => { location.hash = `entry=${id}`; }, firstId);
  await expect(firstCard).toBeVisible();
  await expect(page).toHaveURL(/entry=/);
  await page.locator("#filter-btn").click();
  await expect(page).toHaveURL(/modal=filter/);
  await page.reload();
  await expect(page.locator("#filter-modal")).toBeVisible();
  await page.locator("#filter-modal [data-close]").click();
});

test("shows conservative accessibility notes for marked venues", async ({ page }) => {
  await page.goto("/#view=venue&venue=34&day=2026-06-13");
  await expect(page.locator("#view-venue")).toBeVisible();
  await expect(page.locator("#venue-accessibility")).toBeVisible();
  await expect(page.locator("#venue-accessibility")).toContainText(/Görnischen Gasse|Stufen|Umweg/);

  await page.locator("#venue-events [data-card]").first().click();
  await expect(page.locator("#view-event")).toBeVisible();
  await expect(page.locator("#event-accessibility")).toBeVisible();
  await expect(page.locator("#event-accessibility")).toContainText(/Jahnhalle|Stufen/);
});

test("keeps the actual festival title as a sticky home button after scrolling", async ({ page }) => {
  await page.goto("/#view=venue&venue=B1&day=2026-06-13");
  await expect(page.locator("#view-venue")).toBeVisible();
  await expect(page.locator("#mini-home")).toHaveCount(0);
  await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 520));
  await expect.poll(() => page.evaluate(() => document.body.classList.contains("header-condensed"))).toBe(true);
  await expect(page.locator("#app-header")).toHaveCSS("position", "fixed");
  await page.locator("#home-title").click();
  await expect(page.locator("#view-program")).toBeVisible();
  await expect(page).toHaveURL(/day=2026-06-13/);
});

test("reuses sticky datetime head in author and venue views", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-13T15:48:00+02:00"));
  const cases = [
    { url: "/#view=venue&venue=B1&day=2026-06-13", view: "#view-venue", list: "#venue-events" },
    { url: "/#view=author&author=christina-koenig&day=2026-06-13", view: "#view-author", list: "#author-events" },
  ];

  for (const c of cases) {
    await page.goto(c.url);
    await expect(page.locator(c.view)).toBeVisible();
    await expect(page.locator("#timeline-head")).toBeVisible();
    await expect(page.locator(`${c.list} [data-card]`).first()).toBeVisible();
    expect(await page.evaluate((listSelector) => document.querySelector(listSelector)?.previousElementSibling?.id, c.list)).toBe("timeline-head");

    const scrollState = await page.evaluate(() => {
      const main = document.querySelector("main");
      main?.scrollTo(0, 620);
      return {
        scrollTop: main?.scrollTop ?? 0,
        maxScroll: main ? main.scrollHeight - main.clientHeight : 0,
      };
    });
    if (scrollState.maxScroll > 48) {
      await expect.poll(() => page.evaluate(() => document.body.classList.contains("header-condensed"))).toBe(true);
    } else {
      await expect(page.locator("body")).not.toHaveClass(/header-condensed/);
    }
    await page.waitForTimeout(320);
    const topBefore = (await page.locator("#timeline-head").boundingBox())?.y ?? 0;
    await page.evaluate(() => {
      const main = document.querySelector("main");
      main?.scrollTo(0, main.scrollHeight);
    });
    await page.waitForTimeout(80);
    const topAfter = (await page.locator("#timeline-head").boundingBox())?.y ?? 0;
    expect(Math.abs(topAfter - topBefore)).toBeLessThan(4);
    expect(await page.locator("#timeline-head").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    expect(await page.evaluate((listSelector) => !!document.querySelector(`${listSelector} .time-slot.is-active-time-slot`), c.list)).toBe(true);
  }

  const fill = await page.evaluate(() => ({
    body: document.body.getBoundingClientRect().height,
    main: (document.querySelector("main") as HTMLElement).getBoundingClientRect().height,
    viewport: window.innerHeight,
  }));
  expect(fill.body).toBeGreaterThanOrEqual(fill.viewport - 1);
  expect(fill.main).toBeGreaterThan(fill.viewport * 0.55);
});

test("opens routed author profiles with links first", async ({ page }) => {
  await page.goto("/#view=author&author=ingo-siegner&day=2026-06-13");
  await expect(page.locator("#view-author")).toBeVisible();
  await expect(page).toHaveURL(/view=author/);
  await expect(page).toHaveURL(/author=ingo-siegner/);
  await expect(page.locator("#author-list-trigger")).toHaveText("Autor·innen:");
  await expect(page.locator("#author-title")).toHaveText("Ingo Siegner");
  await expect(page.locator("#author-links .profile-link").first()).toBeVisible();
  await expect(page.locator("#author-share")).toHaveCount(0);
  await expect(page.locator("#view-share-jump")).toBeVisible();
  await expect(page.locator("#view-author .ic-ext")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { __lfmAuthorShare?: string }).__lfmAuthorShare = data.text ?? "";
      },
    });
  });
  await page.locator("#view-share-jump").click();
  expect(await page.evaluate(() => (window as Window & { __lfmAuthorShare?: string }).__lfmAuthorShare ?? "")).toContain("#view=author&author=ingo-siegner");
  const authorCount = await page.evaluate(() => Object.keys(JSON.parse(document.getElementById("lfm-people")?.textContent ?? "{\"profiles\":{}}").profiles).length);
  await page.locator("#author-list-trigger").click();
  await expect(page.locator("body")).toHaveClass(/search-open/);
  await expect(page.locator("#search-suggestions [data-search-kind='venue']")).toHaveCount(0);
  await expect(page.locator("#search-suggestions [data-search-kind='author']")).toHaveCount(authorCount);
  await page.keyboard.press("Escape");
  await expect(page.locator("#author-events [data-card]").first()).toBeVisible();
  await expect(page.locator("#author-events .who-reader").first()).toBeHidden();
  await expect(page.locator("#author-events .author-link").first()).toBeHidden();
  await page.reload();
  await expect(page.locator("#view-author")).toBeVisible();
  await page.locator("#saved-jump").click();
  await expect(page.locator("#view-program")).toBeVisible();
  await expect(page.locator(".person-more").first()).toBeAttached();

  await page.goto("/#view=author&author=christina-koenig&day=2026-06-13");
  await expect(page.locator("#view-author")).toBeVisible();
  expect(await page.locator("#author-events [data-card]").count()).toBeGreaterThan(1);
  await expect(page.locator("#now-jump")).toBeVisible();
});

test("routes single-event authors straight to event detail", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-14T10:00:00+02:00"));
  await page.goto("/#day=2026-06-14");
  const singleAuthor = await page.locator("[data-card]:visible").evaluateAll((els) => {
    type ProfileData = { profiles: Record<string, { links?: unknown[] }> };
    const people = JSON.parse(document.getElementById("lfm-people")?.textContent ?? "{\"profiles\":{}}") as ProfileData;
    const counts = new Map<string, number>();
    for (const el of els) {
      for (const key of ((el as HTMLElement).dataset.authorKeys ?? "").split(",").filter(Boolean)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()].find(([key, count]) => {
      if (count !== 1 || (people.profiles[key]?.links?.length ?? 0) > 0) return false;
      const trigger = document.querySelector(`[data-author-open="${CSS.escape(key)}"]`);
      return trigger instanceof HTMLElement && trigger.offsetParent !== null;
    })?.[0] ?? "";
  });
  expect(singleAuthor).not.toBe("");
  await page.locator(`[data-author-open="${singleAuthor}"]:visible`).first().click();
  await expect(page.locator("#view-event")).toBeVisible();
  await expect(page).toHaveURL(/view=event/);
});

test("opens event detail with large actions and routed share", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.clock.setFixedTime(new Date("2026-06-13T10:00:00+02:00"));
  const stableId = "bf328aa2-0e6f-5bd9-b977-adf129fc9300";
  const title = "Isaac B. Singer «Kleyne Weisheiten»";
  await page.goto(`/#view=event&entry=${stableId}&day=2026-06-14`);
  await expect(page.locator("#view-event")).toBeVisible();
  await expect(page).toHaveURL(/view=event/);
  await expect(page).toHaveURL(new RegExp(`entry=${stableId}`));
  await expect(page.locator("#event-title")).toHaveText(title);
  await expect(page.locator("#event-when")).toBeVisible();
  await expect(page.locator("#event-when")).not.toContainText("–");
  await expect(page.locator("#event-when")).toContainText("Uhr");
  await expect(page.locator("#event-info .event-person-link")).toBeVisible();
  await expect(page.locator("#event-info .event-byline .ic-pen")).toHaveCount(0);
  await expect(page.locator("#event-info .event-person-name")).toBeVisible();
  await expect(page.locator("#event-meta .event-venue-link")).toBeVisible();
  await expect(page.locator("#event-back")).toHaveCount(0);
  await expect(page.locator("#event-save")).toBeVisible();
  await expect(page.locator("#event-share")).toBeVisible();
  await expect(page.locator("#event-route")).toBeVisible();
  await expect(page.locator("#event-calendar")).toBeVisible();
  await expect(page.locator(".top-source-link")).toBeHidden();
  await expect(page.locator("#nearby-jump")).toBeHidden();
  await expect(page.locator("#saved-jump")).toBeVisible();
  await expect(page.locator("#saved-jump .ic-back")).toBeVisible();
  await expect(page.locator("#saved-jump")).toHaveAttribute("data-action-slot", "1");
  await expect(page.locator("#event-save")).toHaveAttribute("data-action-slot", "2");
  await expect(page.locator("#event-share")).toHaveAttribute("data-action-slot", "3");
  await expect(page.locator("#event-route")).toHaveAttribute("data-action-slot", "4");
  await expect(page.locator("#event-calendar")).toHaveAttribute("data-action-slot", "5");
  await expect(page.locator("#event-source")).toHaveAttribute("href", /literaturfest-meissen\.de\/programm/);
  await expect(page.locator("#event-source")).not.toHaveClass(/event-action/);
  await expect(page.locator("#event-source .ic-ext")).toBeVisible();
  await expect(page.locator("#event-share")).toContainText("Teilen");
  await expect(page.locator("#event-calendar")).toContainText("Kalender");
  await expect(page.locator("#event-save")).toHaveClass(/bookmark-entry/);
  const actionBoxes = await Promise.all([
    page.locator("#event-share").boundingBox(),
    page.locator("#event-calendar").boundingBox(),
  ]);
  const [shareBox, calendarBox] = actionBoxes;
  expect(shareBox && calendarBox).toBeTruthy();
  const boxes = [shareBox, calendarBox].filter((box): box is NonNullable<typeof box> => !!box);
  expect(boxes.every((box) => Math.abs(box.x - boxes[0].x) < 2)).toBe(true);
  expect(boxes.every((box) => Math.abs(box.width - boxes[0].width) < 2 && box.width > 420)).toBe(true);
  expect(boxes.every((box) => Math.abs(box.height - boxes[0].height) < 2 && box.height >= 50 && box.height <= 60)).toBe(true);
  expect(boxes.every((box, index) => index === 0 || box.y > boxes[index - 1].y)).toBe(true);
  const sourcePlacement = await page.evaluate(() => {
    const source = document.querySelector("#event-source")?.getBoundingClientRect();
    const titleBox = document.querySelector("#event-title")?.getBoundingClientRect();
    const venue = document.querySelector("#event-meta .event-venue-link")?.getBoundingClientRect();
    const route = document.querySelector("#event-route")?.getBoundingClientRect();
    const share = document.querySelector("#event-share")?.getBoundingClientRect();
    const calendar = document.querySelector("#event-calendar")?.getBoundingClientRect();
    const person = document.querySelector("#event-info .event-person-name");
    const bookmark = document.querySelector("#event-save")?.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".event-actions .event-action")].map((row) => {
      const label = row.querySelector("span:not(.ic)")?.getBoundingClientRect();
      const icon = row.querySelector(".ic")?.getBoundingClientRect();
      const style = getComputedStyle(row);
      return {
        iconAfterLabel: !!label && !!icon && icon.left > label.right,
        radius: Number.parseFloat(style.borderRadius),
      };
    });
    return {
      sourceOffset: source && titleBox ? source.left - titleBox.left : 999,
      routeAfterVenue: !!venue && !!route && route.top > venue.bottom,
      routeBeforeActions: !!route && !!share && route.bottom < share.top,
      sourceAfterActions: !!source && !!calendar && source.top > calendar.bottom,
      personWhiteSpace: person ? getComputedStyle(person).whiteSpace : "",
      bookmarkAfterTitle: !!bookmark && !!titleBox && bookmark.left > titleBox.right,
      rows,
    };
  });
  expect(Math.abs(sourcePlacement.sourceOffset)).toBeLessThan(2);
  expect(sourcePlacement.routeAfterVenue).toBe(true);
  expect(sourcePlacement.routeBeforeActions).toBe(true);
  expect(sourcePlacement.sourceAfterActions).toBe(true);
  expect(sourcePlacement.personWhiteSpace).toBe("normal");
  expect(sourcePlacement.bookmarkAfterTitle).toBe(true);
  expect(sourcePlacement.rows.every((row) => row.iconAfterLabel && row.radius > 20)).toBe(true);
  await page.locator("#event-save").click();
  await expect(page.locator("#event-save")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#event-save")).toHaveClass(/is-saved/);
  const typeScale = await page.evaluate(() => {
    const titleEl = document.querySelector("#event-title");
    const personEl = document.querySelector("#event-info .event-person-name");
    const eventWhenEl = document.querySelector("#event-when");
    const listTimeEl = document.querySelector(".datetime-time");
    return {
      title: titleEl ? Number.parseFloat(getComputedStyle(titleEl).fontSize) : 0,
      person: personEl ? Number.parseFloat(getComputedStyle(personEl).fontSize) : 0,
      eventWhen: eventWhenEl ? Number.parseFloat(getComputedStyle(eventWhenEl).fontSize) : 0,
      listTime: listTimeEl ? Number.parseFloat(getComputedStyle(listTimeEl).fontSize) : 0,
      titleY: titleEl?.getBoundingClientRect().y ?? 0,
      personY: personEl?.getBoundingClientRect().y ?? 1,
    };
  });
  expect(typeScale.person).toBeGreaterThan(typeScale.title * 0.55);
  expect(typeScale.personY).toBeLessThan(typeScale.titleY);
  expect(typeScale.eventWhen).toBeGreaterThan(20);
  expect(typeScale.eventWhen).toBeLessThan(typeScale.listTime * 0.8);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { __lfmEventShare?: string }).__lfmEventShare = data.text ?? "";
      },
    });
  });
  await page.locator("#event-share").click();
  const sharedText = await page.evaluate(() => (window as Window & { __lfmEventShare?: string }).__lfmEventShare ?? "");
  expect(sharedText).toContain(`#view=event&entry=${stableId}`);
  expect(sharedText).not.toContain("literaturfest-meissen.de");
});

test("saves entries, exports saved list, and jumps to upcoming saved items", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-13T15:48:00+02:00"));
  await page.goto("/");
  await page.locator("[data-day-next]").click();
  const card = page.locator("[data-card]:visible").first();
  const id = await card.getAttribute("data-id");
  await card.locator("[data-bookmark]").click();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("lfm.saved") ?? "[]"));
  expect(saved).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));

  await expect(page.locator("#view-program [data-message-share]")).toHaveCount(0);
  await expect(page.locator("#saved-jump .ic-bookmark")).toBeVisible();
  await page.locator("#saved-jump").click();
  await expect(page.locator("#saved-calendar")).toBeVisible();
  await expect(page.locator("#now-jump")).toBeHidden();
  await expect(page.locator("#saved-jump .ic-back")).toBeVisible();
  await expect(page.locator(".saved-day-title").first()).toBeVisible();
  await expect(page.locator("#saved-results .time-slot-title").first()).toBeVisible();
  const savedCard = page.locator(`#saved-results [data-id="${id}"]`);
  await expect(savedCard.locator("[data-message-share]")).toBeVisible();
  await expect(savedCard.locator(".ic-message")).toBeVisible();
  const stableId = await savedCard.getAttribute("data-stable-id");
  await expect.poll(() => savedCard.locator(".type-title").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 20, rect.top + rect.height / 2);
    return hit === el || !!hit?.closest?.(".type-title");
  })).toBe(true);
  await savedCard.locator(".type-title").click();
  await expect(page.locator("#view-event")).toBeVisible();
  await expect(page.locator("#saved-jump .ic-back")).toBeVisible();
  await page.locator("#saved-jump").click();
  await expect(page.locator("#view-saved")).toBeVisible();
  await expect(savedCard).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { __lfmSharedText?: string }).__lfmSharedText = data.text ?? "";
      },
    });
  });
  await savedCard.locator("[data-message-share]").click();
  const sharedText = await page.evaluate(() => (window as Window & { __lfmSharedText?: string }).__lfmSharedText ?? "");
  expect(sharedText).toContain(`#view=event&entry=${stableId}`);
  expect(sharedText).not.toContain("literaturfest-meissen.de");
  await page.evaluate(() => {
    (window as Window & { __lfmDownloadName?: string }).__lfmDownloadName = "";
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      (window as Window & { __lfmDownloadName?: string }).__lfmDownloadName = this.download;
      originalClick.call(this);
    };
  });
  await page.locator("#saved-calendar").click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __lfmDownloadName?: string }).__lfmDownloadName)).toBe("literaturfest-meissen-merkliste.ics");

  await page.locator("#saved-jump").click();
  await expect(page.locator("#view-program")).toBeVisible();

  await page.locator("#saved-jump").click();
  await expect(page.locator("#view-saved")).toBeVisible();
  const box = await page.locator("#view-saved").boundingBox();
  expect(box).not.toBeNull();
  const y = (box?.y ?? 0) + 80;
  await page.locator("#view-saved").dispatchEvent("pointerdown", {
    pointerId: 11,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: (box?.x ?? 0) + (box?.width ?? 320) - 20,
    clientY: y,
  });
  await page.locator("#view-saved").dispatchEvent("pointerup", {
    pointerId: 11,
    pointerType: "touch",
    isPrimary: true,
    clientX: (box?.x ?? 0) + 20,
    clientY: y,
  });
  await expect(page.locator("#view-program")).toBeVisible();

  await page.locator("#saved-jump").click();
  await expect(page.locator("#view-saved")).toBeVisible();
  await expect(page.locator(`#saved-results [data-id="${id}"]`)).toBeVisible();
});

test("loads compact OSM walk graph for client-side GPS routing", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fn = (window as Window & {
      lfmWalkMinutesFromGps?: (lat: number, lon: number, venueKey: string) => Promise<number | null>;
    }).lfmWalkMinutesFromGps;
    if (!fn) return { hasRouter: false };
    const graph = await (await fetch("data/walk-network.json")).json() as {
      nodes: unknown[];
      edges: unknown[];
      venues: Record<string, unknown>;
    };
    return {
      hasRouter: true,
      minutesB1: await fn(51.1625, 13.4710, "B1"),
      minutes45: await fn(51.1625, 13.4710, "45"),
      minutesEisbusCarpeDiem: await fn(51.1533432, 13.4809118, "47"),
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      venues: Object.keys(graph.venues).length,
    };
  });

  expect(result.hasRouter).toBe(true);
  if (!result.hasRouter) return;
  expect(result.nodes).toBeGreaterThan(10_000);
  expect(result.edges).toBeGreaterThan(10_000);
  expect(result.venues).toBeGreaterThan(50);
  expect(result.minutesB1).toBeGreaterThanOrEqual(1);
  expect(result.minutes45).toBeGreaterThan(10);
  expect(result.minutes45).toBeLessThan(40);
  expect(result.minutesEisbusCarpeDiem).toBeGreaterThan(20);
  expect(result.minutesEisbusCarpeDiem).toBeLessThan(45);
});
