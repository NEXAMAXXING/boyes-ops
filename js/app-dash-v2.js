/* ============================================================
   Boye's OPS — Tablero de inicio
   ------------------------------------------------------------
   Una sola pantalla que conteste, sin picarle a nada: ¿cómo va la
   semana, contra la anterior, y en cuál de las dos sucursales está
   el problema?

   Regla de la casa: si un número no se puede calcular, la tarjeta
   se queda en su lugar y dice QUÉ FALTA para llenarla. Esconderla
   haría creer que el tablero está completo cuando no lo está.
   ============================================================ */

let dashData = null, dashError = null, dashCargando = false;
let dashLoc = 0;            // 0 = las dos sucursales, 1 Guaymas, 2 San Carlos

/* El periodo se arma con SEMANAS COMPLETAS porque así se guardan las ventas.
   Un "del 5 al 12" no existe en la base; pedirlo daría una ilusión de precisión
   que el dato no tiene. Por eso los rangos se eligen de semana a semana.

   «En vivo» es el periodo más corto de todos —el día que va corriendo— y por
   eso vive aquí y no en una pestaña aparte: es la misma pregunta («¿cómo
   vamos?») con otra ventana de tiempo. Se recuerda cuál quedó abierto, menos
   el personalizado, que sin sus fechas no significa nada. */
let dashPer = (() => {
  try {
    const v = localStorage.getItem('boyes_dash_per');
    return ['vivo','semana','mes','ano'].includes(v) ? v : 'semana';
  } catch(e){ return 'semana'; }
})();
let dashDesde = null, dashHasta = null;   // lunes de la primera y última semana

const D_VERDE = '#0E9F4F', D_ROJO = '#E01B0F';

/* La misma retención que usa el corte. Se repite aquí porque los dos
   archivos se cargan sueltos; si algún día cambia, cambia en los dos. */
const PROP_RET_DASH = 18;

async function refreshDash(){
  if(dashCargando) return;
  dashCargando = true; dashError = null;
  try{
    /* 104 semanas = dos años. Menos que eso y la vista anual no tiene contra
       qué comparar: el año pasado se quedaría fuera de la ventana. */
    dashData = await finRpc('dash_resumen', {p_semanas: 104,
      p_desde: dashDesde, p_hasta: dashHasta});
  }
  catch(e){ dashData = null; dashError = e?.message || 'No se pudo cargar el tablero'; }
  finally{ dashCargando = false; }
  render();
}

/* Devuelve las semanas del periodo y las del periodo anterior del mismo tamaño,
   a partir de la lista de semanas que existen de verdad. */
function dashRango(todas){
  const i = todas.indexOf(dashHasta) >= 0 ? todas.indexOf(dashHasta) : 0;
  if(dashPer==='rango' && dashDesde && dashHasta){
    const act = todas.filter(w => w>=dashDesde && w<=dashHasta);
    const ant = todas.filter(w => w<dashDesde).slice(0, act.length);
    return [act, ant];
  }
  if(dashPer==='mes'){
    const mes = (dashHasta||todas[0]||'').slice(0,7);
    const act = todas.filter(w => w.slice(0,7)===mes);
    const d = new Date((mes+'-01')+'T12:00'); d.setMonth(d.getMonth()-1);
    const mesAnt = d.toISOString().slice(0,7);
    return [act, todas.filter(w => w.slice(0,7)===mesAnt)];
  }
  if(dashPer==='ano'){
    const anio = (dashHasta||todas[0]||'').slice(0,4);
    const act = todas.filter(w => w.slice(0,4)===anio);
    const ant = String(Number(anio)-1);
    return [act, todas.filter(w => w.slice(0,4)===ant)];
  }
  const n = dashPer==='4sem' ? 4 : 1;
  return [todas.slice(i, i+n), todas.slice(i+n, i+n*2)];
}

function dashEtiquetaPeriodo(act){
  if(!act.length) return 'Sin semanas';
  const ini = act[act.length-1], fin = act[0];
  const f = new Date(fin+'T12:00'); f.setDate(f.getDate()+6);
  const fmt = x => x.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  if(act.length===1) return dSemLabel(fin);
  return `${fmt(new Date(ini+'T12:00'))} al ${fmt(f)}`;
}

