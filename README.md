# Pasarela de video

Servicio de transmisiones privadas para ticketeras de terceros. La ticketera vende y maneja sus usuarios; este servicio entrega el video:

- **Panel** (`/panel`): clientes (cada uno con su clave de API), eventos con sus datos RTMPS/SRT para vMix u OBS, entradas usadas y monto a facturar.
- **API** (`/api/v1/...`): la ticketera pide un link personal por entrada. Documentada en `/integracion`.
- **Reproductor** (`/ver/...`): sin marcas, una pantalla por entrada, links que vencen, repetición por partes.
- **Worker** (`worker/worker.js`): entrega el video por un dominio propio.

Sin dependencias: Node 22 puro (`node:sqlite`). Los datos viven en `DATA_DIR` (disco de Render en `/data`).

## Variables

| Variable | Qué es |
|---|---|
| `BRAND_NAME` | Nombre que se muestra en el panel y la guía |
| `ADMIN_PASSWORD` | Clave del panel (Render la genera) |
| `SECRET_KEY` | Firma de links y cifrado (Render la genera; no cambiarla) |
| `PRECIO_POR_ENTRADA` | Precio general por entrada (cada cliente puede tener el suyo) |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | Cuenta de streaming (token con permiso *Stream: Edit*) |
| `CF_CUSTOMER_CODE` | Código de cliente de Stream (`customer-XXXX`) |
| `VIDEO_HOST` | Dominio del Worker, ej. `video.midominio.com` (vacío = sin ocultar, solo pruebas) |
| `BASE_URL` | URL pública del servicio, ej. `https://play.midominio.com` |

## Puesta en marcha

1. Render → New → Blueprint → este repo. Cargar las variables `sync: false`.
2. Worker: Cloudflare → Workers → Create → pegar `worker/worker.js`, variable `CUSTOMER_CODE`, y asignarle el dominio `video.midominio.com` (Custom Domain).
3. En Render, dominio propio `play.midominio.com` y `BASE_URL` / `VIDEO_HOST`.
4. Panel → Clientes → crear el cliente → pasarle su clave y el link a `/integracion`.

## Local

```
ADMIN_PASSWORD=x SECRET_KEY=y CF_ACCOUNT_ID=... CF_API_TOKEN=... npm start
```
