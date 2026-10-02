/* ============================================================
   Ventas desde Soft Restaurant, para Boye's Ops.
   ------------------------------------------------------------
   Todo pasa por aquí y no desde el navegador por una razón: la
   llave de Soft (SOFT_APPKEY_PROD) vive en las variables de
   entorno de Netlify y NO debe tocar el navegador nunca. Quien
   la tenga puede leer —y escribir— las ventas de las dos
   sucursales.

   Cada llamada exige un token de sesión de la app, que se
   valida contra la base. Sin sesión no se contesta nada.

   El DÍA DE NEGOCIO no es el día natural: una venta de la 1 de
   la mañana del domingo pertenece al sábado. La hora de corte
   (`corte`, 6 por default) es la que parte los días.

   Sobre las fechas hay una trampa que ya mordió dos veces:
   Sale/Get IGNORA la hora que se le manda y trabaja por días
   COMPLETOS. Por eso el recorte por hora de corte se hace aquí
   en el código (ver `ventana` y `esDelDia`), nunca pidiéndole
   a la API una ventana con horas. Cuando se intentó lo segundo,
   cada venta cayó en dos días y la semana salió al doble: 321
   cuentas donde el corte impreso marca 158.

   Al cambiar cualquier cosa de aquí, comprobarlo contra un
   corte impreso —cuentas y pesos— antes de darlo por bueno.
   ============================================================ */
const SALE    = "https://sale-api.national-soft.com";
const CATALOG = "https://catalog-api.national-soft.com";
const ACCOUNT = "038b533f-db16-483b-b664-b07a00cb7ba0";
const SUC = {
  guaymas:   { companyId: "c46b91f7-57ce-41fb-ada9-b18700c6a026", nombre: "Guaymas" },
  sancarlos: { companyId: "bdb52303-8016-405a-992e-b49d00eb4d1e", nombre: "San Carlos" }
};

const SUPA_URL = "https://pyhfpggduehplobtanee.supabase.co";
const SUPA_KEY = "sb_publishable_3w-exsBCuqK0l8A3k6H2Fg_j-nvrf1C";

