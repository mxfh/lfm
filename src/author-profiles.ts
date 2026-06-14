export interface PersonLink {
  label: string;
  url: string;
  kind?: "website" | "instagram" | "facebook" | "publisher" | "wikipedia";
}

export interface AuthorProfileSeed {
  links: PersonLink[];
}

export const AUTHOR_PROFILE_SEEDS: Record<string, AuthorProfileSeed> = {
  "Alina Bronsky": {
    links: [{ label: "Verlag", url: "https://www.europaeditions.com/author/73/alina-bronsky", kind: "publisher" }],
  },
  "Andrej Kurkow": {
    links: [{ label: "Wikipedia", url: "https://de.wikipedia.org/wiki/Andrij_Kurkow", kind: "wikipedia" }],
  },
  "Anja Kampmann": {
    links: [
      { label: "Website", url: "https://anjakampmann.de/", kind: "website" },
      { label: "Facebook", url: "https://www.facebook.com/kamp.anja.3", kind: "facebook" },
      { label: "Instagram", url: "https://www.instagram.com/anjakampmann_autorin/", kind: "instagram" },
      { label: "Verlag", url: "https://www.hanser-literaturverlage.de/autor/anja-kampmann/", kind: "publisher" },
    ],
  },
  "Heide Fuhljahn": {
    links: [{ label: "Website", url: "https://www.heidefuhljahn.de/", kind: "website" }],
  },
  "Henning Beck": {
    links: [
      { label: "Website", url: "https://www.henning-beck.com/", kind: "website" },
      { label: "LinkedIn", url: "https://de.linkedin.com/in/dr-henning-beck-8965a720", kind: "website" },
      { label: "Verlag", url: "https://www.hanser-literaturverlage.de/autor/henning-beck/", kind: "publisher" },
    ],
  },
  "Ingo Siegner": {
    links: [
      { label: "Website", url: "https://www.ingosiegner.de/", kind: "website" },
      { label: "Drache Kokosnuss", url: "https://www.drache-kokosnuss.de/", kind: "website" },
    ],
  },
  "Jana Scheerer": {
    links: [{ label: "Website", url: "https://www.janascheerer.de/", kind: "website" }],
  },
  "Küf Kaufmann": {
    links: [{ label: "Website", url: "https://www.kuef-kaufmann.de/", kind: "website" }],
  },
  "Lukas Rietzschel": {
    links: [{ label: "Website", url: "https://www.lukasrietzschel.de/", kind: "website" }],
  },
  "Peter Grandl": {
    links: [
      { label: "Website", url: "https://petergrandl.de/", kind: "website" },
      { label: "Verlag", url: "https://www.piper.de/autoren/peter-grandl-10002230", kind: "publisher" },
    ],
  },
  "Prinz Rupi": {
    links: [{ label: "Website", url: "https://ruprechtfrieling.de/", kind: "website" }],
  },
  "Tara-Louise Witwer": {
    links: [{ label: "Instagram", url: "https://www.instagram.com/wastarasagt/", kind: "instagram" }],
  },
  "Thea Lehmann": {
    links: [{ label: "Website", url: "https://www.thealehmann.de/", kind: "website" }],
  },
  "Martina Berscheid": {
    links: [{ label: "Profil", url: "https://www.literaturland-saar.de/personen/martina-berscheid/", kind: "publisher" }],
  },
  "Siri Hustvedt": {
    links: [{ label: "Website", url: "https://www.sirihustvedt.net/", kind: "website" }],
  },
  "Will Guidara": {
    links: [{ label: "Website", url: "https://www.unreasonablehospitality.com/", kind: "website" }],
  },
};
