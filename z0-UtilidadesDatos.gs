/**
 * z0-UtilidadesDatos.gs
 *
 * Infraestructura compartida de acceso a datos, normalización, rendimiento,
 * concurrencia, diagnóstico y mantenimiento de cachés para APPALMACEN.
 *
 * Responsabilidades:
 * - Resolver archivos y hojas configurados mediante FILES y SHEETS.
 * - Reutilizar instancias Spreadsheet durante una ejecución.
 * - Leer y escribir rangos con ancho controlado y telemetría.
 * - Normalizar textos, números, fechas, horas, ubicaciones y bodegas.
 * - Sanitizar metadatos sensibles antes de enviarlos a logs.
 * - Administrar trazas de rendimiento y advertencias por lentitud.
 * - Ejecutar operaciones críticas mediante ScriptLock.
 * - Estandarizar la ejecución y errores de Controllers.
 * - Invalidar cachés por alcance funcional.
 * - Verificar contratos de hojas del módulo Verificación de entrada.
 *
 * Seguridad:
 * - No enviar XML, CFDI, códigos de barras, certificados, sellos, cuentas ni
 *   payloads completos a los helpers debug*.
 * - Para datos sensibles deben utilizarse los helpers perf*, que redactan,
 *   truncan y limitan profundidad, propiedades y arreglos.
 *
 * Invariantes:
 * - La posición y escritura concurrente deben ocurrir bajo el mismo lock.
 * - Las hojas de alto crecimiento deben leerse con readSheetRows_().
 * - Las trazas finalizadas no aceptan nuevas marcas.
 * - Las limpiezas de caché toleran dependencias opcionales ausentes.
 */

// =========================================================
// ACCESO A ARCHIVOS, HOJAS Y RANGOS
// =========================================================
/** Caché de Spreadsheet válida durante la ejecución actual. */
const __spreadsheetCache = {};

/**
 * Obtiene un Spreadsheet por su fileKey y lo conserva durante la ejecución.
 *
 * @param {string} fileKey Clave definida en FILES.
 * @param {Object=} trace Tracker opcional.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheetByFileKey_(fileKey, trace) {
  const key = String(fileKey || "").trim();
  const fileId = FILES[key];

  if (!fileId) {
    throw new Error(
      "No se encontró el fileKey en FILES: " + key
    );
  }

  if (__spreadsheetCache[key]) {
    perfMark_(trace, "SPREADSHEET_CACHE_HIT", {
      fileKey: key
    });

    return __spreadsheetCache[key];
  }

  const startedAt = Date.now();

  __spreadsheetCache[key] = SpreadsheetApp.openById(fileId);

  perfMark_(trace, "SPREADSHEET_OPENED", {
    fileKey: key,
    elapsedMs: Date.now() - startedAt
  });

  return __spreadsheetCache[key];
}

/**
 * Obtiene una hoja mediante una clave definida en SHEETS.
 *
 * @param {string} sheetKey Clave definida en SHEETS.
 * @param {Object=} trace Tracker opcional.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheetByKey_(sheetKey, trace) {
  const key = String(sheetKey || "").trim();
  const config = SHEETS[key];

  if (!config) {
    throw new Error(
      "No se encontró la configuración de hoja para: " + key
    );
  }

  const startedAt = Date.now();
  const ss = getSpreadsheetByFileKey_(config.file, trace);
  const sheet = ss.getSheetByName(config.name);
  const elapsedMs = Date.now() - startedAt;

  if (!sheet) {
    throw new Error(
      'No se encontró la hoja "' +
      config.name +
      '" en el archivo "' +
      config.file +
      '".'
    );
  }

  perfMark_(trace, "SHEET_RESOLVED", {
    sheetKey: key,
    fileKey: config.file,
    sheetName: config.name,
    elapsedMs: elapsedMs
  });

  return sheet;
}

/**
 * Lectura genérica heredada. Lee todo el rango utilizado.
 * No usar para hojas VE-* que puedan crecer considerablemente.
 */
function getRowsByKey_(sheetKey) {
  const values = getSheetByKey_(sheetKey)
    .getDataRange()
    .getValues();

  if (values.length < 2) return [];

  return values.slice(1);
}

/**
 * Lectura genérica heredada, incluyendo encabezados.
 */
function getValuesByKey_(sheetKey) {
  return getSheetByKey_(sheetKey)
    .getDataRange()
    .getValues();
}

/**
 * Lee filas de una hoja usando un ancho controlado.
 * No incluye la fila de encabezados.
 *
 * @param {string} sheetKey Clave definida en SHEETS.
 * @param {number} width Cantidad exacta de columnas por leer.
 * @param {Object=} trace Tracker opcional.
 * @return {Array<Array<*>>}
 */
