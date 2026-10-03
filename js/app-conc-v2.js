/* ============================================================
   Boye's OPS — Conciliación del estado de cuenta
   ------------------------------------------------------------
   El trabajo que hace Rod a mano: agarra el estado de cuenta del
   mes y verifica que CADA movimiento del banco esté capturado en
   la planilla. Karen captura en la fecha del CONSUMO (el día que
   llegó la nota); el banco lo muestra en la fecha del PAGO, que
   puede ser una semana después si hay crédito. Por eso la
   búsqueda es por MONTO, no por fecha.

   La regla que lo vuelve confiable: una casilla confirmada queda
   CONSUMIDA. Si en mayo se confirmó $1,500 de VERDURA, un $1,500
   de VERDURA en junio tiene que encontrar OTRA casilla. Sin eso,
   el mismo apunte cuadraría dos meses distintos y la conciliación
   no probaría nada.
   ============================================================ */

let concMes = null;        // mes del estado de cuenta, 'AAAA-MM'
let concEdo = null;        // lo leído del PDF
let concError = null;
let concMeses = {};        // planillas cargadas: 'AAAA-MM' -> {ventas,gastos_var,formato}
let concCargando = false;
let concFiltro = 'pendientes';
let concVentana = 30;      // días de holgura entre el consumo y el pago

const MESES_ABR = {ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEP:9,OCT:10,NOV:11,DIC:12};

/* ---------- 1. leer el estado de cuenta ---------- */

/* El tipo de movimiento NO se decide por la columna en la que cae el número
   —el PDF trae marca de agua encima y las columnas se ensucian— sino por el
   saldo: si bajó fue cargo, si subió fue abono. El saldo nunca miente. */
function concClase(concepto, tipo){
  const c = (concepto||'').toUpperCase();
  if(/LIQUIDACION ADQ/.test(c))                     return 'deposito_tarjeta';
  if(/TASA DE DESCTO|TASA DESCUENTO|IVA TASA/.test(c)) return 'comision';
  if(/TRASPASO ENTRE CUENTAS/.test(c))              return 'traspaso';
  if(/RENDIMIENTO|INTERES/.test(c))                 return 'rendimiento';
  if(/COMISION|ANUALIDAD|MANEJO DE CUENTA/.test(c)) return 'comision';
  return tipo==='cargo' ? 'pago' : 'ingreso';
}

/* Las líneas de abajo de cada movimiento traen el beneficiario y su banco.
   El nombre es la primera que no es la del banco+CLABE ni basura de la marca
   de agua. */
function concEsRuido(l){
  if(!l) return true;
  if(/^(BBVA|BANORTE|SANTANDER|CITI|BAJIO|STP|HSBC|SCOTIABANK|AZTECA|INBURSA|BANCOPPEL|AFIRME|MIFEL|MULTIVA)\b.*\d{10,}/i.test(l)) return true;
  if(/^\d{10,}$/.test(l)) return true;
  if(/PAGO EN UNA SOLA EXHIBICION|Tasa IVA|Página|ESTADO DE CUENTA|www\.|Banco Inbursa/i.test(l)) return true;
  /* Basura de la marca de agua. Trae símbolos que ningún nombre de proveedor
     usa, y muy pocas letras en proporción a su largo. */
  if(/[{}\[\]%;+?^~|<>\\]/.test(l)) return true;
  const letras = (l.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g)||[]).length;
  if(letras / Math.max(l.length,1) < 0.55) return true;
  if(l.length < 22 && !/\s/.test(l) && !/[AEIOU]/i.test(l)) return true;
  if(/^[^A-Za-z0-9]*$/.test(l)) return true;
  return false;
}

