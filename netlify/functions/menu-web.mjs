/* ============================================================
   El menú del sitio público, para cotizar desde Ops.
   ------------------------------------------------------------
   No hay base de datos de por medio: la verdad del menú vive en
   boyesburger.com, en el archivo que el propio sitio usa para
   pintarse. Leerlo de ahí es lo que garantiza que la cotización
   cobre lo mismo que cobra la página. Una copia en otro lado
   sería una segunda verdad, y tarde o temprano se separan.

   Los precios que salen de aquí van CON IVA, igual que los ve
   el cliente. Quien cotiza es el que decide si se lo quita.
   ============================================================ */
const FUENTE = "https://boyesburger.com/ordenar/js/menu-data.js";

/* El archivo declara varias cosas (CATEGORIES, MENU, RESTAURANT).
   Se saca cada una por su nombre, sin ejecutar el archivo: correr
   código traído de otro sitio dentro del servidor es una puerta
   que no tiene por qué estar abierta.

   Se aceptan las dos formas de declarar —`window.MENU =` y
   `const MENU =`— porque el sitio hoy usa la primera y no hay
   razón para que un cambio de estilo allá tumbe la cotización
   de acá. */
function saca(txt, nombre) {
  let i = -1;
  for (const forma of [`window.${nombre}`, `const ${nombre}`,
                       `let ${nombre}`, `var ${nombre}`]) {
    i = txt.indexOf(forma);
    if (i >= 0) break;
  }
  if (i < 0) return null;
  let j = txt.indexOf("=", i) + 1;
  while (j < txt.length && /\s/.test(txt[j])) j++;
  const cierra = { "[": "]", "{": "}" }[txt[j]];
  if (!cierra) return null;
  /* Se cuenta el anidamiento respetando comillas: un "]" dentro de
     un nombre de producto cortaría el arreglo a la mitad. */
  let nivel = 0, k = j, comilla = null;
  for (; k < txt.length; k++) {
    const c = txt[k];
    if (comilla) {
      if (c === "\\") { k++; continue; }
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { comilla = c; continue; }
    if (c === "[" || c === "{") nivel++;
    else if (c === "]" || c === "}") { nivel--; if (nivel === 0) break; }
  }
  if (nivel !== 0) return null;
  try { return lee(txt.slice(j, k + 1)); } catch { return null; }
}

/* ---- lector de literales de JavaScript ----
   El archivo del sitio es JavaScript, no JSON: las llaves van sin
   comillas, los textos con apóstrofo y hay comas colgando. JSON.parse
   se ahoga con eso.

   La salida fácil sería `new Function('return ' + texto)()`, y es
   justo la que no se toma: eso ejecuta, dentro de este servidor,
   código que viene de otro sitio. Este servidor tiene la llave de
   Soft en sus variables de entorno. El día que alguien meta mano en
   el sitio público, se llevaría la llave. Un lector de 60 renglones
   cuesta menos que esa posibilidad.

   Lee objetos, arreglos, textos, números, true/false/null. Nada más.
   Cualquier otra cosa truena, que es lo que debe hacer. */
function lee(src) {
  let i = 0;

  const salta = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (src[i] === "/" && src[i + 1] === "*") {
        i = src.indexOf("*/", i);
        if (i < 0) throw new Error("comentario sin cerrar");
        i += 2;
      } else return;
    }
  };

  const texto = () => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") {
        const c = src[++i]; i++;
        out += c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r"
             : c === "u" ? String.fromCharCode(parseInt(src.slice(i, i += 4), 16))
             : c;
      } else out += src[i++];
    }
    i++;                                   // la comilla de cierre
    return out;
  };

  const valor = () => {
    salta();
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") return texto();
    if (c === "[") {
      i++; const arr = [];
      for (;;) {
        salta();
        if (src[i] === "]") { i++; return arr; }
        arr.push(valor());
        salta();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "]") { i++; return arr; }
        throw new Error("arreglo mal formado en " + i);
      }
    }
    if (c === "{") {
      i++; const obj = {};
      for (;;) {
        salta();
        if (src[i] === "}") { i++; return obj; }
        let llave;
        if (src[i] === '"' || src[i] === "'" || src[i] === "`") llave = texto();
        else {
          const ini = i;
          while (i < src.length && /[\w$]/.test(src[i])) i++;
          llave = src.slice(ini, i);
          if (!llave) throw new Error("llave vacía en " + i);
        }
        salta();
        if (src[i] !== ":") throw new Error("falta ':' en " + i);
        i++;
        obj[llave] = valor();
        salta();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "}") { i++; return obj; }
        throw new Error("objeto mal formado en " + i);
      }
    }
    const ini = i;
    while (i < src.length && /[-+.\deE\w$]/.test(src[i])) i++;
    const crudo = src.slice(ini, i);
    if (crudo === "true") return true;
    if (crudo === "false") return false;
    if (crudo === "null" || crudo === "undefined") return null;

    /* El sitio arma las fotos con una ayudante: `img: im("…")`. Esa llamada
       se SALTA, no se ejecuta ni se intenta resolver — la cotización no usa
       las fotos, y de todos modos no vamos a correr código de otro sitio
       aquí adentro. El campo queda en null y el renglón sigue sirviendo. */
    salta();
    if (crudo && /^[A-Za-z_$][\w$]*$/.test(crudo) && src[i] === "(") {
      let nivel = 0, q = null;
      for (; i < src.length; i++) {
        const c = src[i];
        if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === "`") { q = c; continue; }
        if (c === "(") nivel++;
        else if (c === ")") { nivel--; if (nivel === 0) { i++; break; } }
      }
      return null;
    }

    const n = Number(crudo);
    if (crudo === "" || Number.isNaN(n)) throw new Error("no sé leer «" + crudo + "»");
    return n;
  };

  const v = valor();
  salta();
  return v;
}

