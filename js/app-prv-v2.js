/* ============================================================
   FORMATOS · Comparar cotizaciones de proveedores
   ------------------------------------------------------------
   Lo difícil de comparar proveedores no es juntar los precios:
   es que cada uno cotiza en su propia presentación. Uno manda el
   aceite en garrafa de 5 L, otro en botella de 1 L y otro en caja
   de 12 × 900 ml. Poner esos tres precios uno junto a otro no
   dice nada — el barato puede ser el que parece más caro.

   Por eso todo se lleva a PRECIO POR UNIDAD BASE: por litro, por
   kilo o por pieza. Ahí sí se ve quién está más barato, y cuánto
   se ahorra en realidad.

   El PDF del proveedor se lee para adelantar trabajo, no para
   confiar en él a ciegas: cada renglón queda editable antes de
   comparar. Un comparativo con un precio mal leído es peor que
   no tener comparativo — se toma una decisión de compra con él.
   ============================================================ */

let prvLista = null;
let prvEdit = null;         // el comparativo abierto
let prvCargando = false;
let prvLeyendo = false;
let prvSug = null;          // las parejas propuestas, esperando confirmación
let prvArchivos = [];       // los PDF soltados, todavía sin leer
let prvDetalle = false;     // ver los renglones para corregirlos

const prvHoy = () => new Date().toISOString().slice(0,10);
const prvNuevo = () => ({ id:null, nombre:'', fecha:prvHoy(), notas:'', proveedores:[] });

/* ---------- unidades ----------
   Todo se reduce a tres bases: litro, kilo y pieza. Cualquier otra unidad
   que aparezca se respeta tal cual y ese renglón no se compara — mejor
   dejarlo fuera que compararlo mal. */
const PRV_UNID = [
  { re:/\b(ml|mililitros?)\b/i,            base:'L',  factor:0.001 },
  { re:/\b(l|lt|lts|litros?)\b/i,          base:'L',  factor:1 },
  { re:/\b(gal|galon(es)?|gl)\b/i,         base:'L',  factor:3.785411784 },
  { re:/\b(g|gr|grs|gramos?)\b/i,          base:'kg', factor:0.001 },
  { re:/\b(kg|kgs|kilos?|kilogramos?|klg)\b/i, base:'kg', factor:1 },
  /* Muchos proveedores de carne y pollo cotizan en libras. Compararlas contra
     kilos sin convertir hace ver barato lo que no lo es: una libra es menos de
     medio kilo, así que el precio "por unidad" sale 2.2 veces más bajo. */
  { re:/\b(lb|lbs|libras?)\b/i,            base:'kg', factor:0.45359237 },
  { re:/\b(oz|onzas?)\b/i,                 base:'kg', factor:0.028349523 },
  { re:/\b(pz|pza|pzas|piezas?|u|und|unidad(es)?|c\/u)\b/i, base:'pz', factor:1 },
  /* Los desechables no se venden por peso sino por cuenta: la servilleta va
     en "12/500 hojas" y el higiénico en "12/200 metros". Sin estas dos, esos
     renglones —de los más caros del mes— quedaban fuera de la comparación. */
  { re:/\b(hs|hjs|hoja|hojas)\b/i,         base:'hoja', factor:1 },
  { re:/\b(m|mt|mts|metros?)\b/i,          base:'m',  factor:1 }
];

/* Envases que por sí solos ya dicen cuánto traen. Un galón son 3.785 L
   siempre; una pieza es una pieza. Los que NO están aquí —caja, paquete,
   porrón, cubeta, bolsa— son a propósito: un porrón puede ser de 5, 10 o 20
   litros, y suponerlo es exactamente el error que hace comprarle al caro. */
const PRV_SOLO = [
  { re:/^(pieza|piezas|pza|pzas|pz|rollo|rollos|lata|latas|botella|botellas)$/i, cant:1, unidad:'pz' },
  { re:/^(gal[oó]n|galon|galones|gl)$/i,   cant:3.785411784, unidad:'L' },
  { re:/^(litro|litros|lt|lts|l)$/i,       cant:1, unidad:'L' },
  { re:/^(kilo|kilos|kg|kgs)$/i,           cant:1, unidad:'kg' }
];

/* De un texto de presentación saca cuánto trae en unidad base.
     "5 L"            → 5 L
     "900 ml"         → 0.9 L
     "caja 12 x 1 L"  → 12 L
     "20 kg"          → 20 kg
     "12 pz"          → 12 pz
   Si no reconoce nada, devuelve null y el renglón se marca para revisar. */
/* El lector de PDF entrega el texto en trozos y a veces parte una palabra a
   media letra: "1.14 K G." donde dice 1.14 KG, "2.27 K G" donde dice 2.27 KG.
   Partida así, NINGUNA regla reconoce la unidad: el renglón se quedaba en
   piezas y entonces no se podía comparar contra el mismo producto del otro
   proveedor, que sí venía en kilos.

   Se vuelven a pegar SOLO las letras sueltas que van pegadas a un número —ahí
   siempre es la unidad—. "907 GRS" o "6 x 1 KG" no traen letras sueltas y no
   se tocan. */
const PRV_UNI_SUELTA = /^(kg|kgs|g|gr|grs|gramos?|kilos?|ml|mls|l|lt|lts|litros?|lb|lbs|oz|pz|pza|pzas|piezas?)$/i;
function prvUneUnidad(t){
  return String(t||'').replace(/(\d(?:\.\d+)?)((?:\s+[a-zá-ú]{1,3}\b){2,4})/gi,
    (todo, num, letras) => {
      const trozos = letras.trim().split(/\s+/);
      /* Solo se pega si lo pegado es una unidad DE VERDAD. Sin esa prueba,
         "13.62 KG I 3791" se volvía "13.62 KGI" y el renglón perdía su
         medida — arreglando una cosa se rompía otra. */
      for(let k = trozos.length; k >= 2; k--){
        const junto = trozos.slice(0, k).join('');
        if(!PRV_UNI_SUELTA.test(junto)) continue;
        const resto = trozos.slice(k);
        return num + ' ' + junto + (resto.length ? ' ' + resto.join(' ') : '');
      }
      return todo;
    });
}
function prvBase(txt){
  const t = prvUneUnidad(String(txt||'').replace(/,/g,'').toLowerCase()).trim();
  if(!t) return null;

  /* Una caja no es una unidad: es un envase que trae algo adentro. Lo que se
     compara es lo de adentro. Estas son las formas en que los proveedores lo
     escriben, y todas significan lo mismo:

       caja c/6 de 1 kg   ·   6 x 1 kg   ·   6/1 kg   ·   caja 6 bolsas 1 kg

     Si solo dijera "caja", no hay nada que comparar: eso se marca para que
     alguien pregunte cuánto trae. */
  /* Los dos números TIENEN que venir separados por algo que signifique
     «de tantos»: una x, una diagonal, o la palabra «de»/«con». Sin exigirlo,
     «bulto 25 kg» se leía como 2 × 5 kg = 10 kg — la mitad del bulto, y un
     precio por kilo del doble. Un comparativo con ese error manda a comprarle
     al proveedor equivocado. */
  /* Entre los dos números puede haber el nombre del envase: «24 botellas de
     355 ml», «6 bolsas de 1 kg». Se permite una palabra ahí, pero el «de» o
     la «x» siguen siendo obligatorios. */
  const SEP = '(?:\\s*[x×\\/]\\s*|\\s+(?:[a-zá-ú]{2,14}\\s+)?(?:de|con)\\s+)';
  const compuesto =
       t.match(new RegExp('(\\d+(?:\\.\\d+)?)' + SEP + '(\\d+(?:\\.\\d+)?)\\s*([a-zá-ú]+)', 'i'))
    || t.match(new RegExp('c\\/\\s*(\\d+(?:\\.\\d+)?)' + SEP + '(\\d+(?:\\.\\d+)?)\\s*([a-zá-ú]+)', 'i'))
    || t.match(new RegExp('(?:caja|bulto|paquete|pack|bolsa|saco)\\s*(?:c\\/)?\\s*(\\d+(?:\\.\\d+)?)' +
                          SEP + '(\\d+(?:\\.\\d+)?)\\s*([a-zá-ú]+)', 'i'));
  if(compuesto){
    const u = PRV_UNID.find(x=>x.re.test(compuesto[3]));
    if(u) return { cant: Number(compuesto[1]) * Number(compuesto[2]) * u.factor,
                   unidad: u.base, piezas: Number(compuesto[1]),
                   detalle: `${compuesto[1]} × ${compuesto[2]} ${compuesto[3]}` };
  }

  /* "caja c/6" a secas: son 6 piezas, y como piezas sí se puede comparar. */
  const soloPiezas = t.match(/(?:caja|bulto|paquete|pack)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:pz|pza|pzas|piezas?)?\s*$/i)
                  || t.match(/c\/\s*(\d+(?:\.\d+)?)\s*$/i);
  if(soloPiezas)
    return { cant: Number(soloPiezas[1]), unidad:'pz', piezas: Number(soloPiezas[1]),
             detalle: `${soloPiezas[1]} pz` };

  const m = t.match(/(\d+(?:\.\d+)?)\s*([a-zá-ú]+)/i);
  if(m){
    const u = PRV_UNID.find(x=>x.re.test(m[2]));
    if(u) return { cant: Number(m[1]) * u.factor, unidad: u.base, piezas: 1,
                   detalle: `${m[1]} ${m[2]}` };
  }
  /* La palabra sola, sin número: "PIEZA", "ROLLO", "GALÓN". Cuando el envase
     ya dice cuánto trae, se toma; cuando no —"PORRÓN"—, se sigue pidiendo el
     tamaño. */
  const solo = PRV_SOLO.find(x => x.re.test(t.trim()));
  if(solo) return { cant: solo.cant, unidad: solo.unidad, piezas: 1,
                    detalle: t.trim() + (solo.unidad==='L' && solo.cant!==1 ? ` = ${solo.cant.toFixed(2)} L` : '') };
  return null;
}

/* Nombre normalizado, para juntar el mismo producto de proveedores distintos.
   No adivina sinónimos: quita acentos, plurales simples y palabras de
   presentación. Si dos proveedores le dicen distinto, el nombre se corrige a
   mano — que es más honesto que emparejar por parecido y equivocarse. */
function prvClave(nombre){
  /* Si alguien escribió una equivalencia, esa manda: es la única forma
     confiable de decir «la pierna de pollo de este y el muslo de aquel son el
     mismo producto para mí». Emparejar por parecido de nombre se equivoca
     justo donde más caro sale equivocarse. */
  return String(nombre||'')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/\b\d+(\.\d+)?\s*(ml|l|lt|lts|litros?|g|gr|kg|kgs|kilos?|pz|pza|pzas|piezas?)\b/g,' ')
    .replace(/\b(caja|bulto|garrafa|botella|bolsa|paquete|pack|c\/u|c\/)\b/g,' ')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ').trim();
}

/* El precio se lleva SIEMPRE a sin IVA antes de comparar.

   Unos proveedores cotizan con IVA incluido y otros sin él, y la diferencia
   es del 16%: comparar uno contra otro tal cual haría ganar al que cotiza sin
   IVA aunque sea el más caro. Se compara el costo real —sin IVA— y el precio
   con IVA se enseña aparte, que es lo que se acaba pagando. */
function prvSinIva(precio, p){
  const v = Number(precio||0);
  if(!v) return 0;
  const pct = Number(p?.iva_pct ?? 16);
  return (p?.iva === 'con') ? v / (1 + pct/100) : v;
}

function prvCalc(r, p){
  const b = prvBase(r.presentacion);
  const bruto = Number(r.precio||0);
  const precio = prvSinIva(bruto, p);
  if(!b || !b.cant || !precio)
    return { ...r, base:null, unidad_base:null, precio_base:null,
             precio_sin: precio||null, detalle: b?.detalle || null };
  return { ...r, base: b.cant, unidad_base: b.unidad, precio_sin: precio,
           detalle: b.detalle || null,
           precio_base: Math.round((precio / b.cant) * 10000) / 10000 };
}

/* ============================================================
   LEER LA COTIZACIÓN DEL PROVEEDOR
   ------------------------------------------------------------
   La primera versión leía línea por línea y agarraba el último
   número de cada una. Con una cotización de verdad eso no sirve:
   el membrete trae el domicilio del cliente, su RFC y sus dos
   teléfonos, y todos esos números tienen pinta de precio. Salían
   renglones como «Domicilio: BLVD. MANLIO FABIO» a $85,506 —que
   es el código postal— y el teléfono cotizado en $6,221,988.

   Ahora se lee la TABLA, no el papel. Se busca la fila de
   encabezados (Cantidad · Concepto · Precio · Importe): esa fila
   es la frontera entre el membrete y la mercancía. Arriba de ella
   no hay productos, y abajo del subtotal tampoco. Con la posición
   de cada columna, el nombre sale de la de Concepto y el precio
   de la de Precio — no de la clave del SAT, que era lo que se
   estaba enseñando.

   Y todo se comprueba: cantidad x precio tiene que dar el importe
   del propio renglón, y la suma de los importes tiene que dar el
   subtotal del documento. Lo que no cuadra se marca para revisar
   en vez de darlo por bueno.
   ============================================================ */

/* ============================================================
   Lo que NUNCA es un producto
   ------------------------------------------------------------
   Toda cotización trae arriba los datos del emisor y del cliente,
   y abajo los sellos fiscales. Antes eso entraba a la tabla como
   si fueran renglones de compra: salían "Domicilio: BLVD. MANLIO
   FABIO" con precio 85506 —que es el código postal— y el teléfono
   del cliente cotizado en $6,221,988. Ninguno de esos números es
   un precio.
   ============================================================ */
const PRV_MAL = new RegExp([
  'r\\.?f\\.?c\\b', 'domicilio', 'colonia', 'tel[eé]fonos?\\b', 'correo', 'e-?mail',
  '\\bc\\.?p\\.?\\s*[:.]', 'codigo postal', '^cliente\\b', 'vendedor', 'r[eé]gimen',
  'uso cfdi', 'folio fiscal', 'serie y folio', '\\buuid\\b', 'sello', 'cadena original',
  'certificado', 'efectos fiscales', 'condiciones de pago', 'forma de pago',
  'm[eé]todo de pago', 'lugar de expedici', 'tipo de comprobante', '\\bmoneda\\b',
  '^ciudad', '^estado', '^pa[ií]s', 'fecha y hora', 'representaci[oó]n impresa',
  'hoja\\s*\\d+\\s*de', 'versi[oó]n del comprobante', 'personas morales',
  'persona f[ií]sica', 'clave prod', 'clave unidad', 'nuestro pedido',
  'observaci', 'vigencia', 'tiempo de entrega', 'los precios', 'atentamente',
  'nombre y firma', 'sub\\s*total', '^i\\.?v\\.?a\\.?$', '^total\\b', '^importe\\b',
  'pesos\\s*\\d\\d/100', 'asesor de ventas', 'no localizado'
].join('|'), 'i');