function concLee(lineas, anio){
  const movs = [];
  let saldoPrev = null, diaPrev = null, mesPrev = null;
  let declarado = {};

  for(let i=0; i<lineas.length; i++){
    const l = String(lineas[i]).replace(/\s+/g,' ').trim();
    if(!l) continue;

    /* Los totales que el propio estado declara. Son el juez: si lo que leí no
       suma exactamente eso, la lectura está mal y hay que decirlo, no seguir. */
    let m;
    const primero = (k, v) => { if(declarado[k] === undefined) declarado[k] = v; };
    if((m = l.match(/SALDO ANTERIOR\s+([\d,]+\.\d{2})/i)))  primero('saldo_anterior', numMX(m[1]));
    if((m = l.match(/SALDO ACTUAL\s+([\d,]+\.\d{2})/i)))    primero('saldo_actual',   numMX(m[1]));
    if((m = l.match(/\bABONOS\s+([\d,]+\.\d{2})/i)))        primero('abonos', numMX(m[1]));
    if((m = l.match(/\bCARGOS\s+([\d,]+\.\d{2})/i)))        primero('cargos', numMX(m[1]));

    /* El día tiene que ir SOLO: sin el lookahead, "ABR. 4202626514 ..." le
       arrancaba el "42" al número de referencia y salían fechas de abril 42. */
    const dm = l.match(/^([A-Z]{3})\.\s*(?:(\d{1,2})(?=\s|$))?\s*(.*)$/);
    if(!dm) continue;
    const mesN = MESES_ABR[dm[1].toUpperCase()];
    if(!mesN) continue;

    let dia = dm[2] ? Number(dm[2]) : null;
    if(dia !== null && (dia < 1 || dia > 31)) dia = null;
    let resto = dm[3] || '';
    /* El día a veces se le va al renglón de abajo (el PDF lo parte). Se busca
       ahí; si tampoco está, se hereda del movimiento anterior, que en un estado
       de cuenta va en orden. */
    if(dia === null){
      /* Se acepta solo si de verdad parece un día: 1 a 31, y sin retroceder
         —un estado de cuenta va en orden—. Sin ese filtro se colaban pedazos
         de una CLABE y salían fechas como "38 de abril". */
      for(let k=1; k<=2 && i+k<lineas.length; k++){
        const sig = String(lineas[i+k]).trim().match(/^(\d{1,2})(\s|$)/);
        if(!sig) continue;
        const n = Number(sig[1]);
        if(n>=1 && n<=31 && (diaPrev===null || (n>=diaPrev && n<=diaPrev+5))){ dia = n; break; }
      }
      if(dia === null) dia = diaPrev;
    }
    if(!dia) continue;

    const nums = [...resto.matchAll(/-?\d[\d,]*\.\d{2}/g)].map(x=>numMX(x[0]));
    if(!nums.length){                                  // BALANCE INICIAL sin importe
      const soloSaldo = l.match(/([\d,]+\.\d{2})\s*$/);
      if(soloSaldo) saldoPrev = numMX(soloSaldo[1]);
      diaPrev = dia; mesPrev = mesN;
      continue;
    }
    if(nums.length === 1){ saldoPrev = nums[0]; diaPrev = dia; mesPrev = mesN; continue; }

    const saldo  = nums[nums.length-1];
    const monto  = nums[nums.length-2];
    const tipo   = (saldoPrev !== null && saldo < saldoPrev) ? 'cargo' : 'abono';

    const refM = resto.match(/^(\d{6,})\s+/);
    const ref  = refM ? refM[1] : '';
    let concepto = resto.replace(/^(\d{6,})\s+/,'')
                        .split(/-?\d[\d,]*\.\d{2}/)[0]
                        .replace(/\s+/g,' ').trim();

    /* Beneficiario: las dos o tres líneas siguientes, saltando el renglón del
       banco destino y la basura de la marca de agua. */
    let beneficiario = '';
    for(let k=1; k<=4 && i+k<lineas.length; k++){
      const sig = String(lineas[i+k]).replace(/\s+/g,' ').trim().replace(/^\d{1,2}\s+/,'');
      if(/^[A-Z]{3}\.\s*\d{0,2}/.test(sig)) break;      // ya empezó el siguiente movimiento
      if(concEsRuido(sig)) continue;
      beneficiario = sig.slice(0,80);
      break;
    }

    movs.push({
      id: `${anio}-${String(mesN).padStart(2,'0')}-${String(dia).padStart(2,'0')}|${ref||i}|${monto.toFixed(2)}`,
      fecha: `${anio}-${String(mesN).padStart(2,'0')}-${String(dia).padStart(2,'0')}`,
      dia, mes: mesN, ref, concepto: concepto.slice(0,120), beneficiario,
      monto, tipo, saldo, clase: concClase(concepto, tipo)
    });
    saldoPrev = saldo; diaPrev = dia; mesPrev = mesN;
  }

  if(!movs.length) return {error:'No encontré movimientos. ¿El PDF es una foto escaneada? Esos todavía no se pueden leer.'};

  const sumaCargos = movs.filter(m=>m.tipo==='cargo').reduce((s,m)=>s+m.monto,0);
  const sumaAbonos = movs.filter(m=>m.tipo==='abono').reduce((s,m)=>s+m.monto,0);
  return {movs, declarado,
          suma_cargos: Math.round(sumaCargos*100)/100,
          suma_abonos: Math.round(sumaAbonos*100)/100};
}

