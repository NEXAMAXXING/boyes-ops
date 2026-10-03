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
  /* El pie de página del banco (dirección de Inbursa, tus datos, el RFC):
     cuando un cargo cae al final de la hoja, lo de abajo es esto y no un
     beneficiario. */
  if(/PASEO DE LAS PALMAS|LOMAS DE CHAPULTEPEC|MIGUEL HIDALGO|CIUDAD DE MEXICO|C\.R\.\s*\d|RFC\s*BII|INSTITUCION DE BANCA|GRUPO FINANCIERO|LOTE \d+|EL CRESTON|SONORA, MEX|^\d{5}\s+\d{6,}-F$|RFC:\s*ZEZR/i.test(l)) return true;
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
    /* "COMISIONES EFECTIVAMENTE COBRADAS ... EN EL PERIODO 9,419.71" */
    if((m = l.match(/EN EL PERIODO\s+([\d,]+\.\d{2})/i)))  primero('comisiones', numMX(m[1]));
    /* Resumen gráfico del final: "Comisiones 5,455.16" (y "Otros Cargos"). */
    if((m = l.match(/(?:^|\s)Comisiones\s+([\d,]+\.\d{2})/i)))  primero('comisiones_graf', numMX(m[1]));
    if((m = l.match(/Otros\s+Cargos\s+([\d,]+\.\d{2})/i)))       primero('otros_cargos', numMX(m[1]));
    /* Resumen gráfico del final: "Comisiones 5,455.16" */
    if((m = l.match(/\bComisiones\s+([\d,]+\.\d{2})/i)))   primero('comisiones', numMX(m[1]));

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
    /* Solo las transferencias traen beneficiario abajo. Una compra con
       tarjeta ("GASOL LA FLECHA E MX") ya dice en su concepto dónde fue. */
    const conBenef = /TRANSFERENCIA|SPEI|TRASPASO|CARGO EN CUENTA|DOMICILIACION|PAGO\b/i.test(concepto);
    for(let k=1; conBenef && k<=4 && i+k<lineas.length; k++){
      const sig = String(lineas[i+k]).replace(/\s+/g,' ').trim().replace(/^\d{1,2}\s+/,'');
      if(/^[A-Z]{3}\.\s*\d{0,2}/.test(sig)) break;      // ya empezó el siguiente movimiento
      if(concEsRuido(sig)) continue;
      beneficiario = sig.slice(0,80);
      break;
    }

    /* La nota que escribió Karen al transferir ("20260515 LIMPIEZA BOYES SC"):
       viene con la fecha AAAAMMDD al frente. Es lo más específico del
       movimiento: dice el concepto, la sucursal y a veces el mes. */
    let nota = '';
    for(let k=1; k<=7 && i+k<lineas.length; k++){
      const sig = String(lineas[i+k]).replace(/\s+/g,' ').trim();
      if(/^[A-Z]{3}\.\s*\d{0,2}/.test(sig)) break;
      const nm = sig.match(/^20\d{6}\s+(.+)$/);
      if(nm){ nota = nm[1].replace(/\s+[\d,]+\.\d{2}(\s+[\d,]+\.\d{2})?\s*$/,'').trim().slice(0,80); break; }
    }

    movs.push({
      nota,
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
          karen: String((P.formato||{})[clave]?.bg||'').toUpperCase()==='#FF00FF',
          fecha: `${ym}-${String(d).padStart(2,'0')}`,
          /* Naranja = Rod ya la verificó contra un estado de cuenta anterior
             (así venía del Excel). Esa cantidad ya se usó: no se vuelve a ofrecer. */
          usada: conc[clave] || (String((P.formato||{})[clave]?.bg||'').toUpperCase()===CONC_COLOR
                   ? {mov:'excel', por:'Excel (naranja)'} : null)
        });
      }
    }
    /* Gastos fijos (renta, vehículo, luz…): no tienen día, son del mes. Se
       ofrecen para pagos del mismo mes, del mes anterior (pagado por
       adelantado) o del siguiente (pagado tarde). */
    for(const [nom, f] of Object.entries(P.gastos_fijos||{})){
      const monto = planN((f||{}).monto);
      if(!monto) continue;
      const clave = `f|${nom}|monto`;
      const bgF = String((P.formato||{})[clave]?.bg||'').toUpperCase();
      out.push({ ym, cat: nom, dia: null, fijo: true, monto, clave,
        fecha: `${ym}-01`, karen: bgF==='#FF00FF',
        usada: conc[clave] || (bgF===CONC_COLOR ? {mov:'excel', por:'Excel (naranja)'} : null) });
    }
  }
  return out;
}

/* Un gasto fijo se ofrece para un pago del banco si es del mismo mes, o del
   mes siguiente (pagado por adelantado). El del MES ANTERIOR solo si Karen lo
   dejó en rosa y Rod no lo ha puesto en naranja: hay servicios (fumigación,
   etc.) que se pagan al mes siguiente, pero si ese mes ya está verificado,
   este pago no puede ser de él. */
/* Gastos compartidos: el IMSS (y el ISR) se pagan COMPLETOS desde la cuenta
   de San Carlos, pero la mitad es de Guaymas. Guaymas le transfiere esa mitad
   a la cuenta de San Carlos (traspaso de CTMAX-5991) y cada planilla lleva su
   mitad. Así se vio en mayo: abono de $28,548.86 y el mismo día el pago
   SIPARE de $57,097.79 = 2 × 28,548.86. */
const CONC_COMPARTIDOS = { 'IMSS': true, 'ISR Y 2%': true };
const CONC_OTRA = {1:2, 2:1};
function concAbonoOtra(mov, mitad){
  if(!concEdo) return null;
  return concEdo.movs.filter(m => m.tipo==='abono' && Math.abs(m.monto - mitad) < 0.05 && concDias(m.fecha, mov.fecha) <= 7)
    .sort((a,b)=>concDias(a.fecha,mov.fecha)-concDias(b.fecha,mov.fecha))[0] || null;
}
let concOtra = {};   // planillas de la OTRA sucursal (para ver si capturó su mitad)

function concFijoAplica(c, mov){
  const nm = concNotaMes(mov);
  if(nm) return c.ym === nm;            // la nota dice de qué mes es ("RENTA BOYES SC MARZO")
  const dm = concMesDif(c.ym, mov.fecha.slice(0,7));
  if(dm === 0 || dm === 1) return true;
  if(dm === -1) return !!c.karen;
  return false;
}

