/* Retención sobre la propina de tarjeta, en por ciento.
   Vive aquí arriba y con nombre porque el día que cambie la tasa, se cambia
   en un solo lugar y no hay que ir a cazar 0.18 regados por el archivo. */
const PROP_RETENCION = 18;

/* Debajo de esto la semana se declara CUADRADA. Con ciento y pico de cuentas,
   unos pesos son redondeo, no un problema; marcarlos en rojo entrena a la
   gente a ignorar el rojo, que es justo lo que no queremos el día que de
   verdad falte dinero. El número exacto se sigue imprimiendo siempre. */
const COR_TOLERANCIA = 50;

async function refreshCor(){
  /* La merma se paga con una semana de retraso: el inventario de la semana que
     se está cortando todavía no se cuenta cuando se paga la propina. Así que
     lo que se descuenta aquí es lo que faltó la semana ANTERIOR. */
  const semAnt = new Date(corWeek); semAnt.setDate(semAnt.getDate() - 7);
  try{
    const [cor, sw, mer] = await Promise.all([
      finRpc('cor_get', {p_week: dstr(corWeek), p_loc: finLoc}),
      finRpc('inv_get_week', {p_week: dstr(corWeek), p_loc: finLoc}),
      /* Si esa semana no se inventarió, no se inventa un descuento: se avisa. */
      finRpc('cor_merma_faltantes', {p_week: dstr(semAnt), p_loc: finLoc}).catch(()=>null)
    ]);
    corData = cor;
    corData._st = sw && sw.sales && sw.sales.saved ? Number(sw.sales.total_amount||0) : 0;
    corData._mermaAnt = (mer === null || mer === undefined) ? null : Number(mer);
    corData._semAnt = dstr(semAnt);
  }
  catch(e){ corData=null; return; }
  corEdit = null;
  render();
}
function corInitEdit(){
  if(corEdit) return corEdit;
  const d = corData.saved ? corData : {};
  corEdit = {
    ef_decl: Number(d.ef_decl||0), tj_decl: Number(d.tj_decl||0),
    depositos: Number(d.depositos||0), retiros: Number(d.retiros||0),
    ef_final_decl: Number(d.ef_final_decl||0), venta_neta: corData.saved ? Number(d.venta_neta||0) : 0,
    venta_imp: corData.saved ? Number(d.venta_imp||0) : 0,
    ef_real: corData.saved && d.ef_real!=null ? Number(d.ef_real) : '',
    /* El efectivo y las transferencias ahora se capturan día por día, igual que
       los vouchers de tarjeta. El total de la semana es la suma. */
    ef_days: corData.saved ? Object.assign({lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""}, d.ef_days||{}) : {lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""},
    tr_days: corData.saved ? Object.assign({lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""}, d.tr_days||{}) : {lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""},
    tj_propina: corData.saved ? Number(d.tj_propina||0) : '',
    tp_days: corData.saved ? Object.assign({lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""}, d.tp_days||{}) : {lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""},
    cortesias: corData.saved ? Number(d.cortesias||0) : '',
    dsc_alimentos: corData.saved ? Number(d.dsc_alimentos||0) : '',
    dsc_bebidas: corData.saved ? Number(d.dsc_bebidas||0) : '',
    dsc_otros: corData.saved ? Number(d.dsc_otros||0) : '',
    ctas_cortesia: corData.saved ? Number(d.ctas_cortesia||0) : '',
    ctas_dscto: corData.saved ? Number(d.ctas_dscto||0) : '',
    ctas_canceladas: corData.saved ? Number(d.ctas_canceladas||0) : '',
    /* Las otras formas de pago de Guaymas. Sin ellas, la suma de formas nunca
       alcanzaba las ventas con IVA y el corte parecía tener un faltante que
       no existía: solo faltaba dónde ponerlas. */
    rappi: corData.saved ? Number(d.rappi||0) : '',
    maquilas: corData.saved ? Number(d.maquilas||0) : '',
    tc_days: corData.saved ? Object.assign({lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""}, d.tc_days||{}) : {lun:"",mar:"",mie:"",jue:"",vie:"",sab:"",dom:""},
    notes: d.notes||'',
    retiros_pend: corData.saved && d.retiros_pend ? d.retiros_pend : [{fecha:'',concepto:'',monto:''},{fecha:'',concepto:'',monto:''},{fecha:'',concepto:'',monto:''},{fecha:'',concepto:'',monto:''}]
  };
  return corEdit;
}

function xlsxToCorteText(ws){
  const cv=(r,c)=>{ const cell=ws[XLSX.utils.encode_cell({r:r-1,c:c-1})]; return cell?cell.v:null; };
  const n=(r,c)=>{ const v=cv(r,c); return v!=null&&v!==''?Number(v):0; };
  return [
    `+EFECTIVO: $${n(5,2)}`,`+TARJETA: $${n(6,2)}`,
    `+DEPOSITOS EFE $${n(9,2)}`,`-RETIROS EFECT $${n(10,2)}`,
    ` EFECTIVO FINA $${n(13,2)}`,
  ].join('\n');
}
const prvSinEspacios = x => String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toUpperCase().replace(/[^A-Z0-9]/g,'');

