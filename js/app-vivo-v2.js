/* ============================================================
   Boye's OPS — En vivo
   ------------------------------------------------------------
   Cómo va el día HOY, mientras pasa. Se refresca solo cada minuto.

   Qué es "en vivo" aquí, con precisión: la API entrega las cuentas
   ya CERRADAS. Una mesa que está comiendo todavía no aparece. Así
   que esto es "lo que ya se cobró hoy", no "lo que hay en piso".
   Se dice en la pantalla, porque la diferencia importa: si a las
   9 de la noche marca $12,000, hay mesas ocupadas que no están
   contadas ahí.
   ============================================================ */

let vivoData = {}, vivoError = null, vivoCargando = false;
let vivoReloj = null, vivoUltima = null;

/* Qué sucursal se está viendo: 0 = las dos, 1 Guaymas, 2 San Carlos.
   Se recuerda entre visitas porque quien administra una sola sucursal no
   tiene por qué volver a elegirla cada vez que entra. */
let vivoLoc = (() => {
  try { return Number(localStorage.getItem('boyes_vivo_loc') || 0) || 0; }
  catch(e){ return 0; }
})();
const vivoLocs = () => vivoLoc ? [vivoLoc] : [1, 2];

async function refreshVivo(silencioso){
  if(vivoCargando) return;
  vivoCargando = true; if(!silencioso) vivoError = null;
  const sucs = [['guaymas',1],['sancarlos',2]];
  try{
    const r = await Promise.all(sucs.map(async ([nom,id])=>{
      const res = await fetch(`/api/soft-ventas?modo=vivo&sucursal=${nom}&token=${encodeURIComponent(user.token)}`);
      const d = await res.json().catch(()=>null);
      if(d?.error) throw new Error(d.error);
      if(!res.ok) throw new Error('el servidor contestó '+res.status);
      return [id, d];
    }));
    vivoData = Object.fromEntries(r);
    vivoError = null;
    vivoUltima = new Date();
  }catch(e){ vivoError = e.message || 'No se pudo conectar con el punto de venta'; }
  finally{ vivoCargando = false; }
  render();
}

/* El reloj se enciende al entrar a la pestaña y se apaga al salir: dejarlo
   corriendo en segundo plano gastaría llamadas al POS por una pantalla que
   nadie está viendo. */
/* En vivo dejó de ser pestaña propia: ahora es el periodo más corto del
   Resumen. El reloj tiene que preguntar por las dos formas de llegar, o se
   apagaría justo cuando la pantalla sí se está viendo. */
const vivoALaVista = () => tab==='vivo'
  || (tab==='resumen' && typeof dashPer!=='undefined' && dashPer==='vivo');
function vivoArranca(){
  if(vivoReloj) return;
  vivoReloj = setInterval(()=>{ if(vivoALaVista() && document.visibilityState==='visible') refreshVivo(true); }, 60000);
}
function vivoDetiene(){ if(vivoReloj){ clearInterval(vivoReloj); vivoReloj = null; } }

