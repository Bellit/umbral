import type { Agency, Floor, Furniture, FurnitureType, Opening, OpeningKind, Pt, Room, UmbralModel, Wall } from "../model/types";
import { centroid, distToSegment, pointInPolygon, polygonArea } from "../model/geometry";

/** Operaciones del editor sobre una planta. Son puras: reciben una planta y devuelven otra. */

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pt = (x: number, y: number): Pt => [r3(x), r3(y)];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a: Pt, b: Pt, tol = 0.01) => dist(a, b) < tol;

export function blankModel(agency: Agency): UmbralModel {
  return {
    schema: "umbral.model/1",
    meta: { title: "Vivienda nueva", createdAt: new Date().toISOString(), units: "m", source: "editor", example: agency.example },
    agency,
    property: { title: "Vivienda nueva" },
    floors: [{ id: "p1", name: "Planta principal", level: 0, height: 2.5, rooms: [], walls: [], openings: [], furniture: [] }],
    photos: [],
  };
}

function nextId(floor: Floor, prefix: string): string {
  const all = [...floor.walls, ...floor.openings, ...floor.furniture, ...floor.rooms].map(e => e.id);
  let n = all.length + 1;
  while (all.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// ---------- ajuste del cursor ----------

export type SnapKind = "endpoint" | "wall" | "grid" | "free";
export interface SnapOptions { tol: number; from?: Pt; ortho: boolean; free: boolean }

const GRID = 0.05;
const onGrid = (n: number) => r3(Math.round(n / GRID) * GRID);

/** Ajusta el cursor a extremos de pared, a paredes, al ángulo recto desde `from` y a la rejilla. */
export function snap(floor: Floor, p: Pt, o: SnapOptions): { pt: Pt; kind: SnapKind } {
  if (o.free) return { pt: pt(p[0], p[1]), kind: "free" };
  let endpoint: Pt | null = null, best = o.tol;
  for (const w of floor.walls) for (const e of [w.a, w.b]) {
    const d = dist(p, e);
    if (d < best) { best = d; endpoint = e; }
  }
  if (endpoint) return { pt: endpoint, kind: "endpoint" };

  const horizontal = o.from && o.ortho && Math.abs(p[0] - o.from[0]) >= Math.abs(p[1] - o.from[1]);
  const vertical = o.from && o.ortho && !horizontal;
  const q: Pt = horizontal ? [p[0], o.from![1]] : vertical ? [o.from![0], p[1]] : p;

  for (const w of floor.walls) {
    const s = distToSegment(q[0], q[1], w.a, w.b);
    if (s.d >= o.tol) continue;
    const wallV = Math.abs(w.a[0] - w.b[0]) < 0.001, wallH = Math.abs(w.a[1] - w.b[1]) < 0.001;
    if (horizontal) { if (wallV) return { pt: pt(w.a[0], q[1]), kind: "wall" }; continue; }
    if (vertical) { if (wallH) return { pt: pt(q[0], w.a[1]), kind: "wall" }; continue; }
    // sobre una pared recta, a lo largo de ella también manda la rejilla
    if (wallV) return { pt: pt(w.a[0], onGrid(s.cy)), kind: "wall" };
    if (wallH) return { pt: pt(onGrid(s.cx), w.a[1]), kind: "wall" };
    return { pt: pt(s.cx, s.cy), kind: "wall" };
  }
  // la coordenada que fija el ángulo recto no se redondea a la rejilla
  return { pt: [vertical ? r3(q[0]) : onGrid(q[0]), horizontal ? r3(q[1]) : onGrid(q[1])], kind: "grid" };
}

// ---------- estancias a partir de las paredes ----------

/**
 * Recintos cerrados que forman las paredes (polígonos en sentido antihorario).
 * Las paredes se parten donde se cruzan o se tocan; las que acaban en el aire no cuentan.
 */
export function findFaces(walls: Wall[]): Pt[][] {
  const key = (p: Pt) => `${Math.round(p[0] * 200)},${Math.round(p[1] * 200)}`;
  const nodes = new Map<string, Pt>();
  const edges = new Map<string, Set<string>>();
  const link = (a: Pt, b: Pt) => {
    const ka = key(a), kb = key(b);
    if (ka === kb) return;
    if (!nodes.has(ka)) nodes.set(ka, a);
    if (!nodes.has(kb)) nodes.set(kb, b);
    if (!edges.has(ka)) edges.set(ka, new Set());
    if (!edges.has(kb)) edges.set(kb, new Set());
    edges.get(ka)!.add(kb); edges.get(kb)!.add(ka);
  };

  for (const w of walls) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy);
    if (L < 0.01) continue;
    const ts = new Set<number>([0, 1]);
    for (const o of walls) {
      if (o === w) continue;
      // extremos de otra pared sobre esta (uniones en T)
      for (const e of [o.a, o.b]) {
        const s = distToSegment(e[0], e[1], w.a, w.b);
        if (s.d < 0.01) ts.add(((s.cx - w.a[0]) * dx + (s.cy - w.a[1]) * dy) / (L * L));
      }
      // cruces
      const ox = o.b[0] - o.a[0], oy = o.b[1] - o.a[1], den = dx * oy - dy * ox;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((o.a[0] - w.a[0]) * oy - (o.a[1] - w.a[1]) * ox) / den;
      const u = ((o.a[0] - w.a[0]) * dy - (o.a[1] - w.a[1]) * dx) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) ts.add(t);
    }
    const sorted = [...ts].sort((m, n) => m - n);
    for (let i = 1; i < sorted.length; i++) {
      link(pt(w.a[0] + dx * sorted[i - 1], w.a[1] + dy * sorted[i - 1]), pt(w.a[0] + dx * sorted[i], w.a[1] + dy * sorted[i]));
    }
  }

  // fuera las ramas que acaban en el aire
  for (let changed = true; changed;) {
    changed = false;
    for (const [k, set] of edges) {
      if (set.size !== 1) continue;
      const other = [...set][0];
      edges.get(other)!.delete(k); edges.delete(k);
      changed = true;
    }
  }

  const angle = (from: string, to: string) => {
    const a = nodes.get(from)!, b = nodes.get(to)!;
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const around = new Map<string, string[]>();
  for (const [k, set] of edges) around.set(k, [...set].sort((a, b) => angle(k, a) - angle(k, b)));

  const seen = new Set<string>(), faces: Pt[][] = [];
  for (const [u, list] of around) for (const v of list) {
    if (seen.has(`${u}>${v}`)) continue;
    const loop: string[] = [];
    let a = u, b = v;
    while (!seen.has(`${a}>${b}`)) {
      seen.add(`${a}>${b}`);
      loop.push(a);
      // siguiente borde girando lo más a la izquierda posible: el recinto queda a la izquierda
      const out = around.get(b)!, i = out.indexOf(a), next = out[(i - 1 + out.length) % out.length];
      a = b; b = next;
    }
    const poly = withoutCollinear(loop.map(k => nodes.get(k)!));
    if (poly.length >= 3 && signedArea(poly) > 0.01) faces.push(poly);
  }
  return faces;
}

