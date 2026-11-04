import type { Furniture, Pt } from "../model/types";
import { pointInPolygon } from "../model/geometry";

/**
 * Muebles de cada tipo construidos con volúmenes sencillos.
 * Cuando un mueble trae `model` (glTF de una biblioteca gratuita), el visor
 * lo carga en su lugar; estas formas quedan como respaldo.
 */

export interface Builder {
  /** Caja en coordenadas de planta: x0,y0 → x1,y1 y altura z0 → z1. */
  box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, mat: any, cast?: boolean): void;
  /** Caja de cantos redondeados, con radio r. */
  rbox(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, r: number, mat: any): void;
  /** Cilindro de planta elíptica; `top` es la proporción de la tapa respecto a la base. */
  cyl(x: number, y: number, z0: number, z1: number, rx: number, ry: number, mat: any, top?: number): void;
  extrude(pts: Pt[], h: number, mat: any, z0?: number): void;
  mat(color: number, opts?: Record<string, unknown>): any;
  glass(): any;
  /** Distancia desde un punto a la pared más cercana. */
  nearWall(x: number, y: number): number;
  /** true si el punto cabe sin chocar con paredes ni cristales. */
  free(x: number, y: number, r: number): boolean;
}

const C = {
  white: 0xf4f4f2, steel: 0xbfc4c7, granite: 0x3b3632, cab: 0x8b3a22, cabTop: 0xf2f0ea,
  fabric: 0x8e877f, fabricD: 0x6d675f, bed: 0xe9e3d6, dark: 0x2a2a2a, wood: 0x8a6040, woodD: 0x5a4030,
  wardrobe: 0xb79a73, light: 0xe8e2d6, duvet: 0xc9d1cf, accent: 0x4f6f6a, chrome: 0xd4d6d8,
};

/** Pseudoaleatorio estable: los detalles salen igual cada vez. */
function rnd(i: number): number {
  const x = Math.sin(i * 91.7) * 24634.6345;
  return x - Math.floor(x);
}

/**
 * Marco local de un mueble con la espalda a una pared: u recorre la pared,
 * v se aleja de ella. W es el ancho (en u) y D el fondo (en v). `gap` es la
 * separación entre la espalda del mueble y la pared.
 */
interface Frame {
  W: number; D: number; gap: number;
  box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, m: any, cast?: boolean): void;
  rbox(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, r: number, m: any): void;
  cyl(u: number, v: number, z0: number, z1: number, ru: number, rv: number, m: any, top?: number): void;
}

/**
 * `wide`: la espalda va en un lado largo (armarios, aparadores).
 * `long`: la espalda va en un lado corto (camas, bañeras).
 * Si el modelo indica `heading`, se respeta.
 */
function frame(B: Builder, f: Furniture, prefer?: "wide" | "long"): Frame {
  const { x, y, w, d } = f;
  const mid = (h: number): Pt => h === 0 ? [x + w / 2, y] : h === 90 ? [x, y + d / 2] : h === 180 ? [x + w / 2, y + d] : [x + w, y + d / 2];
  const near = (h: number) => B.nearWall(...mid(h));
  const sides = [0, 90, 180, 270].filter(h => {
    if (!prefer) return true;
    const along = h % 180 === 0 ? w : d, deep = h % 180 === 0 ? d : w;
    return prefer === "wide" ? along >= deep : deep >= along;
  });
  // a igual cercanía a una pared, la espalda queda frente al lado más despejado
  const h = f.heading ?? [...sides].sort((a, b) => {
    const diff = near(a) - near(b);
    return Math.abs(diff) > 0.06 ? diff : near((b + 180) % 360) - near((a + 180) % 360);
  })[0];
  const sideways = h % 180 !== 0;
  const pt = (u: number, v: number): Pt =>
    h === 0 ? [x + u, y + v] : h === 90 ? [x + v, y + u] : h === 180 ? [x + u, y + d - v] : [x + w - v, y + u];
  return {
    W: sideways ? d : w, D: sideways ? w : d, gap: near(h),
    box: (u0, v0, u1, v1, z0, z1, m, cast) => {
      const a = pt(u0, v0), b = pt(u1, v1);
      B.box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), z0, z1, m, cast);
    },
    rbox: (u0, v0, u1, v1, z0, z1, r, m) => {
      const a = pt(u0, v0), b = pt(u1, v1);
      B.rbox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), z0, z1, r, m);
    },
    cyl: (u, v, z0, z1, ru, rv, m, top) => {
      const c = pt(u, v);
      B.cyl(c[0], c[1], z0, z1, sideways ? rv : ru, sideways ? ru : rv, m, top);
    },
  };
}

function metal(B: Builder) { return B.mat(C.chrome, { metalness: 0.85, roughness: 0.25 }); }