/* ============================================================
   Texto aplastado, para reconocer lo que el PDF escribe separado
   ------------------------------------------------------------
   Hay facturas que dibujan letra por letra: en el archivo dice
   "IMPO RTE C ON LE TRA" y "T O T AL", no "IMPORTE CON LETRA" ni
   "TOTAL". Buscar la palabra completa no encuentra nada, y por eso
   el pie de la factura —el pagaré, el IEPS, el subtotal— se colaba
   como si fueran productos.

   Quitándole TODOS los espacios y acentos, las dos formas de
   escribir la misma palabra quedan iguales. Es la única manera de
   que el filtro funcione sin importar cómo la parta el PDF.
   ============================================================ */
const prvPlano = s => String(s||'').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');

/* Lo mismo que PRV_MAL y PRV_FIN, pero contra el texto aplastado. */
const PRV_MAL_P = new RegExp([
  'importeconletra','subtotal','\\bieps\\b','totalapagar','grantotal',
  'debemosypagar','pagaremos','pagare','objetodeimpuesto','noobjetodeimpuesto',
  'fechadeemision','fechadevencimiento','selloDigital'.toLowerCase(),'cadenaoriginal',
  'certificadodelemisor','folgiofiscal','uuid','regimenfiscal','usodelcfdi',
  'metododepago','formadepago','condicionesdepago','moneda\\b','tipodecambio',
  'domicilio','telefono','rfc\\b','codigopostal','nombreyfirma','hoja\\d+de',
  'representacionimpresa','retenciones','trasladados','descuentototal'
].join('|'));

/* Donde termina la tabla: de aquí para abajo ya son sumas y letras chiquitas. */
const PRV_FIN = /^(sub\s*total|subtotal|i\.?v\.?a\.?\b|total\b|observaci|son:|importe con letra|nombre y firma|hoja\s*\d|efectos fiscales|sello|cadena original)/i;

/* La fila de encabezados de la tabla. Se reconoce por juntar dos o más de
   estas palabras: es la frontera entre el membrete y la mercancía. */
const PRV_CAB = [
  { k:'desc',    re:/^(concepto|descripci|art[ií]culo|articulo|producto|detalle|mercanc)/i },
  /* "VALOR UNITARIO" es el precio, no el importe. Al empezar con "valor"
     caía en la columna de importe y la de precio quedaba sin detectar: la
     factura entera se leía por la ruta de emergencia. Va antes que importe
     justo por eso. */
  { k:'precio',  re:/^(valor\s*unit|precio\s*unit|precio|p\.?\s*u\.?\b|v\.?\s*u\.?\b|unitario|costo)/i },
  { k:'importe', re:/^(importe|monto|total)/i },
  { k:'cant',    re:/^(cantidad|cant\b|cant\.|cdad|ctd|piezas)/i },
  { k:'unidad',  re:/^(unidad|unid|u\.?\s*m\.?\b|u\.?\s*med|medida|presentaci|empaque)/i },
  { k:'clave',   re:/^(clave|c[oó]digo|codigo|sku|part|crif)/i },
  /* La columna PESO de un CFDI dice cuántos kilos trae el renglón COMPLETO.
     Es el dato más confiable que existe para saber la presentación: no hay
     que deducirla del nombre. Iba metida en "otro" —solo anclada para que no
     contaminara el precio— y con ella el chile quebrado en sobres de 1 gramo
     se leía a $359,000 el kilo. */
  { k:'peso',    re:/^peso/i },
  /* Columnas que no aportan nada pero SÍ hay que anclar. Sin un ancla propia,
     sus valores —el peso, el IEPS en ceros, la clave del SAT— se van a la
     columna más cercana, que suele ser la del precio. Anclarlas es lo que
     evita que contaminen. */
  { k:'otro',    re:/^(peso|u\.?\s*sat|c\.?\s*sat|imp\.?$|ieps|i\.?v\.?a\.?$|descuento|desc\.?$|obj|no\.?\s*ident)/i }
];

/* Envases que sí son una unidad de verdad. La "Clave Unidad SAT" (PCE-PCE) no
   está aquí a propósito: es un catálogo del SAT, no una presentación. */
const PRV_ENVASE = /\b(pieza|pzas?|pza|pz|caja|cja|porron|porr[oó]n|gal[oó]n|galon|rollo|paquete|paq|bolsa|bulto|cubeta|garrafa|saco|lata|botella|tambo|kilo|kg|litro|lts?|juego|par|docena|ciento|millar)\b/i;

/* ---------- números ---------- */
/* El OCR parte los números: "5.40.00" es 540.00, no 5.40. En México nunca hay
   dos puntos decimales, así que sobra todo menos el último. */
