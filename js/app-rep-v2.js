
function monthPicker(){
  const MN = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const nowY = new Date().getFullYear();
  const [cy, cm] = finMonth.split('-').map(Number);
  let h = `<div class="toolbar">
    <div class="switch" style="margin:0;flex:none;width:200px">
      <button aria-pressed="${!finRange}" data-pm="mes">Mes</button>
      <button aria-pressed="${!!finRange}" data-pm="rango">Rango</button></div>`;
  if(!finRange){
    h += `<select id="monSel" aria-label="Mes" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px 12px;background:var(--card);font-size:16px">
      ${MN.map((n,i)=>`<option value="${i+1}" ${i+1===cm?'selected':''}>${n}</option>`).join('')}</select>
    <select id="yrSel" aria-label="A\u00f1o" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px 12px;background:var(--card);font-size:16px">
      ${Array.from({length: nowY-2023+3},(_,k)=>2024+k).map(y=>`<option value="${y}" ${y===cy?'selected':''}>${y}</option>`).join('')}</select>`;
  } else {
    h += `<label class="hint">De</label><input type="date" id="rFrom" value="${finRange.from}">
    <label class="hint">a</label><input type="date" id="rTo" value="${finRange.to}">
    <button class="btn-quiet" id="rGo" style="min-height:48px">Aplicar</button>`;
  }
  h += `</div>`;
  return h;
}
function movView(){
  const tx = txMonth.filter(t=>t.location_id===finLoc);
  const ing = tx.filter(t=>t.kind==='ingreso').reduce((s,t)=>s+Number(t.amount),0);
  const egr = tx.filter(t=>t.kind==='egreso').reduce((s,t)=>s+Number(t.amount),0);
  let html = locSwitch(finLoc,'floc') + monthPicker();
  html += `<div class="kpis">
    <div class="kpi in"><div class="l">Ingresos</div><div class="v">${money(ing)}</div></div>
    <div class="kpi out-k"><div class="l">Egresos</div><div class="v">${money(egr)}</div></div>
    <div class="kpi"><div class="l">Balance</div><div class="v">${money(ing-egr)}</div></div>
  </div>`;
  html += `<form class="panel" id="txFrm">
    <div class="frm-row-3">
      <label>Fecha <input type="date" name="tx_date" value="${todayStr()}" required></label>
      <label>Tipo <select name="kind" id="kindSel"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></label>
      <label>Categoría <select name="category" id="catSel"></select></label>
    </div>
    <div class="frm-row">
      <label>Concepto <input name="concept" required maxlength="140" placeholder="Ej. Venta del día / Pago Sysco"></label>
      <label>Monto (MXN) <input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="0.00"></label>
    </div>
    <button class="btn-primary" type="submit">Registrar movimiento</button>
  </form>`;
  if(!tx.length){ html += `<div class="empty"><b>Sin movimientos este mes</b>Registra el primero arriba.</div>`; }
  else{
    let curDate = '';
    for(const t of tx){
      if(t.tx_date!==curDate){
        curDate = t.tx_date;
        html += `<div class="datehead">${new Date(t.tx_date+'T12:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'})}</div>`;
      }
      html += `<div class="txrow ${t.kind==='egreso'?'eg':''}">
        <div class="c"><div class="t">${esc(t.concept)}</div>
          <div class="m"><span class="cat-chip">${esc(CAT_LABEL[t.category]||t.category)}</span> · ${esc(t.created_by||'')}</div></div>
        <div class="amt">${t.kind==='egreso'?'−':'+'}${money(t.amount)}</div>
        ${t.payroll_run_id?'' :`<button class="del" data-deltx="${t.id}" aria-label="Eliminar movimiento">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`}
      </div>`;
    }
  }
  return html;
}
function wireMov(){
  const kindSel = $('#kindSel'), catSel = $('#catSel');
  const updCats = ()=>{ catSel.innerHTML = CATS[kindSel.value].filter(([v])=>v!=='nomina').map(([v,l])=>`<option value="${v}">${l}</option>`).join(''); };
  kindSel.addEventListener('change', updCats); updCats();
  $('#txFrm').addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      const row = await finRpc('fin_add_transaction', {
        p_date: f.get('tx_date'), p_location: finLoc, p_kind: f.get('kind'),
        p_category: f.get('category'), p_concept: f.get('concept'),
        p_amount: Number(f.get('amount')), p_notes: null
      });
      txMonth.unshift(row); txMonth.sort((a,b)=>b.tx_date.localeCompare(a.tx_date));
      toast('Movimiento registrado'); render();
    }catch(err){}
  });
}
async function deleteTx(id){
  if(!confirm('¿Eliminar este movimiento? Esta acción no se puede deshacer.')) return;
  try{
    await finRpc('fin_delete_transaction', {p_id: id});
    txMonth = txMonth.filter(t=>t.id!==id);
    toast('Movimiento eliminado'); render();
  }catch(e){}
}

/* ---------- checador engine (rules from CALCULO_NOMINA) ----------
   tarifa/hora = salario semanal / 56 · pago base topado a 48 h
   7º día = pago base / 6 · extras = horas sobre 48 × tarifa
   festivo trabajado = FESTIVO_DIAS × salario diario (base/7), sumado aparte
   salida faltante: entrada ≥ 15:00 → 23:59, si no → 14:00 (marcado para revisar)
   salida 23:59 en turno de cierre → botón +1 h (checador corta a las 23:59) */
/* ---------- DÍA FESTIVO TRABAJADO ----------
   Se paga DOBLE el día: lo que la persona generó ese día, otra vez. Si
   trabajó 10 horas y esas horas valieron $100, la casilla le agrega $100.
   No es un día de salario fijo — quien cerró 12 horas el 16 de septiembre no
   gana lo mismo que quien entró cuatro.

   Para eso hace falta saber QUÉ DÍA fue el festivo, y eso no se pregunta: son
   los días del Art. 74 de la LFT y se calculan. La casilla sigue siendo
   manual y sigue significando lo mismo —«esta persona sí lo trabajó»—, pero
   el monto ya sale de sus horas de ese día.

   Cuando no hay detalle de días (los que se capturan a mano) se cae al
   salario diario, que es lo único medible ahí, y el recibo lo dice. */
const FESTIVO_DIAS_FALLBACK = 1;

function festivosLFT(anio){
  /* El n-ésimo lunes de un mes: así están escritos en la ley tres de ellos. */
  const lunes = (mes, n) => {
    const d = new Date(anio, mes, 1);
    while(d.getDay() !== 1) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + (n-1)*7);
    return d;
  };
  const f = [
    new Date(anio, 0, 1),    // 1 de enero
    lunes(1, 1),             // primer lunes de febrero (por el 5 de febrero)
    lunes(2, 3),             // tercer lunes de marzo (por el 21 de marzo)
    new Date(anio, 4, 1),    // 1 de mayo
    new Date(anio, 8, 16),   // 16 de septiembre
    lunes(10, 3),            // tercer lunes de noviembre (por el 20 de noviembre)
    new Date(anio, 11, 25)   // 25 de diciembre
  ];
  /* Transmisión del Poder Ejecutivo Federal: cada seis años. 2024, 2030, 2036… */
  if((anio - 2024) % 6 === 0) f.push(new Date(anio, 11, 1));
  return f.map(dstr);
}
/* El festivo que cae dentro de la semana de nómina (jueves a miércoles), si
   es que cae alguno. Devuelve la fecha en texto, o null. */
function festivoDeLaSemana(){
  if(typeof payWeek === 'undefined' || !payWeek) return null;
  const dias = Array.from({length:7}, (_,i)=>{
    const d = new Date(payWeek); d.setDate(d.getDate()+i); return dstr(d);
  });
  const anios = [...new Set(dias.map(s=>Number(s.slice(0,4))))];
  const fest = anios.flatMap(festivosLFT);
  return dias.find(d => fest.includes(d)) || null;
}
const FESTIVO_NOMBRES = {
  '01-01':'1 de enero', '05-01':'1 de mayo', '09-16':'16 de septiembre',
  '12-25':'25 de diciembre', '12-01':'1 de diciembre'
};
function festivoNombre(iso){
  if(!iso) return '';
  return FESTIVO_NOMBRES[iso.slice(5)]
    || new Date(iso+'T12:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'});
}

const MESES = {ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,sep:8,oct:9,nov:10,dic:11};
const normName = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();
const parseTime = s => { const m=String(s||'').match(/^\s*(\d{1,2}):(\d{2})\s*$/); return m?Number(m[1])*60+Number(m[2]):null; };
const fmtHM = mins => String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');
function parseFecha(s){
  const m = String(s||'').match(/(\d{1,2})\/([a-z]{3})\/(\d{4})/i);
  if(!m) return null;
  const mo = MESES[m[2].toLowerCase()]; if(mo===undefined) return null;
  return new Date(Number(m[3]), mo, Number(m[1]), 12);
}
/* Un colaborador puede trabajar un día en Guaymas y otro en San Carlos. Antes,
   el checador solo buscaba dentro de la sucursal abierta, así que había que dar
   de alta a la misma persona dos veces —una por sucursal— y por eso cobraba
   doble en la nómina.
   Ahora se busca primero en la sucursal abierta, luego en cualquiera, y al
   final por parecido de nombre (para las erratas del checador). Con una sola
   ficha basta, aparezca en la sucursal que aparezca. */
function buscarColaborador(nombre, loc){
  const n = normName(nombre);
  const act = employees.filter(e=>e.active);
  return act.find(e=>e.location_id===loc && normName(e.name)===n)
      || act.find(e=>normName(e.name)===n)
      || act.find(e=>similitudNombre(e.name, nombre) >= UMBRAL_UNIR)
      || null;
}
function parseChecador(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length) return {error:'No hay datos'};
  let iName=1, iFecha=2, iEnt=3, iSal=4;
  let start=0;
  const head = lines[0].toLowerCase();
  if(head.includes('nombre') && head.includes('fecha')){
    const cols = lines[0].split('\t').map(c=>c.trim().toLowerCase());
    iName=cols.indexOf('nombre'); iFecha=cols.indexOf('fecha');
    iEnt=cols.indexOf('ent'); iSal=cols.indexOf('sal');
    if(iName<0||iFecha<0){ return {error:'No encontré las columnas nombre/fecha'}; }
    if(iEnt<0) iEnt=iFecha+1; if(iSal<0) iSal=iEnt+1;
    start=1;
  }
  const byEmp = new Map();
  let rows=0;
  for(let i=start;i<lines.length;i++){
    const c = lines[i].split('\t');
    const name = normName(c[iName]);
    const fecha = parseFecha(c[iFecha]);
    if(!name || !fecha || name==='NOMBRE') continue;
    rows++;
    const ent = parseTime(c[iEnt]), sal = parseTime(c[iSal]);
    let hours=0, flags=[], salShown = sal!==null ? fmtHM(sal) : null, entShown = ent!==null ? fmtHM(ent) : null;
    if(ent===null){ flags.push('falta'); }
    else if(sal===null){
      flags.push('auto');
      salShown = null; hours = 0;
      if([5,6].includes(fecha.getDay())) flags.push('cierre');
    }else{
      hours = ((sal-ent)+1440)%1440/60;
      if([5,6].includes(fecha.getDay())) flags.push('cierre');
    }
    hours = Math.round(hours*100)/100;
    if(!byEmp.has(name)) byEmp.set(name, []);
    byEmp.get(name).push({fecha: fecha.toISOString().slice(0,10),
      dia: fecha.toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'}),
      ent: entShown, sal: salShown, hours, flags});
  }
  if(!rows) return {error:'No pude leer filas. Copia el reporte desde la hoja (con columnas separadas por tabulador) y pégalo completo.'};
  const emps = [];
  for(const [name, days] of byEmp){
    days.sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const match = buscarColaborador(name, finLoc);
    emps.push({name, employee_id: match?.id||null, base: (match && Number(match.weekly_salary)>0) ? Number(match.weekly_salary) : null,
               days, added:0, festivo:false, bonos:0, descuentos:0});
  }
  emps.sort((a,b)=>a.name.localeCompare(b.name));
  return {emps};
}
function calcEmp(e){
  const hrs = Math.round(e.days.reduce((s,d)=>s+d.hours,0));
  const totalH = hrs + Number(e.added||0);
  const base = Number(e.base||0);
  const rate = base/56, diario = base/7;
  const pagoBase = Math.min(totalH,48)*rate;
  const septimo = pagoBase/6;
  const extraH = Math.max(0, totalH-48);
  const extras = extraH*rate;
  /* Lo que generó el día festivo: sus horas de ese día a su tarifa. Se le
     paga otra vez, así que ese día le sale al doble. */
  const fFest = festivoDeLaSemana();
  const hFest = fFest ? (e.days||[]).filter(d=>d.fecha===fFest)
                                    .reduce((s,d)=>s+Number(d.hours||0), 0) : 0;
  const festivo = !e.festivo ? 0
    : (hFest > 0 ? Math.round(hFest*rate*100)/100 : diario*FESTIVO_DIAS_FALLBACK);
  const bonos = Number(e.bonos||0), desc = Number(e.descuentos||0);
  const total = pagoBase+septimo+extras+festivo+bonos-desc;
  return {hrs, totalH, rate, pagoBase, septimo, extraH, extras, festivo, bonos, desc, total};
}
/* Reconstruye la tabla interactiva (días/horas por checador) desde una nómina ya guardada,
   para poder seguir ajustando horas de cada quien — incluso a los que se agregaron manual. */
function rebuildPayCalcFromSaved(){
  const emps = (payData.items||[]).map(i=>{
    const bd = i.breakdown||null;
    const days = bd?.days||[];
    const match = employees.find(e=>e.id===i.employee_id);
    const base = bd?.base_semanal ?? (match?Number(match.weekly_salary||0):null) ?? null;
    return {
      name: i.name, employee_id: i.employee_id,
      base: (base!==null && base>0) ? base : null,
      days, added: days.length ? 0 : Number(i.hours||0),
      festivo: !!(bd && Number(bd.festivo||0)>0),
      bonos: Number(bd?.bonos ?? 0), descuentos: Number(i.deductions||0),
      manual: !days.length
    };
  });
  emps.sort((a,b)=>a.name.localeCompare(b.name));
  payCalc = {emps};
}
/* ============ RECIBO DE PAGO DE SALARIO ============
   Formato para firma del trabajador. No sustituye al CFDI de nómina que
   expide el contador; es la constancia interna de que se pagó y se recibió. */
const EMPRESA = "BOYE'S - BURGER & PIZZA";
const LOGO_RECIBO = 'img/logo.png';

/* Cantidad con letra: en un recibo de pago es lo que impide que alguien le
   agregue un dígito al importe después de firmado. */