/** Fila de puertas sobre la cara v, con tirador vertical junto a la junta. */
function doors(B: Builder, F: Frame, u0: number, u1: number, v: number, z0: number, z1: number, n: number, m: any) {
  const du = (u1 - u0) / n, grip = metal(B), hz = Math.min(z0 + (z1 - z0) * 0.55, 1.15), hh = Math.min((z1 - z0) * 0.14, 0.12);
  for (let i = 0; i < n; i++) {
    const a = u0 + i * du, b = a + du;
    F.box(a + 0.004, v, b - 0.004, v + 0.018, z0, z1, m);
    const hu = i % 2 === 0 && i + 1 < n ? b - 0.035 : a + 0.035;
    F.box(hu - 0.006, v + 0.018, hu + 0.006, v + 0.032, hz - hh, hz + hh, grip);
  }
}

/** Fila de cajones sobre la cara v, con tirador horizontal. */
function drawers(B: Builder, F: Frame, u0: number, u1: number, v: number, z0: number, z1: number, n: number, m: any) {
  const dz = (z1 - z0) / n, grip = metal(B), c = (u0 + u1) / 2, half = Math.min((u1 - u0) * 0.22, 0.1);
  for (let i = 0; i < n; i++) {
    const a = z0 + i * dz, b = a + dz;
    F.box(u0 + 0.004, v, u1 - 0.004, v + 0.018, a + 0.004, b - 0.004, m);
    F.box(c - half, v + 0.018, c + half, v + 0.03, (a + b) / 2 - 0.006, (a + b) / 2 + 0.006, grip);
  }
}

/** Grifo: columna y caño hacia +v. */
function faucet(B: Builder, F: Frame, u: number, v: number, z: number, reach = 0.12) {
  const m = metal(B);
  F.cyl(u, v, z, z + 0.17, 0.012, 0.012, m);
  F.box(u - 0.01, v, u + 0.01, v + reach, z + 0.15, z + 0.17, m);
}

function chair(B: Builder, x: number, y: number, dir: 0 | 1 | 2 | 3) {
  const s = 0.42, leg = B.mat(C.dark, { roughness: 0.6 }), seat = B.mat(C.fabricD);
  B.box(x - s / 2, y - s / 2, x + s / 2, y + s / 2, 0.43, 0.48, seat);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = x + (a * s) / 2.4, cy = y + (b * s) / 2.4;
    B.box(cx - 0.015, cy - 0.015, cx + 0.015, cy + 0.015, 0, 0.43, leg);
  }
  const backs: [number, number, number, number][] = [
    [x - s / 2, y - s / 2, x + s / 2, y - s / 2 + 0.04], [x - s / 2, y + s / 2 - 0.04, x + s / 2, y + s / 2],
    [x - s / 2, y - s / 2, x - s / 2 + 0.04, y + s / 2], [x + s / 2 - 0.04, y - s / 2, x + s / 2, y + s / 2],
  ];
  const k = backs[dir];
  B.box(k[0], k[1], k[2], k[3], 0.48, 0.9, seat);
}

function table(B: Builder, f: Furniture, withChairs: boolean) {
  const { x, y, w, d } = f, h = f.h ?? 0.75;
  const top = B.mat(C.wood), leg = B.mat(C.woodD);
  B.box(x, y, x + w, y + d, h - 0.04, h, top);
  const L = 0.05;
  for (const [a, b] of [[x + 0.03, y + 0.03], [x + w - 0.03 - L, y + 0.03], [x + 0.03, y + d - 0.03 - L], [x + w - 0.03 - L, y + d - 0.03 - L]])
    B.box(a, b, a + L, b + L, 0, h - 0.04, leg);
  if (!withChairs) return;
  const put = (cx: number, cy: number, dir: 0 | 1 | 2 | 3) => { if (B.free(cx, cy, 0.24)) chair(B, cx, cy, dir); };
  if (w >= d) {
    const n = w > 1.0 ? 2 : 1;
    for (let i = 0; i < n; i++) { const cx = x + (w * (i + 0.5)) / n; put(cx, y - 0.25, 0); put(cx, y + d + 0.25, 1); }
  } else {
    const n = d > 1.0 ? 2 : 1;
    for (let i = 0; i < n; i++) { const cy = y + (d * (i + 0.5)) / n; put(x - 0.25, cy, 2); put(x + w + 0.25, cy, 3); }
  }
}

function desk(B: Builder, f: Furniture) {
  const { x, y, w, d } = f;
  const top = B.mat(C.light), leg = B.mat(0x9a9a9a, { metalness: 0.4, roughness: 0.4 });
  B.box(x, y, x + w, y + d, 0.71, 0.75, top);
  const L = 0.04;
  for (const [a, b] of [[x + 0.03, y + 0.03], [x + w - 0.03 - L, y + 0.03], [x + 0.03, y + d - 0.03 - L], [x + w - 0.03 - L, y + d - 0.03 - L]])
    B.box(a, b, a + L, b + L, 0, 0.71, leg);
  const cx = x + w / 2, cy = y + d / 2;
  if (w >= d) B.nearWall(cx, y) < B.nearWall(cx, y + d) ? chair(B, cx, y + d + 0.3, 1) : chair(B, cx, y - 0.3, 0);
  else B.nearWall(x, cy) < B.nearWall(x + w, cy) ? chair(B, x + w + 0.3, cy, 3) : chair(B, x - 0.3, cy, 2);
}

