async function pedLiveLoad(){
  try{
    const {data}=await sb.from('pedido_live').select('*').eq('location_id',finLoc).eq('week_start',dstr(pedWeek));
    for(const row of (data||[])) pedEdit2[row.item_key]={existencia:row.existencia!==null?row.existencia:'',pedido:row.pedido!==null?row.pedido:0};
  }catch(e){}
}
async function pedLiveSave(key,existencia,pedido){
  if(_pedBroadcasting) return;
  try{
    await sb.from('pedido_live').upsert({location_id:finLoc,week_start:dstr(pedWeek),item_key:key,
      existencia:existencia===''?null:Number(existencia),pedido:Number(pedido||0),
      updated_by:user.name,updated_at:new Date().toISOString()},
      {onConflict:'location_id,week_start,item_key'});
  }catch(e){}
}
function pedSubscribe(){
  if(_pedChannel){sb.removeChannel(_pedChannel);_pedChannel=null;}
  _pedChannel=sb.channel('ped_'+finLoc+'_'+dstr(pedWeek))
    .on('postgres_changes',{event:'*',schema:'public',table:'pedido_live',filter:'location_id=eq.'+finLoc},payload=>{
      const r=payload.new||{};
      if(!r.item_key||r.week_start!==dstr(pedWeek)) return;
      if(r.updated_by===user.name) return;
      _pedBroadcasting=true;
      pedEdit2[r.item_key]={existencia:r.existencia!==null?r.existencia:'',pedido:r.pedido!==null?r.pedido:0};
      _pedBroadcasting=false;
      clearTimeout(pedSubscribe._t);
      pedSubscribe._t=setTimeout(()=>{toast('📡 '+(r.updated_by||'Admin')+' actualizó el pedido');render();},400);
    }).subscribe();
}
/* ---------- vista principal de Pedido (Finanzas > Pedido) ---------- */
async function refreshPedido(){
  try{
    if(!catalog){ await refreshFinance(); }
    await pedLiveLoad();
  }catch(e){}
  pedData = true;
  pedSubscribe();
  render();
}
function pedidoView(){
  if(!catalog){ return `<div class="empty"><b>Cargando catálogo…</b></div>`; }
  const end = new Date(pedWeek); end.setDate(end.getDate()+6);
  const fmt = d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  const ings = (catalog.ingredients||[]).filter(i=>i.location_id===finLoc && i.active)
    .sort((a,b)=>a.name.localeCompare(b.name));
  let h = `<div class="weeknav">
    <button data-pwk="-1" aria-label="Semana anterior">‹</button>
    <b>Pedido \u00b7 semana del ${fmt(pedWeek)} al ${fmt(end)}</b>
    <button data-pwk="1" aria-label="Semana siguiente">›</button>
  </div>`;
  h += `<p class="hint" style="margin-bottom:12px">📡 Esta lista se sincroniza en tiempo real \u2014 lo que edite cualquiera desde su tel\u00e9fono o tablet lo ven todos al instante.</p>`;
  if(!ings.length){
    return h + `<div class="empty"><b>Sin insumos en ${LOCS[finLoc]}</b>Agr\u00e9galos primero en Inventario.</div>`;
  }
  h += `<div class="res-wrap"><table class="res"><thead><tr><th>Insumo</th><th>Existencia</th><th>Pedido</th></tr></thead><tbody>`;
  for(const ing of ings){
    const ed = pedEdit2[ing.id]||{existencia:'',pedido:0};
    h += `<tr><td style="text-align:left;min-width:160px">${esc(ing.name)} <span class="ps" style="font-size:12px;color:var(--ink-2)">${esc(ing.unit)}</span></td>
      <td><input type="text" inputmode="decimal" class="nospin" value="${ed.existencia}" placeholder="—" data-pex="${ing.id}" aria-label="Existencia ${esc(ing.name)}"></td>
      <td><input type="text" inputmode="decimal" class="nospin" value="${ed.pedido||''}" placeholder="0" data-pcant="${ing.id}" aria-label="Pedido ${esc(ing.name)}"></td></tr>`;
  }
  h += `</tbody></table></div>`;
  h += `<div class="frm-row" style="margin-top:14px"><button class="btn-quiet" id="pedCopyBtn" style="width:100%">📋 Copiar lista de pedido (solo lo que tiene cantidad)</button></div>`;
  return h;
}
function wirePedido(){
  $('#main').querySelectorAll('[data-pwk]').forEach(b=>b.addEventListener('click', ()=>{
    pedWeek.setDate(pedWeek.getDate()+7*Number(b.dataset.pwk));
    pedData=null; pedEdit2={};
    refreshPedido();
  }));
  $('#main').querySelectorAll('[data-pex]').forEach(inp=>inp.addEventListener('change', ()=>{
    const id = inp.dataset.pex;
    const ed = pedEdit2[id]||(pedEdit2[id]={existencia:'',pedido:0});
    ed.existencia = inp.value.trim();
    pedLiveSave(id, ed.existencia, ed.pedido);
  }));
  $('#main').querySelectorAll('[data-pcant]').forEach(inp=>inp.addEventListener('change', ()=>{
    const id = inp.dataset.pcant;
    const ed = pedEdit2[id]||(pedEdit2[id]={existencia:'',pedido:0});
    ed.pedido = Number(inp.value||0);
    pedLiveSave(id, ed.existencia, ed.pedido);
  }));
  $('#pedCopyBtn')?.addEventListener('click', ()=>{
    const ings = (catalog.ingredients||[]).filter(i=>i.location_id===finLoc && i.active);
    const lines = ings.filter(ing=>Number((pedEdit2[ing.id]||{}).pedido||0)>0)
      .map(ing=>`\u2022 ${ing.name}: ${pedEdit2[ing.id].pedido} ${ing.unit}`);
    if(!lines.length){ toast('No hay cantidades capturadas en el pedido'); return; }
    const text = `Pedido ${LOCS[finLoc]}\n`+lines.join('\n');
    if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(text).then(()=>toast('Pedido copiado ✓')).catch(()=>toast('No se pudo copiar'));
    } else { toast('No se pudo copiar'); }
  });
}