function prvNum(t){
  let s = String(t==null?'':t).replace(/[^\d.,]/g,'').replace(/,/g,'');
  const p = s.split('.');
  if(p.length > 2) s = p.slice(0,-1).join('') + '.' + p[p.length-1];
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
/* Un precio se escribe con centavos. Exigirlos tira de un golpe códigos
   postales, RFC, teléfonos y claves del SAT, que es de donde venía la basura. */
function prvDinero(txt){
  const out = [];
  for(const m of String(txt||'').matchAll(/\d[\d.,]*\d|\d/g)){
    const bruto = m[0];
    /* Un precio lleva centavos. Los CFDI los escriben con seis decimales
       (144.370000), así que se aceptan de dos a seis: exigir exactamente dos
       tiraba TODOS los precios de una factura fiscal. Lo que se sigue tirando
       —y es el punto— son los enteros pelones: códigos postales, RFC,
       teléfonos y claves del SAT. */
    if(!/[.,]\d{2,6}(?!\d)/.test(bruto)) continue;
    const v = prvNum(bruto);
    if(v !== null && v > 0 && v < 1e6) out.push(v);
  }
  return out;
}

/* ============================================================
   1. Dónde están las columnas
   ------------------------------------------------------------
   Adivinarlas por el hueco entre palabras no funciona: en una
   factura "50112000 7.00" quedaba pegado en una sola celda y
   "$165.00 $1,155.00" también —precio e importe revueltos—.
   Y colocar cada celda en la columna del encabezado más cercano
   tampoco: el título "DESCRIPCIÓN" va centrado y el texto del
   producto empieza mucho antes, así que caía en la columna del
   código y el nombre del producto se perdía.

   La forma que sí aguanta es mirar la tabla completa. Una columna
   se separa de la siguiente por una franja vertical que NINGÚN
   renglón pisa — ni el encabezado, ni el producto más largo. Esas
   franjas son los cortes, y salen de los datos, no de suponer.
   ============================================================ */
function prvCortes(filas){
  /* Cuánto tiene que medir una franja libre para contar como corte. Con
     varios renglones basta con que esté libre en TODOS: los espacios entre
     palabras se mueven de un renglón a otro y la unión los tapa sola, así que
     lo que sobrevive es columna de verdad —en estas facturas los canales
     miden 3 puntos y el texto es de 7—. Con dos o tres renglones no hay esa
     evidencia y se exige un hueco ancho para no partir una frase. */
  const minima = filas.length >= 8 ? 1 : filas.length >= 5 ? 2 : 6;
  let ancho = 0;
  for(const f of filas) for(const p of f.pal) ancho = Math.max(ancho, p.x + p.w);
  const n = Math.ceil(ancho) + 3;
  const ocupado = new Uint8Array(n);
  for(const f of filas) for(const p of f.pal){
    const a = Math.max(0, Math.floor(p.x)), b = Math.min(n-1, Math.ceil(p.x + p.w));
    for(let i=a;i<=b;i++) ocupado[i] = 1;
  }
  const cortes = [];
  let i = 0;
  while(i < n){
    if(ocupado[i]){ i++; continue; }
    let j = i; while(j < n && !ocupado[j]) j++;
    /* Una franja libre ancha separa columnas; una angosta es nada más el
       espacio entre dos palabras de la misma frase. Cinco puntos es más de
       un espacio y menos que cualquier canal de tabla. */
    if(j - i >= minima && i > 0 && j < n) cortes.push((i + j) / 2);
    i = j;
  }
  return cortes;
}

const prvColIdx = (x, cortes) => { let k = 0; while(k < cortes.length && x >= cortes[k]) k++; return k; };

/* ¿Estos dos pedazos son en realidad UNA palabra que el lector partió?
   El PDF no entrega palabras: entrega trozos de texto con su posición, y
   dentro de una misma palabra puede haber varios. Pegarlos siempre con un
   espacio es lo que producía "CA MO TE HA RVEST SPLENDOR" en vez de
   "CAMOTE HARVEST SPLENDOR" — y con el nombre partido, el comparativo no
   reconocía que era el mismo producto que el del otro proveedor.

   Se pegan sin espacio solo si NO hay hueco de por medio y si a los dos
   lados hay letras. Nunca donde participa un dígito: ahí se juegan los
   precios, y un "165.00" pegado a un "1,155.00" mandaría a comprar con un
   número que nadie cotizó. */
function prvPega(izq, der, hueco, alto){
  if(hueco > Math.max(0.35, (alto || 8) * 0.12)) return false;
  return /[a-záéíóúñü]$/i.test(izq) && /^[a-záéíóúñü]/i.test(der);
}

/* Las palabras de un renglón, agrupadas por la columna a la que caen. */
function prvCeldasCol(pal, cortes){
  const m = new Map();
  for(const p of [...pal].sort((a,b)=>a.x-b.x)){
    const k = prvColIdx(p.x + p.w/2, cortes);
    if(!m.has(k)) m.set(k, { k, x:p.x, x2:p.x+p.w, s:p.s, h:p.h });
    else { const c = m.get(k);
      c.s += (prvPega(c.s, p.s, p.x - c.x2, p.h || c.h) ? '' : ' ') + p.s;
      c.x = Math.min(c.x, p.x); c.x2 = Math.max(c.x2, p.x+p.w); }
  }
  return [...m.values()].sort((a,b)=>a.k-b.k)
    .map(c => ({ ...c, w:c.x2-c.x, cx:(c.x+c.x2)/2, s:c.s.replace(/\s+/g,' ').trim() }));
}

/* Sin cortes todavía (para encontrar el encabezado) se junta por hueco. */
function prvCeldas(palabras){
  const orden = [...palabras].sort((a,b)=>a.x-b.x);
  const out = [];
  for(const p of orden){
    const u = out[out.length-1];
    const alto = p.h || 8;
    if(u && p.x - (u.x + u.w) < alto * 0.9){
      const hueco = p.x - (u.x + u.w);
      u.s += (prvPega(u.s, p.s, hueco, alto) ? '' : ' ') + p.s;
      u.w = p.x + p.w - u.x; }
    else out.push({ x:p.x, w:p.w, h:alto, s:p.s });
  }
  return out.map(c => ({ ...c, s: c.s.replace(/\s+/g,' ').trim(), cx: c.x + c.w/2 }));
}

function prvFilas(palabras){
  const porY = new Map();
  for(const p of palabras){
    const k = [...porY.keys()].find(y => Math.abs(y - p.y) <= Math.max(2, (p.h||8)*0.4));
    const kk = k ?? p.y;
    if(!porY.has(kk)) porY.set(kk, []);
    porY.get(kk).push(p);
  }
  return [...porY.entries()].sort((a,b)=>b[0]-a[0])
    .map(([y, ps]) => { const cel = prvCeldas(ps);
      return { y, pal: ps, cel, texto: cel.map(c=>c.s).join('  ').trim() }; });
}

/* ---------- 2. la fila de encabezados ----------
   Se buscan las palabras sueltas, no las celdas juntadas: "UNIDAD DE MEDIDA
   DESCRIPCIÓN" venía pegado en un solo bloque y así solo se reconocía la
   primera de las dos columnas — la de Descripción, la que trae el nombre del
   producto, se perdía entera. */
function prvBuscaCab(filas){
  for(let i=0;i<filas.length;i++){
    let n = 0;
    for(const p of filas[i].pal)
      if(PRV_CAB.some(h => h.k !== 'otro' && h.re.test(p.s))) n++;
    if(n >= 2) return { i };
  }
  return null;
}

/* Qué columna es cada una, ya con los cortes calculados. */
function prvMapaCols(filaCab, cortes){
  const cols = {};
  let otros = 0;
  for(const p of [...filaCab.pal].sort((a,b)=>a.x-b.x)){
    for(const h of PRV_CAB){
      if(!h.re.test(p.s)) continue;
      const k = prvColIdx(p.x + p.w/2, cortes);
      if(h.k === 'otro' || h.k === 'clave') cols[h.k + (++otros)] = k;
      else if(!(h.k in cols)) cols[h.k] = k;
      break;
    }
  }
  return cols;
}
/* De índice de columna a nombre. Ya no hay "la más cercana": o cae dentro o
   no cae, que es la diferencia entre leer el producto y leer su código. */
const prvQueCol = (k, cols) => {
  for(const [nom, idx] of Object.entries(cols)) if(idx === k) return nom;
  return null;
};

/* ---------- 3. leer la tabla ---------- */
function prvLeeTabla(paginas){
  const salida = [];
  for(const pag of paginas){
    const filas = prvFilas(pag);
    const cab = prvBuscaCab(filas);
    if(!cab) continue;
    const cuerpo = [];
    for(let i=cab.i+1;i<filas.length;i++){
      const f = filas[i];
      if(!f.texto) continue;
      if(PRV_FIN.test(f.texto) ||
         /^(importeconletra|subtotal|ieps|totalapagar|grantotal|debemos|pagare|observaciones|son:)/.test(prvPlano(f.texto))) break;
      cuerpo.push(f);
    }
    if(!cuerpo.length) continue;
    /* Los cortes salen del encabezado MÁS el cuerpo: el encabezado solo puede
       inventar canales donde el cuerpo sí escribe. */
    const cortes = prvCortes([filas[cab.i], ...cuerpo]);
    const cols = prvMapaCols(filas[cab.i], cortes);
    /* Si "Precio unitario" e "Importe" quedaron en la misma columna —pasa
       cuando el canal entre las dos mide un punto— no se puede decir cuál es
       cuál por posición. Se suelta el importe y se saca por orden: en un
       renglón el precio va antes que el importe, siempre. */
    if('precio' in cols && cols.precio === cols.importe) delete cols.importe;
    salida.push(...prvArma(cuerpo.map(f => ({ ...f, cel: prvCeldasCol(f.pal, cortes), cols }))));
  }
  return salida;
}

function prvArma(filas){
  const out = [];
  for(const f of filas){
    const cel = f.cel, cols = f.cols;
    const enCol = nom => cel.filter(c => prvQueCol(c.k, cols) === nom);

    /* El nombre: lo que está en la columna de Descripción. Si esa columna no
       se reconoció, la celda de texto más larga que no sea un código. */
    let nom = null;
    const dCol = enCol('desc').filter(c => (c.s.match(/[A-Za-zÁ-ú]/g)||[]).length >= 4);
    if(dCol.length) nom = dCol.sort((a,b)=>b.s.length-a.s.length)[0];
    else {
      let mejor = -1;
      for(const c of cel){
        const letras = (c.s.match(/[A-Za-zÁ-ú]/g)||[]).length;
        if(letras < 4 || /^\d[\d.,]*$/.test(c.s)) continue;
        const q = prvQueCol(c.k, cols);
        if(q && /^(clave|otro)\d*$/.test(q)) continue;
        if(PRV_MAL_P.test(prvPlano(c.s)) || PRV_MAL.test(c.s)) continue;
        if(letras > mejor){ mejor = letras; nom = c; }
      }
    }
    if(nom && (PRV_MAL_P.test(prvPlano(nom.s)) || PRV_MAL.test(nom.s))) nom = null;
    if(!nom) continue;

    const dinero = prvDinero(f.texto);
    if(!dinero.length){
      /* Segunda línea de la descripción ("CAJA CON 6 BOLSAS DE 2.27 C/U"):
         se pega al producto de arriba. Solo si viene de la columna de
         Descripción — la del código del SAT también se parte en dos. */
      const u = out[out.length-1];
      const enDesc = !Object.keys(cols).length || prvQueCol(nom.k, cols) === 'desc';
      if(u && enDesc && nom.s.length <= 60 && !PRV_MAL.test(nom.s))
        u.producto = (u.producto + ' ' + nom.s).slice(0,140);
      continue;
    }

    /* Ningún renglón de totales trae cantidad. Exigirla, cuando la tabla
       tiene esa columna, es lo que deja fuera el pie de la factura. */
    if('cant' in cols && !enCol('cant').some(c=>/\d/.test(c.s))) continue;
    if(PRV_MAL_P.test(prvPlano(f.texto).slice(0,60))) continue;

    /* La unidad de venta manda sobre lo que diga el nombre. */
    const uniVenta = enCol('unidad').map(c=>c.s).join(' ').trim();

    let precio = null, importe = null, cant = 1, seguro = false;
    if('precio' in cols) precio  = prvDinero(enCol('precio').map(c=>c.s).join(' '))[0] ?? null;
    if('importe' in cols) importe = prvDinero(enCol('importe').map(c=>c.s).join(' ')).slice(-1)[0] ?? null;
    const txtCant = enCol('cant').map(c=>c.s).join(' ');
    const q0 = prvDinero(txtCant)[0] ?? (Number(txtCant.replace(/[^\d.]/g,'')) || null);
    if(q0) cant = q0;

    if(precio == null){
      precio  = dinero.length >= 2 ? dinero[dinero.length-2] : dinero[0];
      importe = dinero.length >= 2 ? dinero[dinero.length-1] : null;
    }
    /* El importe es el último número del renglón. Tenerlo es lo que permite
       comprobar la lectura; sin él, el renglón se marca para revisar. */
    if(importe == null && dinero.length >= 2) importe = dinero[dinero.length-1];
    if(!precio) continue;

    /* El peso del renglón completo, si la factura trae esa columna. */
    const txtPeso = enCol('peso').map(c=>c.s).join(' ');
    const peso = Number(String(txtPeso).replace(/[^\d.]/g,'')) || 0;

    /* Cantidad x precio tiene que dar el importe. Es la prueba de que el
       renglón se leyó bien, y en un escaneo es lo único que la da. */
    if(importe && precio){
      const r = importe / precio;
      if(r > 0 && r < 1e4 && Math.abs(r - cant) < Math.max(0.02, cant*0.01)) seguro = true;
      /* Si importe÷precio coincide con el PESO del renglón, la cantidad son
         kilos y se leyó mal. Pasaba con "5.18 kilos de media pechuga": la
         cantidad salía 1 y la comprobación no cuadraba nunca. Dos datos
         independientes de la propia factura diciendo lo mismo es prueba
         suficiente para corregirla. */
      else if(peso > 0 && Math.abs(r - peso) <= Math.max(0.02, peso*0.01)){ cant = r; seguro = true; }
      else { const e = Math.round(r);
             if(e >= 1 && e <= 999 && Math.abs(r - e) < 0.02){ cant = e; seguro = true; } }
    }

    /* La presentación, por orden de confianza:
       1. el PESO que declara la propia factura, repartido entre la cantidad;
       2. lo que se pueda deducir de la unidad de venta y del nombre. */
    let pres = null;
    if(peso > 0 && cant > 0 && !/^(litro|litros|lt|lts|l|ml|mililitro)/i.test(uniVenta)){
      const porUnidad = peso / cant;
      if(porUnidad >= 0.0005 && porUnidad <= 2000)
        pres = `${Math.round(porUnidad*10000)/10000} kg`;
    }
    if(!pres) pres = prvPresent(f.texto, nom.s, uniVenta, cant);

    /* ---- una ambigüedad que el papel NO resuelve ----
       Cuando la unidad dice PIEZA y la cantidad del renglón es exactamente el
       peso que anuncia el nombre, hay dos lecturas y las dos cuadran con el
       importe:

         "QUESO PIZZERO ORIGINAL 5 KG"  cant 5  $86   imp $430
            · 5 kilos a $86  → $86 el kilo
            · 5 bolsas de 5 kg a $86 → $17.20 el kilo

         "SALSA PARA PIZZA CONTADINA LATA 3 KG"  cant 3  $155  imp $465
            · 3 kilos a $155 → $155 el kilo
            · 3 latas de 3 kg a $155 → $51.67 el kilo

       En el queso la buena es la primera; en la salsa, la segunda. Y lo único
       que las separa es saber cuánto cuesta el queso — conocimiento del
       negocio, no del documento. Escribí una regla que lo resolvía solo y
       arreglaba el queso mientras rompía la salsa, así que se va: aquí se
       MARCA la duda con las dos cuentas hechas, y la decide quien sabe. */
    const envase = PRV_ENVOLTORIO.test(uniVenta);
    let ambiguo = null;
    if(envase && cant >= 2 && precio){
      const m0 = String(nom.s||'').match(/(\d+(?:\.\d+)?)\s*(kgs?|kilos?|lts?|litros?)\b/i);
      if(m0 && Math.abs(Number(m0[1]) - cant) <= Math.max(0.01, cant*0.01)){
        const u = /^l/i.test(m0[2]) ? 'L' : 'kg';
        ambiguo = { unidad: u, tam: Number(m0[1]),
                    siEsUnidad: Math.round(precio*100)/100,
                    siEsEnvase: Math.round(precio/Number(m0[1])*100)/100 };
      }
    }

    out.push({
      producto: nom.s.replace(/^\(\s*[A-Z0-9\-]{2,12}\s*\)\s*/i,'').slice(0,140),
      presentacion: pres,
      cant, precio, importe, peso, seguro, ambiguo, marca:'', nota:'', equiv:''
    });
  }
  return out;
}

/* ---------- 4. sin posiciones (OCR): la unidad marca el corte ---------- */
/* En un escaneo no hay columnas, hay una tira de texto. Pero la palabra del
   envase —PIEZA, CAJA, PORRÓN— siempre va entre el nombre y los números.
   Ese es el gancho: a la izquierda el producto, a la derecha el dinero. */
function prvLeeTexto(texto){
  const lineas = String(texto||'').split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
  let ini = 0;
  for(let i=0;i<lineas.length;i++){
    let n = 0;
    for(const h of PRV_CAB) if(h.re.test(lineas[i]) || new RegExp(h.re.source,'i').test(lineas[i])) n++;
    const pal = (lineas[i].match(/\b(cantidad|unidad|importe|precio|descripci[oó]n|concepto|clave|codigo|c[oó]digo|crif)\b/gi)||[]).length;
    if(pal >= 2){ ini = i + 1; break; }
  }
  const out = [];
  for(let i=ini;i<lineas.length;i++){
    const l = lineas[i];
    if(PRV_FIN.test(l)) break;
    if(PRV_MAL.test(l)) continue;

    const m = l.match(PRV_ENVASE);
    let nombre, resto;
    if(m && m.index > 3){
      nombre = l.slice(0, m.index).trim();
      resto  = l.slice(m.index);
    } else {
      /* Sin envase: se corta en el primer número con centavos. */
      const p = l.search(/\d[\d.,]*[.,]\d{2}(?!\d)/);
      if(p < 4) continue;
      nombre = l.slice(0,p).trim(); resto = l.slice(p);
    }
    /* Los escaneos traen una clave corta al inicio (RR, ST, PHG). No es
       parte del nombre y estorba para emparejar entre proveedores. */
    nombre = nombre.replace(/^[A-Za-z]{1,4}\d{0,3}\s+(?=[A-Za-zÁ-ú]{3})/,'').trim();
    const letras = (nombre.match(/[A-Za-zÁ-ú]/g)||[]).length;
    if(letras < 4 || PRV_MAL.test(nombre)) continue;

    const dinero = prvDinero(resto);
    if(!dinero.length) continue;
    const precio  = dinero.length >= 2 ? dinero[dinero.length-2] : dinero[0];
    const importe = dinero.length >= 2 ? dinero[dinero.length-1] : null;
    if(!precio) continue;
    let cant = 1, seguro = false;
    if(importe){
      const q = importe/precio, r = Math.round(q);
      if(r >= 1 && r <= 999 && Math.abs(q-r) < 0.02){ cant = r; seguro = true; }
    }
    out.push({ producto: nombre.slice(0,120),
               presentacion: prvPresent(l, nombre),
               cant, precio, importe, seguro, marca:'', nota:'', equiv:'' });
  }
  return out;
}

/* ---------- 5. la presentación ----------
   Aquí estaba el error más caro de todos. El nombre del producto trae números
   por todos lados —"PAPA 5/16 FLAVORLAST C/13.62 KG"— y agarrar el primero
   daba 13.62 kg por bolsa: el precio por kilo salía en $4.04 en vez de $55.
   Trece veces más barato de lo que es. Un comparativo con ese número manda a
   cambiar de proveedor por nada.

   La verdad no está en el nombre, está en la COLUMNA DE UNIDAD. Si la factura
   dice que vende por Kilo, el precio ES por kilo y los números del nombre son
   descripción, no presentación. Solo cuando vende por Pieza hay que averiguar
   cuánto trae esa pieza, y ahí sí el nombre es la única fuente.
   ============================================================ */

/* Unidades de venta que ya dicen todo: el precio es por esta unidad. */
const PRV_VENDE = [
  { re:/^(kilo|kilos|kilogramos?|kg|kgs|kgm|kilog)\b/i,       pres:'1 kg' },
  { re:/^(gramos?|grs?|g)\b/i,                                pres:'1 g'  },
  { re:/^(litros?|lt|lts|l|ltr)\b/i,                          pres:'1 L'  },
  { re:/^(mililitros?|ml)\b/i,                                pres:'1 ml' },
  { re:/^(libras?|lb|lbs)\b/i,                                pres:'1 lb' }
];
/* Unidades que son un envase: hay que buscar cuánto trae. */
const PRV_ENVOLTORIO = /^(pieza|piezas|pza|pzas|pz|h87|caja|cja|bolsa|paquete|paq|rollo|lata|bote|botella|garrafa|cubeta|porron|porr[oó]n|saco|bulto|gal[oó]n|galon)\b/i;

function prvPresent(linea, nombre, unidad, cant){
  const u = String(unidad||'').trim();

  /* 1. Si vende por peso o volumen, se acabó: una unidad es una unidad. */
  const vende = PRV_VENDE.find(x => x.re.test(u));
  if(vende) return vende.pres;


  /* El nombre pasa por el mismo arreglo que la presentación: el lector de PDF
     parte las unidades —"1.14 K G."— y partidas no las reconoce ninguna de
     las reglas de abajo. Ese renglón se quedaba sin medida, se comparaba por
     pieza contra un kilo, y acababa en «solo uno». */
  const t = ' ' + prvUneUnidad(String(nombre||'').toLowerCase()) + ' ';
  const U = '(ml|mls|l|lt|lts|litros?|g|gr|grs|gramos?|kg|kgs|kilos?|lb|lbs|libras?|oz|onzas?|mts?|metros?|hs|hjs|hojas?|pz|pzas?|piezas?)';
  let m;

  /* 2. "(400/CAJA)" — cuántos trae la caja. Va antes que todo lo demás
        porque en "SOBRE 1 GRS (400/CAJA)" el 1 gramo es del sobre, no de la
        caja: leerlo al revés daba $359,000 el kilo. */
  if(/^(caja|cja|bulto|saco|paquete|paq)\b/i.test(u) &&
     /* El espacio antes del paréntesis no es cosmético: el lector entrega
        "(400/CAJA )" y la regla sin ese \s* no reconocía nada. */
     (m = t.match(/\(\s*(\d+)\s*\/\s*(?:caja|cja|bulto|saco|paquete|paq)\s*\)/i)))
    return `${m[1]} pz`;

  /* 3. Cuánto trae el envase, según el nombre. */
  if((m = t.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*[x×/]\\s*(\\d+(?:\\.\\d+)?)\\s*'+U+'\\b','i'))))
    return `${m[1]}x${m[2]} ${m[3]}`;
  if((m = t.match(new RegExp('\\bp\\s?(\\d+(?:\\.\\d+)?)\\s*'+U+'\\b','i'))))
    return `${m[1]} ${m[2]}`;
  if((m = t.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*'+U+'\\b','i'))))
    return `${m[1]} ${m[2]}`;

  /* 4. Sin medida en ningún lado: se dice el envase y se pide el tamaño.
        Una pieza sí se puede comparar contra otra pieza; una caja no —
        nadie sabe qué trae adentro. */
  if(PRV_ENVOLTORIO.test(u)) return u.toLowerCase();
  const e = String(linea||'').match(PRV_ENVASE);
  return e ? e[0].toLowerCase() : '';
}

/* ============================================================
   ¿Los precios traen IVA?
   ------------------------------------------------------------
   No se le pregunta a quien captura: se comprueba contra el propio
   documento. La suma de los importes de la tabla tiene que dar el
   subtotal (precios sin IVA) o el total (precios con IVA). Esa
   comparación es una prueba, no una suposición — y el 16% es
   justo la diferencia que decide quién sale más barato.
   ============================================================ */
function prvDetectaIva(texto, filas){
  const t = String(texto||'');
  const suma = filas.reduce((s,r)=>s + (r.importe ?? (r.precio*(r.cant||1))), 0);
  const num = re => { const m = t.match(re); return m ? prvNum(m[1]) : null; };
  const sub = num(/sub\s*-?\s*total[^\d$]{0,20}\$?\s*([\d.,]+\d)/i);
  /* "Sub Total" contiene la palabra "Total": buscarla tal cual devolvía el
     subtotal dos veces y la comprobación no comparaba nada. Se quitan primero
     los renglones de subtotal. */
  const sinSub = t.replace(/^.*sub\s*-?\s*total.*$/gim, ' ');
  const tot = (()=>{ const m = sinSub.match(/total[^\d$]{0,20}\$?\s*([\d.,]+\d)/i);
                     return m ? prvNum(m[1]) : null; })();
  const cerca = (a,b) => a && b && Math.abs(a-b) <= Math.max(1, b*0.01);

  if(cerca(suma, sub) && !cerca(suma, tot)) return { iva:'sin', por:'la suma da el subtotal' };
  if(cerca(suma, tot) && !cerca(suma, sub)) return { iva:'con', por:'la suma da el total' };
  if(/precios?\s+(no\s+incluyen?|sin)\s+iva|m[aá]s\s+iva|\+\s*iva|iva\s+no\s+incluido/i.test(t))
    return { iva:'sin', por:'lo dice la cotización' };
  if(/iva\s+incluido|precios?\s+con\s+iva|incluye\s+iva/i.test(t))
    return { iva:'con', por:'lo dice la cotización' };
  if(sub && tot && Math.abs(tot/sub - 1.16) < 0.02)
    return { iva:'sin', por:'el total es el subtotal más 16%' };
  return { iva:'sin', por:'no lo dice — se asume sin IVA' };
}

/* ---------- de quién es la cotización ---------- */
/* El nombre del proveedor está en el logo: es el texto más grande de la
   primera página. Se descarta lo que sea del cliente —somos nosotros— y
   los renglones fiscales. Si no hay letra grande (un escaneo), el correo
   del proveedor lo dice igual de bien. */
const PRV_YO = /boye|rodrigo|ze[ñn]a|zaragoza|zezr9/i;
/* Y el texto más grande de la hoja muchas veces no es el proveedor sino el
   título del documento: "Cotización", "Factura". Nombrar al proveedor
   "Cotización" no le sirve a nadie. */
const PRV_TITULO = /^(cotizaci[oó]n|factura|remisi[oó]n|nota|pedido|presupuesto|orden de compra|comprobante|recibo|ticket)\b/i;
function prvProveedor(paginas, texto, archivo){
  if(paginas && paginas[0]?.length){
    const cand = prvFilas(paginas[0]).slice(0, 14)
      .flatMap(f => f.cel.map(c => ({ ...c, h: c.h })))
      .filter(c => c.s.length >= 4 && c.s.length <= 46
                && (c.s.match(/[A-Za-zÁ-ú]/g)||[]).length >= 4
                && !PRV_YO.test(c.s) && !PRV_MAL.test(c.s) && !PRV_TITULO.test(c.s))
      .sort((a,b) => b.h - a.h);
    if(cand.length && cand[0].h >= (cand[cand.length-1].h || 1) * 1.15)
      return cand[0].s.replace(/\s+/g,' ').trim();
  }
  const mail = String(texto||'').match(/([A-Za-z][\w.\-]{2,})@([\w.\-]+)/);
  if(mail && !PRV_YO.test(mail[0])){
    /* El buzón casi siempre trae el nombre del negocio: ferrelimpio2025@…
       Solo cuando es un buzón genérico (ventas@, info@) hay que irse al
       dominio. Fiarse del dominio primero fallaba con los correos de Gmail
       —y el OCR ni siquiera escribe "gmail" bien. */
    /* Los buzones traen el año pegado (ferrelimpio2025@) y el OCR mete letras
       sueltas entre los dígitos. Se quita toda la cola de números y letras
       sueltas, no solo el último número. */
    const local = mail[1].replace(/(\d[a-z]?)+$/i,'');
    const dom = mail[2].split('.')[0];
    const generico = /^(ventas|info|contacto|cotiza|admin|compras|atencion|hola|pedidos|facturacion|correo|mail)$/i.test(local);
    const elegido = generico ? dom : local;
    if(elegido.length >= 3) return elegido.toUpperCase();
  }
  return String(archivo||'').replace(/\.[a-z]+$/i,'').slice(0,50);
}

/* ---------- pdf.js, conservando dónde está cada palabra ----------
   El lector de siempre (extractPdfText) devuelve renglones de texto ya
   aplanados: sirve para una factura de inventario, pero al aplanar se pierde
   en qué columna estaba cada dato, que es justo lo que aquí hace falta. */
async function prvExtraeCeldas(file){
  await loadPdfJs();
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  const pags = [];
  for(let p=1; p<=pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pal = [];
    for(const it of tc.items){
      const s = String(it.str||'').trim();
      if(!s) continue;
      pal.push({ x: it.transform[4], y: it.transform[5],
                 w: it.width || s.length * 4,
                 h: Math.abs(it.transform[3]) || it.height || 8, s });
    }
    if(pal.length) pags.push(pal);
  }
  return pags;
}

/* Un solo punto de entrada: con posiciones si el PDF trae texto, por líneas
   si vino escaneado y hubo que pasarlo por OCR. */
function prvParse(texto, paginas){
  const filas = (paginas && paginas.length) ? prvLeeTabla(paginas) : [];
  return filas.length ? filas : prvLeeTexto(texto);
}

/* ============================================================
   EMPAREJAR EL MISMO PRODUCTO ENTRE PROVEEDORES
   ------------------------------------------------------------
   Nadie escribe igual. Uno pone "SERVILLETA TORK XPRESS NAP" y el
   otro "SERVILLETA XPRESSNAP CAFE TORK ADVANCED 12/500 HS". Es el
   mismo producto y el comparativo no los juntaba, así que no
   comparaba nada — que era todo el punto de la sección.

   Aquí se PROPONEN parejas, no se aplican solas. La propuesta se
   basa en palabras compartidas, y una palabra compartida solo
   cuenta si es rara en el comparativo: "microfibra" aparece en un
   trapeador, en un paño y en una toalla, así que sola no junta
   nada; "trapeador" aparece dos veces y ahí sí dice algo.

   Que las proponga la máquina y las confirme una persona es a
   propósito: emparejar mal dos productos distintos manda a
   comprarle al proveedor equivocado, y nadie se entera.
   ============================================================ */
const PRV_VACIAS = new Set(('de del la el los las con sin para por y o en un una su sus al ' +
  'tipo marca color azul verde negro blanco blanca rojo amarillo gris cafe ' +
  'grande chico chica mediano premium advanced universal multi eco super plus ' +
  /* Adjetivos de catálogo. "ORIGINAL" juntaba el queso Philadelphia con el
     queso pizzero nada más porque los dos lo dicen; son productos y precios
     distintos y el comparativo salía mintiendo. */
  'original especial natural clasico tradicional extra superior selecto nuevo nueva ' +
  'juego pieza piezas caja cajas rollo rollos bolsa bolsas paquete galon corte cortes ' +
  'porron litro litros kilo kilos gramos aprox variado peso').split(/\s+/));

const prvPalabras = s => String(s||'')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-z0-9]+/g,' ')
  .split(' ')
  .filter(w => w.length >= 4 && !PRV_VACIAS.has(w) && !/^\d+$/.test(w));

/* Distancia de edición, para las erratas de catálogo: un proveedor escribe
   PEPPERONI y el otro PEPERONI. Es la misma carne y el mismo precio por kilo,
   y sin esto nunca se comparaban. */
function prvLev(a, b){
  if(Math.abs(a.length-b.length) > 1) return 9;
  const m = a.length, n = b.length;
  let prev = Array.from({length:n+1}, (_,j)=>j);
  for(let i=1;i<=m;i++){
    const cur = [i];
    for(let j=1;j<=n;j++)
      cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1]===b[j-1]?0:1));
    prev = cur;
    if(Math.min(...cur) > 1) return 9;
  }
  return prev[n];
}