/* ---------- 2. cruzar contra lo que capturó Karen ---------- */

/* Todas las casillas de gasto de los meses cargados, con su estado: libre,
   o ya consumida por otro movimiento del banco. */
function concCasillas(){
  const out = [];
  for(const [ym, P] of Object.entries(concMeses)){
    const conc = (P.formato||{})._conc || {};
    for(const [cat, dias] of Object.entries(P.gastos_var||{})){
      for(const [d, val] of Object.entries(dias||{})){
        const monto = planN(val);
        if(!monto) continue;
        const clave = `g|${cat}|${d}`;
        out.push({
          ym, cat, dia: Number(d), monto, clave,
          fecha: `${ym}-${String(d).padStart(2,'0')}`,
          /* Naranja = Rod ya la verificó contra un estado de cuenta anterior
             (así venía del Excel). Esa cantidad ya se usó: no se vuelve a ofrecer. */
          usada: conc[clave] || (String((P.formato||{})[clave]?.bg||'').toUpperCase()===CONC_COLOR
                   ? {mov:'excel', por:'Excel (naranja)'} : null)
        });
      }
    }
  }
  return out;
}

function concDias(a, b){
  return Math.abs((new Date(a+'T12:00:00') - new Date(b+'T12:00:00')) / 86400000);
}

/* Los candidatos de un movimiento: mismo monto al centavo, dentro de la
   ventana, y —lo importante— que NADIE más los haya consumido. Se ordenan por
   cercanía en días y por parecido del nombre del beneficiario con el concepto. */
function concCandidatos(mov, casillas){
  const cand = casillas.filter(c =>
    Math.abs(c.monto - mov.monto) < 0.01 &&
    (!c.usada || c.usada.mov === mov.id) &&
    concDias(c.fecha, mov.fecha) <= concVentana
  );
  const nom = (mov.beneficiario + ' ' + mov.concepto).toUpperCase();
  const puntos = c => {
    let p = concDias(c.fecha, mov.fecha);
    const pal = c.cat.split(/[^A-ZÑ]+/i).filter(x=>x.length>3);
    if(pal.some(x => nom.includes(x.toUpperCase()))) p -= 100;   // el nombre coincide: gana
    return p;
  };
  return cand.sort((a,b)=>puntos(a)-puntos(b));
}

function concEstadoDe(mov, casillas){
  if(['comision','traspaso','rendimiento','deposito_tarjeta'].includes(mov.clase)) return 'aparte';
  if(mov.tipo === 'abono') return 'aparte';
  const yaUsada = casillas.find(c => c.usada && c.usada.mov === mov.id);
  if(yaUsada) return 'confirmado';
  return concCandidatos(mov, casillas).length ? 'propuesto' : 'sin_apunte';
}

/* ---------- 3. cargar las planillas de la ventana ---------- */

/* La conciliación cruza meses: un pago de junio puede corresponder a una nota
   de mayo. Por eso se cargan el mes del estado de cuenta y sus vecinos, y se
   guarda en el mes al que pertenece la casilla, no en el del estado. */
