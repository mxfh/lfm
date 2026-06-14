export interface SourceLink {
  id: string;
  labelKey: string;
  href: "official-program" | `asset:${string}` | `https://${string}`;
}

export interface ResolvedSourceLink {
  id: string;
  labelKey: string;
  href: string;
}

const withBase = (base: string, path: string): string => {
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}${path.replace(/^\/+/, "")}`;
};

export const appContent = {
  event: {
    year: "2026",
    officialName: "Literaturfest Meißen",
  },
  meta: {
    title: "Literaturfest Meißen — Lesefahrplan",
    description: "Inoffizieller mobiler Lesefahrplan für das Literaturfest Meißen: Lesungen merken und sehen, was du von hier zu Fuß noch erreichst.",
    applicationName: "Lesefahrplan",
    appleTitle: "Lesefahrplan",
    themeColor: "#21458c",
    themeColorLight: "#f7f3ea",
    themeColorDark: "#15130e",
  },
  header: {
    titleParts: [
      { text: "Literaturfest", accent: false },
      { text: "Meißen", accent: true },
    ],
    taglineKey: "app.tagline",
    programLinkKey: "app.programLink",
    infoLabelKey: "app.info",
  },
  info: {
    titleKey: "info.title",
    leadKey: "info.lead",
    detailKeys: ["info.bestEffort", "info.validation", "info.translations"],
    sourcesTitleKey: "info.sources",
    sourceModifiedKey: "info.sourceModified",
  },
  sources: [
    { id: "official-program", labelKey: "source.officialProgram", href: "official-program" },
    { id: "events-json", labelKey: "source.eventsData", href: "asset:data/events.json" },
    { id: "venues-json", labelKey: "source.venuesData", href: "asset:data/venues.json" },
    { id: "authors-json", labelKey: "source.authorsData", href: "asset:data/authors.json" },
  ] satisfies SourceLink[],
  calendar: {
    id: "lfm",
    uidDomain: "lfm.mxfh.github.io",
    prodId: "-//mxfh//lfm//DE",
    fileName: "literaturfest-meissen-merkliste.ics",
    name: "Literaturfest Meißen",
    defaultEventTitle: "Literaturfest Meißen",
    sourceLabelKey: "source.officialProgram",
    validationNoteKey: "info.validationShort",
  },
} as const;

export const resolveSourceLinks = (
  sources: readonly SourceLink[],
  options: { base: string; officialProgramUrl: string },
): ResolvedSourceLink[] => sources.map((source) => ({
  id: source.id,
  labelKey: source.labelKey,
  href: source.href === "official-program" ? options.officialProgramUrl : source.href.startsWith("asset:") ? withBase(options.base, source.href.slice("asset:".length)) : source.href,
}));