function parseCorte(text){
  // Normalize: collapse runs of spaces so patterns are simpler
  const t = text.replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n');
  const grab = (re)=>{ const m = t.match(re); return m ? numMX(m[1].replace(/,/g,'')) : null; };
  const r = {
    ef_decl:      grab(/\+EFECTIVO\s*:?\s*\$?([\d,]+\.?\d*)/i),
    tj_decl:      grab(/\+TARJETA\s*:?\s*\$?([\d,]+\.?\d*)/i),
    depositos:    grab(/\+?DEP[O\u00d3]SITOS?\s*EFE[^\n]*?\$?([\d,]+\.?\d*)/i),
    retiros:      grab(/-?RETIROS?\s*EFEC[^\n]*?\$?([\d,]+\.?\d*)/i),
    ef_final_decl:grab(/EFECTIVO\s*FINA[^\n]*?\$?([\d,]+\.?\d*)/i),
    venta_neta:   grab(/VENTA\s*NETA\s*:\s*\$?([\d,]+\.?\d*)/i),
    venta_imp:    grab(/VENTAS?\s*CON\s*IMP\.?:?\s*\$?([\d,]+\.?\d*)/i),
    /* Etiquetas tal como salen en el Corte de Caja del sistema:
         TOTAL CORTESIAS : $1,167.25   ·  DESCUENTO ALIMENTOS : $55.60
         CUENTAS CON CORTESIA : 3      ·  CUENTAS CANCELADAS :0        */
    cortesias:       grab(/TOTAL\s*CORTESIAS?\s*:?\s*\$?([\d,]+\.?\d*)/i),
    dsc_alimentos:   grab(/DESCUENTO\s*ALIMENTOS\s*:?\s*\$?([\d,]+\.?\d*)/i),
    dsc_bebidas:     grab(/DESCUENTO\s*BEBIDAS\s*:?\s*\$?([\d,]+\.?\d*)/i),
    dsc_otros:       grab(/DESCUENTO\s*OTROS\s*:?\s*\$?([\d,]+\.?\d*)/i),
    ctas_cortesia:   grab(/CUENTAS\s*CON\s*CORTESIA\s*:?\s*\$?([\d,]+\.?\d*)/i),
    ctas_dscto:      grab(/CUENTAS\s*CON\s*DESCUENTO\s*:?\s*\$?([\d,]+\.?\d*)/i),
    ctas_canceladas: grab(/CUENTAS\s*CANCELADAS\s*:?\s*\$?([\d,]+\.?\d*)/i),
    /* En el bloque FORMA DE PAGO VENTAS del corte, Guaymas trae estos dos
       renglones más. Se leen igual que el efectivo y la tarjeta. */
    rappi:    grab(/RAPPI\s*:?\s*\$?([\d,]+\.?\d*)/i),
    maquilas: grab(/MAQUILAS?[^\n$]*?\$?([\d,]+\.?\d*)/i)
  };

  /* ============================================================
     De QUÉ SUCURSAL y de QUÉ FECHAS es este corte
     ------------------------------------------------------------
     Los números del corte de una sucursal comparados contra lo que
     el punto de venta trae de la otra nunca van a cuadrar, y la
     pantalla no tenía forma de darse cuenta: enseñaba Guaymas
     $121,861 al lado de un corte impreso de San Carlos por
     $133,593.50 y parecía que el lector estaba mal.

     El propio corte lo dice: trae el domicilio de la sucursal y el
     rango de fechas. Se leen y se comparan contra lo que está
     seleccionado en la pantalla.
     ============================================================ */
  /* El domicilio NO sirve para distinguirlas: los dos cortes imprimen
     "SECTOR CRESTON" y los dos dicen "GUAYMAS" — el de San Carlos porque su
     dirección es "SAN CARLOS NUEVO GUAYMAS". Encima el PDF parte las palabras
     a la mitad ("CREST" en una línea y "ON" en la siguiente). Se compara
     contra el texto sin espacios y con tres señales que sí separan:

       · "SANCARLOS" aparece solo en el de San Carlos.
       · RAPPI y MAQUILAS solo los cobra Guaymas.
       · El folio: son dos puntos de venta distintos y sus series van a
         diez mil de distancia (Guaymas ~29,500 · San Carlos ~39,800).

     Si las señales se contradicen, no se decide nada: más vale no saber que
     bloquear un corte bueno. */
  const T = t.toUpperCase();
  const P = prvSinEspacios(T);
  const votos = [];
  if(/SANCARLOS/.test(P)) votos.push(2);
  if(/\bRAPPI\b|\bMAQUILAS?\b/.test(T)) votos.push(1);
  const folio = (()=>{ const m = T.match(/FOLIO\s*INICIAL\s*:?\s*(\d{3,})/); return m ? Number(m[1]) : null; })();
  if(folio) votos.push(folio < 35000 ? 1 : 2);
  r.folio_inicial = folio;
  r.sucursal = votos.length && votos.every(v => v === votos[0]) ? votos[0] : null;

  /* El rango que dice el propio corte: "DEL 31/08/2026 ... AL 06/09/2026". */
  const fecha = re => { const m = t.match(re); if(!m) return null;
    const [,d,mm,a] = m; return `${a}-${String(mm).padStart(2,'0')}-${String(d).padStart(2,'0')}`; };
  r.desde = fecha(/DEL\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  r.hasta = fecha(/\bAL\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);

  return Object.values(r).some(v=>v!==null) ? r : null;
}
/* Lo que trajo la API la última vez. Vive aparte de lo capturado para poder
   enseñar las dos versiones lado a lado en vez de que una borre a la otra. */
let corAPI = null;
/* Resumen de la última lectura del PDF, para que se vea que sí entró. */
let corLeido = null;
let corEditable = false;   // los datos del corte están bloqueados por defecto
/* Una vez guardado el corte, la captura por día también se cierra: así nadie
   le mueve un número sin querer a una semana que ya se cuadró. Se abre a
   propósito con el botón «Editar corte». */
let corDiasEditable = false;
/* Todos los números derivados del corte, en un solo lugar.

   Antes vivían sueltos dentro de la pantalla. Se sacaron aquí porque el
   reporte en PDF tiene que enseñar exactamente lo mismo que la pantalla:
   si cada uno hiciera su propia cuenta, tarde o temprano dirían cosas
   distintas del mismo corte, y ese es justo el error que este módulo
   existe para encontrar. */
function corNumeros(ed){
  const sumaDias = obj => COR_DAYS.reduce((s,k)=>s+Number(obj[k]||0),0);
  const tcReal = sumaDias(ed.tc_days);
  const hayEfDias = COR_DAYS.some(k=>ed.ef_days[k]!=='' && ed.ef_days[k]!=null);
  /* Si ya se capturó por día se usa esa suma; si es un corte viejo, se respeta
     el número que se había guardado a mano. */
  const efTotal = hayEfDias ? sumaDias(ed.ef_days) : (ed.ef_real==='' ? null : numMX(ed.ef_real));
  const trTotal = sumaDias(ed.tr_days);
  const hayTpDias = COR_DAYS.some(k=>ed.tp_days[k]!=='' && ed.tp_days[k]!=null);
  const propTotal = hayTpDias ? sumaDias(ed.tp_days) : Number(ed.tj_propina||0);
  const tjConPropina = tcReal + propTotal;
  const totRP = ed.retiros_pend ? ed.retiros_pend.reduce((s,r)=>s+numMX(r.monto||0),0) : 0;
  const efAdj = efTotal===null ? null : efTotal - totRP;

  /* En caja capturan las transferencias como si fueran venta en efectivo, así
     que el efectivo que marca el corte trae dinero que nunca entró al cajón.
     Para comparar peras con peras se le descuenta lo que se cobró por
     transferencia: eso es el efectivo que SÍ debería estar físicamente. */
  const efEsperado = Number(ed.ef_final_decl||0) - trTotal;
  const difEf = efAdj===null ? null : efAdj - efEsperado;

  /* La cajera declara la tarjeta SIN la propina, así que meter la propina en
     la comparación inventaba un sobrante que no existía. Se compara voucher
     contra voucher, y la propina se reporta aparte. */
  const difTj = tcReal - Number(ed.tj_decl||0);
  const difTot = (difEf===null?0:difEf) + difTj;

  /* Las formas de pago de la venta son TODAS: efectivo, tarjeta y las de
     Guaymas. Comparadas contra las ventas con IVA del corte, dicen si el
     corte está completo o si se quedó algo sin capturar. */
  const otrasFormas = Number(ed.rappi||0) + Number(ed.maquilas||0);
  const formasPago = Number(ed.ef_decl||0) + Number(ed.tj_decl||0) + otrasFormas;
  const difFormas = Number(ed.venta_imp||0) > 0 ? formasPago - Number(ed.venta_imp||0) : null;
  /* ---- PROPINA DE TARJETA ----
     El cliente la deja en el voucher, o sea que entra al banco, no al cajón.
     Al personal se le paga en efectivo, y de ahí se retiene el ISR que marca
     la ley para propinas. Lo que se entrega es el neto.

     El porcentaje se calcula contra la venta con tarjeta SIN propina —que es
     justo lo que declara la cajera— porque lo que interesa saber es cuánto
     dejó el cliente sobre lo que consumió, no sobre lo que firmó. */
  /* ---- EL RESULTADO DE LA SEMANA, EN UN SOLO NÚMERO ----
     Efectivo, tarjeta y transferencia no son tres cajas separadas: son tres
     puertas del mismo negocio. Si una cuenta se cobró en efectivo y la
     cajera la registró como tarjeta, el efectivo sobra y la tarjeta falta
     por el mismo importe — y no falta un peso.

     Por eso lo que se presenta como resultado es la suma de las tres contra
     lo que el corte dice que debió entrar. Las diferencias por canal siguen
     abajo, pero como desglose, no como veredicto. */
  const entro = (efAdj === null ? 0 : efAdj) + tcReal + trTotal;
  const debiaEntrar = Number(ed.ef_final_decl || 0) + Number(ed.tj_decl || 0);
  const difNeta = efAdj === null ? null : Math.round((entro - debiaEntrar) * 100) / 100;

  /* ¿La diferencia de efectivo y la de tarjeta se cancelan entre sí? Si traen
     signo contrario y el neto es chico al lado de las dos, fue clasificación,
     no dinero perdido. Se dice con todas sus letras. */
  const seCompensan = difEf !== null && difEf * difTj < 0
    && Math.min(Math.abs(difEf), Math.abs(difTj)) > Math.abs(difNeta || 0);

  const propRet   = Math.round(propTotal * PROP_RETENCION) / 100;
  const propPagar = Math.round((propTotal - propRet) * 100) / 100;
  const propPct   = tcReal > 0 ? (propTotal / tcReal) * 100 : null;

  return {sumaDias, tcReal, efTotal, trTotal, propTotal, tjConPropina,
          propRet, propPagar, propPct,
          entro, debiaEntrar, difNeta, seCompensan,
          totRP, efAdj, efEsperado, difEf, difTj, difTot,
          otrasFormas, formasPago, difFormas};
}

function corView(){
  const ed = corInitEdit();
  const end = new Date(corWeek); end.setDate(end.getDate()+6);
  const fmt = d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  const {sumaDias, tcReal, efTotal, trTotal, propTotal, tjConPropina,
         propRet, propPagar, propPct,
         entro, debiaEntrar, difNeta, seCompensan,
         totRP, efAdj, efEsperado, difEf, difTj, difTot,
         otrasFormas, formasPago, difFormas} = corNumeros(ed);
  /* Rojo vivo si falta dinero, verde vivo si sobra. Antes lo positivo salía en
     naranja y no se entendía si el número era bueno o malo. */
  const ROJO_VIVO = '#E01B0F', VERDE_VIVO = '#0E9F4F';
  const col = v => v===null ? 'inherit' : (v<0 ? ROJO_VIVO : VERDE_VIVO);
  /* Y por si el color no basta, se dice con todas sus letras. */
  const veredicto = v => v===null ? '' : (Math.abs(v)<1 ? 'CUADRADO' : (v<0 ? 'FALTAN' : 'SOBRAN'));
  const sello = v => v===null ? '' :
    `<span style="display:inline-block;margin-left:8px;font-size:10.5px;font-weight:800;
      letter-spacing:.09em;padding:2px 7px;border-radius:20px;vertical-align:middle;
      background:${Math.abs(v)<1?'#E7F4EC':(v<0?'#FCE8E6':'#E7F4EC')};
      color:${Math.abs(v)<1?VERDE_VIVO:col(v)}">${veredicto(v)}</span>`;
  let h = locSwitch(finLoc,'floc');
  h += `<div class="weeknav">
    <button data-cwk="-1" aria-label="Semana anterior">\u2039</button>
    <b>Corte del ${fmt(corWeek)} al ${fmt(end)} ${corData.saved?'\u00b7 <span style="color:var(--ok)">Guardado</span>':''}</b>
    <button data-cwk="1" aria-label="Semana siguiente">\u203a</button></div>`;

  /* Un solo botón para abrir todo el corte.

     Había dos candados con nombres distintos —«Corregir a mano» arriba y
     «Editar corte» abajo—, cada uno abriendo la mitad. Quien quería corregir
     un número tenía que adivinar cuál de los dos, y los dos se veían como
     letra chica al lado de un título. Este los abre juntos y se ve. Los
     chicos siguen ahí para abrir una sola mitad si se quiere. */
  const abierto = corEditable && corDiasEditable;
  if(corData.saved){
    h += `<div class="frm-row" style="margin:0 0 12px">
      <button type="button" class="${abierto?'btn-quiet':'btn-primary'}" id="corTodo"
        style="width:100%;${abierto?'border:2px solid var(--warn);background:#FFF3D6':''}">
        ${abierto ? '\u{1F513} MODIFICANDO — toca para bloquear' : '\u270F\uFE0F MODIFICAR CORTE'}</button>
    </div>
    <p class="hint" style="margin:-6px 0 12px">${abierto
      ? 'Todo el corte está abierto: puedes corregir efectivo, tarjeta, vouchers, propinas, cortesías y lo de cada día. Al terminar, dale <b>Actualizar corte</b> abajo para guardar.'
      : 'El corte está guardado y bloqueado, para que nadie le mueva un número sin querer.'}</p>`;
  }

  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px">1. Corte del software (SR) — arrastra o elige archivo</div>
    <textarea class="paste-box" id="corBox" style="min-height:80px" placeholder="Arrastra aquí el PDF o Excel del corte… o pégalo directo"></textarea>
    <div class="frm-row">
      <button type="button" class="btn-quiet" data-paste="corBox">Pegar del portapapeles</button>
      <button type="button" class="btn-quiet" id="corPick">Elegir archivo (PDF / Excel)</button>
    </div>
    <button class="btn-primary" id="corRead" style="width:100%">Leer corte</button></div>`;
  const nf = (id, val, lbl) => `<label>${lbl} <input type="text" inputmode="decimal" class="nospin" data-cf="${id}" value="${fmtNum(val)||''}" placeholder="0"></label>`;
  /* Estos campos son lo que dice el corte del sistema: se llenan al leer el
     archivo y quedan bloqueados, para que nadie los "cuadre" a mano. Se pueden
     desbloquear a propósito si el PDF trae un número mal leído. */
  /* Cada campo dice DE QUÉ RENGLÓN del corte impreso salió, con la etiqueta
     tal cual la imprime el sistema. Quien captura tiene el papel en la mano:
     si el rótulo de la pantalla no es el mismo del papel, tiene que adivinar
     —y "Venta neta" contra "VENTAS CON IMP." son dos números distintos que
     se parecen. Esa duda es la que se acaba aquí. */
  const nfRO = (id, val, lbl, src) => `<label>${lbl}
    ${src?`<span class="hint" style="font-size:10.5px;font-weight:700;color:var(--ink-2)">${src}</span>`:''}
    <input type="text" inputmode="decimal" class="nospin" data-cf="${id}" value="${fmtNum(val)||''}" placeholder="0" ${corEditable?'':'readonly tabindex="-1"'} style="${corEditable?'':'background:#EFEDE7;color:var(--ink-2);cursor:not-allowed'}"></label>`;
  h += `<div class="panel">
    ${corLeido ? `<div class="hint" style="margin-bottom:8px;padding:8px 11px;border-radius:9px;
        background:#E7F4EC;border-left:4px solid var(--ok)">
        <b>PDF del corte leído</b> — ${esc(corLeido.quien)} · ${esc(corLeido.desde||'?')} al ${esc(corLeido.hasta||'?')}
        · ventas con IVA <b>${money(corLeido.venta_imp)}</b></div>`
      : `<div class="hint" style="margin-bottom:8px;padding:8px 11px;border-radius:9px;
        background:#FFF3D6;border-left:4px solid var(--warn)">
        <b>Todavía no se ha leído el PDF del corte.</b> Lo que ves abajo, si trae números,
        viene del punto de venta. Suéltalo en el recuadro de arriba y se llena solo.</div>`}
    <div class="hint" style="font-weight:700;margin-bottom:8px">Lo que marca el corte del sistema
      <span style="font-weight:600;font-size:10.5px;color:var(--ink-2)">· lector v14</span>
      <button type="button" class="btn-quiet" id="corUnlock" style="min-height:32px;padding:2px 10px;font-size:12px;margin-left:8px">${corEditable?'🔓 Desbloqueado — volver a bloquear':'🔒 Corregir a mano'}</button></div>
    <div class="frm-row" style="margin-bottom:10px">
      <button type="button" class="btn-primary" id="corJalar">⬇️ Jalar del punto de venta</button>
      <span class="hint">Trae de la API el <b>efectivo</b>, la <b>tarjeta</b>, <b>Rappi</b>, <b>maquilas</b>,
      la <b>venta con IVA</b> y las <b>canceladas</b> de los siete días. <b>No sustituye al PDF:</b> venta neta, depósitos, retiros,
      efectivo final, cortesías y descuentos solo vienen en el corte del sistema.</span></div>
    <p class="hint" style="margin:0 0 10px;padding:8px 11px;border-radius:9px;background:#F1EEE6">
      Todo lo de este bloque es <b>tal cual lo imprime el corte</b>, sin recalcular nada.
      El total del negocio es <b>VENTAS CON IMP.</b> —con IVA—, que es el que cuadra contra
      las formas de pago. La <b>VENTA NETA</b> del corte va sin impuestos y por eso es un
      número más chico: se guarda porque el corte la trae, no para compararla contra la caja.</p>
    <div class="frm-row-3">
    ${nfRO('venta_imp', ed.venta_imp, 'Ventas CON IVA', 'VENTAS CON IMP.')}
    ${nfRO('ef_decl', ed.ef_decl, 'Efectivo', '+EFECTIVO (caja)')}
    ${nfRO('tj_decl', ed.tj_decl, 'Tarjeta', '+TARJETA (caja)')}</div>
    <div class="frm-row-3" style="margin-top:10px">
    ${nfRO('venta_neta', ed.venta_neta, 'Venta neta', 'VENTA NETA · SIN impuestos')}<span></span><span></span></div>
    ${corData._st>0&&!corData.saved?`<p class="hint" style="margin:-8px 0 8px">Del reporte SR: <b id="useSRVenta" style="cursor:pointer;color:var(--navy)">${money(corData._st)} → clic para usar</b></p>`:''}
    <div class="frm-row-3">
    ${nfRO('depositos', ed.depositos, 'Dep\u00f3sitos efectivo', '+DEP\u00d3SITOS EFE')}
    ${nfRO('retiros', ed.retiros, 'Retiros efectivo', '-RETIROS EFECT')}
    ${nfRO('ef_final_decl', ed.ef_final_decl, 'Efectivo final', 'EFECTIVO FINAL')}</div>
    <div class="hint" style="font-weight:700;margin:16px 0 4px">Cortes\u00edas, descuentos y cancelaciones</div>
    <p class="hint" style="margin:0 0 8px">El corte imprime estos renglones <b>sin impuestos</b>. Se copian igual.</p>
    <div class="frm-row-3">
      ${nfRO('cortesias', ed.cortesias, 'Total cortes\u00edas', 'TOTAL CORTESIAS')}
      ${nfRO('dsc_alimentos', ed.dsc_alimentos, 'Dscto. alimentos', 'DESCUENTO ALIMENTOS')}
      ${nfRO('dsc_bebidas', ed.dsc_bebidas, 'Dscto. bebidas', 'DESCUENTO BEBIDAS')}</div>
    <div class="frm-row-3" style="margin-top:10px">
      ${nfRO('dsc_otros', ed.dsc_otros, 'Dscto. otros', 'DESCUENTO OTROS')}
      ${nfRO('ctas_cortesia', ed.ctas_cortesia, 'Cuentas con cortes\u00eda', 'CUENTAS CON CORTESIA')}
      ${nfRO('ctas_dscto', ed.ctas_dscto, 'Cuentas con descuento', 'CUENTAS CON DESCUENTO')}</div>
    <div class="frm-row-3" style="margin-top:10px">
      ${nfRO('ctas_canceladas', ed.ctas_canceladas, 'Cuentas canceladas', 'CUENTAS CANCELADAS')}<span></span><span></span></div>
    <div class="hint" style="font-weight:700;margin:16px 0 8px">Otras formas de pago</div>
    <div class="frm-row-3">
      ${nfRO('rappi', ed.rappi, 'Rappi', 'FORMA DE PAGO VENTAS')}
      ${nfRO('maquilas', ed.maquilas, 'Maquilas Tetakawi', 'FORMA DE PAGO VENTAS')}<span></span></div>
    <p class="hint" style="margin:8px 0 0">San Carlos no los usa — se dejan en cero y no pasa nada.</p>
    <div class="hint" style="margin-top:8px;padding:8px 11px;border-radius:9px;background:${
      difFormas===null ? '#F6F4EE' : (Math.abs(difFormas)<1 ? '#E7F4EC' : '#FFF3D6')};
      border-left:4px solid ${difFormas===null ? 'var(--line)' : (Math.abs(difFormas)<1 ? 'var(--ok)' : 'var(--warn)')}">
      <b>Formas de pago: ${money(formasPago)}</b> contra <b>${money(Number(ed.venta_imp||0))}</b> de ventas con IVA
      ${difFormas===null ? '' : (Math.abs(difFormas)<1
        ? ' — <b style="color:var(--ok)">cuadra</b>'
        : ` — <b style="color:var(--warn)">difieren ${money(difFormas)}</b>. Si la sucursal cobra por Rappi o maquilas, captúralo arriba.`)}
    </div>
    ${corAPI ? (()=>{
      const dEf = corAPI.ef - Number(ed.ef_decl||0);
      const dTj = corAPI.tj - Number(ed.tj_decl||0);
      const dTot = corAPI.total - Number(ed.venta_imp||0);
      const cuadra = Math.abs(dEf)<1 && Math.abs(dTj)<1 && Math.abs(dTot)<1;
      const dif = v => Math.abs(v)<1 ? '<span style="color:var(--ok)">igual</span>'
        : `<b style="color:var(--warn)">${v>0?'+':''}${money(v)}</b>`;
      return `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;
          background:${cuadra?'#E7F4EC':'#FFF3D6'};border-left:4px solid ${cuadra?'var(--ok)':'var(--warn)'}">
        <b>El corte contra el punto de venta</b>
        <span class="hint">(jalado ${esc(corAPI.cuando)})</span>
        <div class="res-wrap" style="margin-top:6px"><table class="res" style="font-size:12px">
          <thead><tr><th style="text-align:left"></th><th>Corte impreso</th><th>Punto de venta</th><th>Diferencia</th></tr></thead>
          <tbody>
            <tr><td style="text-align:left">Efectivo</td><td>${money(Number(ed.ef_decl||0))}</td><td>${money(corAPI.ef)}</td><td>${dif(dEf)}</td></tr>
            <tr><td style="text-align:left">Tarjeta</td><td>${money(Number(ed.tj_decl||0))}</td><td>${money(corAPI.tj)}</td><td>${dif(dTj)}</td></tr>
            <tr><td style="text-align:left"><b>Ventas con IVA</b></td><td><b>${money(Number(ed.venta_imp||0))}</b></td><td><b>${money(corAPI.total)}</b></td><td>${dif(dTot)}</td></tr>
          </tbody></table></div>
        <p class="hint" style="margin:6px 0 0">${cuadra
          ? 'Las dos fuentes dicen lo mismo.'
          : (Math.abs(dTot)<1
            ? 'El <b>total es el mismo</b>: lo que cambia es cómo se reparte entre efectivo y tarjeta. '
              + 'Eso pasa cuando un pago se corrigió en la caja después de cobrarlo. Manda el corte impreso.'
            : 'Ojo: no cuadra ni el total. Revisa que el PDF sea de esta sucursal y de esta semana.')}</p>
      </div>`;
    })() : ''}
    <div class="hint" style="font-weight:700;margin-top:10px">Cortes\u00edas + descuentos: <b>${money(Number(ed.cortesias||0)+Number(ed.dsc_alimentos||0)+Number(ed.dsc_bebidas||0)+Number(ed.dsc_otros||0))}</b></div>
    </div>`;
  /* Un renglón por día con todo junto —efectivo, tarjeta, propina y
     transferencia— en vez de tres rejillas separadas. Los campos aceptan
     sumas: 100+200. */
  /* Arranca en 0 y se escribe encima. Sigue aceptando sumas: 100+100 → 200. */
  const diasBloqueados = corData.saved && !corDiasEditable;
  const celda = (attr, k, val) => `<input type="text" inputmode="decimal" class="nospin" ${attr}="${k}" value="${(val===''||val==null)?'0':fmtNum(val)}" placeholder="0" ${diasBloqueados?'readonly tabindex="-1"':'title="Puedes escribir sumas: 100+100"'} style="min-width:96px${diasBloqueados?';background:#EFEDE7;color:var(--ink-2);cursor:not-allowed;border-color:transparent':''}">`;
  h += `<div class="panel"><div class="hint" style="font-weight:800;font-size:15px;display:flex;align-items:center;flex-wrap:wrap;gap:8px">
      <span>2. Real entregado</span>
      ${corData.saved?`<button type="button" class="btn-quiet" id="corDiasUnlock" style="min-height:32px;padding:2px 12px;font-size:12px">${corDiasEditable?'🔓 Editando — volver a bloquear':'✏️ Editar corte'}</button>`:''}
      ${diasBloqueados?'<span style="font-size:11.5px;font-weight:700;color:var(--ok);letter-spacing:.04em">CORTE GUARDADO · SOLO LECTURA</span>':''}</div>
    <p class="hint">${diasBloqueados?'Este corte ya está guardado. Para corregir un número, toca <b>Editar corte</b>.':'Captura cada día lo que de verdad se entregó. Puedes escribir sumas: <b>100+100</b> se convierte en <b>200</b> al salir de la casilla.'}</p>
    <p class="hint" style="margin:-4px 0 10px;color:#7A3EA1;font-weight:600">
      La columna de tarjeta pasa sola a la planilla, al renglón <b>TARJETA BANCARIA REAL</b>.</p>
    <div class="res-wrap"><table class="res"><thead><tr>
      <th>Día</th><th>Efectivo real</th><th>Tarjeta — voucher de la terminal</th><th>Propina tarjeta</th>
      <th>Tarjeta + propina</th><th>Transferencia bancaria</th><th>Total del día</th></tr></thead><tbody>
    ${COR_DAYS.map((k,ix)=>{
      const _d=new Date(corWeek); _d.setDate(_d.getDate()+ix);
      const ef=Number(ed.ef_days[k]||0), tj=Number(ed.tc_days[k]||0), tp=Number(ed.tp_days[k]||0), tr=Number(ed.tr_days[k]||0);
      return `<tr>
        <td style="text-align:left;font-weight:700;white-space:nowrap">${k.toUpperCase()} ${_d.getDate()}</td>
        <td>${celda('data-cef',k,ed.ef_days[k])}</td>
        <td>${celda('data-ctc',k,ed.tc_days[k])}</td>
        <td>${celda('data-ctp',k,ed.tp_days[k])}</td>
        <td class="tot2">${money(tj+tp)}</td>
        <td>${celda('data-ctr',k,ed.tr_days[k])}</td>
        <td class="tot2">${money(ef+tj+tp+tr)}</td></tr>`;
    }).join('')}
    </tbody><tfoot>
      <tr><td>TOTAL SEMANA</td><td class="tot2">${efTotal===null?'—':money(efTotal)}</td>
      <td class="tot2">${money(tcReal)}</td><td class="tot2">${money(propTotal)}</td>
      <td class="tot2">${money(tjConPropina)}</td><td class="tot2">${money(trTotal)}</td>
      <td class="tot2">${money((efTotal||0)+tjConPropina+trTotal)}</td></tr>
    </tfoot></table></div>
    <div class="hint" style="font-weight:700;margin-top:8px">Total real entregado en la semana: <b>${money((efTotal||0)+tjConPropina+trTotal)}</b> — efectivo ${efTotal===null?'—':money(efTotal)} · tarjeta con propina ${money(tjConPropina)} · transferencias ${money(trTotal)}</div>
    </div>`;
  h += `<div class="kpis">
    <div class="kpi" style="border-top:4px solid ${efAdj===null?'var(--line)':(efAdj>=0?'var(--ok)':'var(--red)')}">
      <div class="l">Efectivo contado</div>
      <div class="v" style="color:${efAdj===null?'var(--ink-2)':(efAdj>=0?'var(--ok)':'var(--red)')}">${efAdj===null?'\u2014':money(efAdj)}</div>
      <div class="hint">${totRP>0?`Contado ${money(efTotal||0)} \u2212 retiros pendientes ${money(totRP)}`:'Lo que se cont\u00f3 en caja'}</div>
    </div>
    <div class="kpi"><div class="l">Efectivo${sello(difEf)}</div>
      <div class="v" style="color:${col(difEf)}">${difEf===null?'\u2014':money(difEf)}</div>
      <div class="hint">contra ${money(efEsperado)} esperado${trTotal>0?` (corte ${money(Number(ed.ef_final_decl||0))} \u2212 transferencias ${money(trTotal)})`:' seg\u00fan corte'}</div></div>
    <div class="kpi"><div class="l">Tarjeta${sello(difTj)}</div>
      <div class="v" style="color:${col(difTj)}">${money(difTj)}</div>
      <div class="hint">vouchers ${money(tcReal)} \u2212 declarado ${money(Number(ed.tj_decl||0))} \u00b7 sin propina</div></div>
    <div class="kpi" style="border-top:4px solid var(--navy)">
      <div class="l">Propina de la semana</div>
      <div class="v">${money(propTotal)}
        ${propPct!==null?`<span style="font-size:15px;font-weight:800;color:var(--navy);margin-left:8px">${propPct.toFixed(1)}%</span>`:''}</div>
      <div class="hint">${propPct!==null?`${propPct.toFixed(1)}% sobre la venta con tarjeta (${money(tcReal)})`:'sin venta con tarjeta'} \u2014 no entra en las diferencias</div></div>
    <div class="kpi" style="border-top:4px solid var(--navy)">
      <div class="l">Propina a pagar</div>
      <div class="v" style="color:var(--navy)">${money(propPagar)}</div>
      <div class="hint">${money(propTotal)} \u2212 ${PROP_RETENCION}% de retenci\u00f3n (${money(propRet)})</div></div>
    ${(()=>{
      /* Lo que de verdad se entrega: la propina neta menos la merma de la
         semana anterior. Va junto a las otras, no escondido en el PDF, porque
         es el n\u00famero que se cuenta en la caja. */
      const mA = corData?._mermaAnt;
      const aPagar = Math.round((propPagar - (mA||0))*100)/100;
      const sem = corData?._semAnt
        ? (()=>{ const a=new Date(corData._semAnt+'T12:00'), b=new Date(a); b.setDate(b.getDate()+6);
                 const f=d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
                 return `${f(a)} al ${f(b)}`; })() : '';
      return `<div class="kpi" style="border-top:4px solid ${aPagar<0?'var(--red)':'var(--ok)'}">
        <div class="l">Total a pagar al personal</div>
        <div class="v" style="color:${aPagar<0?'var(--red)':'var(--ok)'}">${money(Math.max(0,aPagar))}</div>
        <div class="hint">${money(propPagar)} de propina neta ${mA===null||mA===undefined
          ? `\u2014 <b>sin inventario del ${esc(sem)}</b>, no se descont\u00f3 merma`
          : `\u2212 ${money(mA)} de merma (faltantes del ${esc(sem)})`}${
          aPagar<0 ? ` \u00b7 <b style="color:var(--red)">la merma supera la propina: quedan ${money(-aPagar)} sin cubrir</b>`
                   : ` \u00b7 se paga del efectivo de esta semana`}</div></div>`;
    })()}
    <div class="kpi" style="border-top:4px solid ${difNeta===null?'var(--line)':(Math.abs(difNeta)<=COR_TOLERANCIA?'var(--ok)':col(difNeta))}">
      <div class="l">¿Falta dinero?${difNeta===null?'':(Math.abs(difNeta)<=COR_TOLERANCIA?' <b style="color:var(--ok)">CUADRA</b>':sello(difNeta))}</div>
      <div class="v" style="color:${difNeta===null?'var(--ink-2)':(Math.abs(difNeta)<=COR_TOLERANCIA?'var(--ok)':col(difNeta))}">${difNeta===null?'—':money(difNeta)}</div>
      <div class="hint">entró ${money(entro)} (efectivo + tarjeta + transferencias) contra ${money(debiaEntrar)} del corte${
        seCompensan?' · <b>el efectivo y la tarjeta se compensan: es clasificación, no dinero perdido</b>':''}</div></div>
  </div>`;
  const totRetPend = ed.retiros_pend ? ed.retiros_pend.reduce((s,r)=>s+numMX(r.monto||0),0) : 0;
  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px">\u{1F4B8} Retiros pendientes (pagos de caja no registrados)</div>
    <p class="hint">Gastos pagados desde la caja que no se retiraron formalmente. Se restan del efectivo real para el diferencial ajustado.</p>
    <div style="display:grid;gap:8px">
    ${(ed.retiros_pend||[]).map((r,ix)=>`
      <div class="frm-row-3" style="align-items:end">
        <label style="font-size:13px">Fecha <input type="date" data-rp="${ix}" data-rf="fecha" value="${r.fecha||''}" style="min-height:44px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:15px"></label>
        <label style="font-size:13px">Concepto <input type="text" maxlength="80" data-rp="${ix}" data-rf="concepto" value="${esc(r.concepto||'')}" placeholder="Gas, insumos\u2026" style="min-height:44px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:15px"></label>
        <label style="font-size:13px">Monto <input type="text" inputmode="decimal" data-rp="${ix}" data-rf="monto" value="${fmtNum(r.monto)}" placeholder="0" class="nospin" style="min-height:44px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:15px${numMX(r.monto||0)>0?';border-color:var(--warn)':''}"></label>
      </div>`).join('')}
    </div>
    ${totRetPend>0?`<div style="margin-top:10px;padding:10px 14px;background:#FFF3D6;border-radius:10px;border-left:4px solid var(--warn)">
      <div class="hint" style="font-weight:700">Total retiros pendientes: <b>${money(totRetPend)}</b></div>
      <div class="hint" style="font-weight:700">Efectivo real ajustado: <b style="color:${efAdj!==null&&efAdj-ed.ef_final_decl>=0?'var(--ok)':'var(--red)'}">${efAdj!==null?money(efAdj):'\u2014'}</b> (${money(numMX(ed.ef_real||0))} \u2212 ${money(totRetPend)})</div>
    </div>`:''}
  </div>`;
  h += `<div class="panel"><label>Notas / ajustes (retiros olvidados, cobros marcados mal, etc.)
    <textarea data-cf="notes" maxlength="600" style="min-height:70px">${esc(ed.notes)}</textarea></label></div>
  <button class="btn-primary" id="corSave" style="width:100%">${corData.saved?'Actualizar corte':'Guardar corte'}</button>
  <button class="btn-quiet" id="corPdf" style="width:100%;margin-top:8px">📄 Reporte del corte en PDF</button>
  <p class="hint" style="margin-top:8px">El corte guardado aparece en el Reporte semanal de la sucursal, con sus diferencias y ajustes.
  El PDF trae todo: venta del sistema, lo entregado día por día, diferencias, cortesías, descuentos, cancelaciones, retiros y notas.</p>`;
  return h;
}

