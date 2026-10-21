'use strict';
const config = require('./config');
const { esc } = require('./util');

const CSS = `
:root{--bg:#0e1014;--bg2:#13161c;--card:#181b22;--card2:#1e222b;--line:#2a2f3a;--txt:#eceef3;--muted:#9aa1ad;--acc:#7c6cff;--acc2:#5e4ee6;--ok:#34c88a;--warn:#f0b43c;--bad:#ef5350}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#a99fff}a:hover{color:#c7c0ff}
.top{background:var(--bg2);border-bottom:1px solid var(--line)}
.top .in{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.marca{font-weight:800;letter-spacing:.02em;font-size:17px;color:#fff;text-decoration:none;display:flex;align-items:center;gap:8px}
.marca i{width:10px;height:10px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 4px rgba(124,108,255,.18)}
.top nav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
.top nav a{color:var(--muted);text-decoration:none;padding:6px 10px;border-radius:8px}
.top nav a:hover,.top nav a.on{color:#fff;background:var(--card2)}
main{max-width:1100px;margin:0 auto;padding:24px 16px 60px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px}
.sub{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.kpi b{display:block;font-size:26px}.kpi span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:13px}
.tabla{overflow-x:auto}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--acc);color:#fff;border:0;border-radius:10px;padding:9px 14px;font:600 14px system-ui,sans-serif;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--acc2);color:#fff}.btn.sec{background:var(--card2);border:1px solid var(--line)}.btn.sec:hover{background:var(--line)}
.btn.peligro{background:transparent;border:1px solid #5a2a2c;color:#ff8a87}.btn.chico{padding:5px 10px;font-size:13px}
label{display:block;font-weight:600;font-size:13px;color:var(--muted);margin:12px 0 5px}
input,select,textarea{width:100%;background:var(--bg2);color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:15px system-ui,sans-serif}
input:focus,select:focus{outline:2px solid var(--acc);border-color:transparent}
.check{display:flex;gap:8px;align-items:center;color:var(--txt);font-weight:500}.check input{width:auto}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;background:var(--card2);color:var(--muted);border:1px solid var(--line)}
.pill.vivo{background:rgba(239,83,80,.15);color:#ff7b78;border-color:rgba(239,83,80,.4)}
.pill.repeticion,.pill.ok{background:rgba(52,200,138,.12);color:#5fe0a6;border-color:rgba(52,200,138,.35)}
.pill.procesando,.pill.espera{background:rgba(240,180,60,.12);color:#f5c45e;border-color:rgba(240,180,60,.35)}
.dato{display:flex;gap:8px;align-items:center;margin-bottom:8px}.dato code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
.aviso{border-left:3px solid var(--warn);background:rgba(240,180,60,.08);padding:12px 14px;border-radius:8px;margin:12px 0}
.error{border-left:3px solid var(--bad);background:rgba(239,83,80,.08);padding:12px 14px;border-radius:8px;margin:12px 0}
.okmsg{border-left:3px solid var(--ok);background:rgba(52,200,138,.08);padding:12px 14px;border-radius:8px;margin:12px 0}
.fila{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.muted{color:var(--muted)}small{color:var(--muted)}
pre{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto;font-size:13px;line-height:1.45}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.doc h2{border-top:1px solid var(--line);padding-top:22px}.doc p,.doc li{max-width:760px}
`;