function bed(B: Builder, f: Furniture) {
  const F = frame(B, f, "long"), { W, D } = F;
  const head = B.mat(0x6b5642, { roughness: 0.9 }), base = B.mat(0x7a6a58), leg = B.mat(C.woodD);
  const mattress = B.mat(C.bed, { roughness: 0.95 }), pillow = B.mat(0xfbfaf6, { roughness: 0.95 });
  const duvet = B.mat(C.duvet, { roughness: 1 }), fold = B.mat(0xf1eee6, { roughness: 1 }), throwM = B.mat(C.accent, { roughness: 1 });
  F.rbox(0, 0, W, 0.07, 0, 1.05, 0.025, head);
  F.box(0.02, 0.07, W - 0.02, D - 0.02, 0.16, 0.3, base);
  for (const [u, v] of [[0.06, 0.12], [W - 0.06, 0.12], [0.06, D - 0.07], [W - 0.06, D - 0.07]]) F.cyl(u, v, 0, 0.16, 0.025, 0.025, leg);
  F.rbox(0.03, 0.07, W - 0.03, D - 0.03, 0.3, 0.52, 0.05, mattress);
  // edredón con embozo y manta a los pies
  F.rbox(0, 0.68, W, D, 0.32, 0.56, 0.05, duvet);
  F.rbox(0, 0.62, W, 0.88, 0.5, 0.585, 0.03, fold);
  F.box(0, D - 0.58, W, D - 0.2, 0.555, 0.568, throwM);
  const n = W > 1.2 ? 2 : 1, pw = (W - 0.12) / n;
  for (let i = 0; i < n; i++) {
    const u = 0.06 + i * pw;
    F.rbox(u + 0.02, 0.1, u + pw - 0.02, 0.56, 0.52, 0.66, 0.06, pillow);
  }
}

function bunk(B: Builder, f: Furniture) {
  const { x, y, w, d } = f;
  const fr = B.mat(0xe8e4dc, { roughness: 0.5 }), mt = B.mat(C.bed, { roughness: 0.95 });
  for (const [a, b] of [[x, y], [x + w - 0.06, y], [x, y + d - 0.06], [x + w - 0.06, y + d - 0.06]]) B.box(a, b, a + 0.06, b + 0.06, 0, 1.85, fr);
  B.box(x, y, x + w, y + d, 0.22, 0.3, fr); B.rbox(x + 0.03, y + 0.03, x + w - 0.03, y + d - 0.03, 0.3, 0.46, 0.04, mt);
  B.box(x, y, x + w, y + d, 1.2, 1.28, fr); B.rbox(x + 0.03, y + 0.03, x + w - 0.03, y + d - 0.03, 1.28, 1.44, 0.04, mt);
}

function wardrobe(B: Builder, f: Furniture) {
  const F = frame(B, f, "wide"), { W, D } = F, H = f.h ?? 2.2;
  F.box(0, 0, W, D - 0.03, 0.08, H, B.mat(0xa58a66, { roughness: 0.7 }));
  F.box(0.01, 0, W - 0.01, D - 0.06, 0, 0.08, B.mat(C.woodD));
  doors(B, F, 0, W, D - 0.03, 0.09, H - 0.01, Math.max(1, Math.round(W / 0.55)), B.mat(C.wardrobe, { roughness: 0.6 }));
}

/** Mueble bajo con puertas: aparador, mueble auxiliar. */
function lowCabinet(B: Builder, f: Furniture, h: number) {
  const F = frame(B, f, "wide"), { W, D } = F, body = B.mat(0x5a4a3c), front = B.mat(0x6b5847, { roughness: 0.6 });
  F.box(0, 0, W, D - 0.03, 0.1, h - 0.03, body);
  F.box(-0.005, 0, W + 0.005, D, h - 0.03, h, B.mat(0x4a3c30, { roughness: 0.5 }));
  for (const [u, v] of [[0.05, 0.05], [W - 0.05, 0.05], [0.05, D - 0.07], [W - 0.05, D - 0.07]]) F.cyl(u, v, 0, 0.1, 0.018, 0.018, B.mat(C.dark));
  doors(B, F, 0, W, D - 0.03, 0.11, h - 0.04, Math.max(1, Math.round(W / 0.5)), front);
}