function signedArea(p: Pt[]): number {
  let s = 0;
  p.forEach((a, i) => { const b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; });
  return s / 2;
}

function withoutCollinear(p: Pt[]): Pt[] {
  return p.filter((c, i) => {
    const a = p[(i - 1 + p.length) % p.length], b = p[(i + 1) % p.length];
    return Math.abs((c[0] - a[0]) * (b[1] - c[1]) - (c[1] - a[1]) * (b[0] - c[0])) > 1e-6;
  });
}

/** El recinto más pequeño que contiene el punto. */
export function faceAt(faces: Pt[][], x: number, y: number): Pt[] | null {
  const inside = faces.filter(f => pointInPolygon(x, y, f));
  return inside.sort((a, b) => polygonArea(a) - polygonArea(b))[0] ?? null;
}

/** Un punto que cae dentro del polígono, aunque tenga forma de L. */
export function interiorPoint(poly: Pt[]): Pt {
  const c = centroid(poly);
  if (pointInPolygon(c[0], c[1], poly)) return c;
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best: Pt = c, score = -1;
  for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
    const q: Pt = [x0 + ((x1 - x0) * i) / 16, y0 + ((y1 - y0) * j) / 16];
    if (!pointInPolygon(q[0], q[1], poly)) continue;
    const edge = Math.min(...poly.map((a, k) => distToSegment(q[0], q[1], a, poly[(k + 1) % poly.length]).d));
    if (edge > score) { score = edge; best = q; }
  }
  return best;
}

