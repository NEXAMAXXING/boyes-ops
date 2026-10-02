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
let cotMenuSuc = null;      // de qué sucursal es el menú cargado
let cotModPara = null;      // índice del renglón al que se le está agregando un cambio

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
  saludo: COT_SALUDO, cierre: COT_CIERRE, notas: '', lugar: '', iva: 16, renglones: []
});

/* ---------- datos ---------- */
async function cotRefresca(){
  cotCargando = true; render();
  try{ cotLista = await finRpc('cot_list', {}) || []; }
  catch(e){ cotLista = []; toast('No se pudieron cargar las cotizaciones'); }
  cotCargando = false; render();
}

/* El catálogo sale del punto de venta (Soft Restaurant) de la sucursal de
   la cotización: es lo que cobra la caja hoy, con su precio. Si Soft no
   contesta, se cae al menú del sitio web para no dejar el buscador vacío. */
const COT_ESPECIAL = /DAY|PROMO|HAPPY|MAQUILA|^BOYES$|BONELESS LAB|VICIO|DOMICILIO|VINOFEST|EVENTO|FRANQUICIA/i;
async function cotJalaMenu(){
  const suc = cotEdit?.sucursal || 'guaymas';
  if(cotMenu && cotMenuSuc === suc) return cotMenu;
  cotMenu = null; cotMenuErr = null; render();
  try{
    const r = await fetch(`/api/soft-ventas?modo=productos&sucursal=${suc}&token=${encodeURIComponent(user.token)}`,
                          {cache:'no-store'});
    const j = await r.json();
    if(j.error) throw new Error(j.error);
    const prods = (j.productos||[])
      .filter(p => p.activo !== false && p.nombre)
      .map(p => ({ id: 'soft:'+(p.id||p.clave||p.nombre), clave: p.clave || '', nombre: String(p.nombre).trim(),
                   categoria: String(p.categoria||'').trim(), cat: String(p.categoria||'').trim(),
                   precio: p.precio === null || p.precio === undefined ? null : Number(p.precio) }));
    /* Los grupos de promoción o temporada van al final: el precio que se
       cotiza es el del menú normal, no el de un 2x1 de jueves. */
    prods.forEach(p => { p.especial = COT_ESPECIAL.test(p.cat); });
    prods.sort((a,b) => (a.especial - b.especial) || a.cat.localeCompare(b.cat) || a.nombre.localeCompare(b.nombre));
    const cats = [...new Set(prods.map(p=>p.cat).filter(Boolean))]
      .map(c => ({ id:c, nombre: COT_ESPECIAL.test(c) ? c + ' (promo / especial)' : c }));
    cotMenu = { total: prods.length, productos: prods, categorias: cats, fuente: 'Soft Restaurant' };
  }catch(e){
    try{
      const r = await fetch('/api/menu-web', {cache:'no-store'});
      const j = await r.json();
      if(j.error) throw new Error(j.error);
      cotMenu = { ...j, fuente: 'boyesburger.com' };
      cotMenuErr = null;
    }catch(e2){
      cotMenu = null;
      cotMenuErr = (e.message || 'el punto de venta no contestó');
    }
  }
  cotMenuSuc = suc;
  render();
  return cotMenu;
}

/* Búsqueda sin acentos ni mayúsculas, palabra por palabra: "classic"
   encuentra CLASSIC BURGER y "papas saz" encuentra CAMBIO A PAPAS SAZONADAS. */