function nightstand(B: Builder, f: Furniture) {
  const F = frame(B, f), { W, D } = F, h = f.h ?? 0.5;
  F.box(0, 0, W, D - 0.03, 0.1, h, B.mat(0x5a4a3c));
  for (const [u, v] of [[0.04, 0.04], [W - 0.04, 0.04], [0.04, D - 0.07], [W - 0.04, D - 0.07]]) F.cyl(u, v, 0, 0.1, 0.015, 0.015, B.mat(C.dark));
  drawers(B, F, 0, W, D - 0.03, 0.11, h - 0.01, 2, B.mat(0x6b5847, { roughness: 0.6 }));
}

function shelf(B: Builder, f: Furniture) {
  const F = frame(B, f, "wide"), { W, D } = F, H = f.h ?? 1.9, m = B.mat(0xf0ece4), t = 0.025;
  F.box(0, 0, W, 0.012, 0, H, B.mat(0xe2ddd2));
  F.box(0, 0, t, D, 0, H, m); F.box(W - t, 0, W, D, 0, H, m);
  const n = Math.max(2, Math.round(H / 0.38));
  const tints = [0x8a4b3a, 0x3f5d6b, 0xc2a35a, 0x5d6b4a, 0xd8d2c6, 0x704f6b];
  for (let i = 0; i <= n; i++) {
    const z = i === n ? H - t : (i * (H - t)) / n;
    F.box(t, 0, W - t, D, z, z + t, m);
    if (i === n) break;
    // libros en parte de cada balda
    let u = t + 0.03 + rnd(i) * 0.15;
    const end = W - t - 0.05 - rnd(i + 9) * (W * 0.35);
    for (let k = 0; u < end; k++) {
      const bw = 0.025 + rnd(i * 7 + k) * 0.025, bh = Math.min(0.16 + rnd(i * 3 + k * 5) * 0.12, (H - t) / n - t - 0.02);
      F.box(u, 0.03, u + bw, Math.min(D - 0.03, 0.2), z + t, z + t + bh, B.mat(tints[(i + k * 3) % tints.length], { roughness: 0.8 }));
      u += bw + 0.002;
    }
  }
}

function fridge(B: Builder, f: Furniture) {
  const F = frame(B, f), { W, D } = F, H = f.h ?? 1.8, steel = B.mat(C.steel, { metalness: 0.55, roughness: 0.32 });
  F.box(0.005, 0, W - 0.005, D - 0.06, 0.03, H, B.mat(0x8f9396, { metalness: 0.3, roughness: 0.5 }));
  F.box(0.02, 0, W - 0.02, D - 0.08, 0, 0.03, B.mat(C.dark));
  F.box(0.01, D - 0.06, W - 0.01, D - 0.052, 0.04, H - 0.01, B.mat(C.dark));
  const grip = metal(B);
  if (W > 0.8) {
    // dos puertas verticales
    for (const [a, b, hu] of [[0.005, W / 2 - 0.003, W / 2 - 0.04], [W / 2 + 0.003, W - 0.005, W / 2 + 0.04]]) {
      F.box(a, D - 0.052, b, D - 0.012, 0.04, H, steel);
      F.box(hu - 0.008, D - 0.012, hu + 0.008, D, 0.75, 1.35, grip);
    }
  } else {
    // congelador abajo
    F.box(0.005, D - 0.052, W - 0.005, D - 0.012, 0.04, 0.6, steel);
    F.box(0.005, D - 0.052, W - 0.005, D - 0.012, 0.615, H, steel);
    F.box(0.04, D - 0.012, 0.056, D, 0.72, 1.2, grip);
    F.box(0.04, D - 0.012, 0.056, D, 0.3, 0.55, grip);
  }
}

function tv(B: Builder, f: Furniture) {
  const F = frame(B, f, "wide"), { W, D } = F, h = 0.46;
  F.rbox(0, 0.02, W, D - 0.03, 0.12, h, 0.012, B.mat(0x5b4636, { roughness: 0.6 }));
  for (const [u, v] of [[0.06, 0.07], [W - 0.06, 0.07], [0.06, D - 0.09], [W - 0.06, D - 0.09]]) F.cyl(u, v, 0, 0.12, 0.018, 0.018, B.mat(C.dark));
  doors(B, F, 0.005, W - 0.005, D - 0.03, 0.13, h - 0.01, Math.max(2, Math.round(W / 0.6)), B.mat(0x6a5342, { roughness: 0.55 }));
  const c = W / 2, half = Math.min(0.62, W / 2 - 0.02), v = D * 0.42;
  F.box(c - 0.16, v - 0.08, c + 0.16, v + 0.08, h, h + 0.012, B.mat(C.dark, { roughness: 0.4 }));
  F.box(c - 0.03, v - 0.015, c + 0.03, v + 0.015, h + 0.012, 0.56, B.mat(C.dark, { roughness: 0.4 }));
  F.box(c - half, v - 0.022, c + half, v + 0.012, 0.54, 1.24, B.mat(0x151515, { roughness: 0.4 }));
  F.box(c - half + 0.012, v + 0.012, c + half - 0.012, v + 0.016, 0.552, 1.228, B.mat(0x07090c, { roughness: 0.08, metalness: 0.2 }), false);
}

