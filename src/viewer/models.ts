import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Furniture } from "../model/types";

/** Reflejo del entorno, común a las formas básicas y a los glTF. */
export const ENV_INTENSITY = 0.55;

const loader = new GLTFLoader();
const cache = new Map<string, Promise<any>>();

/** Carga un glTF una sola vez por dirección; las copias comparten geometría. */
export function loadModel(url: string): Promise<any> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((ok, ko) => loader.load(url, (g: any) => ok(g.scene), undefined, ko));
    cache.set(url, p);
  }
  return p;
}

/**
 * Rumbo del frente del mueble en grados (0 = norte, 90 = este): el indicado en
 * el modelo o, si falta, de espaldas a la pared más cercana.
 */
export function furnitureHeading(f: Furniture, nearWall: (x: number, y: number) => number): number {
  if (f.heading !== undefined) return f.heading;
  const { x, y, w, d } = f;
  const backs: [number, number][] = [
    [nearWall(x + w / 2, y), 0],
    [nearWall(x, y + d / 2), 90],
    [nearWall(x + w / 2, y + d), 180],
    [nearWall(x + w, y + d / 2), 270],
  ];
  return backs.sort((a, b) => a[0] - b[0])[0][1];
}

/**
 * Copia de un modelo ajustada al rectángulo del mueble, apoyada en el suelo.
 * (px, pz) es el centro del rectángulo en coordenadas de la escena. Los glTF
 * miran hacia +Z; sin `h`, la altura se escala con la media de la planta.
 */
export function fitModel(src: any, f: Furniture, heading: number, px: number, pz: number) {
  const inner = src.clone(true);
  inner.rotation.y = Math.PI - (heading * Math.PI) / 180;
  const outer = new THREE.Group();
  outer.add(inner);
  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(outer);
  const size = box.getSize(new THREE.Vector3());
  const sx = f.w / size.x, sz = f.d / size.z;
  const sy = f.h !== undefined ? f.h / size.y : (sx + sz) / 2;
  outer.scale.set(sx, sy, sz);
  const c = box.getCenter(new THREE.Vector3());
  outer.position.set(px - c.x * sx, -box.min.y * sy, pz - c.z * sz);
  outer.traverse((o: any) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.shared = true; o.material.envMapIntensity = ENV_INTENSITY; }
  });
  return outer;
}
