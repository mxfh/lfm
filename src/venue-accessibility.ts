export interface VenueAccessibilityNote {
  kind: "warning" | "info";
  noteKey: string;
}

export const VENUE_ACCESSIBILITY: Record<string, VenueAccessibilityNote> = {
  "34": {
    kind: "warning",
    noteKey: "access.venue.34",
  },
};
