
/**
 * Utilidades.gs
 * Auxiliares
 */


const __spreadsheetCache = {};

function getSpreadsheetByFileKey_(fileKey) {
  const fileId = FILES[fileKey];

  if (!fileId) {
    throw new Error(`No se encontró el fileKey en FILES: ${fileKey}`);
  }

  if (!__spreadsheetCache[fileKey]) {
    __spreadsheetCache[fileKey] = SpreadsheetApp.openById(fileId);
  }

  return __spreadsheetCache[fileKey];
}

function getSheetByKey_(sheetKey) {
  const config = SHEETS[sheetKey];

  if (!config) {
    throw new Error(`No se encontró la configuración de hoja para: ${sheetKey}`);
  }

  const ss = getSpreadsheetByFileKey_(config.file);
  const hoja = ss.getSheetByName(config.name);

  if (!hoja) {
    throw new Error(`No se encontró la hoja "${config.name}" en el archivo "${config.file}"`);
  }

  return hoja;
}

function getRowsByKey_(sheetKey) {
  const values = getSheetByKey_(sheetKey).getDataRange().getValues();

  if (values.length < 2) return [];

  return values.slice(1); // sin encabezado
}

function getValuesByKey_(sheetKey) {
  return getSheetByKey_(sheetKey).getDataRange().getValues();
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
  const n = Number(value);
  return isNaN(n) ? 0 : n;
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

  // Validación fuerte
  if (
    isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day
  ) {
    return null;
  }

  return d;
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
function debugHoja_(sheetKey, mapFn, label) {
  const config = SHEETS[sheetKey];

  if (!config) {
    console.error(`[${label}] No existe la clave SHEETS.${sheetKey}`);
    return;
  }

  const hoja = getSheetByKey_(sheetKey);
  const values = hoja.getDataRange().getValues();

  console.log(`==================================================`);
  console.log(`[${label}] sheetKey: ${sheetKey}`);
  console.log(`[${label}] file: ${config.file}`);
  console.log(`[${label}] hoja: ${config.name}`);
  console.log(`[${label}] Filas totales (incluye encabezado):`, values.length);

  if (values.length === 0) {
    console.warn(`[${label}] Hoja vacía.`);
    console.log(`==================================================`);
    return;
  }

  console.log(`[${label}] Encabezados (fila 1):`, JSON.stringify(values[0], null, 2));
  console.log(`[${label}] Muestra RAW (primeras 5 filas):`, JSON.stringify(values.slice(0, 5), null, 3));

  const rows = values.slice(1);

  console.log(`[${label}] Filas de datos (sin encabezado):`, rows.length);
  console.log(`[${label}] Muestra RAW datos (primeras 5):`, JSON.stringify(rows.slice(0, 5), null, 3));

  if (typeof mapFn === "function") {
    const mapped = rows.map((fila, index) => mapFn(fila, index + 2));

    console.log(`[${label}] Muestra MAPEADA (primeras 5):`, JSON.stringify(mapped.slice(0, 5), null, 3));

    const nulos = mapped.filter(o => !o).length;
    console.log(`[${label}] Objetos nulos/undefined mapeados:`, nulos);
  }

  console.log(`==================================================`);
}

function debugRepositoryCall_(label, input, executor, options = {}) {
  const limit = options.limit || 5;

  console.log("==================================================");
  console.log(`[REPOSITORY] ${label}`);

  if (input !== undefined) {
    console.log(`[${label}] input:`, JSON.stringify(input, null, 2));
  }

  try {
    const result = executor();

    if (Array.isArray(result)) {
      console.log(`[${label}] tipo: array`);
      console.log(`[${label}] total:`, result.length);
      console.log(`[${label}] muestra:`, JSON.stringify(result.slice(0, limit), null, 2));
    } else if (result && typeof result === "object") {
      console.log(`[${label}] tipo: object`);
      console.log(`[${label}] keys:`, Object.keys(result));
      console.log(`[${label}] valor:`, JSON.stringify(result, null, 2));
    } else {
      console.log(`[${label}] tipo:`, typeof result);
      console.log(`[${label}] valor:`, result);
    }

    console.log("==================================================");
    return result;

  } catch (error) {
    console.error(`[${label}] ERROR:`, error.message);
    if (error.stack) console.error(error.stack);
    console.log("==================================================");
    return null;
  }
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


/**
 * Debug de métodos públicos de un Repository
 * - label: nombre del repository
 * - repository: objeto repository a inspeccionar
 */
function debugRepositoryMethods_(label, repository) {
  console.log("==================================================");
  console.log(`[REPOSITORY] ${label} - Métodos públicos`);

  try {
    if (!repository || typeof repository !== "object") {
      console.warn(`[${label}] No es un objeto válido de repository`);
      console.log("==================================================");
      return [];
    }

    const methods = Object.keys(repository)
      .filter(key => typeof repository[key] === "function");

    console.log(`[${label}] total métodos: ${methods.length}`);
    console.log(`[${label}] métodos:`, JSON.stringify(methods, null, 2));
    console.log("==================================================");

    return methods;

  } catch (error) {
    console.error(`[${label}] ERROR:`, error.message);
    if (error.stack) console.error(error.stack);
    console.log("==================================================");
    return [];
  }
}

/**
 * =========================================================
 * Utilities extendidas para services/controllers
 * =========================================================
 */

/**
 * Número redondeado a 2 decimales.
 */
function round2_(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Zona horaria del script.
 */
function getScriptTz_() {
  return Session.getScriptTimeZone() || "America/Mexico_City";
}

/**
 * Fecha actual.
 */
function now_() {
  return new Date();
}

/**
 * Fecha actual formateada dd/MM/yyyy.
 */
function fmtDateNow_() {
  return Utilities.formatDate(now_(), getScriptTz_(), "dd/MM/yyyy");
}

/**
 * Hora actual formateada HH:mm:ss.
 */
function fmtTimeNow_() {
  return Utilities.formatDate(now_(), getScriptTz_(), "HH:mm:ss");
}

/**
 * Fecha formateada dd/MM/yyyy desde Date.
 */
function fmtDateSafe_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, getScriptTz_(), "dd/MM/yyyy");
}

/**
 * Hora formateada HH:mm:ss desde Date.
 */
function fmtTimeSafe_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, getScriptTz_(), "HH:mm:ss");
}

