/**
 * z0-APPALMACENRendimiento.gs
 *
 * @fileoverview Registro de rendimiento de TODA la aplicación APPALMACEN.
 *
 * Controlado por el switch APPALMACEN_RENDIMIENTO.ENABLED (z1-Constants.gs).
 * Con el switch en false ninguna función de este archivo mide, acumula ni
 * escribe: todas regresan de inmediato.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PIEZAS
 * ─────────────────────────────────────────────────────────────────────────
 * 1. isPerformanceLoggingEnabled_()
 *    Punto único de consulta del switch para todo el servidor.
 *
 * 2. COLECTOR DE TRAZAS (APP_PERF_SINK_)
 *    Cada llamada google.script.run es una ejecución independiente. Mientras
 *    el colector está activo, toda traza que termine con perfEnd_()
 *    (z0-UtilidadesDatos) se resume aquí. El despachador y el Controller de
 *    Reabastecimiento lo activan al iniciar y lo devuelven al navegador.
 *
 * 3. DESPACHADOR MEDIDO: APPALMACEN_invocarMedido(method, args)
 *    Con el switch encendido, el Shell redirige cada llamada de cualquier vista
 *    a esta función. Ejecuta el endpoint original, mide su tiempo y adjunta las
 *    etapas internas. El navegador desempaqueta la respuesta y la entrega a la
 *    vista exactamente como antes, por lo que las vistas no cambian.
 *    Reglas de seguridad: solo invoca funciones globales públicas (sin "_" al
 *    final), igual que google.script.run.
 *
 * 4. BITÁCORA: APPALMACENRendimiento_registrar(events)
 *    Guarda por lotes los eventos del navegador en la hoja
 *    APPALMACEN_RENDIMIENTO (GESTION5). Usa appendRow(), atómico, sin el
 *    ScriptLock de inventario, para no competir con la operación.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version APPALMACEN-RENDIMIENTO-2026-11-20-01
 */

// ============================================================================
// 1. SWITCH
// ============================================================================

/**
 * Indica si el registro de rendimiento está activo.
 * Lee APPALMACEN_RENDIMIENTO.ENABLED de z1-Constants.gs.
 *
 * @return {boolean}
 */
function isPerformanceLoggingEnabled_() {
  return typeof APPALMACEN_RENDIMIENTO !== "undefined" &&
    APPALMACEN_RENDIMIENTO &&
    APPALMACEN_RENDIMIENTO.ENABLED === true;
}

// ============================================================================
// 2. COLECTOR DE TRAZAS DEL SERVIDOR
// ============================================================================

/**
 * Trazas de la ejecución actual. null = colector inactivo.
 * @type {?Array<!Object>}
 * @private
 */
var APP_PERF_SINK_ = null;

/** Activa un colector vacío (solo con el switch encendido). */
function appPerfSinkReset_() {
  APP_PERF_SINK_ = isPerformanceLoggingEnabled_() ? [] : null;
}

/** Indica si el colector está activo en esta ejecución. */
function appPerfSinkActive_() {
  return Array.isArray(APP_PERF_SINK_);
}

/**
 * Agrega el resumen compacto de una traza finalizada.
 * Marca compacta: [etapa, ms del segmento, ms acumulado, {numéricos}?].
 *
 * @param {?Object} result Resultado de perfEnd_() o de una traza equivalente
 *     con {operation, status, totalMs, marks[]}.
 */
function appPerfSinkPush_(result) {
  try {
    if (!Array.isArray(APP_PERF_SINK_) || !result) return;
    const max = Number(APPALMACEN_RENDIMIENTO.SERVER.MAX_TRACES_PER_CALL || 25);
    if (APP_PERF_SINK_.length >= max) return;
    APP_PERF_SINK_.push({
      op: String(result.operation || ""),
      status: String(result.status || ""),
      ms: Number(result.totalMs || 0),
      marks: (Array.isArray(result.marks) ? result.marks : []).map(function(mark) {
        const compact = [String(mark.stage || ""), Number(mark.segmentMs || 0), Number(mark.totalMs || 0)];
        const numeric = appPerfNumericMetadata_(mark.metadata);
        if (numeric) compact.push(numeric);
        return compact;
      })
    });
  } catch (error) {
    console.warn("[APPALMACEN_RENDIMIENTO] No se pudo agregar la traza.", error && error.message);
  }
}

