'use strict';
const config = require('./config');
const { esc } = require('./util');

/** Guía para la ticketera del cliente. No menciona proveedores: solo nuestra marca. */
module.exports = function guia(base) {
  const B = esc(base);
  const M = esc(config.marca);
  return `<div class="doc">
<h1>Guía de integración</h1>
<p class="sub">Cómo mostrar las transmisiones de ${M} dentro de tu ticketera. Vos seguís manejando la venta, los usuarios y los pagos; nosotros entregamos el video.</p>

<div class="card">
<b>Resumen en 3 pasos</b>
<ol>
<li>Te damos una <b>clave de API</b> y el <b>ID de cada evento</b>.</li>
<li>Cuando un comprador con entrada válida quiere ver, tu servidor nos pide un <b>link personal</b> para esa entrada.</li>
<li>Mostrás ese link dentro de tu página con un <code>&lt;iframe&gt;</code> (o redirigís al comprador).</li>
</ol>
Cada entrada se puede ver en <b>una sola pantalla a la vez</b>: mientras esté abierta en un dispositivo, en otro aparece "ya se está usando". Al cerrarla se libera. Los links vencen solos.
</div>

<h2>1. Autenticación</h2>
<p>Todas las llamadas llevan tu clave en la cabecera <code>Authorization</code>. <b>Usala solo desde tu servidor</b>, nunca en el navegador ni en la app.</p>
<pre>Authorization: Bearer pv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</pre>

<h2>2. Pedir el link de una entrada</h2>
<p><code>POST ${B}/api/v1/eventos/{ID_EVENTO}/accesos</code></p>
<p>En <code>comprador</code> mandá un identificador <b>único por entrada</b> de tu sistema (por ejemplo el número de entrada o de orden + posición). Si lo pedís de nuevo para la misma entrada, te damos un link nuevo pero cuenta como la misma entrada.</p>
<pre>curl -X POST ${B}/api/v1/eventos/12/accesos \\
  -H "Authorization: Bearer TU_CLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"comprador": "entrada-48213", "horas": 24}'</pre>
<p>Respuesta:</p>
<pre>{
  "comprador": "entrada-48213",
  "url": "${B}/ver/eyJhIjoxMjMsImUiOjE3...",
  "vence": "2026-10-26T03:00:00.000Z",
  "nueva": true
}</pre>
<p><code>horas</code> es opcional (por defecto 24, máximo 168). Conviene pedir el link en el momento en que el comprador entra a ver, no al comprar.</p>

<h2>3. Mostrar el video</h2>
<p><b>Opción A — la más simple: redirigir.</b> Cuando el comprador toca "Ver evento", tu servidor pide el link y lo manda directo ahí. Se abre nuestra página a pantalla completa con <b>el logo de tu ticketera</b>, el título del evento, el video y un botón "Volver" a tu sitio.</p>
<pre>// PHP
header('Location: ' . $r['url']);
exit;

// Node / Express
res.redirect(url);</pre>
<p><b>Opción B: dentro de tu página</b>, con un iframe:</p>
<pre>&lt;div style="position:relative;padding-top:56.25%"&gt;
  &lt;iframe src="URL_DEL_LINK"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
    allowfullscreen&gt;&lt;/iframe&gt;
&lt;/div&gt;</pre>
<p>El reproductor no muestra ninguna marca. Antes de empezar dice "La transmisión todavía no empezó" y arranca solo cuando sale la señal. Al terminar ofrece la repetición si el evento la tiene.</p>
<p><b>Ver en la TV:</b> el reproductor trae su propio botón para mandar el video a la tele por <b>Chromecast</b> (Chrome, Android) o <b>AirPlay</b> (iPhone, Mac). Aparece solo cuando hay una TV compatible en la misma red Wi-Fi. No tenés que agregar nada: solo mantené el <code>allow</code> del iframe como en el ejemplo y que tu página use <code>https</code>.</p>

<h2>Ejemplo en PHP</h2>
<pre>$ch = curl_init("${B}/api/v1/eventos/$idEvento/accesos");
curl_setopt_array($ch, [
  CURLOPT_POST =&gt; true,
  CURLOPT_RETURNTRANSFER =&gt; true,
  CURLOPT_HTTPHEADER =&gt; ["Authorization: Bearer " . getenv('VIDEO_API_KEY'), "Content-Type: application/json"],
  CURLOPT_POSTFIELDS =&gt; json_encode(["comprador" =&gt; "entrada-" . $entrada-&gt;id]),
]);
$r = json_decode(curl_exec($ch), true);
echo '&lt;iframe src="' . htmlspecialchars($r['url']) . '" allow="autoplay; fullscreen" allowfullscreen&gt;&lt;/iframe&gt;';</pre>

<h2>Ejemplo en Node.js</h2>
<pre>const r = await fetch(\`${B}/api/v1/eventos/\${idEvento}/accesos\`, {
  method: 'POST',
  headers: { Authorization: \`Bearer \${process.env.VIDEO_API_KEY}\`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ comprador: \`entrada-\${entrada.id}\` }),
});
const { url } = await r.json();</pre>

<h2>Otras llamadas</h2>
<table>
<tr><th>Llamada</th><th>Para qué</th></tr>
<tr><td><code>GET /api/v1/eventos</code></td><td>Tus eventos con su estado: <code>espera</code>, <code>vivo</code>, <code>procesando</code>, <code>repeticion</code>, <code>terminado</code>, <code>cerrado</code>.</td></tr>
<tr><td><code>GET /api/v1/eventos/{id}</code></td><td>Estado del evento, entradas emitidas y cuántos están mirando ahora.</td></tr>
<tr><td><code>DELETE /api/v1/eventos/{id}/accesos/{comprador}</code></td><td>Anula una entrada (por ejemplo, si devolviste el dinero). Su link deja de funcionar y no se factura.</td></tr>
</table>

<h2>Errores</h2>
<table>
<tr><th>Código</th><th>Significa</th></tr>
<tr><td>401</td><td>Clave de API inválida.</td></tr>
<tr><td>404</td><td>El evento no existe o no es tuyo.</td></tr>
<tr><td>409</td><td>El evento está desactivado o la entrada fue anulada.</td></tr>
<tr><td>422</td><td>Falta <code>comprador</code> o tiene caracteres no permitidos.</td></tr>
</table>

<h2>Facturación</h2>
<p>Se factura cada <b>entrada distinta que efectivamente entró a ver</b> (cada <code>comprador</code> o código usado), menos las anuladas. Entrar varias veces con la misma entrada no suma.</p>
</div>`;
};