/* Dos palabras son la misma si son iguales, si una es el plural de la otra,
   o si difieren en una letra. Nada más. Antes bastaba con que una empezara
   igual que la otra —cinco letras— y eso juntó "CHILE quebrado" con "pechuga
   CHILEna": el chile en polvo comparado contra la pechuga de pollo. */
const prvMismaPalabra = (a, b) =>
  a === b
  || (Math.abs(a.length-b.length) <= 1 && (a.startsWith(b) || b.startsWith(a)))
  || (a.length >= 6 && b.length >= 6 && prvLev(a,b) <= 1);

/* El nombre entero sin espacios ni signos. Sirve para los comparativos que ya
   están guardados con el nombre partido —"CA MO TE HA RVEST SPLENDOR"—: los
   espacios de más no se pueden quitar a ciegas (no hay forma de saber cuáles
   sobran y cuáles son de verdad), pero sí se pueden IGNORAR al comparar.
   "camote" aparece dentro de "camoteharvestsplendor…" aunque en pantalla se
   lea partido en tres. */
const prvCompacto = s => String(s||'')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-z0-9]+/g,'');

/* ¿Aparece esta palabra dentro del nombre pegado, aguantando una errata?
   La errata importa: un proveedor factura PEPERONI y el otro PEPPERONI. */
/* MÍNIMO SEIS LETRAS, y no es un número redondo: con cinco, "CHILE" quebrado
   se encontró dentro de pechuga "CHILEna" y el comparativo puso el chile en
   sobres de 1 gramo —$359 el sobre— a competir contra la pechuga de pollo.
   Ese error ya lo habían corregido aquí antes; lo volví a meter yo al buscar
   por pedazos. Seis letras y el candado de abajo lo cierran otra vez. */
function prvDentro(compacto, w){
  if(!compacto || w.length < 6) return false;
  if(compacto.includes(w)) return true;
  for(let n = w.length - 1; n <= w.length + 1; n++){
    if(n < 5 || n > compacto.length) continue;
    for(let i = 0; i + n <= compacto.length; i++)
      if(prvLev(compacto.slice(i, i+n), w) <= 1) return true;
  }
  return false;
}

/* ============================================================
   EMPAREJAR EL MISMO PRODUCTO ENTRE PROVEEDORES
   ------------------------------------------------------------
   Nadie escribe igual. Uno pone "PAPA CAMOTE 5/16 HARVEST
   SPLENDOR" y el otro "(3731) CAMOTE HARVEST SPLENDOR CORTE
   DELGADO 5/16" 1.14 KG.". Es el mismo camote y sin juntarlos el
   comparativo no compara nada.

   Dos reglas, y las dos existen por un error concreto:

   1. Solo se emparejan MEJORES MUTUOS. Antes cualquier parecido
      unía, y como los grupos se encadenaban, un solo enlace malo
      arrastraba tres productos distintos al mismo renglón: el
      queso Philadelphia acabó comparado contra el queso pizzero
      a $17 el kilo. Ahora el camote se junta con el camote solo
      si el camote también lo elige a él.

   2. Una palabra suelta solo cuenta si es rara. "POLLO" aparece
      en cinco renglones y no dice cuál con cuál; "SPLENDOR"
      aparece en dos y ahí sí dice todo.
   ============================================================ */