let cache = null, cuando = 0;

export default async () => {
  /* Diez minutos. El menú cambia cuando se publica el sitio, no
     entre una cotización y la siguiente. */
  if (cache && Date.now() - cuando < 10 * 60 * 1000)
    return Response.json(cache, { headers: { "Cache-Control": "no-store" } });

  let txt;
  try {
    const r = await fetch(FUENTE, { cache: "no-store" });
    if (!r.ok) throw new Error(`el sitio contestó ${r.status}`);
    txt = await r.text();
  } catch (e) {
    return Response.json({ error: `no se pudo leer el menú del sitio: ${e.message}` },
                         { status: 502 });
  }

  const cats = saca(txt, "CATEGORIES");
  const menu = saca(txt, "MENU");
  if (!Array.isArray(cats) || !Array.isArray(menu))
    return Response.json({ error: "el menú del sitio vino con un formato que no reconozco" },
                         { status: 502 });

  const nombreCat = Object.fromEntries(cats.map(c => [c.id, c.name || c.nombre || c.id]));

  /* `id` va como TEXTO a propósito: del otro lado se compara contra
     el dataset de un botón, y eso siempre es texto. Un id numérico
     rompería el botón de agregar sin avisar. */
  const productos = menu
    .filter(p => p && p.id != null)
    .map(p => ({
      id: String(p.id),
      nombre: String(p.name || p.nombre || ""),
      precio: Number(p.price ?? p.precio ?? 0),
      cat: String(p.cat || ""),
      categoria: nombreCat[p.cat] || "Otros"
    }))
    .filter(p => p.nombre);

  cache = {
    fuente: FUENTE,
    leido: new Date().toISOString(),
    categorias: cats.map(c => ({
      id: String(c.id),
      nombre: String(c.name || c.nombre || c.id),
      emoji: c.emoji || ""
    })),
    productos,
    total: productos.length
  };
  cuando = Date.now();
  return Response.json(cache, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/menu-web" };