function vivoView(){
  vivoArranca();
  if(!Object.keys(vivoData).length && !vivoError){
    if(!vivoCargando) refreshVivo();
    return `<div class="panel"><p class="hint">Consultando el punto de venta…</p></div>`;
  }
  if(vivoError && !Object.keys(vivoData).length){
    return `<div class="panel" style="border-left:4px solid ${D_ROJO}">
      <p style="font-weight:700;margin:0 0 8px">No se pudo conectar — ${esc(vivoError)}</p>
      <button class="btn-primary" id="vivoRetry">Reintentar</button></div>`;
  }

  const G = vivoData[1]||{}, S = vivoData[2]||{};
  /* Los números de arriba suman SOLO lo que se está viendo. Si el título
     dijera el total de las dos mientras abajo se ve una, el encabezado
     estaría mintiendo. */
  const vistos = vivoLocs().map(id => vivoData[id] || {});
  const suma = campo => vistos.reduce((t, d) => t + Number(d[campo] || 0), 0);
  const tot = suma('total'), nv = suma('ventas'), prop = suma('propinas');
  const hora = G.hora_negocio || S.hora_negocio || '';

  let h = `<div class="d-head">
    <div>
      <div class="d-eyebrow">Hoy · ${esc(G.fecha||S.fecha||'')}</div>
      <h2 class="d-titulo">Van ${money(tot)} en ${nv} cuentas</h2>
      <p class="hint" style="margin:2px 0 0">
        Hora del negocio ${esc(hora)} · actualizado ${vivoUltima?vivoUltima.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}
        ${vivoError?` · <b style="color:${D_ROJO}">la última consulta falló</b>`:''}</p>
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div class="switch d-switch" role="group" aria-label="Sucursal">
        <button aria-pressed="${vivoLoc===0}" data-vloc="0">Las dos</button>
        <button aria-pressed="${vivoLoc===1}" data-vloc="1">Guaymas</button>
        <button aria-pressed="${vivoLoc===2}" data-vloc="2">San Carlos</button>
      </div>
      <button class="btn-quiet" id="vivoYa" style="flex:none">↻ Actualizar ahora</button>
    </div>
  </div>`;

  /* La advertencia va arriba y no en letra chica: sin ella, este número se
     lee como "la venta del día" y no lo es. */
  h += `<div class="panel" style="border-left:4px solid #E0A100;background:#FFFCF4">
    <p style="margin:0;font-size:13.5px"><b>Son cuentas ya cobradas.</b> Las mesas que siguen comiendo
    todavía no entran aquí — el punto de venta las suma hasta que se cierran. A media noche esto cuadra
    con el corte; a media tarde siempre va por debajo de lo que hay en piso.</p></div>`;

  h += `<div class="d-tiles">
    ${dTile('Vendido hoy', money(tot), undefined, `${nv} cuentas cerradas`)}
    ${dTile('Ticket promedio', nv?money(tot/nv):'—', undefined, 'por cuenta')}
    ${dTile('Propinas', money(prop), undefined, 'de tarjeta, según el POS')}
    ${dTile('Canceladas', String(suma('canceladas')), undefined, 'cuentas canceladas hoy')}
  </div>`;

  for(const id of vivoLocs()){
    const D = vivoData[id];
    if(!D || D.ventas===undefined) continue;
    const pg = D.pagos||{};
    h += `<div class="panel"><div class="d-h3">${LOCS[id]}</div>
      <div class="d-tiles" style="margin-bottom:12px">
        ${dTile('Vendido', money(D.total), undefined, `${D.ventas} cuentas`)}
        ${dTile('Ticket', money(D.ticket), undefined, 'promedio de hoy')}
        ${dTile('Efectivo', money(pg.efectivo||0), undefined, 'incluye transferencias')}
        ${dTile('Tarjeta', money(pg.tarjeta||0), undefined, '')}
      </div>`;

    if((D.por_hora||[]).length){
      h += `<div class="d-h4">Cómo se movió el día, hora por hora</div>
        ${dBarras(D.por_hora.map(x=>({nombre:`${x.hora}:00`, valor:Number(x.total),
                                      color:'var(--navy)', extra:`${x.ventas} cta`})))}`;
    }

    /* Meseros: solo si la API de verdad los trae. Si no, se dice qué falta en
       lugar de dejar un hueco mudo o —peor— inventar un desglose. */
    if(D.hay_meseros){
      h += `<div class="d-h4" style="margin-top:16px">Por quien atendió</div>
        ${dBarras((D.meseros||[]).map(m=>({nombre:m.nombre, valor:Number(m.total),
                                           color:D_VERDE, extra:`${m.ventas} cta`})))}`;
    } else {
      h += `<div class="d-tile d-pend" style="margin-top:14px">
        <div class="d-lbl">Reporte por mesero</div>
        <div class="d-sub" style="color:var(--warn);font-weight:700">La API no manda quién atendió cada cuenta</div>
        <div class="d-pie">La venta trae estos campos: ${(D.campos_de_la_venta||[]).map(c=>esc(c)).join(', ')||'ninguno (no hubo ventas hoy)'}.
          Si el mesero viene en alguno, lo conecto; si no, hay que pedírselo a Soft.</div></div>`;
    }
    h += `</div>`;
  }
  h += pagosView();
  return h;
}

/* ---------- diagnóstico del ordena-y-paga ---------- */
let pagoData = null, pagoError = null, pagoCargando = false;

