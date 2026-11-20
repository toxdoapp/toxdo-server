# ToXdo server

Servidor de ToXdo. Mantiene al día los beneficios y los eventos con inteligencia artificial y responde al asistente de la app. La app lee los datos directamente desde Firestore, por lo que sigue funcionando aunque este servidor esté dormido.

## Qué hace

- **Beneficios:** una vez al día revisa las páginas oficiales de bancos, tarjetas, telefónicas, cajas e isapres del catálogo (`src/catalog.json`), y con Claude convierte lo publicado en ofertas estructuradas en la colección `offers`.
- **Eventos:** cuando la app informa la ciudad de una persona, Claude busca en la web los panoramas de esa ciudad, se ubican en el mapa con OpenStreetMap y se guardan en `events`.
- **Sucursales:** cada dos semanas, o cuando cambian los comercios, busca en OpenStreetMap las sucursales de los comercios con beneficio en todo Chile y las guarda por zonas en `placeCells`. La app las usa en "Beneficios cerca". No necesita IA.
- **Sheet de beneficios:** si se configura `BENEFITS_SHEET_ID`, lee cada 4 horas un Google Sheet público con beneficios cargados a mano o por un scraper propio, y los guarda en `offers` igual que la ingesta con IA, sin generar avisos de "nuevo beneficio" (el volumen del Sheet los saturaría). No usa IA ni tiene costo. Ver `src/ingest/sheet.js`. En `/admin` hay un botón para forzarlo al instante, sin terminal.
- **Sheet de eventos:** si se configura `EVENTS_SHEET_GID`, lee cada 4 horas una segunda pestaña del mismo Sheet con eventos (ciudad, fechas, lugar), geocodifica cada uno con OpenStreetMap y los guarda en `events`. Pensada para llenarse fuera del servidor —por ejemplo, un script con el crédito del Agent SDK de una suscripción de Claude, corriendo una vez al día— no con la IA del servidor. Ver `src/ingest/eventsSheet.js`.
- **Asistente:** `POST /api/assistant` responde preguntas como "dónde como sushi con descuento hoy" usando solo los beneficios guardados.
- **Páginas públicas:** `/privacidad`, `/terminos` y `/soporte`, que son las direcciones que pide la App Store.

## Variables de entorno

Copia `.env.example` como `.env` para trabajar en tu computador. En Render se configuran en el panel, sección Environment.

| Variable | Para qué sirve |
| --- | --- |
| `ANTHROPIC_API_KEY` | Clave de Anthropic. Sin ella el servidor funciona, pero no actualiza datos ni responde el asistente. |
| `FIREBASE_SERVICE_ACCOUNT` | Credencial de servicio de Firebase, en una línea de JSON o en base64. |
| `SCRAPE_SECRET` | Secreto de las rutas `/api/admin`. Mínimo 12 caracteres. |
| `ANTHROPIC_MODEL` | Opcional. Modelo principal. Por defecto usa Claude Fable. |
| `BENEFITS_SHEET_ID` | Opcional. ID del Google Sheet de beneficios (el que aparece en su URL, entre `/d/` y `/edit`). El Sheet debe estar compartido como "Cualquier persona con el enlace, Lector". Vacío desactiva la sincronización. |
| `BENEFITS_SHEET_GID` | Opcional. Pestaña del Sheet a leer. Por defecto `0`, la primera. |
| `EVENTS_SHEET_GID` | Opcional. Pestaña del mismo Sheet con eventos (gid distinto al de beneficios). Vacío desactiva esa sincronización. |

## Comandos

```bash
npm install
npm start                      # inicia el servidor
npm run seed                   # carga el contenido inicial de data/
npm run ingest -- benefits santander   # actualiza con IA una o más entidades
node scripts/check-sources.js  # revisa que las páginas del catálogo respondan
npm run places                 # busca en OpenStreetMap las sucursales de los comercios con beneficio
npm run sync:sheet             # sincroniza los beneficios del Google Sheet (sin IA)
```

## Rutas

| Ruta | Uso |
| --- | --- |
| `GET /api/ping` | La app la llama al abrirse. Despierta el servidor y dispara la tarea diaria si falta. |
| `GET /api/status` | Estado y cantidad de beneficios y eventos vigentes. |
| `POST /api/events/refresh` | Pide actualizar los eventos de una ciudad. |
| `POST /api/assistant` | Asistente. Requiere el token de Firebase de la persona. |
| `POST /api/admin/ingest/benefits` | Fuerza la ingesta de beneficios. Requiere `x-toxdo-secret`. |
| `POST /api/admin/ingest/events` | Fuerza la búsqueda de eventos de una ciudad. Requiere `x-toxdo-secret`. |
| `POST /api/admin/sync/sheet` | Sincroniza los beneficios del Google Sheet ahora mismo, sin esperar a la próxima pasada automática (cada 4 horas). Requiere `x-toxdo-secret`. También hay un botón en `/admin`. |
| `POST /api/admin/sync/events` | Sincroniza la pestaña de eventos del Sheet ahora mismo. Requiere `x-toxdo-secret`. También hay un botón en `/admin`. |
| `GET /api/admin/status` | Estado de la IA y de las últimas ingestas. Requiere `x-toxdo-secret`. |

## Contenido inicial

`data/seed-offers.json` y `data/seed-events.json` contienen una carga curada a mano con fuentes de noviembre de 2026. Sirve para partir con datos reales. Cuando la ingesta con IA está activa, las ofertas curadas conviven con las que trae la IA y vencen solas según su fecha.
