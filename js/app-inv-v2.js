
/* Si la consulta falla, antes se quedaba en "Cargando inventario…" para
   siempre y sin decir nada: se tragaba el error y ni siquiera volvía a pintar.
   Ahora se guarda el motivo y se muestra con un botón para reintentar. */
let invError = null, invCargando = false, invCargandoDesde = 0, invCorte = null;
async function refreshInvWeek(){
  /* El candado evita dos consultas al mismo tiempo, pero si una se queda
     colgada (red caída, pestaña dormida) antes bloqueaba la sección PARA
     SIEMPRE: "Cargando inventario…" y nada más. Ahora, pasados 20 s, se
     considera muerta y se deja pasar la nueva. */
  if(invCargando && (Date.now() - invCargandoDesde) < 20000) return;
  invCargando = true; invCargandoDesde = Date.now(); invError = null;
  try{
    /* El corte va en Promise.allSettled aparte: si no hay corte de esa semana
       —o falla— el inventario tiene que abrir igual. Es un árbitro, no un
       requisito. */
    const [wk, hist, cor] = await Promise.all([
      finRpc('inv_get_week', {p_week: dstr(invWeek), p_loc: finLoc}),
      finRpc('inv_list_weeks', {p_loc: finLoc}),
      finRpc('inv_corte_semana', {p_week: dstr(invWeek), p_loc: finLoc}).catch(()=>null)
    ]);
    invData = wk; invHist = hist||[]; invCorte = cor||null;
  }
  catch(e){
    console.error('inventario:', e);
    invData = null;
    invError = e?.message || String(e) || 'No se pudo cargar el inventario';
  }
  finally{ invCargando = false; }
  invEdit = {};
  render();
}
/* Captura de inventario: un solo escucha para toda la tabla.
   Antes se le colgaba un escucha a CADA casilla: con 259 insumos son más de
   mil, y se volvían a colocar todos cada vez que la pantalla se repintaba.
   Con un escucha en #main (que nunca se reemplaza) el costo es fijo y la
   tabla abre igual de rápido con 20 insumos que con 500. */
let _capturaInvLista = false, _recBuscaReloj = null;
let invVerTodos = false;   // la captura arranca mostrando solo lo que se cuenta
function instalaCapturaInventario(){
  if(_capturaInvLista) return;
  _capturaInvLista = true;
  $('#main').addEventListener('change', async ev=>{
    const inp = ev.target;
    if(!inp || !inp.dataset) return;

    if(inp.dataset.inv){
      const ed = invEdit[inp.dataset.inv];
      if(!ed) return;
      if(inp.dataset.if==='physical'){ ed.physical = inp.value==='' ? null : Number(inp.value); }
      else ed[inp.dataset.if] = Number(inp.value||0);
      return;
    }

    if(inp.dataset.invprice){
      const ing = catalog?.ingredients.find(i=>i.id===inp.dataset.invprice);
      if(!ing) return;
      const precio = Number(inp.value||0);
      /* ============================================================
         El precio va a LAS DOS SUCURSALES de un solo tecleo.
         ------------------------------------------------------------
         La carne se compra en el mismo Walmart para Guaymas y para
         San Carlos: es el mismo kilo al mismo precio. Pero el
         catálogo guarda un renglón por sucursal, así que antes había
         que teclear cada costo dos veces. Nadie hace eso dos veces
         bien: se hace una y la otra queda a medias, y entonces la
         merma de una sucursal vale dinero y la de la otra sale en
         cero sin que nadie sepa por qué.

         Si algún insumo de verdad cuesta distinto en cada plaza, se
         corrige con el candado de abajo y solo se toca esta. */
      try{
        if(invPrecioAmbas){
          const r = await finRpc('inv_precio_ambas', {p_name: ing.name, p_price: precio});
          /* Se refleja en la copia local de las DOS, no solo en la abierta:
             si no, al cambiar de sucursal el precio parecía no haberse
             guardado y alguien lo volvía a capturar. */
          for(const x of catalog.ingredients)
            if((x.name||'').trim().toUpperCase() === (ing.name||'').trim().toUpperCase()) x.price = precio;
          toast(`${ing.name}: ${money(precio)} — guardado en ${(r&&r.sucursales&&r.sucursales.length)||2} sucursales`);
        } else {
          await finRpc('inv_save_ingredient', {p_id: ing.id, p_loc: ing.location_id, p_name: ing.name, p_unit: ing.unit, p_price: precio});
          ing.price = precio;
          toast(`${ing.name}: ${money(precio)} — solo ${LOCS[ing.location_id]||'esta sucursal'}`);
        }
        guardaCatalogoLocal(catalog);
        render();
      }catch(e){ toast('No se guardó el precio: ' + (e.message||'')); }
    }
  });
}
/* Por defecto el precio se comparte: es lo que pasa el 95% de las veces. */
let invPrecioAmbas = true;

