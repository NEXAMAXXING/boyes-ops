/* ============================================================
   PRODUCTOS VENDIDOS · historial
   ------------------------------------------------------------
   El punto de venta sabe qué se vendió, pero no lo suelta en
   bloque: la lista de cuentas del día NO trae los renglones. Para
   saber cuántas hamburguesas se vendieron hay que pedir cada
   cuenta por separado. Un día son ~40 llamadas; un año, quince mil.

   Por eso esto no es una consulta, es un archivo. Cada día que se
   baja se guarda en la base y ya no se vuelve a pedir. El botón
   "actualizar del Soft a la fecha" pregunta primero qué días
   faltan y baja solo esos. Se puede cerrar la app a medio camino:
   lo bajado ya quedó, y al volver sigue donde se quedó.

   Una advertencia que tiene que verse, no esconderse: en San
   Carlos el punto de venta no entrega todas las cuentas, y de las
   que entrega muchas vienen sin renglones. Los números de San
   Carlos son un PISO, no un total. Guaymas sí cuadra al peso.
   ============================================================ */

let hpEstado   = null;      // qué hay guardado (prod_estado)
let hpDatos    = null;      // lo que se está viendo (prod_rango)
let hpCargando = false;
let hpDesde    = null;      // rango de la consulta
let hpHasta    = null;
let hpVista    = 'prod';    // prod | cat | dia
let hpBusca    = '';
let hpCat      = '';
let hpModif    = false;     // mostrar modificadores
let hpBaja     = null;      // {n, hechos, dia, errores:[], alto}
/* El punto de venta no guarda para siempre: probando día por día hacia atrás,
   antes de junio de 2024 contesta cero cuentas en todas las fechas. Ese es el
   principio del archivo, y por eso es el arranque por defecto. Pedir días que
   ya están guardados no cuesta nada — se descartan antes de salir a la red. */
let hpDesdeBajar = '2024-06-01';

const hpSuc  = () => finLoc === 1 ? 'guaymas' : 'sancarlos';
const hpHoy  = () => {
  /* Hermosillo no cambia de horario: UTC-7 todo el año. Sacar "hoy" del reloj
     del navegador manda a bajar un día que allá todavía no termina. */
  const d = new Date(Date.now() - 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};
const hpFmtDia = f => {
  if (!f) return '—';
  const d = new Date(f + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
};
const hpN = n => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 });

/* ---------- datos ---------- */

function hpRangoPorDefecto() {
  const h = hpHoy();
  hpHasta = h;
  hpDesde = h.slice(0, 8) + '01';           // el mes en curso
}

async function hpRefrescaEstado() {
  try { hpEstado = await finRpc('prod_estado', { p_loc: Number(finLoc) }, 12000); }
  catch (e) { hpEstado = null; toast('No se pudo leer el historial'); }
}

async function hpRefresca() {
  if (!hpDesde || !hpHasta) hpRangoPorDefecto();
  hpCargando = true; render();
  await hpRefrescaEstado();
  try {
    hpDatos = await finRpc('prod_rango', {
      p_loc: Number(finLoc), p_desde: hpDesde, p_hasta: hpHasta,
      p_cat: hpCat || null
    }, 20000);
  } catch (e) { hpDatos = { productos: [], categorias: [], serie: [], meta: null }; toast(e.message || 'Error al consultar'); }
  hpCargando = false; render();
}

/* ---------- la descarga ----------
   Un día a la vez, de a dos en paralelo. Más no: cada día ya son ~40
   llamadas al punto de venta por dentro, y saturarlo es la forma más rápida
   de que empiece a contestar con errores y quede el historial con hoyos. */
async function hpBajaUnDia(dia) {
  const c = (typeof corteHora !== 'undefined' ? corteHora : 6);
  const r = await fetch(`/api/soft-ventas?sucursal=${hpSuc()}&fecha=${dia}&corte=${c}` +
    `&token=${encodeURIComponent(user.token)}`, { cache: 'no-store' });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error(j?.error || `HTTP ${r.status}`);

  await finRpc('prod_guarda_dia', {
    p_loc: Number(finLoc), p_dia: dia,
    p_meta: {
      cuentas: j.ventas || 0,
      cuentas_con_detalle: j.ventas_con_detalle || 0,
      monto_sin_detalle: j.monto_sin_detalle || 0,
      venta_total: j.total || 0,
      unidades: j.unidades || 0,
      importe: j.importe_productos || 0
    },
    p_items: j.items || []
  }, 20000);
  return j;
}

