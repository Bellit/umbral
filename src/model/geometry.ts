import type { Floor, Pt, Room } from "./types";

/** Superficie de un polígono (fórmula del área de Gauss), en m². */
export function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function centroid(p: Pt[]): Pt {
  let x = 0, y = 0;
  for (const q of p) { x += q[0]; y += q[1]; }
  return [x / p.length, y / p.length];
}

export function roomLabelPoint(r: Room): Pt {
  return r.label ?? centroid(r.polygon);
}

export function pointInPolygon(x: number, y: number, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function floorBounds(f: Floor): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (q: Pt) => {
    b.minX = Math.min(b.minX, q[0]); b.minY = Math.min(b.minY, q[1]);
    b.maxX = Math.max(b.maxX, q[0]); b.maxY = Math.max(b.maxY, q[1]);
  };
  f.rooms.forEach(r => r.polygon.forEach(add));
  f.walls.forEach(w => { add(w.a); add(w.b); });
  return b;
}

export interface RoomArea { id: string; name: string; area: number; measured: boolean; outdoor: boolean }

/** La superficie escrita en el plano manda sobre la calculada. */
export function roomArea(r: Room): number {
  return r.area ?? polygonArea(r.polygon);
}

export function floorAreas(f: Floor): { rooms: RoomArea[]; total: number } {
  const rooms = f.rooms.map(r => ({ id: r.id, name: r.name, area: roomArea(r), measured: r.measured !== false, outdoor: Boolean(r.outdoor) }));
  return { rooms, total: rooms.reduce((s, r) => (r.outdoor ? s : s + r.area), 0) };
}

/** Formato español: 12,32 */
export function fmt(n: number, dec = 2): string {
  return n.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Distancia de un punto a un segmento. */
export function distToSegment(px: number, py: number, a: Pt, b: Pt): { d: number; cx: number; cy: number } {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? ((px - a[0]) * vx + (py - a[1]) * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * vx, cy = a[1] + t * vy;
  return { d: Math.hypot(px - cx, py - cy), cx, cy };
}

/**
 * Parte una pared en los tramos que quedan al quitar los huecos que caen
 * sobre ella. Devuelve los tramos macizos y, por cada hueco, su intervalo.
 */
export function splitWall(a: Pt, b: Pt, holes: [Pt, Pt][], tol = 0.08): { solid: [Pt, Pt][]; cuts: { t0: number; t1: number; index: number }[] } {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const L = Math.hypot(vx, vy);
  if (L === 0) return { solid: [], cuts: [] };
  const ux = vx / L, uy = vy / L;
  const proj = (p: Pt) => ({ t: (p[0] - a[0]) * ux + (p[1] - a[1]) * uy, off: Math.abs((p[0] - a[0]) * -uy + (p[1] - a[1]) * ux) });
  const cuts: { t0: number; t1: number; index: number }[] = [];
  holes.forEach(([p, q], index) => {
    const P = proj(p), Q = proj(q);
    if (P.off > tol || Q.off > tol) return;
    const t0 = Math.max(0, Math.min(P.t, Q.t)), t1 = Math.min(L, Math.max(P.t, Q.t));
    if (t1 - t0 > 0.02) cuts.push({ t0, t1, index });
  });
  cuts.sort((m, n) => m.t0 - n.t0);
  const solid: [Pt, Pt][] = [];
  let cur = 0;
  const at = (t: number): Pt => [a[0] + ux * t, a[1] + uy * t];
  for (const c of cuts) {
    if (c.t0 - cur > 0.02) solid.push([at(cur), at(c.t0)]);
    cur = Math.max(cur, c.t1);
  }
  if (L - cur > 0.02) solid.push([at(cur), at(L)]);
  return { solid, cuts };
}
