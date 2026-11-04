import { useEffect, useId, useState, type ReactNode } from "react";
import type { Floor, FloorFinish, FurnitureType, OpeningKind, UmbralModel } from "../model/types";
import { floorAreas, fmt, polygonArea } from "../model/geometry";
import {
  FURNITURE, clearRoomKey, duplicateFurniture, flipHinge, flipSwing, openingOffset, patchFurniture, patchOpening, patchRoom, patchWall,
  resizeOpening, rotateFurniture, setOpeningKind, setOpeningOffset, setWallLength, type Selection,
} from "./ops";

const parseNum = (s: string) => Number(s.trim().replace(",", "."));

/** Campo numérico que acepta coma decimal y aplica al salir o con Intro. */
function NumberField({ label, value, unit = "m", onCommit, min = 0, placeholder }: { label: string; value: number | undefined; unit?: string; onCommit: (n: number | undefined) => void; min?: number; placeholder?: string }) {
  const id = useId();
  const shown = value === undefined ? "" : String(Math.round(value * 1000) / 1000).replace(".", ",");
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (text.trim() === "") { if (value !== undefined) onCommit(undefined); return; }
    const n = parseNum(text);
    if (Number.isFinite(n) && n >= min) onCommit(n); else setText(shown);
  };
  return (
    <label className="ed-field" htmlFor={id}>
      <span>{label}</span>
      <span className="ed-input-unit">
        <input id={id} inputMode="decimal" value={text} placeholder={placeholder} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } }} />
        <small>{unit}</small>
      </span>
    </label>
  );
}

function TextField({ label, value, onCommit, multiline, focused }: { label: string; value: string; onCommit: (s: string) => void; multiline?: boolean; focused?: boolean }) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => { if (focused) (document.getElementById(id) as HTMLInputElement | null)?.select(); }, [focused, id]);
  const commit = () => { if (text !== value) onCommit(text); };
  return (
    <label className="ed-field" htmlFor={id}>
      <span>{label}</span>
      {multiline
        ? <textarea id={id} rows={3} value={text} onChange={e => setText(e.target.value)} onBlur={commit} />
        : <input id={id} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />}
    </label>
  );
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <label className="ed-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return <label className="ed-check"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className="ed-section"><h3>{title}</h3>{children}</section>;

const KINDS: { value: OpeningKind; label: string }[] = [
  { value: "door", label: "Puerta" }, { value: "passage", label: "Paso sin puerta" }, { value: "window", label: "Ventana" }, { value: "balcony", label: "Balconera" },
];
const FINISHES: { value: FloorFinish; label: string }[] = [
  { value: "tile", label: "Baldosa" }, { value: "wood", label: "Parquet" }, { value: "bath", label: "Gres de baño" }, { value: "concrete", label: "Hormigón" },
];
const HEADINGS = [
  { value: "auto", label: "Automático (pared cercana)" }, { value: "0", label: "Norte (arriba)" }, { value: "90", label: "Este (derecha)" },
  { value: "180", label: "Sur (abajo)" }, { value: "270", label: "Oeste (izquierda)" },
];

interface SelectionProps {
  floor: Floor;
  selection: Selection;
  /** Aplica un cambio a la planta y lo guarda en el historial. */
  apply: (next: Floor) => void;
  onSelect: (s: Selection | null) => void;
  onDelete: () => void;
  focusName?: boolean;
}