/* ============================================================
   El corte en una hoja, para mandar
   ------------------------------------------------------------
   Se dibuja a mano con jsPDF en vez de imprimir la pantalla: la
   pantalla tiene botones, campos y avisos que en una hoja
   estorban, y lo que se manda por WhatsApp tiene que leerse de
   un vistazo en un teléfono.

   Los números NO se recalculan aquí: salen de corNumeros(), el
   mismo que pinta la pantalla. Un reporte que no dice lo mismo
   que la pantalla es peor que no tener reporte.
   ============================================================ */
function loadPDF(){
  return window._jspdfLoaded || (window._jspdfLoaded = new Promise((ok, mal)=>{
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload = ok; s.onerror = mal; document.head.appendChild(s);
  }));
}

async function corGeneraPDF(){
  await loadPDF();
  const JS = (window.jspdf || {}).jsPDF;
  if(!JS){ toast('No se pudo cargar el generador de PDF'); return; }

  const ed = corInitEdit();
  const N  = corNumeros(ed);
  const fin = new Date(corWeek); fin.setDate(fin.getDate()+6);
  const dl = d => d.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
  const n2 = v => (v===null||v===undefined||v==='') ? '-'
      : Number(v).toLocaleString('es-MX',{minimumFractionDigits:2, maximumFractionDigits:2});
  /* jsPDF escribe con la fuente base del PDF, que no trae el signo menos
     tipográfico: puesto ahí sale como comilla. Guiones normales, y el dinero
     negativo con el signo ANTES del peso, que es como se lee. */
  const pesos = v => (v===null||v===undefined||v==='') ? '-'
      : (Number(v) < 0 ? '-$' + n2(Math.abs(Number(v))) : '$' + n2(v));
  const veredicto = v => v===null ? '' : (Math.abs(v)<1 ? 'CUADRADO' : (v<0 ? 'FALTAN' : 'SOBRAN'));

  const TINTA=[29,27,22], SUAVE=[110,103,92], LINEA=[221,215,201];
  const ROJO=[192,38,31], VERDE=[11,110,63], NAVY=[27,46,77];

  /* La venta del día no está en el corte —el corte guarda totales de la
     semana—, así que se pide al punto de venta al armar el reporte. Si no
     contesta, el PDF sale igual sin esa columna en vez de no salir. */
  let POS = null;
  try{
    const suc = finLoc===1 ? 'guaymas' : 'sancarlos';
    const c = (typeof corteHora !== 'undefined' ? corteHora : 6);
    const r = await fetch(`/api/soft-ventas?modo=rango&sucursal=${suc}` +
      `&desde=${corWeek.toISOString().slice(0,10)}&hasta=${fin.toISOString().slice(0,10)}` +
      `&corte=${c}&token=${encodeURIComponent(user.token)}`, {cache:'no-store'});
    const j = await r.json().catch(()=>null);
    if(r.ok && j && !j.error) POS = j;
  }catch(e){ /* sin punto de venta, el reporte sigue siendo útil */ }

  /* ============================================================
     Todo en una hoja.

     Antes eran dos páginas, y dos páginas para un corte semanal es una de
     más: quien lo revisa quiere ver el dinero declarado, lo entregado y la
     diferencia de un vistazo, sin voltear. Para que quepa se hicieron tres
     cosas, en este orden de importancia:

     1. Una sola tabla de días. Antes había dos con los mismos siete
        renglones —lo vendido y lo entregado— y eso costaba una tabla
        entera. Van juntas: la venta del día al lado de lo que se entregó.
     2. Dos columnas arriba. El bloque de caja a la izquierda, las
        diferencias y las cortesías a la derecha.
     3. Tipografía más apretada, pero no menos de 7.5 pt: por debajo de eso
        deja de leerse impreso, y este papel se imprime.

     Si de todos modos no cabe —muchos retiros pendientes, una nota larga—,
     se corta lo que sobra y se dice cuánto se cortó. Un reporte de dos
     páginas que dice ser de una es peor que uno que avisa.
     ============================================================ */
  const doc = new JS({unit:'pt', format:'letter'});
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 34;
  const PIE = H - 26;               // por debajo de aquí ya no se escribe

  /* --- encabezado --- */
  doc.setFillColor(...NAVY); doc.rect(0,0,W,58,'F');
  doc.setTextColor(255,255,255);
  doc.setFont('helvetica','bold').setFontSize(14);
  doc.text("BOYE'S BURGER & PIZZA", M, 24);
  doc.setFont('helvetica','normal').setFontSize(9);
  doc.text(`${LOCS[finLoc]||''} · Corte semanal`, M, 38);
  doc.setFont('helvetica','bold').setFontSize(9.5);
  doc.text(`${dl(corWeek)} al ${dl(fin)}`, M, 51);
  doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(205,216,232);
  doc.text(`Generado ${new Date().toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'})}` +
           (user && user.name ? ` · ${user.name}` : ''), W-M, 51, {align:'right'});

  /* ---------- utilidades de dibujo ---------- */
  const GAP = 14;
  const COL = (W - 2*M - GAP) / 2;
  const X1 = M, X2 = M + COL + GAP;

  const titulo = (t, x, ancho, y0) => {
    doc.setTextColor(...NAVY).setFont('helvetica','bold').setFontSize(9);
    doc.text(t.toUpperCase(), x, y0);
    doc.setDrawColor(...NAVY).setLineWidth(1);
    doc.line(x, y0+3.5, x+ancho, y0+3.5);
    return y0 + 14;
  };
  /* Un renglón «concepto ..... monto» dentro de una columna. */
  const ren = (x, ancho, y0, lbl, val, opt) => {
    opt = opt || {};
    doc.setFont('helvetica', opt.fuerte?'bold':'normal').setFontSize(8.5);
    doc.setTextColor(...(opt.color || (opt.fuerte ? TINTA : SUAVE)));
    if(opt.signo){
      doc.text(opt.signo, x+1, y0);
      doc.setTextColor(...TINTA); doc.text(String(lbl), x+11, y0);
    } else doc.text(String(lbl), x+1, y0);
    doc.setFont('helvetica','bold').setTextColor(...(opt.color || TINTA));
    doc.text(opt.crudo ? String(val) : pesos(val), x+ancho-1, y0, {align:'right'});
    doc.setDrawColor(...LINEA).setLineWidth(.4);
    doc.line(x, y0+4, x+ancho, y0+4);
    return y0 + 13.5;
  };
  /* El renglón que cierra un bloque: banda de color, imposible de perder. */
  const cierre = (x, ancho, y0, lbl, val, fuerte) => {
    if(fuerte) doc.setFillColor(...NAVY); else doc.setFillColor(228,243,232);
    doc.rect(x, y0-8.5, ancho, 17, 'F');
    doc.setFont('helvetica','bold').setFontSize(fuerte ? 9.5 : 8.8);
    doc.setTextColor(...(fuerte ? [255,255,255] : VERDE));
    doc.text(String(lbl).toUpperCase(), x+6, y0+2);
    doc.text(pesos(val), x+ancho-6, y0+2, {align:'right'});
    return y0 + 22;
  };
  const rotulo = (x, y0, t) => {
    doc.setFont('helvetica','bold').setFontSize(7).setTextColor(...SUAVE);
    doc.text(String(t).toUpperCase(), x+1, y0);
    return y0 + 10;
  };
  const chico = (x, ancho, y0, t) => {
    doc.setFont('helvetica','normal').setFontSize(6.8).setTextColor(...SUAVE);
    for(const l of doc.splitTextToSize(t, ancho)){ doc.text(l, x+1, y0); y0 += 8; }
    return y0 + 2;
  };

  /* ============================================================
     EL RESULTADO, ANTES QUE NADA
     ------------------------------------------------------------
     El reporte traía todo: la caja, las formas de pago, las
     cortesías, el día por día. Todo cierto y todo útil — pero la
     pregunta con la que uno abre esta hoja es una sola: cuánto
     efectivo me entregaron y si cuadra. Esa respuesta estaba
     repartida entre un renglón de la izquierda y un recuadro de la
     derecha, y había que armarla mentalmente.

     Ahora va arriba, en grande y con tres números: lo que
     entregaron, lo que debían entregar, y la resta. Lo demás sigue
     abajo para quien quiera ver de dónde salió cada uno.
     ============================================================ */
  const yRes = 70, ALTO_RES = 104;
  {
    const entregado = N.entro;                 // efectivo + vouchers + transferencias
    const debia     = N.debiaEntrar;           // lo que el corte dice que entró
    const d         = N.difNeta;
    const ok        = d !== null && Math.abs(d) <= COR_TOLERANCIA;
    const cOK       = d === null ? SUAVE : (ok ? VERDE : (d < 0 ? ROJO : VERDE));
    const ALTO = ALTO_RES;

    doc.setFillColor(246, 244, 238);
    doc.rect(M, yRes, W - 2*M, ALTO, 'F');
    doc.setDrawColor(...cOK); doc.setLineWidth(3);
    doc.line(M, yRes, M, yRes + ALTO);

    doc.setFont('helvetica','bold').setFontSize(8.5).setTextColor(...SUAVE);
    doc.text('EL RESULTADO DE LA SEMANA', M + 12, yRes + 15);

    const anchoCol = (W - 2*M - 24) / 3;
    const celda = (i, rot, valor, color, sello) => {
      const x = M + 12 + i * anchoCol;
      doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(...SUAVE);
      doc.text(rot, x, yRes + 33);
      doc.setFont('helvetica','bold').setFontSize(17).setTextColor(...color);
      doc.text(valor, x, yRes + 55);
      if(sello){
        doc.setFont('helvetica','bold').setFontSize(9).setTextColor(...color);
        doc.text(sello, x, yRes + 68);
      }
    };
    /* En los cortes viejos el efectivo se capturaba de un solo tirón, no día
       por día. Decir "contado día por día" en esos sería mentir sobre de
       dónde salió el número. */
    celda(0, 'ENTRÓ EN TOTAL', pesos(entregado), TINTA,
          N.efAdj === null ? 'falta contar el efectivo' : 'efectivo + tarjeta + transferencias');
    celda(1, 'DEBÍA ENTRAR', pesos(debia), TINTA, 'según el corte');
    celda(2, 'DIFERENCIA', d === null ? '-' : pesos(d), cOK,
          d === null ? '' : (ok ? 'CUADRA' : veredicto(d)));

    /* De dónde sale el "debía entregar", con números, no con palabras. */
    doc.setFont('helvetica','normal').setFontSize(6.8).setTextColor(...SUAVE);
    /* ---- por qué falta, cuando se puede saber ----
       En los cortes viejos el efectivo se capturaba de una sola vez y sin
       transferencias, y eso produce dos faltantes que NO son faltantes. Los
       dos se reconocen por el número exacto, así que se dicen en vez de
       dejar un rojo de dieciocho mil pesos sin explicación. */
    let pista = '';
    if(N.seCompensan)
      pista = `  El efectivo y la tarjeta se compensan entre sí: eso es una cuenta cobrada de una ` +
              `forma y registrada de otra, no dinero perdido.`;
    else if(d !== null && Number(ed.depositos||0) > 0 && Math.abs(d + Number(ed.depositos)) < 1)
      pista = `  OJO: el faltante es exactamente los depósitos (${pesos(ed.depositos)}). ` +
              `Lo más probable es que el efectivo se haya contado ya sin ellos, no que falte dinero.`;
    else if(d !== null && d < -COR_TOLERANCIA && !N.trTotal)
      pista = `  OJO: esta semana no se capturó ninguna transferencia. Si la sucursal cobró alguna, ` +
              `ahí puede estar la diferencia — el corte las suma como si fueran efectivo.`;

    /* De qué está hecho el número, canal por canal. Se dice el desglose
       porque el neto solo no deja corregir la captura de la semana. */
    const explica = `Entró = efectivo contado ${pesos(N.efAdj)} + vouchers ${pesos(N.tcReal)}` +
      (N.trTotal ? ` + transferencias ${pesos(N.trTotal)}` : '') + '.' +
      `  Debía entrar = efectivo del corte ${pesos(ed.ef_final_decl)} + tarjeta del corte ${pesos(ed.tj_decl)}.` +
      `  Por canal: efectivo ${veredicto(N.difEf).toLowerCase()} ${pesos(Math.abs(N.difEf||0))}, ` +
      `tarjeta ${veredicto(N.difTj).toLowerCase()} ${pesos(Math.abs(N.difTj))}.` +
      (N.totRP ? `  Ya se descontaron ${pesos(N.totRP)} de retiros pendientes.` : '') +
      pista;
    let ye = yRes + 82;
    for(const l of doc.splitTextToSize(explica, W - 2*M - 24).slice(0,3)){
      doc.text(l, M + 12, ye); ye += 7.5;
    }
  }

  /* ====================== COLUMNA IZQUIERDA ====================== */
  let yI = yRes + ALTO_RES + 16;
  yI = titulo('1 · Lo que marca el corte', X1, COL, yI);

  yI = rotulo(X1, yI, 'Caja');
  yI = ren(X1, COL, yI, 'Efectivo', ed.ef_decl, {signo:'+'});
  yI = ren(X1, COL, yI, 'Tarjeta', ed.tj_decl, {signo:'+'});
  yI = ren(X1, COL, yI, 'Depósitos de efectivo', ed.depositos, {signo:'+'});
  yI = ren(X1, COL, yI, 'Retiros de efectivo', ed.retiros, {signo:'-'});
  const saldo = Number(ed.ef_decl||0) + Number(ed.tj_decl||0) +
                Number(ed.depositos||0) - Number(ed.retiros||0);
  yI += 4;
  yI = cierre(X1, COL, yI, '= Saldo final', saldo);
  yI = chico(X1, COL, yI, 'efectivo + tarjeta + depósitos - retiros');
  yI = cierre(X1, COL, yI, 'Efectivo final según corte', ed.ef_final_decl);

  yI += 2;
  yI = rotulo(X1, yI, 'Formas de pago de la venta');
  yI = ren(X1, COL, yI, 'Efectivo', ed.ef_decl);
  yI = ren(X1, COL, yI, 'Tarjeta', ed.tj_decl);
  /* Rappi y maquilas solo se enseñan donde existen. En San Carlos, dos
     renglones en cero solo ocupan espacio y hacen dudar. */
  if(Number(ed.rappi||0)    > 0) yI = ren(X1, COL, yI, 'Rappi', ed.rappi);
  if(Number(ed.maquilas||0) > 0) yI = ren(X1, COL, yI, 'Maquilas Tetakawi', ed.maquilas);
  yI += 4;
  yI = cierre(X1, COL, yI, 'Total formas de pago', N.formasPago, true);

  /* ---- TRANSFERENCIAS ----
     Su propio apartado porque es la forma de pago más fácil de perder de
     vista: en el punto de venta se capturan como si fueran efectivo, así
     que el dinero entra al banco pero el cajón sale corto por ese mismo
     importe. Sin verlo escrito, cada semana parece un faltante. */
  if(N.trTotal > 0){
    yI += 2;
    yI = rotulo(X1, yI, 'Transferencias');
    COR_DAYS.forEach((k, ix) => {
      const v = Number(ed.tr_days[k] || 0);
      if(!v) return;                                  // los días en cero no ocupan renglón
      const f = new Date(corWeek); f.setDate(f.getDate() + ix);
      yI = ren(X1, COL, yI, `${k.toUpperCase()} ${f.getDate()}`, v);
    });
    yI += 4;
    yI = cierre(X1, COL, yI, 'Total transferencias', N.trTotal);
    yI = chico(X1, COL, yI,
      'Entraron al banco, no al cajón. El punto de venta las cuenta como efectivo, ' +
      'por eso el efectivo esperado se reduce en esta cantidad.');
  }

  yI += 2;
  yI = rotulo(X1, yI, 'Venta');
  yI = ren(X1, COL, yI, 'Venta neta (sin impuestos)', ed.venta_neta);
  yI += 4;
  yI = cierre(X1, COL, yI, 'Ventas con IVA', ed.venta_imp, true);
  /* El cuadre que faltaba: si las formas de pago no dan las ventas con IVA,
     el corte está incompleto y hay que decirlo aquí, no dejarlo a que
     alguien reste los dos números de arriba. */
  if(N.difFormas !== null){
    const ok = Math.abs(N.difFormas) < 1;
    doc.setFont('helvetica','bold').setFontSize(7.5);
    doc.setTextColor(...(ok ? VERDE : ROJO));
    doc.text(ok ? 'Las formas de pago cuadran con la venta.'
                : `Formas de pago contra venta: difieren ${pesos(N.difFormas)}`, X1+1, yI+1);
    yI += 11;
    if(!ok) yI = chico(X1, COL, yI, 'Si la sucursal cobra por Rappi o maquilas, falta capturarlo en el corte.');
  }

  /* ====================== COLUMNA DERECHA ====================== */
  let yD = yRes + ALTO_RES + 16;
  yD = titulo('2 · Diferencias', X2, COL, yD);

  /* Cada diferencia en su recuadro: el color y la palabra dicen lo mismo,
     para que no dependa de ver bien el color en una impresión en gris. */
  const dif = (y0, lbl, v, nota) => {
    const c = v===null ? SUAVE : (Math.abs(v)<1 ? VERDE : (v<0 ? ROJO : VERDE));
    /* El recuadro crece con su nota. Antes era de alto fijo y la explicación
       del efectivo —que es la que más falta hace— se cortaba a la mitad. */
    const nLin = nota ? Math.min(3, doc.splitTextToSize(nota, COL-16).length) : 0;
    const alto = nota ? 14 + nLin*7 : 20;
    doc.setFillColor(v!==null && Math.abs(v)>=1 && v<0 ? 253 : 247,
                     v!==null && Math.abs(v)>=1 && v<0 ? 240 : 250,
                     v!==null && Math.abs(v)>=1 && v<0 ? 239 : 245);
    doc.rect(X2, y0-9, COL, alto, 'F');
    doc.setDrawColor(...c); doc.setLineWidth(2.2);
    doc.line(X2, y0-9, X2, y0-9+alto);
    doc.setFont('helvetica','bold').setFontSize(9).setTextColor(...TINTA);
    doc.text(lbl, X2+8, y0+1);
    doc.setTextColor(...c).setFontSize(9.5);
    doc.text((v===null?'-':pesos(v)) + '  ' + veredicto(v), X2+COL-6, y0+1, {align:'right'});
    if(nota){
      doc.setFont('helvetica','normal').setFontSize(6.5).setTextColor(...SUAVE);
      let yy = y0 + 11;
      for(const l of doc.splitTextToSize(nota, COL-16).slice(0,3)){ doc.text(l, X2+8, yy); yy += 7; }
    }
    return y0 + alto - 6;
  };
  /* De dónde sale el «esperado», con todas sus letras.

     En caja cobran las transferencias como si fuera efectivo, así que el
     efectivo que marca el corte trae dinero que nunca entró al cajón. Se le
     resta lo cobrado por transferencia antes de comparar. El cálculo ya lo
     hacía; lo que faltaba era enseñarlo: sin la fórmula a la vista, un
     «faltan $1,616» parece dinero perdido y nadie puede comprobar si el
     descuento de las transferencias se hizo o no. */
  /* Igual que en pantalla, con la fórmula entre paréntesis: sin ella un
     «faltan $1,616» parece dinero perdido y nadie puede comprobar si ya se
     descontaron las transferencias, que en caja se cobran como efectivo. */
  yD = dif(yD, 'Efectivo', N.difEf,
    `Contado ${pesos(N.efTotal||0)}${N.totRP>0?` - retiros pend. ${pesos(N.totRP)}`:''} ` +
    `contra ${pesos(N.efEsperado)} esperado` +
    (N.trTotal > 0 ? ` (corte ${pesos(ed.ef_final_decl||0)} - transferencias ${pesos(N.trTotal)})` : ''));
  yD = dif(yD, 'Tarjeta', N.difTj,
    `Vouchers ${pesos(N.tcReal)} contra ${pesos(ed.tj_decl||0)} declarado · la propina va aparte`);
  yD = dif(yD, 'Diferencia neta', N.difTot, 'Efectivo + tarjeta');
  /* ---- PROPINA: lo declarado, la retención y lo que se entrega ----
     Se pone completo porque es dinero que sale de la caja en efectivo y
     alguien lo va a contar. Un solo número no basta: quien firma necesita
     ver de dónde salió el descuento. */
  yD = ren(X2, COL, yD+6, 'Propina con tarjeta (declarada)', N.propTotal, {fuerte:true});
  yD = chico(X2, COL, yD, `${N.propPct!==null?N.propPct.toFixed(1)+'% sobre la venta con tarjeta ('+pesos(N.tcReal)+')':'sin venta con tarjeta'} · no entra en las diferencias`);
  yD = ren(X2, COL, yD, `Retención ${PROP_RETENCION}%`, -N.propRet);
  yD = cierre(X2, COL, yD, 'PROPINA A PAGAR EN EFECTIVO', N.propPagar);

  yD += 6;
  yD = titulo('3 · Cortesías, descuentos y cancelaciones', X2, COL, yD);
  const cortesias = Number(ed.cortesias||0);
  const dscTot = Number(ed.dsc_alimentos||0)+Number(ed.dsc_bebidas||0)+Number(ed.dsc_otros||0);
  yD = ren(X2, COL, yD, 'Total cortesías', cortesias);
  yD = ren(X2, COL, yD, 'Descuento en alimentos', ed.dsc_alimentos);
  yD = ren(X2, COL, yD, 'Descuento en bebidas', ed.dsc_bebidas);
  yD = ren(X2, COL, yD, 'Descuento en otros', ed.dsc_otros);
  yD += 4;
  yD = cierre(X2, COL, yD, 'Cortesías + descuentos', cortesias + dscTot);
  if(Number(ed.venta_imp||0) > 0)
    yD = chico(X2, COL, yD, `${((cortesias+dscTot)/Number(ed.venta_imp)*100).toFixed(2)}% de la venta con IVA`) + 4;
  yD = ren(X2, COL, yD, 'Cuentas con cortesía', ed.ctas_cortesia||0, {crudo:true});
  yD = ren(X2, COL, yD, 'Cuentas con descuento', ed.ctas_dscto||0, {crudo:true});
  yD = ren(X2, COL, yD, 'Cuentas canceladas', ed.ctas_canceladas||0,
           {crudo:true, color: Number(ed.ctas_canceladas||0)>0 ? ROJO : undefined});

  /* ============ 4 · LO QUE SE LE ENTREGA AL PERSONAL ============
     La propina neta ya sale arriba, pero no es lo que se paga: antes se le
     descuenta la merma de la semana ANTERIOR —el inventario de esta semana
     todavía no se cuenta cuando se paga—. Aquí se hace la resta completa y
     queda un solo número para contar el dinero, que es lo que hace falta
     parado en la caja.

     Va la cuenta entera a la vista, no el resultado solo: este papel lo firma
     quien recibe, y nadie firma un descuento que no puede comprobar. */
  const mermaAnt = corData._mermaAnt;
  const semAntTxt = corData._semAnt
    ? (()=>{ const a = new Date(corData._semAnt+'T12:00'), b = new Date(a);
             b.setDate(b.getDate()+6); return `${dl(a)} al ${dl(b)}`; })()
    : '';
  const aPagar = Math.round((N.propPagar - (mermaAnt || 0)) * 100) / 100;

  yD += 6;
  yD = titulo('4 · Propina a pagar al personal', X2, COL, yD);
  yD = ren(X2, COL, yD, 'Propina con tarjeta (declarada)', N.propTotal);
  yD = ren(X2, COL, yD, `Retención ${PROP_RETENCION}%`, -N.propRet);
  if(mermaAnt === null){
    yD = ren(X2, COL, yD, 'Merma de la semana anterior', 0);
    yD = chico(X2, COL, yD, `Sin inventario capturado del ${semAntTxt} — no se descuenta nada. ` +
      `En cuanto se capture, este renglón se llena solo.`);
  } else {
    yD = ren(X2, COL, yD, 'Merma de la semana anterior', -mermaAnt);
    yD = chico(X2, COL, yD, `Faltantes del inventario del ${semAntTxt}, a precio de costo. ` +
      `Solo lo que faltó: lo que sobró de otros insumos no lo tapa.`);
  }
  yD += 2;
  yD = cierre(X2, COL, yD, 'TOTAL A PAGAR EN EFECTIVO', Math.max(0, aPagar), true);
  if(aPagar < 0){
    /* Nunca se paga en negativo ni se arrastra solo a la semana que sigue:
       cobrarle a alguien lo de la semana pasada sin decírselo es la forma de
       que el corte deje de creerse. Se dice el sobrante y lo decide una
       persona. */
    yD = chico(X2, COL, yD, `La merma (${pesos(mermaAnt)}) es mayor que la propina neta ` +
      `(${pesos(N.propPagar)}). No hay propina que entregar esta semana y quedan ` +
      `${pesos(-aPagar)} sin cubrir. Qué se hace con ese saldo lo decide la administración.`);
  } else {
    const ef = N.efTotal;
    yD = chico(X2, COL, yD, ef === null
      ? 'Se paga del efectivo que entró esta semana.'
      : `Se paga del efectivo que entró esta semana (${pesos(ef)}); quedan ${pesos(ef - aPagar)} ` +
        `después de entregarla.`);
  }

  /* ============ LA TABLA DE DÍAS, UNA SOLA, A TODO LO ANCHO ============
     Lo vendido y lo entregado en el mismo renglón: es la comparación que
     de verdad se hace, y antes obligaba a saltar entre dos tablas. */
  let y = Math.max(yI, yD) + 12;

  const cols = [
    {t:'Día',              w:52, a:'left'},
    {t:'Ctas',             w:32, a:'right'},
    {t:'Venta del día',    w:74, a:'right'},
    {t:'Efectivo real',    w:70, a:'right'},
    {t:'Tarjeta voucher',  w:74, a:'right'},
    {t:'Propina',          w:56, a:'right'},
    {t:'Transfer.',        w:58, a:'right'},
    {t:'Total entregado',  w:0,  a:'right'}
  ];
  cols[cols.length-1].w = (W-2*M) - cols.slice(0,-1).reduce((s,c)=>s+c.w,0);

  const fila = (celdas, opt) => {
    opt = opt || {};
    if(opt.cab){ doc.setFillColor(...NAVY); doc.rect(M, y-9, W-2*M, 15, 'F'); }
    else if(opt.pie){ doc.setFillColor(228,243,232); doc.rect(M, y-9, W-2*M, 15, 'F'); }
    let x = M;
    doc.setFont('helvetica', (opt.cab||opt.pie)?'bold':'normal').setFontSize(opt.cab?7:8.2);
    celdas.forEach((c, i)=>{
      doc.setTextColor(...(opt.cab ? [255,255,255] : (opt.pie ? VERDE : TINTA)));
      doc.text(String(c), cols[i].a==='right' ? x+cols[i].w-4 : x+4, y+1, {align: cols[i].a});
      x += cols[i].w;
    });
    y += 15;
    if(!opt.cab){ doc.setDrawColor(...LINEA).setLineWidth(.4); doc.line(M, y-9, W-M, y-9); }
  };

  const porFecha = {};
  for(const d of (POS?.dias || [])) porFecha[d.fecha] = d;

  doc.setTextColor(...NAVY).setFont('helvetica','bold').setFontSize(9);
  doc.text('4 · DÍA POR DÍA — LO QUE VENDIÓ Y LO QUE ENTREGÓ', M, y);
  doc.setDrawColor(...NAVY).setLineWidth(1); doc.line(M, y+3.5, W-M, y+3.5);
  y += 18;

  fila(cols.map(c=>c.t), {cab:true});
  let tC=0, tV=0, tEf=0, tTc=0, tTp=0, tTr=0, tDeclarado=0;
  COR_DAYS.forEach((k, ix)=>{
    const d = new Date(corWeek); d.setDate(d.getDate()+ix);
    const S = porFecha[d.toISOString().slice(0,10)];
    /* La venta del día es la SUMA de lo que entró: efectivo + tarjeta + otras
       formas. No SaleTotal.Total, que es otra cosa y dejaba renglones que no
       cerraban. Las cortesías no suman: no son dinero que entró. */
    const vEf = S ? Number(S.efectivo||0) + Number(S.transferencia||0) : 0;
    const vTj = S ? Number(S.tarjeta||0) : 0;
    const vOt = S ? Number(S.otros||0) : 0;
    const venta = vEf + vTj + vOt;
    const ct = S ? Number(S.ventas||0) : 0;
    tDeclarado += S ? Number(S.total||0) : 0;

    const ef=Number(ed.ef_days[k]||0), tc=Number(ed.tc_days[k]||0);
    const tp=Number(ed.tp_days[k]||0), tr=Number(ed.tr_days[k]||0);
    tC+=ct; tV+=venta; tEf+=ef; tTc+=tc; tTp+=tp; tTr+=tr;
    fila([`${k.toUpperCase()} ${d.getDate()}`, S?ct:'-', POS?n2(venta):'-',
          n2(ef), n2(tc), n2(tp), n2(tr), n2(ef+tc+tp+tr)]);
  });
  fila(['TOTAL', tC||'-', POS?n2(tV):'-', n2(tEf), n2(tTc), n2(tTp), n2(tTr),
        n2(tEf+tTc+tTp+tTr)], {pie:true});
  y += 4;

  /* Avisos: cortos, de un renglón, y solo cuando hay algo que decir. */
  const aviso = (txt, rojo) => {
    if(y > PIE - 24) return;
    doc.setFont('helvetica', rojo?'bold':'normal').setFontSize(7.2);
    /* Hasta dos renglones: con uno solo, el aviso importante —el del faltante—
       se cortaba justo donde decía qué hacer. */
    const lineas = doc.splitTextToSize(txt, W-2*M-14).slice(0,2);
    const alto = 8 + lineas.length*9;
    doc.setFillColor(rojo?253:247, rojo?240:246, rojo?239:240);
    doc.rect(M, y-8, W-2*M, alto, 'F');
    doc.setDrawColor(...(rojo?ROJO:SUAVE)); doc.setLineWidth(2);
    doc.line(M, y-8, M, y-8+alto);
    doc.setTextColor(...(rojo?ROJO:SUAVE));
    let yy = y+1;
    for(const l of lineas){ doc.text(l, M+7, yy); yy += 9; }
    y += alto + 5;
  };

  aviso('Venta del día = efectivo + tarjeta + otras formas; el efectivo incluye transferencias. ' +
        'Las cortesías no suman: no son dinero que entró.');

  const zeta = Number(ed.venta_imp||0);
  if(POS && zeta > 0 && tV > 0 && Math.abs(tV - zeta)/zeta > 0.01)
    aviso(`Ojo: el punto de venta entrega ${pesos(tV)} y el corte del sistema dice ${pesos(zeta)} — faltan ` +
          `${pesos(Math.abs(zeta - tV))} (${(Math.abs(tV-zeta)/zeta*100).toFixed(1)}%). ` +
          (finLoc===2 ? 'El bueno es el del corte: la consulta a Soft de San Carlos viene incompleta.'
                      : 'Revísalo antes de usar cualquiera de los dos.'), true);

  if(POS && Math.abs(tDeclarado - tV) >= 1)
    aviso(`La API declara ${pesos(tDeclarado)} de venta pero sus formas de pago suman ${pesos(tV)}: ` +
          `${pesos(Math.abs(tDeclarado - tV))} en cuentas que llegaron sin renglón de pago.`);

  /* --- retiros pendientes y notas, con lo que quede de hoja --- */
  const rp = (ed.retiros_pend||[]).filter(r=>numMX(r.monto||0) > 0);
  const notas = String(ed.notes||'').trim();

  if(rp.length && y < PIE - 40){
    doc.setFont('helvetica','bold').setFontSize(8).setTextColor(...NAVY);
    doc.text('RETIROS PENDIENTES (pagos de caja no registrados)', M, y); y += 11;
    let puestos = 0;
    for(const r of rp){
      if(y > PIE - 26) break;
      doc.setFont('helvetica','normal').setFontSize(7.8).setTextColor(...SUAVE);
      doc.text(`${r.fecha||'sin fecha'} · ${r.concepto||'sin concepto'}`, M+2, y);
      doc.setFont('helvetica','bold').setTextColor(...TINTA);
      doc.text(pesos(numMX(r.monto||0)), W-M-2, y, {align:'right'});
      doc.setDrawColor(...LINEA).setLineWidth(.4); doc.line(M, y+3, W-M, y+3);
      y += 12; puestos++;
    }
    doc.setFont('helvetica','bold').setFontSize(8).setTextColor(...VERDE);
    doc.text(`Total de retiros pendientes${puestos < rp.length ? ` (${rp.length - puestos} no caben en la hoja)` : ''}`, M+2, y);
    doc.text(pesos(N.totRP), W-M-2, y, {align:'right'});
    y += 14;
  }

  if(notas && y < PIE - 26){
    doc.setFont('helvetica','bold').setFontSize(8).setTextColor(...NAVY);
    doc.text('NOTAS Y AJUSTES', M, y); y += 10;
    doc.setFont('helvetica','normal').setFontSize(7.8).setTextColor(...TINTA);
    const lineas = doc.splitTextToSize(notas, W-2*M-4);
    const caben = Math.max(0, Math.floor((PIE - 12 - y) / 9));
    for(const l of lineas.slice(0, caben)){ doc.text(l, M+2, y); y += 9; }
    if(lineas.length > caben){
      doc.setFont('helvetica','italic').setFontSize(7).setTextColor(...SUAVE);
      doc.text(`(la nota completa está en el corte, en Boye's Ops)`, M+2, y);
    }
  }

  /* --- pie --- */
  doc.setFont('helvetica','normal').setFontSize(7).setTextColor(...SUAVE);
  doc.text("Boye's Ops · corte semanal", M, H-16);
  doc.text(`${LOCS[finLoc]||''} · ${dl(corWeek)} al ${dl(fin)}`, W-M, H-16, {align:'right'});

  const nombre = `Corte ${(LOCS[finLoc]||'').replace(/^Boye's\s*/,'')} ` +
    `${corWeek.toISOString().slice(0,10)} a ${fin.toISOString().slice(0,10)}.pdf`;

  /* En el celular lo que se quiere es mandarlo, no guardarlo. Si el teléfono
     sabe compartir archivos, se abre el menú de compartir; si no, se descarga. */
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
async function wireCor(){
  wireDrop('corBox');
  const xlsxToCor = async f=>{
    await loadXLSX();
    const buf=await f.arrayBuffer(); const wb=XLSX.read(buf);
    const ws=wb.Sheets[wb.SheetNames[0]]; return xlsxToCorteText(ws);
  };
  const handleCorFile = async f=>{
    if(!f) return; toast('Leyendo archivo\u2026');
    try{
      const nm=(f.name||'').toLowerCase();
      const text=nm.endsWith('.xlsx')||nm.endsWith('.xls') ? await xlsxToCor(f) : await fileToText(f);
      $('#corBox').value=text;
      /* Y se aplica solo. Antes el archivo nada más se copiaba al cuadro de
         texto y había que picarle a "Leer corte" aparte: quien subía el PDF
         veía los campos en cero, daba por hecho que el lector no servía, y en
         realidad nunca se le había pedido que leyera. */
      applyCorte(text);
    }catch(e){ toast('No pude leer el archivo'); }
  };
  const ta=$('#corBox');
  if(ta && !ta._corxlsx){ ta._corxlsx=true;
    ta.addEventListener('dragover', e=>{ e.preventDefault(); ta.style.borderColor='var(--gold)'; ta.style.background='#FFF6E2'; });
    ta.addEventListener('dragleave', ()=>{ ta.style.borderColor=''; ta.style.background=''; });
    ta.addEventListener('drop', e=>{ e.preventDefault(); ta.style.borderColor=''; ta.style.background=''; handleCorFile(e.dataTransfer.files[0]); });
  }
  $('#corPick')?.addEventListener('click', ()=>{
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.pdf,.xlsx,.xls,.txt';
    inp.onchange=()=>handleCorFile(inp.files[0]); inp.click();
  });
  const applyCorte = (text)=>{
    const r = parseCorte(text);
    if(r){
      /* ---- de qué sucursal y de qué semana es este papel ----
         Un corte de San Carlos capturado en la semana de Guaymas queda
         guardado como si fuera de Guaymas, y ya nadie se entera: los dos
         números existen, los dos parecen buenos, y el que compara ve una
         diferencia enorme que no es real. Vale más no dejar cargarlo. */
      const LOC = {1:'Guaymas', 2:'San Carlos'};
      if(r.sucursal && r.sucursal !== finLoc){
        /* Se avisa, no se prohíbe. Bloquear un corte bueno porque la
           detección se equivocó es peor que dejar pasar uno con la
           advertencia enfrente: quien captura tiene el papel en la mano. */
        const ok = confirm(`Creo que este corte es de ${LOC[r.sucursal]} `
          + `(folio ${r.folio_inicial||'?'}) y en la pantalla tienes ${LOC[finLoc]}.\n\n`
          + `¿Lo cargo de todos modos?`);
        if(!ok) return;
      }
      const finSem = new Date(corWeek); finSem.setDate(finSem.getDate()+6);
      if(r.desde && r.desde !== dstr(corWeek)){
        const ok = confirm(`El corte dice del ${r.desde} al ${r.hasta||'?'}, `
          + `y la semana abierta es del ${dstr(corWeek)} al ${dstr(finSem)}.\n\n`
          + `¿Lo cargo de todos modos en esta semana?`);
        if(!ok) return;
      }
      const ed=corInitEdit();
      for(const k of ['ef_decl','tj_decl','depositos','retiros','ef_final_decl','venta_neta','venta_imp','cortesias','dsc_alimentos','dsc_bebidas','dsc_otros','ctas_cortesia','ctas_dscto','ctas_canceladas','rappi','maquilas']){ if(r[k]!=null) ed[k]=r[k]; }

      /* Se dice de una vez si el corte cuadra consigo mismo: las formas de
         pago contra las ventas CON IVA. Si esas dos no dan lo mismo, el
         archivo se leyó mal o al corte le falta un renglón, y más vale
         saberlo ahora que después de guardar. */
      const fp = Number(ed.ef_decl||0) + Number(ed.tj_decl||0) +
                 Number(ed.rappi||0) + Number(ed.maquilas||0);
      const vi = Number(ed.venta_imp||0);
      corLeido = { quien: r.sucursal ? ({1:'Guaymas',2:'San Carlos'})[r.sucursal]
                                      : 'sucursal no identificada',
                   desde: r.desde, hasta: r.hasta, venta_imp: Number(ed.venta_imp||0) };
      const quien = r.sucursal ? ({1:'Guaymas',2:'San Carlos'})[r.sucursal] + ' · ' : '';
      toast(vi > 0 && Math.abs(fp - vi) < 1
        ? `${quien}corte le\u00eddo \u2014 ventas con IVA ${money(vi)}, cuadra con las formas de pago`
        : (vi > 0 ? `${quien}corte le\u00eddo \u2014 OJO: formas de pago ${money(fp)} vs ventas con IVA ${money(vi)}`
                  : `${quien}corte le\u00eddo \u2014 revisa los montos`));
      render();
    } else toast('No detect\u00e9 los montos \u2014 pega el texto completo del corte en el cuadro');
  };
  $('#main').querySelectorAll('[data-cwk]').forEach(b=>b.addEventListener('click', ()=>{
    corWeek.setDate(corWeek.getDate() + 7*Number(b.dataset.cwk));
    corData=null; corEdit=null; corDiasEditable=false; corEditable=false; corAPI=null; corLeido=null; refreshCor();
  }));
  $('#corRead')?.addEventListener('click', ()=>{ applyCorte($('#corBox').value); });

  $('#corPdf')?.addEventListener('click', async ev=>{
    const b = ev.currentTarget, etq = b.textContent;
    b.disabled = true; b.textContent = 'Armando el reporte…';
    try{ await corGeneraPDF(); }
    catch(e){ toast('No se pudo generar el PDF' + (e && e.message ? ': ' + e.message : '')); }
    finally{ b.disabled = false; b.textContent = etq; }
  });

  /* Jala del punto de venta lo DECLARADO: efectivo, tarjeta, venta y
     cancelaciones de los siete días. Lo del recuadro 2 —lo que de verdad se
     entregó— NO se toca a propósito: si se llenara con lo mismo que dice el
     sistema, la diferencia siempre daría cero y el corte dejaría de servir
     para lo único que sirve, que es comparar el POS contra la realidad. */
  $('#corJalar')?.addEventListener('click', async ev=>{
    const b = ev.currentTarget, etq = b.textContent;
    const suc = finLoc===1 ? 'guaymas' : 'sancarlos';
    b.disabled = true;
    const dias = [];
    for(let i=0;i<7;i++){ const d=new Date(corWeek); d.setDate(d.getDate()+i); dias.push(dstr(d)); }
    const acum = {efectivo:0, tarjeta:0, transferencia:0, total:0, propinas:0,
                  descuentos:0, canceladas:0, monto_cancelado:0, otros:0};
    const otrosNom = {};
    let fallos = 0, motivo = '';
    for(let i=0;i<dias.length;i++){
      b.textContent = `Jalando ${i+1} de 7…`;
      try{
        const r = await fetch(`/api/soft-ventas?sucursal=${suc}&fecha=${dias[i]}&productos=0&token=${encodeURIComponent(user.token)}`);
        const d = await r.json().catch(()=>null);
        if(d?.error) throw new Error(d.error);
        if(!r.ok) throw new Error('el servidor contestó '+r.status);
        acum.efectivo      += Number(d.pagos?.efectivo||0);
        acum.tarjeta       += Number(d.pagos?.tarjeta||0);
        acum.transferencia += Number(d.pagos?.transferencia||0);
        acum.otros         += Number(d.pagos?.otros||0);
        acum.total         += Number(d.total||0);
        acum.propinas      += Number(d.propinas||0);
        acum.descuentos    += Number(d.descuentos||0);
        acum.canceladas    += Number(d.canceladas||0);
        acum.monto_cancelado += Number(d.monto_cancelado||0);
        for(const [k,v] of Object.entries(d.otros_detalle||{})) otrosNom[k]=(otrosNom[k]||0)+Number(v||0);
      }catch(e){ fallos++; motivo = e.message || 'sin detalle'; }
    }
    b.disabled = false; b.textContent = etq;
    /* Si truena, decir POR QUÉ. Un "no se pudo conectar" a secas no deja
       distinguir entre la llave del Soft mal puesta y el internet caído. */
    if(fallos===7){ toast('No se pudo traer del punto de venta — '+motivo); return; }

    const ed = corInitEdit();
    /* Solo se escribe lo que la API de verdad tiene.

       Antes esto también llenaba «Dscto. otros» con SaleTotal.Discount, y
       estaba mal por partida doble: ese campo es el TOTAL de descuentos del
       mes, no los de la categoría «otros», y además no es lo mismo que lo que
       reporta el corte Z. En una semana real la API decía $1,050.00 y el corte
       decía $23.28 de descuentos y $3,508.62 de cortesías, que son conceptos
       distintos. Escribir ahí ese número no ahorraba trabajo: metía un dato
       falso en el renglón equivocado.

       Depósitos, retiros, efectivo final, venta neta, cortesías y el desglose
       de descuentos NO existen en la API: son del corte Z. Se dejan en paz. */
    /* ============================================================
       Lo que trae la API se guarda APARTE, no encima del corte.
       ------------------------------------------------------------
       Antes los dos escribían en las mismas casillas: el que corriera
       al último borraba al otro y la diferencia desaparecía sin que
       nadie la viera. Y hay diferencia — en la semana del 31 de agosto,
       Guaymas: el corte reparte $35,591.50 en efectivo y $60,725.50 en
       tarjeta; las ventas del sistema dicen $34,442.50 y $61,874.50.
       El total es el MISMO al peso ($121,861.00) y las cuentas también
       (193): son $1,149.00 que en un lado están como efectivo y en el
       otro como tarjeta.

       Esa diferencia es justo lo que hay que ver, no lo que hay que
       tapar. Así que el corte manda —es el papel firmado— y la API se
       enseña al lado, con la resta hecha.
       ============================================================ */
    corAPI = {
      ef: Math.round(acum.efectivo*100)/100,
      tj: Math.round(acum.tarjeta*100)/100,
      total: Math.round(acum.total*100)/100,
      rappi: Math.round((otrosNom.RAPPI||0)*100)/100,
      maquilas: Math.round((otrosNom.MAQUILAS||0)*100)/100,
      canceladas: acum.canceladas,
      cuando: new Date().toLocaleString('es-MX',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
    };
    /* Solo se escriben las casillas que estén VACÍAS. Si el PDF del corte ya
       las llenó, ese número se respeta: es el que firmó la sucursal. */
    const vacio = v => v==='' || v==null || Number(v)===0;
    if(vacio(ed.ef_decl))   ed.ef_decl   = corAPI.ef;
    if(vacio(ed.tj_decl))   ed.tj_decl   = corAPI.tj;
    if(vacio(ed.venta_imp)) ed.venta_imp = corAPI.total;
    if(vacio(ed.ctas_canceladas)) ed.ctas_canceladas = acum.canceladas;
    /* Rappi y maquilas sí vienen en la API, con su nombre, dentro de las otras
       formas de pago. Se buscan por nombre y no por posición: la lista de
       formas cambia entre sucursales. */
    const porNombre = re => Object.entries(otrosNom)
      .filter(([k]) => re.test(k)).reduce((t,[,v]) => t + Number(v||0), 0);
    if(vacio(ed.rappi))    ed.rappi    = Math.round(porNombre(/RAPPI|DIDI|UBER/i)*100)/100;
    if(vacio(ed.maquilas)) ed.maquilas = Math.round(porNombre(/MAQUILA/i)*100)/100;
    corEditable = false;
    render();
    const extra = Object.keys(otrosNom).length
      ? ` · otras formas: ${Object.entries(otrosNom).map(([k,v])=>k+' '+money(v)).join(', ')}`
      : '';
    /* Se dice qué quedó pendiente, con nombre y apellido. Un botón que llena
       cuatro campos de catorce y no lo advierte hace pensar que ya está. */
    const faltan = !Number(ed.venta_neta||0) || !Number(ed.ef_final_decl||0) || !Number(ed.cortesias||0);
    toast(`${fallos?`${7-fallos} de 7 días · `:''}Efectivo ${money(acum.efectivo)} · Tarjeta ${money(acum.tarjeta)}${extra}` +
      (faltan ? ' — falta subir el PDF del corte: venta neta, depósitos, retiros, efectivo final, cortesías y descuentos no vienen en la API.' : ''));
  });
  $('#main').querySelectorAll('[data-cf]').forEach(inp=>inp.addEventListener('change', ()=>{
    const ed = corInitEdit();
    if(inp.dataset.cf==='notes') ed.notes = inp.value;
    else if(inp.dataset.cf==='ef_real') ed.ef_real = inp.value==='' ? '' : numMX(inp.value);
    else ed[inp.dataset.cf] = numMX(inp.value||0);
    render();
  }));
  /* Las tres rejillas por día se capturan igual (aceptan sumas: 100+200). */
  [['data-cef','ef_days'],['data-ctr','tr_days'],['data-ctp','tp_days']].forEach(([attr,campo])=>{
    $('#main').querySelectorAll('['+attr+']').forEach(inp=>inp.addEventListener('change', ()=>{
      const raw = inp.value.trim(), dia = inp.getAttribute(attr);
      if(raw===''){ corInitEdit()[campo][dia] = ''; }
      else if(/^[\d\s+\-*/.(),]+$/.test(raw)){
        try{ const val = Math.round(Function('return '+raw)()*100)/100;
          corInitEdit()[campo][dia] = val; inp.value = val;
        }catch(e){ corInitEdit()[campo][dia] = numMX(raw); }
      } else corInitEdit()[campo][dia] = numMX(raw);
      render();
    }));
  });
  $('#main').querySelectorAll('[data-ctc]').forEach(inp=>inp.addEventListener('change', ()=>{
    // Allow math expressions: 100+200+500 → evaluates to 800
    const raw = inp.value.trim();
    if(raw === '') { corInitEdit().tc_days[inp.dataset.ctc] = ''; }
    else if(/^[\d\s+\-*/.(),]+$/.test(raw)) {
      try { const val = Math.round(Function('return '+raw)()*100)/100;
        corInitEdit().tc_days[inp.dataset.ctc] = val;
        inp.value = val; // show result
      } catch(e) { corInitEdit().tc_days[inp.dataset.ctc] = numMX(raw); }
    } else { corInitEdit().tc_days[inp.dataset.ctc] = numMX(raw); }
    render();
    render();
  }));
  $('#useSRVenta')?.addEventListener('click', ()=>{
    corInitEdit().venta_neta = corData._st;
    render();
  });
  $('#main').querySelectorAll('[data-rp]').forEach(inp=>inp.addEventListener('change', ()=>{
    const ix=Number(inp.dataset.rp), f=inp.dataset.rf;
    const ed=corInitEdit();
    if(!ed.retiros_pend) ed.retiros_pend=[{},{},{},{}];
    ed.retiros_pend[ix] = {...(ed.retiros_pend[ix]||{}), [f]: inp.value};
    render();
  }));
  $('#corTodo')?.addEventListener('click', ()=>{
    const abierto = corEditable && corDiasEditable;
    if(!abierto && !confirm('Este corte ya está guardado.\n\n¿Abrirlo completo para corregir números?\n\nAl terminar tienes que darle Actualizar corte para que se guarde.')) return;
    corEditable = corDiasEditable = !abierto;
    render();
  });
  $('#corDiasUnlock')?.addEventListener('click', ()=>{
    if(!corDiasEditable && !confirm('Este corte ya está guardado y cuadrado.\n\n¿Abrirlo para corregir la captura por día?')) return;
    corDiasEditable = !corDiasEditable; render();
  });
    $('#corUnlock')?.addEventListener('click', ()=>{
    if(!corEditable && !confirm('Estos números salen del corte del sistema.\n\n¿Desbloquear para corregirlos a mano? Hazlo solo si el archivo se leyó mal.')) return;
    corEditable = !corEditable; render();
  });
  $('#corSave')?.addEventListener('click', async ()=>{
    const ed = corInitEdit();
    const suma = o => COR_DAYS.reduce((s,k)=>s+Number(o[k]||0),0);
    const hayEf = COR_DAYS.some(k=>ed.ef_days[k]!=='' && ed.ef_days[k]!=null);
    const payload = {...ed,
      /* ef_real se sigue guardando como el total de la semana para no romper
         los cortes viejos ni los reportes que ya lo leen. */
      ef_real: hayEf ? suma(ed.ef_days) : (ed.ef_real===''?null:numMX(ed.ef_real)),
      ef_days: Object.fromEntries(COR_DAYS.map(k=>[k, Number(ed.ef_days[k]||0)])),
      tr_days: Object.fromEntries(COR_DAYS.map(k=>[k, Number(ed.tr_days[k]||0)])),
      tc_days: Object.fromEntries(COR_DAYS.map(k=>[k, Number(ed.tc_days[k]||0)])),
      tp_days: Object.fromEntries(COR_DAYS.map(k=>[k, Number(ed.tp_days[k]||0)])),
      tj_propina: COR_DAYS.some(k=>ed.tp_days[k]!=='' && ed.tp_days[k]!=null)
        ? COR_DAYS.reduce((t,k)=>t+Number(ed.tp_days[k]||0),0) : Number(ed.tj_propina||0),
      cortesias: Number(ed.cortesias||0), dsc_alimentos: Number(ed.dsc_alimentos||0),
      dsc_bebidas: Number(ed.dsc_bebidas||0), dsc_otros: Number(ed.dsc_otros||0),
      ctas_cortesia: Number(ed.ctas_cortesia||0), ctas_dscto: Number(ed.ctas_dscto||0),
      ctas_canceladas: Number(ed.ctas_canceladas||0),
      /* Rappi y Maquilas empiezan vacíos en un corte nuevo. Se iban tal cual
         —cadena vacía— y la base no los podía convertir a número: el guardado
         tronaba y la pantalla se comía el error. Se le picaba a Guardar y no
         pasaba nada, con el corte entero capturado. */
      venta_neta: Number(ed.venta_neta||0), venta_imp: Number(ed.venta_imp||0),
      depositos: Number(ed.depositos||0), retiros: Number(ed.retiros||0),
      ef_decl: Number(ed.ef_decl||0), tj_decl: Number(ed.tj_decl||0),
      ef_final_decl: Number(ed.ef_final_decl||0),
      rappi: Number(ed.rappi||0), maquilas: Number(ed.maquilas||0)};
    const btn = $('#corSave');
    if(btn){ btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = 'Guardando…'; }
    try{
      await finRpc('cor_save', {p_week: dstr(corWeek), p_loc: finLoc, p: payload});
      toast('Corte guardado');
      corDiasEditable = false; corEditable = false;   // queda cerrado otra vez
      corData=null; corEdit=null; refreshCor();
    }catch(e){
      /* Antes esto era un catch vacío. Un guardado que falla en silencio es
         peor que uno que falla: quien capturó se va creyendo que quedó. */
      toast('NO se guardó: ' + (e.message || 'error de conexión'));
      if(btn){ btn.disabled = false; btn.textContent = btn.dataset.txt || 'Guardar corte'; }
    }
  });
}
/* ---------- conciliaci\u00f3n bancaria ---------- */
/* ---------- pedido extendido de compras ---------- */
/* ---------- horario semanal ---------- */
const SCH_SHIFTS = ["4:00PM - 12:00AM","10:00AM - 6:00PM","12:00PM - 8:00PM","DESCANSO"];
const SCH_COLORS = {"4:00PM - 12:00AM":"#5B8FDE","10:00AM - 6:00PM":"#F0C43A","12:00PM - 8:00PM":"#E07A3A","DESCANSO":"#E8E4DC"};
const SCH_DAYS = ["LUN","MAR","MI\u00c9","JUE","VIE","S\u00c1B","DOM"];