function sink(B: Builder, f: Furniture) {
  const F = frame(B, f, "wide"), { W, D, gap } = F, white = B.mat(C.white, { roughness: 0.18 });
  F.box(0.01, 0, W - 0.01, D - 0.04, 0.14, 0.8, B.mat(0x4a2f22));
  F.box(0.03, 0, W - 0.03, D - 0.07, 0, 0.14, B.mat(C.dark));
  doors(B, F, 0.01, W - 0.01, D - 0.04, 0.15, 0.79, W > 0.6 ? 2 : 1, B.mat(0x5a3a2a, { roughness: 0.5 }));
  F.rbox(0, 0, W, D, 0.8, 0.84, 0.012, white);
  const c = W / 2, ru = Math.min(W * 0.36, 0.26), rv = D * 0.34, v = D * 0.56;
  F.cyl(c, v, 0.84, 0.862, ru, rv, white);
  F.cyl(c, v, 0.862, 0.864, ru * 0.84, rv * 0.82, B.mat(0xc9cfd2, { roughness: 0.2 }), 1);
  faucet(B, F, c, 0.05, 0.84, 0.09);
  // espejo sobre el lavabo, en la pared
  if (gap < 0.3) {
    F.box(W * 0.08, -gap, W * 0.92, -gap + 0.015, 1.05, 1.85, B.mat(0xdfe6ea, { metalness: 1, roughness: 0.06, envMapIntensity: 1.2 }), false);
    F.box(W * 0.08 - 0.012, -gap, W * 0.92 + 0.012, -gap + 0.01, 1.04, 1.86, B.mat(C.dark, { roughness: 0.5 }), false);
  }
}

function wc(B: Builder, f: Furniture) {
  const F = frame(B, f), { W, D } = F, white = B.mat(C.white, { roughness: 0.15 });
  const c = W / 2, ru = Math.min(W / 2 - 0.02, 0.18), rv = Math.min((D - 0.17) / 2 + 0.05, 0.25), v = D - rv;
  F.rbox(c - 0.18, 0, c + 0.18, 0.17, 0.36, 0.78, 0.025, white);
  F.cyl(c, 0.085, 0.78, 0.79, 0.035, 0.035, metal(B));
  F.box(c - 0.09, 0.02, c + 0.09, Math.min(v, 0.26), 0, 0.36, white);
  F.cyl(c, v, 0, 0.2, ru * 0.62, rv * 0.62, white, 1.35);
  F.cyl(c, v, 0.2, 0.38, ru * 0.84, rv * 0.84, white, 1.18);
  F.cyl(c, v, 0.38, 0.425, ru, rv, B.mat(0xfbfbf9, { roughness: 0.25 }));
}

function bidet(B: Builder, f: Furniture) {
  const F = frame(B, f), { W, D } = F, white = B.mat(C.white, { roughness: 0.15 });
  const c = W / 2, ru = Math.min(W / 2 - 0.01, 0.18), rv = D / 2 - 0.01, v = D / 2;
  F.cyl(c, v, 0, 0.22, ru * 0.62, rv * 0.62, white, 1.35);
  F.cyl(c, v, 0.22, 0.4, ru * 0.84, rv * 0.84, white, 1.18);
  F.cyl(c, v, 0.4, 0.402, ru * 0.72, rv * 0.72, B.mat(0xc9cfd2, { roughness: 0.2 }));
  faucet(B, F, c, 0.05, 0.4, 0.07);
}

function bathtub(B: Builder, f: Furniture) {
  const F = frame(B, f, "long"), { W, D } = F, t = 0.07;
  const shell = B.mat(C.white, { roughness: 0.15 }), inner = B.mat(0xe6edf0, { roughness: 0.12 });
  // laterales y fondo: la bañera es hueca
  F.box(0, 0, W, t, 0, 0.5, shell); F.box(0, D - t, W, D, 0, 0.5, shell);
  F.box(0, t, t, D - t, 0, 0.5, shell); F.box(W - t, t, W, D - t, 0, 0.5, shell);
  F.box(t, t, W - t, D - t, 0, 0.2, inner);
  // borde redondeado
  for (const [a, b, c, d] of [[0, 0, W, t], [0, D - t, W, D], [0, t, t, D - t], [W - t, t, W, D - t]]) F.rbox(a, b, c, d, 0.5, 0.56, 0.02, shell);
  faucet(B, F, W / 2, 0.035, 0.56, 0.13);
}

