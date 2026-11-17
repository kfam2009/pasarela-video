'use strict';
const crypto = require('node:crypto');

const env = (k, def = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : def);

const config = {
  port: parseInt(env('PORT', '8080'), 10),
  dataDir: env('DATA_DIR', require('node:path').join(__dirname, '..', 'data')),
  marca: env('BRAND_NAME', 'Pasarela Video'),
  baseUrl: env('BASE_URL', '').replace(/\/+$/, ''),
  adminPassword: env('ADMIN_PASSWORD'),
  secret: env('SECRET_KEY'),
  precioEntrada: parseFloat(env('PRECIO_POR_ENTRADA', '1000')) || 0,
  moneda: env('MONEDA', '$'),
  cf: {
    apiBase: env('CF_API_BASE', 'https://api.cloudflare.com/client/v4'),
    accountId: env('CF_ACCOUNT_ID'),
    token: env('CF_API_TOKEN'),
    customerCode: env('CF_CUSTOMER_CODE').replace(/^https?:\/\//, '').replace(/^customer-/, '').replace(/\.cloudflarestream\.com.*$/, ''),
  },
  // Dominio del "pasamanos" (Worker). Si está vacío se usa directo el de Cloudflare (solo para pruebas).
  videoHost: env('VIDEO_HOST', '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  // Backup en R2: Worker que copia las grabaciones (worker/r2-worker.js) y su clave compartida
  r2: {
    worker: env('R2_WORKER_URL', '').replace(/\/+$/, ''),
    clave: env('R2_CLAVE'),
  },
  hlsCdn: env('HLS_JS_URL', 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js'),
};

if (!config.secret) {
  config.secret = crypto.randomBytes(32).toString('hex');
  console.warn('[aviso] Falta SECRET_KEY: las sesiones y los links se invalidan en cada reinicio.');
}

config.r2Listo = () => Boolean(config.r2.worker && config.r2.clave);
config.cloudflareListo = () => Boolean(config.cf.accountId && config.cf.token);

module.exports = config;
