# Vinilo Loop

Web app 100% en el navegador: subís una foto y genera la animación de un vinilo saliendo del sobre (intro), girando en un loop perfecto y, opcionalmente, volviendo a entrar (outro). Spec completa: `vinilo-loop-spec.md`.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests de timing, loop, continuidad, empalmes y PNG
npm run build    # typecheck + build estático en dist/
```

## Funcionalidades (fases 1–3)

- **Foto**: se suelta en cualquier parte de la ventana; recorte de tapa (cuadrado) y de galleta (círculo), independientes.
- **Portada**: foto completa o sobre con agujero (kraft, blanco, negro, color o la foto troquelada). Por el agujero se ve la galleta mientras el disco está adentro, y el interior del sobre cuando sale.
- **Galleta**: foto de tapa, otra imagen o uno de 8 diseños estándar (`src/render/labels.ts`) con título, subtítulo, color base y las RPM reales.
- **Layouts**: semi-afuera, afuera al lado, disco solo (el sobre se va deslizándose o desvaneciéndose). El disco sale a la derecha, la izquierda o arriba.
- **Vinilo**: negro, color sólido o translúcido; surcos procedurales, brillo fijo, etiqueta que rota y wobble opcional (una oscilación por vuelta).
- **Sobre**: desgaste 0–100 (ring wear, bordes gastados, amarilleo) y funda interior de papel opcional.
- **Fondos**: transparente, sólido, degradé giratorio, mesh/blobs, rayos, polvo/partículas, retro/VHS (grilla o scanlines) y bokeh. La paleta se edita a mano o se saca de la foto (k-means).
- **Overlays**: grano (re-seedeado cada frame, periódico con el loop) y viñeta.
- **Intro / loop / outro**: el giro se integra frame a frame; los empalmes intro→loop y loop→outro no tienen salto de ángulo, velocidad, posición ni fase.
- **Presets**: se guardan en localStorage y se exportan / importan como JSON (sin imágenes).
- **Exportación**: intro, N loops y outro combinables.

| Formato | Alpha | Cómo |
|---|---|---|
| MP4 H.264 | ✗ | WebCodecs + Mediabunny |
| WebM VP9 | ✓ | WebCodecs + Mediabunny (alpha como side data). Fallback: VP8 con alpha vía ffmpeg.wasm |
| PNG ZIP | ✓ | Encoder PNG propio en Web Workers + fflate |
| ProRes 4444 .mov | ✓ | ffmpeg.wasm (`prores_ks`, `yuva444p`) |

ffmpeg.wasm usa el core single-thread (no necesita headers COOP/COEP), se sirve desde el propio origen (sin CDN) y se descarga (~32 MB) solo la primera vez que se usa ProRes o el fallback de WebM.

## Interfaz

Panel por pestañas (Imagen, Escena, Movimiento, Fondo, Presets, Exportar), timeline con los segmentos intro / loop / outro (clic o arrastre para ir a un frame) y atajos: **Espacio** play/pausa, **← →** un frame, **Shift + ← →** un segundo, **Inicio** vuelve al principio.

## Cómo está armado

- `src/render/timing.ts`: N, F, rpmEf, θ(i), φ(i), intro y outro. La fracción de vuelta se calcula con enteros (`N·i mod F`), así θ(i+F) es bit a bit igual a θ(i).
- Los frames se direccionan con `{ seg: 'intro' | 'loop' | 'outro', i }` o con un número de timeline (`[0, I)` intro, `[I, ∞)` loop). El frame F nunca se exporta.
- `src/render/layout.ts`: `placement(cfg, W, H, move)`. `move` va de 0 (disco adentro) a 1 (pose del loop); cada layout aplica su easing, y el outro es la intro al revés arrancando en reposo.
- `src/render/scene.ts`: `renderFrame` pura; `buildAssets` pre-renderiza una vez lo estático (surcos + etiqueta, sobre con desgaste, papel, sombras, tiles de grano).
- `tests/loop.test.ts`:
  - frame 0 == frame F píxel a píxel para cada fondo × 5 variantes (layouts, direcciones, fps, wobble, overlays, colores, desgaste);
  - **continuidad**: el paso F-1 → 0 de cada fondo no puede ser más grande que un paso normal (detecta frecuencias no enteras; hay un control negativo que lo prueba);
  - empalmes intro→loop y loop→outro para los tres layouts.

**Regla para agregar animaciones:** tienen que ser función de `phase` con frecuencias enteras (o ruido 4D sobre un círculo, `utils/noise.ts`). Al registrar un fondo en `src/render/backgrounds/index.ts` queda cubierto automáticamente por los tests.

## Offline

En producción (`npm run build`) se registra `public/sw.js`: después de la primera visita la app funciona sin conexión. El core de ffmpeg queda en caché la primera vez que se usa ProRes o el fallback de WebM.
