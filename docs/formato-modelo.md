# Formato del modelo de Umbral · `umbral.model/1`

Un archivo `.umbral.json` describe una vivienda completa: la inmobiliaria, el inmueble,
sus plantas y sus fotos. Es el contrato entre todas las piezas:

- la **skill de Umbral para Claude de escritorio** lo genera a partir de plano, fotos y vídeo;
- el **lector por API** (más adelante) generará exactamente lo mismo;
- el **editor** lo corrige y el **visor** lo muestra.

La definición exacta, con comentarios, está en `src/model/types.ts`. El validador
`src/model/validate.ts` comprueba un archivo antes de abrirlo.

## Reglas generales

- Unidades en **metros**; alturas en metros desde el suelo de la planta.
- Coordenadas de planta `[x, y]`: x hacia la derecha (este), y hacia arriba (norte),
  como en un plano visto desde arriba. El origen es libre; conviene una esquina del piso.
- Cada planta es independiente (`floors[]`), con su `level` (0 = planta baja).
- `measured: false` marca medidas estimadas; el visor las muestra con «≈».
- `example: true` en `meta` o `agency` marca datos ficticios de demostración.

## Estructura

```
{
  "schema": "umbral.model/1",
  "meta":     { "title", "createdAt", "units": "m", "source", "example"?, "notes"? },
  "agency":   { "name", "color", "logoText"?, "logoUrl"?, "phone"?, "email"?, "web"?, "address"?, "agent"? },
  "property": { "title", "address"?, "price"?, "description"?, "features"?: [{ "label", "value" }] },
  "floors": [{
    "id", "name", "level", "height",
    "rooms":     [{ "id", "name", "polygon": [[x,y],…], "finish": "tile|wood|bath|concrete", "label"?: [x,y], "measured"?, "area"?, "outdoor"? }],
    "walls":     [{ "id", "a": [x,y], "b": [x,y], "thickness" }],
    "openings":  [{ "id", "kind": "door|passage|window|balcony", "a", "b", "sill"?, "head"?,
                    "door"?: { "hinge": [x,y], "openTo": [x,y], "glazed"?, "entrance"? } }],
    "furniture": [{ "id", "type", "label"?, "x", "y", "w", "d", "polygon"?, "h"?, "model"?, "heading"? }],
    "entrance"?: { "x", "y", "heading" }
  }],
  "photos": [{ "src", "caption", "room"? }]
}
```

## Detalles

- **Estancias**: `area` es la superficie escrita en el plano, en m²; manda sobre la calculada
  del contorno. `outdoor: true` marca patios y porches: sin techo y fuera del total útil.
- **Paredes**: segmentos continuos por su eje. Las puertas y ventanas no parten la pared
  en el archivo; el visor la corta donde cae cada hueco (`openings`), que debe estar sobre
  el eje de una pared.
- **Puertas**: `hinge` es la bisagra (uno de los extremos del hueco) y `openTo` el extremo
  de la hoja abierta. El sentido de apertura sale de ahí.
- **Ventanas**: `sill` (antepecho) y `head` (dintel). Por defecto 0,90 y 2,10 m.
  Una `balcony` (balconera) llega al suelo.
- **Muebles**: rectángulo en planta (`x`, `y` = esquina inferior izquierda; `w` en x, `d` en y)
  o `polygon` para piezas en L. Tipos: `bed`, `bunk`, `sofa`, `kitchen`, `island`, `table`,
  `desk`, `chair`, `wardrobe`, `nightstand`, `tv`, `fridge`, `sink`, `wc`, `bidet`, `bathtub`,
  `shower`, `shelf`, `sideboard`, `cabinet`, `stairs`, `other`. Todos cortan el paso en el recorrido,
  salvo `shower`.
- **Modelos de mueble**: `model` es la ruta de un glTF o GLB (relativa a `public/`), que
  sustituye a la forma básica y se ajusta al rectángulo `w` × `d`, apoyado en el suelo; sin
  `h`, la altura se escala con la media de la planta. Si no carga, se queda la forma básica.
  El glTF debe mirar hacia +Z. `heading` indica hacia dónde mira el frente en planta, en
  grados (0 = norte, 90 = este); si falta, el mueble queda de espaldas a la pared más cercana.
  También orienta las formas básicas: frente de armarios y aparadores, cabecero de la cama,
  cisterna del inodoro…
  Una mesa o un escritorio con `model` pierden las sillas automáticas: añádelas como piezas
  `chair`.
- **Entrada**: punto donde empieza el recorrido en primera persona; `heading` en grados,
  0 = norte, 90 = este.
