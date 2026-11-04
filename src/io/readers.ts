import type { UmbralModel } from "../model/types";
import { validateModel, type ValidationResult } from "../model/validate";

/**
 * Un "lector" convierte el material de una vivienda (plano, fotos, vídeo)
 * en un modelo de Umbral. Hay dos:
 *
 *  - "claude-file": la lectura la hace Claude de escritorio con la skill de
 *    Umbral y entrega un archivo .umbral.json que aquí solo se importa.
 *  - "anthropic-api": Umbral llama directamente a la API de Anthropic.
 *    Queda preparado, pero desactivado hasta que haya una clave.
 *
 * Los dos devuelven el mismo formato, así que el resto de la app no cambia.
 */
export type ReaderId = "claude-file" | "anthropic-api";

export interface ReaderSettings {
  reader: ReaderId;
  apiKey?: string;
  apiModel?: string;
}

export interface ReadResult { model?: UmbralModel; check: ValidationResult }

const KEY = "umbral.settings";

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { reader: "claude-file", ...JSON.parse(raw) };
  } catch { /* sin almacenamiento: valores por defecto */ }
  return { reader: "claude-file", apiModel: "claude-sonnet-5-5" };
}

export function saveSettings(s: ReaderSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignorar */ }
}

/** Lector por archivo: abre un .umbral.json elegido por el usuario. */
export async function readFromFile(file: File): Promise<ReadResult> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { check: { ok: false, errors: [`"${file.name}" no es un archivo JSON válido.`], warnings: [] } };
  }
  const check = validateModel(data);
  return { model: check.ok ? (data as UmbralModel) : undefined, check };
}

/**
 * Lector por API (preparado para más adelante).
 * Enviará las imágenes y las instrucciones de la skill de Umbral a la API de
 * Anthropic y validará la respuesta con el mismo validador.
 */
export async function readWithApi(_files: File[], settings: ReaderSettings): Promise<ReadResult> {
  if (!settings.apiKey) {
    return { check: { ok: false, errors: ["Falta la clave de API. Añádela en Ajustes o usa el lector por archivo de Claude."], warnings: [] } };
  }
  return { check: { ok: false, errors: ["La lectura por API aún no está activada en esta versión. Usa el lector por archivo de Claude."], warnings: [] } };
}

/** Guarda el modelo en el ordenador del usuario como archivo .umbral.json. */
export function downloadModel(model: UmbralModel): void {
  const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${model.meta.title.replace(/[^\w\- ]+/g, "").trim() || "vivienda"}.umbral.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