/**
 * Tras cambiar paredes, cada estancia que coincidía con un recinto cerrado sigue a
 * ese recinto. Las demás (cocinas abiertas, contornos a mano) conservan su contorno.
 */
function relinkRooms(before: Floor, after: Floor): Floor {
  const facesB = findFaces(before.walls), facesA = findFaces(after.walls);
  const rooms = after.rooms.map(r => {
    const ip = interiorPoint(r.polygon), was = faceAt(facesB, ip[0], ip[1]);
    const area = polygonArea(r.polygon);
    if (!was || Math.abs(polygonArea(was) - area) / area > 0.03) return r;
    const now = faceAt(facesA, ip[0], ip[1]);
    if (!now || Math.abs(polygonArea(now) - area) < 0.001) return r;
    // la superficie escrita en el plano deja de valer si la estancia cambia
    const { area: _declared, label, ...rest } = r;
    return { ...rest, polygon: now, ...(label && pointInPolygon(label[0], label[1], now) ? { label } : {}) };
  });
  return { ...after, rooms };
}

// ---------- huecos ----------

export function wallOfOpening(floor: Floor, o: Opening): Wall | null {
  return floor.walls.find(w => distToSegment(o.a[0], o.a[1], w.a, w.b).d < 0.08 && distToSegment(o.b[0], o.b[1], w.a, w.b).d < 0.08) ?? null;
}

interface DoorPose { hingeAtA: boolean; side: number }

function doorPose(o: Opening): DoorPose | null {
  if (!o.door) return null;
  const hingeAtA = near(o.door.hinge, o.a, 0.03);
  const ux = o.b[0] - o.a[0], uy = o.b[1] - o.a[1];
  const cross = ux * (o.door.openTo[1] - o.door.hinge[1]) - uy * (o.door.openTo[0] - o.door.hinge[0]);
  return { hingeAtA, side: cross >= 0 ? 1 : -1 };
}

/** Recoloca un hueco en los extremos a–b; la hoja de la puerta conserva bisagra y sentido. */
function withEnds(o: Opening, a: Pt, b: Pt, pose: DoorPose | null = doorPose(o)): Opening {
  const out: Opening = { ...o, a, b };
  if (o.door && pose) {
    const L = dist(a, b) || 0.01, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const hinge = pose.hingeAtA ? a : b;
    out.door = { ...o.door, hinge, openTo: pt(hinge[0] - uy * L * pose.side, hinge[1] + ux * L * pose.side) };
  }
  return out;
}

const DEFAULT_WIDTH: Record<OpeningKind, number> = { door: 0.82, passage: 0.9, window: 1.2, balcony: 2 };

/** Centra un hueco de ancho `width` en el punto de la pared más cercano a c. */
function endsOnWall(w: Wall, c: Pt, width: number): [Pt, Pt] {
  const L = dist(w.a, w.b), ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
  const half = Math.min(width, L) / 2;
  const t = Math.max(half, Math.min(L - half, (c[0] - w.a[0]) * ux + (c[1] - w.a[1]) * uy));
  return [pt(w.a[0] + ux * (t - half), w.a[1] + uy * (t - half)), pt(w.a[0] + ux * (t + half), w.a[1] + uy * (t + half))];
}

export function addOpening(floor: Floor, wall: Wall, at: Pt, kind: OpeningKind): { floor: Floor; id: string } {
  const [a, b] = endsOnWall(wall, at, DEFAULT_WIDTH[kind]);
  const id = nextId(floor, "o");
  let o: Opening = { id, kind, a, b };
  if (kind === "door") o = withEnds({ ...o, door: { hinge: a, openTo: a } }, a, b, { hingeAtA: true, side: 1 });
  return { floor: { ...floor, openings: [...floor.openings, o] }, id };
}

export function patchOpening(floor: Floor, id: string, fn: (o: Opening) => Opening): Floor {
  return { ...floor, openings: floor.openings.map(o => (o.id === id ? fn(o) : o)) };
}