function invErrorView(msg){
  return `<div class="empty"><b>No se pudo cargar el inventario</b>
    <span style="display:block;margin:8px 0;font-size:13px;color:var(--red)">${esc(msg||invError||'Error desconocido')}</span>
    <button class="btn-quiet" id="invRetry" style="margin-top:10px">Reintentar</button></div>`;
}
async function ocrPDF(file){
  await loadTesseract();
  if(typeof Tesseract==='undefined') return null;
  try{
    const ab=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:new Uint8Array(ab)}).promise;
    let allText='';
    const worker=await Tesseract.createWorker(['spa','eng']);
    for(let p=1;p<=Math.min(pdf.numPages,15);p++){
      const page=await pdf.getPage(p);
      const vp=page.getViewport({scale:2.5});
      const canvas=document.createElement('canvas');
      canvas.width=vp.width; canvas.height=vp.height;
      await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
      const _pgTxt=(await worker.recognize(canvas.toDataURL('image/png'))).data.text;
      const _pgClean=_pgTxt.split('\n').filter(ln=>!/SoftRestaurant|Copyright National Soft/i.test(ln)).join('\n');
      allText+=_pgClean+'\n---PAGE---\n';
    }
    await worker.terminate();
    return allText;
  }catch(e){ console.error('ocrPDF:',e); return null; }
}
function parseSR(text){
  /* ================================================================
   PARSER UNIVERSAL — lee todos los formatos del SR y variantes.
   Detecta el tipo automáticamente y extrae productos.
   ================================================================ */
  const NM = s => parseFloat(String(s==null?'0':s).replace(/[$,\s]/g,''))||0;
  const clean = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines  = clean.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
  const SKIP   = /^(TOTAL|SUBTOTAL|COSTO TOTAL|CLASIFICACION|FORMA|IMPUESTO|SOFTRESTAURANT)/i;

  /* Los renglones de totales del reporte (744.000 $109,682.69 $114,612.00) se
     colaban como si fueran un producto y duplicaban la venta de la semana. */
  const NOMBRE_VALIDO = n => !!n && !/^[\d.,\s$%]+$/.test(n) && !SKIP.test(n);
  /* ---- lectura por columnas (reporte "Productos vendidos" del SR) ----
     Este reporte trae columnas de más (costo, venta-costo, precio de catálogo
     y venta total a precio de catálogo). Leyéndolo con expresiones regulares
     ancladas al final de la línea, el nombre se contaminaba con los números y
     el importe que se tomaba era el de catálogo, no el vendido de verdad.
     Aquí se parte la línea en tokens y se toman las columnas por posición:
     nombre · precio · cantidad vendida · venta total. */
  const ES_MONTO = t => /^\$[\d,]+\.?\d*$/.test(t);
  const ES_NUM   = t => /^[\d,]+\.?\d*$/.test(t);
  function tryRowTokens(l){
    const tk = l.split(/\s+/).filter(Boolean);
    if(tk.length < 4) return null;
    if(!/^\d[\w.]*$/.test(tk[0])) return null;          // clave del producto
    const iMonto = tk.findIndex(ES_MONTO);
    if(iMonto < 2) return null;                          // sin nombre → es un renglón de totales
    const name = tk.slice(1, iMonto).join(' ').trim();
    if(!name || ES_NUM(name) || SKIP.test(name)) return null;
    const price = NM(tk[iMonto]);
    const resto = tk.slice(iMonto+1);
    const iQty = resto.findIndex(ES_NUM);                // cantidad vendida: va sin $
    if(iQty < 0) return null;                            // formato escaneado → lo ve el lector viejo
    const qty = NM(resto[iQty]);
    const iTot = resto.slice(iQty+1).findIndex(ES_MONTO);
    const total = iTot >= 0 ? NM(resto[iQty+1+iTot]) : qty*price;
    /* Un modificador gratis (importe $0) sí se sirvió y sí consume insumos:
       basta con que la cantidad sea mayor a cero. */
    if(!(qty > 0) || !(total >= 0)) return null;
    return {code:tk[0], name:name.toUpperCase(), qty, price, total, _sk:0};
  }
  /* ---- parse one product row ---- */
  function tryRow(l, nxt){
    // A) code name qty $price $total
    let m=l.match(/^(\d[\w.]*?)\s+(.+?)\s+(\d[\d,]*\.?\d*)\s+\$(\d[\d,]*\.?\d*)\s+\$(\d[\d,]*\.?\d*)\s*$/);
    if(m&&!SKIP.test(m[2])&&NM(m[5])>0)
      return {code:m[1],name:m[2].trim().toUpperCase(),qty:NM(m[3]),price:NM(m[4]),total:NM(m[5]),_sk:0};
    // B) code name $price $total  (qty on next line — escaneado)
    m=l.match(/^(\d[\w.]*?)\s+(.+?)\s+\$(\d[\d,]*\.?\d*)\s+\$(\d[\d,]*\.?\d*)\s*$/);
    if(m&&!SKIP.test(m[2])&&NM(m[4])>0){
      let qty=0, sk=0;
      const _FOOT=/SoftRestaurant|Copyright|National|---PAGE---|^[=\-]{3}/i;
      if(nxt&&!_FOOT.test(nxt)){const q=nxt.match(/^([\d,]+\.?\d*)\s*$/);if(q){qty=NM(q[1]);sk=1;}}
      // If footer blocked the qty line, calculate it from total/price
      if(qty===0&&NM(m[3])>0&&NM(m[4])>0){
        const _calc=Math.round(NM(m[4])/NM(m[3])*100)/100;
        if(_calc>0&&(_calc===Math.round(_calc)||Math.abs(_calc*2-Math.round(_calc*2))<0.01)) qty=_calc;
      }
      // Fix OCR artifact: '2.00' read as '200' — recalculate from total/price if ratio is off
      if(qty>=100&&NM(m[3])>0&&NM(m[4])>0&&qty*NM(m[3])>NM(m[4])*3){
        qty=Math.round(NM(m[4])/NM(m[3])*100)/100;
      }
      return {code:m[1],name:m[2].trim().toUpperCase(),qty,price:NM(m[3]),total:NM(m[4]),_sk:sk};
    }
    // C) code name qty price total  (sin $)
    m=l.match(/^(\d[\w.]*?)\s+(.+?)\s+(\d[\d,]*\.?\d*)\s+(\d[\d,]*\.?\d*)\s+(\d[\d,]*\.?\d*)\s*$/);
    if(m&&!SKIP.test(m[2])&&NM(m[5])>0&&NM(m[3])<9999)
      return {code:m[1],name:m[2].trim().toUpperCase(),qty:NM(m[3]),price:NM(m[4]),total:NM(m[5]),_sk:0};
    return null;
  }

  /* ---- FORMATO CON GRUPO (A o B) ---- */
  const hasGrupo = lines.some(l=>/^GRUPO[:\s]/i.test(l));
  if(hasGrupo){
    const grupoRe=/^GRUPO[:\s]+(.+)$/i;
    let cat=null; const items=[]; let i=0;
    while(i<lines.length){
      const l=lines[i];
      if(l==='---PAGE---'){i++;continue;}
      const g=l.match(grupoRe);
      if(g){cat=g[1].trim().replace(/\s+/g,' ').toUpperCase();i++;continue;}
      if(/^[=\-_]{4,}|^SoftRestaurant/i.test(l)){i++;continue;}
      const row=tryRowTokens(l)||tryRow(l,lines[i+1]);
      if(row&&!NOMBRE_VALIDO(row.name)){i++;continue;}
      if(row){if(row._sk)i++;items.push({code:row.code,name:row.name,qty:row.qty,price:row.price,total:row.total,category:cat||'GENERAL'});}
      i++;
    }
    if(items.length>0){
      const fmt=lines.some(l=>/^GRUPO\s*:/i.test(l))?'SR Digital':'SR Escaneado';
      return {items,total:items.reduce((s,x)=>s+x.total,0),units:items.reduce((s,x)=>s+x.qty,0),format:fmt};
    }
  }

  /* ---- CORTE DE CAJA X ---- */
  if(lines.some(l=>/Corte de Caja/i.test(l))){
    const g=re=>{const m=clean.match(re);return m?NM(m[1]):null;};
    const vn=g(/VENTA\s*NETA\s*[:\s]+\$?([\d,]+\.?\d*)/i);
    const vi=g(/VENTAS?\s*CON\s*IMP\.?\s*:?\s*\$?([\d,]+\.?\d*)/i);
    if(vn||vi){
      const items=[];
      const ali=g(/ALIMENTOS\s*:\s*\$?([\d,]+\.?\d*)/i);
      const beb=g(/BEBIDAS\s*:\s*\$?([\d,]+\.?\d*)/i);
      const otr=g(/OTROS\s*:\s*\$?([\d,]+\.?\d*)/i);
      if(ali)items.push({code:'ALI',name:'ALIMENTOS',qty:1,price:ali,total:ali,category:'ALIMENTOS'});
      if(beb)items.push({code:'BEB',name:'BEBIDAS',qty:1,price:beb,total:beb,category:'BEBIDAS'});
      if(otr&&otr>0)items.push({code:'OTR',name:'OTROS',qty:1,price:otr,total:otr,category:'OTROS'});
      return {items,total:vn||vi||0,units:items.length,format:'Corte de Caja X',
        warning:'Este es un Corte de Caja — solo tiene totales por categor\u00eda. Para productos individuales usa el Reporte de Ventas del SR. Puedes usar este archivo en la pesta\u00f1a Corte.'};
    }
  }

  /* ---- CSV / EXCEL ---- */
  const csvHdr=lines.findIndex(l=>/(nombre|descripci[oó]n|producto).*(cantidad|cant|qty)/i.test(l));
  if(csvHdr>=0){
    const sep=lines[csvHdr].includes('\t')?'\t':',';
    const h=lines[csvHdr].split(sep).map(x=>x.trim().toLowerCase());
    const iN=h.findIndex(x=>/(nombre|descripci|producto|item)/i.test(x));
    const iQ=h.findIndex(x=>/(cantidad|cant|qty|piezas)/i.test(x));
    const iP=h.findIndex(x=>/(precio|price|unitario)/i.test(x));
    const iT=h.findIndex(x=>/(total|importe|venta)/i.test(x));
    const iC=h.findIndex(x=>/(grupo|categoria)/i.test(x));
    if(iN>=0&&iQ>=0){
      const items=[];
      for(let i=csvHdr+1;i<lines.length;i++){
        const c=lines[i].split(sep).map(x=>x.trim().replace(/"/g,''));
        if(!c[iN]||/total/i.test(c[iN]))continue;
        const qty=NM(c[iQ]),price=iP>=0?NM(c[iP]):0,total=iT>=0?NM(c[iT]):qty*price;
        if(qty>0)items.push({code:'',name:c[iN].toUpperCase(),qty,price,total,category:iC>=0?c[iC].toUpperCase():'GENERAL'});
      }
      if(items.length)return{items,total:items.reduce((s,x)=>s+x.total,0),units:items.reduce((s,x)=>s+x.qty,0),format:'Excel/CSV'};
    }
  }

  /* ---- SR SIN GRUPO (filas con código + números) ---- */
  if(lines.some(l=>/^\d[\w.]*\s+.+\s+[$\d]/.test(l))){
    let cat='GENERAL'; const items=[]; let i=0;
    while(i<lines.length){
      const l=lines[i];
      if(/^[A-Z\u00C0-\u00FF][A-Z\u00C0-\u00FF\s&]{3,}$/.test(l)&&!/TOTAL|IMPUESTO|VENTA|FOLIO|FECHA/i.test(l))cat=l;
      const row=tryRowTokens(l)||tryRow(l,lines[i+1]);
      if(row&&!NOMBRE_VALIDO(row.name)){i++;continue;}
      if(row){if(row._sk)i++;items.push({code:row.code,name:row.name,qty:row.qty,price:row.price,total:row.total,category:cat});}
      i++;
    }
    if(items.length>=3)return{items,total:items.reduce((s,x)=>s+x.total,0),units:items.reduce((s,x)=>s+x.qty,0),format:'SR Alternativo'};
  }

  /* ---- LISTA SIMPLE nombre: cantidad ---- */
  {
    const items=[]; let cat='GENERAL';
    for(const l of lines){
      if(/^[A-Z\u00C0-\u00FF][A-Z\u00C0-\u00FF\s]{3,}$/.test(l))cat=l;
      const m=l.match(/^(.{3,}?)[:\-\u2013]\s*(\d[\d,]*\.?\d*)\s*(?:pzas?|pcs?|kg)?/i);
      if(m&&NM(m[2])>0)items.push({code:'',name:m[1].trim().toUpperCase(),qty:NM(m[2]),price:0,total:0,category:cat});
    }
    if(items.length>=3)return{items,total:0,units:items.reduce((s,x)=>s+x.qty,0),format:'Lista simple'};
  }

  return {error:'No reconoc\u00ed el formato.\n\nFormatos aceptados:\n\u2022 Reporte de Ventas del SR (digital o escaneado \u2014 arrastra el PDF)\n\u2022 Corte de Caja X \u2192 usar en pesta\u00f1a Corte, no aqu\u00ed\n\u2022 Excel/CSV con columnas nombre/cantidad\n\u2022 Lista nombre: cantidad'};
}

function consumptionCalc(items, loc){
  const L = loc || finLoc;
  const need = {}; const noRecipe = [];
  const porId   = new Map(catalog.dishes.map(d=>[d.id, d]));
  const byName  = new Map(catalog.dishes.filter(d=>d.location_id===L && d.active)
                                        .map(d=>[normName(d.name), d]));
  /* El punto de venta y el recetario no siempre llaman igual al mismo
     platillo. Cuando no empatan por nombre, se busca un alias; sin eso, ese
     producto no descuenta nada y su consumo aparece después como merma. */
  const porAlias = new Map((catalog.dish_aliases||[])
    .filter(a=>a.location_id===L)
    .map(a=>[normName(a.alias), porId.get(a.dish_id)])
    .filter(([,d])=>d));

  for(const it of items){
    const d = byName.get(normName(it.name)) || porAlias.get(normName(it.name));
    /* Un platillo sin receta cuenta igual que uno que no existe: tampoco
       descuenta. Antes solo se avisaba del segundo caso. */
    if(!d || !(d.items||[]).length){ if(it.qty>0) noRecipe.push(it.name); continue; }
    for(const ri of d.items){ need[ri.ingredient_id] = (need[ri.ingredient_id]||0) + it.qty*Number(ri.qty); }
  }
  return {need, noRecipe:[...new Set(noRecipe)]};
}

/* Solo los productos sin receta que de verdad ensucian la merma: los que
   parecen comida. Una limonada sin receta no descuadra nada, porque los
   refrescos no se inventarían — avisar de esos entrena a ignorar el aviso. */
const INV_BEBIDAS = /LIMONADA|TE HELADO|UVOLA|JAMAICA|REFRESCO|COCA|SPRITE|FANTA|FRESCA|SANGRIA|MANZANITA|AGUA|MINERAL|CERVEZA|PACIFICO|MODELO|CORONA|TECATE|MICHELAD|VINO|COPA|BOTELLA|SERVICIO \$/i;
const invSoloComida = lista => (lista||[]).filter(n => !INV_BEBIDAS.test(n));

/* Un final teórico NEGATIVO no es un dato, es un error de captura: significa
   que se consumió más de lo que hubo disponible, y eso no puede pasar en el
   mundo físico. Casi siempre son compras que no se registraron; a veces una
   receta que descuenta de más. Sea cual sea, la merma de ese renglón no vale
   nada mientras el teórico esté en negativo. */
const invTeoImposible = r => r.teo < -0.001;
function invWeekNav(){
  const end = new Date(invWeek); end.setDate(end.getDate()+6);
  const fmt = d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  return `<div class="weeknav">
    <button data-iwk="-1" aria-label="Semana anterior">\u2039</button>
    <b>Semana del ${fmt(invWeek)} al ${fmt(end)}</b>
    <button data-iwk="1" aria-label="Semana siguiente">\u203a</button></div>`;
}
function invHistChips(){
  if(!invHist || !invHist.length) return '';
  const cur = dstr(invWeek);
  let h = `<div class="hint" style="font-weight:700;margin-bottom:6px">Semanas guardadas \u00b7 ${LOCS[finLoc]}</div><div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px">`;
  for(const w of invHist){
    const d = new Date(w.week_start+'T12:00');
    const label = d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
    const active = w.week_start===cur;
    const imp = w.impact!==null && w.impact!==undefined ? Number(w.impact) : null;
    h += `<button data-goweek="${w.week_start}" style="flex:none;min-height:56px;padding:6px 14px;border-radius:12px;
      background:${active?'var(--navy)':'var(--card)'};color:${active?'#fff':'var(--ink)'};box-shadow:var(--shadow);text-align:left">
      <span style="display:block;font-weight:800;font-size:14px">${label}</span>
      <span style="display:block;font-size:12px;${imp!==null&&imp<0?'color:'+(active?'#FFB4B4':'var(--red)'):''}">
        ${w.has_sales?money(w.sales_total):'sin ventas'}${w.has_inventory?(imp!==null?' \u00b7 '+money(imp):' \u00b7 inv \u2713'):''}</span></button>`;
  }
  return h + `</div>`;
}
function invSection(){
  if(invSub==='ped') invSub='ven';   // Pedido se movió a su propia sección
  let h = locSwitch(finLoc,'floc') + invWeekNav() + invHistChips();
  h += `<div class="mode-tabs" role="group" aria-label="Inventario">
    <button aria-pressed="${invSub==='ven'}" data-is="ven">1. Ventas</button>
    <button aria-pressed="${invSub==='inv'}" data-is="inv">2. Inventario</button>
    <button aria-pressed="${invSub==='res'}" data-is="res">3. Resultados</button>
    <button aria-pressed="${invSub==='fac'}" data-is="fac">Factura PDF</button>
    </div>`;
  if(invSub==='ven') h += venView();
  else if(invSub==='inv') h += invTableView();
  else if(invSub==='res') h += invResultsView();
  else if(invSub==='fac') h += facView();

  else h += venView();
  return h;
}
function venView(){
  const s = invData.sales;
  if(salesParse){
    /* Faltaba declarar `h`. Al leer bien el reporte, esta vista tronaba con
       ReferenceError y se caía el render completo: por eso salía el aviso de
       "Ventas leídas" y después no pasaba absolutamente nada. */
    let h = '';
    // Group by category for validation view
    const byCat = {};
    salesParse.items.forEach((it,ix)=>{
      const c=it.category||'SIN CATEGORÍA';
      if(!byCat[c]) byCat[c]={total:0,items:[]};
      byCat[c].total+=it.total; byCat[c].items.push({...it,_ix:ix});
    });
    const cats = Object.entries(byCat).sort((a,b)=>b[1].total-a[1].total);
    const allCats = [...new Set(salesParse.items.map(i=>i.category||'SIN CATEGORÍA'))].sort();

    /* Los renglones que baja el punto de venta no se corrigen: son EL dato.
       El panel de correcciones existe porque el reporte pegado pasa por un
       lector de PDF que confunde cantidades y precios; la API no lee, entrega. */
    const delPOS = salesParse.origen==='pos';
    const issues = delPOS ? [] : salesParse.items.filter(it=>{
      if(!it.category) return true;
      if(it.qty>=100) return true;
      if(it.qty===0) return true;
      if(it.price>0&&it.total>0&&Math.abs(it.qty*it.price-it.total)/it.total>0.15) return true;
      return false;
    });

    if(salesParse.format) h += `<div class="hint" style="margin-bottom:8px">Formato detectado: <b>${esc(salesParse.format)}</b></div>`;

    /* Verificación que no necesita un reporte a mano contra el cual comparar.
       El punto de venta entrega dos números que salen de caminos distintos: el
       total de cada cuenta y la suma de sus renglones. Si cuadran, ningún
       producto se quedó en el camino. Es la misma lógica de un arqueo. */
    if(delPOS && salesParse.chequeo){
      const c = salesParse.chequeo;
      const dif = Math.round((c.importeProductos - salesParse.total)*100)/100;
      /* Lo que importa no es cuántas cuentas se quedaron sin renglones sino
         cuánto dinero traían. Una cuenta en cero no se llevó producto; una de
         mil pesos sí. Contarlas nada más marcaba en rojo cosas inofensivas. */
      const sinDinero = Math.abs(c.montoSinDetalle||0) < 1;
      const okDias = c.dias===7, okDet = c.sinDetalle===0 || sinDinero, okSuma = Math.abs(dif) < 1;
      const todoBien = okDias && okDet && okSuma;
      const fila = (ok, txt, det) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line)">
        <span style="font-weight:800;color:${ok?'#0E9F4F':'#E01B0F'};min-width:18px">${ok?'✓':'✕'}</span>
        <span><b>${txt}</b>${det?`<br><span class="hint" style="font-size:12px">${det}</span>`:''}</span></div>`;
      h += `<div class="panel" style="border-left:4px solid ${todoBien?'#0E9F4F':'#E01B0F'}">
        <div style="font-weight:800;margin-bottom:6px">${todoBien?'✓ Bajó completo':'⚠️ Bajó incompleto'}</div>
        <p class="hint" style="margin:0 0 8px">Sin comparar contra nada: son los propios números del Soft revisándose entre ellos.</p>
        ${fila(okDias, `Los 7 días de la semana`, okDias?'':`Solo respondieron ${c.dias}. Los días que faltan no están contados.`)}
        ${fila(okDet, `Ninguna cuenta con productos se quedó fuera`,
          c.sinDetalle===0 ? ''
          : (sinDinero
             ? `${c.sinDetalle} cuenta(s) no entregaron renglones, pero venían en ${money(c.montoSinDetalle||0)} — no se llevaron producto.`
             : `${c.sinDetalle} cuenta(s) por ${money(c.montoSinDetalle||0)} no entregaron sus renglones: ese producto no se va a descontar.`))}
        ${fila(okSuma, `La suma de los productos cuadra con la venta`,
          `Renglones ${money(c.importeProductos)} contra ventas ${money(salesParse.total)}` +
          (okSuma ? ` — diferencia ${money(dif)}` : ` — faltan ${money(Math.abs(dif))} en productos`))}
        <p class="hint" style="margin:10px 0 0">${todoBien
          ? 'Cada cuenta entregó sus renglones y lo que suman coincide con lo que se cobró. Ya puedes guardar.'
          : 'Revisa lo marcado antes de guardar: lo que falte aquí se va a ver como merma en el inventario.'}</p></div>`;
    }

    /* Si esta semana ya tenía ventas guardadas, la pregunta que importa no es
       "¿cuánto trajo?" sino "¿trajo lo mismo?". Se pone el careo enfrente en
       vez de dejar que se compare a ojo entre dos pantallas. */
    if(s.saved){
      const cap = Number(s.total_amount||0), pos = salesParse.total;
      const dT = pos - cap;
      const dU = salesParse.units - Number(s.total_units||0);
      const dP = salesParse.items.length - (s.items?.length||0);
      const pct = cap ? dT/cap*100 : 0;
      const cuadra = Math.abs(pct) < 1;

      /* El corte de caja es el árbitro. Comparar el reporte pegado contra la
         API no alcanza: cuando discrepan, ninguno de los dos puede decir cuál
         tiene la razón. El corte se capturó por otro camino y de otro papel,
         así que el que se le pegue es el bueno. San Carlos 10-16 lo dejó claro:
         el pegado se pasaba $2,663 y la API cuadraba al peso con el corte. */
      const vCorte = invCorte && invCorte.venta_imp!=null ? Number(invCorte.venta_imp) : null;
      const cerca = (a,b) => a!==null && b!==null && Math.abs(a-b) <= Math.max(1, Math.abs(b)*0.005);
      const posOk = cerca(pos, vCorte), capOk = cerca(cap, vCorte);

      let titulo, consejo, color;
      if(vCorte===null){
        titulo = cuadra ? '✓ Cuadra con lo capturado a mano' : '⚠️ No cuadra con lo capturado a mano';
        color  = cuadra ? '#0E9F4F' : '#E01B0F';
        consejo = cuadra
          ? 'El punto de venta entrega lo mismo que el reporte pegado.'
          : `Hay <b>${money(Math.abs(dT))}</b> de diferencia y no hay corte de caja guardado de esta semana para desempatar. Captura el corte y vuelve a jalar, o revisa el reporte pegado a mano.`;
      } else if(posOk && capOk){
        titulo = '✓ Los tres coinciden'; color = '#0E9F4F';
        consejo = 'Corte de caja, reporte pegado y punto de venta dicen lo mismo. Puedes guardar con confianza.';
      } else if(posOk){
        titulo = '✓ El punto de venta le atina al corte'; color = '#0E9F4F';
        consejo = `La API cuadra con el corte de caja; el que se sale es el reporte que se capturó, por <b>${money(Math.abs(cap-vCorte))}</b>. <b>Guarda esto para reemplazarlo.</b>`;
      } else if(capOk){
        titulo = '⚠️ Lo que bajó no cuadra con el corte'; color = '#E01B0F';
        consejo = `El reporte capturado sí coincide con el corte de caja, y lo que bajó se sale por <b>${money(Math.abs(pos-vCorte))}</b>. <b>No lo guardes</b> hasta saber qué pasó.`;
      } else {
        titulo = '⚠️ Ninguno cuadra con el corte'; color = '#E01B0F';
        consejo = `Ni el reporte capturado ni la API coinciden con el corte de caja (${money(vCorte)}). Hay que revisar los tres a mano antes de guardar nada.`;
      }

      const marca = (val, ref) => ref===null ? '' :
        (cerca(val,ref) ? ' <span style="color:#0E9F4F;font-weight:800">✓</span>' : '');
      const cmp = (l, guardado, nuevo, dif, fmt, conMarca) => `
        <tr><td style="text-align:left;font-weight:700">${l}</td>
          ${conMarca?`<td style="font-weight:700">${fmt(vCorte)}</td>`:'<td>—</td>'}
          <td>${fmt(guardado)}${conMarca?marca(guardado,vCorte):''}</td>
          <td>${fmt(nuevo)}${conMarca?marca(nuevo,vCorte):''}</td>
          <td style="font-weight:800;color:${Math.abs(dif)<0.005?'var(--ink-2)':(dif<0?'#E01B0F':'#0E9F4F')}">${dif>0?'+':''}${fmt(dif)}</td></tr>`;

      h += `<div class="panel" style="border-left:4px solid ${color}">
        <div style="font-weight:800;margin-bottom:8px">${titulo}</div>
        <div class="res-wrap"><table class="res"><thead><tr>
          <th>Concepto</th><th>Corte de caja</th><th>Capturado</th><th>Del punto de venta</th><th>POS − capturado</th></tr></thead><tbody>
          ${cmp('Total ingresos', cap, pos, dT, money, vCorte!==null)}
          ${cmp('Unidades', Number(s.total_units||0), salesParse.units, dU, n=>Number(n).toLocaleString('es-MX'), false)}
          ${cmp('Productos distintos', s.items?.length||0, salesParse.items.length, dP, n=>String(n), false)}
        </tbody></table></div>
        <p class="hint" style="margin:8px 0 0">${consejo}</p>
        ${vCorte!==null?'':'<p class="hint" style="margin:6px 0 0;font-size:12px">Sin corte de caja de esta semana no hay con qué desempatar.</p>'}
        <p class="hint" style="margin:6px 0 0;font-size:12px">Las unidades del punto de venta salen más altas a propósito: cuenta cada modificador (cambio a papas, salsas, tocino) como su propio renglón. Eso no es un descuadre.</p></div>`;
    }

    if(issues.length){
      h += `<div class="panel" style="border-left:4px solid var(--warn);background:#FFF9EC">
        <div style="font-weight:800;color:var(--warn);margin-bottom:6px">⚠️ Revisa estos ${issues.length} productos — posibles errores de lectura:</div>
        <div class="res-wrap"><table class="res" style="font-size:13px"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th><th>Categoría</th><th>Problema</th></tr></thead><tbody>
        ${issues.map(it=>{
          const prob = it.qty>=100?'Cantidad muy alta':(!it.category?'Sin categoría':'Cant×Precio ≠ Total');
          return `<tr style="background:#FFF3D6">
            <td style="text-align:left">${esc(it.name)}</td>
            <td><input type="number" class="nospin" data-srfix-qty="${it._ix}" value="${it.qty}" style="width:70px;border:2px solid var(--warn);border-radius:6px;padding:4px;font-size:13px"></td>
            <td>${money(it.price)}</td>
            <td>${money(it.total)}</td>
            <td><select data-srfix-cat="${it._ix}" style="border:1.5px solid var(--line);border-radius:6px;padding:4px;font-size:12px">
              ${allCats.map(c=>`<option value="${esc(c)}" ${c===it.category?'selected':''}>${esc(c)}</option>`).join('')}
            </select></td>
            <td style="color:var(--warn);font-size:11px;font-weight:700">${esc(prob)}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div></div>`;
    }

    h += `<div class="panel"><div class="hint" style="font-weight:800;margin-bottom:8px">Ventas por categoría — verifica que coincidan con tu reporte:</div>`;
    const maxV = Math.max(...cats.map(([,v])=>v.total));
    h += cats.map(([c,v])=>`
      <div class="b" style="margin-bottom:4px">
        <span style="min-width:200px;display:inline-block">${esc(c)}</span>
        <span class="bar-track" style="flex:1"><span class="bar-fill" style="width:${Math.max(4,Math.round(v.total/maxV*100))}%;background:var(--ok)"></span></span>
        <span class="amt2" style="min-width:100px;text-align:right">${money(v.total)}</span>
        <span style="color:var(--ink-2);font-size:11px;min-width:60px;text-align:right">${v.items.length} prod.</span>
      </div>`).join('');
    h += `</div>`;

    h += `<div class="panel"><label style="display:flex;align-items:center;gap:10px;grid-template-columns:none">
      <input type="checkbox" id="regInc" ${invRegisterIncome?'checked':''} style="width:22px;height:22px;min-height:22px"> Registrar total como ingreso en Movimientos</label>
      <div class="frm-row">
        <button class="btn-primary" id="saveSales">✓ Confirmar y guardar</button>
        <button class="btn-quiet" id="dropSales">Descartar y volver a leer</button>
      </div></div>`;
    return h;
  }
  if(s.saved){
    const byCat = {};
    for(const it of s.items){ const c=it.category||'OTROS'; byCat[c]=(byCat[c]||0)+Number(it.total); }
    let h = `<div class="kpis">
      <div class="kpi in"><div class="l">Total ingresos</div><div class="v">${money(s.total_amount)}</div></div>
      <div class="kpi"><div class="l">Unidades</div><div class="v">${Number(s.total_units).toLocaleString('es-MX')}</div></div>
      <div class="kpi"><div class="l">Productos</div><div class="v">${s.items.length}</div></div></div>`;
    const cats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
    if(cats.length){
      const max = cats[0][1];
      h += `<div class="panel"><div class="hint" style="font-weight:700">Ventas por categor\u00eda</div><div class="bars">`;
      h += cats.map(([c,v])=>`<div class="b"><span>${esc(c)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(4,Math.round(v/max*100))}%;background:var(--ok)"></span></span><span class="amt2">${money(v)}</span></div>`).join('');
      h += `</div></div>`;
    }
    /* También aquí, con las ventas ya guardadas: sirve para comparar lo que
       bajó del POS contra lo que se capturó a mano. No pisa nada — deja la
       revisión en pantalla y solo se guarda si se confirma. */
    h += `<div class="frm-row" style="margin-bottom:8px">
      <button class="btn-primary" id="srJalar" style="width:100%">⬇️ Bajar productos vendidos del punto de venta</button></div>
    <p class="hint" style="margin:0 0 12px">Trae los siete días directo del Soft para comparar contra lo capturado. No reemplaza nada hasta que confirmes.</p>
    <button class="btn-quiet" id="redoSales" style="width:100%">Pegar reporte de nuevo</button>`;
    return h;
  }
  return `<div class="panel">
    <div class="frm-row" style="margin-bottom:14px;align-items:center">
      <button type="button" class="btn-primary" id="srJalar" style="width:100%">\u2b07\ufe0f Bajar productos vendidos del punto de venta</button></div>
    <p class="hint" style="margin:-6px 0 16px">Trae los siete d\u00edas de la semana directo del Soft \u2014 con eso arranca el inventario, sin pegar el reporte.</p>
    <div class="hint" style="text-align:center;font-weight:700;margin-bottom:12px;color:var(--ink-2)">\u2014 o a mano \u2014</div>
    <label>Pega aqu\u00ed el reporte de ventas del Soft Restaurant (lunes a domingo)
      <textarea class="paste-box" id="srBox" placeholder="GRUPO:BURGERS\n0101 CLASSIC 80.00 $257.00 $20,560.00\n..."></textarea></label>
    <div class="frm-row"><button type="button" class="btn-quiet" data-paste="srBox">Pegar del portapapeles</button><button type="button" class="btn-quiet" data-pick="srBox">Elegir archivo (Excel, CSV, PDF)</button></div><button class="btn-primary" id="procSR" style="width:100%">Procesar reporte</button>
    <p class="hint">La app separa c\u00f3digo, producto, cantidad, precio y total; agrupa por categor\u00eda; y calcula el consumo te\u00f3rico de insumos con el recetario.</p></div>`;
}
function initInvEdit(ing, savedRows, prev){
  const sv = savedRows[ing.id];
  return invEdit[ing.id] || (invEdit[ing.id] = {
    initial: sv ? Number(sv.initial) : (prev[ing.id]!==undefined ? Number(prev[ing.id]) : 0),
    purchases: sv ? Number(sv.purchases) : 0,
    physical: sv && sv.physical!==null && sv.physical!==undefined ? Number(sv.physical) : null
  });
}
function invTableView(){
  const s = invData.sales;
  /* La captura semanal muestra solo los insumos que de verdad se cuentan.
     Los 235 del catálogo de compras (bolsas, cajas, cervezas por marca…) sirven
     para pedir, no para contar cada semana, y llenaban la tabla de renglones en
     cero que nadie llenaba. Con "Ver todos" se pueden marcar los que sí. */
  const todosLoc = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active);
  const ings = invVerTodos ? todosLoc : todosLoc.filter(i=>i.inventariar!==false);
  const nCuentan = todosLoc.filter(i=>i.inventariar!==false).length;
  const savedRows = Object.fromEntries((invData.inventory.rows||[]).map(r=>[r.ingredient_id, r]));
  const prev = invData.prev_physical||{};
  let h = '';
  if(!s.saved) h += `<div class="arm-note"><span>Puedes capturar conteo y compras desde ya; el consumo y el an\u00e1lisis salen cuando guarden las ventas de la semana.</span></div>`;
  const hasPrev = Object.keys(prev).length>0;
  if(hasPrev) h += `<div class="frm-row" style="margin-bottom:12px"><button class="btn-quiet" id="pullPrev">Jalar inicial del \u00faltimo conteo</button><span></span></div>`;
  h += `<div class="frm-row" style="margin-bottom:10px;align-items:center">
    <button class="btn-quiet" id="invTgTodos" style="${invVerTodos?'background:var(--navy);color:#fff':''}">
      ${invVerTodos?`Ver solo los que se cuentan (${nCuentan})`:`Ver todos los insumos (${todosLoc.length})`}</button>
    <span class="hint">${invVerTodos
      ? 'Palomea un insumo para que entre al conteo semanal; despaloméalo para sacarlo.'
      : `Se cuentan <b>${nCuentan}</b> insumos cada semana.`}</span></div>`;
  /* Sin costo, la merma se valúa en cero y el reporte de "mermas más
     costosas" sale vacío sin decir por qué. Se dice aquí, con el número. */
  const sinPrecio = ings.filter(i => !Number(i.price||0)).length;
  h += `<div class="frm-row" style="margin-bottom:10px;align-items:center">
    <button class="btn-quiet" id="invTgAmbas" style="${invPrecioAmbas?'background:var(--navy);color:#fff':''}">
      ${invPrecioAmbas ? '🔗 El precio se guarda en las DOS sucursales' : '🔓 El precio solo para esta sucursal'}</button>
    <span class="hint">${invPrecioAmbas
      ? 'La misma carne del mismo Walmart cuesta igual en Guaymas y San Carlos: se teclea una vez.'
      : 'Solo para los insumos que de verdad cuestan distinto en cada plaza.'}</span></div>`;
  if(sinPrecio) h += `<div class="hint" style="margin-bottom:10px;padding:9px 12px;border-radius:10px;
      background:#FFF3D6;border-left:4px solid var(--warn)">
      <b>${sinPrecio} de ${ings.length} insumos sin precio.</b> Mientras no tengan costo, su merma se
      valúa en <b>$0</b> y no aparecen en "mermas más costosas". Captúralos en la columna <b>$/u</b>.</div>`;
  h += `<div class="res-wrap"><table class="res inv-tbl"><thead><tr>
    ${invVerTodos?'<th style="width:56px">Cuenta</th>':''}<th>Insumo</th><th>Inicial</th><th>Compras</th><th>F\u00edsico real (conteo)</th><th>$/u${invPrecioAmbas?'<br><span style="font-weight:600;font-size:10px">las dos sucursales</span>':''}</th></tr></thead><tbody>`;
  for(const ing of ings){
    const ed = initInvEdit(ing, savedRows, prev);
    h += `<tr>${invVerTodos?`<td><input type="checkbox" data-invmark="${ing.id}" ${ing.inventariar!==false?'checked':''} style="width:21px;height:21px;min-height:21px" aria-label="Contar ${esc(ing.name)}"></td>`:''}
      <td>${esc(ing.name)} <span class="ps" style="font-size:12px;color:var(--ink-2)">${esc(ing.unit)}</span></td>
      <td><input type="number" step="0.01" value="${ed.initial}" data-inv="${ing.id}" data-if="initial" aria-label="Inicial ${esc(ing.name)}"></td>
      <td><input type="number" step="0.01" value="${ed.purchases}" data-inv="${ing.id}" data-if="purchases" aria-label="Compras ${esc(ing.name)}"></td>
      <td><input type="number" step="0.01" value="${ed.physical===null?'':ed.physical}" placeholder="\u2014" data-inv="${ing.id}" data-if="physical" aria-label="F\u00edsico ${esc(ing.name)}"></td>
      <td><input type="number" step="0.01" min="0" value="${ing.price}" data-invprice="${ing.id}" aria-label="Precio ${esc(ing.name)}" style="width:92px"></td></tr>`;
  }
  h += `</tbody></table></div>
  <button class="btn-primary" id="saveInv" style="width:100%">${invData.inventory.saved?'Actualizar inventario':'Guardar inventario'}</button>
  <p class="hint" style="margin-top:10px">Inicial se precarga con el f\u00edsico del lunes anterior. Las compras tambi\u00e9n se suman solas al subir facturas PDF. El an\u00e1lisis completo est\u00e1 en "3. Resultados".</p>`;
  return h;
}
function invResultsView(){
  const s = invData.sales;
  if(!s.saved) return `<div class="empty"><b>Primero guarda las ventas de la semana</b>El an\u00e1lisis cruza ventas + recetario + conteo.</div>`;
  const cons = consumptionCalc(s.items);
  /* Resultados también muestra solo los insumos que se cuentan: con los 259 del
     catálogo de compras la tabla era ilegible y 235 renglones salían en ceros. */
  const ings = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active && i.inventariar!==false);
  const savedRows = Object.fromEntries((invData.inventory.rows||[]).map(r=>[r.ingredient_id, r]));
  const prev = invData.prev_physical||{};
  let consMxn=0, mermaNeg=0, mermaNet=0, counted=0;
  const rows = [];
  for(const ing of ings){
    const ed = initInvEdit(ing, savedRows, prev);
    const consumed = Math.round((cons.need[ing.id]||0)*1000)/1000;
    const teo = ed.initial + ed.purchases - consumed;
    const dif = ed.physical===null ? null : ed.physical - teo;
    const imp = dif===null ? null : dif*Number(ing.price||0);
    consMxn += consumed*Number(ing.price||0);
    if(imp!==null){ mermaNet += imp; if(imp<0) mermaNeg += imp; counted++; }
    rows.push({ing, ed, consumed, teo, dif, imp});
  }
  const ventas = Number(s.total_amount||0);
  const pctMerma = ventas>0 ? Math.abs(mermaNeg)/ventas*100 : 0;
  const pctCons = ventas>0 ? consMxn/ventas*100 : 0;
  let h = `<div class="kpis">
    <div class="kpi in"><div class="l">Ventas</div><div class="v">${money(ventas)}</div></div>
    <div class="kpi"><div class="l">Consumo te\u00f3rico</div><div class="v">${money(consMxn)}</div><div class="hint">${pctCons?pctCons.toFixed(1)+'% de ventas':''}</div></div>
    <div class="kpi out-k"><div class="l">Mermas (faltantes)</div><div class="v">${money(mermaNeg)}</div><div class="hint">${pctMerma?pctMerma.toFixed(2)+'% de ventas':''}</div></div>
  </div>`;
  if(!counted) h += `<div class="arm-note"><span>A\u00fan no hay conteo f\u00edsico esta semana \u2014 las diferencias salen cuando lo capturen en "2. Inventario".</span></div>`;
  const worst = rows.filter(r=>r.imp!==null && r.imp<0).sort((a,b)=>a.imp-b.imp).slice(0,3);
  if(worst.length){
    h += `<div class="sec"><h2>Mermas m\u00e1s costosas</h2></div>`;
    for(const r of worst){
      h += `<div class="txrow eg"><div class="c"><div class="t">${esc(r.ing.name)}</div>
        <div class="m">Faltaron ${Math.abs(Math.round(r.dif*100)/100)} ${esc(r.ing.unit)} vs. lo te\u00f3rico</div></div>
        <div class="amt">${money(r.imp)}</div></div>`;
    }
  }
  /* ---- EL AVISO QUE FALTABA ----
     Un producto vendido sin receta no descuenta inventario, y ese consumo
     reaparece abajo disfrazado de merma. Sin decirlo, un "-$535 en ALITAS"
     se lee como pérdida cuando en realidad es captura faltante. Va ARRIBA
     del desglose y con el dinero en juego, no como una nota al pie. */
  const sinRecetaComida = invSoloComida(cons.noRecipe);
  if(sinRecetaComida.length){
    h += `<div class="panel" style="border-left:4px solid var(--warn);background:#FFF9EC">
      <div style="font-weight:800;color:var(--warn);margin-bottom:6px">
        ⚠️ ${sinRecetaComida.length} producto${sinRecetaComida.length===1?'':'s'} de comida se vendió sin receta ligada</div>
      <p class="hint" style="margin:0 0 8px">Lo que llevan adentro <b>no se descontó del inventario</b>,
        así que reaparece abajo como merma. <b>Las mermas de esta semana están infladas</b> hasta que
        estos productos tengan receta o queden ligados a una.</p>
      <div>${sinRecetaComida.map(n=>`<span class="cat-chip" style="margin:2px">${esc(n)}</span>`).join(' ')}</div>
      <p class="hint" style="margin:8px 0 0">Se ligan en <b>Recetario</b>: o se le crea la receta al
        producto, o se le apunta a la receta que ya existe con otro nombre.</p></div>`;
  }
  /* Las bebidas también se listan, pero aparte y sin alarma: no se inventarían,
     así que no ensucian nada. */
  const sinRecetaBebida = cons.noRecipe.filter(n=>!sinRecetaComida.includes(n));
  if(sinRecetaBebida.length){
    h += `<div class="panel"><div class="hint" style="font-weight:700">Bebidas y servicios vendidos sin receta</div>
      <p class="hint" style="margin:2px 0 8px">No se inventarían, así que no afectan la merma. Se listan solo para que conste.</p>
      <div>${sinRecetaBebida.map(n=>`<span class="cat-chip" style="margin:2px">${esc(n)}</span>`).join(' ')}</div></div>`;
  }
  const imposibles = rows.filter(invTeoImposible);
  if(imposibles.length){
    h += `<div class="panel" style="border-left:4px solid var(--red);background:#FFF3F1">
      <div style="font-weight:800;color:var(--red);margin-bottom:6px">
        ⚠️ ${imposibles.length} insumo${imposibles.length===1?'':'s'} con final teórico negativo</div>
      <p class="hint" style="margin:0 0 8px">Se consumió más de lo que había disponible, y eso no puede
        pasar de verdad. Casi siempre son <b>compras que no se capturaron</b>; a veces una receta que
        descuenta de más. Mientras el teórico esté en negativo, <b>la merma de ese renglón no significa nada</b>.</p>
      <div>${imposibles.map(r=>`<span class="cat-chip" style="margin:2px">${esc(r.ing.name)}: ${
        Math.round(r.teo*100)/100} ${esc(r.ing.unit)}</span>`).join(' ')}</div></div>`;
  }
  h += `<div class="sec"><h2>Desglose completo</h2></div>
  <div class="res-wrap"><table class="res inv-tbl"><thead><tr>
    <th>Insumo</th><th>Inicial</th><th>Compras</th><th>Consumo</th><th>Final te\u00f3rico</th><th>F\u00edsico</th><th>Dif.</th><th>Impacto</th></tr></thead><tbody>`;
  for(const r of rows){
    const malo = invTeoImposible(r);
    h += `<tr${malo?' style="background:#FFF3F1"':''}><td>${esc(r.ing.name)} <span class="ps" style="font-size:12px;color:var(--ink-2)">${esc(r.ing.unit)}</span>${
        malo?' <b style="color:var(--red);font-size:11px">⚠ REVISAR</b>':''}</td>
      <td>${r.ed.initial}</td><td>${r.ed.purchases}</td><td>${r.consumed}</td><td${
        malo?' style="color:var(--red);font-weight:800"':''}>${Math.round(r.teo*100)/100}</td>
      <td>${r.ed.physical===null?'\u2014':r.ed.physical}</td>
      <td style="color:${r.dif===null?'inherit':(r.dif<0?'var(--red)':'var(--ok)')};font-weight:700">${r.dif===null?'\u2014':Math.round(r.dif*100)/100}</td>
      <td class="tot2" style="color:${r.imp===null?'inherit':(r.imp<0?'var(--red)':'var(--ok)')}">${r.imp===null?'\u2014':money(r.imp)}</td></tr>`;
  }
  h += `</tbody><tfoot><tr><td colspan="7">Impacto neto</td><td class="tot2" style="color:${mermaNet<0?'var(--red)':'var(--ok)'}">${money(mermaNet)}</td></tr></tfoot></table></div>`;
  h += `<div class="frm-row" style="margin-top:14px">
    <button class="btn-primary" id="invPrint" style="width:100%">🖨 Imprimir reporte de inventario</button></div>`;
  /* Se guarda lo ya calculado para que el impreso salga con exactamente los
     mismos números que la pantalla, sin recalcular nada. */
  _invReporte = {rows, ventas, consMxn, mermaNeg, mermaNet, pctMerma, pctCons,
                 counted, sinReceta: cons.noRecipe||[], imposibles};
  return h;
}
let _invReporte = null;
function invReporteHtml(){
  const r = _invReporte;
  if(!r) return '';
  const fin = new Date(invWeek); fin.setDate(fin.getDate()+6);
  const f = d => d.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
  const num = v => v===null||v===undefined ? '—' : (Math.round(v*1000)/1000);
  return `<div class="rc rc-compacto">
    ${encabezadoRecibo('Reporte de inventario', `Semana del ${f(invWeek)} al ${f(fin)}`)}
    <table class="rc-datos">
      <tr><th>Ventas de la semana</th><td>${money(r.ventas)}</td>
          <th>Consumo teórico</th><td>${money(r.consMxn)}${r.pctCons?` · ${r.pctCons.toFixed(1)}% de ventas`:''}</td></tr>
      <tr><th>Mermas (faltantes)</th><td>${money(r.mermaNeg)}${r.pctMerma?` · ${r.pctMerma.toFixed(2)}% de ventas`:''}</td>
          <th>Impacto neto</th><td>${money(r.mermaNet)}</td></tr>
    </table>
    <table class="rc-mov">
      <thead><tr><th>Insumo</th><th class="num">Inicial</th><th class="num">Compras</th>
        <th class="num">Consumo</th><th class="num">Final teórico</th><th class="num">Físico</th>
        <th class="num">Dif.</th><th class="num">Impacto</th></tr></thead>
      <tbody>${r.rows.map(x=>`<tr${invTeoImposible(x)?' class="rc-revisar"':''}>
        <td>${esc(x.ing.name)} <span style="color:#777">${esc(x.ing.unit)}</span>${
          invTeoImposible(x)?' <b>&#9888; REVISAR</b>':''}</td>
        <td class="num">${num(x.ed.initial)}</td><td class="num">${num(x.ed.purchases)}</td>
        <td class="num">${num(x.consumed)}</td><td class="num"><b>${num(x.teo)}</b></td>
        <td class="num">${x.ed.physical===null?'—':num(x.ed.physical)}</td>
        <td class="num"><b>${x.dif===null?'—':num(x.dif)}</b></td>
        <td class="num">${x.imp===null?'—':money(x.imp)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="total-row"><td colspan="7">IMPACTO NETO</td>
        <td class="num">${money(r.mermaNet)}</td></tr></tfoot>
    </table>
    ${(r.imposibles||[]).length?`<p class="rc-sinreceta" style="color:#B4453A">
      <b>&#9888; ${r.imposibles.length} insumo${r.imposibles.length===1?'':'s'} con final teórico negativo</b>
      (${r.imposibles.map(x=>esc(x.ing.name)+': '+(Math.round(x.teo*100)/100)+' '+esc(x.ing.unit)).join(' · ')}).
      Se consumió más de lo que había disponible, lo cual no puede pasar: casi siempre son compras sin
      capturar. La merma de esos renglones no es confiable.</p>`:''}
    ${r.sinReceta.length?`<p class="rc-sinreceta" style="color:#555">
      <b>Vendidos sin receta</b> (no descuentan inventario): ${r.sinReceta.map(esc).join(' · ')}</p>`:''}
    ${!r.counted?`<p style="font-size:10.5px;color:#B4453A;font-weight:700">Sin conteo físico capturado esta semana: las diferencias no son definitivas.</p>`:''}
    <div class="rc-firmas-2">
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Quien contó</div></div>
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Revisó</div></div>
    </div>
    <div class="rc-pie">Impreso el ${f(new Date())} · Documento interno de control</div>
  </div>`;
}
function printInventario(){
  const html = invReporteHtml();
  if(!html){ toast('Abre primero el análisis'); return; }
  $('#printArea').innerHTML = html;
  const img = $('#printArea').querySelector('.rc-logo');
  if(img && !img.complete){ img.onload = ()=>window.print(); img.onerror = ()=>window.print(); setTimeout(()=>window.print(), 1500); }
  else window.print();
}
function stockFinalMap(){
  const cons = invData.sales.saved ? consumptionCalc(invData.sales.items).need : {};
  const savedRows = Object.fromEntries((invData.inventory.rows||[]).map(r=>[r.ingredient_id, r]));
  const prev = invData.prev_physical||{};
  const map = {};
  for(const ing of catalog.ingredients.filter(i=>i.location_id===finLoc && i.active)){
    const sv = savedRows[ing.id];
    if(sv && sv.physical!==null && sv.physical!==undefined){ map[ing.id] = Number(sv.physical); }
    else if(sv){ map[ing.id] = Number(sv.initial)+Number(sv.purchases)-Number(sv.consumed); }
    else if(prev[ing.id]!==undefined){ map[ing.id] = Number(prev[ing.id]); }
    else map[ing.id] = null;
  }
  return {map, cons};
}
function pedView(){
  const ings = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active);
  const {map:stock, cons} = stockFinalMap();
  const hasInv = invData.inventory.saved;
  let h = '';
  if(!hasInv) h += `<div class="arm-note"><span>Esta semana a\u00fan no tiene inventario guardado \u2014 el stock se toma del conteo m\u00e1s reciente disponible. Para el pedido del lunes, p\u00e1rate en la semana del conteo.</span></div>`;
  h += `<div class="frm-row" style="margin-bottom:12px">
    <button class="btn-quiet" id="sugPar">Sugerir stock objetivo seg\u00fan consumo de la semana (+15%)</button></div>`;
  const sinProv = ings.filter(i=>!i.supplier).length;
  if(sinProv) h += `<div class="arm-note"><span><b>${sinProv} insumos sin proveedor.</b> Elígeselo en la columna Proveedor (marcada en amarillo) y se guarda solo — así salen agrupados en la orden de compra.</span></div>`;
  const bySup = {};
  let anySuggest = false;
  /* Proveedores ya registrados en el catálogo, para elegirlos de una lista en
     vez de volver a escribirlos en cada insumo. */
  const PROVS = [...new Set(catalog.ingredients
    .filter(i=>i.location_id===finLoc && i.supplier)
    .map(i=>i.supplier.trim()).filter(Boolean))].sort((x,y)=>x.localeCompare(y));
  h += `<div class="res-wrap"><table class="res"><thead><tr>
    <th>Insumo</th><th>Proveedor</th><th>Stock actual</th><th>Consumo sem.</th><th>Objetivo (par)</th><th>Sugerido</th><th>Pedir</th><th>Costo est.</th></tr></thead><tbody>`;
  for(const ing of ings){
    const _oculto = pedSoloSinProv && !!ing.supplier;   // filtro: solo sin proveedor
    const st = stock[ing.id];
    const consumed = Math.round((cons[ing.id]||0)*100)/100;
    const par = Number(ing.par_level||0);
    let sug = 0;
    if(par>0 && st!==null) sug = Math.max(0, par - st);
    else if(par>0 && st===null) sug = par;
    sug = ing.unit==='PZA' ? Math.ceil(sug) : Math.ceil(sug*2)/2;
    if(pedEdit[ing.id]===undefined) pedEdit[ing.id] = sug;
    const q = pedEdit[ing.id];
    if(q>0){ (bySup[ing.supplier||'SIN PROVEEDOR'] = bySup[ing.supplier||'SIN PROVEEDOR']||[]).push({ing, q}); anySuggest = true; }
    if(_oculto) continue;
    h += `<tr><td>${esc(ing.name)} <span class="ps" style="font-size:12px;color:var(--ink-2)">${esc(ing.unit)}</span></td>
      <td style="text-align:left"><select data-psup="${ing.id}" aria-label="Proveedor ${esc(ing.name)}" style="min-width:150px;min-height:40px;border:1.5px solid var(--line);border-radius:8px;padding:4px;background:var(--card);${ing.supplier?'':'border-color:var(--warn);background:#FFF9EC'}">
        <option value="" ${!ing.supplier?'selected':''}>— Sin proveedor —</option>
        ${PROVS.map(pv=>`<option value="${esc(pv)}" ${ing.supplier===pv?'selected':''}>${esc(pv)}</option>`).join('')}
        <option value="__nuevo__">+ Agregar proveedor nuevo…</option>
      </select></td>
      <td>${st===null?'\u2014':Math.round(st*100)/100}</td><td>${consumed}</td>
      <td><input type="number" step="0.5" min="0" value="${par}" data-ppar="${ing.id}" aria-label="Par ${esc(ing.name)}"></td>
      <td style="font-weight:700;color:${sug>0?'var(--red)':'var(--ink-2)'}">${sug>0?sug:'\u2014'}</td>
      <td><input type="number" step="0.5" min="0" value="${q}" data-pq="${ing.id}" aria-label="Pedir ${esc(ing.name)}"></td>
      <td>${money(q*Number(ing.price||0))}</td></tr>`;
  }
  h += `</tbody></table></div>
  <p class="hint" style="margin:10px 0">Sugerido = objetivo \u2212 stock actual. El objetivo (par) y el proveedor se guardan por insumo; ll\u00e9nalos una vez y cada lunes el pedido sale solo.</p>`;
  if(anySuggest){
    h += `<div class="sec"><h2>Orden de compra por proveedor</h2></div>`;
    for(const [sup, rows] of Object.entries(bySup)){
      const tot = rows.reduce((s,r)=>s+r.q*Number(r.ing.price||0),0);
      h += `<div class="panel"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <b style="flex:1">${esc(sup)}</b>
        <button class="btn-quiet" data-pcopy="${esc(sup)}">Copiar para WhatsApp</button>
        <button class="btn-quiet" data-pprint="${esc(sup)}">Imprimir</button></div>
        <div>${rows.map(r=>`<div class="txrow" style="box-shadow:none;border:1px solid var(--line)"><div class="c"><div class="t">${esc(r.ing.name)}</div></div><div class="amt" style="color:var(--ink)">${r.q} ${esc(r.ing.unit)}</div></div>`).join('')}</div>
        ${tot>0?`<div class="hint" style="font-weight:700">Costo estimado: ${money(tot)}</div>`:''}</div>`;
    }
  } else {
    h += `<div class="empty"><b>Nada que pedir</b>Con par y stock capturados, aqu\u00ed aparece el pedido sugerido.</div>`;
  }
  return h;
}
function pedText(sup){
  const rows = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active &&
    (i.supplier||'SIN PROVEEDOR')===sup && (pedEdit[i.id]||0)>0);
  let t = `PEDIDO ${LOCS[finLoc].toUpperCase()}\nSemana del ${invWeek.toLocaleDateString('es-MX',{day:'numeric',month:'short'})}\nProveedor: ${sup}\n\n`;
  t += rows.map(i=>`\u2022 ${i.name}: ${pedEdit[i.id]} ${i.unit}`).join('\n');
  return t;
}
function wirePed(){
  $('#sugPar')?.addEventListener('click', async ()=>{
    const {cons} = stockFinalMap();
    if(!invData.sales.saved){ toast('Primero guarda las ventas de la semana para calcular el consumo'); return; }
    const targets = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active).map(ing=>{
      const c = cons[ing.id]||0;
      if(c<=0) return null;
      const par = ing.unit==='PZA' ? Math.ceil(c*1.15) : Math.ceil(c*1.15*2)/2;
      return {ing, par};
    }).filter(Boolean);
    const results = await Promise.allSettled(targets.map(({ing,par})=>
      finRpc('inv_save_ingredient', {p_id:ing.id, p_loc:ing.location_id, p_name:ing.name, p_unit:ing.unit, p_price:Number(ing.price||0), p_par:par})
        .then(()=>{ ing.par_level = par; })
    ));
    const n = results.filter(r=>r.status==='fulfilled').length;
    pedEdit={}; toast(`Objetivo sugerido en ${n} insumos`); render();
  });
  $('#main').querySelectorAll('[data-ppar]').forEach(inp=>inp.addEventListener('change', async ()=>{
    const ing = catalog.ingredients.find(i=>i.id===inp.dataset.ppar);
    try{
      await finRpc('inv_save_ingredient', {p_id:ing.id, p_loc:ing.location_id, p_name:ing.name, p_unit:ing.unit, p_price:Number(ing.price||0), p_par:Number(inp.value||0)});
      ing.par_level = Number(inp.value||0);
      delete pedEdit[ing.id];
      render();
    }catch(e){}
  }));
  $('#main').querySelectorAll('[data-psup]').forEach(inp=>inp.addEventListener('change', async ()=>{
    const ing = catalog.ingredients.find(i=>i.id===inp.dataset.psup);
    let valor = inp.value;
    if(valor==='__nuevo__'){
      valor = (prompt('Nombre del proveedor nuevo:')||'').trim().toUpperCase();
      if(!valor){ render(); return; }   // se canceló: se deja como estaba
    }
    try{
      await finRpc('inv_save_ingredient', {p_id:ing.id, p_loc:ing.location_id, p_name:ing.name, p_unit:ing.unit, p_price:Number(ing.price||0), p_supplier:valor});
      ing.supplier = valor.trim()||null;
      toast(ing.supplier ? `${ing.name} → ${ing.supplier}` : `${ing.name} sin proveedor`);
      render();
    }catch(e){ toast('No se pudo guardar el proveedor'); }
  }));
  $('#main').querySelectorAll('[data-pq]').forEach(inp=>inp.addEventListener('change', ()=>{
    pedEdit[inp.dataset.pq] = Number(inp.value||0); render();
  }));
  $('#main').querySelectorAll('[data-pcopy]').forEach(b=>b.addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(pedText(b.dataset.pcopy)); toast('Pedido copiado \u2014 p\u00e9galo en WhatsApp'); }
    catch(e){ toast('No se pudo copiar'); }
  }));
  $('#main').querySelectorAll('[data-pprint]').forEach(b=>b.addEventListener('click', ()=>{
    const sup = b.dataset.pprint;
    const rows = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active &&
      (i.supplier||'SIN PROVEEDOR')===sup && (pedEdit[i.id]||0)>0);
    $('#printArea').innerHTML = `<div class="rc"><h1>Orden de Compra \u2014 ${esc(LOCS[finLoc])}</h1>
      <div class="sub2">${esc(EMPRESA)} \u00b7 Proveedor: ${esc(sup)} \u00b7 ${new Date().toLocaleDateString('es-MX')}</div>
      <table><tr><th>Insumo</th><th>Cantidad</th><th>Unidad</th></tr>
      ${rows.map(i=>`<tr><td>${esc(i.name)}</td><td class="num">${pedEdit[i.id]}</td><td>${esc(i.unit)}</td></tr>`).join('')}</table>
      <div class="firma">Recibido</div></div>`;
    window.print();
  }));
}
function recView(){
  /* Aqu\u00ed hab\u00eda una segunda tabla con los 259 insumos y su precio. Era la misma
     lista que ya est\u00e1 en Inventario (columna $/u) y en Pedido, solo que
     repetida: no aportaba nada y hac\u00eda pesada esta pantalla. Se quit\u00f3 y queda
     \u00fanicamente lo que s\u00ed es exclusivo de aqu\u00ed: dar de alta un insumo nuevo. */
  let h = `<div class="sec"><h2>Insumos \u00b7 ${LOCS[finLoc]}</h2></div>
  <form class="panel" id="ingFrm"><div class="frm-row-3">
    <label>Nuevo insumo <input name="name" required maxlength="60"></label>
    <label>Unidad <select name="unit"><option>KG</option><option>PZA</option><option>LT</option></select></label>
    <label>Precio por unidad <input name="price" type="number" step="0.01" min="0" value="" placeholder="0"></label></div>
    <button class="btn-quiet" type="submit">Agregar insumo</button>
    <p class="hint" style="margin-top:8px">Los precios de los insumos se editan en <b>Inventario</b> (columna $/u) o en <b>Pedido</b>.</p></form>`;
  const dishes = catalog.dishes.filter(d=>d.location_id===finLoc && d.active &&
    (!recFilter || d.name.includes(recFilter)));
  const ingName = Object.fromEntries(catalog.ingredients.map(i=>[i.id, i.name]));
  h += `<div class="sec"><h2>Platillos (${dishes.length})</h2></div>
  <div class="panel"><label>Buscar platillo <input id="recSearch" value="${esc(recFilter)}" placeholder="BOYES, CHABACANA\u2026"></label></div>`;
  h += `<form class="panel" id="dishFrm"><div class="frm-row">
    <label>Nuevo platillo <input name="dname" required maxlength="80" placeholder="Como aparece en el reporte del SR"></label>
    <button class="btn-quiet" type="submit" style="align-self:end">Crear y editar receta</button></div>
    <p class="hint">\u00datil para los que salen en Alertas: crea el platillo con el nombre EXACTO del reporte de ventas. Si lo dejas sin insumos, deja de alertar y no descuenta inventario.</p></form>`;
  /* En las recetas solo tienen sentido los insumos que de verdad se cuentan
     cada semana. Los 235 del cat\u00e1logo de compras (bolsas, cajas, Windex,
     cervezas por marca\u2026) sirven para pedir, no para descontar del inventario,
     y llenaban la lista de cientos de renglones in\u00fatiles.
     Si un insumo ya estaba puesto en una receta, se sigue mostrando aunque no
     est\u00e9 marcado, para no perder nada de lo ya capturado. */
  const ingOpts = sel => `<option value="">\u2014 No descontar inventario \u2014</option>` + catalog.ingredients
    .filter(i=>i.location_id===finLoc && i.active && (i.inventariar!==false || i.id===sel))
    .map(i=>`<option value="${i.id}" ${sel===i.id?'selected':''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('');
    const empties = dishes.filter(d=>!d.items.length);
  const shown = recOnlyEmpty ? dishes.filter(d=>!d.items.length) : dishes;
  h += `<div class="frm-row" style="margin-bottom:10px">
    <button class="btn-quiet" id="recEmptyTgl" style="${recOnlyEmpty?'background:var(--warn);color:#fff':''}">
      ${recOnlyEmpty?'Ver todos los platillos':'Solo SIN insumos ('+empties.length+')'}</button>
    <button class="btn-quiet" id="recSelAll">${recSel.size?'Quitar selecci\u00f3n ('+recSel.size+')':'Seleccionar visibles'}</button></div>`;
  if(recSel.size){
    h += `<div class="panel" style="border:2px solid var(--gold)">
      <div class="hint" style="font-weight:800">Edici\u00f3n masiva \u00b7 ${recSel.size} platillo(s) seleccionados</div>
      <div class="frm-row-3">
        <label>Insumo <select id="bulkIng" style="min-height:52px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:16px">${ingOpts('')}</select></label>
        <label>Cantidad por platillo <input id="bulkQty" type="number" step="0.001" min="0" class="nospin" placeholder="0.03 = 30 g"></label>
        <span style="align-self:end;display:grid;gap:8px">
          <button class="btn-primary" id="bulkAdd" type="button">Agregar / actualizar en todos</button>
          <button class="btn-quiet" id="bulkDel" type="button">Quitar de todos</button></span>
      </div></div>`;
  }
  const byCat = {};
  for(const d of shown){ (byCat[d.category||'SIN CATEGOR\u00cdA'] = byCat[d.category||'SIN CATEGOR\u00cdA']||[]).push(d); }
  const cats = Object.keys(byCat).sort((a,b)=> a==='SIN CATEGOR\u00cdA'?1 : b==='SIN CATEGOR\u00cdA'?-1 : a.localeCompare(b));
  h += `<div class="emp-scroll" style="max-height:64vh">`;
  for(const cat of cats){
    h += `<div class="sec" style="margin:10px 4px 6px"><h2>${esc(cat)} (${byCat[cat].length})</h2></div>`;
    for(const d of byCat[cat]){
      if(recEditId===d.id && recDraft){
        h += `<div class="emp-card"><div class="hd"><span class="nm2">${esc(d.name)}</span></div>`;
        recDraft.forEach((ri,ix)=>{
          const ringr = catalog.ingredients.find(i=>i.id===ri.ingredient_id);
          const unit = ringr ? ringr.unit : '';
          const gHint = (unit==='KG' && ri.qty>0 && ri.qty<5) ? `= ${Math.round(ri.qty*1000)} g` : '';
          h += `<div class="frm-row" style="grid-template-columns:2fr 1fr auto auto;margin-bottom:8px;align-items:center">
            <select data-reing="${ix}" aria-label="Insumo" style="min-height:52px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:16px">${ingOpts(ri.ingredient_id)}</select>
            <input type="number" step="0.001" min="0" value="${ri.qty}" data-reqty="${ix}" aria-label="Cantidad" class="nospin" style="min-height:52px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:16px">
            <span style="font-weight:700;color:var(--ink-2);min-width:56px">${unit}${gHint?`<br><span style="font-weight:400;font-size:12px">${gHint}</span>`:''}</span>
            <button class="btn-quiet" data-redel="${ix}" aria-label="Quitar insumo">\u2715</button></div>`;
        });
        if(!recDraft.length) h += `<div class="arm-note" style="margin:8px 0"><span>Sin insumos \u2014 al guardar este platillo <b>no descuenta inventario</b> y desaparece de las alertas.</span></div>`;
        h += `<div class="frm-row" style="margin-top:6px">
          <button class="btn-quiet" id="recAddIng">+ Agregar insumo</button><span></span></div>
          <div class="frm-row" style="margin-top:10px">
          <button class="btn-primary" id="recSave">Guardar receta</button>
          <button class="btn-quiet" id="recCancel">Cancelar</button></div>
          <p class="hint" style="margin-top:8px">0.18 KG = 180 g \u00b7 1 PZA = 1 pieza. Sin insumos = no descuenta inventario.</p></div>`;
      } else {
        const chips = d.items.length
          ? d.items.map(ri=>`<span class="cat-chip" style="margin:2px 4px 2px 0">${esc(ingName[ri.ingredient_id]||'?')} \u00d7 ${ri.qty}</span>`).join('')
          : `<span class="cat-chip" style="background:var(--warn);color:#fff">\u26a0 SIN INSUMOS</span>`;
        h += `<div class="txrow" style="${!d.items.length?'border-left-color:var(--warn);background:#FFF9EC;':''}">
          <input type="checkbox" ${recSel.has(d.id)?'checked':''} data-rsel="${d.id}" aria-label="Seleccionar ${esc(d.name)}" style="width:26px;height:26px;min-height:26px;flex:none;align-self:center">
          <div class="c"><div class="t">${esc(d.name)}</div><div class="m" style="margin-top:4px">${chips}</div></div>
          <button class="rowbtn" data-recedit="${d.id}">Editar</button></div>`;
      }
    }
  }
  h += `</div>`;
  if(!shown.length) h += `<div class="empty"><b>Sin platillos${recOnlyEmpty?' pendientes \u2014 todo el men\u00fa tiene insumos \u2705':''}</b></div>`;
  return h;
}
/* Pedido vive en su propia sección: trae selector de sucursal, la semana del
   inventario, el stock real, el consumo y la orden de compra por proveedor. */
function pedidoSeccion(){
  return locSwitch(finLoc,'floc') + invWeekNav() + pedView();
}
function wireInv(){
  if(document.getElementById('srBox')?._invWired) return; if(document.getElementById('srBox')) document.getElementById('srBox')._invWired=true;
  wireDrop('srBox');
  /* after drop fills srBox, try smart parse */
  (()=>{
    const ta=document.getElementById('srBox'); if(!ta||ta._smartParse) return; ta._smartParse=true;
    ta.addEventListener('drop', async e=>{
      // Wait for wireDrop to fill value, then parse
      const fileList = e.dataTransfer?.files;
      await new Promise(r=>setTimeout(r,400));
      // Try text first
      if(ta.value && ta.value.trim().length > 20){
        const res=parseSR(ta.value);
        if(!res.error){
          salesParse=res;
          if(res.warning) toast('⚠️ '+res.warning.split('\n')[0]);
          else toast('Ventas leídas · '+res.items.length+' productos'+(res.format?' · '+res.format:''));
          render(); return;
        }
      }
      // If text parse failed and it was a PDF file, try OCR
      const pdfFile = fileList && [...fileList].find(f=>f.name.toLowerCase().endsWith('.pdf'));
      if(pdfFile && typeof Tesseract!=='undefined'){
        toast('🔍 PDF escaneado — OCR en proceso... (20-40 seg)');
        try{
          const ocrText = await ocrPDF(pdfFile);
          if(ocrText){
            const res2=parseSR(ocrText);
            if(!res2.error){ salesParse=res2; toast('OCR · '+res2.items.length+' productos · '+res2.format); render(); return; }
          }
        }catch(ocrErr){ console.error('OCR:',ocrErr); }
        toast('No detecté productos en el PDF escaneado.');
      }
    });
  })();
  $('#main').querySelectorAll('[data-iwk]').forEach(b=>b.addEventListener('click', ()=>{
    invWeek.setDate(invWeek.getDate() + 7*Number(b.dataset.iwk));
    invData=null; salesParse=null; invEdit={}; pedEdit={}; refreshInvWeek();
  }));
  $('#main').querySelectorAll('[data-is]').forEach(b=>b.addEventListener('click', ()=>{ invSub=b.dataset.is; render(); }));
  $('#main').querySelectorAll('[data-goweek]').forEach(b=>b.addEventListener('click', ()=>{
    invWeek = new Date(b.dataset.goweek+'T12:00');
    invData=null; salesParse=null; invEdit={}; pedEdit={}; refreshInvWeek();
  }));
  wireFac();
  wirePed();
  $('#procSR')?.addEventListener('click', async ev=>{
    const ta = $('#srBox');
    const raw = ta.value;
    const archivo = ta._archivo;
    const esPdf = archivo && /\.pdf$/i.test(archivo.name || '');

    /* Primero el texto, que es rápido y exacto. */
    if(raw.trim()){
      const res = parseSR(raw);
      if(!res.error){
        salesParse=res;
        if(res.warning) toast('⚠️ '+res.warning.split('\n')[0]);
        else toast('Ventas leídas · '+res.items.length+' productos'+(res.format?' · '+res.format:''));
        render(); return;
      }
      if(!esPdf){ toast(res.error); return; }
    } else if(!esPdf){
      toast('Pega el reporte o arrastra el PDF'); return;
    }

    /* Si no hubo texto que sirviera y lo que cargaron es un PDF, se intenta
       con OCR. Antes esto solo pasaba al arrastrar el archivo: quien lo elegía
       con el botón «Elegir archivo» se quedaba sin salida, y un PDF impreso
       desde Windows —que no trae texto— no había forma de leerlo. */
    const b = ev.currentTarget, etq = b.textContent;
    b.disabled = true; b.textContent = 'Leyendo la imagen del PDF…';
    toast('Ese PDF es una imagen — lo estoy leyendo con OCR. Tarda entre 20 y 60 segundos.');
    try{
      const texto = await ocrPDF(archivo);
      if(texto){
        const res2 = parseSR(texto);
        if(!res2.error){
          salesParse = res2;
          ta.value = texto;      // queda a la vista, por si hay que corregir algo a mano
          toast(`OCR · ${res2.items.length} productos${res2.format?' · '+res2.format:''} — revísalo antes de guardar.`);
          render(); return;
        }
        ta.value = texto;
        toast('Leí el PDF pero no reconocí los productos. Quedó el texto en el cuadro para revisarlo.');
        render(); return;
      }
      toast('No pude leer ese PDF ni como imagen.');
    }catch(e){
      toast('Falló el OCR: ' + (e && e.message ? e.message : 'sin detalle'));
    }finally{
      b.disabled = false; b.textContent = etq;
    }
  });
  /* Baja del punto de venta los productos vendidos de los siete días y los deja
     igual que si se hubiera pegado el reporte: mismo objeto salesParse, misma
     revisión en pantalla, mismo botón de guardar. No guarda nada solo — el
     conteo lo sigue autorizando quien lo revisa. */
  $('#srJalar')?.addEventListener('click', async ev=>{
    const b = ev.currentTarget, etq = b.innerHTML;
    const suc = finLoc===1 ? 'guaymas' : 'sancarlos';
    b.disabled = true;
    const dias = [];
    for(let i=0;i<7;i++){ const d=new Date(invWeek); d.setDate(d.getDate()+i); dias.push(dstr(d)); }
    const acum = new Map();           // nombre normalizado → renglón acumulado
    let total=0, impProd=0, fallos=0, motivo='', conDetalle=0, sinDetalle=0, montoSinDet=0;
    for(let i=0;i<dias.length;i++){
      b.textContent = `Bajando ${i+1} de 7 — ${dias[i].slice(8)}/${dias[i].slice(5,7)}…`;
      try{
        const r = await fetch(`/api/soft-ventas?sucursal=${suc}&fecha=${dias[i]}&token=${encodeURIComponent(user.token)}`);
        const d = await r.json().catch(()=>null);
        if(d?.error) throw new Error(d.error);
        if(!r.ok) throw new Error('el servidor contestó '+r.status);
        total += Number(d.total||0);
        impProd += Number(d.importe_productos||0);
        conDetalle  += Number(d.ventas_con_detalle||0);
        sinDetalle  += Number(d.ventas||0) - Number(d.ventas_con_detalle||0);
        montoSinDet += Number(d.monto_sin_detalle||0);
        for(const it of (d.items||[])){
          const k = normName(it.name);
          const a = acum.get(k) || { name: it.name, qty: 0, price: Number(it.price||0),
                                     total: 0, category: it.category || 'GENERAL' };
          a.qty += Number(it.qty||0);
          a.total += Number(it.total||0);
          acum.set(k, a);
        }
      }catch(e){ fallos++; motivo = e.message || 'sin detalle'; }
    }
    b.disabled = false; b.innerHTML = etq;
    if(fallos===7){ toast('No se pudo bajar del punto de venta — '+motivo); return; }
    if(!acum.size){ toast('El punto de venta no reporta ventas en esa semana'); return; }

    const items = [...acum.values()]
      .map(a=>({ ...a, qty: Math.round(a.qty*1000)/1000, total: Math.round(a.total*100)/100 }))
      .sort((x,y)=>y.total-x.total);
    salesParse = { items, total: Math.round(total*100)/100,
                   units: Math.round(items.reduce((s,x)=>s+x.qty,0)*1000)/1000,
                   format: `Soft Restaurant · ${7-fallos} de 7 días`,
                   /* El origen manda: lo que baja del punto de venta es el dato
                      bueno y no se corrige a mano. Lo pegado sí, porque pasó
                      por un lector de PDF que sí se puede equivocar. */
                   origen: 'pos',
                   chequeo: { dias: 7-fallos, conDetalle, sinDetalle,
                              montoSinDetalle: Math.round(montoSinDet*100)/100,
                              importeProductos: Math.round(impProd*100)/100 } };
    render();
    toast(`${fallos?`${7-fallos} de 7 días · `:''}${items.length} productos · ${money(salesParse.total)}`
      + (sinDetalle>0?` · ⚠️ ${sinDetalle} venta(s) sin renglones`:''));
  });
  $('#dropSales')?.addEventListener('click', ()=>{ salesParse=null; render(); });
  $('#redoSales')?.addEventListener('click', ()=>{ salesParse=null; invData.sales.saved=false; render(); });
  $('#regInc')?.addEventListener('change', e=>{ invRegisterIncome = e.target.checked; });
  // Wire inline corrections for OCR issues
  $('#main').querySelectorAll('[data-srfix-qty]').forEach(inp=>inp.addEventListener('change',()=>{
    const ix=Number(inp.dataset.srfixQty);
    if(salesParse?.items[ix]) salesParse.items[ix].qty=Number(inp.value||0);
    render();
  }));
  $('#main').querySelectorAll('[data-srfix-cat]').forEach(sel=>sel.addEventListener('change',()=>{
    const ix=Number(sel.dataset.srfixCat);
    if(salesParse?.items[ix]) salesParse.items[ix].category=sel.value;
    render();
  }));
  $('#saveSales')?.addEventListener('click', async ()=>{
    try{
      await finRpc('inv_save_sales', {p_week: dstr(invWeek), p_loc: finLoc, p_total: salesParse.total,
        p_units: salesParse.units, p_items: salesParse.items, p_register: invRegisterIncome});
      toast(`Ventas guardadas \u00b7 ${money(salesParse.total)}`);
      salesParse=null; invData=null; invEdit={}; refreshFinance(); refreshInvWeek();
    }catch(e){}
  });
  instalaCapturaInventario();
  $('#invPrint')?.addEventListener('click', printInventario);
  $('#invTgTodos')?.addEventListener('click', ()=>{ invVerTodos = !invVerTodos; render(); });
  $('#invTgAmbas')?.addEventListener('click', ()=>{ invPrecioAmbas = !invPrecioAmbas; render(); });
  $('#main').querySelectorAll('[data-invmark]').forEach(c=>c.addEventListener('change', async ()=>{
    const ing = catalog.ingredients.find(i=>i.id===c.dataset.invmark);
    if(!ing) return;
    const antes = ing.inventariar;
    ing.inventariar = c.checked;
    try{
      await finRpc('inv_set_inventariar', {p_id: ing.id, p_val: c.checked});
      guardaCatalogoLocal(catalog);
      toast(c.checked ? `${ing.name} entra al conteo` : `${ing.name} sale del conteo`);
    }catch(e){ ing.inventariar = antes; c.checked = antes!==false; toast('No se pudo guardar'); }
  }));
  $('#pullPrev')?.addEventListener('click', ()=>{
    const prev = invData.prev_physical||{};
    let n=0;
    for(const ing of catalog.ingredients.filter(i=>i.location_id===finLoc && i.active)){
      if(prev[ing.id]!==undefined){
        (invEdit[ing.id] = invEdit[ing.id]||{initial:0,purchases:0,physical:null}).initial = Number(prev[ing.id]);
        n++;
      }
    }
    toast(`Inicial actualizado en ${n} insumos desde el \u00faltimo conteo`);
    render();
  });
  $('#saveInv')?.addEventListener('click', async ()=>{
    const cons = consumptionCalc(invData.sales.items);
    /* Se guardan únicamente los insumos que se cuentan: si no, se escribían
       235 renglones en cero cada semana. */
    const rows = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active && i.inventariar!==false).map(i=>{
      const ed = invEdit[i.id]||{initial:0,purchases:0,physical:null};
      return {ingredient_id:i.id, initial:ed.initial, purchases:ed.purchases,
              consumed: Math.round((cons.need[i.id]||0)*1000)/1000, physical: ed.physical};
    });
    try{
      await finRpc('inv_save_inventory', {p_week: dstr(invWeek), p_loc: finLoc, p_rows: rows});
      toast('Inventario guardado');
      invData=null; invEdit={}; refreshInvWeek();
    }catch(e){}
  });
  wireRec();
}
function wireRec(){
  $('#ingFrm')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      const row = await finRpc('inv_save_ingredient', {p_id:null, p_loc:finLoc, p_name:f.get('name'), p_unit:f.get('unit'), p_price:Number(f.get('price')||0)});
      catalog.ingredients.push(row);
      guardaCatalogoLocal(catalog);
      toast('Insumo agregado'); render();
    }catch(err){}
  });
  const rs = $('#recSearch');
  /* Antes cada letra tecleada repintaba la lista entera de platillos. Ahora se
     espera a que la persona deje de escribir (180 ms) y se repinta una sola
     vez: el buscador responde al instante aunque haya cientos de platillos. */
  rs?.addEventListener('input', ()=>{
    recFilter = rs.value.toUpperCase();
    clearTimeout(_recBuscaReloj);
    _recBuscaReloj = setTimeout(()=>{
      const p = rs.selectionStart;
      render();
      const n = $('#recSearch');
      if(n){ n.focus(); n.setSelectionRange(p,p); }
    }, 180);
  });

  $('#recEmptyTgl')?.addEventListener('click', ()=>{ recOnlyEmpty = !recOnlyEmpty; render(); });
  $('#recSelAll')?.addEventListener('click', ()=>{
    if(recSel.size){ recSel.clear(); }
    else {
      const dishes = catalog.dishes.filter(d=>d.location_id===finLoc && d.active &&
        (!recFilter || d.name.includes(recFilter)) && (!recOnlyEmpty || !d.items.length));
      dishes.slice(0,200).forEach(d=>recSel.add(d.id));
    }
    render();
  });
  $('#main').querySelectorAll('[data-rsel]').forEach(c=>c.addEventListener('change', ()=>{
    if(c.checked) recSel.add(c.dataset.rsel); else recSel.delete(c.dataset.rsel);
    render();
  }));
  $('#bulkAdd')?.addEventListener('click', async ()=>{
    const ing = $('#bulkIng').value, qty = Number($('#bulkQty').value||0);
    if(!ing || !qty){ toast('Elige insumo y cantidad'); return; }
    try{
      await finRpc('inv_bulk_recipe', {p_dishes: [...recSel], p_ingredient: ing, p_qty: qty, p_remove: false});
      for(const id of recSel){
        const d = catalog.dishes.find(x=>x.id===id);
        const ex = d.items.find(r=>r.ingredient_id===ing);
        if(ex) ex.qty = qty; else d.items.push({ingredient_id: ing, qty});
      }
      toast(`Insumo aplicado a ${recSel.size} platillos`);
      recSel.clear(); render();
    }catch(e){}
  });
  $('#bulkDel')?.addEventListener('click', async ()=>{
    const ing = $('#bulkIng').value;
    if(!ing){ toast('Elige el insumo a quitar'); return; }
    try{
      await finRpc('inv_bulk_recipe', {p_dishes: [...recSel], p_ingredient: ing, p_qty: 0, p_remove: true});
      for(const id of recSel){
        const d = catalog.dishes.find(x=>x.id===id);
        d.items = d.items.filter(r=>r.ingredient_id!==ing);
      }
      toast(`Insumo quitado de ${recSel.size} platillos`);
      recSel.clear(); render();
    }catch(e){}
  });

  /* recipe editor */
  $('#main').querySelectorAll('[data-recedit]').forEach(b=>b.addEventListener('click', ()=>{
    const d = catalog.dishes.find(x=>x.id===b.dataset.recedit);
    recEditId = d.id;
    recDraft = d.items.map(ri=>({ingredient_id: ri.ingredient_id, qty: Number(ri.qty)}));
    render();
  }));
  $('#recCancel')?.addEventListener('click', ()=>{ recEditId=null; recDraft=null; render(); });
  $('#recAddIng')?.addEventListener('click', ()=>{
    const first = catalog.ingredients.find(i=>i.location_id===finLoc && i.active);
    recDraft.push({ingredient_id: first?first.id:'', qty: 0});
    render();
  });
  $('#main').querySelectorAll('[data-reing]').forEach(s=>s.addEventListener('change', ()=>{ recDraft[Number(s.dataset.reing)].ingredient_id = s.value; render(); }));
  $('#main').querySelectorAll('[data-reqty]').forEach(s=>s.addEventListener('change', ()=>{ recDraft[Number(s.dataset.reqty)].qty = Number(s.value||0); render(); }));
  $('#main').querySelectorAll('[data-redel]').forEach(b=>b.addEventListener('click', ()=>{ recDraft.splice(Number(b.dataset.redel),1); render(); }));
  // If no ingredients left, show a hint so user knows they can save empty

  $('#recSave')?.addEventListener('click', async ()=>{
    const d = catalog.dishes.find(x=>x.id===recEditId);
    const items = recDraft.filter(ri=>ri.ingredient_id && ri.qty>0);
    try{
      await finRpc('inv_save_dish', {p_id: d.id, p_loc: finLoc, p_name: d.name, p_items: items});
      d.items = items;
      toast('Receta guardada');
      recEditId=null; recDraft=null; render();
    }catch(e){}
  });
  $('#dishFrm')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const name = new FormData(e.target).get('dname').trim().toUpperCase();
    if(!name) return;
    try{
      const id = await finRpc('inv_save_dish', {p_id: null, p_loc: finLoc, p_name: name, p_items: []});
      let d = catalog.dishes.find(x=>x.id===id);
      if(!d){ d = {id, location_id:finLoc, name, active:true, items:[]}; catalog.dishes.push(d); }
      recFilter = name; recEditId = id; recDraft = [];
      toast('Platillo creado \u2014 agrega sus insumos');
      render();
    }catch(err){}
  });
}
/* ---------- factura PDF ---------- */
async function extractPdfText(file){
  await loadPdfJs();
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  const lines = [];
  for(let p=1; p<=pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = {};
    for(const it of tc.items){
      const y = Math.round(it.transform[5]);
      (rows[y] = rows[y]||[]).push({x: it.transform[4], s: it.str});
    }
    Object.keys(rows).map(Number).sort((a,b)=>b-a).forEach(y=>{
      const line = rows[y].sort((a,b)=>a.x-b.x).map(i=>i.s).join(' ').replace(/\s+/g,' ').trim();
      if(line) lines.push(line);
    });
  }
  return lines;
}
function parseInvoiceLines(lines){
  const out = [];
  for(const l of lines){
    if(/SUBTOTAL|^TOTAL|I\.?V\.?A|IMPORTE CON LETRA|R\.?F\.?C|FOLIO|FACTURA|CFDI|FORMA DE PAGO|USO/i.test(l)) continue;
    const nums = [...l.matchAll(/\d[\d,]*\.?\d*/g)].map(m=>m[0]);
    if(nums.length < 2) continue;
    const desc = l.replace(/\$/g,'').replace(/\d[\d,]*\.?\d*/g,' ').replace(/\s+/g,' ').trim();
    if(desc.length < 3) continue;
    const qty = numMX(nums[0]);
    const amount = numMX(nums[nums.length-1]);
    if(qty<=0 || amount<=0 || qty>100000) continue;
    out.push({desc: desc.toUpperCase(), qty, amount});
  }
  return out;
}
function aliasFor(desc){
  const list = (catalog.aliases||[]).filter(a=>a.location_id===finLoc);
  const dn = normName(desc);
  for(const a of list){ if(dn.includes(a.alias)) return a; }
  const ings = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active);
  for(const i of ings){ if(dn.includes(normName(i.name))) return {ingredient_id:i.id, factor:1}; }
  return null;
}
function facView(){
  const ings = catalog.ingredients.filter(i=>i.location_id===finLoc && i.active);
  if(!facLines){
    return `<div class="panel">
      <label>Sube la factura del proveedor (PDF)
        <input type="file" id="facFile" accept="application/pdf" style="min-height:48px;padding:10px;border:2px dashed var(--line);border-radius:12px;background:#FBFAF7;width:100%"></label>
      <p class="hint">La app lee la factura, detecta los productos y te deja mapear cada uno a un insumo del inventario (el mapeo se guarda y la pr\u00f3xima factura del mismo proveedor sale sola). Al aplicar: suma las cantidades a Compras de la semana seleccionada y registra el egreso en Movimientos.</p></div>`;
  }
  const opts = sel => `<option value="">\u2014 No inventariar \u2014</option>` +
    ings.map(i=>`<option value="${i.id}" ${sel===i.id?'selected':''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('');
  let h = `<div class="panel"><div class="frm-row-3">
    <label>Proveedor <input id="facProv" value="${esc(facMeta.prov)}" placeholder="Yoreme, Rancho 17\u2026" required></label>
    <label>Fecha (d\u00eda de consumo) <input type="date" id="facDate" value="${facMeta.date||todayStr()}"></label>
    <label>Total factura (MXN) <input type="number" step="0.01" min="0" id="facTotal" value="${facMeta.total||''}"></label></div></div>`;
  h += `<div class="res-wrap"><table class="res"><thead><tr><th></th><th>Producto en factura</th><th>Cant.</th><th>Insumo</th><th>Factor \u00d7</th><th>Suma al inventario</th></tr></thead><tbody>`;
  facLines.forEach((l,ix)=>{
    const add = l.ingredient_id ? Math.round(l.qty*l.factor*1000)/1000 : null;
    const ing = ings.find(i=>i.id===l.ingredient_id);
    h += `<tr><td><input type="checkbox" ${l.use?'checked':''} data-fuse="${ix}" aria-label="Incluir ${esc(l.desc)}"></td>
      <td style="text-align:left;white-space:normal;min-width:180px">${esc(l.desc)}</td>
      <td><input type="number" step="0.01" value="${l.qty}" data-fqty="${ix}" aria-label="Cantidad"></td>
      <td style="text-align:left"><select data-fing="${ix}" aria-label="Insumo">${opts(l.ingredient_id)}</select></td>
      <td><input type="number" step="0.001" value="${l.factor}" data-ffac="${ix}" aria-label="Factor"></td>
      <td class="tot2">${add===null?'\u2014':add+' '+(ing?esc(ing.unit):'')}</td></tr>`;
  });
  h += `</tbody></table></div>
  <p class="hint" style="margin-bottom:10px">Factor convierte unidades de la factura a unidades de inventario (ej. caja de 10 kg \u2192 factor 10). Marca solo las l\u00edneas correctas \u2014 el lector de PDF a veces agarra l\u00edneas de m\u00e1s.</p>
  <div class="frm-row"><button class="btn-primary" id="facApply">Aplicar a compras + registrar egreso</button>
  <button class="btn-quiet" id="facDrop">Descartar</button></div>`;
  return h;
}
async function wireFac(){
  $('#facFile')?.addEventListener('change', async e=>{
    const f = e.target.files[0]; if(!f) return;
    toast('Leyendo factura\u2026');
    try{
      const lines = await extractPdfText(f);
      const parsed = parseInvoiceLines(lines);
      if(!parsed.length){ toast('No detect\u00e9 productos en el PDF \u2014 \u00bfes un PDF escaneado (imagen)? Esos a\u00fan no se pueden leer.'); return; }
      facLines = parsed.map(p=>{
        const a = aliasFor(p.desc);
        return {...p, use: !!a, ingredient_id: a?a.ingredient_id:'', factor: a?Number(a.factor):1};
      });
      facMeta = {prov: (f.name||'').replace(/\.pdf$/i,'').replace(/[_-]/g,' ').slice(0,40), date: todayStr(),
                 total: Math.round(parsed.reduce((s,p)=>s+p.amount,0)*100)/100};
      render();
    }catch(err){ toast('No pude leer el PDF'); }
  });
  $('#facDrop')?.addEventListener('click', ()=>{ facLines=null; render(); });
  $('#main').querySelectorAll('[data-fuse]').forEach(c=>c.addEventListener('change', ()=>{ facLines[Number(c.dataset.fuse)].use = c.checked; }));
  $('#main').querySelectorAll('[data-fqty]').forEach(c=>c.addEventListener('change', ()=>{ facLines[Number(c.dataset.fqty)].qty = Number(c.value||0); render(); }));
  $('#main').querySelectorAll('[data-ffac]').forEach(c=>c.addEventListener('change', ()=>{ facLines[Number(c.dataset.ffac)].factor = Number(c.value||1); render(); }));
  $('#main').querySelectorAll('[data-fing]').forEach(c=>c.addEventListener('change', ()=>{
    const l = facLines[Number(c.dataset.fing)];
    l.ingredient_id = c.value; l.use = !!c.value; render();
  }));
  $('#facApply')?.addEventListener('click', async ()=>{
    facMeta.prov = $('#facProv').value.trim();
    facMeta.date = $('#facDate').value;
    facMeta.total = Number($('#facTotal').value||0);
    if(!facMeta.prov){ toast('Pon el nombre del proveedor'); return; }
    if(!facMeta.total){ toast('Pon el total de la factura'); return; }
    const adds = facLines.filter(l=>l.use && l.ingredient_id)
      .map(l=>({ingredient_id:l.ingredient_id, qty: Math.round(l.qty*l.factor*1000)/1000}));
    try{
      if(adds.length) await finRpc('inv_add_purchases', {p_week: dstr(invWeek), p_loc: finLoc, p_adds: adds});
      const lines = facLines.filter(l=>l.use && l.ingredient_id);
      await Promise.allSettled(lines.map(l=>
        finRpc('inv_save_alias', {p_loc: finLoc, p_alias: l.desc.slice(0,80), p_ingredient: l.ingredient_id, p_factor: l.factor})
          .then(()=>{
            const ca = (catalog.aliases||(catalog.aliases=[]));
            if(!ca.find(a=>a.location_id===finLoc && a.alias===normName(l.desc.slice(0,80))))
              ca.push({location_id:finLoc, alias:normName(l.desc.slice(0,80)), ingredient_id:l.ingredient_id, factor:l.factor});
          })
      ));
      await finRpc('fin_add_transaction', {p_date: facMeta.date, p_location: finLoc, p_kind: 'egreso',
        p_category: 'proveedores', p_concept: 'Factura ' + facMeta.prov, p_amount: facMeta.total, p_notes: null});
      toast(`Listo: ${adds.length} insumos sumados a compras + egreso ${money(facMeta.total)}`);
      facLines=null; invData=null; invEdit={}; refreshFinance(); refreshInvWeek();
    }catch(e){}
  });
}

/* ---------- corte de caja semanal ---------- */
const COR_DAYS = ['lun','mar','mie','jue','vie','sab','dom'];
