/**
 * z0-ReabastecimientoTelemetria.gs
 *
 * @fileoverview Telemetría y sincronización del módulo de Reabastecimiento.
 *
 * Este archivo concentra tres capacidades transversales que utilizan los
 * Controllers, el Service y las vistas de Reabastecimiento:
 *
 * 1. COLECTOR DE ETAPAS DEL SERVIDOR (REAB_PERF_SINK_)
 *    Cada llamada google.script.run es una ejecución independiente de Apps
 *    Script. Al iniciar, el Controller limpia el colector; cada traza del
 *    Service que termina (perfEnd_) se resume y se agrega. Al responder, el
 *    Controller adjunta el resumen en response.metadata.perf para que el
 *    navegador conozca cuánto tardó cada etapa interna (lecturas de hojas,
 *    espera de candado, escrituras, consolidaciones).
 *
 * 2. REVISIÓN DE CAMBIOS (actualización en tiempo real)
 *    Cada escritura confirmada incrementa:
 *    - un contador global de Reabastecimiento, y
 *    - el contador del folio afectado.
 *    El valor vive en CacheService (lectura de ~10–40 ms) con respaldo en
 *    ScriptProperties. Las vistas consultan únicamente este contador cada
 *    pocos segundos y recargan datos solo cuando cambia, en lugar de releer
 *    las tres hojas de GESTION5 en cada ciclo.
 *
 * 3. BITÁCORA PERSISTENTE (APPALMACEN_RENDIMIENTO, unificada)
 *    El navegador acumula eventos medidos y los envía por lotes. Se guardan en
 *    una hoja de GESTION5 para analizar cuellos de botella. La hoja se crea si
 *    no existe. Las filas se agregan con appendRow(), operación atómica que no
 *    requiere el ScriptLock de inventario y, por lo tanto, no compite con las
 *    operaciones operativas.
 *
 * Dependencias globales:
 * - REABASTECIMIENTO_CONFIG, REABASTECIMIENTO_RENDIMIENTO_HEADERS y SHEETS.
 * - getSpreadsheetByFileKey_(), toStr_(), toStrUpper_().
 * - CacheService, PropertiesService, Utilities, Session.
 *
 * Garantías:
 * - Ninguna función de este archivo lanza errores hacia la operación de
 *   negocio: si la telemetría falla, se registra en consola y la operación
 *   continúa.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REAB-TELEMETRIA-2026-11-20-02
 */

// ============================================================================
// 1. COLECTOR DE ETAPAS DEL SERVIDOR
// ============================================================================
//
// Delegan en el colector común de z0-APPALMACENRendimiento.gs. Se conservan
// los nombres para que el Controller y el Service de Reabastecimiento no
// cambien. Todo queda sujeto al switch APPALMACEN_RENDIMIENTO.ENABLED.

/** Activa el colector de la ejecución (no hace nada con el switch apagado). */
function reabPerfSinkReset_() {
  appPerfSinkReset_();
}

/** Agrega una traza finalizada al colector activo. */
function reabPerfSinkPush_(result) {
  appPerfSinkPush_(result);
}

/** Devuelve y cierra el colector. */
function reabPerfSinkDrain_() {
  return appPerfSinkDrain_();
}
// ============================================================================
// 2. REVISIÓN DE CAMBIOS
// ============================================================================

/**
 * Lee el estado de revisión desde CacheService con respaldo en
 * ScriptProperties.
 *
 * Estructura: { r: number, at: epochMs, ids: { [idSolicitud]: number } }
 *
 * @return {!Object} Estado de revisión normalizado.
 * @private
 */
function reabRevisionRead_() {
  const cfg = REABASTECIMIENTO_CONFIG.REVISION;
  let raw = null;
  try {
    raw = CacheService.getScriptCache().get(cfg.CACHE_KEY);
  } catch (error) {
    raw = null;
  }
  if (!raw) {
    try {
      raw = PropertiesService.getScriptProperties().getProperty(cfg.PROPERTY_KEY);
      if (raw) {
        CacheService.getScriptCache().put(cfg.CACHE_KEY, raw, cfg.CACHE_TTL_SECONDS);
      }
    } catch (error) {
      raw = null;
    }
  }
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      return {
        r: Number(parsed.r || 0),
        at: Number(parsed.at || 0),
        ids: parsed.ids && typeof parsed.ids === "object" ? parsed.ids : {}
      };
    }
  } catch (error) {
    console.warn("[REAB_TELEMETRIA] Revisión corrupta; se reinicia.");
  }
  return { r: 0, at: 0, ids: {} };
}

