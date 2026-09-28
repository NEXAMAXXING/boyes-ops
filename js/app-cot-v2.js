/* ============================================================
   FORMATOS · Cotizaciones
   ------------------------------------------------------------
   Antes esto era un PDF que alguien editaba a mano: copiaba los
   precios del menú, los tecleaba, sacaba el IVA con calculadora
   y guardaba el archivo en su computadora. Tres cosas salían mal
   solas: los precios envejecían, el IVA se equivocaba, y no
   quedaba registro de qué se le cotizó a quién.

   Aquí los precios salen del menú de boyesburger.com —el mismo
   que ve el cliente—, las sumas las hace la máquina, y cada
   cotización queda guardada con sus renglones y su precio del
   día. Una cotización es una promesa a una fecha: si mañana sube
   el menú, lo ya cotizado no se mueve.
   ============================================================ */

let cotLista = null;        // las guardadas
let cotEdit  = null;        // la que se está armando (null = viendo la lista)
let cotMenu  = null;        // el menú del sitio
let cotMenuErr = null;
let cotBusca = '';
let cotCat   = '';
let cotCargando = false;

const COT_SUC = {
  guaymas: {
    nombre: 'Suc. Guaymas', tel: '622 222 7992',
    dir: ['Blvd. Luis Encinas Esq.', 'Privadas del Mar, Col. Miramar', 'Guaymas, Son.']
  },
  sancarlos: {
    nombre: 'Suc. San Carlos', tel: '622 226 0369',
    dir: ['Blvd. Manlio Fabio Beltrones', 'Sector Crestón', 'San Carlos, Son.']
  }
};

/* Los textos que casi siempre son los mismos, ya escritos. Se pueden
   cambiar en cada cotización: son un punto de partida, no una regla. */
const COT_SALUDO = 'Gracias por considerar a Boye\'s Burgers & Pizza para tu evento. ' +
  'A continuación te compartimos la cotización con los precios vigentes.';
const COT_CIERRE = 'Precios vigentes a la fecha de esta cotización. ' +
  'Cualquier duda con gusto te atendemos.';

const cotHoy = () => new Date().toISOString().slice(0,10);
const cotNuevo = () => ({
  id: null, folio: null, cliente: '', fecha: cotHoy(), sucursal: 'guaymas',
  saludo: COT_SALUDO, cierre: COT_CIERRE, notas: '', iva: 16, renglones: []
});

/* ---------- datos ---------- */
async function cotRefresca(){
  cotCargando = true; render();
  try{ cotLista = await finRpc('cot_list', {}) || []; }
  catch(e){ cotLista = []; toast('No se pudieron cargar las cotizaciones'); }
  cotCargando = false; render();
}

async function cotJalaMenu(){
  if(cotMenu) return cotMenu;
  try{
    const r = await fetch('/api/menu-web', {cache:'no-store'});
    const j = await r.json();
    if(j.error) throw new Error(j.error);
    cotMenu = j; cotMenuErr = null;
  }catch(e){
    cotMenu = null;
    cotMenuErr = e.message || 'no se pudo leer el menú del sitio';
  }
  render();
  return cotMenu;
}

/* ---------- cuentas ----------
   El menú publica el precio CON IVA (lo que paga el cliente). La cotización
   lo enseña sin IVA y suma el impuesto aparte, igual que el formato de
   siempre. Así el TOTAL de la cotización da exactamente lo que costaría
   pedir eso mismo en el menú — que es lo que el cliente va a comparar. */
function cotCuentas(c){
  const f = 1 + (Number(c.iva||0) / 100);
  let conIva = 0;
  for(const r of (c.renglones||[])){
    conIva += Number(r.precio||0) * Number(r.cant||0);
  }
  const total = Math.round(conIva*100)/100;
  const sub   = Math.round((total / f)*100)/100;
  return { sub, imp: Math.round((total - sub)*100)/100, total, factor: f };
}
/* El unitario que se imprime: el del menú, sin IVA. */
const cotUnit = (r, f) => Math.round((Number(r.precio||0) / f)*100)/100;