const cotNorm = t => String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function cotCoincide(p, q){
  const palabras = cotNorm(q).split(/\s+/).filter(Boolean);
  if(!palabras.length) return true;
  const n = cotNorm(p.nombre + ' ' + (p.categoria||''));
  return palabras.every(w => n.includes(w));
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
    <label style="display:block;margin-top:10px">Dirección del lugar <span class="hint">(opcional, sale abajo del cliente)</span>
      <input type="text" id="cotLugar" maxlength="120" value="${esc(c.lugar||'')}" placeholder="Dónde es el evento"></label>
  </div>`;

  /* ---- el buscador de productos ---- */
  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px;margin-bottom:4px">2. Agregar del menú</div>
    <p class="hint" style="margin:0 0 10px">Precios en vivo del punto de venta de la sucursal.
      ${cotMenu ? `<b>${cotMenu.total}</b> productos · ${esc(cotMenu.fuente||'')}` : ''}</p>`;
  if(cotModPara !== null && c.renglones[cotModPara]){
    h += `<div style="padding:10px 12px;border-radius:10px;background:#E8EEF7;border-left:4px solid var(--navy);margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">Agregando un <b>cambio o extra</b> a:
        <b>${esc(c.renglones[cotModPara].nombre)}</b>. Busca el cambio (ej. «sazonadas») y dale Agregar.</div>
      <button class="btn-quiet" id="cotModCancel">Cancelar</button></div>`;
  }

  if(cotMenuErr){
    h += `<div style="padding:10px 12px;border-radius:10px;background:#FFF3D6;border-left:4px solid var(--warn)">
      <b>No pude leer el catálogo del punto de venta.</b>
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

    const lista = (cotMenu.productos||[]).filter(p =>
      (!cotCat || p.cat === cotCat) && cotCoincide(p, cotBusca));

    h += `<div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:10px">`;
    if(!lista.length) h += `<p class="hint" style="padding:14px">Nada con ese nombre.</p>`;
    for(const p of lista.slice(0,120)){
      h += `<div style="display:flex;align-items:center;gap:10px;padding:8px 11px;border-bottom:1px solid var(--line)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${esc(p.nombre)}</div>
          <div class="hint" style="font-size:11.5px">${esc(p.categoria||'')}${p.especial?' · <b style="color:var(--warn)">promo / especial</b>':''}</div>
        </div>
        <div style="font-weight:800;font-variant-numeric:tabular-nums">${p.precio===null?'<span class="hint">sin precio</span>':money(p.precio)}</div>
        <button class="rowbtn" data-cotadd="${esc(p.id)}">${cotModPara!==null?'+ Al renglón':'Agregar'}</button>
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
          value="${esc(r.nombre||'')}" style="width:100%;min-height:38px">
          ${(r.mods||[]).length?`<div class="hint" style="font-size:11.5px;margin-top:3px">${r.mods.map(m=>`+ ${esc(m.nombre)} (${money(m.precio)})`).join(' · ')}
            <button class="rowbtn" data-cotmodquita="${ix}" style="font-size:11px;padding:2px 6px">quitar cambios</button></div>`:''}
          <button class="rowbtn" data-cotmod="${ix}" style="font-size:11.5px;margin-top:4px">+ cambio / extra</button></td>
        <td><input type="text" inputmode="decimal" class="nospin" data-cotr="${ix}" data-cotf="cant"
          value="${esc(String(r.cant||1))}" style="width:72px;min-height:38px;text-align:right"></td>
        <td style="font-variant-numeric:tabular-nums">${r.id ? money(unit)
          : `<input type="text" inputmode="decimal" class="nospin" data-cotr="${ix}" data-cotf="unit"
              value="${unit ? esc(String(unit)) : ''}" placeholder="0.00" style="width:90px;min-height:38px;text-align:right">`}</td>
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
/* El PDF va sobre el membrete de Boye's (img/cot-fondo.jpg): papel, logo,
   franja roja y pie con las dos sucursales ya vienen en la imagen. Aquí solo
   se escribe encima lo que cambia: cliente, fecha, tabla y totales, con la
   misma letra del diseño (DM Sans) y la misma tabla azul. */
const cotRecurso = {};
async function cotBase64(url){
  if(cotRecurso[url]) return cotRecurso[url];
  const buf = await fetch(url).then(r => { if(!r.ok) throw new Error(url); return r.arrayBuffer(); });
  let bin = ''; const u = new Uint8Array(buf);
  for(let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return (cotRecurso[url] = btoa(bin));
}

async function cotPDF(){
  await loadPDF();
  const JS = (window.jspdf || {}).jsPDF;
  if(!JS){ toast('No se pudo cargar el generador de PDF'); return; }
  const c = cotEdit, N = cotCuentas(c);
  const suc = COT_SUC[c.sucursal] || COT_SUC.guaymas;

  const n2 = v => Number(v||0).toLocaleString('es-MX',{minimumFractionDigits:2, maximumFractionDigits:2});
  const pesos = v => '$' + n2(v);
  const TINTA=[29,29,27], NAVY=[22,58,96], BLANCO=[255,255,255], NEGRO=[0,0,0];

  const doc = new JS({unit:'pt', format:'letter'});
  const W = doc.internal.pageSize.getWidth();   // 612
  const H = doc.internal.pageSize.getHeight();  // 792

  let fondo = null, F = 'helvetica';
  try{
    fondo = 'data:image/jpeg;base64,' + await cotBase64('/img/cot-fondo.jpg');
    doc.addFileToVFS('DMSans-Regular.ttf', await cotBase64('/img/dmsans-400.ttf'));
    doc.addFont('DMSans-Regular.ttf', 'DMSans', 'normal');
    doc.addFileToVFS('DMSans-Bold.ttf', await cotBase64('/img/dmsans-700.ttf'));
    doc.addFont('DMSans-Bold.ttf', 'DMSans', 'bold');
    F = 'DMSans';
  }catch(e){ /* sin membrete o sin letra: el PDF sale igual, más sencillo */ }
  const hoja = () => { if(fondo) doc.addImage(fondo, 'JPEG', 0, 0, W, H, 'fondo', 'FAST'); };
  hoja();

  /* Medidas del diseño original (en puntos, desde arriba). */
  const X0 = 82.5, X1 = 529.2;                 // bordes de la tabla
  const CX = [X0, 147.9, 387.3, 456.1, X1];     // divisiones de columna
  const LIMITE = 615;                            // donde empieza el pie azul

  /* ---- encabezado: para quién y cuándo ---- */
  doc.setFont(F,'bold').setFontSize(12).setTextColor(...NAVY);
  doc.text('Cotización a:', X0, 160);
  doc.text('Fecha:', 422.4, 160);
  doc.setFont(F,'normal').setFontSize(12).setTextColor(...NEGRO);
  doc.text(doc.splitTextToSize(c.cliente || '(sin cliente)', 280)[0], X0, 176);
  const f = new Date(c.fecha + 'T12:00:00');
  const fechaTxt = f.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'})
    .replace(/ de (\w)/, (m, l) => ' de ' + l.toUpperCase());
  doc.text(fechaTxt, 422.4, 176);
  if((c.lugar||'').trim()){
    let yl = 205;
    for(const l of doc.splitTextToSize(c.lugar.trim(), 280).slice(0,2)){ doc.text(l, X0, yl); yl += 14; }
  }
  doc.text(c.sucursal === 'sancarlos' ? 'San Carlos, Son.' : 'Guaymas, Son.', X1, 205, {align:'right'});

  let y = 232;
  if((c.saludo||'').trim()){
    doc.setFont(F,'normal').setFontSize(9.5).setTextColor(...TINTA);
    for(const l of doc.splitTextToSize(c.saludo.trim(), X1 - X0).slice(0,3)){ doc.text(l, X0, y); y += 12; }
    y += 8;
  }
  y = Math.max(y, 248);

  /* ---- la tabla ---- */
  const ALTO_CAB = 35.6;
  const cabecera = () => {
    doc.setFillColor(...NAVY).setDrawColor(...NEGRO).setLineWidth(.5);
    doc.rect(X0, y, X1 - X0, ALTO_CAB, 'FD');
    doc.setFont(F,'bold').setFontSize(11).setTextColor(...BLANCO);
    const mid = y + ALTO_CAB/2 + 4;
    doc.text('Código', (CX[0]+CX[1])/2, mid, {align:'center'});
    doc.text('Platillo', (CX[1]+CX[2])/2, mid, {align:'center'});
    doc.text('Cantidad', (CX[2]+CX[3])/2, mid, {align:'center'});
    doc.text('Precio', (CX[3]+CX[4])/2, mid - 6, {align:'center'});
    doc.text('Unitario', (CX[3]+CX[4])/2, mid + 6, {align:'center'});
    for(let i = 1; i < 4; i++) doc.line(CX[i], y, CX[i], y + ALTO_CAB);
    y += ALTO_CAB;
  };
  cabecera();

  /* Alto de renglón: el del diseño (35) si caben; si no, se aprieta hasta
     24 y, si aun así no caben, la tabla sigue en otra hoja. */
  const ALTO_TOT = 72;
  const n = Math.max(1, c.renglones.length);
  const RH = Math.max(24, Math.min(35.3, (LIMITE - ALTO_TOT - y) / n));

  let inicioCuerpo = y;
  const cierraCuerpo = () => {
    doc.setDrawColor(...NEGRO).setLineWidth(.5);
    for(let i = 1; i < 4; i++) doc.line(CX[i], inicioCuerpo, CX[i], y);
    doc.line(X0, inicioCuerpo, X0, y); doc.line(X1, inicioCuerpo, X1, y);
  };
  for(const r of c.renglones){
    if(y + RH > LIMITE){
      cierraCuerpo(); doc.addPage(); hoja(); y = 150; cabecera(); inicioCuerpo = y;
    }
    const unit = cotUnit(r, N.factor);
    const base = y + RH/2 + 4;
    doc.setFont(F,'normal').setFontSize(10.5).setTextColor(...TINTA);
    if(r.codigo) doc.text(String(r.codigo), (CX[0]+CX[1])/2, base, {align:'center'});
    /* El nombre va en un renglón: si no cabe se achica la letra (hasta 8) y,
       solo si ni así cabe, se parte en dos líneas más chicas. */
    const ancho = CX[2] - CX[1] - 16, txt = String(r.nombre||'');
    let fs = 10.5;
    while(fs > 8 && doc.setFontSize(fs).getTextWidth(txt) > ancho) fs -= 0.5;
    if(doc.getTextWidth(txt) <= ancho){
      doc.text(txt, CX[1] + 9, base);
    } else {
      doc.setFontSize(8.5);
      const ls = doc.splitTextToSize(txt, ancho).slice(0,2);
      doc.text(ls, CX[1] + 9, base - 5);
    }
    doc.setFontSize(10.5);
    doc.text(String(r.cant||0), (CX[2]+CX[3])/2, base, {align:'center'});
    doc.text(pesos(unit), CX[3] + 9, base);
    y += RH;
    doc.setDrawColor(...NEGRO).setLineWidth(.5); doc.line(X0, y, X1, y);
  }
  cierraCuerpo();

  /* ---- totales, dentro del mismo recuadro ---- */
  if(y + ALTO_TOT > LIMITE){ doc.addPage(); hoja(); y = 150; }
  const yT = y;
  let yy = y + 22;
  const tot = (et, val, fuerte) => {
    doc.setFont(F, fuerte ? 'bold' : 'normal').setFontSize(11.5).setTextColor(...TINTA);
    doc.text(et, CX[3] - 12, yy, {align:'right'});
    doc.text(pesos(val), CX[3] + 9, yy);
    yy += 16.5;
  };
  tot('Sub Total', N.sub);
  tot('IVA', N.imp);
  tot('TOTAL', N.total, true);
  y = yT + ALTO_TOT;
  doc.setDrawColor(...NEGRO).setLineWidth(.5);
  doc.line(X0, yT, X0, y); doc.line(X1, yT, X1, y); doc.line(X0, y, X1, y);

  if((c.cierre||'').trim() && y + 30 < LIMITE){
    y += 18;
    doc.setFont(F,'normal').setFontSize(9).setTextColor(...TINTA);
    for(const l of doc.splitTextToSize(c.cierre.trim(), X1 - X0).slice(0,3)){ doc.text(l, X0, y); y += 11; }
  }

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
  $('#cotVolver')?.addEventListener('click', ()=>{ cotEdit = null; cotModPara = null; render(); });
  $('#cotMenuRetry')?.addEventListener('click', ()=>{ cotMenu=null; cotMenuErr=null; cotJalaMenu(); });

  $('#main').querySelectorAll('[data-cotabre]').forEach(b=>b.addEventListener('click', async ()=>{
    try{
      const d = await finRpc('cot_get', {p_id: b.dataset.cotabre});
      cotEdit = { id:d.id, folio:d.folio, cliente:d.cliente||'', fecha:String(d.fecha).slice(0,10),
                  sucursal:d.sucursal||'guaymas', saludo:d.saludo||'', cierre:d.cierre||'',
                  notas:d.notas||'', lugar:d.lugar||'', iva:Number(d.iva||16), renglones:d.renglones||[] };
      cotJalaMenu(); render();
    }catch(e){ toast('No se pudo abrir: '+(e.message||'')); }
  }));

  /* Los campos de arriba se guardan en memoria al cambiar, sin repintar:
     repintar mientras alguien escribe le quita el cursor de la casilla. */
  const liga = (id, campo) => $('#'+id)?.addEventListener('change', e=>{
    if(!cotEdit) return;
    cotEdit[campo] = e.target.value;
    if(campo === 'sucursal'){ cotJalaMenu(); render(); }
  });
  liga('cotCliente','cliente'); liga('cotFecha','fecha'); liga('cotSuc','sucursal');
  liga('cotLugar','lugar'); liga('cotSaludo','saludo'); liga('cotCierre','cierre'); liga('cotNotas','notas');

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
    /* Modo «cambio»: lo elegido se le suma al renglón marcado (Bembos + cambio
       a papas sazonadas) en vez de ir como renglón aparte. */
    if(cotModPara !== null && cotEdit.renglones[cotModPara]){
      const r = cotEdit.renglones[cotModPara];
      r.mods = r.mods || [];
      if(r.base === undefined) r.base = { nombre: r.nombre, precio: Number(r.precio||0) };
      r.mods.push({ nombre: p.nombre, precio: Number(p.precio||0) });
      r.precio = Math.round((r.base.precio + r.mods.reduce((s,m)=>s+m.precio,0))*100)/100;
      r.nombre = r.base.nombre + ' (' + r.mods.map(m=>m.nombre.toLowerCase()).join(', ') + ')';
      r.id = (r.id||'x') + '+' + p.id;
      cotModPara = null; cotBusca = '';
      render(); return;
    }
    /* Si ya está, se suma uno en vez de repetir el renglón: es lo que espera
       quien va picando «agregar» varias veces. */
    const ya = cotEdit.renglones.find(r => r.id === p.id);
    if(ya) ya.cant = Number(ya.cant||0) + 1;
    else cotEdit.renglones.push({ id:p.id, codigo:p.clave||'', nombre:p.nombre, cant:1, precio:Number(p.precio||0) });
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
    } else if(campo === 'unit'){
      /* Renglón a mano: se captura el unitario SIN IVA, como se imprime. */
      const f = 1 + Number(cotEdit.iva||0)/100;
      r.precio = Math.round(Math.max(0, numMX(inp.value)) * f * 100)/100;
    } else r[campo] = inp.value;
    render();
  }));

  $('#main').querySelectorAll('[data-cotmod]').forEach(b=>b.addEventListener('click', ()=>{
    cotModPara = Number(b.dataset.cotmod); cotBusca = ''; render();
    const n = $('#cotBusca'); if(n){ n.scrollIntoView({block:'center'}); n.focus(); }
  }));
  $('#main').querySelectorAll('[data-cotmodquita]').forEach(b=>b.addEventListener('click', ()=>{
    const r = cotEdit?.renglones[Number(b.dataset.cotmodquita)];
    if(r && r.base){ r.nombre = r.base.nombre; r.precio = r.base.precio; r.mods = []; delete r.base; r.id = String(r.id).split('+')[0]; }
    render();
  }));
  $('#cotModCancel')?.addEventListener('click', ()=>{ cotModPara = null; render(); });

  $('#main').querySelectorAll('[data-cotdel]').forEach(b=>b.addEventListener('click', ()=>{
    cotModPara = null;
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
        saludo: cotEdit.saludo, cierre: cotEdit.cierre, notas: cotEdit.notas, lugar: cotEdit.lugar||'',
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