/**
 * Contexto temporal estándar.
 */
function getTemporalContext_() {
  const now = now_();

  return {
    fecha: Utilities.formatDate(now, getScriptTz_(), "dd/MM/yyyy"),
    hora: Utilities.formatDate(now, getScriptTz_(), "HH:mm:ss"),
    ahora: now
  };
}

/**
 * Normaliza texto para token de ubicación.
 * Ejemplo:
 * " B1 - 01 " => "B1-01" si no hay espacios internos con guion,
 * "B1 01" => "B101"
 */
function normalizeLocationToken_(value) {
  return toStrUpper_(value)
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Normaliza texto para bodega.
 */
function normalizeWarehouseToken_(value) {
  return toStrUpper_(value)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae el primer campo con valor desde un objeto.
 */
function pickFirstField_(row, possibleFields) {
  for (let i = 0; i < possibleFields.length; i++) {
    const key = possibleFields[i];

    if (row && row[key] !== null && row[key] !== undefined && toStr_(row[key])) {
      return row[key];
    }
  }

  return "";
}

/**
 * Devuelve elementos únicos según una llave calculada.
 */
function uniqueBy_(arr, mapper) {
  const seen = {};
  const out = [];

  (arr || []).forEach(function (item) {
    const key = mapper(item);

    if (!key) return;
    if (seen[key]) return;

    seen[key] = true;
    out.push(item);
  });

  return out;
}

/**
 * Orden localeCompare español con soporte numérico.
 */
function compareEs_(a, b) {
  return String(a || "").localeCompare(
    String(b || ""),
    "es",
    {
      sensitivity: "base",
      numeric: true
    }
  );
}

/**
 * Clonado simple para objetos planos.
 */
function clonePlain_(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Inferencia estándar de bodega por ubicación.
 */
function inferWarehouseByLocation_(ubicacion, fallback) {
  const u = toStrUpper_(ubicacion);
  const fb = toStrUpper_(fallback) || "PENDIENTE DE UBICACIÓN";

  if (!u) return fb;
  if (u.startsWith("B1")) return "BODEGA 1";
  if (u.startsWith("B2")) return "BODEGA 2";
  if (u.startsWith("B3")) return "BODEGA 3";
  if (u.startsWith("BM")) return "BODEGA MOSTRADOR";
  if (u.startsWith("CB1")) return "CASA BLANCA 1";
  if (u.startsWith("CB2")) return "CASA BLANCA 2";
  if (u.startsWith("CU")) return "CUARTO ALTO RIESGO";
  if (u.startsWith("MO")) return "MOSTRADOR";

  return fb;
}

/**
 * Diferencia en minutos entre fecha + hora inicio + hora fin.
 * fecha: dd/MM/yyyy
 * horaInicio: HH:mm:ss
 * horaFin: HH:mm:ss
 */
function minutesDiffFromStrings_(fechaStr, horaInicioStr, horaFinStr) {
  try {
    if (!fechaStr || !horaInicioStr || !horaFinStr) return 0;

    const fechaParts = String(fechaStr).split("/");
    const inicioParts = String(horaInicioStr).split(":");
    const finParts = String(horaFinStr).split(":");

    if (fechaParts.length !== 3 || inicioParts.length < 2 || finParts.length < 2) {
      return 0;
    }

    const day = Number(fechaParts[0]);
    const month = Number(fechaParts[1]);
    const year = Number(fechaParts[2]);

    const h1 = Number(inicioParts[0] || 0);
    const m1 = Number(inicioParts[1] || 0);
    const s1 = Number(inicioParts[2] || 0);

    const h2 = Number(finParts[0] || 0);
    const m2 = Number(finParts[1] || 0);
    const s2 = Number(finParts[2] || 0);

    const inicio = new Date(year, month - 1, day, h1, m1, s1);
    const fin = new Date(year, month - 1, day, h2, m2, s2);

    const diff = fin.getTime() - inicio.getTime();

    return diff > 0 ? Math.round(diff / 60000) : 0;

  } catch (error) {
    return 0;
  }
}

/**
 * Ejecuta una operación con LockService.
 */
function withScriptLock_(label, executor, timeoutMs) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(timeoutMs || 30000);
    locked = true;

    return executor();

  } catch (error) {
    console.error(`[LOCK] ${label} :: ERROR`, error && error.message);
    if (error && error.stack) console.error(error.stack);
    throw error;

  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

/**
 * Wrapper genérico para controllers.
 */
function execController_(controllerName, label, executor) {
  try {
    console.log(`[${controllerName}] ${label} :: INICIO`);

    const result = executor();

    console.log(
      `[${controllerName}] ${label} :: OK`,
      result && typeof result === "object"
        ? JSON.stringify(result).slice(0, 1000)
        : result
    );

    return result;

  } catch (error) {
    console.error(`[${controllerName}] ${label} :: ERROR message`, error && error.message);
    console.error(`[${controllerName}] ${label} :: ERROR stack`, error && error.stack);
    console.error(`[${controllerName}] ${label} :: ERROR raw`, error);

    throw new Error(error && error.message ? error.message : `Error en ${label}`);
  }
}

/**
 * Limpia cachés operativos que afectan saldos, movimientos,
 * excedentes, estado actual y vistas consolidadas.
 */
function clearOperationalCaches_() {
  try {
    if (typeof CatalogoRepository !== "undefined" && CatalogoRepository.clearCache) {
      CatalogoRepository.clearCache();
    }

    if (typeof ExcedentesRepository !== "undefined" && ExcedentesRepository.clearCache) {
      ExcedentesRepository.clearCache();
    }

    if (typeof TraspasosRepository !== "undefined" && TraspasosRepository.clearCache) {
      TraspasosRepository.clearCache();
    }

    if (typeof ExistenciasRepository !== "undefined" && ExistenciasRepository.clearCache) {
      ExistenciasRepository.clearCache();
    }

    if (typeof MaxMinRepository !== "undefined" && MaxMinRepository.clearCache) {
      MaxMinRepository.clearCache();
    }

    if (typeof UbicacionesSurtidoRepository !== "undefined" && UbicacionesSurtidoRepository.clearCache) {
      UbicacionesSurtidoRepository.clearCache();
    }

    if (typeof UbicacionesExcedentesRepository !== "undefined" && UbicacionesExcedentesRepository.clearCache) {
      UbicacionesExcedentesRepository.clearCache();
    }

    if (typeof EstadoActualExcedentesService !== "undefined" && EstadoActualExcedentesService.clearCache) {
      EstadoActualExcedentesService.clearCache();
    }

    if (typeof GestorExcedentesService !== "undefined" && GestorExcedentesService.clearCache) {
      GestorExcedentesService.clearCache();
    }

    console.log("[CACHE] clearOperationalCaches_ :: OK");

    return true;

  } catch (error) {
    console.warn("[CACHE] clearOperationalCaches_ :: ERROR", error && error.message);
    return false;
  }
}
