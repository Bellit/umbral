import type { Floor, Pt } from "../model/types";
import { floorAreas, floorBounds, fmt, roomLabelPoint, splitWall } from "../model/geometry";

interface Props { floor: Floor }

const FILL: Record<string, string> = { tile: "var(--floor-tile)", wood: "var(--floor-wood)", bath: "var(--floor-bath)", concrete: "var(--floor-concrete)" };

/** Dibujo de la planta en SVG; sin rótulos sirve de miniatura en la portada. */
export function PlanDrawing({ floor, labels = true }: Props & { labels?: boolean }) {
  const b = floorBounds(floor);
  const pad = 0.6;
  const W = b.maxX - b.minX + 2 * pad, H = b.maxY - b.minY + 2 * pad;
  // y del plano hacia arriba → y del SVG hacia abajo
  const X = (x: number) => x - b.minX + pad;
  const Y = (y: number) => b.maxY - y + pad;
  const pts = (p: Pt[]) => p.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
  const holes: [Pt, Pt][] = floor.openings.map(o => [o.a, o.b]);
  const { rooms } = floorAreas(floor);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Plano de ${floor.name}`}>
          {floor.rooms.map(r => <polygon key={r.id} points={pts(r.polygon)} fill={FILL[r.finish]} />)}
          {floor.furniture.map(f => f.polygon
            ? <polygon key={f.id} points={pts(f.polygon)} className="plan-furn" />
            : <rect key={f.id} x={X(f.x)} y={Y(f.y + f.d)} width={f.w} height={f.d} className="plan-furn" />)}
          {floor.walls.flatMap(w => splitWall(w.a, w.b, holes).solid.map(([a, c], i) => (
            <line key={`${w.id}-${i}`} x1={X(a[0])} y1={Y(a[1])} x2={X(c[0])} y2={Y(c[1])} className="plan-wall" strokeWidth={w.thickness + 0.04} />
          )))}
          {floor.openings.filter(o => o.kind === "window" || o.kind === "balcony").map(o => (
            <line key={o.id} x1={X(o.a[0])} y1={Y(o.a[1])} x2={X(o.b[0])} y2={Y(o.b[1])} className="plan-window" />
          ))}
          {floor.openings.filter(o => o.door).map(o => {
            const d = o.door!;
            const r = Math.hypot(d.openTo[0] - d.hinge[0], d.openTo[1] - d.hinge[1]);
            const other = Math.hypot(o.a[0] - d.hinge[0], o.a[1] - d.hinge[1]) < 0.01 ? o.b : o.a;
            // arco de la hoja: de la posición cerrada (sobre el hueco) a la abierta
            const cross = (other[0] - d.hinge[0]) * (d.openTo[1] - d.hinge[1]) - (other[1] - d.hinge[1]) * (d.openTo[0] - d.hinge[0]);
            const sweep = cross > 0 ? 0 : 1;
            return (
              <g key={o.id} className="plan-door">
                <line x1={X(d.hinge[0])} y1={Y(d.hinge[1])} x2={X(d.openTo[0])} y2={Y(d.openTo[1])} />
                <path d={`M${X(other[0])} ${Y(other[1])} A${r} ${r} 0 0 ${sweep} ${X(d.openTo[0])} ${Y(d.openTo[1])}`} fill="none" />
              </g>
            );
          })}
          {labels && floor.rooms.map(r => {
            const [lx, ly] = roomLabelPoint(r);
            const a = rooms.find(q => q.id === r.id)!;
            return (
              <g key={r.id} className="plan-label">
                <text x={X(lx)} y={Y(ly) - 0.05} textAnchor="middle" className="plan-name">{r.name}</text>
                <text x={X(lx)} y={Y(ly) + 0.32} textAnchor="middle" className="plan-area">{a.measured ? "" : "≈ "}{fmt(a.area)} m²</text>
              </g>
            );
          })}
    </svg>
  );
}

/** Pestaña "Plano": planta en SVG con superficies, generada del modelo. */
export function Plan2D({ floor }: Props) {
  const { rooms, total } = floorAreas(floor);
  const anyEstimated = rooms.some(r => !r.measured);

  return (
    <div className="plan">
      <div className="plan-figure">
        <PlanDrawing floor={floor} />
      </div>
      <div className="plan-table">
        <h3>Superficies útiles</h3>
        <table>
          <thead><tr><th>Estancia</th><th className="num">m²</th></tr></thead>
          <tbody>
            {rooms.map(r => <tr key={r.id}><td>{r.name}{r.outdoor ? " (exterior)" : ""}</td><td className="num">{r.measured ? "" : "≈ "}{fmt(r.area)}</td></tr>)}
          </tbody>
          <tfoot><tr><td>Total</td><td className="num">{anyEstimated ? "≈ " : ""}{fmt(total)}</td></tr></tfoot>
        </table>
        <p className="muted small">
          Superficie útil, de pared a pared.{rooms.some(r => r.outdoor) ? " El total no incluye los exteriores." : ""} {anyEstimated ? "Las cifras con ≈ están estimadas." : ""} La superficie construida suele ser un 10–20 % mayor.
        </p>
      </div>
    </div>
  );
}