function readSheetRows_(sheetKey, width, trace) {
  const safeWidth = Math.max(
    1,
    Math.floor(Number(width || 1))
  );

  const sheet = getSheetByKey_(sheetKey, trace);

  const lastRowStartedAt = Date.now();
  const lastRow = sheet.getLastRow();

  perfMark_(trace, "SHEET_LAST_ROW_READY", {
    sheetKey: String(sheetKey || ""),
    elapsedMs: Date.now() - lastRowStartedAt,
    lastRow: lastRow,
    width: safeWidth
  });

  if (lastRow < 2) {
    perfMark_(trace, "SHEET_ROWS_READ_SKIPPED", {
      sheetKey: String(sheetKey || ""),
      reason: "NO_DATA_ROWS",
      rows: 0,
      width: safeWidth
    });

    return [];
  }

  const readStartedAt = Date.now();
  const rows = sheet
    .getRange(2, 1, lastRow - 1, safeWidth)
    .getValues();
  const elapsedMs = Date.now() - readStartedAt;

  perfMark_(trace, "SHEET_ROWS_READ", {
    sheetKey: String(sheetKey || ""),
    elapsedMs: elapsedMs,
    rows: rows.length,
    width: safeWidth,
    cells: rows.length * safeWidth
  });

  perfWarnSlow_(
    trace,
    "SLOW_SHEET_READ",
    elapsedMs,
    perfConfig_().WARN_SHEET_READ_MS,
    {
      sheetKey: String(sheetKey || ""),
      rows: rows.length,
      width: safeWidth
    }
  );

  return rows;
}

/**
 * Escribe filas por lote al final de una hoja.
 * La posición y la escritura deben ejecutarse dentro del mismo ScriptLock
 * cuando pueda existir concurrencia.
 *
 * @param {string} sheetKey Clave definida en SHEETS.
 * @param {Array<Array<*>>} rows Filas por escribir.
 * @param {number} width Ancho exacto esperado.
 * @param {Object=} trace Tracker opcional.
 * @return {{written:number, firstRow:number}}
 */
function writeRowsBatch_(sheetKey, rows, width, trace) {
  const safeRows = Array.isArray(rows) ? rows : [];

  if (safeRows.length === 0) {
    perfMark_(trace, "SHEET_WRITE_SKIPPED", {
      sheetKey: String(sheetKey || ""),
      reason: "NO_ROWS"
    });

    return {
      written: 0,
      firstRow: 0
    };
  }

  const safeWidth = Math.max(
    1,
    Math.floor(Number(width || 1))
  );

  safeRows.forEach(function(row, index) {
    if (!Array.isArray(row) || row.length !== safeWidth) {
      throw new Error(
        "Fila inválida para " +
        sheetKey +
        " en posición " +
        index +
        ". Se esperaban " +
        safeWidth +
        " columnas."
      );
    }
  });

  const sheet = getSheetByKey_(sheetKey, trace);

  const positionStartedAt = Date.now();
  const firstRow = Math.max(2, sheet.getLastRow() + 1);

  perfMark_(trace, "SHEET_APPEND_POSITION_READY", {
    sheetKey: String(sheetKey || ""),
    elapsedMs: Date.now() - positionStartedAt,
    firstRow: firstRow
  });

  const writeStartedAt = Date.now();

  sheet
    .getRange(firstRow, 1, safeRows.length, safeWidth)
    .setValues(safeRows);

  const elapsedMs = Date.now() - writeStartedAt;

  perfMark_(trace, "SHEET_ROWS_WRITTEN", {
    sheetKey: String(sheetKey || ""),
    elapsedMs: elapsedMs,
    rows: safeRows.length,
    width: safeWidth,
    cells: safeRows.length * safeWidth,
    firstRow: firstRow
  });

  perfWarnSlow_(
    trace,
    "SLOW_SHEET_WRITE",
    elapsedMs,
    perfConfig_().WARN_SHEET_WRITE_MS,
    {
      sheetKey: String(sheetKey || ""),
      rows: safeRows.length,
      width: safeWidth
    }
  );

  return {
    written: safeRows.length,
    firstRow: firstRow
  };
}

// =========================================================
// NORMALIZACIÓN DE DATOS, FECHAS Y HORAS
// =========================================================
/** Formateadores defensivos compartidos. */
/** Convierte un valor a texto sin espacios externos. */
function toStr_(value) {
  return String(value || "").trim();
}

/** Convierte un valor a texto normalizado en mayúsculas. */
function toStrUpper_(value) {
  return String(value || "").trim().toUpperCase();
}

/** Convierte un valor a número y usa cero para entradas inválidas. */
function toNum_(value) {
  if (value === "" || value == null) return 0;

  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function isValidDate_(value) {
  return value instanceof Date && !isNaN(value.getTime());
}

/** Normaliza Date o dd/MM/yyyy a una fecha calendario. */
function toDate_(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );
  }

  const text = toStr_(value);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const d = new Date(year, month, day);

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

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "dd/MM/yyyy"
  );
}

function sameDate_(a, b) {
  const d1 = toDate_(a);
  const d2 = toDate_(b);

  if (!d1 || !d2) return false;

  return d1.getTime() === d2.getTime();
}