const _UNI = ['','UN','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE'];
const _DEC = ['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
const _CEN = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
function _centenas(n){
  if(n===0) return '';
  if(n===100) return 'CIEN';
  const c = Math.floor(n/100), r = n%100;
  let t = _CEN[c];
  if(r){
    if(r<=20) t += (t?' ':'') + _UNI[r];
    else{
      const d = Math.floor(r/10), u = r%10;
      if(d===2) t += (t?' ':'') + (u ? 'VEINTI'+_UNI[u].toLowerCase().toUpperCase() : 'VEINTE');
      else t += (t?' ':'') + _DEC[d] + (u ? ' Y '+_UNI[u] : '');
    }
  }
  return t;
}
function numeroALetras(monto){
  const n = Math.floor(Math.abs(Number(monto)||0));
  const cent = Math.round((Math.abs(Number(monto)||0) - n)*100);
  let txt;
  if(n===0) txt = 'CERO';
  else if(n===1) txt = 'UN';
  else{
    const millones = Math.floor(n/1000000), resto = n%1000000;
    const miles = Math.floor(resto/1000), unidades = resto%1000;
    const partes = [];
    if(millones) partes.push(millones===1 ? 'UN MILLÓN' : _centenas(millones)+' MILLONES');
    if(miles) partes.push(miles===1 ? 'MIL' : _centenas(miles)+' MIL');
    if(unidades) partes.push(_centenas(unidades));
    txt = partes.join(' ');
  }
  return `${txt} ${n===1?'PESO':'PESOS'} ${String(cent).padStart(2,'0')}/100 M.N.`;
}
function fechaLargaHoy(){
  return new Date().toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
}
function encabezadoRecibo(titulo, subtitulo){
  return `<div class="rc-head">
    <img class="rc-logo" src="${LOGO_RECIBO}" alt="Boye's">
    <div class="rc-head-txt">
      <h1>${esc(titulo)}</h1>
      <div class="sub2">${esc(EMPRESA)} · ${esc(LOCS[finLoc]||'')}</div>
      <div class="sub3">${esc(subtitulo)}</div>
    </div>
  </div>`;
}
/* Cláusula de conformidad. Cubre lo que sí puede ir absorbido en un sueldo
   semanal: el séptimo día, la prima dominical y los festivos. El tiempo
   extraordinario se desglosa aparte porque la ley lo paga por separado. */
const CLAUSULA_RECIBO = `El trabajador manifiesta haber recibido de ${EMPRESA} la cantidad señalada como PAGO NETO, por concepto del salario correspondiente al periodo indicado, quedando pagados a su entera satisfacción todos los días efectivamente laborados en dicho periodo.
Ambas partes reconocen que el salario semanal aquí pagado ya comprende y cubre el pago del día de descanso semanal o séptimo día (Arts. 69 y 71 LFT), la prima dominical (Art. 71 LFT) y los días de descanso obligatorio (Arts. 74 y 75 LFT), por lo que dichos conceptos no se adeudan por separado. El tiempo extraordinario, los bonos y cualquier otro concepto devengado se desglosan por separado en este mismo recibo cuando corresponden.
Con la firma de este documento el trabajador otorga el recibo más amplio que en derecho proceda por el periodo señalado, y declara que no queda a su favor cantidad alguna pendiente de pago por dicho periodo.`;

function receiptHtml(r, weekLabel){
  const percep = [
    ['Sueldo del periodo', r.base],
    ['Tiempo extraordinario', r.extrasMonto],
    ['Bonos e incentivos', r.bonos]
  ].filter(x=>Number(x[1])>0 || x[0]==='Sueldo del periodo');
  const totalPercep = percep.reduce((s,x)=>s+Number(x[1]||0),0);
  const totalDed = Number(r.deducciones||0);
  const neto = totalPercep - totalDed;
  return `<div class="rc">
    ${encabezadoRecibo('Recibo de pago de salario', `Periodo: ${weekLabel}`)}

    <table class="rc-datos">
      <tr><th>Trabajador</th><td colspan="3">${esc(r.name)}</td></tr>
      <tr><th>Puesto</th><td>${esc(r.puesto||'—')}</td>
          <th>Fecha de ingreso</th><td>${esc(r.ingreso||'—')}</td></tr>
      <tr><th>Centro de trabajo</th><td>${esc(LOCS[finLoc]||'')}</td>
          <th>Periodicidad</th><td>Semanal</td></tr>
      <tr><th>Días pagados</th><td>7</td>
          <th>Horas del periodo</th><td>${r.horas==null?'—':r.horas}${Number(r.horasExtra)>0?` (${r.horasExtra} extra)`:''}${(!r.days||!r.days.length)?' · captura manual':''}</td></tr>
    </table>
    ${(!r.days||!r.days.length)?`<div class="rc-nota">Este colaborador no registra en el checador; sus horas del periodo se capturaron a mano por administración.</div>`:''}

    <table class="rc-mov">
      <thead><tr><th colspan="2">Percepciones</th><th colspan="2">Deducciones</th></tr></thead>
      <tbody>
        ${(()=>{
          const ded = totalDed>0 ? [['Descuentos y préstamos', totalDed]] : [['—','']];
          const filas = Math.max(percep.length, ded.length);
          let out = '';
          for(let i=0;i<filas;i++){
            const p = percep[i], d = ded[i];
            out += `<tr>
              <td>${p?esc(p[0]):''}</td><td class="num">${p?money(p[1]):''}</td>
              <td>${d?esc(d[0]):''}</td><td class="num">${d&&d[1]!==''?money(d[1]):''}</td></tr>`;
          }
          return out;
        })()}
        <tr class="subt"><td>Total percepciones</td><td class="num">${money(totalPercep)}</td>
            <td>Total deducciones</td><td class="num">${money(totalDed)}</td></tr>
      </tbody>
      <tfoot><tr class="total-row"><td colspan="2">PAGO NETO</td><td class="num" colspan="2">${money(neto)}</td></tr></tfoot>
    </table>
    <div class="rc-letra"><b>Cantidad con letra:</b> ${esc(numeroALetras(neto))}</div>

    ${r.days && r.days.length ? `<table class="rc-asist">
      <thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th class="num">Horas</th></tr></thead>
      <tbody>${r.days.map(d=>`<tr><td>${esc(d.dia)}</td><td>${esc(d.ent||'—')}</td><td>${esc(d.sal||'—')}</td><td class="num">${Number(d.hours||0).toFixed(2)}</td></tr>`).join('')}</tbody>
    </table>` : ''}

    <div class="rc-clausula">${CLAUSULA_RECIBO.split('\n').map(p=>`<p>${esc(p)}</p>`).join('')}</div>

    <div class="rc-firma-wrap">
      <div class="rc-fecha">${esc(LOCS[finLoc]||'')}, Sonora, a ${esc(fechaLargaHoy())}</div>
      <div class="rc-firma">
        <div class="rc-linea"></div>
        <div class="rc-nombre">${esc(r.name)}</div>
        <div class="rc-rol">Firma de conformidad del trabajador</div>
      </div>
    </div>
    <div class="rc-pie">Documento interno de control. No sustituye al CFDI de nómina.</div>
  </div>`;
}
/* Concentrado de toda la semana, para archivo y firma de quien la elabora y
   quien la autoriza. */
function payrollSummaryHtml(filas, weekLabel){
  const t = filas.reduce((a,r)=>({
    base:a.base+Number(r.base||0), extras:a.extras+Number(r.extrasMonto||0)+Number(r.bonos||0),
    ded:a.ded+Number(r.deducciones||0),
    neto:a.neto+Number(r.base||0)+Number(r.extrasMonto||0)+Number(r.bonos||0)-Number(r.deducciones||0),
    horas:a.horas+Number(r.horas||0)
  }), {base:0,extras:0,ded:0,neto:0,horas:0});
  return `<div class="rc">
    ${encabezadoRecibo('Concentrado de nómina semanal', `Periodo: ${weekLabel}`)}
    <table class="rc-mov rc-concentrado">
      <thead><tr><th>#</th><th>Trabajador</th><th>Puesto</th><th class="num">Horas</th>
        <th class="num">Sueldo</th><th class="num">Extras y bonos</th><th class="num">Deducciones</th><th class="num">Neto</th></tr></thead>
      <tbody>
        ${filas.map((r,ix)=>{
          const ex = Number(r.extrasMonto||0)+Number(r.bonos||0);
          const neto = Number(r.base||0)+ex-Number(r.deducciones||0);
          return `<tr><td class="num">${ix+1}</td><td>${esc(r.name)}</td><td>${esc(r.puesto||'—')}</td>
            <td class="num">${r.horas??'—'}</td><td class="num">${money(r.base)}</td>
            <td class="num">${money(ex)}</td><td class="num">${money(r.deducciones||0)}</td>
            <td class="num"><b>${money(neto)}</b></td></tr>`;
        }).join('')}
      </tbody>
      <tfoot><tr class="total-row"><td colspan="3">TOTAL · ${filas.length} colaborador${filas.length===1?'':'es'}</td>
        <td class="num">${t.horas||'—'}</td><td class="num">${money(t.base)}</td><td class="num">${money(t.extras)}</td>
        <td class="num">${money(t.ded)}</td><td class="num">${money(t.neto)}</td></tr></tfoot>
    </table>
    <div class="rc-letra"><b>Importe total con letra:</b> ${esc(numeroALetras(t.neto))}</div>

    <div class="rc-fecha" style="margin-top:26px">${esc(LOCS[finLoc]||'')}, Sonora, a ${esc(fechaLargaHoy())}</div>
    <div class="rc-firmas-2">
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Elaboró</div></div>
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Autorizó</div></div>
    </div>
    <div class="rc-pie">Documento interno de control. No sustituye al CFDI de nómina.</div>
  </div>`;
}
/* Datos del trabajador que no vienen en la nómina (puesto, ingreso) se toman
   de la plantilla, que ahora es una sola para las dos sucursales. */
function datosDePlantilla(nombre, id){
  const e = (id && employees.find(x=>x.id===id)) || buscarColaborador(nombre, finLoc);
  if(!e) return {};
  return {puesto: e.position || etiquetaPuesto(e.role), ingreso: e.hire_date ? fechaLarga(e.hire_date) : ''};
}
function etiquetaSemana(){
  const end = new Date(payWeek); end.setDate(end.getDate()+6);
  return `jueves ${payWeek.toLocaleDateString('es-MX',{day:'numeric',month:'long'})} al miércoles ${end.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'})}`;
}
function printReceipts(filas, concentrado){
  const wl = etiquetaSemana();
  const html = filas.map(r=>receiptHtml(r, wl)).join('');
  $('#printArea').innerHTML = concentrado ? payrollSummaryHtml(filas, wl) + html : html;
  /* Que el logotipo alcance a cargar antes de abrir la ventana de impresión. */
  const img = $('#printArea').querySelector('.rc-logo');
  const abrir = ()=>window.print();
  if(img && !img.complete){ img.onload = abrir; img.onerror = abrir; setTimeout(abrir, 1500); }
  else abrir();
}
/* Semanas de nómina ya guardadas, para saltar a cualquiera de un toque.
   Es el mismo atajo que ya existía en Inventario: la navegación de flecha en
   flecha obligaba a adivinar en qué semana quedó guardada la nómina. */
function nomHistChips(){
  if(!payHist || !payHist.length) return '';
  const cur = dstr(payWeek);
  let h = `<div class="hint" style="font-weight:700;margin-bottom:6px">Nóminas guardadas · ${LOCS[finLoc]}</div><div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px">`;
  for(const w of payHist){
    const d = new Date(w.week_start+'T12:00');
    const fin = new Date(d); fin.setDate(fin.getDate()+6);
    const label = d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
    const rango = `${d.getDate()} al ${fin.toLocaleDateString('es-MX',{day:'numeric',month:'short'})}`;
    const active = w.week_start===cur;
    h += `<button data-gopay="${w.week_start}" title="Nómina del ${rango}" style="flex:none;min-height:56px;padding:6px 14px;border-radius:12px;
      background:${active?'var(--navy)':'var(--card)'};color:${active?'#fff':'var(--ink)'};box-shadow:var(--shadow);text-align:left">
      <span style="display:block;font-weight:800;font-size:14px">${label}</span>
      <span style="display:block;font-size:12px">${money(Number(w.total||0))} · ${w.n_empleados} col.</span></button>`;
  }
  return h + `</div>`;
}
function nomView(){
  const end = new Date(payWeek); end.setDate(end.getDate()+6);
  const fmt = d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  let html = '';
  {
    html += locSwitch(finLoc,'floc');
    html += `<div class="weeknav">
      <button data-wk="-1" aria-label="Semana anterior">‹</button>
      <b>Nómina del jueves ${fmt(payWeek)} al miércoles ${fmt(end)} ${payData?.saved?'<span class="saved-flag">· Guardada</span>':''}</b>
      <button data-wk="1" aria-label="Semana siguiente">›</button>
    </div>`;
    html += nomHistChips();
    const sinSueldo = employees.filter(e=>e.location_id===finLoc && e.active && Number(e.weekly_salary)<=0);
    if(sinSueldo.length){
      html += `<div class="alarm-banner" role="alert" style="position:static">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Sin sueldo asignado: ${sinSueldo.map(e=>esc(e.name.split(' ')[0]+' '+(e.name.split(' ')[1]||''))).join(', ')} \u2014 as\u00edgnalo en Equipo</span>
      </div>`;
    }
  }
  /* La calculadora se fue a Herramientas y la plantilla a su propia pestaña
     (Equipo), que ahora abarca las dos sucursales. Aquí sobraban las dos. */
  if(nomMode!=='chk') nomMode='chk';
  html += (manualOpen ? manView() : chkView());
  return html;
}
/* ================= CALCULADORA LFT: aguinaldo / vacaciones / finiquito / liquidación ================= */
const SALARIO_MIN_2026 = 315.04; // CONASAMI, zona general, vigente desde 1-ene-2026 (Guaymas/San Carlos no son zona fronteriza)
const UMA_2026 = 117.31; // INEGI, vigente desde 1-feb-2026
function calcVacDiasPorAnio(n){ // n = año de servicio en curso (1-indexed), tabla LFT reformada 2023
  if(n<=5) return 10+2*n; // año1:12, año2:14, año3:16, año4:18, año5:20
  return 20 + 2*Math.ceil((n-5)/5); // 6-10:22, 11-15:24, 16-20:26, 21-25:28...
}
function diasDelAnio(y){ return ((y%4===0 && y%100!==0)||y%400===0) ? 366 : 365; }
/* La antigüedad se cuenta por aniversario, no dividiendo entre 365: así los años
   bisiestos no van corriendo la fecha. Y el primer y el último día trabajados
   cuentan los dos — si alguien entró el 27 de marzo y salió el 8 de agosto,
   trabajó los dos días. */
function calcAntiguedad(ingreso, calculo){
  const totalDias = Math.max(0, Math.round((calculo-ingreso)/86400000)) + 1;
  let anios = 0;
  const aniv = new Date(ingreso);
  for(;;){
    const sig = new Date(aniv); sig.setFullYear(sig.getFullYear()+1);
    if(sig > calculo) break;
    aniv.setFullYear(aniv.getFullYear()+1); anios++;
  }
  const sigAniv = new Date(aniv); sigAniv.setFullYear(sigAniv.getFullYear()+1);
  const diasDelAnioServicio = Math.round((sigAniv-aniv)/86400000);
  const diasEnAnioActual = Math.round((calculo-aniv)/86400000) + 1;
  return {totalDias, anios, diasEnAnioActual, diasDelAnioServicio,
          fraccionAnio: Math.min(1, diasEnAnioActual/diasDelAnioServicio), anioServicioActual: anios+1};
}
function calcLiquidacion(f){
  /* El sueldo mensual se divide entre 30, no entre 30.4: es la convención de la
     LFT y del IMSS. Con 30.4 el salario diario salía 1.3% más bajo y todo lo
     demás se calculaba corto. */
  const salarioDiario = f.salarioTipo==='diario' ? Number(f.salario||0)
    : f.salarioTipo==='semanal' ? Number(f.salario||0)/7
    : f.salarioTipo==='quincenal' ? Number(f.salario||0)/15
    : Number(f.salario||0)/30; // mensual
  const ingreso = new Date(f.fechaIngreso+'T12:00'), calculo = new Date(f.fechaCalculo+'T12:00');
  const items = [];
  if(!f.fechaIngreso || isNaN(ingreso) || isNaN(calculo) || calculo<ingreso || salarioDiario<=0){
    return {items, total:0, error:true};
  }
  const {anios, fraccionAnio, anioServicioActual} = calcAntiguedad(ingreso, calculo);
  const diasVacCorresponden = calcVacDiasPorAnio(anioServicioActual);
  /* Los días se redondean SOLO para mostrarlos. El dinero se calcula con el
     número completo: redondear antes se comía centavos en cada recibo. */
  const vacDiasPropExacto = diasVacCorresponden*fraccionAnio;
  const vacDiasProp = Math.round(vacDiasPropExacto*100)/100;
  const vacDiasPendAnteriores = Math.max(0, Number(f.vacPendientes||0));
  const vacDiasTotal = Math.round((vacDiasPropExacto+vacDiasPendAnteriores)*100)/100;
  const vacPropPesos = vacDiasPropExacto*salarioDiario;
  const vacPesos = vacPropPesos + vacDiasPendAnteriores*salarioDiario;
  const primaVacPesos = vacPesos*0.25;
  const inicioAnioCal = new Date(calculo.getFullYear(),0,1);
  const inicioAguinaldo = ingreso>inicioAnioCal ? ingreso : inicioAnioCal;
  const diasAguinaldo = Math.max(0, Math.round((calculo-inicioAguinaldo)/86400000)+1);
  const diasAnioCal = diasDelAnio(calculo.getFullYear());
  /* El aguinaldo se paga completo en diciembre, así que en un finiquito
     siempre entra la parte proporcional del año en curso. */
  const aguinaldoPesos = (diasAguinaldo/diasAnioCal)*15*salarioDiario;
  const salarioTopadoAntig = Math.min(salarioDiario, 2*SALARIO_MIN_2026);
  const antiguedadTotal = anios+fraccionAnio;
  const primaAntiguedadPesos = 12*antiguedadTotal*salarioTopadoAntig;
  const pendientesPesos = Number(f.diasPendientes||0)*salarioDiario;
  // Salario Diario Integrado (Art. 84 LFT) — para la indemnización constitucional y los 20 días/año (Art. 89 LFT)
  // integra la parte proporcional diaria de aguinaldo (15 días/365) y prima vacacional (días vac. año en curso × 25%/365)
  const factorIntegracion = 1 + (15/365) + (diasVacCorresponden*0.25/365);
  const salarioIntegrado = salarioDiario*factorIntegracion;

  if(f.tipo==='aguinaldo'){
    items.push({label:`Aguinaldo proporcional (${diasAguinaldo} días trabajados del año / ${diasAnioCal} × 15 días · Art. 87 LFT)`, monto:aguinaldoPesos});
  } else if(f.tipo==='vacaciones'){
    items.push({label:`Vacaciones del año en curso (año ${anioServicioActual} de servicio: ${diasVacCorresponden} días × ${(fraccionAnio*100).toFixed(0)}% del año = ${vacDiasProp} días)`, monto:vacPropPesos});
    if(vacDiasPendAnteriores>0) items.push({label:`Vacaciones pendientes de años anteriores no disfrutadas (${vacDiasPendAnteriores} días)`, monto:vacDiasPendAnteriores*salarioDiario});
    items.push({label:'Prima vacacional (25% del total de vacaciones)', monto:primaVacPesos});
  } else if(f.tipo==='finiquito'){
    if(pendientesPesos>0) items.push({label:`Salarios pendientes (${f.diasPendientes} días)`, monto:pendientesPesos});
    items.push({label:`Aguinaldo proporcional (${diasAguinaldo} días del año / ${diasAnioCal} × 15 días · Art. 87 LFT)`, monto:aguinaldoPesos});
    items.push({label:`Vacaciones proporcionales del año en curso (${vacDiasProp} días)`, monto:vacPropPesos});
    if(vacDiasPendAnteriores>0) items.push({label:`Vacaciones pendientes de años anteriores no disfrutadas (${vacDiasPendAnteriores} días)`, monto:vacDiasPendAnteriores*salarioDiario});
    items.push({label:'Prima vacacional (25% del total de vacaciones)', monto:primaVacPesos});
    if(anios>=15) items.push({label:`Prima de antigüedad (12 días × ${antiguedadTotal.toFixed(1)} años, tope 2 salarios mín. — aplica por 15+ años de antigüedad)`, monto:primaAntiguedadPesos});
  } else if(f.tipo==='liquidacion'){
    const indem90 = 90*salarioIntegrado;
    const indem20 = 20*antiguedadTotal*salarioIntegrado;
    if(pendientesPesos>0) items.push({label:`Salarios pendientes (${f.diasPendientes} días)`, monto:pendientesPesos});
    items.push({label:`Indemnización constitucional (3 meses = 90 días × salario diario integrado, Art. 48 y 89 LFT)`, monto:indem90});
    /* Los 20 días por año (Art. 50-II) NO van en todo despido: aplican cuando el
       patrón queda eximido de reinstalar o cuando el trabajador rescinde. Por eso
       ahora es una casilla que administración prende o apaga en cada caso. */
    if(f.incluir20!==false) items.push({label:`20 días de salario integrado por año de servicio (${antiguedadTotal.toFixed(1)} años, Art. 50-II LFT)`, monto:indem20});
    items.push({label:`Prima de antigüedad (12 días × ${antiguedadTotal.toFixed(1)} años, tope 2 salarios mín.)`, monto:primaAntiguedadPesos});
    items.push({label:`Aguinaldo proporcional (${diasAguinaldo} días del año / ${diasAnioCal} × 15 días · Art. 87 LFT)`, monto:aguinaldoPesos});
    items.push({label:`Vacaciones proporcionales del año en curso (${vacDiasProp} días)`, monto:vacPropPesos});
    if(vacDiasPendAnteriores>0) items.push({label:`Vacaciones pendientes de años anteriores no disfrutadas (${vacDiasPendAnteriores} días)`, monto:vacDiasPendAnteriores*salarioDiario});
    items.push({label:'Prima vacacional (25% del total de vacaciones)', monto:primaVacPesos});
  }
  const total = items.reduce((s,i)=>s+i.monto,0);
  // Exención ISR de pagos por separación (Art. 93 fracc. XIII LISR): 90 UMA por año de servicio.
  // Fracción de antigüedad > 6 meses cuenta como año completo SOLO para este cálculo de exención.
  const aniosParaExencion = anios + (fraccionAnio>0.5 ? 1 : 0);
  const montoExentoISR = 90*UMA_2026*aniosParaExencion;
  let montoPagosSeparacion = 0;
  if(f.tipo==='liquidacion'){
    montoPagosSeparacion = (90*salarioIntegrado) + (f.incluir20!==false ? 20*antiguedadTotal*salarioIntegrado : 0) + primaAntiguedadPesos;
  } else if(f.tipo==='finiquito' && anios>=15){
    montoPagosSeparacion = primaAntiguedadPesos;
  }
  const {totalDias, diasEnAnioActual} = calcAntiguedad(ingreso, calculo);
  return {items, total, salarioDiario, salarioIntegrado, anios, fraccionAnio, error:false,
    montoExentoISR, montoPagosSeparacion, aniosParaExencion,
    totalDias, diasEnAnioActual, diasAguinaldo, diasAnioCal,
    vacDiasProp, vacDiasPendAnteriores, vacDiasTotal, diasVacCorresponden, anioServicioActual};
}
const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
/* La fecha de ingreso se guardaba sola al escoger día, mes y año, pero si
   faltaba uno de los tres no pasaba absolutamente nada y no lo decía: parecía
   que la app no servía y no había dónde apretar. Ahora la celda trae su propio
   botón Guardar y un aviso de qué falta. */
/* La fecha de ingreso SE VE aquí pero se CAPTURA en el expediente.
   Antes traía tres desplegables y su propio botón Guardar dentro de la celda:
   cuatro controles por renglón, multiplicados por toda la plantilla, hacían
   ilegible la tabla que se usa a diario. Aquí queda el dato —y el aviso de
   que falta, que es lo que uno viene a ver de un vistazo— y la captura vive
   junto a los demás papeles de la persona, que es donde se llena de una vez. */
function celdaFecha(e){
  if(!e.hire_date)
    return `<span class="flag cierre" style="margin:0">SIN FECHA</span>`;
  return `<span style="font-weight:700;white-space:nowrap">${
    new Date(e.hire_date+'T12:00').toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric'})}</span>`;
}
function dmySelect(field, isoValue, opts){
  opts = opts||{};
  const attrName = opts.attrName||'data-dmy';
  const compact = !!opts.compact;
  const disabled = opts.disabled?'disabled':'';
  const [y,m,d] = (isoValue||'').split('-').map(Number);
  const selStyle = compact
    ? 'min-height:40px;border:1.5px solid var(--line);border-radius:8px;padding:4px;background:var(--card);font-size:13px'
    : 'min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:6px;background:var(--card);font-size:15px';
  const dias = Array.from({length:31},(_,i)=>i+1);
  const anioActual = new Date().getFullYear();
  /* La fecha de ingreso no baja de 1970; la de NACIMIENTO sí — quien nació en
     1958 no podía capturarse y la lista de años ni siquiera lo insinuaba. */
  const desdeAnio = opts.desdeAnio || 1970;
  const anios = Array.from({length:anioActual-desdeAnio+2},(_,i)=>anioActual+1-i);
  return `<div style="display:flex;gap:6px;${compact?'min-width:220px':''}">
    <select ${attrName}="${field}" data-dmyp="d" ${disabled} style="${selStyle};flex:0 0 ${compact?'58px':'72px'}${disabled?';opacity:.65':''}"><option value="">Día</option>${dias.map(x=>`<option value="${x}" ${d===x?'selected':''}>${x}</option>`).join('')}</select>
    <select ${attrName}="${field}" data-dmyp="m" ${disabled} style="${selStyle};flex:1${disabled?';opacity:.65':''}"><option value="">Mes</option>${MESES_ES.map((nm,ix)=>`<option value="${ix+1}" ${m===ix+1?'selected':''}>${compact?nm.slice(0,3):nm}</option>`).join('')}</select>
    <select ${attrName}="${field}" data-dmyp="y" ${disabled} style="${selStyle};flex:0 0 ${compact?'74px':'90px'}${disabled?';opacity:.65':''}"><option value="">Año</option>${anios.map(x=>`<option value="${x}" ${y===x?'selected':''}>${x}</option>`).join('')}</select>
  </div>`;
}
function calcView(){
  const f = calcForm;
  const empLigado = f.empleadoId ? employees.find(e=>e.id===f.empleadoId) : null;
  if(empLigado){
    f.salario = empLigado.weekly_salary||0;
    f.salarioTipo = 'semanal';
    f.fechaIngreso = empLigado.hire_date||'';
  }
  const r = calcLiquidacion(f);
  const TIPOS = [['aguinaldo','Aguinaldo'],['vacaciones','Vacaciones + prima'],['finiquito','Finiquito (renuncia)'],['liquidacion','Liquidación (despido injustificado)']];
  /* Se puede filtrar por sucursal, pero la lista trae a los dos lados por
     defecto: administración calcula finiquitos de Guaymas y de San Carlos
     desde la misma pantalla. */
  /* Una sola entrada por persona: si está repetida en las dos sucursales o con
     el nombre mal escrito, se muestra el registro más completo y se indican las
     sucursales donde aparece. */
  const todosActivos = gruposDePersonas()
    .map(g=>{
      const jefe = g[0];
      const sucs = [...new Set(g.map(x=>LOCS[x.location_id]||'Itinerante'))].join(' y ');
      return Object.assign(Object.create(Object.getPrototypeOf(jefe)||Object.prototype), jefe, {__sucursales:sucs, __grupo:g});
    })
    .filter(e=>!f.locFiltro || e.__grupo.some(x=>String(x.location_id)===String(f.locFiltro)))
    .sort((a,b)=>a.name.localeCompare(b.name));
  let h = `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px">🧮 Calculadora de prestaciones (LFT)</div>
    <p class="hint">Estimación basada en la Ley Federal del Trabajo vigente. Para un caso real de despido o liquidación, confirma los montos con tu contador o abogado laboral antes de pagar — esta herramienta no sustituye asesoría legal. Muestra la exención de ISR sobre indemnización/prima de antigüedad, pero <b>no calcula la retención de ISR</b> sobre el excedente ni sobre aguinaldo/vacaciones — eso lo debe calcular tu contador con las tablas fiscales vigentes.</p>
  </div>`;
  h += `<div class="subnav" role="group" aria-label="Tipo de cálculo">
    ${TIPOS.map(([id,l])=>`<button aria-pressed="${f.tipo===id}" data-ct="${id}">${l}</button>`).join('')}
  </div>`;
  h += `<div class="panel">
    <div class="hint" style="font-weight:700">🔗 Vincular a un colaborador registrado</div>
    <p class="hint">Recomendado: al elegir a alguien de Equipo, su sueldo y fecha de ingreso se toman directo de su registro (no se pueden inventar), para que el cálculo siempre parta de datos reales ya guardados.</p>
    <div class="frm-row">
      <label>Sucursal <select id="calcLocSel" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:var(--card)">
        <option value="" ${!f.locFiltro?'selected':''}>Las dos sucursales</option>
        <option value="1" ${String(f.locFiltro)==='1'?'selected':''}>${esc(LOCS[1])}</option>
        <option value="2" ${String(f.locFiltro)==='2'?'selected':''}>${esc(LOCS[2])}</option>
      </select></label>
      <label>Colaborador <select id="calcEmpSel" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:var(--card)">
        <option value="">— Sin vincular (captura manual) —</option>
        ${todosActivos.map(e=>`<option value="${e.id}" ${f.empleadoId===e.id?'selected':''}>${esc(e.name)} · ${e.__sucursales||LOCS[e.location_id]||'Itinerante'} · ${money(e.weekly_salary||0)}/sem</option>`).join('')}
      </select></label>
    </div>
    ${!empLigado?`<div class="frm-row" style="margin-top:12px">
      <label>Nombre para el recibo (si no lo vinculaste) <input type="text" data-cfv="nombreManual" value="${esc(f.nombreManual||'')}" placeholder="Nombre completo"></label>
      <span></span>
    </div>`:''}
    ${empLigado && !empLigado.hire_date ? `<p class="hint" style="color:var(--red);font-weight:700;margin-top:8px">⚠ ${esc(empLigado.name)} no tiene fecha de ingreso guardada — ve a Equipo (plantilla) y captúrasela primero para un cálculo confiable.</p>` : ''}
  </div>`;
  h += `<div class="panel">
    <div class="frm-row-3">
      <label>Sueldo <input type="text" inputmode="decimal" class="nospin" data-cfv="salario" value="${f.salario||''}" placeholder="0" ${empLigado?'disabled style="opacity:.65"':''}></label>
      <label>Periodo del sueldo
        <select data-cfv="salarioTipo" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:var(--card)" ${empLigado?'disabled style="opacity:.65"':''}>
          <option value="diario" ${f.salarioTipo==='diario'?'selected':''}>Diario</option>
          <option value="semanal" ${f.salarioTipo==='semanal'?'selected':''}>Semanal</option>
          <option value="quincenal" ${f.salarioTipo==='quincenal'?'selected':''}>Quincenal</option>
          <option value="mensual" ${f.salarioTipo==='mensual'?'selected':''}>Mensual</option>
        </select></label>
      <span></span>
    </div>
    <div class="frm-row-3" style="margin-top:14px">
      <label>Fecha de ingreso ${dmySelect('fechaIngreso', f.fechaIngreso, {disabled:!!empLigado})}${empLigado?'<span class="hint">🔒 Tomada del registro de '+esc(empLigado.name)+'</span>':''}</label>
      <label>Fecha de ${f.tipo==='liquidacion'?'despido':(f.tipo==='finiquito'?'renuncia/salida':'cálculo')}
        ${(f.tipo==='finiquito'||f.tipo==='liquidacion')?`<span class="hint" style="font-weight:600;display:block;margin:-2px 0 4px">Último día de trabajo — ese día sí lo trabajó y cuenta; de ahí en adelante ya no.</span>`:''}
        ${dmySelect('fechaCalculo', f.fechaCalculo)}</label>
      ${(f.tipo==='finiquito'||f.tipo==='liquidacion')?`<label>Días de sueldo pendientes de pago <input type="number" min="0" step="0.5" data-cfv="diasPendientes" value="${f.diasPendientes||0}"></label>`:'<span></span>'}
    </div>
    <div class="frm-row-3" style="margin-top:14px">
      <label>Vacaciones pendientes de años anteriores (días ya ganados y no tomados, si los hay) <input type="number" min="0" step="0.5" data-cfv="vacPendientes" value="${f.vacPendientes||0}"></label>
      <span></span><span></span>
    </div>
    ${''/* Se quitó la casilla "ya se le pagó el aguinaldo": en Boye's el
           aguinaldo se paga completo en diciembre, así que lo que va en el
           finiquito es siempre lo proporcional de este año (del 1 de enero, o
           de su fecha de ingreso si entró después, al último día trabajado).
           Nunca se duplica. */}
    ${f.tipo==='liquidacion'?`<label style="flex-direction:row;align-items:flex-start;gap:8px;margin-top:14px;display:flex">
      <input type="checkbox" id="calcIncluir20" ${f.incluir20!==false?'checked':''} style="width:22px;height:22px;flex:none;margin-top:2px">
      <span>Incluir los <b>20 días de salario por año</b> (Art. 50-II LFT)<br>
        <span class="hint">No van en todo despido: aplican cuando el patrón queda eximido de reinstalar o cuando el trabajador rescinde. Muchos patrones los pagan de todos modos para cerrar el asunto. Consúltalo con tu abogado.</span></span>
    </label>`:''}
  </div>`;
  if(r.error){
    h += `<div class="empty"><b>Faltan datos</b>Completa sueldo y fechas para ver el cálculo.</div>`;
  } else {
    h += `<div class="sec"><h2>Desglose</h2></div>
      <div class="res-wrap"><table class="res"><thead><tr><th>Concepto</th><th>Monto</th></tr></thead><tbody>
      ${r.items.map(i=>`<tr><td style="text-align:left;white-space:normal;min-width:260px">${esc(i.label)}</td><td class="tot2">${money(i.monto)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>TOTAL ESTIMADO</td><td class="tot2">${money(r.total)}</td></tr></tfoot></table></div>
      <p class="hint" style="margin-top:8px">Antigüedad: ${r.anios} años y ${Math.round(r.fraccionAnio*365)} días · Salario diario: ${money(r.salarioDiario)}${f.salarioTipo!=='diario'?' (convertido)':''}${f.tipo==='liquidacion'?` · Salario diario integrado (Art. 84 LFT, usado en los 90 y 20 días): ${money(r.salarioIntegrado)}`:''}</p>`;
    if(r.montoPagosSeparacion>0){
      const dentro = r.montoPagosSeparacion<=r.montoExentoISR;
      h += `<div class="panel" style="margin-top:14px;border-left:4px solid ${dentro?'var(--ok)':'var(--warn)'}">
        <div class="hint" style="font-weight:800">💰 Exención de ISR sobre indemnización/prima de antigüedad (Art. 93-XIII LISR)</div>
        <p class="hint">Exento hasta 90 UMA por año de servicio (redondeado: fracción mayor a 6 meses cuenta como año completo). UMA 2026 = ${money(UMA_2026)}/día.</p>
        <p class="hint">Exención estimada: <b>${money(r.montoExentoISR)}</b> (90 × ${r.aniosParaExencion} año${r.aniosParaExencion===1?'':'s'} × UMA) — Monto de indemnización/prima de antigüedad: <b>${money(r.montoPagosSeparacion)}</b></p>
        <p class="hint" style="font-weight:700;color:${dentro?'var(--ok)':'var(--warn)'}">${dentro?'✓ Está dentro de la exención — esta parte normalmente no genera ISR.':'⚠ Excede la exención por '+money(r.montoPagosSeparacion-r.montoExentoISR)+' — ese excedente sí causa ISR (Art. 96 LISR, tasa efectiva sobre el último sueldo mensual). Pide a tu contador que calcule la retención exacta.'}</p>
        <p class="hint">El aguinaldo, las vacaciones y la prima vacacional NO entran en esta exención — se gravan aparte como sueldo ordinario.</p>
      </div>`;
    }
    const esSalida = f.tipo==='finiquito' || f.tipo==='liquidacion';
    const nombreTipo = f.tipo==='liquidacion' ? 'liquidación' : (f.tipo==='finiquito' ? 'finiquito' : f.tipo);
    /* Un solo botón: calcular, dar de baja e imprimir es un mismo trámite.
       Solo cuando no hay colaborador vinculado (captura manual) o el cálculo
       no es de salida, el botón se queda nada más con el recibo. */
    if(esSalida){
      h += `<div class="sec"><h2>Documentos para firma</h2></div>
      <div class="panel" style="border-left:4px solid var(--navy)">
        <div class="hint" style="font-weight:800">⚖️ Lo que de verdad protege ante una demanda</div>
        <p class="hint">Un finiquito firmado <b>en privado no cierra la puerta a un juicio</b>: sirve para acreditar
          lo que se pagó, nada más. Lo único que le da efecto de <b>cosa juzgada</b> es ratificarlo ante el
          <b>Centro de Conciliación Laboral del Estado de Sonora</b> (Art. 684-E fr. XIII LFT). El trámite es
          <b>gratuito</b>, hay sede en Guaymas y no necesitas abogado. Llévense los dos documentos, identificación
          oficial de ambos, y de ser posible paguen ahí mismo por transferencia.</p>
        <p class="hint">Tres fechas deben coincidir o el documento se cae solo: <b>la renuncia</b>, <b>el último día
          de nómina</b> y <b>la baja ante el IMSS</b> (dentro de 5 días hábiles).</p>
      </div>
      <div class="frm-row" style="margin-top:12px">
        <button type="button" class="btn-quiet" id="docRenuncia">🖨 Carta de renuncia</button>
        <button type="button" class="btn-quiet" id="docConvenio">🖨 Convenio y recibo de ${nombreTipo}</button>
      </div>
      <div class="frm-row" style="margin-top:8px">
        <button type="button" class="btn-quiet" id="docAmbos">🖨 Los dos documentos juntos</button>
        <span></span>
      </div>
      <p class="hint" style="margin-top:6px">Los documentos traen espacio para <b>firma, huella digital, identificación
        y dos testigos</b>. A propósito <b>no</b> incluyen la cláusula de "renuncio a todos mis derechos" (es nula por
        los Arts. 5º fr. XIII y 33 LFT y hace que el conciliador rechace el convenio) ni la frase "nunca laboré horas
        extras" (en un restaurante es inverosímil y le resta credibilidad a todo el escrito).</p>`;
    }
    if(esSalida && empLigado){
      h += `<div class="sec"><h2>Cerrar el proceso</h2></div>
      <div class="frm-row" style="margin-top:6px">
        <button type="button" class="btn-primary" id="calcBaja" data-calcbaja="${empLigado.id}" style="width:100%">
          🖨 Calcular ${nombreTipo}, dar de baja a ${esc(empLigado.name)} e imprimir recibo</button>
      </div>
      <p class="hint">Dar de baja <b>no borra nada</b>: el registro de ${esc(empLigado.name)}, su historial y las nóminas ya guardadas se quedan igual. Solo deja de aparecer en las nóminas semanales que vienen. Si regresa, se reactiva desde Equipo con el botón <i>Reactivar</i>.</p>`;
    } else {
      h += `<div class="frm-row" style="margin-top:16px">
        <button type="button" class="btn-primary" id="calcPrint" style="width:100%">🖨 ${esSalida?'Calcular '+nombreTipo+' e imprimir recibo':'Imprimir recibo'}</button>
      </div>`;
      if(esSalida) h += `<p class="hint" style="margin-top:10px">Para que además lo dé de baja, vincúlalo arriba en <b>Colaborador</b> (con captura manual no hay a quién dar de baja).</p>`;
    }
    h += `<p class="hint">El recibo sale con el nombre, las fechas, el desglose y la línea de firma. Revísalo con tu contador antes de que lo firme.</p>`;
  }
  return h;
}
/* ---------- recibo imprimible del finiquito ---------- */
const TIPO_TITULO = {aguinaldo:'RECIBO DE AGUINALDO', vacaciones:'RECIBO DE VACACIONES Y PRIMA VACACIONAL',
  finiquito:'RECIBO DE FINIQUITO', liquidacion:'RECIBO DE LIQUIDACIÓN'};
function fechaLarga(iso){
  if(!iso) return '—';
  const [y,m,d] = iso.split('-').map(Number);
  return `${d} de ${MESES_ES[m-1]} de ${y}`;
}
function finiquitoReceiptHtml(f, r, emp){
  const nombre = emp ? emp.name : (f.nombreManual||'').trim() || '__________________________';
  const suc = emp ? (LOCS[emp.location_id]||'Itinerante') : (f.sucursalManual||'');
  const hoy = fechaLarga(new Date().toISOString().slice(0,10));
  const esFin = f.tipo==='finiquito', esLiq = f.tipo==='liquidacion';
  let cuerpo = '';
  if(esFin){
    cuerpo = `<p>Manifiesto que <b>doy por terminada voluntariamente</b> la relación de trabajo y que no se me
      adeuda cantidad alguna por concepto de salarios devengados, horas extras, séptimos días, vacaciones,
      prima vacacional, prima de antigüedad, aguinaldo, ni por ningún otro concepto derivado de la Ley o de
      mi contrato individual de trabajo.</p>`;
  } else if(esLiq){
    cuerpo = `<p>Recibo el pago correspondiente a la <b>terminación de la relación de trabajo</b> por los
      conceptos que se detallan, y manifiesto que con ello quedan cubiertas las prestaciones a que tengo
      derecho conforme a la Ley Federal del Trabajo.</p>`;
  } else {
    cuerpo = `<p>Recibo el pago correspondiente a los conceptos que se detallan en este documento,
      conforme a la Ley Federal del Trabajo.</p>`;
  }
  return `<div class="rc">
    <div style="text-align:right;font-size:12px;margin-bottom:10px">Guaymas, Sonora, a ${hoy}</div>
    <h1>${TIPO_TITULO[f.tipo]||'RECIBO'}</h1>
    <div class="sub2">${esc(EMPRESA)}${suc?' · '+esc(suc):''}</div>
    <table>
      <tr><th style="width:38%">Colaborador</th><td>${esc(nombre)}</td></tr>
      <tr><th>Fecha de ingreso</th><td>${fechaLarga(f.fechaIngreso)}</td></tr>
      <tr><th>Fecha de ${esLiq?'separación':(esFin?'salida':'cálculo')}</th><td>${fechaLarga(f.fechaCalculo)}</td></tr>
      <tr><th>Antigüedad</th><td>${r.anios} año${r.anios===1?'':'s'} y ${r.diasEnAnioActual} días (${r.totalDias} días en total)</td></tr>
      <tr><th>Salario diario</th><td>${money(r.salarioDiario)}</td></tr>
    </table>
    <p style="font-size:12px;line-height:1.5">Recibí del <b>C. RODRIGO ZEÑA ZARAGOZA</b>, propietario y responsable
      de la fuente de trabajo denominada para efectos comerciales como <b>“${esc(PATRON_NEGOCIO)}”</b>, la cantidad de
      <b>${money(r.total)}</b> por los conceptos que se relacionan en este documento.</p>
    <div style="font-size:12px;line-height:1.5">${cuerpo}</div>
    <table>
      <tr><th>Concepto</th><th class="num" style="width:26%">Importe</th></tr>
      ${r.items.map(i=>`<tr><td style="font-size:12px">${esc(i.label)}</td><td class="num">${money(i.monto)}</td></tr>`).join('')}
      <tr class="total-row"><td>TOTAL</td><td class="num">${money(r.total)}</td></tr>
    </table>
    <p style="font-size:10.5px;color:#555;line-height:1.4">Cálculo conforme a la Ley Federal del Trabajo:
      aguinaldo Art. 87 · vacaciones Art. 76 · prima vacacional Art. 80${(esFin||esLiq)?' · prima de antigüedad Art. 162':''}${esLiq?' · indemnización Art. 48, 50 y 89':''}.
      Los importes se expresan en pesos mexicanos y no incluyen el cálculo de retención de ISR.</p>
    <div class="firma">${esc(nombre)}</div>
  </div>`;
}
function printFiniquito(){
  const f = calcForm;
  const emp = f.empleadoId ? employees.find(e=>e.id===f.empleadoId) : null;
  const r = calcLiquidacion(f);
  if(r.error){ toast('Faltan datos para imprimir'); return; }
  $('#printArea').innerHTML = finiquitoReceiptHtml(f, r, emp);
  window.print();
}
/* ================= DOCUMENTOS DE TERMINACIÓN LABORAL =================
   Redactados contra la LFT vigente (última reforma DOF 14-05-2026) y contra
   los criterios que en la práctica tumban un finiquito.

   Tres decisiones de fondo, a propósito:

   1) NO se incluye la cláusula de "renuncia a todos mis derechos y acciones".
      Es NULA de origen (Art. 5 fr. XIII y Art. 33 primer párrafo LFT): no
      protege de nada y, peor, un conciliador rechaza el convenio por traerla.

   2) NO se declara "nunca laboré horas extras ni domingos". En un restaurante
      esa frase es inverosímil, y si el patrón no exhibe controles de asistencia
      (Art. 804 fr. III LFT) le resta credibilidad a TODO el documento.

   3) SÍ se desglosa concepto por concepto, porque el Art. 987 segundo párrafo
      LFT lo EXIGE en todo convenio de terminación, y sí se dejan a salvo los
      derechos de PTU cuando el reparto aún no se determina.

   La protección de verdad no está en el papel: está en ratificarlo ante el
   Centro de Conciliación Laboral (Art. 684-E fr. XIII LFT), que es lo único
   que le da efecto de cosa juzgada. Eso se le recuerda en pantalla. */

const PATRON_NOMBRE = 'RODRIGO ZEÑA ZARAGOZA';
const PATRON_NEGOCIO = "BOYE'S - BURGER & PIZZA";

function _datosDoc(f, emp){
  const nombre = emp ? emp.name : ((f.nombreManual||'').trim() || '_______________________________');
  const suc = emp ? (LOCS[emp.location_id]||'Itinerante') : '';
  const puesto = emp ? (emp.position || etiquetaPuesto(emp.role)) : '_______________';
  return {nombre, suc, puesto, hoy: fechaLarga(new Date().toISOString().slice(0,10))};
}
function _piePruebas(nombre){
  /* Firma + huella + identificación + dos testigos. La jurisprudencia
     2024400 obliga al patrón a exhibir el ORIGINAL con elementos que reflejen
     voluntad y espontaneidad; la huella evita depender de una pericial
     grafoscópica si después se objeta la firma. */
  return `<div class="rc-firma-wrap">
    <div class="rc-firma" style="min-width:320px">
      <div class="rc-linea"></div>
      <div class="rc-nombre">${esc(nombre)}</div>
      <div class="rc-rol">Firma autógrafa</div>
    </div>
    <div class="doc-huella">
      <div class="doc-huella-caja">Huella digital<br>(pulgar derecho)</div>
      <div class="doc-ident">Identificación oficial: ____________________________ Folio: ______________</div>
    </div>
    <div class="rc-firmas-2" style="margin-top:26px">
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Testigo</div></div>
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Testigo</div></div>
    </div>
  </div>`;
}

/* ---------- 1. CARTA DE RENUNCIA ---------- */
function cartaRenunciaHtml(f, emp){
  const d = _datosDoc(f, emp);
  const salida = f.fechaCalculo ? fechaLarga(f.fechaCalculo) : '_______________________';
  const ingreso = f.fechaIngreso ? fechaLarga(f.fechaIngreso) : '_______________________';
  return `<div class="rc doc">
    <div class="doc-lugar">${esc(d.suc||'Guaymas')}, Sonora, a ${esc(d.hoy)}</div>
    <div class="doc-dest">
      <b>C. ${esc(PATRON_NOMBRE)}</b><br>
      Propietario y responsable de la fuente de trabajo denominada<br>
      para efectos comerciales como “${esc(PATRON_NEGOCIO)}”<br>
      <b>P R E S E N T E .-</b>
    </div>
    <div class="doc-cuerpo">
      <p>El que suscribe, <b>${esc(d.nombre)}</b>, quien se desempeñó como <b>${esc(d.puesto)}</b>
      en el centro de trabajo ubicado en ${esc(d.suc||'_______________')}, con fecha de ingreso del
      <b>${esc(ingreso)}</b>, por medio del presente escrito manifiesto lo siguiente:</p>

      <p><b>PRIMERO.</b> Que por así convenir a mis intereses personales, <b>renuncio de manera voluntaria,
      libre y espontánea</b> al empleo que venía desempeñando, siendo mi último día efectivamente laborado
      el <b>${esc(salida)}</b>, a partir del cual doy por terminada la relación de trabajo que me unía con usted.</p>

      <p><b>SEGUNDO.</b> Que la presente decisión la tomo sin que haya mediado despido, presión, coacción,
      violencia, engaño ni intimidación de ninguna especie por parte del patrón ni de persona alguna, y que
      la firmo el día de su fecha, con pleno conocimiento de su contenido y alcance.</p>

      <p><b>TERCERO.</b> Que solicito me sean cubiertas las prestaciones devengadas que conforme a la Ley
      Federal del Trabajo me correspondan a la fecha de terminación, las cuales se detallarán y liquidarán en
      el convenio y recibo de finiquito correspondiente.</p>

      <p>Agradezco la oportunidad y la atención que se me brindó durante el tiempo que presté mis servicios.</p>
    </div>
    <div class="doc-atte">A T E N T A M E N T E</div>
    ${_piePruebas(d.nombre)}
    <div class="rc-pie">La renuncia debe entregarse en original y conservarse por el patrón. Se recomienda
      ratificarla junto con el convenio de terminación ante el Centro de Conciliación Laboral del Estado de Sonora.</div>
  </div>`;
}

/* ---------- 2. CONVENIO Y RECIBO DE FINIQUITO ---------- */
function convenioFiniquitoHtml(f, r, emp){
  const d = _datosDoc(f, emp);
  const esLiq = f.tipo === 'liquidacion';
  const salida = f.fechaCalculo ? fechaLarga(f.fechaCalculo) : '_______________________';
  const ingreso = f.fechaIngreso ? fechaLarga(f.fechaIngreso) : '_______________________';
  const motivo = esLiq
    ? 'la terminación de la relación de trabajo por decisión del patrón'
    : 'la renuncia voluntaria presentada por escrito por la persona trabajadora';
  return `<div class="rc doc">
    ${encabezadoRecibo(esLiq?'Convenio de terminación y recibo de liquidación':'Convenio de terminación y recibo de finiquito',
       `${PATRON_NOMBRE} · “${PATRON_NEGOCIO}”`)}
    <div class="doc-lugar">${esc(d.suc||'Guaymas')}, Sonora, a ${esc(d.hoy)}</div>

    <table class="rc-datos">
      <tr><th>Persona trabajadora</th><td colspan="3">${esc(d.nombre)}</td></tr>
      <tr><th>Puesto</th><td>${esc(d.puesto)}</td><th>Centro de trabajo</th><td>${esc(d.suc||'—')}</td></tr>
      <tr><th>Fecha de ingreso</th><td>${esc(ingreso)}</td>
          <th>Último día laborado</th><td>${esc(salida)}</td></tr>
      <tr><th>Antigüedad</th><td>${r.anios} año${r.anios===1?'':'s'} y ${r.diasEnAnioActual} días</td>
          <th>Salario diario</th><td>${money(r.salarioDiario)}</td></tr>
    </table>

    <div class="doc-cuerpo">
      <p><b>RELACIÓN CIRCUNSTANCIADA DE LOS HECHOS</b> (Art. 33, segundo párrafo, LFT). Las partes
      manifiestan que entre ellas existió una relación de trabajo que inició el ${esc(ingreso)} y concluyó el
      ${esc(salida)}, desempeñando la persona trabajadora el puesto de ${esc(d.puesto)} en el centro de
      trabajo señalado, siendo la causa de terminación ${esc(motivo)}. Con motivo de dicha terminación, el
      patrón cubre en este acto las prestaciones devengadas que se desglosan a continuación.</p>
    </div>

    <table class="rc-mov">
      <thead><tr><th>Concepto y fundamento</th><th class="num" style="width:24%">Importe</th></tr></thead>
      <tbody>${r.items.map(i=>`<tr><td>${esc(i.label)}</td><td class="num">${money(i.monto)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="total-row"><td>TOTAL QUE SE ENTREGA</td><td class="num">${money(r.total)}</td></tr></tfoot>
    </table>
    <div class="rc-letra"><b>Cantidad con letra:</b> ${esc(numeroALetras(r.total))}</div>

    <div class="doc-cuerpo">
      <p><b>PRIMERA. Pago.</b> La persona trabajadora <b>recibe en este acto</b> del C. ${esc(PATRON_NOMBRE)},
      propietario y responsable de la fuente de trabajo denominada para efectos comerciales como
      “${esc(PATRON_NEGOCIO)}”, la cantidad de <b>${money(r.total)}</b>, desglosada concepto por concepto en
      el cuadro que antecede, conforme lo exige el artículo 987, segundo párrafo, de la Ley Federal del
      Trabajo, quedando así cubiertas las prestaciones devengadas hasta el último día laborado.</p>

      <p><b>SEGUNDA. Conceptos cubiertos.</b> Las partes reconocen que el pago anterior comprende los
      salarios devengados, las vacaciones proporcionales (Arts. 76 y 79 LFT), la prima vacacional del
      veinticinco por ciento (Art. 80 LFT) y el aguinaldo proporcional (Art. 87 LFT)${r.anios>=15?', así como la prima de antigüedad a razón de doce días de salario por año de servicios (Art. 162 LFT)':''}${esLiq?', además de la indemnización constitucional (Arts. 48 y 89 LFT)':''}, correspondientes al periodo trabajado.</p>

      <p><b>TERCERA. Salario integrado.</b> Las partes reconocen que el salario semanal que percibió la
      persona trabajadora durante la relación laboral comprendía el pago del día de descanso semanal o
      séptimo día (Arts. 69 y 71 LFT), la prima dominical (Art. 71 LFT) y los días de descanso obligatorio
      (Arts. 74 y 75 LFT), los cuales le fueron cubiertos en cada periodo de pago mediante los recibos de
      nómina firmados que obran en poder del patrón.</p>

      <p><b>CUARTA. Participación de utilidades.</b> En caso de que a la fecha de este convenio no se haya
      determinado el reparto individual de utilidades del ejercicio en curso, <b>se dejan a salvo los derechos
      de la persona trabajadora</b> para recibir la parte proporcional que le corresponda, conforme al artículo
      987, segundo párrafo, de la Ley Federal del Trabajo.</p>

      <p><b>QUINTA. Seguridad social.</b> El patrón se obliga a presentar el aviso de baja ante el Instituto
      Mexicano del Seguro Social con fecha ${esc(salida)}, dentro del plazo de cinco días hábiles previsto en
      la Ley del Seguro Social, quedando a salvo los derechos de seguridad social que la persona trabajadora
      haya generado.</p>

      <p><b>SEXTA. Conformidad.</b> La persona trabajadora manifiesta que recibió la cantidad señalada a su
      entera satisfacción, que le fue explicado el desglose de cada concepto y que está de acuerdo con los
      importes; y otorga por este medio el finiquito más amplio que en derecho proceda respecto de las
      prestaciones aquí desglosadas y del periodo señalado. Las partes reconocen expresamente que este
      convenio <b>no implica renuncia de derechos</b> de la persona trabajadora, en términos de los artículos
      5º fracción XIII y 33 de la Ley Federal del Trabajo.</p>

      <p><b>SÉPTIMA. Ratificación.</b> Las partes convienen en presentar este documento para su aprobación y
      ratificación ante el Centro de Conciliación Laboral del Estado de Sonora, en términos de los artículos
      33 y 987 de la Ley Federal del Trabajo, a efecto de que surta los efectos legales correspondientes.</p>
    </div>

    <div class="doc-firmas-conv">
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-nombre">${esc(d.nombre)}</div>
        <div class="rc-rol">Persona trabajadora — recibe de conformidad</div></div>
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-nombre">${esc(PATRON_NOMBRE)}</div>
        <div class="rc-rol">Patrón</div></div>
    </div>
    <div class="doc-huella">
      <div class="doc-huella-caja">Huella digital<br>(pulgar derecho)</div>
      <div class="doc-ident">Identificación oficial: ____________________________ Folio: ______________<br>
        Forma de pago: ☐ Transferencia   ☐ Efectivo   Referencia: ____________________</div>
    </div>
    <div class="rc-firmas-2" style="margin-top:22px">
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Testigo</div></div>
      <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Testigo</div></div>
    </div>
    <div class="rc-pie">Este convenio adquiere el carácter de cosa juzgada únicamente una vez ratificado ante el
      Centro de Conciliación Laboral (Art. 684-E fracción XIII LFT). Documento interno; no sustituye al CFDI de nómina.</div>
  </div>`;
}
function printDocLegal(cual){
  const f = calcForm;
  const emp = f.empleadoId ? employees.find(e=>e.id===f.empleadoId) : null;
  const r = calcLiquidacion(f);
  if(r.error){ toast('Faltan datos: captura sueldo y fechas'); return; }
  const html = cual==='renuncia' ? cartaRenunciaHtml(f, emp)
             : cual==='convenio' ? convenioFiniquitoHtml(f, r, emp)
             : cartaRenunciaHtml(f, emp) + convenioFiniquitoHtml(f, r, emp);
  $('#printArea').innerHTML = html;
  const img = $('#printArea').querySelector('.rc-logo');
  if(img && !img.complete){ img.onload = ()=>window.print(); img.onerror = ()=>window.print(); setTimeout(()=>window.print(), 1500); }
  else window.print();
}

/* ---------- Herramientas ---------- */
function herrView(){
  let h = `<div class="mode-tabs" role="group" aria-label="Herramientas">
    <button aria-pressed="${herrSub==='calc'}" data-hs="calc">🧮 Calculadora</button>
    <button aria-pressed="${herrSub==='hor'}" data-hs="hor">📅 Horario</button>
    <button aria-pressed="${herrSub==='fmt'}" data-hs="fmt">📄 Formatos</button>
  </div>`;
  if(herrSub==='hor'){
    if(schData===null) return h + locSwitch(finLoc,'floc') + `<div class="empty"><b>Cargando horario…</b></div>`;
    return h + schView();
  }
  /* Formatos se mudó aquí desde la fila de Finanzas: cotizar a un cliente y
     comparar proveedores son herramientas, no un movimiento de dinero. */
  if(herrSub==='fmt'){
    h += `<div class="subnav" role="group" aria-label="Formatos" style="margin-bottom:10px">
      <button aria-pressed="${fmtSub==='cot'}" data-fmtsub="cot">Cotización a cliente</button>
      <button aria-pressed="${fmtSub==='prv'}" data-fmtsub="prv">Comparar proveedores</button></div>`;
    return h + (fmtSub==='prv' ? prvView() : cotView());
  }
  h += `<div class="panel">
    <div class="hint" style="font-weight:800;font-size:15px">🧰 Calculadora de prestaciones</div>
    <p class="hint">Finiquitos, aguinaldos y vacaciones para Guaymas y San Carlos, ligados al registro de colaboradores.</p>
  </div>`;
  h += calcView();
  return h;
}
function chkView(){
  if(payData?.saved && !payCalc){
    const items = payData.items||[];
    const yaEnLista = new Set(items.map(i=>i.employee_id));
    const faltantes = employees.filter(e=>e.location_id===finLoc && e.active && !yaEnLista.has(e.id));
    const tot = items.reduce((s,i)=>s+Number(i.base||0)+Number(i.extras||0)-Number(i.deductions||0),0);
    let h = `<div class="panel"><div class="hint" style="font-weight:700">Nómina guardada de esta semana</div>`;
    h += `<div class="res-wrap"><table class="res"><thead><tr><th>Empleado</th><th>Horas</th><th>H. Extra</th><th>Sueldo</th><th>Extras</th><th>Deducciones</th><th>Total</th></tr></thead><tbody>`;
    for(const i of items){
      h += `<tr><td>${esc(i.name)}</td><td>${i.hours??'—'}</td><td>${i.extra_hours??'—'}</td>
        <td>${money(i.base)}</td><td>${money(i.extras)}</td><td>${money(i.deductions)}</td>
        <td class="tot2">${money(Number(i.base)+Number(i.extras)-Number(i.deductions))}</td></tr>`;
    }
    h += `</tbody><tfoot><tr><td colspan="6">Total nómina</td><td class="tot2">${money(tot)}</td></tr></tfoot></table></div>`;
    /* Los renglones que la app metía sola traen horas en blanco y ni extras ni
       deducciones: nadie los tocó. Se pueden quitar sin perder captura real. */
    const sinHoras = items.filter(i=>(i.hours===null||i.hours===undefined)
      && !Number(i.extras) && !Number(i.deductions));
    if(sinHoras.length){
      const deMas = sinHoras.reduce((s,i)=>s+Number(i.base||0),0);
      h += `<div class="panel" style="border-left:4px solid var(--warn);background:#FFF9EC;margin-top:14px">
        <div style="font-weight:800;color:var(--warn);margin-bottom:6px">⚠️ ${sinHoras.length} personas sin horas están sumando ${money(deMas)}</div>
        <p class="hint">No aparecieron en el checador de esta semana ni se les capturaron horas a mano: la app las agregaba sola con su sueldo completo. Ese error ya está corregido, pero esta nómina se guardó antes.</p>
        <p class="hint" style="margin-top:6px">${sinHoras.map(i=>esc(i.name)).join(' · ')}</p>
        <button class="btn-primary" id="limpiaNom" style="width:100%;margin-top:10px">Quitarlas — la nómina queda en ${money(tot-deMas)}</button></div>`;
    }
    h += `<div class="frm-row"><button class="btn-quiet" id="printSaved">🖨 Recibos individuales</button>
      <button class="btn-quiet" id="printSavedSolo">🖨 Concentrado de la semana</button></div>
    <div class="frm-row" style="margin-top:8px"><button class="btn-quiet" id="printSavedTotal">🖨 Concentrado + todos los recibos</button>
      <span></span></div>
    <p class="hint" style="margin-top:6px">El <b>concentrado</b> es una hoja con los ${items.length} colaboradores y el total de la semana (${money(tot)}), con espacio para firma de quien elabora y quien autoriza. Los <b>recibos individuales</b> son uno por persona, para que cada quien firme el suyo.</p>
    <div class="frm-row" style="margin-top:10px"><button class="btn-quiet" id="redoChk">Procesar de nuevo</button>
      <button class="btn-quiet" id="openMan2">Ajustar horas</button></div>`;
    if(faltantes.length){
      h += `<div class="panel" style="margin-top:14px">
        <div class="hint" style="font-weight:700">Falta alguien de Equipo en esta nómina</div>
        <p class="hint">Se agrega y se guarda de inmediato con su sueldo base; luego dale "Ajustar manual" si necesitas cambiarle horas/extras.</p>
        <div class="frm-row">
          <label>Persona <select id="addSavedSel" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:var(--card)">
            ${faltantes.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}
          </select></label>
          <button type="button" class="btn-quiet" id="addSavedBtn" style="align-self:end">+ Agregar y guardar</button>
        </div>
      </div>`;
    }
    h += `</div>`;
    return h;
  }
  if(!payCalc){
    return `<div class="panel">
      <label>Pega aquí el reporte del checador (copia las columnas desde la hoja y pégalo tal cual)
        <textarea class="paste-box" id="pasteBox" placeholder="notrab	nombre	fecha	ent	sal ..."></textarea></label>
      <div class="frm-row"><button type="button" class="btn-quiet" data-paste="pasteBox">Pegar del portapapeles</button><button type="button" class="btn-quiet" data-pick="pasteBox">Elegir archivo (Excel, CSV, PDF)</button></div><button class="btn-primary" id="procBtn" style="width:100%">Procesar reporte</button>
      <button type="button" class="btn-quiet" id="openMan" style="width:100%">\u00bfSemana sin checador? Capturar n\u00f3mina manual</button>
      <p class="hint">Reglas: tarifa/hora = sueldo semanal ÷ 56 · pago base topado a 48 h · 7º día = pago base ÷ 6 · extras sobre 48 h · salida faltante se marca en amarillo para capturarla a mano · salidas 23:59 en viernes/sábado se marcan para sumar +1 h si salió a la 01:00.</p>
    </div>`;
  }
  let h = '';
  h += `<div class="panel">
    <div class="hint" style="font-weight:700">¿Falta alguien que no salió en el checador?</div>
    <p class="hint">Agrégalo aquí para esta nómina — si ya está dado de alta en Equipo se precarga su sueldo, si es nuevo lo creamos y le asignas sueldo abajo.</p>
    <div class="frm-row">
      <label>Nombre completo <input type="text" id="addEmpName" placeholder="Como debe aparecer en el recibo"></label>
      <button type="button" class="btn-quiet" id="addEmpBtn" style="align-self:end">+ Agregar a esta nómina</button>
    </div>
  </div>`;
  const missing = payCalc.emps.filter(e=>e.base===null);
  if(missing.length){
    h += `<div class="panel"><div class="hint" style="font-weight:700;color:var(--red)">Empleados nuevos — asigna su sueldo semanal para continuar</div>`;
    h += missing.map((e,ix)=>`<div class="frm-row">
      <label>${esc(e.name)} <span class="flag nuevo">NUEVO</span><input type="number" inputmode="decimal" step="0.01" min="0" data-newsal="${payCalc.emps.indexOf(e)}" placeholder="Sueldo semanal MXN"></label>
      <label>Puesto <input type="text" data-newpos="${payCalc.emps.indexOf(e)}" placeholder="(opcional)"></label></div>`).join('');
    h += `<button class="btn-primary" id="saveNewEmps" style="width:100%">Guardar empleados nuevos</button></div>`;
  }
  const sinOut = [];
  for(const e of payCalc.emps){ for(const d of e.days){ if(d.flags.includes('auto')) sinOut.push(`${esc(e.name.split(' ')[0])} (${esc(d.dia)})`); } }
  if(sinOut.length){
    h += `<div class="alarm-banner" role="alert" style="position:static">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>Sin clock out (${sinOut.length}): ${sinOut.join(', ')} \u2014 ajusta la salida manual en los renglones marcados</span>
    </div>`;
  }
  h += `<div class="emp-scroll">`;
  for(const [ix,e] of payCalc.emps.entries()){
    const c = calcEmp(e);
    h += `<div class="emp-card"><div class="hd">
      <span class="nm2">${esc(e.name)}${e.manual?'<span class="flag nuevo" style="background:#E3ECFB;color:#2B5AA7">MANUAL</span>':''}${e.base===null?'<span class="flag nuevo">SIN SUELDO</span>':''}</span>
      <span class="hrs">${c.totalH} h</span></div>`;
    if(e.manual){
      h += `<p class="hint" style="margin:0 0 10px">No sale en el checador — captura sus horas en el campo "+Horas" de la tabla de abajo.</p>`;
    } else {
      h += `<div style="overflow-x:auto"><table class="days"><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Horas</th><th></th></tr></thead><tbody>`;
      for(const [di,d] of e.days.entries()){
        h += `<tr${d.flags.includes('auto')?' style="background:#FFF3D6"':''}><td>${esc(d.dia)}
            ${d.flags.includes('auto')?'<span class="flag auto">SIN SALIDA</span>':''}
            ${d.flags.includes('cierre')?(d.plus1?'<span class="flag auto">+1 H CIERRE</span>':'<span class="flag cierre">VIE/SÁB \u00bf+1h?</span>'):''}
            ${d.flags.includes('falta')?'<span class="flag falta">FALTA</span>':''}</td>
          <td>${d.ent||'—'}</td><td>${d.ent?`<input type="time" value="${d.sal||''}" data-se="${ix}" data-sd="${di}" aria-label="Salida ${esc(e.name)} ${esc(d.dia)}" style="min-height:40px;border:1.5px solid ${d.flags.includes('auto')?'var(--warn)':'var(--line)'};${d.flags.includes('auto')?'box-shadow:0 0 0 2px rgba(179,84,30,.25);':''}border-radius:8px;padding:4px 6px;background:#FBFAF7;font-size:14px">`:'—'}</td>
          <td style="font-variant-numeric:tabular-nums;font-weight:700">${d.hours.toFixed(2)}</td>
          <td>${d.flags.includes('cierre')?`<button class="plus1" data-p1e="${ix}" data-p1d="${di}">${d.plus1?'\u2212 1 h':'+1 h'}</button>`:''}</td></tr>`;
      }
      h += `</tbody></table></div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;
  h += `<div class="sec"><h2>Resultados</h2></div>`;
  /* Un festivo en la semana no se puede quedar callado: la casilla existe
     desde siempre y no se ha marcado UNA sola vez en diez semanas de nómina
     guardada. Si nadie lo dice, nadie se acuerda. */
  {
    const fF = festivoDeLaSemana();
    if(fF){
      const conHoras = payCalc.emps.filter(e=>(e.days||[]).some(d=>d.fecha===fF && Number(d.hours||0)>0));
      const yaMarcados = payCalc.emps.filter(e=>e.festivo).length;
      h += `<div class="panel" style="border-left:4px solid var(--warn);background:#FFF9EC">
        <div style="font-weight:800;color:var(--warn)">📅 Esta semana cae el ${esc(festivoNombre(fF))} — día de descanso obligatorio</div>
        <p class="hint" style="margin:4px 0 0">Marca la casilla <b>Festivo</b> de quien lo haya trabajado: se le paga
          <b>otra vez lo que generó ese día</b>, así que ese día le sale al doble.
          ${conHoras.length
            ? `Según el checador lo trabajaron <b>${conHoras.length}</b>: ${conHoras.map(e=>esc(e.name)).join(' · ')}.`
            : 'El checador no muestra horas de nadie ese día.'}
          ${yaMarcados ? `Van <b>${yaMarcados}</b> marcado${yaMarcados===1?'':'s'}.`
                       : '<b style="color:var(--red)">Todavía no hay ninguno marcado.</b>'}</p></div>`;
    }
  }
  h += `<div class="res-wrap"><table class="res"><thead><tr>
    <th>Empleado</th><th>Base sem.</th><th>Horas</th><th>+Horas</th><th>H. Extra</th><th>Pago Base</th><th>7º Día</th><th>Festivo</th><th>Extras</th><th>Bonos</th><th>Desc.</th><th>Total</th></tr></thead><tbody>`;
  let gtot = 0;
  for(const [ix,e] of payCalc.emps.entries()){
    const c = calcEmp(e); gtot += e.base===null?0:c.total;
    h += `<tr><td>${esc(e.name)}</td><td>${e.base===null?'—':money(e.base)}</td><td>${c.hrs}</td>
      <td><input type="number" step="1" value="${e.added}" data-fld="added" data-eix="${ix}" aria-label="Horas añadidas ${esc(e.name)}"></td>
      <td>${c.extraH}</td><td>${money(c.pagoBase)}</td><td>${money(c.septimo)}</td>
      <td><input type="checkbox" ${e.festivo?'checked':''} data-fld="festivo" data-eix="${ix}" aria-label="Festivo ${esc(e.name)}"></td>
      <td>${money(c.extras)}</td>
      <td><input type="number" step="0.01" min="0" value="${e.bonos}" data-fld="bonos" data-eix="${ix}" aria-label="Bonos ${esc(e.name)}"></td>
      <td><input type="number" step="0.01" min="0" value="${e.descuentos}" data-fld="descuentos" data-eix="${ix}" aria-label="Descuentos ${esc(e.name)}"></td>
      <td class="tot2">${e.base===null?'—':money(c.total)}</td></tr>`;
  }
  h += `</tbody><tfoot><tr><td colspan="11">Total nómina</td><td class="tot2">${money(gtot)}</td></tr></tfoot></table></div>`;
  h += `<div class="frm-row">
    <button class="btn-primary" id="saveCalc">Guardar nómina</button>
    <button class="btn-quiet" id="printCalc">🖨 Recibos individuales</button></div>
    <div class="frm-row" style="margin-top:10px"><button class="btn-quiet" id="printCalcTotal">🖨 Concentrado de la semana</button>
      <button class="btn-quiet" id="cancelCalc">Descartar y pegar de nuevo</button></div>
    <p class="hint" style="margin-top:10px">Al guardar, el total se registra como egreso de nómina en Movimientos.</p>`;
  return h;
}
function manView(){
  const items = payData?.items||[];
  let html = `<div class="frm-row" style="margin-bottom:12px"><button class="btn-quiet" id="closeMan">\u2190 Volver al checador</button><span class="hint" style="align-self:center">Captura manual de esta semana (sin reporte del checador)</span></div>`;
  const yaEnLista = new Set(items.map(i=>i.employee_id));
  const faltantes = employees.filter(e=>e.location_id===finLoc && e.active && !yaEnLista.has(e.id));
  if(faltantes.length){
    html += `<div class="panel">
      <div class="hint" style="font-weight:700">Falta alguien de Equipo en esta lista</div>
      <p class="hint">Si diste de alta a alguien después de guardar esta nómina, agrégalo aquí manualmente.</p>
      <div class="frm-row">
        <label>Persona <select id="addManSel" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:var(--card)">
          ${faltantes.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}
        </select></label>
        <button type="button" class="btn-quiet" id="addManBtn" style="align-self:end">+ Agregar a la lista</button>
      </div>
    </div>`;
  }
  if(!items.length){
    html += `<div class="empty"><b>Sin empleados en ${LOCS[finLoc]}</b>Da de alta al equipo en la pesta\u00f1a "Equipo (plantilla)".</div>`;
    return html;
  }
  let tot=0;
  html += `<div class="pay-wrap"><table class="pay"><thead><tr>
    <th>Empleado</th><th>Base</th><th>Extras</th><th>Deducciones</th><th style="text-align:right">Total</th></tr></thead><tbody>`;
  items.forEach((it,i)=>{
    const t = Number(it.base||0)+Number(it.extras||0)-Number(it.deductions||0); tot+=t;
    html += `<tr>
      <td><div class="nm">${esc(it.name)}</div><div class="ps">${esc(it.position||'')}</div></td>
      <td><input type="number" inputmode="decimal" step="0.01" min="0" data-pay="${i}" data-f="base" value="${it.base??0}" aria-label="Base ${esc(it.name)}"></td>
      <td><input type="number" inputmode="decimal" step="0.01" min="0" data-pay="${i}" data-f="extras" value="${it.extras??0}" aria-label="Extras ${esc(it.name)}"></td>
      <td><input type="number" inputmode="decimal" step="0.01" min="0" data-pay="${i}" data-f="deductions" value="${it.deductions??0}" aria-label="Deducciones ${esc(it.name)}"></td>
      <td class="tot">${money(t)}</td></tr>`;
  });
  html += `</tbody><tfoot><tr><td colspan="4">Total n\u00f3mina</td><td class="tot">${money(tot)}</td></tr></tfoot></table></div>`;
  html += `<button class="btn-primary" id="savePay" style="width:100%;margin-bottom:16px">${payData?.saved?'Actualizar n\u00f3mina':'Guardar n\u00f3mina'}</button>
  <p class="hint">La base se precarga desde la plantilla maestra (pesta\u00f1a Equipo). Cambios aqu\u00ed aplican solo a esta semana.</p>`;
  return html;
}
/* ============================================================
   Personas repetidas en la plantilla
   ------------------------------------------------------------
   La misma persona quedó dada de alta en las dos sucursales, y a
   veces con el nombre mal escrito ("ERIIK" / "ERIK"). Salía dos
   veces en la nómina y en la calculadora.

   Se comparan los nombres por parecido (distancia de edición). Del
   80% para arriba se tratan como la misma persona. Debajo de eso
   solo se sugiere, nunca se une solo: apellidos iguales entre
   hermanos dan parecidos altos y unir por error borraría a alguien
   de la nómina.
   ============================================================ */
const claveNombre = n => (n||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^A-Z0-9]+/g,' ').trim();
function distanciaTexto(a,b){
  if(a===b) return 0;
  const m=a.length, n=b.length;
  if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,j)=>j), cur=new Array(n+1);
  for(let i=1;i<=m;i++){
    cur[0]=i;
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
    [prev,cur]=[cur,prev];
  }
  return prev[n];
}
function similitudNombre(a,b){
  const x=claveNombre(a), y=claveNombre(b);
  if(!x||!y) return 0;
  return 1 - distanciaTexto(x,y)/Math.max(x.length,y.length);
}
const UMBRAL_UNIR = 0.80, UMBRAL_DUDA = 0.65;
/* Qué tan completo está un registro: el más completo es el que se queda. */
function puntajeRegistro(e){
  return (e.hire_date?4:0) + (Number(e.weekly_salary)>0?2:0) + (e.position?1:0) + (e.area?1:0)
       + Math.min(2, (e.name||'').length/40);
}
function gruposDePersonas(umbral){
  const act = employees.filter(e=>e.active);
  const usados = new Set(), grupos = [];
  for(const e of act){
    if(usados.has(e.id)) continue;
    const grupo = [e]; usados.add(e.id);
    for(const o of act){
      if(usados.has(o.id)) continue;
      if(grupo.some(g=>similitudNombre(g.name, o.name) >= (umbral||UMBRAL_UNIR))){ grupo.push(o); usados.add(o.id); }
    }
    grupo.sort((a,b)=>puntajeRegistro(b)-puntajeRegistro(a));
    grupos.push(grupo);
  }
  return grupos;
}
/* Sólo los grupos con más de un registro: esos son los repetidos. */
const personasRepetidas = () => gruposDePersonas(UMBRAL_UNIR).filter(g=>g.length>1);
/* Parecidos flojos que NO se unen solos, únicamente se avisan. */
/* Un nombre corto metido dentro de uno largo — "ADRIAN" y "ADRIAN MONGE" —
   se parece apenas 50% por letras, así que se colaba sin que nadie lo viera,
   aunque casi siempre es la misma persona capturada a las carreras. No se unen
   solas (podrían ser dos hermanos), pero sí se avisan. */
