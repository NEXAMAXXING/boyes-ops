/* ============================================================
   Boye's OPS — Consulta de cuentas
   ------------------------------------------------------------
   Es la pantalla de Soft Restaurant, con sus tres botones:
   Turno (un día de negocio), Periodo (de fecha a fecha) y
   Anual (un año completo). El renglón por cuenta, no la suma
   del día — para eso ya están los otros periodos del Resumen.

   UNA ACLARACIÓN QUE NO SE PUEDE ESCONDER: en Soft la tabla
   trae mesero, mesa, personas, estación y área. La API pública
   NO manda ninguno de esos campos. No se inventan y no se
   dejan columnas vacías fingiendo que algún día se llenan: se
   dice abajo de la tabla qué falta y por qué.

   Qué sí trae cada cuenta: folio, fecha y hora, total, propina,
   descuento, forma de pago, si está cancelada, y —abriéndola—
   los renglones con cantidad, descripción, precio e importe.
   ============================================================ */

let ctasData = null, ctasError = null, ctasCargando = false;
let ctasSel = null, ctasDet = null, ctasDetCargando = false;
let ctasBusca = '';

const CTAS_HOY = () => new Date(Date.now() - 6*3600*1000).toISOString().slice(0,10);

/* Qué ventana se está viendo y con qué fechas. Se recuerda entre visitas:
   quien revisa el mismo periodo todos los días no tiene por qué volver a
   armarlo cada vez que entra. */
let ctasVista = 'turno', ctasFecha = CTAS_HOY(),
    ctasDesde = CTAS_HOY(), ctasHasta = CTAS_HOY(),
    ctasAno = Number(CTAS_HOY().slice(0,4)),
    ctasLoc = 0;
try{
  const g = JSON.parse(localStorage.getItem('boyes_ctas')||'{}');
  if(g.vista) ctasVista = g.vista;
  if(g.fecha) ctasFecha = g.fecha;
  if(g.desde) ctasDesde = g.desde;
  if(g.hasta) ctasHasta = g.hasta;
  if(g.ano)   ctasAno   = Number(g.ano);
  if(g.loc!==undefined) ctasLoc = Number(g.loc)||0;
}catch(e){}
function ctasGuarda(){
  try{ localStorage.setItem('boyes_ctas', JSON.stringify({
    vista:ctasVista, fecha:ctasFecha, desde:ctasDesde, hasta:ctasHasta,
    ano:ctasAno, loc:ctasLoc })); }catch(e){}
}

const ctasLocs = () => ctasLoc ? [ctasLoc] : [1,2];
const CTAS_SUC = {1:'guaymas', 2:'sancarlos'};

/* Cada cambio de ventana o de fechas estrena consulta. Se lleva un sello con
   lo que se pidió para no repetir la misma llamada al volver a pintar —un año
   son varios tramos y no se piden dos veces por un repintado. */
function ctasSello(){
  return [ctasVista, ctasLoc,
          ctasVista==='turno' ? ctasFecha
          : ctasVista==='anual' ? ctasAno
          : ctasDesde+'·'+ctasHasta].join('|');
}
let ctasUlt = null;

async function refreshCtas(forzar){
  const sello = ctasSello();
  if(ctasCargando) return;
  if(!forzar && ctasUlt===sello && ctasData) return;
  ctasCargando = true; ctasError = null; ctasUlt = sello;
  ctasSel = null; ctasDet = null;

  const p = new URLSearchParams({ modo:'cuentas', vista:ctasVista, token:user.token });
  if(ctasVista==='turno') p.set('fecha', ctasFecha);
  else if(ctasVista==='anual') p.set('ano', String(ctasAno));
  else { p.set('desde', ctasDesde); p.set('hasta', ctasHasta); }

  try{
    const r = await Promise.all(ctasLocs().map(async id=>{
      const u = new URLSearchParams(p); u.set('sucursal', CTAS_SUC[id]);
      const res = await fetch('/api/soft-ventas?'+u.toString());
      const d = await res.json().catch(()=>null);
      if(d?.error) throw new Error(d.error + (d.msg?' — '+d.msg:''));
      if(!res.ok) throw new Error('el servidor contestó '+res.status);
      return [id, d];
    }));
    ctasData = Object.fromEntries(r);
  }catch(e){
    ctasError = e.message || 'No se pudo consultar el punto de venta';
    ctasData = null; ctasUlt = null;
  }
  finally{ ctasCargando = false; }
  render();
}