function prvEmpareja(c){
  const filas = [];
  /* Los índices ip/ir apuntan al renglón REAL —la pantalla escribe la
     equivalencia ahí— pero para decidir "esto es de otro proveedor" manda el
     GRUPO: dos facturas de Quesos y Quesos no se emparejan entre sí. */
  const grupo = prvGrupoProv(c);
  (c.proveedores||[]).forEach((p, ip) => (p.renglones||[]).forEach((r, ir) => {
    filas.push({ ip, ir, gr: grupo[ip], prov: p.proveedor || `Proveedor ${ip+1}`,
                 producto: r.producto || '', pal: [...new Set(prvPalabras(r.producto))],
                 comp: prvCompacto(r.producto),
                 /* Buscar una palabra DENTRO del nombre pegado solo tiene
                    sentido cuando ese nombre viene partido por el lector
                    ("CA MO TE HA RVEST"). En un nombre bien escrito, buscar
                    por pedazos solo inventa parecidos. */
                 partido: (String(r.producto||'').match(/\b[a-záéíóúñ]{1,2}\b/gi)||[]).length >= 3,
                 uni: prvBase(r.presentacion)?.unidad || null,
                 yaTiene: !!(r.equiv||'').trim() });
  }));

  /* Qué tan común es cada palabra. Se cuenta UNA VEZ POR PROVEEDOR: con tres
     facturas de Quesos y Quesos, "pepperoni" aparecía tres veces y dejaba de
     ser una palabra rara — justo la rareza que hacía que se emparejara con el
     PEPERONI del otro. Tres copias del mismo renglón no son tres productos. */
  const cuenta = new Map();
  {
    /* En cuántos PRODUCTOS DISTINTOS aparece la palabra. Ni por renglón —tres
       facturas del mismo proveedor repetían el mismo producto y "pepperoni"
       dejaba de ser raro— ni por proveedor —con dos proveedores, cualquier
       palabra compartida daba 2 y todo parecía raro, hasta "pollo", que
       juntaba las alitas con los nuggets—. */
    const vistoPor = new Map(), yaVisto = new Set();
    for(const f of filas){
      const k = f.gr + '|' + prvClave(f.producto);
      if(yaVisto.has(k)) continue;
      yaVisto.add(k);
      for(const w of f.pal){
        if(!vistoPor.has(w)) vistoPor.set(w, 0);
        vistoPor.set(w, vistoPor.get(w) + 1);
      }
    }
    for(const [w, n] of vistoPor) cuenta.set(w, n);
  }

  /* Qué tan parecidos son dos renglones: cuántas palabras comparten, y si
     comparten una sola, qué tan rara es. */
  /* Cuántas palabras de A reconoce B. Además de palabra contra palabra, se
     busca la palabra DENTRO del nombre pegado del otro: así se reconoce al
     que viene partido por el lector de PDF, que es de donde salían la mitad
     de los renglones «solo uno». */
  const empalme = (A, B) => {
    let n = 0, raras = 0;
    for(const x of A.pal){
      if(!(B.pal.some(y => prvMismaPalabra(x, y)) || (B.partido && prvDentro(B.comp, x)))) continue;
      n++; if((cuenta.get(x)||9) <= 2) raras++;
    }
    return { n, raras };
  };
  /* Se mide en las dos direcciones y manda la mejor: si solo uno de los dos
     nombres viene partido, sus palabras no existen como tales y contar nada
     más de ese lado daría cero. El parecido tiene que dar igual quién va
     primero, o el emparejamiento por mejores mutuos nunca cierra. */
  const parecido = (a, b) => {
    if(a.gr === b.gr) return 0;                       // el mismo proveedor no se compara consigo
    if(a.uni && b.uni && a.uni !== b.uni) return 0;   // kilos contra piezas no se comparan
    const ab = empalme(a, b), ba = empalme(b, a);
    /* Manda la mejor de las dos direcciones, y el desempate es por palabras
       raras: con solo el conteo, "PEPERONI" contra "PEPPERONI DOBLE Q GRANEL"
       daba 1 mirándolo de un lado y 0 del otro, según quién fuera primero. Un
       parecido que cambia de valor al voltear la pareja nunca cierra el
       emparejamiento por mejores mutuos. */
    const { n, raras } = (ab.n > ba.n || (ab.n === ba.n && ab.raras >= ba.raras)) ? ab : ba;
    if(n >= 2) return n + raras;
    if(n === 1 && raras === 1) return 1;
    return 0;
  };

  /* El mejor candidato de cada renglón, por cada proveedor distinto. */
  const mejorDe = filas.map(()=> new Map());
  for(let i=0;i<filas.length;i++) for(let j=0;j<filas.length;j++){
    if(i === j) continue;
    const s = parecido(filas[i], filas[j]);
    if(!s) continue;
    const m = mejorDe[i].get(filas[j].gr);
    if(!m || s > m.s) mejorDe[i].set(filas[j].gr, { j, s });
  }

  const une = new Map(); filas.forEach((_,i)=>une.set(i,i));
  const raiz = x => { while(une.get(x) !== x) x = une.get(x); return x; };
  for(let i=0;i<filas.length;i++) for(const {j} of mejorDe[i].values()){
    /* Solo si se eligen el uno al otro. Un enlace de ida sin vuelta es
       justo el que arrastraba grupos enteros al producto equivocado. */
    if(mejorDe[j].get(filas[i].gr)?.j !== i) continue;
    const ri = raiz(i), rj = raiz(j);
    if(ri !== rj) une.set(rj, ri);
  }

  const grupos = new Map();
  filas.forEach((f, i) => {
    const r = raiz(i);
    if(!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(f);
  });

  return [...grupos.values()]
    .filter(g => new Set(g.map(x=>x.gr)).size >= 2)
    .map(g => ({
      nombre: g.map(x=>x.producto).sort((a,b)=>a.length-b.length)[0].slice(0,60),
      items: g
    }))
    .sort((a,b)=>b.items.length - a.items.length);
}

/* ============================================================
   TRES FACTURAS DEL MISMO PROVEEDOR SON UN PROVEEDOR
   ------------------------------------------------------------
   Se suben las cotizaciones de una en una, y de un mismo
   proveedor pueden venir varias —una por pedido, una por mes—.
   El comparativo las estaba tomando como proveedores distintos:
   salían tres columnas «QUESOS Y QUESOS», y como cada renglón
   busca su precio por NOMBRE de proveedor, las tres columnas
   enseñaban el mismo número. Una tabla que repite el mismo dato
   tres veces no compara nada, y de paso hacía ver como si
   hubiera más proveedores de los que hay.

   Aquí se juntan por nombre. Si el mismo producto viene en dos
   facturas del mismo proveedor:
     · con el mismo precio  → es la misma cotización repetida, se
       ignora la copia sin decir nada;
     · con precio distinto  → manda la factura más nueva y se
       avisa, porque eso significa que el precio se movió (o que
       una de las dos se leyó mal) y el dato importa.
   ============================================================ */
const prvNormProv = s => String(s||'')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-z0-9]+/g,' ').trim();

/* De cada proveedor real, a qué proveedor unificado pertenece. Los índices
   ORIGINALES se conservan aparte porque la pantalla de equivalencias escribe
   de vuelta en prvEdit.proveedores[ip].renglones[ir]: moverlos ahí guardaría
   la equivalencia en el renglón equivocado. */
function prvGrupoProv(c){
  const map = new Map(), idx = [];
  (c.proveedores||[]).forEach((p, ip) => {
    const k = prvNormProv(p.proveedor) || ('#'+ip);
    if(!map.has(k)) map.set(k, map.size);
    idx[ip] = map.get(k);
  });
  return idx;
}

function prvUnifica(c){
  const orden = [], porClave = new Map();
  (c.proveedores||[]).forEach((p, ip) => {
    const nombre = p.proveedor || `Proveedor ${ip+1}`;
    const k = prvNormProv(nombre) || ('#'+ip);
    if(!porClave.has(k)){
      porClave.set(k, { ...p, proveedor: nombre, renglones: [], _facturas: 0, _choques: [] });
      orden.push(k);
    }
    const u = porClave.get(k);
    u._facturas++;
    if(p.fecha && (!u.fecha || p.fecha > u.fecha)) u.fecha = p.fecha;
    for(const r of (p.renglones || [])){
      const kr = prvClave(r.equiv || r.producto);
      const ya = kr && u.renglones.find(x => prvClave(x.equiv || x.producto) === kr);
      if(!ya){ u.renglones.push({ ...r, _fecha: p.fecha || null }); continue; }
      const antes = Number(ya.precio || 0), ahora = Number(r.precio || 0);
      if(Math.abs(antes - ahora) < 0.005) continue;      // la misma cotización repetida
      u._choques.push({ producto: r.producto, antes, ahora, fecha: p.fecha || null });
      if((p.fecha || '') >= (ya._fecha || '')) Object.assign(ya, r, { _fecha: p.fecha || ya._fecha });
    }
  });
  return orden.map(k => porClave.get(k));
}

/* ---------- datos ---------- */
async function prvRefresca(){
  prvCargando = true; render();
  try{ prvLista = await finRpc('prov_list', {}) || []; }
  catch(e){ prvLista = []; toast('No se pudieron cargar los comparativos'); }
  prvCargando = false; render();
}

/* ---------- la comparación ----------
   Se agrupa por nombre normalizado. Cada grupo enseña el precio por unidad
   base de cada proveedor, quién es el más barato y cuánto se ahorra contra
   el más caro. Los renglones sin presentación reconocida NO se comparan: se
   listan aparte para que se corrijan. */
/* ============================================================
   CUANDO LA DIFERENCIA ES DEMASIADO GRANDE PARA SER CIERTA
   ------------------------------------------------------------
   Dos proveedores del mismo producto no se llevan por el triple.
   Se llevan por diez, veinte, treinta y cinco por ciento; eso es
   el mercado. Cuando el comparativo dice que uno cobra tres o
   diez veces más, casi nunca es el precio: es la PRESENTACIÓN
   leída mal en uno de los dos — una caja de 6 contada como una
   bolsa, o una bolsa contada como la caja entera.

   Enseñar eso como "ahorro del 70%" manda a cambiar de proveedor
   por un número inventado, y nadie se entera hasta que llega la
   factura. Así que el renglón se marca.

   Y cuando la diferencia se parece a algún número de la propia
   presentación, se dice cuál: si la razón es 6.0 y un renglón
   dice "C/6", ya sabemos exactamente qué pasó. Eso no lo corrige
   la máquina sola — corregirlo mal cuesta igual de caro — pero
   deja el dedo puesto en el renglón que hay que revisar. */
const PRV_RAZON_SOSPECHOSA = 3;

function prvSospecha(ord){
  if(ord.length < 2) return null;
  const min = ord[0].precio_base, max = ord[ord.length-1].precio_base;
  if(!min || !max || min <= 0) return null;
  const razon = max / min;
  if(razon < PRV_RAZON_SOSPECHOSA) return null;

  /* El número culpable: el que aparece en la presentación o el nombre de
     alguno de los dos y se parece a la razón. Un 6 en "C/6 6.8KG" explica
     una diferencia de 6 veces mucho mejor que cualquier teoría de precios. */
  let culpa = null;
  for(const o of ord){
    const nums = `${o.presentacion||''} ${o.producto||''}`.match(/\d+(?:\.\d+)?/g) || [];
    for(const n of nums){
      const f = Number(n);
      if(!(f >= 1.5 && f <= 200)) continue;
      if(Math.abs(razon - f) / f <= 0.08){ culpa = { factor: f, oferta: o }; break; }
    }
    if(culpa) break;
  }
  return { razon: Math.round(razon*10)/10, culpa };
}

function prvComparar(c){
  const grupos = new Map();
  const sinBase = [];
  /* Se compara contra proveedores UNIFICADOS: tres facturas de Quesos y
     Quesos son Quesos y Quesos, no tres columnas con el mismo número. */
  const unificados = prvUnifica(c);
  unificados.forEach((p, ip)=>{
    (p.renglones||[]).forEach((r0, ir)=>{
      const r = prvCalc(r0, p);
      if(r.precio_base === null){ sinBase.push({ prov:p.proveedor||`Proveedor ${ip+1}`, r:r0, ip, ir }); return; }
      const k = prvClave(r0.equiv || r.producto);
      if(!k) return;
      const g = grupos.get(k) || { clave:k, nombre:(r0.equiv||r.producto), unidad:r.unidad_base, ofertas:[] };
      /* Si el mismo producto viene en unidades distintas (uno por kilo y otro
         por pieza) no se pueden comparar: se separa en dos grupos. */
      if(g.unidad !== r.unidad_base){
        const k2 = k + ' · ' + r.unidad_base;
        const g2 = grupos.get(k2) || { clave:k2, nombre:(r0.equiv||r.producto), unidad:r.unidad_base, ofertas:[] };
        g2.ofertas.push({ prov:p.proveedor||`Proveedor ${ip+1}`, ...r });
        grupos.set(k2, g2); return;
      }
      g.ofertas.push({ prov:p.proveedor||`Proveedor ${ip+1}`, ...r });
      grupos.set(k, g);
    });
  });

  const filas = [];
  for(const g of grupos.values()){
    const ord = g.ofertas.slice().sort((a,b)=>a.precio_base-b.precio_base);
    const mejor = ord[0], peor = ord[ord.length-1];
    filas.push({
      ...g, ofertas: ord, mejor, peor,
      /* El ahorro por unidad y, si hay cantidad pedida, el ahorro en pesos. */
      ahorroUnidad: ord.length>1 ? Math.round((peor.precio_base-mejor.precio_base)*10000)/10000 : 0,
      ahorroPct: ord.length>1 && peor.precio_base
        ? Math.round((1 - mejor.precio_base/peor.precio_base)*1000)/10 : 0,
      solo: ord.length === 1,
      sospecha: prvSospecha(ord)
    });
  }
  /* Los renglones dudosos van arriba de todo. No son la mejor oportunidad de
     ahorro —son el número que hay que arreglar antes de creerle al resto—. */
  filas.sort((a,b)=> (b.sospecha?1:0) - (a.sospecha?1:0) || b.ahorroPct - a.ahorroPct);
  const ambiguos = [];
  unificados.forEach(p => (p.renglones||[]).forEach(r => {
    if(r.ambiguo) ambiguos.push({ prov: p.proveedor, ...r });
  }));
  return { filas, sinBase, ambiguos, provs: unificados.map(p=>p.proveedor),
           unificados, choques: unificados.flatMap(p=>p._choques.map(x=>({...x, prov:p.proveedor}))),
           juntados: unificados.filter(p=>p._facturas>1) };
}

/* ---------- ¿quién sale más barato, en una línea? ----------
   La tabla dice renglón por renglón; esto contesta la pregunta con la que uno
   llega: «¿a quién le compro?». Se mide sobre la CANASTA COMPARABLE —los
   productos que TODOS cotizan— porque sumar lo que cada quien cotizó por su
   lado no compara nada: gana el que mandó la lista más corta.
   Los renglones marcados como dudosos quedan fuera: un precio mal leído
   decide el resultado él solo. */
function prvQuienGana(C){
  const provs = C.provs || [];
  if(provs.length < 2) return null;
  const comp = C.filas.filter(f => !f.solo && !f.sospecha);
  if(!comp.length) return null;

  const gana = {}; provs.forEach(n => gana[n] = 0);
  for(const f of comp) gana[f.mejor.prov]++;

  /* La canasta se arma por PAREJA, no entre todos. Exigir que los tres
     coticen el mismo producto deja la canasta en cero —nadie cotiza todo— y
     sumar lo que cada quien mandó por su lado tampoco sirve: ganaría el de la
     lista más corta. Se toma la pareja con más productos en común, que es la
     comparación con más piso. */
  let par = null;
  for(let i=0;i<provs.length;i++) for(let j=i+1;j<provs.length;j++){
    const a = provs[i], b = provs[j];
    const filas = comp.filter(f => f.ofertas.some(o=>o.prov===a) && f.ofertas.some(o=>o.prov===b));
    if(!filas.length) continue;
    const ta = filas.reduce((s,f)=>s + f.ofertas.find(o=>o.prov===a).precio_base, 0);
    const tb = filas.reduce((s,f)=>s + f.ofertas.find(o=>o.prov===b).precio_base, 0);
    if(!par || filas.length > par.filas.length) par = { a, b, ta, tb, filas };
  }
  if(!par) return null;

  const mejor  = par.ta <= par.tb ? par.a : par.b;
  const peor   = mejor === par.a ? par.b : par.a;
  const tMejor = mejor === par.a ? par.ta : par.tb;
  const tPeor  = mejor === par.a ? par.tb : par.ta;
  return {
    canasta: par.filas.length, provs, gana, mejor, peor,
    total: { [mejor]: tMejor, [peor]: tPeor },
    pct: tPeor ? Math.round((1 - tMejor/tPeor)*1000)/10 : 0,
    /* Renglones donde el que gana en general NO es el más barato: ahí conviene
       partir el pedido, y decirlo es más útil que un ganador absoluto. */
    excepciones: par.filas.filter(f => f.mejor.prov !== mejor)
  };
}

