import * as THREE from "three";

/** Pseudoaleatorio estable: la textura sale igual cada vez. */
function rnd(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, sizeM: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / sizeM, 1 / sizeM);
  t.anisotropy = 4;
  t.encoding = THREE.sRGBEncoding;
  return t;
}

/** Baldosa cerámica beige colocada en diagonal (recibidor, cocina, salón). */
function tile() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#e7d9c3"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${(180 + rnd(i) * 40) | 0},${(160 + rnd(i + 3) * 30) | 0},130,0.08)`;
      g.beginPath(); g.arc(rnd(i + 1) * w, rnd(i + 2) * h, 10 + rnd(i + 5) * 30, 0, 7); g.fill();
    }
    g.strokeStyle = "#c9b89e"; g.lineWidth = 3; g.beginPath();
    g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.moveTo(w / 2, h); g.lineTo(w, h / 2);
    g.moveTo(0, h / 2); g.lineTo(w / 2, h); g.moveTo(w / 2, 0); g.lineTo(w, h / 2);
    g.stroke();
  }, 0.9);
}

/** Parquet de roble con lamas de largos distintos. */
function wood() {
  return canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = "#c08a55"; g.fillRect(0, 0, w, h);
    const cols = 8, pw = w / cols;
    for (let c = 0; c < cols; c++) {
      let y = -rnd(c + 11) * h * 0.6, k = 0;
      while (y < h) {
        const L = h * (0.35 + rnd(c * 31 + k) * 0.35), tt = rnd(c * 17 + k * 3);
        g.fillStyle = `hsl(${27 + tt * 7},${42 + tt * 12}%,${50 + tt * 12}%)`;
        g.fillRect(c * pw, y, pw, L);
        for (let q = 0; q < 9; q++) {
          g.strokeStyle = `rgba(95,58,28,${0.05 + rnd(c * 7 + k * 5 + q) * 0.07})`;
          g.lineWidth = 1 + rnd(q + k) * 2;
          const xx = c * pw + 6 + rnd(c * 3 + q * 7 + k) * (pw - 12);
          g.beginPath(); g.moveTo(xx, y); g.bezierCurveTo(xx + 5, y + L * 0.3, xx - 5, y + L * 0.7, xx + 2, y + L); g.stroke();
        }
        g.fillStyle = "rgba(80,48,20,.28)"; g.fillRect(c * pw, y, pw, 2);
        y += L; k++;
      }
      g.fillStyle = "rgba(80,48,20,.22)"; g.fillRect(c * pw, 0, 2, h);
    }
  }, 1.2);
}

/** Gresite / baldosa pequeña de baño. */
function bath() {
  return canvasTexture(256, 256, (g, w, h) => {
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const t = rnd(i * 13 + j);
      g.fillStyle = `hsl(32,${14 + t * 8}%,${62 + t * 12}%)`; g.fillRect(i * s, j * s, s, s);
    }
    g.strokeStyle = "#efe8dc"; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
  }, 1.2);
}

/** Solera de hormigón con manchas suaves (garajes). */
function concrete() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = "#a9a8a3"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const v = (140 + rnd(i) * 50) | 0;
      g.fillStyle = `rgba(${v},${v},${v - 4},0.07)`;
      g.beginPath(); g.arc(rnd(i + 1) * w, rnd(i + 2) * h, 12 + rnd(i + 5) * 50, 0, 7); g.fill();
    }
  }, 2.5);
}

let cache: Record<string, any> | null = null;
export function floorTextures(): Record<string, any> {
  if (!cache) cache = { tile: tile(), wood: wood(), bath: bath(), concrete: concrete() };
  return cache;
}
