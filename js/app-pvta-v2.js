/* ============================================================
   Boye's OPS — Ventas de la Planilla desde el punto de venta
   ------------------------------------------------------------
   Karen captura a mano el efectivo y la tarjeta de cada día. El
   punto de venta ya tiene ese dato exacto. Esto lo trae y —esto
   es lo importante— NO lo escribe solo: enseña día por día dónde
   el POS y Karen no coinciden, y Rod decide cuál se queda.

   Escribir encima sin preguntar sería más rápido y peor: si ella
   ajustó algo a propósito, se borraría sin dejar rastro, y la
   diferencia entre el POS y lo capturado es justo el lugar donde
   aparecen los errores que vale la pena ver.
   ============================================================ */

let pvData = null;      // 'AAAA-MM-DD' -> respuesta del POS (o {error})
let pvCarga = false, pvError = null, pvClave = null;

/* ------------------------------------------------------------------
   Por qué aceptar del POS está bajo llave.

   El reporte oficial de Soft de marzo (San Carlos) dice $506,162.01
   sin impuestos y 988 cuentas. Con IVA son $587,147.76, y la planilla
   trae $585,007.60: cuadran al 0.37%, y día por día dentro del medio
   por ciento. La captura de la administración es correcta.

   Lo que estaba mal era la consulta: yo pedía el día de 00:00 a 23:59
   del calendario, y el día de negocio de un restaurante termina de
   madrugada. Eso partía los fines de semana a la mitad. Ya se corrigió
   con una hora de corte calibrada contra ese mismo reporte.

   Aun así el botón sigue bajo llave: hasta que la calibración cuadre
   el conteo de cuentas contra el reporte, aceptar el número del POS
   puede romper un dato bueno. Se destraba a propósito, no por descuido.
   ------------------------------------------------------------------ */
let pvDestrabado = false;

function pvSuc(){ return Number(finLoc) === 2 ? 'sancarlos' : 'guaymas'; }

/* Cada respuesta del POS trae escrito de qué sucursal es. Se compara contra la
   que está en pantalla ANTES de enseñar nada: comparar el punto de venta de
   Guaymas contra la planilla de San Carlos no produce un error visible, produce
   una tabla llena de rojos que parecen hallazgos y no lo son. Pasó, y por eso
   esta comprobación existe. */
function pvSucDe(D){ return D && !D.error ? (D.sucursal || null) : null; }
function pvSucOk(){
  const esperada = pvSuc();
  for(const D of Object.values(pvData || {})){
    const s = pvSucDe(D);
    if(s && s !== esperada) return s;      // devuelve la intrusa
  }
  return null;
}

function pvFecha(d){
  return `${planMonth}-${String(d).padStart(2,'0')}`;
}

/* Lo que el POS propone para cada renglón de la planilla.
   EFECTIVO lleva las transferencias sumadas porque así se declaran en el corte
   —en caja las cobran como si fuera efectivo—, y así es como Karen las venía
   capturando. La partida se muestra desglosada para que no quede escondida. */
function pvPropone(D){
  if(!D || D.error) return null;
  const p = D.pagos || {};
  const rappi = Object.entries(D.otros_detalle || {})
    .filter(([k]) => /RAPPI|DIDI|UBER/i.test(k))
    .reduce((s,[,v]) => s + Number(v||0), 0);
  return {
    ef: Math.round((Number(p.efectivo||0) + Number(p.transferencia||0)) * 100) / 100,
    tj: Math.round(Number(p.tarjeta||0) * 100) / 100,
    ra: Math.round(rappi * 100) / 100,
    transferencia: Math.round(Number(p.transferencia||0) * 100) / 100,
    ventas: Number(D.ventas||0),
    total: Number(D.total||0)
  };
}

async function pvJala(dias){
  if(pvCarga) return;
  pvCarga = true; pvError = null; pvData = {};
  pvClave = `${finLoc}|${planMonth}|${dias[0]}-${dias[dias.length-1]}`;
  render();
  const suc = pvSuc();
  let fallos = 0, motivo = '';
  for(const d of dias){
    const f = pvFecha(d);
    try{
      /* La misma hora de corte que calibró la pestaña de Tarjeta: si el día de
         negocio termina a las 5 de la mañana, aquí también. */
      const c = typeof corteHora !== 'undefined' ? corteHora : 0;
      const r = await fetch(`/api/soft-ventas?sucursal=${suc}&fecha=${f}&productos=0&corte=${c}&token=${encodeURIComponent(user.token)}`);
      const j = await r.json().catch(()=>null);
      if(j?.error) throw new Error(j.error + (j.msg ? ' — ' + j.msg : ''));
      if(!r.ok) throw new Error('el servidor contestó ' + r.status);
      pvData[f] = j;
    }catch(e){
      pvData[f] = {error: e.message || 'sin detalle'};
      fallos++; motivo = e.message || 'sin detalle';
    }
  }
  pvCarga = false;
  if(fallos === dias.length){
    pvData = null;
    pvError = 'No se pudo traer del punto de venta — ' + motivo;
  }
  render();
}