function shower(B: Builder, f: Furniture) {
  const { x, y, w, d } = f, g = B.glass(), m = metal(B), white = B.mat(C.white, { roughness: 0.3 });
  const cx = x + w / 2, cy = y + d / 2;
  B.rbox(x, y, x + w, y + d, 0, 0.05, 0.015, white);
  B.cyl(cx, cy, 0.05, 0.053, 0.045, 0.045, B.mat(0x8f9396, { metalness: 0.7, roughness: 0.4 }));
  // mampara en los lados sin pared
  const edges: { a: Pt; b: Pt }[] = [
    { a: [x, y], b: [x + w, y] }, { a: [x + w, y], b: [x + w, y + d] },
    { a: [x + w, y + d], b: [x, y + d] }, { a: [x, y + d], b: [x, y] },
  ];
  let wall: Pt | null = null;
  for (const { a, b } of edges) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (B.nearWall(mx, my) < 0.12) { wall = wall ?? [mx, my]; continue; }
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const ex = x0 === x1 ? 0.01 : 0, ey = y0 === y1 ? 0.01 : 0;
    B.box(x0 - ex, y0 - ey, x1 + ex, y1 + ey, 0.05, 2.0, g, false);
    B.box(x0 - ex * 1.5, y0 - ey * 1.5, x1 + ex * 1.5, y1 + ey * 1.5, 1.985, 2.0, m);
  }
  // columna de ducha y rociador, hacia el centro del plato
  if (wall) {
    const dx = Math.sign(cx - wall[0]) * (Math.abs(cx - wall[0]) > 0.01 ? 1 : 0), dy = Math.sign(cy - wall[1]) * (Math.abs(cy - wall[1]) > 0.01 ? 1 : 0);
    const px = wall[0] + dx * 0.03, py = wall[1] + dy * 0.03;
    B.cyl(px, py, 0.95, 2.08, 0.012, 0.012, m);
    B.box(Math.min(px, px + dx * 0.22) - 0.008, Math.min(py, py + dy * 0.22) - 0.008, Math.max(px, px + dx * 0.22) + 0.008, Math.max(py, py + dy * 0.22) + 0.008, 2.07, 2.085, m);
    B.cyl(px + dx * 0.24, py + dy * 0.24, 2.05, 2.07, 0.1, 0.1, m);
    B.box(px - 0.03, py - 0.03, px + 0.03, py + 0.03, 1.05, 1.13, m);
  }
}

// ---------- piezas en L o a medida ----------

interface Edge { a: Pt; b: Pt; L: number; n: Pt /* normal hacia dentro */; depth: number }

function edgesOf(pts: Pt[]): (Edge & { i: number })[] {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let n: Pt = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    if (!pointInPolygon(mx + n[0] * 0.02, my + n[1] * 0.02, pts)) n = [-n[0], -n[1]];
    // fondo de la pieza en este borde
    let depth = 0.02;
    while (depth < 3 && pointInPolygon(mx + n[0] * (depth + 0.02), my + n[1] * (depth + 0.02), pts)) depth += 0.02;
    return { a, b, L, n, depth, i };
  });
}

/** Tramo rectangular de un borde recto: t recorre el borde, s entra en la pieza. */
function band(e: Edge, t0: number, t1: number, s0: number, s1: number): [number, number, number, number] {
  const ux = (e.b[0] - e.a[0]) / e.L, uy = (e.b[1] - e.a[1]) / e.L;
  const xs = [t0, t1].flatMap(t => [s0, s1].map(s => e.a[0] + ux * t + e.n[0] * s));
  const ys = [t0, t1].flatMap(t => [s0, s1].map(s => e.a[1] + uy * t + e.n[1] * s));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Vértices entrantes del polígono: separan los bordes interiores de una L. */
function reflexSet(pts: Pt[]): Set<number> {
  let area = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; });
  const out = new Set<number>();
  pts.forEach((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
    const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
    if (cross * area < 0) out.add(i);
  });
  return out;
}

