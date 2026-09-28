
async function refreshBank(){
  try{
    const [bk, tx] = await Promise.all([
      finRpc('bank_get', {p_month: bankMonth, p_loc: finLoc}),
      (async ()=>{
        const [y,m] = bankMonth.split('-').map(Number);
        const from = dstr(new Date(y, m-2, 1));
        const to = dstr(new Date(y, m+1, 0));
        return finRpc('fin_list_transactions', {p_from: from, p_to: to});
      })()
    ]);
    bankData = bk; txRange = tx||[];
  }catch(e){ bankData=null; return; }
  render();
}
function classifyBank(concept, kind){
  const c = concept.toUpperCase();
  if(/TASA DE DESCTO|IVA TASA|COMISION|ANUALIDAD TPV/.test(c)) return 'comision';
  if(/LIQUIDACION ADQ/.test(c)) return 'deposito_ventas';
  if(/TRASPASO ENTRE CUENTAS/.test(c)) return 'transfer';
  if(/RENDIMIENTO|INTERES/.test(c) && kind==='abono') return 'rendimiento';
  return kind==='cargo' ? 'gasto' : 'ingreso';
}
function parseBank(text){
  const lines = text.split(/\r?\n/);
  const items = []; let prevSaldo = null;
  for(const raw of lines){
    const l = raw.replace(/\t/g,'  ').trim(); if(!l) continue;
    const dm = l.match(/^([A-Z]{3,4})\.?\s*(\d{1,2})\b/i);
    if(!dm) { continue; }
    const nums = [...l.matchAll(/-?\d[\d,]*\.\d{2}/g)].map(m=>numMX(m[0]));
    if(!nums.length) continue;
    let amount, saldo=null;
    if(nums.length>=2){ saldo = nums[nums.length-1]; amount = nums[nums.length-2]; }
    else { amount = nums[0]; }
    const concept = l.replace(/^([A-Z]{3,4})\.?\s*(\d{1,2})\b/i,'')
      .replace(/-?\d[\d,]*\.\d{2}(\s*)$/,'').replace(/-?\d[\d,]*\.\d{2}(\s*)$/,'').trim();
    let kind;
    if(saldo!==null && prevSaldo!==null){ kind = saldo < prevSaldo ? 'cargo' : 'abono'; }
    else {
      kind = /LIQUIDACION ADQ|DEPOSITO|ABONO|RENDIMIENTO/i.test(concept) ? 'abono' : 'cargo';
    }
    if(saldo!==null) prevSaldo = saldo;
    if(amount<=0) continue;
    items.push({date_label: dm[1].toUpperCase()+'. '+dm[2].padStart(2,'0'), concept: concept.slice(0,300), amount, kind,
                class: classifyBank(concept, kind), matched_tx:'', status:'unmatched'});
  }
  if(!items.length) return {error:'No pude leer movimientos. Pega las filas del estado de cuenta (fecha, concepto, cantidad, saldo).'};
  return {items};
}
function autoMatchBank(items){
  const used = new Set(items.filter(i=>i.matched_tx).map(i=>i.matched_tx));
  const egresos = txRange.filter(t=>t.kind==='egreso' && t.location_id===finLoc);
  for(const it of items){
    if(it.kind!=='cargo' || it.class!=='gasto' || it.status!=='unmatched') continue;
    const cand = egresos.find(t=>!used.has(t.id) && Math.abs(Number(t.amount)-it.amount) < 0.01);
    if(cand){ it.matched_tx = cand.id; it.status='matched'; used.add(cand.id); }
  }
  for(const it of items){
    if(['comision','transfer','deposito_ventas','rendimiento'].includes(it.class) && it.status==='unmatched') it.status='ignored';
  }
  return items;
}
function bankView(){
  let h = locSwitch(finLoc,'floc');
  h += `<div class="toolbar"><label class="hint" for="bmon">Mes del estado de cuenta</label>
    <input type="month" id="bmon" value="${bankMonth}"></div>`;
  const items = bankParse ? bankParse.items : (bankData.saved ? bankData.items : null);
  if(!items){
    return h + `<div class="panel">
      <label>Pega el estado de cuenta del banco (las filas de movimientos)
        <textarea class="paste-box" id="bkBox" placeholder="MAY. 01  3931314331 TRASPASO ENTRE CUENTAS ...  1,800.00  198,080.15"></textarea></label>
      <div class="frm-row"><button type="button" class="btn-quiet" data-paste="bkBox">Pegar del portapapeles</button><button type="button" class="btn-quiet" data-pick="bkBox">Elegir archivo (Excel, CSV, PDF)</button></div><button class="btn-primary" id="procBk" style="width:100%">Procesar estado de cuenta</button>
      <p class="hint">La app separa fecha, concepto y monto; clasifica dep\u00f3sitos de terminal, comisiones de TC y traspasos; y cruza cada cargo contra los egresos registrados (\u00b160 d\u00edas, por monto exacto) \u2014 considerando que los pagos a proveedores con cr\u00e9dito salen semanas despu\u00e9s.</p></div>`;
  }
  const cargos = items.filter(i=>i.kind==='cargo');
  const gastos = cargos.filter(i=>i.class==='gasto');
  const matched = gastos.filter(i=>i.status==='matched');
  const unmatched = gastos.filter(i=>i.status==='unmatched');
  const comis = items.filter(i=>i.class==='comision').reduce((s,i)=>s+i.amount,0);
  const depVentas = items.filter(i=>i.class==='deposito_ventas').reduce((s,i)=>s+i.amount,0);
  const txById = Object.fromEntries(txRange.map(t=>[t.id,t]));
  const usedTx = new Set(items.map(i=>i.matched_tx).filter(Boolean));
  const [y,m] = bankMonth.split('-').map(Number);
  const monthEgresos = txRange.filter(t=>t.kind==='egreso' && t.location_id===finLoc &&
    t.tx_date.startsWith(bankMonth) && !usedTx.has(t.id) && t.category!=='nomina');
  h += `<div class="kpis">
    <div class="kpi"><div class="l">Cargos gasto</div><div class="v">${money(gastos.reduce((s,i)=>s+i.amount,0))}</div></div>
    <div class="kpi in"><div class="l">Dep\u00f3sitos terminal</div><div class="v">${money(depVentas)}</div></div>
    <div class="kpi out-k"><div class="l">Comisiones TC</div><div class="v">${money(comis)}</div></div>
  </div>
  <div class="rail"><div class="row"><span class="date">Conciliado</span><span class="count">${matched.length} / ${gastos.length}</span></div>
  <div class="track"><div class="fill ${unmatched.length===0?'done':''}" style="width:${gastos.length?Math.round(matched.length/gastos.length*100):0}%"></div></div></div>`;
  if(unmatched.length){
    h += `<div class="sec"><h2>Cargos sin conciliar (${unmatched.length})</h2></div>`;
    for(const it of unmatched){
      const ix = items.indexOf(it);
      const cands = txRange.filter(t=>t.kind==='egreso' && t.location_id===finLoc && !usedTx.has(t.id) &&
        Math.abs(Number(t.amount)-it.amount) < Math.max(1, it.amount*0.02));
      h += `<div class="txrow eg"><div class="c"><div class="t">${esc(it.date_label)} \u00b7 ${money(it.amount)}</div>
        <div class="m" style="overflow-wrap:anywhere">${esc(it.concept.slice(0,140))}</div>
        <div class="m" style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
          ${cands.length?`<select data-bmatch="${ix}" style="min-height:44px;border:1.5px solid var(--line);border-radius:8px;padding:6px;max-width:100%">
            <option value="">Conciliar con\u2026</option>
            ${cands.map(t=>`<option value="${t.id}">${t.tx_date} \u00b7 ${esc(t.concept.slice(0,40))} \u00b7 ${money(t.amount)}</option>`).join('')}</select>`:''}
          <button class="btn-quiet" data-breg="${ix}">Registrar como egreso</button>
          <button class="btn-quiet" data-bign="${ix}">Ignorar</button>
        </div></div></div>`;
    }
  }
  if(monthEgresos.length){
    h += `<div class="sec"><h2>Registrados en la app, sin aparecer en el banco (${monthEgresos.length})</h2></div>
    <p class="hint" style="margin-bottom:8px">Normal si se pagaron en efectivo, con otra cuenta, o el pago saldr\u00e1 el mes siguiente (cr\u00e9dito con proveedor).</p>`;
    for(const t of monthEgresos.slice(0,30)){
      h += `<div class="txrow"><div class="c"><div class="t">${esc(t.concept)}</div>
        <div class="m">${t.tx_date} \u00b7 <span class="cat-chip">${esc(CAT_LABEL[t.category]||t.category)}</span></div></div>
        <div class="amt" style="color:var(--ink)">${money(t.amount)}</div></div>`;
    }
  }
  if(matched.length){
    h += `<div class="sec"><h2>Conciliados (${matched.length})</h2></div>`;
    for(const it of matched.slice(0,50)){
      const ix = items.indexOf(it);
      const t = txById[it.matched_tx];
      h += `<div class="txrow" style="border-left-color:var(--ok)"><div class="c">
        <div class="t">${esc(it.date_label)} \u00b7 ${money(it.amount)}</div>
        <div class="m">${t?esc(t.concept)+' \u00b7 '+t.tx_date:'\u2014'}</div></div>
        <button class="btn-quiet" data-bunm="${ix}">Deshacer</button></div>`;
    }
  }
  h += `<div class="frm-row" style="margin-top:16px">
    <button class="btn-primary" id="saveBk">Guardar conciliaci\u00f3n</button>
    <button class="btn-quiet" id="redoBk">Pegar estado de nuevo</button></div>`;
  if(comis>0) h += `<div class="frm-row" style="margin-top:10px"><button class="btn-quiet" id="regComis">Registrar comisiones TC como egreso (${money(comis)})</button></div>`;
  return h;
}
async function wireBank(){
  wireDrop('bkBox');
  $('#bmon')?.addEventListener('change', e=>{ bankMonth=e.target.value; bankData=null; bankParse=null; refreshBank(); });
  $('#procBk')?.addEventListener('click', ()=>{
    const res = parseBank($('#bkBox').value);
    if(res.error){ toast(res.error); return; }
    res.items = autoMatchBank(res.items);
    bankParse = res; render();
    const n = res.items.filter(i=>i.status==='matched').length;
    toast(`${res.items.length} movimientos \u00b7 ${n} conciliados autom\u00e1ticamente`);
  });
  $('#redoBk')?.addEventListener('click', ()=>{ bankParse=null; bankData={saved:false, items:[]}; render(); });
  const items = bankParse ? bankParse.items : (bankData.saved ? bankData.items : []);
  $('#main').querySelectorAll('[data-bmatch]').forEach(s=>s.addEventListener('change', ()=>{
    if(!s.value) return;
    const it = items[Number(s.dataset.bmatch)];
    it.matched_tx = s.value; it.status='matched';
    if(!bankParse) bankParse = {items};
    render();
  }));
  $('#main').querySelectorAll('[data-bign]').forEach(b=>b.addEventListener('click', ()=>{
    items[Number(b.dataset.bign)].status='ignored';
    if(!bankParse) bankParse = {items};
    render();
  }));
  $('#main').querySelectorAll('[data-bunm]').forEach(b=>b.addEventListener('click', ()=>{
    const it = items[Number(b.dataset.bunm)];
    it.matched_tx=''; it.status='unmatched';
    if(!bankParse) bankParse = {items};
    render();
  }));
  $('#main').querySelectorAll('[data-breg]').forEach(b=>b.addEventListener('click', async ()=>{
    const it = items[Number(b.dataset.breg)];
    const [y,m] = bankMonth.split('-').map(Number);
    const day = it.date_label.match(/(\d{1,2})$/); 
    const date = `${bankMonth}-${String(day?day[1]:1).padStart(2,'0')}`;
    try{
      const row = await finRpc('fin_add_transaction', {p_date: date, p_location: finLoc, p_kind: 'egreso',
        p_category: 'otros_egresos', p_concept: it.concept.slice(0,120), p_amount: it.amount, p_notes: 'Del estado de cuenta'});
      txRange.push(row);
      it.matched_tx = row.id; it.status='matched';
      if(!bankParse) bankParse = {items};
      toast('Egreso registrado y conciliado'); render();
    }catch(e){}
  }));
  $('#regComis')?.addEventListener('click', async ()=>{
    const comis = items.filter(i=>i.class==='comision').reduce((s,i)=>s+i.amount,0);
    const [y,m] = bankMonth.split('-').map(Number);
    try{
      await finRpc('fin_add_transaction', {p_date: dstr(new Date(y, m, 0)), p_location: finLoc, p_kind:'egreso',
        p_category:'otros_egresos', p_concept:'Comisiones TC ' + bankMonth, p_amount: Math.round(comis*100)/100, p_notes:'Conciliaci\u00f3n bancaria'});
      toast('Comisiones registradas'); refreshFinance();
    }catch(e){}
  });
  $('#saveBk')?.addEventListener('click', async ()=>{
    try{
      await finRpc('bank_save', {p_month: bankMonth, p_loc: finLoc, p_items: items});
      toast('Conciliaci\u00f3n guardada');
      bankParse=null; bankData=null; refreshBank();
    }catch(e){}
  });
}
