# Orbes Mandálicos AR

Web app (sin dependencias) que superpone esferas mandálicas de colores ácidos, con sombra, movimiento y sonido sintetizado, sobre la cámara de tu celular mientras grabas.

## Uso
- Necesita **HTTPS** (o `localhost`) para acceder a la cámara. Con GitHub Pages queda en `https://<usuario>.github.io/Realidad-aumentada-cel/`.
- Local: `python3 -m http.server 8000` y abre `http://localhost:8000` (en el celular usa un túnel HTTPS, p. ej. `npx localtunnel --port 8000`).
- **Tocar** el fondo: crea un orbe. **Arrastrar/lanzar** un orbe: lo mueves. Inclinar el celular da paralaje.
- Botones: ● grabar (descarga video con audio), + añadir, ✕ limpiar, ⟲ cambiar cámara, ♪ silenciar.

Cada orbe tiene su propia nota (pentatónica) con modulación FM, paneo según su posición, y suena al rebotar o chocar.
