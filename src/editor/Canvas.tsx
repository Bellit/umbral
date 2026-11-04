import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, type PointerEvent as RPointerEvent } from "react";
import type { Floor, Pt } from "../model/types";
import { fmt, polygonArea, roomArea, roomLabelPoint, splitWall } from "../model/geometry";
import { hitTest, snap, type Selection, type SnapKind } from "./ops";

export type Tool = "select" | "wall" | "door" | "window" | "balcony" | "passage" | "room" | "furniture" | "entrance" | "scale" | "image";

/** Plano de fondo colocado en el mundo: (x, y) es su esquina superior izquierda, en metros. */
export interface Backdrop { url: string; name: string; size: number; width: number; height: number; metersPerPx: number; x: number; y: number; opacity: number; visible: boolean }

interface Props {
  floor: Floor;
  tool: Tool;
  selection: Selection | null;
  backdrop: Backdrop | null;
  /** Puntos en curso: tramo de pared, contorno a mano o medida de la escala. */
  path: Pt[];
  ortho: boolean;
  showDims: boolean;
  /** Clic ya ajustado, según la herramienta. */
  onPlace: (p: Pt, raw: Pt) => void;
  onDoubleClick: () => void;
  onSelect: (s: Selection | null) => void;
  /** Arrastre sobre la selección o un extremo: d es el desplazamiento total desde el inicio. */
  onDrag: (d: DragEvent) => void;
  onCursor: (p: Pt | null) => void;
}

export type DragEvent =
  | { phase: "start"; target: DragTarget; at: Pt }
  | { phase: "move"; target: DragTarget; at: Pt; from: Pt }
  | { phase: "end" };
export type DragTarget = Selection | { kind: "endpoint"; point: Pt } | { kind: "backdrop" };

export interface CanvasHandle { fit: () => void }

const FILL: Record<string, string> = { tile: "var(--floor-tile)", wood: "var(--floor-wood)", bath: "var(--floor-bath)", concrete: "var(--floor-concrete)" };
const fmtLen = (n: number) => `${fmt(n)} m`;

