'use strict';
/**
 * Relé de señal: corre en un servidor en la nube (no en Render).
 *
 * Cada 20 s le pregunta a la pasarela qué eventos tienen "Tomar la señal de otro servidor"
 * (link SRT de origen, ej. Castr) y para cada uno deja corriendo ffmpeg que toma esa señal
 * y la manda, sin recodificar, al SRT del evento en Cloudflare. Si la señal se corta o se
 * traba (no avanza la imagen), reintenta. Le informa a la pasarela el estado y los números
 * de cada uno, que se ven en el panel.
 *
 * Se actualiza solo: si la pasarela tiene una versión nueva de este archivo, la baja,
 * la guarda y sale; systemd lo vuelve a arrancar con la versión nueva.
 *
 * Variables: PASARELA (ej. https://pasarela-video.onrender.com) y CLAVE (= RELAY_CLAVE en Render).
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const BASE = String(process.env.PASARELA || '').replace(/\/+$/, '');
const CLAVE = process.env.CLAVE || '';
if (!BASE || !CLAVE) { console.error('Faltan PASARELA y CLAVE'); process.exit(1); }

const TRABADO_MS = 20000; // sin avanzar la imagen este tiempo = trabado: se reinicia
const VERSION = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const relays = new Map(); // id -> { cfg, child, estado, msg, desde, parado, timer, avance, stats }

const log = (...a) => console.log(new Date().toISOString(), ...a);
const auth = { Authorization: 'Bearer ' + CLAVE };

/** ffmpeg quiere el # del streamid escrito como %23 (si no, lo toma como fin de la URL). */
const urlSrt = (u) => String(u).replace(/#/g, '%23');

function arrancar(r) {
  r.parado = false;
  r.estado = 'conectando';
  r.desde = null;
  r.stats = {};
  r.ultimoTiempo = 0;
  r.avance = Date.now(); // margen para conectar
  const fuente = urlSrt(r.cfg.fuente) + (r.cfg.fuente.includes('?') ? '&' : '?') + 'mode=caller&timeout=10000000';
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-progress', 'pipe:1', '-stats_period', '2',
    '-fflags', '+genpts', '-i', fuente,
    '-map', '0:v?', '-map', '0:a?', '-c', 'copy',
    '-f', 'mpegts', urlSrt(r.cfg.destino),
  ];
  log(`[${r.cfg.id}] conectando a la fuente`);
  const ch = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  r.child = ch;
  let buf = '';
  ch.stdout.on('data', (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf('progress=')) !== -1) {
      const fin = buf.indexOf('\n', i);
      if (fin === -1) break;
      const bloque = buf.slice(0, fin);
      buf = buf.slice(fin + 1);
      const v = Object.fromEntries(bloque.split('\n').map((l) => l.split('=')).filter((p) => p.length === 2).map(([k, x]) => [k.trim(), x.trim()]));
      const t = Number(v.out_time_us || v.out_time_ms || 0);
      r.stats = { fps: v.fps, bitrate: v.bitrate, velocidad: v.speed, cuadros: v.frame };
      if (t > r.ultimoTiempo) {
        r.ultimoTiempo = t;
        r.avance = Date.now();
        if (r.estado !== 'transmitiendo') {
          r.estado = 'transmitiendo';
          r.desde = new Date().toISOString();
          r.msg = '';
          log(`[${r.cfg.id}] transmitiendo`);
        }
      }
    }
  });
  ch.stderr.on('data', (d) => {
    const linea = String(d).trim().split('\n').pop();
    if (linea) { r.msg = linea.slice(0, 300); log(`[${r.cfg.id}] ffmpeg: ${r.msg}`); }
  });
  ch.on('exit', (code) => {
    if (r.child !== ch) return;
    r.child = null;
    if (r.parado) return;
    log(`[${r.cfg.id}] se cortó (código ${code}) ${r.msg || ''}`);
    r.estado = 'reintentando';
    r.desde = null;
    r.timer = setTimeout(() => arrancar(r), 5000);
  });
}

function parar(r) {
  r.parado = true;
  clearTimeout(r.timer);
  if (r.child) r.child.kill('SIGKILL');
}

// Vigila que la imagen avance; si se traba sin cortarse, reinicia la conexión.
setInterval(() => {
  for (const r of relays.values()) {
    if (!r.child || r.parado) continue;
    const quieto = Date.now() - r.avance;
    if (quieto > (r.estado === 'transmitiendo' ? TRABADO_MS : 30000)) {
      log(`[${r.cfg.id}] sin avanzar hace ${Math.round(quieto / 1000)} s: reinicio`);
      r.msg = r.estado === 'transmitiendo' ? 'La imagen se trabó: reconectando' : 'La fuente no manda imagen';
      r.child.kill('SIGKILL'); // el "exit" lo vuelve a arrancar
    }
  }
}, 5000).unref();

async function actualizar() {
  try {
    const v = await fetch(BASE + '/relay/version', { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!v.ok) return;
    const { version } = await v.json();
    if (!version || version === VERSION) return;
    const c = await fetch(BASE + '/relay/codigo', { headers: auth, signal: AbortSignal.timeout(30000) });
    if (!c.ok) return;
    const codigo = await c.text();
    if (crypto.createHash('sha256').update(codigo).digest('hex') !== version || !codigo.startsWith("'use strict'")) return;
    fs.writeFileSync(__filename + '.nuevo', codigo);
    fs.renameSync(__filename + '.nuevo', __filename);
    log('versión nueva del relé instalada: reinicio');
    for (const r of relays.values()) parar(r);
    process.exit(0); // systemd lo vuelve a arrancar
  } catch (e) {
    log('no pude buscar actualizaciones:', e.message);
  }
}

async function ciclo() {
  let lista;
  try {
    const res = await fetch(BASE + '/relay/config', { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('la pasarela respondió ' + res.status);
    lista = (await res.json()).relays || [];
  } catch (e) {
    log('no pude leer la configuración:', e.message);
    return; // sigue con lo que ya estaba corriendo
  }
  const ids = new Set(lista.map((c) => c.id));
  for (const [id, r] of relays) {
    if (!ids.has(id)) { log(`[${id}] quitado del panel: paro`); parar(r); relays.delete(id); }
  }
  for (const c of lista) {
    const r = relays.get(c.id);
    if (!r) {
      const n = { cfg: c };
      relays.set(c.id, n);
      arrancar(n);
    } else if (r.cfg.fuente !== c.fuente || r.cfg.destino !== c.destino) {
      log(`[${c.id}] cambió el link: reinicio`);
      parar(r);
      r.cfg = c;
      arrancar(r);
    }
  }
  try {
    await fetch(BASE + '/relay/estado', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: VERSION.slice(0, 8),
        relays: [...relays.values()].map((r) => ({ id: r.cfg.id, estado: r.estado, msg: r.msg, desde: r.desde, stats: r.stats, quieto: Math.round((Date.now() - r.avance) / 1000) })),
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { /* la próxima vuelta informa */ }
}

process.on('SIGTERM', () => { for (const r of relays.values()) parar(r); process.exit(0); });
log('relé arrancado, versión', VERSION.slice(0, 8), 'pasarela:', BASE);
ciclo();
setInterval(ciclo, 10000);
setInterval(actualizar, 60000);
setTimeout(actualizar, 5000);