async function hpActualiza() {
  if (hpBaja) return;
  const hasta = hpHoy();
  const desde = hpDesdeBajar;
  if (desde > hasta) { toast('La fecha inicial es mayor que hoy'); return; }

  let falt;
  try { falt = await finRpc('prod_faltantes', { p_loc: Number(finLoc), p_desde: desde, p_hasta: hasta }, 15000); }
  catch (e) { toast(e.message || 'No se pudo consultar qué falta'); return; }

  const dias = falt?.faltantes || [];
  if (!dias.length) {
    toast('Ya está al día — no falta ningún día en ese rango');
    await hpRefrescaEstado(); render(); return;
  }

  hpBaja = { n: dias.length, hechos: 0, dia: dias[0], errores: [], alto: false };
  render();

  /* Dos hilos comiendo de la misma lista. Van del día más reciente hacia
     atrás: si alguien se cansa y detiene la descarga a media hora, lo que
     alcanzó a bajar es lo que más le sirve. */
  let i = 0;
  const hilo = async () => {
    while (i < dias.length && !hpBaja.alto) {
      const d = dias[i++];
      try { await hpBajaUnDia(d); }
      catch (e) { hpBaja.errores.push({ dia: d, msg: String(e.message || e).slice(0, 120) }); }
      hpBaja.hechos++;
      hpBaja.dia = d;
      hpPintaAvance();
    }
  };
  await Promise.all([hilo(), hilo()]);

  const errs = hpBaja.errores;
  const detenido = hpBaja.alto;
  hpBaja = null;
  await hpRefresca();
  toast(detenido ? 'Descarga detenida — lo bajado quedó guardado'
    : errs.length ? `Listo, con ${errs.length} día(s) que no se pudieron bajar`
      : 'Historial actualizado');
}

/* El avance se pinta a mano, sin volver a dibujar la sección: repintar todo
   cada segundo durante media hora tira el scroll y lo que se esté escribiendo
   en los filtros. */
function hpPintaAvance() {
  if (!hpBaja) return;
  const b = $('#hpBarra'), t = $('#hpAvance');
  if (b) b.style.width = Math.round(100 * hpBaja.hechos / Math.max(1, hpBaja.n)) + '%';
  if (t) t.textContent = `${hpBaja.hechos} de ${hpBaja.n} días · ${hpFmtDia(hpBaja.dia)}` +
    (hpBaja.errores.length ? ` · ${hpBaja.errores.length} con error` : '');
}

/* ---------- vista ---------- */

function hpView() {
  if (!hpDesde || !hpHasta) hpRangoPorDefecto();
  let h = locSwitch(finLoc, 'floc');
  h += hpPanelHistorial();
  if (hpBaja) return h + hpPanelDescarga();
  h += hpFiltros();
  if (hpCargando) return h + `<div class="empty"><b>Consultando…</b></div>`;
  if (!hpDatos) return h;
  h += hpResumen();
  h += hpTabla();
  return h;
}

function hpPanelHistorial() {
  const e = hpEstado;
  const sc = finLoc === 2;
  const dias = e?.dias || 0;
  const faltan = e?.n_faltantes || 0;

  let aviso = '';
  if (sc) {
    aviso = `<p class="hint" style="background:#FBE4E4;color:var(--red);border-radius:10px;padding:10px 12px;margin:0">
      <b>San Carlos entrega incompleto.</b> El punto de venta no sube todas las
      cuentas, y de las que sí suben muchas llegan sin renglones. Lo que se ve
      aquí es un <b>piso</b>, no el total vendido. Guaymas sí cuadra.</p>`;
  } else if (e && e.cuentas > 0) {
    const falt = e.cuentas - e.cuentas_con_detalle;
    if (falt > 0) aviso = `<p class="hint" style="margin:0">
      De ${hpN(e.cuentas)} cuentas bajadas, <b>${hpN(falt)}</b> llegaron sin
      renglones (${money(e.monto_sin_detalle)}). Ese dinero está en la venta
      pero no en el detalle de productos.</p>`;
  }

  return `<div class="panel">
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <b style="font-size:16px">Historial guardado</b>
      <span class="hint">${dias
      ? `${hpN(dias)} días · ${hpFmtDia(e.primero)} a ${hpFmtDia(e.ultimo)}`
      : 'todavía no se ha bajado nada'}</span>
      ${faltan ? `<span class="pill warn" style="margin:0">faltan ${faltan} días</span>`
      : dias ? `<span class="pill ok" style="margin:0">al día</span>` : ''}
    </div>
    ${dias ? `<div class="kpis" style="margin:0">
      <div class="kpi"><div class="l">Unidades</div><div class="v">${hpN(e.unidades)}</div></div>
      <div class="kpi"><div class="l">Importe productos</div><div class="v">${money0(e.importe)}</div></div>
      <div class="kpi"><div class="l">Venta registrada</div><div class="v">${money0(e.venta)}</div></div>
    </div>` : ''}
    ${aviso}
    <div class="frm-row" style="align-items:end">
      <label>Bajar desde <input type="date" id="hpDesdeBajar" value="${hpDesdeBajar}" max="${hpHoy()}">
        <span class="hint">Solo se piden los días que falten. El punto de venta
          guarda desde junio de 2024 hacia acá; más atrás contesta vacío.</span></label>
      <button class="btn-primary" id="hpActualiza">Actualizar del Soft a la fecha</button>
    </div>
  </div>`;
}

