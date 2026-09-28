/* ============================================================
   Boye's OPS — Verificación de tarjeta a tres bandas
   ------------------------------------------------------------
   La venta con tarjeta es la única línea del negocio que tiene
   TRES testigos independientes:

     1. Soft Restaurant  — lo que cobró la terminal en el punto de venta
     2. La planilla      — lo que capturó la administradora
     3. El banco         — lo que de verdad entró a la cuenta

   Si los tres coinciden, el mes está probado. Si dos coinciden y
   uno no, el que no coincide es el que tiene el error, y se sabe
   cuál sin discutirlo. Esa es toda la idea de esta pantalla.

   El banco no deposita por día: deposita por corte, y un lunes
   trae el viernes, el sábado y el domingo. Por eso la comparación
   contra el banco va por rango de días, no día por día — y los
   días que cubre cada depósito salen del propio estado de cuenta.
   ============================================================ */

let tjData = null, tjCarga = false, tjError = null, tjClave = null;

/* ------------------------------------------------------------------
   El cuarto testigo: el voucher de totalización de la terminal.

   La «tarjeta» que captura la administración sale del reporte de Soft,
   así que no es un testigo independiente: si la sucursal cobró mal una
   cuenta —la marcó como tarjeta cuando fue efectivo, o al revés—, el
   error viaja del punto de venta a la planilla sin que nadie lo note.

   El voucher de totalización sí es independiente: es lo que la propia
   terminal le manda al banco al cerrar el día, y es lo que después
   aparece en el estado de cuenta. Karen ya lo captura cada semana en el
   corte, día por día, en la columna de tarjeta. Aquí se trae y se pone
   al lado de los otros dos.

   Vive por semana (cash_cuts.week_start + tc_days por día), y esta
   pantalla es por mes: hay que traer también la semana que empieza en
   el mes anterior, porque sus últimos días caen en este.
   ------------------------------------------------------------------ */
let tjVou = null;          // 'AAAA-MM-DD' -> monto del voucher
let tjVouSemanas = 0;

const TJ_DOW = ['lun','mar','mie','jue','vie','sab','dom'];

async function tjJalaVoucher(){
  tjVou = {}; tjVouSemanas = 0;
  try{
    /* Mismo origen que la planilla, para que las dos pantallas no puedan
       enseñar números distintos del mismo dato. */
    const porDia = await vouchersDelMes(finLoc, planMonth);
    const semanas = new Set();
    for(const [d, v] of Object.entries(porDia)){
      const f = `${planMonth}-${String(d).padStart(2,'0')}`;
      tjVou[f] = Number(v);
      const dt = new Date(f + 'T12:00:00Z');
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));   // al lunes
      semanas.add(dt.toISOString().slice(0,10));
    }
    tjVouSemanas = semanas.size;
  }catch(e){ /* sin corte cargado la pantalla sigue sirviendo igual */ }
}

function tjSuc(){ return Number(finLoc) === 2 ? 'sancarlos' : 'guaymas'; }