function concMesDif(ymA, ymB){
  const [a1,a2] = ymA.split('-').map(Number), [b1,b2] = ymB.split('-').map(Number);
  return (a1*12+a2) - (b1*12+b2);
}
const CONC_MESES = ['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function concNomMes(ym){ const [y,m] = ym.split('-').map(Number); return `${CONC_MESES[m]} ${y}`; }
/* Cómo se nombra una casilla en pantalla. */
function concEtiqueta(c, mov){
  if(c.fijo){
    const dm = mov ? concMesDif(c.ym, mov.fecha.slice(0,7)) : 0;
    const nota = dm>0 ? ' (pagado por adelantado)' : (dm<0 ? ' (servicio de ese mes, se paga al siguiente · 🟪 Karen)' : '');
    const comp = c.compartido ? ` · mitad ${(LOCS[finLoc]||'').replace(/^Boye's\s*/,'')} ${money(c.mitad)} (la otra mitad es de ${(LOCS[CONC_OTRA[finLoc]]||'').replace(/^Boye's\s*/,'')})` : '';
    return `🔒 Gasto fijo ${c.cat} · ${concNomMes(c.ym)}${nota}${comp}`;
  }
  return `${c.cat} · ${c.dia} ${CONC_MESES[Number(c.ym.slice(5,7))].slice(0,3)}${c.karen?' · 🟪 Karen':' · sin marca'}`;
}

/* Ventana de búsqueda: hacia atrás hasta 2 meses (a veces se paga una nota
   de hace 5-8 semanas); hacia adelante, la holgura elegida. Las más cercanas
   siguen ganando: lo de hace 2 meses solo sale si no hay nada más cerca. */
const CONC_ATRAS = 62;
function concEnVentana(c, mov){
  const d = (new Date(mov.fecha+'T12:00:00') - new Date(c.fecha+'T12:00:00')) / 86400000;   // + = casilla antes del pago
  return d >= 0 ? d <= Math.max(CONC_ATRAS, concVentana) : -d <= concVentana;
}

function concDias(a, b){
  return Math.abs((new Date(a+'T12:00:00') - new Date(b+'T12:00:00')) / 86400000);
}

/* Los candidatos de un movimiento: mismo monto al centavo, dentro de la
   ventana, y —lo importante— que NADIE más los haya consumido. Se ordenan por
   cercanía en días y por parecido del nombre del beneficiario con el concepto. */
function concCandidatos(mov, casillas){
  const libre = c =>
    (!c.usada || c.usada.mov === mov.id) &&
    (c.fijo ? concFijoAplica(c, mov) : concEnVentana(c, mov));
  /* Si no hay monto exacto, se ofrecen los parecidos (Karen a veces redondea:
     765 en vez de 765.88). Salen marcados y al confirmar se corrige la
     casilla al monto del banco. */
  const holg = Math.max(5, mov.monto * 0.005);
  const K = concProveedor(mov);
  const delProv = c => !K || c.cat === K;
  const exactos = casillas.filter(c => Math.abs(c.monto - mov.monto) < 0.01 && libre(c) && delProv(c))
    .concat(casillas.filter(c => c.fijo && CONC_COMPARTIDOS[c.cat] && Math.abs(c.monto*2 - mov.monto) < 0.05 && libre(c))
      .map(c => ({...c, compartido: true, mitad: c.monto})));
  const cand = exactos.length ? exactos
    : casillas.filter(c => !c.fijo && Math.abs(c.monto - mov.monto) <= holg && libre(c) && delProv(c))
              .map(c => ({...c, aprox: true}));
  const nom = (mov.beneficiario + ' ' + mov.concepto + ' ' + (mov.nota||'')).toUpperCase();
  const puntos = c => {
    let p = c.fijo ? Math.abs(concMesDif(c.ym, mov.fecha.slice(0,7)))*15 : concDias(c.fecha, mov.fecha);
    const pal = c.cat.split(/[^A-ZÑ]+/i).filter(x=>x.length>3);
    if(pal.some(x => nom.includes(x.toUpperCase()))) p -= 100;   // el nombre coincide: gana
    return p;
  };
  return cand.sort((a,b)=>puntos(a)-puntos(b));
}

/* Reparto: cada casilla se le propone a UN solo movimiento. Si dos cargos
   del banco del mismo monto compiten por la misma casilla, se la queda el que
   mejor coincide (fecha y nombre) y el otro va a "no encontrados" desde el
   principio — así confirmar uno nunca cambia de estado a otro. */
let concRecientes = new Set();   // confirmados en esta sesión: se quedan a la vista

/* ---------- proveedor → concepto, aprendido ----------
   Cada vez que Rod confirma un cargo del banco contra una casilla, se guarda
   quién era el beneficiario. Con eso la app aprende que "ARCA CONTINENTAL" va
   en COCA COLA, que "CARNES YOREME" va en CARNES YOREME, etc. Cuando llega un
   cargo de un proveedor conocido, solo se buscan casillas de SU concepto: un
   pago a Arca nunca se va a proponer contra TRANSPORTE TAXI aunque el monto
   se parezca. */
let concHistBen = [];            // [{ben, cat}] de TODOS los meses de la sucursal
const CONC_SEMILLA = [            // para arrancar mientras se junta historia
  [/ARCA\s*CONTINENTAL|COCA[\s-]*COLA|\bFEMSA\b/, 'COCA COLA'],
  [/\bSAM'?S\b|SAMS CLUB/, 'SAMS'],
  [/YOREME/, 'CARNES YOREME'],
  [/SURTICHEF/, 'SURTICHEF'],
  [/MEGACABLE/, 'MEGACABLE'],
  [/TELMEX|TELEFONOS DE MEXICO/, 'TELMEX'],
  [/SIPARE/, 'IMSS'],
  [/GASOL|GASOLINER|PEMEX|\bOXXO GAS\b|\bG500\b|\bARCO\b|\bBP\b|SHELL|MOBIL|\bREDCO\b|\bHIDROSINA\b/, 'GASOLINA']
];
function concBenClave(t){
  return String(t||'').toUpperCase()
    .replace(/\b(S\.?\s*DE\s*R\.?\s*L\.?|S\.?\s*A\.?|DE\s*C\.?\s*V\.?|SAPI|MX|MEX|MEXICO|SA|CV|RL|DE|LA|EL|Y)\b/g,' ')
    .replace(/[^A-ZÑ0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>2).slice(0,3).join(' ');
}
/* El concepto que le toca a un cargo, o null si no se sabe. Gana lo que la
   historia dice más veces; la semilla solo si no hay historia. */
/* Lo que dice la nota de Karen: concepto, mes y sucursal. */
const CONC_NOTA_SIN = [
  [/COCA/, 'COCA COLA'], [/LIMPIEZA/, 'ARTICULOS DE LIMPIEZA'], [/TRAMPA/, 'TRAMPA DE GRASA'],
  [/CONTA?B?L?I?LIDAD|CONTABLILIDAD|CONTADOR/, 'CONTABILIDAD'], [/REKO|BASURA/, 'RECOLECCION BASURA'],
  [/\bRENTA\b/, 'RENTA'], [/CERVEZA/, 'CERVEZA'], [/VERDURA/, 'VERDURA'], [/GASOLINA/, 'GASOLINA'],
  [/\bGAS\b/, 'GAS'], [/\bSAM'?S\b/, 'SAMS'], [/HARINA/, 'HARINA'], [/TOCINO/, 'TOCINO'],
  [/PANADER/, 'PANADERIA'], [/MANTENIMIENTO/, 'MANTENIMIENTO'], [/\bAUTO\b|VEHICULO/, 'VEHICULO RZ'],
  [/\bIMSS\b/, 'IMSS'], [/\bLUZ\b|\bCFE\b/, 'LUZ + PANEL SOLAR MENSUALIDAD'], [/TELMEX/, 'TELMEX'],
  [/MEGACABLE/, 'MEGACABLE'], [/FUMIGA|FUMUGA/, 'FUMUGACION'], [/UNIFORME/, 'UNIFORMES'],
  [/DESECHABLE/, 'DESECHABLES'], [/NOMINA/, 'NOMINA'], [/PROPINA/, 'PROPINA'], [/MARISCO/, 'MARISCO']
];
function concConceptos(){
  return new Set([...(typeof PLAN_GV!=='undefined'?PLAN_GV:[]), ...(typeof PLAN_GF!=='undefined'?PLAN_GF:[]),
    ...Object.values(concMeses).flatMap(P => [...Object.keys(P.gastos_var||{}), ...Object.keys(P.gastos_fijos||{})])]);
}
function concNotaConcepto(mov){
  const t = String(mov.nota||'').toUpperCase(); if(!t) return null;
  const todos = concConceptos();
  /* Primero el nombre completo de un concepto ("QUESOS Y QUESOS", "CARNES YOREME"). */
  const llano = [...todos].sort((a,b)=>b.length-a.length).find(c => c.length > 3 && t.includes(c.toUpperCase()));
  if(llano) return llano;
  const sin = CONC_NOTA_SIN.find(([re, c]) => re.test(t) && todos.has(c));
  return sin ? sin[1] : null;
}
function concNotaMes(mov){
  const t = String(mov.nota||'').toUpperCase(); if(!t) return null;
  const i = CONC_MESES.findIndex((m, k) => k && new RegExp('\\b'+m.toUpperCase()+'\\b').test(t));
  if(i < 1) return null;
  const [y, mm] = mov.fecha.split('-').map(Number);
  return `${i > mm + 1 ? y-1 : y}-${String(i).padStart(2,'0')}`;
}
function concNotaSucursal(mov){
  const t = String(mov.nota||'').toUpperCase();
  if(/GUAYMAS|\bGYS\b/.test(t)) return 1;
  if(/\bSC\b|SAN CARLOS/.test(t)) return 2;
  return null;
}

function concProveedor(mov){
  /* La nota de Karen manda: "RODRIGO ZENA" puede ser quesos o Sams, pero la
     nota dice cuál. */
  const porNota = concNotaConcepto(mov);
  if(porNota) return porNota;
  const k = concBenClave(mov.beneficiario || mov.concepto);
  if(!k) return null;
  const votos = {};
  const suma = (ben, cat) => { if(concBenClave(ben) === k) votos[cat] = (votos[cat]||0) + 1; };
  concHistBen.forEach(x => suma(x.ben, x.cat));
  /* Lo confirmado en este mismo estado de cuenta también enseña al momento. */
  if(concEdo){
    for(const P of Object.values(concMeses)){
      for(const [clave, u] of Object.entries((P.formato||{})._conc||{})){
        if(!u || u.ben || !clave.startsWith('g|')) continue;
        const m = concEdo.movs.find(x => x.id === u.mov);
        if(m) suma(m.beneficiario || m.concepto, clave.split('|')[1]);
      }
    }
  }
  const mejor = Object.entries(votos).sort((a,b)=>b[1]-a[1])[0];
  if(mejor) return mejor[0];
  const t = (mov.beneficiario + ' ' + mov.concepto).toUpperCase();
  const sem = CONC_SEMILLA.find(([re]) => re.test(t));
  return sem ? sem[1] : null;
}
/* Casillas del mismo monto pero en OTRO renglón: quizá Karen lo puso donde no
   iba. Se ofrecen aparte, para moverlas al concepto correcto. */
function concOtroRenglon(mov, casillas){
  const K = concProveedor(mov); if(!K) return [];
  return casillas.filter(c => !c.fijo && c.cat !== K && !c.usada &&
    Math.abs(c.monto - mov.monto) <= Math.max(5, mov.monto*0.005) &&
    concEnVentana(c, mov));
}
function concReparte(pagos, casillas){
  const pares = [];
  for(const mov of pagos){
    if(['comision','traspaso','rendimiento','deposito_tarjeta'].includes(mov.clase) || mov.tipo==='abono') continue;
    if(concIgnorado(mov) || concPendiente(mov) || casillas.some(c => c.usada && c.usada.mov === mov.id)) continue;
    concCandidatos(mov, casillas).forEach((c, i) => pares.push({mov, c, i, aprox: !!c.aprox}));
  }
  pares.sort((a,b) => (a.aprox-b.aprox) || (a.i-b.i));
  const tomada = new Set(), deMov = new Map(), compite = new Map();
  for(const {mov, c} of pares){
    if(tomada.has(c.clave+'@'+c.ym)){ if(!deMov.has(mov.id)) compite.set(mov.id, c); continue; }
    if(deMov.has(mov.id)) continue;
    tomada.add(c.clave+'@'+c.ym); deMov.set(mov.id, [c]);
  }
  /* Alternativas: solo casillas que nadie más tiene asignadas. */
  for(const {mov, c} of pares){
    const l = deMov.get(mov.id); if(!l) continue;
    if(!tomada.has(c.clave+'@'+c.ym) && !l.some(x=>x.clave===c.clave && x.ym===c.ym)) l.push(c);
  }
  return {deMov, compite};
}

function concEstadoDe(mov, casillas, rep){
  if(['comision','traspaso','rendimiento','deposito_tarjeta'].includes(mov.clase)) return 'aparte';
  if(mov.tipo === 'abono') return 'aparte';
  if(concIgnorado(mov)) return 'ignorado';
  if(concPendiente(mov)) return 'pendiente';
  const yaUsada = casillas.find(c => c.usada && c.usada.mov === mov.id);
  if(yaUsada) return 'confirmado';
  if(rep) return rep.deMov.has(mov.id) ? 'propuesto' : 'sin_apunte';
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
    try{
      const {data: hist} = await sb.from('planilla_months').select('formato').eq('location_id', finLoc);
      concHistBen = [];
      (hist||[]).forEach(r => Object.entries(((r.formato||{})._conc)||{}).forEach(([clave, u]) => {
        if(u && u.ben && clave.startsWith('g|')) concHistBen.push({ben: u.ben, cat: clave.split('|')[1]});
      }));
    }catch(e){ concHistBen = []; }
    const yms = concVecinos(concMes);
    const {data} = await sb.from('planilla_months').select('*')
      .eq('location_id', finLoc).in('year_month', yms);
    concMeses = {};
    for(const ym of yms){
      const row = (data||[]).find(r=>r.year_month===ym);
      concMeses[ym] = row
        ? {ventas:row.ventas||{}, gastos_var:row.gastos_var||{}, gastos_fijos:row.gastos_fijos||{}, formato:row.formato||{}}
        : {ventas:{}, gastos_var:{}, gastos_fijos:{}, formato:{}};
    }
    concOtra = {};
    try{
      const {data: od} = await sb.from('planilla_months').select('*').eq('location_id', CONC_OTRA[finLoc]).in('year_month', yms);
      (od||[]).forEach(r => concOtra[r.year_month] = r);
    }catch(e){}
  }catch(e){ concError = 'No pude leer las planillas de esos meses'; }
  finally{ concCargando = false; }
  render();
}

/* Guardar un mes concreto. Se manda solo lo que esta pantalla toca —formato,
   que es donde viven el color y la marca de conciliado— para no pisar una
   captura que Karen esté haciendo al mismo tiempo en otra pestaña. */
/* Cambios puntuales que esta pantalla le hace a la captura (no solo al
   formato): una casilla de gasto nueva o un gasto fijo marcado como pagado.
   Se aplican sobre lo que haya en la base en ese momento, celda por celda. */
let concPend = {};   // ym -> {gv:{cat:{dia:monto}}, gf:{nombre:{...}}}
async function concGuarda(ym){
  const P = concMeses[ym];
  if(!P) return;
  const {data} = await sb.from('planilla_months').select('*')
    .eq('location_id', finLoc).eq('year_month', ym).limit(1);
  const base = (data && data[0]) || {ventas:{}, gastos_var:{}, gastos_fijos:{}, banco:{}};
  const gv = base.gastos_var||{}, gf = base.gastos_fijos||{};
  const pend = concPend[ym] || {};
  for(const [cat, dias] of Object.entries(pend.gv||{})){
    gv[cat] = gv[cat] || {};
    for(const [d, v] of Object.entries(dias)){ if(v==='') delete gv[cat][d]; else gv[cat][d] = v; }
  }
  for(const [nom, f] of Object.entries(pend.gf||{})) gf[nom] = { ...(gf[nom]||{}), ...f };
  delete concPend[ym];
  await sb.from('planilla_months').upsert({
    location_id: finLoc, year_month: ym,
    ventas: base.ventas||{}, gastos_var: gv,
    gastos_fijos: gf, banco: base.banco||{},
    formato: P.formato||{},
    created_by: user.name, updated_at: new Date().toISOString()
  }, {onConflict:'location_id,year_month'});
  /* Si el mes que se tocó es el que está abierto en la Planilla, se le pasa
     el formato nuevo en sitio. Antes se tiraba planData y eso recargaba toda
     la pantalla y la mandaba hasta arriba en cada clic. */
  if(ym === planMonth && planData && planData.location_id === finLoc){
    planData.formato = JSON.parse(JSON.stringify(P.formato||{}));
    planData.gastos_var = JSON.parse(JSON.stringify(gv));
    planData.gastos_fijos = JSON.parse(JSON.stringify(gf));
    if(planEdit){
      planEdit.formato = JSON.parse(JSON.stringify(P.formato||{}));
      planEdit.gastos_var = JSON.parse(JSON.stringify(gv));
      planEdit.gastos_fijos = JSON.parse(JSON.stringify(gf));
    }
  }
}

/* "No va en la planilla": un retiro personal, un pago que no es del
   restaurante… Se anota en el mes del movimiento para que no vuelva a salir
   como pendiente, con quién lo decidió. */
function concIgnorado(mov){
  const P = concMeses[mov.fecha.slice(0,7)];
  return P && P.formato && P.formato._concIgn ? P.formato._concIgn[mov.id] : null;
}
async function concIgnora(movId, nota){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov) return;
  const ym = mov.fecha.slice(0,7), P = concMeses[ym]; if(!P) return;
  P.formato = P.formato || {}; P.formato._concIgn = P.formato._concIgn || {};
  P.formato._concIgn[movId] = {nota: nota||'', monto: mov.monto, fecha: mov.fecha, por: user.name, cuando: new Date().toISOString()};
  render(); toast('Listo — ya no sale como pendiente');
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}
async function concDesignora(movId){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov) return;
  const ym = mov.fecha.slice(0,7), P = concMeses[ym];
  if(P?.formato?._concIgn) delete P.formato._concIgn[movId];
  render();
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

/* "Dejar pendiente": un cargo que Rod no reconoce y quiere checar con Karen.
   Se guarda en el mes del movimiento (formato._concChk) con todo lo necesario
   para el reporte en PDF, aunque después ya no se tenga el estado de cuenta. */
function concPendiente(mov){
  const P = concMeses[mov.fecha.slice(0,7)];
  return P && P.formato && P.formato._concChk ? P.formato._concChk[mov.id] : null;
}
async function concDejaPend(movId, nota){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov) return;
  const ym = mov.fecha.slice(0,7), P = concMeses[ym]; if(!P) return;
  P.formato = P.formato || {}; P.formato._concChk = P.formato._concChk || {};
  P.formato._concChk[movId] = {nota: nota||'', monto: mov.monto, fecha: mov.fecha,
    ben: mov.beneficiario||'', concepto: mov.concepto||'', nota_banco: mov.nota||'', por: user.name, cuando: new Date().toISOString()};
  render(); toast('Quedó pendiente para checar con Karen');
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}
async function concQuitaPend(movId){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov) return;
  const ym = mov.fecha.slice(0,7), P = concMeses[ym];
  if(P?.formato?._concChk) delete P.formato._concChk[movId];
  render();
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}
async function concNotaPend(movId, nota){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov) return;
  const ym = mov.fecha.slice(0,7), P = concMeses[ym];
  const x = P?.formato?._concChk?.[movId]; if(!x) return;
  x.nota = nota;
  try{ await concGuarda(ym); toast('Nota guardada'); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

/* Reporte PDF de los pendientes, para mandárselo a Karen. Sale de lo que está
   guardado en las planillas cargadas (no de la pantalla), ordenado por fecha. */
async function concPendPDF(){
  const lista = [];
  for(const P of Object.values(concMeses))
    for(const [id, x] of Object.entries(((P.formato||{})._concChk)||{})) lista.push({id, ...x});
  if(!lista.length){ toast('No hay pendientes'); return; }
  lista.sort((a,b)=> a.fecha.localeCompare(b.fecha) || a.monto-b.monto);
  await loadPDF();
  const JS = (window.jspdf || {}).jsPDF;
  if(!JS){ toast('No se pudo cargar el generador de PDF'); return; }
  const doc = new JS({unit:'pt', format:'letter'});
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const suc = (LOCS[finLoc]||'').replace(/^Boye's\s*/,'');
  const total = lista.reduce((s,x)=>s+Number(x.monto||0),0);
  const fmt = n => '$' + Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2, maximumFractionDigits:2});
  const fch = f => { const [y,m,d] = f.split('-'); return `${d} ${CONC_MESES[Number(m)].slice(0,3)} ${y}`; };
  const enc = () => {
    doc.setFillColor(27,42,74); doc.rect(0,0,W,64,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16);
    doc.text('Movimientos del banco por aclarar', M, 30);
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text(`Boye's ${suc} · estado de cuenta de ${concNomMes(concMes)} · ${lista.length} movimiento${lista.length===1?'':'s'} · ${fmt(total)}`, M, 48);
    doc.setTextColor(30,30,30);
  };
  enc();
  let y = 88;
  doc.setFontSize(9.5);
  doc.text('Karen: estos cargos salieron en el estado de cuenta y no los encontré en la planilla. ¿Qué son y en qué concepto/día van?', M, y);
  y += 18;
  const cols = [[M,'Fecha'],[M+70,'Beneficiario / concepto del banco'],[W-M-140,'Nota de Rod / respuesta de Karen']];
  const cab = () => {
    doc.setFillColor(238,234,224); doc.rect(M-4, y-12, W-2*M+8, 18, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9);
    cols.forEach(([x,t]) => doc.text(t, x, y)); doc.text('Monto', W-M-150, y, {align:'right'});
    doc.setFont('helvetica','normal'); y += 16;
  };
  cab();
  for(const x of lista){
    const ben = doc.splitTextToSize(`${x.ben||''}${x.nota_banco ? ' · "'+x.nota_banco+'"' : (x.concepto && x.concepto!==x.ben ? ' · '+x.concepto : '')}`, W-M-210-(M+70)-10);
    const nota = doc.splitTextToSize(x.nota || '', 140);
    const alto = Math.max(ben.length, nota.length, 1) * 11 + 18;
    if(y + alto > H - 50){ doc.addPage(); enc(); y = 88; cab(); }
    doc.setFontSize(9.5);
    doc.text(fch(x.fecha), M, y);
    doc.text(ben, M+70, y);
    doc.setFont('helvetica','bold'); doc.text(fmt(x.monto), W-M-150, y, {align:'right'}); doc.setFont('helvetica','normal');
    doc.text(nota, W-M-140, y);
    doc.setDrawColor(200,200,200);
    doc.line(W-M-140, y + Math.max(nota.length,1)*11 + 2, W-M, y + Math.max(nota.length,1)*11 + 2);
    y += alto;
    doc.setDrawColor(225,220,208); doc.line(M-4, y-12, W-M+4, y-12);
  }
  doc.setFont('helvetica','bold'); doc.setFontSize(10.5);
  doc.text(`Total por aclarar: ${fmt(total)}`, W-M, y+4, {align:'right'});
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(120,120,120);
  doc.text(`Generado ${new Date().toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'})} por ${user.name} · Boye's Ops`, M, H-24);
  const nombre = `Pendientes banco ${suc} ${concMes}.pdf`;
  try{
    const archivo = new File([doc.output('blob')], nombre, {type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[archivo]})){ await navigator.share({files:[archivo], title:nombre}); return; }
  }catch(e){}
  doc.save(nombre);
}