/* ---------- utilidades ---------- */
const dPct = (hoy, antes) => (antes===null || antes===undefined || !Number(antes))
  ? null : (Number(hoy)-Number(antes))/Number(antes)*100;

function dDelta(p, alRevesEsBueno){
  if(p===null) return '<span class="d-delta d-nulo">sin comparación</span>';
  /* Redondeado a un decimal, un cambio de −0.04% se imprimía "-0.0%": un signo
     de menos delante de un cero. Si a un decimal no se mueve, no se movió. */
  if(Math.abs(p) < 0.05) return '<span class="d-delta" style="color:var(--ink-2)">sin cambio</span>';
  const bueno = alRevesEsBueno ? p<0 : p>0;
  return `<span class="d-delta" style="color:${bueno?D_VERDE:D_ROJO}">${p>0?'▲':'▼'} ${p>0?'+':''}${p.toFixed(1)}%</span>`;
}

function dSemLabel(iso){
  const d = new Date(iso+'T12:00'), f = new Date(d); f.setDate(f.getDate()+6);
  const fmt = x => x.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  return `${fmt(d)} al ${fmt(f)}`;
}

/* Las semanas de nómina corren de jueves a miércoles y las de venta de lunes a
   domingo. Se empareja cada nómina con la semana de venta que CONTIENE su día
   de inicio: la del jueves 13 pertenece a la venta del 10 al 16. Sin esto, el
   costo de nómina se compararía contra una venta que no le toca. */
function dNominaDe(nomina, semanaISO, loc){
  const ini = new Date(semanaISO+'T12:00'), fin = new Date(ini); fin.setDate(fin.getDate()+6);
  return nomina.filter(x=>{
    if(Number(x.loc)!==Number(loc)) return false;
    const d = new Date(x.semana+'T12:00');
    return d>=ini && d<=fin;
  }).reduce((s,x)=>s+Number(x.total||0), 0) || null;
}

/* ---------- bloques ---------- */
function dTile(rotulo, valor, delta, pie){
  return `<div class="d-tile">
    <div class="d-lbl">${rotulo}</div>
    <div class="d-val">${valor}</div>
    ${delta!==undefined?`<div class="d-sub">${delta}</div>`:''}
    ${pie?`<div class="d-pie">${pie}</div>`:''}
  </div>`;
}

/* La tarjeta que no se puede llenar todavía. Ocupa su lugar y dice qué falta:
   un hueco declarado enseña más que una tarjeta ausente. */
function dTilePendiente(rotulo, queFalta, comoSeArregla){
  return `<div class="d-tile d-pend">
    <div class="d-lbl">${rotulo}</div>
    <div class="d-val d-val-pend">—</div>
    <div class="d-sub" style="color:var(--warn);font-weight:700">${queFalta}</div>
    <div class="d-pie">${comoSeArregla}</div>
  </div>`;
}

function dBarras(filas, opts){
  const o = opts||{};
  if(!filas.length) return `<p class="hint">Sin datos.</p>`;
  const max = Math.max(...filas.map(f=>Math.abs(f.valor))) || 1;
  return `<div class="d-bars">${filas.map(f=>`
    <div class="d-bar">
      <span class="d-bar-n" title="${esc(f.nombre)}">${esc(f.nombre)}</span>
      <span class="d-bar-t"><span class="d-bar-f" style="width:${Math.max(2,Math.round(Math.abs(f.valor)/max*100))}%;background:${f.color||o.color||'var(--navy)'}"></span></span>
      <span class="d-bar-v">${o.fmt?o.fmt(f.valor):money(f.valor)}</span>
      ${f.extra!==undefined?`<span class="d-bar-x">${f.extra}</span>`:''}
    </div>`).join('')}</div>`;
}

/* Una línea sencilla de la venta semana a semana. No necesita librería: son
   cuatro puntos y una polilínea. */