/* Compara un valor capturado contra el del POS. Devuelve el estado, que es lo
   que decide el color y si hay algo que aceptar. */
function pvEstado(cap, pos){
  const c = planN(cap), p = Number(pos||0);
  if(!c && !p) return 'nada';
  if(!c && p)  return 'vacio';          // el POS tiene el dato y la planilla no
  if(c && !p)  return 'sobra';          // capturado sin respaldo del POS
  return Math.abs(c - p) < 0.5 ? 'igual' : 'difiere';
}

const PV_CAMPOS = [['ef','EFECTIVO'], ['tj','TARJETA'], ['ra','RAPPI']];

function pvPanel(w){
  const dias = w.days;
  const mia = `${finLoc}|${planMonth}|${dias[0]}-${dias[dias.length-1]}`;
  const vigente = pvData && pvClave === mia;

  let h = `<style>
    .pv-b{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px}
    .pv-t td,.pv-t th{font-variant-numeric:tabular-nums lining-nums}
    .pv-cel{display:flex;gap:6px;align-items:center;justify-content:flex-end}
    .pv-mini{border:0;background:var(--navy);color:#fff;border-radius:6px;padding:2px 7px;
             font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap}
    .pv-mini:hover{background:#0F2440}
    .pv-ok{color:#0B6E3F;font-weight:800}
    .pv-dif{color:#C0261F;font-weight:800}
    .pv-vac{color:#8A5A00;font-weight:800}
    .pv-sob{color:#C0261F;font-weight:800}
  </style>`;

  h += `<div class="panel"><div class="d-h3">Ventas del punto de venta · semana ${w.wk}
    <span style="font-weight:700;color:var(--ink-2)">· ${esc(LOCS[finLoc]||'')}</span></div>`;

  /* Si lo cargado no es de esta sucursal, no se compara nada. */
  const intrusa = vigente ? pvSucOk() : null;
  if(intrusa){
    return h + `<div class="panel" style="border-left:4px solid ${D_ROJO};background:#FFF6F5;margin:10px 0">
      <p style="margin:0;font-weight:800">Lo que está cargado es de otra sucursal.</p>
      <p class="hint" style="margin:6px 0 0">Estos datos vinieron de <b>${esc(intrusa)}</b> y la planilla en
      pantalla es de <b>${esc(LOCS[finLoc]||'')}</b>. No los comparo: sería inventar diferencias.</p>
      <div class="frm-row" style="margin-top:10px"><button class="btn-primary" id="pvOtra">↻ Consultar ${esc(LOCS[finLoc]||'')}</button></div>
    </div></div>`;
  }

  if(!vigente){
    h += `<p class="hint" style="margin:0 0 10px">Trae del punto de venta el efectivo y la tarjeta de estos
      ${dias.length} días y te enseña dónde no coincide con lo capturado. No escribe nada solo: tú decides
      qué se queda.</p>
      <div class="pv-b"><button class="btn-primary" id="pvJalar" ${pvCarga?'disabled':''}>
        ${pvCarga?'Consultando el punto de venta…':'↓ Traer ventas del punto de venta'}</button></div>`;
    if(pvError) h += `<p style="color:${D_ROJO};font-weight:700;margin:0">${esc(pvError)}</p>`;
    return h + `</div>`;
  }

  /* Los renglones de la comparación, ya resueltos: así el resumen de arriba y
     la tabla de abajo cuentan lo mismo. */
  const filas = dias.map(d=>{
    const f = pvFecha(d), D = pvData[f], P = pvPropone(D);
    const cap = planEdit.ventas?.[d] || {};
    const campos = {};
    for(const [k] of PV_CAMPOS){
      campos[k] = {cap: planN(cap[k]), pos: P ? P[k] : null, est: P ? pvEstado(cap[k], P[k]) : 'error'};
    }
    return {d, f, dow: planDowShort(planMonth, d), error: D?.error || null, P, campos};
  });

  const pendientes = filas.flatMap(r => PV_CAMPOS
    .filter(([k]) => ['vacio','difiere'].includes(r.campos[k].est))
    .map(([k]) => ({d: r.d, k})));
  const nVacios  = filas.flatMap(r => PV_CAMPOS.filter(([k]) => r.campos[k].est === 'vacio')).length;
  const nDif     = filas.flatMap(r => PV_CAMPOS.filter(([k]) => r.campos[k].est === 'difiere')).length;
  const nIgual   = filas.flatMap(r => PV_CAMPOS.filter(([k]) => r.campos[k].est === 'igual')).length;
  /* Capturado sin respaldo del POS. No se ofrece "usar" para esto —poner cero
     encima de lo que alguien capturó a propósito no es aceptar un dato, es
     borrarlo— pero tampoco se deja pasar de largo: es el caso que más vale la
     pena revisar. */
  const nSobra   = filas.flatMap(r => PV_CAMPOS.filter(([k]) => r.campos[k].est === 'sobra')).length;
  const conError = filas.filter(r => r.error).length;

  h += `<p class="hint" style="margin:0 0 10px">
    <b class="pv-ok">${nIgual} coinciden</b> ·
    <b class="pv-vac">${nVacios} el POS los tiene y la planilla no</b> ·
    <b class="pv-dif">${nDif} no cuadran</b>${nSobra?` · <b class="pv-sob">${nSobra} capturados que el POS no tiene</b>`:''}${conError?` · ${conError} día${conError===1?' no contestó':'s no contestaron'}`:''}.
    El efectivo del POS lleva sumadas las transferencias, porque en caja se cobran como efectivo y así se
    declaran en el corte.</p>`;

  /* La advertencia va arriba de los botones y no en letra chica: sin ella, un
     clic bien intencionado sustituye datos buenos por datos incompletos. */
  h += `<div class="panel" style="border-left:4px solid ${D_ROJO};background:#FFF6F5;margin:0 0 12px">
    <p style="margin:0 0 6px;font-weight:800;font-size:13.5px">Antes de aceptar nada: calibra el día de negocio.</p>
    <p class="hint" style="margin:0">El reporte oficial de Soft de marzo (San Carlos) da <b>$587,147.76</b> con
    IVA y la planilla <b>$585,007.60</b>: cuadran al <b>0.37%</b>. La captura está bien. Lo que estaba mal era
    mi consulta —pedía el día de 00:00 a 23:59 del calendario, cuando el día de negocio termina de madrugada—.
    Ve a la pestaña <b>💳 Tarjeta</b>, suelta ahí el reporte del mes y deja que calibre la hora de corte.
    Hasta que el conteo de cuentas cuadre contra ese reporte, aceptar el número del POS puede romper un dato bueno.</p>
    <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:12.5px;cursor:pointer">
      <input type="checkbox" id="pvDestraba" ${pvDestrabado?'checked':''} style="margin-top:2px">
      <span>Ya lo sé — déjame aceptar del POS de todas formas.</span></label>
  </div>`;

  const trabado = !pvDestrabado;
  h += `<div class="pv-b">
    <button class="${(nVacios&&!trabado)?'btn-primary':'btn-quiet'}" id="pvVacios" ${(nVacios&&!trabado)?'':'disabled'}>${
      nVacios===1?'Llenar 1 vacío':`Llenar los ${nVacios} vacíos`}</button>
    <button class="btn-quiet" id="pvTodo" ${(pendientes.length&&!trabado)?'':'disabled'}>${
      pendientes.length===1?'Aceptar 1 del POS':`Aceptar los ${pendientes.length} del POS`}</button>
    <button class="btn-quiet" id="pvOtra">↻ Volver a consultar</button>
    <span class="hint" style="margin-left:auto">${nSobra
      ? 'Lo capturado sin respaldo del POS no se toca desde aquí — revísalo tú.'
      : 'Después de aceptar hay que darle <b>Guardar</b>.'}</span>
  </div>`;

  h += `<div class="res-wrap"><table class="res pv-t" style="font-size:12.5px"><thead><tr>
    <th style="text-align:left;min-width:76px">Día</th>
    ${PV_CAMPOS.map(([,t])=>`<th style="min-width:96px">${t} capturado</th><th style="min-width:150px">${t} del POS</th>`).join('')}
    <th style="min-width:74px">Cuentas</th></tr></thead><tbody>`;

  for(const r of filas){
    if(r.error){
      h += `<tr><td style="text-align:left;font-weight:700">${r.dow} ${r.d}</td>
        <td colspan="${PV_CAMPOS.length*2+1}" style="text-align:left;color:${D_ROJO}">${esc(r.error)}</td></tr>`;
      continue;
    }
    h += `<tr><td style="text-align:left;font-weight:700">${r.dow} ${r.d}</td>`;
    for(const [k] of PV_CAMPOS){
      const c = r.campos[k];
      const cls = c.est==='igual'?'pv-ok':(c.est==='difiere'?'pv-dif':
                  (c.est==='vacio'?'pv-vac':(c.est==='sobra'?'pv-sob':'')));
      h += `<td class="${cls}">${c.cap?money(c.cap):''}</td>`;
      h += `<td><div class="pv-cel">
        <span class="${cls}">${c.est==='sobra' ? 'el POS no registró nada'
                              : (c.pos?money(c.pos):(c.est==='nada'?'—':money(0)))}</span>
        ${['vacio','difiere'].includes(c.est) && pvDestrabado
          ? `<button class="pv-mini" data-pvacc="${r.d}|${k}">usar</button>` : ''}
        ${k==='ef' && r.P?.transferencia ? `<span class="hint" style="margin:0">incl. ${money(r.P.transferencia)} transf.</span>` : ''}
      </div></td>`;
    }
    h += `<td>${r.P?.ventas || 0}</td></tr>`;
  }
  h += `</tbody></table></div>`;

  /* Lo que el POS dice que se vendió, contra lo que suma la planilla. Es la
     comprobación final: si los renglones cuadran uno por uno pero el total no,
     algo se está capturando en un renglón que no le toca. */
  const posTot = filas.reduce((s,r)=>s + (r.P?.total || 0), 0);
  const plaTot = dias.reduce((s,d)=>{
    const v = planEdit.ventas?.[d] || {};
    return s + planN(v.ef) + planN(v.tj) + planN(v.ra);
  }, 0);
  const dif = Math.round((plaTot - posTot) * 100) / 100;
  h += `<div class="conc-res" style="margin-top:12px">
    <div class="conc-k" style="border-left-color:#2A78D6"><div class="l">Venta según el POS</div>
      <div class="v">${money(posTot)}</div></div>
    <div class="conc-k" style="border-left-color:#E0A100"><div class="l">Venta en la planilla</div>
      <div class="v">${money(plaTot)}</div></div>
    <div class="conc-k" style="border-left-color:${Math.abs(dif)<1?'#0B6E3F':'#C0261F'}">
      <div class="l">Diferencia</div>
      <div class="v" style="color:${Math.abs(dif)<1?'#0B6E3F':'#C0261F'}">${Math.abs(dif)<1?'$0.00':money(dif)}</div>
      <div class="hint" style="margin:2px 0 0">${Math.abs(dif)<1?'cuadran':(dif>0?'la planilla trae de más':'la planilla trae de menos')}</div></div>
  </div>`;

  return h + `</div>`;
}

