import type { Agency } from "../model/types";

/** Logo y nombre de la inmobiliaria, en la cabecera. */
export function AgencyBrand({ agency }: { agency: Agency }) {
  return (
    <div className="brand">
      {agency.logoUrl
        ? <img src={agency.logoUrl} alt={agency.name} className="logo-img" />
        : <span className="logo-badge">{agency.logoText ?? agency.name.slice(0, 2)}</span>}
      <span className="agency-name">{agency.name}</span>
    </div>
  );
}