/** Normaliza Date o HH:mm:ss a una hora comparable. */
function toTime_(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(
      1970,
      0,
      1,
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

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "HH:mm:ss"
  );
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

// =========================================================
// DIAGNÓSTICO MANUAL Y SEGURIDAD DE LOGS
// =========================================================
/**
 * ADVERTENCIA DE SEGURIDAD:
 *
 * No utilizar los helpers debug* con datos de Verificación de entrada:
 * - XML o CFDI completos.
 * - Códigos de barras originales.
 * - Certificados o sellos.
 * - UUID o RFC sin enmascarar.
 * - Cuentas bancarias.
 * - Equivalencias completas.
 * - Cajas completas.
 * - Payloads de sesiones.
 *
 * Para Verificación de entrada usar los helpers perf*, que limitan
 * profundidad, longitud y propiedades sensibles.
 */

/**
 * Plantilla genérica de Debug para registro de ejecución.
 */
function debugHoja_(sheetKey, mapFn, label) {
  const config = SHEETS[sheetKey];

  if (!config) {
    console.error("[" + label + "] No existe la clave SHEETS." + sheetKey);
    return;
  }

  const hoja = getSheetByKey_(sheetKey);
  const values = hoja.getDataRange().getValues();

  console.log("==================================================");
  console.log("[" + label + "] sheetKey: " + sheetKey);
  console.log("[" + label + "] file: " + config.file);
  console.log("[" + label + "] hoja: " + config.name);
  console.log(
    "[" + label + "] Filas totales (incluye encabezado):",
    values.length
  );

  if (values.length === 0) {
    console.warn("[" + label + "] Hoja vacía.");
    console.log("==================================================");
    return;
  }

  console.log(
    "[" + label + "] Encabezados (fila 1):",
    JSON.stringify(values[0], null, 2)
  );

  console.log(
    "[" + label + "] Muestra RAW (primeras 5 filas):",
    JSON.stringify(values.slice(0, 5), null, 3)
  );

  const rows = values.slice(1);

  console.log(
    "[" + label + "] Filas de datos (sin encabezado):",
    rows.length
  );

  console.log(
    "[" + label + "] Muestra RAW datos (primeras 5):",
    JSON.stringify(rows.slice(0, 5), null, 3)
  );

  if (typeof mapFn === "function") {
    const mapped = rows.map(function(fila, index) {
      return mapFn(fila, index + 2);
    });

    console.log(
      "[" + label + "] Muestra MAPEADA (primeras 5):",
      JSON.stringify(mapped.slice(0, 5), null, 3)
    );

    const nulos = mapped.filter(function(item) {
      return !item;
    }).length;

    console.log(
      "[" + label + "] Objetos nulos/undefined mapeados:",
      nulos
    );
  }

  console.log("==================================================");
}

function debugRepositoryCall_(label, input, executor, options) {
  const opts = options || {};
  const limit = opts.limit || 5;

  console.log("==================================================");
  console.log("[REPOSITORY] " + label);

  if (input !== undefined) {
    console.log(
      "[" + label + "] input:",
      JSON.stringify(input, null, 2)
    );
  }

  try {
    const result = executor();

    if (Array.isArray(result)) {
      console.log("[" + label + "] tipo: array");
      console.log("[" + label + "] total:", result.length);
      console.log(
        "[" + label + "] muestra:",
        JSON.stringify(result.slice(0, limit), null, 2)
      );
    } else if (result && typeof result === "object") {
      console.log("[" + label + "] tipo: object");
      console.log("[" + label + "] keys:", Object.keys(result));
      console.log(
        "[" + label + "] valor:",
        JSON.stringify(result, null, 2)
      );
    } else {
      console.log("[" + label + "] tipo:", typeof result);
      console.log("[" + label + "] valor:", result);
    }

    console.log("==================================================");
    return result;
  } catch (error) {
    console.error("[" + label + "] ERROR:", error.message);
    if (error.stack) console.error(error.stack);
    console.log("==================================================");
    return null;
  }
}

function debugServiceCall_(label, input, executor, options) {
  const opts = options || {};
  const limit = opts.limit || 5;

  console.log("==================================================");
  console.log("[SERVICE] " + label);

  if (input !== undefined) {
    console.log(
      "[" + label + "] input:",
      JSON.stringify(input, null, 2)
    );
  }

  try {
    const result = executor();

    if (Array.isArray(result)) {
      console.log("[" + label + "] tipo: array");
      console.log("[" + label + "] total:", result.length);
      console.log(
        "[" + label + "] muestra:",
        JSON.stringify(result.slice(0, limit), null, 2)
      );
    } else if (result && typeof result === "object") {
      console.log("[" + label + "] tipo: object");
      console.log("[" + label + "] keys:", Object.keys(result));
      console.log(
        "[" + label + "] valor:",
        JSON.stringify(result, null, 2)
      );
    } else {
      console.log("[" + label + "] tipo:", typeof result);
      console.log("[" + label + "] valor:", result);
    }

    console.log("==================================================");
    return result;
  } catch (error) {
    console.error("[" + label + "] ERROR:", error.message);
    if (error.stack) console.error(error.stack);
    console.log("==================================================");
    return null;
  }
}

function debugRepositoryMethods_(label, repository) {
  console.log("==================================================");
  console.log("[REPOSITORY] " + label + " - Métodos públicos");

  try {
    if (!repository || typeof repository !== "object") {
      console.warn("[" + label + "] No es un objeto válido de repository");
      console.log("==================================================");
      return [];
    }

    const methods = Object.keys(repository).filter(function(key) {
      return typeof repository[key] === "function";
    });

    console.log("[" + label + "] total métodos: " + methods.length);
    console.log(
      "[" + label + "] métodos:",
      JSON.stringify(methods, null, 2)
    );
    console.log("==================================================");

    return methods;
  } catch (error) {
    console.error("[" + label + "] ERROR:", error.message);
    if (error.stack) console.error(error.stack);
    console.log("==================================================");
    return [];
  }
}

// =========================================================
// UTILIDADES GENERALES PARA SERVICES Y CONTROLLERS
// =========================================================
/** Utilities extendidas para services/controllers. */
/** Redondea un valor numérico a dos decimales. */
function round2_(value) {
  return Math.round(
    (Number(value || 0) + Number.EPSILON) * 100
  ) / 100;
}

function getScriptTz_() {
  return Session.getScriptTimeZone() || "America/Mexico_City";
}

function now_() {
  return new Date();
}

function fmtDateNow_() {
  return Utilities.formatDate(now_(), getScriptTz_(), "dd/MM/yyyy");
}

function fmtTimeNow_() {
  return Utilities.formatDate(now_(), getScriptTz_(), "HH:mm:ss");
}

function fmtDateSafe_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, getScriptTz_(), "dd/MM/yyyy");
}

