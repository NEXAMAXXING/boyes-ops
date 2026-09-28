/* ============================================================
   Boye's OPS — Gráficas de la Planilla
   ------------------------------------------------------------
   La cuadrícula sigue siendo la mejor forma de CAPTURAR 31 días
   por 25 conceptos. Lo que faltaba era no tener que LEERLA para
   saber cómo va el mes.

   Sin librerías: son SVG dibujados a mano. Una librería de
   gráficas pesa más que toda esta app junta, y aquí solo hacen
   falta barras, una línea y un apilado.
   ============================================================ */

/* Paleta categórica validada (contraste, banda de luminosidad y separación
   para daltonismo). El orden es FIJO: el azul siempre es lo mismo, el naranja
   siempre es lo mismo. Nunca se recicla ni se reordena por tamaño. */
const G_AZUL = '#2a78d6', G_NARANJA = '#eb6834',
      G_VERDE = '#1baf7a', G_AMBAR = '#eda100';
const G_TINTA = '#1B2432', G_TINTA2 = '#5B6472', G_LINEA = '#E3DFD5';

const gMes = ym => {
  const [y,m] = ym.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleDateString('es-MX',{month:'short'}) + ' ' + String(y).slice(2);
};
const gMoneyCorto = n => {
  const a = Math.abs(n);
  if(a >= 1000000) return '$' + (n/1000000).toFixed(1).replace(/\.0$/,'') + 'M';
  if(a >= 1000)    return '$' + Math.round(n/1000) + 'k';
  return '$' + Math.round(n);
};

/* ---------- barras verticales, una por día ---------- */
function gBarrasDia(datos, opts){
  const o = opts||{};
  if(!datos.length) return '';
  const W = Math.max(560, datos.length*26), H = 190, PB = 26, PT = 22;
  const max = Math.max(...datos.map(d=>d.valor), 1);
  const bw = Math.max(8, (W/datos.length) - 7);
  /* La barra más alta y la de hoy se rotulan; las demás no. Un número sobre
     cada barra convierte la gráfica en una tabla peor hecha. */
  const iMax = datos.reduce((b,d,i)=>datos[b].valor>=d.valor?b:i, 0);
  return `<div class="g-scroll"><svg class="g-svg" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${esc(o.titulo||'Por día')}">
    <line x1="0" y1="${H-PB}" x2="${W}" y2="${H-PB}" stroke="${G_LINEA}" stroke-width="1"></line>
    ${datos.map((d,i)=>{
      const h = Math.max(2, (d.valor/max)*(H-PB-PT));
      const x = i*(W/datos.length) + 3, y = H-PB-h;
      const col = d.color || G_AZUL;
      return `<g class="g-bar"><title>${esc(d.etiqueta)} · ${money(d.valor)}</title>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"
              rx="4" fill="${col}"></rect>
        ${i===iMax&&d.valor>0?`<text x="${(x+bw/2).toFixed(1)}" y="${(y-6).toFixed(1)}"
              text-anchor="middle" font-size="11" font-weight="800" fill="${G_TINTA}">${gMoneyCorto(d.valor)}</text>`:''}
        <text x="${(x+bw/2).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="10"
              fill="${d.fin?G_TINTA:G_TINTA2}" font-weight="${d.fin?'800':'500'}">${esc(d.etiqueta)}</text>
      </g>`;
    }).join('')}
  </svg></div>`;
}

