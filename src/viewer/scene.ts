import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Floor, Furniture, Opening, Pt, Room } from "../model/types";
import { distToSegment, floorBounds, fmt, pointInPolygon, roomArea, roomLabelPoint, splitWall } from "../model/geometry";
import { floorTextures } from "./textures";
import { buildFurniture, type Builder } from "./furniture";
import { ENV_INTENSITY, fitModel, furnitureHeading, loadModel } from "./models";

export type ViewMode = "maqueta" | "recorrido";
export type MoveKey = "f" | "b" | "l" | "r" | "sl" | "sr";
/** "alto": sombras y luces por estancia. "ligero": para móviles modestos. */
export type Detail = "alto" | "ligero";

interface Seg { a: Pt; b: Pt; t: number }

export interface SceneCallbacks {
  onRoomChange?: (name: string) => void;
  /** Convierte la ruta de un archivo del modelo en una dirección descargable. */
  resolve?: (src: string) => string;
}

const EYE = 1.6, RADIUS = 0.22;
const SKY = 0xdbe9f4;

// Los colores del modelo y los glTF están en sRGB.
THREE.ColorManagement.enabled = true;

/** Móvil o equipo con pocos núcleos: se empieza en detalle ligero. */
export function defaultDetail(): Detail {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  return coarse || (navigator.hardwareConcurrency ?? 8) <= 4 ? "ligero" : "alto";
}

/**
 * Visor 3D de una planta: maqueta con paredes cortadas y recorrido en
 * primera persona con colisiones. No depende de React.
 */
export class UmbralScene {
  private renderer: any;
  private scene: any;
  private camera: any;
  private controls: any;
  private hemi: any;
  private sun: any;
  private group: any;
  private mats = new Map<string, any>();
  private floor!: Floor;
  private cx = 0;
  private cy = 0;
  private solids: Seg[] = [];
  private blockers: Seg[] = [];
  private mode: ViewMode = "maqueta";
  private wallHeight = 1.1;
  private showLabels = true;
  private labelEls: { el: HTMLDivElement; x: number; y: number }[] = [];
  private walker = { x: 0, y: 0, yaw: 0, pitch: -0.05 };
  private keys: Partial<Record<MoveKey, boolean>> = {};
  private drag: { x: number; y: number } | null = null;
  private raf = 0;
  private last = performance.now();
  private roomTimer = 0;
  private lastRoom = "";
  private ro: ResizeObserver;
  private minimap: HTMLCanvasElement | null = null;
  private detail: Detail = "alto";
  private background = new THREE.Color(0x000000);
  private buildId = 0;

