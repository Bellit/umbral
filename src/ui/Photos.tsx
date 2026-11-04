import { useEffect, useState } from "react";
import type { Photo } from "../model/types";

interface Props { photos: Photo[]; resolve: (src: string) => string }

/** Pestaña "Fotos": galería con visor ampliado. */
export function Photos({ photos, resolve }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen(i => (i === null ? i : (i + 1) % photos.length));
      if (e.key === "ArrowLeft") setOpen(i => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, photos.length]);

  if (!photos.length) return <p className="empty">Este inmueble todavía no tiene fotos.</p>;

  return (
    <>
      <ul className="gallery">
        {photos.map((p, i) => (
          <li key={p.src}>
            <button onClick={() => setOpen(i)} aria-label={`Ampliar: ${p.caption}`}>
              <img src={resolve(p.src)} alt={p.caption} loading="lazy" />
            </button>
            <span>{p.caption}</span>
          </li>
        ))}
      </ul>
      {open !== null && (
        <div className="lightbox" role="dialog" aria-label={photos[open].caption} onClick={() => setOpen(null)}>
          <img src={resolve(photos[open].src)} alt={photos[open].caption} onClick={e => e.stopPropagation()} />
          <div className="lightbox-bar" onClick={e => e.stopPropagation()}>
            <button onClick={() => setOpen((open - 1 + photos.length) % photos.length)} aria-label="Foto anterior">◀</button>
            <span>{photos[open].caption} · {open + 1} de {photos.length}</span>
            <button onClick={() => setOpen((open + 1) % photos.length)} aria-label="Foto siguiente">▶</button>
            <button onClick={() => setOpen(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </>
  );
}
