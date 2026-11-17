/**
 * Copiador a R2 de la pasarela.
 *
 * Copia las grabaciones (MP4 de Stream) a un bucket R2 dentro de Cloudflare, por partes,
 * para que los gigas no pasen por el servidor de la pasarela. También entrega los archivos
 * con links firmados para bajarlos.
 *
 * Configuración del Worker (Cloudflare → Workers → este Worker → Settings):
 *   - Binding R2:  nombre  BUCKET  → el bucket de backups
 *   - Secreto:     CLAVE   → la misma que R2_CLAVE en Render
 */
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const err = (status, error) => json({ ok: false, error }, status);

function iguales(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmac(clave, texto) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const f = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto));
  return [...new Uint8Array(f)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Baja un pedazo (o todo) del MP4 y lo pasa a R2 sin cargarlo en memoria. */
async function traer(url, desde, hasta) {
  const headers = desde == null ? {} : { Range: `bytes=${desde}-${hasta}` };
  const r = await fetch(url, { headers });
  if (desde != null && r.status !== 206) throw new Error(`Stream no devolvió el pedazo pedido (${r.status})`);
  if (desde == null && !r.ok) throw new Error(`Stream respondió ${r.status}`);
  const largo = desde == null ? Number(r.headers.get('content-length')) : hasta - desde + 1;
  if (!largo) throw new Error('Stream no informó el tamaño');
  const { readable, writable } = new FixedLengthStream(largo);
  r.body.pipeTo(writable);
  return readable;
}

async function bajar(req, env, url) {
  const k = url.searchParams.get('k') || '';
  const e = Number(url.searchParams.get('e')) || 0;
  const f = url.searchParams.get('f') || '';
  if (!k || e < Date.now() / 1000 || !iguales(f, await hmac(env.CLAVE, `${k}|${e}`))) {
    return new Response('Link vencido o inválido. Pedí uno nuevo desde el panel.', { status: 403 });
  }
  const obj = await env.BUCKET.get(k, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response('No encontrado', { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('Accept-Ranges', 'bytes');
  h.set('Content-Type', 'video/mp4');
  const nombre = (url.searchParams.get('n') || 'grabacion.mp4').replace(/[^A-Za-z0-9._-]/g, '_');
  h.set('Content-Disposition', `attachment; filename="${nombre}"`);
  if (!('body' in obj)) return new Response(null, { status: 304, headers: h });
  if (obj.range && req.headers.get('Range')) {
    const ini = obj.range.offset || 0;
    const largo = obj.range.length != null ? obj.range.length : obj.size - ini;
    h.set('Content-Range', `bytes ${ini}-${ini + largo - 1}/${obj.size}`);
    h.set('Content-Length', String(largo));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers: h });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.BUCKET || !env.CLAVE) return err(500, 'Falta el binding BUCKET o el secreto CLAVE en el Worker');
    if (req.method === 'GET' && url.pathname === '/bajar') return bajar(req, env, url);
    if (req.method !== 'POST') return new Response('No encontrado', { status: 404 });
    if (!iguales(req.headers.get('Authorization') || '', 'Bearer ' + env.CLAVE)) return err(401, 'Clave incorrecta');

    let b;
    try { b = await req.json(); } catch { return err(400, 'JSON inválido'); }
    if (!b.clave || typeof b.clave !== 'string') return err(400, 'Falta la clave del archivo');

    try {
      switch (url.pathname) {
        case '/entero': {
          const o = await env.BUCKET.put(b.clave, await traer(b.url), { httpMetadata: { contentType: 'video/mp4' } });
          return json({ ok: true, tamano: o.size });
        }
        case '/iniciar': {
          const m = await env.BUCKET.createMultipartUpload(b.clave, { httpMetadata: { contentType: 'video/mp4' } });
          return json({ ok: true, uploadId: m.uploadId });
        }
        case '/parte': {
          const m = env.BUCKET.resumeMultipartUpload(b.clave, b.uploadId);
          const p = await m.uploadPart(Number(b.n), await traer(b.url, Number(b.desde), Number(b.hasta)));
          return json({ ok: true, partNumber: p.partNumber, etag: p.etag });
        }
        case '/completar': {
          const m = env.BUCKET.resumeMultipartUpload(b.clave, b.uploadId);
          const o = await m.complete(b.partes);
          return json({ ok: true, tamano: o.size });
        }
        case '/abortar': {
          await env.BUCKET.resumeMultipartUpload(b.clave, b.uploadId).abort();
          return json({ ok: true });
        }
        case '/borrar': {
          await env.BUCKET.delete(b.clave);
          return json({ ok: true });
        }
        default:
          return err(404, 'Ruta desconocida');
      }
    } catch (e) {
      return err(500, e.message || String(e));
    }
  },
};