function hpPanelDescarga() {
  const b = hpBaja;
  const pct = Math.round(100 * b.hechos / Math.max(1, b.n));
  return `<div class="panel">
    <b style="font-size:16px">Bajando del punto de venta…</b>
    <div style="height:14px;border-radius:999px;background:#E7E3D9;overflow:hidden">
      <div id="hpBarra" style="height:100%;width:${pct}%;background:var(--gold);transition:width .2s"></div>
    </div>
    <div id="hpAvance" style="font-variant-numeric:tabular-nums;font-weight:700">
      ${b.hechos} de ${b.n} días · ${hpFmtDia(b.dia)}</div>
    <p class="hint" style="margin:0">Cada día son unas 40 consultas al punto de venta,
      así que tarda. Puedes dejarlo corriendo. Lo que ya bajó queda guardado
      aunque lo detengas.</p>
    ${b.errores.length ? `<p class="hint" style="color:var(--red);margin:0">
      ${b.errores.length} día(s) con error: ${b.errores.slice(0, 4).map(x => x.dia).join(', ')}${b.errores.length > 4 ? '…' : ''}.
      Se vuelven a intentar la próxima vez que actualices.</p>` : ''}
    <button class="btn-quiet" id="hpAlto">Detener</button>
  </div>`;
}