/* "Capturarlo aquí": el pago sí es gasto pero nadie lo apuntó. Se escribe en
   la planilla (concepto y día que elijas) y queda confirmado de una vez. */
async function concCaptura(movId, cat, fecha, nota){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov || !cat || !fecha) return;
  const ym = fecha.slice(0,7), d = String(Number(fecha.slice(8,10)));
  if(!concMeses[ym]){ toast('Ese mes no está cargado aquí — usa una fecha de '+Object.keys(concMeses).join(', ')); return; }
  const P = concMeses[ym];
  P.gastos_var = P.gastos_var || {}; P.gastos_var[cat] = P.gastos_var[cat] || {};
  const prev = planN(P.gastos_var[cat][d]);
  if(prev){ toast(`${cat} del ${d} ya tiene ${money(prev)} — elige otro día o confírmalo contra esa casilla`); return; }
  P.gastos_var[cat][d] = mov.monto;
  concPend[ym] = concPend[ym] || {}; concPend[ym].gv = concPend[ym].gv || {};
  (concPend[ym].gv[cat] = concPend[ym].gv[cat] || {})[d] = mov.monto;
  await concConfirma(movId, `g|${cat}|${d}`, ym, nota);
}

/* Anotar la mitad en la planilla de la otra sucursal (mismo mes, mismo gasto
   fijo), marcada en naranja porque ya se vio el abono y el pago. */