function fmtTimeSafe_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, getScriptTz_(), "HH:mm:ss");
}

/** Construye un contexto consistente de fecha y hora actual. */
function getTemporalContext_() {
  const current = now_();

  return {
    fecha: Utilities.formatDate(current, getScriptTz_(), "dd/MM/yyyy"),
    hora: Utilities.formatDate(current, getScriptTz_(), "HH:mm:ss"),
    ahora: current
  };
}

/** Normaliza una ubicación eliminando espacios. */
function normalizeLocationToken_(value) {
  return toStrUpper_(value)
    .replace(/\s+/g, "")
    .trim();
}

/** Normaliza una bodega conservando espacios simples. */
function normalizeWarehouseToken_(value) {
  return toStrUpper_(value)
    .replace(/\s+/g, " ")
    .trim();
}

/** Obtiene el primer campo no vacío entre varias claves. */
function pickFirstField_(row, possibleFields) {
  const fields = Array.isArray(possibleFields) ? possibleFields : [];

  for (let i = 0; i < fields.length; i++) {
    const key = fields[i];

    if (
      row &&
      row[key] !== null &&
      row[key] !== undefined &&
      toStr_(row[key])
    ) {
      return row[key];
    }
  }

  return "";
}

/** Conserva la primera aparición de cada clave calculada. */
function uniqueBy_(arr, mapper) {
  const seen = {};
  const out = [];

  (arr || []).forEach(function(item) {
    const key = mapper(item);

    if (!key || seen[key]) return;

    seen[key] = true;
    out.push(item);
  });

  return out;
}

/** Compara textos en español con orden numérico. */
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

