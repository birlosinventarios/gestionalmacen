/**
 * Lectores de datos
 */


function getSheet_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(sheetName);

  if (!hoja) {
    throw new Error(`No se encontró la hoja: ${sheetName}`);
  }

  return hoja;
}

function getRows_(sheetName) {
  const values = getSheet_(sheetName).getDataRange().getValues();

  if (values.length < 2) return [];

  return values.slice(1); // sin encabezado
}

/**
 * Formateadores de datos
 */
function toStr_(value) {
  return String(value || "").trim();
}

function toStrUpper_(value) {
  return String(value || "").trim().toUpperCase();
}

function toNum_(value) {
  return Number(value || 0);
}

function isValidDate_(value) {
  return value instanceof Date && !isNaN(value.getTime());
}


function toDate_(value) {
  if (value === null || value === undefined || value === "") return null;

  // Si ya viene como Date
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = toStr_(value);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);

  const d = new Date(year, month, day);

  return isNaN(d.getTime()) ? null : d;
}


function formatDate_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
}

function sameDate_(a, b) {
  const d1 = toDate_(a);
  const d2 = toDate_(b);

  if (!d1 || !d2) return false;

  return d1.getTime() === d2.getTime();
}



function toTime_(value) {
  if (value === null || value === undefined || value === "") return null;

  // Si ya viene como Date
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(
      1970, 0, 1,
      value.getHours(),
      value.getMinutes(),
      value.getSeconds()
    );
  }

  const text = toStr_(value);
  const match = text.match(/^(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return new Date(1970, 0, 1, hours, minutes, seconds);
}

function formatTime_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "HH:mm:ss");
}

function sameTime_(a, b) {
  const t1 = toTime_(a);
  const t2 = toTime_(b);

  if (!t1 || !t2) return false;

  return (
    t1.getHours() === t2.getHours() &&
    t1.getMinutes() === t2.getMinutes() &&
    t1.getSeconds() === t2.getSeconds()
  );
}


// ----  ---- //



/**
 * Plantilla genérica de Debug para registro de ejecución
 */
function debugHoja_(sheetName, mapFn, label) {
  const hoja = getSheet_(sheetName);

  if (!hoja) {
    console.error(`[${label}] No se encontró la hoja:`, sheetName);
    return;
  }

  const values = getSheet_(sheetName).getDataRange().getValues();

  console.log(`==================================================`);
  console.log(`[${label}] Hoja: ${sheetName}`);
  console.log(`[${label}] Filas totales (incluye encabezado):`, values.length);

  if (values.length === 0) {
    console.warn(`[${label}] Hoja vacía.`);
    return;
  }

  console.log(`[${label}] Encabezados (fila 1):`, values[0]);
  console.log(`[${label}] Muestra RAW (primeras 5 filas):`, JSON.stringify(values.slice(0, 5), null, 3));

  // Quitar encabezado
  const rows = values.slice(1);

  console.log(`[${label}] Filas de datos (sin encabezado):`, rows.length);
  console.log(`[${label}] Muestra RAW datos (primeras 5):`, JSON.stringify(rows.slice(0, 5), null, 3));

  // Mapear a objetos (si hay mapFn)
  if (typeof mapFn === "function") {
    const mapped = rows.map(mapFn);

    console.log(`[${label}] Muestra MAPEADA (primeras 5):`, JSON.stringify(mapped.slice(0, 5), null, 3));

    // Validaciones rápidas
    const nulos = mapped.filter(o => !o).length;
    console.log(`[${label}] Objetos nulos/undefined mapeados:`, nulos);
  }

  console.log(`==================================================`);
} 


/**
 * Plantilla genérica de Debug para Services
 * - label: nombre de la operación
 * - input: objeto o valor de entrada (solo para log)
 * - executor: función que ejecuta el service
 * - options.limit: cuántos elementos mostrar si el resultado es array
 */
function debugServiceCall_(label, input, executor, options = {}) {
  const limit = options.limit || 5;

  console.log("==================================================");
  console.log(`[SERVICE] ${label}`);

  if (input !== undefined) {
    console.log(`[${label}] input:`, JSON.stringify(input, null, 2));
  }

  try {
    const result = executor();

    // Si regresa array
    if (Array.isArray(result)) {
      console.log(`[${label}] tipo: array`);
      console.log(`[${label}] total:`, result.length);
      console.log(`[${label}] muestra:`, JSON.stringify(result.slice(0, limit), null, 2));
    }

    // Si regresa objeto
    else if (result && typeof result === "object") {
      console.log(`[${label}] tipo: object`);
      console.log(`[${label}] keys:`, Object.keys(result));
      console.log(`[${label}] valor:`, JSON.stringify(result, null, 2));
    }

    // Si regresa valor simple
    else {
      console.log(`[${label}] tipo:`, typeof result);
      console.log(`[${label}] valor:`, result);
    }

    console.log("==================================================");
    return result;

  } catch (error) {
    console.error(`[${label}] ERROR:`, error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    console.log("==================================================");
    return null;
  }
}
