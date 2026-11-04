/**
 * Formato del modelo de Umbral (versión 1).
 *
 * Es la pieza común de todo el proyecto: la skill de Claude, la API, el editor
 * y el visor leen y escriben exactamente este formato.
 *
 * Unidades: metros. Coordenadas de planta: x hacia la derecha (este),
 * y hacia arriba (norte), vistas desde arriba como en un plano.
 */

export type Pt = [number, number];

export interface UmbralModel {
  schema: "umbral.model/1";
  meta: ModelMeta;
  agency: Agency;
  property: Property;
  floors: Floor[];
  photos: Photo[];
}

export interface ModelMeta {
  title: string;
  createdAt: string; // ISO 8601
  units: "m";
  /** De dónde salen los datos: "manual", "claude-desktop", "api-anthropic"… */
  source: string;
  /** true si los datos son de ejemplo y no deben tomarse como reales. */
  example?: boolean;
  notes?: string;
}

export interface Agency {
  name: string;
  /** Texto corto que se muestra como logo cuando no hay imagen. */
  logoText?: string;
  /** Logo como URL o data URI. */
  logoUrl?: string;
  /** Color principal de la marca, en hex (#rrggbb). */
  color: string;
  phone?: string;
  email?: string;
  web?: string;
  address?: string;
  agent?: string;
  example?: boolean;
}

export interface Property {
  title: string;
  address?: string;
  price?: string;
  description?: string;
  features?: { label: string; value: string }[];
}

export interface Photo {
  src: string;
  caption: string;
  /** id de la estancia que aparece en la foto. */
  room?: string;
}

export interface Floor {
  id: string;
  name: string;
  /** 0 = planta baja, 1 = primera, -1 = sótano… */
  level: number;
  /** Altura libre de la planta, en metros. */
  height: number;
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
  /** Punto de inicio del recorrido: posición y rumbo en grados (0 = norte). */
  entrance?: { x: number; y: number; heading: number };
}

export type FloorFinish = "tile" | "wood" | "bath" | "concrete";

export interface Room {
  id: string;
  name: string;
  polygon: Pt[];
  finish: FloorFinish;
  /** Posición del rótulo; si falta, se usa el centro del polígono. */
  label?: Pt;
  /** true si las medidas las ha tomado una persona; false si son estimadas. */
  measured?: boolean;
  /** Superficie escrita en el plano, en m²; si falta, se calcula del contorno. */
  area?: number;
  /** Patio o porche: sin techo y fuera del total de superficie útil. */
  outdoor?: boolean;
}

export interface Wall {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
}

export type OpeningKind = "door" | "passage" | "window" | "balcony";

export interface Opening {
  id: string;
  kind: OpeningKind;
  /** Extremos del hueco, sobre el eje de la pared. */
  a: Pt;
  b: Pt;
  /** Altura del antepecho (ventanas). */
  sill?: number;
  /** Altura del dintel. */
  head?: number;
  door?: DoorLeaf;
}

export interface DoorLeaf {
  /** Bisagra, en uno de los extremos del hueco. */
  hinge: Pt;
  /** Extremo de la hoja cuando la puerta está abierta. */
  openTo: Pt;
  glazed?: boolean;
  entrance?: boolean;
}

export type FurnitureType =
  | "bed" | "bunk" | "sofa" | "kitchen" | "island" | "table" | "desk"
  | "chair" | "wardrobe" | "nightstand" | "tv" | "fridge" | "sink"
  | "wc" | "bidet" | "bathtub" | "shower" | "shelf" | "sideboard"
  | "cabinet" | "stairs" | "other";

export interface Furniture {
  id: string;
  type: FurnitureType;
  label?: string;
  /** Rectángulo en planta: esquina inferior izquierda y tamaño. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Forma en planta para piezas no rectangulares (sofá en L, cocina en L). */
  polygon?: Pt[];
  /** Altura, si se conoce. */
  h?: number;
  /** Modelo 3D de catálogo (glTF) para sustituir la forma básica. */
  model?: string;
  /** Hacia dónde mira el frente del modelo, en grados (0 = norte, 90 = este). */
  heading?: number;
}