/**
 * Conserva solo valores numéricos y booleanos (rows, waitMs, elapsedMs…).
 * @private
 */
function appPerfNumericMetadata_(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const output = {};
  let count = 0;
  Object.keys(metadata).forEach(function(key) {
    const value = metadata[key];
    if (count >= 8) return;
    if (typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
      count += 1;
    }
  });
  return count ? output : null;
}

/** Devuelve las trazas acumuladas y desactiva el colector. */
function appPerfSinkDrain_() {
  const items = Array.isArray(APP_PERF_SINK_) ? APP_PERF_SINK_.slice() : [];
  APP_PERF_SINK_ = null;
  return items;
}

// ============================================================================
// 3. DESPACHADOR MEDIDO
// ============================================================================

/** Marcador que identifica una respuesta del despachador. */
var APP_PERF_ENVELOPE_KEY = "__appalmacenPerf";

/**
 * Ejecuta un endpoint público midiendo su tiempo y etapas internas.
 *
 * El Shell solo redirige llamadas aquí cuando el switch está encendido. Si se
 * apagó en el servidor mientras una página seguía abierta, la llamada se
 * ejecuta igual y solo se omiten las mediciones.
 *
 * @param {string} method Nombre de la función global (p. ej. "GestorExcedentesController_getDatos").
 * @param {Array<*>} args Argumentos originales.
 * @return {{__appalmacenPerf:number, result:*, perf:?Object}} Respuesta empaquetada.
 */
function APPALMACEN_invocarMedido(method, args) {
  const name = String(method == null ? "" : method).trim();
  if (
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
    /_$/.test(name) ||
    name === "APPALMACEN_invocarMedido"
  ) {
    throw new Error("Función no permitida: " + name);
  }
  const fn = globalThis[name];
  if (typeof fn !== "function") {
    throw new Error("La función " + name + " no está disponible en el servidor.");
  }

  const enabled = isPerformanceLoggingEnabled_();
  const startedAt = Date.now();
  if (enabled) appPerfSinkReset_();

  try {
    const result = fn.apply(null, Array.isArray(args) ? args : []);
    const response = { result: result, perf: null };
    response[APP_PERF_ENVELOPE_KEY] = 1;
    if (enabled && APPALMACEN_RENDIMIENTO.SERVER.RETURN_STAGES === true) {
      response.perf = {
        serverMs: Date.now() - startedAt,
        controller: [],
        services: appPerfSinkDrain_()
      };
    } else {
      appPerfSinkDrain_();
    }
    return response;
  } catch (error) {
    appPerfSinkDrain_();
    if (enabled && error && typeof error.message === "string" && error.message.indexOf("⟦serverMs=") === -1) {
      // El navegador extrae y elimina este marcador antes de mostrar el mensaje.
      error.message = error.message + " ⟦serverMs=" + (Date.now() - startedAt) + "⟧";
    }
    throw error;
  }
}

// ============================================================================
// 4. BITÁCORA PERSISTENTE
// ============================================================================

/**
 * Obtiene (o crea) la hoja de la bitácora unificada.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 * @private
 */
