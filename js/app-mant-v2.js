
function ticketDetail(t){
  const eq = mantData.equipment.find(e=>e.id===t.equipment_id);
  const ups = mantData.updates.filter(u=>u.ticket_id===t.id);
  const isAdmin = user.role==='admin' || user.role==='administradora';
  let h = `<button class="btn-quiet" id="tkBack" style="margin-bottom:12px">\u2190 Todos los reportes</button>
  <div class="panel">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:18px">${eq?esc(eq.name)+' \u00b7 #'+esc(eq.code):'Equipo general'}</b> ${tkChip(t.status)}</div>
    <div class="m" style="margin-top:6px">${LOCS[t.location_id]} \u00b7 Reportado por ${esc(t.reported_by||'?')} \u00b7 ${new Date(t.created_at).toLocaleDateString('es-MX',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
    <p style="margin:10px 0 0;font-weight:600">${esc(t.problem)}</p>
    ${t.notes?`<p class="hint">${esc(t.notes)}</p>`:''}
    ${t.photo_url?`<a href="${t.photo_url}" target="_blank" rel="noopener"><img src="${t.photo_url}" alt="Foto del problema" style="max-width:100%;max-height:260px;border-radius:12px;margin-top:10px;border:1px solid var(--line)"></a>`:''}
    ${t.contact_name?`<div class="arm-note" style="margin-top:10px"><span><b>Contacto asignado:</b> ${esc(t.contact_name)} ${t.contact_phone?`\u00b7 <a href="tel:${esc(t.contact_phone)}" style="font-weight:800">${esc(t.contact_phone)}</a>`:''}</span></div>`:''}
  </div>
  <div class="sec"><h2>Seguimiento</h2></div>`;
  const KLBL = {reporte:'Reporte', instruccion:'\u{1F4CB} Instrucci\u00f3n de Rod', avance:'Avance', cotizacion:'\u{1F4B0} Cotizaci\u00f3n', aprobacion:'\u2705 Aprobado', rechazo:'\u274C Rechazado', resolucion:'\u{1F527} Resuelto'};
  if(!ups.length) h += `<div class="empty"><b>Sin actualizaciones a\u00fan</b></div>`;
  for(const u of ups){
    h += `<div class="txrow" style="box-shadow:none;border:1px solid var(--line);${u.kind==='instruccion'?'border-left:4px solid var(--gold);':''}${u.kind==='cotizacion'?'border-left:4px solid var(--warn);':''}">
      <div class="c"><div class="t">${KLBL[u.kind]||u.kind} \u00b7 ${esc(u.author)}</div>
      <div class="m" style="white-space:pre-wrap">${esc(u.body)}</div>
      ${u.amount?`<div class="t" style="margin-top:4px">${money(u.amount)}</div>`:''}
      <div class="m" style="margin-top:2px">${new Date(u.created_at).toLocaleDateString('es-MX',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div></div></div>`;
  }
  if(t.status!=='resuelto'){
    h += `<form class="panel" id="tkUpdFrm">
      <label>${isAdmin?'Instrucci\u00f3n / respuesta':'Actualizaci\u00f3n de seguimiento'}
        <textarea name="body" required maxlength="600" style="min-height:80px" placeholder="${isAdmin?'Ej: Ll\u00e1menle a Gabriel para revisarla, cel 622-123-4567':'Ej: Gabriel viene el s\u00e1bado, cotiza $15,000 por el arreglo'}"></textarea></label>`;
    if(isAdmin){
      h += `<div class="frm-row"><label>Contacto (nombre) <input name="cname" value="${esc(t.contact_name||'')}" placeholder="Gabriel"></label>
        <label>Tel\u00e9fono <input name="cphone" value="${esc(t.contact_phone||'')}" inputmode="tel" placeholder="622-000-0000"></label></div>`;
    }
    h += `<div class="frm-row"><label>\u00bfCotizaci\u00f3n? Monto (MXN) <input name="amount" type="number" step="0.01" min="0" class="nospin" placeholder="0"></label><span></span></div>
      <button class="btn-primary" type="submit">${isAdmin?'Enviar instrucci\u00f3n':'Agregar actualizaci\u00f3n'}</button></form>`;
    const quote = [...ups].reverse().find(u=>u.kind==='cotizacion');
    if(isAdmin && t.status==='por_aprobar' && quote){
      h += `<div class="frm-row" style="margin-top:10px">
        <button class="btn-primary" id="tkApprove" data-amt="${quote.amount||0}">Aprobar cotizaci\u00f3n (${money(quote.amount||0)})</button>
        <button class="btn-quiet" id="tkReject">Rechazar</button></div>`;
    }
    h += `<div class="frm-row" style="margin-top:10px">
      <button class="btn-quiet" id="tkResolve">Marcar como RESUELTO</button>
      ${isAdmin?`<button class="btn-quiet" id="tkPay" ${quote?`data-amt="${quote.amount||0}"`:''}>Registrar egreso de mantenimiento</button>`:'<span></span>'}</div>`;
  } else if(isAdmin){
    h += `<div class="frm-row" style="margin-top:10px"><button class="btn-quiet" id="tkPay">Registrar egreso de mantenimiento</button><span></span></div>`;
  }
  return h;
}
function maintView(locId){
  if(mantData===null){ loadMant(); return `<div class="empty"><b>Cargando mantenimiento\u2026</b></div>`; }
  const isAdmin = user.role==='admin' || user.role==='administradora';
  if(ticketSel){
    const t = mantData.tickets.find(x=>x.id===ticketSel);
    if(t) return ticketDetail(t);
    ticketSel = null;
  }
  let h = '';
  const myTickets = mantData.tickets.filter(t=> isAdmin ? true : t.location_id===locId);
  const open = myTickets.filter(t=>t.status!=='resuelto');
  const closed = myTickets.filter(t=>t.status==='resuelto').slice(0,10);
  /* report form */
  if(mantForm){
    const eqs = mantData.equipment.filter(e=>e.location_id===locId);
    h += `<form class="panel" id="tkFrm">
      <div class="hint" style="font-weight:800;font-size:16px">Reportar problema \u00b7 ${LOCS[locId]}</div>
      <label>Equipo (busca por nombre o c\u00f3digo)
        <select name="equipment" style="min-height:52px;border:1.5px solid var(--line);border-radius:10px;padding:10px;background:#FBFAF7;font-size:16px">
          <option value="">\u2014 Otro / instalaci\u00f3n general \u2014</option>
          ${eqs.map(e=>`<option value="${e.id}">#${esc(e.code)} \u00b7 ${esc(e.name)}${e.brand?' ('+esc(e.brand)+')':''}</option>`).join('')}
        </select></label>
      <label>\u00bfCu\u00e1l es el problema? <input name="problem" required maxlength="140" placeholder="Ej: hace ruido y se apaga"></label>
      <label>Notas / detalles <textarea name="notes" maxlength="500" style="min-height:70px" placeholder="Desde cu\u00e1ndo, con qu\u00e9 frecuencia, olores, cortos, etc."></textarea></label>
      <label>Foto (opcional)</label><div class="frm-row"><label style="flex:1;min-height:52px;display:flex;align-items:center;justify-content:center;border:2px dashed var(--line);border-radius:12px;background:#FBFAF7;cursor:pointer;gap:8px;padding:10px"><input type="file" name="photo" accept="image/*" style="display:none">📁 Elegir archivo</label><label style="flex:1;min-height:52px;display:flex;align-items:center;justify-content:center;border:2px dashed var(--gold);border-radius:12px;background:#FFF9EC;cursor:pointer;gap:8px;padding:10px;font-weight:700"><input type="file" name="photoCapture" accept="image/*" capture="environment" style="display:none">📷 Tomar fotografía</label></div>
      <div class="frm-row"><button class="btn-primary" type="submit">Enviar reporte</button>
      <button class="btn-quiet" type="button" id="tkCancel">Cancelar</button></div></form>`;
  } else {
    h += `<button class="btn-primary" id="tkNew" style="width:100%;margin-bottom:14px">\u{1F6A8} Reportar un problema</button>`;
  }
  if(open.length){
    h += `<div class="sec"><h2>Reportes activos (${open.length})</h2></div>`;
    h += `<div class="emp-scroll" style="max-height:52vh">` + open.map(ticketCard).join('') + `</div>`;
  } else {
    h += `<div class="empty"><b>Sin reportes activos${isAdmin?'':' en '+LOCS[locId]}</b>Todo el equipo funcionando.</div>`;
  }
  if(closed.length){
    h += `<div class="sec"><h2>Resueltos recientes</h2></div>
    <div class="emp-scroll" style="max-height:36vh">` + closed.map(ticketCard).join('') + `</div>`;
  }
  /* admin: equipment registry */
  if(isAdmin){
    const eqs = mantData.equipment.filter(e=>e.location_id===locId);
    const eqShown = eqFilter ? eqs.filter(e=>(e.name+' '+e.code+' '+(e.brand||'')).toUpperCase().includes(eqFilter)) : eqs;
    h += `<div class="sec"><h2>Equipos registrados \u00b7 ${LOCS[locId]} (${eqs.length})</h2></div>
    <p class="hint" style="margin-bottom:8px">Cada equipo tiene su c\u00f3digo \u00fanico \u2014 imprime/etiqueta el n\u00famero en la m\u00e1quina para que el turno lo identifique al reportar.</p>
    <div class="panel" style="margin-bottom:10px"><label>Buscar equipo <input id="eqSearch" value="${esc(eqFilter)}" placeholder="Nombre, c\u00f3digo o marca: freidora, 10004, Torrey\u2026"></label></div>`;
    h += `<div class="emp-scroll" style="max-height:44vh">` + eqShown.map(e=>`<div class="txrow"><div class="c"><div class="t">#${esc(e.code)} \u00b7 ${esc(e.name)}</div>
      <div class="m">${e.brand?esc(e.brand):'\u2014'}</div></div></div>`).join('') + `</div>`;
    if(!eqShown.length) h += `<div class="empty"><b>Sin resultados para "${esc(eqFilter)}"</b></div>`;
    h += `<form class="panel" id="eqFrm"><div class="frm-row-3">
      <label>Nuevo equipo <input name="name" required maxlength="60" placeholder="Congelador vertical"></label>
      <label>Marca <input name="brand" maxlength="40"></label>
      <span style="align-self:end"><button class="btn-quiet" type="submit" style="width:100%">Registrar equipo</button></span>
    </div><p class="hint">El c\u00f3digo se asigna solo (consecutivo desde #10001).</p></form>`;
  }
  return h;
}
async function wireMant(locId){
  $('#tkNew')?.addEventListener('click', ()=>{ mantForm=true; render(); });
  $('#tkCancel')?.addEventListener('click', ()=>{ mantForm=false; render(); });
  $('#main').querySelectorAll('[data-tk]').forEach(b=>b.addEventListener('click', ()=>{ ticketSel=b.dataset.tk; render(); }));
  $('#tkBack')?.addEventListener('click', ()=>{ ticketSel=null; loadMant(); });
  $('#tkFrm')?.addEventListener('change', e=>{
    const t = e.target;
    if(t.name==='photoCapture' && t.files[0]){
      const dt = new DataTransfer(); dt.items.add(t.files[0]);
      e.currentTarget.querySelector('[name=photo]').files = dt.files;
    }
  });
  $('#tkFrm')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    let photo_url = null;
    const file = f.get('photo');
    try{
      if(file && file.size){ toast('Subiendo foto\u2026'); photo_url = await uploadTicketPhoto(file); }
      const {data, error} = await sb.from('tickets').insert({
        location_id: locId, equipment_id: f.get('equipment')||null,
        problem: f.get('problem').trim(), notes: (f.get('notes')||'').trim()||null,
        photo_url, reported_by: user.name, status:'nuevo'
      }).select().single();
      if(error) throw error;
      await sb.from('ticket_updates').insert({ticket_id: data.id, author: user.name, kind:'reporte', body: f.get('problem').trim()});
      toast('Reporte enviado \u2014 Rod lo ver\u00e1 en su panel');
      mantForm=false; loadMant();
    }catch(err){ toast('No se pudo enviar el reporte'); }
  });
  $('#tkUpdFrm')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const t = mantData.tickets.find(x=>x.id===ticketSel);
    const f = new FormData(e.target);
    const isAdmin = user.role==='admin' || user.role==='administradora';
    const amount = Number(f.get('amount')||0)||null;
    const kind = amount ? 'cotizacion' : (isAdmin ? 'instruccion' : 'avance');
    try{
      await sb.from('ticket_updates').insert({ticket_id: t.id, author: user.name, kind, body: f.get('body').trim(), amount});
      const patch = {updated_at: new Date().toISOString()};
      if(amount && !isAdmin) patch.status = 'por_aprobar';
      else if(isAdmin && t.status==='nuevo') patch.status = 'seguimiento';
      if(isAdmin){
        const cn = (f.get('cname')||'').trim(), cp = (f.get('cphone')||'').trim();
        if(cn) patch.contact_name = cn;
        if(cp) patch.contact_phone = cp;
      }
      await sb.from('tickets').update(patch).eq('id', t.id);
      toast(kind==='cotizacion'?'Cotizaci\u00f3n enviada a Rod para aprobaci\u00f3n':'Actualizaci\u00f3n guardada');
      loadMant();
    }catch(err){ toast('No se pudo guardar'); }
  });
  $('#tkApprove')?.addEventListener('click', async ()=>{
    const t = mantData.tickets.find(x=>x.id===ticketSel);
    const amt = Number($('#tkApprove').dataset.amt||0);
    try{
      await sb.from('ticket_updates').insert({ticket_id: t.id, author: user.name, kind:'aprobacion', body:'Cotizaci\u00f3n aprobada. Procedan con el arreglo.', amount: amt||null});
      await sb.from('tickets').update({status:'aprobado', updated_at: new Date().toISOString()}).eq('id', t.id);
      toast('Aprobado \u2014 la sucursal ya lo ve'); loadMant();
    }catch(err){}
  });
  $('#tkReject')?.addEventListener('click', async ()=>{
    const t = mantData.tickets.find(x=>x.id===ticketSel);
    try{
      await sb.from('ticket_updates').insert({ticket_id: t.id, author: user.name, kind:'rechazo', body:'Cotizaci\u00f3n rechazada. Busquen otra opci\u00f3n / esperen indicaciones.'});
      await sb.from('tickets').update({status:'seguimiento', updated_at: new Date().toISOString()}).eq('id', t.id);
      toast('Rechazada'); loadMant();
    }catch(err){}
  });
  $('#tkResolve')?.addEventListener('click', async ()=>{
    const t = mantData.tickets.find(x=>x.id===ticketSel);
    try{
      await sb.from('ticket_updates').insert({ticket_id: t.id, author: user.name, kind:'resolucion', body:'Problema resuelto.'});
      await sb.from('tickets').update({status:'resuelto', updated_at: new Date().toISOString()}).eq('id', t.id);
      toast('Marcado como resuelto \u2705'); loadMant();
    }catch(err){}
  });
  $('#tkPay')?.addEventListener('click', async ()=>{
    const t = mantData.tickets.find(x=>x.id===ticketSel);
    const eq = mantData.equipment.find(e=>e.id===t.equipment_id);
    const amt = Number($('#tkPay').dataset.amt||0);
    const monto = prompt('Monto del egreso (MXN):', amt||'');
    if(monto===null || !Number(monto)) return;
    try{
      await finRpc('fin_add_transaction', {p_date: todayStr(), p_location: t.location_id, p_kind:'egreso',
        p_category:'mantenimiento', p_concept: 'Mant: ' + (eq?eq.name:'general') + ' \u2014 ' + t.problem.slice(0,60),
        p_amount: Number(monto), p_notes: 'Ticket #' + t.id.slice(0,8)});
      await sb.from('ticket_updates').insert({ticket_id: t.id, author: user.name, kind:'avance', body:'Egreso registrado en finanzas.', amount: Number(monto)});
      toast('Egreso registrado'); loadMant();
    }catch(err){}
  });
  const eqs2 = $('#eqSearch');
  eqs2?.addEventListener('input', ()=>{ eqFilter = eqs2.value.toUpperCase(); const p = eqs2.selectionStart; render(); const n = $('#eqSearch'); if(n){ n.focus(); n.setSelectionRange(p,p); } });
  $('#eqFrm')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      const {error} = await sb.from('equipment').insert({location_id: locId, name: f.get('name').trim(), brand: (f.get('brand')||'').trim()||null});
      if(error) throw error;
      toast('Equipo registrado'); loadMant();
    }catch(err){ toast('No se pudo registrar'); }
  });
}
function adminSummary(){
  if(mantData===null) loadMant();
  let html = `<div class="loc-grid">`;
  for(const id of [1,2]){
    const all = forLocation(id).filter(t=>dueToday(t, id));
    const now = hhmmNow();
    let recDue=0, recDone=0;
    for(const t of forLocation(id).filter(x=>x.frequency==='recurring')){
      for(const s of slotsFor(t)){ if(s<=now){ recDue++; if(slotDone(t,id,s)) recDone++; } } }
    const done = all.filter(t=>isDoneToday(t,id)).length + recDone;
    const total = all.length + recDue;
    const pct = total?Math.round(done/total*100):0;
    const over = forLocation(id).filter(t=>t.frequency==='interval' && intervalStatus(t,id).overdue).length;
    const tkNew = mantData ? mantData.tickets.filter(t=>t.location_id===id && t.status==='nuevo').length : 0;
    html += `<div class="loc-card">
      <h3>${LOCS[id]}</h3>
      <div class="big">${pct}%</div>
      <div class="lbl">${done} de ${total} tareas de hoy</div>
      <div class="track"><div class="fill ${pct===100?'done':''}" style="width:${pct}%"></div></div>
      ${over?`<span class="pill warn">${over} mantenimiento${over>1?'s':''} vencido${over>1?'s':''}</span>`
            :`<span class="pill ok">Mantenimiento al día</span>`}
      ${tkNew?`<span class="pill warn" style="background:var(--red);color:#fff">\u{1F6A8} ${tkNew} reporte${tkNew>1?'s':''} nuevo${tkNew>1?'s':''} de equipo</span>`:''}
    </div>`;
  }
  html += `</div>`;
  return html;
}
function locSwitch(cur, attr){
  return `<div class="switch" role="group" aria-label="Sucursal">
    <button aria-pressed="${cur===1}" data-${attr}="1">Guaymas</button>
    <button aria-pressed="${cur===2}" data-${attr}="2">San Carlos</button>
  </div>`;
}
function newTaskForm(){
  return `<form class="panel" id="frm">
    <label>Nombre de la tarea <input name="title" required maxlength="120" placeholder="Ej. Revisar máquina de hielo"></label>
    <label>Detalle <span class="hint">(opcional)</span><textarea name="description" maxlength="300"></textarea></label>
    <div class="frm-row">
      <label>Área <select name="area">${AREA_ORDER.map(a=>`<option value="${a}">${AREAS[a]}</option>`).join('')}</select></label>
      <label>Responsable <select name="target_role"><option value="">Ambos</option><option value="manager">Manager</option><option value="chef">Head Chef</option></select></label>
    </div>
    <div class="frm-row">
      <label>Frecuencia <select name="frequency" id="freqSel">
        <option value="daily">Diaria</option><option value="recurring">Varias veces al día</option>
        <option value="weekly">Semanal</option>
        <option value="monthly">Mensual</option><option value="interval">Cada N días</option>
      </select></label>
      <label id="freqExtra" class="hide"></label>
    </div>
    <label>Sucursal <select name="location_id"><option value="">Ambas</option><option value="1">Guaymas</option><option value="2">San Carlos</option></select></label>
    <button class="btn-primary" type="submit">Agregar tarea</button>
  </form>`;
}
function wireForm(){
  const sel = $('#freqSel'), extra = $('#freqExtra');
  const upd = ()=>{
    const v = sel.value;
    if(v==='weekly'){ extra.classList.remove('hide'); extra.innerHTML = `Día <select name="day_of_week">${DOW.map((d,i)=>`<option value="${i}" ${i===1?'selected':''}>${d}</option>`).join('')}</select>`; }
    else if(v==='monthly'){ extra.classList.remove('hide'); extra.innerHTML = `Día del mes <input name="day_of_month" type="number" min="1" max="28" value="1" required>`; }
    else if(v==='interval'){ extra.classList.remove('hide'); extra.innerHTML = `Cada cuántos días <input name="interval_days" type="number" min="1" max="365" value="30" required>`; }
    else if(v==='recurring'){ extra.classList.remove('hide'); extra.innerHTML = `Cada cuántos minutos <input name="every_minutes" type="number" min="15" max="720" step="15" value="60" required>
      <span class="hint">Horario de rondas</span>
      <span style="display:flex;gap:8px"><input type="time" name="window_start" value="10:00" required aria-label="Desde"><input type="time" name="window_end" value="22:00" required aria-label="Hasta"></span>`; }
    else { extra.classList.add('hide'); extra.innerHTML=''; }
  };
  sel.addEventListener('change', upd); upd();
  $('#frm').addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const row = {
      title: f.get('title').trim(),
      description: (f.get('description')||'').trim() || null,
      area: f.get('area'),
      frequency: f.get('frequency'),
      target_role: f.get('target_role') || null,
      location_id: f.get('location_id') ? Number(f.get('location_id')) : null,
      day_of_week: f.get('day_of_week')!=null ? Number(f.get('day_of_week')) : null,
      day_of_month: f.get('day_of_month') ? Number(f.get('day_of_month')) : null,
      interval_days: f.get('interval_days') ? Number(f.get('interval_days')) : null,
      every_minutes: f.get('every_minutes') ? Number(f.get('every_minutes')) : null,
      window_start: f.get('window_start') || null,
      window_end: f.get('window_end') || null,
      sort_order: 500
    };
    const {data, error} = await sb.from('task_templates').insert(row).select().single();
    if(error){ toast('No se pudo guardar la tarea'); return; }
    templates.push(data);
    toast('Tarea agregada');
    e.target.reset(); upd();
  });
}