async function refreshPagos(){
  if(pagoCargando) return;
  pagoCargando = true; pagoError = null;
  try{
    const r = await Promise.all([['guaymas',1],['sancarlos',2]].map(async ([nom,id])=>{
      const res = await fetch(`/api/soft-ventas?modo=pagos&sucursal=${nom}&token=${encodeURIComponent(user.token)}`);
      const d = await res.json().catch(()=>null);
      if(d?.error) throw new Error(d.error + (d.msg?' — '+d.msg:''));
      if(!res.ok) throw new Error('el servidor contestó '+res.status);
      return [id, d];
    }));
    pagoData = Object.fromEntries(r);
  }catch(e){ pagoError = e.message || 'No se pudo consultar'; }
  finally{ pagoCargando = false; }
  render();
}

function pagosView(){
  let h = `<div class="panel"><div class="d-h3">Ordena y paga en línea · diagnóstico</div>
    <p class="hint" style="margin:0 0 12px">Para que un pedido pagado en la página entre al punto de venta
    <b>ya marcado como pagado</b>, la forma de pago tiene que estar habilitada <i>y asociada</i>.
    El manual de Soft es explícito: si el campo <b>Code</b> viene vacío, esa forma de pago no está ligada
    y hay que pedirle a Soft que la ligue.</p>`;

  if(pagoError) h += `<p style="font-weight:700;color:${D_ROJO}">${esc(pagoError)}</p>`;
  else if(!pagoData) h += `<p class="hint">${pagoCargando?'Consultando…':'—'}</p>`;
  else {
    for(const [id,D] of [[1,pagoData[1]],[2,pagoData[2]]]){
      if(!D) continue;
      const m = D.metodos||[];
      const app = m.find(x=>Number(x.id)===22);
      h += `<div style="margin-top:14px"><div class="d-h4">${LOCS[id]}</div>`;
      if(!m.length){
        h += `<p class="hint">El catálogo no devolvió ninguna forma de pago para esta sucursal.</p>`;
      } else {
        h += `<div class="res-wrap"><table class="res"><thead><tr>
          <th>Forma de pago</th><th>Id</th><th>Code</th><th>Estado</th></tr></thead><tbody>
          ${m.map(x=>`<tr>
            <td style="text-align:left">${esc(x.nombre||'—')}</td>
            <td>${x.id}</td>
            <td>${x.code?esc(x.code):'<span style="color:'+D_ROJO+'">vacío</span>'}</td>
            <td style="font-weight:800;color:${x.asociado?D_VERDE:D_ROJO}">${x.asociado?'✓ asociada':'✕ falta ligar'}</td>
          </tr>`).join('')}
        </tbody></table></div>`;
        h += `<p class="hint" style="margin-top:8px">${
          !D.tiene_pago_app
            ? `<b style="color:${D_ROJO}">No aparece la forma de pago 22 «Pago desde la App».</b> Sin ella no se puede cobrar en línea; hay que pedirle a Soft que la habilite para esta sucursal.`
            : (app && app.asociado
                ? `<b style="color:${D_VERDE}">«Pago desde la App» está habilitada y asociada.</b> Esta sucursal ya puede recibir pedidos pagados en línea.`
                : `<b style="color:${D_ROJO}">«Pago desde la App» está habilitada pero sin Code.</b> Falta que Soft la asocie al catálogo del punto de venta.`)}</p>`;
      }
      h += `</div>`;
    }
  }
  h += `<div class="frm-row" style="margin-top:14px">
    <button class="btn-quiet" id="pagoVer">${pagoData?'↻ Volver a revisar':'Revisar formas de pago'}</button></div></div>`;
  return h;
}

function wireVivo(){
  $('#pagoVer')?.addEventListener('click', ()=>refreshPagos());
  $('#vivoRetry')?.addEventListener('click', ()=>refreshVivo());
  $('#vivoYa')?.addEventListener('click', ()=>refreshVivo());
  /* Cambiar de sucursal NO vuelve a preguntarle al POS: los datos de las dos
     ya están en memoria y se piden juntos cada minuto. Solo se repinta. */
  $('#main').querySelectorAll('[data-vloc]').forEach(b =>
    b.addEventListener('click', () => {
      vivoLoc = Number(b.dataset.vloc);
      try { localStorage.setItem('boyes_vivo_loc', String(vivoLoc)); } catch(e){}
      render();
    }));
}