async function refreshCtaDet(loc, saleId){
  ctasDetCargando = true; ctasDet = null; render();
  try{
    const res = await fetch(`/api/soft-ventas?modo=cuenta&sucursal=${CTAS_SUC[loc]}&saleId=${encodeURIComponent(saleId)}&token=${encodeURIComponent(user.token)}`);
    const d = await res.json().catch(()=>null);
    if(d?.error) throw new Error(d.error);
    if(!res.ok) throw new Error('el servidor contestó '+res.status);
    ctasDet = d;
  }catch(e){ ctasDet = { error: e.message || 'No se pudo abrir la cuenta' }; }
  finally{ ctasDetCargando = false; }
  render();
}

/* ---------- utilería de pantalla ---------- */
const ctasHora = f => {
  const s = String(f||''); const t = s.slice(11,16);
  return t || '—';
};
const ctasDia = f => String(f||'').slice(0,10) || '—';

/* Las filas que se están viendo, de las dos sucursales juntas y ya ordenadas
   por hora. Cada fila se queda con su sucursal pegada porque abrir la cuenta
   requiere saber a qué punto de venta preguntarle. */
function ctasFilas(){
  let f = [];
  for(const id of ctasLocs()){
    const D = ctasData?.[id];
    if(!D?.filas) continue;
    f = f.concat(D.filas.map(x=>({...x, loc:id})));
  }
  const b = ctasBusca.trim().toLowerCase();
  if(b) f = f.filter(x =>
    String(x.folio||'').toLowerCase().includes(b) ||
    String(x.total).includes(b) ||
    (x.pagos||[]).some(p=>String(p.nombre||'').toLowerCase().includes(b)));
  f.sort((a,b2)=>String(b2.fecha||'').localeCompare(String(a.fecha||'')));
  return f;
}

