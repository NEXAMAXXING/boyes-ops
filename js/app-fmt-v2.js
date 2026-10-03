/* ============================================================
   Boye's OPS — Barra de formato de la Planilla
   ------------------------------------------------------------
   Lo que se espera de una hoja de cálculo: negritas, color de
   relleno, color de letra, y tamaño. El formato se guarda por
   celda junto con el mes, así que sobrevive a recargar.

   El relleno es el que de verdad importa aquí: Rod resalta celdas
   y ese color SIGNIFICA algo en su operación. Por eso la paleta
   son colores nombrados, no una rueda infinita: un color con
   nombre se puede contar después; uno cualquiera, no.
   ============================================================ */

/* La clave de una celda tiene que ser estable entre recargas, así que se arma
   de lo que la identifica en los datos —sección, concepto, día— y nunca de su
   posición en pantalla. */
function fmtClave(inp){
  if(inp.dataset.pv !== undefined) return `v|${inp.dataset.pv}|${inp.dataset.pvf}`;
  if(inp.dataset.pg !== undefined) return `g|${inp.dataset.pg}|${inp.dataset.pgd}`;
  if(inp.dataset.pf !== undefined) return `f|${inp.dataset.pf}|${inp.dataset.pff}`;
  return null;
}

/* Colores con nombre. El primero de cada lista es "quitar". */
const FMT_RELLENO = [
  ['', 'Sin relleno'],
  ['#FFF3B0','Amarillo'], ['#FFD5CC','Rojo claro'], ['#CDEBD6','Verde'],
  ['#CFE3FB','Azul'],     ['#EBD8F7','Morado'],     ['#FFE0B8','Naranja'],
  ['#E4E4E4','Gris'],     ['#FFFFFF','Blanco']
];
const FMT_LETRA = [
  ['', 'Automático'],
  ['#C0261F','Rojo'], ['#0B6E3F','Verde'], ['#1B4FA8','Azul'],
  ['#8A5A00','Café'], ['#6B2E9E','Morado'], ['#5B6472','Gris'], ['#111111','Negro']
];

let fmtSel = [];          // claves seleccionadas ahorita
let fmtAncla = null;      // para seleccionar un rango con shift
let fmtZoom = Number(localStorage.getItem('boyes_pt_zoom') || 100);

function fmtDe(k){ return (planEdit.formato||{})[k] || {}; }

function fmtAplica(cambio){
  if(!fmtSel.length){ toast('Primero toca una casilla'); return; }
  planEdit.formato = planEdit.formato || {};
  for(const k of fmtSel){
    const f = { ...(planEdit.formato[k]||{}), ...cambio };
    /* Un valor vacío no se guarda: así una celda sin formato pesa cero y el
       mes no se llena de objetos vacíos. */
    for(const p of Object.keys(f)) if(f[p]==='' || f[p]===false) delete f[p];
    if(Object.keys(f).length) planEdit.formato[k] = f; else delete planEdit.formato[k];
  }
  /* Aquí NO se vuelve a dibujar la vista. Redibujar mientras el cursor está en
     una casilla la destruye y el foco se pierde a media captura —que fue
     exactamente el defecto que metió esta barra. fmtPinta escribe los estilos
     sobre las casillas que ya están en pantalla, así que no hace falta. */
  fmtPinta();
  fmtBarraRefresca();
}

/* Pinta el formato guardado sobre las casillas que están en pantalla. Se hace
   después de dibujar y no dentro del HTML para no rehacer toda la tabla. */
function fmtPinta(){
  const M = document.getElementById('main');
  if(!M) return;
  M.querySelectorAll('.pt input').forEach(inp=>{
    const k = fmtClave(inp); if(!k) return;
    const f = fmtDe(k), td = inp.closest('td');
    if(!td) return;
    td.style.background = f.bg || '';
    inp.style.color      = f.fg || '';
    inp.style.fontWeight = f.b ? '800' : '';
    inp.style.fontStyle  = f.i ? 'italic' : '';
    inp.style.textDecoration = f.s ? 'line-through' : '';
  });
  fmtMarca();
  const t = M.querySelector('.pt');
  if(t && !(typeof planZoomAplica==='function' && planZoomAplica())) t.style.fontSize = (13*fmtZoom/100).toFixed(1)+'px';
}

function fmtBarra(){
  const uno = fmtSel.length===1 ? fmtDe(fmtSel[0]) : {};
  const act = p => fmtSel.length===1 && uno[p] ? ' fmt-on' : '';
  const swatch = (lista, campo) => lista.map(([c,nom])=>
    `<button type="button" class="fmt-sw${c?'':' fmt-x'}" data-fmt-c="${campo}" data-fmt-v="${c}"
       title="${nom}" aria-label="${nom}" style="${c?`background:${c}`:''}"></button>`).join('');
  return `<div class="fmt-bar" role="toolbar" aria-label="Formato">
    <div class="fmt-g">
      <button type="button" class="fmt-b" data-fmt-zoom="-1" aria-label="Letra más chica">−</button>
      <span class="fmt-z">${fmtZoom}%</span>
      <button type="button" class="fmt-b" data-fmt-zoom="1" aria-label="Letra más grande">+</button>
    </div>
    <div class="fmt-g">
      <button type="button" class="fmt-b${act('b')}" data-fmt-t="b" aria-label="Negritas"><b>B</b></button>
      <button type="button" class="fmt-b${act('i')}" data-fmt-t="i" aria-label="Cursiva"><i>I</i></button>
      <button type="button" class="fmt-b${act('s')}" data-fmt-t="s" aria-label="Tachado"><s>S</s></button>
    </div>
    <div class="fmt-g fmt-pop">
      <button type="button" class="fmt-b" data-fmt-abrir="fg" aria-label="Color de letra"><b style="border-bottom:3px solid ${uno.fg||'#111'}">A</b></button>
      <div class="fmt-menu" data-fmt-m="fg">${swatch(FMT_LETRA,'fg')}</div>
    </div>
    <div class="fmt-g fmt-pop">
      <button type="button" class="fmt-b" data-fmt-abrir="bg" aria-label="Color de relleno">
        <span class="fmt-cubo" style="background:${uno.bg||'#fff'}"></span></button>
      <div class="fmt-menu" data-fmt-m="bg">${swatch(FMT_RELLENO,'bg')}</div>
    </div>
    <span class="fmt-info">${fmtSel.length
      ? `<b>${fmtSel.length}</b> casilla${fmtSel.length===1?'':'s'} · shift+clic para un rango`
      : 'Toca una casilla para darle formato'}</span>
  </div>`;
}

