import casaPatio from "./casa-patio.json";
import casaGaraje from "./casa-garaje.json";
import type { UmbralModel } from "../model/types";

export interface CatalogEntry { id: string; model: UmbralModel }

/**
 * Inmuebles privados: `src/privado/*.json`, fuera de git y solo con `npm run dev`.
 * Nunca entran en la versión publicada; el id es el nombre del archivo.
 */
const privados: Record<string, UmbralModel> = import.meta.env.DEV
  ? import.meta.glob<UmbralModel>("../privado/*.json", { eager: true, import: "default" })
  : {};

/** Inmuebles de la portada; el id es el que aparece en la dirección de cada ficha. */
export const CATALOG: CatalogEntry[] = [
  ...Object.entries(privados).map(([path, model]) => ({ id: path.replace(/^.*\/|\.json$/g, ""), model })),
  { id: "casa-patio", model: casaPatio as unknown as UmbralModel },
  { id: "casa-garaje", model: casaGaraje as unknown as UmbralModel },
];
