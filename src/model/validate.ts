import type { UmbralModel } from "./types";

export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[] }

const isPt = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number" && Number.isFinite(n));

/**
 * Comprueba que un archivo tiene el formato de Umbral antes de abrirlo.
 * Los mensajes están pensados para el usuario: dicen qué falla y dónde.
 */
export function validateModel(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const m = data as Partial<UmbralModel>;
  if (!m || typeof m !== "object") return { ok: false, errors: ["El archivo no contiene un modelo de Umbral."], warnings };
  if (m.schema !== "umbral.model/1") errors.push(`Versión de formato no reconocida: "${String(m.schema)}". Se esperaba "umbral.model/1".`);
  if (!m.agency?.name) warnings.push("Falta el nombre de la inmobiliaria.");
  if (!m.property?.title) warnings.push("Falta el título del inmueble.");
  if (!Array.isArray(m.floors) || m.floors.length === 0) errors.push("El modelo no tiene ninguna planta.");
  (m.floors ?? []).forEach((f, fi) => {
    const where = `Planta ${fi + 1} (${f?.name ?? "sin nombre"})`;
    if (!Array.isArray(f.rooms) || f.rooms.length === 0) errors.push(`${where}: no tiene estancias.`);
    if (!Array.isArray(f.walls) || f.walls.length === 0) errors.push(`${where}: no tiene paredes.`);
    (f.rooms ?? []).forEach(r => {
      if (!Array.isArray(r.polygon) || r.polygon.length < 3 || !r.polygon.every(isPt)) errors.push(`${where}: la estancia "${r.name}" tiene un contorno no válido.`);
    });
    (f.walls ?? []).forEach(w => {
      if (!isPt(w.a) || !isPt(w.b)) errors.push(`${where}: la pared ${w.id} tiene coordenadas no válidas.`);
    });
    (f.openings ?? []).forEach(o => {
      if (!isPt(o.a) || !isPt(o.b)) errors.push(`${where}: el hueco ${o.id} tiene coordenadas no válidas.`);
    });
    if (!f.entrance) warnings.push(`${where}: sin punto de entrada; el recorrido empezará en el centro.`);
  });
  return { ok: errors.length === 0, errors, warnings };
}