  constructor(private host: HTMLElement, private labelLayer: HTMLElement, private cb: SceneCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // la vivienda no se mueve: las sombras solo se recalculan al reconstruirla
    this.renderer.shadowMap.autoUpdate = false;
    host.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 40;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb9b1a3, 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6ea, 0.7);
    this.sun.position.set(6, 14, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.group = new THREE.Group();
    this.scene.add(this.group);

    const el = this.renderer.domElement as HTMLCanvasElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.setDetail(defaultDetail());
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------- API pública ----------
  setBackground(css: string) {
    try { this.background.setStyle(css); } catch { /* color no válido */ }
    this.applyBackground();
  }

  setDetail(d: Detail) {
    this.detail = d;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, d === "alto" ? 2 : 1.25));
    this.sun.castShadow = d === "alto";
    this.resize();
    this.build();
  }

  setFloor(floor: Floor) {
    this.floor = floor;
    const b = floorBounds(floor);
    this.cx = (b.minX + b.maxX) / 2;
    this.cy = (b.minY + b.maxY) / 2;
    this.build();
    this.resetWalker();
    if (this.mode === "maqueta") this.setView("3d");
  }

  setMode(m: ViewMode) {
    this.mode = m;
    this.controls.enabled = m === "maqueta";
    this.camera.fov = m === "recorrido" ? 70 : 40;
    this.camera.updateProjectionMatrix();
    this.keys = {};
    if (m === "recorrido") this.resetWalker(); else this.setView("3d");
    this.build();
  }

  setWallHeight(h: number) { this.wallHeight = h; this.build(); }
  setLabels(on: boolean) { this.showLabels = on; this.labelLayer.hidden = !on || this.mode === "recorrido"; }
  setMinimap(c: HTMLCanvasElement | null) { this.minimap = c; }
  setKey(k: MoveKey, on: boolean) { this.keys[k] = on; }

  setView(v: "3d" | "top") {
    const b = floorBounds(this.floor);
    // en pantallas verticales hay que alejarse para que quepa a lo ancho
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) * Math.max(1, 1.1 / this.camera.aspect);
    if (v === "top") this.camera.position.set(0, span * 1.9, 0.01);
    else this.camera.position.set(span * 0.75, span * 1.0, span * 1.1);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.buildId++;
    this.clearGroup();
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- geometría ----------
  private P(x: number, y: number): [number, number] { return [x - this.cx, -(y - this.cy)]; }

  private mat(color: number, opts: Record<string, unknown> = {}) {
    const key = color + "|" + Object.keys(opts).map(k => k + ":" + String((opts[k] as any)?.uuid ?? opts[k])).join(",");
    let m = this.mats.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, envMapIntensity: ENV_INTENSITY, ...opts }); this.mats.set(key, m); }
    return m;
  }
  private glass() { return this.mat(0x9fd0ea, { transparent: true, opacity: 0.32, roughness: 0.25, metalness: 0.1 }); }

  private box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, mat: any, cast = true) {
    const w = Math.abs(x1 - x0), d = Math.abs(y1 - y0), h = z1 - z0;
    if (w <= 0.001 || d <= 0.001 || h <= 0.001) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const [px, pz] = this.P((x0 + x1) / 2, (y0 + y1) / 2);
    m.position.set(px, z0 + h / 2, pz);
    m.castShadow = cast; m.receiveShadow = true;
    this.group.add(m);
  }

  /** Caja orientada a lo largo del segmento a→b, con grosor t. */
  private segBox(a: Pt, b: Pt, z0: number, z1: number, mat: any, t = 0.11, extend = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) + 2 * extend, h = z1 - z0;
    if (L <= 0.001 || h <= 0.001) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, t), mat);
    const [px, pz] = this.P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    m.position.set(px, z0 + h / 2, pz);
    m.rotation.y = Math.atan2(dy, dx);
    m.castShadow = !mat.transparent; m.receiveShadow = true;
    this.group.add(m);
  }

  /** Caja de cantos redondeados en coordenadas de planta. */
  private rbox(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, r: number, mat: any) {
    const w = Math.abs(x1 - x0), d = Math.abs(y1 - y0), h = z1 - z0;
    if (w <= 0.001 || d <= 0.001 || h <= 0.001) return;
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, d / 2, h / 2)), mat);
    const [px, pz] = this.P((x0 + x1) / 2, (y0 + y1) / 2);
    m.position.set(px, z0 + h / 2, pz);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }

  /** Cilindro de planta elíptica; `top` es la proporción de la tapa superior respecto a la base. */
  private cyl(x: number, y: number, z0: number, z1: number, rx: number, ry: number, mat: any, top = 1) {
    const g = new THREE.CylinderGeometry(top, 1, z1 - z0, 20);
    g.scale(rx, 1, ry);
    const m = new THREE.Mesh(g, mat);
    const [px, pz] = this.P(x, y);
    m.position.set(px, (z0 + z1) / 2, pz);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }

  private shape(pts: Pt[]) {
    const s = new THREE.Shape();
    pts.forEach(([x, y], i) => { const [px, pz] = this.P(x, y); if (i) s.lineTo(px, -pz); else s.moveTo(px, -pz); });
    return s;
  }

  private extrude(pts: Pt[], h: number, mat: any, z0 = 0) {
    const g = new THREE.ExtrudeGeometry(this.shape(pts), { depth: h, bevelEnabled: false });
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2; m.position.y = z0;
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }

  private nearWall(x: number, y: number) {
    let best = 9;
    for (const s of this.solids) best = Math.min(best, Math.max(0, distToSegment(x, y, s.a, s.b).d - s.t / 2));
    return best;
  }
  private free(x: number, y: number, r: number) {
    return this.blockers.every(s => distToSegment(x, y, s.a, s.b).d - s.t / 2 >= r);
  }

  private clearGroup() {
    this.scene.remove(this.group);
    this.group.traverse((o: any) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    this.group = new THREE.Group();
    this.scene.add(this.group);
  }

  private applyBackground() {
    this.scene.background = this.mode === "recorrido" ? new THREE.Color(SKY) : this.background;
  }

  /** Sustituye la forma básica de un mueble por su glTF; si falla, la forma se queda. */
  private placeModel(it: Furniture, stand: any[], id: number) {
    loadModel(this.cb.resolve ? this.cb.resolve(it.model!) : it.model!).then(src => {
      if (id !== this.buildId) return;
      const [px, pz] = this.P(it.x + it.w / 2, it.y + it.d / 2);
      const heading = furnitureHeading(it, (x, y) => this.nearWall(x, y));
      this.group.add(fitModel(src, it, heading, px, pz));
      for (const o of stand) { this.group.remove(o); o.geometry?.dispose(); }
      this.renderer.shadowMap.needsUpdate = true;
    }).catch(err => console.warn(`Umbral: no se pudo cargar el modelo ${it.model}`, err));
  }

  private build() {
    if (!this.floor) return;
    this.clearGroup();
    const id = ++this.buildId;
    const f = this.floor, walk = this.mode === "recorrido";
    const H = walk ? f.height : Math.min(this.wallHeight, f.height);
    const tex = floorTextures();
    const wallM = this.mat(0xf6f4ef, { roughness: 0.95 }), skirt = this.mat(0xc9b9a3);
    const frame = this.mat(0xe8e8e6, { roughness: 0.4 }), jamb = this.mat(0xc58a4a, { roughness: 0.6 });

    // suelos
    for (const r of f.rooms) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(this.shape(r.polygon)), this.mat(0xffffff, { map: tex[r.finish] ?? tex.wood, roughness: r.finish === "wood" ? 0.6 : 0.4 }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.001; m.receiveShadow = true;
      this.group.add(m);
    }

    // paredes partidas por los huecos
    this.solids = []; this.blockers = [];
    const holes: [Pt, Pt][] = f.openings.map(o => [o.a, o.b]);
    const onWall = new Set<string>();
    for (const w of f.walls) {
      const { solid, cuts } = splitWall(w.a, w.b, holes);
      for (const [a, b] of solid) {
        this.segBox(a, b, 0, H, wallM, w.thickness, w.thickness / 2);
        this.segBox(a, b, 0, 0.07, skirt, w.thickness + 0.02, w.thickness / 2);
        this.solids.push({ a, b, t: w.thickness });
      }
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const at = (t: number): Pt => [w.a[0] + ux * t, w.a[1] + uy * t];
      for (const c of cuts) {
        const o = f.openings[c.index];
        onWall.add(o.id);
        this.buildOpening(o, at(c.t0), at(c.t1), w.thickness, H, { wallM, frame, jamb });
      }
    }
    // los huecos de ventana y la puerta de entrada bloquean el paso: no se sale del piso
    for (const o of f.openings) if (o.kind === "window" || o.kind === "balcony" || o.door?.entrance) this.blockers.push({ a: o.a, b: o.b, t: 0.11 });
    this.blockers.push(...this.solids);

    // hojas de puerta
    for (const o of f.openings) if (o.door && (walk || H >= 0.6)) this.buildDoorLeaf(o, H);

    // muebles
    const B: Builder = {
      box: (x0, y0, x1, y1, z0, z1, m, cast) => this.box(x0, y0, x1, y1, z0, z1, m, cast),
      rbox: (x0, y0, x1, y1, z0, z1, r, m) => this.rbox(x0, y0, x1, y1, z0, z1, r, m),
      cyl: (x, y, z0, z1, rx, ry, m, top) => this.cyl(x, y, z0, z1, rx, ry, m, top),
      extrude: (pts, h, m, z0) => this.extrude(pts, h, m, z0),
      mat: (c, o) => this.mat(c, o),
      glass: () => this.glass(),
      nearWall: (x, y) => this.nearWall(x, y),
      free: (x, y, r) => this.free(x, y, r),
    };
    const windowsOnLine = (a: Pt, b: Pt) => f.openings.some(o => o.kind !== "door" && o.kind !== "passage" &&
      distToSegment(o.a[0], o.a[1], a, b).d < 0.1 && distToSegment(o.b[0], o.b[1], a, b).d < 0.1);
    for (const it of f.furniture) {
      const from = this.group.children.length;
      buildFurniture(B, it, windowsOnLine);
      if (it.model) this.placeModel(it, this.group.children.slice(from), id);
    }

    // los muebles también cortan el paso; en la ducha sí se puede entrar
    for (const it of f.furniture) {
      if (it.type === "shower") continue;
      const { x, y, w, d } = it;
      const pts: Pt[] = it.polygon ?? [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
      pts.forEach((a, i) => this.blockers.push({ a, b: pts[(i + 1) % pts.length], t: 0 }));
    }

    // techo y luces interiores en el recorrido
    const rich = this.detail === "alto";
    if (walk) {
      for (const r of f.rooms) {
        if (r.outdoor) continue;
        const m = new THREE.Mesh(new THREE.ShapeGeometry(this.shape(r.polygon)), this.mat(0xfbfaf7, { side: THREE.DoubleSide, roughness: 1 }));
        m.rotation.x = -Math.PI / 2; m.position.y = f.height;
        m.castShadow = true;
        this.group.add(m);
        if (!rich) continue;
        const [lx, ly] = roomLabelPoint(r);
        const [px, pz] = this.P(lx, ly);
        const pl = new THREE.PointLight(0xfff1dc, 0.2, 6.5, 1.6);
        pl.position.set(px, f.height - 0.2, pz);
        this.group.add(pl);
      }
    }
    // el entorno ya aporta luz de relleno
    this.hemi.intensity = walk ? (rich ? 0.2 : 0.4) : 0.25;
    this.sun.intensity = walk ? 1.1 : 0.9;
    this.renderer.toneMappingExposure = walk ? 0.75 : 0.85;
    this.applyBackground();
    this.renderer.shadowMap.needsUpdate = true;

    this.buildLabels(f.rooms);
  }

  private buildOpening(o: Opening, a: Pt, b: Pt, t: number, H: number, m: { wallM: any; frame: any; jamb: any }) {
    if (o.kind === "door" || o.kind === "passage") {
      const head = o.head ?? 2.05;
      if (H > head) this.segBox(a, b, head, H, m.wallM, t);
      if (o.kind === "door" && H > 0.5) {
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
        const top = Math.min(head + 0.05, H);
        this.segBox([a[0] - ux * 0.05, a[1] - uy * 0.05], a, 0, top, m.jamb, t + 0.03);
        this.segBox(b, [b[0] + ux * 0.05, b[1] + uy * 0.05], 0, top, m.jamb, t + 0.03);
        if (H > head) this.segBox(a, b, head, head + 0.05, m.jamb, t + 0.03, 0.05);
      }
      return;
    }
    const sill = o.sill ?? (o.kind === "window" ? 0.9 : 0.02);
    const head = o.head ?? (o.kind === "window" ? 2.1 : 2.2);
    if (sill > 0.05) this.segBox(a, b, 0, Math.min(sill, H), m.wallM, t);
    if (H > head) this.segBox(a, b, head, H, m.wallM, t);
    if (H <= sill) return;
    const zt = Math.min(head, H);
    this.segBox(a, b, sill, zt, this.glass(), 0.02);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const p = (s: number): Pt => [a[0] + ux * s, a[1] + uy * s];
    this.segBox(a, p(0.05), sill, zt, m.frame, 0.08);
    this.segBox(p(L - 0.05), b, sill, zt, m.frame, 0.08);
    this.segBox(a, b, sill, sill + 0.05, m.frame, 0.08);
    if (H >= head) this.segBox(a, b, head - 0.05, head, m.frame, 0.08);
    const n = o.kind === "window" ? 2 : Math.max(2, Math.round(L / 0.8));
    for (let i = 1; i < n; i++) this.segBox(p((L * i) / n - 0.025), p((L * i) / n + 0.025), sill, zt, m.frame, 0.08);
    if (o.kind === "window") this.segBox(p(-0.05), p(L + 0.05), sill - 0.03, sill, this.mat(0xd8d2c6), 0.22);
  }

  private buildDoorLeaf(o: Opening, H: number) {
    const d = o.door!;
    const hh = Math.min(2.03, H);
    const mat = this.mat(d.entrance ? 0x8a5a2b : 0xc58a4a, { roughness: 0.55 });
    if (d.glazed) {
      this.segBox(d.hinge, d.openTo, 0, hh, this.glass(), 0.03);
      const dx = d.openTo[0] - d.hinge[0], dy = d.openTo[1] - d.hinge[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
      const p = (s: number): Pt => [d.hinge[0] + ux * s, d.hinge[1] + uy * s];
      this.segBox(d.hinge, p(0.1), 0, hh, mat, 0.045);
      this.segBox(p(L - 0.1), d.openTo, 0, hh, mat, 0.045);
      this.segBox(d.hinge, d.openTo, 0, 0.12, mat, 0.045);
      if (hh > 1.9) this.segBox(d.hinge, d.openTo, hh - 0.1, hh, mat, 0.045);
    } else {
      this.segBox(d.hinge, d.openTo, 0, hh, mat, 0.04);
    }
    if (hh > 1) {
      const dx = d.openTo[0] - d.hinge[0], dy = d.openTo[1] - d.hinge[1], L = Math.hypot(dx, dy);
      const k: Pt = [d.openTo[0] - (dx / L) * 0.08, d.openTo[1] - (dy / L) * 0.08];
      this.box(k[0] - 0.03, k[1] - 0.03, k[0] + 0.03, k[1] + 0.03, 0.95, 1.0, this.mat(0xc0c0c0, { metalness: 0.8, roughness: 0.3 }));
    }
  }

  private buildLabels(rooms: Room[]) {
    this.labelLayer.innerHTML = "";
    this.labelEls = rooms.map(r => {
      const el = document.createElement("div");
      el.className = "u-label";
      const area = roomArea(r);
      el.innerHTML = `<b></b><small>${r.measured === false ? "≈ " : ""}${fmt(area)} m²</small>`;
      (el.firstChild as HTMLElement).textContent = r.name;
      this.labelLayer.appendChild(el);
      const [x, y] = roomLabelPoint(r);
      return { el, x, y };
    });
    this.labelLayer.hidden = !this.showLabels || this.mode === "recorrido";
  }

  // ---------- recorrido ----------
  private resetWalker() {
    const e = this.floor?.entrance;
    if (e) Object.assign(this.walker, { x: e.x, y: e.y, yaw: (-e.heading * Math.PI) / 180, pitch: -0.05 });
    else { const b = floorBounds(this.floor); Object.assign(this.walker, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, yaw: 0, pitch: -0.05 }); }
  }

  private collide(nx: number, ny: number): [number, number] {
    for (let it = 0; it < 3; it++) {
      for (const s of this.blockers) {
        const { d, cx, cy } = distToSegment(nx, ny, s.a, s.b);
        const min = RADIUS + s.t / 2;
        if (d < min) {
          if (d < 1e-6) { nx += min; continue; }
          nx = cx + ((nx - cx) / d) * min;
          ny = cy + ((ny - cy) / d) * min;
        }
      }
    }
    return [nx, ny];
  }

  private stepWalker(dt: number) {
    const w = this.walker, k = this.keys, sp = 1.5 * dt, tr = 1.6 * dt;
    if (k.l) w.yaw += tr;
    if (k.r) w.yaw -= tr;
    const dx = -Math.sin(w.yaw), dy = Math.cos(w.yaw);
    let mx = 0, my = 0;
    if (k.f) { mx += dx; my += dy; }
    if (k.b) { mx -= dx; my -= dy; }
    if (k.sl) { mx -= dy; my += dx; }
    if (k.sr) { mx += dy; my -= dx; }
    const n = Math.hypot(mx, my);
    if (n > 0) {
      mx = (mx / n) * sp; my = (my / n) * sp;
      let [nx, ny] = this.collide(w.x + mx, w.y);
      [nx, ny] = this.collide(nx, ny + my);
      w.x = nx; w.y = ny;
    }
    const [px, pz] = this.P(w.x, w.y);
    this.camera.position.set(px, EYE, pz);
    this.camera.lookAt(px + dx * Math.cos(w.pitch), EYE + Math.sin(w.pitch), pz - dy * Math.cos(w.pitch));
  }

  private roomAt(x: number, y: number): string {
    for (const r of this.floor.rooms) if (pointInPolygon(x, y, r.polygon)) return r.name;
    return "";
  }

  private drawMinimap() {
    const c = this.minimap;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const W = c.width, H = c.height, b = floorBounds(this.floor);
    const s = Math.min((W - 12) / (b.maxX - b.minX), (H - 12) / (b.maxY - b.minY));
    const ox = 6 - b.minX * s + ((W - 12) - (b.maxX - b.minX) * s) / 2;
    const oy = H - 6 + b.minY * s - ((H - 12) - (b.maxY - b.minY) * s) / 2;
    const T = (x: number, y: number): [number, number] => [ox + x * s, oy - y * s];
    g.clearRect(0, 0, W, H);
    g.strokeStyle = getComputedStyle(c).color || "#222";
    g.lineWidth = 2.4;
    for (const w of this.solids) { g.beginPath(); g.moveTo(...T(w.a[0], w.a[1])); g.lineTo(...T(w.b[0], w.b[1])); g.stroke(); }
    const [px, py] = T(this.walker.x, this.walker.y);
    const dx = -Math.sin(this.walker.yaw), dy = Math.cos(this.walker.yaw), fov = 0.6, L = 28;
    g.fillStyle = "rgba(47,111,98,.25)";
    g.beginPath(); g.moveTo(px, py);
    g.lineTo(px + (dx * Math.cos(fov) - dy * Math.sin(fov)) * L, py - (dy * Math.cos(fov) + dx * Math.sin(fov)) * L);
    g.lineTo(px + (dx * Math.cos(-fov) - dy * Math.sin(-fov)) * L, py - (dy * Math.cos(-fov) + dx * Math.sin(-fov)) * L);
    g.closePath(); g.fill();
    g.fillStyle = "#2f6f62"; g.beginPath(); g.arc(px, py, 5, 0, 7); g.fill();
  }

  // ---------- eventos ----------
  private onDown = (e: PointerEvent) => {
    if (this.mode !== "recorrido") return;
    this.drag = { x: e.clientX, y: e.clientY };
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignorar */ }
  };
  private onMove = (e: PointerEvent) => {
    if (this.mode !== "recorrido" || !this.drag) return;
    this.walker.yaw -= (e.clientX - this.drag.x) * 0.006;
    this.walker.pitch = Math.max(-1.1, Math.min(1.1, this.walker.pitch - (e.clientY - this.drag.y) * 0.004));
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private onUp = () => { this.drag = null; };
  private static KEYMAP: Record<string, MoveKey> = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "sl", KeyD: "sr", ArrowLeft: "l", ArrowRight: "r", KeyQ: "l", KeyE: "r" };
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode !== "recorrido") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const k = UmbralScene.KEYMAP[e.code];
    if (k) { this.keys[k] = true; e.preventDefault(); }
  };
  private onKeyUp = (e: KeyboardEvent) => { const k = UmbralScene.KEYMAP[e.code]; if (k) this.keys[k] = false; };

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(r.height, 1);
    this.camera.updateProjectionMatrix();
  }

  private v = new THREE.Vector3();
  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.floor) {
      if (this.mode === "recorrido") {
        this.stepWalker(dt);
        this.drawMinimap();
        this.roomTimer -= dt;
        if (this.roomTimer <= 0) {
          this.roomTimer = 0.25;
          const name = this.roomAt(this.walker.x, this.walker.y);
          if (name !== this.lastRoom) { this.lastRoom = name; this.cb.onRoomChange?.(name); }
        }
      } else {
        this.controls.update();
      }
      this.renderer.render(this.scene, this.camera);
      if (this.mode === "maqueta" && this.showLabels) {
        const r = this.host.getBoundingClientRect();
        for (const l of this.labelEls) {
          const [px, pz] = this.P(l.x, l.y);
          this.v.set(px, Math.min(this.wallHeight, 1.1) + 0.15, pz).project(this.camera);
          l.el.style.left = ((this.v.x + 1) / 2) * r.width + "px";
          l.el.style.top = ((1 - this.v.y) / 2) * r.height + "px";
          l.el.style.display = this.v.z < 1 ? "" : "none";
        }
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
