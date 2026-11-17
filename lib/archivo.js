'use strict';
/**
 * Backup en R2: pasa las grabaciones de un evento de Stream a R2 y recién
 * cuando la copia quedó completa (mismo tamaño) borra el video de Stream.
 *
 * La copia la hace el Worker (worker/r2-worker.js) dentro de Cloudflare, por partes:
 * los gigas no pasan por este servidor.
 */
const crypto = require('node:crypto');
const config = require('./config');
const { db, ajuste } = require('./db');
const cf = require('./cloudflare');
const { ahora } = require('./util');

const PARTE = 256 * 1024 * 1024; // 256 MB por parte (R2 pide partes iguales salvo la última)
const UNA_SOLA_MAX = 4.9 * 1024 * 1024 * 1024; // sin partes, R2 acepta hasta ~5 GB

const trabajos = new Map(); // eventoId -> { activo, texto, error, fin }

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Si el servidor se reinició a mitad de una copia, esa fila quedó colgada.
db.prepare("UPDATE archivos SET estado = 'error', error = 'Se cortó por un reinicio del servidor. Volvé a tocar el botón.' WHERE estado = 'subiendo'").run();

async function worker(ruta, body, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(config.r2.worker + ruta, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + config.r2.clave, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.ok) return j;
      ultimo = new Error(`R2 respondió ${r.status}${j && j.error ? ': ' + j.error : ''}`);
      if (r.status === 401 || r.status === 404) break; // clave mal o falta el bucket: no tiene sentido reintentar
    } catch (e) {
      ultimo = e;
    }
    await dormir(3000 * (i + 1));
  }
  throw ultimo;
}

/** Tamaño del MP4 y si el servidor acepta pedir pedazos (Range). Baja 1 byte, no el archivo. */
async function medir(url) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(60000) });
  try {
    if (r.status === 206) {
      const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
      if (m) return { tamano: Number(m[1]), pedazos: true };
    }
    if (r.ok) return { tamano: Number(r.headers.get('content-length')) || 0, pedazos: false };
    throw new Error(`No se pudo leer el MP4 (${r.status}).`);
  } finally {
    r.body && r.body.cancel().catch(() => {});
  }
}

function claveR2(ev, g) {
  const d = new Date(g.creado || Date.now());
  const f = d.toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).replace(' ', '_').replace(/:/g, '-').slice(0, 16);
  return `evento-${ev.id}/${f}_${g.uid.slice(0, 8)}.mp4`;
}

