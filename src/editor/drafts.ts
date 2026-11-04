import type { UmbralModel } from "../model/types";

/** Colocación del plano de fondo, recordada por nombre y tamaño del archivo. La imagen no se guarda. */
export interface TraceMemory { name: string; size: number; metersPerPx: number; x: number; y: number }

export interface Draft { id: string; model: UmbralModel; updatedAt: string; trace?: TraceMemory }

/** Borradores del editor: solo en este navegador, nada sale del ordenador. */
const KEY = "umbral.drafts.v1";

function readAll(): Record<string, Draft> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* sin almacenamiento: sin borradores */ }
  return {};
}

export function listDrafts(): Draft[] {
  return Object.values(readAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getDraft(id: string): Draft | null {
  return readAll()[id] ?? null;
}

/** Devuelve false si el navegador no ha podido guardarlo. */
export function saveDraft(draft: Omit<Draft, "updatedAt">): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [draft.id]: { ...draft, updatedAt: new Date().toISOString() } }));
    return true;
  } catch { return false; }
}

export function removeDraft(id: string): void {
  const all = readAll();
  delete all[id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignorar */ }
}

export function newDraftId(): string {
  return `b${Date.now().toString(36)}`;
}
