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
 * - Invalidar de forma específica las cachés de UBICACIONES_MAXMIN.
 * - Verificar contratos de hojas del módulo Verificación de entrada.
 * - Validar y normalizar contratos documentales de Gestión de Material.
 * - Validar los contratos físicos del módulo de Reabastecimiento, incluidos los
 *   nueve campos de detalle sin consecutivo de partida.
 * - Generar contextos temporales, folios y consecutivos de Reabastecimiento.
 * - Invalidar selectivamente las cachés del dominio de Reabastecimiento.
 * - Administrar claves COTIZACION_NUM, identificadores y consecutivos diarios.
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
 * - COTIZACION_NUM se trata siempre como texto, nunca como número.
 * - La unicidad técnica se confirma bajo ScriptLock en el repositorio.
 * - Los folios y consecutivos de Reabastecimiento se calculan bajo el mismo
 *   ScriptLock que protege su persistencia.
 * - Las trazas finalizadas no aceptan nuevas marcas.
 * - Las limpiezas de caché toleran dependencias opcionales ausentes.
 * - Los Controllers utilizan execController_(controllerName, label, executor).
 *
 * @author Sigifredo de la Cruz Ramos
 * @version APPALMACEN-UTILIDADES-DATOS-2026-11-12-07
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
function getRowsByKey_(sheetKey, trace) {
  const key = String(sheetKey || "").trim();
  const sheet = getSheetByKey_(key, trace);
  const dimensionsStartedAt = Date.now();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  perfMark_(trace, "SHEET_DIMENSIONS_READY", {
    sheetKey: key,
    elapsedMs: Date.now() - dimensionsStartedAt,
    lastRow,
    lastColumn
  });

  if (lastRow < 2 || lastColumn < 1) {
    perfMark_(trace, "SHEET_ROWS_READ_SKIPPED", {
      sheetKey: key,
      reason: "NO_DATA_ROWS",
      rows: 0
    });
    return [];
  }

  const readStartedAt = Date.now();
  const rows = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const elapsedMs = Date.now() - readStartedAt;
  perfMark_(trace, "SHEET_ROWS_READ", {
    sheetKey: key,
    elapsedMs,
    rows: rows.length,
    width: lastColumn,
    cells: rows.length * lastColumn
  });
  perfWarnSlow_(trace, "SLOW_SHEET_READ", elapsedMs,
    perfConfig_(trace).WARN_SHEET_READ_MS,
    { sheetKey: key, rows: rows.length, width: lastColumn });
  return rows;
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
    perfConfig_(trace).WARN_SHEET_READ_MS,
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
    perfConfig_(trace).WARN_SHEET_WRITE_MS,
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

/**
 * Lee una única fila física con ancho controlado.
 *
 * Evita cargar el rango completo cuando el consumidor ya conoce el número de
 * fila. No incluye encabezados y no modifica la hoja.
 *
 * @param {string} sheetKey Clave definida en SHEETS.
 * @param {*} rowNumber Número físico de fila, base uno.
 * @param {number} width Ancho exacto del contrato.
 * @param {Object=} trace Traza opcional de rendimiento.
 * @return {?Array<*>} Fila leída o null cuando está fuera del rango utilizado.
 * @throws {RangeError} Si rowNumber o width son inválidos.
 */
/**
 * Elimina filas cuya columna coincide exactamente con un texto normalizado.
 *
 * Debe ejecutarse bajo un ScriptLock externo. Las filas se eliminan de abajo
 * hacia arriba para conservar válidos los números físicos pendientes.
 *
 * @param {string} sheetKey Clave configurada en SHEETS.
 * @param {number} width Ancho físico esperado.
 * @param {number} columnIndex Índice base cero de la columna clave.
 * @param {*} value Valor buscado.
 * @param {Object=} trace Traza opcional.
 * @return {{deleted:number, rowNumbers:!Array<number>}}
 */
function deleteRowsByTextColumnUnderLock_(
  sheetKey,
  width,
  columnIndex,
  value,
  trace
) {
  const safeWidth = Math.floor(Number(width));
  const safeColumnIndex = Math.floor(Number(columnIndex));
  const normalizedValue = toStrUpper_(value);
  if (!Number.isInteger(safeWidth) || safeWidth < 1) {
    throw new RangeError("width debe ser un entero mayor que cero.");
  }
  if (
    !Number.isInteger(safeColumnIndex) ||
    safeColumnIndex < 0 ||
    safeColumnIndex >= safeWidth
  ) {
    throw new RangeError("columnIndex está fuera del ancho de " + sheetKey + ".");
  }
  if (!normalizedValue) return { deleted: 0, rowNumbers: [] };

  const rows = readSheetRows_(sheetKey, safeWidth, trace);
  const rowNumbers = [];
  rows.forEach(function(row, index) {
    if (toStrUpper_(row[safeColumnIndex]) === normalizedValue) {
      rowNumbers.push(index + 2);
    }
  });
  const sheet = getSheetByKey_(sheetKey, trace);
  rowNumbers.slice().sort(function(left, right) {
    return right - left;
  }).forEach(function(rowNumber) {
    sheet.deleteRow(rowNumber);
  });
  perfMark_(trace, "SHEET_ROWS_DELETED", {
    sheetKey: sheetKey,
    deleted: rowNumbers.length
  });
  return { deleted: rowNumbers.length, rowNumbers: rowNumbers };
}

function readRowAt_(sheetKey, rowNumber, width, trace) {
  const safeRowNumber = Math.floor(Number(rowNumber));
  const safeWidth = Math.floor(Number(width));

  if (!Number.isInteger(safeRowNumber) || safeRowNumber < 2) {
    throw new RangeError("rowNumber debe ser una fila de datos válida.");
  }
  if (!Number.isInteger(safeWidth) || safeWidth < 1) {
    throw new RangeError("width debe ser un entero mayor que cero.");
  }

  const sheet = getSheetByKey_(sheetKey, trace);
  const lastRow = sheet.getLastRow();
  if (safeRowNumber > lastRow) {
    perfMark_(trace, "SHEET_SINGLE_ROW_NOT_FOUND", {
      sheetKey: String(sheetKey || ""),
      rowNumber: safeRowNumber,
      lastRow: lastRow
    });
    return null;
  }

  const startedAt = Date.now();
  const row = sheet
    .getRange(safeRowNumber, 1, 1, safeWidth)
    .getValues()[0];
  const elapsedMs = Date.now() - startedAt;

  perfMark_(trace, "SHEET_SINGLE_ROW_READ", {
    sheetKey: String(sheetKey || ""),
    rowNumber: safeRowNumber,
    width: safeWidth,
    elapsedMs: elapsedMs
  });
  perfWarnSlow_(
    trace,
    "SLOW_SHEET_SINGLE_ROW_READ",
    elapsedMs,
    perfConfig_(trace).WARN_SHEET_READ_MS,
    { sheetKey: String(sheetKey || ""), width: safeWidth }
  );
  return row;
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
/**
 * Construye un contexto temporal con precisión de minuto.
 *
 * Este contrato corresponde a los campos FECHA y HORA del módulo de
 * Reabastecimiento. Se genera una sola instancia Date para impedir diferencias
 * entre la fecha y la hora cuando la operación cruza un cambio de minuto o día.
 *
 * @param {Date=} current Instante opcional para pruebas deterministas.
 * @return {{fecha:string, hora:string, fechaFolio:string, ahora:Date}}
 * @throws {TypeError} Si current no es una fecha válida.
 */
function getReabastecimientoTemporalContext_(current) {
  const instant = current === undefined ? now_() : current;
  if (!isValidDate_(instant)) {
    throw new TypeError(
      "getReabastecimientoTemporalContext_: current debe ser una fecha válida."
    );
  }
  const timezone = getScriptTz_();
  const formats =
    typeof REABASTECIMIENTO_CONFIG !== "undefined" &&
    REABASTECIMIENTO_CONFIG &&
    REABASTECIMIENTO_CONFIG.FORMATOS
      ? REABASTECIMIENTO_CONFIG.FORMATOS
      : {};
  const folio =
    typeof REABASTECIMIENTO_CONFIG !== "undefined" &&
    REABASTECIMIENTO_CONFIG &&
    REABASTECIMIENTO_CONFIG.FOLIO
      ? REABASTECIMIENTO_CONFIG.FOLIO
      : {};
  return {
    fecha: Utilities.formatDate(
      instant,
      timezone,
      String(formats.FECHA || "dd/MM/yyyy")
    ),
    hora: Utilities.formatDate(
      instant,
      timezone,
      String(formats.HORA || "HH:mm")
    ),
    fechaFolio: Utilities.formatDate(
      instant,
      timezone,
      String(folio.FORMATO_FECHA || "yyyyMMdd")
    ),
    ahora: new Date(instant.getTime())
  };
}

/**
 * Completa un entero positivo con ceros a la izquierda.
 *
 * @param {*} value Entero positivo o cero.
 * @param {*} digits Cantidad exacta de dígitos.
 * @param {string=} fieldName Nombre funcional para mensajes de error.
 * @return {string} Valor textual con longitud fija.
 * @throws {RangeError} Si el valor no cabe en la longitud especificada.
 */
function padPositiveInteger_(value, digits, fieldName) {
  const number = Math.floor(Number(value));
  const width = Math.floor(Number(digits));
  const label = String(fieldName || "consecutivo");
  if (!Number.isInteger(number) || number < 0) {
    throw new RangeError(label + " debe ser un entero no negativo.");
  }
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError("digits debe ser un entero mayor que cero.");
  }
  const text = String(number);
  if (text.length > width) {
    throw new RangeError(
      label + " excede la longitud configurada de " + width + " dígitos."
    );
  }
  return text.padStart(width, "0");
}

/**
 * Construye un folio de solicitud de Reabastecimiento.
 *
 * Esta función es pura: no consulta hojas ni garantiza unicidad. El Repository
 * debe calcular el consecutivo y persistir el folio bajo el mismo ScriptLock.
 *
 * @param {string} dateToken Fecha yyyyMMdd generada por el servidor.
 * @param {*} consecutive Consecutivo diario.
 * @return {string} Folio con formato REA-yyyyMMddNN.
 */
function buildReabastecimientoFolio_(dateToken, consecutive) {
  if (
    typeof REABASTECIMIENTO_CONFIG === "undefined" ||
    !REABASTECIMIENTO_CONFIG ||
    !REABASTECIMIENTO_CONFIG.FOLIO
  ) {
    throw new Error("REABASTECIMIENTO_CONFIG.FOLIO no está disponible.");
  }
  const config = REABASTECIMIENTO_CONFIG.FOLIO;
  const normalizedDate = String(dateToken || "").trim();
  if (!/^\d{8}$/.test(normalizedDate)) {
    throw new Error("dateToken debe usar el formato yyyyMMdd.");
  }
  const safeConsecutive = Math.floor(Number(consecutive));
  const maximum = Number(config.MAX_SOLICITUDES_DIARIAS || 99);
  if (
    !Number.isInteger(safeConsecutive) ||
    safeConsecutive < 1 ||
    safeConsecutive > maximum
  ) {
    throw new RangeError(
      "El consecutivo diario debe estar entre 1 y " + maximum + "."
    );
  }
  return (
    String(config.PREFIJO || "REA-") +
    normalizedDate +
    padPositiveInteger_(
      safeConsecutive,
      Number(config.CONSECUTIVO_DIGITOS || 2),
      "ID_SOLICITUDCONSECUTIVO"
    )
  );
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
function perfConfig_(traceOrModule) {
  const moduleName = typeof traceOrModule === "string"
    ? traceOrModule
    : String(traceOrModule?.metadata?.module || "");

  if (
    moduleName === "UBICACIONES_MAXMIN" &&
    typeof UBICACIONES_MAXMIN_CONFIG !== "undefined" &&
    UBICACIONES_MAXMIN_CONFIG?.PERFORMANCE
  ) {
    return UBICACIONES_MAXMIN_CONFIG.PERFORMANCE;
  }
  if (
    moduleName === "REABASTECIMIENTO" &&
    typeof REABASTECIMIENTO_CONFIG !== "undefined" &&
    REABASTECIMIENTO_CONFIG &&
    REABASTECIMIENTO_CONFIG.PERFORMANCE
  ) {
    return REABASTECIMIENTO_CONFIG.PERFORMANCE;
  }
  if (
    typeof VERIFICACION_ENTRADA !== "undefined" &&
    VERIFICACION_ENTRADA?.PERFORMANCE
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

  const cfg = perfConfig_(trace);
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

/** Mide una etapa síncrona y conserva el error original. */
function perfMeasure_(trace, stage, executor, metadata) {
  if (typeof executor !== "function") {
    throw new TypeError("perfMeasure_: executor debe ser una función.");
  }
  const startedAt = Date.now();
  try {
    const result = executor();
    perfMark_(trace, stage, Object.assign({}, metadata || {}, {
      elapsedMs: Date.now() - startedAt,
      ok: true
    }));
    return result;
  } catch (error) {
    perfMark_(trace, stage + "_FAILED", Object.assign({}, metadata || {}, {
      elapsedMs: Date.now() - startedAt,
      ok: false,
      message: error?.message || String(error || "")
    }));
    throw error;
  }
}

/** Finaliza y registra una traza. */
function perfEnd_(trace, status, metadata) {
  if (!trace || trace.ended === true) return null;

  trace.ended = true;

  const cfg = perfConfig_(trace);
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

  /*
   * Registro de rendimiento (switch APPALMACEN_RENDIMIENTO.ENABLED): si hay un
   * colector activo en esta ejecución, la traza se devuelve al navegador.
   */
  if (typeof appPerfSinkPush_ === "function") appPerfSinkPush_(result);

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
      perfConfig_(trace).WARN_LOCK_WAIT_MS,
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
/**
 * Ejecuta una operación de Controller con trazabilidad uniforme.
 *
 * CONTRATO
 * execController_(controllerName, label, executor)
 *
 * El tercer argumento debe ser la función ejecutora. La validación ocurre antes
 * de iniciar la traza para generar un error accionable cuando un Controller
 * invierte el orden de los argumentos.
 *
 * SEGURIDAD
 * - No registra argumentos ni payloads completos.
 * - Registra nombre del Controller, operación, duración y error.
 * - Conserva el código funcional del error cuando existe.
 *
 * @param {*} controllerName Nombre lógico del Controller.
 * @param {*} label Nombre corto de la operación.
 * @param {function(): *} executor Operación delegada.
 * @return {*} Resultado serializable de la operación.
 * @throws {TypeError} Si el contrato de invocación es inválido.
 * @throws {Error} Si la operación delegada falla.
 */
function execController_(controllerName, label, executor) {
  const safeControllerName = String(controllerName || "").trim();
  const safeLabel = String(label || "").trim();

  if (!safeControllerName) {
    throw new TypeError("execController_: controllerName es obligatorio.");
  }
  if (!safeLabel) {
    throw new TypeError("execController_: label es obligatorio.");
  }
  if (typeof executor !== "function") {
    throw new TypeError(
      "execController_: executor debe ser una función. " +
      "Firma esperada: execController_(controllerName, label, executor)."
    );
  }

  const startedAt = Date.now();
  const logPrefix = "[" + safeControllerName + "] " + safeLabel;

  try {
    console.log(logPrefix + " :: INICIO");
    const result = executor();
    console.log(logPrefix + " :: OK", {
      durationMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    console.error(logPrefix + " :: ERROR message", error && error.message);
    console.error(logPrefix + " :: ERROR stack", error && error.stack);
    console.error(logPrefix + " :: ERROR raw", error);

    const wrappedError = new Error(
      error && error.message
        ? error.message
        : "Error en " + safeControllerName + "." + safeLabel
    );
    if (error && error.code) {
      wrappedError.code = error.code;
    }
    throw wrappedError;
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
      typeof UbicacionesMaxMinRepository !== "undefined" &&
      UbicacionesMaxMinRepository &&
      typeof UbicacionesMaxMinRepository.clearCache === "function"
    ) {
      UbicacionesMaxMinRepository.clearCache();
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
      typeof DocumentosRepository !== "undefined" &&
      DocumentosRepository &&
      typeof DocumentosRepository.clearCache === "function"
    ) {
      DocumentosRepository.clearCache();
    }
    if (
      typeof DocumentosDetalleRepository !== "undefined" &&
      DocumentosDetalleRepository &&
      typeof DocumentosDetalleRepository.clearCache === "function"
    ) {
      DocumentosDetalleRepository.clearCache();
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

    clearReabastecimientoCaches_();

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
 * Limpia las cachés relacionadas con FormularioUbicacionesMaxMin.
 *
 * Debe invocarse después de una escritura confirmada para impedir que el
 * bootstrap compartido vuelva a mostrar como pendiente una fila ya capturada.
 * La función tolera dependencias opcionales ausentes y no propaga errores de
 * limpieza porque la persistencia principal pudo haberse completado.
 *
 * @return {boolean} true cuando finaliza sin errores; false en caso contrario.
 */
function clearUbicacionesMaxMinCaches_(options) {
  const config = options || {};
  try {
    if (
      config.skipRepository !== true &&
      typeof UbicacionesMaxMinRepository !== "undefined" &&
      UbicacionesMaxMinRepository &&
      typeof UbicacionesMaxMinRepository.clearCache === "function"
    ) {
      UbicacionesMaxMinRepository.clearCache();
    }

    if (
      typeof APPALMACENCache !== "undefined" &&
      APPALMACENCache &&
      typeof APPALMACENCache.clearUbicacionesMaxMin === "function"
    ) {
      APPALMACENCache.clearUbicacionesMaxMin();
    }

    console.log("[CACHE] clearUbicacionesMaxMinCaches_ :: OK");
    return true;
  } catch (error) {
    console.warn(
      "[CACHE] clearUbicacionesMaxMinCaches_ :: ERROR",
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
 * Limpia únicamente cachés del dominio de Reabastecimiento.
 *
 * Tolera módulos todavía no instalados y no invalida cachés ajenas al dominio.
 * Debe ejecutarse después de una escritura confirmada de solicitud, partida o
 * detalle. No debe utilizarse para compensar errores de persistencia.
 *
 * @return {boolean} true cuando concluye sin errores.
 */
function clearReabastecimientoCaches_() {
  try {
    const dependencies = [
      typeof ReabastecimientoSolicitudesRepository !== "undefined"
        ? ReabastecimientoSolicitudesRepository
        : null,
      typeof ReabastecimientoPartidasRepository !== "undefined"
        ? ReabastecimientoPartidasRepository
        : null,
      typeof ReabastecimientoDetallesRepository !== "undefined"
        ? ReabastecimientoDetallesRepository
        : null
    ];
    dependencies.forEach(function(dependency) {
      if (dependency && typeof dependency.clearCache === "function") {
        dependency.clearCache();
      }
    });
    if (
      typeof APPALMACENCache !== "undefined" &&
      APPALMACENCache &&
      typeof APPALMACENCache.clearReabastecimiento === "function"
    ) {
      APPALMACENCache.clearReabastecimiento();
    }
    console.log("[CACHE] clearReabastecimientoCaches_ :: OK");
    return true;
  } catch (error) {
    console.warn(
      "[CACHE] clearReabastecimientoCaches_ :: ERROR",
      error && error.message ? error.message : String(error || "")
    );
    return false;
  }
}

// =========================================================
// GESTIÓN DE MATERIAL: UTILIDADES DOCUMENTALES
// =========================================================
/**
 * Utilidades compartidas por DocumentosRepository y
 * DocumentosDetalleRepository.
 *
 * Estas funciones validan contratos, normalizan claves y ejecutan operaciones
 * de infraestructura. No contienen reglas de negocio específicas de una vista.
 *
 * Dependencias:
 * - GESTION_MATERIAL_DOCUMENTOS.
 * - GESTION_MATERIAL_DOCUMENTOS_HEADERS.
 * - GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS.
 *
 * @version MAT-UTIL-2026-10-26-01
 */
// =========================================================
// VALIDACIÓN ESTRUCTURAL Y NORMALIZACIÓN DE CONTRATOS
// =========================================================

/**
 * Determina si un valor es un objeto plano utilizable como payload.
 *
 * @param {*} value Valor por evaluar.
 * @return {boolean}
 */
function isPlainObject_(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Exige un objeto plano y devuelve el mismo objeto.
 *
 * @param {*} value Valor recibido.
 * @param {string} argumentName Nombre funcional del argumento.
 * @return {Object}
 * @throws {TypeError} Cuando el valor no es un objeto plano.
 */
function requirePlainObject_(value, argumentName) {
  if (!isPlainObject_(value)) {
    throw new TypeError(
      String(argumentName || "payload") + " debe ser un objeto válido."
    );
  }

  return value;
}

/**
 * Normaliza texto sin convertirlo a mayúsculas y valida su longitud.
 *
 * @param {*} value Valor original.
 * @param {Object=} options Opciones de validación.
 * @param {string=} options.fieldName Nombre del campo para mensajes.
 * @param {boolean=} options.required Indica si el texto es obligatorio.
 * @param {number=} options.maxLength Longitud máxima permitida.
 * @return {string}
 */
function normalizeTextField_(value, options) {
  const opts = options || {};
  const fieldName = String(opts.fieldName || "campo");
  const required = opts.required === true;
  const maxLength = Math.max(0, Number(opts.maxLength || 0));
  const normalized = String(value == null ? "" : value).trim();

  if (required && !normalized) {
    throw new Error(fieldName + " es obligatorio.");
  }

  if (maxLength > 0 && normalized.length > maxLength) {
    throw new Error(
      fieldName + " excede la longitud máxima de " + maxLength + " caracteres."
    );
  }

  return normalized;
}

/**
 * Normaliza COTIZACION_NUM como texto obligatorio e inmutable.
 * No lo convierte a número para conservar ceros iniciales y evitar notación
 * científica en Google Sheets.
 *
 * @param {*} value Valor recibido.
 * @return {string}
 */
function normalizeCotizacionNum_(value) {
  const limits =
    typeof GESTION_MATERIAL_DOCUMENTOS !== "undefined" &&
    GESTION_MATERIAL_DOCUMENTOS &&
    GESTION_MATERIAL_DOCUMENTOS.LIMITES
      ? GESTION_MATERIAL_DOCUMENTOS.LIMITES
      : {};

  return normalizeTextField_(value, {
    fieldName: "COTIZACION_NUM",
    required: true,
    maxLength: Number(limits.COTIZACION_NUM_MAX_LENGTH || 100)
  });
}

/**
 * Convierte valores comunes de hoja o interfaz a SI, NO o PENDIENTE.
 *
 * @param {*} value Valor original.
 * @param {Object=} options Opciones.
 * @param {boolean=} options.allowPending Permite PENDIENTE y vacío.
 * @param {string=} options.fieldName Nombre del campo.
 * @return {string}
 */
function normalizeTriState_(value, options) {
  const opts = options || {};
  const allowPending = opts.allowPending !== false;
  const fieldName = String(opts.fieldName || "estado");
  const normalized = toStrUpper_(value);

  if (
    value === true ||
    normalized === "SI" ||
    normalized === "SÍ" ||
    normalized === "TRUE" ||
    normalized === "1"
  ) {
    return "SI";
  }

  if (
    value === false ||
    normalized === "NO" ||
    normalized === "FALSE" ||
    normalized === "0"
  ) {
    return "NO";
  }

  if (allowPending && (!normalized || normalized === "PENDIENTE")) {
    return "PENDIENTE";
  }

  throw new Error(
    fieldName + " debe ser SI, NO" +
      (allowPending ? " o PENDIENTE." : ".")
  );
}

/**
 * Valida y normaliza un valor contra un catálogo cerrado.
 *
 * @param {*} value Valor recibido.
 * @param {Object} enumObject Objeto de valores admitidos.
 * @param {Object=} options Opciones de validación.
 * @param {string=} options.fieldName Nombre del campo.
 * @param {boolean=} options.required Indica si es obligatorio.
 * @param {string=} options.defaultValue Valor por defecto.
 * @return {string}
 */
function normalizeEnumValue_(value, enumObject, options) {
  const opts = options || {};
  const fieldName = String(opts.fieldName || "campo");
  const normalized = toStrUpper_(value || opts.defaultValue);
  const allowed = Object.keys(enumObject || {}).map(function(key) {
    return toStrUpper_(enumObject[key]);
  });

  if (!normalized) {
    if (opts.required === true) {
      throw new Error(fieldName + " es obligatorio.");
    }
    return "";
  }

  if (allowed.indexOf(normalized) === -1) {
    throw new Error(
      fieldName + " contiene un valor no permitido: " + normalized + "."
    );
  }

  return normalized;
}

/**
 * Normaliza un monto monetario no negativo con dos decimales.
 *
 * @param {*} value Valor recibido.
 * @param {string=} fieldName Nombre del campo.
 * @return {number}
 */
function normalizeMoney_(value, fieldName) {
  if (value === "" || value == null) return 0;

  const number = Number(value);
  if (!isFinite(number) || number < 0) {
    throw new Error(
      String(fieldName || "monto") + " debe ser un número no negativo."
    );
  }

  return round2_(number);
}

// =========================================================
// CONTRATOS DE HOJAS
// =========================================================

/**
 * Valida ancho y encabezados físicos de una hoja configurada.
 *
 * @param {string} sheetKey Clave de SHEETS.
 * @param {ReadonlyArray<string>} expectedHeaders Encabezados esperados.
 * @param {Object=} trace Tracker de rendimiento opcional.
 * @return {{sheetKey:string, sheetName:string, width:number, headersOk:boolean}}
 */
function assertSheetContract_(sheetKey, expectedHeaders, trace) {
  const key = String(sheetKey || "").trim();
  const headers = Array.isArray(expectedHeaders)
    ? expectedHeaders.slice()
    : [];

  if (!key || !SHEETS[key]) {
    throw new Error("No existe la configuración SHEETS." + key + ".");
  }

  if (headers.length === 0) {
    throw new Error("No se definieron encabezados para " + key + ".");
  }

  const sheet = getSheetByKey_(key, trace);
  const actualWidth = sheet.getLastColumn();

  if (actualWidth !== headers.length) {
    throw new Error(
      "Ancho incorrecto en " + key + ". Esperado: " + headers.length +
      ", encontrado: " + actualWidth + "."
    );
  }

  const actualHeaders = sheet
    .getRange(1, 1, 1, headers.length)
    .getDisplayValues()[0]
    .map(toStrUpper_);

  const mismatches = [];
  headers.forEach(function(expected, index) {
    const normalizedExpected = toStrUpper_(expected);
    const actual = actualHeaders[index];

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
      "Encabezados incorrectos en " + key + ": " +
      JSON.stringify(mismatches.slice(0, 10))
    );
  }

  perfMark_(trace, "SHEET_CONTRACT_VALIDATED", {
    sheetKey: key,
    width: headers.length
  });

  return {
    sheetKey: key,
    sheetName: sheet.getName(),
    width: headers.length,
    headersOk: true
  };
}

/**
 * Resuelve dinámicamente la estructura de una hoja a partir de su fila 1.
 *
 * Las columnas se localizan por nombre de encabezado normalizado; la posición
 * física deja de ser un contrato. El ancho efectivo es la última columna con
 * encabezado no vacío.
 *
 * - requiredHeaders: deben existir; si falta alguno se lanza un error.
 * - extensionHeaders: columnas nuevas opcionales. Si faltan y
 *   options.appendMissing === true, se agregan al final de la fila 1. Solo debe
 *   solicitarse appendMissing dentro de un ScriptLock ya adquirido por el
 *   llamador; esta función nunca adquiere candados.
 * - Los encabezados duplicados se rechazan porque harían ambigua la escritura.
 *
 * @param {string} sheetKey Clave de SHEETS.
 * @param {ReadonlyArray<string>} requiredHeaders Encabezados obligatorios.
 * @param {ReadonlyArray<string>=} extensionHeaders Encabezados opcionales.
 * @param {{appendMissing:boolean=}=} options Opciones.
 * @param {Object=} trace Traza opcional.
 * @return {{sheetKey:string,width:number,headers:!Array<string>,index:!Object<string,number>,missing:!Array<string>}}
 */
function resolveSheetLayout_(sheetKey, requiredHeaders, extensionHeaders, options, trace) {
  const key = String(sheetKey || "").trim();
  const config = options || {};
  const sheet = getSheetByKey_(key, trace);
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const raw = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  return buildSheetLayout_(key, sheet, raw, requiredHeaders, extensionHeaders, config, trace);
}

/**
 * Construye la estructura de columnas a partir de una fila de encabezados ya
 * leída (sin llamadas adicionales a la hoja salvo que se agreguen extensiones).
 *
 * @param {string} key Clave de SHEETS.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet Hoja (para agregar extensiones).
 * @param {!Array<*>} headerRow Valores de la fila 1.
 * @param {ReadonlyArray<string>} requiredHeaders Encabezados obligatorios.
 * @param {ReadonlyArray<string>=} extensionHeaders Encabezados de extensión.
 * @param {{appendMissing:boolean=}} config Opciones.
 * @param {Object=} trace Traza opcional.
 * @return {!Object} Estructura {sheetKey,width,headers,index,missing}.
 * @private
 */
function buildSheetLayout_(key, sheet, headerRow, requiredHeaders, extensionHeaders, config, trace) {
  const required = (Array.isArray(requiredHeaders) ? requiredHeaders : []).map(toStrUpper_);
  const extension = (Array.isArray(extensionHeaders) ? extensionHeaders : []).map(toStrUpper_);
  const raw = (Array.isArray(headerRow) ? headerRow : []).map(toStrUpper_);

  let width = 0;
  raw.forEach(function(header, position) {
    if (header) width = position + 1;
  });
  const headers = raw.slice(0, width);
  const index = Object.create(null);
  const duplicates = [];
  headers.forEach(function(header, position) {
    if (!header) return;
    if (Object.prototype.hasOwnProperty.call(index, header)) {
      duplicates.push(header);
      return;
    }
    index[header] = position;
  });
  if (duplicates.length) {
    const duplicateError = new Error(
      "Encabezados duplicados en " + key + ": " + duplicates.join(", ") + "."
    );
    duplicateError.code = "SHEET_HEADERS_DUPLICATED";
    throw duplicateError;
  }

  const missingRequired = required.filter(function(header) {
    return !Object.prototype.hasOwnProperty.call(index, header);
  });
  if (missingRequired.length) {
    const missingError = new Error(
      "Faltan encabezados obligatorios en " + key + ": " + missingRequired.join(", ") + "."
    );
    missingError.code = "SHEET_HEADERS_MISSING";
    throw missingError;
  }

  let missing = extension.filter(function(header) {
    return !Object.prototype.hasOwnProperty.call(index, header);
  });
  if (missing.length && config && config.appendMissing === true) {
    const requiredColumns = width + missing.length;
    const maxColumns = sheet.getMaxColumns();
    if (requiredColumns > maxColumns) {
      sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
    }
    sheet.getRange(1, width + 1, 1, missing.length).setValues([missing]);
    missing.forEach(function(header, offset) {
      index[header] = width + offset;
      headers.push(header);
    });
    width += missing.length;
    perfMark_(trace, "SHEET_HEADERS_APPENDED", { sheetKey: key, appended: missing.length });
    missing = [];
  }

  perfMark_(trace, "SHEET_LAYOUT_RESOLVED", {
    sheetKey: key,
    width: width,
    missingExtensions: missing.length
  });

  return {
    sheetKey: key,
    width: width,
    headers: headers,
    index: index,
    missing: missing
  };
}

// =========================================================
// LECTURA DIRIGIDA POR CLAVE (sin leer la hoja completa)
// =========================================================
//
// Para validar pocos códigos en hojas de ~16 mil filas (CATALOGO,
// UBICACIONES_SURTIDO) leer la hoja entera cuesta 1.5–3.5 s. Esta utilidad:
//   1. lee SOLO la columna clave (una columna, ≈0.3 s);
//   2. ubica las filas coincidentes;
//   3. las agrupa en tramos contiguos (uniendo huecos pequeños) y lee cada
//      tramo con una sola llamada getValues().
// Si los tramos son demasiados, lee un único bloque desde la primera hasta la
// última coincidencia, que nunca es peor que leer la hoja completa.

/** Filas de separación que todavía se leen como un mismo tramo. */
var KEYED_READ_MAX_GAP_ = 150;
/** Máximo de tramos antes de leer un solo bloque envolvente. */
var KEYED_READ_MAX_RUNS_ = 6;

/**
 * Lee las filas cuyo valor en keyColumn coincide con alguna de las claves.
 *
 * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet Hoja de origen.
 * @param {number} keyColumn Columna clave (base 1).
 * @param {!Array<*>} keys Claves buscadas (se comparan en mayúsculas).
 * @param {number} width Columnas a devolver desde la columna 1.
 * @param {Object=} trace Traza opcional.
 * @param {string=} label Nombre de la etapa en la traza.
 * @return {!Array<{rowNumber:number, values:!Array<*>}>} Filas en orden físico.
 */
function readRowsMatchingKeys_(sheet, keyColumn, keys, width, trace, label) {
  const wanted = Object.create(null);
  (Array.isArray(keys) ? keys : []).forEach(function(key) {
    const value = toStrUpper_(key);
    if (value) wanted[value] = true;
  });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !Object.keys(wanted).length) return [];

  const startedAt = Date.now();
  const keyValues = sheet.getRange(2, keyColumn, lastRow - 1, 1).getValues();
  const rowNumbers = [];
  for (let i = 0; i < keyValues.length; i++) {
    if (wanted[toStrUpper_(keyValues[i][0])]) rowNumbers.push(i + 2);
  }
  const keyColumnMs = Date.now() - startedAt;
  if (!rowNumbers.length) {
    perfMark_(trace, label || "SHEET_KEYED_ROWS_READ", { elapsedMs: keyColumnMs, keys: Object.keys(wanted).length, matches: 0, blocks: 0 });
    return [];
  }

  // Tramos contiguos de filas coincidentes.
  const runs = [];
  let runStart = rowNumbers[0];
  let runEnd = rowNumbers[0];
  for (let i = 1; i < rowNumbers.length; i++) {
    if (rowNumbers[i] - runEnd <= KEYED_READ_MAX_GAP_) {
      runEnd = rowNumbers[i];
    } else {
      runs.push([runStart, runEnd]);
      runStart = runEnd = rowNumbers[i];
    }
  }
  runs.push([runStart, runEnd]);
  const blocks = runs.length > KEYED_READ_MAX_RUNS_
    ? [[rowNumbers[0], rowNumbers[rowNumbers.length - 1]]]
    : runs;

  const result = [];
  const columns = Math.max(1, Math.min(width, sheet.getLastColumn()));
  blocks.forEach(function(block) {
    const values = sheet.getRange(block[0], 1, block[1] - block[0] + 1, columns).getValues();
    values.forEach(function(row, offset) {
      if (wanted[toStrUpper_(row[keyColumn - 1])]) {
        result.push({ rowNumber: block[0] + offset, values: row });
      }
    });
  });
  perfMark_(trace, label || "SHEET_KEYED_ROWS_READ", {
    elapsedMs: Date.now() - startedAt,
    keyColumnMs: keyColumnMs,
    keys: Object.keys(wanted).length,
    matches: result.length,
    blocks: blocks.length,
    sourceRows: lastRow - 1
  });
  return result;
}

// =========================================================
// CACHÉ POR BLOQUES (valores mayores a 100 KB)
// =========================================================

/** Tamaño de cada bloque (CacheService admite hasta 100 KB por valor). */
var CHUNKED_CACHE_PART_CHARS_ = 90000;

/**
 * Guarda un valor serializable en CacheService dividido en bloques.
 * Estructura: <key>__META = {parts, chars} y <key>__0..n con el JSON.
 *
 * @param {string} key Clave base.
 * @param {*} value Valor serializable.
 * @param {number} ttlSeconds Vigencia en segundos.
 * @return {boolean} true si se guardó.
 */
function cachePutChunked_(key, value, ttlSeconds) {
  try {
    const json = JSON.stringify(value);
    const parts = Math.max(1, Math.ceil(json.length / CHUNKED_CACHE_PART_CHARS_));
    if (parts > 40) return false; // ~3.6 MB: demasiado grande para caché.
    const entries = {};
    for (let i = 0; i < parts; i++) {
      entries[key + "__" + i] = json.slice(i * CHUNKED_CACHE_PART_CHARS_, (i + 1) * CHUNKED_CACHE_PART_CHARS_);
    }
    entries[key + "__META"] = JSON.stringify({ parts: parts, chars: json.length });
    CacheService.getScriptCache().putAll(entries, Math.max(1, Math.floor(Number(ttlSeconds) || 60)));
    return true;
  } catch (error) {
    console.warn("[CACHE_CHUNKED] No se pudo guardar " + key, error && error.message);
    return false;
  }
}

/**
 * Lee un valor guardado con cachePutChunked_. Devuelve null si falta algún
 * bloque o el contenido está corrupto.
 *
 * @param {string} key Clave base.
 * @return {*} Valor o null.
 */
function cacheGetChunked_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const metaRaw = cache.get(key + "__META");
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    const keys = [];
    for (let i = 0; i < Number(meta.parts || 0); i++) keys.push(key + "__" + i);
    const values = cache.getAll(keys);
    let json = "";
    for (let i = 0; i < keys.length; i++) {
      if (typeof values[keys[i]] !== "string") return null;
      json += values[keys[i]];
    }
    if (json.length !== Number(meta.chars)) return null;
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

/** Elimina un valor guardado con cachePutChunked_. */
function cacheRemoveChunked_(key) {
  try {
    CacheService.getScriptCache().remove(key + "__META");
  } catch (error) {
    /* sin acción */
  }
}

/**
 * Crea un accesor de columnas por encabezado para un Repository.
 *
 * Conserva la estructura resuelta durante la ejecución actual. Las lecturas
 * toleran extensiones aún inexistentes (devuelven ""); las escrituras solicitan
 * get(trace, true) para agregar las extensiones faltantes bajo el ScriptLock del
 * llamador.
 *
 * CACHÉ PERSISTENTE OPCIONAL (options.persistentCache)
 * Con {keyPrefix, ttlSeconds, revision()} readTable() guarda la tabla en
 * CacheService junto con la revisión vigente y la reutiliza mientras la
 * revisión no cambie (≈60–100 ms contra 250–650 ms por hoja). Reglas:
 * - La revisión se lee ANTES de la hoja; así una copia nunca se etiqueta con
 *   una revisión más nueva que sus datos.
 * - Quien escribe debe llamar markDirty(): elimina la copia y, durante el
 *   resto de la ejecución, las lecturas vuelven a la hoja.
 * - El Service hace SpreadsheetApp.flush() antes de subir la revisión, para
 *   que otra ejecución no lea la hoja sin la escritura ya anunciada.
 *
 * @param {string} sheetKey Clave de SHEETS.
 * @param {ReadonlyArray<string>} requiredHeaders Encabezados obligatorios.
 * @param {ReadonlyArray<string>=} extensionHeaders Encabezados de extensión.
 * @param {{persistentCache?:{keyPrefix:string, ttlSeconds:number, revision:function():?number}}=} options
 * @return {!Object} Accesor inmutable.
 */
function createHeaderLayoutAccessor_(sheetKey, requiredHeaders, extensionHeaders, options) {
  let layout_ = null;
  const persist_ = options && options.persistentCache ? options.persistentCache : null;
  const persistKey_ = persist_ ? String(persist_.keyPrefix || "APPALMACEN_TABLE_") + sheetKey : "";
  /** true tras una escritura propia: no se usa ni se guarda la copia persistente. */
  let dirty_ = false;

  function get(trace, forWrite) {
    const write = forWrite === true;
    if (!layout_ || (write && layout_.missing.length > 0)) {
      layout_ = resolveSheetLayout_(
        sheetKey,
        requiredHeaders,
        extensionHeaders,
        { appendMissing: write },
        trace
      );
    }
    return layout_;
  }

  function read(row, layout, header) {
    const position = layout.index[toStrUpper_(header)];
    if (position === undefined || !Array.isArray(row)) return "";
    const value = row[position];
    return value == null ? "" : value;
  }

  function write(row, layout, header, value) {
    const position = layout.index[toStrUpper_(header)];
    if (position === undefined) {
      throw new Error("La hoja " + sheetKey + " no contiene el encabezado " + header + ".");
    }
    row[position] = value;
    return row;
  }

  function blankRow(layout) {
    return new Array(layout.width).fill("");
  }

  /**
   * Lee encabezados y datos con UNA sola llamada (getDataRange().getValues()).
   *
   * RENDIMIENTO: antes se hacían tres llamadas por hoja (fila 1, getLastRow y
   * rango de datos), ~150–600 ms por hoja según la bitácora del 20/11/2026.
   * La estructura resultante queda en memoria para las escrituras posteriores
   * de la misma ejecución.
   *
   * @param {Object=} trace Traza opcional.
   * @return {{layout:!Object, rows:!Array<!Array<*>>}} Filas de datos (sin encabezado).
   */
  function readTable(trace) {
    // 1. Copia persistente válida para la revisión actual.
    let revision = null;
    if (persist_ && !dirty_) {
      const cacheStartedAt = Date.now();
      try {
        const value = persist_.revision();
        revision = Number.isFinite(value) && value > 0 ? value : null;
      } catch (error) {
        revision = null;
      }
      const cached = revision !== null ? cacheGetChunked_(persistKey_) : null;
      if (cached && cached.r === revision && Array.isArray(cached.v) && cached.v.length) {
        const cachedValues = decodeTableValues_(cached.v);
        layout_ = buildSheetLayout_(sheetKey, null, cachedValues[0], requiredHeaders, extensionHeaders, { appendMissing: false }, trace);
        const cachedRows = cachedValues.slice(1);
        perfMark_(trace, "SHEET_TABLE_CACHE_HIT", {
          sheetKey: sheetKey,
          rows: cachedRows.length,
          revision: revision,
          elapsedMs: Date.now() - cacheStartedAt
        });
        return { layout: layout_, rows: cachedRows };
      }
    }

    // 2. Lectura de la hoja (una sola llamada).
    const sheet = getSheetByKey_(sheetKey, trace);
    const startedAt = Date.now();
    const values = sheet.getDataRange().getValues();
    const elapsedMs = Date.now() - startedAt;
    layout_ = buildSheetLayout_(
      sheetKey,
      sheet,
      values.length ? values[0] : [],
      requiredHeaders,
      extensionHeaders,
      { appendMissing: false },
      trace
    );
    const width = layout_.width;
    const rows = values.slice(1).map(function(row) {
      return row.length > width ? row.slice(0, width) : row;
    });
    perfMark_(trace, "SHEET_TABLE_READ", {
      sheetKey: sheetKey,
      rows: rows.length,
      width: width,
      elapsedMs: elapsedMs
    });

    // 3. Guarda la copia con la revisión leída ANTES de la hoja.
    if (persist_ && !dirty_ && revision !== null) {
      const header = values.length ? values[0].slice(0, width) : [];
      cachePutChunked_(
        persistKey_,
        { r: revision, v: encodeTableValues_([header].concat(rows)) },
        Number(persist_.ttlSeconds) || 60
      );
    }
    return { layout: layout_, rows: rows };
  }

  /**
   * Registra una escritura propia: descarta la copia persistente y obliga a
   * releer la hoja durante el resto de la ejecución.
   */
  function markDirty() {
    if (!persist_) return;
    dirty_ = true;
    cacheRemoveChunked_(persistKey_);
  }

  function columnIndex(layout, header) {
    const position = layout.index[toStrUpper_(header)];
    if (position === undefined) {
      throw new Error("La hoja " + sheetKey + " no contiene el encabezado " + header + ".");
    }
    return position;
  }

  function reset() {
    layout_ = null;
    dirty_ = false;
  }

  return Object.freeze({ get, read, write, blankRow, columnIndex, readTable, markDirty, reset });
}

/**
 * Prepara valores de hoja para JSON conservando las fechas
 * (Date → {"__d": epochMs}); JSON.stringify las convertiría en texto.
 */
function encodeTableValues_(values) {
  return values.map(function(row) {
    return row.map(function(value) {
      return value instanceof Date ? { __d: value.getTime() } : value;
    });
  });
}

/** Inverso de encodeTableValues_. */
function decodeTableValues_(values) {
  return values.map(function(row) {
    return row.map(function(value) {
      return value && typeof value === "object" && typeof value.__d === "number" ? new Date(value.__d) : value;
    });
  });
}

/**
 * Valida los contratos físicos de MAT_DOCUMENTOS y MAT_DOCUMENTODETALLE.
 * No escribe información.
 *
 * @param {Object=} trace Tracker opcional.
 * @return {Array<Object>}
 */
function assertMaterialDocumentSheets_(trace) {
  if (
    typeof GESTION_MATERIAL_DOCUMENTOS_HEADERS === "undefined" ||
    !GESTION_MATERIAL_DOCUMENTOS_HEADERS
  ) {
    throw new Error(
      "GESTION_MATERIAL_DOCUMENTOS_HEADERS no está disponible."
    );
  }

  return [
    assertSheetContract_(
      "MAT_DOCUMENTOS",
      GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTOS,
      trace
    ),
    assertSheetContract_(
      "MAT_DOCUMENTODETALLE",
      GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTODETALLE,
      trace
    )
  ];
}



/**
 * Valida los contratos físicos de las tres hojas de Reabastecimiento.
 *
 * La función no escribe información. Verifica que todas las hojas pertenezcan a
 * GESTION5 y que sus encabezados coincidan exactamente con Constants. El detalle
 * usa nueve columnas y se relaciona con la partida mediante solicitud + código.
 *
 * @param {Object=} trace Tracker opcional.
 * @return {!Array<!Object>} Contratos validados en orden lógico.
 */
function assertReabastecimientoSheets_(trace) {
  if (
    typeof REABASTECIMIENTO_HEADERS === "undefined" ||
    !REABASTECIMIENTO_HEADERS ||
    typeof REABASTECIMIENTO_EXPECTED_WIDTHS === "undefined" ||
    !REABASTECIMIENTO_EXPECTED_WIDTHS
  ) {
    throw new Error(
      "Los contratos de encabezados de Reabastecimiento no están disponibles."
    );
  }
  const extensions =
    typeof REABASTECIMIENTO_HEADERS_EXTENSION !== "undefined"
      ? REABASTECIMIENTO_HEADERS_EXTENSION
      : {};
  const contracts = [
    {
      sheetKey: "REABASTECIMIENTO_SOLICITUDES",
      headers: REABASTECIMIENTO_HEADERS.SOLICITUDES,
      extension: extensions.SOLICITUDES
    },
    {
      sheetKey: "REABASTECIMIENTO_PARTIDAS",
      headers: REABASTECIMIENTO_HEADERS.PARTIDAS,
      extension: extensions.PARTIDAS
    },
    {
      sheetKey: "REABASTECIMIENTO_DETALLES",
      headers: REABASTECIMIENTO_HEADERS.DETALLES,
      extension: extensions.DETALLES
    }
  ];
  return contracts.map(function(contract) {
    const descriptor = SHEETS[contract.sheetKey];
    if (!descriptor || descriptor.file !== "GESTION5") {
      throw new Error(
        contract.sheetKey + " debe estar configurada en GESTION5."
      );
    }
    /*
     * Las columnas se resuelven por nombre. Se valida que existan los
     * encabezados obligatorios; las extensiones faltantes se reportan sin
     * escribir en la hoja.
     */
    const layout = resolveSheetLayout_(
      contract.sheetKey,
      contract.headers,
      contract.extension,
      { appendMissing: false },
      trace
    );
    return {
      sheetKey: contract.sheetKey,
      sheetName: descriptor.name,
      width: layout.width,
      headersOk: true,
      extensionesPendientes: layout.missing
    };
  });
}

/**
 * Prueba de integración no destructiva de GESTION5.
 *
 * @return {!Array<!Object>} Resultado de validación de las tres hojas.
 */
function testReabastecimientoUtilities_() {
  const trace = perfStart_("REABASTECIMIENTO_TEST_UTILITIES", {
    module: "REABASTECIMIENTO",
    test: true
  });
  try {
    const result = assertReabastecimientoSheets_(trace);
    perfEnd_(trace, "ok", { sheets: result.length });
    return result;
  } catch (error) {
    perfFail_(trace, error, { module: "REABASTECIMIENTO" });
    throw error;
  }
}

// =========================================================
// BÚSQUEDA Y ACTUALIZACIÓN CONTROLADA POR FILA
// =========================================================

/**
 * Localiza filas físicas por igualdad exacta normalizada en una columna.
 * La comparación trata los valores como texto para preservar COTIZACION_NUM.
 *
 * @param {string} sheetKey Clave de SHEETS.
 * @param {number} width Ancho del contrato.
 * @param {number} columnIndex Índice base cero.
 * @param {*} value Valor buscado.
 * @param {Object=} trace Tracker opcional.
 * @return {Array<number>} Números de fila físicos, base uno.
 */
function findRowNumbersByTextColumn_(
  sheetKey,
  width,
  columnIndex,
  value,
  trace
) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const safeColumnIndex = Math.floor(Number(columnIndex));
  const normalizedValue = String(value == null ? "" : value).trim();

  if (
    !Number.isInteger(safeColumnIndex) ||
    safeColumnIndex < 0 ||
    safeColumnIndex >= safeWidth
  ) {
    throw new RangeError(
      "columnIndex está fuera del ancho de " + sheetKey + "."
    );
  }

  if (!normalizedValue) return [];

  const rows = readSheetRows_(sheetKey, safeWidth, trace);
  const result = [];

  rows.forEach(function(row, index) {
    const candidate = String(
      row[safeColumnIndex] == null ? "" : row[safeColumnIndex]
    ).trim();

    if (candidate === normalizedValue) {
      result.push(index + 2);
    }
  });

  return result;
}

/**
 * Escribe una fila completa en una posición física existente.
 * Debe ejecutarse bajo el mismo ScriptLock que protegió la lectura previa.
 *
 * @param {string} sheetKey Clave de SHEETS.
 * @param {number} rowNumber Número físico de fila, base uno.
 * @param {Array<*>} row Fila completa.
 * @param {number} width Ancho esperado.
 * @param {Object=} trace Tracker opcional.
 * @return {{updated:boolean, rowNumber:number}}
 */
function writeRowAt_(sheetKey, rowNumber, row, width, trace) {
  const safeRowNumber = Math.floor(Number(rowNumber));
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));

  if (!Number.isInteger(safeRowNumber) || safeRowNumber < 2) {
    throw new RangeError("rowNumber debe ser una fila de datos válida.");
  }

  if (!Array.isArray(row) || row.length !== safeWidth) {
    throw new Error(
      "La fila para " + sheetKey + " debe contener exactamente " +
      safeWidth + " columnas."
    );
  }

  const startedAt = Date.now();
  const sheet = getSheetByKey_(sheetKey, trace);
  sheet.getRange(safeRowNumber, 1, 1, safeWidth).setValues([row]);
  const elapsedMs = Date.now() - startedAt;

  perfMark_(trace, "SHEET_ROW_UPDATED", {
    sheetKey: sheetKey,
    rowNumber: safeRowNumber,
    width: safeWidth,
    elapsedMs: elapsedMs
  });

  perfWarnSlow_(
    trace,
    "SLOW_SHEET_ROW_UPDATE",
    elapsedMs,
    perfConfig_(trace).WARN_SHEET_WRITE_MS,
    {
      sheetKey: sheetKey,
      rowNumber: safeRowNumber,
      width: safeWidth
    }
  );

  return {
    updated: true,
    rowNumber: safeRowNumber
  };
}

// =========================================================
// IDENTIFICADORES Y CONSECUTIVOS
// =========================================================

/**
 * Genera un identificador técnico no secuencial, apto para filas internas.
 * La unicidad definitiva debe comprobarse en el repositorio bajo ScriptLock.
 *
 * @param {string} prefix Prefijo funcional.
 * @return {string}
 */
function generateTechnicalId_(prefix) {
  const safePrefix = toStrUpper_(prefix)
    .replace(/[^A-Z0-9_-]/g, "") || "ID";
  const timestamp = Utilities.formatDate(
    now_(),
    getScriptTz_(),
    "yyyyMMddHHmmssSSS"
  );
  const random = Utilities.getUuid()
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase();

  return safePrefix + "-" + timestamp + "-" + random;
}

/**
 * Obtiene el siguiente consecutivo del día a partir de filas ya normalizadas.
 * No realiza lecturas ni escrituras y debe invocarse bajo ScriptLock cuando se
 * use para insertar un documento.
 *
 * @param {Array<Object>} documents Documentos normalizados.
 * @param {string} dateText Fecha dd/MM/yyyy.
 * @return {number}
 */
function nextDailyConsecutive_(documents, dateText) {
  const normalizedDate = formatDate_(toDate_(dateText));
  if (!normalizedDate) {
    throw new Error("La fecha del consecutivo diario es inválida.");
  }

  let maximum = 0;
  (Array.isArray(documents) ? documents : []).forEach(function(document) {
    if (!document || formatDate_(toDate_(document.cotizacionFecha)) !== normalizedDate) {
      return;
    }

    const candidate = Math.floor(Number(document.idConsecutivoDiario || 0));
    if (candidate > maximum) maximum = candidate;
  });

  return maximum + 1;
}

// =========================================================
// CACHÉS Y PRUEBA DE INTEGRACIÓN DEL MÓDULO DOCUMENTAL
// =========================================================

/**
 * Limpia únicamente las cachés de los repositorios documentales cuando existan.
 *
 * @return {boolean}
 */
function clearDocumentosCaches_() {
  try {
    if (
      typeof DocumentosRepository !== "undefined" &&
      DocumentosRepository &&
      typeof DocumentosRepository.clearCache === "function"
    ) {
      DocumentosRepository.clearCache();
    }

    if (
      typeof DocumentosDetalleRepository !== "undefined" &&
      DocumentosDetalleRepository &&
      typeof DocumentosDetalleRepository.clearCache === "function"
    ) {
      DocumentosDetalleRepository.clearCache();
    }

    console.log("[CACHE] clearDocumentosCaches_ :: OK");
    return true;
  } catch (error) {
    console.warn(
      "[CACHE] clearDocumentosCaches_ :: ERROR",
      error && error.message ? error.message : String(error || "")
    );
    return false;
  }
}

/**
 * Prueba de integración de los contratos de MAT_DOCUMENTOS y
 * MAT_DOCUMENTODETALLE. No escribe información.
 *
 * @return {Array<Object>}
 */
function testMaterialDocumentUtilities_() {
  const trace = perfStart_("MAT_DOC_TEST_UTILITIES", {
    test: true
  });

  try {
    const result = assertMaterialDocumentSheets_(trace);
    perfEnd_(trace, "ok", {
      sheets: result.length
    });
    return result;
  } catch (error) {
    perfFail_(trace, error);
    throw error;
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
