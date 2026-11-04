import { useState } from "react";
import type { Agency, Property } from "../model/types";

interface Props { agency: Agency; property: Property }

function CopyLine({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* el texto se puede seleccionar */ }
  };
  return (
    <div className="contact-line">
      <dt>{label}</dt>
      <dd><span className="selectable">{value}</span> <button className="link" onClick={copy}>{done ? "Copiado" : "Copiar"}</button></dd>
    </div>
  );
}

/** Pestaña "Inmobiliaria": datos del inmueble y contacto. */
export function AgencyCard({ agency, property }: Props) {
  return (
    <div className="agency">
      <section className="card">
        <h3>{property.title}</h3>
        {property.address && <p className="muted">{property.address}</p>}
        {property.price && <p className="price">{property.price}</p>}
        {property.description && <p>{property.description}</p>}
        {property.features && (
          <dl className="features">
            {property.features.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
          </dl>
        )}
      </section>
      <section className="card">
        <div className="agency-head">
          {agency.logoUrl ? <img src={agency.logoUrl} alt={agency.name} className="logo-img" /> : <span className="logo-badge">{agency.logoText ?? agency.name.slice(0, 2)}</span>}
          <div>
            <h3>{agency.name}</h3>
            {agency.agent && <p className="muted">Te atiende {agency.agent}</p>}
          </div>
        </div>
        <dl className="contact">
          {agency.phone && <CopyLine label="Teléfono" value={agency.phone} />}
          {agency.email && <CopyLine label="Correo" value={agency.email} />}
          {agency.web && <CopyLine label="Web" value={agency.web} />}
          {agency.address && <CopyLine label="Oficina" value={agency.address} />}
        </dl>
        {agency.example && <p className="example-note">Inmobiliaria y datos de contacto ficticios, solo para demostración.</p>}
      </section>
    </div>
  );
}
