'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./lib/config');
const { db } = require('./lib/db');
const cf = require('./lib/cloudflare');
const { estadoEvento, olvidar, TEXTOS } = require('./lib/estado');
const { pagina, reproductor, mensaje } = require('./lib/vistas');
const { firmar, verificar, cifrar, descifrar, sha256, esc, ahora, fechaLinda, plata } = require('./lib/util');
const guia = require('./lib/guia');

/* ------------------------------------------------------------------ utilidades HTTP */

function enviar(res, codigo, cuerpo, tipo = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(cuerpo);
}
const json = (res, codigo, obj, extra = {}) => enviar(res, codigo, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
const redirigir = (res, a, extra = {}) => { res.writeHead(303, { Location: a, 'Cache-Control': 'no-store', ...extra }); res.end(); };

function leerCuerpo(req, limite = 64 * 1024) {
  return new Promise((ok, mal) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) { mal(new Error('Cuerpo demasiado grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      const txt = Buffer.concat(partes).toString('utf8');
      const tipo = String(req.headers['content-type'] || '');
      if (!txt) return ok({});
      if (tipo.includes('application/json')) {
        try { return ok(JSON.parse(txt) || {}); } catch { return ok({}); }
      }
      return ok(Object.fromEntries(new URLSearchParams(txt)));
    });
    req.on('error', mal);
  });
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function baseUrl(req) {
  if (config.baseUrl) return config.baseUrl;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}
const esHttps = (req) => baseUrl(req).startsWith('https://');

/* ------------------------------------------------------------------ panel: sesión */

const intentos = new Map();
function puedeIntentar(ip) {
  const ahoraMs = Date.now();
  const r = (intentos.get(ip) || []).filter((t) => ahoraMs - t < 10 * 60 * 1000);
  intentos.set(ip, r);
  return r.length < 10;
}

function esAdmin(req) {
  const t = verificar(cookies(req).pv);
  return Boolean(t && !t.vencido && t.u === 'admin');
}

function iguales(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ datos */

const q = {
  clientes: () => db.prepare('SELECT c.*, (SELECT COUNT(*) FROM eventos e WHERE e.cliente_id = c.id) AS n_eventos FROM clientes c ORDER BY c.nombre').all(),
  cliente: (id) => db.prepare('SELECT * FROM clientes WHERE id = ?').get(id),
  clientePorClave: (k) => db.prepare('SELECT * FROM clientes WHERE api_hash = ? AND activo = 1').get(sha256(k)),
  eventos: () => db.prepare(`SELECT e.*, c.nombre AS cliente,
      (SELECT COUNT(*) FROM accesos a WHERE a.evento_id = e.id AND a.revocado = 0) AS n_accesos
      FROM eventos e JOIN clientes c ON c.id = e.cliente_id ORDER BY COALESCE(e.fecha, e.creado) DESC`).all(),
  evento: (id) => db.prepare('SELECT e.*, c.nombre AS cliente, c.precio_entrada AS precio_cliente FROM eventos e JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?').get(id),
  acceso: (id) => db.prepare('SELECT * FROM accesos WHERE id = ?').get(id),
};

function precioDe(ev) {
  return ev.precio_cliente != null && ev.precio_cliente !== '' ? Number(ev.precio_cliente) : config.precioEntrada;
}

function resumen(eventoId) {
  const hace = Date.now() - 60 * 1000;
  return db.prepare(`SELECT
      COUNT(*) FILTER (WHERE revocado = 0) AS emitidas,
      COUNT(*) FILTER (WHERE revocado = 0 AND primera_vista IS NOT NULL) AS vistas,
      COUNT(*) FILTER (WHERE revocado = 1) AS anuladas,
      COUNT(*) FILTER (WHERE revocado = 0 AND sesion_latido > ?) AS ahora
    FROM accesos WHERE evento_id = ? AND comprador <> 'prueba-panel'`).get(hace, eventoId);
}

/** Crea (o reutiliza) el acceso de un comprador y devuelve el link firmado. */
function linkDeAcceso(req, ev, comprador, horas) {
  db.prepare('INSERT INTO accesos (evento_id, comprador, creado) VALUES (?, ?, ?) ON CONFLICT(evento_id, comprador) DO NOTHING').run(ev.id, comprador, ahora());
  const a = db.prepare('SELECT * FROM accesos WHERE evento_id = ? AND comprador = ?').get(ev.id, comprador);
  const vence = Math.floor(Date.now() / 1000) + Math.round(horas * 3600);
  return { acceso: a, url: `${baseUrl(req)}/ver/${firmar({ a: a.id, e: vence })}`, vence: new Date(vence * 1000).toISOString() };
}

async function fuentes(ev, est) {
  if (est.estado === 'vivo') return [{ id: ev.cf_uid, url: await cf.urlHls(ev.cf_uid, 6) }];
  if (est.estado === 'repeticion') return Promise.all(est.partes.map(async (p) => ({ id: p.uid, url: await cf.urlHls(p.uid, 6) })));
  return [];
}

/* ------------------------------------------------------------------ panel: vistas */

function pill(estado) {
  return `<span class="pill ${esc(estado)}">${esc(TEXTOS[estado] || estado)}</span>`;
}

function srtCompleta(ev) {
  const pass = descifrar(ev.srt_pass);
  if (!ev.srt_url) return '';
  const sep = ev.srt_url.includes('?') ? '&' : '?';
  return `${ev.srt_url}${sep}passphrase=${encodeURIComponent(pass || '')}&streamid=${encodeURIComponent(ev.srt_id || '')}`;
}

async function vistaEventos(res, aviso = '') {
  const eventos = q.eventos();
  const estados = await Promise.all(eventos.map((e) => (e.activo ? estadoEvento(e) : Promise.resolve({ estado: 'cerrado' }))));
  const clientes = q.clientes();
  const filas = eventos.map((e, i) => `<tr>
      <td><a href="/panel/eventos/${e.id}"><b>${esc(e.titulo)}</b></a><br><small>${esc(e.cliente)}</small></td>
      <td>${fechaLinda(e.fecha) || '<span class="muted">—</span>'}</td>
      <td>${pill(estados[i].estado)}</td>
      <td>${e.n_accesos}</td>
      <td><a class="btn sec chico" href="/panel/eventos/${e.id}">Abrir</a></td></tr>`).join('');
  const sinCf = config.cloudflareListo() ? '' : '<div class="aviso"><b>Falta conectar Cloudflare:</b> cargá CF_ACCOUNT_ID y CF_API_TOKEN en las variables del servicio.</div>';
  const cuerpo = `
    <div class="fila" style="justify-content:space-between"><div><h1>Eventos</h1><p class="sub">Cada evento tiene su propia señal para vMix u OBS.</p></div>
    ${clientes.length ? '<a class="btn" href="/panel/eventos/nuevo">+ Nuevo evento</a>' : '<a class="btn" href="/panel/clientes">Primero cargá un cliente</a>'}</div>
    ${aviso}${sinCf}
    <div class="card tabla">${eventos.length ? `<table><thead><tr><th>Evento</th><th>Fecha</th><th>Estado</th><th>Entradas</th><th></th></tr></thead><tbody>${filas}</tbody></table>`
      : '<p class="muted" style="margin:0">Todavía no hay eventos.</p>'}</div>`;
  enviar(res, 200, pagina({ titulo: 'Eventos', cuerpo, nav: 'panel', activo: 'eventos' }));
}

function vistaNuevoEvento(res, err = '', datos = {}) {
  const clientes = q.clientes().filter((c) => c.activo);
  const opciones = clientes.map((c) => `<option value="${c.id}" ${String(datos.cliente_id) === String(c.id) ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  const cuerpo = `<h1>Nuevo evento</h1><p class="sub">Se crea la señal en Cloudflare y te damos los datos para vMix u OBS.</p>
    ${err ? `<div class="error">${esc(err)}</div>` : ''}
    <form method="post" action="/panel/eventos/nuevo" class="card" style="max-width:620px">
      <label>Cliente</label><select name="cliente_id" required>${opciones}</select>
      <label>Título del evento</label><input name="titulo" required maxlength="140" value="${esc(datos.titulo || '')}" placeholder="Ej: Final del torneo">
      <label>Fecha y hora de inicio</label><input type="datetime-local" name="fecha" value="${esc(datos.fecha || '')}">
      <label class="check" style="margin-top:16px"><input type="checkbox" name="grabar" value="1" ${datos.titulo && !datos.grabar ? '' : 'checked'}> Grabar para repetición</label>
      <label>Repetición disponible durante (horas después de terminar, 0 = sin límite)</label>
      <input type="number" name="repeticion_horas" min="0" max="2160" value="${esc(datos.repeticion_horas || '48')}">
      <div style="margin-top:18px"><button class="btn">Crear evento</button> <a class="btn sec" href="/panel">Cancelar</a></div>
    </form>`;
  enviar(res, err ? 422 : 200, pagina({ titulo: 'Nuevo evento', cuerpo, nav: 'panel', activo: 'eventos' }));
}

async function vistaEvento(req, res, ev, aviso = '') {
  const est = ev.activo ? await estadoEvento(ev) : { estado: 'cerrado' };
  const r = resumen(ev.id);
  const precio = precioDe(ev);
  const accesos = db.prepare('SELECT * FROM accesos WHERE evento_id = ? ORDER BY id DESC LIMIT 200').all(ev.id);
  const key = descifrar(ev.rtmps_key);
  const srt = srtCompleta(ev);
  const hace = Date.now() - 60000;
  const filas = accesos.map((a) => `<tr><td><code>${esc(a.comprador)}</code>${a.comprador === 'prueba-panel' ? ' <small>(tu prueba, no se factura)</small>' : ''}</td><td>${fechaLinda(a.creado)}</td>
      <td>${a.primera_vista ? fechaLinda(a.primera_vista) : '<span class="muted">No entró</span>'}</td><td>${a.aperturas}</td>
      <td>${a.revocado ? '<span class="pill">Anulada</span>' : a.sesion_latido > hace ? '<span class="pill vivo">Mirando</span>' : '<span class="pill ok">Válida</span>'}</td></tr>`).join('');
  const cuerpo = `
    <p><a href="/panel">← Eventos</a></p>
    <div class="fila" style="justify-content:space-between"><div><h1>${esc(ev.titulo)}</h1>
    <p class="sub">${esc(ev.cliente)}${ev.fecha ? ' · ' + fechaLinda(ev.fecha) : ''} · ${pill(est.estado)}</p></div>
    <div class="fila">
      <a class="btn" href="/panel/eventos/${ev.id}/prueba" target="_blank" rel="noopener">Ver reproductor de prueba</a>
    </div></div>
    ${aviso}<div style="height:6px"></div>
    ${est.estado === 'error' ? `<div class="error">No pudimos leer el estado en Cloudflare: ${esc(est.error || '')}</div>` : ''}
    <div class="grid">
      <div class="kpi"><b>${r.emitidas}</b><span>Entradas emitidas</span></div>
      <div class="kpi"><b>${r.vistas}</b><span>Entraron a ver</span></div>
      <div class="kpi"><b>${r.ahora}</b><span>Mirando ahora</span></div>
      <div class="kpi"><b>${plata(r.emitidas * precio)}</b><span>A facturar (${plata(precio)} por entrada)</span></div>
    </div>

    <h2>Datos para vMix / OBS</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Estos datos son solo tuyos: no se los pases al cliente.</p>
      <b>RTMPS</b> <small>(vMix: Stream → Destination Custom RTMP Server · OBS: Servicio Personalizado)</small>
      <div class="dato" style="margin-top:8px"><code id="d1">${esc(ev.rtmps_url || '—')}</code><button class="btn sec chico" data-copiar="d1">Copiar URL</button></div>
      <div class="dato"><code id="d2">${esc(key || '—')}</code><button class="btn sec chico" data-copiar="d2">Copiar clave</button></div>
      <b style="display:block;margin-top:14px">SRT</b> <small>(más estable en conexiones inestables; vMix lo soporta directo)</small>
      <div class="dato" style="margin-top:8px"><code id="d3">${esc(srt || '—')}</code><button class="btn sec chico" data-copiar="d3">Copiar</button></div>
      <p class="muted" style="margin-bottom:0">Recomendado: 1080p o 720p, H.264, 4.000–6.000 kbps, keyframe cada 2 segundos, audio AAC 128 kbps.</p>
    </div>

    <h2>Entradas</h2>
    <div class="fila" style="margin-bottom:10px"><a class="btn sec chico" href="/panel/eventos/${ev.id}/accesos.csv">Descargar CSV</a>
      ${r.anuladas ? `<small>${r.anuladas} anulada(s), no se facturan.</small>` : ''}</div>
    <div class="card tabla">${accesos.length ? `<table><thead><tr><th>Comprador (ID de la ticketera)</th><th>Emitida</th><th>Primera vez que entró</th><th>Aperturas</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>
      ${accesos.length === 200 ? '<p class="muted">Se muestran las últimas 200. El CSV tiene todas.</p>' : ''}`
      : '<p class="muted" style="margin:0">Todavía no se emitieron entradas para este evento.</p>'}</div>

    <h2>Opciones</h2>
    <div class="card fila">
      <form method="post" action="/panel/eventos/${ev.id}/activo"><button class="btn sec">${ev.activo ? 'Desactivar evento' : 'Activar evento'}</button></form>
      <form method="post" action="/panel/eventos/${ev.id}/borrar" data-confirmar="¿Borrar el evento? Se elimina la señal y la grabación en Cloudflare. No se puede deshacer."><button class="btn peligro">Borrar evento</button></form>
      <small>ID del evento para la API: <code>${ev.id}</code> · Grabación: ${ev.grabar ? `sí, repetición ${Number(ev.repeticion_horas) ? ev.repeticion_horas + ' h' : 'sin límite'}` : 'no'}</small>
    </div>`;
  enviar(res, 200, pagina({ titulo: ev.titulo, cuerpo, nav: 'panel', activo: 'eventos' }));
}

function vistaClientes(res, aviso = '') {
  const clientes = q.clientes();
  const meses = db.prepare(`SELECT c.nombre, substr(a.creado, 1, 7) AS mes, COUNT(*) AS n
      FROM accesos a JOIN eventos e ON e.id = a.evento_id JOIN clientes c ON c.id = e.cliente_id
      WHERE a.revocado = 0 AND a.comprador <> 'prueba-panel' GROUP BY c.id, mes ORDER BY mes DESC, c.nombre LIMIT 60`).all();
  const filas = clientes.map((c) => `<tr>
      <td><b>${esc(c.nombre)}</b>${c.activo ? '' : ' <span class="pill">Inactivo</span>'}</td>
      <td><code>${esc(c.api_prefijo || '')}…</code></td>
      <td>${c.precio_entrada != null ? plata(c.precio_entrada) : `<span class="muted">${plata(config.precioEntrada)} (general)</span>`}</td>
      <td>${esc(c.dominios || '') || '<span class="muted">Cualquiera</span>'}</td>
      <td>${c.n_eventos}</td>
      <td><details><summary class="btn sec chico">Editar</summary>
        <form method="post" action="/panel/clientes/${c.id}" style="margin-top:10px;min-width:260px">
          <label>Nombre</label><input name="nombre" value="${esc(c.nombre)}" required>
          <label>Precio por entrada (vacío = general)</label><input name="precio_entrada" type="number" step="0.01" min="0" value="${c.precio_entrada != null ? esc(c.precio_entrada) : ''}">
          <label>Dominios donde puede ir el reproductor</label><input name="dominios" value="${esc(c.dominios || '')}" placeholder="ticketera.com www.ticketera.com">
          <label class="check"><input type="checkbox" name="activo" value="1" ${c.activo ? 'checked' : ''}> Activo</label>
          <div class="fila" style="margin-top:10px"><button class="btn chico">Guardar</button></div>
        </form>
        <form method="post" action="/panel/clientes/${c.id}/clave" style="margin-top:8px" data-confirmar="Se genera una clave nueva y la anterior deja de funcionar. ¿Seguir?"><button class="btn peligro chico">Nueva clave de API</button></form>
      </details></td></tr>`).join('');
  const resumenMeses = meses.length ? `<h2>Entradas por mes</h2><div class="card tabla"><table><thead><tr><th>Mes</th><th>Cliente</th><th>Entradas</th></tr></thead><tbody>
      ${meses.map((m) => `<tr><td>${esc(m.mes)}</td><td>${esc(m.nombre)}</td><td>${m.n}</td></tr>`).join('')}</tbody></table></div>` : '';
  const cuerpo = `<h1>Clientes</h1><p class="sub">Cada ticketera que usa el reproductor tiene su propia clave de API.</p>
    ${aviso}
    <div class="card tabla">${clientes.length ? `<table><thead><tr><th>Cliente</th><th>Clave</th><th>Precio por entrada</th><th>Dominios</th><th>Eventos</th><th></th></tr></thead><tbody>${filas}</tbody></table>` : '<p class="muted" style="margin:0">Todavía no hay clientes.</p>'}</div>
    <h2>Nuevo cliente</h2>
    <form method="post" action="/panel/clientes" class="card" style="max-width:620px">
      <label>Nombre</label><input name="nombre" required maxlength="80" placeholder="Ej: Ticketera de Juan">
      <label>Precio por entrada (vacío = ${plata(config.precioEntrada)})</label><input name="precio_entrada" type="number" step="0.01" min="0">
      <label>Dominios donde puede ir el reproductor (opcional, separados por espacio)</label><input name="dominios" placeholder="ticketera.com www.ticketera.com">
      <div style="margin-top:16px"><button class="btn">Crear cliente y generar clave</button></div>
    </form>${resumenMeses}`;
  enviar(res, 200, pagina({ titulo: 'Clientes', cuerpo, nav: 'panel', activo: 'clientes' }));
}

function nuevaClave() {
  const k = 'pv_' + crypto.randomBytes(24).toString('hex');
  return { k, hash: sha256(k), prefijo: k.slice(0, 9) };
}

function avisoClave(nombre, k) {
  return `<div class="okmsg"><b>Clave de API de ${esc(nombre)}</b> — copiala ahora, no se vuelve a mostrar:
    <div class="dato" style="margin-top:8px"><code id="k1">${esc(k)}</code><button class="btn sec chico" data-copiar="k1">Copiar</button></div>
    Pasásela al cliente por un canal privado junto con la <a href="/integracion">guía de integración</a>.</div>`;
}

const limpiarDominios = (s) => String(s || '').toLowerCase().split(/[\s,]+/)
  .map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim())
  .filter((d) => /^(\*\.)?[a-z0-9.-]+(:\d+)?$/.test(d)).slice(0, 10).join(' ');

/* ------------------------------------------------------------------ API para ticketeras */

async function api(req, res, partes) {
  const cabecera = String(req.headers.authorization || '');
  const clave = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : String(req.headers['x-api-key'] || '').trim();
  const cliente = clave ? q.clientePorClave(clave) : null;
  if (!cliente) return json(res, 401, { error: 'Clave de API inválida.' });

  // GET /api/v1/eventos
  if (req.method === 'GET' && partes.length === 1 && partes[0] === 'eventos') {
    const evs = db.prepare('SELECT * FROM eventos WHERE cliente_id = ? ORDER BY COALESCE(fecha, creado) DESC LIMIT 100').all(cliente.id);
    const estados = await Promise.all(evs.map((e) => (e.activo ? estadoEvento(e) : { estado: 'cerrado' })));
    return json(res, 200, { eventos: evs.map((e, i) => ({ id: e.id, titulo: e.titulo, fecha: e.fecha, estado: estados[i].estado })) });
  }

  const ev = partes[0] === 'eventos' && /^\d+$/.test(partes[1] || '') ? db.prepare('SELECT * FROM eventos WHERE id = ? AND cliente_id = ?').get(Number(partes[1]), cliente.id) : null;
  if (partes[0] === 'eventos' && partes[1] && !ev) return json(res, 404, { error: 'Evento inexistente.' });

  // GET /api/v1/eventos/:id
  if (req.method === 'GET' && ev && partes.length === 2) {
    const est = ev.activo ? await estadoEvento(ev) : { estado: 'cerrado' };
    const r = resumen(ev.id);
    return json(res, 200, { id: ev.id, titulo: ev.titulo, fecha: ev.fecha, estado: est.estado, entradas: r.emitidas, mirando_ahora: r.ahora });
  }

  // POST /api/v1/eventos/:id/accesos  { "comprador": "ID-de-tu-entrada", "horas": 24 }
  if (req.method === 'POST' && ev && partes.length === 3 && partes[2] === 'accesos') {
    const body = await leerCuerpo(req);
    const comprador = String(body.comprador || '').trim();
    if (!/^[\w.@:+\-]{1,100}$/.test(comprador)) return json(res, 422, { error: 'Falta "comprador": un identificador único de la entrada (letras, números, . _ - @ : +, hasta 100).' });
    if (!ev.activo) return json(res, 409, { error: 'El evento está desactivado.' });
    const existe = db.prepare('SELECT revocado FROM accesos WHERE evento_id = ? AND comprador = ?').get(ev.id, comprador);
    if (existe && existe.revocado) return json(res, 409, { error: 'Esa entrada fue anulada.' });
    const horas = Math.min(Math.max(Number(body.horas) || 24, 1), 168);
    const l = linkDeAcceso(req, ev, comprador, horas);
    return json(res, existe ? 200 : 201, { comprador, url: l.url, vence: l.vence, nueva: !existe });
  }

  // DELETE /api/v1/eventos/:id/accesos/:comprador  (devolución: anula la entrada)
  if (req.method === 'DELETE' && ev && partes.length === 4 && partes[2] === 'accesos') {
    const r = db.prepare('UPDATE accesos SET revocado = 1, sesion = NULL WHERE evento_id = ? AND comprador = ?').run(ev.id, decodeURIComponent(partes[3]));
    if (!r.changes) return json(res, 404, { error: 'No existe esa entrada.' });
    return json(res, 200, { anulada: true });
  }

  return json(res, 404, { error: 'Ruta inexistente. Ver /integracion.' });
}

/* ------------------------------------------------------------------ reproductor */

function cabecerasReproductor(acceso) {
  const ev = acceso && db.prepare('SELECT c.dominios FROM eventos e JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?').get(acceso.evento_id);
  const dom = ev && ev.dominios ? ev.dominios.split(' ').map((d) => `https://${d}`).join(' ') : '*';
  return {
    'Content-Security-Policy': `frame-ancestors 'self' ${dom}`,
    'Referrer-Policy': 'no-referrer',
  };
}

function leerTicket(t) {
  const d = verificar(t);
  if (!d || typeof d.a !== 'number') return { error: 'Link inválido', detalle: 'Volvé a entrar desde la página donde compraste la entrada.' };
  if (d.vencido) return { error: 'Este link venció', detalle: 'Volvé a entrar desde la página donde compraste la entrada para obtener uno nuevo.' };
  const a = q.acceso(d.a);
  if (!a) return { error: 'Link inválido', detalle: '' };
  if (a.revocado) return { error: 'Esta entrada fue anulada', detalle: '' };
  return { acceso: a };
}

async function ver(req, res, t, accion) {
  const tk = leerTicket(t);
  if (!accion) {
    if (tk.error) return enviar(res, 403, mensaje(tk.error, tk.detalle), 'text/html; charset=utf-8', cabecerasReproductor(null));
    const hlsUrl = fs.existsSync(path.join(__dirname, 'public', 'hls.min.js')) ? '/js/r.js' : config.hlsCdn;
    return enviar(res, 200, reproductor({ token: t, hlsUrl }), 'text/html; charset=utf-8', cabecerasReproductor(tk.acceso));
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  if (tk.error) return json(res, 200, tk);
  const body = await leerCuerpo(req, 4096);
  const s = String(body.s || '').slice(0, 64);
  if (!s) return json(res, 400, { error: 'Sesión inválida' });
  const a = tk.acceso;
  const ahoraMs = Date.now();
  if (accion === 'iniciar') {
    // La pantalla más nueva se queda con la entrada; la anterior se corta en su próximo latido.
    db.prepare(`UPDATE accesos SET sesion = ?, sesion_latido = ?, aperturas = aperturas + 1,
        primera_vista = COALESCE(primera_vista, ?), ultima_vista = ? WHERE id = ?`).run(s, ahoraMs, ahora(), ahora(), a.id);
  } else if (accion === 'latido') {
    if (a.sesion && a.sesion !== s) return json(res, 200, { expulsado: true });
    db.prepare('UPDATE accesos SET sesion = ?, sesion_latido = ?, ultima_vista = ? WHERE id = ?').run(s, ahoraMs, ahora(), a.id);
  } else {
    return json(res, 404, { error: 'Ruta inexistente' });
  }
  const ev = q.evento(a.evento_id);
  if (!ev) return json(res, 200, { error: 'Evento inexistente' });
  const est = await estadoEvento(ev);
  // Si nada cambió, en el latido no hace falta firmar URLs nuevas.
  const necesitaFuentes = accion === 'iniciar' || body.estado !== est.estado;
  let lista = [];
  try {
    lista = necesitaFuentes ? await fuentes(ev, est) : [];
  } catch (e) {
    console.error('[ver]', e.message);
    return json(res, 200, { estado: 'error' });
  }
  return json(res, 200, { estado: est.estado, titulo: ev.titulo, fuentes: necesitaFuentes ? lista : undefined });
}

/* ------------------------------------------------------------------ rutas */

async function rutas(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const partes = p.split('/').filter(Boolean);

  if (p === '/salud') return json(res, 200, { ok: true });
  if (p === '/robots.txt') return enviar(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain');
  if (p === '/js/r.js') {
    const f = path.join(__dirname, 'public', 'hls.min.js');
    if (!fs.existsSync(f)) return redirigir(res, config.hlsCdn);
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(f).pipe(res);
  }
  if (p === '/') {
    if (esAdmin(req)) return redirigir(res, '/panel');
    return enviar(res, 200, pagina({ titulo: 'Inicio', cuerpo: `<h1>${esc(config.marca)}</h1><p class="sub">Transmisiones privadas para plataformas de venta de entradas.</p><p><a class="btn" href="/panel/login">Ingresar</a> <a class="btn sec" href="/integracion">Guía de integración</a></p>` }));
  }
  if (p === '/integracion') return enviar(res, 200, pagina({ titulo: 'Guía de integración', cuerpo: guia(baseUrl(req)), nav: esAdmin(req) ? 'panel' : null, activo: 'doc' }));

  if (partes[0] === 'ver' && partes[1]) return ver(req, res, partes[1], partes[2]);
  if (partes[0] === 'api' && partes[1] === 'v1') return api(req, res, partes.slice(2));

  if (partes[0] !== 'panel') return enviar(res, 404, pagina({ titulo: 'No encontrado', cuerpo: '<h1>No encontrado</h1>' }));

  /* ---------- panel ---------- */
  if (p === '/panel/login') {
    let err = '';
    if (req.method === 'POST') {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
      const body = await leerCuerpo(req);
      if (!config.adminPassword) err = 'Falta configurar ADMIN_PASSWORD en el servidor.';
      else if (!puedeIntentar(ip)) err = 'Demasiados intentos. Esperá unos minutos.';
      else if (iguales(body.clave || '', config.adminPassword)) {
        const c = firmar({ u: 'admin', e: Math.floor(Date.now() / 1000) + 12 * 3600 });
        return redirigir(res, '/panel', { 'Set-Cookie': `pv=${c}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${esHttps(req) ? '; Secure' : ''}` });
      } else {
        intentos.get(ip).push(Date.now());
        err = 'Clave incorrecta.';
      }
    }
    const cuerpo = `<div class="card" style="max-width:380px;margin:40px auto"><h1>Ingresar</h1><p class="sub">Panel de administración</p>
      ${err ? `<div class="error">${esc(err)}</div>` : ''}
      <form method="post"><label>Clave</label><input type="password" name="clave" autofocus required autocomplete="current-password">
      <div style="margin-top:16px"><button class="btn">Entrar</button></div></form></div>`;
    return enviar(res, err ? 401 : 200, pagina({ titulo: 'Ingresar', cuerpo }));
  }
  if (p === '/panel/salir') return redirigir(res, '/', { 'Set-Cookie': 'pv=; Path=/; Max-Age=0' });
  if (!esAdmin(req)) return redirigir(res, '/panel/login');

  if (p === '/panel') return vistaEventos(res);

  if (p === '/panel/eventos/nuevo') {
    if (req.method !== 'POST') return vistaNuevoEvento(res);
    const b = await leerCuerpo(req);
    const cli = q.cliente(Number(b.cliente_id));
    const titulo = String(b.titulo || '').trim().slice(0, 140);
    if (!cli || !titulo) return vistaNuevoEvento(res, 'Elegí el cliente y poné un título.', b);
    const grabar = b.grabar ? 1 : 0;
    const horas = Math.min(Math.max(parseInt(b.repeticion_horas, 10) || 0, 0), 2160);
    let e;
    try {
      e = await cf.crearEntrada(`${cli.nombre} · ${titulo}`, grabar, horas);
    } catch (err) {
      return vistaNuevoEvento(res, 'No se pudo crear la señal en Cloudflare: ' + err.message, b);
    }
    const fecha = b.fecha ? new Date(b.fecha + (b.fecha.length === 16 ? ':00-03:00' : '')).toISOString() : null;
    const r = db.prepare(`INSERT INTO eventos (cliente_id, titulo, fecha, cf_uid, rtmps_url, rtmps_key, srt_url, srt_id, srt_pass, grabar, repeticion_horas, creado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(cli.id, titulo, fecha, e.cf_uid, e.rtmps_url, cifrar(e.rtmps_key), e.srt_url, e.srt_id, cifrar(e.srt_pass), grabar, horas, ahora());
    return redirigir(res, `/panel/eventos/${r.lastInsertRowid}?creado=1`);
  }

  if (partes[1] === 'eventos' && /^\d+$/.test(partes[2] || '')) {
    const ev = q.evento(Number(partes[2]));
    if (!ev) return redirigir(res, '/panel');
    const accion = partes[3];
    if (!accion) return vistaEvento(req, res, ev, url.searchParams.get('creado') ? '<div class="okmsg">Evento creado. Cargá estos datos en vMix u OBS y probá con el reproductor de prueba.</div>' : '');
    if (accion === 'accesos.csv') {
      const filas = db.prepare('SELECT comprador, creado, primera_vista, ultima_vista, aperturas, revocado FROM accesos WHERE evento_id = ? ORDER BY id').all(ev.id);
      const c = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const csv = ['comprador,emitida,primera_vista,ultima_vista,aperturas,anulada']
        .concat(filas.map((f) => [f.comprador, f.creado, f.primera_vista, f.ultima_vista, f.aperturas, f.revocado ? 'si' : 'no'].map(c).join(','))).join('\n');
      return enviar(res, 200, '﻿' + csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="entradas-evento-${ev.id}.csv"` });
    }
    if (accion === 'prueba') {
      const l = linkDeAcceso(req, ev, 'prueba-panel', 12);
      db.prepare('UPDATE accesos SET revocado = 0 WHERE id = ?').run(l.acceso.id);
      return redirigir(res, l.url.replace(baseUrl(req), ''));
    }
    if (req.method !== 'POST') return redirigir(res, `/panel/eventos/${ev.id}`);
    if (accion === 'activo') {
      db.prepare('UPDATE eventos SET activo = 1 - activo WHERE id = ?').run(ev.id);
      olvidar(ev.id);
      return redirigir(res, `/panel/eventos/${ev.id}`);
    }
    if (accion === 'borrar') {
      try { if (ev.cf_uid) await cf.borrarEntrada(ev.cf_uid); } catch (e) {
        if (!/404/.test(e.message)) return vistaEvento(req, res, ev, `<div class="error">No se pudo borrar en Cloudflare: ${esc(e.message)}</div>`);
      }
      db.prepare('DELETE FROM eventos WHERE id = ?').run(ev.id);
      olvidar(ev.id);
      return vistaEventos(res, '<div class="okmsg">Evento borrado.</div>');
    }
  }

  if (p === '/panel/clientes') {
    if (req.method !== 'POST') return vistaClientes(res);
    const b = await leerCuerpo(req);
    const nombre = String(b.nombre || '').trim().slice(0, 80);
    if (!nombre) return vistaClientes(res, '<div class="error">Poné un nombre.</div>');
    const k = nuevaClave();
    const precio = b.precio_entrada === '' || b.precio_entrada == null ? null : Number(b.precio_entrada);
    db.prepare('INSERT INTO clientes (nombre, api_hash, api_prefijo, dominios, precio_entrada, creado) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nombre, k.hash, k.prefijo, limpiarDominios(b.dominios), Number.isFinite(precio) ? precio : null, ahora());
    return vistaClientes(res, avisoClave(nombre, k.k));
  }
  if (partes[1] === 'clientes' && /^\d+$/.test(partes[2] || '') && req.method === 'POST') {
    const c = q.cliente(Number(partes[2]));
    if (!c) return redirigir(res, '/panel/clientes');
    if (partes[3] === 'clave') {
      const k = nuevaClave();
      db.prepare('UPDATE clientes SET api_hash = ?, api_prefijo = ? WHERE id = ?').run(k.hash, k.prefijo, c.id);
      return vistaClientes(res, avisoClave(c.nombre, k.k));
    }
    const b = await leerCuerpo(req);
    const precio = b.precio_entrada === '' || b.precio_entrada == null ? null : Number(b.precio_entrada);
    db.prepare('UPDATE clientes SET nombre = ?, precio_entrada = ?, dominios = ?, activo = ? WHERE id = ?')
      .run(String(b.nombre || c.nombre).trim().slice(0, 80), Number.isFinite(precio) ? precio : null, limpiarDominios(b.dominios), b.activo ? 1 : 0, c.id);
    return vistaClientes(res, '<div class="okmsg">Cliente actualizado.</div>');
  }

  return redirigir(res, '/panel');
}

const server = http.createServer((req, res) => {
  rutas(req, res).catch((e) => {
    console.error('[error]', req.method, req.url, e);
    if (!res.headersSent) {
      if (String(req.url).startsWith('/api/') || String(req.url).startsWith('/ver/')) json(res, 500, { error: 'Error interno' });
      else enviar(res, 500, pagina({ titulo: 'Error', cuerpo: '<h1>Algo salió mal</h1><p class="sub">Probá de nuevo en un momento.</p>' }));
    } else res.end();
  });
});

if (require.main === module) {
  server.listen(config.port, () => console.log(`${config.marca} escuchando en el puerto ${config.port}`));
}
module.exports = server;