function pvAplica(d, k){
  const f = pvFecha(d), P = pvPropone(pvData?.[f]);
  if(!P) return;
  planEdit.ventas = planEdit.ventas || {};
  planEdit.ventas[d] = planEdit.ventas[d] || {};
  planEdit.ventas[d][k] = P[k] || '';
}

function wirePv(w){
  document.getElementById('pvDestraba')?.addEventListener('change', e=>{
    pvDestrabado = e.target.checked; render();
  });
  document.getElementById('pvJalar')?.addEventListener('click', ()=>pvJala(w.days));
  document.getElementById('pvOtra')?.addEventListener('click', ()=>pvJala(w.days));

  document.querySelectorAll('[data-pvacc]').forEach(b=>b.addEventListener('click', ()=>{
    const [d, k] = b.dataset.pvacc.split('|');
    pvAplica(Number(d), k);
    render();
  }));

  document.getElementById('pvVacios')?.addEventListener('click', ()=>{
    for(const d of w.days){
      const P = pvPropone(pvData?.[pvFecha(d)]); if(!P) continue;
      for(const [k] of PV_CAMPOS)
        if(pvEstado(planEdit.ventas?.[d]?.[k], P[k]) === 'vacio') pvAplica(d, k);
    }
    toast('Llenados los vacíos — dale Guardar');
    render();
  });

  document.getElementById('pvTodo')?.addEventListener('click', ()=>{
    for(const d of w.days){
      const P = pvPropone(pvData?.[pvFecha(d)]); if(!P) continue;
      for(const [k] of PV_CAMPOS)
        if(['vacio','difiere'].includes(pvEstado(planEdit.ventas?.[d]?.[k], P[k]))) pvAplica(d, k);
    }
    toast('Aceptado lo del punto de venta — dale Guardar');
    render();
  });
}