function unNombreDentroDelOtro(a, b){
  const pa = claveNombre(a).split(' ').filter(w=>w.length>=3);
  const pb = claveNombre(b).split(' ').filter(w=>w.length>=3);
  if(!pa.length || !pb.length || pa.length===pb.length) return false;
  const [corto, largo] = pa.length < pb.length ? [pa,pb] : [pb,pa];
  return corto.every(w=>largo.includes(w));
}
/* Parejas que ya se revisaron y NO son la misma persona. Viven en la base y no
   en este navegador: el aviso lo ve también quien lleva la nómina, y que a ella
   le siga saliendo lo que él ya descartó es la forma más segura de que los dos
   dejen de leerlo. null = todavía no se han pedido. */
let noDup = null, noDupPidiendo = false;
const noDupClave = (x, y) => [x, y].sort().join('|');
async function noDupCarga(){
  if(noDup !== null || noDupPidiendo) return;
  noDupPidiendo = true;
  try{
    const r = await finRpc('fin_no_dup_list', {});
    noDup = new Set((r||[]).map(p=>noDupClave(p[0], p[1])));
  }catch(e){ noDup = new Set(); }
  finally{ noDupPidiendo = false; }
  render();
}
function posiblesRepetidos(){
  if(noDup === null) noDupCarga();
  const act = employees.filter(e=>e.active), pares = [], vistos = new Set();
  for(let i=0;i<act.length;i++) for(let j=i+1;j<act.length;j++){
    let s = similitudNombre(act[i].name, act[j].name);
    if(s < UMBRAL_DUDA && unNombreDentroDelOtro(act[i].name, act[j].name)) s = UMBRAL_DUDA;
    if(s<UMBRAL_DUDA || s>=UMBRAL_UNIR) continue;
    /* Si alguien está repetido en las dos sucursales, el mismo par de nombres
       salía dos y tres veces en el aviso. Se muestra una sola vez. */
    const par = [claveNombre(act[i].name), claveNombre(act[j].name)].sort().join('|');
    if(vistos.has(par)) continue;
    vistos.add(par);
    if(noDup && noDup.has(noDupClave(act[i].id, act[j].id))) continue;
    pares.push({a:act[i], b:act[j], s});
  }
  return pares.sort((x,y)=>y.s-x.s);
}
const idsRepetidos = () => new Set(personasRepetidas().flat().map(e=>e.id));
/* Un solo campo de Puesto: antes había "Área", "Rol" y "Puesto" por separado y
   se capturaba lo mismo tres veces. El valor se guarda en rol y en puesto para
   que los recibos impresos lo sigan mostrando. */