function hpFiltros() {
  const cats = (hpDatos?.categorias || []).map(c => c.categoria);
  const h = hpHoy();
  const mesAnt = (() => {
    const d = new Date(h + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const ini = d.toISOString().slice(0, 10);
    const f = new Date(d); f.setMonth(f.getMonth() + 1); f.setDate(0);
    return [ini, f.toISOString().slice(0, 10)];
  })();
  const hace = n => { const d = new Date(h + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const rapidos = [
    ['Hoy', h, h],
    ['7 días', hace(6), h],
    ['30 días', hace(29), h],
    ['Este mes', h.slice(0, 8) + '01', h],
    ['Mes pasado', mesAnt[0], mesAnt[1]],
    ['Todo', hpEstado?.primero || h, hpEstado?.ultimo || h]
  ];

  return `<div class="panel">
    <div class="subnav" style="margin:0">
      ${rapidos.map(([l, a, b]) =>
    `<button data-hprap="${a}|${b}" aria-pressed="${hpDesde === a && hpHasta === b}">${l}</button>`).join('')}
    </div>
    <div class="frm-row-3" style="align-items:end">
      <label>Desde <input type="date" id="hpF1" value="${hpDesde}"></label>
      <label>Hasta <input type="date" id="hpF2" value="${hpHasta}"></label>
      <button class="btn-quiet" id="hpVer" style="min-height:52px">Ver</button>
    </div>
    <div class="frm-row-3" style="align-items:end">
      <label>Categoría <select id="hpCat">
        <option value="">Todas</option>
        ${cats.map(c => `<option value="${esc(c)}" ${hpCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select></label>
      <label>Buscar producto <input id="hpBusca" value="${esc(hpBusca)}" placeholder="hamburguesa…"></label>
      <label style="align-self:end"><span class="hint">
        <input type="checkbox" id="hpModif" ${hpModif ? 'checked' : ''} style="width:auto;margin-right:6px">
        Incluir modificadores</span></label>
    </div>
  </div>`;
}

/* Los modificadores («sin cebolla», «extra queso») son renglones de venta como
   cualquier otro, pero contarlos junto a los platillos infla las unidades sin
   que se haya vendido un producto más. Por eso salen aparte por defecto. */
const hpFiltrado = () => (hpDatos?.productos || [])
  .filter(p => hpModif || !p.modificador)
  .filter(p => !hpBusca || p.producto.includes(hpBusca.toUpperCase()));

function hpResumen() {
  const m = hpDatos?.meta || {};
  const lista = hpFiltrado();
  const uds = lista.reduce((s, p) => s + Number(p.qty || 0), 0);
  const imp = lista.reduce((s, p) => s + Number(p.importe || 0), 0);
  const diasPedidos = (() => {
    const a = new Date(hpDesde + 'T12:00:00'), b = new Date(hpHasta + 'T12:00:00');
    return Math.round((b - a) / 86400000) + 1;
  })();
  const guardados = Number(m.dias || 0);

  return `<div class="kpis">
    <div class="kpi"><div class="l">Productos distintos</div><div class="v">${hpN(lista.length)}</div></div>
    <div class="kpi"><div class="l">Unidades vendidas</div><div class="v">${hpN(uds)}</div></div>
    <div class="kpi"><div class="l">Importe</div><div class="v">${money0(imp)}</div></div>
  </div>
  ${guardados < diasPedidos ? `<p class="hint" style="margin:-8px 0 14px">
    En ese rango hay <b>${diasPedidos} días</b> y solo <b>${guardados}</b> están
    bajados. Los que faltan no cuentan aquí — usa el botón de arriba.</p>` : ''}
  <div class="subnav">
    <button data-hpv="prod" aria-pressed="${hpVista === 'prod'}">Por producto</button>
    <button data-hpv="cat"  aria-pressed="${hpVista === 'cat'}">Por categoría</button>
    <button data-hpv="dia"  aria-pressed="${hpVista === 'dia'}">Por día</button>
    <button class="btn-quiet" id="hpCsv" style="flex:none">Descargar CSV</button>
  </div>`;
}

function hpTabla() {
  if (hpVista === 'cat') return hpTablaCat();
  if (hpVista === 'dia') return hpTablaDia();
  return hpTablaProd();
}

function hpTablaProd() {
  const lista = hpFiltrado();
  if (!lista.length) return `<div class="empty"><b>Sin productos en ese rango.</b></div>`;
  const uds = lista.reduce((s, p) => s + Number(p.qty || 0), 0);
  const imp = lista.reduce((s, p) => s + Number(p.importe || 0), 0);
  return `<div class="res-wrap"><table class="res inv-tbl">
    <thead><tr>
      <th style="text-align:left">Producto</th><th style="text-align:left">Categoría</th>
      <th>Unidades</th><th>Importe</th><th>Días</th><th>Prom./día</th>
    </tr></thead><tbody>
    ${lista.map(p => `<tr>
      <td style="text-align:left">${esc(p.producto)}${p.modificador ? ' <span class="hint">(mod.)</span>' : ''}</td>
      <td style="text-align:left">${esc(p.categoria)}</td>
      <td>${hpN(p.qty)}</td>
      <td>${money(p.importe)}</td>
      <td>${p.dias}</td>
      <td>${hpN(Number(p.qty) / Math.max(1, Number(p.dias)))}</td>
    </tr>`).join('')}
    </tbody><tfoot><tr>
      <td style="text-align:left"><b>Total</b></td><td></td>
      <td><b>${hpN(uds)}</b></td><td><b>${money(imp)}</b></td><td></td><td></td>
    </tr></tfoot></table></div>`;
}

function hpTablaCat() {
  const cats = hpDatos?.categorias || [];
  if (!cats.length) return `<div class="empty"><b>Sin datos en ese rango.</b></div>`;
  const imp = cats.reduce((s, c) => s + Number(c.importe || 0), 0);
  return `<div class="res-wrap"><table class="res inv-tbl">
    <thead><tr><th style="text-align:left">Categoría</th><th>Productos</th>
      <th>Unidades</th><th>Importe</th><th>% del importe</th></tr></thead><tbody>
    ${cats.map(c => `<tr>
      <td style="text-align:left">${esc(c.categoria)}</td>
      <td>${c.productos}</td><td>${hpN(c.qty)}</td><td>${money(c.importe)}</td>
      <td>${imp ? (100 * Number(c.importe) / imp).toFixed(1) : '0.0'}%</td>
    </tr>`).join('')}
    </tbody><tfoot><tr><td style="text-align:left"><b>Total</b></td><td></td>
      <td><b>${hpN(cats.reduce((s, c) => s + Number(c.qty || 0), 0))}</b></td>
      <td><b>${money(imp)}</b></td><td></td></tr></tfoot></table></div>`;
}

function hpTablaDia() {
  const serie = hpDatos?.serie || [];
  if (!serie.length) return `<div class="empty"><b>No hay días bajados en ese rango.</b></div>`;
  return `<div class="res-wrap"><table class="res inv-tbl">
    <thead><tr><th style="text-align:left">Día</th><th>Cuentas</th>
      <th>Con detalle</th><th>Unidades</th><th>Importe productos</th>
      <th>Venta del día</th><th>Sin detalle</th></tr></thead><tbody>
    ${serie.map(d => {
    const falt = Number(d.cuentas) - Number(d.cuentas_con_detalle);
    return `<tr>
      <td style="text-align:left">${hpFmtDia(d.dia)}</td>
      <td>${d.cuentas}</td>
      <td${falt > 0 ? ' style="color:var(--red);font-weight:700"' : ''}>${d.cuentas_con_detalle}</td>
      <td>${hpN(d.unidades)}</td>
      <td>${money(d.importe)}</td>
      <td>${money(d.venta_total)}</td>
      <td${Number(d.monto_sin_detalle) > 0 ? ' style="color:var(--red)"' : ''}>${money(d.monto_sin_detalle)}</td>
    </tr>`;
  }).join('')}
    </tbody></table></div>`;
}

/* ---------- CSV ---------- */
function hpCsv() {
  const nl = '\r\n';
  let filas, nombre;
  if (hpVista === 'cat') {
    nombre = 'categorias';
    filas = [['Categoría', 'Productos', 'Unidades', 'Importe'],
    ...(hpDatos?.categorias || []).map(c => [c.categoria, c.productos, c.qty, c.importe])];
  } else if (hpVista === 'dia') {
    nombre = 'por-dia';
    filas = [['Día', 'Cuentas', 'Con detalle', 'Unidades', 'Importe productos', 'Venta del día', 'Sin detalle'],
    ...(hpDatos?.serie || []).map(d => [d.dia, d.cuentas, d.cuentas_con_detalle, d.unidades,
    d.importe, d.venta_total, d.monto_sin_detalle])];
  } else {
    nombre = 'productos';
    filas = [['Producto', 'Categoría', 'Modificador', 'Unidades', 'Importe', 'Días'],
    ...hpFiltrado().map(p => [p.producto, p.categoria, p.modificador ? 'sí' : 'no',
    p.qty, p.importe, p.dias])];
  }
  const txt = '﻿' + filas.map(f => f.map(c => {
    const s = String(c ?? '');
    return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join(nl);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = `productos-${hpSuc()}-${nombre}-${hpDesde}_${hpHasta}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- eventos ---------- */
function wireHprod() {
  $('#hpActualiza')?.addEventListener('click', hpActualiza);
  $('#hpDesdeBajar')?.addEventListener('change', e => { hpDesdeBajar = e.target.value; });
  $('#hpAlto')?.addEventListener('click', () => { if (hpBaja) { hpBaja.alto = true; toast('Deteniendo…'); } });

  $('#main').querySelectorAll('[data-hprap]').forEach(b => b.addEventListener('click', () => {
    const [a, z] = b.dataset.hprap.split('|');
    hpDesde = a; hpHasta = z; hpRefresca();
  }));
  $('#hpVer')?.addEventListener('click', () => {
    const a = $('#hpF1').value, z = $('#hpF2').value;
    if (!a || !z) { toast('Elige las dos fechas'); return; }
    if (a > z) { toast('La fecha inicial es mayor que la final'); return; }
    hpDesde = a; hpHasta = z; hpRefresca();
  });
  $('#hpCat')?.addEventListener('change', e => { hpCat = e.target.value; hpRefresca(); });
  $('#hpModif')?.addEventListener('change', e => { hpModif = e.target.checked; render(); });

  /* La búsqueda filtra lo ya traído: no hace falta ir a la base por cada
     letra, y así el cursor no se pierde a media palabra. */
  const bus = $('#hpBusca');
  if (bus) bus.addEventListener('input', e => {
    hpBusca = e.target.value;
    const cur = e.target.selectionStart;
    render();
    const n = $('#hpBusca');
    if (n) { n.focus(); try { n.setSelectionRange(cur, cur); } catch (x) { } }
  });

  $('#main').querySelectorAll('[data-hpv]').forEach(b => b.addEventListener('click', () => {
    hpVista = b.dataset.hpv; render();
  }));
  $('#hpCsv')?.addEventListener('click', hpCsv);
}