async function copiar(ev, g, aviso) {
  // Si ya quedó copiado antes (y falló solo el borrado), no se vuelve a subir.
  const hecho = db.prepare("SELECT * FROM archivos WHERE video_uid = ? AND estado = 'ok'").get(g.uid);
  if (hecho) return hecho;

  aviso('preparando el MP4 en Cloudflare');
  const limite = Date.now() + 90 * 60 * 1000;
  for (;;) {
    const d = await cf.descarga(g.uid);
    if (d.listo) break;
    if (Date.now() > limite) throw new Error('Cloudflare tardó demasiado en armar el MP4. Probá de nuevo más tarde.');
    aviso(`preparando el MP4 en Cloudflare (${d.pct}%)`);
    await dormir(10000);
  }

  const url = await cf.urlMp4(g.uid, 12);
  const { tamano, pedazos } = await medir(url);
  if (!tamano) throw new Error('No se pudo saber el tamaño del MP4.');
  const clave = claveR2(ev, g);

  // Limpia intentos anteriores que quedaron a medias
  for (const v of db.prepare("SELECT * FROM archivos WHERE video_uid = ? AND estado <> 'ok'").all(g.uid)) {
    if (v.upload_id) await worker('/abortar', { clave: v.clave, uploadId: v.upload_id }, 1).catch(() => {});
    db.prepare('DELETE FROM archivos WHERE id = ?').run(v.id);
  }
  const fila = db.prepare('INSERT INTO archivos (evento_id, video_uid, clave, grabado, duracion, tamano, creado) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ev.id, g.uid, clave, g.creado || null, g.duracion || null, tamano, ahora());
  const id = Number(fila.lastInsertRowid);
  const gb = (tamano / 1073741824).toFixed(2);

  let final;
  if (!pedazos || tamano <= PARTE) {
    if (tamano > UNA_SOLA_MAX) throw new Error('El MP4 pesa más de 5 GB y Cloudflare no deja copiarlo por partes.');
    aviso(`copiando a R2 (${gb} GB)`);
    final = await worker('/entero', { clave, url, tamano });
  } else {
    const { uploadId } = await worker('/iniciar', { clave });
    db.prepare('UPDATE archivos SET upload_id = ? WHERE id = ?').run(uploadId, id);
    const total = Math.ceil(tamano / PARTE);
    const partes = [];
    for (let n = 1; n <= total; n++) {
      aviso(`copiando a R2: parte ${n} de ${total} (${gb} GB)`);
      const desde = (n - 1) * PARTE;
      const hasta = Math.min(tamano, n * PARTE) - 1;
      const p = await worker('/parte', { clave, uploadId, n, url, desde, hasta });
      partes.push({ partNumber: p.partNumber, etag: p.etag });
    }
    aviso('cerrando la copia en R2');
    final = await worker('/completar', { clave, uploadId, partes });
  }
  if (Number(final.tamano) !== tamano) {
    throw new Error(`La copia en R2 quedó incompleta (${final.tamano} de ${tamano} bytes). No se borró nada de Stream.`);
  }
  db.prepare("UPDATE archivos SET estado = 'ok', error = NULL, upload_id = NULL WHERE id = ?").run(id);
  return db.prepare('SELECT * FROM archivos WHERE id = ?').get(id);
}

async function correr(ev) {
  const t = trabajos.get(ev.id);
  const grabs = await cf.grabaciones(ev.cf_uid);
  const listas = grabs.filter((g) => g.estado === 'ready' && !g.enVivo)
    .sort((a, b) => String(a.creado).localeCompare(String(b.creado)));
  const enCurso = grabs.length - listas.length;
  if (!listas.length) {
    t.texto = enCurso ? 'Hay una grabación en curso o procesándose: esperá a que termine.' : 'No hay grabaciones para pasar.';
    return;
  }
  let hechas = 0;
  for (let i = 0; i < listas.length; i++) {
    const g = listas[i];
    const aviso = (txt) => { t.texto = `Grabación ${i + 1} de ${listas.length}: ${txt}…`; };
    try {
      await copiar(ev, g, aviso);
      aviso('borrando de Stream');
      await cf.borrarVideo(g.uid).catch((e) => { if (!/404/.test(e.message)) throw e; });
      hechas++;
    } catch (e) {
      console.error('[r2]', ev.id, g.uid, e.message);
      db.prepare("UPDATE archivos SET estado = 'error', error = ? WHERE video_uid = ? AND estado <> 'ok'").run(e.message, g.uid);
      t.error = `Grabación ${i + 1}: ${e.message}`;
    }
  }
  t.texto = `Listo: ${hechas} de ${listas.length} grabación(es) pasadas a R2 y borradas de Stream.`
    + (enCurso ? ' Hay otra en curso: pasala cuando termine.' : '');
}

/** Arranca en segundo plano (si no hay otro corriendo para el mismo evento). */
function archivar(ev) {
  const t = trabajos.get(ev.id);
  if (t && t.activo) return false;
  const nuevo = { activo: true, texto: 'Arrancando…', error: '' };
  trabajos.set(ev.id, nuevo);
  correr(ev)
    .catch((e) => { console.error('[r2]', ev.id, e.message); nuevo.error = e.message; nuevo.texto = 'Se frenó.'; })
    .finally(() => { nuevo.activo = false; nuevo.fin = Date.now(); });
  return true;
}

const estado = (eventoId) => trabajos.get(eventoId) || null;

/** Link firmado para bajar un archivo de R2 por el Worker (vence en unas horas). */
function linkBajar(a, horas = 6) {
  const exp = Math.floor(Date.now() / 1000) + horas * 3600;
  const nombre = a.clave.split('/').pop();
  const firma = crypto.createHmac('sha256', config.r2.clave).update(`${a.clave}|${exp}`).digest('hex');
  return `${config.r2.worker}/bajar?k=${encodeURIComponent(a.clave)}&e=${exp}&n=${encodeURIComponent(nombre)}&f=${firma}`;
}

async function borrar(a) {
  await worker('/borrar', { clave: a.clave }, 2);
  db.prepare('DELETE FROM archivos WHERE id = ?').run(a.id);
}

/** Días que un archivo queda en R2 antes de borrarse solo (0 = nunca). */
function dias(v) {
  if (v !== undefined) ajuste('r2_borrar_dias', String(Math.min(Math.max(parseInt(v, 10) || 0, 0), 365)));
  const d = ajuste('r2_borrar_dias');
  return d == null ? 2 : Number(d);
}

/** Fecha en que se borra solo (o null si no se borra). */
function venceEl(a) {
  const d = dias();
  if (!d || !a.creado) return null;
  return new Date(new Date(a.creado).getTime() + d * 86400000).toISOString();
}

async function limpiarViejos() {
  if (!config.r2Listo() || !dias()) return;
  const limite = new Date(Date.now() - dias() * 86400000).toISOString();
  for (const a of db.prepare("SELECT * FROM archivos WHERE estado = 'ok' AND creado < ?").all(limite)) {
    try { await borrar(a); console.log('[r2] borrado por antigüedad:', a.clave); } catch (e) { console.error('[r2] no se pudo borrar', a.clave, e.message); }
  }
}
setTimeout(limpiarViejos, 60000);
setInterval(limpiarViejos, 3600000).unref();

module.exports = { archivar, estado, linkBajar, borrar, dias, venceEl };