function concVecinos(ym){
  const [y,m] = ym.split('-').map(Number);
  return [-2,-1,0,1].map(k=>{
    const d = new Date(y, m-1+k, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });
}

async function concCargaMeses(){
  concCargando = true;
  try{
    const yms = concVecinos(concMes);
    const {data} = await sb.from('planilla_months').select('*')
      .eq('location_id', finLoc).in('year_month', yms);
    concMeses = {};
    for(const ym of yms){
      const row = (data||[]).find(r=>r.year_month===ym);
      concMeses[ym] = row
        ? {ventas:row.ventas||{}, gastos_var:row.gastos_var||{}, formato:row.formato||{}}
        : {ventas:{}, gastos_var:{}, formato:{}};
    }
  }catch(e){ concError = 'No pude leer las planillas de esos meses'; }
  finally{ concCargando = false; }
  render();
}

/* Guardar un mes concreto. Se manda solo lo que esta pantalla toca —formato,
   que es donde viven el color y la marca de conciliado— para no pisar una
   captura que Karen esté haciendo al mismo tiempo en otra pestaña. */
async function concGuarda(ym){
  const P = concMeses[ym];
  if(!P) return;
  const {data} = await sb.from('planilla_months').select('*')
    .eq('location_id', finLoc).eq('year_month', ym).limit(1);
  const base = (data && data[0]) || {ventas:{}, gastos_var:{}, gastos_fijos:{}, banco:{}};
  await sb.from('planilla_months').upsert({
    location_id: finLoc, year_month: ym,
    ventas: base.ventas||{}, gastos_var: base.gastos_var||{},
    gastos_fijos: base.gastos_fijos||{}, banco: base.banco||{},
    formato: P.formato||{},
    created_by: user.name, updated_at: new Date().toISOString()
  }, {onConflict:'location_id,year_month'});
  /* Si el mes que se tocó es el que está abierto en la Planilla, se le pasa
     el formato nuevo en sitio. Antes se tiraba planData y eso recargaba toda
     la pantalla y la mandaba hasta arriba en cada clic. */
  if(ym === planMonth && planData && planData.location_id === finLoc){
    planData.formato = JSON.parse(JSON.stringify(P.formato||{}));
    if(planEdit) planEdit.formato = JSON.parse(JSON.stringify(P.formato||{}));
  }
}

/* El color de "ya lo verifiqué yo" es el naranja del Excel de Rod, para que
   la app y el Excel hablen el mismo idioma. El azul viejo se sigue
   reconociendo para poder deshacer lo que se confirmó antes. */
const CONC_COLOR = '#FF9900';
const CONC_AZUL_VIEJO = '#CFE3FB';

async function concConfirma(movId, clave, ym){
  const P = concMeses[ym]; if(!P) return;
  P.formato = P.formato || {};
  P.formato._conc = P.formato._conc || {};
  const mov = concEdo.movs.find(m=>m.id===movId);
  P.formato._conc[clave] = {mov: movId, fecha_banco: mov?.fecha, monto: mov?.monto,
                            por: user.name, cuando: new Date().toISOString()};
  P.formato[clave] = { ...(P.formato[clave]||{}), bg: CONC_COLOR };
  /* Primero se pinta (al instante, sin moverse de lugar) y luego se guarda. */
  render();
  toast('Confirmado — la casilla quedó en naranja');
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

async function concDeshace(clave, ym){
  const P = concMeses[ym]; if(!P) return;
  if(P.formato?._conc) delete P.formato._conc[clave];
  /* Se quita el azul, pero solo si es el azul de la conciliación: si Rod le
     puso otro color a mano, ese se respeta. */
  if([CONC_COLOR, CONC_AZUL_VIEJO].includes(String(P.formato?.[clave]?.bg||'').toUpperCase())){
    delete P.formato[clave].bg;
    if(!Object.keys(P.formato[clave]).length) delete P.formato[clave];
  }
  render();
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

/* ---------- 4. depósitos de terminal ---------- */

/* Lo que se cobra con tarjeta entra al banco el siguiente día hábil, pero
   "hábil" no es solo lunes-a-viernes: en Semana Santa el depósito del lunes 6
   traía cinco días de venta. En vez de cargar un calendario de días festivos
   —que se desactualiza y miente— se usa el propio estado de cuenta: un
   depósito cubre TODOS los días desde el depósito anterior hasta el día antes
   de éste. El banco mismo dice qué días fueron hábiles. */
/* De 'desde' a 'hasta', ambos incluidos. El día del depósito anterior SÍ entra:
   ese depósito cubría hasta la víspera, así que la venta de ese mismo día se
   deposita en el siguiente. Sin incluirlo, dos depósitos seguidos dejaban un
   rango vacío y la comparación se quedaba muda. */
function concRango(desde, hasta){
  const out = [];
  const d = new Date(desde+'T12:00:00'), h = new Date(hasta+'T12:00:00');
  while(d <= h){ out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
  return out;
}

function concTarjeta(){
  if(!concEdo) return [];
  const porDia = {};
  for(const m of concEdo.movs){
    if(m.clase!=='deposito_tarjeta' && m.clase!=='comision') continue;
    const r = porDia[m.fecha] = porDia[m.fecha] || {fecha:m.fecha, deposito:0, comision:0, marcas:{}};
    if(m.clase==='deposito_tarjeta'){
      r.deposito += m.monto;
      const marca = /AMEX/.test(m.concepto) ? 'AMEX' : (/DEBITO/.test(m.concepto) ? 'Débito' : 'Crédito');
      r.marcas[marca] = (r.marcas[marca]||0) + m.monto;
    } else r.comision += m.monto;
  }
  const dias = Object.values(porDia).filter(r=>r.deposito>0).sort((a,b)=>a.fecha<b.fecha?-1:1);

  return dias.map((r,i)=>{
    const ayer = new Date(r.fecha+'T12:00:00'); ayer.setDate(ayer.getDate()-1);
    const hasta = ayer.toISOString().slice(0,10);
    /* Del depósito anterior (sin contarlo) hasta ayer. Para el primero del
       estado de cuenta solo se puede afirmar el día anterior. */
    const cubre = i===0 ? [hasta] : concRango(dias[i-1].fecha, hasta);

    let capturado = 0, faltan = 0;
    for(const f of cubre){
      const P = concMeses[f.slice(0,7)];
      const v = P ? planN((P.ventas?.[Number(f.slice(8,10))]||{}).tj) : 0;
      if(v) capturado += v; else faltan++;
    }
    const esperado = Math.round((r.deposito + r.comision)*100)/100;
    return {
      fecha: r.fecha,
      deposito: Math.round(r.deposito*100)/100,
      comision: Math.round(r.comision*100)/100,
      marcas: r.marcas,
      cubre, faltan,
      etiqueta: cubre.length===1 ? cubre[0] : `${cubre[0]} al ${cubre[cubre.length-1]} (${cubre.length} días)`,
      capturado: Math.round(capturado*100)/100,
      esperado,
      tasa: esperado ? (r.comision / esperado) * 100 : 0
    };
  });
}

/* ---------- 5. la pantalla ---------- */

function concChip(estado){
  const M = {
    confirmado : ['✓ Confirmado', '#0B6E3F', '#DFF3E7'],
    propuesto  : ['Por confirmar', '#8A5A00', '#FFF3D0'],
    sin_apunte : ['Sin apunte', '#C0261F', '#FFE4E1'],
    aparte     : ['Va aparte', '#5B6472', '#EDEDED']
  };
  const [t,c,b] = M[estado] || M.aparte;
  return `<span class="conc-chip" style="color:${c};background:${b}">${t}</span>`;
}

function concView(){
  let h = `<style>
    .conc-drop{border:2px dashed #C9C2B2;border-radius:12px;padding:26px 18px;text-align:center;
               background:#FBFAF6;cursor:pointer;transition:.15s}
    .conc-drop.on{border-color:var(--gold);background:#FFF6E2}
    .conc-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;
               letter-spacing:.02em;white-space:nowrap}
    .conc-mov{border:1px solid #E1DCD0;border-radius:11px;padding:11px 13px;margin-bottom:8px;background:var(--card)}
    .conc-mov.sin{border-left:4px solid #C0261F}
    .conc-mov.ok{border-left:4px solid #0B6E3F}
    .conc-mov.prop{border-left:4px solid #E0A100}
    .conc-top{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
    .conc-top .mnt{font-size:16px;font-weight:900;font-variant-numeric:tabular-nums}
    .conc-top .ben{font-weight:700;font-size:13.5px}
    .conc-top .fch{font-size:12px;color:var(--ink-2);font-weight:600;margin-left:auto}
    .conc-cand{margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
               background:#F6F4EE;border-radius:9px;padding:8px 10px}
    .conc-cand select{flex:1;min-width:200px;padding:6px 8px;border:1px solid #D8D2C4;border-radius:7px;
                      background:var(--card);font-family:inherit;font-size:12.5px}
    .conc-res{display:grid;gap:9px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin:12px 0}
    .conc-k{border:1px solid #E1DCD0;border-radius:10px;padding:9px 11px;background:var(--card);border-left-width:5px}
    .conc-k .l{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#6B6455}
    .conc-k .v{font-size:20px;font-weight:900;font-variant-numeric:tabular-nums}
  </style>`;

  h += locSwitch(finLoc,'floc');

  if(!concEdo){
    return h + `<div class="panel">
      <div class="d-h3">Conciliación del estado de cuenta</div>
      <p class="hint" style="margin:4px 0 14px">Arrastra aquí el PDF del banco. Busco cada cargo dentro de lo que
      capturó Karen en la planilla —por monto, no por fecha, porque ella apunta el día del consumo y el banco
      el día del pago— y te digo cuál encontró, cuál no está capturado y cuánto cobró el banco de comisión.
      Lo que tú confirmes se pinta de naranja (como en tu Excel) y esa casilla ya no se vuelve a usar para otro movimiento.</p>
      <div class="conc-drop" id="concDrop">
        <div style="font-size:30px;line-height:1">📄</div>
        <div style="font-weight:800;margin-top:6px">Suelta aquí el estado de cuenta</div>
        <div class="hint" style="margin-top:3px">PDF, Excel o CSV · o toca para elegirlo</div>
      </div>
      ${concError?`<p style="color:${D_ROJO};font-weight:700;margin-top:12px">${esc(concError)}</p>`:''}
      ${concCargando?`<p class="hint" style="margin-top:12px">Leyendo…</p>`:''}
    </div>`;
  }

  /* La prueba de que la lectura está bien: el propio estado declara cuánto
     sumaron los cargos y los abonos. Si no cuadra al peso, se dice y no se
     concilia nada —conciliar sobre una lectura chueca es peor que no hacerlo. */
  const dec = concEdo.declarado || {};
  const dC = dec.cargos!==undefined ? Math.round((concEdo.suma_cargos - dec.cargos)*100)/100 : null;
  const dA = dec.abonos!==undefined ? Math.round((concEdo.suma_abonos - dec.abonos)*100)/100 : null;
  const cuadra = (dC===null || Math.abs(dC)<0.01) && (dA===null || Math.abs(dA)<0.01);

  h += `<div class="panel" style="border-left:4px solid ${cuadra?D_VERDE:D_ROJO}">
    <div class="d-h3">${cuadra?'La lectura cuadra con el estado de cuenta':'La lectura NO cuadra'}</div>
    <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
      <th style="text-align:left">Concepto</th><th>Lo que leí</th><th>Lo que declara el banco</th><th>Diferencia</th>
    </tr></thead><tbody>
      <tr><td style="text-align:left">Cargos</td><td>${money(concEdo.suma_cargos)}</td>
          <td>${dec.cargos!==undefined?money(dec.cargos):'—'}</td>
          <td style="font-weight:800;color:${dC===null?'inherit':(Math.abs(dC)<0.01?D_VERDE:D_ROJO)}">${dC===null?'—':money(dC)}</td></tr>
      <tr><td style="text-align:left">Abonos</td><td>${money(concEdo.suma_abonos)}</td>
          <td>${dec.abonos!==undefined?money(dec.abonos):'—'}</td>
          <td style="font-weight:800;color:${dA===null?'inherit':(Math.abs(dA)<0.01?D_VERDE:D_ROJO)}">${dA===null?'—':money(dA)}</td></tr>
    </tbody></table></div>
    <p class="hint" style="margin:8px 0 0">${cuadra
      ? `Leí ${concEdo.movs.length} movimientos y suman exactamente lo que el banco dice. La lectura está completa.`
      : `Falta algo por leer. No conviene conciliar sobre esto — mándame el PDF y lo reviso.`}</p>
    <div class="frm-row" style="margin-top:10px"><button class="btn-quiet" id="concOtro">Cargar otro estado de cuenta</button></div>
  </div>`;

  if(concCargando) return h + `<div class="panel"><p class="hint">Cargando las planillas de esos meses…</p></div>`;

  const casillas = concCasillas();
  const pagos = concEdo.movs.filter(m=>m.tipo==='cargo' && m.clase==='pago');
  const estados = pagos.map(m=>({mov:m, estado:concEstadoDe(m, casillas)}));
  const nOk   = estados.filter(x=>x.estado==='confirmado').length;
  const nProp = estados.filter(x=>x.estado==='propuesto').length;
  const nSin  = estados.filter(x=>x.estado==='sin_apunte').length;
  const mSin  = estados.filter(x=>x.estado==='sin_apunte').reduce((s,x)=>s+x.mov.monto,0);

  h += `<div class="panel"><div class="d-h3">Pagos a proveedor · ${pagos.length} movimientos</div>
    <div class="conc-res">
      <div class="conc-k" style="border-left-color:#0B6E3F"><div class="l">Confirmados</div><div class="v">${nOk}</div></div>
      <div class="conc-k" style="border-left-color:#E0A100"><div class="l">Por confirmar</div><div class="v">${nProp}</div></div>
      <div class="conc-k" style="border-left-color:#C0261F"><div class="l">Sin apunte</div><div class="v">${nSin}</div>
        <div class="hint" style="margin:2px 0 0">${money(mSin)}</div></div>
    </div>
    <div class="frm-row" style="margin-bottom:10px;align-items:center;gap:8px;flex-wrap:wrap">
      ${[['pendientes','Por revisar'],['sin','Sin apunte'],['ok','Confirmados'],['todos','Todos']].map(([k,t])=>
        `<button class="btn-quiet${concFiltro===k?' on':''}" data-concf="${k}"
           style="${concFiltro===k?'background:var(--navy);color:#fff':''}">${t}</button>`).join('')}
      <label class="hint" style="margin-left:auto">Holgura
        <select id="concVent" style="padding:5px 7px;border:1px solid #D8D2C4;border-radius:7px;font-family:inherit">
          ${[15,30,45,60,90].map(d=>`<option value="${d}"${d===concVentana?' selected':''}>${d} días</option>`).join('')}
        </select></label>
    </div>`;

  const visibles = estados.filter(({estado})=>
      concFiltro==='todos' ? true :
      concFiltro==='ok'    ? estado==='confirmado' :
      concFiltro==='sin'   ? estado==='sin_apunte' :
                             estado!=='confirmado');

  if(!visibles.length) h += `<p class="hint">Nada en este filtro.</p>`;

  for(const {mov, estado} of visibles){
    const cls = estado==='confirmado'?'ok':(estado==='sin_apunte'?'sin':'prop');
    h += `<div class="conc-mov ${cls}">
      <div class="conc-top">
        <span class="mnt">${money(mov.monto)}</span>
        <span class="ben">${esc(mov.beneficiario || mov.concepto)}</span>
        ${concChip(estado)}
        <span class="fch">${esc(mov.fecha)} · ${esc(mov.concepto)}</span>
      </div>`;

    if(estado==='confirmado'){
      const c = casillas.find(x=>x.usada && x.usada.mov===mov.id);
      h += `<div class="conc-cand">
        <span style="font-size:12.5px">Va contra <b>${esc(c.cat)}</b> del ${c.dia} de ${esc(c.ym)}
          — lo confirmaste ${c.usada.por?`(${esc(c.usada.por)})`:''}</span>
        <button class="btn-quiet" data-concdes="${esc(c.clave)}" data-concym="${c.ym}"
                style="margin-left:auto">Deshacer</button></div>`;
    } else if(estado==='propuesto'){
      const cand = concCandidatos(mov, casillas);
      h += `<div class="conc-cand">
        <select data-conccand="${esc(mov.id)}">
          ${cand.slice(0,25).map((c,i)=>`<option value="${esc(c.ym)}|${esc(c.clave)}"${i?'':' selected'}>
            ${esc(c.cat)} · ${c.dia} de ${esc(c.ym)} · ${money(c.monto)} (${concDias(c.fecha,mov.fecha)} días antes)
          </option>`).join('')}
        </select>
        <button class="btn-primary" data-concok="${esc(mov.id)}">Confirmar</button></div>`;
    } else {
      h += `<div class="conc-cand" style="background:#FFF1EF">
        <span style="font-size:12.5px">No hay ninguna casilla de ese monto sin usar en ±${concVentana} días.
        O no está capturado, o el monto no coincide.</span></div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;

  /* ---- terminal ---- */
  const tj = concTarjeta();
  if(tj.length){
    const totDep = tj.reduce((s,x)=>s+x.deposito,0), totCom = tj.reduce((s,x)=>s+x.comision,0);
    h += `<div class="panel"><div class="d-h3">Depósitos de la terminal</div>
      <p class="hint" style="margin:0 0 10px">Lo que se cobra con tarjeta un día entra al banco el siguiente día hábil
      (lo del viernes, hasta el lunes). Aquí cada depósito se compara contra la venta con tarjeta del día que le toca.
      <b>Esperado</b> es el depósito más la comisión que el banco descontó de ese mismo depósito: eso es lo que
      debió haberse cobrado en caja.</p>
      <div class="conc-res">
        <div class="conc-k" style="border-left-color:#2A78D6"><div class="l">Depositado</div><div class="v">${money(totDep)}</div></div>
        <div class="conc-k" style="border-left-color:#C0261F"><div class="l">Comisión del banco</div><div class="v">${money(totCom)}</div>
          <div class="hint" style="margin:2px 0 0">${(totCom/(totDep+totCom)*100).toFixed(2)}% de lo cobrado con tarjeta</div></div>
      </div>
      <div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
        <th>Entró al banco</th><th>Depósito</th><th>Comisión</th><th>%</th><th>Esperado en caja</th>
        <th style="text-align:left">Días que cubre</th><th>Capturado</th><th>Diferencia</th></tr></thead><tbody>
        ${tj.map(x=>{
          const dif = x.capturado===0 ? null : Math.round((x.capturado - x.esperado)*100)/100;
          return `<tr>
            <td>${esc(x.fecha)}</td>
            <td>${money(x.deposito)}</td>
            <td>${money(x.comision)}</td>
            <td>${x.tasa.toFixed(2)}%</td>
            <td style="font-weight:800;background:#E6F0FA">${money(x.esperado)}</td>
            <td style="text-align:left">${esc(x.etiqueta)}${x.faltan?` <span style="color:${D_ROJO};font-weight:700">· ${x.faltan} sin capturar</span>`:''}</td>
            <td>${x.capturado?money(x.capturado):'<span style="color:'+D_ROJO+'">—</span>'}</td>
            <td style="font-weight:800;color:${dif===null?'inherit':(Math.abs(dif)<1?D_VERDE:D_ROJO)}">${dif===null?'—':money(dif)}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div>
      <p class="hint" style="margin-top:8px">Cuando un depósito cubre varios días es porque el banco no operó en medio
      —fin de semana o día festivo—. No uso un calendario de festivos: los días que cubre salen del propio estado de
      cuenta, del hueco entre un depósito y el anterior.</p></div>`;
  }
  return h;
}

function wireConc(){
  const drop = document.getElementById('concDrop');
  if(drop && !drop._listo){
    drop._listo = true;
    const lee = async f => {
      if(!f) return;
      concError = null; concCargando = true; render();
      try{
        const txt = await fileToText(f);
        const anio = Number((concMes||todayStr()).slice(0,4));
        const r = concLee(txt.split(/\r?\n/), anio);
        if(r.error){ concError = r.error; concEdo = null; }
        else {
          concEdo = r;
          /* El mes lo dice el propio estado de cuenta: el mes del primer
             movimiento. Así no depende de qué mes tenía abierto la Planilla. */
          const m0 = r.movs[0];
          concMes = m0 ? m0.fecha.slice(0,7) : planMonth;
          await concCargaMeses();
          return;
        }
      }catch(e){ concError = 'No pude leer el archivo — ' + (e.message||''); concEdo = null; }
      finally{ concCargando = false; }
      render();
    };
    drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', ()=>drop.classList.remove('on'));
    drop.addEventListener('drop', e=>{ e.preventDefault(); drop.classList.remove('on'); lee(e.dataTransfer.files[0]); });
    drop.addEventListener('click', ()=>{
      const inp = document.createElement('input');
      inp.type='file'; inp.accept='.pdf,.xlsx,.xls,.csv,.txt';
      inp.onchange = ()=>lee(inp.files[0]);
      inp.click();
    });
  }
  document.getElementById('concOtro')?.addEventListener('click', ()=>{ concEdo=null; concError=null; render(); });
  document.querySelectorAll('[data-concf]').forEach(b=>b.addEventListener('click', ()=>{
    concFiltro = b.dataset.concf; render();
  }));
  document.getElementById('concVent')?.addEventListener('change', e=>{
    concVentana = Number(e.target.value); render();
  });
  document.querySelectorAll('[data-concok]').forEach(b=>b.addEventListener('click', async ()=>{
    const sel = document.querySelector(`[data-conccand="${CSS.escape(b.dataset.concok)}"]`);
    if(!sel || !sel.value) return;
    const [ym, ...resto] = sel.value.split('|');
    b.disabled = true; b.textContent = 'Guardando…';
    await concConfirma(b.dataset.concok, resto.join('|'), ym);
  }));
  document.querySelectorAll('[data-concdes]').forEach(b=>b.addEventListener('click', async ()=>{
    b.disabled = true;
    await concDeshace(b.dataset.concdes, b.dataset.concym);
  }));
}
