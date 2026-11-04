import { useEffect, useRef, useState } from "react";
import type { Floor } from "../model/types";
import { defaultDetail, UmbralScene, type Detail, type MoveKey, type ViewMode } from "./scene";

interface Props { floor: Floor; resolve: (src: string) => string }

/** Pestaña "Recorrido 3D": maqueta y paseo en primera persona. */
export function Viewer3D({ floor, resolve }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<UmbralScene | null>(null);
  const [mode, setMode] = useState<ViewMode>("maqueta");
  const [walls, setWalls] = useState<"cut" | "full">("cut");
  const [view, setView] = useState<"3d" | "top">("3d");
  const [labels, setLabels] = useState(true);
  const [detail, setDetail] = useState<Detail>(defaultDetail);
  const [room, setRoom] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!stageRef.current || !labelsRef.current) return;
    let s: UmbralScene;
    try {
      s = new UmbralScene(stageRef.current, labelsRef.current, { onRoomChange: setRoom, resolve });
    } catch (err) {
      console.error("Umbral: no se pudo iniciar el visor 3D", err);
      setFailed(true);
      return;
    }
    sceneRef.current = s;
    const bg = () => s.setBackground(getComputedStyle(stageRef.current!).backgroundColor);
    bg();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", bg);
    return () => { mq.removeEventListener?.("change", bg); s.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => { sceneRef.current?.setFloor(floor); }, [floor]);
  useEffect(() => { sceneRef.current?.setMinimap(miniRef.current); }, [mode]);

  const changeMode = (m: ViewMode) => {
    setMode(m);
    sceneRef.current?.setMode(m);
    if (m === "recorrido") stageRef.current?.focus({ preventScroll: true });
  };

  const hold = (k: MoveKey) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); sceneRef.current?.setKey(k, true); },
    onPointerUp: () => sceneRef.current?.setKey(k, false),
    onPointerLeave: () => sceneRef.current?.setKey(k, false),
    onPointerCancel: () => sceneRef.current?.setKey(k, false),
  });

  return (
    <div className="viewer">
      <div className="stage" ref={stageRef} tabIndex={0}>
        <div className="labels" ref={labelsRef} />
        {failed && <div className="stage-error">Este navegador no puede mostrar el 3D. Prueba con Chrome, Edge, Safari o Firefox actualizados.</div>}
        {mode === "recorrido" && (
          <div className="dock">
            <div className="dock-ctl">
              <div className="dock-room">{room || "—"}</div>
              <div className="pad">
                <button className="fw" aria-label="Avanzar" {...hold("f")}>▲</button>
                <button className="lt" aria-label="Girar a la izquierda" {...hold("l")}>◀</button>
                <button className="bk" aria-label="Retroceder" {...hold("b")}>▼</button>
                <button className="rt" aria-label="Girar a la derecha" {...hold("r")}>▶</button>
              </div>
              <div className="dock-keys">W A S D · flechas<br />arrastra para mirar</div>
            </div>
            <canvas className="mini" ref={miniRef} width={224} height={252} aria-label="Plano con tu posición" />
          </div>
        )}
      </div>
      <div className="viewer-bar">
        <div className="seg" role="group" aria-label="Modo">
          <button aria-pressed={mode === "maqueta"} onClick={() => changeMode("maqueta")}>Maqueta</button>
          <button aria-pressed={mode === "recorrido"} onClick={() => changeMode("recorrido")}>Recorrido</button>
        </div>
        {mode === "maqueta" && (
          <>
            <div className="seg" role="group" aria-label="Paredes">
              <button aria-pressed={walls === "cut"} onClick={() => { setWalls("cut"); sceneRef.current?.setWallHeight(1.1); }}>Paredes cortadas</button>
              <button aria-pressed={walls === "full"} onClick={() => { setWalls("full"); sceneRef.current?.setWallHeight(floor.height); }}>Altura real</button>
            </div>
            <div className="seg" role="group" aria-label="Vista">
              <button aria-pressed={view === "3d"} onClick={() => { setView("3d"); sceneRef.current?.setView("3d"); }}>3D</button>
              <button aria-pressed={view === "top"} onClick={() => { setView("top"); sceneRef.current?.setView("top"); }}>Planta</button>
            </div>
            <div className="seg" role="group" aria-label="Rótulos">
              <button aria-pressed={labels} onClick={() => { setLabels(true); sceneRef.current?.setLabels(true); }}>Con rótulos</button>
              <button aria-pressed={!labels} onClick={() => { setLabels(false); sceneRef.current?.setLabels(false); }}>Sin rótulos</button>
            </div>
          </>
        )}
        <div className="seg" role="group" aria-label="Detalle">
          <button aria-pressed={detail === "alto"} onClick={() => { setDetail("alto"); sceneRef.current?.setDetail("alto"); }}>Detalle alto</button>
          <button aria-pressed={detail === "ligero"} onClick={() => { setDetail("ligero"); sceneRef.current?.setDetail("ligero"); }}>Ligero</button>
        </div>
        <p className="viewer-hint">
          {mode === "maqueta"
            ? "Arrastra para girar, rueda o pellizco para acercar."
            : "Empiezas en la puerta de entrada, a 1,60 m de altura."}
        </p>
      </div>
    </div>
  );
}