async function concMitadOtra(ym, nom, mitad, movId){
  const otra = CONC_OTRA[finLoc];
  try{
    const {data} = await sb.from('planilla_months').select('*').eq('location_id', otra).eq('year_month', ym).limit(1);
    const b = (data && data[0]) || {ventas:{}, gastos_var:{}, gastos_fijos:{}, banco:{}, formato:{}};
    const gf = b.gastos_fijos || {}, fm = b.formato || {};
    gf[nom] = { ...(gf[nom]||{}), monto: mitad, pagado: true };
    const k = `f|${nom}|monto`;
    fm[k] = { ...(fm[k]||{}), bg: CONC_COLOR, nota: `Mitad del pago desde ${(LOCS[finLoc]||'')}` };
    fm._conc = fm._conc || {};
    fm._conc[k] = { mov: movId, monto: mitad, compartido_de: finLoc, por: user.name, cuando: new Date().toISOString() };
    await sb.from('planilla_months').upsert({ location_id: otra, year_month: ym,
      ventas: b.ventas||{}, gastos_var: b.gastos_var||{}, gastos_fijos: gf, banco: b.banco||{}, formato: fm,
      created_by: user.name, updated_at: new Date().toISOString() }, {onConflict:'location_id,year_month'});
    concOtra[ym] = { ...b, gastos_fijos: gf, formato: fm, year_month: ym, location_id: otra };
    toast(`Mitad anotada en ${LOCS[otra]}`); render();
  }catch(e){ toast('No se pudo guardar en la otra sucursal'); }
}

/* Comisiones bancarias del mes: todas las "tasa de descuento" de la terminal
   (crédito, débito, AMEX) más su IVA y cualquier otra comisión. En la planilla
   van juntas en el gasto fijo COMISIONES BANCARIAS del mes del estado. */
