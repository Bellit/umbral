declare global { interface Window { __UMBRAL_ASSETS__?: Record<string, string>; __UMBRAL_EDITOR__?: boolean } }

/** Rutas de fotos y modelos: en la demo publicada vienen incrustadas; en local, de /public. */
export function resolveAsset(src: string): string {
  return window.__UMBRAL_ASSETS__?.[src] ?? `${import.meta.env.BASE_URL}${src}`;
}

/** Las herramientas de trabajo solo se muestran en local o con ?editar en la dirección. */
export function isEditor(): boolean {
  try {
    return Boolean(window.__UMBRAL_EDITOR__) || import.meta.env.DEV || new URLSearchParams(location.search).has("editar");
  } catch { return false; }
}