/** Propiedades del elemento seleccionado. */
export function SelectionPanel({ floor, selection, apply, onSelect, onDelete, focusName }: SelectionProps) {
  const del = <button className="btn ghost ed-delete" onClick={onDelete}>Eliminar <kbd>Supr</kbd></button>;

  if (selection.kind === "wall") {
    const w = floor.walls.find(q => q.id === selection.id);
    if (!w) return null;
    return (
      <Section title="Pared">
        <NumberField label="Longitud" value={Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])} onCommit={n => n && apply(setWallLength(floor, w.id, n))} />
        <NumberField label="Grosor" value={w.thickness} onCommit={n => n && apply(patchWall(floor, w.id, { thickness: n }))} />
        <p className="muted small">Arrastra la pared o sus extremos. Las paredes unidas la acompañan.</p>
        {del}
      </Section>
    );
  }

  if (selection.kind === "opening") {
    const o = floor.openings.find(q => q.id === selection.id);
    if (!o) return null;
    const isWindow = o.kind === "window" || o.kind === "balcony";
    return (
      <Section title="Hueco">
        <SelectField label="Tipo" value={o.kind} options={KINDS} onChange={k => apply(patchOpening(floor, o.id, q => setOpeningKind(q, k)))} />
        <NumberField label="Ancho" value={Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1])} onCommit={n => n && apply(resizeOpening(floor, o.id, n))} />
        <NumberField label="Distancia al inicio de la pared" value={openingOffset(floor, o)} onCommit={n => n !== undefined && apply(setOpeningOffset(floor, o.id, n))} />
        {isWindow && o.kind === "window" && <NumberField label="Antepecho" value={o.sill ?? 0.9} onCommit={n => n !== undefined && apply(patchOpening(floor, o.id, q => ({ ...q, sill: n })))} />}
        {isWindow && <NumberField label="Dintel" value={o.head ?? (o.kind === "window" ? 2.1 : 2.2)} onCommit={n => n && apply(patchOpening(floor, o.id, q => ({ ...q, head: n })))} />}
        {o.door && (
          <>
            <div className="row">
              <button className="btn ghost" onClick={() => apply(patchOpening(floor, o.id, flipHinge))}>Cambiar bisagra</button>
              <button className="btn ghost" onClick={() => apply(patchOpening(floor, o.id, flipSwing))}>Cambiar sentido</button>
            </div>
            <Check label="Con cristal" checked={Boolean(o.door.glazed)} onChange={b => apply(patchOpening(floor, o.id, q => ({ ...q, door: { ...q.door!, glazed: b } })))} />
            <Check
              label="Puerta de entrada a la vivienda" checked={Boolean(o.door.entrance)}
              onChange={b => apply({ ...floor, openings: floor.openings.map(q => (q.door ? { ...q, door: { ...q.door, entrance: q.id === o.id ? b : b ? false : q.door.entrance } } : q)) })}
            />
          </>
        )}
        {del}
      </Section>
    );
  }

  if (selection.kind === "room") {
    const r = floor.rooms.find(q => q.id === selection.id);
    if (!r) return null;
    return (
      <Section title="Estancia">
        <TextField label="Nombre" value={r.name} focused={focusName} onCommit={name => apply(patchRoom(floor, r.id, { name }))} />
        <SelectField label="Suelo" value={r.finish} options={FINISHES} onChange={finish => apply(patchRoom(floor, r.id, { finish }))} />
        <p className="muted small">Superficie del contorno: ≈ {fmt(polygonArea(r.polygon))} m²</p>
        <NumberField
          label="Superficie escrita en el plano" unit="m²" value={r.area} placeholder="Opcional"
          onCommit={n => apply(n === undefined ? clearRoomKey(floor, r.id, "area") : patchRoom(floor, r.id, { area: n }))}
        />
        <Check label="Medidas tomadas en la vivienda" checked={r.measured !== false} onChange={measured => apply(patchRoom(floor, r.id, { measured }))} />
        <Check label="Exterior (sin techo, fuera del total)" checked={Boolean(r.outdoor)} onChange={b => apply(b ? patchRoom(floor, r.id, { outdoor: true }) : clearRoomKey(floor, r.id, "outdoor"))} />
        {del}
      </Section>
    );
  }

  if (selection.kind === "furniture") {
    const f = floor.furniture.find(q => q.id === selection.id);
    if (!f) return null;
    const def = FURNITURE.find(q => q.type === f.type);
    const patch = (p: Partial<typeof f>) => apply(patchFurniture(floor, f.id, q => ({ ...q, ...p })));
    return (
      <Section title="Mueble">
        <SelectField<FurnitureType> label="Tipo" value={f.type} options={FURNITURE.map(q => ({ value: q.type, label: q.label }))} onChange={type => {
          const nd = FURNITURE.find(q => q.type === type)!;
          apply(patchFurniture(floor, f.id, q => { const { model: _m, ...rest } = q; return { ...rest, type, label: nd.label, ...(nd.model ? { model: nd.model } : {}) }; }));
        }} />
        <TextField label="Rótulo" value={f.label ?? ""} onCommit={label => patch({ label })} />
        {f.polygon
          ? <p className="muted small">Pieza en L o a medida: se mueve y se gira, pero su forma se edita en el archivo.</p>
          : <><NumberField label="Ancho (en planta)" value={f.w} onCommit={n => n && patch({ w: n })} /><NumberField label="Fondo (en planta)" value={f.d} onCommit={n => n && patch({ d: n })} /></>}
        <NumberField label="Alto" value={f.h} placeholder="Automático" onCommit={n => apply(patchFurniture(floor, f.id, q => { const { h: _h, ...rest } = q; return n ? { ...rest, h: n } : rest; }))} />
        <SelectField label="Hacia dónde mira" value={f.heading === undefined ? "auto" : String(f.heading)} options={HEADINGS} onChange={v => apply(patchFurniture(floor, f.id, q => { const { heading: _o, ...rest } = q; return v === "auto" ? rest : { ...rest, heading: Number(v) }; }))} />
        {def?.model && <Check label="Usar modelo 3D realista" checked={Boolean(f.model)} onChange={b => apply(patchFurniture(floor, f.id, q => { const { model: _m, ...rest } = q; return b ? { ...rest, model: def.model } : rest; }))} />}
        <div className="row">
          <button className="btn ghost" onClick={() => apply(patchFurniture(floor, f.id, rotateFurniture))}>Girar 90°</button>
          <button className="btn ghost" onClick={() => { const r = duplicateFurniture(floor, f.id); apply(r.floor); onSelect({ kind: "furniture", id: r.id }); }}>Duplicar</button>
        </div>
        {del}
      </Section>
    );
  }

  const e = floor.entrance;
  if (!e) return null;
  return (
    <Section title="Inicio del recorrido">
      <p className="muted small">Aquí empieza el paseo en primera persona.</p>
      <NumberField label="Rumbo (0 = norte, 90 = este)" unit="°" value={e.heading} onCommit={n => n !== undefined && apply({ ...floor, entrance: { ...e, heading: n % 360 } })} />
      {del}
    </Section>
  );
}