function sofa(B: Builder, f: Furniture) {
  const { x, y, w, d } = f;
  const pts: Pt[] = f.polygon ?? [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  const fabric = B.mat(C.fabric, { roughness: 1 }), back = B.mat(C.fabricD, { roughness: 1 }), seat = B.mat(0x9a938a, { roughness: 1 }), accent = B.mat(C.accent, { roughness: 1 });
  B.extrude(pts, 0.08, B.mat(C.dark, { roughness: 0.7 }));
  B.extrude(pts, 0.25, fabric, 0.08);

  const edges = edgesOf(pts), reflex = reflexSet(pts);
  const outer = edges.filter(e => !reflex.has(e.i) && !reflex.has((e.i + 1) % pts.length));
  let backs: typeof outer, arms: typeof outer;
  if (reflex.size) {
    // en L: los dos bordes exteriores largos son el respaldo; los extremos, los brazos
    const sorted = [...outer].sort((m, n) => n.L - m.L);
    backs = sorted.slice(0, 2); arms = sorted.slice(2);
  } else {
    const nearest = [...outer].sort((m, n) => B.nearWall((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2) - B.nearWall((n.a[0] + n.b[0]) / 2, (n.a[1] + n.b[1]) / 2))[0];
    backs = [nearest];
    arms = outer.filter(e => e.L < nearest.L && e !== nearest && (e.i + 2) % 4 !== nearest.i);
  }
  for (const e of backs) {
    const [x0, y0, x1, y1] = band(e, 0, e.L, 0, 0.13);
    B.rbox(x0, y0, x1, y1, 0.33, 0.74, 0.03, back);
    const n = Math.max(1, Math.round(e.L / 0.8)), step = e.L / n;
    for (let i = 0; i < n; i++) {
      // asiento y respaldo por plazas
      const s = band(e, i * step + 0.01, (i + 1) * step - 0.01, 0.1, e.depth - 0.01);
      B.rbox(s[0], s[1], s[2], s[3], 0.33, 0.47, 0.045, seat);
      const r = band(e, i * step + 0.02, (i + 1) * step - 0.02, 0.11, 0.3);
      B.rbox(r[0], r[1], r[2], r[3], 0.46, 0.8, 0.07, back);
    }
    // cojín decorativo en el extremo
    const p = band(e, e.L - 0.56, e.L - 0.16, 0.3, 0.42);
    B.rbox(p[0], p[1], p[2], p[3], 0.47, 0.82, 0.05, accent);
  }
  for (const e of arms) {
    const [x0, y0, x1, y1] = band(e, 0, e.L, 0, 0.14);
    B.rbox(x0, y0, x1, y1, 0.33, 0.6, 0.05, fabric);
  }
}

function kitchen(B: Builder, f: Furniture, windowsOnLine: (a: Pt, b: Pt) => boolean) {
  const { x, y, w, d } = f;
  const pts: Pt[] = f.polygon ?? [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  const cab = B.mat(C.cab, { roughness: 0.5 }), front = B.mat(0x9a4428, { roughness: 0.42 }), upper = B.mat(C.cabTop, { roughness: 0.3 });
  const counter = B.mat(C.granite, { roughness: 0.28 }), grip = metal(B);
  B.extrude(pts, 0.1, B.mat(C.dark, { roughness: 0.7 }));
  B.extrude(pts, 0.76, cab, 0.1);
  B.extrude(pts, 0.04, counter, 0.86);

  const edges = edgesOf(pts);
  const onWall = (e: Edge) => B.nearWall((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2) < 0.1;
  const inner = edges.filter(e => !onWall(e));

  // puertas bajas en las caras vistas: sobresalen de la pieza hacia el paso
  for (const e of inner) {
    const n = Math.max(1, Math.round(e.L / 0.6)), step = e.L / n;
    for (let i = 0; i < n; i++) {
      const p = band(e, i * step + 0.004, (i + 1) * step - 0.004, -0.018, 0);
      B.box(p[0], p[1], p[2], p[3], 0.11, 0.85, front);
      const g = band(e, (i + 0.5) * step - 0.08, (i + 0.5) * step + 0.08, -0.03, -0.018);
      B.box(g[0], g[1], g[2], g[3], 0.78, 0.795, grip);
    }
  }

  // frente de pared y muebles altos
  for (const e of edges.filter(onWall)) {
    if (e.L < 0.9) continue;
    const s = band(e, 0, e.L, 0, 0.012);
    B.box(s[0], s[1], s[2], s[3], 0.9, 1.45, B.mat(0xe9e4da, { roughness: 0.3 }));
    if (windowsOnLine(e.a, e.b)) continue;
    const u = band(e, 0, e.L, 0, 0.33);
    B.box(u[0], u[1], u[2], u[3], 1.45, 2.15, upper);
    const n = Math.max(1, Math.round(e.L / 0.6)), step = e.L / n;
    for (let i = 0; i < n; i++) {
      const p = band(e, i * step + 0.004, (i + 1) * step - 0.004, 0.33, 0.348);
      B.box(p[0], p[1], p[2], p[3], 1.455, 2.145, B.mat(0xf7f5ef, { roughness: 0.25 }));
      const g = band(e, (i + 0.5) * step - 0.06, (i + 0.5) * step + 0.06, 0.348, 0.358);
      B.box(g[0], g[1], g[2], g[3], 1.49, 1.502, grip);
    }
  }

  // fregadero y placa en el tramo visto más largo; se miden desde el canto hacia la pared
  const run = [...inner].sort((m, n) => n.L - m.L)[0];
  if (!run || run.depth < 0.45) return;
  const steel = B.mat(C.steel, { metalness: 0.8, roughness: 0.3 });
  const sinkAt = run.L * 0.3, hobAt = run.L * 0.62;
  const s = band(run, sinkAt - 0.3, sinkAt + 0.3, 0.08, 0.52);
  B.box(s[0], s[1], s[2], s[3], 0.9, 0.904, steel);
  const bowl = band(run, sinkAt - 0.22, sinkAt + 0.22, 0.12, 0.46);
  B.box(bowl[0], bowl[1], bowl[2], bowl[3], 0.904, 0.906, B.mat(0x7f8487, { metalness: 0.6, roughness: 0.4 }));
  const tap = band(run, sinkAt - 0.012, sinkAt + 0.012, 0.5, 0.524);
  B.cyl((tap[0] + tap[2]) / 2, (tap[1] + tap[3]) / 2, 0.904, 1.16, 0.012, 0.012, grip);
  const spout = band(run, sinkAt - 0.01, sinkAt + 0.01, 0.34, 0.52);
  B.box(spout[0], spout[1], spout[2], spout[3], 1.14, 1.16, grip);

  const hob = band(run, hobAt - 0.3, hobAt + 0.3, 0.06, 0.54);
  B.box(hob[0], hob[1], hob[2], hob[3], 0.9, 0.906, B.mat(0x0c0c0e, { roughness: 0.12 }));
  const ring = B.mat(0x34363a, { roughness: 0.35 });
  for (const [ta, sa] of [[-0.15, 0.18], [0.15, 0.18], [-0.15, 0.42], [0.15, 0.42]]) {
    const q = band(run, hobAt + ta, hobAt + ta, 0.06 + sa, 0.06 + sa);
    B.cyl(q[0], q[1], 0.906, 0.908, 0.085, 0.085, ring);
  }
  // campana en la pared del fondo
  const far = run.depth;
  const hood = band(run, hobAt - 0.3, hobAt + 0.3, far - 0.48, far);
  B.box(hood[0], hood[1], hood[2], hood[3], 1.62, 1.72, steel);
  const flue = band(run, hobAt - 0.13, hobAt + 0.13, far - 0.26, far);
  B.box(flue[0], flue[1], flue[2], flue[3], 1.72, 2.3, steel);
}

/** Tramo de escalera: sube alejándose de la pared de la espalda. */
function stairs(B: Builder, f: Furniture) {
  const F = frame(B, f, "long"), { W, D } = F, tread = B.mat(0xd8cfbf, { roughness: 0.6 }), riser = B.mat(0xf1eee6);
  const n = Math.max(3, Math.round(D / 0.27)), run = D / n, rise = 0.18;
  for (let i = 0; i < n; i++) {
    const z = (i + 1) * rise;
    F.box(0, i * run, W, (i + 1) * run, z - rise, z - 0.03, riser);
    F.box(0, i * run - 0.015, W, (i + 1) * run, z - 0.03, z, tread);
  }
  // barandilla de vidrio con pasamanos
  const top = n * rise + 0.9;
  F.box(W - 0.015, 0, W, D, 0.05, top, B.glass(), false);
  F.box(W - 0.025, 0, W + 0.01, D, top, top + 0.03, metal(B));
}

function island(B: Builder, f: Furniture) {
  const F = frame(B, f, "wide"), { W, D } = F;
  F.box(0.02, 0.02, W - 0.02, D - 0.02, 0, 0.1, B.mat(C.dark, { roughness: 0.7 }));
  F.box(0, 0, W, D - 0.02, 0.1, 0.86, B.mat(C.cab, { roughness: 0.5 }));
  doors(B, F, 0, W, D - 0.02, 0.11, 0.85, Math.max(1, Math.round(W / 0.6)), B.mat(0x9a4428, { roughness: 0.42 }));
  F.box(-0.03, -0.03, W + 0.03, D + 0.03, 0.86, 0.9, B.mat(C.granite, { roughness: 0.3 }));
}

export function buildFurniture(B: Builder, f: Furniture, windowsOnLine: (a: Pt, b: Pt) => boolean) {
  const { x, y, w, d } = f;
  switch (f.type) {
    case "bed": return bed(B, f);
    case "bunk": return bunk(B, f);
    case "sofa": return sofa(B, f);
    case "kitchen": return kitchen(B, f, windowsOnLine);
    case "island": return island(B, f);
    case "table": return table(B, f, true);
    case "desk": return desk(B, f);
    case "chair": return chair(B, x + w / 2, y + d / 2, 0);
    case "wardrobe": return wardrobe(B, f);
    case "nightstand": return nightstand(B, f);
    case "sideboard": case "cabinet": return lowCabinet(B, f, f.h ?? 0.85);
    case "shelf": return shelf(B, f);
    case "tv": return tv(B, f);
    case "fridge": return fridge(B, f);
    case "sink": return sink(B, f);
    case "wc": return wc(B, f);
    case "bidet": return bidet(B, f);
    case "bathtub": return bathtub(B, f);
    case "shower": return shower(B, f);
    case "stairs": return stairs(B, f);
    default: B.box(x, y, x + w, y + d, 0, f.h ?? 0.8, B.mat(0xd9cfbf));
  }
}
