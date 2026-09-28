
async function refreshSch(){
  try{
    const emps = employees.filter(e=>e.location_id===finLoc && e.active);
    const {data:schedArr} = await sb.from('schedules').select('*').eq('location_id',finLoc).eq('week_start',dstr(schWeek)).limit(1);
    let shifts = [];
    if(schedArr && schedArr.length){
      const sid = schedArr[0].id;
      const {data} = await sb.from('schedule_shifts').select('*').eq('schedule_id',sid);
      shifts = data||[];
    }
    schData = {saved: !!(schedArr&&schedArr.length), schedId: schedArr&&schedArr.length?schedArr[0].id:null, emps, shifts};
  }catch(e){ schData=null; return; }
  schEdit = {};
  render();
}
function schGet(empId, day){
  const key = empId+'_'+day;
  if(schEdit[key]!==undefined) return schEdit[key];
  const s = schData.shifts.find(x=>x.employee_id===empId && x.day_of_week===day);
  return s ? s.shift : 'DESCANSO';
}
function schSet(empId, day, shift){
  schEdit[empId+'_'+day] = shift;
}
function schView(){
  const end = new Date(schWeek); end.setDate(end.getDate()+6);
  const fmt = d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  let h = locSwitch(finLoc,'floc');
  h += `<div class="weeknav">
    <button data-swk="-1">\u2039</button>
    <b>Horario del ${fmt(schWeek)} al ${fmt(end)} ${schData.saved?'\u00b7 <span style="color:var(--ok)">Guardado</span>':''}</b>
    <button data-swk="1">\u203a</button></div>`;
  h += `<div class="frm-row" style="margin-bottom:12px">
    <button class="btn-quiet" id="schCopyPrev">\u2190 Copiar semana anterior</button>
    <button class="btn-primary" id="schAI" style="background:var(--navy)">\u2728 Auto-generar con IA</button>
    <button class="btn-quiet" id="schPrint">Imprimir horario</button></div>`;
  /* employee area/role config */
  h += `<details class="panel" style="margin-bottom:10px">
    <summary style="font-weight:800;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px">\u{1F465} Configurar \u00e1reas y roles del equipo</summary>
    <p class="hint">Asigna \u00e1rea (Servicio/Cocina) y rol (Encargado/Sub-enc.) a cada empleado. Se guarda autom\u00e1ticamente.</p>
    <div class="res-wrap"><table class="res"><thead><tr>
      <th>Empleado</th><th>\u00c1rea</th><th>Rol</th></tr></thead><tbody>
    ${schData.emps.map(e=>`<tr>
      <td style="text-align:left;font-weight:600">${esc(e.name.split(' ')[0])} ${esc(e.name.split(' ')[1]||'')}</td>
      <td><select data-seid="${e.id}" data-sef="area" style="min-height:40px;border:1.5px solid var(--line);border-radius:8px;padding:4px 8px;background:var(--card);width:100%">
        <option value="">—</option>
        <option value="servicio" ${e.area==='servicio'?'selected':''}>Servicio</option>
        <option value="cocina" ${e.area==='cocina'?'selected':''}>Cocina</option>
        <option value="admin" ${e.area==='admin'?'selected':''}>Admin</option>
      </select></td>
      <td><select data-seid="${e.id}" data-sef="role" style="min-height:40px;border:1.5px solid var(--line);border-radius:8px;padding:4px 8px;background:var(--card);width:100%">
        <option value="empleado" ${(e.role||'empleado')==='empleado'?'selected':''}>Empleado</option>
        <option value="subencargado" ${e.role==='subencargado'?'selected':''}>Sub-enc.</option>
        <option value="encargado" ${e.role==='encargado'?'selected':''}>Encargado</option>
        <option value="gerente" ${e.role==='gerente'?'selected':''}>Gerente</option>
      </select></td>
    </tr>`).join('')}
    </tbody></table></div>
  </details>`;
  /* shift palette */
  h += `<div class="panel" style="padding:10px 14px;margin-bottom:10px">
    <div class="hint" style="font-weight:700;margin-bottom:6px">Turnos r\u00e1pidos \u2014 selecciona empleado(s) y d\u00eda:</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">`;
  for(const s of SCH_SHIFTS){
    const bg=SCH_COLORS[s]||'#eee', dark=s!=='10:00AM - 6:00PM'&&s!=='DESCANSO';
    h += `<button class="sch-shift-btn" data-shift="${esc(s)}" style="padding:8px 14px;border-radius:10px;border:none;background:${bg};color:${dark?'#fff':'#333'};font-weight:700;cursor:pointer;min-height:44px">${esc(s)}</button>`;
  }
  h += `</div></div>`;
  /* sections */
  const sec = (label, emps)=>{
    if(!emps.length) return '';
    let t = `<div class="sec"><h2>${esc(label)}</h2></div>
    <div class="res-wrap" style="margin-bottom:16px"><table class="res" style="min-width:700px"><thead><tr>
      <th style="min-width:130px">Empleado</th>`;
    SCH_DAYS.forEach((d,i)=>{
      const dt = new Date(schWeek); dt.setDate(dt.getDate()+i);
      t += `<th style="min-width:110px">${d}<br><span style="font-weight:400;font-size:11px">${dt.getDate()} ${dt.toLocaleString('es-MX',{month:'short'})}</span></th>`;
    });
    t += `</tr></thead><tbody>`;
    for(const emp of emps){
      const sel = schSelEmp === emp.id;
      const _rb=emp.role&&emp.role!=='empleado'?` <span style="font-size:10px;background:var(--navy);color:#fff;padding:1px 4px;border-radius:3px;vertical-align:middle">${emp.role==='encargado'?'ENC':emp.role==='subencargado'?'SUB':'GTE'}</span>`:'';
      t += `<tr><td><button class="sch-emp" data-emp="${emp.id}" style="width:100%;text-align:left;padding:6px 8px;border-radius:8px;border:2px solid ${sel?'var(--navy)':'transparent'};background:${sel?'#E8EEF7':'transparent'};font-weight:${sel?'800':'600'};cursor:pointer">${esc(emp.name.split(' ')[0])} ${esc(emp.name.split(' ')[1]||'')}${_rb}</button></td>`;
      for(let d=0;d<7;d++){
        const shift = schGet(emp.id, d);
        const bg = SCH_COLORS[shift]||'#eee';
        const dark = shift!=='10:00AM - 6:00PM'&&shift!=='DESCANSO';
        t += `<td style="padding:3px"><button class="sch-cell" data-emp="${emp.id}" data-day="${d}" style="width:100%;min-height:44px;border-radius:8px;border:none;background:${bg};color:${dark?'#fff':'#333'};font-size:11px;font-weight:700;cursor:pointer;padding:4px 2px">${esc(shift==='DESCANSO'?'DESCANSO':shift)}</button></td>`;
      }
      t += `</tr>`;
    }
    t += `</tbody></table></div>`;
    return t;
  };
  const serv = schData.emps.filter(e=>['servicio','mesero','cajero','gerente','manager'].some(r=>(e.position||'').toLowerCase().includes(r)));
  const coc = schData.emps.filter(e=>['cocina','cociner','chef'].some(r=>(e.position||'').toLowerCase().includes(r)));
  const otros = schData.emps.filter(e=>!serv.find(x=>x.id===e.id)&&!coc.find(x=>x.id===e.id));
  if(serv.length) h += sec('SERVICIO', serv);
  if(coc.length) h += sec('COCINA', coc);
  if(otros.length) h += sec('SIN ÁREA', otros);
  h += `<button class="btn-primary" id="schSave" style="width:100%">${schData.saved?'Actualizar horario':'Guardar horario'}</button>`;
  return h;
}
async function schGenAI(){
  const emps = schData.emps;
  if(!emps.length){ toast('No hay empleados activos en esta sucursal'); return; }
  const btn = document.getElementById('schAI');
  if(btn){ btn.disabled=true; btn.textContent='Generando\u2026'; }

  /* collect store hours per day from user input */
  const end = new Date(schWeek); end.setDate(end.getDate()+6);
  const fmt = d=>d.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'short'});
  const days = Array.from({length:7},(_,i)=>{ const d=new Date(schWeek); d.setDate(d.getDate()+i); return d; });

  /* build prompt */
  const servicio = emps.filter(e=>['servicio','mesero','cajero','gerente','manager'].some(r=>(e.position||'').toLowerCase().includes(r)));
  const cocina = emps.filter(e=>['cocina','cociner','chef'].some(r=>(e.position||'').toLowerCase().includes(r)));
  const otros = emps.filter(e=>!servicio.find(x=>x.id===e.id)&&!cocina.find(x=>x.id===e.id));
  const sArea = (label, arr) => arr.length ? `${label}:\n` + arr.map(e=>`- ${e.name}`).join('\n') : `${label}:\n(ninguno)`;
  const empList = [sArea('\u00c1REA SERVICIO', servicio), sArea('\u00c1REA COCINA', cocina), otros.length?sArea('SIN \u00c1REA', otros):''].filter(Boolean).join('\n\n');
  const shiftsAvail = SCH_SHIFTS.filter(s=>s!=='DESCANSO').join(', ');
  const weekLabel = `${schWeek.toLocaleDateString('es-MX',{day:'numeric',month:'short'})} al ${end.toLocaleDateString('es-MX',{day:'numeric',month:'short'})}`;

  const prompt = `Eres el gerente de Boye's Burgers & Pizza (${LOCS[finLoc]}), un restaurante de hamburguesas y pizza en Sonora, México.

Debes generar el horario semanal para la semana del ${weekLabel}.

EMPLEADOS ACTIVOS:
${empList}

TURNOS DISPONIBLES: ${shiftsAvail}, DESCANSO

REGLAS:
1. Cada empleado trabaja máximo 6 días a la semana (mínimo 1 día de descanso)
2. El restaurante necesita al menos 2 personas en servicio y 2 en cocina por turno
3. Los viernes y sábados son días de mayor demanda — asigna más personal en AMBAS áreas
4. Siempre debe haber al menos 2 personas de SERVICIO y 2 de COCINA por turno
4. Los encargados/sub-encargados deben estar presentes en los turnos clave (viernes y sábado)
5. Distribuye los descansos de forma que no coincidan todos el mismo día
6. El turno 10:00AM - 6:00PM es ideal para apertura, el 4:00PM - 12:00AM para cierre
7. El turno 12:00PM - 8:00PM es intermedio, útil los días de alta demanda
8. Considera el área de cada empleado: servicio/mesero/cajero van al área de servicio, cocinero/cocina al área de cocina

Responde ÚNICAMENTE con un JSON válido con este formato exacto (sin explicación, sin markdown):
{
  "schedule": [
    {"name": "NOMBRE COMPLETO", "shifts": ["turno_lun","turno_mar","turno_mie","turno_jue","turno_vie","turno_sab","turno_dom"]}
  ],
  "notas": "breve explicación de la lógica aplicada"
}

Donde cada turno es exactamente uno de: "4:00PM - 12:00AM", "10:00AM - 6:00PM", "12:00PM - 8:00PM", "DESCANSO"`;

  try{
    const resp = await fetch('/.netlify/functions/ai-schedule', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({messages:[{role:'user', content: prompt}]})
    });
    const data = await resp.json();
    if(data.error){ throw new Error(data.error.message||JSON.stringify(data.error)); }
    const text = data.content?.find(c=>c.type==='text')?.text||'';
    if(!text) throw new Error('Respuesta vacía del modelo — revisa la API key en Netlify');
    const clean = text.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);

    /* apply to schEdit */
    let applied=0;
    for(const row of parsed.schedule){
      const emp = emps.find(e=>e.name.toUpperCase()===row.name.toUpperCase() ||
        e.name.toUpperCase().includes(row.name.toUpperCase().split(' ')[0]));
      if(!emp) continue;
      row.shifts.forEach((shift,d)=>{
        if(SCH_SHIFTS.includes(shift)||shift==='DESCANSO') schEdit[emp.id+'_'+d]=shift;
      });
      applied++;
    }
    if(parsed.notas) toast('\u2728 Horario generado \u00b7 '+parsed.notas.slice(0,120));
    else toast(`\u2728 Horario generado para ${applied} empleados \u2014 revisa y ajusta`);
    render();
  }catch(err){
    toast('No se pudo generar el horario: '+err.message);
  } finally {
    if(btn){ btn.disabled=false; btn.textContent='\u2728 Auto-generar con IA'; }
  }
}
async function wireSch(){
  $('#main').querySelectorAll('[data-swk]').forEach(b=>b.addEventListener('click', ()=>{
    schWeek.setDate(schWeek.getDate() + 7*Number(b.dataset.swk));
    schData=null; schEdit={}; schSelEmp=null; refreshSch();
  }));
  /* select employee */
  $('#main').querySelectorAll('.sch-emp').forEach(b=>b.addEventListener('click', ()=>{
    schSelEmp = schSelEmp===b.dataset.emp ? null : b.dataset.emp;
    render();
  }));
  /* click cell: cycle through shifts */
  $('#main').querySelectorAll('.sch-cell').forEach(b=>b.addEventListener('click', ()=>{
    const cur = schGet(b.dataset.emp, Number(b.dataset.day));
    const next = SCH_SHIFTS[(SCH_SHIFTS.indexOf(cur)+1)%SCH_SHIFTS.length];
    schSet(b.dataset.emp, Number(b.dataset.day), next);
    render();
  }));
  /* palette button: apply to selected employee or all visible */
  $('#main').querySelectorAll('.sch-shift-btn').forEach(b=>b.addEventListener('click', ()=>{
    const shift = b.dataset.shift;
    const emps = schSelEmp ? [schSelEmp] : schData.emps.map(e=>e.id);
    const day = schSelEmp ? null : null; // apply to all 7 days if no day selected
    if(schSelEmp){
      for(let d=0;d<7;d++) schSet(schSelEmp, d, shift);
      toast(`Turno "${shift}" aplicado a ${schData.emps.find(e=>e.id===schSelEmp)?.name.split(' ')[0]||''} toda la semana`);
    } else {
      toast('Selecciona un empleado primero para aplicar el turno r\u00e1pido');
      return;
    }
    render();
  }));
  $('#main').querySelectorAll('[data-seid]').forEach(sel=>sel.addEventListener('change', async ()=>{
    const emp = employees.find(e=>e.id===sel.dataset.seid);
    if(!emp) return;
    if(sel.dataset.sef==='area') emp.area=sel.value;
    else emp.role=sel.value;
    try{
      await finRpc('fin_save_employee',{p_id:emp.id,p_name:emp.name,p_position:emp.position||'',p_location:emp.location_id,p_salary:Number(emp.weekly_salary||0),p_area:emp.area||null,p_role:emp.role||'empleado'});
      toast('Guardado');
    }catch(e){}
  }));
  $('#schAI')?.addEventListener('click', schGenAI);
  $('#schCopyPrev')?.addEventListener('click', async ()=>{
    const prev = new Date(schWeek); prev.setDate(prev.getDate()-7);
    try{
      const {data:ps} = await sb.from('schedules').select('id').eq('location_id',finLoc).eq('week_start',dstr(prev)).limit(1);
      if(!ps||!ps.length){ toast('No hay horario guardado la semana anterior'); return; }
      const {data:psh} = await sb.from('schedule_shifts').select('*').eq('schedule_id',ps[0].id);
      for(const s of (psh||[])) schEdit[s.employee_id+'_'+s.day_of_week] = s.shift;
      toast('Horario anterior cargado \u2014 ajusta y guarda');
      render();
    }catch(e){ toast('No se pudo cargar'); }
  });
  $('#schSave')?.addEventListener('click', async ()=>{
    const _b=document.getElementById('schSave'); if(_b) _b.disabled=true;
    try{
      let sid = schData.schedId;
      if(!sid){
        const {data} = await sb.from('schedules').insert({location_id:finLoc, week_start:dstr(schWeek), created_by:user.name}).select().single();
        sid = data.id;
      } else {
        await sb.from('schedules').update({updated_at:new Date().toISOString(), created_by:user.name}).eq('id',sid);
      }
      const rows = [];
      for(const emp of schData.emps){
        for(let d=0;d<7;d++){
          rows.push({schedule_id:sid, employee_id:emp.id, day_of_week:d, shift:schGet(emp.id,d)});
        }
      }
      await sb.from('schedule_shifts').delete().eq('schedule_id',sid);
      await sb.from('schedule_shifts').insert(rows);
      toast('Horario guardado');
      schData=null; schEdit={}; refreshSch();
    }catch(e){ toast('No se pudo guardar'); if(_b) _b.disabled=false; }
  });
  $('#schPrint')?.addEventListener('click', ()=>{
    const end = new Date(schWeek); end.setDate(end.getDate()+6);
    const fmt = d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
    let rows = schData.emps.map(emp=>{
      const shifts = Array.from({length:7},(_,d)=>schGet(emp.id,d));
      return `<tr><td><b>${esc(emp.name)}</b></td>${shifts.map(s=>`<td style="background:${SCH_COLORS[s]||'#eee'};color:${s!=='10:00AM - 6:00PM'&&s!=='DESCANSO'?'#fff':'#333'};font-size:10px;padding:4px;text-align:center">${esc(s)}</td>`).join('')}</tr>`;
    }).join('');
    $('#printArea').innerHTML = `<div class="rc"><h1>Horario \u2014 ${esc(LOCS[finLoc])}</h1>
      <div class="sub2">${esc(EMPRESA)} \u00b7 Semana del ${fmt(schWeek)} al ${fmt(end)}</div>
      <table><tr><th>Empleado</th>${SCH_DAYS.map((d,i)=>{const dt=new Date(schWeek);dt.setDate(dt.getDate()+i);return`<th>${d}<br>${dt.getDate()} ${dt.toLocaleString('es-MX',{month:'short'})}</th>`;}).join('')}</tr>${rows}</table></div>`;
    window.print();
  });
}