async function tjJala(){
  if(tjCarga) return;
  const [y, m] = planMonth.split('-').map(Number);
  const desde = `${planMonth}-01`;
  const hasta = `${planMonth}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;
  tjCarga = true; tjError = null; render();
  try{
    const r = await fetch(`/api/soft-ventas?modo=rango&sucursal=${tjSuc()}&desde=${desde}&hasta=${hasta}&corte=${corteHora}&token=${encodeURIComponent(user.token)}`);
    const j = await r.json().catch(()=>null);
    if(j?.error) throw new Error(j.error + (j.msg ? ' — ' + j.msg : ''));
    if(!r.ok) throw new Error('el servidor contestó ' + r.status);
    tjData = j;
    await tjJalaVoucher();
    tjClave = `${finLoc}|${planMonth}`;
  }catch(e){
    tjData = null;
    tjError = e.message || 'No se pudo consultar el punto de venta';
  }
  tjCarga = false;
  render();
}

/* Los días del mes con las tres fuentes puestas lado a lado. */
function tjFilas(){
  const [y, m] = planMonth.split('-').map(Number);
  const nDias = new Date(y, m, 0).getDate();
  const porFecha = {};
  for(const d of (tjData?.dias || [])) porFecha[d.fecha] = d;

  const out = [];
  for(let d = 1; d <= nDias; d++){
    const f = `${planMonth}-${String(d).padStart(2,'0')}`;
    const S = porFecha[f] || null;
    const cap = planEdit.ventas?.[d] || {};
    /* El efectivo del POS se compara con las transferencias sumadas, porque en
       caja se cobran como efectivo y así llegan al corte y a la planilla. */
    const softEf = S ? Number(S.efectivo||0) + Number(S.transferencia||0) : null;
    const softTj = S ? Number(S.tarjeta||0) : null;
    /* El voucher solo cuenta si ese día se capturó. Un día sin corte no es
       una diferencia de cero: es un día que todavía no tiene testigo. */
    const vou = (tjVou && tjVou[f] != null) ? Number(tjVou[f]) : null;
    out.push({
      d, f, dow: planDowShort(planMonth, d),
      softTj, softEf, vou,
      plaTj: planN(cap.tj), plaEf: planN(cap.ef),
      cuentas: S ? Number(S.ventas||0) : null,
      difTj: softTj===null ? null : Math.round((planN(cap.tj) - softTj)*100)/100,
      difEf: softEf===null ? null : Math.round((planN(cap.ef) - softEf)*100)/100,
      /* Lo que de verdad importa: la terminal contra lo que dice el sistema.
         Positivo = la terminal cobró más de lo que el punto de venta registró
         como tarjeta. */
      difVou: (vou===null || softTj===null) ? null : Math.round((vou - softTj)*100)/100
    });
  }
  return out;
}

/* Depósitos del banco, si hay un estado de cuenta cargado en Conciliación,
   contra lo que Soft dice que se cobró con tarjeta en los días que cubren. */
function tjBanco(){
  if(typeof concTarjeta !== 'function' || !concEdo) return null;
  const dep = concTarjeta();
  if(!dep.length) return null;
  const porFecha = {};
  for(const d of (tjData?.dias || [])) porFecha[d.fecha] = d;

  return dep.map(x=>{
    let soft = 0, faltan = 0;
    for(const f of x.cubre){
      const S = porFecha[f];
      if(S) soft += Number(S.tarjeta||0); else faltan++;
    }
    soft = Math.round(soft*100)/100;
    return {...x, soft, softFaltan: faltan,
            difSoft: soft ? Math.round((soft - x.esperado)*100)/100 : null};
  });
}

function tjView(){
  const vigente = tjData && tjClave === `${finLoc}|${planMonth}`;
  const [y, m] = planMonth.split('-').map(Number);
  const nomMes = new Date(y, m-1, 1).toLocaleString('es-MX',{month:'long',year:'numeric'});

  let h = `<style>
    .tj-k{border:1px solid #E1DCD0;border-radius:10px;padding:10px 12px;background:var(--card);border-left-width:5px}
    .tj-k .l{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#6B6455}
    .tj-k .v{font-size:20px;font-weight:900;font-variant-numeric:tabular-nums;margin-top:1px}
    .tj-k .s{font-size:11.5px;font-weight:600;color:#7A7365;margin-top:2px}
    .tj-g{display:grid;gap:9px;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));margin:12px 0}
    .tj-t td,.tj-t th{font-variant-numeric:tabular-nums lining-nums}
    .tj-t .sep{border-left:2px solid #DCD6C8}
    .tj-mal{background:#FFF1EF;font-weight:800;color:#C0261F}
    .tj-bien{color:#0B6E3F;font-weight:700}
    .tj-nada{color:#A8A296}
  </style>`;

  h += `<div class="panel">
    <div class="d-h3">Tarjeta: Soft · la planilla · la terminal · el banco
      <span style="font-weight:700;color:var(--ink-2)">· ${esc(LOCS[finLoc]||'')} · ${esc(nomMes)}</span></div>
    <p class="hint" style="margin:4px 0 12px">La venta con tarjeta es la única línea que tiene varios testigos.
    Ojo con uno: <b>la planilla no es independiente</b> — la administración saca la tarjeta del reporte de Soft,
    así que si la sucursal cobró mal una cuenta, el error viaja de un lado al otro sin que se note.
    <b>El voucher de totalización de la terminal sí es independiente</b>: es lo que la terminal le manda al banco
    al cerrar el día, y es lo que después aparece en el estado de cuenta. Se captura en el corte de cada semana.</p>`;

  if(!vigente){
    h += `<div class="frm-row"><button class="btn-primary" id="tjJalar" ${tjCarga?'disabled':''}>
      ${tjCarga?'Consultando el punto de venta…':`↓ Traer ${nomMes} del punto de venta`}</button></div>`;
    if(tjError) h += `<p style="color:${D_ROJO};font-weight:700;margin:10px 0 0">${esc(tjError)}</p>`;
    h += `<p class="hint" style="margin:10px 0 0">Es una sola consulta por mes, no una por día.
      El día de negocio corta a las <b>${corteHora}:00</b> — abajo se calibra contra el reporte oficial.</p>`;
    return h + `</div>` + repView() + sonView() + dgView();
  }

  /* Lo cargado trae escrito de qué sucursal es. Si no es la que está en
     pantalla, no se compara: cruzar el POS de Guaymas contra la planilla de
     San Carlos no da un error, da una tabla de rojos que parecen hallazgos. */
  if(tjData.sucursal && tjData.sucursal !== tjSuc()){
    return h + `<div class="panel" style="border-left:4px solid ${D_ROJO};background:#FFF6F5">
      <p style="margin:0;font-weight:800">Lo cargado es de otra sucursal.</p>
      <p class="hint" style="margin:6px 0 0">Vino de <b>${esc(tjData.sucursal)}</b> y estás viendo
      <b>${esc(LOCS[finLoc]||'')}</b>. No lo comparo.</p>
      <div class="frm-row" style="margin-top:10px"><button class="btn-primary" id="tjOtra">↻ Consultar ${esc(LOCS[finLoc]||'')}</button></div>
    </div></div>` + dgView();
  }

  const filas = tjFilas();
  const softTj = filas.reduce((s,r)=>s + (r.softTj||0), 0);
  const plaTj  = filas.reduce((s,r)=>s + r.plaTj, 0);
  const softEf = filas.reduce((s,r)=>s + (r.softEf||0), 0);
  const plaEf  = filas.reduce((s,r)=>s + r.plaEf, 0);
  const difTj  = Math.round((plaTj - softTj)*100)/100;
  const cuadraTj = Math.abs(difTj) < 1;

  const conDif = filas.filter(r=>r.difTj !== null && Math.abs(r.difTj) >= 1);
  const sinSoft = filas.filter(r=>r.softTj === null && r.plaTj > 0);
  const sinPla  = filas.filter(r=>r.softTj > 0 && !r.plaTj);

  h += `<div class="tj-g">
    <div class="tj-k" style="border-left-color:#2A78D6"><div class="l">Tarjeta según Soft</div>
      <div class="v">${money(softTj)}</div><div class="s">${tjData.cuentas} cuentas en el mes</div></div>
    <div class="tj-k" style="border-left-color:#E0A100"><div class="l">Tarjeta en la planilla</div>
      <div class="v">${money(plaTj)}</div><div class="s">lo que capturó la administración</div></div>
    <div class="tj-k" style="border-left-color:${cuadraTj?'#0B6E3F':'#C0261F'}"><div class="l">Diferencia</div>
      <div class="v" style="color:${cuadraTj?'#0B6E3F':'#C0261F'}">${cuadraTj?'$0.00':money(difTj)}</div>
      <div class="s">${cuadraTj ? 'cuadra el mes'
        : `${(Math.abs(difTj)/Math.max(softTj,1)*100).toFixed(2)}% · la planilla trae de ${difTj>0?'más':'menos'}`}</div></div>
    ${(()=>{
      /* La terminal solo se compara contra los días que sí tienen voucher.
         Sumar el mes completo contra un puñado de días capturados daría una
         diferencia gigante y falsa. */
      const conV = filas.filter(r => r.vou !== null && r.softTj !== null);
      if(!conV.length) return `<div class="tj-k" style="border-left-color:#A8A296">
        <div class="l">Tarjeta real (terminal)</div><div class="v" style="color:#A8A296">—</div>
        <div class="s">sin cortes capturados de este mes</div></div>`;
      const v = conV.reduce((s,r)=>s+r.vou,0);
      const sf = conV.reduce((s,r)=>s+r.softTj,0);
      const dv = Math.round((v - sf)*100)/100;
      const ok = Math.abs(dv) < 1;
      return `<div class="tj-k" style="border-left-color:#7A3EA1"><div class="l">Tarjeta real (terminal)</div>
        <div class="v">${money(v)}</div>
        <div class="s">${conV.length} de ${filas.length} días capturados</div></div>
      <div class="tj-k" style="border-left-color:${ok?'#0B6E3F':'#C0261F'}">
        <div class="l">Terminal − Soft</div>
        <div class="v" style="color:${ok?'#0B6E3F':'#C0261F'}">${ok?'$0.00':money(dv)}</div>
        <div class="s">${ok ? 'esos días cuadran'
          : `la terminal cobró de ${dv>0?'más':'menos'} · solo los ${conV.length} días con corte`}</div></div>`;
    })()}
  </div>`;

  h += `<div class="panel" style="border-left:4px solid ${D_ROJO};background:#FFF6F5;margin:0 0 12px">
    <p style="margin:0;font-size:13.5px"><b>Antes de leer los rojos, calibra.</b> El reporte oficial de Soft de
    marzo (San Carlos) da <b>$587,147.76</b> con IVA contra <b>$585,007.60</b> de la planilla: cuadran al
    <b>0.37%</b>, y día por día dentro del medio por ciento. La captura está bien y el punto de venta también.
    Lo que fallaba era esta consulta: pedía el día de 00:00 a 23:59 del calendario y el día de negocio termina
    de madrugada, así que partía los fines de semana a la mitad. <b>Suelta el reporte del mes aquí abajo</b> y
    deja que calibre la hora de corte antes de sacar conclusiones de esta tabla.</p></div>

  <div class="res-wrap" style="margin:0 0 12px"><table class="res" style="font-size:12.5px"><thead><tr>
      <th style="text-align:left">Lo que Soft reporta del mes</th><th>Monto</th></tr></thead><tbody>
      <tr><td style="text-align:left">Venta total — ya sin canceladas y neta de descuento</td><td>${money(tjData.total)}</td></tr>
      <tr><td style="text-align:left">Efectivo${tjData.transferencia?' (incluye transferencias '+money(tjData.transferencia)+')':''}</td><td>${money((tjData.efectivo||0) + (tjData.transferencia||0))}</td></tr>
      <tr><td style="text-align:left">Tarjeta</td><td>${money(tjData.tarjeta)}</td></tr>
      <tr><td style="text-align:left">Cortesías</td><td>${money(tjData.cortesia||0)}</td></tr>
      <tr><td style="text-align:left">Otras formas de pago${(()=>{const o=Object.entries(tjData.otros_detalle||{}).sort((a,b)=>b[1]-a[1]);
        return o.length?' — '+o.map(([k,v])=>esc(k)+' '+money(v)).join(' · '):'';})()}</td>
          <td style="${(tjData.otros||0)>1?'color:'+D_ROJO+';font-weight:800':''}">${money(tjData.otros||0)}</td></tr>
      <tr><td style="text-align:left"><b>Canceladas</b> — no entran en nada de lo de arriba</td>
          <td>${tjData.canceladas||0} cuentas · ${money(tjData.monto_cancelado||0)}</td></tr>
      <tr><td style="text-align:left"><b>Descuentos</b> — ya restados del total</td><td>${money(tjData.descuentos||0)}</td></tr>
      <tr><td style="text-align:left">Propinas que registra Soft</td><td>${money(tjData.propinas||0)}</td></tr>
    </tbody></table></div>

  <p class="hint" style="margin:0 0 10px">
    <b>${filas.length - conDif.length - sinSoft.length}</b> días cuadran ·
    <b style="color:${D_ROJO}">${conDif.length}</b> con diferencia ·
    <b>${sinPla.length}</b> con venta en Soft y nada en la planilla ·
    <b>${sinSoft.length}</b> capturados sin venta en Soft
    ${tjData.sin_fecha ? ` · <b style="color:${D_ROJO}">${tjData.sin_fecha} cuentas sin fecha legible</b>` : ''}</p>
  <p class="hint" style="margin:0 0 10px">Voucher de la terminal:
    <b>${filas.filter(r=>r.vou!==null).length}</b> días capturados de ${filas.length}
    ${tjVouSemanas ? `· ${tjVouSemanas} semana${tjVouSemanas===1?'':'s'} de corte` : ''}
    ${filas.filter(r=>r.vou===null).length
      ? ` · los días sin voucher salen en gris: no son diferencia de cero, es que todavía no hay corte capturado.`
      : ''}</p>`;

  h += `<div class="frm-row" style="margin-bottom:10px">
    <button class="btn-quiet" id="tjOtra">↻ Volver a consultar</button>
    ${conDif.length||sinPla.length ? `<button class="btn-quiet" id="tjArregla" disabled
        title="Bajo llave: el banco probó que el POS entrega de menos">Poner el valor de Soft en los ${conDif.length+sinPla.length} días que no cuadran</button>` : ''}
  </div>`;

  h += `<div class="res-wrap" style="max-height:min(62vh,640px)"><table class="res tj-t" style="font-size:12.5px"><thead><tr>
    <th style="text-align:left;min-width:72px">Día</th>
    <th style="min-width:98px">Tarjeta Soft</th><th style="min-width:98px">Tarjeta planilla</th><th style="min-width:92px">Dif.</th>
    <th class="sep" style="min-width:106px">Tarjeta real<br><span style="font-weight:600;font-size:10.5px">voucher terminal</span></th>
    <th style="min-width:92px">Dif. vs Soft</th>
    <th class="sep" style="min-width:98px">Efectivo Soft</th><th style="min-width:98px">Efectivo planilla</th><th style="min-width:92px">Dif.</th>
    <th style="min-width:62px">Ctas</th></tr></thead><tbody>`;

  for(const r of filas){
    const malTj = r.difTj !== null && Math.abs(r.difTj) >= 1;
    const malEf = r.difEf !== null && Math.abs(r.difEf) >= 1;
    const noHubo = r.softTj === null && !r.plaTj && !r.plaEf;
    h += `<tr${noHubo?' style="opacity:.5"':''}>
      <td style="text-align:left;font-weight:700">${r.dow} ${r.d}</td>
      <td>${r.softTj===null?'<span class="tj-nada">—</span>':money(r.softTj)}</td>
      <td>${r.plaTj?money(r.plaTj):'<span class="tj-nada">—</span>'}</td>
      <td class="${malTj?'tj-mal':'tj-bien'}">${r.difTj===null?'':(Math.abs(r.difTj)<1?'✓':money(r.difTj))}</td>
      <td class="sep">${r.vou===null?'<span class="tj-nada">—</span>':money(r.vou)}</td>
      <td class="${(r.difVou!==null && Math.abs(r.difVou)>=1)?'tj-mal':'tj-bien'}">${
        r.difVou===null?'<span class="tj-nada">—</span>':(Math.abs(r.difVou)<1?'✓':money(r.difVou))}</td>
      <td class="sep">${r.softEf===null?'<span class="tj-nada">—</span>':money(r.softEf)}</td>
      <td>${r.plaEf?money(r.plaEf):'<span class="tj-nada">—</span>'}</td>
      <td class="${malEf?'tj-mal':'tj-bien'}">${r.difEf===null?'':(Math.abs(r.difEf)<1?'✓':money(r.difEf))}</td>
      <td>${r.cuentas===null?'':r.cuentas}</td></tr>`;
  }
  h += `</tbody></table></div>`;

  /* ---- la tercera banda ---- */
  const B = tjBanco();
  if(!B){
    h += `<div class="panel" style="margin-top:14px;background:#FBFAF6">
      <p class="hint" style="margin:0"><b>Falta el banco.</b> Carga el estado de cuenta de ${esc(nomMes)} en
      la pestaña <b>Conciliación</b> y esta pantalla agrega la tercera columna: lo que de verdad entró a la
      cuenta, con su comisión.</p></div>`;
  } else {
    const dep = B.reduce((s,x)=>s+x.deposito,0);
    const com = B.reduce((s,x)=>s+x.comision,0);
    const esp = B.reduce((s,x)=>s+x.esperado,0);
    const sof = B.reduce((s,x)=>s+x.soft,0);
    const dif = Math.round((sof - esp)*100)/100;
    h += `<div class="d-h4" style="margin-top:18px">Contra el banco</div>
      <p class="hint" style="margin:0 0 10px">El banco deposita por corte, no por día: un lunes trae viernes,
      sábado y domingo. Por eso aquí se compara por rango. <b>Esperado en caja</b> es el depósito más la comisión
      que el banco descontó de ese mismo depósito.</p>
      <div class="tj-g">
        <div class="tj-k" style="border-left-color:#2A78D6"><div class="l">Soft, en esos días</div>
          <div class="v">${money(sof)}</div></div>
        <div class="tj-k" style="border-left-color:#1BAF7A"><div class="l">Esperado en caja</div>
          <div class="v">${money(esp)}</div><div class="s">depósito ${money(dep)} + comisión ${money(com)}</div></div>
        <div class="tj-k" style="border-left-color:${Math.abs(dif)<1?'#0B6E3F':'#C0261F'}"><div class="l">Diferencia</div>
          <div class="v" style="color:${Math.abs(dif)<1?'#0B6E3F':'#C0261F'}">${Math.abs(dif)<1?'$0.00':money(dif)}</div>
          <div class="s">${com&&esp?`comisión ${(com/esp*100).toFixed(2)}%`:''}</div></div>
      </div>
      <div class="res-wrap"><table class="res tj-t" style="font-size:12.5px"><thead><tr>
        <th>Entró al banco</th><th style="text-align:left">Días que cubre</th>
        <th>Soft</th><th>Planilla</th><th>Esperado en caja</th><th>Comisión</th><th>Dif. vs Soft</th>
      </tr></thead><tbody>
      ${B.map(x=>{
        const pla = x.capturado;
        const d = x.difSoft;
        return `<tr>
          <td>${esc(x.fecha)}</td>
          <td style="text-align:left">${esc(x.etiqueta)}${x.softFaltan?` <span style="color:${D_ROJO}">· ${x.softFaltan} sin dato de Soft</span>`:''}</td>
          <td>${x.soft?money(x.soft):'<span class="tj-nada">—</span>'}</td>
          <td>${pla?money(pla):'<span class="tj-nada">—</span>'}</td>
          <td style="font-weight:800;background:#E6F0FA">${money(x.esperado)}</td>
          <td>${money(x.comision)}</td>
          <td class="${d!==null&&Math.abs(d)>=1?'tj-mal':'tj-bien'}">${d===null?'':(Math.abs(d)<1?'✓':money(d))}</td>
        </tr>`;
      }).join('')}
      </tbody></table></div>`;
  }

  return h + `</div>` + repView() + sonView() + cmpView() + dgView();
}

function wireTarj(){
  wireDiag();
  wireRep();
  document.getElementById('sonVer')?.addEventListener('click', sonJala);
  document.getElementById('cmpVer')?.addEventListener('click', tjCompara);
  document.getElementById('tjJalar')?.addEventListener('click', tjJala);
  document.getElementById('tjOtra')?.addEventListener('click', tjJala);
  document.getElementById('tjArregla')?.addEventListener('click', ()=>{
    /* Solo la tarjeta, y solo donde Soft tiene el dato. El efectivo no se toca
       desde aquí: en caja se le suman transferencias y depósitos que el POS no
       necesariamente vio, y arreglarlo a ciegas taparía justo lo que hay que mirar. */
    let n = 0;
    for(const r of tjFilas()){
      if(r.softTj === null) continue;
      if(r.difTj !== null && Math.abs(r.difTj) < 1) continue;
      planEdit.ventas = planEdit.ventas || {};
      planEdit.ventas[r.d] = planEdit.ventas[r.d] || {};
      planEdit.ventas[r.d].tj = r.softTj || '';
      n++;
    }
    toast(`${n} días con el valor de Soft — dale Guardar`);
    render();
  });
}

/* ============================================================
   Diagnóstico de un día
   ------------------------------------------------------------
   Cuando el POS y lo capturado no cuadran, antes de creerle a
   ninguno de los dos hay que ver la respuesta cruda. Esto no
   interpreta nada: enseña cuántas cuentas trajo la API, a qué
   horas, con qué nombre exacto de forma de pago, y si la suma de
   los pagos da el total de las ventas. Con eso se puede afirmar
   si falta información o si el dato es ese y punto.
   ============================================================ */
let dgFecha = null, dgData = null, dgCarga = false, dgError = null;

/* La prueba de la puerta: pedirle a la API un folio por su nombre. */
let ptFolio = '', ptData = null, ptCarga = false, ptError = null;

/* El rescate: armar el día completo pidiendo uno por uno los folios que
   Sale/Get se salta. */
let rlData = null, rlCarga = false, rlError = null;

async function rlJala(){
  if(!dgFecha || rlCarga) return;
  rlCarga = true; rlError = null; rlData = null; render();
  try{
    const r = await fetch(`/api/soft-ventas?modo=relleno&sucursal=${tjSuc()}`
      + `&fecha=${dgFecha}&corte=${corteHora}&token=${encodeURIComponent(user.token)}`);
    const j = await r.json().catch(()=>null);
    if(j?.error) throw new Error(j.error);
    if(!r.ok) throw new Error('el servidor contestó '+r.status);
    rlData = j;
  }catch(e){ rlError = e.message || 'no se pudo rescatar'; }
  rlCarga = false; render();
}

function rlView(){
  const R = rlData, res = R.rescatadas || {}, lista = res.lista || [];
  /* Lo que capturó Karen ese día, que es contra lo que hay que cerrar. */
  const cap = (dgFecha && dgFecha.slice(0,7) === planMonth)
    ? (()=>{ const v = planEdit.ventas?.[Number(dgFecha.slice(8,10))] || {};
             return planN(v.ef) + planN(v.tj); })() : null;
  const dif = cap ? R.completo.total - cap : null;
  const cierra = dif !== null && Math.abs(dif) < 1;

  let h = `<div class="panel" style="margin-top:14px"><div class="d-h3">El día completo, rescatado</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
      gap:10px;margin-top:10px">
      ${[['CON SALE/GET', money(R.con_get.total),
          `${R.con_get.cuentas} cuentas · folios ${R.con_get.del_folio}–${R.con_get.al_folio}`, ''],
         ['RESCATADO POR FOLIO', '+'+money(res.total||0),
          `${res.cuentas||0} cuentas que Get no listó`, 'color:#1B7F4C'],
         ['EL DÍA COMPLETO', money(R.completo.total),
          `${R.completo.cuentas} cuentas`, ''],
         ...(cap!==null?[['LA PLANILLA ESE DÍA', money(cap), 'lo que capturó Karen','']]:[])
      ].map(([k,v,s,st])=>`<div style="background:#fff;border:1px solid #E1DCD0;border-radius:10px;
        padding:10px 12px;min-width:0">
        <div style="font-size:10px;letter-spacing:.06em;color:#8A8377;font-weight:800">${k}</div>
        <div style="font-size:19px;font-weight:800;margin-top:3px;${st}">${v}</div>
        <div style="font-size:11px;color:#6B6459;margin-top:2px;line-height:1.35">${s}</div>
      </div>`).join('')}
    </div>`;

  if(cap !== null){
    h += `<div style="margin-top:12px;padding:12px 14px;border-radius:10px;
      background:${cierra?'#E8F5E9':'#FFF6E5'};border:1px solid ${cierra?'#A5D6A7':'#F0D9A8'}">
      <b style="font-size:14px">${cierra
        ? 'Cierra con la planilla, al peso'
        : `Todavía ${dif>0?'sobra':'falta'} ${money(Math.abs(dif))}`}</b>
      <p style="margin:6px 0 0;font-size:13px;line-height:1.5">${cierra
        ? 'El rescate por folio reconstruye el día exacto que capturó Karen. '
          + '<b>El método funciona</b> — se puede aplicar a todo el mes.'
        : 'El rescate acercó el día pero no lo cerró. Puede ser IVA, o pueden faltar '
          + 'folios más allá de donde se alcanzó a buscar.'}</p></div>`;
  }

  if(lista.length){
    /* Si Find sí trae el nodo del restaurante, aquí se contesta de una vez
       cuál es el módulo de las ventas que faltaban. */
    h += `<div class="d-h4" style="margin-top:16px">Las cuentas rescatadas</div>
      ${R.trae_restaurante?`<p class="hint" style="margin:0 0 8px"><b>Sale/Find sí trae el nodo
      SaleRestaurant</b> — el que Get manda siempre en null. Ahí está el módulo de venta.</p>`:''}
      <div class="res-wrap"><table class="res tj-t" style="font-size:12.5px">
        <thead><tr><th>Folio</th><th>Hora</th><th>Total</th><th>Estado</th><th>Pagos</th></tr></thead>
        <tbody>${lista.map(x=>`<tr style="background:#F2FBF5">
          <td style="font-weight:800">${x.folio}</td>
          <td>${esc(String(x.fecha||'').slice(11,16))}</td>
          <td style="font-weight:700">${money(x.total)}</td>
          <td style="font-size:11.5px">${esc(x.status||'—')}</td>
          <td style="font-size:11.5px">${esc((x.pagos||[]).map(p=>`${p.nombre} ${money(p.monto)}`).join(' · ')||'—')}</td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  /* Los que NO se rescataron, uno por uno y con su razón. Enseñar solo el
     conteo escondía justo el dato que hace falta para saber si la razón es
     buena: un folio marcado «de otro día» puede ser un error mío de corte, y
     sin ver su fecha no hay manera de notarlo. */
  const rev = R.revisados || [];
  if(rev.length){
    h += `<div class="d-h4" style="margin-top:16px">Los que se preguntaron y no entraron · ${rev.length}</div>
      <p class="hint" style="margin:0 0 8px">Con su razón y su fecha. <b>Si alguno dice «es de otro día»
      pero la fecha es de este día, el error es mío</b> — de cómo asigno el día de negocio.</p>
      <div class="res-wrap"><table class="res tj-t" style="font-size:12.5px">
        <thead><tr><th>Folio</th><th>Qué pasó</th><th>Fecha que trae</th><th>Día que le asigné</th><th>Total</th></tr></thead>
        <tbody>${rev.map(x=>{
          const mal = x.estado==='es de otro día' && String(x.fecha||'').slice(0,10)===R.fecha;
          return `<tr${mal?' style="background:#FDECEA"':''}>
            <td style="font-weight:800">${x.folio}</td>
            <td style="font-size:11.5px">${esc(x.estado)}${x.devolvio_folio
              ? ` · contestó con el ${x.devolvio_folio}` : ''}${x.como
              ? ` · ${esc(x.como)}` : ''}</td>
            <td style="font-size:11.5px">${esc(String(x.fecha||'—').replace('T',' ').slice(0,16))}</td>
            <td style="font-size:11.5px">${esc(x.dia||'—')}</td>
            <td>${x.total!=null?money(x.total):'—'}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  }
  return h + `</div>`;
}

async function ptJala(){
  const n = Number(String(ptFolio).replace(/\D/g,''));
  if(!n){ ptError = 'escribe el número de folio'; render(); return; }
  /* Cada sucursal lleva su propia serie de folios. Preguntarle a Guaymas por
     un folio de San Carlos contesta «no llegó» —y sería verdad, y no
     significaría nada. Un falso negativo aquí nos manda a los dos por el
     camino equivocado, así que se detiene antes de salir. */
  const serie = (dgData?.lista_de_cuentas || []).map(c=>Number(c.folio))
                  .filter(f=>Number.isFinite(f) && f>0);
  if(serie.length){
    const lo = Math.min(...serie), hi = Math.max(...serie);
    if(n < lo - 500 || n > hi + 500){
      ptError = `El folio ${n} no es de esta serie: ese día ${dgData.sucursal==='sancarlos'
        ? 'San Carlos' : 'Guaymas'} va del ${lo} al ${hi}. `
        + 'Cada sucursal lleva su propia numeración — cambia de sucursal arriba, '
        + 'o usa uno de los folios que faltan aquí.';
      ptData = null; render(); return;
    }
  }
  if(ptCarga) return;
  ptCarga = true; ptError = null; ptData = null; render();
  try{
    const r = await fetch(`/api/soft-ventas?modo=puertas&sucursal=${tjSuc()}&folio=${n}`
      + `&fecha=${encodeURIComponent(dgFecha||'')}&token=${encodeURIComponent(user.token)}`);
    const j = await r.json().catch(()=>null);
    if(j?.error) throw new Error(j.error);
    if(!r.ok) throw new Error('el servidor contestó '+r.status);
    ptData = j;
  }catch(e){ ptError = e.message || 'no se pudo consultar'; }
  ptCarga = false; render();
}

function ptView(){
  const P = ptData, pf = P.por_folio || [];
  const gano = pf.find(x => x.trajo_el_folio);
  const abiertas = (P.puertas || []).filter(p => p.existe);
  const hayEstado = (P.por_estado || []).some(x => (x.folios_nuevos || 0) > 0);

  /* El veredicto primero. Lo demás es para comprobarlo, no para leerlo. */
  let h = `<div style="margin-top:12px;padding:12px 14px;border-radius:10px;
    background:${(gano||hayEstado) ? '#E8F5E9' : '#FDECEA'};
    border:1px solid ${(gano||hayEstado) ? '#A5D6A7' : '#F5C6C0'}">
    <b style="font-size:14px">${gano
      ? `Sí llegó — por «${esc(gano.prueba)}»`
      : hayEstado ? 'El filtro de Status sí trae lo que falta'
      : 'No llegó por ninguna vía'}</b>
    <p style="margin:6px 0 0;font-size:13px;line-height:1.5">${(gano||hayEstado)
      ? 'La venta existe y la API sí la entrega. <b>El problema es cómo la estoy pidiendo, '
        + 'no que el dato no exista</b> — y eso lo puedo arreglar.'
      : 'Se le pidió el folio de cuatro maneras distintas, y el filtro de Status del 0 al 12. '
        + '<b>Esa venta no sale del servicio</b>, ni listándola, ni por su folio, ni por su estado.'}</p></div>`;

  /* Status con números. Si alguno trae folios que hoy no llegan, se acabó la
     investigación: el filtro existía y yo le mandaba el tipo equivocado. */
  const pe = P.por_estado || [];
  const conNuevos = pe.filter(x => (x.folios_nuevos || 0) > 0);
  if(pe.length){
    h += `<div class="d-h4" style="margin-top:16px">Status, pero con números</div>`;
    if(conNuevos.length){
      h += `<div style="padding:12px 14px;border-radius:10px;background:#E8F5E9;border:1px solid #A5D6A7">
        <b style="font-size:14px">Aquí están — Status = ${conNuevos.map(x=>x.status).join(', ')}</b>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.5">Ese filtro trae
        <b>${conNuevos.reduce((s,x)=>s+x.folios_nuevos,0)} folios que hoy no llegan</b>.
        El parámetro sí servía: pedía un número y yo le mandaba la palabra. Lo corrijo y jalamos todo.</p></div>`;
    }else{
      h += `<p class="hint" style="margin:0 0 8px">Del 0 al 12. Ninguno trajo folios que hoy no lleguen —
        el filtro no es la salida.</p>`;
    }
    h += `<div class="res-wrap" style="margin-top:10px"><table class="res tj-t" style="font-size:12px">
      <thead><tr><th>Status</th><th>HTTP</th><th>Trajo</th><th>Folios nuevos</th><th>Cuáles</th><th>Venta</th></tr></thead>
      <tbody>${pe.map(x=>`<tr${x.folios_nuevos>0?' style="background:#DFF3E7"':''}>
        <td style="font-weight:800">${esc(String(x.status))}</td>
        <td class="${x.http>=400?'tj-mal':''}">${x.http ?? '—'}</td>
        <td>${x.registros ?? 0}</td>
        <td style="font-weight:800">${x.folios_nuevos ?? 0}</td>
        <td style="font-size:11px">${esc((x.cuales||[]).join(' · '))}</td>
        <td>${money(x.total||0)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  h += `<div class="res-wrap" style="margin-top:10px"><table class="res tj-t" style="font-size:12.5px">
    <thead><tr><th>Cómo se pidió</th><th>HTTP</th><th>Trajo</th><th>¿Ese folio?</th><th>Recado</th></tr></thead>
    <tbody>${pf.map(x=>`<tr>
      <td>${esc(x.prueba||'')}</td>
      <td>${x.http ?? '—'}</td>
      <td>${x.registros ?? 0}</td>
      <td class="${x.trajo_el_folio?'':'tj-mal'}" style="font-weight:800">${x.trajo_el_folio
        ? 'sí' + (x.total!=null ? ' · '+money(x.total) : '') : 'no'}</td>
      <td style="font-size:11px;color:#6B6459">${esc(String(x.recado||'').slice(0,90))}</td>
    </tr>`).join('')}</tbody></table></div>`;

  if(abiertas.length){
    h += `<div class="d-h4" style="margin-top:14px">Otros métodos que sí existen · ${abiertas.length}</div>
      <p class="hint" style="margin:0 0 8px">Se preguntó por dieciséis nombres de método que serían de otro
      carril de venta. Los que contestan algo distinto de 404 existen — ahí puede estar lo que falta.</p>
      <div class="res-wrap"><table class="res tj-t" style="font-size:12px">
        <thead><tr><th>Método</th><th>HTTP</th><th>Trajo</th><th>Recado</th></tr></thead>
        <tbody>${abiertas.map(p=>`<tr>
          <td><code style="font-size:11px">${esc(p.ruta)}</code></td>
          <td>${p.http}</td><td>${p.registros ?? 0}</td>
          <td style="font-size:11px;color:#6B6459">${esc(String(p.recado||'').slice(0,80))}</td>
        </tr>`).join('')}</tbody></table></div>`;
  }
  return h;
}

/* El campo de fecha lo pinta el navegador en el formato de SU idioma: en
   inglés sale mm/dd y "02/03/2026" termina siendo 3 de febrero cuando lo que
   se quería era 2 de marzo. Por eso al lado va la fecha escrita con todas sus
   letras, y por eso hay botones con los días que de verdad interesan: escribir
   la fecha a mano es el paso donde se pierde media hora. */
function dgLetra(f){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(f||'')) return '';
  return new Date(f+'T12:00:00').toLocaleDateString('es-MX',
    {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}

/* Los días del mes abierto con más venta capturada: son los que más pesan si
   algo no cuadra, y de un clic. */
function dgSugeridos(){
  const v = planEdit.ventas || {};
  const dias = Object.keys(v)
    .map(d=>({d:Number(d), t: planN(v[d].ef)+planN(v[d].tj)}))
    .filter(x=>x.d>=1 && x.d<=31 && x.t>0)
    .sort((a,b)=>b.t-a.t).slice(0,6)
    .sort((a,b)=>a.d-b.d);
  if(!dias.length) return '';
  return `<div class="frm-row" style="margin-top:8px;align-items:center;gap:6px;flex-wrap:wrap">
    <span class="hint" style="margin:0">Los días más fuertes de este mes:</span>
    ${dias.map(x=>{
      const f = `${planMonth}-${String(x.d).padStart(2,'0')}`;
      return `<button class="btn-quiet" data-dgdia="${f}"
        style="padding:5px 10px;font-size:12px${f===dgFecha?';background:var(--navy);color:#fff':''}">
        ${x.d} · ${money0(x.t)}</button>`;
    }).join('')}</div>`;
}

async function dgJala(){
  if(!dgFecha || dgCarga) return;
  /* Cambiar de día invalida la prueba del folio y el rescate: eran de otro día. */
  ptData = null; ptError = null; ptFolio = '';
  rlData = null; rlError = null;
  dgCarga = true; dgError = null; render();
  try{
    const r = await fetch(`/api/soft-ventas?modo=diag&sucursal=${tjSuc()}&fecha=${dgFecha}&token=${encodeURIComponent(user.token)}`);
    const j = await r.json().catch(()=>null);
    if(j?.error) throw new Error(j.error + (j.msg?' — '+j.msg:''));
    if(!r.ok) throw new Error('el servidor contestó '+r.status);
    dgData = j;
  }catch(e){ dgData = null; dgError = e.message || 'no se pudo consultar'; }
  dgCarga = false; render();
}

function dgView(){
  const cap = (()=>{                       // lo que dice la planilla de ese día
    if(!dgFecha || dgFecha.slice(0,7) !== planMonth) return null;
    const v = planEdit.ventas?.[Number(dgFecha.slice(8,10))] || {};
    return { ef: planN(v.ef), tj: planN(v.tj) };
  })();

  const dgAjeno = dgData && dgData.sucursal && dgData.sucursal !== tjSuc();
  let h = `<div class="panel"><div class="d-h3">Diagnóstico de un día
    <span style="font-weight:700;color:var(--ink-2)">· ${esc(LOCS[finLoc]||'')}</span></div>
    <p class="hint" style="margin:4px 0 10px">Esto enseña la respuesta cruda del punto de venta, sin
    interpretarla. Sirve para saber si la API está entregando el día completo o solo una parte.</p>
    <div class="frm-row" style="align-items:center;gap:8px;flex-wrap:wrap">
      <input type="date" id="dgFecha" value="${dgFecha||''}"
        style="padding:7px 9px;border:1px solid #D8D2C4;border-radius:8px;font-family:inherit">
      <button class="btn-primary" id="dgVer" ${dgCarga?'disabled':''}>${dgCarga?'Consultando…':'Revisar ese día'}</button>
      ${dgFecha?`<b style="font-size:13px;text-transform:capitalize">${esc(dgLetra(dgFecha))}</b>`:''}
    </div>
    ${dgSugeridos()}`;

  if(dgError) h += `<p style="color:${D_ROJO};font-weight:700;margin-top:10px">${esc(dgError)}</p>`;
  if(dgAjeno){
    return h + `<div class="panel" style="border-left:4px solid ${D_ROJO};background:#FFF6F5;margin-top:12px">
      <p style="margin:0;font-weight:800">Este resultado es de otra sucursal.</p>
      <p class="hint" style="margin:6px 0 0">Se consultó <b>${esc(dgData.sucursal)}</b> y ahora estás viendo
      <b>${esc(LOCS[finLoc]||'')}</b>. Vuelve a darle a «Revisar ese día».</p></div></div>`;
  }
  if(!dgData) return h + `</div>`;

  const D = dgData;
  const alerta = [];
  if(!D.cuadra_pagos_con_total)
    alerta.push(`La suma de los pagos (${money(D.suma_de_pagos)}) <b>no da</b> el total de las ventas (${money(D.total)}). Faltan renglones de pago.`);
  if(D.cuentas_sin_pago)
    alerta.push(`<b>${D.cuentas_sin_pago}</b> cuentas vinieron sin ningún renglón de pago.`);
  if(cap && Math.abs((cap.ef+cap.tj) - D.total) > 1)
    alerta.push(`La planilla trae ${money(cap.ef+cap.tj)} ese día y el POS ${money(D.total)} — <b>${money((cap.ef+cap.tj)-D.total)}</b> de diferencia.`);

  h += `<p style="margin:12px 0 0;font-weight:800;font-size:14px">
    <span style="text-transform:capitalize">${esc(dgLetra(D.fecha))}</span>
    <span style="color:var(--ink-2)"> · ${esc(LOCS[finLoc]||'')}</span></p>
  <div class="tj-g" style="margin-top:6px">
    <div class="tj-k" style="border-left-color:#2A78D6"><div class="l">Cuentas que trajo</div>
      <div class="v">${D.cuentas}</div><div class="s">${D.canceladas} canceladas</div></div>
    <div class="tj-k" style="border-left-color:#1BAF7A"><div class="l">Total del POS</div>
      <div class="v">${money(D.total)}</div><div class="s">propinas ${money(D.propinas)}</div></div>
    ${cap?`<div class="tj-k" style="border-left-color:#E0A100"><div class="l">La planilla ese día</div>
      <div class="v">${money(cap.ef+cap.tj)}</div><div class="s">efectivo ${money(cap.ef)} · tarjeta ${money(cap.tj)}</div></div>`:''}
    <div class="tj-k" style="border-left-color:#8D6E63"><div class="l">Horario de las cuentas</div>
      <div class="v" style="font-size:14px">${esc((D.primera_venta||'—').slice(11,16))} a ${esc((D.ultima_venta||'—').slice(11,16))}</div>
      <div class="s">primera y última que entregó</div></div>
  </div>`;

  if(alerta.length) h += `<div class="panel" style="border-left:4px solid ${D_ROJO};background:#FFF6F5;margin:10px 0">
    ${alerta.map(a=>`<p style="margin:0 0 6px;font-size:13.5px">${a}</p>`).join('')}</div>`;

  /* La tabla que contesta la pregunta del IVA: cada campo del total del día,
     y el mismo con IVA encima. El que se parezca a lo capturado es el que
     Karen está usando. */
  const T = D.totales_del_dia || {};
  if(Object.keys(T).length){
    const objetivo = cap ? cap.ef + cap.tj : null;
    const cerca = v => objetivo && Math.abs(v - objetivo) / Math.max(objetivo,1) < 0.02;
    h += `<div class="d-h4" style="margin-top:16px">¿Con IVA o sin IVA?</div>
      <p class="hint" style="margin:0 0 8px">Cada campo del total que manda Soft, sumado en el día, y el mismo
      con 16% encima. ${objetivo?`La planilla trae <b>${money(objetivo)}</b> ese día — el número que se le
      parezca es el que está capturando Karen.`:'Abre el mes de esa fecha en la Planilla para comparar.'}</p>
      <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
        <th style="text-align:left">Campo de Soft</th><th>Como viene</th><th>Con IVA 16%</th></tr></thead><tbody>
      ${Object.entries(T).map(([k,v])=>`<tr>
        <td style="text-align:left">${esc(k)}</td>
        <td class="${cerca(v.suma)?'tj-bien':''}" style="${cerca(v.suma)?'background:#DFF3E7':''}">${money(v.suma)}</td>
        <td class="${cerca(v.con_iva_16)?'tj-bien':''}" style="${cerca(v.con_iva_16)?'background:#DFF3E7':''}">${money(v.con_iva_16)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  /* Los folios primero: es la prueba más fuerte que existe. Si la serie tiene
     huecos, las cuentas que faltan EXISTEN y este servicio no las entregó.
     No hay nada que interpretar. */
  const F = D.folios;
  if(F && F.hay_folio){
    const faltan = F.faltan_en_la_serie;
    h += `<div class="panel" style="margin:14px 0;border-left:4px solid ${faltan?D_ROJO:D_VERDE};
            background:${faltan?'#FFF6F5':'#F4FBF7'}">
      <div class="d-h4" style="margin:0 0 6px">${faltan
        ? `Faltan ${faltan} folios en la serie de ese día`
        : 'La serie de folios viene completa, sin huecos'}</div>
      <p class="hint" style="margin:0 0 10px">Los folios de un restaurante van consecutivos. Del
      <b>${F.primero}</b> al <b>${F.ultimo}</b> debería haber <b>${F.esperadas_por_la_serie}</b> cuentas.
      La API entregó <b>${F.entregados}</b>. ${faltan
        ? 'Cada hueco es una cuenta que existe y que este servicio no está devolviendo — eso no se puede discutir.'
        : 'Entonces las cuentas que faltan en el mes no se están cayendo dentro de este día.'}</p>
      ${(F.huecos||[]).length?`<div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
        <th>Después del folio</th><th>Antes del folio</th><th>Cuántas faltan</th></tr></thead><tbody>
        ${F.huecos.map(x=>`<tr><td>${x.despues_de}</td><td>${x.antes_de}</td>
          <td style="font-weight:800;color:${D_ROJO}">${x.faltan}</td></tr>`).join('')}
      </tbody></table></div>`:''}
    </div>`;
  } else if(F){
    h += `<p class="hint" style="margin:12px 0">Las ventas de este día no traen folio en la respuesta.</p>`;
  }
  /* La lista de folios que SÍ entregó, para poner al lado de la pantalla de
     Soft. Los que estén en Soft y no aquí son los que el servicio no expone —y
     abriéndolos en el punto de venta se ve qué tienen en común. Es la única
     forma de identificarlos, porque por definición no vienen en la respuesta. */
  const lista = D.lista_de_cuentas || [];
  if(lista.length){
    h += `<div class="d-h4" style="margin-top:16px">Los folios que sí entregó · ${lista.length} cuentas</div>
      <p class="hint" style="margin:0 0 8px">Abre en Soft las ventas de este día y compara. <b>Los folios que
      estén en Soft y no en esta lista son los que la API no expone.</b> Ábrelos en el punto de venta y mira
      qué tienen en común — si son de para llevar, de teléfono, o de otra cosa.</p>
      <div class="res-wrap" style="max-height:min(50vh,440px)"><table class="res tj-t" style="font-size:12.5px">
        <thead><tr><th>Folio</th><th>Hora</th><th>Total</th><th>Estado</th><th>Pagos</th></tr></thead><tbody>
        ${lista.map(c=>`<tr>
          <td style="font-weight:800">${c.folio ?? '—'}</td>
          <td>${esc(String(c.fecha||'').slice(11,16))}</td>
          <td>${money(c.total)}</td>
          <td style="font-size:11.5px">${esc(c.status||'—')}${c.cancelada?' · cancelada':''}</td>
          <td class="${c.pagos?'':'tj-mal'}">${c.pagos}</td></tr>`).join('')}
      </tbody></table></div>`;

    /* Si un folio de Soft no está en la lista de arriba, se le puede pedir
       directo. Es la prueba que separa las dos explicaciones posibles: si
       llega pidiéndolo por folio, la venta sí es alcanzable y el problema es
       que estoy tocando la puerta equivocada — eso se arregla hoy. Si ni así
       llega, el dato no sale del servicio y no hay nada que yo pueda hacer. */
    h += `<div class="d-h4" style="margin-top:16px">¿Y si le pido un folio que falta?</div>
      <p class="hint" style="margin:0 0 8px">Escribe aquí un folio que <b>esté en Soft y no esté en la lista
      de arriba</b>. Le pregunto a la API por ese folio, de frente.</p>
      ${(()=>{
        /* Los huecos ya dicen QUÉ folios faltan. Escribirlos a mano es
           trabajo que la pantalla puede hacer sola — y equivocarse de dígito
           arruinaría la prueba sin que se note. */
        const faltan = [];
        for(const x of (D.folios?.huecos || []))
          for(let n = Number(x.despues_de)+1; n < Number(x.antes_de) && faltan.length < 24; n++)
            faltan.push(n);
        if(!faltan.length) return '';
        return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">
          <span class="hint" style="margin:0;align-self:center">Los que faltan en la serie:</span>
          ${faltan.map(n=>`<button class="btn-quiet" data-ptf="${n}"
            style="padding:5px 10px;font-size:12px;font-weight:800">${n}</button>`).join('')}</div>`;
      })()}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="ptFolio" type="text" inputmode="numeric" placeholder="32640"
          value="${esc(String(ptFolio||''))}" style="width:120px;padding:7px 10px;border:1px solid #E1DCD0;
          border-radius:8px;font-size:14px;font-weight:700">
        <button class="btn-quiet" id="ptVer" ${ptCarga?'disabled':''}
          style="padding:7px 14px">${ptCarga?'preguntando…':'preguntar'}</button>
      </div>`;
    if(ptError) h += `<p class="tj-mal" style="margin:8px 0 0;font-size:13px">${esc(ptError)}</p>`;
    if(ptData)  h += ptView();

    /* El rescate completo del día. Va aquí abajo porque solo tiene sentido
       después de haber comprobado que pedir por folio sí funciona. */
    h += `<div class="d-h4" style="margin-top:18px">Armar el día completo</div>
      <p class="hint" style="margin:0 0 8px">Pide uno por uno todos los folios que faltan en la serie
      —los de en medio y los que van después del último— y arma el día como debería venir.
      Cada cuenta se verifica contra su propia fecha antes de contarla.</p>
      <button class="btn" id="rlVer" ${rlCarga?'disabled':''}>${rlCarga
        ? 'rescatando folio por folio…' : 'RESCATAR EL DÍA COMPLETO'}</button>`;
    if(rlError) h += `<p class="tj-mal" style="margin:8px 0 0;font-size:13px">${esc(rlError)}</p>`;
    if(rlData)  h += rlView();
  }

  if((D.campos_de_la_venta||[]).length){
    h += `<div class="d-h4" style="margin-top:14px">Todo lo que trae una venta</div>
      <p class="hint" style="margin:0 0 8px">La lista completa de campos con su tipo. Si Soft distingue el
      módulo de venta, el campo tiene que estar aquí.</p>
      <div style="background:#F6F4EE;border-radius:8px;padding:10px;font-size:11.5px;line-height:1.8">
        ${(D.campos_de_la_venta||[]).map(c=>`<code style="background:#fff;border:1px solid #E1DCD0;
          border-radius:5px;padding:2px 6px;margin:0 4px 4px 0;display:inline-block">${esc(c)}</code>`).join('')}
      </div>`;
  }

  /* La huella: qué valores distintos trae cada campo. Si el servicio entrega
     solo ciertos estados, aquí se ve cuáles —y por descarte, cuál esconde. */
  const HU = D.huella_de_los_campos || {};
  const interesantes = Object.entries(HU).filter(([k,v])=>Object.keys(v).length<=8 && Object.keys(v).length>0);
  if(interesantes.length){
    h += `<div class="d-h4" style="margin-top:14px">Qué valores trae cada campo</div>
      <p class="hint" style="margin:0 0 8px">Todos los campos con pocos valores distintos, incluidos los
      numéricos. Aquí es donde estaría el módulo de venta —comedor, para llevar, servicio—. Si todas las
      cuentas que sí llegan traen el mismo valor en algún campo, ese campo es el filtro, y las que faltan
      traen otro.</p>
      <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
        <th style="text-align:left">Campo</th><th style="text-align:left">Valores que trae</th></tr></thead><tbody>
      ${interesantes.map(([k,v])=>`<tr><td style="text-align:left"><b>${esc(k)}</b></td>
        <td style="text-align:left">${Object.entries(v).map(([val,n])=>`${esc(val)} <span class="hint">(${n})</span>`).join(' · ')}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* El veredicto de la prueba de ventana: si la ventana estaba
     cortando el día, todo lo demás que se lea abajo está mal medido. */
  const V = D.prueba_de_ventana;
  if(V){
    const corta = V.la_ventana_estaba_cortando;
    const perdido = Math.round((V.total_pidiendo_tres_dias - V.total_pidiendo_solo_ese_dia)*100)/100;
    h += `<div class="panel" style="margin:14px 0;border-left:4px solid ${corta?D_ROJO:D_VERDE};
            background:${corta?'#FFF6F5':'#F4FBF7'}">
      <div class="d-h4" style="margin:0 0 6px">${corta
        ? 'La ventana de fechas SÍ estaba cortando el día'
        : 'La ventana de fechas está bien'}</div>
      <p class="hint" style="margin:0 0 10px">Le pedí a Soft el día de dos maneras: pidiendo <b>solo ese día</b>
      (como lo hace la app) y pidiendo <b>tres días</b> y separando después. Si las dos dan lo mismo, la fecha
      no es el problema.</p>
      <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
        <th style="text-align:left">Cómo se lo pedí</th><th>Cuentas</th><th>Total</th></tr></thead><tbody>
        <tr><td style="text-align:left">Pidiendo solo ese día</td>
            <td>${V.cuentas_pidiendo_solo_ese_dia}</td><td>${money(V.total_pidiendo_solo_ese_dia)}</td></tr>
        <tr><td style="text-align:left">Pidiendo tres días y filtrando</td>
            <td style="font-weight:800">${V.cuentas_pidiendo_tres_dias}</td>
            <td style="font-weight:800">${money(V.total_pidiendo_tres_dias)}</td></tr>
        <tr style="font-weight:900;background:${corta?'#FFE4E1':'#DFF3E7'}">
            <td style="text-align:left">Diferencia</td>
            <td>${V.cuentas_pidiendo_tres_dias - V.cuentas_pidiendo_solo_ese_dia}</td>
            <td>${money(perdido)}</td></tr>
      </tbody></table></div>
      ${corta?`<p style="margin:10px 0 0;font-size:13.5px"><b>Eso es lo que estaba faltando.</b>
        Con la ventana ancha el día trae efectivo ${money(V.efectivo_ancha)} y tarjeta ${money(V.tarjeta_ancha)}.
        Si esos números sí se parecen a los de la planilla, el arreglo es cambiar cómo pido las fechas —
        no hay nada mal con tu captura ni con el punto de venta.</p>`:''}
      ${(V.por_hora_ancha||[]).length?`<div class="d-h4" style="margin-top:14px">A qué hora se vendió ese día
        <span class="hint" style="font-weight:400">(según la ventana ancha)</span></div>
        ${dBarras(V.por_hora_ancha.map(x=>({nombre:`${x.hora}:00`, valor:Number(x.total),
                                            color:'var(--navy)', extra:`${x.cuentas} cta`})))}`:''}
      ${(V.vecinos||[]).length?`<div class="d-h4" style="margin-top:14px">Los tres días, como los ve Soft</div>
        <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
          <th>Fecha</th><th>Cuentas</th><th>Efectivo</th><th>Tarjeta</th><th>Total</th></tr></thead><tbody>
          ${V.vecinos.map(x=>`<tr${x.fecha===D.fecha?' style="background:#FFF8E0;font-weight:800"':''}>
            <td>${esc(x.fecha)}</td><td>${x.cuentas}</td><td>${money(x.efectivo)}</td>
            <td>${money(x.tarjeta)}</td><td>${money(x.total)}</td></tr>`).join('')}
        </tbody></table></div>`:''}
    </div>`;
  }

  h += `<div class="d-h4" style="margin-top:14px">Formas de pago, con su nombre exacto</div>
    <p class="hint" style="margin:0 0 8px">Si alguna cae en «otros», es que no reconozco ese texto y ese dinero
    no está llegando ni a efectivo ni a tarjeta.</p>
    <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
      <th style="text-align:left">Como lo llama Soft</th><th>Veces</th><th>Monto</th><th>Dónde lo pongo</th>
    </tr></thead><tbody>${(D.formas_de_pago||[]).map(f=>`<tr>
      <td style="text-align:left">${esc(f.nombre)}</td><td>${f.veces}</td><td>${money(f.monto)}</td>
      <td style="font-weight:800;color:${f.clase==='otros'?D_ROJO:'inherit'}">${esc(f.clase)}</td>
    </tr>`).join('')}</tbody></table></div>`;

  /* Las cuentas por hora: si el día se corta a media tarde, la API está
     entregando la respuesta incompleta y aquí se ve de un vistazo. */
  if((D.por_hora||[]).length){
    h += `<div class="d-h4" style="margin-top:16px">Cuentas por hora</div>
      <p class="hint" style="margin:0 0 8px">Si el día se corta antes de la hora de cierre, la respuesta viene
      incompleta.</p>
      ${dBarras(D.por_hora.map(x=>({nombre:`${x.hora}:00`, valor:Number(x.total),
                                    color:'var(--navy)', extra:`${x.cuentas} cta`})))}`;
  }

  h += `<details style="margin-top:14px"><summary class="hint" style="cursor:pointer">Ver el sobre de la respuesta y los campos crudos</summary>
    <pre style="background:#F6F4EE;border-radius:8px;padding:10px;overflow:auto;font-size:11.5px;margin-top:8px">${
      esc(JSON.stringify({sobre: D.sobre_de_la_respuesta, peticion: D.peticion,
                          campos_de_la_venta: D.campos_de_la_venta,
                          campos_del_total: D.campos_del_total,
                          campos_del_pago: D.campos_del_pago,
                          ejemplo_de_venta: D.ejemplo_de_venta}, null, 1))}</pre></details>`;

  return h + `</div>`;
}

function wireDiag(){
  document.getElementById('dgFecha')?.addEventListener('change', e=>{ dgFecha = e.target.value; render(); });
  document.querySelectorAll('[data-dgdia]').forEach(b=>b.addEventListener('click', ()=>{
    dgFecha = b.dataset.dgdia; dgJala();
  }));
  document.getElementById('dgVer')?.addEventListener('click', ()=>{
    const i = document.getElementById('dgFecha');
    if(i && i.value) dgFecha = i.value;
    dgJala();
  });
  const pi = document.getElementById('ptFolio');
  pi?.addEventListener('input', e=>{ ptFolio = e.target.value; });
  pi?.addEventListener('keydown', e=>{ if(e.key === 'Enter'){ ptFolio = e.target.value; ptJala(); } });
  document.getElementById('ptVer')?.addEventListener('click', ()=>{
    if(pi) ptFolio = pi.value;
    ptJala();
  });
  document.querySelectorAll('[data-ptf]').forEach(b=>b.addEventListener('click', ()=>{
    ptFolio = b.dataset.ptf; ptJala();
  }));
  document.getElementById('rlVer')?.addEventListener('click', rlJala);
}

/* ============================================================
   La prueba del pedido: ¿el mes completo trae lo mismo que los
   días uno por uno?
   ------------------------------------------------------------
   La pantalla pide el mes en UNA sola llamada. Si esa llamada
   viene recortada —paginación, un tope de registros, lo que sea—
   pedir los 31 días por separado va a traer más. Y si los dos
   caminos dan exactamente lo mismo, entonces la API no está
   ocultando nada y el dinero que falta nunca entró al punto de
   venta. Son dos explicaciones muy distintas y esto las separa
   sin opinar.
   ============================================================ */
let cmpData = null, cmpCarga = false, cmpProg = 0;

async function tjCompara(){
  if(cmpCarga || !tjData) return;
  const [y, m] = planMonth.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  cmpCarga = true; cmpData = null; cmpProg = 0; render();
  const porDia = {}, fallos = [];
  for(let d = 1; d <= n; d++){
    const f = `${planMonth}-${String(d).padStart(2,'0')}`;
    try{
      const r = await fetch(`/api/soft-ventas?sucursal=${tjSuc()}&fecha=${f}&productos=0&corte=${corteHora}&token=${encodeURIComponent(user.token)}`);
      const j = await r.json().catch(()=>null);
      if(j?.error || !r.ok) throw new Error(j?.error || ('http '+r.status));
      porDia[f] = { cuentas: Number(j.ventas||0), total: Number(j.total||0),
                    tarjeta: Number(j.pagos?.tarjeta||0),
                    efectivo: Number(j.pagos?.efectivo||0) + Number(j.pagos?.transferencia||0) };
    }catch(e){ fallos.push(f); }
    cmpProg = d; render();
  }
  const mesPorFecha = {};
  for(const x of (tjData.dias||[])) mesPorFecha[x.fecha] = x;
  const filas = Object.entries(porDia).map(([f, uno])=>{
    const mes = mesPorFecha[f] || {ventas:0, total:0, tarjeta:0};
    return { f,
      cuentasUno: uno.cuentas, cuentasMes: Number(mes.ventas||0),
      totalUno: uno.total,     totalMes: Number(mes.total||0),
      tjUno: uno.tarjeta,      tjMes: Number(mes.tarjeta||0) };
  }).sort((a,b)=>a.f<b.f?-1:1);
  cmpData = { filas, fallos,
    cuentasUno: filas.reduce((s,x)=>s+x.cuentasUno,0),
    cuentasMes: filas.reduce((s,x)=>s+x.cuentasMes,0),
    totalUno: Math.round(filas.reduce((s,x)=>s+x.totalUno,0)*100)/100,
    totalMes: Math.round(filas.reduce((s,x)=>s+x.totalMes,0)*100)/100,
    tjUno: Math.round(filas.reduce((s,x)=>s+x.tjUno,0)*100)/100,
    tjMes: Math.round(filas.reduce((s,x)=>s+x.tjMes,0)*100)/100 };
  cmpCarga = false; render();
}

function cmpView(){
  if(!tjData) return '';
  let h = `<div class="panel"><div class="d-h3">¿La consulta del mes trae todo?</div>
    <p class="hint" style="margin:4px 0 10px">La pantalla pide el mes de un jalón. Esto lo vuelve a pedir
    <b>día por día</b>, 31 consultas, y compara. Si los dos caminos dan lo mismo, la API no está escondiendo
    nada — y entonces el dinero que falta nunca entró al punto de venta. Si dan distinto, el problema es de Soft.</p>
    <div class="frm-row"><button class="btn-primary" id="cmpVer" ${cmpCarga?'disabled':''}>
      ${cmpCarga?`Consultando día ${cmpProg} de 31…`:'Comprobar día por día'}</button></div>`;

  if(!cmpData) return h + `</div>`;

  const C = cmpData;
  const igualCta = C.cuentasUno === C.cuentasMes;
  const igualTot = Math.abs(C.totalUno - C.totalMes) < 1;
  const igual = igualCta && igualTot;

  h += `<div class="panel" style="margin:12px 0;border-left:4px solid ${igual?D_VERDE:D_ROJO};
          background:${igual?'#F4FBF7':'#FFF6F5'}">
    <div class="d-h4" style="margin:0 0 6px">${igual
      ? 'Los dos caminos dan lo mismo: la API entrega todo lo que tiene'
      : 'Los dos caminos NO dan lo mismo: la consulta del mes viene recortada'}</div>
    <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
      <th style="text-align:left">Cómo se pidió</th><th>Cuentas</th><th>Total</th><th>Tarjeta</th>
    </tr></thead><tbody>
      <tr><td style="text-align:left">El mes de un jalón</td><td>${C.cuentasMes}</td>
          <td>${money(C.totalMes)}</td><td>${money(C.tjMes)}</td></tr>
      <tr><td style="text-align:left">Día por día</td><td style="font-weight:800">${C.cuentasUno}</td>
          <td style="font-weight:800">${money(C.totalUno)}</td><td style="font-weight:800">${money(C.tjUno)}</td></tr>
      <tr style="font-weight:900;background:${igual?'#DFF3E7':'#FFE4E1'}">
          <td style="text-align:left">Diferencia</td><td>${C.cuentasUno-C.cuentasMes}</td>
          <td>${money(C.totalUno-C.totalMes)}</td><td>${money(C.tjUno-C.tjMes)}</td></tr>
    </tbody></table></div>
    ${C.fallos.length?`<p class="hint" style="margin:8px 0 0;color:${D_ROJO}">${C.fallos.length} días no
      contestaron y quedaron fuera de la comparación: ${C.fallos.map(x=>esc(x.slice(8))).join(', ')}</p>`:''}
    <p style="margin:10px 0 0;font-size:13.5px">${igual
      ? `<b>Entonces la consulta no está recortando nada:</b> el servicio es consistente consigo mismo y
         entrega todo lo que él tiene. Eso NO quiere decir que tenga todo lo que hubo — para saber eso hay
         que compararlo contra el reporte oficial de Soft, aquí arriba. Si el reporte trae más cuentas que
         este servicio, el problema es de ellos.`
      : `<b>Entonces la consulta del mes viene recortada.</b> Es mi problema y lo arreglo con esta tabla.`}</p>
  </div>`;

  const dif = C.filas.filter(x=>x.cuentasUno!==x.cuentasMes || Math.abs(x.totalUno-x.totalMes)>=1);
  if(dif.length){
    h += `<div class="d-h4">Los días donde no coinciden</div>
      <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
        <th>Día</th><th>Ctas (mes)</th><th>Ctas (día)</th><th>Total (mes)</th><th>Total (día)</th><th>Dif.</th>
      </tr></thead><tbody>${dif.map(x=>`<tr>
        <td>${esc(x.f.slice(8))}</td><td>${x.cuentasMes}</td><td style="font-weight:800">${x.cuentasUno}</td>
        <td>${money(x.totalMes)}</td><td style="font-weight:800">${money(x.totalUno)}</td>
        <td class="tj-mal">${money(x.totalUno-x.totalMes)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  return h + `</div>`;
}

/* ============================================================
   El reporte oficial de Soft como referencia
   ------------------------------------------------------------
   Este reporte es la verdad del punto de venta: lo emite el
   propio sistema, día por día, con su venta y su número de
   cuentas. Contra él se calibra la consulta a la API.

   La hora a la que Soft cierra el día de negocio no se pregunta
   ni se supone: se prueban todas las horas de corte de 0 a 8 y
   se elige la que reproduce el CONTEO DE CUENTAS del reporte.
   Las cuentas son enteros y no traen IVA de por medio, así que
   son el juez más limpio que hay.

   Ojo: el reporte viene SIN impuestos. Para compararlo contra la
   planilla —que se captura con IVA— hay que subirle el 16%.
   ============================================================ */
let repOf = null, repError = null, repCargando = false;
/* El turno de Soft en San Carlos corre de 06:00:00 AM a 05:59:59 AM —lo dice la
   propia pantalla del punto de venta—. Ese es el día de negocio, así que ese es
   el corte de arranque. Sigue siendo ajustable por si una sucursal difiere. */
/* La hora de corte del día de negocio.
   Se calibró antes contra el reporte, y la calibración salió empatada: todas
   las horas daban casi lo mismo, así que quedó guardado un 0 que nadie eligió
   a conciencia. La pantalla del propio punto de venta dice «06:00:00 AM -
   05:59:59 AM», y esa no es una opinión: es el turno de Soft. Con 0 las ventas
   de después de medianoche caen en el día equivocado.
   Llave nueva a propósito: la vieja trae el 0 guardado y hay que soltarlo. */
let corteHora = Number(localStorage.getItem('boyes_corte_hora_v2') ?? 6);

function repLee(texto){
  const dias = {};
  for(const raw of String(texto).split(/\r?\n/)){
    const l = raw.replace(/\s+/g,' ').trim();
    const m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(.*)$/);
    if(!m) continue;
    const fecha = `${m[3]}-${m[2]}-${m[1]}`;
    /* Se quitan primero los importes y los porcentajes; lo que queda como
       número suelto es el conteo de cuentas. */
    /* numMX solo quita comas, no el signo de pesos: hay que limpiarlo aquí o
       cada importe se lee como cero. */
    const aNum = x => Number(String(x).replace(/[^0-9.-]/g,'')) || 0;
    const importes = [...m[4].matchAll(/\$\s?-?[\d,]+\.\d{2}/g)].map(aNum);
    if(!importes.length) continue;
    const resto = m[4].replace(/\$\s?-?[\d,]+\.\d{2}/g,' ').replace(/\d+\s*%/g,' ');
    const enteros = [...resto.matchAll(/\b\d{1,5}\b/g)].map(x=>Number(x[0]));
    dias[fecha] = { fecha, venta: importes[0], cuentas: enteros[0] ?? null };
  }
  const lista = Object.values(dias).sort((a,b)=>a.fecha<b.fecha?-1:1);
  if(!lista.length) return {error:'No reconocí ningún día en ese archivo. ¿Es el reporte "Ventas sin impuestos del mes"?'};
  return { dias: lista,
           venta: Math.round(lista.reduce((s,x)=>s+x.venta,0)*100)/100,
           cuentas: lista.reduce((s,x)=>s+(x.cuentas||0),0) };
}

/* Qué hora de corte reproduce mejor el conteo de cuentas del reporte. */
function repCalibra(){
  if(!repOf || !tjData?.calibracion) return null;
  const oficial = {};
  for(const d of repOf.dias) if(d.cuentas!=null) oficial[d.fecha] = d.cuentas;
  const fechas = Object.keys(oficial);
  if(!fechas.length) return null;

  const pruebas = Object.entries(tjData.calibracion).map(([h, mapa])=>{
    let err = 0, exactos = 0, ctas = 0;
    for(const f of fechas){
      const mio = mapa[f]?.cuentas || 0;
      ctas += mio;
      const d = Math.abs(mio - oficial[f]);
      err += d;
      if(d === 0) exactos++;
    }
    return { h: Number(h), err, exactos, cuentas: ctas,
             dias: fechas.length,
             total: Math.round(Object.values(mapa).reduce((s,x)=>s+x.total,0)*100)/100 };
  }).sort((a,b)=> a.err - b.err || a.h - b.h);

  return { pruebas, mejor: pruebas[0],
           oficialCuentas: fechas.reduce((s,f)=>s+oficial[f],0) };
}

function repView(){
  let h = `<div class="panel"><div class="d-h3">El reporte oficial de Soft</div>
    <p class="hint" style="margin:4px 0 12px">Arrastra aquí el PDF de <b>«Ventas sin impuestos del mes»</b> que
    saca el punto de venta. Es la verdad de Soft, y con él se calibra mi consulta: se prueban todas las horas de
    corte y se elige la que reproduce el conteo de cuentas del reporte, día por día. Nada de suponer horarios.</p>
    <div class="conc-drop" id="repDrop">
      <div style="font-size:26px;line-height:1">📄</div>
      <div style="font-weight:800;margin-top:6px">Suelta aquí el reporte del mes</div>
      <div class="hint" style="margin-top:3px">PDF, Excel o CSV · o toca para elegirlo</div>
    </div>
    ${repError?`<p style="color:${D_ROJO};font-weight:700;margin-top:10px">${esc(repError)}</p>`:''}
    ${repCargando?`<p class="hint" style="margin-top:10px">Leyendo…</p>`:''}`;

  if(!repOf) return h + `</div>`;

  const conIva = Math.round(repOf.venta*1.16*100)/100;
  const plaTot = (()=>{ let s=0; for(const v of Object.values(planEdit.ventas||{}))
                        s += planN(v.ef)+planN(v.tj)+planN(v.ra)+planN(v.mq); return s; })();
  const dif = Math.round((plaTot - conIva)*100)/100;

  h += `<div class="tj-g">
    <div class="tj-k" style="border-left-color:#2A78D6"><div class="l">Reporte de Soft, sin impuestos</div>
      <div class="v">${money(repOf.venta)}</div><div class="s">${repOf.cuentas} cuentas · ${repOf.dias.length} días</div></div>
    <div class="tj-k" style="border-left-color:#1BAF7A"><div class="l">El mismo, con IVA 16%</div>
      <div class="v">${money(conIva)}</div><div class="s">así se compara con la planilla</div></div>
    <div class="tj-k" style="border-left-color:${Math.abs(dif)/Math.max(conIva,1)<0.01?'#0B6E3F':'#C0261F'}">
      <div class="l">La planilla del mes</div><div class="v">${money(plaTot)}</div>
      <div class="s">${money(dif)} · ${(dif/Math.max(conIva,1)*100).toFixed(2)}% contra el reporte</div></div>
  </div>`;

  const C = repCalibra();
  if(!C){
    h += `<p class="hint">Trae el mes del punto de venta (el botón de arriba) para poder calibrar.</p>`;
    return h + `</div>`;
  }

  const m = C.mejor, peor = C.pruebas[C.pruebas.length-1];
  const bien = m.err === 0;
  /* Si mover el corte siete horas casi no cambia el resultado, entonces por la
     madrugada no se vende y la hora de corte NO explica nada. Decirlo así evita
     ofrecer un botón que no arregla el problema —y que además dejaría la
     consulta configurada con una hora elegida por ruido. */
  const rangoErr = peor.err - m.err;
  const daIgual = rangoErr <= Math.max(3, m.err * 0.1);
  const faltanCtas = C.oficialCuentas - m.cuentas;
  const faltanPesos = Math.round((conIva - m.total)*100)/100;
  const sirve = !daIgual && m.err < peor.err;

  h += `<div class="panel" style="margin:12px 0;border-left:4px solid ${bien?D_VERDE:D_ROJO};
          background:${bien?'#F4FBF7':'#FFF6F5'}">
    <div class="d-h4" style="margin:0 0 6px">${
      bien ? `El día de negocio corta a las ${m.h}:00 — con eso el conteo cuadra exacto`
      : daIgual ? 'La hora de corte no explica la diferencia'
      : `La hora que mejor ajusta es las ${m.h}:00, pero todavía quedan ${m.err} cuentas de diferencia`}</div>
    <p class="hint" style="margin:0 0 10px">Se probaron nueve horas de corte. Para cada una se comparó, día por
    día, cuántas cuentas trae la API contra cuántas dice el reporte. ${daIgual
      ? `<b>Todas dan prácticamente lo mismo</b> — mover el corte siete horas no cambia el resultado, así que
         por la madrugada casi no se vende y el horario no es la causa.`
      : 'Gana la que menos se equivoca.'}</p>

    <div class="tj-g" style="margin:0 0 12px">
      <div class="tj-k" style="border-left-color:#C0261F"><div class="l">Cuentas que faltan</div>
        <div class="v">${faltanCtas}</div>
        <div class="s">${C.oficialCuentas} en el reporte · ${m.cuentas} en la API</div></div>
      <div class="tj-k" style="border-left-color:#C0261F"><div class="l">Dinero que falta</div>
        <div class="v">${money(faltanPesos)}</div>
        <div class="s">${(faltanPesos/Math.max(conIva,1)*100).toFixed(1)}% del mes</div></div>
      <div class="tj-k" style="border-left-color:#8D6E63"><div class="l">Ticket de lo que falta</div>
        <div class="v">${faltanCtas?money(faltanPesos/faltanCtas):'—'}</div>
        <div class="s">contra ${m.cuentas?money(m.total/m.cuentas):'—'} de lo que sí llega</div></div>
    </div>

    <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
      <th>Hora de corte</th><th>Días exactos</th><th>Cuentas de diferencia</th><th>Cuentas totales</th><th>Venta</th>
    </tr></thead><tbody>
    ${C.pruebas.map(p=>`<tr${p.h===m.h?' style="background:#EEF1F7;font-weight:800"':''}>
      <td>${p.h}:00</td><td>${p.exactos} de ${p.dias}</td><td>${p.err}</td>
      <td>${p.cuentas}</td><td>${money(p.total)}</td></tr>`).join('')}
    <tr style="font-weight:900;background:#DFF3E7"><td>El reporte oficial</td><td>—</td><td>—</td>
      <td>${C.oficialCuentas}</td><td>${money(conIva)}</td></tr>
    </tbody></table></div>

    ${(()=>{
      /* Día por día, el reporte contra la API. Es donde se ve el patrón: si lo
         que falta se concentra en fin de semana, si crece con el volumen, o si
         hay días donde la API trae MÁS. Un promedio del mes esconde todo eso. */
      const oficial = {}; for(const d of repOf.dias) oficial[d.fecha] = d;
      const mapa = tjData.calibracion?.[String(m.h)] || {};
      const filas = Object.keys(oficial).sort().map(f=>{
        const o = oficial[f], mio = mapa[f] || {cuentas:0, total:0};
        const dia = new Date(f+'T12:00:00');
        return { f, dow: ['dom','lun','mar','mié','jue','vie','sáb'][dia.getDay()],
                 d: dia.getDate(),
                 cOf: o.cuentas ?? 0, cApi: mio.cuentas,
                 vOf: Math.round(o.venta*1.16*100)/100, vApi: mio.total };
      });
      const finde = filas.filter(x=>['vie','sáb','dom'].includes(x.dow));
      const entre = filas.filter(x=>!['vie','sáb','dom'].includes(x.dow));
      const pct = g => { const a = g.reduce((s,x)=>s+x.cOf,0), b = g.reduce((s,x)=>s+x.cApi,0);
                         return a ? ((a-b)/a*100) : 0; };
      const pctV = g => { const a = g.reduce((s,x)=>s+x.vOf,0), b = g.reduce((s,x)=>s+x.vApi,0);
                          return a ? ((a-b)/a*100) : 0; };
      return `<div class="d-h4" style="margin-top:16px">Día por día: el reporte contra la API</div>
      <p class="hint" style="margin:0 0 8px">El promedio del mes esconde el patrón. Aquí está cada día, con su
      día de la semana, para ver si lo que falta se concentra en algún lado.</p>
      <div class="tj-g" style="margin:0 0 10px">
        <div class="tj-k" style="border-left-color:#C0261F"><div class="l">Falta entre semana</div>
          <div class="v">${pct(entre).toFixed(1)}%</div><div class="s">de las cuentas · ${pctV(entre).toFixed(1)}% del dinero</div></div>
        <div class="tj-k" style="border-left-color:#C0261F"><div class="l">Falta viernes a domingo</div>
          <div class="v">${pct(finde).toFixed(1)}%</div><div class="s">de las cuentas · ${pctV(finde).toFixed(1)}% del dinero</div></div>
      </div>
      <div class="res-wrap" style="max-height:min(60vh,560px)"><table class="res tj-t" style="font-size:12.5px">
        <thead><tr><th style="text-align:left">Día</th>
          <th>Ctas reporte</th><th>Ctas API</th><th>Faltan</th>
          <th class="sep">Venta reporte c/IVA</th><th>Venta API</th><th>Falta</th><th>%</th>
        </tr></thead><tbody>
        ${filas.map(x=>{
          const dc = x.cOf - x.cApi, dv = Math.round((x.vOf - x.vApi)*100)/100;
          const p = x.vOf ? dv/x.vOf*100 : 0;
          const ok = dc===0 && Math.abs(p)<2;
          const finde = ['vie','sáb','dom'].includes(x.dow);
          return `<tr${ok?' style="background:#DFF3E7"':''}>
            <td style="text-align:left;font-weight:${finde?'800':'600'}">${x.dow} ${x.d}</td>
            <td>${x.cOf}</td><td>${x.cApi}</td>
            <td class="${dc>0?'tj-mal':'tj-bien'}">${dc===0?'✓':dc}</td>
            <td class="sep">${money(x.vOf)}</td><td>${money(x.vApi)}</td>
            <td class="${Math.abs(p)>=2?'tj-mal':'tj-bien'}">${Math.abs(p)<2?'✓':money(dv)}</td>
            <td class="${Math.abs(p)>=2?'tj-mal':'tj-bien'}">${p.toFixed(0)}%</td></tr>`;
        }).join('')}
        </tbody></table></div>`;
    })()}

    ${sirve ? `<div class="frm-row" style="margin-top:12px">
      <button class="btn-primary" data-corte="${m.h}" ${corteHora===m.h?'disabled':''}>
        ${corteHora===m.h?`Ya está usando las ${m.h}:00`:`Usar las ${m.h}:00 de aquí en adelante`}</button>
      <span class="hint" style="margin-left:auto">Ahora mismo estoy usando las <b>${corteHora}:00</b>.</span>
    </div>` : `<p style="margin:12px 0 0;font-size:13.5px"><b>Entonces no hay hora que ajustar.</b>
      La API simplemente entrega menos cuentas de las que el punto de venta tiene, y las que faltan son las
      grandes. El siguiente paso es <b>«Comprobar día por día»</b>, aquí abajo: si pedir los 31 días por
      separado trae más que pedir el mes de un jalón, el problema es de la consulta y lo arreglo yo. Si trae
      lo mismo, el problema está del lado de Soft y hay que reclamárselo con esta tabla.</p>`}
  </div>`;
  return h + `</div>`;
}

function wireRep(){
  const d = document.getElementById('repDrop');
  if(d && !d._listo){
    d._listo = true;
    const lee = async f => {
      if(!f) return;
      repError = null; repCargando = true; render();
      try{
        const r = repLee(await fileToText(f));
        if(r.error){ repError = r.error; repOf = null; } else repOf = r;
      }catch(e){ repError = 'No pude leer el archivo — ' + (e.message||''); repOf = null; }
      repCargando = false; render();
    };
    d.addEventListener('dragover', e=>{ e.preventDefault(); d.classList.add('on'); });
    d.addEventListener('dragleave', ()=>d.classList.remove('on'));
    d.addEventListener('drop', e=>{ e.preventDefault(); d.classList.remove('on'); lee(e.dataTransfer.files[0]); });
    d.addEventListener('click', ()=>{
      const i = document.createElement('input');
      i.type='file'; i.accept='.pdf,.xlsx,.xls,.csv,.txt';
      i.onchange = ()=>lee(i.files[0]);
      i.click();
    });
  }
  document.querySelectorAll('[data-corte]').forEach(b=>b.addEventListener('click', ()=>{
    corteHora = Number(b.dataset.corte);
    localStorage.setItem('boyes_corte_hora_v2', corteHora);
    toast(`Listo — el día de negocio ahora corta a las ${corteHora}:00`);
    tjJala();
  }));
}

/* ============================================================
   Sondeo de la API
   ------------------------------------------------------------
   Cuando el reporte del punto de venta y el servicio en línea de
   Soft no dan lo mismo, lo primero es descartar que yo le esté
   preguntando de menos. Esto manda la MISMA consulta con distintos
   parámetros de paginación añadidos y cuenta cuántos registros
   devuelve cada una. Si alguna trae más que la de hoy, ese es el
   parámetro que faltaba. Si todas traen lo mismo, entonces no es
   la forma de preguntar — y eso se lo reclamamos a Soft con la
   tabla en la mano.
   ============================================================ */
let sonData = null, sonCarga = false, sonError = null;

async function sonJala(){
  if(sonCarga) return;
  const [y, m] = planMonth.split('-').map(Number);
  const desde = `${planMonth}-01`;
  const hasta = `${planMonth}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;
  sonCarga = true; sonError = null; sonData = null; render();
  try{
    const r = await fetch(`/api/soft-ventas?modo=sondeo&sucursal=${tjSuc()}&desde=${desde}&hasta=${hasta}&token=${encodeURIComponent(user.token)}`);
    const j = await r.json().catch(()=>null);
    if(j?.error) throw new Error(j.error + (j.msg?' — '+j.msg:''));
    if(!r.ok) throw new Error('el servidor contestó '+r.status);
    sonData = j;
  }catch(e){ sonError = e.message || 'no se pudo sondear'; }
  sonCarga = false; render();
}

function sonView(){
  let h = `<div class="panel"><div class="d-h3">Sondeo: ¿le estoy preguntando mal a Soft?</div>
    <p class="hint" style="margin:4px 0 10px">Mi consulta le manda a Soft solo cuatro datos: cuenta, sucursal,
    fecha inicial y fecha final. Si su servicio pagina o tiene un tope de registros, <b>hay un parámetro que no
    le estoy mandando</b>. El manual no lo documenta, así que se prueba: la misma consulta con trece variantes
    distintas, contando cuántos registros trae cada una. Si alguna trae más, esa es la respuesta.</p>
    <div class="frm-row"><button class="btn-primary" id="sonVer" ${sonCarga?'disabled':''}>
      ${sonCarga?'Sondeando…':'Sondear la API con este mes'}</button></div>`;
  if(sonError) h += `<p style="color:${D_ROJO};font-weight:700;margin-top:10px">${esc(sonError)}</p>`;
  if(!sonData) return h + `</div>`;

  const S = sonData;
  h += `<div class="panel" style="margin:12px 0;border-left:4px solid ${S.hay_una_mejor?D_VERDE:'#E0A100'};
          background:${S.hay_una_mejor?'#F4FBF7':'#FFFCF4'}">
    <div class="d-h4" style="margin:0 0 6px">${S.hay_una_mejor
      ? `Encontrado: con «${esc(S.mejor_variante)}» trae ${S.mejor_registros} registros en vez de ${S.base_registros}`
      : `Ninguna variante trae más que la de hoy (${S.base_registros} registros)`}</div>
    <p class="hint" style="margin:0">${S.hay_una_mejor
      ? 'Ese era el parámetro que faltaba. Lo dejo puesto y volvemos a comparar contra el reporte.'
      : 'Entonces no es la forma de preguntar. El servicio en línea de Soft entrega menos que el reporte del propio Soft, y eso se les reclama a ellos.'}</p>
  </div>

  <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
    <th style="text-align:left">Variante</th><th>HTTP</th><th>Registros</th>
    <th style="text-align:left">Estados que trajo</th><th>Venta</th></tr></thead><tbody>
  ${S.pruebas.map(p=>{
    const mas = p.registros > S.base_registros;
    return `<tr${mas?' style="background:#DFF3E7;font-weight:800"':''}>
      <td style="text-align:left">${esc(p.variante)}</td>
      <td style="${p.http!==200?'color:'+D_ROJO+';font-weight:800':''}">${p.http}</td>
      <td>${p.registros}</td>
      <td style="text-align:left;font-size:11.5px">${Object.entries(p.estados||{})
        .map(([k,n])=>`${esc(k)} <span class="hint">(${n})</span>`).join(' · ') || '—'}</td>
      <td>${money(p.total)}</td>
    </tr>`;
  }).join('')}
  </tbody></table></div>

  ${(()=>{ const conMsg = S.pruebas.filter(p=>p.dice);
     if(!conMsg.length) return '';
     return `<div class="d-h4" style="margin-top:14px">Lo que contesta Soft cuando le mando un valor que no acepta</div>
     <p class="hint" style="margin:0 0 8px">Aquí es donde una API dice qué valores sí acepta. Es lo único que no
     se puede deducir desde afuera.</p>
     ${conMsg.map(p=>`<div style="margin-bottom:8px">
       <div style="font-size:12px;font-weight:800">${esc(p.variante)} → HTTP ${p.http}</div>
       <pre style="background:#F6F4EE;border-radius:8px;padding:8px;overflow:auto;font-size:11.5px;margin:4px 0 0">${esc(p.dice)}</pre>
     </div>`).join('')}`;
  })()}

  <div class="d-h4" style="margin-top:14px">El sobre de la respuesta</div>
  <p class="hint" style="margin:0 0 8px">Todo lo que Soft manda junto al listado. Si hay paginación —un total de
  registros, un número de página, un "hay más"— vive aquí.</p>
  <pre style="background:#F6F4EE;border-radius:8px;padding:10px;overflow:auto;font-size:11.5px;margin:0">${
    esc(JSON.stringify(S.pruebas[0]?.sobre ?? {}, null, 1))}</pre>`;

  return h + `</div>`;
}