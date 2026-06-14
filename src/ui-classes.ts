export const uiClass = {
  control: "ui-control type-ui",
  tag: "ui-tag type-label",
  index: "ui-index type-label",
  sheetHead: "ui-sheet-head type-ui",
  linkRow: "ui-link-row type-ui",
  actionRow: "ui-action-row event-action type-ui",
  fab: "ui-fab thumb-jump type-ui",
  display: "type-display",
  ui: "type-ui",
  title: "type-title",
  section: "type-section",
  clock: "type-clock",
  time: "type-time",
  person: "type-person",
  label: "type-label",
  meta: "type-meta",
} as const;

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");