/* ---------- la lista ---------- */
function cotListaView(){
  let h = `<div class="panel">
    <div class="d-h3">Cotizaciones</div>
    <p class="hint" style="margin:4px 0 12px">Los precios salen del menú de
      <b>boyesburger.com</b>, el mismo que ve el cliente. Cada cotización se guarda con el
      precio del día: si mañana sube el menú, lo ya cotizado no se mueve.</p>
    <button class="btn-primary" id="cotNueva" style="width:100%">+ Nueva cotización</button>
  </div>`;

  if(cotLista === null || cotCargando)
    return h + `<div class="empty"><b>Cargando…</b></div>`;

  if(!cotLista.length)
    return h + `<div class="empty"><b>Todavía no hay cotizaciones</b>
      <span style="display:block;margin-top:6px;font-size:13px;color:var(--ink-2)">
        La primera que hagas queda guardada aquí para reabrirla y cambiarla cuando quieras.</span></div>`;

  h += `<div class="res-wrap"><table class="res"><thead><tr>
    <th style="text-align:left">Folio</th><th style="text-align:left">Cliente</th>
    <th>Fecha</th><th>Renglones</th><th>Total</th><th></th></tr></thead><tbody>`;
  for(const c of cotLista){
    h += `<tr>
      <td style="text-align:left;font-weight:700">${esc(c.folio||'—')}</td>
      <td style="text-align:left">${esc(c.cliente||'(sin cliente)')}</td>
      <td>${esc(String(c.fecha||'').split('-').reverse().join('/'))}</td>
      <td>${c.renglones||0}</td>
      <td style="font-weight:800">${money(c.total||0)}</td>
      <td><button class="rowbtn" data-cotabre="${c.id}">Abrir</button></td></tr>`;
  }
  h += `</tbody></table></div>`;
  return h;
}