/** Crea una copia JSON de un objeto serializable. */
function clonePlain_(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * =========================================================
 * TRACKER GENÉRICO DE RENDIMIENTO APPALMACEN
 * =========================================================
 */

/** Obtiene la configuración efectiva de rendimiento. */
function perfConfig_() {
  if (
    typeof VERIFICACION_ENTRADA !== "undefined" &&
    VERIFICACION_ENTRADA &&
    VERIFICACION_ENTRADA.PERFORMANCE
  ) {
    return VERIFICACION_ENTRADA.PERFORMANCE;
  }

  return {
    ENABLED: true,
    LOG_PREFIX: "[APPALMACEN][PERF]",
    MAX_MARKS: 80,
    MAX_METADATA_TEXT_LENGTH: 500,
    WARN_TOTAL_MS: 3000,
    WARN_SHEET_READ_MS: 1500,
    WARN_SHEET_WRITE_MS: 1500,
    WARN_LOCK_WAIT_MS: 1000,
    MEASURE_RESPONSE_CHARS: true
  };
}

/** Genera un identificador compacto de correlación. */
function perfGenerateRequestId_() {
  return (
    "REQ-" +
    Utilities.getUuid()
      .replace(/-/g, "")
      .slice(0, 16)
      .toUpperCase()
  );
}

/** Redacta y limita metadatos para logs seguros. */
function perfSanitizeMetadata_(metadata) {
  const cfg = perfConfig_();
  const maxText = Math.max(
    50,
    Number(cfg.MAX_METADATA_TEXT_LENGTH || 500)
  );

  const blockedKeys = {
    xml: true,
    xmltext: true,
    xmlcontent: true,
    contenidoxml: true,
    certificado: true,
    sello: true,
    sellocfd: true,
    sellosat: true,
    codigooriginal: true,
    rawbarcode: true,
    barcodeoriginal: true,
    metadatajson: true,
    uuidcfdi: true,
    rfcemisor: true,
    rfc: true,
    hashxml: true,
    huellalectura: true,
    cuentaordenante: true,
    cuentabeneficiario: true,
    iddocumento: true
  };

  function sanitizeValue_(value, key, depth) {
    const safeDepth = Number(depth || 0);
    const normalizedKey = String(key || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    if (blockedKeys[normalizedKey]) {
      return "[REDACTED]";
    }

    if (value === null || value === undefined) return value;

    if (value instanceof Date) {
      return isNaN(value.getTime()) ? "" : value.toISOString();
    }

    if (typeof value === "string") {
      return value.length > maxText
        ? value.slice(0, maxText) + "...[TRUNCATED]"
        : value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (safeDepth >= 3) return "[MAX_DEPTH]";

    if (Array.isArray(value)) {
      return value.slice(0, 20).map(function(item) {
        return sanitizeValue_(item, "", safeDepth + 1);
      });
    }

    if (typeof value === "object") {
      return Object.keys(value)
        .slice(0, 40)
        .reduce(function(output, childKey) {
          output[childKey] = sanitizeValue_(
            value[childKey],
            childKey,
            safeDepth + 1
          );
          return output;
        }, {});
    }

    return String(value);
  }

  return sanitizeValue_(
    metadata && typeof metadata === "object" ? metadata : {},
    "",
    0
  );
}

/** Inicia una traza de rendimiento. */
function perfStart_(operation, metadata) {
  const now = Date.now();

  return {
    requestId:
      metadata && metadata.requestId
        ? String(metadata.requestId)
        : perfGenerateRequestId_(),
    operation: String(operation || "APPALMACEN_OPERATION"),
    startedAt: now,
    lastAt: now,
    metadata: perfSanitizeMetadata_(metadata || {}),
    marks: [],
    ended: false
  };
}

/** Agrega una marca a una traza activa. */
function perfMark_(trace, stage, metadata) {
  if (!trace || trace.ended === true) return null;

  const cfg = perfConfig_();
  const maxMarks = Math.max(1, Number(cfg.MAX_MARKS || 80));

  if (trace.marks.length >= maxMarks) return null;

  const now = Date.now();
  const mark = {
    stage: String(stage || "MARK"),
    segmentMs: now - trace.lastAt,
    totalMs: now - trace.startedAt,
    metadata: perfSanitizeMetadata_(metadata || {})
  };

  trace.marks.push(mark);
  trace.lastAt = now;

  return mark;
}

/** Registra una marca si se supera el umbral. */
function perfWarnSlow_(trace, stage, elapsedMs, thresholdMs, metadata) {
  const threshold = Number(thresholdMs || 0);

  if (threshold <= 0 || Number(elapsedMs || 0) <= threshold) {
    return null;
  }

  return perfMark_(
    trace,
    stage || "SLOW_OPERATION",
    Object.assign(
      {},
      metadata || {},
      {
        elapsedMs: Number(elapsedMs || 0),
        thresholdMs: threshold
      }
    )
  );
}

/** Estima el tamaño JSON de una respuesta. */
function perfMeasureJsonChars_(value) {
  try {
    return JSON.stringify(value).length;
  } catch (error) {
    return -1;
  }
}

/** Finaliza y registra una traza. */
function perfEnd_(trace, status, metadata) {
  if (!trace || trace.ended === true) return null;

  trace.ended = true;

  const cfg = perfConfig_();
  const totalMs = Date.now() - trace.startedAt;

  const result = {
    requestId: trace.requestId,
    operation: trace.operation,
    status: String(status || "ok"),
    totalMs: totalMs,
    metadata: Object.assign(
      {},
      trace.metadata,
      perfSanitizeMetadata_(metadata || {})
    ),
    marks: trace.marks.slice()
  };

  if (cfg.ENABLED !== false) {
    console.log(
      String(cfg.LOG_PREFIX || "[APPALMACEN][PERF]") +
      " " +
      JSON.stringify(result)
    );
  }

  if (
    Number(cfg.WARN_TOTAL_MS || 0) > 0 &&
    totalMs > Number(cfg.WARN_TOTAL_MS)
  ) {
    console.warn(
      String(cfg.LOG_PREFIX || "[APPALMACEN][PERF]") +
      "[SLOW_TOTAL] " +
      JSON.stringify({
        requestId: trace.requestId,
        operation: trace.operation,
        totalMs: totalMs,
        thresholdMs: Number(cfg.WARN_TOTAL_MS)
      })
    );
  }

  return result;
}

/** Finaliza una traza con estado de error. */
function perfFail_(trace, error, metadata) {
  perfMark_(
    trace,
    "FAILED",
    Object.assign({}, metadata || {}, {
      message:
        error && error.message
          ? error.message
          : String(error || "")
    })
  );

  return perfEnd_(trace, "error");
}

// =========================================================
// REGLAS TEMPORALES Y RESOLUCIÓN DE BODEGAS
// =========================================================
/** Inferencia estándar de bodega por ubicación. */
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

/** Calcula minutos positivos entre horas de una fecha. */
function minutesDiffFromStrings_(fechaStr, horaInicioStr, horaFinStr) {
  try {
    if (!fechaStr || !horaInicioStr || !horaFinStr) return 0;

    const fechaParts = String(fechaStr).split("/");
    const inicioParts = String(horaInicioStr).split(":");
    const finParts = String(horaFinStr).split(":");

    if (
      fechaParts.length !== 3 ||
      inicioParts.length < 2 ||
      finParts.length < 2
    ) {
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

// =========================================================
// CONCURRENCIA Y LOCKS
// =========================================================
/**
 * Ejecuta una operación con LockService y distingue la espera del candado
 * de los errores ocurridos dentro de la operación protegida.
 */
function withScriptLock_(label, executor, timeoutMs, trace) {
  if (typeof executor !== "function") {
    throw new Error(
      "withScriptLock_: executor debe ser una función."
    );
  }

  const lock = LockService.getScriptLock();
  const safeLabel = String(label || "LOCK_OPERATION");
  const safeTimeoutMs = Math.max(1, Number(timeoutMs || 30000));
  const waitStartedAt = Date.now();
  let locked = false;

  try {
    lock.waitLock(safeTimeoutMs);
    locked = true;

    const waitMs = Date.now() - waitStartedAt;

    perfMark_(trace, "LOCK_ACQUIRED", {
      label: safeLabel,
      waitMs: waitMs
    });

    perfWarnSlow_(
      trace,
      "SLOW_LOCK_WAIT",
      waitMs,
      perfConfig_().WARN_LOCK_WAIT_MS,
      { label: safeLabel }
    );
  } catch (error) {
    perfMark_(trace, "LOCK_ACQUIRE_FAILED", {
      label: safeLabel,
      waitMs: Date.now() - waitStartedAt,
      message:
        error && error.message
          ? error.message
          : String(error || "")
    });

    console.error(
      "[LOCK] " + safeLabel + " :: ACQUIRE ERROR",
      error && error.message ? error.message : error
    );

    throw error;
  }

  const executionStartedAt = Date.now();

  try {
    const result = executor();

    perfMark_(trace, "LOCKED_OPERATION_COMPLETED", {
      label: safeLabel,
      executionMs: Date.now() - executionStartedAt
    });

    return result;
  } catch (error) {
    perfMark_(trace, "LOCKED_OPERATION_FAILED", {
      label: safeLabel,
      executionMs: Date.now() - executionStartedAt,
      message:
        error && error.message
          ? error.message
          : String(error || "")
    });

    console.error(
      "[LOCK] " + safeLabel + " :: OPERATION ERROR",
      error && error.message ? error.message : error
    );

    throw error;
  } finally {
    if (locked) {
      const releaseStartedAt = Date.now();

      try {
        lock.releaseLock();

        perfMark_(trace, "LOCK_RELEASED", {
          label: safeLabel,
          releaseMs: Date.now() - releaseStartedAt
        });
      } catch (releaseError) {
        perfMark_(trace, "LOCK_RELEASE_FAILED", {
          label: safeLabel,
          releaseMs: Date.now() - releaseStartedAt,
          message:
            releaseError && releaseError.message
              ? releaseError.message
              : String(releaseError || "")
        });

        console.warn(
          "[LOCK] " + safeLabel + " :: RELEASE ERROR",
          releaseError && releaseError.message
            ? releaseError.message
            : releaseError
        );
      }
    }
  }
}

// =========================================================
// EJECUCIÓN ESTÁNDAR DE CONTROLLERS
// =========================================================
/** Wrapper genérico para controllers. */
function execController_(controllerName, label, executor) {
  const t0 = Date.now();

  try {
    console.log("[" + controllerName + "] " + label + " :: INICIO");

    const result = executor();

    console.log(
      "[" + controllerName + "] " + label + " :: OK",
      {
        durationMs: Date.now() - t0
      }
    );

    return result;
  } catch (error) {
    console.error(
      "[" + controllerName + "] " + label + " :: ERROR message",
      error && error.message
    );

    console.error(
      "[" + controllerName + "] " + label + " :: ERROR stack",
      error && error.stack
    );

    console.error(
      "[" + controllerName + "] " + label + " :: ERROR raw",
      error
    );

    throw new Error(
      error && error.message
        ? error.message
        : "Error en " + controllerName + "." + label
    );
  }
}

// =========================================================
// INVALIDACIÓN DE CACHÉS
// =========================================================
/** Limpia cachés operativas generales. */
function clearOperationalCaches_() {
  try {
    if (
      typeof CatalogoRepository !== "undefined" &&
      CatalogoRepository &&
      typeof CatalogoRepository.clearCache === "function"
    ) {
      CatalogoRepository.clearCache();
    }

    if (
      typeof ExcedentesRepository !== "undefined" &&
      ExcedentesRepository &&
      typeof ExcedentesRepository.clearCache === "function"
    ) {
      ExcedentesRepository.clearCache();
    }

    if (
      typeof TraspasosRepository !== "undefined" &&
      TraspasosRepository &&
      typeof TraspasosRepository.clearCache === "function"
    ) {
      TraspasosRepository.clearCache();
    }

    if (
      typeof ExistenciasRepository !== "undefined" &&
      ExistenciasRepository &&
      typeof ExistenciasRepository.clearCache === "function"
    ) {
      ExistenciasRepository.clearCache();
    }

    if (
      typeof MaxMinRepository !== "undefined" &&
      MaxMinRepository &&
      typeof MaxMinRepository.clearCache === "function"
    ) {
      MaxMinRepository.clearCache();
    }

    if (
      typeof UbicacionesSurtidoRepository !== "undefined" &&
      UbicacionesSurtidoRepository &&
      typeof UbicacionesSurtidoRepository.clearCache === "function"
    ) {
      UbicacionesSurtidoRepository.clearCache();
    }

    if (
      typeof UbicacionesExcedentesRepository !== "undefined" &&
      UbicacionesExcedentesRepository &&
      typeof UbicacionesExcedentesRepository.clearCache === "function"
    ) {
      UbicacionesExcedentesRepository.clearCache();
    }

    if (
      typeof GestorExcedentesService !== "undefined" &&
      GestorExcedentesService &&
      typeof GestorExcedentesService.clearCache === "function"
    ) {
      GestorExcedentesService.clearCache();
    } else if (
      typeof EstadoActualExcedentesService !== "undefined" &&
      EstadoActualExcedentesService &&
      typeof EstadoActualExcedentesService.clearCache === "function"
    ) {
      EstadoActualExcedentesService.clearCache();
    }

    if (
      typeof APPALMACENCache !== "undefined" &&
      APPALMACENCache &&
      typeof APPALMACENCache.clearOperational === "function"
    ) {
      APPALMACENCache.clearOperational();
    }

    if (
      typeof VerificacionEntradaRepository !== "undefined" &&
      VerificacionEntradaRepository &&
      typeof VerificacionEntradaRepository.clearCache === "function"
    ) {
      VerificacionEntradaRepository.clearCache();
    }

    if (
      typeof VerificacionEntradaService !== "undefined" &&
      VerificacionEntradaService &&
      typeof VerificacionEntradaService.clearCache === "function"
    ) {
      VerificacionEntradaService.clearCache();
    }

    console.log("[CACHE] clearOperationalCaches_ :: OK");
    return true;
  } catch (error) {
    console.warn(
      "[CACHE] clearOperationalCaches_ :: ERROR",
      error && error.message
        ? error.message
        : String(error || "")
    );

    return false;
  }
}

/**
 * Limpia únicamente las cachés relacionadas con Traspasos.
 */
function clearTraspasosCaches_() {
  try {
    if (
      typeof ExcedentesRepository !== "undefined" &&
      ExcedentesRepository &&
      typeof ExcedentesRepository.clearCache === "function"
    ) {
      ExcedentesRepository.clearCache();
    }

    if (
      typeof TraspasosRepository !== "undefined" &&
      TraspasosRepository &&
      typeof TraspasosRepository.clearCache === "function"
    ) {
      TraspasosRepository.clearCache();
    }

    if (
      typeof ExistenciasRepository !== "undefined" &&
      ExistenciasRepository &&
      typeof ExistenciasRepository.clearCache === "function"
    ) {
      ExistenciasRepository.clearCache();
    }

    if (
      typeof GestorExcedentesService !== "undefined" &&
      GestorExcedentesService &&
      typeof GestorExcedentesService.clearCache === "function"
    ) {
      GestorExcedentesService.clearCache();
    } else if (
      typeof EstadoActualExcedentesService !== "undefined" &&
      EstadoActualExcedentesService &&
      typeof EstadoActualExcedentesService.clearCache === "function"
    ) {
      EstadoActualExcedentesService.clearCache();
    }

    if (
      typeof APPALMACENCache !== "undefined" &&
      APPALMACENCache &&
      typeof APPALMACENCache.clearPrototipoFolios === "function"
    ) {
      APPALMACENCache.clearPrototipoFolios();
    }

    console.log("[CACHE] clearTraspasosCaches_ :: OK");
    return true;
  } catch (error) {
    console.warn(
      "[CACHE] clearTraspasosCaches_ :: ERROR",
      error && error.message
        ? error.message
        : String(error || "")
    );

    return false;
  }
}

/**
 * Limpia únicamente las cachés del módulo Verificación de entrada.
 * No debe ejecutarse después de cada caja escaneada.
 */
function clearVerificacionEntradaCaches_() {
  try {
    if (
      typeof VerificacionEntradaRepository !== "undefined" &&
      VerificacionEntradaRepository &&
      typeof VerificacionEntradaRepository.clearCache === "function"
    ) {
      VerificacionEntradaRepository.clearCache();
    }

    if (
      typeof VerificacionEntradaService !== "undefined" &&
      VerificacionEntradaService &&
      typeof VerificacionEntradaService.clearCache === "function"
    ) {
      VerificacionEntradaService.clearCache();
    }

    console.log(
      "[CACHE] clearVerificacionEntradaCaches_ :: OK"
    );

    return true;
  } catch (error) {
    console.warn(
      "[CACHE] clearVerificacionEntradaCaches_ :: ERROR",
      error && error.message
        ? error.message
        : String(error || "")
    );

    return false;
  }
}

/**
 * Prueba de integración de las utilidades y las cinco hojas VE-*.
 * No escribe información.
 */
// =========================================================
// PRUEBA DE INTEGRACIÓN DE VERIFICACIÓN DE ENTRADA
// =========================================================
function testVeUtilities_() {
  const trace = perfStart_("VE_TEST_UTILITIES", {
    test: true
  });

  try {
    const sheetKeys = [
      "VERIFICACION_ENTRADA_SESIONES",
      "VERIFICACION_ENTRADA_DETALLE",
      "VERIFICACION_ENTRADA_CAJAS",
      "VERIFICACION_ENTRADA_EVENTOS",
      "VERIFICACION_ENTRADA_EQUIVALENCIAS"
    ];

    const headersBySheetKey = {
      VERIFICACION_ENTRADA_SESIONES:
        VERIFICACION_ENTRADA_HEADERS.SESIONES,
      VERIFICACION_ENTRADA_DETALLE:
        VERIFICACION_ENTRADA_HEADERS.DETALLE,
      VERIFICACION_ENTRADA_CAJAS:
        VERIFICACION_ENTRADA_HEADERS.CAJAS,
      VERIFICACION_ENTRADA_EVENTOS:
        VERIFICACION_ENTRADA_HEADERS.EVENTOS,
      VERIFICACION_ENTRADA_EQUIVALENCIAS:
        VERIFICACION_ENTRADA_HEADERS.EQUIVALENCIAS
    };

    const result = sheetKeys.map(function(sheetKey) {
      const config = SHEETS[sheetKey];

      if (!config) {
        throw new Error("No existe SHEETS." + sheetKey);
      }

      if (config.file !== "GESTION2") {
        throw new Error(
          "La hoja " + sheetKey + " debe apuntar a GESTION2."
        );
      }

      const expectedWidth = Number(
        VERIFICACION_ENTRADA_EXPECTED_WIDTHS[sheetKey] || 0
      );

      if (expectedWidth <= 0) {
        throw new Error(
          "No existe ancho esperado para " + sheetKey + "."
        );
      }

      const expectedHeaders = headersBySheetKey[sheetKey];

      if (
        !Array.isArray(expectedHeaders) ||
        expectedHeaders.length !== expectedWidth
      ) {
        throw new Error(
          "Contrato de encabezados inválido para " + sheetKey + "."
        );
      }

      const sheet = getSheetByKey_(sheetKey, trace);
      const dimensionsStartedAt = Date.now();
      const lastRow = sheet.getLastRow();
      const lastColumn = sheet.getLastColumn();

      perfMark_(trace, "SHEET_DIMENSIONS_READY", {
        sheetKey: sheetKey,
        elapsedMs: Date.now() - dimensionsStartedAt,
        lastRow: lastRow,
        lastColumn: lastColumn,
        expectedWidth: expectedWidth
      });

      if (lastColumn !== expectedWidth) {
        throw new Error(
          "Ancho incorrecto en " +
          sheetKey +
          ". Esperado: " +
          expectedWidth +
          ", encontrado: " +
          lastColumn +
          "."
        );
      }

      const headerStartedAt = Date.now();
      const actualHeaders = sheet
        .getRange(1, 1, 1, expectedWidth)
        .getDisplayValues()[0]
        .map(function(value) {
          return toStrUpper_(value);
        });

      perfMark_(trace, "SHEET_HEADERS_READ", {
        sheetKey: sheetKey,
        elapsedMs: Date.now() - headerStartedAt,
        headers: actualHeaders.length
      });

      const mismatches = [];

      expectedHeaders.forEach(function(expected, index) {
        const actual = actualHeaders[index];
        const normalizedExpected = toStrUpper_(expected);

        if (actual !== normalizedExpected) {
          mismatches.push({
            column: index + 1,
            expected: normalizedExpected,
            actual: actual
          });
        }
      });

      if (mismatches.length > 0) {
        throw new Error(
          "Encabezados incorrectos en " +
          sheetKey +
          ": " +
          JSON.stringify(mismatches.slice(0, 10))
        );
      }

      return {
        sheetKey: sheetKey,
        fileKey: config.file,
        sheetName: sheet.getName(),
        lastRow: lastRow,
        lastColumn: lastColumn,
        expectedWidth: expectedWidth,
        widthOk: true,
        headersOk: true
      };
    });

    perfMark_(trace, "ALL_SHEETS_RESOLVED", {
      sheets: result.length
    });

    const responseChars = perfMeasureJsonChars_(result);

    perfMark_(trace, "RESPONSE_READY", {
      responseChars: responseChars
    });

    perfEnd_(trace, "ok", {
      sheets: result.length,
      responseChars: responseChars
    });

    return result;
  } catch (error) {
    perfFail_(trace, error);
    throw error;
  }
}