function pagina({ titulo, cuerpo, nav = null, activo = '' }) {
  const menu = nav === 'panel'
    ? `<nav>
        <a href="/panel" class="${activo === 'eventos' ? 'on' : ''}">Eventos</a>
        <a href="/panel/clientes" class="${activo === 'clientes' ? 'on' : ''}">Clientes</a>
        <a href="/integracion" class="${activo === 'doc' ? 'on' : ''}">Guía de integración</a>
        <a href="/panel/salir">Salir</a>
      </nav>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)} · ${esc(config.marca)}</title>
<style>${CSS}</style></head><body>
<header class="top"><div class="in"><a class="marca" href="${nav === 'panel' ? '/panel' : '/'}"><i></i>${esc(config.marca)}</a>${menu}</div></header>
<main>${cuerpo}</main>
<script>
document.addEventListener('click',function(e){var b=e.target.closest('[data-copiar]');if(!b)return;
var t=document.getElementById(b.getAttribute('data-copiar'));if(!t)return;
navigator.clipboard.writeText(t.textContent.trim()).then(function(){var o=b.textContent;b.textContent='Copiado';setTimeout(function(){b.textContent=o},1400)})});
document.addEventListener('change',function(e){var f=e.target;if(!f.hasAttribute('data-logo')||!f.files[0])return;
if(f.files[0].size>200*1024){alert('El logo pesa más de 200 KB. Achicalo y probá de nuevo.');f.value='';return}
var r=new FileReader();r.onload=function(){f.nextElementSibling.value=r.result};r.readAsDataURL(f.files[0])});
document.addEventListener('submit',function(e){var m=e.target.getAttribute('data-confirmar');if(m&&!confirm(m))e.preventDefault()});
</script>
</body></html>`;
}