function appPerfLogSheet_() {
  const descriptor = SHEETS[APPALMACEN_RENDIMIENTO.SHEET_KEY];
  const spreadsheet = getSpreadsheetByFileKey_(descriptor.file);
  let sheet = spreadsheet.getSheetByName(descriptor.name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(descriptor.name);
    sheet.getRange(1, 1, 1, APPALMACEN_RENDIMIENTO_HEADERS.length)
      .setValues([APPALMACEN_RENDIMIENTO_HEADERS.slice()]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Serializa una celda JSON respetando el límite de caracteres. @private */
function appPerfJsonCell_(value) {
  if (value == null || value === "") return "";
  const max = Number(APPALMACEN_RENDIMIENTO.SERVER.MAX_JSON_CELL_CHARS || 45000);
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch (error) {
    text = String(value);
  }
  return text.length > max ? text.slice(0, max) + "…[TRUNCADO]" : text;
}

/** Entero no negativo o vacío. @private */
function appPerfInt_(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : "";
}

/** Texto acotado. @private */
function appPerfText_(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

/**
 * Guarda un lote de eventos del navegador.
 * No escribe nada si el switch está apagado.
 *
 * @param {Array<!Object>} events Eventos {ts, session, view, type, operation,
 *     status, clientMs, serverMs, networkMs, renderMs, bytes, idSolicitud,
 *     user, clientStages, serverStages, meta, error}.
 * @return {{saved:number, skipped:number, elapsedMs:number, disabled?:boolean}}
 */
function appPerfPersistEvents_(events) {
  const startedAt = Date.now();
  const source = Array.isArray(events) ? events : [];
  if (!isPerformanceLoggingEnabled_()) {
    return { saved: 0, skipped: source.length, elapsedMs: 0, disabled: true };
  }
  const batch = source.slice(0, Number(APPALMACEN_RENDIMIENTO.SERVER.MAX_EVENTS_PER_BATCH || 60));
  if (!batch.length) return { saved: 0, skipped: 0, elapsedMs: 0 };

  const tz = Session.getScriptTimeZone() || "America/Monterrey";
  const now = new Date();
  const fecha = Utilities.formatDate(now, tz, "dd/MM/yyyy");
  const hora = Utilities.formatDate(now, tz, "HH:mm:ss");
  const sheet = appPerfLogSheet_();

  let saved = 0;
  batch.forEach(function(event) {
    if (!event || typeof event !== "object") return;
    sheet.appendRow([
      fecha,
      hora,
      appPerfText_(event.ts, 40),
      appPerfText_(event.session, 60),
      appPerfText_(event.view, 80),
      appPerfText_(event.type, 30).toUpperCase(),
      appPerfText_(event.operation, 150),
      appPerfText_(event.status, 30),
      appPerfInt_(event.clientMs),
      appPerfInt_(event.serverMs),
      appPerfInt_(event.networkMs),
      appPerfInt_(event.renderMs),
      appPerfInt_(event.bytes),
      appPerfText_(event.idSolicitud, 40).toUpperCase(),
      appPerfText_(event.user, 120).toUpperCase(),
      appPerfJsonCell_(event.clientStages),
      appPerfJsonCell_(event.serverStages),
      appPerfJsonCell_(event.meta),
      appPerfText_(event.error, 500)
    ]);
    saved += 1;
  });
  return { saved: saved, skipped: source.length - saved, elapsedMs: Date.now() - startedAt };
}

/**
 * Endpoint público de la bitácora para todas las vistas.
 * Nunca lanza errores al navegador.
 *
 * @param {Array<!Object>} events Lote de eventos.
 * @return {{ok:boolean, data:Object, message?:string}}
 */
function APPALMACENRendimiento_registrar(events) {
  try {
    return { ok: true, operation: "REGISTRAR_RENDIMIENTO", data: appPerfPersistEvents_(events) };
  } catch (error) {
    console.warn("[APPALMACEN_RENDIMIENTO] registrar falló.", error && error.message);
    return {
      ok: false,
      operation: "REGISTRAR_RENDIMIENTO",
      data: { saved: 0, skipped: Array.isArray(events) ? events.length : 0 },
      message: String(error && error.message || "")
    };
  }
}