/* ---------- la vista ---------- */
function ctasView(){
  const anos = []; const anoHoy = Number(CTAS_HOY().slice(0,4));
  for(let a=anoHoy; a>=anoHoy-4; a--) anos.push(a);

  /* Los tres botones, en el mismo orden que allá. */
  let h = `<div class="d-per">
    <div class="switch" role="group" aria-label="Ventana">
      ${[['turno','Turno'],['periodo','Periodo'],['anual','Anual']]
        .map(([v,l])=>`<button aria-pressed="${ctasVista===v}" data-cv="${v}">${l}</button>`).join('')}
    </div>
    <div class="d-per-r">`;

  if(ctasVista==='turno'){
    h += `<label>Día del negocio
      <input type="date" data-cf="fecha" value="${ctasFecha}"></label>
      <span class="hint">El día como lo corta el punto de venta: lo que se vendió después de medianoche todavía cuenta para el día anterior.</span>`;
  } else if(ctasVista==='anual'){
    h += `<label>Año
      <select data-cf="ano">${anos.map(a=>`<option value="${a}" ${a===ctasAno?'selected':''}>${a}</option>`).join('')}</select></label>
      <span class="hint">Un año completo se pide en tramos; tarda unos segundos.</span>`;
  } else {
    h += `<label>De <input type="date" data-cf="desde" value="${ctasDesde}"></label>
      <label>a <input type="date" data-cf="hasta" value="${ctasHasta}"></label>`;
  }
  h += `</div></div>`;

  /* Encabezado con la sucursal y el botón de volver a consultar. */
  h += `<div class="d-head">
    <div>
      <div class="d-eyebrow">Consulta de cuentas</div>
      <h2 class="d-titulo">${esc(ctasTitulo())}</h2>
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div class="switch d-switch" role="group" aria-label="Sucursal">
        <button aria-pressed="${ctasLoc===0}" data-cloc="0">Las dos</button>
        <button aria-pressed="${ctasLoc===1}" data-cloc="1">Guaymas</button>
        <button aria-pressed="${ctasLoc===2}" data-cloc="2">San Carlos</button>
      </div>
      <button class="btn-quiet" id="ctasYa" style="flex:none">${ctasCargando?'Consultando…':'↻ Consultar'}</button>
    </div>
  </div>`;

  if(ctasError){
    return h + `<div class="panel" style="border-left:4px solid ${D_ROJO}">
      <p style="font-weight:700;margin:0 0 8px">No se pudo consultar — ${esc(ctasError)}</p>
      <button class="btn-primary" id="ctasRetry">Reintentar</button></div>`;
  }
  if(!ctasData){
    if(!ctasCargando) refreshCtas();
    return h + `<div class="panel"><p class="hint">Consultando el punto de venta…</p></div>`;
  }

  const filas = ctasFilas();
  const vivas = filas.filter(f=>!f.cancelada);
  const tot   = vivas.reduce((s,f)=>s+Number(f.total||0),0);
  const prop  = vivas.reduce((s,f)=>s+Number(f.propina||0),0);
  const desc  = vivas.reduce((s,f)=>s+Number(f.descuento||0),0);
  const canc  = filas.length - vivas.length;

  h += `<div class="d-tiles">
    ${dTile('Cuentas', String(vivas.length), undefined, canc?`${canc} cancelada${canc===1?'':'s'} aparte`:'ninguna cancelada')}
    ${dTile('Importe', money(tot), undefined, 'suma de las cuentas vivas')}
    ${dTile('Ticket promedio', vivas.length?money(tot/vivas.length):'—', undefined, 'por cuenta')}
    ${dTile('Propinas', money(prop), undefined, desc?`${money(desc)} en descuentos`:'sin descuentos')}
  </div>`;

  /* Aviso de recorte: si el periodo trae más cuentas de las que se mandan, se
     dice, en vez de dejar creer que eso es todo lo que hubo. */
  const recortado = ctasLocs().some(id=>ctasData?.[id]?.recortado);
  if(recortado){
    const totF = ctasLocs().reduce((s,id)=>s+Number(ctasData?.[id]?.total_filas||0),0);
    h += `<div class="panel" style="border-left:4px solid #E0A100;background:#FFFCF4">
      <p style="margin:0;font-size:13.5px"><b>Se están mostrando las ${filas.length} cuentas más recientes</b>
      de ${totF.toLocaleString('es-MX')} que tiene el periodo. Los totales de arriba son de lo mostrado.
      Para verlo completo, acorta el periodo.</p></div>`;
  }

  h += `<div class="panel">
    <div class="frm-row" style="justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap">
      <div class="d-h3" style="margin:0">Cuentas</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="ctasBusca" type="search" placeholder="Buscar folio, importe o forma de pago"
               value="${esc(ctasBusca)}" style="min-height:40px;border:1.5px solid var(--line);border-radius:8px;padding:6px 10px;font-size:14px;min-width:240px">
        <button class="btn-quiet" id="ctasXls" style="flex:none">⬇ Excel</button>
      </div>
    </div>`;

  if(!filas.length){
    h += `<p class="hint">No hay cuentas en este periodo${ctasBusca?' que coincidan con la búsqueda':''}.</p></div>`;
    return h + ctasFaltantes();
  }

  const conSuc = ctasLoc===0;
  const cols = 8 + (conSuc?1:0);

  h += `<div class="res-wrap"><table class="res"><thead><tr>
    <th>Folio</th>
    ${conSuc?'<th>Sucursal</th>':''}
    <th>Día</th><th>Hora</th>
    <th>Descuento</th><th>Propina</th><th>Total</th>
    <th>Forma de pago</th><th>Estado</th></tr></thead><tbody>`;

  for(const f of filas){
    const abierta = ctasSel && ctasSel.saleId===f.saleId;
    const pagos = (f.pagos||[]).map(p=>esc(p.nombre||p.clase||'—')).join(' + ') || '—';
    h += `<tr data-cta="${esc(f.saleId)}" data-ctaloc="${f.loc}"
             style="cursor:pointer;${abierta?'background:#F3F7FB':''}${f.cancelada?';opacity:.6':''}">
      <td style="font-weight:700">${abierta?'▾':'▸'} ${esc(String(f.folio??'—'))}</td>
      ${conSuc?`<td style="text-align:left">${esc(LOCS[f.loc]||'')}</td>`:''}
      <td>${esc(f.dia||ctasDia(f.fecha))}</td>
      <td>${esc(ctasHora(f.fecha))}</td>
      <td>${Number(f.descuento)?money(f.descuento):'—'}</td>
      <td>${Number(f.propina)?money(f.propina):'—'}</td>
      <td class="tot2">${money(f.total)}</td>
      <td style="text-align:left;white-space:normal">${pagos}</td>
      <td style="font-weight:800;color:${f.cancelada?D_ROJO:D_VERDE}">${f.cancelada?'Cancelada':'Cobrada'}</td>
    </tr>`;
    if(abierta) h += `<tr><td colspan="${cols}" style="text-align:left;white-space:normal;background:#F8FAFC;padding:0">
      ${ctasDetView()}</td></tr>`;
  }

  h += `</tbody><tfoot><tr>
    <td>${vivas.length} cuenta${vivas.length===1?'':'s'}</td>
    ${conSuc?'<td></td>':''}<td></td><td></td>
    <td>${desc?money(desc):'—'}</td><td>${prop?money(prop):'—'}</td>
    <td>${money(tot)}</td><td></td><td></td>
  </tr></tfoot></table></div>`;

  /* El desglose por forma de pago, como el pie de la consulta de Soft. */
  const sp = {};
  for(const f of vivas) for(const p of (f.pagos||[]))
    sp[p.clase||'otro'] = (sp[p.clase||'otro']||0) + Number(p.monto||0);
  const clases = Object.entries(sp).sort((a,b)=>b[1]-a[1]);
  if(clases.length){
    h += `<div class="d-h4" style="margin-top:14px">Cómo se pagó</div>
      <div class="d-tiles">${clases.map(([c,m])=>
        dTile(c.charAt(0).toUpperCase()+c.slice(1), money(m), undefined,
              tot?`${Math.round(m/tot*100)}% del importe`:'')).join('')}</div>`;
  }

  h += `</div>`;
  return h + ctasFaltantes();
}