/* ---------- finance ---------- */
async function refreshFinance(){
  /* Si ya hay una carga en curso, nos colgamos de esa en vez de disparar otra
     igual: así dos secciones abiertas no piden el catálogo dos veces, y quien
     haga await recibe los datos frescos igual. */
  if(_finEnCurso) return _finEnCurso;
  finCargando = true;
  _finEnCurso = (async ()=>{ try{ await _refreshFinance(); } finally{ finCargando = false; _finEnCurso = null; } })();
  return _finEnCurso;
}
let _finEnCurso = null;
async function _refreshFinance(){
  let from, to;
  if(finRange){ from = finRange.from; to = finRange.to; }
  else { const [y,m] = finMonth.split('-').map(Number); from = `${finMonth}-01`; to = dstr(new Date(y, m, 0)); }
  /* allSettled y no all: antes, si UNA de las cuatro consultas fallaba se
     perdían las otras tres y el catálogo se quedaba en null para siempre —
     por eso Inventario se quedaba cargando sin fin y sin avisar. */
  const r = await Promise.allSettled([
    finRpc('fin_list_transactions', {p_from: from, p_to: to}),
    finRpc('fin_list_employees', {}),
    finRpc('inv_get_catalog', {}),
    finRpc('rep_weekly', {})
  ]);
  const [tx, emp, cat, rw] = r;
  if(tx.status==='fulfilled') txMonth = tx.value||[];
  if(emp.status==='fulfilled') employees = emp.value||[];
  if(cat.status==='fulfilled'){ catalog = cat.value||{ingredients:[],dishes:[]}; catalogError = null; guardaCatalogoLocal(catalog); }
  else { catalogError = cat.reason?.message || 'No se pudo cargar el catálogo de insumos'; console.error('catálogo:', cat.reason); }
  if(rw.status==='fulfilled') repWeekly = rw.value||[];
  const fallaron = r.filter(x=>x.status==='rejected');
  if(fallaron.length) toast(`${fallaron.length} de 4 consultas fallaron — revisa Inventario`);
  render();
}
async function refreshPayroll(){
  /* ANTES: al abrir una nómina ya guardada, la app metía sola a TODA la
     plantilla que no estuviera en la lista —con su sueldo semanal completo— y
     lo guardaba en la base sin preguntar. Por eso aparecía gente que ni salió
     en el checador de esa semana, cobrando su sueldo entero, y el total de la
     nómina se inflaba.
     Ahora la nómina la mandan el checador y la captura manual. A quien falte se
     le agrega a mano desde el recuadro "¿Falta alguien de Equipo en esta
     nómina?", que sigue estando abajo. */
  try{
    /* La lista de semanas guardadas se pide en paralelo: si falla, la nómina
       de la semana igual se abre — es un atajo, no un requisito. */
    const [pd, hist] = await Promise.allSettled([
      finRpc('fin_get_payroll', {p_week: dstr(payWeek), p_loc: finLoc}),
      finRpc('nom_list_weeks', {p_loc: finLoc})
    ]);
    if(pd.status==='fulfilled') payData = pd.value; else payData = null;
    payHist = hist.status==='fulfilled' ? (hist.value||[]) : [];
    if(payData?.saved && !employees.length){ try{ await refreshFinance(); }catch(e){} }
  }catch(e){ payData=null; }
  render();
}