export function slideOpening(floor: Floor, id: string, to: Pt): Floor {
  return patchOpening(floor, id, o => {
    const w = wallOfOpening(floor, o);
    if (!w) return o;
    const [a, b] = endsOnWall(w, to, dist(o.a, o.b));
    return withEnds(o, a, b);
  });
}

export function resizeOpening(floor: Floor, id: string, width: number): Floor {
  return patchOpening(floor, id, o => {
    const w = wallOfOpening(floor, o);
    if (!w || width <= 0.1) return o;
    const [a, b] = endsOnWall(w, [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], width);
    return withEnds(o, a, b);
  });
}

/** Distancia del comienzo de la pared al borde del hueco. */
export function openingOffset(floor: Floor, o: Opening): number {
  const w = wallOfOpening(floor, o);
  return w ? Math.min(dist(w.a, o.a), dist(w.a, o.b)) : 0;
}

export function setOpeningOffset(floor: Floor, id: string, offset: number): Floor {
  return patchOpening(floor, id, o => {
    const w = wallOfOpening(floor, o);
    if (!w) return o;
    const L = dist(w.a, w.b), width = dist(o.a, o.b), t = offset + width / 2;
    const c: Pt = [w.a[0] + ((w.b[0] - w.a[0]) * t) / L, w.a[1] + ((w.b[1] - w.a[1]) * t) / L];
    const [a, b] = endsOnWall(w, c, width);
    return withEnds(o, a, b);
  });
}

export function flipHinge(o: Opening): Opening {
  const pose = doorPose(o);
  return pose ? withEnds(o, o.a, o.b, { hingeAtA: !pose.hingeAtA, side: pose.side }) : o;
}

export function flipSwing(o: Opening): Opening {
  const pose = doorPose(o);
  return pose ? withEnds(o, o.a, o.b, { hingeAtA: pose.hingeAtA, side: -pose.side }) : o;
}

/** Cambia el tipo: una puerta recupera su hoja; los demás huecos la pierden. */
export function setOpeningKind(o: Opening, kind: OpeningKind): Opening {
  const { door, ...rest } = o;
  if (kind !== "door") return { ...rest, kind };
  return door ? { ...o, kind } : withEnds({ ...rest, kind, door: { hinge: o.a, openTo: o.a } }, o.a, o.b, { hingeAtA: true, side: 1 });
}

// ---------- paredes ----------

export function addWall(floor: Floor, a: Pt, b: Pt, thickness: number): Floor {
  if (near(a, b)) return floor;
  return relinkRooms(floor, { ...floor, walls: [...floor.walls, { id: nextId(floor, "w"), a, b, thickness }] });
}

/** Aplica un cambio de posición a los extremos de pared; los huecos acompañan a su pared. */
function moveWallPoints(floor: Floor, move: (p: Pt) => Pt): Floor {
  const walls = floor.walls.map(w => ({ ...w, a: move(w.a), b: move(w.b) }));
  const openings = floor.openings.map(o => {
    const old = wallOfOpening(floor, o);
    const now = old && walls.find(w => w.id === old.id);
    if (!old || !now) return o;
    const L0 = dist(old.a, old.b), L1 = dist(now.a, now.b);
    if (L0 < 0.01 || L1 < 0.01) return o;
    const center = ((o.a[0] + o.b[0]) / 2 - old.a[0]) * (old.b[0] - old.a[0]) / L0 + ((o.a[1] + o.b[1]) / 2 - old.a[1]) * (old.b[1] - old.a[1]) / L0;
    const t = center / L0;
    const c: Pt = [now.a[0] + (now.b[0] - now.a[0]) * t, now.a[1] + (now.b[1] - now.a[1]) * t];
    const [a, b] = endsOnWall(now, c, dist(o.a, o.b));
    return withEnds(o, a, b);
  });
  return relinkRooms(floor, { ...floor, walls, openings });
}

/** Mueve un extremo y, con él, las paredes que llegan a ese mismo punto. */
export function moveEndpoint(floor: Floor, from: Pt, to: Pt): Floor {
  return moveWallPoints(floor, p => (near(p, from) ? to : p));
}

/** Traslada una pared entera; las paredes que acaban sobre ella se alargan con ella. */
export function moveWall(floor: Floor, wall: Wall, dx: number, dy: number): Floor {
  return moveWallPoints(floor, p => (distToSegment(p[0], p[1], wall.a, wall.b).d < 0.01 ? pt(p[0] + dx, p[1] + dy) : p));
}

