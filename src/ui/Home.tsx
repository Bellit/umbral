import { useEffect, type CSSProperties } from "react";
import type { CatalogEntry } from "../demo/catalog";
import { floorAreas, fmt } from "../model/geometry";
import { PlanDrawing } from "../plan/Plan2D";
import { AgencyBrand } from "./AgencyBrand";

interface Props { entries: CatalogEntry[]; editor: boolean }

/** Portada: los inmuebles de la inmobiliaria, cada uno con su plano y un enlace a su ficha. */
export function Home({ entries, editor }: Props) {
  const agency = entries[0].model.agency;
  useEffect(() => { document.title = `${agency.name} · Inmuebles`; }, [agency.name]);

  return (
    <div className="app" style={{ "--brand": agency.color } as CSSProperties}>
      <header className="top">
        <AgencyBrand agency={agency} />
        <div className="title">
          <h1>Inmuebles</h1>
          <p className="muted">{entries.length} {entries.length === 1 ? "vivienda" : "viviendas"} para recorrer en 3D</p>
        </div>
        {editor && <a className="back-link" href="#/editor">Editor</a>}
      </header>

      {entries.some(e => e.model.meta.example) && <div className="example-banner">Demostración con datos de ejemplo: la inmobiliaria y sus datos son ficticios.</div>}

      <main className="content home">
        <ul className="listing">
          {entries.map(({ id, model }) => {
            const total = model.floors.reduce((s, f) => s + floorAreas(f).total, 0);
            const beds = model.property.features?.find(f => f.label === "Dormitorios")?.value;
            const baths = model.property.features?.find(f => f.label === "Baños")?.value;
            return (
              <li key={id}>
                <a className="property" href={`#/inmueble/${id}`}>
                  <div className="property-plan"><PlanDrawing floor={model.floors[0]} labels={false} /></div>
                  <div className="property-body">
                    <h2>{model.property.title}</h2>
                    <p className="muted">{[model.property.address, model.property.price].filter(Boolean).join(" · ")}</p>
                    <dl className="property-facts">
                      <div><dt>Superficie</dt><dd>≈ {fmt(total, 0)} m²</dd></div>
                      {beds && <div><dt>Dormitorios</dt><dd>{beds}</dd></div>}
                      {baths && <div><dt>Baños</dt><dd>{baths}</dd></div>}
                    </dl>
                    <span className="property-cta">Ver ficha y recorrido 3D</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </main>

      <footer className="foot">
        <span>Recorridos virtuales orientativos, generados a partir del plano de cada inmueble.</span>
        <span className="powered">Powered by <b>Umbral</b></span>
      </footer>
    </div>
  );
}