/* ---------- pantallas ---------- */
function prvListaView(){
  let h = `<div class="panel">
    <div class="d-h3">Comparar proveedores</div>
    <p class="hint" style="margin:4px 0 12px">Sube la cotización de cada proveedor y la app las pone
      lado a lado <b>en precio por litro, kilo o pieza</b> — que es la única forma de comparar una
      garrafa de 5 L contra una caja de 12 botellas.</p>
    <button class="btn-primary" id="prvNuevo" style="width:100%">+ Nuevo comparativo</button>
  </div>`;
  if(prvLista === null || prvCargando) return h + `<div class="empty"><b>Cargando…</b></div>`;
  if(!prvLista.length) return h + `<div class="empty"><b>Todavía no hay comparativos</b></div>`;

  h += `<div class="res-wrap"><table class="res"><thead><tr>
    <th style="text-align:left">Comparativo</th><th>Fecha</th>
    <th>Proveedores</th><th>Renglones</th><th></th></tr></thead><tbody>`;
  for(const c of prvLista){
    h += `<tr><td style="text-align:left;font-weight:700">${esc(c.nombre||'(sin nombre)')}</td>
      <td>${esc(String(c.fecha||'').split('-').reverse().join('/'))}</td>
      <td>${c.proveedores||0}</td><td>${c.renglones||0}</td>
      <td><button class="rowbtn" data-prvabre="${c.id}">Abrir</button></td></tr>`;
  }
  return h + `</tbody></table></div>`;
}

