import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Floor, Pt, UmbralModel } from "../model/types";
import { validateModel } from "../model/validate";
import { downloadModel, readFromFile } from "../io/readers";
import { CATALOG } from "../demo/catalog";
import { resolveAsset } from "../env";
import { Viewer3D } from "../viewer/Viewer3D";
import { Canvas, type Backdrop, type CanvasHandle, type DragEvent, type DragTarget, type Tool } from "./Canvas";
import { ModelPanel, SelectionPanel } from "./Panels";
import { getDraft, listDrafts, newDraftId, removeDraft, saveDraft, type Draft } from "./drafts";
import {
  FURNITURE, addFurniture, addOpening, addRoom, addWall, blankModel, faceAt, findFaces, moveEndpoint, moveFurniture, moveWall, patchFurniture,
  removeSelection, rotateFurniture, duplicateFurniture, slideOpening, interiorPoint, type Selection,
} from "./ops";
import { distToSegment, pointInPolygon } from "../model/geometry";

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Seleccionar", key: "V", hint: "Haz clic en un elemento para editarlo y arrástralo para moverlo. Arrastra el fondo para desplazarte; la rueda acerca." },
  { id: "wall", label: "Pared", key: "P", hint: "Haz clic para encadenar paredes. Escribe una medida e Intro para fijar el largo. Esc termina. Mayús: sin ajuste." },
  { id: "door", label: "Puerta", key: "U", hint: "Haz clic sobre una pared para abrir una puerta." },
  { id: "window", label: "Ventana", key: "T", hint: "Haz clic sobre una pared para poner una ventana." },
  { id: "balcony", label: "Balconera", key: "B", hint: "Haz clic sobre una pared para poner una balconera." },
  { id: "passage", label: "Paso", key: "O", hint: "Haz clic sobre una pared para abrir un paso sin puerta." },
  { id: "room", label: "Estancia", key: "E", hint: "Haz clic dentro de una zona cerrada por paredes para crear la estancia." },
  { id: "furniture", label: "Mueble", key: "M", hint: "Elige un mueble en el panel y haz clic donde va." },
  { id: "entrance", label: "Inicio", key: "I", hint: "Haz clic donde debe empezar el recorrido 3D." },
  { id: "scale", label: "Escala", key: "L", hint: "Marca los dos extremos de una medida que conozcas y escribe cuánto mide." },
  { id: "image", label: "Mover plano", key: "N", hint: "Arrastra el plano de fondo para encajarlo con lo dibujado." },
];

const OPENING_TOOLS = ["door", "window", "balcony", "passage"] as const;
type OpeningTool = (typeof OPENING_TOOLS)[number];
const isOpeningTool = (t: Tool): t is OpeningTool => (OPENING_TOOLS as readonly string[]).includes(t);

function floorOf(m: UmbralModel) { return m.floors[0]; }
function withFloor(m: UmbralModel, floor: Floor): UmbralModel { return { ...m, floors: m.floors.map((f, i) => (i === 0 ? floor : f)) }; }

/** Editor de un borrador: calca el plano, fija la escala y coloca muebles. */
export function Editor({ draftId }: { draftId: string }) {
  const [initial] = useState(() => getDraft(draftId));
  if (!initial) {
    return (
      <div className="ed-missing">
        <p>Este borrador no existe en este navegador.</p>
        <a className="btn" href="#/editor">Volver a los borradores</a>
      </div>
    );
  }
  return <EditorInner key={draftId} draft={initial} />;
}

