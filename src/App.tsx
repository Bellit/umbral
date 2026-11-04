import { Suspense, lazy, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { UmbralModel } from "./model/types";
import { floorAreas, fmt } from "./model/geometry";
import { CATALOG } from "./demo/catalog";
import { isEditor, resolveAsset } from "./env";
import { Viewer3D } from "./viewer/Viewer3D";
import { Plan2D } from "./plan/Plan2D";
import { Photos } from "./ui/Photos";
import { AgencyCard } from "./ui/AgencyCard";
import { AgencyBrand } from "./ui/AgencyBrand";
import { Home } from "./ui/Home";
import { Settings } from "./ui/Settings";

type Tab = "recorrido" | "plano" | "fotos" | "inmobiliaria";
const TABS: { id: Tab; label: string }[] = [
  { id: "recorrido", label: "Recorrido 3D" },
  { id: "plano", label: "Plano" },
  { id: "fotos", label: "Fotos" },
  { id: "inmobiliaria", label: "Inmobiliaria" },
];

// el editor se descarga solo si se abre: el comprador no carga ese código
const Editor = lazy(() => import("./editor/Editor").then(m => ({ default: m.Editor })));
const EditorHome = lazy(() => import("./editor/Editor").then(m => ({ default: m.EditorHome })));

/** Rutas con # porque funcionan en cualquier alojamiento estático. */
function routeFromHash() {
  const property = /^#\/inmueble\/([\w-]+)$/.exec(location.hash)?.[1];
  if (property) return { page: "property" as const, id: property };
  const draft = /^#\/editor\/([\w-]+)$/.exec(location.hash)?.[1];
  if (isEditor() && draft) return { page: "editor" as const, id: draft };
  if (isEditor() && location.hash === "#/editor") return { page: "editor-home" as const, id: "" };
  return { page: "home" as const, id: "" };
}

export function App() {
  const [route, setRoute] = useState(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.page === "editor" || route.page === "editor-home") {
    return <Suspense fallback={<p className="ed-loading">Abriendo el editor…</p>}>{route.page === "editor" ? <Editor key={route.id} draftId={route.id} /> : <EditorHome />}</Suspense>;
  }
  const entry = route.page === "property" ? CATALOG.find(e => e.id === route.id) : undefined;
  return entry ? <PropertySheet key={entry.id} initial={entry.model} /> : <Home entries={CATALOG} editor={isEditor()} />;
}

/** Ficha de un inmueble: cuatro pestañas y el pie "Powered by Umbral". */
function PropertySheet({ initial }: { initial: UmbralModel }) {
  const [model, setModel] = useState(initial);
  const [tab, setTab] = useState<Tab>("recorrido");
  const [floorIdx, setFloorIdx] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const floor = model.floors[Math.min(floorIdx, model.floors.length - 1)];
  const total = useMemo(() => model.floors.reduce((s, f) => s + floorAreas(f).total, 0), [model]);
  const editor = isEditor();

  useEffect(() => { document.title = `${model.property.title} · ${model.agency.name}`; }, [model]);

  const brand = { "--brand": model.agency.color } as CSSProperties;

  return (
    <div className="app" style={brand}>
      <header className="top">
        <AgencyBrand agency={model.agency} />
        <div className="title">
          <h1>{model.property.title}</h1>
          <p className="muted">
            {model.property.address ? `${model.property.address} · ` : ""}≈ {fmt(total, 0)} m² útiles
            {model.property.price ? ` · ${model.property.price}` : ""}
          </p>
        </div>
        <a className="back-link" href="#/">Todos los inmuebles</a>
      </header>

      {model.meta.example && <div className="example-banner">Demostración con datos de ejemplo: la inmobiliaria y sus datos son ficticios.</div>}

      <nav className="tabs" aria-label="Secciones del inmueble">
        {TABS.filter(t => t.id !== "fotos" || model.photos.length > 0).map(t => <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
        {model.floors.length > 1 && (
          <select id="floor-select" aria-label="Planta" value={floorIdx} onChange={e => setFloorIdx(Number(e.target.value))}>
            {model.floors.map((f, i) => <option key={f.id} value={i}>{f.name}</option>)}
          </select>
        )}
      </nav>

      <main className={`content tab-${tab}`}>
        {tab === "recorrido" && <Viewer3D floor={floor} resolve={resolveAsset} />}
        {tab === "plano" && <Plan2D floor={floor} />}
        {tab === "fotos" && <Photos photos={model.photos} resolve={resolveAsset} />}
        {tab === "inmobiliaria" && <AgencyCard agency={model.agency} property={model.property} />}
      </main>

      <footer className="foot">
        <span>Recorrido virtual orientativo, generado a partir del plano y las fotos del inmueble.</span>
        <span className="powered">
          {editor && <button className="link" onClick={() => setShowSettings(true)}>Ajustes</button>}
          Powered by <b>Umbral</b>
        </span>
      </footer>

      {showSettings && <Settings model={model} onLoad={m => { setModel(m); setFloorIdx(0); }} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