/** Datos del inmueble y superficies, cuando no hay nada seleccionado. */
export function ModelPanel({ model, onModel, warnings }: { model: UmbralModel; onModel: (m: UmbralModel) => void; warnings: string[] }) {
  const floor = model.floors[0];
  const { rooms, total } = floorAreas(floor);
  const set = (patch: Partial<UmbralModel["property"]>) => onModel({ ...model, property: { ...model.property, ...patch } });
  return (
    <>
      <Section title="Superficies">
        {rooms.length === 0
          ? <p className="muted small">Cuando las paredes cierren una zona, usa la herramienta Estancia y haz clic dentro.</p>
          : (
            <table className="ed-areas">
              <tbody>{rooms.map(r => <tr key={r.id}><td>{r.name}{r.outdoor ? " (exterior)" : ""}</td><td className="num">{r.measured ? "" : "≈ "}{fmt(r.area)}</td></tr>)}</tbody>
              <tfoot><tr><td>Total útil</td><td className="num">≈ {fmt(total)} m²</td></tr></tfoot>
            </table>
          )}
      </Section>
      {warnings.length > 0 && (
        <Section title="Pendiente">
          <ul className="ed-warnings">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </Section>
      )}
      <Section title="Inmueble">
        <TextField label="Título" value={model.property.title} onCommit={title => onModel({ ...model, meta: { ...model.meta, title }, property: { ...model.property, title } })} />
        <TextField label="Dirección" value={model.property.address ?? ""} onCommit={address => set({ address })} />
        <TextField label="Precio" value={model.property.price ?? ""} onCommit={price => set({ price })} />
        <TextField label="Descripción" multiline value={model.property.description ?? ""} onCommit={description => set({ description })} />
        <NumberField label="Altura de techo" value={floor.height} onCommit={n => n && onModel({ ...model, floors: model.floors.map((f, i) => (i === 0 ? { ...f, height: n } : f)) })} />
      </Section>
      <Section title="Inmobiliaria">
        <TextField label="Nombre" value={model.agency.name} onCommit={name => onModel({ ...model, agency: { ...model.agency, name } })} />
        <TextField label="Teléfono" value={model.agency.phone ?? ""} onCommit={phone => onModel({ ...model, agency: { ...model.agency, phone } })} />
        <TextField label="Correo" value={model.agency.email ?? ""} onCommit={email => onModel({ ...model, agency: { ...model.agency, email } })} />
        <Check label="Datos de ejemplo (muestra el aviso de demostración)" checked={Boolean(model.meta.example)} onChange={example => onModel({ ...model, meta: { ...model.meta, example } })} />
      </Section>
    </>
  );
}