function dLinea(valores, color){
  if(valores.length<2) return '';
  const w=260, h=54, min=Math.min(...valores), max=Math.max(...valores), rango=(max-min)||1;
  const pts = valores.map((v,i)=>[
    (i/(valores.length-1))*w,
    h - ((v-min)/rango)*(h-8) - 4
  ]);
  const d = pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${w},${h} L0,${h} Z`;
  return `<svg class="d-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity=".10"></path>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>
    <circle cx="${pts[pts.length-1][0].toFixed(1)}" cy="${pts[pts.length-1][1].toFixed(1)}" r="3.5" fill="${color}"></circle>
  </svg>`;
}

/* Los pendientes de mantenimiento viven en otro módulo. Si ese falla, el
   tablero entero se caía con él: aquí se aísla para que un problema en una
   tarjeta no borre las otras diez. */
function dPendientes(){
  try{ return adminSummary(); }
  catch(e){ return `<p class="hint">No se pudieron cargar los pendientes de mantenimiento.</p>`; }
}

/* Los periodos, de la ventana más corta a la más larga. «En vivo» no lleva
   los desplegables de semana: no hay semana que elegir cuando el periodo es
   el día que va corriendo. */
function dashPerSwitch(todasSem, semAct){
  const OPC = [['vivo','En vivo'],['cuentas','Cuentas'],['semana','Semana'],['mes','Mes'],
               ['ano','Año'],['rango','Personalizado']];
  let h = `<div class="d-per">
    <div class="switch" role="group" aria-label="Periodo">
      ${OPC.map(([v,l])=>`<button aria-pressed="${dashPer===v}" data-dper="${v}">${l}</button>`).join('')}
    </div>`;
  if(dashPer==='vivo'){
    h += `<div class="d-per-r"><span class="hint">El día de hoy, mientras pasa. Se actualiza solo cada minuto.</span></div>`;
  } else if(dashPer==='cuentas'){
    /* Cuentas trae su propia ventana (Turno / Periodo / Anual) y sus propias
       fechas: aquí no van los desplegables de semana, que se arman con las
       semanas guardadas en Inventario y no tienen nada que ver con los folios
       del punto de venta. */
    h += `<div class="d-per-r"><span class="hint">Cuenta por cuenta, como en «Consulta de cuentas» del punto de venta.</span></div>`;
  } else if(dashPer==='rango'){
    h += `<div class="d-per-r">
      <label>De la semana del
        <select data-dw="desde">${todasSem.slice().reverse().map(w=>`<option value="${w}" ${w===dashDesde?'selected':''}>${dSemLabel(w)}</option>`).join('')}</select></label>
      <label>a la del
        <select data-dw="hasta">${todasSem.slice().reverse().map(w=>`<option value="${w}" ${w===dashHasta?'selected':''}>${dSemLabel(w)}</option>`).join('')}</select></label>
    </div>`;
  } else {
    h += `<div class="d-per-r"><label>Termina en
      <select data-dw="hasta">${todasSem.map(w=>`<option value="${w}" ${w===dashHasta?'selected':''}>${dSemLabel(w)}</option>`).join('')}</select></label>
      <span class="hint">${semAct.length} semana${semAct.length===1?'':'s'} · los periodos se arman con semanas completas, que es como se guardan las ventas.</span></div>`;
  }
  return h + `</div>`;
}

/* ---------- la vista ---------- */
function dashView(){
  /* En vivo va ANTES de todo lo demás: no necesita las semanas guardadas ni
     el tablero cargado, y ponerlo después obligaría a esperar una consulta
     que no usa. */
  if(dashPer==='vivo')
    return dashPerSwitch([], []) + (typeof vivoView==='function'
      ? vivoView()
      : `<div class="panel"><p class="hint">No se pudo cargar la vista En vivo.</p></div>`);
  /* Cuentas, igual: le pregunta directo al punto de venta y no necesita el
     tablero de semanas. Si esperara por él, entrar a ver un folio obligaría a
     cargar medio año de ventas que no va a usar. */
  if(dashPer==='cuentas')
    return dashPerSwitch([], []) + (typeof ctasView==='function'
      ? ctasView()
      : `<div class="panel"><p class="hint">No se pudo cargar la Consulta de cuentas.</p></div>`);
  if(dashError) return `<div class="panel"><p style="font-weight:700">${esc(dashError)}</p>
    <button class="btn-primary" id="dashRetry">Reintentar</button></div>` + dPendientes();
  if(!dashData){ if(!dashCargando) refreshDash();
    return `<div class="panel"><p class="hint">Cargando el tablero…</p></div>` + dPendientes(); }

  const D = dashData;
  const semanas = D.semanas||[], nomina = D.nomina||[], cortes = D.cortes||[],
        merma = D.merma||[], productos = D.productos||[], salud = D.salud||{};

  /* Las dos semanas más recientes que tengan venta: todo el tablero compara
     contra la anterior, igual que el resumen de un punto de venta. */
  const todasSem = [...new Set(semanas.map(s=>s.semana))].sort().reverse();
  if(!todasSem.length) return `<div class="panel"><p class="hint">Todavía no hay ventas guardadas. En cuanto guardes la primera semana en Inventario, aquí aparece el tablero.</p></div>` + dPendientes();
  if(!dashHasta) dashHasta = todasSem[0];

  const [semAct_, semAnt_] = dashRango(todasSem);
  const semAct = semAct_, semAnt = semAnt_;

  const locs = dashLoc ? [dashLoc] : [1,2];
  const enPer = (arr, sems, loc) => arr.filter(x => sems.includes(x.semana) && (loc?Number(x.loc)===loc:true));
  const ventaDe = (sem, loc) => semanas.filter(s=>s.semana===sem && (loc?Number(s.loc)===loc:true));
  const suma = (arr, campo) => arr.reduce((a,b)=>a+Number(b[campo]||0),0);

  const actF = enPer(semanas, semAct, dashLoc||0), antF = enPer(semanas, semAnt, dashLoc||0);
  const vAct = suma(actF,'venta'), vAnt = suma(antF,'venta');
  const uAct = suma(actF,'unidades'), uAnt = suma(antF,'unidades');
  const tAct = uAct? vAct/uAct : 0, tAnt = uAnt? vAnt/uAnt : 0;

  const nomEn = sems => locs.reduce((s,l)=>s + sems.reduce((a,w)=>a+(dNominaDe(nomina,w,l)||0),0), 0);
  const nomAct = nomEn(semAct), nomAnt = nomEn(semAnt);
  const pctNomAct = (nomAct && vAct) ? nomAct/vAct*100 : null;
  const pctNomAnt = (nomAnt && vAnt) ? nomAnt/vAnt*100 : null;

  /* ---- PROPINA DE TARJETA ----
     El cliente la deja en el voucher y al personal se le paga en efectivo,
     menos la retención. Aquí interesa el PORCENTAJE: cuánto está dejando la
     gente sobre lo que consume. Un mes al 5% y otro al 7% dice cosas del
     servicio que la venta sola no dice. */
  const corAct = enPer(cortes, semAct, dashLoc||0), corAnt = enPer(cortes, semAnt, dashLoc||0);
  const propAct = suma(corAct,'propina'), propAnt = suma(corAnt,'propina');
  const vouAct  = suma(corAct,'vouchers'), vouAnt  = suma(corAnt,'vouchers');
  const ppAct = vouAct>0 ? propAct/vouAct*100 : null;
  const ppAnt = vouAnt>0 ? propAnt/vouAnt*100 : null;
  const propNeta = Math.round(propAct * (100-PROP_RET_DASH)) / 100;
  /* Semanas donde hubo venta con tarjeta pero nadie capturó la propina: sin
     avisarlo, el promedio del periodo sale bajo y parece mal servicio. */
  const corSinProp = corAct.filter(c=>Number(c.vouchers||0)>0 && !Number(c.propina||0)).length;

  const rotulo = {semana:'Semana del', '4sem':'Cuatro semanas', mes:'Mes de',
                  ano:'Año', rango:'Del'}[dashPer];
  let h = `<div class="d-head">
      <div>
        <div class="d-eyebrow">${rotulo}</div>
        <h2 class="d-titulo">${dashEtiquetaPeriodo(semAct)}</h2>
        <p class="hint" style="margin:2px 0 0">${semAnt.length
          ? `Comparado contra ${dashEtiquetaPeriodo(semAnt)}${semAnt.length!==semAct.length?` <b>(solo ${semAnt.length} de ${semAct.length} semanas: no hay más historial)</b>`:''}`
          : 'No hay periodo anterior con qué comparar.'}</p>
      </div>
      <div class="switch d-switch" role="group" aria-label="Sucursal">
        <button aria-pressed="${dashLoc===0}" data-dloc="0">Las dos</button>
        <button aria-pressed="${dashLoc===1}" data-dloc="1">Guaymas</button>
        <button aria-pressed="${dashLoc===2}" data-dloc="2">San Carlos</button>
      </div>
    </div>`;

  /* ---- selector de periodo ---- */
  h += dashPerSwitch(todasSem, semAct);

  /* ---- 1. los cuatro números de arriba ---- */
  h += `<div class="d-tiles">
    ${dTile('Venta total', money(vAct), dDelta(dPct(vAct,vAnt)), semAnt.length?`antes ${money(vAnt)}`:'')}
    ${dTile('Unidades vendidas', uAct.toLocaleString('es-MX'), dDelta(dPct(uAct,uAnt)), semAnt.length?`antes ${uAnt.toLocaleString('es-MX')}`:'')}
    ${dTile('Venta por unidad', money(tAct), dDelta(dPct(tAct,tAnt)), 'venta ÷ unidades')}
    ${pctNomAct!==null
      ? dTile('Nómina sobre venta', pctNomAct.toFixed(1)+'%',
              dDelta(dPct(pctNomAct,pctNomAnt), true), `${money(nomAct)} de nómina`)
      : dTilePendiente('Nómina sobre venta', `Falta la nómina de ${semAct.length>1?'este periodo':'esta semana'}`,
              'En cuanto se guarde en Nómina, aparece aquí')}
  </div>`;

  /* ---- 1b. propina de tarjeta ---- */
  h += `<div class="d-tiles">
    ${ppAct!==null
      ? dTile('Propina sobre tarjeta', ppAct.toFixed(1)+'%', dDelta(dPct(ppAct,ppAnt)),
              `${money(propAct)} sobre ${money(vouAct)} de venta con tarjeta`)
      : dTilePendiente('Propina sobre tarjeta', 'Falta la venta con tarjeta del periodo',
              'Se llena al capturar el corte de caja')}
    ${dTile('Propina declarada', money(propAct), dDelta(dPct(propAct,propAnt)),
            semAnt.length?`antes ${money(propAnt)}`:'lo que dejó el cliente en el voucher')}
    ${dTile('Propina a pagar', money(propNeta), undefined,
            `${money(propAct)} − ${PROP_RET_DASH}% de retención (${money(Math.round(propAct*PROP_RET_DASH)/100)})`)}
    ${dTile('Venta con tarjeta', money(vouAct), dDelta(dPct(vouAct,vouAnt)),
            semAnt.length?`antes ${money(vouAnt)}`:'vouchers del corte')}
  </div>`;
  if(corSinProp)
    h += `<p class="hint" style="margin:-4px 0 12px">⚠️ ${corSinProp} corte${corSinProp===1?'':'s'} de este periodo tiene${corSinProp===1?'':'n'} venta con tarjeta pero la propina en cero. El porcentaje sale más bajo de lo real hasta que se capture.</p>`;

  /* ---- 2. costos: el bloque que hoy no se puede llenar ---- */
  const mermaAct = enPer(merma, semAct, dashLoc||0);
  const mermaU = suma(mermaAct,'unidades'), contados = suma(mermaAct,'insumos_contados');
  h += `<div class="d-tiles">
    ${salud.sin_precio>0
      ? dTilePendiente('Costo de alimentos', `${salud.inventariables_sin_precio} insumos sin precio`,
          'Es el número que más manda en un restaurante. Se desbloquea cargando el precio de los insumos que se inventarían.')
      : dTile('Costo de alimentos', '—', undefined, '')}
    ${salud.sin_precio>0
      ? dTilePendiente('Merma en pesos', 'Los insumos valen $0',
          `Hoy solo se puede medir en kilos y piezas. Con precios, esto te dice cuánto dinero se está yendo.`)
      : dTile('Merma en pesos', money(suma(mermaAct,'pesos')), undefined, '')}
    ${contados
      ? dTile('Merma en kilos y piezas', (mermaU>=0?'+':'')+mermaU.toFixed(1), undefined,
              `sobre ${contados} insumos contados${mermaU<0?' · falta producto':(mermaU>0?' · sobra producto':'')}`)
      : dTilePendiente('Merma en kilos y piezas', `Falta el conteo físico de ${semAct.length>1?'este periodo':'esta semana'}`,
              'Se llena al capturar el inventario')}
    ${dTile('Catálogo', `${salud.platillos} platillos`, undefined, `${salud.insumos} insumos · ${salud.sin_precio} sin precio`)}
  </div>`;

  /* ---- 3. sucursal contra sucursal ---- */
  if(!dashLoc){
    h += `<div class="panel"><div class="d-h3">Sucursal contra sucursal</div>`;
    h += `<div class="d-locs">`;
    for(const l of [1,2]){
      const A = enPer(semanas, semAct, l), B = enPer(semanas, semAnt, l);
      const va = suma(A,'venta'), vb = B.length ? suma(B,'venta') : null;
      const ua = suma(A,'unidades');
      const nl = semAct.reduce((acc,w)=>acc+(dNominaDe(nomina,w,l)||0), 0) || null;
      const serie = todasSem.slice().reverse()
        .map(s=>{ const r = ventaDe(s,l)[0]; return r?Number(r.venta):null; })
        .filter(v=>v!==null);
      h += `<div class="d-loc">
        <div class="d-loc-n">${LOCS[l]}</div>
        <div class="d-loc-v">${money(va)}</div>
        <div class="d-sub">${dDelta(dPct(va,vb))}</div>
        ${dLinea(serie, l===1?'var(--navy)':'#0E9F4F')}
        <div class="d-loc-f">
          <span>${ua.toLocaleString('es-MX')} unidades</span>
          <span>${ua?money(va/ua):'—'} por unidad</span>
          <span>${nl&&va?`nómina ${(nl/va*100).toFixed(1)}%`:'nómina pendiente'}</span>
        </div>
      </div>`;
    }
    h += `</div></div>`;
  }

  /* ---- 4. formas de pago ---- */
  if(corAct.length){
    const ef = suma(corAct,'efectivo'), tj = suma(corAct,'tarjeta'), tot = ef+tj;
    const prop = suma(corAct,'propina');
    h += `<div class="d-cols">
      <div class="panel"><div class="d-h3">Cómo pagaron</div>
        ${dBarras([
          {nombre:'Efectivo', valor:ef, color:'#0E9F4F', extra: tot?((ef/tot*100).toFixed(1)+'%'):''},
          {nombre:'Tarjeta',  valor:tj, color:'var(--navy)', extra: tot?((tj/tot*100).toFixed(1)+'%'):''}
        ])}
        <p class="hint" style="margin:8px 0 0">Las transferencias se capturan en el punto de venta como efectivo, así que van dentro de esa barra.</p>
      </div>
      <div class="panel"><div class="d-h3">Lo que no entró a caja</div>
        ${dBarras([
          {nombre:'Cortesías',  valor:suma(corAct,'cortesias'),  color:'#E0A100'},
          {nombre:'Descuentos', valor:suma(corAct,'descuentos'), color:'#E0A100'},
          {nombre:'Propina de tarjeta', valor:prop, color:'var(--ink-2)',
           extra: tj?((prop/tj*100).toFixed(1)+'% sobre tarjeta'):''}
        ])}
        <p class="hint" style="margin:8px 0 0">${suma(corAct,'canceladas')} cuenta(s) cancelada(s) en el periodo.</p>
      </div></div>`;
  }

  /* ---- 5. productos: los que jalan y los que estorban ---- */
  for(const l of locs){
    const P = productos.filter(p=>Number(p.loc)===l);
    if(!P.length) continue;
    const conVenta = P.filter(p=>Number(p.importe)>0);
    const top = conVenta.slice(0,10);
    /* Con pocos productos, tomar los últimos diez devolvía los MISMOS que el
       top y la tarjeta mentía. Se excluye lo que ya salió arriba. */
    const enTop = new Set(top.map(p=>p.name));
    const bottom = conVenta.filter(p=>!enTop.has(p.name)).slice(-10).reverse();
    const cats = {};
    for(const p of P){ const c=p.category||'SIN CATEGORÍA'; cats[c]=(cats[c]||0)+Number(p.importe||0); }
    const catFilas = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,10)
      .map(([n,v])=>({nombre:n, valor:v}));

    h += `<div class="panel"><div class="d-h3">${LOCS[l]} · qué se vendió</div>
      <div class="d-cols3">
        <div><div class="d-h4">Por categoría</div>${dBarras(catFilas,{color:'var(--navy)'})}</div>
        <div><div class="d-h4">Los 10 que más jalan</div>
          ${dBarras(top.map(p=>({nombre:p.name, valor:Number(p.importe), color:D_VERDE,
                                extra:Number(p.unidades).toLocaleString('es-MX')+' u'})))}</div>
        <div><div class="d-h4">Los 10 que menos se mueven</div>
          ${dBarras(bottom.map(p=>({nombre:p.name, valor:Number(p.importe), color:'#B9A98A',
                                    extra:Number(p.unidades).toLocaleString('es-MX')+' u'})))}
          <p class="hint" style="margin:8px 0 0">Candidatos a salir de la carta o a revisar precio.</p></div>
      </div></div>`;
  }

  /* ---- 6. lo que hay que atender ---- */
  h += `<div class="panel"><div class="d-h3">Pendientes</div>${dPendientes()}</div>`;
  return h;
}

function wireDash(){
  $('#dashRetry')?.addEventListener('click', ()=>{ dashData=null; refreshDash(); });
  /* Cambiar de periodo vuelve a pedir los datos porque los productos se suman
     del lado del servidor: el navegador no tiene los renglones del año. */
  $('#main').querySelectorAll('[data-dper]').forEach(b=>b.addEventListener('click', ()=>{
    dashPer = b.dataset.dper;
    try{ if(dashPer!=='rango') localStorage.setItem('boyes_dash_per', dashPer); }catch(e){}
    /* En vivo y Cuentas no consultan la base de las semanas: solo se repintan
       y ellos mismos le preguntan al punto de venta. */
    if(dashPer==='vivo' || dashPer==='cuentas'){ render(); return; }
    if(dashPer==='rango' && !dashDesde) dashDesde = dashHasta;
    /* Si se entró directo a En vivo, el tablero nunca se pidió. aplicaPeriodo
       se saldría sin repintar y la pantalla quedaría en blanco; dashView pide
       los datos él solo en cuanto le toca pintarse. */
    if(!dashData){ render(); return; }
    aplicaPeriodo();
  }));
  $('#main').querySelectorAll('[data-dw]').forEach(sel=>sel.addEventListener('change', ()=>{
    if(sel.dataset.dw==='hasta') dashHasta = sel.value; else dashDesde = sel.value;
    if(dashDesde && dashHasta && dashDesde > dashHasta){
      /* Si se invierten, se acomodan solos en vez de devolver un periodo vacío. */
      const t = dashDesde; dashDesde = dashHasta; dashHasta = t;
    }
    aplicaPeriodo();
  }));
  $('#main').querySelectorAll('[data-dloc]').forEach(b=>b.addEventListener('click', ()=>{
    dashLoc = Number(b.dataset.dloc); render();
  }));
}

/* Traduce el periodo elegido a las dos fechas que el servidor necesita para
   sumar los productos, y vuelve a pedir. */
function aplicaPeriodo(){
  const todas = [...new Set((dashData?.semanas||[]).map(x=>x.semana))].sort().reverse();
  if(!todas.length) return;
  const [act] = dashRango(todas);
  if(act.length){ dashDesde = act[act.length-1]; dashHasta = act[0]; }
  dashData = null; refreshDash();
}