const PUESTOS = [
  ['empleado','Empleado'], ['mesero','Mesero'], ['cocinero','Cocinero'],
  ['chef','Chef'], ['subchef','Sub-chef'], ['administracion','Administración'],
  ['subencargado','Sub-encargado'], ['encargado','Encargado'], ['gerente','Gerente']
];
const etiquetaPuesto = v => (PUESTOS.find(p=>p[0]===v)||PUESTOS[0])[1];

/* ============================================================
   EXPEDIENTE DEL COLABORADOR
   ------------------------------------------------------------
   Los datos que un expediente laboral necesita y que la tabla de
   sueldos no tenía dónde guardar. Van detrás de un botón a
   propósito: el sueldo y la fecha de ingreso se tocan seguido,
   el expediente se captura una vez por persona. Meterlos como
   ocho columnas más habría vuelto ilegible la tabla que sí se
   usa todos los días.

   Dónde viven: en la misma ficha del empleado, en columnas
   propias. La tabla tiene RLS prendida y CERO políticas, así que
   la llave pública del navegador no puede leerla — todo pasa por
   las funciones con token. Eso no se toca: aquí hay CURP, RFC y
   domicilio de gente real.
   ============================================================ */
const EXP_CAMPOS = [
  {k:'hire_date',         t:'Fecha de ingreso',         fecha:true, desde:1990},
  {k:'direccion',         t:'Domicilio',                ancho:true, ph:'Calle y número, colonia, ciudad'},
  {k:'fecha_nac',         t:'Fecha de nacimiento',      fecha:true, desde:1940},
  {k:'curp',              t:'CURP',                     mayus:true, largo:18, ph:'18 caracteres'},
  {k:'rfc',               t:'RFC',                      mayus:true, largo:13, ph:'13 caracteres'},
  {k:'nss',               t:'Núm. de seguro social',    soloNum:true, largo:11, ph:'11 dígitos'},
  {k:'telefono',          t:'Celular',                  soloNum:true, largo:15, ph:'10 dígitos'},
  {k:'emergencia_nombre', t:'Contacto de emergencia',   ph:'Nombre y parentesco'},
  {k:'emergencia_tel',    t:'Teléfono de emergencia',   soloNum:true, largo:15, ph:'10 dígitos'}
];
const expLleno = e => EXP_CAMPOS.filter(c=>String(e[c.k]||'').trim()).length;