/* ---------- línea de meses ---------- */
function gLinea(datos){
  if(datos.length < 2) return `<p class="hint">Con un solo mes no hay tendencia que dibujar.</p>`;
  /* Los rótulos van centrados sobre cada punto, así que el primero y el último
     necesitan medio rótulo de aire a cada lado o se cortan contra el borde. */
  const W = Math.max(520, datos.length*84), H = 200, PB = 30, PT = 26, PL = 34, PR = 34;
  const vals = datos.map(d=>d.valor);
  const max = Math.max(...vals), min = Math.min(...vals, 0);
  const rango = (max-min)||1;
  const px = i => PL + (i/(datos.length-1))*(W-PL-PR);
  const py = v => H-PB - ((v-min)/rango)*(H-PB-PT);
  const pts = datos.map((d,i)=>[px(i), py(d.valor)]);
  const d1 = pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return `<div class="g-scroll"><svg class="g-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Venta por mes">
    <path d="${d1} L${pts[pts.length-1][0].toFixed(1)},${H-PB} L${pts[0][0].toFixed(1)},${H-PB} Z"
          fill="${G_AZUL}" opacity=".10"></path>
    <path d="${d1}" fill="none" stroke="${G_AZUL}" stroke-width="2.5"
          stroke-linejoin="round" stroke-linecap="round"></path>
    ${pts.map((p,i)=>`<g><title>${esc(datos[i].etiqueta)} · ${money(datos[i].valor)}</title>
      <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i===pts.length-1?5:4}"
              fill="${G_AZUL}" stroke="#fff" stroke-width="2"></circle>
      <text x="${p[0].toFixed(1)}" y="${(p[1]-12).toFixed(1)}" text-anchor="middle"
            font-size="11" font-weight="800" fill="${G_TINTA}">${gMoneyCorto(datos[i].valor)}</text>
      <text x="${p[0].toFixed(1)}" y="${H-10}" text-anchor="middle" font-size="11"
            fill="${G_TINTA2}" font-weight="600">${esc(datos[i].etiqueta)}</text></g>`).join('')}
  </svg></div>`;
}

/* ---------- barras horizontales con rótulo directo ---------- */
function gBarrasH(datos, color){
  if(!datos.length) return `<p class="hint">Sin datos capturados.</p>`;
  const max = Math.max(...datos.map(d=>d.valor), 1);
  const tot = datos.reduce((s,d)=>s+d.valor, 0);
  return `<div class="g-hb">${datos.map(d=>`
    <div class="g-hb-r" title="${esc(d.nombre)} · ${money(d.valor)}">
      <span class="g-hb-n">${esc(d.nombre)}</span>
      <span class="g-hb-v">${money(d.valor)}</span>
      <span class="g-hb-t"><span class="g-hb-f" style="width:${Math.max(1.5,(d.valor/max)*100)}%;background:${d.color||color||G_NARANJA}"></span></span>
      <span class="g-hb-p">${tot?((d.valor/tot)*100).toFixed(1)+'%':''}</span>
    </div>`).join('')}</div>`;
}

/* ---------- dos series apiladas (efectivo / tarjeta) ---------- */
function gApilado(a, b, etA, etB){
  const tot = a+b;
  if(!tot) return `<p class="hint">Sin ventas capturadas este mes.</p>`;
  const pa = a/tot*100;
  return `<div>
    <div class="g-stack">
      <span style="width:${pa}%;background:${G_VERDE}" title="${etA} ${money(a)}"></span>
      <span style="width:${100-pa}%;background:${G_AZUL}" title="${etB} ${money(b)}"></span>
    </div>
    <div class="g-leyenda">
      <span><i style="background:${G_VERDE}"></i>${etA} <b>${money(a)}</b> · ${pa.toFixed(1)}%</span>
      <span><i style="background:${G_AZUL}"></i>${etB} <b>${money(b)}</b> · ${(100-pa).toFixed(1)}%</span>
    </div></div>`;
}

/* ============================================================
   La vista de resumen del mes
   ============================================================ */
let gHist = null, gHistCargando = false;

/* Los meses anteriores se piden una sola vez y se quedan en memoria: son de
   otros renglones de la tabla, no del mes que se está editando. */
async function gCargaHistoria(){
  if(gHistCargando) return;
  gHistCargando = true;
  try{
    const {data} = await sb.from('planilla_months')
      .select('year_month,ventas').eq('location_id', finLoc).order('year_month');
    gHist = (data||[]).map(r=>{
      let ef=0, tj=0, ra=0;
      for(const d of Object.values(r.ventas||{})){
        ef += planN(d.ef); tj += planN(d.tj); ra += planN(d.ra);
      }
      return { ym: r.year_month, total: ef+tj+ra, ef, tj, ra };
    }).filter(x=>x.total>0);
  }catch(e){ gHist = []; }
  finally{ gHistCargando = false; }
  render();
}