function prvEditorView(){
  const c = prvEdit;
  const C = prvComparar(c);

  /* Las equivalencias que ya se escribieron, para poder elegirlas en vez de
     volver a teclearlas —y que no se cuelen dos formas de escribir lo mismo. */
  const equivs = [...new Set((c.proveedores||[]).flatMap(p=>(p.renglones||[])
    .map(r=>(r.equiv||'').trim()).filter(Boolean)))].sort();

  let h = `<datalist id="prvEquivs">${equivs.map(e=>`<option value="${esc(e)}">`).join('')}</datalist>
  <div class="frm-row" style="margin-bottom:10px">
    <button class="btn-quiet" id="prvVolver">‹ Todos los comparativos</button></div>`;

  h += `<div class="panel">
    <div class="frm-row-3">
      <label>Qué se está comparando <input type="text" id="prvNombre" maxlength="80"
        value="${esc(c.nombre)}" placeholder="Aceite, carne, desechables…"></label>
      <label>Fecha <input type="date" id="prvFecha" value="${esc(c.fecha)}"
        style="min-height:44px;border:1.5px solid var(--line);border-radius:10px;padding:8px;background:#FBFAF7;font-size:15px"></label>
      <span></span></div>
  </div>`;

  /* ============================================================
     Adjuntar y procesar
     ------------------------------------------------------------
     Antes cada proveedor era una tarjeta con su nombre, su fecha,
     su IVA y su tabla de renglones, todo abierto al mismo tiempo:
     tres cotizaciones llenaban la pantalla de campos que casi
     nunca se tocan. El trabajo de verdad es otro — soltar los PDF
     y ver quién sale más barato.

     Así que eso es lo que se ve. Los renglones siguen ahí, para
     corregir cuando el lector se equivoque, pero doblados.
     ============================================================ */
  const nProv = (c.proveedores||[]).length;
  const nRen  = (c.proveedores||[]).reduce((t,p)=>t+(p.renglones||[]).length, 0);

  h += `<div class="panel" id="prvZona" style="border:2px dashed #C9C1B2;background:#FBFAF7;
      text-align:center;padding:22px 16px;transition:background .15s,border-color .15s">
    <div style="font-size:28px;line-height:1">📎</div>
    <div style="font-weight:800;font-size:15px;margin-top:6px">
      Arrastra aquí las cotizaciones en PDF</div>
    <p class="hint" style="margin:6px 0 12px">Una por proveedor — dos, tres o cuatro.
      Si el PDF viene escaneado, lo leo con OCR.</p>`;

  if(prvArchivos.length){
    h += `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px">
      ${prvArchivos.map((f,i)=>`<span style="display:inline-flex;align-items:center;gap:8px;
        background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 8px 6px 12px;
        font-size:13px;font-weight:600">📄 ${esc(f.name.replace(/\.pdf$/i,'').slice(0,34))}
        <button class="rowbtn" data-prvquitaarch="${i}" style="min-width:24px;height:24px">✕</button>
      </span>`).join('')}
    </div>`;
  }

  h += `<div class="frm-row" style="justify-content:center">
      <button class="btn-quiet" id="prvSubir">Elegir archivos (PDF)</button>
      <button class="btn-quiet" id="prvAddProv">+ Capturar a mano</button>
    </div>
    <p class="hint" style="margin:10px 0 0;font-size:10.5px">Lector de tablas <b>v7</b> —
      si aquí no dice v7, recarga la página.</p>
  </div>`;

  if(prvArchivos.length){
    h += `<button class="btn-primary" id="prvProcesa" style="width:100%;margin-bottom:16px">
      ${prvLeyendo ? 'Leyendo…' : `Procesar y comparar (${prvArchivos.length} cotizacion${prvArchivos.length===1?'':'es'})`}</button>`;
  }

  /* ---- la hoja de resultado ----
     Una fila por producto y una columna por proveedor: es como se lee una
     comparación de precios en la vida real. El más barato en verde, el más
     caro en gris, y hasta la derecha cuánto se ahorra. */
  h += `<div class="panel">
    <div class="d-h3">Resultado</div>`;
  if(!C.filas.length){
    h += `<p class="hint">Todavía no hay nada que comparar. Suelta arriba las cotizaciones
      en PDF y dale a <b>Procesar y comparar</b>.</p>`;
  } else {
    const provs = C.provs;
    const conVarios = C.filas.filter(f=>!f.solo);
    /* El promedio se saca SOLO de los renglones creíbles. Un renglón con la
       presentación mal leída marca 80% de "ahorro" y solo, él, levantaba el
       promedio de toda la hoja: el resumen de arriba quedaba más falso que
       el renglón que lo causó. */
    const dudosos = conVarios.filter(f=>f.sospecha);
    const buenos  = conVarios.filter(f=>!f.sospecha);
    const ahorroTot = buenos.reduce((s,f)=>s+f.ahorroPct,0);
    /* La respuesta antes que la tabla. A esta pantalla se llega con una
       pregunta —«¿a quién le compro?»— y estaba contestada nada más renglón
       por renglón, que obliga a sumar de cabeza 25 números. */
    const G = prvQuienGana(C);
    if(G && G.canasta){
      h += `<div style="margin:0 0 14px;padding:14px 16px;border-radius:12px;background:#EAF6EE;border-left:5px solid var(--ok)">
        <div style="font-size:15px;font-weight:900;color:var(--ok)">${esc(G.mejor)} sale más barato</div>
        <div style="margin-top:4px;font-size:13.5px">
          Sobre los <b>${G.canasta} productos que ${esc(G.mejor)} y ${esc(G.peor)} cotizan los dos</b>, la misma canasta cuesta
          <b>${money(G.total[G.mejor])}</b> con ${esc(G.mejor)} contra
          <b>${money(G.total[G.peor])}</b> con ${esc(G.peor)} —
          <b>${G.pct}% menos</b> (precio por unidad, sin IVA).</div>
        <div class="hint" style="margin-top:6px">Renglones que gana cada quien en todo el comparativo:
          ${G.provs.map(n=>`<b>${esc(n)}</b> ${G.gana[n]}`).join(' · ')}.</div>
        ${G.excepciones.length?`<div class="hint" style="margin-top:6px">
          Aun así, conviene pedirle a otro: ${G.excepciones.slice(0,6)
            .map(f=>`<b>${esc(f.nombre.slice(0,34))}</b> (${esc(f.mejor.prov)})`).join(' · ')}${
            G.excepciones.length>6?` y ${G.excepciones.length-6} más`:''}.</div>`:''}
      </div>`;
    }
    if(C.juntados.length){
      h += `<p class="hint" style="margin:0 0 10px">📎 ${C.juntados.map(p=>
        `<b>${esc(p.proveedor)}</b> con ${p._facturas} cotizaciones`).join(' · ')}
        — se juntaron en una sola columna, porque es un proveedor, no varios.</p>`;
    }
    if(C.ambiguos?.length){
      h += `<div style="margin:0 0 10px;padding:12px 14px;border-radius:10px;background:#FFF3D6;border-left:4px solid var(--warn)">
        <b>${C.ambiguos.length} renglón${C.ambiguos.length===1?'':'es'} donde la factura no dice si la cantidad son piezas o kilos</b>
        <div class="hint" style="margin-top:4px">La unidad dice pieza y la cantidad es igual al peso del empaque,
          así que las dos lecturas cuadran con el importe. Corrige la presentación abajo, en
          <b>Revisar y corregir</b>, si el precio que quedó no es el que pagas.</div>
        ${C.ambiguos.map(r=>`<div class="hint" style="margin-top:6px">
          <b>${esc(String(r.producto).slice(0,46))}</b> (${esc(r.prov)}) — ${money(r.precio)} × ${r.cant}:
          si son ${r.cant} ${esc(r.ambiguo.unidad)} → <b>${money(r.ambiguo.siEsUnidad)}/${esc(r.ambiguo.unidad)}</b>;
          si son ${r.cant} empaques de ${r.ambiguo.tam} ${esc(r.ambiguo.unidad)} → <b>${money(r.ambiguo.siEsEnvase)}/${esc(r.ambiguo.unidad)}</b>.
          Hoy está tomando <b>${esc(r.presentacion||'—')}</b>.</div>`).join('')}
      </div>`;
    }
    if(C.choques.length){
      h += `<div style="margin:0 0 10px;padding:10px 12px;border-radius:10px;background:#FFF3D6;border-left:4px solid var(--warn)">
        <b>${C.choques.length} producto${C.choques.length===1?'':'s'} con dos precios del mismo proveedor</b>
        <div class="hint" style="margin-top:4px">Se tomó el de la cotización más nueva.
        ${C.choques.slice(0,6).map(x=>`${esc(x.prov)} · ${esc(String(x.producto).slice(0,34))}: ${money(x.antes)} → ${money(x.ahora)}`).join(' · ')}</div></div>`;
    }
    h += `<p class="hint" style="margin:0 0 10px">Todo <b>sin IVA</b> y en la misma unidad —
      por litro, por kilo o por pieza. Las libras se convierten a kilos y las cajas a lo que
      traen adentro.</p>
    <p class="hint" style="margin:0 0 10px">
      <b>${conVarios.length}</b> producto${conVarios.length===1?'':'s'} con más de un proveedor ·
      <b>${C.filas.length-conVarios.length}</b> con uno solo
      ${buenos.length?` · ahorro promedio del mejor contra el más caro: <b>${(ahorroTot/buenos.length).toFixed(1)}%</b>`:''}</p>
    ${dudosos.length?`<div style="margin:0 0 10px;padding:10px 12px;border-radius:10px;background:#FFF3D6;border-left:4px solid var(--warn)">
      <b>${dudosos.length} renglón${dudosos.length===1?'':'es'} con una diferencia que no se sostiene</b>
      <div class="hint" style="margin-top:4px">Van hasta arriba, marcados. Una diferencia de tres veces
      o más entre dos proveedores del mismo producto casi siempre es una presentación mal leída, no un
      precio. No están contados en el ahorro promedio.</div></div>`:''}`;

    h += `<div class="res-wrap"><table class="res inv-tbl" style="font-size:12.5px"><thead><tr>
      <th style="text-align:left;min-width:170px">Producto</th>
      <th style="width:52px">Unidad</th>
      ${provs.map(p=>`<th style="min-width:96px">${esc(p.slice(0,22))}</th>`).join('')}
      <th style="width:88px">Diferencia</th></tr></thead><tbody>`;

    for(const f of C.filas){
      /* El precio de cada proveedor para ESTE producto, en su columna. El que
         no lo cotizó deja el hueco: un hueco dice algo —no lo maneja— y
         rellenarlo con el precio de otro sería mentir. */
      const porProv = provs.map(nom => f.ofertas.find(o=>o.prov===nom) || null);
      h += `<tr>
        <td style="text-align:left;font-weight:700">${esc(f.nombre)}</td>
        <td class="hint" style="font-weight:700">/${f.unidad}</td>
        ${porProv.map(o=>{
          if(!o) return `<td class="hint">—</td>`;
          const esMejor = !f.solo && o.precio_base === f.mejor.precio_base;
          const esPeor  = !f.solo && o.precio_base === f.peor.precio_base;
          return `<td style="font-variant-numeric:tabular-nums;${
            esMejor ? 'color:var(--ok);font-weight:900'
            : esPeor ? 'color:var(--ink-2)' : 'font-weight:600'}">${money(o.precio_base)}</td>`;
        }).join('')}
        <td style="font-weight:900;${f.solo?'':(f.sospecha?'color:var(--warn)':'color:var(--ok)')}">${
          f.solo ? '<span class="hint" style="font-weight:600">solo uno</span>'
                 : (f.sospecha ? `⚠️ ${f.ahorroPct}%` : f.ahorroPct + '%')}</td></tr>`;
      if(f.sospecha){
        const s = f.sospecha;
        h += `<tr><td colspan="${provs.length+3}" style="text-align:left;background:#FFF3D6;
          border-left:4px solid var(--warn);font-size:12px;padding:7px 10px">
          <b>Revisa la presentación, no el precio.</b>
          ${esc(f.peor.prov)} sale <b>${s.razon}× más caro</b> que ${esc(f.mejor.prov)} por
          ${esc(f.unidad)}. Dos proveedores del mismo producto no se llevan por tanto: lo más
          probable es que una de las dos presentaciones esté mal leída.
          ${s.culpa ? `La diferencia es casi exactamente <b>×${s.culpa.factor}</b>, y ese número
            aparece en «${esc(String(s.culpa.oferta.presentacion||s.culpa.oferta.producto||'').slice(0,60))}»
            — revisa si ahí se está contando el empaque completo o solo una pieza.` : ''}
          <br>${f.ofertas.map(o=>`${esc(o.prov)}: ${money(o.precio_sin||0)} ÷ ${
            o.base} ${esc(o.unidad_base||'')} = <b>${money(o.precio_base)}</b>`).join(' &nbsp;·&nbsp; ')}
        </td></tr>`;
      }
    }
    h += `</tbody></table></div>`;

    if(conVarios.length){
      h += `<p class="hint" style="margin:10px 0 0">En <b>verde</b> el más barato de cada renglón.
        La última columna es cuánto más caro está el peor contra el mejor.</p>`;
    }

    if(C.sinBase.length){
      h += `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#FFF3D6;border-left:4px solid var(--warn)">
        <b>${C.sinBase.length} renglón${C.sinBase.length===1?'':'es'} sin presentación</b>
        <div class="hint" style="margin-top:4px">No entran porque sin saber cuántos litros o kilos
        trae el envase, su precio no se puede comparar con nada. Ábrelos abajo en
        <b>Revisar lo que leí</b> y ponles la presentación (ej. <b>5 L</b>, <b>20 kg</b>): entran solos.</div></div>`;
    }
  }
  h += `</div>`;

  /* ---- revisar y corregir, doblado ----
     El lector se equivoca con algunas facturas y eso no se va a acabar: cada
     proveedor imprime distinto. Lo que sí se puede es que el error se vea y
     se corrija en dos clics, sin que los campos estorben el resto del tiempo. */
  if(nProv){
    h += `<button class="btn-quiet" id="prvVerDetalle" style="width:100%;margin-bottom:12px">
      ${prvDetalle ? '▾' : '▸'} Revisar lo que leí — ${nProv} cotización${nProv===1?'':'es'},
      ${nRen} renglón${nRen===1?'':'es'}</button>`;
  }

  if(prvDetalle) (c.proveedores||[]).forEach((p, ip)=>{
    h += `<div class="panel" style="border-left:4px solid var(--navy)">
      <div class="frm-row" style="margin-bottom:8px">
        <label style="flex:1">Proveedor <input type="text" data-prvp="${ip}" data-prvf="proveedor"
          value="${esc(p.proveedor||'')}" placeholder="Nombre del proveedor"></label>
        <label style="width:180px">Sus precios vienen
          <select data-prvp="${ip}" data-prvf="iva" style="min-height:44px">
            <option value="sin" ${(p.iva||'sin')==='sin'?'selected':''}>Sin IVA</option>
            <option value="con" ${p.iva==='con'?'selected':''}>Con IVA incluido</option>
          </select>
          ${p.iva_por?`<span class="hint" style="font-size:10.5px;font-weight:600">${esc(p.iva_por)}</span>`:''}</label>
        <button class="btn-quiet" data-prvquita="${ip}" style="align-self:end;color:var(--red)">Quitar</button>
      </div>
      <div class="frm-row" style="margin-bottom:8px">
        <button class="btn-quiet" data-prvfila="${ip}">+ Renglón a mano</button>
        ${(p.renglones||[]).length ? `<button class="btn-quiet" data-prvlimpia="${ip}"
          style="color:var(--red)">Borrar sus ${p.renglones.length} renglones</button>` : ''}
      </div>`;

    if(!(p.renglones||[]).length){
      h += `<p class="hint">Sin renglones. Suelta su PDF arriba o captúralos a mano.</p>`;
    } else {
      h += `<div class="res-wrap"><table class="res" style="font-size:12.5px"><thead><tr>
        <th style="text-align:left;min-width:140px">Producto (como lo escribe él)</th>
        <th style="text-align:left;min-width:120px">Es el mismo que…<br>
          <span style="font-weight:600;font-size:10px">para que se comparen entre sí</span></th>
        <th style="width:100px">Presentación</th>
        <th style="width:52px">Cant.</th>
        <th style="width:86px">Precio</th>
        <th style="width:112px">Por unidad<br><span style="font-weight:600;font-size:10px">sin IVA</span></th>
        <th style="width:40px"></th></tr></thead><tbody>`;
      (p.renglones||[]).forEach((r0, ir)=>{
        const r = prvCalc(r0, p);
        const malo = r.precio_base === null;
        const dudoso = r0.seguro === false;
        h += `<tr${malo?' style="background:#FFF6E5"':''}>
          <td style="text-align:left">
            <input type="text" data-prvr="${ip}.${ir}" data-prvrf="producto"
              value="${esc(r0.producto||'')}" style="width:100%;min-height:36px">
            ${dudoso?`<div class="hint" style="font-size:10px;font-weight:700;color:var(--warn)">
              revisar contra el papel — no cuadró cantidad × precio</div>`:''}</td>
          <td style="text-align:left"><input type="text" list="prvEquivs" data-prvr="${ip}.${ir}" data-prvrf="equiv"
            value="${esc(r0.equiv||'')}" placeholder="(mismo nombre)" style="width:100%;min-height:36px"></td>
          <td><input type="text" data-prvr="${ip}.${ir}" data-prvrf="presentacion"
            value="${esc(r0.presentacion||'')}" placeholder="5 L · 20 kg · 12 pz"
            style="width:96px;min-height:36px"></td>
          <td><input type="text" inputmode="decimal" class="nospin" data-prvr="${ip}.${ir}" data-prvrf="cant"
            value="${esc(String(r0.cant??1))}" style="width:46px;min-height:36px;text-align:right"></td>
          <td><input type="text" inputmode="decimal" class="nospin" data-prvr="${ip}.${ir}" data-prvrf="precio"
            value="${esc(String(r0.precio||''))}" style="width:84px;min-height:36px;text-align:right"></td>
          <td style="font-variant-numeric:tabular-nums;${malo?'color:var(--warn);font-weight:700':'font-weight:700'}">
            ${malo ? 'falta present.' : money(r.precio_base)+' /'+r.unidad_base +
              (r.detalle?`<div class="hint" style="font-size:10px;font-weight:600">entendí ${esc(r.detalle)}</div>`:'')}</td>
          <td><button class="rowbtn" data-prvdel="${ip}.${ir}">✕</button></td></tr>`;
      });
      h += `</tbody></table></div>`;
    }
    h += `</div>`;
  });

  h += `<button class="btn-primary" id="prvGuardar" style="width:100%">
    ${c.id?'Actualizar comparativo':'Guardar comparativo'}</button>
  <button class="btn-quiet" id="prvPdf" style="width:100%;margin-top:8px">📄 Hoja de resultado en PDF</button>
  ${c.id?`<button class="btn-quiet" id="prvBorrar" style="width:100%;margin-top:8px;color:var(--red)">Borrar</button>`:''}`;
  return h;
}

function prvView(){ return prvEdit ? prvEditorView() : prvListaView(); }

/* ---------- el PDF de resultado ---------- */
async function prvPDF(){
  await loadPDF();
  const JS = (window.jspdf||{}).jsPDF;
  if(!JS){ toast('No se pudo cargar el generador de PDF'); return; }
  const c = prvEdit, C = prvComparar(c);
  const n4 = v => Number(v||0).toLocaleString('es-MX',{minimumFractionDigits:2, maximumFractionDigits:2});
  const TINTA=[29,27,22], SUAVE=[110,103,92], LINEA=[221,215,201], NAVY=[27,46,77], VERDE=[11,110,63];

  const doc = new JS({unit:'pt', format:'letter', orientation:'landscape'});
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 36; let y = 0;

  doc.setFillColor(...NAVY); doc.rect(0,0,W,54,'F');
  doc.setTextColor(255,255,255).setFont('helvetica','bold').setFontSize(14);
  doc.text("BOYE'S BURGER & PIZZA", M, 23);
  doc.setFont('helvetica','normal').setFontSize(9.5);
  doc.text(`Comparativo de proveedores · ${c.nombre||'sin nombre'}`, M, 38);
  doc.setFontSize(8).setTextColor(205,216,232);
  doc.text(new Date(c.fecha+'T12:00:00').toLocaleDateString('es-MX',{dateStyle:'long'}), W-M, 38, {align:'right'});
  y = 74;

  doc.setFont('helvetica','normal').setFontSize(8).setTextColor(...SUAVE);
  for(const l of doc.splitTextToSize(
      'Todos los precios SIN IVA y llevados a la misma unidad —litro, kilo o pieza—, para que sean ' +
      'comparables aunque cada proveedor cotice en su propia presentacion. Las libras se convierten a ' +
      'kilos y las cajas a lo que traen adentro.', W-2*M)){ doc.text(l, M, y); y += 10; }
  y += 8;

  const cols = [
    {t:'Producto', w:190, a:'left'},
    {t:'Mejor proveedor', w:135, a:'left'},
    {t:'Precio/unidad', w:88, a:'right'},
    {t:'Más caro', w:135, a:'left'},
    {t:'Precio/unidad', w:88, a:'right'},
    {t:'Ahorro', w:0, a:'right'}
  ];
  cols[5].w = (W-2*M) - cols.slice(0,5).reduce((s,x)=>s+x.w,0);

  /* ANTES: cada celda se dibujaba de un jalón con doc.text, y jsPDF no
     recorta — el nombre del producto se seguía de largo y se encimaba
     encima del proveedor. La hoja salía ilegible justo en la columna que
     más se lee. Ahora cada celda se parte al ancho de SU columna y el
     renglón crece lo que haga falta. */
  const fila = (cel, opt)=>{
    opt = opt||{};
    const tam = opt.cab ? 8 : 9;
    doc.setFont('helvetica', opt.cab?'bold':(opt.fuerte?'bold':'normal')).setFontSize(tam);
    const partido = cel.map((t,i)=>doc.splitTextToSize(String(t), cols[i].w - 7));
    const lineas = Math.max(1, ...partido.map(p=>p.length));
    const alto = opt.cab ? 16 : Math.max(16, lineas*11 + 5);
    if(y + alto > H-40){ doc.addPage(); y = 46;
      doc.setFont('helvetica', opt.cab?'bold':(opt.fuerte?'bold':'normal')).setFontSize(tam); }
    if(opt.cab){ doc.setFillColor(...NAVY); doc.rect(M,y-9,W-2*M,16,'F'); }
    let x = M;
    partido.forEach((lineasCel,i)=>{
      doc.setTextColor(...(opt.cab?[255,255,255]:(opt.verde&&(i===1||i===2||i===5)?VERDE:TINTA)));
      lineasCel.forEach((l,k)=>doc.text(l, cols[i].a==='right'? x+cols[i].w-4 : x+3, y+1+k*11,
                                        {align:cols[i].a}));
      x += cols[i].w;
    });
    y += alto;
    if(!opt.cab){ doc.setDrawColor(...LINEA).setLineWidth(.4); doc.line(M,y-9,W-M,y-9); }
  };

  /* La respuesta, antes de la tabla. */
  const G = prvQuienGana(C);
  if(G && G.canasta){
    /* El ancho útil es el del cuadro, no el de la hoja: sin partir el texto
       aquí, la línea se salía por la derecha y la frase quedaba cortada a
       media palabra — justo la frase que contesta la pregunta. */
    const anchoTxt = (W-2*M) - 20;
    doc.setFont('helvetica','normal').setFontSize(9);
    const l1 = doc.splitTextToSize(
      `Sobre los ${G.canasta} productos que ${G.mejor} y ${G.peor} cotizan los dos, la misma canasta cuesta ` +
      `$${n4(G.total[G.mejor])} con ${G.mejor} contra $${n4(G.total[G.peor])} con ${G.peor} — ` +
      `${G.pct}% menos (precio por unidad, sin IVA).`, anchoTxt);
    doc.setFontSize(8);
    const l2 = doc.splitTextToSize(
      `Renglones que gana cada quien: ${G.provs.map(n=>`${n} ${G.gana[n]}`).join('   ·   ')}.` +
      (G.excepciones.length ? `   Aun asi conviene pedirle a otro: ${G.excepciones.slice(0,4)
        .map(f=>`${f.nombre.slice(0,26)} (${f.mejor.prov})`).join(', ')}.` : ''), anchoTxt);
    const alto = 20 + l1.length*12 + l2.length*10 + 8;
    doc.setFillColor(234,246,238); doc.rect(M, y-10, W-2*M, alto, 'F');
    doc.setDrawColor(...VERDE).setLineWidth(3); doc.line(M, y-10, M, y-10+alto);
    doc.setFont('helvetica','bold').setFontSize(12).setTextColor(...VERDE);
    doc.text(`${G.mejor} sale mas barato`, M+10, y+3);
    let yy = y + 17;
    doc.setFont('helvetica','normal').setFontSize(9).setTextColor(...TINTA);
    l1.forEach(l=>{ doc.text(l, M+10, yy); yy += 12; });
    doc.setFontSize(8).setTextColor(...SUAVE);
    l2.forEach(l=>{ doc.text(l, M+10, yy); yy += 10; });
    y += alto + 12;
  }
  if(C.juntados.length){
    doc.setFont('helvetica','normal').setFontSize(8).setTextColor(...SUAVE);
    doc.text(`${C.juntados.map(p=>`${p.proveedor}: ${p._facturas} cotizaciones juntadas en una`).join('   ·   ')}`, M, y);
    y += 14;
  }

  fila(cols.map(x=>x.t), {cab:true});
  for(const f of C.filas){
    if(f.solo){
      fila([f.nombre, f.mejor.prov, '$'+n4(f.mejor.precio_base)+' /'+f.unidad,
            'un solo proveedor', '—', '—']);
    } else if(f.sospecha){
      /* En el PDF tampoco puede salir en verde: este papel se lleva a la
         junta de compras y ahí el verde se lee como «cámbiate a este». */
      fila([f.nombre, f.mejor.prov, '$'+n4(f.mejor.precio_base)+' /'+f.unidad,
            f.peor.prov, '$'+n4(f.peor.precio_base)+' /'+f.unidad,
            `revisar (${f.sospecha.razon}x)`], {fuerte:true});
    } else {
      fila([f.nombre, f.mejor.prov, '$'+n4(f.mejor.precio_base)+' /'+f.unidad,
            f.peor.prov, '$'+n4(f.peor.precio_base)+' /'+f.unidad, f.ahorroPct+'%'],
           {verde:true, fuerte:true});
    }
  }

  y += 10;
  if(y > H-60){ doc.addPage(); y = 46; }
  doc.setFont('helvetica','normal').setFontSize(8).setTextColor(...SUAVE);
  const provs = (c.proveedores||[]).map(p=>`${p.proveedor||'sin nombre'}${p.fecha?` (cot. ${p.fecha})`:''}`).join(' · ');
  for(const l of doc.splitTextToSize('Cotizaciones comparadas: ' + (provs||'—'), W-2*M)){ doc.text(l, M, y); y += 10; }
  if(C.sinBase.length){
    doc.setTextColor(...[192,38,31]);
    doc.text(`${C.sinBase.length} renglón(es) quedaron fuera por no traer presentación reconocible.`, M, y+4);
  }

  const paginas = doc.internal.getNumberOfPages();
  for(let p=1;p<=paginas;p++){
    doc.setPage(p);
    doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(...SUAVE);
    doc.text("Boye's Ops · comparativo de proveedores", M, H-16);
    doc.text(`${p} de ${paginas}`, W-M, H-16, {align:'right'});
  }
  doc.save(`Comparativo ${(c.nombre||'proveedores').replace(/[^\w\s-]/g,'').trim()} ${c.fecha}.pdf`);
}

/* ---------- cableado ---------- */
function wirePrv(){
  $('#prvNuevo')?.addEventListener('click', ()=>{ prvEdit = prvNuevo(); prvArchivos=[]; prvDetalle=false; render(); });
  $('#prvVolver')?.addEventListener('click', ()=>{ prvEdit = null; prvArchivos=[]; prvDetalle=false; render(); });

  $('#main').querySelectorAll('[data-prvabre]').forEach(b=>b.addEventListener('click', async ()=>{
    try{
      const d = await finRpc('prov_get', {p_id:b.dataset.prvabre});
      prvArchivos=[]; prvDetalle=false;
      prvEdit = { id:d.id, nombre:d.nombre||'', fecha:String(d.fecha).slice(0,10),
                  notas:d.notas||'', proveedores:d.proveedores||[] };
      render();
    }catch(e){ toast('No se pudo abrir'); }
  }));

  const liga = (id, campo) => $('#'+id)?.addEventListener('change', e=>{
    if(prvEdit) prvEdit[campo] = e.target.value;
  });
  liga('prvNombre','nombre'); liga('prvFecha','fecha');

  $('#prvAddProv')?.addEventListener('click', ()=>{
    if(!prvEdit) return;
    prvEdit.proveedores.push({ proveedor:'', fecha:prvHoy(), iva:'sin', iva_pct:16,
                               renglones:[], crudo:'' });
    render();
  });

  $('#main').querySelectorAll('[data-prvquita]').forEach(b=>b.addEventListener('click', ()=>{
    const ip = Number(b.dataset.prvquita);
    const p = prvEdit.proveedores[ip];
    if((p.renglones||[]).length && !confirm(`¿Quitar a ${p.proveedor||'ese proveedor'} y sus ${p.renglones.length} renglones?`)) return;
    prvEdit.proveedores.splice(ip,1); render();
  }));

  $('#main').querySelectorAll('[data-prvp]').forEach(inp=>inp.addEventListener('change', ()=>{
    const p = prvEdit.proveedores[Number(inp.dataset.prvp)]; if(!p) return;
    p[inp.dataset.prvf] = inp.value;
    render();   // cambiar el IVA mueve todos los precios por unidad de ese proveedor
  }));

  $('#main').querySelectorAll('[data-prvfila]').forEach(b=>b.addEventListener('click', ()=>{
    const p = prvEdit.proveedores[Number(b.dataset.prvfila)]; if(!p) return;
    (p.renglones = p.renglones||[]).push({producto:'', presentacion:'', precio:'', cant:1});
    render();
  }));

  $('#main').querySelectorAll('[data-prvr]').forEach(inp=>inp.addEventListener('change', ()=>{
    const [ip,ir] = inp.dataset.prvr.split('.').map(Number);
    const r = prvEdit.proveedores[ip]?.renglones?.[ir]; if(!r) return;
    const f = inp.dataset.prvrf;
    r[f] = (f==='precio' || f==='cant') ? numMX(inp.value) : inp.value;
    /* Corregido a mano, el aviso de «revisar» ya no aplica: lo puso la
       máquina porque su cuenta no cuadró, y quien acaba de teclear el número
       vio el papel. */
    if(f==='precio' || f==='cant' || f==='producto') r.seguro = true;
    render();
  }));

  /* Aplicar las parejas propuestas: se escribe el mismo nombre en la columna
     «es el mismo que…» de todos los renglones del grupo, que es lo que hace
     que la comparación los junte. Queda escrito y editable, no escondido. */
  $('#prvAplicaSug')?.addEventListener('click', ()=>{
    if(!prvSug) return;
    const marcados = [...document.querySelectorAll('.prvsug')]
      .filter(x=>x.checked).map(x=>Number(x.dataset.sug));
    let n = 0;
    for(const ig of marcados){
      const g = prvSug[ig]; if(!g) continue;
      for(const it of g.items){
        const r = prvEdit.proveedores[it.ip]?.renglones?.[it.ir];
        if(r && !(r.equiv||'').trim()){ r.equiv = g.nombre; n++; }
      }
    }
    toast(n ? `${n} renglones emparejados` : 'No había nada nuevo que emparejar');
    render();
  });

  /* Los comparativos guardados antes traen los renglones que leyó la versión
     vieja —el domicilio, el RFC, los teléfonos—. Esos ya están en la base y no
     se arreglan solos: hay que vaciarlos y volver a leer el PDF. */
  $('#main').querySelectorAll('[data-prvlimpia]').forEach(b=>b.addEventListener('click', ()=>{
    const p = prvEdit.proveedores[Number(b.dataset.prvlimpia)]; if(!p) return;
    if(!confirm(`¿Borro los ${(p.renglones||[]).length} renglones de ${p.proveedor||'este proveedor'}?\n\n`
      + `Después vuelve a subir su PDF y se leen de nuevo.`)) return;
    p.renglones = []; render();
  }));

  $('#main').querySelectorAll('[data-prvdel]').forEach(b=>b.addEventListener('click', ()=>{
    const [ip,ir] = b.dataset.prvdel.split('.').map(Number);
    prvEdit.proveedores[ip]?.renglones?.splice(ir,1); render();
  }));

  /* ---- leer el PDF del proveedor ----
     Vive fuera de los botones porque hay dos caminos para llegar aquí: el
     botón de un proveedor que ya existe, y el de «subir una cotización»,
     que crea el proveedor y abre el archivo de un tirón. Antes solo existía
     el primero, y en un comparativo vacío no había ningún proveedor todavía:
     el botón de subir el PDF no estaba en ninguna parte. */
  /* Lee UN archivo hacia el proveedor `ip`. */
  const prvLee = async (f, ip, b, etiqueta) => {
      const etq = b ? (etiqueta || b.textContent) : '';
      if(b){ b.disabled = true; b.textContent = 'Leyendo…'; }
      try{
        let texto = '', paginas = null;
        if(/\.pdf$/i.test(f.name)){
          try{
            paginas = await prvExtraeCeldas(f);
            texto = paginas.map(pg => prvFilas(pg).map(x=>x.texto).join('\n')).join('\n');
          }catch(e){ paginas = null; texto = ''; }
          /* Muchas cotizaciones llegan escaneadas o impresas a PDF desde
             Windows: se ven perfectas y no traen una sola letra que un
             programa pueda leer. Ahí entra el OCR — pero el OCR devuelve
             texto plano, sin columnas, y por eso hay dos lectores. */
          if(texto.trim().length < 30){
            if(b) b.textContent = 'Es una imagen — OCR…';
            texto = (await ocrPDF(f)) || '';
            paginas = null;
          }
        } else texto = await f.text();

        if(!texto.trim()){ toast('No le pude sacar texto a ese archivo'); return; }
        const p = prvEdit.proveedores[ip]; if(!p) return;
        const filas = prvParse(texto, paginas);
        p.crudo = texto.slice(0, 20000);
        /* Volver a leer el mismo PDF REEMPLAZA lo que había, no se le suma.
           Antes se concatenaba, y al releer una cotización mal leída quedaban
           los renglones malos abajo de los buenos: la lista crecía y el error
           seguía ahí. Si alguien capturó algo a mano, se le avisa antes. */
        p.renglones = filas;

        /* El IVA no se pregunta: se comprueba. Si la suma de los importes da
           el subtotal del documento, sus precios son sin IVA; si da el total,
           vienen con IVA. Es la diferencia del 16% que decide quién sale más
           barato, así que adivinarla no es opción. */
        const iva = prvDetectaIva(texto, filas);
        p.iva = iva.iva; p.iva_por = iva.por;

        if(!p.proveedor) p.proveedor = prvProveedor(paginas, texto, f.name);

        const revisar = filas.filter(r=>!r.seguro).length;
        toast(filas.length
          ? `${filas.length} renglones · ${p.proveedor} · precios ${iva.iva} IVA` +
            (revisar ? ` · ${revisar} por revisar` : '')
          : `${f.name}: no encontré la tabla de productos`);
      }catch(e){ toast('No se pudo leer: '+(e.message||'')); }
      finally{ if(b){ b.disabled=false; b.textContent=etq; } }
  };

  /* ---- adjuntar ahora, procesar después ----
     Soltar el archivo y leerlo en el mismo gesto obligaba a soltarlos de uno
     en uno para poder ver qué pasó con cada uno. Ahora se acumulan como
     etiquetas y un solo botón los procesa todos: es como llega el trabajo —
     tres cotizaciones el mismo día— y así se compara lo que se adjuntó, no
     lo que quedó de la vez pasada. */
  const prvAgrega = (archivos)=>{
    const lista = [...(archivos||[])].filter(f=>/\.(pdf|txt|csv)$/i.test(f.name));
    if(!lista.length){ toast('Solo puedo leer PDF, TXT o CSV'); return; }
    for(const f of lista)
      if(!prvArchivos.some(x=>x.name===f.name && x.size===f.size)) prvArchivos.push(f);
    render();
  };

  /* Procesar: se rehacen los proveedores que salieron de un PDF y se
     conservan los capturados a mano. Volver a darle al botón no duplica. */
  const prvProcesa = async (b)=>{
    if(prvLeyendo || !prvEdit || !prvArchivos.length) return;
    prvLeyendo = true; render();
    const btn = $('#prvProcesa');
    try{
      prvEdit.proveedores = (prvEdit.proveedores||[]).filter(p => p.origen !== 'pdf');
      for(let i=0;i<prvArchivos.length;i++){
        if(btn) btn.textContent = `Leyendo ${i+1} de ${prvArchivos.length}: ${prvArchivos[i].name.slice(0,28)}…`;
        prvEdit.proveedores.push({ proveedor:'', fecha:prvHoy(), iva:'sin', iva_pct:16,
                                   renglones:[], crudo:'', origen:'pdf',
                                   archivo: prvArchivos[i].name });
        await prvLee(prvArchivos[i], prvEdit.proveedores.length - 1, null);
      }

      /* Y se emparejan solos. Lo que la máquina juntó queda escrito en la
         columna «es el mismo que…», a la vista y editable en el detalle: si
         se equivocó, se corrige ahí en vez de quedar escondido. */
      let juntados = 0;
      if(prvEdit.proveedores.length >= 2){
        for(const g of prvEmpareja(prvEdit)){
          for(const it of g.items){
            const r = prvEdit.proveedores[it.ip]?.renglones?.[it.ir];
            if(r && !(r.equiv||'').trim()){ r.equiv = g.nombre; juntados++; }
          }
        }
      }
      const tot = prvEdit.proveedores.reduce((t,p)=>t+(p.renglones||[]).length,0);
      toast(`${tot} renglones de ${prvEdit.proveedores.length} cotizaciones` +
            (juntados ? ` · emparejé ${juntados}` : ''));
    } finally { prvLeyendo = false; render(); }
  };

  const prvPide = ()=>{
    if(prvLeyendo) return;
    const inp = document.createElement('input');
    inp.type='file'; inp.accept='.pdf,.txt,.csv'; inp.multiple = true;
    inp.onchange = ()=>{ if(inp.files?.length) prvAgrega(inp.files); };
    inp.click();
  };

  $('#prvSubir')?.addEventListener('click', prvPide);
  $('#prvProcesa')?.addEventListener('click', ()=> prvProcesa());
  $('#prvVerDetalle')?.addEventListener('click', ()=>{ prvDetalle = !prvDetalle; render(); });
  $('#main').querySelectorAll('[data-prvquitaarch]').forEach(b=>b.addEventListener('click', ()=>{
    prvArchivos.splice(Number(b.dataset.prvquitaarch), 1); render();
  }));

  /* Arrastrar y soltar sobre la zona. */
  const zona = $('#prvZona');
  if(zona && !zona._prvDrop){
    zona._prvDrop = true;
    const pinta = (on)=>{ zona.style.borderColor = on ? 'var(--gold)' : '#C9C1B2';
                          zona.style.background = on ? '#FFF6E2' : '#FBFAF7'; };
    zona.addEventListener('dragover', e=>{ e.preventDefault(); pinta(true); });
    zona.addEventListener('dragleave', ()=> pinta(false));
    zona.addEventListener('drop', e=>{ e.preventDefault(); pinta(false);
                                       prvAgrega(e.dataTransfer?.files); });
  }

  $('#prvGuardar')?.addEventListener('click', async ev=>{
    if(!prvEdit) return;
    if(!prvEdit.nombre.trim()){ toast('Ponle nombre al comparativo'); $('#prvNombre')?.focus(); return; }
    const b = ev.currentTarget, etq = b.textContent;
    b.disabled=true; b.textContent='Guardando…';
    try{
      const d = await finRpc('prov_save', { p_id: prvEdit.id, p: {
        nombre: prvEdit.nombre, fecha: prvEdit.fecha, notas: prvEdit.notas,
        proveedores: prvEdit.proveedores } });
      prvEdit.id = d.id; prvLista = null; prvRefresca();
      toast('Comparativo guardado ✓');
    }catch(e){ toast('No se pudo guardar: '+(e.message||'')); }
    finally{ b.disabled=false; b.textContent=etq; }
  });

  $('#prvPdf')?.addEventListener('click', async ev=>{
    const b = ev.currentTarget, etq = b.textContent;
    b.disabled=true; b.textContent='Armando…';
    try{ await prvPDF(); }catch(e){ toast('No se pudo generar el PDF'); }
    finally{ b.disabled=false; b.textContent=etq; }
  });

  $('#prvBorrar')?.addEventListener('click', async ()=>{
    if(!prvEdit?.id) return;
    if(!confirm(`¿Borrar el comparativo "${prvEdit.nombre}"?`)) return;
    try{ await finRpc('prov_del',{p_id:prvEdit.id}); prvEdit=null; prvLista=null; prvRefresca(); }
    catch(e){ toast('No se pudo borrar'); }
  });
}
