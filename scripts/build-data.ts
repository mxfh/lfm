/**
 * build-data.ts — one-shot data refresh: program -> geocode -> distances.
 * Idempotent; geocoding is cached so only new venues hit the network.
 */
import { run as fetchProgram } from "./fetch-program.ts";
import { run as enrichAuthors } from "./enrich-authors.ts";
import { run as geocodeVenues } from "./geocode-venues.ts";
import { run as buildDistances } from "./build-distances.ts";

await fetchProgram();
await enrichAuthors();
await geocodeVenues();
await buildDistances();