/* Qué se ve mal SIN bloquear el guardado. Un dato incompleto capturado hoy
   vale más que un campo vacío esperando a que alguien traiga la credencial;
   el aviso queda a la vista para corregirlo después. */
function expAvisos(e){
  const a = [];
  const curp = String(e.curp||'').trim(), rfc = String(e.rfc||'').trim(), nss = String(e.nss||'').trim();
  if(curp && curp.length!==18) a.push(`la CURP trae ${curp.length} caracteres y deben ser 18`);
  if(rfc && rfc.length!==13)   a.push(`el RFC de una persona física trae 13 caracteres, aquí van ${rfc.length}`);
  if(nss && nss.length!==11)   a.push(`el número de seguro social trae 11 dígitos, aquí van ${nss.length}`);
  return a;
}
let expAbierto = new Set();

function expBoton(e){
  const n = expLleno(e), tot = EXP_CAMPOS.length, abierto = expAbierto.has(e.id);
  const color = n===tot ? 'var(--ok)' : (n===0 ? 'var(--red)' : 'var(--warn)');
  return `<button class="rowbtn" data-expopen="${e.id}" style="white-space:nowrap">
    ${abierto?'▾':'▸'} Expediente <b style="color:${color}">${n}/${tot}</b></button>`;
}

function expedienteFila(e, columnas){
  const avisos = expAvisos(e);
  const campo = c => c.fecha
    ? dmySelect(c.k+'_'+e.id, e[c.k]||'', {attrName:'data-expdmy', compact:true, desdeAnio:c.desde||1970})
    : `<input data-expid="${e.id}" data-expf="${c.k}" value="${esc(e[c.k]||'')}"
         placeholder="${esc(c.ph||'')}" ${c.largo?`maxlength="${c.largo}"`:''}
         autocomplete="off" spellcheck="false"
         style="text-align:left;width:100%${c.mayus?';text-transform:uppercase':''}">`;
  return `<tr><td colspan="${columnas}" style="padding:0;border-top:0">
    <div style="background:#FBF7EC;border-left:4px solid var(--navy);padding:14px 16px">
      <div style="font-weight:800;color:var(--navy)">Expediente de ${esc(e.name)}</div>
      <p class="hint" style="margin:2px 0 12px">Se guarda solo cuando le picas <b>Guardar expediente</b>.
        Un campo que dejes en blanco se queda como está; para borrar un dato, vacía la casilla y guarda.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
        ${EXP_CAMPOS.map(c=>`<label style="${c.ancho?'grid-column:1 / -1':''}">${c.t}
          ${campo(c)}</label>`).join('')}
      </div>
      ${avisos.length?`<p class="hint" style="margin:10px 0 0;color:var(--warn);font-weight:700">
        ⚠️ Revisa: ${avisos.join(' · ')}. Se guardó de todos modos.</p>`:''}
      <div class="frm-row" style="margin-top:12px;align-items:center">
        <button class="btn-primary" data-expsave="${e.id}" style="flex:0 1 auto;width:auto;max-width:260px;padding:0 22px">Guardar expediente</button>
        <span data-expmsg="${e.id}" style="font-size:13px;font-weight:700;color:var(--ink-2)"></span>
      </div>
    </div></td></tr>`;
}

/* ---------- reporte imprimible de la plantilla ----------
   Una hoja por sucursal. Cada persona ocupa dos renglones: arriba lo que
   cabe en columnas, abajo el domicilio y los contactos, que son largos y
   variables. Así entra en hoja vertical sin letra de lupa ni recortes. */
function plantillaHtml(){
  const hoy = new Date().toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
  const fFecha = v => v ? new Date(v+'T12:00').toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
  const dato = v => String(v||'').trim() || '—';
  const activos = employees.filter(e=>e.active);
  const grupos = [];
  for(const [id, nombre] of Object.entries(LOCS)){
    const g = activos.filter(e=>String(e.location_id)===String(id) && !e.always_manual)
                     .sort((a,b)=>a.name.localeCompare(b.name,'es'));
    if(g.length) grupos.push([nombre, g]);
  }
  const itin = activos.filter(e=>e.always_manual).sort((a,b)=>a.name.localeCompare(b.name,'es'));
  if(itin.length) grupos.push(['Personal itinerante', itin]);
  if(!grupos.length) return '';

  return grupos.map(([nombre, gente])=>{
    const nomina = gente.reduce((s,e)=>s+Number(e.weekly_salary||0), 0);
    const completos = gente.filter(e=>expLleno(e)===EXP_CAMPOS.length).length;
    /* Lo que falta, dicho por persona y por campo. Un reporte que solo
       enseña lo que sí hay no sirve para ir a completarlo. */
    const faltantes = gente.map(e=>{
      const f = EXP_CAMPOS.filter(c=>!String(e[c.k]||'').trim()).map(c=>c.t.toLowerCase());
      return f.length ? `<b>${esc(e.name)}</b>: ${f.join(', ')}` : null;
    }).filter(Boolean);

    return `<div class="rc rc-compacto">
      <div class="rc-head">
        <img class="rc-logo" src="${LOGO_RECIBO}" alt="Boye's">
        <div class="rc-head-txt">
          <h1>Plantilla de personal — ${esc(nombre)}</h1>
          <div class="sub2">${esc(EMPRESA)}</div>
          <div class="sub3">Al ${hoy} · documento interno · contiene datos personales</div>
        </div>
      </div>
      <table class="rc-datos">
        <tr><th>Colaboradores</th><td>${gente.length}</td>
            <th>Nómina semanal</th><td>${money(nomina)}</td>
            <th>Expedientes completos</th><td>${completos} de ${gente.length}</td></tr>
      </table>
      <table class="rc-plantilla">
        <thead><tr>
          <th>Colaborador</th><th>Puesto</th><th>Ingreso</th><th class="num">Sueldo</th>
          <th>Nacimiento</th><th>RFC</th><th>CURP</th><th>NSS</th>
        </tr></thead>
        <tbody>${gente.map(e=>`
          <tr class="pl-a">
            <td><b>${esc(e.name)}</b></td>
            <td>${esc(e.position||etiquetaPuesto(e.role))}</td>
            <td>${fFecha(e.hire_date)}</td>
            <td class="num">${money(e.weekly_salary||0)}</td>
            <td>${fFecha(e.fecha_nac)}</td>
            <td>${esc(dato(e.rfc))}</td>
            <td>${esc(dato(e.curp))}</td>
            <td>${esc(dato(e.nss))}</td>
          </tr>
          <tr class="pl-b"><td colspan="8">
            <b>Domicilio:</b> ${esc(dato(e.direccion))} &nbsp;·&nbsp;
            <b>Cel:</b> ${esc(dato(e.telefono))} &nbsp;·&nbsp;
            <b>Emergencia:</b> ${esc(dato(e.emergencia_nombre))} ${e.emergencia_tel?'('+esc(e.emergencia_tel)+')':''}
          </td></tr>`).join('')}</tbody>
      </table>
      ${faltantes.length?`<p class="rc-sinreceta" style="color:#B4453A">
        <b>Falta capturar:</b> ${faltantes.join(' &nbsp;·&nbsp; ')}</p>`:''}
      <div class="rc-firmas-2">
        <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Elaboró</div></div>
        <div class="rc-firma"><div class="rc-linea"></div><div class="rc-rol">Revisó</div></div>
      </div>
      <div class="rc-pie">Impreso el ${hoy} · Uso interno · Resguardar conforme a la Ley Federal de Protección de Datos Personales</div>
    </div>`;
  }).join('');
}
function printPlantilla(){
  const html = plantillaHtml();
  if(!html){ toast('No hay personal activo que imprimir'); return; }
  $('#printArea').innerHTML = html;
  const img = $('#printArea').querySelector('.rc-logo');
  const abrir = ()=>window.print();
  if(img && !img.complete){ img.onload = abrir; img.onerror = abrir; setTimeout(abrir, 1500); }
  else abrir();
}

function selectPuesto(e){
  const actual = PUESTOS.some(p=>p[0]===e.role) ? e.role : 'empleado';
  return `<select data-eid="${e.id}" data-ef="role" style="min-height:42px;border:1.5px solid var(--line);border-radius:8px;padding:4px;background:var(--card);min-width:140px">
    ${PUESTOS.map(([v,l])=>`<option value="${v}" ${actual===v?'selected':''}>${l}</option>`).join('')}
  </select>`;
}
/* Plantilla \u00daNICA de las dos sucursales.
   Antes cada sucursal ten\u00eda su propia lista y hab\u00eda que ir cambiando de una a
   otra: por eso una misma persona pod\u00eda traer $1,500 en Guaymas y $2,205 en
   San Carlos sin que nadie lo notara, y la calculadora agarraba el primero que
   encontraba. Ahora se ven las dos de corrido, separadas por sucursal. */