/** Página del reproductor: sin marcas, pensada para ir dentro de un iframe. */
function reproductor({ token, hlsUrl, titulo = '', marca = null }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(titulo || 'Transmisión')}</title>
<style>
html,body{margin:0;height:100%;background:#000;color:#fff;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
video{position:absolute;inset:0;width:100%;height:100%;background:#000}
#marco{position:absolute;inset:0}
#cab{display:none}
body.pagina{background:#0b0c10}
body.pagina #cab{position:absolute;top:0;left:0;right:0;height:60px;display:flex;align-items:center;gap:14px;padding:0 16px;background:#111318;border-bottom:1px solid #23262e;box-sizing:border-box}
body.pagina #marco{top:60px}
#cab img{max-height:38px;max-width:160px;object-fit:contain}
#cab .nom{font-weight:800;white-space:nowrap}
#cab .tit{color:#b4b9c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
#cab a{color:#fff;text-decoration:none;border:1px solid #3a3e48;border-radius:99px;padding:6px 12px;font-size:13px;font-weight:600;white-space:nowrap}
@media (max-width:560px){#cab .tit{display:none}#cab{justify-content:space-between}}
#msg{position:absolute;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;text-align:center;padding:20px;background:radial-gradient(circle at 50% 40%,#1a1d24,#000 70%)}
#msg[hidden]{display:none}
#msg h2{margin:0;font-size:clamp(17px,3.2vw,24px);font-weight:700}
#msg p{margin:0;color:#b4b9c4;max-width:520px}
.btn{background:#fff;color:#000;border:0;border-radius:99px;padding:10px 18px;font:700 14px system-ui,sans-serif;cursor:pointer}
.spin{width:34px;height:34px;border:3px solid rgba(255,255,255,.18);border-top-color:#fff;border-radius:50%;animation:g 1s linear infinite}
@keyframes g{to{transform:rotate(360deg)}}
#vivo{position:absolute;top:12px;left:12px;background:#e53935;color:#fff;font:800 11px system-ui,sans-serif;letter-spacing:.08em;padding:4px 8px;border-radius:4px;pointer-events:none}
#vivo[hidden],#sonido[hidden],#partes[hidden],#airplay[hidden],#cast[hidden],#tele[hidden]{display:none}
#acciones{position:absolute;top:10px;right:10px;display:flex;gap:8px;align-items:center;z-index:3}
.ico{width:40px;height:40px;border-radius:50%;border:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:9px;box-sizing:border-box}
.ico svg{width:22px;height:22px;fill:#fff}
google-cast-launcher{width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.55);padding:9px;box-sizing:border-box;cursor:pointer;--connected-color:#fff;--disconnected-color:#fff}
#tele{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;text-align:center;padding:20px;background:radial-gradient(circle at 50% 40%,#1a1d24,#000 70%);z-index:2}
#tele h2{margin:0;font-size:clamp(17px,3.2vw,24px)}#tele p{margin:0;color:#b4b9c4}
#partes{position:absolute;bottom:64px;left:50%;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
#partes button{background:rgba(0,0,0,.6);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:99px;padding:5px 12px;font:600 13px system-ui,sans-serif;cursor:pointer}
#partes button.on{background:#fff;color:#000}
</style></head><body>
<header id="cab">${marca && marca.logo ? `<img src="${esc(marca.logo)}" alt="${esc(marca.nombre)}">` : marca ? `<span class="nom">${esc(marca.nombre)}</span>` : ''}
<span class="tit">${esc(titulo)}</span>${marca && marca.sitio ? `<a href="${esc(marca.sitio)}">Volver</a>` : ''}</header>
<div id="marco">
<video id="v" playsinline controls></video>
<div id="vivo" hidden>EN VIVO</div>
<div id="tele" hidden><h2>Viendo en la TV</h2><p id="teleNombre"></p><p>Usá este dispositivo como control. Para volver a verlo acá, tocá el ícono de transmitir.</p></div>
<div id="acciones">
<button id="sonido" class="btn" hidden>Activar sonido</button>
<button id="airplay" class="ico" hidden title="Ver en la TV (AirPlay)" aria-label="AirPlay"><svg viewBox="0 0 24 24"><path d="M6 22h12l-6-6-6 6zM21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4v-2H3V5h18v12h-4v2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg></button>
<google-cast-launcher id="cast" hidden title="Ver en la TV (Chromecast)"></google-cast-launcher>
</div>
<div id="partes" hidden></div>
<div id="msg"><div class="spin"></div><p>Conectando…</p></div>
</div>
<script>try{if(window.self===window.top)document.body.className='pagina'}catch(e){}</script>
<script src="${esc(hlsUrl)}"></script>
<script>
(function(){
var T=${JSON.stringify(token)};
var S=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Math.random()).slice(2)+Date.now();
var v=document.getElementById('v'),msg=document.getElementById('msg'),vivo=document.getElementById('vivo'),
    sonido=document.getElementById('sonido'),partesEl=document.getElementById('partes');
var hls=null,actual=null,parte=0,ultimo=null,timer=null,fuera=false,fuente=null,titulo='',enTele=false,castCtx=null;
var tele=document.getElementById('tele'),airplay=document.getElementById('airplay'),castBtn=document.getElementById('cast');
// Safari (Mac/iPhone): video nativo, así AirPlay manda el video a la TV
var nativo=!!window.WebKitPlaybackTargetAvailabilityEvent&&!!v.canPlayType('application/vnd.apple.mpegurl');
if(window.WebKitPlaybackTargetAvailabilityEvent){v.setAttribute('x-webkit-airplay','allow');
 v.addEventListener('webkitplaybacktargetavailabilitychanged',function(e){airplay.hidden=e.availability!=='available'});
 airplay.onclick=function(){v.webkitShowPlaybackTargetPicker()}}
var TEXTOS={espera:['La transmisión todavía no empezó','Dejá esta pantalla abierta: arranca sola cuando comience.'],
 procesando:['La transmisión terminó','La repetición va a estar disponible en unos minutos.'],
 terminado:['Este evento ya finalizó','Gracias por acompañarnos.'],
 cerrado:['Este evento no está disponible',''],
 error:['No pudimos conectar','Reintentamos en unos segundos…']};
function mostrar(t,p,boton){msg.hidden=false;msg.innerHTML='';var h=document.createElement('h2');h.textContent=t;msg.appendChild(h);
 if(p){var q=document.createElement('p');q.textContent=p;msg.appendChild(q)}
 if(boton){var b=document.createElement('button');b.className='btn';b.textContent=boton[0];b.onclick=boton[1];msg.appendChild(b)}}
function parar(){fuente=null;if(hls){hls.destroy();hls=null}v.removeAttribute('src');try{v.load()}catch(e){}actual=null;vivo.hidden=true;partesEl.hidden=true}
function reproducir(){var p=v.play();if(p&&p.catch)p.catch(function(){v.muted=true;sonido.hidden=false;v.play().catch(function(){})})}
sonido.onclick=function(){v.muted=false;sonido.hidden=true;reproducir()};
function cargar(f){actual=f.id;fuente=f;msg.hidden=true;
 if(enTele){castCargar(f);return}
 if(nativo){if(hls){hls.destroy();hls=null}v.src=f.url;reproducir();return}
 if(window.Hls&&Hls.isSupported()){if(hls)hls.destroy();hls=new Hls({lowLatencyMode:true,backBufferLength:60});
  hls.on(Hls.Events.ERROR,function(e,d){if(d.fatal){if(d.type===Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError()}else{parar();setTimeout(function(){pedir('iniciar')},3000)}}});
  hls.loadSource(f.url);hls.attachMedia(v);hls.on(Hls.Events.MANIFEST_PARSED,reproducir)}
 else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=f.url;reproducir()}
 else{mostrar('Tu navegador no puede reproducir este video','Probá con Chrome, Safari o Firefox actualizados.')}}
function dibujarPartes(fs){partesEl.innerHTML='';if(fs.length<2){partesEl.hidden=true;return}partesEl.hidden=false;
 fs.forEach(function(f,i){var b=document.createElement('button');b.textContent='Parte '+(i+1);if(i===parte)b.className='on';
  b.onclick=function(){parte=i;cargar(fs[i]);dibujarPartes(fs)};partesEl.appendChild(b)})}
function aplicar(d){
 if(d.titulo)titulo=d.titulo;
 if(d.expulsado||d.error){castCortar()}
 if(d.expulsado){fuera=true;parar();clearInterval(timer);
  mostrar('Esta entrada se abrió en otra pantalla','Cada entrada se puede ver en un solo dispositivo a la vez.',['Ver en esta pantalla',function(){fuera=false;mostrar('Conectando…');pedir('iniciar');timer=setInterval(function(){pedir('latido')},20000)}]);return}
 if(d.error){parar();clearInterval(timer);mostrar(d.error,d.detalle||'');return}
 ultimo=d.estado;
 if(d.estado==='vivo'||d.estado==='repeticion'){var fs=d.fuentes||[];if(!fs.length)return;
  if(parte>=fs.length)parte=fs.length-1;
  if(d.estado==='vivo')parte=0;
  vivo.hidden=d.estado!=='vivo';
  if(actual!==fs[parte].id)cargar(fs[parte]);
  if(d.estado==='repeticion')dibujarPartes(fs);else partesEl.hidden=true;return}
 parar();var t=TEXTOS[d.estado]||TEXTOS.error;mostrar(t[0],t[1]);}
function pedir(que){if(fuera&&que==='latido')return;
 fetch('/ver/'+encodeURIComponent(T)+'/'+que,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({s:S,estado:ultimo}),cache:'no-store'})
 .then(function(r){return r.json()}).then(aplicar).catch(function(){if(!actual)mostrar(TEXTOS.error[0],TEXTOS.error[1])})}
/* ---------- Chromecast ---------- */
function castCortar(){try{if(castCtx&&enTele)castCtx.endCurrentSession(true)}catch(e){}}
function formatoFmp4(url){
 // Si los segmentos son fMP4 el receptor necesita saberlo
 return fetch(url).then(function(r){return r.text()}).then(function(t){
  if(t.indexOf('#EXT-X-MAP')>=0)return true;
  var l=t.split(/\\r?\\n/).filter(function(x){return x&&x[0]!=='#'})[0];
  if(!l)return false;
  return fetch(new URL(l.trim(),url).href).then(function(r){return r.text()}).then(function(t2){return t2.indexOf('#EXT-X-MAP')>=0})
 }).catch(function(){return false})}
function castCargar(f){
 var ses=castCtx&&castCtx.getCurrentSession();if(!ses)return;
 v.pause();tele.hidden=false;
 formatoFmp4(f.url).then(function(fmp4){
  var mi=new chrome.cast.media.MediaInfo(f.url,'application/x-mpegurl');
  mi.streamType=ultimo==='vivo'?chrome.cast.media.StreamType.LIVE:chrome.cast.media.StreamType.BUFFERED;
  if(fmp4){mi.hlsSegmentFormat=chrome.cast.media.HlsSegmentFormat.FMP4;mi.hlsVideoSegmentFormat=chrome.cast.media.HlsVideoSegmentFormat.FMP4}
  var md=new chrome.cast.media.GenericMediaMetadata();md.title=titulo||'Transmisión';mi.metadata=md;
  var rq=new chrome.cast.media.LoadRequest(mi);rq.autoplay=true;
  if(ultimo!=='vivo'&&v.currentTime>5)rq.currentTime=v.currentTime;
  ses.loadMedia(rq).catch(function(){})})}
window.__onGCastApiAvailable=function(ok){
 if(!ok||!window.cast||!cast.framework)return;
 castCtx=cast.framework.CastContext.getInstance();
 castCtx.setOptions({receiverApplicationId:chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,autoJoinPolicy:chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED});
 function verBoton(){castBtn.hidden=castCtx.getCastState()===cast.framework.CastState.NO_DEVICES_AVAILABLE}
 castCtx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED,verBoton);verBoton();
 castCtx.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED,function(e){
  var S2=cast.framework.SessionState;
  if(e.sessionState===S2.SESSION_STARTED||e.sessionState===S2.SESSION_RESUMED){
   enTele=true;var dev=e.session.getCastDevice();document.getElementById('teleNombre').textContent=dev&&dev.friendlyName?dev.friendlyName:'';
   if(fuente)castCargar(fuente)}
  else if(e.sessionState===S2.SESSION_ENDED){
   enTele=false;tele.hidden=true;if(fuente){var f=fuente;actual=null;cargar(f)}}})};
(function(){var s=document.createElement('script');s.src='https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';s.async=true;document.head.appendChild(s)})();
pedir('iniciar');timer=setInterval(function(){pedir('latido')},20000);
document.addEventListener('visibilitychange',function(){if(!document.hidden&&!fuera)pedir('latido')});
})();
</script></body></html>`;
}

function mensaje(titulo, texto) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(titulo)}</title>
<style>html,body{margin:0;height:100%;background:#000;color:#fff;font:15px/1.45 system-ui,sans-serif}
div{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;gap:10px}
h2{margin:0;font-size:22px}p{margin:0;color:#b4b9c4;max-width:520px}</style></head>
<body><div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></div></body></html>`;
}

/** Pantalla para escribir el código de acceso (con la marca de la ticketera del cliente). */
function ingresoCodigo({ titulo, marca, error, codigo }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(titulo)}</title>
<style>
html,body{margin:0;min-height:100%;background:#0b0c10;color:#fff;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{height:60px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 16px;background:#111318;border-bottom:1px solid #23262e}
header img{max-height:38px;max-width:170px;object-fit:contain}header .nom{font-weight:800}
header a{color:#fff;text-decoration:none;border:1px solid #3a3e48;border-radius:99px;padding:6px 12px;font-size:13px;font-weight:600}
main{max-width:420px;margin:0 auto;padding:56px 16px}
.caja{background:#15171d;border:1px solid #262a33;border-radius:16px;padding:26px 22px;text-align:center}
h1{font-size:22px;margin:0 0 6px}p{color:#aab0bb;margin:0 0 20px}
input{width:100%;box-sizing:border-box;background:#0b0c10;color:#fff;border:1px solid #333845;border-radius:12px;padding:14px;font:700 22px ui-monospace,Menlo,Consolas,monospace;text-align:center;letter-spacing:.12em;text-transform:uppercase}
input:focus{outline:2px solid #fff;border-color:transparent}
button{margin-top:14px;width:100%;background:#fff;color:#000;border:0;border-radius:12px;padding:14px;font:800 16px system-ui,sans-serif;cursor:pointer}
.err{background:rgba(239,83,80,.12);border:1px solid rgba(239,83,80,.4);color:#ff8f8c;border-radius:10px;padding:10px;margin-bottom:14px;font-size:14px}
small{display:block;color:#7d8490;margin-top:16px}
</style></head><body>
<header>${marca && marca.logo ? `<img src="${esc(marca.logo)}" alt="${esc(marca.nombre)}">` : `<span class="nom">${esc(marca ? marca.nombre : '')}</span>`}
${marca && marca.sitio ? `<a href="${esc(marca.sitio)}">Volver</a>` : ''}</header>
<main><div class="caja">
<h1>${esc(titulo)}</h1><p>Ingresá el código de tu entrada para ver la transmisión.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post"><input name="codigo" value="${esc(codigo)}" placeholder="XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14" required autofocus>
<button>Ver transmisión</button></form>
<small>Cada código se puede usar en una sola pantalla a la vez.</small>
</div></main></body></html>`;
}

module.exports = { pagina, reproductor, mensaje, ingresoCodigo };