function EditorInner({ draft }: { draft: Draft }) {
  const [history, setHistory] = useState({ past: [] as UmbralModel[], present: draft.model, future: [] as UmbralModel[] });
  /** Planta provisional durante un arrastre: solo entra en el historial al soltar. */
  const [live, setLive] = useState<Floor | null>(null);
  const model = history.present;
  const floor = live ?? floorOf(model);

  const [tool, setToolState] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [path, setPath] = useState<Pt[]>([]);
  const [typed, setTyped] = useState("");
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [ortho, setOrtho] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [thickness, setThickness] = useState(0.1);
  const [roomManual, setRoomManual] = useState(false);
  const [furnType, setFurnType] = useState(FURNITURE[0].type);
  const [view, setView] = useState<"plano" | "3d">("plano");
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [trace, setTrace] = useState(draft.trace);
  const [scaleText, setScaleText] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  /** Estancia recién creada: su nombre recibe el foco para escribirlo directamente. */
  const [newRoom, setNewRoom] = useState<string | null>(null);

  const canvasRef = useRef<CanvasHandle>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const dragStart = useRef<{ floor: Floor; target: DragTarget; backdrop: Backdrop | null } | null>(null);
  const backdropUrl = useRef<string | null>(null);

  const commitModel = useCallback((next: UmbralModel) => {
    setHistory(h => (next === h.present ? h : { past: [...h.past.slice(-99), h.present], present: next, future: [] }));
  }, []);
  const commit = useCallback((next: Floor) => setHistory(h => ({ past: [...h.past.slice(-99), h.present], present: withFloor(h.present, next), future: [] })), []);
  const undo = useCallback(() => { setSelection(null); setHistory(h => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)); }, []);
  const redo = useCallback(() => { setSelection(null); setHistory(h => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)); }, []);

  const setTool = useCallback((t: Tool) => { setToolState(t); setPath([]); setTyped(""); setNewRoom(null); if (t !== "select") setSelection(null); }, []);

  // autoguardado del borrador en este navegador
  useEffect(() => {
    const t = setTimeout(() => setSaveFailed(!saveDraft({ id: draft.id, model, trace })), 300);
    return () => clearTimeout(t);
  }, [draft.id, model, trace]);

  useEffect(() => { document.title = `${model.property.title} · Editor de Umbral`; }, [model.property.title]);
  useEffect(() => () => { if (backdropUrl.current) URL.revokeObjectURL(backdropUrl.current); }, []);

  // ---------- plano de fondo ----------
  const loadImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setNote({ kind: "error", text: `"${file.name}" no es una imagen. De momento se admiten JPG y PNG; exporta los PDF como imagen.` }); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (backdropUrl.current) URL.revokeObjectURL(backdropUrl.current);
      backdropUrl.current = url;
      const remembered = trace && trace.name === file.name && trace.size === file.size ? trace : null;
      const metersPerPx = remembered?.metersPerPx ?? 12 / img.naturalWidth;
      setBackdrop({
        url, name: file.name, size: file.size, width: img.naturalWidth, height: img.naturalHeight, metersPerPx,
        x: remembered?.x ?? 0, y: remembered?.y ?? img.naturalHeight * metersPerPx, opacity: 0.6, visible: true,
      });
      setNote(remembered ? { kind: "ok", text: "Plano colocado con la escala que ya tenía." } : { kind: "ok", text: "Plano cargado. Ahora fija la escala con una medida que conozcas." });
      if (!remembered) setTool("scale");
    };
    img.onerror = () => { URL.revokeObjectURL(url); setNote({ kind: "error", text: `No se pudo leer "${file.name}".` }); };
    img.src = url;
  };

  const placeBackdrop = useCallback((b: Backdrop) => {
    setBackdrop(b);
    setTrace({ name: b.name, size: b.size, metersPerPx: b.metersPerPx, x: b.x, y: b.y });
  }, []);

  const applyScale = () => {
    const real = Number(scaleText.trim().replace(",", "."));
    if (!backdrop || path.length < 2 || !Number.isFinite(real) || real <= 0) { setNote({ kind: "error", text: "Marca dos puntos y escribe una medida mayor que cero." }); return; }
    const [a, b] = path, measured = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (measured < 1e-6) return;
    const k = real / measured;
    // la escala se aplica desde el primer punto, que queda en su sitio
    placeBackdrop({ ...backdrop, metersPerPx: backdrop.metersPerPx * k, x: a[0] + (backdrop.x - a[0]) * k, y: a[1] + (backdrop.y - a[1]) * k });
    setPath([]); setScaleText("");
    setNote({ kind: "ok", text: "Escala fijada. Ya puedes dibujar las paredes." });
    setTool("wall");
    setTimeout(() => canvasRef.current?.fit(), 0);
  };

  // ---------- acciones en el lienzo ----------
  const onPlace = (p: Pt, raw: Pt) => {
    setNote(null);
    if (tool === "wall") {
      const last = path[path.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.01) { setPath([]); return; }
      if (last) commit(addWall(floor, last, p, thickness));
      setPath([...path, p].slice(-1));
      setTyped("");
      return;
    }
    if (isOpeningTool(tool)) {
      const near = floor.walls.map(w => ({ w, d: distToSegment(raw[0], raw[1], w.a, w.b).d })).sort((a, b) => a.d - b.d)[0];
      if (!near || near.d > 0.4) { setNote({ kind: "error", text: "Haz clic sobre una pared." }); return; }
      const r = addOpening(floor, near.w, raw, tool);
      commit(r.floor);
      setTool("select");
      setSelection({ kind: "opening", id: r.id });
      return;
    }
    if (tool === "room") {
      if (roomManual) {
        const first = path[0];
        if (first && path.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) < 0.25) { finishManualRoom(); return; }
        setPath([...path, p]);
        return;
      }
      const face = faceAt(findFaces(floor.walls), raw[0], raw[1]);
      if (!face) { setNote({ kind: "error", text: "Esa zona no está cerrada por paredes. Ciérrala o marca el contorno a mano." }); return; }
      const ip = interiorPoint(face);
      if (floor.rooms.some(q => pointInPolygon(ip[0], ip[1], q.polygon))) { setNote({ kind: "error", text: "Ahí ya hay una estancia." }); return; }
      const r = addRoom(floor, face, `Estancia ${floor.rooms.length + 1}`);
      commit(r.floor);
      setSelection({ kind: "room", id: r.id });
      setNewRoom(r.id);
      return;
    }
    if (tool === "furniture") {
      const def = FURNITURE.find(q => q.type === furnType)!;
      const r = addFurniture(floor, def, p);
      commit(r.floor);
      setTool("select");
      setSelection({ kind: "furniture", id: r.id });
      return;
    }
    if (tool === "entrance") {
      commit({ ...floor, entrance: { x: p[0], y: p[1], heading: floor.entrance?.heading ?? 0 } });
      setTool("select");
      setSelection({ kind: "entrance" });
      return;
    }
    if (tool === "scale") setPath(path.length >= 2 ? [p] : [...path, p]);
  };

  const finishManualRoom = () => {
    if (path.length < 3) return;
    const r = addRoom(floor, path, `Estancia ${floor.rooms.length + 1}`);
    commit(r.floor);
    setPath([]);
    setSelection({ kind: "room", id: r.id });
    setNewRoom(r.id);
  };

  const onDrag = (e: DragEvent) => {
    if (e.phase === "start") { dragStart.current = { floor: floorOf(model), target: e.target, backdrop }; return; }
    const s = dragStart.current;
    if (!s) return;
    if (e.phase === "end") {
      dragStart.current = null;
      if (s.target.kind === "backdrop") { if (backdrop) placeBackdrop(backdrop); return; }
      if (live) {
        // una pared que se queda sin longitud desaparece
        const walls = live.walls.filter(w => Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]) >= 0.02);
        commit({ ...live, walls });
        setLive(null);
      }
      return;
    }
    const dx = e.at[0] - e.from[0], dy = e.at[1] - e.from[1], t = s.target, base = s.floor;
    if (t.kind === "backdrop") { if (s.backdrop) setBackdrop({ ...s.backdrop, x: s.backdrop.x + dx, y: s.backdrop.y + dy }); return; }
    const grid = (n: number) => Math.round(n / 0.05) * 0.05;
    switch (t.kind) {
      case "endpoint": setLive(moveEndpoint(base, t.point, e.at)); break;
      case "wall": {
        const w = base.walls.find(q => q.id === t.id);
        if (!w) break;
        // una pared recta se mueve solo en perpendicular
        const horizontal = Math.abs(w.a[1] - w.b[1]) < 0.001, vertical = Math.abs(w.a[0] - w.b[0]) < 0.001;
        setLive(moveWall(base, w, horizontal ? 0 : grid(dx), vertical ? 0 : grid(dy)));
        break;
      }
      case "opening": setLive(slideOpening(base, t.id, e.at)); break;
      case "furniture": {
        const f = base.furniture.find(q => q.id === t.id);
        if (f) setLive(patchFurniture(base, f.id, q => moveFurniture(q, grid(f.x + dx), grid(f.y + dy))));
        break;
      }
      case "entrance":
        if (base.entrance) setLive({ ...base, entrance: { ...base.entrance, x: grid(base.entrance.x + dx), y: grid(base.entrance.y + dy) } });
        break;
    }
  };

  const onDoubleClick = () => {
    if (tool === "wall") setPath([]);
    if (tool === "room" && roomManual) finishManualRoom();
  };

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    commit(removeSelection(floorOf(model), selection));
    setSelection(null);
  }, [selection, model, commit]);

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (view !== "plano") return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "d" && selection?.kind === "furniture") {
        e.preventDefault();
        const r = duplicateFurniture(floorOf(model), selection.id);
        commit(r.floor); setSelection({ kind: "furniture", id: r.id });
        return;
      }
      if (mod) return;
      if (e.key === "Escape") { setPath([]); setTyped(""); if (tool !== "select" && !path.length) setTool("select"); else if (tool === "select") setSelection(null); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (typed) { setTyped(typed.slice(0, -1)); return; }
        if (selection) { e.preventDefault(); deleteSelection(); }
        return;
      }
      // medida escrita mientras se dibuja una pared
      if (tool === "wall" && path.length && /^[\d.,]$/.test(e.key)) { setTyped(s => s + e.key); return; }
      if (e.key === "Enter") {
        if (tool === "wall" && path.length && typed && cursor) {
          const L = Number(typed.replace(",", ".")), from = path[path.length - 1];
          const dx = cursor[0] - from[0], dy = cursor[1] - from[1], d = Math.hypot(dx, dy);
          if (L > 0 && d > 0) {
            const to: Pt = [Math.round((from[0] + (dx / d) * L) * 1000) / 1000, Math.round((from[1] + (dy / d) * L) * 1000) / 1000];
            commit(addWall(floorOf(model), from, to, thickness));
            setPath([to]); setTyped("");
          }
        } else if (tool === "room" && roomManual) finishManualRoom();
        return;
      }
      if (e.key === "r" && selection?.kind === "furniture") { commit(patchFurniture(floorOf(model), selection.id, rotateFurniture)); return; }
      const found = TOOLS.find(q => q.key.toLowerCase() === k);
      if (found) setTool(found.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const warnings = useMemo(() => {
    const out: string[] = [];
    const f = floorOf(model);
    if (!f.walls.length) out.push("Dibuja las paredes.");
    if (f.walls.length && !f.rooms.length) out.push("Crea las estancias.");
    if (f.walls.length && !f.entrance) out.push("Marca el inicio del recorrido.");
    if (f.walls.length && !f.openings.some(o => o.door?.entrance)) out.push("Indica cuál es la puerta de entrada, o el recorrido podrá salir de la vivienda.");
    if (f.rooms.some(r => /^Estancia \d+$/.test(r.name))) out.push("Pon nombre a las estancias.");
    return out;
  }, [model]);

  const save = () => {
    const check = validateModel(model);
    if (!check.ok) { setNote({ kind: "error", text: `Todavía no se puede guardar: ${check.errors[0]}` }); return; }
    downloadModel(model);
    setNote({ kind: "ok", text: "Archivo guardado en tu ordenador. El plano de fondo no se incluye." });
  };

  const activeTool = TOOLS.find(t => t.id === tool)!;
  const hasGeometry = floorOf(model).walls.length > 0;

  return (
    <div className="editor" style={{ "--brand": model.agency.color } as CSSProperties}>
      <header className="ed-top">
        <a className="back-link" href="#/editor">Borradores</a>
        <strong className="ed-title">{model.property.title}</strong>
        <div className="seg" role="group" aria-label="Vista">
          <button aria-pressed={view === "plano"} onClick={() => setView("plano")}>Plano</button>
          <button aria-pressed={view === "3d"} disabled={!hasGeometry} onClick={() => setView("3d")}>Ver en 3D</button>
        </div>
        <div className="seg" role="group" aria-label="Historial">
          <button onClick={undo} disabled={!history.past.length} title="Ctrl+Z">Deshacer</button>
          <button onClick={redo} disabled={!history.future.length} title="Ctrl+Y">Rehacer</button>
        </div>
        <button className="btn ghost" onClick={() => imageInput.current?.click()}>{backdrop ? "Cambiar plano" : "Cargar plano"}</button>
        <input ref={imageInput} id="ed-image" type="file" accept="image/*" hidden onChange={e => { loadImage(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn" onClick={save}>Guardar archivo</button>
        <span className={saveFailed ? "ed-saved is-error" : "ed-saved"} role="status">{saveFailed ? "No se pudo guardar el borrador" : "Borrador guardado"}</span>
      </header>

      {view === "3d" ? (
        <div className="ed-3d"><Viewer3D floor={floorOf(model)} resolve={resolveAsset} /></div>
      ) : (
        <div className="ed-body">
          <nav className="ed-tools" aria-label="Herramientas">
            {TOOLS.filter(t => (t.id !== "scale" && t.id !== "image") || backdrop).map(t => (
              <button key={t.id} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={`Tecla ${t.key}`}>{t.label}</button>
            ))}
          </nav>

          <div className="ed-stage">
            <Canvas
              ref={canvasRef} floor={floor} tool={tool} selection={selection} backdrop={backdrop} path={path} ortho={ortho} showDims={showDims}
              onPlace={onPlace} onDoubleClick={onDoubleClick} onSelect={setSelection} onDrag={onDrag} onCursor={setCursor}
            />
            {!backdrop && !hasGeometry && path.length === 0 && (
              <div className="ed-empty">
                <h2>Empieza por el plano</h2>
                <ol>
                  <li>Carga una imagen del plano. No sale de tu ordenador.</li>
                  <li>Fija la escala con una medida que conozcas.</li>
                  <li>Calca paredes, huecos y estancias, y coloca los muebles.</li>
                </ol>
                <button className="btn" onClick={() => imageInput.current?.click()}>Cargar plano</button>
                <p className="muted small">O dibuja sin plano: elige la herramienta Pared.</p>
              </div>
            )}
            <div className="ed-hint">
              <span>{typed ? `Largo: ${typed} m. Intro para aplicar en la dirección del cursor.` : activeTool.hint}</span>
              <span className="ed-hint-tools">
                <button className="link" onClick={() => canvasRef.current?.fit()}>Encajar</button>
                <label><input type="checkbox" checked={ortho} onChange={e => setOrtho(e.target.checked)} /> Ángulo recto</label>
                <label><input type="checkbox" checked={showDims} onChange={e => setShowDims(e.target.checked)} /> Cotas</label>
              </span>
            </div>
            {note && <div className={`ed-note ${note.kind}`} role="status">{note.text}<button className="link" onClick={() => setNote(null)}>Cerrar</button></div>}
          </div>

          <aside className="ed-panel">
            {!selection && tool === "wall" && (
              <section className="ed-section">
                <h3>Pared nueva</h3>
                <div className="seg" role="group" aria-label="Grosor">
                  {[[0.07, "Tabique 7"], [0.1, "Interior 10"], [0.15, "Exterior 15"], [0.25, "Muro 25"]].map(([v, label]) => (
                    <button key={v} aria-pressed={thickness === v} onClick={() => setThickness(v as number)}>{label}</button>
                  ))}
                </div>
              </section>
            )}
            {!selection && tool === "room" && (
              <section className="ed-section">
                <h3>Estancia nueva</h3>
                <div className="seg" role="group" aria-label="Modo">
                  <button aria-pressed={!roomManual} onClick={() => { setRoomManual(false); setPath([]); }}>Clic dentro</button>
                  <button aria-pressed={roomManual} onClick={() => { setRoomManual(true); setPath([]); }}>Contorno a mano</button>
                </div>
                {roomManual && <p className="muted small">Marca los vértices. Intro, doble clic o un clic en el primer punto la cierra. Sirve para zonas abiertas, como una cocina sin paredes.</p>}
              </section>
            )}
            {!selection && tool === "furniture" && (
              <section className="ed-section">
                <h3>Muebles</h3>
                <div className="ed-palette">
                  {FURNITURE.map(f => <button key={f.type} aria-pressed={furnType === f.type} onClick={() => setFurnType(f.type)}>{f.label}{f.model ? " ·3D" : ""}</button>)}
                </div>
                <p className="muted small">«·3D» usa un modelo realista. Los demás son piezas hechas por código.</p>
              </section>
            )}
            {tool === "scale" && backdrop && (
              <section className="ed-section">
                <h3>Escala del plano</h3>
                <p className="muted small">{path.length < 2 ? `Marca ${path.length ? "el segundo extremo" : "el primer extremo"} de una medida: una cota o el ancho de una puerta.` : "¿Cuánto mide en la realidad?"}</p>
                {path.length === 2 && (
                  <form className="ed-scale" onSubmit={e => { e.preventDefault(); applyScale(); }}>
                    <label className="ed-field" htmlFor="ed-real">
                      <span>Medida real</span>
                      <span className="ed-input-unit"><input id="ed-real" autoFocus inputMode="decimal" value={scaleText} onChange={e => setScaleText(e.target.value)} /><small>m</small></span>
                    </label>
                    <button className="btn" type="submit">Aplicar</button>
                  </form>
                )}
              </section>
            )}
            {selection && !live && <SelectionPanel floor={floorOf(model)} selection={selection} apply={commit} onSelect={setSelection} onDelete={deleteSelection} focusName={selection.kind === "room" && selection.id === newRoom} />}
            {backdrop && (
              <section className="ed-section">
                <h3>Plano de fondo</h3>
                <p className="muted small ed-filename">{backdrop.name}</p>
                <label className="ed-field">
                  <span>Opacidad</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={backdrop.opacity} onChange={e => setBackdrop({ ...backdrop, opacity: Number(e.target.value) })} />
                </label>
                <label className="ed-check"><input type="checkbox" checked={backdrop.visible} onChange={e => setBackdrop({ ...backdrop, visible: e.target.checked })} /><span>Mostrar el plano</span></label>
              </section>
            )}
            {!selection && <ModelPanel model={model} onModel={commitModel} warnings={warnings} />}
          </aside>
        </div>
      )}
    </div>
  );
}

/** Lista de borradores: empezar uno nuevo, abrir un archivo o copiar un inmueble. */
export function EditorHome() {
  const [drafts, setDrafts] = useState(listDrafts);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const agency = CATALOG[0].model.agency;

  useEffect(() => { document.title = "Editor de Umbral"; }, []);

  const open = (model: UmbralModel) => {
    const id = newDraftId();
    if (!saveDraft({ id, model })) { setError("Este navegador no permite guardar borradores. Revisa el almacenamiento del sitio."); return; }
    location.hash = `#/editor/${id}`;
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = await readFromFile(f);
    if (r.model) open(r.model); else setError(r.check.errors[0]);
  };

  return (
    <div className="app" style={{ "--brand": agency.color } as CSSProperties}>
      <header className="top">
        <div className="title">
          <h1>Editor de Umbral</h1>
          <p className="muted">Prepara una vivienda a partir de su plano. Todo se queda en este ordenador.</p>
        </div>
        <a className="back-link" href="#/">Ver los inmuebles</a>
      </header>
      <main className="content home">
        <div className="ed-home">
          <section>
            <div className="row">
              <button className="btn" onClick={() => open(blankModel(agency))}>Nueva vivienda</button>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>Abrir archivo .umbral.json</button>
              <input ref={fileRef} id="ed-open" type="file" accept=".json,application/json" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            {error && <p className="msg error" role="alert">{error}</p>}
          </section>

          <section>
            <h2>Borradores</h2>
            {drafts.length === 0
              ? <p className="muted">Aún no hay borradores. Se guardan solos en este navegador; para conservarlos, usa «Guardar archivo».</p>
              : (
                <ul className="ed-list">
                  {drafts.map(d => (
                    <li key={d.id}>
                      <a href={`#/editor/${d.id}`}><strong>{d.model.property.title}</strong></a>
                      <span className="muted small">{new Date(d.updatedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</span>
                      <button className="link" onClick={() => { if (confirm(`¿Eliminar el borrador "${d.model.property.title}"?`)) { removeDraft(d.id); setDrafts(listDrafts()); } }}>Eliminar</button>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section>
            <h2>Editar una copia</h2>
            <ul className="ed-list">
              {CATALOG.map(c => (
                <li key={c.id}>
                  <strong>{c.model.property.title}</strong>
                  <button className="link" onClick={() => open(structuredClone(c.model))}>Copiar y editar</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
