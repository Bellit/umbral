import { useRef, useState } from "react";
import type { UmbralModel } from "../model/types";
import { downloadModel, loadSettings, readFromFile, saveSettings, type ReaderSettings } from "../io/readers";

interface Props { model: UmbralModel; onLoad: (m: UmbralModel) => void; onClose: () => void }

/**
 * Panel de trabajo (solo para quien prepara la ficha, no para el comprador):
 * abrir un modelo, guardarlo en el ordenador y elegir el lector.
 */
export function Settings({ model, onLoad, onClose }: Props) {
  const [s, setS] = useState<ReaderSettings>(loadSettings);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; lines: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<ReaderSettings>) => { const n = { ...s, ...patch }; setS(n); saveSettings(n); };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = await readFromFile(f);
    if (r.model) {
      onLoad(r.model);
      setMsg({ kind: "ok", lines: [`"${r.model.meta.title}" abierto.`, ...r.check.warnings] });
    } else {
      setMsg({ kind: "error", lines: r.check.errors });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="settings" role="dialog" aria-label="Ajustes de Umbral">
      <div className="settings-head">
        <h2>Ajustes</h2>
        <button className="link" onClick={onClose}>Cerrar</button>
      </div>

      <section>
        <h3>Modelo de la vivienda</h3>
        <p className="muted small">Los modelos se guardan en tu ordenador como archivos <code>.umbral.json</code>.</p>
        <div className="row">
          <button className="btn" onClick={() => fileRef.current?.click()}>Abrir modelo…</button>
          <button className="btn ghost" onClick={() => downloadModel(model)}>Guardar en el ordenador</button>
          <input id="umbral-file" ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => onFile(e.target.files?.[0])} />
        </div>
        {msg && <ul className={`msg ${msg.kind}`}>{msg.lines.map(l => <li key={l}>{l}</li>)}</ul>}
      </section>

      <section>
        <h3>Lector de planos</h3>
        <label className="radio">
          <input id="reader-claude" type="radio" name="reader" checked={s.reader === "claude-file"} onChange={() => update({ reader: "claude-file" })} />
          <span><b>Archivo de Claude</b> (recomendado). Claude de escritorio lee el plano, las fotos y el vídeo con la skill de Umbral y te entrega un archivo que abres aquí.</span>
        </label>
        <label className="radio">
          <input id="reader-api" type="radio" name="reader" checked={s.reader === "anthropic-api"} onChange={() => update({ reader: "anthropic-api" })} />
          <span><b>API de Anthropic</b>. Umbral leerá los planos directamente. Necesita una clave de API con créditos; disponible en una próxima versión.</span>
        </label>
        {s.reader === "anthropic-api" && (
          <div className="api-box">
            <label htmlFor="api-key">Clave de API</label>
            <input id="api-key" type="password" autoComplete="off" placeholder="sk-ant-…" value={s.apiKey ?? ""} onChange={e => update({ apiKey: e.target.value })} />
            <label htmlFor="api-model">Modelo</label>
            <input id="api-model" type="text" value={s.apiModel ?? ""} onChange={e => update({ apiModel: e.target.value })} />
            <p className="muted small">La clave se guarda solo en este navegador. No la uses en un ordenador compartido.</p>
          </div>
        )}
      </section>
    </div>
  );
}