export function setWallLength(floor: Floor, id: string, length: number): Floor {
  const w = floor.walls.find(q => q.id === id);
  if (!w || length < 0.05) return floor;
  const L = dist(w.a, w.b), f = length / L;
  return moveEndpoint(floor, w.b, pt(w.a[0] + (w.b[0] - w.a[0]) * f, w.a[1] + (w.b[1] - w.a[1]) * f));
}

export function patchWall(floor: Floor, id: string, patch: Partial<Wall>): Floor {
  return { ...floor, walls: floor.walls.map(w => (w.id === id ? { ...w, ...patch } : w)) };
}

export function removeWall(floor: Floor, id: string): Floor {
  const w = floor.walls.find(q => q.id === id);
  if (!w) return floor;
  const onIt = new Set(floor.openings.filter(o => wallOfOpening(floor, o)?.id === id).map(o => o.id));
  return relinkRooms(floor, { ...floor, walls: floor.walls.filter(q => q.id !== id), openings: floor.openings.filter(o => !onIt.has(o.id)) });
}

// ---------- estancias ----------

export function addRoom(floor: Floor, polygon: Pt[], name: string): { floor: Floor; id: string } {
  const id = nextId(floor, "r");
  const room: Room = { id, name, polygon, finish: "tile", measured: false };
  return { floor: { ...floor, rooms: [...floor.rooms, room] }, id };
}

export function patchRoom(floor: Floor, id: string, patch: Partial<Room>): Floor {
  return { ...floor, rooms: floor.rooms.map(r => (r.id === id ? { ...r, ...patch } : r)) };
}

/** Quita claves opcionales que han quedado sin valor. */
export function clearRoomKey(floor: Floor, id: string, key: "area" | "outdoor"): Floor {
  return { ...floor, rooms: floor.rooms.map(r => { if (r.id !== id) return r; const c = { ...r }; delete c[key]; return c; }) };
}

// ---------- muebles ----------

const model = (id: string) => `demo/muebles/${id}/${id}_1k.gltf`;

export interface FurnitureDefault { type: FurnitureType; label: string; w: number; d: number; h?: number; model?: string }

/** Catálogo de muebles con su tamaño habitual y, si existe, su modelo 3D. */
export const FURNITURE: FurnitureDefault[] = [
  { type: "bed", label: "Cama", w: 1.5, d: 2 },
  { type: "sofa", label: "Sofá", w: 2, d: 0.9 },
  { type: "table", label: "Mesa", w: 1.4, d: 0.8, h: 0.75, model: model("wooden_table_02") },
  { type: "chair", label: "Silla", w: 0.42, d: 0.5, h: 0.95, model: model("painted_wooden_chair_01") },
  { type: "desk", label: "Escritorio", w: 1.2, d: 0.6, h: 0.75, model: model("metal_office_desk") },
  { type: "wardrobe", label: "Armario", w: 1.5, d: 0.6, h: 2.2 },
  { type: "nightstand", label: "Mesilla", w: 0.45, d: 0.42, h: 0.5 },
  { type: "sideboard", label: "Aparador", w: 1.6, d: 0.45, h: 0.7, model: model("modern_wooden_cabinet") },
  { type: "shelf", label: "Estantería", w: 1, d: 0.35, h: 1.6, model: model("wooden_display_shelves_01") },
  { type: "tv", label: "Televisor", w: 1.6, d: 0.45 },
  { type: "kitchen", label: "Cocina", w: 2.4, d: 0.6 },
  { type: "island", label: "Isla", w: 1.5, d: 0.8 },
  { type: "fridge", label: "Nevera", w: 0.65, d: 0.65, h: 1.8 },
  { type: "sink", label: "Lavabo", w: 0.7, d: 0.46 },
  { type: "wc", label: "Inodoro", w: 0.42, d: 0.6 },
  { type: "bidet", label: "Bidé", w: 0.42, d: 0.55 },
  { type: "bathtub", label: "Bañera", w: 0.75, d: 1.6 },
  { type: "shower", label: "Ducha", w: 0.9, d: 0.9 },
  { type: "stairs", label: "Escalera", w: 0.9, d: 2.6 },
  { type: "cabinet", label: "Mueble bajo", w: 0.8, d: 0.45, h: 0.85 },
  { type: "other", label: "Otro", w: 0.6, d: 0.6, h: 0.85 },
];