let _fmtListo = false;
function instalaFormato(){
  if(_fmtListo) return;
  _fmtListo = true;
  const M = document.getElementById('main');

  /* Selección: un clic elige una; shift+clic elige el rectángulo desde la
     anterior, que es como se resalta un bloque de días de verdad. */
  M.addEventListener('mousedown', e=>{
    const inp = e.target.closest('.pt input'); if(!inp) return;
    const k = fmtClave(inp); if(!k) return;
    if(e.shiftKey && fmtAncla){
      e.preventDefault();
      fmtSel = fmtRango(fmtAncla, inp);
    } else { fmtAncla = inp; fmtSel = [k]; }
    /* Solo se marca lo seleccionado. Un render() aquí borraría el <input> que
       el clic está a punto de enfocar y la casilla se quedaría muerta. */
    fmtMarca();
    fmtBarraRefresca();
  });

  M.addEventListener('click', e=>{
    const ab = e.target.closest('[data-fmt-abrir]');
    if(ab){ const m = M.querySelector(`[data-fmt-m="${ab.dataset.fmtAbrir}"]`);
      M.querySelectorAll('.fmt-menu.open').forEach(x=>{ if(x!==m) x.classList.remove('open'); });
      m?.classList.toggle('open'); return; }
    const sw = e.target.closest('[data-fmt-c]');
    if(sw){ fmtAplica({ [sw.dataset.fmtC]: sw.dataset.fmtV }); return; }
    const t = e.target.closest('[data-fmt-t]');
    if(t){ const p = t.dataset.fmtT;
      const prendido = fmtSel.length && fmtSel.every(k=>fmtDe(k)[p]);
      fmtAplica({ [p]: prendido ? '' : true }); return; }
    const z = e.target.closest('[data-fmt-zoom]');
    if(z && typeof planZoomA==='function' && document.getElementById('wkScroll')){
      planZoomA((Math.round(fmtZoom/10) + Number(z.dataset.fmtZoom))*10); return; }
    if(z){ fmtZoom = Math.max(70, Math.min(160, fmtZoom + Number(z.dataset.fmtZoom)*10));
      localStorage.setItem('boyes_pt_zoom', fmtZoom);
      const et = M.querySelector('.fmt-z'); if(et) et.textContent = fmtZoom+'%';
      fmtPinta(); return; }
    if(!e.target.closest('.fmt-pop')) M.querySelectorAll('.fmt-menu.open').forEach(x=>x.classList.remove('open'));
  });
}

/* El rectángulo entre dos casillas, por posición en la tabla. */
function fmtRango(a, b){
  const ta = a.closest('td'), tb = b.closest('td');
  const cuerpo = ta.closest('tbody');
  if(!cuerpo || tb.closest('tbody')!==cuerpo) return [fmtClave(b)];
  const filas = [...cuerpo.rows];
  const f1 = filas.indexOf(ta.closest('tr')), f2 = filas.indexOf(tb.closest('tr'));
  const c1 = ta.cellIndex, c2 = tb.cellIndex;
  const out = [];
  for(let f=Math.min(f1,f2); f<=Math.max(f1,f2); f++)
    for(let c=Math.min(c1,c2); c<=Math.max(c1,c2); c++){
      const cel = filas[f]?.cells[c];
      const x = cel && cel.querySelector('input');
      const k = x && fmtClave(x);
      if(k) out.push(k);
    }
  return out;
}


/* Solo el marco de la selección. Barato: no toca estilos ni redibuja nada. */
function fmtMarca(){
  const M = document.getElementById('main');
  if(!M) return;
  M.querySelectorAll('.pt input').forEach(inp=>{
    const k = fmtClave(inp), td = inp.closest('td');
    if(!k || !td) return;
    td.classList.toggle('fmt-sel', fmtSel.includes(k));
  });
}

/* La barra al día sin volver a dibujarla: el contador, los botones prendidos,
   el cubo de relleno y la raya bajo la A. */
function fmtBarraRefresca(){
  const M = document.getElementById('main');
  if(!M) return;
  const uno = fmtSel.length===1 ? fmtDe(fmtSel[0]) : {};
  const info = M.querySelector('.fmt-info');
  if(info) info.innerHTML = fmtSel.length
    ? `<b>${fmtSel.length}</b> casilla${fmtSel.length===1?'':'s'} · shift+clic para un rango`
    : 'Toca una casilla para darle formato';
  M.querySelectorAll('[data-fmt-t]').forEach(b=>
    b.classList.toggle('fmt-on', fmtSel.length===1 && !!uno[b.dataset.fmtT]));
  const cubo = M.querySelector('[data-fmt-abrir="bg"] .fmt-cubo');
  if(cubo) cubo.style.background = uno.bg || '#fff';
  const letra = M.querySelector('[data-fmt-abrir="fg"] b');
  if(letra) letra.style.borderBottom = '3px solid ' + (uno.fg || '#111');
}