function eqView(){
  const repes = idsRepetidos();
  const act = employees.filter(e=>e.active && !e.always_manual);
  /* Una ficha vieja NO es una baja.
     Cuando la nómina se pasó de un juego de fichas a otro, las anteriores se
     marcaron inactivas pero la persona sigue trabajando. Enseñarlas aquí, con
     su nombre completo y un botón de «Reactivar», hace creer que esa persona
     ya no está — y peor: invita a reactivarla, y entonces la misma persona
     cobraría dos veces.

     Así que solo se listan las bajas de gente que NO tiene una ficha activa.
     Las demás se quedan guardadas con todo su historial, nomás no se enseñan
     como si fueran bajas. */
  const activosPorNombre = new Set(
    employees.filter(e=>e.active).map(e=>claveNombre(e.name)));
  const bajasReales = employees.filter(e=>!e.active && !activosPorNombre.has(claveNombre(e.name)));
  const fichasViejas = employees.filter(e=>!e.active && activosPorNombre.has(claveNombre(e.name)));
  const inact = bajasReales;
  const flotantes = employees.filter(e=>e.always_manual && e.active);
  let h = `<div class="panel"><div class="hint" style="font-weight:700">Plantilla maestra del personal \u00b7 las dos sucursales</div>
    <p class="hint">Aqu\u00ed viven los sueldos base y puestos de <b>todo el equipo</b>, Guaymas y San Carlos en una sola lista. Se captura una sola vez \u2014 cada semana la n\u00f3mina se precarga sola desde aqu\u00ed y solo se ajustan extras/descuentos. Los cambios se guardan autom\u00e1ticamente al salir de la casilla.</p>
    <p class="hint">El bot\u00f3n <b>Expediente</b> de cada rengl\u00f3n guarda la <b>fecha de ingreso</b>, domicilio,
      fecha de nacimiento, CURP, RFC, n\u00famero de seguro social, celular y contacto de emergencia. El contador
      junto al bot\u00f3n dice cu\u00e1ntos de los ${EXP_CAMPOS.length} datos ya est\u00e1n capturados.</p>
    <div class="frm-row" style="margin-top:10px">
      <button class="btn-primary" id="plantillaPrint">\ud83d\udda8 Imprimir plantilla completa</button>
      <span class="hint">Una hoja por sucursal con todos los datos del expediente y la lista de lo que falta.</span>
    </div></div>`;
  const grupos = personasRepetidas();
  if(grupos.length){
    h += `<div class="panel" style="border-left:4px solid var(--warn);background:#FFF9EC">
      <div style="font-weight:800;color:var(--warn);margin-bottom:6px">⚠️ ${grupos.length} persona${grupos.length===1?'':'s'} está${grupos.length===1?'':'n'} dada${grupos.length===1?'':'s'} de alta más de una vez</div>
      <p class="hint"><b>¿De dónde salen las dos fichas?</b> Son dos renglones distintos en la base: a la misma persona la dieron de alta una vez en Guaymas y otra en San Carlos, cuando cada sucursal tenía su propia lista. Aunque el nombre sea igual, para el sistema eran dos empleados — y por eso cobra en las dos nóminas.</p>
      <p class="hint"><b>Unirlas no le quita ninguna sucursal.</b> La ficha que queda sirve para las dos: el checador la reconoce igual en Guaymas que en San Carlos. Se conserva lo más completo de cada una (fecha de ingreso, puesto) y tú eliges con qué sueldo se queda.</p>`;
    h += `<div class="frm-row" style="margin:6px 0 12px"><button class="btn-primary" id="unirTodas">Unir las ${grupos.length} en una sola cada quien</button><span></span></div>`;
    h += `<div class="lista-larga">`;
    grupos.forEach((g,ix)=>{
      const jefe = g[0];
      const sucs = [...new Set(g.map(e=>LOCS[e.location_id]||'Itinerante'))];
      /* Los sueldos casi nunca coinciden entre las dos fichas (una traía el
         importe de arranque y la otra el real), así que no se adivina: se
         muestran los dos y se elige. Viene marcado el más alto. */
      const sueldos = [...new Set(g.map(e=>Number(e.weekly_salary||0)))].sort((a,b)=>b-a);
      const distintos = sueldos.length > 1;
      const fecha = g.map(e=>e.hire_date).find(Boolean);
      const puesto = g.map(e=>e.position).find(Boolean);
      h += `<div class="txrow" style="align-items:flex-start">
        <div class="c"><div class="t">${esc(jefe.name)}</div>
        <div class="m">Tiene <b>${g.length} fichas</b>: ${g.map(e=>esc(LOCS[e.location_id]||'Itinerante')+' '+money(e.weekly_salary||0)).join('  +  ')}<br>
        Queda <b>1 ficha</b>${fecha?', ingreso '+esc(fecha):', sin fecha de ingreso'}${puesto?', '+esc(puesto):''} — válida en las dos sucursales</div>
        ${distintos?`<div class="m" style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <b style="color:var(--warn)">Los sueldos no coinciden — ¿con cuál se queda?</b>
          <select data-sueldounir="${ix}" style="min-height:40px;border:1.5px solid var(--warn);border-radius:8px;padding:4px 8px;background:var(--card);font-weight:800">
            ${g.map(e=>`<option value="${Number(e.weekly_salary||0)}" ${Number(e.weekly_salary||0)===sueldos[0]?'selected':''}>${money(e.weekly_salary||0)}/sem · ${esc(LOCS[e.location_id]||'Itinerante')}</option>`).join('')}
          </select></div>`:`<div class="m">Sueldo ${money(sueldos[0])}/sem en las dos — sin conflicto</div>`}
        </div>
        <button class="btn-quiet" data-unir="${ix}">Dejar una sola</button></div>`;
    });
    h += `</div></div>`;
  }
  const dudosos = posiblesRepetidos();
  if(dudosos.length){
    h += `<div class="panel" style="border-left:4px solid var(--line)">
      <div class="hint" style="font-weight:700">¿Serán la misma persona?</div>
      <p class="hint">Se parecen, pero no lo suficiente para unirlas solas — apellidos iguales entre
        familiares dan parecidos altos y unir por error dejaría a alguien fuera de la nómina.
        <b>Decide tú aquí mismo.</b> Si dices que no son la misma, el par deja de aparecer para siempre.</p>
      <div class="lista-larga">`;
    dudosos.forEach((d, ix)=>{
      const sueldos = [...new Set([d.a, d.b].map(e=>Number(e.weekly_salary||0)))].sort((x,y)=>y-x);
      h += `<div class="txrow" style="align-items:flex-start">
        <div class="c">
          <div class="t">${Math.round(d.s*100)}% parecidos</div>
          <div class="m"><b>${esc(d.a.name)}</b> (${esc(LOCS[d.a.location_id]||'Itinerante')} · ${money(d.a.weekly_salary||0)})
            <br>vs <b>${esc(d.b.name)}</b> (${esc(LOCS[d.b.location_id]||'Itinerante')} · ${money(d.b.weekly_salary||0)})</div>
          <div class="m" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span>Si es la misma, queda con</span>
            <select data-dudnombre="${ix}" style="min-height:40px;border:1.5px solid var(--line);border-radius:8px;padding:4px 8px;background:var(--card);font-weight:700">
              <option value="a">${esc(d.a.name)}</option>
              <option value="b">${esc(d.b.name)}</option>
            </select>
            ${sueldos.length>1 ? `<span>y sueldo</span>
              <select data-dudsueldo="${ix}" style="min-height:40px;border:1.5px solid var(--warn);border-radius:8px;padding:4px 8px;background:var(--card);font-weight:800">
                ${sueldos.map(s=>`<option value="${s}">${money(s)}/sem</option>`).join('')}
              </select>` : `<span>y sueldo ${money(sueldos[0])}/sem</span>`}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn-quiet" data-dudunir="${ix}">Sí, es la misma</button>
          <button class="rowbtn" data-dudno="${ix}">No, son distintas</button>
        </div></div>`;
    });
    h += `</div></div>`;
  }
  h += `<form class="panel" id="empFrm">
    <div class="frm-row-3">
      <label>Nombre <input name="name" required maxlength="80" placeholder="Como aparece en el checador"></label>
      <label>Sueldo semanal <input name="salary" type="number" inputmode="decimal" step="0.01" min="0" required class="nospin"></label>
      <label>Sucursal <select name="loc" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:var(--card)">
        ${Object.entries(LOCS).map(([id,nm])=>`<option value="${id}" ${Number(id)===finLoc?'selected':''}>${esc(nm)}</option>`).join('')}
      </select></label>
    </div>
    <div class="frm-row" style="margin-top:10px">
      <label>Puesto <select name="position" style="min-height:48px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:var(--card)">${PUESTOS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <span></span>
    </div>
    <label style="margin-top:10px">Fecha de ingreso (opcional, se puede poner después) ${dmySelect('_new', '', {attrName:'data-newhire', compact:true})}</label>
    <button class="btn-quiet" type="submit" style="margin-top:10px">Agregar al equipo</button>
  </form>`;
  const filaEmp = e => `<tr>
    <td style="text-align:left;min-width:300px">${Number(e.weekly_salary)<=0?'<span class="flag cierre" style="margin:0 6px 4px 0">SIN SUELDO</span> ':''}${repes.has(e.id)?'<span class="flag cierre" style="margin:0 6px 4px 0;background:#FDE2C7;color:#8A4B00">REPETIDO</span> ':''}${(Number(e.weekly_salary)<=0||repes.has(e.id))?'<br>':''}<input value="${esc(e.name)}" title="${esc(e.name)}" data-eid="${e.id}" data-ef="name" aria-label="Nombre" style="text-align:left;width:100%;min-width:290px"></td>
    <td><input type="number" step="0.01" min="0" inputmode="decimal" class="nospin" value="${e.weekly_salary||''}" placeholder="0" data-eid="${e.id}" data-ef="salary" style="${Number(e.weekly_salary)<=0?'border-color:var(--red);background:#FBE4E4;':''}" aria-label="Sueldo ${esc(e.name)}"></td>
    <td>${celdaFecha(e)}</td>
    <td>${selectPuesto(e)}</td>
    <td style="white-space:nowrap">${expBoton(e)}<br>
      <button class="rowbtn" data-empoff="${e.id}" style="margin-top:4px">Dar de baja</button></td></tr>`
    + (expAbierto.has(e.id) ? expedienteFila(e, 5) : '');

  if(act.length){
    /* Una secci\u00f3n por sucursal, una debajo de la otra. */
    for(const [locId, locNombre] of Object.entries(LOCS)){
      const gente = act.filter(e=>String(e.location_id)===String(locId))
                       .sort((a,b)=>a.name.localeCompare(b.name,'es'));
      h += `<div class="sec"><h2>${esc(locNombre)} (${gente.length})</h2></div>`;
      if(!gente.length){
        h += `<div class="empty"><b>Sin personal activo en ${esc(locNombre)}</b>Agr\u00e9galo arriba eligiendo esa sucursal.</div>`;
        continue;
      }
      h += `<div class="res-wrap"><table class="res"><thead><tr>
        <th>Nombre</th><th>Sueldo</th><th>Fecha de ingreso</th><th>Puesto</th><th></th></tr></thead><tbody>`;
      h += gente.map(filaEmp).join('');
      h += `</tbody></table></div>`;
    }
  } else {
    h += `<div class="empty"><b>Sin personal activo</b>Agrega al equipo arriba.</div>`;
  }
  if(inact.length){
    h += `<div class="sec"><h2>Dados de baja (${inact.length})</h2></div>`;
    h += `<div class="lista-larga">` + inact
      .sort((a,b)=>a.name.localeCompare(b.name,'es'))
      .map(e=>`<div class="txrow"><div class="c"><div class="t">${esc(e.name)}</div>
      <div class="m">${esc(LOCS[e.location_id]||'Itinerante')} \u00b7 ${esc(e.position||'')} \u00b7 ${money(e.weekly_salary)}/sem</div></div>
      <button class="btn-quiet" data-empon="${e.id}">Reactivar</button></div>`).join('') + `</div>`;
  }
  /* No se esconden en silencio: se dice cuántas hay y por qué, para que nadie
     ande buscando una ficha que sí existe. */
  if(fichasViejas.length){
    h += `<p class="hint" style="margin-top:10px">
      ${fichasViejas.length} ficha${fichasViejas.length===1?'':'s'} anterior${fichasViejas.length===1?'':'es'}
      no se muestra${fichasViejas.length===1?'':'n'} aquí porque esa${fichasViejas.length===1?'':'s'}
      persona${fichasViejas.length===1?'':'s'} sigue${fichasViejas.length===1?'':'n'} activa${fichasViejas.length===1?'':'s'}
      con otra ficha. Siguen guardadas con su historial de nómina; no son bajas.</p>`;
  }
  if(flotantes.length){
    h += `<div class="sec"><h2>Personal itinerante (ambas sucursales)</h2></div>
      <p class="hint" style="margin-bottom:10px">No están fijos a una sucursal ni salen en el checador — su sueldo y horas se capturan a mano cada semana en Nómina, en la sucursal que corresponda esa semana.</p>
      <div class="res-wrap"><table class="res"><thead><tr><th>Nombre</th><th>Fecha de ingreso</th><th>Puesto</th><th></th></tr></thead><tbody>`;
    for(const e of flotantes){
      h += `<tr><td style="text-align:left;min-width:300px"><input value="${esc(e.name)}" title="${esc(e.name)}" data-eid="${e.id}" data-ef="name" aria-label="Nombre" style="text-align:left;width:100%;min-width:290px"></td>
        <td>${celdaFecha(e)}</td>
        <td style="text-align:left"><input value="${esc(e.position||'')}" data-eid="${e.id}" data-ef="position" aria-label="Puesto" style="text-align:left;min-width:120px"></td>
        <td style="white-space:nowrap">${expBoton(e)}<br>
          <button class="rowbtn" data-empoff="${e.id}" style="margin-top:4px">Dar de baja</button></td></tr>`;
      if(expAbierto.has(e.id)) h += expedienteFila(e, 4);
    }
    h += `</tbody></table></div>`;
  }
  return h;
}
function collectCalcItems(){
  return payCalc.emps.filter(e=>e.base!==null).map(e=>{
    const c = calcEmp(e);
    return {
      employee_id: e.employee_id,
      base: Math.round((c.pagoBase+c.septimo)*100)/100,
      extras: Math.round((c.extras+c.festivo+c.bonos)*100)/100,
      deductions: Math.round(c.desc*100)/100,
      hours: c.totalH, extra_hours: c.extraH,
      breakdown: {base_semanal:e.base, rate:Math.round(c.rate*10000)/10000, pago_base:Math.round(c.pagoBase*100)/100,
                  septimo:Math.round(c.septimo*100)/100, festivo:c.festivo, bonos:c.bonos, days:e.days}
    };
  });
}
/* ---------- drag & drop de archivos en zonas de captura ---------- */
async function fileToText(f){
  const name = (f.name||'').toLowerCase();
  if(name.endsWith('.pdf')){ const lines = await extractPdfText(f); return lines.join('\n'); }
  if(name.endsWith('.xlsx') || name.endsWith('.xls')){
    await loadXLSX();
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(ws, {FS:'\t', blankrows:false});
  }
  return await f.text();
}
function wireDrop(taId){
  const ta = document.getElementById(taId); if(!ta || ta._dropWired) return;
  ta._dropWired = true;
  const handle = async f => {
    if(!f) return;
    toast('Leyendo archivo\u2026');
    /* Se guarda el archivo, no solo su texto.

       Los PDF que salen del "Print To PDF" de Windows no traen texto: son una
       imagen de la hoja. Se ven perfectos al abrirlos y no hay una sola letra
       que un programa pueda leer. Antes, en ese caso, el cuadro quedaba vac\u00edo,
       el aviso igual dec\u00eda \u00abArchivo cargado\u00bb y al darle Procesar sal\u00eda \u00abpega
       el reporte\u00bb \u2014 como si el usuario no hubiera hecho nada. Guardando el
       archivo, quien procesa puede mandarlo a OCR en vez de rendirse. */
    ta._archivo = f;
    try{
      ta.value = await fileToText(f);
      const esPdf = /\.pdf$/i.test(f.name || '');
      if(esPdf && ta.value.trim().length < 20)
        toast('Ese PDF no trae texto \u2014 es una imagen. Dale Procesar y lo leo con OCR.');
      else
        toast('Archivo cargado \u2014 revisa y dale Procesar');
    }catch(e){
      ta.value = '';
      toast(/\.pdf$/i.test(f.name||'')
        ? 'No pude sacarle texto \u2014 dale Procesar y lo intento con OCR.'
        : 'No pude leer el archivo');
    }
  };
  ta.addEventListener('dragover', e=>{ e.preventDefault(); ta.style.borderColor='var(--gold)'; ta.style.background='#FFF6E2'; });
  ta.addEventListener('dragleave', ()=>{ ta.style.borderColor=''; ta.style.background=''; });
  ta.addEventListener('drop', e=>{ e.preventDefault(); ta.style.borderColor=''; ta.style.background=''; handle(e.dataTransfer.files[0]); });
  /* Si alguien pega texto a mano, el archivo viejo deja de valer: procesar
     tiene que quedarse con lo último que hizo la persona, no con lo anterior. */
  ta.addEventListener('input', ()=>{ if(ta.value.trim().length > 20) ta._archivo = null; });
  document.querySelector(`[data-paste="${taId}"]`)?.addEventListener('click', async ()=>{
    try{
      const t = await navigator.clipboard.readText();
      if(!t || !t.trim()){ toast('El portapapeles est\u00e1 vac\u00edo \u2014 copia primero el reporte'); return; }
      ta.value = t;
      toast('Pegado \u2014 revisa y dale Procesar');
    }catch(e){ toast('Tu navegador pidi\u00f3 permiso o no dej\u00f3 leer \u2014 pega directo en el cuadro (mantener presionado \u2192 Pegar)'); }
  });
    document.querySelector(`[data-pick="${taId}"]`)?.addEventListener('click', ()=>{
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.txt,.csv,.tsv,.xlsx,.xls,.pdf';
    inp.onchange = ()=>handle(inp.files[0]);
    inp.click();
  });
}
/* Los controles de la calculadora se cablean aparte para poder usarla
   tanto desde Nómina como desde la pestaña de Herramientas. */
function wireCalc(){
  $('#main').querySelectorAll('[data-ct]').forEach(b=>b.addEventListener('click', ()=>{ calcForm.tipo=b.dataset.ct; render(); }));
  $('#main').querySelectorAll('[data-cfv]').forEach(inp=>inp.addEventListener('change', ()=>{ calcForm[inp.dataset.cfv]=inp.value; render(); }));
  $('#main').querySelectorAll('[data-dmy]').forEach(sel=>sel.addEventListener('change', ()=>{
    const field = sel.dataset.dmy;
    const wrap = sel.parentElement;
    const d = wrap.querySelector('[data-dmyp="d"]')?.value;
    const m = wrap.querySelector('[data-dmyp="m"]')?.value;
    const y = wrap.querySelector('[data-dmyp="y"]')?.value;
    if(d && m && y){
      calcForm[field] = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    } else {
      calcForm[field] = '';
    }
    render();
  }));
  $('#calcEmpSel')?.addEventListener('change', e=>{ calcForm.empleadoId = e.target.value; render(); });
  $('#calcIncluir20')?.addEventListener('change', e=>{ calcForm.incluir20 = e.target.checked; render(); });
  $('#calcLocSel')?.addEventListener('change', e=>{
    calcForm.locFiltro = e.target.value;
    /* Si el que estaba elegido no es de esa sucursal, se suelta el vínculo
       para no calcular con datos de otra persona. */
    const sigue = employees.find(x=>x.id===calcForm.empleadoId
      && (!calcForm.locFiltro || String(x.location_id)===String(calcForm.locFiltro)));
    if(!sigue) calcForm.empleadoId = '';
    render();
  });
  /* Estaba enganchado únicamente dentro de Nómina, así que desde que la
     calculadora se mudó a Herramientas el botón de imprimir no hacía nada. */
  $('#calcPrint')?.addEventListener('click', printFiniquito);
  $('#docRenuncia')?.addEventListener('click', ()=>printDocLegal('renuncia'));
  $('#docConvenio')?.addEventListener('click', ()=>printDocLegal('convenio'));
  $('#docAmbos')?.addEventListener('click', ()=>printDocLegal('ambos'));

  $('#calcBaja')?.addEventListener('click', async ev=>{
    const b = ev.currentTarget;
    const emp = employees.find(x=>x.id===b.dataset.calcbaja);
    if(!emp) return;
    const r = calcLiquidacion(calcForm);
    const tipoTxt = calcForm.tipo==='liquidacion' ? 'liquidación' : 'finiquito';
    const ok = confirm(
      `Procesar ${tipoTxt} de ${emp.name}\n\n`
      + `Total estimado: ${money(r.total||0)}\n\n`
      + `${emp.name} dejará de aparecer en las nóminas semanales que vienen.\n\n`
      + `NO se borra nada: su registro, su historial y las nóminas ya guardadas se quedan tal cual. `
      + `Si regresa, lo reactivas en Equipo.\n\n¿Continuar?`);
    if(!ok) return;
    const etiqueta = b.textContent;
    b.disabled = true; b.textContent = 'Procesando…';
    try{
      await finRpc('fin_set_employee_active', {p_id: emp.id, p_active: false});
      emp.active = false;
      toast(`${emp.name} dado de baja — ya no aparece en nóminas nuevas`);
      printFiniquito();           // el recibo sale para firma
      payData = null; payCalc = null;   // que la nómina se vuelva a armar sin él
      render();
    }catch(err){
      b.disabled = false; b.textContent = etiqueta;
      toast('No se pudo dar de baja');
    }
  });
}
/* Un solo escucha, puesto una vez, para saltar a una nómina guardada. Va por
   delegación en #main y no dentro de wireNom porque wireNom se corta a la
   primera si no existe la caja de pegar: los chips se quedarían muertos. */