export function addFurniture(floor: Floor, def: FurnitureDefault, c: Pt): { floor: Floor; id: string } {
  const id = nextId(floor, "f");
  const { type, label, w, d, h, model: m } = def;
  const item: Furniture = { id, type, label, x: r3(c[0] - w / 2), y: r3(c[1] - d / 2), w, d, ...(h !== undefined ? { h } : {}), ...(m ? { model: m } : {}) };
  return { floor: { ...floor, furniture: [...floor.furniture, item] }, id };
}

export function patchFurniture(floor: Floor, id: string, fn: (f: Furniture) => Furniture): Floor {
  return { ...floor, furniture: floor.furniture.map(f => (f.id === id ? fn(f) : f)) };
}

export function moveFurniture(f: Furniture, x: number, y: number): Furniture {
  const dx = x - f.x, dy = y - f.y;
  return { ...f, x: r3(x), y: r3(y), ...(f.polygon ? { polygon: f.polygon.map(p => pt(p[0] + dx, p[1] + dy)) } : {}) };
}

/** Gira 90° sobre su centro, en sentido horario visto en planta. */
export function rotateFurniture(f: Furniture): Furniture {
  const cx = f.x + f.w / 2, cy = f.y + f.d / 2;
  const out: Furniture = { ...f, w: f.d, d: f.w, x: r3(cx - f.d / 2), y: r3(cy - f.w / 2) };
  if (f.polygon) out.polygon = f.polygon.map(p => pt(cx + (p[1] - cy), cy - (p[0] - cx)));
  if (f.heading !== undefined) out.heading = (f.heading + 90) % 360;
  return out;
}

export function duplicateFurniture(floor: Floor, id: string): { floor: Floor; id: string } {
  const f = floor.furniture.find(q => q.id === id);
  if (!f) return { floor, id };
  const nid = nextId(floor, "f");
  return { floor: { ...floor, furniture: [...floor.furniture, { ...moveFurniture(f, f.x + 0.2, f.y - 0.2), id: nid }] }, id: nid };
}

// ---------- selección ----------

export type Selection =
  | { kind: "wall"; id: string } | { kind: "opening"; id: string }
  | { kind: "furniture"; id: string } | { kind: "room"; id: string } | { kind: "entrance" };

export function hitTest(floor: Floor, p: Pt, tol: number): Selection | null {
  if (floor.entrance && Math.hypot(floor.entrance.x - p[0], floor.entrance.y - p[1]) < tol * 1.6) return { kind: "entrance" };
  for (const o of floor.openings) if (distToSegment(p[0], p[1], o.a, o.b).d < tol) return { kind: "opening", id: o.id };
  for (const w of floor.walls) if (distToSegment(p[0], p[1], w.a, w.b).d < w.thickness / 2 + tol * 0.4) return { kind: "wall", id: w.id };
  for (let i = floor.furniture.length - 1; i >= 0; i--) {
    const f = floor.furniture[i];
    const inside = f.polygon ? pointInPolygon(p[0], p[1], f.polygon) : p[0] >= f.x && p[0] <= f.x + f.w && p[1] >= f.y && p[1] <= f.y + f.d;
    if (inside) return { kind: "furniture", id: f.id };
  }
  const rooms = floor.rooms.filter(r => pointInPolygon(p[0], p[1], r.polygon)).sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  return rooms[0] ? { kind: "room", id: rooms[0].id } : null;
}

/** Borra el elemento seleccionado. */
export function removeSelection(floor: Floor, s: Selection): Floor {
  switch (s.kind) {
    case "wall": return removeWall(floor, s.id);
    case "opening": return { ...floor, openings: floor.openings.filter(o => o.id !== s.id) };
    case "furniture": return { ...floor, furniture: floor.furniture.filter(f => f.id !== s.id) };
    case "room": return { ...floor, rooms: floor.rooms.filter(r => r.id !== s.id) };
    case "entrance": { const { entrance: _gone, ...rest } = floor; return rest; }
  }
}
