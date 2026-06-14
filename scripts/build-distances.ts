/**
 * build-distances.ts — build a real OSM foot-routing graph for Meißen and
 * precompute venue-to-venue walking times. Routes follow mapped OSM ways only,
 * so the matrix no longer invents straight-line shortcuts across the Elbe,
 * vineyard slopes, walls, or unmapped terrain.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "../public/data");
const PREP = resolve(HERE, "../prep");
const WALK_KMH = 4.5;
const SNAP_RADIUS_M = 90;
const DISTANCE_PRECISION_M = 25;
const CLIENT_EDGE_PRECISION_M = 5;
const CLIENT_COORD_SCALE = 1e5;
const OSM_CACHE = resolve(PREP, "osm-walk-network.overpass.json");
const UA = "literaturfest-meissen-companion/0.1 (+https://github.com/mxfh/literaturfest-meissen)";

interface Venue { key: string; lat: number; lon: number }
interface OSMWay { type: "way"; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }
interface OverpassResponse { elements: OSMWay[] }
interface Node { lat: number; lon: number; x: number; y: number }
interface Edge { a: number; b: number; meters: number; cost: number; flags: string }
interface Snap { edge: number; a: number; b: number; t: number; offset: number; costToA: number; costToB: number }
interface QueueItem { node: number; cost: number }

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;
const haversine = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const R = 6371000;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const roundTo = (value: number, step: number): number => Math.round(value / step) * step;

class MinHeap {
  private items: QueueItem[] = [];
  push(item: QueueItem): void {
    this.items.push(item);
    for (let i = this.items.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= item.cost) break;
      this.items[i] = this.items[p];
      i = p;
      this.items[i] = item;
    }
  }
  pop(): QueueItem | undefined {
    const root = this.items[0];
    const last = this.items.pop();
    if (!root || !last || this.items.length === 0) return root;
    this.items[0] = last;
    for (let i = 0;;) {
      let c = i * 2 + 1;
      if (c >= this.items.length) break;
      if (c + 1 < this.items.length && this.items[c + 1].cost < this.items[c].cost) c++;
      if (this.items[i].cost <= this.items[c].cost) break;
      [this.items[i], this.items[c]] = [this.items[c], this.items[i]];
      i = c;
    }
    return root;
  }
  get length(): number { return this.items.length; }
}

function localProject(lat: number, lon: number, originLat: number, originLon: number): { x: number; y: number } {
  const r = 6371000;
  return {
    x: toRad(lon - originLon) * r * Math.cos(toRad(originLat)),
    y: toRad(lat - originLat) * r,
  };
}

function localUnproject(x: number, y: number, originLat: number, originLon: number): { lat: number; lon: number } {
  const r = 6371000;
  return {
    lat: originLat + toDeg(y / r),
    lon: originLon + toDeg(x / (r * Math.cos(toRad(originLat)))),
  };
}

function allowedWay(tags: Record<string, string>): boolean {
  const highway = tags.highway ?? "";
  if (!highway || /^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway)$/i.test(highway)) return false;
  if (/^(no|private)$/i.test(tags.access ?? "")) return false;
  if (/^(no|private)$/i.test(tags.foot ?? "")) return false;
  if (/^(yes)$/i.test(tags.motorroad ?? "")) return false;
  return true;
}

function wayFactor(tags: Record<string, string>): { factor: number; flags: string } {
  const highway = tags.highway ?? "";
  let factor = 1.0;
  const flags: string[] = [];
  if (highway === "steps") { factor *= 1.65; flags.push("steps"); }
  else if (highway === "path" || highway === "track") { factor *= 1.18; flags.push("rough"); }
  else if (highway === "primary" || highway === "secondary") factor *= 1.08;
  if (tags.bridge === "yes") flags.push("bridge");
  const incline = (tags.incline ?? "").match(/-?\d+(?:\.\d+)?/);
  if (incline) {
    const pct = Math.abs(Number(incline[0]));
    if (Number.isFinite(pct) && pct > 4) {
      factor *= 1 + Math.min(0.55, pct / 100);
      flags.push("incline");
    }
  }
  return { factor, flags: flags.join(",") };
}

async function fetchWalkNetwork(venues: Venue[]): Promise<OverpassResponse> {
  if (existsSync(OSM_CACHE)) return JSON.parse(readFileSync(OSM_CACHE, "utf8")) as OverpassResponse;
  const lats = venues.map((v) => v.lat), lons = venues.map((v) => v.lon);
  const pad = 0.012;
  const bbox = `${Math.min(...lats) - pad},${Math.min(...lons) - pad},${Math.max(...lats) + pad},${Math.max(...lons) + pad}`;
  const query = `
    [out:json][timeout:80];
    (
      way["highway"]["area"!="yes"](${bbox});
    );
    out tags geom;
  `;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as OverpassResponse;
  writeFileSync(OSM_CACHE, JSON.stringify(data) + "\n");
  return data;
}

function buildGraph(osm: OverpassResponse, originLat: number, originLon: number): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeIds = new Map<string, number>();
  const nodeOf = (lat: number, lon: number): number => {
    const key = `${lat.toFixed(7)},${lon.toFixed(7)}`;
    const hit = nodeIds.get(key);
    if (hit != null) return hit;
    const p = localProject(lat, lon, originLat, originLon);
    const id = nodes.length;
    nodes.push({ lat, lon, x: p.x, y: p.y });
    nodeIds.set(key, id);
    return id;
  };
  for (const way of osm.elements) {
    const tags = way.tags ?? {};
    const geom = way.geometry ?? [];
    if (way.type !== "way" || geom.length < 2 || !allowedWay(tags)) continue;
    const { factor, flags } = wayFactor(tags);
    for (let i = 1; i < geom.length; i++) {
      const a = nodeOf(geom[i - 1].lat, geom[i - 1].lon);
      const b = nodeOf(geom[i].lat, geom[i].lon);
      if (a === b) continue;
      const meters = haversine(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon);
      if (meters < 0.3 || meters > 400) continue;
      edges.push({ a, b, meters, cost: meters * factor, flags });
    }
  }
  addShortConnectors(nodes, edges);
  return { nodes, edges };
}

function addShortConnectors(nodes: Node[], edges: Edge[]): void {
  const max = 7.5;
  const cell = max;
  const seen = new Set<string>();
  for (const edge of edges) seen.add(edge.a < edge.b ? `${edge.a}:${edge.b}` : `${edge.b}:${edge.a}`);
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number): string => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  nodes.forEach((node, i) => {
    const cx = Math.floor(node.x / cell), cy = Math.floor(node.y / cell);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      for (const j of buckets.get(`${cx + ox}:${cy + oy}`) ?? []) {
        const d = Math.hypot(node.x - nodes[j].x, node.y - nodes[j].y);
        if (d > max) continue;
        const a = Math.min(i, j), b = Math.max(i, j), pair = `${a}:${b}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        edges.push({ a, b, meters: d, cost: d * 1.25, flags: "connector" });
      }
    }
    const k = key(node.x, node.y);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i);
  });
}

function nearestEdge(lat: number, lon: number, nodes: Node[], edges: Edge[], originLat: number, originLon: number): Snap | null {
  const p = localProject(lat, lon, originLat, originLon);
  let best: Snap | null = null;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i], a = nodes[edge.a], b = nodes[edge.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const sx = a.x + dx * t, sy = a.y + dy * t;
    const offset = Math.hypot(p.x - sx, p.y - sy);
    if (!best || offset < best.offset) {
      best = { edge: i, a: edge.a, b: edge.b, t, offset, costToA: offset + edge.cost * t, costToB: offset + edge.cost * (1 - t) };
    }
  }
  return best && best.offset <= SNAP_RADIUS_M ? best : null;
}

function adjacency(nodes: Node[], edges: Edge[]): Array<Array<{ to: number; cost: number }>> {
  const adj = Array.from({ length: nodes.length }, () => [] as Array<{ to: number; cost: number }>);
  for (const edge of edges) {
    adj[edge.a].push({ to: edge.b, cost: edge.cost });
    adj[edge.b].push({ to: edge.a, cost: edge.cost });
  }
  return adj;
}

function dijkstra(adj: Array<Array<{ to: number; cost: number }>>, starts: Array<{ node: number; cost: number }>): Float64Array {
  const dist = new Float64Array(adj.length);
  dist.fill(Number.POSITIVE_INFINITY);
  const heap = new MinHeap();
  for (const s of starts) {
    if (s.cost < dist[s.node]) {
      dist[s.node] = s.cost;
      heap.push({ node: s.node, cost: s.cost });
    }
  }
  while (heap.length) {
    const item = heap.pop();
    if (!item || item.cost !== dist[item.node]) continue;
    for (const edge of adj[item.node]) {
      const next = item.cost + edge.cost;
      if (next < dist[edge.to]) {
        dist[edge.to] = next;
        heap.push({ node: edge.to, cost: next });
      }
    }
  }
  return dist;
}

function snapCost(dist: Float64Array, snap: Snap): number {
  return Math.min(dist[snap.a] + snap.costToA, dist[snap.b] + snap.costToB);
}

function compactGraph(nodes: Node[], edges: Edge[], venueSnaps: Record<string, Snap>): unknown {
  return {
    model: "OSM foot graph, client-side Dijkstra; approximate 20-50 m distance precision",
    speedKmh: WALK_KMH,
    snapRadiusM: SNAP_RADIUS_M,
    coordinateScale: CLIENT_COORD_SCALE,
    distancePrecisionM: DISTANCE_PRECISION_M,
    nodes: nodes.map((n) => [Math.round(n.lat * CLIENT_COORD_SCALE), Math.round(n.lon * CLIENT_COORD_SCALE)]),
    edges: edges.map((e) => [e.a, e.b, roundTo(e.cost, CLIENT_EDGE_PRECISION_M), e.flags]),
    venues: Object.fromEntries(Object.entries(venueSnaps).map(([key, s]) => [key, [s.edge, Math.round(s.t * 1000), roundTo(s.offset, CLIENT_EDGE_PRECISION_M)]])),
  };
}

export async function run(): Promise<void> {
  const venues = (JSON.parse(readFileSync(resolve(DATA, "venues.json"), "utf8")).venues as Venue[]).filter((v) => v.lat && v.lon);
  const originLat = venues.reduce((sum, v) => sum + v.lat, 0) / venues.length;
  const originLon = venues.reduce((sum, v) => sum + v.lon, 0) / venues.length;
  const osm = await fetchWalkNetwork(venues);
  const { nodes, edges } = buildGraph(osm, originLat, originLon);
  const adj = adjacency(nodes, edges);

  const venueSnaps: Record<string, Snap> = {};
  for (const venue of venues) {
    const snap = nearestEdge(venue.lat, venue.lon, nodes, edges, originLat, originLon);
    if (!snap) throw new Error(`Could not snap venue ${venue.key} to OSM foot graph within ${SNAP_RADIUS_M} m`);
    venueSnaps[venue.key] = snap;
  }

  const order = venues.map((v) => v.key);
  const meters: number[][] = [], minutes: number[][] = [];
  for (let i = 0; i < order.length; i++) {
    const source = venueSnaps[order[i]];
    const dist = dijkstra(adj, [{ node: source.a, cost: source.costToA }, { node: source.b, cost: source.costToB }]);
    meters[i] = []; minutes[i] = [];
    for (let j = 0; j < order.length; j++) {
      if (i === j) { meters[i][j] = 0; minutes[i][j] = 0; continue; }
      const routed = snapCost(dist, venueSnaps[order[j]]);
      meters[i][j] = Number.isFinite(routed) ? roundTo(routed, DISTANCE_PRECISION_M) : 0;
      minutes[i][j] = Number.isFinite(routed) ? Math.max(1, Math.round((routed / 1000 / WALK_KMH) * 60)) : 0;
    }
  }

  writeFileSync(resolve(DATA, "distances.json"), JSON.stringify({
    model: `OSM foot graph @ ${WALK_KMH} km/h; approximate ${DISTANCE_PRECISION_M} m distance precision; no off-network river/slope shortcuts`,
    attribution: "© OpenStreetMap contributors",
    snapRadiusM: SNAP_RADIUS_M,
    distancePrecisionM: DISTANCE_PRECISION_M,
    order,
    minutes,
    meters,
  }) + "\n");
  writeFileSync(resolve(DATA, "walk-network.json"), JSON.stringify(compactGraph(nodes, edges, venueSnaps)) + "\n");

  let maxMin = 0, sum = 0, cnt = 0;
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) { maxMin = Math.max(maxMin, minutes[i][j]); sum += minutes[i][j]; cnt++; }
  console.log(`walk graph: ${nodes.length} nodes, ${edges.length} edges, ${order.length} venues`);
  console.log(`distances: avg ${cnt ? Math.round(sum / cnt) : 0} min, max ${maxMin} min`);
}

const RUN_DIRECT = process.argv[1]?.endsWith("build-distances.ts") ?? false;
if (RUN_DIRECT) run().catch((e) => { console.error(e); process.exit(1); });