let _nomChipsListo = false;
function instalaSaltoNomina(){
  if(_nomChipsListo) return;
  _nomChipsListo = true;
  $('#main').addEventListener('click', ev=>{
    const b = ev.target.closest('[data-gopay]');
    if(!b) return;
    payWeek = new Date(b.dataset.gopay+'T12:00');
    payData=null; payCalc=null; manualOpen=false; refreshPayroll();
  });
}
async function wireNom(){
  instalaSaltoNomina();
  if(document.getElementById('pasteBox')?._nomWired) return; if(document.getElementById('pasteBox')) document.getElementById('pasteBox')._nomWired=true;
  wireDrop('pasteBox');
  $('#main').querySelectorAll('[data-wk]').forEach(b=>b.addEventListener('click', ()=>{
    payWeek.setDate(payWeek.getDate() + 7*Number(b.dataset.wk));
    payData=null; payCalc=null; manualOpen=false; refreshPayroll();
  }));
  $('#main').querySelectorAll('[data-nm]').forEach(b=>b.addEventListener('click', ()=>{ nomMode=b.dataset.nm; manualOpen=false; render(); }));
  wireCalc();   // wireCalc ya engancha el botón de imprimir

  /* checador mode */
  $('#procBtn')?.addEventListener('click', async ()=>{
    const res = parseChecador($('#pasteBox').value);
    if(res.error){ toast(res.error); return; }
    const nuevosDelChecador = res.emps.filter(e=>!e.employee_id);
    await Promise.allSettled(nuevosDelChecador.map(e=>
      finRpc('fin_save_employee', {p_id:null, p_name:e.name, p_position:'', p_location:finLoc, p_salary:0})
        .then(row=>{
          if(!employees.find(x=>x.id===row.id)) employees.push(row);
          e.employee_id = row.id;
        })
    ));
    // empleados que no salen en el checador (pago/horas 100% manual, aplican a ambas sucursales)
    const manuales = employees.filter(e=>e.always_manual && e.active && !res.emps.find(x=>x.employee_id===e.id));
    for(const e of manuales){
      res.emps.push({name:e.name, employee_id:e.id, base:(Number(e.weekly_salary)>0)?Number(e.weekly_salary):null,
        days:[], added:0, festivo:false, bonos:0, descuentos:0, manual:true});
    }
    res.emps.sort((a,b)=>a.name.localeCompare(b.name));
    payCalc = res; render();
    const nuevos = res.emps.filter(e=>e.base===null);
    if(nuevos.length) toast(`\u26a0 ${nuevos.length} persona(s) sin sueldo asignado \u2014 as\u00edgnalo abajo o en Equipo`);
  });
  $('#openMan')?.addEventListener('click', ()=>{ manualOpen=true; render(); });
  $('#limpiaNom')?.addEventListener('click', async ()=>{
    const items = payData?.items||[];
    const quitar = items.filter(i=>(i.hours===null||i.hours===undefined) && !Number(i.extras) && !Number(i.deductions));
    if(!quitar.length) return;
    const quedan = items.filter(i=>!quitar.includes(i));
    const nuevoTotal = quedan.reduce((s,i)=>s+Number(i.base||0)+Number(i.extras||0)-Number(i.deductions||0),0);
    if(!confirm(`Se quitan ${quitar.length} personas sin horas:\n\n  ${quitar.map(i=>i.name).join('\n  ')}\n\n`
      + `La nómina queda en ${money(nuevoTotal)}.\n`
      + `Si alguna sí trabajó, agrégala después con "Ajustar horas". ¿Continuar?`)) return;
    try{
      await finRpc('fin_save_payroll', {p_week: dstr(payWeek), p_loc: finLoc, p_items: quedan});
      payData.items = quedan;
      toast(`${quitar.length} personas quitadas — nómina: ${money(nuevoTotal)}`);
      render();
    }catch(e){ toast('No se pudo guardar el cambio'); }
  });
  $('#openMan2')?.addEventListener('click', ()=>{ rebuildPayCalcFromSaved(); render(); });
  $('#addSavedBtn')?.addEventListener('click', async ()=>{
    const sel = $('#addSavedSel');
    const emp = employees.find(e=>e.id===sel?.value);
    if(!emp) return;
    const nuevoItem = {employee_id:emp.id, name:emp.name, position:emp.position||'',
      base:Number(emp.weekly_salary||0), extras:0, deductions:0, notes:null, hours:null, extra_hours:null, breakdown:null};
    const items = [...(payData.items||[]), nuevoItem];
    try{
      const res = await finRpc('fin_save_payroll', {p_week: dstr(payWeek), p_loc: finLoc, p_items: items});
      payData.items = items;
      toast(`${emp.name} agregado y guardado ✓ · Total ${money(res.total)}`);
      refreshFinance(); render();
    }catch(e){ toast('No se pudo guardar, intenta de nuevo'); }
  });
  $('#closeMan')?.addEventListener('click', ()=>{ manualOpen=false; render(); });
  $('#redoChk')?.addEventListener('click', ()=>{ payCalc=null; payData={...payData, saved:false}; render(); });
  /* ANTES: el recibo se volvía a calcular desde el detalle del checador, así
     que a quien tenía horas capturadas a mano le salía TODO EN CERO aunque en
     la nómina apareciera su pago. Ahora se imprime lo que quedó guardado. */
  const filasGuardadas = ()=> (payData.items||[]).map(i=>{
    const d = datosDePlantilla(i.name, i.employee_id);
    return {
      name: i.name, puesto: d.puesto, ingreso: d.ingreso,
      base: Number(i.base||0),
      extrasMonto: Number(i.extras||0),
      bonos: 0,
      deducciones: Number(i.deductions||0),
      horas: i.hours ?? null, horasExtra: i.extra_hours ?? 0,
      days: i.breakdown?.days || []
    };
  });
  $('#printSaved')?.addEventListener('click', ()=>{
    const filas = filasGuardadas();
    if(!filas.length){ toast('Esta nómina no tiene renglones'); return; }
    printReceipts(filas, false);
  });
  $('#printSavedTotal')?.addEventListener('click', ()=>{
    const filas = filasGuardadas();
    if(!filas.length){ toast('Esta nómina no tiene renglones'); return; }
    printReceipts(filas, true);
  });
  $('#printSavedSolo')?.addEventListener('click', ()=>{
    const filas = filasGuardadas();
    if(!filas.length){ toast('Esta nómina no tiene renglones'); return; }
    $('#printArea').innerHTML = payrollSummaryHtml(filas, etiquetaSemana());
    const img = $('#printArea').querySelector('.rc-logo');
    if(img && !img.complete){ img.onload = ()=>window.print(); img.onerror = ()=>window.print(); setTimeout(()=>window.print(), 1500); }
    else window.print();
  });
  $('#addEmpBtn')?.addEventListener('click', async ()=>{
    const inp = $('#addEmpName');
    const name = (inp?.value||'').trim();
    if(!name){ toast('Escribe el nombre'); return; }
    const norm = normName(name);
    if(payCalc.emps.find(e=>normName(e.name)===norm)){ toast('Esa persona ya está en la lista'); return; }
    let match = buscarColaborador(name, finLoc);
    if(match){
      payCalc.emps.push({name:match.name, employee_id:match.id, base:(Number(match.weekly_salary)>0)?Number(match.weekly_salary):null,
        days:[], added:0, festivo:false, bonos:0, descuentos:0, manual:true});
      payCalc.emps.sort((a,b)=>a.name.localeCompare(b.name));
      if(inp) inp.value='';
      toast(match.weekly_salary>0 ? `${match.name} agregado — asigna sus horas abajo` : `${match.name} agregado — asígnale sueldo y horas abajo`);
      render();
      return;
    }
    try{
      const row = await finRpc('fin_save_employee', {p_id:null, p_name:name, p_position:'', p_location:finLoc, p_salary:0});
      employees.push(row);
      payCalc.emps.push({name:row.name, employee_id:row.id, base:null,
        days:[], added:0, festivo:false, bonos:0, descuentos:0, manual:true});
      payCalc.emps.sort((a,b)=>a.name.localeCompare(b.name));
      if(inp) inp.value='';
      toast(`${row.name} agregado — asígnale sueldo y horas abajo`);
      render();
    }catch(e){ toast('No se pudo agregar, intenta de nuevo'); }
  });
  $('#saveNewEmps')?.addEventListener('click', async ()=>{
    const inputs = [...$('#main').querySelectorAll('[data-newsal]')];
    const targets = [];
    let skipped = 0;
    for(const inp of inputs){
      const ix = Number(inp.dataset.newsal);
      const sal = Number(inp.value||0);
      if(!sal){ skipped++; continue; }
      const pos = $('#main').querySelector(`[data-newpos="${ix}"]`)?.value||'';
      targets.push({ix, sal, pos});
    }
    const results = await Promise.allSettled(targets.map(({ix,sal,pos})=>
      finRpc('fin_save_employee', {p_id: payCalc.emps[ix].employee_id||null, p_name:payCalc.emps[ix].name, p_position:pos, p_location:finLoc, p_salary:sal})
        .then(row=>{
          const already = employees.findIndex(x=>x.id===row.id);
          if(already>=0) employees[already]=row; else employees.push(row);
          payCalc.emps[ix].employee_id = row.id;
          payCalc.emps[ix].base = sal;
        })
    ));
    const saved = results.filter(r=>r.status==='fulfilled').length;
    const failed = results.filter(r=>r.status==='rejected').length;
    /* El mensaje decía «error de conexión» pasara lo que pasara, y no era la
       conexión: era la base rechazando el alta. Un aviso que miente sobre la
       causa hace que se intente de nuevo diez veces en vez de leer el motivo.
       Ahora se enseña lo que contestó el servidor. */
    if(failed){
      const motivo = results.find(r=>r.status==='rejected')?.reason;
      const txt = String(motivo?.message || motivo || '').slice(0, 120);
      toast(`⚠ ${failed} no se pudieron guardar${txt?` — ${txt}`:''}`);
      console.error('alta de empleados:', results.filter(r=>r.status==='rejected').map(r=>r.reason));
    }
    else if(saved) toast(`${saved} empleado(s) guardado(s) ✓${skipped?` · ${skipped} sin sueldo (pendiente)`:''}`);
    else if(skipped) toast('Asigna un sueldo mayor a 0 antes de guardar');
    render();
  });
  $('#main').querySelectorAll('[data-se]').forEach(inp=>inp.addEventListener('change', ()=>{
    const d = payCalc.emps[Number(inp.dataset.se)].days[Number(inp.dataset.sd)];
    if(!inp.value || !d.ent) return;
    d.sal = inp.value;
    const e0 = parseTime(d.ent), s0 = parseTime(d.sal);
    d.hours = Math.round(((s0 - e0 + 1440) % 1440) / 60 * 100) / 100;
    d.plus1 = false;
    d.flags = d.flags.filter(f=>f!=='auto' && f!=='cierre');
    if([5,6].includes(new Date(d.fecha+'T12:00').getDay())) d.flags.push('cierre');
    render();
  }));
  $('#main').querySelectorAll('[data-p1e]').forEach(b=>b.addEventListener('click', ()=>{
    const d = payCalc.emps[Number(b.dataset.p1e)].days[Number(b.dataset.p1d)];
    if(!d.plus1){ d.hours = Math.round((d.hours+1)*100)/100; d.plus1=true; }
    else { d.hours = Math.max(0, Math.round((d.hours-1)*100)/100); d.plus1=false; }
    render();
  }));
  $('#main').querySelectorAll('[data-fld]').forEach(inp=>inp.addEventListener('change', ()=>{
    const e = payCalc.emps[Number(inp.dataset.eix)];
    if(inp.dataset.fld==='festivo') e.festivo = inp.checked;
    else e[inp.dataset.fld] = Number(inp.value||0);
    render();
  }));
  $('#saveCalc')?.addEventListener('click', async ()=>{
    const pend = payCalc.emps.filter(e=>e.base===null);
    if(pend.length){ toast(`Falta el sueldo de: ${pend.map(e=>e.name.split(' ')[0]).join(', ')}`); return; }
    try{
      const res = await finRpc('fin_save_payroll', {p_week: dstr(payWeek), p_loc: finLoc, p_items: collectCalcItems()});
      refreshFinance();
      toast(`Nómina guardada · ${money(res.total)}`);
      payCalc=null; payData=null; refreshFinance(); refreshPayroll();
    }catch(e){}
  });
  const filasCalculadas = ()=> payCalc.emps.filter(e=>e.base!==null).map(e=>{
    const c = calcEmp(e);
    const d = datosDePlantilla(e.name, e.employee_id);
    return {
      name: e.name, puesto: d.puesto, ingreso: d.ingreso,
      base: c.pagoBase + c.septimo + c.festivo,
      extrasMonto: c.extras, bonos: c.bonos,
      deducciones: c.desc,
      horas: c.totalH, horasExtra: c.extraH,
      days: e.days || []
    };
  });
  $('#printCalc')?.addEventListener('click', ()=>{
    const filas = filasCalculadas();
    if(!filas.length){ toast('Asigna sueldos primero'); return; }
    printReceipts(filas, false);
  });
  $('#printCalcTotal')?.addEventListener('click', ()=>{
    const filas = filasCalculadas();
    if(!filas.length){ toast('Asigna sueldos primero'); return; }
    $('#printArea').innerHTML = payrollSummaryHtml(filas, etiquetaSemana());
    const img = $('#printArea').querySelector('.rc-logo');
    if(img && !img.complete){ img.onload = ()=>window.print(); img.onerror = ()=>window.print(); setTimeout(()=>window.print(), 1500); }
    else window.print();
  });
  $('#cancelCalc')?.addEventListener('click', ()=>{ payCalc=null; render(); });

  /* manual mode */
  $('#addManBtn')?.addEventListener('click', ()=>{
    const sel = $('#addManSel');
    const emp = employees.find(e=>e.id===sel?.value);
    if(!emp) return;
    if(!payData.items) payData.items = [];
    payData.items.push({employee_id:emp.id, name:emp.name, position:emp.position||'',
      base:Number(emp.weekly_salary||0), extras:0, deductions:0, notes:null, hours:null, extra_hours:null, breakdown:null});
    payData.items.sort((a,b)=>a.name.localeCompare(b.name));
    toast(`${emp.name} agregado — dale "Actualizar nómina" para guardarlo`);
    render();
  });
  $('#main').querySelectorAll('[data-pay]').forEach(inp=>inp.addEventListener('change', ()=>{
    const it = payData.items[Number(inp.dataset.pay)];
    it[inp.dataset.f] = Number(inp.value||0);
    render();
  }));
  $('#savePay')?.addEventListener('click', async ()=>{
    try{
      const res = await finRpc('fin_save_payroll', {p_week: dstr(payWeek), p_loc: finLoc, p_items: payData.items});
      refreshFinance();
      toast(`Nómina guardada · ${money(res.total)}`);
      payData.saved = true;
      refreshFinance(); render();
    }catch(e){}
  });
  /* La plantilla vive ahora en su propia pestaña (Equipo); sus controles se
     enganchan aparte para que funcionen en los dos lados. */
  wireEquipo();
}
async function wireEquipo(){
  $('#plantillaPrint')?.addEventListener('click', printPlantilla);
  /* Abrir y cerrar el expediente de una persona. Se guarda en memoria quién
     está abierto para que repintar la tabla —cosa que pasa cada vez que se
     guarda algo— no cierre la ficha que se está llenando. */
  $('#main').querySelectorAll('[data-expopen]').forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.expopen;
    if(expAbierto.has(id)) expAbierto.delete(id); else expAbierto.add(id);
    render();
  }));
  $('#main').querySelectorAll('[data-expsave]').forEach(b=>b.addEventListener('click', async ()=>{
    const id = b.dataset.expsave;
    const emp = employees.find(x=>x.id===id); if(!emp) return;
    const msg = $('#main').querySelector(`[data-expmsg="${id}"]`);
    const decir = (t,c)=>{ if(msg){ msg.textContent = t; msg.style.color = c; } };
    /* Se mandan también nombre, sueldo y sucursal porque la función de la base
       actualiza campo por campo con coalesce: lo que no viaja, no se toca.
       Mandarlos iguales no cambia nada y deja el renglón consistente. */
    const p = {p_id: emp.id, p_name: emp.name, p_position: emp.position||'',
               p_location: emp.location_id, p_salary: Number(emp.weekly_salary||0),
               p_area: emp.area||null, p_role: emp.role||'empleado'};
    for(const c of EXP_CAMPOS){
      if(c.fecha) continue;
      const inp = $('#main').querySelector(`[data-expid="${id}"][data-expf="${c.k}"]`);
      if(!inp) continue;
      let v = inp.value.trim();
      if(c.mayus) v = v.toUpperCase();
      if(c.soloNum) v = v.replace(/\D/g,'');
      inp.value = v;
      emp[c.k] = v;
      p['p_'+c.k] = v;          // cadena vacía = borrar ese dato
    }
    /* Las fechas van por su propio camino: son tres desplegables, no una
       casilla. Media fecha NO se guarda en silencio —se dice qué falta—,
       porque ese fue exactamente el hoyo que tenía la fecha de ingreso
       cuando vivía en la tabla: escogías dos de tres y no pasaba nada. */
    for(const c of EXP_CAMPOS.filter(x=>x.fecha)){
      const wrap = $('#main').querySelector(`[data-expdmy="${c.k}_${id}"]`)?.parentElement;
      if(!wrap) continue;
      const d = wrap.querySelector('[data-dmyp="d"]')?.value;
      const m = wrap.querySelector('[data-dmyp="m"]')?.value;
      const y = wrap.querySelector('[data-dmyp="y"]')?.value;
      if(d && m && y){
        const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        p['p_'+(c.k==='hire_date'?'hire_date':c.k)] = iso;
        emp[c.k] = iso;
      } else if(d || m || y){
        const falta = [!d&&'día', !m&&'mes', !y&&'año'].filter(Boolean).join(' y ');
        decir(`Falta el ${falta} en «${c.t}»`, 'var(--red)');
        return;
      }
    }
    decir('Guardando…', 'var(--ink-2)');
    try{
      await finRpc('fin_save_employee', p);
      toast(`Expediente guardado — ${emp.name}`);
      render();
    }catch(err){ decir('No se pudo guardar', 'var(--red)'); }
  }));
  $('#main').querySelectorAll('[data-eid]').forEach(inp=>inp.addEventListener('change', async ()=>{
    const emp = employees.find(x=>x.id===inp.dataset.eid);
    if(!emp) return;
    if(inp.dataset.ef==='salary') emp.weekly_salary = Number(inp.value||0);
    else if(inp.dataset.ef==='name') emp.name = inp.value.trim()||emp.name;
    else if(inp.dataset.ef==='role'){ emp.role = inp.value; emp.position = etiquetaPuesto(inp.value); }
    else emp.position = inp.value.trim();
    try{
      /* Esta pantalla SÍ es dueña del sueldo: si alguien teclea 0 es porque
         quiere 0. En todas las demás, un cero significa "no sé cuánto gana"
         y la base ya no lo deja borrar — así se perdieron los sueldos al
         pegar el checador. */
      await finRpc('fin_save_employee', {p_id: emp.id, p_name: emp.name, p_position: emp.position||'', p_location: emp.location_id, p_salary: Number(emp.weekly_salary||0), p_area: emp.area||null, p_role: emp.role||'empleado', p_zero_ok: inp.dataset.ef==='salary'});
      toast('Guardado');
      if(!payData?.saved) payData = null;
    }catch(e){}
  }));
  $('#main').querySelectorAll('[data-empon]').forEach(b=>b.addEventListener('click', async ()=>{
    try{
      await finRpc('fin_set_employee_active', {p_id: b.dataset.empon, p_active: true});
      const emp = employees.find(x=>x.id===b.dataset.empon); if(emp) emp.active=true;
      toast('Reactivado');
      if(!payData?.saved) payData = null;
      render();
    }catch(e){}
  }));
  $('#empFrm')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const wrap = $('#main').querySelector('[data-newhire="_new"]')?.parentElement;
    const nd = wrap?.querySelector('[data-dmyp="d"]')?.value, nm = wrap?.querySelector('[data-dmyp="m"]')?.value, ny = wrap?.querySelector('[data-dmyp="y"]')?.value;
    const hireDate = (nd&&nm&&ny) ? `${ny}-${String(nm).padStart(2,'0')}-${String(nd).padStart(2,'0')}` : null;
    try{
      /* La sucursal se escoge en el propio formulario: la plantilla ya no
         depende de en cuál estabas parado. */
      const loc = Number(f.get('loc')) || finLoc;
      const row = await finRpc('fin_save_employee', {p_id: null, p_name: f.get('name'), p_position: f.get('position'), p_location: loc, p_salary: Number(f.get('salary')), p_hire_date: hireDate});
      employees.push(row);
      toast('Empleado agregado');
      if(!payData?.saved){ payData=null; refreshPayroll(); return; }
      render();
    }catch(err){}
  });
  /* Une un grupo de fichas repetidas en una sola.
     A la que se queda se le rellena todo lo que traiga en blanco tomándolo de
     las otras (nunca se pisa un dato bueno), y el sueldo es el que se eligió
     en el desplegable de la tarjeta. Las demás fichas NO se borran: se marcan
     inactivas, así que su historial y sus nóminas viejas quedan intactos. */
  async function unirGrupo(g, sueldoElegido){
    if(!g || g.length<2) return false;
    const jefe = g[0], sobran = g.slice(1);
    for(const o of sobran){
      if(!jefe.hire_date && o.hire_date) jefe.hire_date = o.hire_date;
      if(!jefe.position && o.position) jefe.position = o.position;
      if(!jefe.area && o.area) jefe.area = o.area;
      if((!jefe.role||jefe.role==='empleado') && o.role && o.role!=='empleado') jefe.role = o.role;
    }
    const sueldo = Number(sueldoElegido) > 0
      ? Number(sueldoElegido)
      : Math.max(...g.map(e=>Number(e.weekly_salary||0)));
    jefe.weekly_salary = sueldo;
    await finRpc('fin_save_employee', {p_id: jefe.id, p_name: jefe.name, p_position: jefe.position||'',
      p_location: jefe.location_id, p_salary: sueldo, p_area: jefe.area||null,
      p_role: jefe.role||'empleado', p_hire_date: jefe.hire_date||null});
    for(const o of sobran){
      await finRpc('fin_set_employee_active', {p_id: o.id, p_active: false});
      const ref = employees.find(x=>x.id===o.id); if(ref) ref.active = false;
    }
    return true;
  }
  const sueldoDeTarjeta = ix => Number($('#main').querySelector(`[data-sueldounir="${ix}"]`)?.value || 0);

  $('#main').querySelectorAll('[data-unir]').forEach(b=>b.addEventListener('click', async ()=>{
    const ix = Number(b.dataset.unir);
    const g = personasRepetidas()[ix];
    if(!g || g.length<2) return;
    const jefe = g[0];
    const sueldo = sueldoDeTarjeta(ix) || Math.max(...g.map(e=>Number(e.weekly_salary||0)));
    const aviso = `${jefe.name}\n\n`
      + `Hoy tiene ${g.length} fichas (${g.map(e=>(LOCS[e.location_id]||'Itinerante')+' '+money(e.weekly_salary||0)).join(', ')}).\n\n`
      + `Va a quedar 1 sola, con sueldo ${money(sueldo)}/sem`
      + `${jefe.hire_date? ' e ingreso '+jefe.hire_date : ' y sin fecha de ingreso'}.\n\n`
      + `Esa ficha sirve para LAS DOS sucursales: puede trabajar un día en Guaymas\n`
      + `y otro en San Carlos, y el checador la reconoce igual.\n\n`
      + `Ya no va a cobrar doble en la nómina. ¿Continuar?`;
    if(!confirm(aviso)) return;
    try{
      await unirGrupo(g, sueldo);
      toast(`${jefe.name}: ahora tiene una sola ficha`);
      payData=null; payCalc=null;
      render();
    }catch(e){ toast('No se pudo unir — intenta de nuevo'); }
  }));

  /* Los "¿serán la misma persona?": aquí sí se decide, en vez de mandar a
     corregir el nombre a mano hasta que coincidan letra por letra. */
  $('#main').querySelectorAll('[data-dudunir]').forEach(b=>b.addEventListener('click', async ()=>{
    const ix = Number(b.dataset.dudunir);
    const d = posiblesRepetidos()[ix];
    if(!d) return;
    const cual = $('#main').querySelector(`[data-dudnombre="${ix}"]`)?.value || 'a';
    const nombre = (cual==='b' ? d.b : d.a).name;
    const sel = $('#main').querySelector(`[data-dudsueldo="${ix}"]`);
    const sueldo = Number(sel?.value || 0) || Math.max(Number(d.a.weekly_salary||0), Number(d.b.weekly_salary||0));
    /* Se queda la ficha MÁS COMPLETA, aunque el nombre elegido sea el de la
       otra: perder la fecha de ingreso o el expediente por escoger un nombre
       sería cambiar un dato por otro. */
    const puntos = e => ['hire_date','position','rfc','curp','nss','direccion','fecha_nac','telefono']
      .filter(k=>String(e[k]||'').trim()).length;
    const g = puntos(d.b) > puntos(d.a) ? [d.b, d.a] : [d.a, d.b];
    const aviso = `${d.a.name}\n${d.b.name}\n\n`
      + `Se van a unir en UNA sola ficha, con el nombre "${nombre}" y sueldo ${money(sueldo)}/sem.\n\n`
      + `La otra ficha NO se borra: se marca inactiva y conserva su historial de nómina.\n\n`
      + `Si no son la misma persona, cancela y dale a "No, son distintas".`;
    if(!confirm(aviso)) return;
    try{
      g[0].name = nombre;
      await unirGrupo(g, sueldo);
      toast(`${nombre}: ahora tiene una sola ficha`);
      payData=null; payCalc=null;
      render();
    }catch(e){ toast('No se pudo unir — intenta de nuevo'); }
  }));
  $('#main').querySelectorAll('[data-dudno]').forEach(b=>b.addEventListener('click', async ()=>{
    const ix = Number(b.dataset.dudno);
    const d = posiblesRepetidos()[ix];
    if(!d) return;
    try{
      await finRpc('fin_no_dup_add', {p_a: d.a.id, p_b: d.b.id});
      if(noDup) noDup.add(noDupClave(d.a.id, d.b.id));
      toast('Anotado: son dos personas distintas');
      render();
    }catch(e){ toast('No se pudo guardar'); }
  }));

  $('#unirTodas')?.addEventListener('click', async ev=>{
    const grupos = personasRepetidas();
    if(!grupos.length) return;
    const elecciones = grupos.map((g,ix)=> sueldoDeTarjeta(ix) || Math.max(...g.map(e=>Number(e.weekly_salary||0))));
    const lista = grupos.map((g,ix)=>`· ${g[0].name} → ${money(elecciones[ix])}/sem`).join('\n');
    if(!confirm(`Unir ${grupos.length} personas repetidas\n\nCada quien queda con UNA ficha, válida en las dos sucursales, con el sueldo que quedó marcado:\n\n${lista}\n\nNo se borra ningún registro: las fichas de más se marcan inactivas y su historial se conserva.\n\n¿Continuar?`)) return;
    const b = ev.currentTarget; b.disabled = true;
    let hechas = 0, fallos = 0;
    for(let ix=0; ix<grupos.length; ix++){
      try{ await unirGrupo(grupos[ix], elecciones[ix]); hechas++; }
      catch(e){ fallos++; }
    }
    toast(fallos ? `${hechas} unidas · ${fallos} fallaron` : `${hechas} personas quedaron con una sola ficha`);
    payData=null; payCalc=null;
    render();
  });
  $('#main').querySelectorAll('[data-empoff]').forEach(b=>b.addEventListener('click', async ()=>{
    if(!confirm('¿Dar de baja a este empleado? Dejará de aparecer en nóminas nuevas.')) return;
    try{
      await finRpc('fin_set_employee_active', {p_id: b.dataset.empoff, p_active: false});
      const emp = employees.find(x=>x.id===b.dataset.empoff); if(emp) emp.active=false;
      toast('Empleado dado de baja');
      if(!payData?.saved){ payData=null; refreshPayroll(); return; }
      render();
    }catch(e){}
  }));
}
/* ---------- inventory & sales engine ---------- */
const numMX = s => Number(String(s).replace(/,/g,''))||0;
const fmtNum = v => { if(v===''||v===null||v===undefined) return ''; const n=Number(v); if(isNaN(n)) return v; return n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2}); };


