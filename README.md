# Orbes AR

Orbes luminosos, minimalistas y tecno (erizos de espinas, un anillo de conchas y una flor violeta) **anclados en el espacio 3D** con AR Quick Look en iPhone. Puedes caminar alrededor de ellos; flotan, giran, proyectan sombra y cada uno emite su propio tono espacial.

**Abrir:** https://acidovioletax.github.io/Realidad-aumentada-cel/ en Safari (iPhone/iPad) → «Abrir en AR».

## Archivos
- `orbes.usdz`: la escena (geometría, materiales emisivos, animación en bucle de 8 s y audio espacial).
- `tools/build_scene.py`: genera `orbes.usdz` de forma procedural. Para regenerarla: `pip install usd-core numpy && python3 tools/build_scene.py`. Posiciones, colores y notas están en la lista `ORBS`.
- `index.html`: página que abre la escena en AR Quick Look.