/**
 * Incrementa la revisión global y la del folio indicado.
 *
 * DEBE invocarse dentro del ScriptLock de la escritura que confirma el cambio
 * para que los incrementos concurrentes no se pierdan.
 *
 * @param {string=} idSolicitud Folio afectado; vacío para cambios generales.
 * @return {!Object} Nueva revisión {revision, solicitudRevision}.
 */
function reabRevisionBump_(idSolicitud) {
  const cfg = REABASTECIMIENTO_CONFIG.REVISION;
  try {
    const state = reabRevisionRead_();
    state.r += 1;
    state.at = Date.now();
    const id = toStrUpper_(idSolicitud);
    if (id) state.ids[id] = state.r;

    // Conserva solo los folios con cambios más recientes.
    const ids = Object.keys(state.ids);
    if (ids.length > cfg.MAX_TRACKED_IDS) {
      ids
        .sort(function(a, b) { return state.ids[a] - state.ids[b]; })
        .slice(0, ids.length - cfg.MAX_TRACKED_IDS)
        .forEach(function(key) { delete state.ids[key]; });
    }

    const json = JSON.stringify(state);
    PropertiesService.getScriptProperties().setProperty(cfg.PROPERTY_KEY, json);
    CacheService.getScriptCache().put(cfg.CACHE_KEY, json, cfg.CACHE_TTL_SECONDS);
    return { revision: state.r, solicitudRevision: id ? state.ids[id] : 0, at: state.at };
  } catch (error) {
    console.warn("[REAB_TELEMETRIA] No se pudo actualizar la revisión.", error && error.message);
    return { revision: 0, solicitudRevision: 0, at: 0 };
  }
}

/**
 * Devuelve la revisión actual y la de los folios solicitados.
 *
 * @param {Array<string>|string=} ids Folios de interés.
 * @return {{revision:number, at:number, ids:!Object<string,number>}}
 */
function reabRevisionSnapshot_(ids) {
  const state = reabRevisionRead_();
  const wanted = Array.isArray(ids) ? ids : (ids ? [ids] : []);
  const result = {};
  wanted.slice(0, 20).forEach(function(value) {
    const id = toStrUpper_(value);
    if (id) result[id] = Number(state.ids[id] || 0);
  });
  return { revision: state.r, at: state.at, ids: result };
}

// ============================================================================
// 2b. REVISIÓN DE INVENTARIO (invalidación de cachés de excedentes)
// ============================================================================
//
// Contador que sube cada vez que PrototipoTraspasosService aplica un ACOMODO o
// SURTIDO (desde cualquier vista). Las cachés del "estado de excedentes" se
// guardan junto con la revisión vigente y se descartan si ya no coincide.

var APP_INVENTORY_REVISION_KEY_ = "APPALMACEN_INV_REVISION";

/** Revisión de inventario actual (CacheService con respaldo en ScriptProperties). */
function appInventoryRevisionRead_() {
  try {
    const cached = CacheService.getScriptCache().get(APP_INVENTORY_REVISION_KEY_);
    if (cached != null) return Number(cached) || 0;
    const stored = Number(PropertiesService.getScriptProperties().getProperty(APP_INVENTORY_REVISION_KEY_) || 0);
    CacheService.getScriptCache().put(APP_INVENTORY_REVISION_KEY_, String(stored), 21600);
    return stored;
  } catch (error) {
    return -1;
  }
}

/**
 * Incrementa la revisión de inventario. Debe invocarse dentro del ScriptLock
 * de la escritura de inventario (PrototipoTraspasosService lo hace).
 *
 * @return {number} Nueva revisión.
 */
function appInventoryRevisionBump_() {
  try {
    const next = Math.max(0, appInventoryRevisionRead_()) + 1;
    PropertiesService.getScriptProperties().setProperty(APP_INVENTORY_REVISION_KEY_, String(next));
    CacheService.getScriptCache().put(APP_INVENTORY_REVISION_KEY_, String(next), 21600);
    return next;
  } catch (error) {
    console.warn("[INVENTARIO] No se pudo actualizar la revisión.", error && error.message);
    return -1;
  }
}

// ============================================================================
// 3. BITÁCORA PERSISTENTE
// ============================================================================

/**
 * Persiste eventos de Reabastecimiento en la bitácora UNIFICADA
 * APPALMACEN_RENDIMIENTO (ver z0-APPALMACENRendimiento.gs). No escribe nada
 * si el switch APPALMACEN_RENDIMIENTO.ENABLED está apagado.
 *
 * @param {Array<!Object>} events Eventos del cliente.
 * @return {{saved:number, skipped:number, elapsedMs:number}}
 */
function reabPerfPersistEvents_(events) {
  return appPerfPersistEvents_(events);
}