function concComisiones(){
  if(!concEdo) return null;
  const lista = concEdo.movs.filter(m => m.tipo==='cargo' && m.clase==='comision' && m.fecha.slice(0,7)===concMes);
  const suma = Math.round(lista.reduce((s,m)=>s+m.monto,0)*100)/100;
  const D = concEdo.declarado||{};
  const dec = D.comisiones_graf != null ? D.comisiones_graf : D.comisiones;
  const grupos = {};
  lista.forEach(m => {
    const c = m.concepto.toUpperCase();
    const k = /AMEX/.test(c) ? 'AMEX' : /DEBITO/.test(c) ? 'Débito' : /CREDITO/.test(c) ? 'Crédito' : 'Otras comisiones';
    grupos[k] = (grupos[k]||0) + m.monto;
  });
  return {lista, suma, dec, grupos, monto: (dec && dec > 0) ? dec : suma};
}
async function concComAnota(monto){
  const ym = concMes, P = concMeses[ym]; if(!P) return;
  const nom = 'COMISIONES BANCARIAS', k = `f|${nom}|monto`;
  P.gastos_fijos = P.gastos_fijos || {};
  P.gastos_fijos[nom] = { ...(P.gastos_fijos[nom]||{}), monto, pagado: true };
  P.formato = P.formato || {};
  P.formato[k] = { ...(P.formato[k]||{}), bg: CONC_COLOR, nota: 'Del estado de cuenta (tasa de descuento + IVA)' };
  P.formato._conc = P.formato._conc || {};
  P.formato._conc[k] = { mov: 'comisiones-'+ym, monto, por: user.name, cuando: new Date().toISOString() };
  concPend[ym] = concPend[ym] || {}; concPend[ym].gf = concPend[ym].gf || {};
  concPend[ym].gf[nom] = { ...(concPend[ym].gf[nom]||{}), monto, pagado: true };
  render(); toast('Comisiones anotadas en la planilla');
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

/* ---------- CUADRE: del banco a la planilla ----------
   Todo lo que salió de la cuenta en el mes, repartido en lo que lo explica.
   La última línea, "Sin explicar", es la que debe quedar en $0. */
function concCuadreHTML(estados, casillas){
  const est = new Map(estados.map(x => [x.mov.id, x.estado]));
  const cargos = concEdo.movs.filter(m => m.tipo==='cargo');
  const G = {};
  const suma = (k, m) => { (G[k] = G[k] || {n:0, t:0}); G[k].n++; G[k].t += m.monto; };
  const com = concComisiones();
  const comEnPla = (() => { const P = concMeses[concMes]||{}; return Math.abs(planN(((P.gastos_fijos||{})['COMISIONES BANCARIAS']||{}).monto) - (com?com.monto:0)) < 0.01; })();
  for(const m of cargos){
    if(m.clase==='comision'){ suma(comEnPla ? 'com_ok' : 'com_falta', m); continue; }
    if(m.clase==='traspaso'){ suma('traspaso', m); continue; }
    if(m.clase!=='pago'){ suma('otro', m); continue; }
    const e = est.get(m.id);
    if(e==='confirmado'){
      const c = casillas.find(x => x.usada && x.usada.mov === m.id);
      suma(c && c.fijo ? 'fijo' : 'planilla', m);
    } else suma(e || 'sin_apunte', m);
  }
  const total = cargos.reduce((s,m)=>s+m.monto,0);
  const filas = [
    ['planilla',  '✅ Conciliado contra la planilla', '#0B6E3F'],
    ['fijo',      '🔒 Gastos fijos confirmados', '#0B6E3F'],
    ['com_ok',    '🏦 Comisiones bancarias (ya en la planilla)', '#0B6E3F'],
    ['ignorado',  '🚫 No va en la planilla', '#5B6472'],
    ['com_falta', '🏦 Comisiones bancarias — falta anotarlas', '#E0A100'],
    ['traspaso',  '↔️ Traspasos entre cuentas / a personas — revisar', '#E0A100'],
    ['otro',      'Otros cargos del banco', '#E0A100'],
    ['propuesto', '🟡 Encontrados, falta que confirmes', '#E0A100'],
    ['pendiente', '⏸ Pendientes con Karen', '#E0A100'],
    ['sin_apunte','❓ Sin explicar', '#C0261F']
  ];
  const sinExp = (G.sin_apunte||{t:0}).t;
  const abiertos = ['com_falta','traspaso','otro','propuesto','pendiente','sin_apunte'].reduce((s,k)=>s+((G[k]||{}).t||0),0);
  return `<div class="panel"><div class="d-h3">Cuadre de egresos · ${concNomMes(concMes)}</div>
    <p class="hint" style="margin:0 0 8px">Todo lo que salió de la cuenta, y qué lo explica. Cuando "Sin explicar" está en $0, cada peso del estado de cuenta está considerado.</p>
    <div class="res-wrap"><table class="res" style="font-size:13px;min-width:0"><tbody>
      ${filas.filter(([k]) => G[k]).map(([k,t,col]) => `<tr>
        <td style="text-align:left;border-left:4px solid ${col}">${t}</td>
        <td style="width:70px">${G[k].n}</td>
        <td style="width:130px;font-weight:700">${money(Math.round(G[k].t*100)/100)}</td></tr>`).join('')}
      <tr style="font-weight:900;background:#F6F4EE"><td style="text-align:left">Total de cargos del estado de cuenta</td><td>${cargos.length}</td><td>${money(Math.round(total*100)/100)}</td></tr>
    </tbody></table></div>
    <p style="margin:10px 0 0;font-weight:800;color:${sinExp<0.01 && abiertos<0.01 ? '#0B6E3F' : (sinExp<0.01 ? '#8A5A00' : '#C0261F')}">
      ${sinExp<0.01 && abiertos<0.01 ? '✓ Cuadrado: todos los egresos del banco están considerados.'
        : sinExp<0.01 ? `Sin explicar en $0. Quedan ${money(Math.round(abiertos*100)/100)} por cerrar (confirmar, pendientes, traspasos o comisiones).`
        : `Faltan ${money(Math.round(sinExp*100)/100)} sin explicar.`}</p>
  </div>`;
}

/* ---------- LISTA INVERSA: de la planilla al banco ----------
   Casillas de gasto del mes del estado que NINGÚN cargo de este estado explica.
   - En rosa: Karen dijo que la vio en el banco, así que NO fue efectivo. Si
     aquí no aparece, salió en otro estado de cuenta (mes siguiente/anterior)
     o el monto no coincide: esas son las que hay que revisar.
   - Sin marca: Karen no la encontró en el banco → se pagó en efectivo. Solo
     se resume. Las naranjas ya están verificadas y las propuestas se explican
     al confirmar, así que ninguna de las dos se lista. */
function concInversaHTML(casillas, rep){
  const prop = new Set();
  if(rep) for(const l of rep.deMov.values()) l.forEach(c => prop.add(c.clave+'@'+c.ym));
  const sueltas = casillas.filter(c => !c.fijo && c.ym === concMes && !c.usada && !prop.has(c.clave+'@'+c.ym))
    .sort((a,b) => a.dia-b.dia || b.monto-a.monto);
  const rosas = sueltas.filter(c => c.karen), efe = sueltas.filter(c => !c.karen);
  const tR = rosas.reduce((s,c)=>s+c.monto,0), tE = efe.reduce((s,c)=>s+c.monto,0);
  const dow = c => ['D','L','M','M','J','V','S'][new Date(c.fecha+'T12:00:00').getDay()];
  const tabla = (l, tot, rot) => `<div class="res-wrap"><table class="res" style="font-size:12.5px;min-width:0"><thead><tr>
      <th style="text-align:left">Día</th><th style="text-align:left">Concepto</th><th>Monto</th></tr></thead><tbody>
    ${l.map(c => `<tr><td style="text-align:left">${dow(c)} ${c.dia}</td><td style="text-align:left">${esc(c.cat)}</td>
      <td style="font-weight:700">${money(c.monto)}</td></tr>`).join('')}
    <tr style="font-weight:900;background:#F6F4EE"><td></td><td style="text-align:left">${rot}</td><td>${money(Math.round(tot*100)/100)}</td></tr>
  </tbody></table></div>`;
  return `<div class="panel"><div class="d-h3">De la planilla al banco · ${concNomMes(concMes)}</div>
    ${rosas.length ? `<p style="margin:0 0 6px;font-weight:800;color:#8A5A00">🟪 Karen las marcó como del banco, pero no salen en este estado de cuenta · ${rosas.length} · ${money(Math.round(tR*100)/100)}</p>
      <p class="hint" style="margin:0 0 8px">No fueron efectivo. O salieron en el estado del mes siguiente (o anterior), o el monto que capturó no es el del banco. Revísalas al cargar ese otro estado.</p>
      ${tabla(rosas, tR, 'Total por revisar')}`
      : `<p style="margin:0 0 6px;font-weight:800;color:#0B6E3F">✓ Todo lo que Karen marcó del banco está explicado.</p>`}
    <p style="margin:12px 0 0">💵 <b>Efectivo</b> (sin marca de Karen, no pasó por el banco): ${efe.length} gasto${efe.length===1?'':'s'} · <b>${money(Math.round(tE*100)/100)}</b>
      ${efe.length ? `<button class="btn-quiet" style="padding:3px 9px;min-height:0;font-size:11.5px" id="concVerEfe">ver</button>` : ''}</p>
    ${efe.length ? `<div id="concEfeBox" hidden style="margin-top:6px">${tabla(efe, tE, 'Total en efectivo')}</div>` : ''}
  </div>`;
}
async function concEfectivo(ym, clave, si){
  const P = concMeses[ym]; if(!P) return;
  P.formato = P.formato || {};
  const f = { ...(P.formato[clave]||{}) };
  if(si) f.efectivo = true; else delete f.efectivo;
  if(Object.keys(f).length) P.formato[clave] = f; else delete P.formato[clave];
  render();
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

/* "Mover de renglón": Karen lo apuntó en otro concepto. Se quita de ahí y se
   pone en el concepto del proveedor, mismo día, ya con el monto del banco. */
async function concMueve(movId, ym, claveVieja, catNueva){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov || !catNueva) return;
  const P = concMeses[ym]; if(!P) return;
  const [, catVieja, d] = claveVieja.split('|');
  if(planN((P.gastos_var?.[catNueva]||{})[d])){ toast(`${catNueva} del ${d} ya tiene un monto — captúralo en otro día`); return; }
  P.gastos_var[catVieja] = P.gastos_var[catVieja] || {};
  delete P.gastos_var[catVieja][d];
  P.gastos_var[catNueva] = P.gastos_var[catNueva] || {};
  P.gastos_var[catNueva][d] = mov.monto;
  const fv = (P.formato||{})[claveVieja];
  if(fv){ delete P.formato[claveVieja]; }
  concPend[ym] = concPend[ym] || {}; concPend[ym].gv = concPend[ym].gv || {};
  (concPend[ym].gv[catVieja] = concPend[ym].gv[catVieja] || {})[d] = '';
  (concPend[ym].gv[catNueva] = concPend[ym].gv[catNueva] || {})[d] = mov.monto;
  await concConfirma(movId, `g|${catNueva}|${d}`, ym, `Movido de ${catVieja}`);
}

/* "Es gasto fijo": el monto puede no coincidir (subió la mensualidad). Se toma
   el monto del banco como el real del mes y se marca pagado. */
async function concAFijo(movId, nom, ym){
  const mov = concEdo.movs.find(m=>m.id===movId); if(!mov || !nom || !ym) return;
  const P = concMeses[ym]; if(!P) return;
  P.gastos_fijos = P.gastos_fijos || {};
  P.gastos_fijos[nom] = { ...(P.gastos_fijos[nom]||{}), monto: mov.monto };
  concPend[ym] = concPend[ym] || {}; concPend[ym].gf = concPend[ym].gf || {};
  concPend[ym].gf[nom] = { ...(concPend[ym].gf[nom]||{}), monto: mov.monto };
  await concConfirma(movId, `f|${nom}|monto`, ym);
}

/* El color de "ya lo verifiqué yo" es el naranja del Excel de Rod, para que
   la app y el Excel hablen el mismo idioma. El azul viejo se sigue
   reconociendo para poder deshacer lo que se confirmó antes. */
const CONC_COLOR = '#FF9900';
const CONC_AZUL_VIEJO = '#CFE3FB';

/* Nota de la casilla (ej. "ANUNCIOS LUMINOSOS"): vive en el formato de la
   planilla, así sale igual en la tabla del mes y en la de conceptos. */
async function concNota(clave, ym, texto){
  const P = concMeses[ym]; if(!P) return;
  P.formato = P.formato || {};
  const f = { ...(P.formato[clave]||{}) };
  if(texto) f.nota = texto; else delete f.nota;
  if(Object.keys(f).length) P.formato[clave] = f; else delete P.formato[clave];
  toast(texto ? 'Nota guardada' : 'Nota quitada');
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

async function concConfirma(movId, clave, ym, nota){
  const P = concMeses[ym]; if(!P) return;
  P.formato = P.formato || {};
  P.formato._conc = P.formato._conc || {};
  const mov = concEdo.movs.find(m=>m.id===movId);
  P.formato._conc[clave] = {mov: movId, fecha_banco: mov?.fecha, monto: mov?.monto,
                            ben: mov ? (mov.beneficiario || mov.concepto || '') : '',
                            nota_banco: mov ? (mov.nota || '') : '',
                            por: user.name, cuando: new Date().toISOString()};
  P.formato[clave] = { ...(P.formato[clave]||{}), bg: CONC_COLOR };
  if(nota) P.formato[clave].nota = nota;
  concRecientes.add(movId);
  if(clave.startsWith('g|') && mov){
    const [, cat, d] = clave.split('|');
    const cap = planN((P.gastos_var?.[cat]||{})[d]);
    if(cap && Math.abs(cap - mov.monto) >= 0.01){
      P.gastos_var[cat][d] = mov.monto;
      concPend[ym] = concPend[ym] || {}; concPend[ym].gv = concPend[ym].gv || {};
      (concPend[ym].gv[cat] = concPend[ym].gv[cat] || {})[d] = mov.monto;
      P.formato._conc[clave].antes = cap;
    }
  }
  if(clave.startsWith('f|') && mov){
    const nom0 = clave.slice(2, clave.lastIndexOf('|'));
    const m0 = planN((P.gastos_fijos?.[nom0]||{}).monto);
    if(CONC_COMPARTIDOS[nom0] && Math.abs(m0*2 - mov.monto) < 0.05){
      const ab = concAbonoOtra(mov, m0);
      P.formato._conc[clave].compartido = {total: mov.monto, mitad: m0, abono: ab ? ab.id : null, abono_fecha: ab ? ab.fecha : null};
    }
  }
  if(clave.startsWith('f|')){
    const nom = clave.slice(2, clave.lastIndexOf('|'));
    P.gastos_fijos = P.gastos_fijos || {};
    P.gastos_fijos[nom] = { ...(P.gastos_fijos[nom]||{}), pagado: true };
    concPend[ym] = concPend[ym] || {}; concPend[ym].gf = concPend[ym].gf || {};
    concPend[ym].gf[nom] = { ...(concPend[ym].gf[nom]||{}), pagado: true };
  }
  /* Primero se pinta (al instante, sin moverse de lugar) y luego se guarda. */
  render();
  toast('Confirmado — la casilla quedó en naranja');
  try{ await concGuarda(ym); }catch(e){ toast('No se pudo guardar — revisa tu conexión'); }
}

async function concDeshace(clave, ym){
  const P = concMeses[ym]; if(!P) return;
  if(clave.startsWith('f|')){
    const nom = clave.slice(2, clave.lastIndexOf('|'));
    if(P.gastos_fijos?.[nom]) P.gastos_fijos[nom].pagado = false;
    concPend[ym] = concPend[ym] || {}; concPend[ym].gf = concPend[ym].gf || {};
    concPend[ym].gf[nom] = { ...(concPend[ym].gf[nom]||{}), pagado: false };
  }
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
    aparte     : ['Va aparte', '#5B6472', '#EDEDED'],
    ignorado   : ['No va', '#5B6472', '#EDEDED'],
    pendiente  : ['⏸ Pendiente', '#8A5A00', '#FFE7B0']
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
    .conc-nota{flex:0 1 260px;min-width:160px;padding:6px 8px;border:1px solid #D8D2C4;border-radius:7px;font-family:inherit;font-size:12.5px}
    .conc-notak{font-size:12px;font-weight:700;color:#1B4FA8;background:#EAF1FD;border-radius:6px;padding:2px 7px}
    .conc-sec{display:flex;flex-direction:column;gap:2px;margin:16px 0 8px;padding-bottom:6px;border-bottom:2px solid #E1DCD0;font-size:14px}
    .conc-mov.pend{border-left:4px solid #E0A100;background:#FFFCF3}
    .conc-mov.ign{border-left:4px solid #8A8F98;opacity:.8}
    .conc-opc{display:flex;flex-direction:column;gap:6px;margin-top:8px}
    .conc-opc[hidden]{display:none}
    .conc-rap{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center}
    .conc-rap button{padding:8px 14px;font-size:13px;min-height:0}
    .conc-o select,.conc-o input[type=date]{flex:0 1 220px}
    .conc-o button{padding:7px 12px;font-size:12.5px;min-height:0}
    .conc-o .hint{flex-basis:100%;margin:0}
    .conc-o{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;padding:7px 9px;border:1px dashed #E1DCD0;border-radius:8px}
    .conc-o b{min-width:170px}
    .conc-o select,.conc-o input{padding:6px 8px;border:1px solid #D8D2C4;border-radius:7px;font-family:inherit;font-size:12.5px}
    .conc-o input[type=text]{flex:1;min-width:180px}
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
  const rep = concReparte(pagos, casillas);
  const estados = pagos.map(m=>({mov:m, estado:concEstadoDe(m, casillas, rep)}));
  const nOk   = estados.filter(x=>x.estado==='confirmado').length;
  const nProp = estados.filter(x=>x.estado==='propuesto').length;
  const nSin  = estados.filter(x=>x.estado==='sin_apunte').length;
  const mSin  = estados.filter(x=>x.estado==='sin_apunte').reduce((s,x)=>s+x.mov.monto,0);

  h += concCuadreHTML(estados, casillas);
  h += `<div class="panel"><div class="d-h3">Pagos a proveedor · ${pagos.length} movimientos</div>
    <div class="conc-res">
      <div class="conc-k" style="border-left-color:#0B6E3F"><div class="l">Confirmados</div><div class="v">${nOk}</div></div>
      <div class="conc-k" style="border-left-color:#E0A100"><div class="l">Por confirmar</div><div class="v">${nProp}</div></div>
      <div class="conc-k" style="border-left-color:#E0A100"><div class="l">Pendientes (Karen)</div><div class="v">${estados.filter(x=>x.estado==='pendiente').length}</div></div>
      <div class="conc-k" style="border-left-color:#C0261F"><div class="l">Sin apunte</div><div class="v">${nSin}</div>
        <div class="hint" style="margin:2px 0 0">${money(mSin)}</div></div>
    </div>
    <div class="frm-row" style="margin-bottom:10px;align-items:center;gap:8px;flex-wrap:wrap">
      ${[['pendientes','Por revisar'],['sin','Sin apunte'],['ok','Confirmados'],['todos','Todos']].map(([k,t])=>
        `<button class="btn-quiet${concFiltro===k?' on':''}" data-concf="${k}"
           style="${concFiltro===k?'background:var(--navy);color:#fff':''}">${t}</button>`).join('')}
      <label class="hint" style="margin-left:auto" title="Hacia atrás siempre busca hasta 2 meses">Días después del pago
        <select id="concVent" style="padding:5px 7px;border:1px solid #D8D2C4;border-radius:7px;font-family:inherit">
          ${[15,30,45,60,90].map(d=>`<option value="${d}"${d===concVentana?' selected':''}>${d} días</option>`).join('')}
        </select></label>
    </div>`;

  /* "Por revisar" se parte en secciones fijas: primero lo que sí encontré
     (para confirmar de corrido), luego lo que no encontré. Lo que confirmas
     se queda en su lugar, en verde, para que la lista no se recorra. */
  const enSec = (sec) => estados.filter(({mov, estado}) =>
      sec==='match' ? (estado==='propuesto' || (estado==='confirmado' && concRecientes.has(mov.id))) :
      sec==='sin'   ? estado==='sin_apunte' :
      sec==='ign'   ? estado==='ignorado' :
      sec==='pend'  ? estado==='pendiente' :
      sec==='ok'    ? estado==='confirmado' : true);
  const secciones = concFiltro==='pendientes'
    ? [['match','✅ Encontré la casilla — por confirmar', 'Revisa y confirma. Al confirmar se queda aquí en verde.'],
       ['sin','❓ No los encontré en la planilla', 'Ninguna casilla libre con ese monto. Elige qué es cada uno.'],
       ['pend','⏸ Pendientes de checar con Karen', 'Salen en el PDF para mandárselo. Cuando sepas qué es, dale "Ya lo resolví" y vuelve a su lugar.'],
       ['ign','🚫 Marcados como "no va en la planilla"', '']]
    : [[concFiltro==='ok'?'ok':concFiltro==='sin'?'sin':'todos', '', '']];

  let hay = false;
  for(const [sec, titulo, ayuda] of secciones){
  const visibles = enSec(sec);
  if(!visibles.length) continue;
  hay = true;
  if(titulo) h += `<div class="conc-sec"><b>${titulo} · ${visibles.length}</b>${ayuda?`<span class="hint">${ayuda}</span>`:''}
    ${sec==='pend'?`<button class="btn-primary" id="concPendPDF" style="align-self:flex-start;margin-top:6px">📄 PDF de pendientes para Karen</button>`:''}</div>`;
  for(const {mov, estado} of visibles){
    const cls = estado==='confirmado'?'ok':(estado==='sin_apunte'?'sin':(estado==='ignorado'?'ign':(estado==='pendiente'?'pend':'prop')));
    h += `<div class="conc-mov ${cls}">
      <div class="conc-top">
        <span class="mnt">${money(mov.monto)}</span>
        <span class="ben">${esc(mov.beneficiario || mov.concepto)}</span>
        ${mov.nota ? `<span class="conc-notak" title="Nota de la transferencia">📝 ${esc(mov.nota)}</span>` : ''}
        ${concNotaSucursal(mov) && concNotaSucursal(mov) !== finLoc ? `<span class="conc-chip" style="color:#8A5A00;background:#FFE7B0">📍 la nota dice ${esc((LOCS[concNotaSucursal(mov)]||'').replace(/^Boye's\s*/,''))}</span>` : ''}
        ${concChip(estado)}
        <span class="fch">${esc(mov.fecha)} · ${esc(mov.concepto)}</span>
      </div>`;

    if(estado==='confirmado'){
      const c = casillas.find(x=>x.usada && x.usada.mov===mov.id);
      const comp = c.usada && c.usada.compartido;
      if(comp){
        const otra = CONC_OTRA[finLoc], otraN = (LOCS[otra]||'').replace(/^Boye's\s*/,'');
        const nom = c.cat, O = concOtra[c.ym];
        const enOtra = planN(((O||{}).gastos_fijos||{})[nom]?.monto);
        h += `<div class="conc-cand" style="background:#EEF5FF;font-size:12.5px;flex-wrap:wrap">
          🤝 Compartido · ${esc(nom)} ${concNomMes(c.ym)}: ${money(comp.mitad)} aquí + ${money(comp.mitad)} ${otraN}.
          ${comp.abono ? `Abono de ${otraN} ✓ (${esc(comp.abono_fecha)}).` : `<b style="color:#C0261F">Sin abono de ${otraN}.</b>`}
          ${Math.abs(enOtra - comp.mitad) < 0.05 ? `Planilla de ${otraN} ✓.`
            : `<span>Planilla de ${otraN}: ${enOtra?money(enOtra):'no capturado'}.</span>
               <button class="btn-quiet" data-cmitad="${esc(c.ym)}|${esc(nom)}|${comp.mitad}|${esc(mov.id)}">Anotar ${money(comp.mitad)} en ${otraN}</button>`}
        </div>`;
      }
      h += `<div class="conc-cand">
        <span style="font-size:12.5px">Va contra <b>${esc(concEtiqueta(c, mov))}</b>
          — lo confirmaste ${c.usada.por?`(${esc(c.usada.por)})`:''}</span>
        <input type="text" class="conc-nota" data-cnotaok="${esc(c.ym)}|${esc(c.clave)}" placeholder="💬 Nota (ej. ANUNCIOS LUMINOSOS)"
          value="${esc(((concMeses[c.ym]||{}).formato||{})[c.clave]?.nota||'')}">
        <button class="btn-quiet" data-concdes="${esc(c.clave)}" data-concym="${c.ym}"
                style="margin-left:auto">Deshacer</button></div>`;
    } else if(estado==='propuesto'){
      const cand = rep.deMov.get(mov.id) || [];
      const cc = cand.find(c => c.compartido);
      if(cc){
        const ab = concAbonoOtra(mov, cc.mitad);
        const otraN = (LOCS[CONC_OTRA[finLoc]]||'').replace(/^Boye's\s*/,'');
        h += `<div class="conc-cand" style="background:#EEF5FF;flex-direction:column;align-items:flex-start;gap:3px;font-size:12.5px">
          <span>🤝 <b>Gasto compartido:</b> ${money(mov.monto)} = 2 × ${money(cc.mitad)}. La mitad de ${esc(cc.cat)} es de ${otraN}.</span>
          <span>${ab ? `✅ ${otraN} sí abonó su mitad: ${money(ab.monto)} el ${esc(ab.fecha)}${ab.beneficiario||ab.concepto?` (${esc((ab.beneficiario||ab.concepto).slice(0,60))})`:''}.`
                     : `⚠️ No encontré el abono de ${otraN} por ${money(cc.mitad)} (±7 días). Revísalo: puede que no lo haya transferido.`}</span></div>`;
      }
      h += `<div class="conc-cand">
        <select data-conccand="${esc(mov.id)}">
          ${cand.slice(0,25).map((c,i)=>`<option value="${esc(c.ym)}|${esc(c.clave)}"${i?'':' selected'}>
            ${c.aprox?'≈ ':''}${esc(concEtiqueta(c, mov))} · ${c.aprox?`Karen puso ${money(c.monto)} → queda ${money(mov.monto)}`:money(c.monto)}${c.fijo||c.aprox?'':` · ${concDias(c.fecha,mov.fecha)} días antes`}
          </option>`).join('')}
        </select>
        <input type="text" class="conc-nota" data-cnotaprop="${esc(mov.id)}" placeholder="💬 Nota (opcional)">
        <button class="btn-primary" data-concok="${esc(mov.id)}">Confirmar</button>
        <button class="btn-quiet" data-cpok="${esc(mov.id)}" title="No lo reconozco: checar con Karen">⏸ Pendiente</button></div>`;
    } else if(estado==='pendiente'){
      const pd = concPendiente(mov);
      h += `<div class="conc-cand" style="background:#FFF6E0">
        <span style="font-size:12.5px">⏸ Pendiente de checar con Karen ${pd.por?`(${esc(pd.por)})`:''}</span>
        <input type="text" class="conc-nota" data-cpnota="${esc(mov.id)}" value="${esc(pd.nota||'')}" placeholder="💬 Pregunta para Karen">
        <button class="btn-quiet" data-cpquita="${esc(mov.id)}" style="margin-left:auto">Ya lo resolví</button></div>`;
    } else if(estado==='ignorado'){
      const ig = concIgnorado(mov);
      h += `<div class="conc-cand">
        <span style="font-size:12.5px">No va en la planilla${ig.nota?` — ${esc(ig.nota)}`:''} ${ig.por?`(${esc(ig.por)})`:''}</span>
        <button class="btn-quiet" data-concdesig="${esc(mov.id)}" style="margin-left:auto">Deshacer</button></div>`;
    } else {
      const ymMov = mov.fecha.slice(0,7);
      const mesesF = Object.keys(concMeses).filter(ym => Math.abs(concMesDif(ym, ymMov)) <= 1).sort();
      const fijos = [...new Set(mesesF.flatMap(ym => Object.keys(concMeses[ym].gastos_fijos||{})))]
        .concat(typeof PLAN_GF!=='undefined' ? PLAN_GF : []).filter((x,i,a)=>a.indexOf(x)===i);
      const cats = [...new Set([...(typeof PLAN_GV!=='undefined'?PLAN_GV:[]),
        ...Object.values(concMeses).flatMap(P=>Object.keys(P.gastos_var||{}))])];
      const K = concProveedor(mov);
      const sug = (K && cats.includes(K)) ? K : (cats.find(c => c.split(/[^A-ZÑ]+/i).filter(x=>x.length>3)
        .some(x => (mov.beneficiario+' '+mov.concepto).toUpperCase().includes(x.toUpperCase()))) || '');
      const otros = concOtroRenglon(mov, casillas);
      const mid = esc(mov.id);
      const comp = rep.compite.get(mov.id);
      h += `<div class="conc-cand" style="background:#FFF1EF">
        <span style="font-size:12.5px">${comp
          ? `Hay una casilla de este monto (${esc(concEtiqueta(comp, mov))}), pero le corresponde mejor a otro cargo del banco igual. Parece que falta capturar uno de los dos.`
          : K ? `Va en <b>${esc(K)}</b>, pero no hay casilla libre de ese monto.`
              : `No encontré casilla de ese monto.`}</span></div>
      <div class="conc-rap">
        ${sug ? `<button class="btn-primary" data-crapcap="${mid}" data-crapcat="${esc(sug)}">✏️ Capturar en ${esc(sug)} · ${esc(mov.fecha.slice(8,10))} ${CONC_MESES[Number(mov.fecha.slice(5,7))].slice(0,3)}</button>` : ''}
        <button class="${sug?'btn-quiet':'btn-primary'}" data-cpok="${mid}">⏸ Pendiente</button>
        <button class="btn-quiet conc-masbtn" data-cmas="${mid}">Más opciones ▾</button>
      </div>
      <div class="conc-opc" data-cmasbox="${mid}" hidden>
        ${otros.length ? `<div class="conc-o" style="border-color:#E0A100;background:#FFF9E8"><b>🔀 ¿Karen lo puso en otro renglón?</b>
          <select data-cmvsel="${mid}">${otros.map(c=>`<option value="${esc(c.ym)}|${esc(c.clave)}">${esc(c.cat)} · ${c.dia} ${CONC_MESES[Number(c.ym.slice(5,7))].slice(0,3)} · ${money(c.monto)}</option>`).join('')}</select>
          <button class="btn-primary" data-cmvok="${mid}" data-cmvcat="${esc(K)}">Mover a ${esc(K)} y confirmar</button>
          <span class="hint">Solo si de verdad fue error: lo quita de ese renglón y lo pasa a ${esc(K)} el mismo día.</span></div>` : ''}
        <div class="conc-o"><b>🔒 Es gasto fijo</b>
          <select data-cfnom="${mid}">${fijos.map(f=>`<option>${esc(f)}</option>`).join('')}</select>
          <select data-cfym="${mid}">${mesesF.map(ym=>{
            const dm = concMesDif(ym, ymMov);
            return `<option value="${ym}"${dm===0?' selected':''}>${concNomMes(ym)}${dm>0?' (por adelantado)':dm<0?' (servicio del mes anterior)':''}</option>`;}).join('')}</select>
          <button class="btn-primary" data-cfok="${mid}">Aplicar</button></div>
        <div class="conc-o"><b>✏️ Capturarlo como gasto</b>
          <select data-ccat="${mid}"><option value="">Concepto…</option>${cats.map(c=>`<option${c===sug?' selected':''}>${esc(c)}</option>`).join('')}</select>
          <input type="date" data-cfec="${mid}" value="${esc(mov.fecha)}">
          <input type="text" class="conc-nota" data-cnotacap="${mid}" placeholder="💬 Nota (opcional)">
          <button class="btn-primary" data-ccok="${mid}">Capturar</button></div>
        <div class="conc-o" style="border-color:#E0A100"><b>⏸ Dejar pendiente</b>
          <input type="text" data-cpnew="${mid}" placeholder="Pregunta para Karen (ej. ¿2ª factura de Arca?)">
          <button class="btn-quiet" data-cpok="${mid}">Dejar pendiente</button></div>
        <div class="conc-o"><b>🚫 No va en la planilla</b>
          <input type="text" data-cinota="${mid}" placeholder="¿Por qué? (personal, traspaso…)">
          <button class="btn-quiet" data-ciok="${mid}">Marcar</button></div>
      </div>`;
    }
    h += `</div>`;
  }
  }
  if(!hay) h += `<p class="hint">Nada en este filtro.</p>`;
  h += `</div>`;

  h += concInversaHTML(casillas, rep);

  /* ---- comisiones bancarias ---- */
  const com = concComisiones();
  if(com && (com.suma > 0 || com.dec)){
    const P = concMeses[concMes] || {};
    const enPla = planN(((P.gastos_fijos||{})['COMISIONES BANCARIAS']||{}).monto);
    const ok = Math.abs(enPla - com.monto) < 0.01;
    h += `<div class="panel"><div class="d-h3">Comisiones bancarias · ${concNomMes(concMes)}</div>
      <div class="conc-res">
        <div class="conc-k" style="border-left-color:#C0261F"><div class="l">Del estado de cuenta</div><div class="v">${money(com.monto)}</div>
          <div class="hint" style="margin:2px 0 0">${com.lista.length} cargos${com.dec?` · el banco declara ${money(com.dec)}`:''}</div></div>
        <div class="conc-k" style="border-left-color:${ok?'#0B6E3F':'#E0A100'}"><div class="l">En la planilla</div><div class="v">${enPla?money(enPla):'—'}</div>
          <div class="hint" style="margin:2px 0 0">COMISIONES BANCARIAS (gasto fijo)</div></div>
      </div>
      <p class="hint" style="margin:0 0 8px">${Object.entries(com.grupos).map(([k,v])=>`${k}: ${money(Math.round(v*100)/100)}`).join(' · ')} (incluye IVA)
        ${com.dec && Math.abs(com.dec - com.suma) > 0.5 ? `<br>Sumé ${money(com.suma)} en cargos de comisión; el banco declara ${money(com.dec)}. Se usa lo que declara el banco.` : ''}</p>
      ${ok ? `<p style="margin:0;font-weight:700;color:#0B6E3F">✓ Ya está en la planilla y en naranja.</p>`
           : `<button class="btn-primary" data-ccom="${com.monto}">Anotar ${money(com.monto)} en COMISIONES BANCARIAS de ${concNomMes(concMes)}</button>`}
    </div>`;
  }

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
    const nota = (document.querySelector(`[data-cnotaprop="${CSS.escape(b.dataset.concok)}"]`)?.value || '').trim();
    await concConfirma(b.dataset.concok, resto.join('|'), ym, nota);
  }));
  const _v = (attr, id) => document.querySelector(`[${attr}="${CSS.escape(id)}"]`)?.value || '';
  document.querySelectorAll('[data-cnotaok]').forEach(i=>i.addEventListener('change', ()=>{
    const [ym, ...r] = i.dataset.cnotaok.split('|'); concNota(r.join('|'), ym, i.value.trim()); }));
  document.querySelectorAll('.conc-nota').forEach(i=>i.addEventListener('keydown', e=>{ if(e.key==='Enter') i.blur(); }));
  document.querySelectorAll('[data-cmitad]').forEach(b=>b.addEventListener('click', ()=>{
    const [ym, nom, mitad, id] = b.dataset.cmitad.split('|'); concMitadOtra(ym, nom, Number(mitad), id); }));
  document.querySelectorAll('[data-crapcap]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.crapcap, mov = concEdo.movs.find(m=>m.id===id);
    if(mov) concCaptura(id, b.dataset.crapcat, mov.fecha, ''); }));
  document.querySelectorAll('[data-cmas]').forEach(b=>b.addEventListener('click', ()=>{
    const box = document.querySelector(`[data-cmasbox="${CSS.escape(b.dataset.cmas)}"]`);
    if(box){ box.hidden = !box.hidden; b.textContent = box.hidden ? 'Más opciones ▾' : 'Menos ▴'; } }));
  document.querySelectorAll('[data-cefe]').forEach(b=>b.addEventListener('click', ()=>{
    const [ym, ...r] = b.dataset.cefe.split('|'); concEfectivo(ym, r.join('|'), true); }));
  document.querySelectorAll('[data-cefeq]').forEach(a=>a.addEventListener('click', e=>{ e.preventDefault();
    const [ym, ...r] = a.dataset.cefeq.split('|'); concEfectivo(ym, r.join('|'), false); }));
  document.getElementById('concVerEfe')?.addEventListener('click', ()=>{ const b=document.getElementById('concEfeBox'); if(b) b.hidden=!b.hidden; });
  document.querySelectorAll('[data-ccom]').forEach(b=>b.addEventListener('click', ()=>concComAnota(Number(b.dataset.ccom))));
  document.querySelectorAll('[data-cpok]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.cpok; concDejaPend(id, _v('data-cpnew', id).trim()); }));
  document.querySelectorAll('[data-cpquita]').forEach(b=>b.addEventListener('click', ()=>concQuitaPend(b.dataset.cpquita)));
  document.querySelectorAll('[data-cpnota]').forEach(i=>i.addEventListener('change', ()=>concNotaPend(i.dataset.cpnota, i.value.trim())));
  document.getElementById('concPendPDF')?.addEventListener('click', concPendPDF);
  document.querySelectorAll('[data-cmvok]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.cmvok, [ym, ...r] = _v('data-cmvsel', id).split('|');
    concMueve(id, ym, r.join('|'), b.dataset.cmvcat); }));
  document.querySelectorAll('[data-cfok]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.cfok; concAFijo(id, _v('data-cfnom', id), _v('data-cfym', id)); }));
  document.querySelectorAll('[data-ccok]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.ccok, cat = _v('data-ccat', id);
    if(!cat){ toast('Elige el concepto'); return; }
    concCaptura(id, cat, _v('data-cfec', id), _v('data-cnotacap', id).trim()); }));
  document.querySelectorAll('[data-ciok]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.ciok; concIgnora(id, _v('data-cinota', id)); }));
  document.querySelectorAll('[data-concdesig]').forEach(b=>b.addEventListener('click', ()=>concDesignora(b.dataset.concdesig)));
  document.querySelectorAll('[data-concdes]').forEach(b=>b.addEventListener('click', async ()=>{
    b.disabled = true;
    await concDeshace(b.dataset.concdes, b.dataset.concym);
  }));
}