function weeklyRepBlock(){
  if(!repWeekly || !repWeekly.length) return '';
  const byWeek = {};
  for(const r of repWeekly){ (byWeek[r.week_start] = byWeek[r.week_start]||[]).push(r); }
  let h = `<div class="sec"><h2>Reportes semanales</h2></div>
  <div class="res-wrap"><table class="res"><thead><tr>
    <th>Semana</th><th>Sucursal</th><th>Ventas (SR)</th><th>N\u00f3mina</th><th>Mermas $</th><th></th></tr></thead><tbody>`;
  for(const [wk, rows] of Object.entries(byWeek)){
    const d = new Date(wk+'T12:00'); const e = new Date(d); e.setDate(e.getDate()+6);
    const label = d.toLocaleDateString('es-MX',{day:'numeric',month:'short'}) + ' \u2013 ' + e.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
    rows.forEach((r,i)=>{
      const merma = r.merma_impact!==null && r.merma_impact!==undefined ? Number(r.merma_impact) : null;
      h += `<tr>
        ${i===0?`<td rowspan="${rows.length}" style="font-weight:700;white-space:nowrap">${label}</td>`:''}
        <td style="text-align:left">${LOCS[r.location_id]}</td>
        <td>${r.sales_total!==null&&r.sales_total!==undefined?money(r.sales_total):'\u2014'}</td>
        <td>${r.payroll_total!==null&&r.payroll_total!==undefined?money(r.payroll_total):'\u2014'}</td>
        <td style="color:${merma!==null&&merma<0?'var(--red)':'inherit'};font-weight:700">${merma!==null?money(merma):'\u2014'}</td>
        <td><button class="rowbtn" data-repjump="${wk}|${r.location_id}">Ver</button></td></tr>`;
    });
  }
  h += `</tbody></table></div>
  <p class="hint" style="margin:8px 0 16px">"Ver" abre el reporte completo de esa semana: ventas, inventario y n\u00f3mina. </p>`;
  return h;
}
async function loadRepDetail(){
  if(repLoading) return;
  repLoading = true;
  try{
    const wkEnd = (()=>{ const d=new Date(repSel.week+'T12:00'); d.setDate(d.getDate()+6); return dstr(d); })();
    const [inv, pay, tx, cor] = await Promise.all([
      finRpc('inv_get_week', {p_week: repSel.week, p_loc: repSel.loc}),
      finRpc('fin_get_payroll', {p_week: repSel.week, p_loc: repSel.loc}),
      finRpc('fin_list_transactions', {p_from: repSel.week, p_to: wkEnd}),
      finRpc('cor_get', {p_week: repSel.week, p_loc: repSel.loc})
    ]);
    const gastos = (tx||[]).filter(t=>t.kind==='egreso' && t.location_id===repSel.loc)
      .reduce((s,t)=>s+Number(t.amount),0);
    repDetail = {inv, pay, gastos, cor};
    repLoading = false;
  }catch(e){ repLoading=false; repDetail=null; return; }
  render();
}
function repSalesReport(sales){
  if(!sales.saved) return `<div class="empty"><b>Sin ventas guardadas esta semana</b></div>`;
  const byCat = {};
  for(const it of sales.items){ const c=it.category||'OTROS'; byCat[c]=(byCat[c]||0)+Number(it.total); }
  const cats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  let h = `<div class="kpis">
    <div class="kpi in"><div class="l">Total ventas</div><div class="v">${money(sales.total_amount)}</div></div>
    <div class="kpi"><div class="l">Unidades</div><div class="v">${Number(sales.total_units).toLocaleString('es-MX')}</div></div>
    <div class="kpi"><div class="l">Productos</div><div class="v">${sales.items.length}</div></div></div>`;
  if(cats.length){
    const max = cats[0][1];
    h += `<div class="panel"><div class="hint" style="font-weight:700">Ventas por categor\u00eda</div><div class="bars">`;
    h += cats.map(([c,v])=>`<div class="b"><span>${esc(c)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(4,Math.round(v/max*100))}%;background:var(--ok)"></span></span><span class="amt2">${money(v)}</span></div>`).join('');
    h += `</div></div>`;
  }
  const top = [...sales.items].filter(i=>Number(i.qty)>0).sort((a,b)=>Number(b.qty)-Number(a.qty)).slice(0,10);
  if(top.length){
    h += `<div class="panel"><div class="hint" style="font-weight:700">Top 10 productos m\u00e1s vendidos</div>
    <div class="res-wrap" style="margin:0"><table class="res"><thead><tr><th>#</th><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead><tbody>
    ${top.map((i,ix)=>`<tr><td>${ix+1}</td><td style="text-align:left">${esc(i.name)}</td><td>${Number(i.qty)}</td><td class="tot2">${money(i.total)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
  return h;
}
function repInvReport(inv, loc){
  if(!inv.inventory.saved) return `<div class="empty"><b>Sin inventario guardado esta semana</b></div>`;
  const rowsById = Object.fromEntries((inv.inventory.rows||[]).map(r=>[r.ingredient_id, r]));
  const ings = catalog.ingredients.filter(i=>i.location_id===loc && rowsById[i.id]);
  let mermaNeg=0, mermaNet=0;
  const rows = [];
  for(const ing of ings){
    const r = rowsById[ing.id];
    const teo = Number(r.initial)+Number(r.purchases)-Number(r.consumed);
    const dif = (r.physical===null||r.physical===undefined) ? null : Number(r.physical)-teo;
    const imp = dif===null ? null : dif*Number(ing.price||0);
    if(imp!==null){ mermaNet+=imp; if(imp<0) mermaNeg+=imp; }
    rows.push({ing, r, teo, dif, imp});
  }
  const ventas = Number(inv.sales.total_amount||0);
  let h = `<div class="kpis">
    <div class="kpi out-k"><div class="l">Mermas (faltantes)</div><div class="v">${money(mermaNeg)}</div><div class="hint">${ventas>0?(Math.abs(mermaNeg)/ventas*100).toFixed(2)+'% de ventas':''}</div></div>
    <div class="kpi"><div class="l">Impacto neto</div><div class="v">${money(mermaNet)}</div></div>
    <div class="kpi"><div class="l">Insumos contados</div><div class="v">${rows.filter(r=>r.dif!==null).length} / ${rows.length}</div></div></div>`;
  h += `<div class="res-wrap"><table class="res inv-tbl"><thead><tr>
    <th>Insumo</th><th>Inicial</th><th>Compras</th><th>Consumo</th><th>Te\u00f3rico</th><th>F\u00edsico</th><th>Dif.</th><th>Impacto</th></tr></thead><tbody>`;
  for(const x of rows){
    h += `<tr><td>${esc(x.ing.name)} <span class="ps" style="font-size:12px;color:var(--ink-2)">${esc(x.ing.unit)}</span></td>
      <td>${x.r.initial}</td><td>${x.r.purchases}</td><td>${x.r.consumed}</td><td>${Math.round(x.teo*100)/100}</td>
      <td>${x.r.physical===null||x.r.physical===undefined?'\u2014':x.r.physical}</td>
      <td style="color:${x.dif===null?'inherit':(x.dif<0?'var(--red)':'var(--ok)')};font-weight:700">${x.dif===null?'\u2014':Math.round(x.dif*100)/100}</td>
      <td class="tot2" style="color:${x.imp===null?'inherit':(x.imp<0?'var(--red)':'var(--ok)')}">${x.imp===null?'\u2014':money(x.imp)}</td></tr>`;
  }
  h += `</tbody><tfoot><tr><td colspan="7">Impacto neto</td><td class="tot2" style="color:${mermaNet<0?'var(--red)':'var(--ok)'}">${money(mermaNet)}</td></tr></tfoot></table></div>`;
  return h;
}
function repPayReport(pay){
  if(!pay.saved) return `<div class="empty"><b>Sin n\u00f3mina guardada esta semana</b></div>`;
  const items = pay.items||[];
  const tot = items.reduce((s,i)=>s+Number(i.base||0)+Number(i.extras||0)-Number(i.deductions||0),0);
  let h = `<div class="res-wrap"><table class="res"><thead><tr>
    <th>Empleado</th><th>Horas</th><th>H. Extra</th><th>Sueldo</th><th>Extras</th><th>Deducciones</th><th>Total</th></tr></thead><tbody>`;
  for(const i of items){
    h += `<tr><td>${esc(i.name)}</td><td>${i.hours??'\u2014'}</td><td>${i.extra_hours??'\u2014'}</td>
      <td>${money(i.base)}</td><td>${money(i.extras)}</td><td>${money(i.deductions)}</td>
      <td class="tot2">${money(Number(i.base)+Number(i.extras)-Number(i.deductions))}</td></tr>`;
  }
  h += `</tbody><tfoot><tr><td colspan="6">Total n\u00f3mina</td><td class="tot2">${money(tot)}</td></tr></tfoot></table></div>`;
  return h;
}
function repDetailView(){
  let h = '';
  if(!repDetail){ return `<div class="empty"><b>Cargando reporte\u2026</b></div>`; }
  h += `<div class="frm-row" style="margin-bottom:12px"><button class="btn-quiet" id="repPrint">Imprimir reporte de la semana</button><span></span></div>`;
  {
    const ventas = repDetail.inv.sales.saved ? Number(repDetail.inv.sales.total_amount) : 0;
    const gastos = Number(repDetail.gastos||0);
    const util = ventas - gastos;
    h += `<div class="kpis">
      <div class="kpi in"><div class="l">Ventas</div><div class="v">${money(ventas)}</div></div>
      <div class="kpi out-k"><div class="l">Gastos de la semana</div><div class="v">${money(gastos)}</div><div class="hint">incluye n\u00f3mina y compras registradas</div></div>
      <div class="kpi" style="border-top:4px solid ${util>=0?'var(--ok)':'var(--red)'}"><div class="l">Utilidad estimada</div><div class="v" style="color:${util>=0?'var(--ok)':'var(--red)'}">${money(util)}</div></div>
    </div>`;
  }
  // Collapsible sections — inventory open by default, others collapsed
  const repSection = (id, label, badge, content, open=false) =>
    `<div class="rep-sec">
      <div class="rep-sec-hdr" id="rsh-${id}" aria-expanded="${open}" onclick="
        const h=this; const b=h.nextElementSibling;
        const o=h.getAttribute('aria-expanded')==='true';
        h.setAttribute('aria-expanded',!o);
        b.style.display=o?'none':'block';
      ">
        <h2>${label}</h2>
        ${badge?`<span class="rep-badge">${badge}</span>`:''}
        <span class="rep-chev">›</span>
      </div>
      <div class="rep-sec-body" style="display:${open?'block':'none'}">${content}</div>
    </div>`;

  h += repSection('ventas', 'Ventas', null, repSalesReport(repDetail.inv.sales), false);
  h += repSection('inv', 'Inventario', '21 insumos', repInvReport(repDetail.inv, repSel.loc), false);
  h += repSection('nom', 'Nómina', null, repPayReport(repDetail.pay), false);
  h += repSection('cor', 'Corte de caja', null, repCorReport(repDetail.cor), false);
  return h;
}
function repCorReport(cor){
  if(!cor || !cor.saved) return `<div class="empty"><b>Sin corte de caja guardado esta semana</b>Se captura en la pesta\u00f1a Corte.</div>`;
  const tc = cor.tc_days||{};
  const days = ['lun','mar','mie','jue','vie','sab','dom'];
  const tcReal = days.reduce((s,k)=>s+Number(tc[k]||0),0);
  const difEf = cor.ef_real===null||cor.ef_real===undefined ? null : Number(cor.ef_real) - Number(cor.ef_final_decl);
  const difTj = tcReal - Number(cor.tj_decl);
  const col = v => v===null ? 'inherit' : (Math.abs(v)<1 ? 'var(--ok)' : (v<0?'var(--red)':'var(--warn)'));
  let h = `<div class="kpis">
    <div class="kpi"><div class="l">Efectivo: corte vs real</div><div class="v">${money(cor.ef_final_decl)} \u2192 ${cor.ef_real!==null&&cor.ef_real!==undefined?money(cor.ef_real):'\u2014'}</div>
      <div class="hint" style="color:${col(difEf)};font-weight:700">${difEf===null?'':('dif ' + money(difEf))}</div></div>
    <div class="kpi"><div class="l">Tarjeta: cajera vs terminal</div><div class="v">${money(cor.tj_decl)} \u2192 ${money(tcReal)}</div>
      <div class="hint" style="color:${col(difTj)};font-weight:700">dif ${money(difTj)}</div></div>
    <div class="kpi"><div class="l">Ventas con IVA</div><div class="v">${cor.venta_imp?money(cor.venta_imp):money(cor.venta_neta)}</div><div class="hint">${cor.venta_imp?"con impuestos incluidos":"venta neta (sin IVA)"}</div></div>
  </div>`;
  h += `<div class="res-wrap"><table class="res"><thead><tr>${days.map(d2=>`<th>${d2.toUpperCase()}</th>`).join('')}<th>Total TC</th></tr></thead>
    <tbody><tr>${days.map(d2=>`<td>${money(tc[d2]||0)}</td>`).join('')}<td class="tot2">${money(tcReal)}</td></tr></tbody></table></div>`;
  h += `<div class="panel"><div class="hint">Dep\u00f3sitos efectivo: <b>${money(cor.depositos)}</b> \u00b7 Retiros: <b>${money(cor.retiros)}</b></div>
    ${cor.notes?`<p class="hint" style="white-space:pre-wrap"><b>Ajustes/notas:</b> ${esc(cor.notes)}</p>`:''}</div>`;
  return h;
}
function repWeekNav(){
  const d = new Date(repSel.week+'T12:00'); const e = new Date(d); e.setDate(e.getDate()+6);
  const fmt = x=>x.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  return `<div class="weeknav">
    <button data-rwk="-1" aria-label="Semana anterior">\u2039</button>
    <b>Semana del ${fmt(d)} al ${fmt(e)}</b>
    <button data-rwk="1" aria-label="Semana siguiente">\u203a</button></div>`;
}
function printWeeklyReport(){
  if(!repDetail) return;
  const d = new Date(repSel.week+'T12:00'); const e = new Date(d); e.setDate(e.getDate()+6);
  const label = d.toLocaleDateString('es-MX',{day:'numeric',month:'short'}) + ' al ' + e.toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'});
  const inv = repDetail.inv, pay = repDetail.pay;
  const payItems = pay.saved ? pay.items : [];
  const payTot = payItems.reduce((s,i)=>s+Number(i.base||0)+Number(i.extras||0)-Number(i.deductions||0),0);
  const rowsById = Object.fromEntries((inv.inventory.rows||[]).map(r=>[r.ingredient_id, r]));
  const ings = catalog.ingredients.filter(i=>i.location_id===repSel.loc && rowsById[i.id]);
  let mermaNet=0;
  const invRows = ings.map(ing=>{
    const r = rowsById[ing.id];
    const teo = Number(r.initial)+Number(r.purchases)-Number(r.consumed);
    const dif = (r.physical===null||r.physical===undefined)?null:Number(r.physical)-teo;
    const imp = dif===null?null:dif*Number(ing.price||0);
    if(imp!==null) mermaNet+=imp;
    return {ing,r,teo,dif,imp};
  });
  $('#printArea').innerHTML = `<div class="rc">
    <h1>Reporte Semanal \u2014 ${esc(LOCS[repSel.loc])}</h1>
    <div class="sub2">${esc(EMPRESA)} \u00b7 Semana del ${label}</div>
    <table><tr><th>Ventas</th><td class="num">${inv.sales.saved?money(inv.sales.total_amount):'\u2014'}</td>
    <th>N\u00f3mina</th><td class="num">${pay.saved?money(payTot):'\u2014'}</td>
    <th>Mermas (neto)</th><td class="num">${inv.inventory.saved?money(mermaNet):'\u2014'}</td>
    <th>Gastos sem.</th><td class="num">${money(Number(repDetail.gastos||0))}</td>
    <th>Utilidad est.</th><td class="num">${money((inv.sales.saved?Number(inv.sales.total_amount):0) - Number(repDetail.gastos||0))}</td></tr></table>
    ${inv.inventory.saved?`<table><tr><th>Insumo</th><th>Inicial</th><th>Compras</th><th>Consumo</th><th>Te\u00f3rico</th><th>F\u00edsico</th><th>Dif.</th><th>Impacto</th></tr>
    ${invRows.map(x=>`<tr><td>${esc(x.ing.name)}</td><td class="num">${x.r.initial}</td><td class="num">${x.r.purchases}</td><td class="num">${x.r.consumed}</td><td class="num">${Math.round(x.teo*100)/100}</td><td class="num">${x.r.physical??'\u2014'}</td><td class="num">${x.dif===null?'\u2014':Math.round(x.dif*100)/100}</td><td class="num">${x.imp===null?'\u2014':money(x.imp)}</td></tr>`).join('')}</table>`:''}
    ${pay.saved?`<table><tr><th>Empleado</th><th>Horas</th><th>Sueldo</th><th>Extras</th><th>Deducciones</th><th>Total</th></tr>
    ${payItems.map(i=>`<tr><td>${esc(i.name)}</td><td class="num">${i.hours??'\u2014'}</td><td class="num">${money(i.base)}</td><td class="num">${money(i.extras)}</td><td class="num">${money(i.deductions)}</td><td class="num">${money(Number(i.base)+Number(i.extras)-Number(i.deductions))}</td></tr>`).join('')}
    <tr class="total-row"><td colspan="5">TOTAL N\u00d3MINA</td><td class="num">${money(payTot)}</td></tr></table>`:''}
  </div>`;
  window.print();
}
function repView(){
  if(!repSel) repSel = {week: dstr(mondayOf(new Date())), loc: finLoc};
  if(repSel.loc !== finLoc){ repSel = {week: repSel.week, loc: finLoc}; repDetail = null; }
  let html = locSwitch(finLoc,'floc') + repWeekNav() + repDetailView();
  return html;
}
function exportCsv(){
  const rows = [['fecha','sucursal','tipo','categoria','concepto','monto','registrado_por']];
  for(const t of [...txMonth].sort((a,b)=>a.tx_date.localeCompare(b.tx_date))){
    rows.push([t.tx_date, LOCS[t.location_id], t.kind, CAT_LABEL[t.category]||t.category,
               (t.concept||'').replaceAll('"','""'), Number(t.amount).toFixed(2), t.created_by||'']);
  }
  const csv = '\uFEFF' + rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  a.download = finRange ? `boyes_movimientos_${finRange.from}_a_${finRange.to}.csv` : `boyes_movimientos_${finMonth}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- render ---------- */