/* ---------- el editor ---------- */
function cotEditorView(){
  const c = cotEdit, N = cotCuentas(c);
  const suc = COT_SUC[c.sucursal] || COT_SUC.guaymas;

  let h = `<div class="frm-row" style="margin-bottom:10px">
    <button class="btn-quiet" id="cotVolver">‹ Todas las cotizaciones</button>
    ${c.folio?`<span class="hint" style="font-weight:800;align-self:center">${esc(c.folio)}</span>`:''}
  </div>`;

  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px;margin-bottom:10px">1. Para quién</div>
    <div class="frm-row-3">
      <label>Cotización a <input type="text" id="cotCliente" maxlength="90"
        value="${esc(c.cliente)}" placeholder="Nombre del cliente o empresa"></label>
      <label>Fecha <input type="date" id="cotFecha" value="${esc(c.fecha)}"
        style="min-height:44px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:15px"></label>
      <label>Sucursal <select id="cotSuc" style="min-height:44px">
        <option value="guaymas" ${c.sucursal==='guaymas'?'selected':''}>Guaymas</option>
        <option value="sancarlos" ${c.sucursal==='sancarlos'?'selected':''}>San Carlos</option>
      </select></label>
    </div>
  </div>`;

  /* ---- el buscador de productos ---- */
  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px;margin-bottom:4px">2. Agregar del menú</div>
    <p class="hint" style="margin:0 0 10px">Precios en vivo del menú en línea.
      ${cotMenu ? `<b>${cotMenu.total}</b> productos · leído del sitio` : ''}</p>`;

  if(cotMenuErr){
    h += `<div style="padding:10px 12px;border-radius:10px;background:#FFF3D6;border-left:4px solid var(--warn)">
      <b>No pude leer el menú del sitio.</b>
      <div class="hint" style="margin-top:4px">${esc(cotMenuErr)} — puedes seguir capturando
      renglones a mano abajo.</div>
      <button class="btn-quiet" id="cotMenuRetry" style="margin-top:8px">Reintentar</button></div>`;
  } else if(!cotMenu){
    h += `<p class="hint">Cargando el menú…</p>`;
  } else {
    const cats = cotMenu.categorias || [];
    h += `<div class="frm-row" style="margin-bottom:8px">
      <input type="search" id="cotBusca" placeholder="Buscar producto…" value="${esc(cotBusca)}"
        style="flex:1;min-width:180px">
      <select id="cotCat" style="min-height:44px">
        <option value="">Todas las categorías</option>
        ${cats.map(x=>`<option value="${esc(x.id)}" ${cotCat===x.id?'selected':''}>${esc(x.emoji||'')} ${esc(x.nombre)}</option>`).join('')}
      </select></div>`;

    const q = cotBusca.trim().toLowerCase();
    const lista = (cotMenu.productos||[]).filter(p =>
      (!cotCat || p.cat === cotCat) &&
      (!q || p.nombre.toLowerCase().includes(q)));

    h += `<div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:10px">`;
    if(!lista.length) h += `<p class="hint" style="padding:14px">Nada con ese nombre.</p>`;
    for(const p of lista.slice(0,120)){
      h += `<div style="display:flex;align-items:center;gap:10px;padding:8px 11px;border-bottom:1px solid var(--line)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${esc(p.nombre)}</div>
          <div class="hint" style="font-size:11.5px">${esc(p.categoria||'')}</div>
        </div>
        <div style="font-weight:800;font-variant-numeric:tabular-nums">${money(p.precio)}</div>
        <button class="rowbtn" data-cotadd="${esc(p.id)}">Agregar</button>
      </div>`;
    }
    if(lista.length > 120)
      h += `<p class="hint" style="padding:10px">…y ${lista.length-120} más. Busca por nombre para acotar.</p>`;
    h += `</div>`;
  }
  h += `<button class="btn-quiet" id="cotLibre" style="width:100%;margin-top:10px">
    + Renglón a mano (servicio, traslado, montaje…)</button></div>`;

  /* ---- los renglones ---- */
  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px;margin-bottom:8px">3. La cotización</div>`;
  if(!c.renglones.length){
    h += `<p class="hint">Todavía no hay nada. Agrega productos del menú de arriba.</p>`;
  } else {
    h += `<div class="res-wrap"><table class="res"><thead><tr>
      <th style="text-align:left;min-width:150px">Platillo</th>
      <th style="width:90px">Cantidad</th>
      <th style="width:110px">P. unitario<br><span style="font-weight:600;font-size:10px">sin IVA</span></th>
      <th style="width:110px">Importe</th><th style="width:44px"></th></tr></thead><tbody>`;
    c.renglones.forEach((r,ix)=>{
      const unit = cotUnit(r, N.factor);
      h += `<tr>
        <td style="text-align:left"><input type="text" data-cotr="${ix}" data-cotf="nombre"
          value="${esc(r.nombre||'')}" style="width:100%;min-height:38px"></td>
        <td><input type="text" inputmode="decimal" class="nospin" data-cotr="${ix}" data-cotf="cant"
          value="${esc(String(r.cant||1))}" style="width:72px;min-height:38px;text-align:right"></td>
        <td style="font-variant-numeric:tabular-nums">${money(unit)}</td>
        <td style="font-weight:800;font-variant-numeric:tabular-nums">${money(unit * Number(r.cant||0))}</td>
        <td><button class="rowbtn" data-cotdel="${ix}" title="Quitar">✕</button></td></tr>`;
    });
    h += `</tbody><tfoot>
      <tr><td colspan="3" style="text-align:right;font-weight:700">Sub Total</td>
          <td style="font-weight:800">${money(N.sub)}</td><td></td></tr>
      <tr><td colspan="3" style="text-align:right;font-weight:700">IVA ${Number(c.iva)}%</td>
          <td style="font-weight:800">${money(N.imp)}</td><td></td></tr>
      <tr><td colspan="3" style="text-align:right;font-weight:900;font-size:15px">TOTAL</td>
          <td style="font-weight:900;font-size:15px;color:var(--navy)">${money(N.total)}</td><td></td></tr>
    </tfoot></table></div>
    <p class="hint" style="margin-top:8px">El unitario se muestra sin IVA, como el formato de siempre.
      El <b>TOTAL</b> es exactamente lo que costaría pedir eso mismo por el menú.</p>`;
  }
  h += `</div>`;

  /* ---- textos ---- */
  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px;margin-bottom:8px">4. Textos</div>
    <label>Saludo (arriba de la tabla)
      <textarea id="cotSaludo" maxlength="400" style="min-height:64px">${esc(c.saludo||'')}</textarea></label>
    <label style="margin-top:10px;display:block">Cierre (abajo de la tabla)
      <textarea id="cotCierre" maxlength="400" style="min-height:56px">${esc(c.cierre||'')}</textarea></label>
    <label style="margin-top:10px;display:block">Notas internas (no salen en el PDF)
      <textarea id="cotNotas" maxlength="400" style="min-height:44px">${esc(c.notas||'')}</textarea></label>
  </div>`;

  h += `<button class="btn-primary" id="cotGuardar" style="width:100%">
    ${c.id ? 'Actualizar cotización' : 'Guardar cotización'}</button>
  <button class="btn-quiet" id="cotPdf" style="width:100%;margin-top:8px">📄 Descargar / enviar PDF</button>
  ${c.id?`<button class="btn-quiet" id="cotBorrar" style="width:100%;margin-top:8px;color:var(--red)">Borrar esta cotización</button>`:''}
  <p class="hint" style="margin-top:8px">Sucursal en el pie del PDF: <b>${esc(suc.nombre)}</b> · ${esc(suc.tel)}</p>`;
  return h;
}

function cotView(){
  return cotEdit ? cotEditorView() : cotListaView();
}

/* ---------- el PDF, con el formato de siempre ---------- */
async function cotPDF(){
  await loadPDF();
  const JS = (window.jspdf || {}).jsPDF;
  if(!JS){ toast('No se pudo cargar el generador de PDF'); return; }
  const c = cotEdit, N = cotCuentas(c);
  const suc = COT_SUC[c.sucursal] || COT_SUC.guaymas;

  const n2 = v => Number(v||0).toLocaleString('es-MX',{minimumFractionDigits:2, maximumFractionDigits:2});
  const pesos = v => '$' + n2(v);
  const TINTA=[29,27,22], SUAVE=[110,103,92], LINEA=[221,215,201], NAVY=[27,46,77];

  const doc = new JS({unit:'pt', format:'letter'});
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 54;
  let y = 64;

  doc.setFont('helvetica','bold').setFontSize(17).setTextColor(...NAVY);
  doc.text("BOYE'S BURGERS & PIZZA", M, y);
  doc.setFont('helvetica','normal').setFontSize(9).setTextColor(...SUAVE);
  doc.text('Cotización', W-M, y-10, {align:'right'});
  doc.setFont('helvetica','bold').setFontSize(10).setTextColor(...TINTA);
  doc.text(c.folio || 'Nueva', W-M, y+2, {align:'right'});
  y += 12;
  doc.setDrawColor(...NAVY).setLineWidth(1.4); doc.line(M, y, W-M, y);
  y += 22;

  /* Encabezado a dos lados, como el formato original. */
  doc.setFont('helvetica','normal').setFontSize(9).setTextColor(...SUAVE);
  doc.text('Cotización a:', M, y);
  doc.text('Fecha:', W-M-120, y);
  y += 14;
  doc.setFont('helvetica','bold').setFontSize(11.5).setTextColor(...TINTA);
  doc.text(c.cliente || '(sin cliente)', M, y);
  const f = new Date(c.fecha + 'T12:00:00');
  doc.text(f.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'}), W-M-120, y);
  y += 14;
  doc.setFont('helvetica','normal').setFontSize(9).setTextColor(...SUAVE);
  doc.text(suc.dir[suc.dir.length-1], W-M-120, y);
  y += 22;

  if((c.saludo||'').trim()){
    doc.setFont('helvetica','normal').setFontSize(9.5).setTextColor(...TINTA);
    for(const l of doc.splitTextToSize(c.saludo.trim(), W-2*M)){ doc.text(l, M, y); y += 12; }
    y += 10;
  }

  /* Tabla */
  const cols = [
    {t:'Código', w:64,  a:'left'},
    {t:'Platillo', w:0, a:'left'},
    {t:'Cantidad', w:70, a:'center'},
    {t:'Precio Unitario', w:96, a:'right'}
  ];
  cols[1].w = (W-2*M) - cols[0].w - cols[2].w - cols[3].w;

  doc.setDrawColor(...LINEA).setLineWidth(.6);
  doc.setFont('helvetica','bold').setFontSize(8.5).setTextColor(...SUAVE);
  let x = M;
  cols.forEach(col=>{
    const px = col.a==='right' ? x+col.w : col.a==='center' ? x+col.w/2 : x;
    doc.text(col.t, px, y, {align: col.a==='left'?'left':col.a});
    x += col.w;
  });
  y += 5; doc.line(M, y, W-M, y); y += 16;

  const salto = () => { if(y > H-150){ doc.addPage(); y = 64; } };
  for(const r of c.renglones){
    salto();
    const unit = cotUnit(r, N.factor);
    let x2 = M;
    doc.setFont('helvetica','normal').setFontSize(10).setTextColor(...TINTA);
    doc.text(String(r.codigo||''), x2+1, y); x2 += cols[0].w;
    for(const l of doc.splitTextToSize(String(r.nombre||''), cols[1].w-6).slice(0,1))
      doc.text(l, x2, y);
    x2 += cols[1].w;
    doc.text(String(r.cant||0), x2+cols[2].w/2, y, {align:'center'}); x2 += cols[2].w;
    doc.setFont('helvetica','bold');
    doc.text(pesos(unit), x2+cols[3].w, y, {align:'right'});
    y += 9; doc.setDrawColor(...LINEA).setLineWidth(.4); doc.line(M, y, W-M, y); y += 15;
  }

  /* Totales pegados a la derecha, como el original. */
  y += 6; salto();
  const xEt = W - M - 96 - 90, xNum = W - M;
  const totLinea = (et, val, fuerte) => {
    doc.setFont('helvetica','bold').setFontSize(fuerte?12:10);
    doc.setTextColor(...(fuerte?NAVY:SUAVE));
    doc.text(et, xEt + 80, y, {align:'right'});
    doc.setTextColor(...(fuerte?NAVY:TINTA));
    doc.text(pesos(val), xNum, y, {align:'right'});
    y += fuerte ? 20 : 16;
  };
  totLinea('Sub Total', N.sub);
  totLinea(`IVA ${Number(c.iva)}%`, N.imp);
  doc.setDrawColor(...NAVY).setLineWidth(1);
  doc.line(xEt, y-11, W-M, y-11); y += 4;
  totLinea('TOTAL', N.total, true);

  if((c.cierre||'').trim()){
    y += 10; salto();
    doc.setFont('helvetica','normal').setFontSize(9).setTextColor(...SUAVE);
    for(const l of doc.splitTextToSize(c.cierre.trim(), W-2*M)){ doc.text(l, M, y); y += 11; }
  }

  /* Pie con las dos sucursales, como el formato que ya usan. */
  const yPie = H - 92;
  doc.setDrawColor(...LINEA).setLineWidth(.6); doc.line(M, yPie-14, W-M, yPie-14);
  const pieSuc = (s, x0, alin) => {
    doc.setFont('helvetica','bold').setFontSize(9).setTextColor(...NAVY);
    doc.text(s.nombre, x0, yPie, {align:alin});
    doc.setFont('helvetica','normal').setFontSize(8).setTextColor(...SUAVE);
    let yy = yPie + 11;
    doc.text(s.tel, x0, yy, {align:alin}); yy += 10;
    for(const l of s.dir){ doc.text(l, x0, yy, {align:alin}); yy += 9; }
  };
  pieSuc(COT_SUC.guaymas, M + 40, 'left');
  pieSuc(COT_SUC.sancarlos, W - M - 40, 'right');
  doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(...SUAVE);
  doc.text('boyesburger.com', W/2, H-24, {align:'center'});

  const nombre = `Cotizacion ${(c.cliente||'Boyes').replace(/[^\w\s-]/g,'').trim().slice(0,40)} ${c.fecha}.pdf`;
  try{
    const blob = doc.output('blob');
    const archivo = new File([blob], nombre, {type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[archivo]})){
      await navigator.share({files:[archivo], title:nombre});
      return;
    }
  }catch(e){ /* si cancela el compartir, se descarga abajo */ }
  doc.save(nombre);
}

/* ---------- cableado ---------- */
function wireCot(){
  $('#cotNueva')?.addEventListener('click', ()=>{ cotEdit = cotNuevo(); cotJalaMenu(); render(); });
  $('#cotVolver')?.addEventListener('click', ()=>{ cotEdit = null; render(); });
  $('#cotMenuRetry')?.addEventListener('click', ()=>{ cotMenu=null; cotMenuErr=null; cotJalaMenu(); });

  $('#main').querySelectorAll('[data-cotabre]').forEach(b=>b.addEventListener('click', async ()=>{
    try{
      const d = await finRpc('cot_get', {p_id: b.dataset.cotabre});
      cotEdit = { id:d.id, folio:d.folio, cliente:d.cliente||'', fecha:String(d.fecha).slice(0,10),
                  sucursal:d.sucursal||'guaymas', saludo:d.saludo||'', cierre:d.cierre||'',
                  notas:d.notas||'', iva:Number(d.iva||16), renglones:d.renglones||[] };
      cotJalaMenu(); render();
    }catch(e){ toast('No se pudo abrir: '+(e.message||'')); }
  }));

  /* Los campos de arriba se guardan en memoria al cambiar, sin repintar:
     repintar mientras alguien escribe le quita el cursor de la casilla. */
  const liga = (id, campo) => $('#'+id)?.addEventListener('change', e=>{
    if(!cotEdit) return;
    cotEdit[campo] = e.target.value;
    if(campo === 'sucursal') render();
  });
  liga('cotCliente','cliente'); liga('cotFecha','fecha'); liga('cotSuc','sucursal');
  liga('cotSaludo','saludo'); liga('cotCierre','cierre'); liga('cotNotas','notas');

  $('#cotBusca')?.addEventListener('input', e=>{
    cotBusca = e.target.value;
    /* Se repinta solo la lista de productos para no perder el cursor. */
    const foco = document.activeElement === e.target;
    render();
    if(foco){ const n = $('#cotBusca'); if(n){ n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
  });
  $('#cotCat')?.addEventListener('change', e=>{ cotCat = e.target.value; render(); });

  $('#main').querySelectorAll('[data-cotadd]').forEach(b=>b.addEventListener('click', ()=>{
    const p = (cotMenu?.productos||[]).find(x=>x.id === b.dataset.cotadd);
    if(!p || !cotEdit) return;
    /* Si ya está, se suma uno en vez de repetir el renglón: es lo que espera
       quien va picando «agregar» varias veces. */
    const ya = cotEdit.renglones.find(r => r.id === p.id);
    if(ya) ya.cant = Number(ya.cant||0) + 1;
    else cotEdit.renglones.push({ id:p.id, codigo:'', nombre:p.nombre, cant:1, precio:p.precio });
    render();
  }));

  $('#cotLibre')?.addEventListener('click', ()=>{
    if(!cotEdit) return;
    cotEdit.renglones.push({ id:null, codigo:'', nombre:'', cant:1, precio:0 });
    render();
  });

  $('#main').querySelectorAll('[data-cotr]').forEach(inp=>inp.addEventListener('change', ()=>{
    if(!cotEdit) return;
    const ix = Number(inp.dataset.cotr), campo = inp.dataset.cotf;
    const r = cotEdit.renglones[ix]; if(!r) return;
    if(campo === 'cant'){
      const v = numMX(inp.value);
      r.cant = v > 0 ? v : 1;
    } else r[campo] = inp.value;
    render();
  }));

  $('#main').querySelectorAll('[data-cotdel]').forEach(b=>b.addEventListener('click', ()=>{
    if(!cotEdit) return;
    cotEdit.renglones.splice(Number(b.dataset.cotdel), 1);
    render();
  }));

  $('#cotGuardar')?.addEventListener('click', async ev=>{
    if(!cotEdit) return;
    if(!cotEdit.cliente.trim()){ toast('Ponle el nombre del cliente'); $('#cotCliente')?.focus(); return; }
    if(!cotEdit.renglones.length){ toast('La cotización no tiene ningún renglón'); return; }
    const b = ev.currentTarget, etq = b.textContent;
    b.disabled = true; b.textContent = 'Guardando…';
    try{
      const N = cotCuentas(cotEdit);
      const d = await finRpc('cot_save', { p_id: cotEdit.id, p: {
        cliente: cotEdit.cliente, fecha: cotEdit.fecha, sucursal: cotEdit.sucursal,
        saludo: cotEdit.saludo, cierre: cotEdit.cierre, notas: cotEdit.notas,
        renglones: cotEdit.renglones, iva: cotEdit.iva, total: N.total } });
      cotEdit.id = d.id; cotEdit.folio = d.folio;
      cotLista = null; cotRefresca();
      toast('Cotización guardada ✓ ' + (d.folio||''));
    }catch(e){ toast('No se pudo guardar: '+(e.message||'')); }
    finally{ b.disabled = false; b.textContent = etq; }
  });

  $('#cotPdf')?.addEventListener('click', async ev=>{
    const b = ev.currentTarget, etq = b.textContent;
    b.disabled = true; b.textContent = 'Armando el PDF…';
    try{ await cotPDF(); }
    catch(e){ toast('No se pudo generar el PDF'); }
    finally{ b.disabled = false; b.textContent = etq; }
  });

  $('#cotBorrar')?.addEventListener('click', async ()=>{
    if(!cotEdit?.id) return;
    if(!confirm(`¿Borrar la cotización ${cotEdit.folio||''} de ${cotEdit.cliente}?\n\nNo se puede deshacer.`)) return;
    try{
      await finRpc('cot_del', {p_id: cotEdit.id});
      cotEdit = null; cotLista = null; cotRefresca();
      toast('Cotización borrada');
    }catch(e){ toast('No se pudo borrar'); }
  });
}