/* ---------- sesión ---------- */
async function sesionValida(token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ""))) return false;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/fin_user`, {
      method: "POST",
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
                 "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token })
    });
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    const u = Array.isArray(d) ? d[0] : d;
    return !!(u && u.id);
  } catch { return false; }
}

/* ---------- utilidades ---------- */
const r2  = n => Math.round(Number(n || 0) * 100) / 100;
const dia = f => { const d = new Date(f + "T12:00:00Z"); return d; };
const mueve = (f, n) => {
  const d = dia(f); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hh = h => String(Math.max(0, Math.min(23, Number(h) || 0))).padStart(2, "0");

async function post(ruta, key, cuerpo) {
  try {
    const r = await fetch(SALE + ruta, {
      method: "POST",
      headers: { AuthorizedApp: key, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });
    const t = await r.text();
    let d = null; try { d = JSON.parse(t); } catch { /* no vino JSON */ }
    return { http: r.status, ok: r.ok, data: d, crudo: r.ok ? null : t.slice(0, 250) };
  } catch (e) { return { http: 0, ok: false, data: null, crudo: String(e).slice(0, 250) }; }
}

/* ---- LA VENTANA DE UN DÍA DE NEGOCIO ----
   Aquí está la trampa que ya nos costó una vez, y que volvió a morder:
   Sale/Get IGNORA la hora que se le manda. Trabaja por días completos. Así
   que pedir `EndDate: <día siguiente>T06:00` no trae "hasta las 6 am" —
   trae el día siguiente ENTERO. Y como cada día se pide por separado, cada
   venta caía en dos días y las sumas salían al doble: 321 cuentas donde el
   corte marca 158.

   Entonces se hace al revés: se le piden a la API los días completos que
   puedan contener la jornada, y el recorte fino por hora se hace aquí, con
   `esDelDia`. La API entrega de más; nosotros filtramos. */
function ventana(fecha, corte) {
  const c = Math.max(0, Math.min(12, Number(corte) || 0));
  if (!c) return { InitDate: `${fecha}T00:00:00`, EndDate: `${fecha}T23:59:59` };
  /* La jornada se derrama a la madrugada del día siguiente, así que se piden
     los dos días naturales y luego se filtra. */
  return { InitDate: `${fecha}T00:00:00`, EndDate: `${mueve(fecha, 1)}T23:59:59` };
}

/* ¿Esta venta pertenece al día de NEGOCIO `fecha`? Con corte 6: desde las
   6:00 de ese día hasta las 5:59 del siguiente. */
function esDelDia(v, fecha, corte) {
  const c = Math.max(0, Math.min(12, Number(corte) || 0));
  const t = String(v?.Date || "");
  const d = t.slice(0, 10);
  if (!d) return false;
  if (!c) return d === fecha;
  const h = Number(t.slice(11, 13));
  if (d === fecha) return !Number.isNaN(h) && h >= c;
  if (d === mueve(fecha, 1)) return !Number.isNaN(h) && h < c;
  return false;
}

/* Pide un día de negocio y devuelve SOLO sus ventas, ya recortadas.

   Con `conDetalle` se va además por los renglones de cada venta. Hace falta
   porque Sale/Get devuelve `SaleDetail` en null SIEMPRE: la lista del día
   trae totales y formas de pago, pero no qué se vendió. Los productos solo
   aparecen preguntando venta por venta con Sale/Find.

   Es caro —una llamada por cuenta— así que solo se hace cuando de verdad se
   piden los productos: el inventario y el historial los necesitan, el corte
   y la pantalla de tarjetas no. */
async function ventasDelDia(key, cid, fecha, corte, conDetalle) {
  const r = await post("/api/Sale/Get", key,
    { AccountId: ACCOUNT, CompanyId: cid, ...ventana(fecha, corte) });
  if (!r.ok) return { ok: false, r, vs: [] };
  let vs = ventas(r.data).filter(v => esDelDia(v, fecha, corte));

  if (conDetalle && vs.length) {
    const vivas = vs.filter(v => !v.IsCancelled);
    const porId = new Map();
    const tanda = 8;
    for (let i = 0; i < vivas.length; i += tanda) {
      const lote = await Promise.all(vivas.slice(i, i + tanda).map(async v => {
        const rr = await post("/api/Sale/Find", key,
          { AccountId: ACCOUNT, CompanyId: cid, SaleId: v.SaleId });
        const uno = ventas(rr.data)[0];
        return [v.SaleId, uno?.SaleDetail || null];
      }));
      for (const [id, det] of lote) if (Array.isArray(det) && det.length) porId.set(id, det);
    }
    vs = vs.map(v => porId.has(v.SaleId) ? { ...v, SaleDetail: porId.get(v.SaleId) } : v);
  }
  return { ok: true, r, vs };
}

const ventas = d => Array.isArray(d?.Object) ? d.Object : (d?.Object ? [d.Object] : []);

/* Clasificación de formas de pago. El nombre lo pone cada sucursal en su
   catálogo, así que se reconoce por texto y no por un id que cambia. */
function clasePago(nombre) {
  const n = String(nombre || "").toUpperCase();
  /* Las plataformas van PRIMERO y a propósito. "RAPPI" contiene "APP", así
     que con el orden al revés caía en tarjeta y el corte dejaba de cuadrar:
     el dinero de Rappi no llega por la terminal, llega por transferencia de
     la plataforma días después. Va en `otros`, con su nombre, como en el
     corte impreso. */
  if (/RAPPI|DIDI|UBER|MAQUILA|PLATAFORMA/.test(n)) return "otros";
  if (/CORTESIA|CORTESÍA|INVITACION|INVITACIÓN/.test(n)) return "cortesia";
  if (/EFECTIVO|CASH/.test(n)) return "efectivo";
  if (/TRANSFER|SPEI|DEPOSITO|DEPÓSITO/.test(n)) return "transferencia";
  if (/TARJETA|CARD|CREDITO|CRÉDITO|DEBITO|DÉBITO|TERMINAL|PAGO DESDE LA APP/.test(n)) return "tarjeta";
  return "otros";
}
const nombrePago = p => p?.PaymentMethod?.Description ?? p?.PaymentMethodName
                      ?? p?.PaymentMethod ?? "SIN NOMBRE";

/* Resume un montón de ventas: totales, formas de pago, productos y horas.
   Es el corazón del modo por día y del modo rango. */
function resume(vs, corte) {
  const pagos = { efectivo: 0, tarjeta: 0, transferencia: 0, cortesia: 0, otros: 0 };
  const otros_detalle = {}, porHora = {}, prods = {};
  let total = 0, propinas = 0, descuentos = 0, nCanc = 0, montoCanc = 0, n = 0;
  let conDetalle = 0, sinDetalle = 0, unidades = 0, importeProd = 0, sinPago = 0;

  for (const v of vs) {
    if (v.IsCancelled) { nCanc++; montoCanc += Number(v.SaleTotal?.Total || 0); continue; }
    n++;
    const t = Number(v.SaleTotal?.Total || 0);
    total += t;
    propinas   += Number(v.SaleTotal?.Tips || 0);
    descuentos += Number(v.SaleTotal?.Discount || 0);

    const det = Array.isArray(v.SaleDetail) ? v.SaleDetail : [];
    if (det.length) {
      conDetalle++;
      for (const d of det) {
        const nom = d.Product?.Name || d.ProductName || "SIN NOMBRE";
        const q = Number(d.Quantity || 0), imp = Number(d.Price || 0) * q;
        unidades += q; importeProd += imp;
        if (!prods[nom]) prods[nom] = { name: nom, qty: 0, price: Number(d.Price || 0),
                                        total: 0, category: d.Product?.Category || "GENERAL" };
        prods[nom].qty += q; prods[nom].total += imp;
      }
    } else { sinDetalle += t; }

    const pgs = v.SalePayment || [];
    if (!pgs.length) sinPago++;
    for (const p of pgs) {
      const nom = nombrePago(p), monto = Number(p.Amount || 0);
      const c = clasePago(nom);
      pagos[c] = (pagos[c] || 0) + monto;
      if (c === "otros") otros_detalle[nom.toUpperCase()] = (otros_detalle[nom.toUpperCase()] || 0) + monto;
    }

    /* La hora del día de negocio: una venta de las 2 am con corte 6 cuenta
       como parte de la madrugada del día anterior, no como "hora 2" suelta. */
    const f = String(v.Date || "");
    const h = Number(f.slice(11, 13));
    if (!Number.isNaN(h)) {
      if (!porHora[h]) porHora[h] = { hora: h, total: 0, ventas: 0, cuentas: 0 };
      porHora[h].total += t; porHora[h].ventas++; porHora[h].cuentas++;
    }
  }

  for (const k of Object.keys(pagos)) pagos[k] = r2(pagos[k]);
  for (const k of Object.keys(otros_detalle)) otros_detalle[k] = r2(otros_detalle[k]);

  return {
    ventas: n, canceladas: nCanc, monto_cancelado: r2(montoCanc),
    total: r2(total), propinas: r2(propinas), descuentos: r2(descuentos),
    unidades: r2(unidades), importe_productos: r2(importeProd),
    ventas_con_detalle: conDetalle, monto_sin_detalle: r2(sinDetalle),
    cuentas_sin_pago: sinPago,
    pagos, otros_detalle,
    por_hora: Object.values(porHora).sort((a, b) => a.hora - b.hora),
    items: Object.values(prods).map(p => ({ ...p, qty: r2(p.qty), total: r2(p.total) }))
                               .sort((a, b) => b.total - a.total)
  };
}

const malo = (msg, extra) => Response.json({ error: msg, ...(extra || {}) },
  { status: 200, headers: { "Cache-Control": "no-store" } });
const bien = obj => Response.json(obj, { headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const q = k => url.searchParams.get(k);

  const key = process.env.SOFT_APPKEY_PROD;
  if (!key) return malo("falta configurar la llave de Soft en el servidor");

  if (!(await sesionValida(q("token"))))
    return Response.json({ error: "No autorizado" }, { status: 401 });

  const sucursal = q("sucursal") || "";
  const suc = SUC[sucursal];
  if (!suc) return malo("sucursal desconocida");
  const cid = suc.companyId;

  const modo  = q("modo") || "";
  const corte = q("corte") === null ? 6 : Number(q("corte"));
  const hoyNeg = () => {
    /* El "hoy" del negocio, en hora de Sonora (UTC-7) y ya corrido por la
       hora de corte: a las 2 am todavía es el día anterior. */
    const d = new Date(Date.now() - 7 * 3600 * 1000);
    if (d.getUTCHours() < (Number(corte) || 0)) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  /* ================= MODO VIVO: cómo va hoy ================= */
  if (modo === "vivo") {
    const fecha = hoyNeg();
    const { ok, r, vs } = await ventasDelDia(key, cid, fecha, corte);
    if (!ok) return malo("el punto de venta no contestó", { msg: r.crudo, http: r.http });
    const R = resume(vs, corte);
    const ahora = new Date(Date.now() - 7 * 3600 * 1000);
    /* Aquí —y solo aquí— el efectivo lleva la transferencia adentro: la
       pantalla lo dice así con todas sus letras. */
    return bien({
      fecha, hora_negocio: `${String(ahora.getUTCHours()).padStart(2,"0")}:${String(ahora.getUTCMinutes()).padStart(2,"0")}`,
      total: R.total, ventas: R.ventas, canceladas: R.canceladas, propinas: R.propinas,
      ticket: R.ventas ? r2(R.total / R.ventas) : 0,
      pagos: { efectivo: r2(R.pagos.efectivo + R.pagos.transferencia), tarjeta: R.pagos.tarjeta },
      por_hora: R.por_hora.map(x => ({ hora: x.hora, total: r2(x.total), ventas: x.ventas })),
      /* El mesero no viene en la venta. En vez de inventar un desglose, se
         dice qué campos SÍ manda para que se vea que no está. */
      hay_meseros: false, meseros: [],
      campos_de_la_venta: vs.length ? Object.keys(vs[0]).sort() : []
    });
  }

  /* ================= MODO PAGOS: catálogo ================= */
  if (modo === "pagos") {
    let r;
    try {
      const resp = await fetch(`${CATALOG}/api/CompanyPaymentMethods/Get`, {
        method: "POST",
        headers: { AuthorizedApp: key, "Content-Type": "application/json" },
        body: JSON.stringify({ AccountId: ACCOUNT, CompanyId: cid })
      });
      const t = await resp.text();
      let d = null; try { d = JSON.parse(t); } catch { /* no vino JSON */ }
      r = { ok: resp.ok, http: resp.status, data: d, crudo: resp.ok ? null : t.slice(0, 250) };
    } catch (e) { return malo("no se pudo leer el catálogo de formas de pago", { msg: String(e) }); }
    if (!r.ok) return malo("el catálogo no contestó", { msg: r.crudo, http: r.http });

    const lista = [].concat(r.data?.Object || []);
    const metodos = lista.map(f => ({
      id: f?.PaymentMethodId ?? f?.Id ?? null,
      nombre: f?.PaymentMethodName ?? f?.Name ?? null,
      code: f?.Code ?? f?.PaymentMethodCode ?? "",
      asociado: f?.IsActive ?? f?.Active ?? false
    }));
    return bien({ metodos, tiene_pago_app: metodos.some(m => Number(m.id) === 22) });
  }

  /* ================= MODO PRODUCTOS: el catálogo con precios =================
     Para las cotizaciones: lo que hay en el punto de venta y a cuánto, tal
     cual lo cobra la caja. National Soft no documenta la ruta del catálogo
     de productos, así que se prueban las conocidas y se usa la primera que
     conteste con una lista. `sondeo` dice qué contestó cada una. */
  if (modo === "productos") {
    const rutas = [
      "/api/CompanyProducts/Get", "/api/CompanyProduct/Get", "/api/Products/Get",
      "/api/Product/Get", "/api/CompanyMenu/Get", "/api/Menu/Get",
      "/api/CompanyProductPrices/Get", "/api/ProductPrices/Get"
    ];
    const pide = async ruta => {
      try {
        const resp = await fetch(CATALOG + ruta, {
          method: "POST",
          headers: { AuthorizedApp: key, "Content-Type": "application/json" },
          body: JSON.stringify({ AccountId: ACCOUNT, CompanyId: cid })
        });
        const t = await resp.text();
        let d = null; try { d = JSON.parse(t); } catch { /* no vino JSON */ }
        return { http: resp.status, ok: resp.ok, data: d, crudo: t.slice(0, 200) };
      } catch (e) { return { http: 0, ok: false, data: null, crudo: String(e).slice(0, 200) }; }
    };
    const sondeo = [];
    let lista = null, ruta = null;
    for (const r of rutas) {
      const rr = await pide(r);
      const arr = Array.isArray(rr.data?.Object) ? rr.data.Object
                : Array.isArray(rr.data) ? rr.data : null;
      sondeo.push({ ruta: r, http: rr.http, n: arr ? arr.length : null,
                    dice: rr.data?.Message?.ErrorMessage || (arr ? null : rr.crudo) });
      if (arr && arr.length) { lista = arr; ruta = r; break; }
    }
    if (!lista) return malo("no encontré el catálogo de productos en el punto de venta", { sondeo });

    const num = v => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
    const precioDe = x => {
      for (const k of ["Price", "SalePrice", "PriceWithTax", "Price1", "UnitPrice", "PublicPrice"])
        if (num(x?.[k]) !== null) return num(x[k]);
      const ps = x?.Prices || x?.ProductPrices || x?.PriceList;
      if (Array.isArray(ps) && ps.length) {
        const p = ps[0]; for (const k of ["Price", "Amount", "Value", "Price1"]) if (num(p?.[k]) !== null) return num(p[k]);
      }
      return null;
    };
    /* Soft guarda TODO lo que alguna vez existió: promos viejas, grupos de
       temporada, duplicados con otro precio. Las banderas (IsSuspended,
       IsVisible…) vienen iguales en todos los productos, así que no sirven
       para separar. Lo que sí separa es el grupo (HAMBURGUESAS, PIZZAS,
       BURGER DAY, HAPPY HOUR…): la pantalla pone primero el menú normal. */
    const productos = lista.map(x => ({
      id: String(x?.ProductId ?? x?.Id ?? x?.Code ?? x?.ProductCode ?? ""),
      clave: x?.Code ?? x?.ProductCode ?? null,
      nombre: String(x?.Name ?? x?.ProductName ?? x?.Description ?? "SIN NOMBRE").trim(),
      categoria: String(x?.Group?.Name ?? x?.GroupName ?? x?.Category?.Name ?? "").replace(/\s+/g, " ").trim(),
      tipo: x?.Category?.Name ?? null,
      precio: precioDe(x),
      activo: x?.IsEnabled !== false,
      visible: x?.IsVisible ?? null
    }));
    return bien({
      sucursal, ruta, total: productos.length, productos, sondeo,
      campos: Object.keys(lista[0] || {}).sort(),
      muestra: lista.slice(0, 2)
    });
  }

  /* ================= MODO RANGO: varios días ================= */
  if (modo === "rango") {
    const desde = q("desde") || "", hasta = q("hasta") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
      return malo("faltan las fechas del rango");

    const dias = [];
    for (let f = desde; f <= hasta; f = mueve(f, 1)) dias.push(f);
    if (dias.length > 62) return malo("el rango es demasiado largo");

    /* Se pide día por día y no de un jalón: así cada venta cae en SU día de
       negocio, que es lo que el corte impreso compara. Un solo tirón deja
       las madrugadas del lado equivocado. */
    const porDia = [];
    let cort = 0, sinFecha = 0;
    const acum = { total:0, efectivo:0, tarjeta:0, transferencia:0, cortesia:0, otros:0,
                   propinas:0, descuentos:0, canceladas:0, monto_cancelado:0, cuentas:0 };
    const otrosDet = {};

    const tanda = 6;                              // de seis en seis, para no ahogar la API
    for (let i = 0; i < dias.length; i += tanda) {
      const lote = await Promise.all(dias.slice(i, i + tanda).map(async f =>
        [f, await ventasDelDia(key, cid, f, corte)]));
      for (const [f, res] of lote) {
        if (!res.ok) continue;
        const vs = res.vs;
        const R = resume(vs, corte);
        acum.total += R.total; acum.cuentas += R.ventas;
        acum.efectivo += R.pagos.efectivo; acum.tarjeta += R.pagos.tarjeta;
        acum.transferencia += R.pagos.transferencia; acum.cortesia += R.pagos.cortesia;
        acum.otros += R.pagos.otros;
        acum.propinas += R.propinas; acum.descuentos += R.descuentos;
        acum.canceladas += R.canceladas; acum.monto_cancelado += R.monto_cancelado;
        for (const [k, v] of Object.entries(R.otros_detalle)) otrosDet[k] = (otrosDet[k] || 0) + v;
        sinFecha += vs.filter(v => !v.Date).length;
        if (R.ventas || R.total) porDia.push({
          fecha: f, ventas: R.ventas, total: R.total,
          efectivo: R.pagos.efectivo, transferencia: R.pagos.transferencia,
          tarjeta: R.pagos.tarjeta, otros: R.pagos.otros });
      }
    }
    for (const k of Object.keys(otrosDet)) otrosDet[k] = r2(otrosDet[k]);

    /* Calibración: el mismo rango recalculado con varias horas de corte, para
       descubrir cuál reproduce el conteo del reporte impreso. Solo cuando el
       rango es corto: nueve pasadas de un mes son cientos de llamadas. */
    const calibracion = {};
    if (dias.length <= 8) {
      for (let c = 0; c <= 8; c++) {
        const mapa = {};
        const res = await Promise.all(dias.map(async f => {
          const x = await ventasDelDia(key, cid, f, c);
          return [f, x.vs];
        }));
        for (const [f, vs] of res) {
          const vivas = vs.filter(v => !v.IsCancelled);
          mapa[f] = { cuentas: vivas.length,
                      total: r2(vivas.reduce((s, v) => s + Number(v.SaleTotal?.Total || 0), 0)) };
        }
        calibracion[String(c)] = mapa;
      }
    }

    return bien({
      sucursal, cuentas: acum.cuentas, total: r2(acum.total),
      efectivo: r2(acum.efectivo), transferencia: r2(acum.transferencia),
      tarjeta: r2(acum.tarjeta), cortesia: r2(acum.cortesia), otros: r2(acum.otros),
      otros_detalle: otrosDet,
      canceladas: acum.canceladas, monto_cancelado: r2(acum.monto_cancelado),
      descuentos: r2(acum.descuentos), propinas: r2(acum.propinas),
      sin_fecha: sinFecha,
      dias: porDia.sort((a, b) => a.fecha < b.fecha ? -1 : 1),
      calibracion
    });
  }

  /* ================= MODO DIAG: radiografía de un día ================= */
  if (modo === "diag") {
    const fecha = q("fecha") || hoyNeg();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return malo("falta la fecha");

    const pet = { AccountId: ACCOUNT, CompanyId: cid, ...ventana(fecha, corte) };
    const { ok, r, vs } = await ventasDelDia(key, cid, fecha, corte);
    if (!ok) return malo("el punto de venta no contestó", { msg: r.crudo, http: r.http });
    const R = resume(vs, corte);
    const vivas = vs.filter(v => !v.IsCancelled);

    /* Folios: la serie es consecutiva, así que ella misma delata los huecos. */
    const folios = vivas.map(v => Number(v.Folio)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    const huecos = [];
    for (let i = 1; i < folios.length; i++)
      if (folios[i] - folios[i-1] > 1)
        huecos.push({ despues_de: folios[i-1], antes_de: folios[i], faltan: folios[i] - folios[i-1] - 1 });

    const fmp = {};
    for (const v of vivas) for (const p of (v.SalePayment || [])) {
      const nom = nombrePago(p).toUpperCase();
      if (!fmp[nom]) fmp[nom] = { nombre: nom, veces: 0, monto: 0, clase: clasePago(nom) };
      fmp[nom].veces++; fmp[nom].monto += Number(p.Amount || 0);
    }
    const sumaPagos = r2(Object.values(fmp).reduce((s, x) => s + x.monto, 0));

    const totales = {};
    for (const v of vivas) for (const [k, val] of Object.entries(v.SaleTotal || {})) {
      if (typeof val !== "number") continue;
      if (!totales[k]) totales[k] = { suma: 0, con_iva_16: 0 };
      totales[k].suma += val;
    }
    for (const k of Object.keys(totales)) {
      totales[k].suma = r2(totales[k].suma);
      totales[k].con_iva_16 = r2(totales[k].suma * 1.16);
    }

    /* Huella: qué valores distintos trae cada campo. Sirve para descubrir en
       cuál viene escondido el mesero, el turno o la estación. */
    const huella = {};
    for (const v of vivas) for (const [k, val] of Object.entries(v)) {
      if (val === null || typeof val === "object") continue;
      const t = String(val);
      if (!huella[k]) huella[k] = {};
      huella[k][t] = (huella[k][t] || 0) + 1;
    }

    /* Prueba de ventana: el mismo día pedido angosto y pedido ancho. Si dan
       distinto, la ventana estaba cortando ventas. */
    const anchoR = await post("/api/Sale/Get", key, {
      AccountId: ACCOUNT, CompanyId: cid,
      InitDate: `${mueve(fecha,-1)}T00:00:00`, EndDate: `${mueve(fecha,1)}T23:59:59` });
    const anchoVs = anchoR.ok ? ventas(anchoR.data).filter(v => !v.IsCancelled) : [];
    const delDia = anchoVs.filter(v => String(v.Date || "").slice(0,10) === fecha);
    const Ranch = resume(anchoVs, corte);
    const vecinos = [mueve(fecha,-1), fecha, mueve(fecha,1)].map(f => {
      const g = anchoVs.filter(v => String(v.Date || "").slice(0,10) === f);
      const Rg = resume(g, corte);
      return { fecha: f, cuentas: g.length, efectivo: Rg.pagos.efectivo,
               tarjeta: Rg.pagos.tarjeta, total: Rg.total };
    });

    return bien({
      sucursal, fecha,
      cuentas: R.ventas, canceladas: R.canceladas, total: R.total, propinas: R.propinas,
      suma_de_pagos: sumaPagos,
      cuadra_pagos_con_total: Math.abs(sumaPagos - R.total) < 1,
      cuentas_sin_pago: R.cuentas_sin_pago,
      primera_venta: vivas.length ? vivas.map(v=>v.Date).sort()[0] : null,
      ultima_venta:  vivas.length ? vivas.map(v=>v.Date).sort().slice(-1)[0] : null,
      totales_del_dia: totales,
      folios: {
        hay_folio: folios.length > 0,
        primero: folios[0] ?? null, ultimo: folios[folios.length-1] ?? null,
        esperadas_por_la_serie: folios.length ? folios[folios.length-1] - folios[0] + 1 : 0,
        entregados: folios.length,
        faltan_en_la_serie: folios.length ? (folios[folios.length-1] - folios[0] + 1) - folios.length : 0,
        huecos
      },
      lista_de_cuentas: vs.map(v => ({
        folio: v.Folio, fecha: v.Date, total: Number(v.SaleTotal?.Total || 0),
        status: v.Status, cancelada: !!v.IsCancelled, pagos: (v.SalePayment || []).length
      })).sort((a,b) => (a.folio||0) - (b.folio||0)),
      formas_de_pago: Object.values(fmp).map(x => ({ ...x, monto: r2(x.monto) }))
                                        .sort((a,b) => b.monto - a.monto),
      por_hora: R.por_hora.map(x => ({ hora: x.hora, total: x.total, cuentas: x.cuentas })),
      campos_de_la_venta: vs.length ? Object.keys(vs[0]).sort() : [],
      huella_de_los_campos: huella,
      prueba_de_ventana: {
        la_ventana_estaba_cortando: anchoVs.length > 0 && delDia.length > vivas.length,
        cuentas_pidiendo_solo_ese_dia: vivas.length,
        total_pidiendo_solo_ese_dia: R.total,
        cuentas_pidiendo_tres_dias: anchoVs.length,
        total_pidiendo_tres_dias: Ranch.total,
        efectivo_ancha: Ranch.pagos.efectivo, tarjeta_ancha: Ranch.pagos.tarjeta,
        por_hora_ancha: Ranch.por_hora.map(x => ({ hora: x.hora, total: x.total, cuentas: x.cuentas })),
        vecinos
      },
      peticion: pet,
      sobre_de_la_respuesta: { Message: r.data?.Message ?? null, cuantas: vs.length },
      campos_del_total: vivas.length ? Object.keys(vivas[0].SaleTotal || {}).sort() : [],
      campos_del_pago:  vivas.length && (vivas[0].SalePayment||[])[0]
                        ? Object.keys(vivas[0].SalePayment[0]).sort() : [],
      ejemplo_de_venta: vivas[0] || null
    });
  }

  /* ================= MODO PUERTAS: ¿por dónde sí contesta? ================= */
  if (modo === "puertas") {
    const folio = Number(q("folio") || 0);
    const fecha = q("fecha") || "";
    const porFolio = [], porEstado = [], puertas = [];

    if (folio > 0) {
      for (const [nombre, cuerpo] of [
        ["Sale/Find por folio", { AccountId: ACCOUNT, CompanyId: cid, Folio: folio }],
        ["Sale/Find por folio y serie", { AccountId: ACCOUNT, CompanyId: cid, Folio: folio, Serie: "" }]
      ]) {
        const r = await post("/api/Sale/Find", key, cuerpo);
        const vs = ventas(r.data);
        porFolio.push({ prueba: nombre, http: r.http, registros: vs.length,
          trajo_el_folio: vs.some(v => Number(v.Folio) === folio),
          total: vs[0]?.SaleTotal?.Total ?? null,
          recado: r.data?.Message?.ErrorMessage || r.crudo || null });
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      const base = await ventasDelDia(key, cid, fecha, corte);
      const yaHay = new Set(base.vs.map(v => String(v.Folio)));
      for (let st = 0; st <= 12; st++) {
        const r = await post("/api/Sale/Get", key, {
          AccountId: ACCOUNT, CompanyId: cid, Status: st, ...ventana(fecha, corte) });
        const vs = ventas(r.data).filter(v => esDelDia(v, fecha, corte));
        const nuevos = vs.map(v => String(v.Folio)).filter(f => f && !yaHay.has(f));
        porEstado.push({ status: st, http: r.http, registros: vs.length,
          folios_nuevos: nuevos.length, cuales: nuevos.slice(0, 12),
          total: r2(vs.reduce((s, v) => s + Number(v.SaleTotal?.Total || 0), 0)) });
      }
    }

    /* Nombres de método que PODRÍAN existir. Solo se prueban los que leen:
       nada que cree, finalice, cancele o borre. */
    const ESCRIBE = /create|finaliz|cancel|delete|update|send|save|insert|remove|pay|post|put|set|add|new/i;
    for (const ruta of ["Sale/Get","Sale/Find","Sale/GetPage","Sale/List","Sale/Search",
                        "Sale/GetAll","Sale/GetByDate","Sale/GetByFolio","Sale/Detail",
                        "Sale/GetDetail","Sale/Summary","Sale/Report","Sale/Count",
                        "Sale/GetOpen","Sale/GetClosed","Sale/GetPending"]) {
      if (ESCRIBE.test(ruta)) continue;
      const r = await post("/api/" + ruta, key, { AccountId: ACCOUNT, CompanyId: cid });
      puertas.push({ existe: r.http !== 404, ruta, http: r.http,
        registros: ventas(r.data).length,
        recado: r.data?.Message?.ErrorMessage || r.crudo || null });
    }

    return bien({ por_folio: porFolio, por_estado: porEstado, puertas });
  }

  /* ================= MODO RELLENO: rescatar folios perdidos ================= */
  if (modo === "relleno") {
    const fecha = q("fecha") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return malo("falta la fecha");

    const { ok, r, vs } = await ventasDelDia(key, cid, fecha, corte);
    if (!ok) return malo("el punto de venta no contestó", { msg: r.crudo });
    const base = vs.filter(v => !v.IsCancelled);
    const Rbase = resume(base, corte);
    const folios = base.map(v => Number(v.Folio)).filter(Number.isFinite).sort((a,b)=>a-b);
    const hay = new Set(folios);

    /* Qué folios preguntar: los huecos de la serie, y además hacia arriba del
       último — Get puede estar cortando por arriba y ahí también falta venta. */
    const pedir = [];
    for (let f = folios[0]; f <= folios[folios.length-1]; f++) if (!hay.has(f)) pedir.push(f);
    for (let k = 1; k <= 12; k++) pedir.push(folios[folios.length-1] + k);

    const rescatadas = [], revisados = [];
    let trae_restaurante = false;
    for (let i = 0; i < pedir.length && i < 120; i += 6) {
      const lote = await Promise.all(pedir.slice(i, i + 6).map(async f => {
        const rr = await post("/api/Sale/Find", key, { AccountId: ACCOUNT, CompanyId: cid, Folio: f });
        return [f, rr];
      }));
      for (const [f, rr] of lote) {
        const vs = ventas(rr.data);
        const v = vs[0];
        if (!v) { revisados.push({ folio: f, estado: "no existe", fecha: null, dia: null, total: null }); continue; }
        if (v.SaleRestaurant) trae_restaurante = true;
        const dd = String(v.Date || "").slice(0, 10);
        if (!esDelDia(v, fecha, corte)) {
          revisados.push({ folio: f, estado: "es de otro día", fecha: v.Date, dia: dd,
            total: Number(v.SaleTotal?.Total || 0),
            devolvio_folio: Number(v.Folio), como: "Sale/Find" });
          continue;
        }
        if (v.IsCancelled) { revisados.push({ folio: f, estado: "cancelada", fecha: v.Date, dia: dd,
            total: Number(v.SaleTotal?.Total || 0) }); continue; }
        rescatadas.push({ folio: Number(v.Folio), fecha: v.Date,
          total: Number(v.SaleTotal?.Total || 0), status: v.Status,
          pagos: (v.SalePayment || []).map(p => ({ nombre: nombrePago(p), monto: Number(p.Amount || 0) })) });
      }
    }

    const totRes = r2(rescatadas.reduce((s, x) => s + x.total, 0));
    return bien({
      fecha,
      con_get: { total: Rbase.total, cuentas: Rbase.ventas,
                 del_folio: folios[0] ?? null, al_folio: folios[folios.length-1] ?? null },
      rescatadas: { total: totRes, cuentas: rescatadas.length, lista: rescatadas },
      completo: { total: r2(Rbase.total + totRes), cuentas: Rbase.ventas + rescatadas.length },
      trae_restaurante, revisados
    });
  }

  /* ================= MODO SONDEO: ¿hay una forma de pedir más? ================= */
  if (modo === "sondeo") {
    const desde = q("desde") || "", hasta = q("hasta") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
      return malo("faltan las fechas");

    const base = { AccountId: ACCOUNT, CompanyId: cid,
                   InitDate: `${desde}T00:00:00`, EndDate: `${hasta}T23:59:59` };
    const variantes = [
      ["como hoy", {}],
      ["PageSize=1000", { PageSize: 1000 }],
      ["PageSize=5000", { PageSize: 5000 }],
      ["PageSize=10000", { PageSize: 10000 }],
      ["Take=5000", { Take: 5000 }],
      ["Limit=5000", { Limit: 5000 }],
      ["Top=5000", { Top: 5000 }],
      ["MaxRows=5000", { MaxRows: 5000 }],
      ["Page=1 + PageSize=5000", { Page: 1, PageSize: 5000 }],
      ["PageNumber=1 + PageSize=5000", { PageNumber: 1, PageSize: 5000 }],
      ["Offset=0 + Limit=5000", { Offset: 0, Limit: 5000 }],
      ["IncludeCancelled", { IncludeCancelled: true }],
      ["IncludeDetail", { IncludeDetail: true }]
    ];

    const pruebas = [];
    for (const [nombre, extra] of variantes) {
      const rr = await post("/api/Sale/Get", key, { ...base, ...extra });
      const vs = ventas(rr.data);
      const estados = {};
      for (const v of vs) { const s = String(v.Status ?? "—"); estados[s] = (estados[s] || 0) + 1; }
      pruebas.push({ variante: nombre, http: rr.http, registros: vs.length, estados,
        total: r2(vs.reduce((s, v) => s + Number(v.SaleTotal?.Total || 0), 0)),
        dice: rr.data?.Message?.ErrorMessage || rr.crudo || null,
        sobre: { Message: rr.data?.Message ?? null } });
    }

    const baseReg = pruebas[0]?.registros || 0;
    const mejor = pruebas.reduce((a, b) => b.registros > a.registros ? b : a, pruebas[0]);
    return bien({
      hay_una_mejor: !!mejor && mejor.registros > baseReg,
      mejor_variante: mejor?.variante ?? null,
      mejor_registros: mejor?.registros ?? 0,
      base_registros: baseReg,
      pruebas
    });
  }

  /* ================= MODO CUENTAS: la lista de folios =================
     Lo que en Soft Restaurant es «Consulta de cuentas»: el renglón por
     cuenta, no la suma del día.

     Tres ventanas, igual que allá:
       turno   → un día de negocio
       periodo → de fecha a fecha
       anual   → un año completo

     OJO CON LA TRAMPA DE SIEMPRE. El resto del archivo pide día por día
     porque suma, y sumar respuestas que se traslapan duplica. Aquí NO se
     suma: se juntan cuentas, y cada cuenta trae su SaleId. Entonces se
     puede pedir en tramos grandes y quitar repetidos por SaleId — que es
     lo único que hace falta para que un año no sean 365 llamadas.

     Los tramos se piden con un día de cola de más a propósito: la jornada
     se derrama a la madrugada siguiente y sin esa cola se perderían las
     cuentas de after hours del último día. Como se deduplica, el traslape
     no cuesta nada.
     ==================================================================== */
  if (modo === "cuentas" || modo === "cuenta") {

    /* ---- una cuenta, con sus renglones ---- */
    if (modo === "cuenta") {
      const saleId = q("saleId") || "";
      if (!saleId) return malo("falta la cuenta");
      const rr = await post("/api/Sale/Find", key,
        { AccountId: ACCOUNT, CompanyId: cid, SaleId: saleId });
      if (!rr.ok) return malo("el punto de venta no contestó", { msg: rr.crudo, http: rr.http });
      const v = ventas(rr.data)[0];
      if (!v) return malo("no se encontró esa cuenta");

      const det = Array.isArray(v.SaleDetail) ? v.SaleDetail : [];
      const renglones = det.map((d, i) => ({
        mov: i + 1,
        cantidad: Number(d.Quantity || 0),
        clave: d.Product?.Code ?? d.ProductCode ?? d.Code ?? null,
        descripcion: d.Product?.Name || d.ProductName || "SIN NOMBRE",
        categoria: d.Product?.Category || null,
        precio: r2(d.Price || 0),
        descuento: r2(d.Discount || 0),
        importe: r2(Number(d.Price || 0) * Number(d.Quantity || 0)),
        hora: d.Date || d.CaptureDate || null
      }));

      return bien({
        sucursal,
        saleId, folio: v.Folio ?? null,
        fecha: v.Date || null,
        cancelada: !!v.IsCancelled, status: v.Status ?? null,
        totales: v.SaleTotal || {},
        renglones,
        pagos: (v.SalePayment || []).map(p => ({
          nombre: nombrePago(p), clase: clasePago(nombrePago(p)),
          monto: r2(p.Amount || 0), propina: r2(p.Tips || p.Tip || 0),
          referencia: p.Reference ?? p.Authorization ?? null
        })),
        /* Qué trae de verdad un renglón. Si algún día Soft empieza a mandar
           la clave o la hora de captura, aquí se va a ver sin tener que
           salir a buscarlo. */
        campos_del_renglon: det.length ? Object.keys(det[0]).sort() : [],
        campos_de_la_venta: Object.keys(v).sort()
      });
    }

    /* ---- la lista ---- */
    const vista = q("vista") || "turno";
    let desde, hasta;
    if (vista === "turno") {
      desde = hasta = q("fecha") || hoyNeg();
    } else if (vista === "anual") {
      const ano = Number(q("ano") || new Date().getUTCFullYear());
      if (!(ano >= 2000 && ano <= 2100)) return malo("año fuera de rango");
      desde = `${ano}-01-01`; hasta = `${ano}-12-31`;
    } else {
      desde = q("desde") || ""; hasta = q("hasta") || "";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
      return malo("faltan las fechas");
    if (desde > hasta) { const t = desde; desde = hasta; hasta = t; }

    /* Tramos de 31 días. Cada uno pide un día extra por la cola de la
       madrugada; el dedupe por SaleId hace inofensivo el traslape. */
    const tramos = [];
    for (let f = desde; f <= hasta; f = mueve(f, 31))
      tramos.push([f, (mueve(f, 31) > hasta ? hasta : mueve(f, 30))]);

    const porId = new Map();
    let fallo = null;
    const tanda = 4;
    for (let i = 0; i < tramos.length; i += tanda) {
      const lote = await Promise.all(tramos.slice(i, i + tanda).map(([a, b]) =>
        post("/api/Sale/Get", key, {
          AccountId: ACCOUNT, CompanyId: cid,
          InitDate: `${a}T00:00:00`, EndDate: `${mueve(b, 1)}T23:59:59`
        })));
      for (const r of lote) {
        if (!r.ok) { fallo = r; continue; }
        for (const v of ventas(r.data)) if (v?.SaleId) porId.set(v.SaleId, v);
      }
    }
    if (!porId.size && fallo)
      return malo("el punto de venta no contestó", { msg: fallo.crudo, http: fallo.http });

    /* A qué día de negocio pertenece cada cuenta. Se reusa `esDelDia`
       probando el día natural y el anterior: con corte 6, una venta de las
       2 am es del día anterior. */
    const diaDeNegocio = v => {
      const d = String(v?.Date || "").slice(0, 10);
      if (!d) return null;
      if (esDelDia(v, d, corte)) return d;
      const ant = mueve(d, -1);
      return esDelDia(v, ant, corte) ? ant : d;
    };

    const TOPE = 3000;
    let filas = [];
    for (const v of porId.values()) {
      const dn = diaDeNegocio(v);
      if (!dn || dn < desde || dn > hasta) continue;
      const pgs = (v.SalePayment || []).map(p => ({
        nombre: nombrePago(p), clase: clasePago(nombrePago(p)), monto: r2(p.Amount || 0)
      }));
      filas.push({
        saleId: v.SaleId, folio: v.Folio ?? null,
        fecha: v.Date || null, dia: dn,
        total: r2(v.SaleTotal?.Total || 0),
        propina: r2(v.SaleTotal?.Tips || 0),
        descuento: r2(v.SaleTotal?.Discount || 0),
        cancelada: !!v.IsCancelled, status: v.Status ?? null,
        pagos: pgs
      });
    }
    filas.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    const totalFilas = filas.length;
    const recortado = totalFilas > TOPE;
    if (recortado) filas = filas.slice(0, TOPE);

    const vivas = filas.filter(f => !f.cancelada);
    const sumaPagos = {};
    for (const f of vivas) for (const p of f.pagos)
      sumaPagos[p.clase] = r2((sumaPagos[p.clase] || 0) + p.monto);

    return bien({
      sucursal, vista, desde, hasta,
      cuentas: vivas.length,
      canceladas: filas.length - vivas.length,
      total: r2(vivas.reduce((s, f) => s + f.total, 0)),
      propinas: r2(vivas.reduce((s, f) => s + f.propina, 0)),
      descuentos: r2(vivas.reduce((s, f) => s + f.descuento, 0)),
      pagos: sumaPagos,
      filas,
      recortado, total_filas: totalFilas, tope: TOPE
    });
  }

  /* ================= MODO POR DEFAULT: un día ================= */
  const fecha = q("fecha") || hoyNeg();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return malo("falta la fecha");

  const quiereProductos = q("productos") !== "0";
  const { ok, r, vs } = await ventasDelDia(key, cid, fecha, corte, quiereProductos);
  if (!ok) return malo("el punto de venta no contestó", { msg: r.crudo, http: r.http });

  const R = resume(vs, corte);
  const salida = {
    sucursal, fecha,
    ventas: R.ventas, ventas_con_detalle: R.ventas_con_detalle,
    monto_sin_detalle: R.monto_sin_detalle,
    total: R.total, unidades: R.unidades, importe_productos: R.importe_productos,
    propinas: R.propinas, descuentos: R.descuentos,
    canceladas: R.canceladas, monto_cancelado: R.monto_cancelado,
    pagos: R.pagos, otros_detalle: R.otros_detalle
  };
  /* `productos=0` quiere decir "no me mandes el detalle": son cientos de
     renglones que esa pantalla no usa. */
  if (quiereProductos) salida.items = R.items;
  return bien(salida);
};

export const config = { path: "/api/soft-ventas" };