function ctasTitulo(){
  const suc = ctasLoc===0 ? 'Guaymas y San Carlos' : LOCS[ctasLoc];
  if(ctasVista==='turno')  return `${ctasFecha} · ${suc}`;
  if(ctasVista==='anual')  return `Año ${ctasAno} · ${suc}`;
  return `Del ${ctasDesde} al ${ctasHasta} · ${suc}`;
}

/* El detalle de una cuenta: los renglones como salen en el ticket. */
function ctasDetView(){
  if(ctasDetCargando) return `<p class="hint" style="padding:12px 14px;margin:0">Abriendo la cuenta…</p>`;
  if(!ctasDet) return `<p class="hint" style="padding:12px 14px;margin:0">—</p>`;
  if(ctasDet.error) return `<p style="padding:12px 14px;margin:0;font-weight:700;color:${D_ROJO}">${esc(ctasDet.error)}</p>`;

  const R = ctasDet.renglones||[];
  const T = ctasDet.totales||{};
  let h = `<div style="padding:12px 14px 14px">`;

  if(!R.length){
    h += `<p class="hint" style="margin:0 0 10px"><b>El punto de venta no devolvió los renglones de esta cuenta.</b>
      Pasa con cuentas viejas o canceladas. Los totales sí vienen.</p>`;
  } else {
    h += `<table style="width:100%;border-collapse:collapse;font-size:13.5px;background:#fff">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2)">Mov</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2)">Cant</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2)">Descripción</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2)">Precio</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2)">Desc.</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2)">Importe</th>
      </tr></thead><tbody>
      ${R.map(d=>`<tr>
        <td style="padding:5px 8px;border-bottom:1px solid var(--line);color:var(--ink-2)">${d.mov}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums">${d.cantidad}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--line);font-weight:600">${esc(d.descripcion||'—')}${
          d.categoria?` <span style="font-weight:400;color:var(--ink-2)">· ${esc(d.categoria)}</span>`:''}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums">${money(d.precio)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums">${Number(d.descuento)?money(d.descuento):'—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${money(d.importe)}</td>
      </tr>`).join('')}
      </tbody></table>`;
  }

  /* Los totales tal como los manda el POS, sin recalcular: si algo no cuadra,
     que se vea el número del punto de venta y no uno nuestro. */
  const par = [
    ['Subtotal', T.SubTotal ?? T.Subtotal],
    ['Descuento', T.Discount],
    ['Impuesto', T.Tax ?? T.Taxes],
    ['Propina', T.Tips ?? T.Tip],
    ['Total', T.Total]
  ].filter(([,v]) => v!==undefined && v!==null);

  h += `<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;align-items:flex-start">
    <div style="min-width:200px">
      <div class="d-h4" style="margin:0 0 6px">Totales del punto de venta</div>
      ${par.map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:20px;padding:3px 0;font-size:13.5px${k==='Total'?';font-weight:800;border-top:1px solid var(--line);margin-top:4px;padding-top:6px':''}">
        <span>${k}</span><span style="font-variant-numeric:tabular-nums">${money(v)}</span></div>`).join('')}
    </div>
    <div style="min-width:220px">
      <div class="d-h4" style="margin:0 0 6px">Pagos</div>
      ${(ctasDet.pagos||[]).length
        ? (ctasDet.pagos||[]).map(p=>`<div style="display:flex;justify-content:space-between;gap:20px;padding:3px 0;font-size:13.5px">
            <span>${esc(p.nombre||'—')}${p.referencia?` <span style="color:var(--ink-2)">· ${esc(String(p.referencia))}</span>`:''}</span>
            <span style="font-variant-numeric:tabular-nums">${money(p.monto)}${Number(p.propina)?` <span style="color:var(--ink-2)">+${money(p.propina)} prop.</span>`:''}</span></div>`).join('')
        : `<p class="hint" style="margin:0">Sin formas de pago registradas.</p>`}
    </div>
  </div>`;

  h += `</div>`;
  return h;
}

/* Lo que Soft enseña y la API no manda. Se pone una sola vez, abajo, con los
   nombres de los campos que sí llegaron: si algún día aparece el mesero, se
   va a ver aquí sin tener que salir a buscarlo. */
function ctasFaltantes(){
  const campos = [];
  for(const id of ctasLocs()){
    const c = ctasData?.[id]?.campos_de_la_venta;
    if(Array.isArray(c)) for(const x of c) if(!campos.includes(x)) campos.push(x);
  }
  return `<div class="panel" style="border-left:4px solid #E0A100;background:#FFFCF4">
    <div class="d-h4" style="margin:0 0 6px">Por qué faltan columnas contra Soft</div>
    <p style="margin:0;font-size:13.5px">En la pantalla del punto de venta esta tabla trae además
    <b>mesero, mesa, personas, estación y área</b>. La API que Soft nos abre <b>no manda esos campos</b>
    en la venta, así que no aparecen: preferimos una columna que falta a una columna inventada.
    Para tenerlas hay que pedirle a Soft que las incluya en <code>Sale/Get</code>.</p>
    ${campos.length?`<p class="hint" style="margin:8px 0 0">Lo que sí llega hoy en cada venta: ${campos.map(c=>esc(c)).join(', ')}.</p>`:''}
  </div>`;
}

/* ---------- Excel ---------- */
async function ctasExcel(){
  /* La librería de Excel se baja la primera vez que alguien la pide: cargarla
     siempre haría más pesada una pantalla que casi nunca se exporta. */
  if(typeof loadXLSX==='function') await loadXLSX();
  if(typeof XLSX==='undefined'){ if(typeof toast==='function') toast('No se pudo cargar la librería de Excel'); return; }
  const filas = ctasFilas();
  const conSuc = ctasLoc===0;
  const cab = ['Folio', ...(conSuc?['Sucursal']:[]), 'Día', 'Fecha y hora',
               'Descuento','Propina','Total','Forma de pago','Estado'];
  const rows = [cab, ...filas.map(f=>[
    f.folio ?? '', ...(conSuc?[LOCS[f.loc]||'']:[]),
    f.dia || ctasDia(f.fecha), f.fecha || '',
    Number(f.descuento||0), Number(f.propina||0), Number(f.total||0),
    (f.pagos||[]).map(p=>p.nombre||p.clase||'').join(' + '),
    f.cancelada ? 'Cancelada' : 'Cobrada'
  ])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Cuentas');
  const nom = ctasVista==='turno' ? ctasFecha
            : ctasVista==='anual' ? String(ctasAno)
            : `${ctasDesde}_a_${ctasHasta}`;
  XLSX.writeFile(wb, `Cuentas_${nom}.xlsx`);
  if(typeof toast==='function') toast('Excel descargado ✓');
}

/* ---------- eventos ---------- */
function wireCtas(){
  $('#ctasRetry')?.addEventListener('click', ()=>refreshCtas(true));
  $('#ctasYa')?.addEventListener('click', ()=>refreshCtas(true));
  $('#ctasXls')?.addEventListener('click', ctasExcel);

  $('#main').querySelectorAll('[data-cv]').forEach(b=>b.addEventListener('click', ()=>{
    ctasVista = b.dataset.cv; ctasGuarda(); ctasData = null; ctasUlt = null; render();
  }));

  $('#main').querySelectorAll('[data-cloc]').forEach(b=>b.addEventListener('click', ()=>{
    ctasLoc = Number(b.dataset.cloc); ctasGuarda(); ctasData = null; ctasUlt = null; render();
  }));

  $('#main').querySelectorAll('[data-cf]').forEach(el=>el.addEventListener('change', ()=>{
    const k = el.dataset.cf, v = el.value;
    if(k==='fecha') ctasFecha = v;
    else if(k==='ano') ctasAno = Number(v);
    else if(k==='desde') ctasDesde = v;
    else if(k==='hasta') ctasHasta = v;
    /* Si se invierten las fechas se acomodan solas, en vez de devolver vacío. */
    if(ctasDesde && ctasHasta && ctasDesde > ctasHasta){
      const t = ctasDesde; ctasDesde = ctasHasta; ctasHasta = t;
    }
    ctasGuarda(); ctasData = null; ctasUlt = null; render();
  }));

  /* La búsqueda filtra lo que ya se trajo: no vuelve a preguntarle al POS.
     Se repinta sin perder el cursor porque el input se vuelve a enfocar. */
  const bs = $('#ctasBusca');
  if(bs) bs.addEventListener('input', ()=>{
    ctasBusca = bs.value;
    const pos = bs.selectionStart;
    render();
    const n = $('#ctasBusca');
    if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} }
  });

  $('#main').querySelectorAll('[data-cta]').forEach(tr=>tr.addEventListener('click', ()=>{
    const id = tr.dataset.cta, loc = Number(tr.dataset.ctaloc);
    if(ctasSel && ctasSel.saleId===id){ ctasSel = null; ctasDet = null; render(); return; }
    ctasSel = { saleId:id, loc };
    refreshCtaDet(loc, id);
  }));
}