function planViewGraf(){
  if(gHist === null){ gCargaHistoria();
    return `<div class="panel"><p class="hint">Cargando los meses anteriores…</p></div>`; }

  const v = planEdit.ventas||{}, g = planEdit.gastos_var||{};
  const dias = planDays(planMonth);

  /* --- serie diaria del mes --- */
  const serie = [];
  let ef=0, tj=0, ra=0;
  for(let d=1; d<=dias; d++){
    const x = v[d]||{};
    const t = planN(x.ef)+planN(x.tj)+planN(x.ra);
    ef += planN(x.ef); tj += planN(x.tj); ra += planN(x.ra);
    const dow = planDowShort(planMonth, d);
    serie.push({ etiqueta: String(d), valor: t, fin: dow==='S'||dow==='D',
                 color: (dow==='S'||dow==='D') ? G_NARANJA : G_AZUL });
  }
  const vtMes = ef+tj+ra;

  /* --- gastos por categoría --- */
  const porCat = Object.entries(g).map(([cat, dd])=>({
    nombre: cat,
    valor: Object.values(dd||{}).reduce((s,x)=>s+planN(x), 0)
  })).filter(x=>x.valor>0).sort((a,b)=>b.valor-a.valor);
  const totGV = porCat.reduce((s,x)=>s+x.valor, 0);
  const totFijos = Object.values(planEdit.gastos_fijos||{}).reduce((s,r)=>s+planN(r.monto), 0);
  const util = vtMes - totGV - totFijos;

  /* --- mes contra mes --- */
  const hist = gHist.slice(-12).map(x=>({ etiqueta: gMes(x.ym), valor: x.total, ym: x.ym }));
  const iAct = hist.findIndex(x=>x.ym===planMonth);
  const prev = iAct>0 ? hist[iAct-1] : (iAct===-1 && hist.length ? hist[hist.length-1] : null);
  const dPctMes = (prev && prev.valor) ? (vtMes-prev.valor)/prev.valor*100 : null;

  const diasCon = serie.filter(s=>s.valor>0).length;
  const mejor = serie.reduce((b,s)=>s.valor>b.valor?s:b, {valor:0,etiqueta:'—'});

  let h = `<div class="g-kpis">
    ${gKpi('Venta del mes', money(vtMes), dPctMes===null ? `${diasCon} días capturados`
       : `<b style="color:${dPctMes>=0?G_VERDE:'#D43E3E'}">${dPctMes>=0?'▲ +':'▼ '}${dPctMes.toFixed(1)}%</b> contra ${prev.etiqueta}`)}
    ${gKpi('Promedio por día', diasCon?money(vtMes/diasCon):'—', `sobre ${diasCon} día${diasCon===1?'':'s'} con venta`)}
    ${gKpi('Mejor día', mejor.valor?money(mejor.valor):'—', mejor.valor?`día ${mejor.etiqueta} del mes`:'sin capturar')}
    ${gKpi('Utilidad estimada', money(util),
       vtMes ? `${(util/vtMes*100).toFixed(1)}% de la venta` : 'falta capturar la venta',
       util>=0?G_VERDE:'#D43E3E')}
  </div>`;

  h += `<div class="panel"><div class="g-t">Venta día por día · ${gMes(planMonth)}</div>
    <p class="hint" style="margin:0 0 10px">Los <b style="color:${G_NARANJA}">sábados y domingos</b> van en naranja. Pasa el dedo o el cursor por una barra para ver el monto.</p>
    ${gBarrasDia(serie, {titulo:'Venta por día'})}</div>`;

  h += `<div class="g-cols">
    <div class="panel"><div class="g-t">Cómo te pagaron</div>
      ${gApilado(ef, tj, 'Efectivo', 'Tarjeta')}
      ${ra>0?`<p class="hint" style="margin:10px 0 0">Rappi: <b>${money(ra)}</b></p>`:''}</div>
    <div class="panel"><div class="g-t">Venta por mes</div>
      ${gLinea(hist)}</div>
  </div>`;

  h += `<div class="panel"><div class="g-t">A dónde se fue el dinero</div>
    <p class="hint" style="margin:0 0 12px">Gastos variables del mes, de mayor a menor. Total <b>${money(totGV)}</b>${vtMes?` · <b>${(totGV/vtMes*100).toFixed(1)}%</b> de la venta`:''}.</p>
    ${gBarrasH(porCat.slice(0,15), G_NARANJA)}
    ${porCat.length>15?`<p class="hint" style="margin-top:10px">Se muestran los 15 más grandes de ${porCat.length}.</p>`:''}</div>`;

  return h;
}

function gKpi(rotulo, valor, pie, color){
  return `<div class="g-kpi">
    <div class="g-kpi-l">${rotulo}</div>
    <div class="g-kpi-v" ${color?`style="color:${color}"`:''}>${valor}</div>
    <div class="g-kpi-p">${pie||''}</div></div>`;
}