/** Lienzo del editor: planta en coordenadas de pantalla, con zoom y desplazamiento. */
export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(props, ref) {
  const { floor, tool, selection, backdrop, path, ortho, showDims, onPlace, onDoubleClick, onSelect, onDrag, onCursor } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ tx: 200, ty: 500, z: 40 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<{ pt: Pt; kind: SnapKind } | null>(null);
  const gesture = useRef<{ type: "pan"; x: number; y: number; tx: number; ty: number } | { type: "drag"; target: DragTarget; from: Pt; moved: boolean } | null>(null);
  const spaceDown = useRef(false);

  const SX = (x: number) => view.tx + x * view.z, SY = (y: number) => view.ty - y * view.z;
  const toWorld = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - view.tx) / view.z, (view.ty - (e.clientY - r.top)) / view.z];
  }, [view]);

  const fit = useCallback(() => {
    const xs: number[] = [], ys: number[] = [];
    for (const w of floor.walls) { xs.push(w.a[0], w.b[0]); ys.push(w.a[1], w.b[1]); }
    for (const r of floor.rooms) for (const p of r.polygon) { xs.push(p[0]); ys.push(p[1]); }
    if (backdrop?.visible) {
      xs.push(backdrop.x, backdrop.x + backdrop.width * backdrop.metersPerPx);
      ys.push(backdrop.y, backdrop.y - backdrop.height * backdrop.metersPerPx);
    }
    if (!xs.length) { xs.push(0, 12); ys.push(0, 10); }
    const r = svgRef.current?.getBoundingClientRect();
    const w = r?.width || 800, h = r?.height || 600;
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const z = Math.min((w - 60) / Math.max(x1 - x0, 1), (h - 60) / Math.max(y1 - y0, 1));
    setView({ z, tx: (w - (x1 - x0) * z) / 2 - x0 * z, ty: (h + (y1 - y0) * z) / 2 + y0 * z });
  }, [floor, backdrop]);

  useImperativeHandle(ref, () => ({ fit }), [fit]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); });
    ro.observe(el);
    // la rueda acerca hacia el cursor; hace falta un oyente no pasivo para que la página no se desplace
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      setView(v => {
        const z = Math.max(6, Math.min(600, v.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), k = z / v.z;
        return { z, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const key = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = e.type === "keydown"; };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => { ro.disconnect(); el.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); };
  }, []);

  useEffect(() => { const t = setTimeout(fit, 0); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [backdrop?.url]);

  const tol = 10 / view.z;
  const snapped = (e: RPointerEvent | React.MouseEvent) => snap(floor, toWorld(e), { tol, from: path[path.length - 1], ortho: ortho && tool !== "room", free: e.shiftKey || tool === "scale" });

  const selectedWall = selection?.kind === "wall" ? floor.walls.find(w => w.id === selection.id) : undefined;

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignorar */ }
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      gesture.current = { type: "pan", x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      return;
    }
    const world = toWorld(e);
    if (tool === "image") { gesture.current = { type: "drag", target: { kind: "backdrop" }, from: world, moved: false }; onDrag({ phase: "start", target: { kind: "backdrop" }, at: world }); return; }
    if (tool !== "select") { onPlace(snapped(e).pt, world); return; }
    if (selectedWall) {
      for (const point of [selectedWall.a, selectedWall.b]) {
        if (Math.hypot(point[0] - world[0], point[1] - world[1]) < tol) {
          const target: DragTarget = { kind: "endpoint", point };
          gesture.current = { type: "drag", target, from: world, moved: false };
          onDrag({ phase: "start", target, at: world });
          return;
        }
      }
    }
    const hit = hitTest(floor, world, tol);
    onSelect(hit);
    if (hit && hit.kind !== "room") {
      gesture.current = { type: "drag", target: hit, from: world, moved: false };
      onDrag({ phase: "start", target: hit, at: world });
    } else {
      gesture.current = { type: "pan", x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (g?.type === "pan") { setView(v => ({ ...v, tx: g.tx + e.clientX - g.x, ty: g.ty + e.clientY - g.y })); return; }
    if (g?.type === "drag") {
      const world = toWorld(e);
      if (!g.moved && Math.hypot(world[0] - g.from[0], world[1] - g.from[1]) < 3 / view.z) return;
      g.moved = true;
      // el extremo arrastrado se ajusta a otras paredes y a la rejilla
      const at = g.target.kind === "endpoint" ? snap({ ...floor, walls: floor.walls.filter(w => w.id !== selectedWall?.id) }, world, { tol, ortho: false, free: e.shiftKey }).pt : world;
      onDrag({ phase: "move", target: g.target, at, from: g.from });
      return;
    }
    const s = snapped(e);
    setCursor(s);
    onCursor(s.pt);
  };

  const onPointerUp = () => {
    if (gesture.current?.type === "drag") onDrag({ phase: "end" });
    gesture.current = null;
  };

  const holes: [Pt, Pt][] = floor.openings.map(o => [o.a, o.b]);
  const isSel = (kind: Selection["kind"], id?: string) => selection?.kind === kind && (kind === "entrance" || (selection as { id: string }).id === id);
  const pts = (p: Pt[]) => p.map(q => `${SX(q[0])},${SY(q[1])}`).join(" ");
  const last = path[path.length - 1];
  const lineStyle = view.z < 15 ? 0.6 : 1;

  return (
    <svg
      ref={svgRef} className={`ed-canvas tool-${tool}`} role="application" aria-label="Lienzo del plano"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onPointerLeave={() => { setCursor(null); onCursor(null); }} onDoubleClick={onDoubleClick} onContextMenu={e => e.preventDefault()}
    >
      {size.w > 0 && backdrop?.visible && (
        <image
          href={backdrop.url} x={SX(backdrop.x)} y={SY(backdrop.y)}
          width={backdrop.width * backdrop.metersPerPx * view.z} height={backdrop.height * backdrop.metersPerPx * view.z}
          opacity={backdrop.opacity} preserveAspectRatio="none"
        />
      )}

      {floor.rooms.map(r => <polygon key={r.id} points={pts(r.polygon)} fill={FILL[r.finish]} opacity={backdrop?.visible ? 0.45 : 0.9} className={isSel("room", r.id) ? "ed-room is-sel" : "ed-room"} />)}

      {floor.furniture.map(f => {
        const cls = isSel("furniture", f.id) ? "ed-furn is-sel" : "ed-furn";
        return f.polygon
          ? <polygon key={f.id} points={pts(f.polygon)} className={cls} />
          : <rect key={f.id} x={SX(f.x)} y={SY(f.y + f.d)} width={f.w * view.z} height={f.d * view.z} className={cls} />;
      })}
      {view.z > 28 && floor.furniture.map(f => (
        <text key={f.id} x={SX(f.x + f.w / 2)} y={SY(f.y + f.d / 2) + 4} textAnchor="middle" className="ed-furn-text">{f.label ?? f.type}</text>
      ))}

      {floor.walls.flatMap(w => splitWall(w.a, w.b, holes).solid.map(([a, b], i) => (
        <line key={`${w.id}-${i}`} x1={SX(a[0])} y1={SY(a[1])} x2={SX(b[0])} y2={SY(b[1])} strokeWidth={Math.max(2, w.thickness * view.z)} className={isSel("wall", w.id) ? "ed-wall is-sel" : "ed-wall"} />
      )))}

      {floor.openings.map(o => {
        const sel = isSel("opening", o.id) ? " is-sel" : "";
        if (o.door) {
          const d = o.door, r = Math.hypot(d.openTo[0] - d.hinge[0], d.openTo[1] - d.hinge[1]) * view.z;
          const other = Math.hypot(o.a[0] - d.hinge[0], o.a[1] - d.hinge[1]) < 0.03 ? o.b : o.a;
          const cross = (other[0] - d.hinge[0]) * (d.openTo[1] - d.hinge[1]) - (other[1] - d.hinge[1]) * (d.openTo[0] - d.hinge[0]);
          return (
            <g key={o.id} className={`ed-door${sel}`}>
              <line x1={SX(o.a[0])} y1={SY(o.a[1])} x2={SX(o.b[0])} y2={SY(o.b[1])} className="ed-gap" />
              <line x1={SX(d.hinge[0])} y1={SY(d.hinge[1])} x2={SX(d.openTo[0])} y2={SY(d.openTo[1])} />
              <path d={`M${SX(other[0])} ${SY(other[1])} A${r} ${r} 0 0 ${cross > 0 ? 0 : 1} ${SX(d.openTo[0])} ${SY(d.openTo[1])}`} fill="none" />
            </g>
          );
        }
        return <line key={o.id} x1={SX(o.a[0])} y1={SY(o.a[1])} x2={SX(o.b[0])} y2={SY(o.b[1])} className={`ed-opening kind-${o.kind}${sel}`} />;
      })}

      {showDims && view.z > 18 && floor.walls.map(w => {
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        if (L * view.z < 46) return null;
        const mx = SX((w.a[0] + w.b[0]) / 2), my = SY((w.a[1] + w.b[1]) / 2);
        const angle = (-Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180) / Math.PI;
        const up = angle > 90 || angle <= -90 ? angle + 180 : angle;
        return <text key={w.id} transform={`translate(${mx} ${my}) rotate(${up})`} y={-(w.thickness * view.z) / 2 - 4} textAnchor="middle" className="ed-dim">{fmt(L)}</text>;
      })}

      {floor.rooms.map(r => {
        const [lx, ly] = roomLabelPoint(r);
        return (
          <g key={r.id} className="ed-room-label">
            <text x={SX(lx)} y={SY(ly)} textAnchor="middle" className="ed-room-name">{r.name}</text>
            <text x={SX(lx)} y={SY(ly) + 15} textAnchor="middle" className="ed-room-area">{r.area === undefined ? "≈ " : ""}{fmt(roomArea(r) || polygonArea(r.polygon))} m²</text>
          </g>
        );
      })}

      {floor.entrance && (
        <g transform={`translate(${SX(floor.entrance.x)} ${SY(floor.entrance.y)}) rotate(${floor.entrance.heading})`} className={isSel("entrance") ? "ed-entrance is-sel" : "ed-entrance"}>
          <circle r={9} /><path d="M0 -6 L5 4 L0 1.5 L-5 4 Z" />
        </g>
      )}

      {selectedWall && [selectedWall.a, selectedWall.b].map((p, i) => <rect key={i} x={SX(p[0]) - 5} y={SY(p[1]) - 5} width={10} height={10} className="ed-handle" />)}

      {path.length > 0 && (
        <polyline points={pts(cursor && tool !== "scale" ? [...path, cursor.pt] : cursor && path.length < 2 ? [...path, cursor.pt] : path)} className="ed-path" strokeWidth={lineStyle * 2} />
      )}
      {path.map((p, i) => <circle key={i} cx={SX(p[0])} cy={SY(p[1])} r={4} className="ed-path-pt" />)}
      {last && cursor && (tool === "wall" || (tool === "scale" && path.length < 2)) && (
        <text x={SX(cursor.pt[0]) + 12} y={SY(cursor.pt[1]) - 10} className="ed-live">{fmtLen(Math.hypot(cursor.pt[0] - last[0], cursor.pt[1] - last[1]))}</text>
      )}
      {cursor && tool !== "select" && tool !== "image" && (
        <circle cx={SX(cursor.pt[0])} cy={SY(cursor.pt[1])} r={cursor.kind === "endpoint" ? 7 : 4} className={`ed-cursor snap-${cursor.kind}`} />
      )}
    </svg>
  );
});
