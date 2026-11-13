# ToXdo server

Servidor de ToXdo. Mantiene al día los beneficios y los eventos con inteligencia artificial y responde al asistente de la app. La app lee los datos directamente desde Firestore, por lo que sigue funcionando aunque este servidor esté dormido.

## Qué hace

- **Beneficios:** una vez al día revisa las páginas oficiales de bancos, tarjetas, telefónicas, cajas e isapres del catálogo (`src/catalog.json`), y con Claude convierte lo publicado en ofertas estructuradas en la colección `offers`.
- **Eventos:** cuando la app informa la ciudad de una persona, Claude busca en la web los panoramas de esa ciudad, se ubican en el mapa con OpenStreetMap y se guardan en `events`.
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

## Comandos

```bash
npm install
npm start                      # inicia el servidor
npm run seed                   # carga el contenido inicial de data/
npm run ingest -- benefits santander   # actualiza con IA una o más entidades
node scripts/check-sources.js  # revisa que las páginas del catálogo respondan
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
| `GET /api/admin/status` | Estado de la IA y de las últimas ingestas. Requiere `x-toxdo-secret`. |

## Contenido inicial

`data/seed-offers.json` y `data/seed-events.json` contienen una carga curada a mano con fuentes de noviembre de 2026. Sirve para partir con datos reales. Cuando la ingesta con IA está activa, las ofertas curadas conviven con las que trae la IA y vencen solas según su fecha.
