# Umbral

Del plano de una vivienda a una ficha con recorrido virtual en 3D para inmobiliarias.

Versión 0.1 · fase 2: **ficha del inmueble** con cuatro pestañas (recorrido 3D, plano
con m², fotos e inmobiliaria) y el pie «Powered by Umbral». El recorrido tiene luz
natural, colisiones con paredes y muebles, y un detalle «Ligero» que se activa solo en
móviles.

La portada lista los inmuebles de la inmobiliaria (ficticia) y cada uno abre su ficha en
`#/inmueble/<id>`: dos casas transcritas a mano de planos de prueba. Para añadir uno, deja
su `.json` en `src/demo/` y regístralo en `src/demo/catalog.ts`.

### Inmuebles privados

Los archivos `src/privado/*.json` aparecen en la portada solo con `npm run dev`, y sus fotos
van en `public/privado/`. Ninguna de las dos carpetas se sube a git ni entra en `npm run build`.

## Ponerlo en marcha

1. Instala **Node.js 20 o superior** (versión LTS) desde nodejs.org. Solo la primera vez.
2. Abre una terminal en esta carpeta.
   En Windows: clic derecho sobre la carpeta → «Abrir en Terminal».
3. Instala las dependencias (solo la primera vez):

   ```
   npm install
   ```

4. Arranca la aplicación:

   ```
   npm run dev
   ```

5. Abre en el navegador la dirección que aparece (normalmente http://localhost:5173).

En local se ve el enlace **Ajustes** en el pie. Desde ahí se abren y guardan modelos
(`.umbral.json`) en tu ordenador y se elige el lector de planos.

## Publicar una ficha

```
npm run build
```

Genera la carpeta `dist/` con la ficha lista para subir a un alojamiento de páginas
estáticas (por ejemplo, Cloudflare Pages). La versión publicada no muestra Ajustes;
para verlos en una copia publicada, añade `?editar` a la dirección.

## Estructura

| Carpeta | Qué contiene |
| --- | --- |
| `src/model/` | Formato del modelo (`types.ts`), cálculo de m² y geometría, validación |
| `src/io/` | Lectores de planos: archivo de Claude (activo) y API de Anthropic (preparado) |
| `src/viewer/` | Visor 3D: maqueta, recorrido en primera persona, muebles y texturas |
| `src/plan/` | Plano 2D en SVG con superficies |
| `src/ui/` | Portada, fotos, ficha de la inmobiliaria y ajustes |
| `src/demo/` | Inmuebles de demostración y su catálogo |
| `public/demo/muebles/` | Modelos 3D de la demostración, de [Poly Haven](https://polyhaven.com) (licencia CC0) |
| `docs/` | Documentación del formato del modelo |

## Formato del modelo

Todo Umbral gira alrededor de un único formato: `umbral.model/1`. Lo describe
`docs/formato-modelo.md`. La skill de Claude (fase 4), la API, el editor y el visor
leen y escriben exactamente ese formato.

## Comprobaciones

```
npm run typecheck
```

## Próximos pasos

- Buscar modelos reales para lo que Poly Haven no cubre (sofá en L, camas, armarios,
  cocina, nevera, televisor y baños); ahora son piezas detalladas hechas por código, en
  `src/viewer/furniture.ts`.
- Editor: calcar un plano sobre una imagen y fijar la escala con una medida.
- Skill de Umbral para Claude de escritorio (lectura de planos, fotos y vídeo).
