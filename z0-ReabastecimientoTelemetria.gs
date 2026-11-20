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
 *    El valor vive solo en CacheService (lectura de ~10–40 ms; ver sección 2
 *    sobre la siembra segura). Las vistas consultan únicamente este contador cada
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
 * @version REAB-TELEMETRIA-2026-11-20-03
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
//
// MODELO (fase 4)
// ───────────────
// El estado vive SOLO en CacheService (sin ScriptProperties): escribir una
// propiedad costaba 150–700 ms por operación (bitácora 20/11/2026).
//
//   {
//     r:    revisión global (la que vigilan las vistas en tiempo real),
//     base: valor con el que se sembró el estado,
//     at:   epochMs del último cambio,
//     ids:  { [idSolicitud]: revisión del último cambio del folio },
//     t:    { [sheetKey]:    revisión del último cambio de esa hoja }
//   }
//
// SIEMBRA SEGURA
// - El contador se siembra con Date.now(). Si CacheService pierde el estado,
//   el nuevo valor es mayor que cualquier revisión anterior (nadie escribe más
//   de una vez por milisegundo), así que ninguna copia vieja puede coincidir
//   con una revisión nueva.
// - Solo se siembra con el ScriptLock tomado (el mismo de las escrituras): un
//   lector nunca crea ni pisa el estado de un escritor concurrente. Si el
//   candado está ocupado, el lector simplemente no usa cachés en esa llamada.
//
// REVISIÓN POR HOJA
// - Cada escritura sube r y, además, t[hoja] solo de las hojas que modificó.
//   Así, por ejemplo, ATENDER (que solo escribe SOLICITUDES) no invalida las
//   copias de PARTIDAS ni DETALLES.

/** Espera máxima para sembrar el estado desde una lectura (ms). */
var REAB_REVISION_SEED_WAIT_MS_ = 150;

/**
 * Ejecuta fn con el ScriptLock tomado: directo si la ejecución ya lo tiene,
 * o intentando tomarlo brevemente. Devuelve null si no fue posible.
 *
 * IMPORTANTE: si la ejecución YA tiene el candado (una escritura en curso), no
 * se libera aquí; lo libera quien lo tomó.
 *
 * @param {function():*} fn Operación que requiere exclusión.
 * @return {*} Resultado de fn o null.
 * @private
 */
function revisionWithLock_(fn) {
  try {
    const lock = LockService.getScriptLock();
    if (lock.hasLock()) return fn();
    if (!lock.tryLock(REAB_REVISION_SEED_WAIT_MS_)) return null;
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return null;
  }
}

/**
 * Lee el estado de revisión de Reabastecimiento.
 *
 * @return {{r:number, base:number, at:number, ids:!Object<string,number>,
 *     t:!Object<string,number>, missing:boolean}} missing=true cuando no hay
 *     estado válido (nunca sembrado, expirado o formato anterior).
 * @private
 */
function reabRevisionRead_() {
  const cfg = REABASTECIMIENTO_CONFIG.REVISION;
  try {
    const raw = CacheService.getScriptCache().get(cfg.CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && Number(parsed.base) > 0 && Number(parsed.r) >= Number(parsed.base)) {
      return {
        r: Number(parsed.r),
        base: Number(parsed.base),
        at: Number(parsed.at || 0),
        ids: parsed.ids && typeof parsed.ids === "object" ? parsed.ids : {},
        t: parsed.t && typeof parsed.t === "object" ? parsed.t : {},
        missing: false
      };
    }
  } catch (error) {
    console.warn("[REAB_TELEMETRIA] Revisión ilegible; se tratará como ausente.");
  }
  return { r: 0, base: 0, at: 0, ids: {}, t: {}, missing: true };
}

/** Guarda el estado de revisión (solo CacheService). @private */
function reabRevisionWrite_(state) {
  const cfg = REABASTECIMIENTO_CONFIG.REVISION;
  CacheService.getScriptCache().put(
    cfg.CACHE_KEY,
    JSON.stringify({ r: state.r, base: state.base, at: state.at, ids: state.ids, t: state.t }),
    cfg.CACHE_TTL_SECONDS
  );
}

/** Estado nuevo sembrado con Date.now() (ver "SIEMBRA SEGURA"). @private */
function reabRevisionSeedState_() {
  const seed = Date.now();
  return { r: seed, base: seed, at: seed, ids: {}, t: {}, missing: false };
}

/**
 * Devuelve el estado de revisión, sembrándolo bajo candado si falta.
 *
 * @return {!Object} Estado (missing=true si no se pudo sembrar ahora).
 * @private
 */
function reabRevisionEnsure_() {
  const current = reabRevisionRead_();
  if (!current.missing) return current;
  const seeded = revisionWithLock_(function() {
    const again = reabRevisionRead_();
    if (!again.missing) return again;
    const state = reabRevisionSeedState_();
    reabRevisionWrite_(state);
    return state;
  });
  return seeded || current;
}

/**
 * Revisión vigente de una hoja de Reabastecimiento, usada como etiqueta de su
 * copia en caché (createHeaderLayoutAccessor_ → persistentCache.revision).
 *
 * @param {string} sheetKey Clave de SHEETS.
 * @return {?number} Revisión de la hoja o null si no hay estado (no usar caché).
 */
function reabTableRevisionRead_(sheetKey) {
  const state = reabRevisionEnsure_();
  if (state.missing) return null;
  const value = Number(state.t[String(sheetKey)] || state.base);
  return value > 0 ? value : null;
}

/**
 * Incrementa la revisión global, la del folio y la de las hojas escritas.
 *
 * DEBE invocarse dentro del ScriptLock de la escritura que confirma el cambio
 * para que los incrementos concurrentes no se pierdan.
 *
 * @param {string=} idSolicitud Folio afectado; vacío para cambios generales.
 * @param {Array<string>=} sheetKeys Hojas modificadas por la operación.
 * @return {{revision:number, solicitudRevision:number, at:number,
 *     tables:!Object<string,number>}} tables: revisión nueva de cada hoja escrita.
 */
function reabRevisionBump_(idSolicitud, sheetKeys) {
  const cfg = REABASTECIMIENTO_CONFIG.REVISION;
  try {
    const previous = reabRevisionRead_();
    const state = previous.missing ? reabRevisionSeedState_() : previous;
    // Un estado recién sembrado ya es una revisión nueva; uno existente sube 1.
    if (!previous.missing) state.r += 1;
    state.at = Date.now();

    const id = toStrUpper_(idSolicitud);
    if (id) state.ids[id] = state.r;
    const tables = {};
    (Array.isArray(sheetKeys) ? sheetKeys : []).forEach(function(key) {
      const sheetKey = String(key || "");
      if (!sheetKey) return;
      state.t[sheetKey] = state.r;
      tables[sheetKey] = state.r;
    });

    // Conserva solo los folios con cambios más recientes.
    const ids = Object.keys(state.ids);
    if (ids.length > cfg.MAX_TRACKED_IDS) {
      ids
        .sort(function(a, b) { return state.ids[a] - state.ids[b]; })
        .slice(0, ids.length - cfg.MAX_TRACKED_IDS)
        .forEach(function(key) { delete state.ids[key]; });
    }

    reabRevisionWrite_(state);
    return { revision: state.r, solicitudRevision: id ? state.ids[id] : 0, at: state.at, tables: tables };
  } catch (error) {
    console.warn("[REAB_TELEMETRIA] No se pudo actualizar la revisión.", error && error.message);
    return { revision: 0, solicitudRevision: 0, at: 0, tables: {} };
  }
}

/**
 * Devuelve la revisión actual y la de los folios solicitados (vigilante de
 * las vistas). No siembra: sin estado responde 0 y la vista sigue esperando.
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
//
// Mismo modelo que la revisión de Reabastecimiento: solo CacheService,
// siembra con Date.now() bajo el ScriptLock (ver sección 2). La clave es nueva
// (_V2) para que ningún valor del esquema anterior se reutilice.

var APP_INVENTORY_REVISION_KEY_ = "APPALMACEN_INV_REVISION_V2";
var APP_INVENTORY_REVISION_TTL_SECONDS_ = 21600;

/**
 * Revisión de inventario actual, sin sembrar.
 * @return {number} Revisión o -1 si no hay estado (no usar cachés).
 */
function appInventoryRevisionRead_() {
  try {
    const value = Number(CacheService.getScriptCache().get(APP_INVENTORY_REVISION_KEY_));
    return Number.isFinite(value) && value > 0 ? value : -1;
  } catch (error) {
    return -1;
  }
}

/**
 * Revisión de inventario, sembrándola bajo candado si falta. La usan los
 * lectores que quieren guardar una caché etiquetada (estado de surtibles).
 *
 * @return {number} Revisión o -1 si no se pudo sembrar ahora.
 */
function appInventoryRevisionEnsure_() {
  const current = appInventoryRevisionRead_();
  if (current > 0) return current;
  const seeded = revisionWithLock_(function() {
    const again = appInventoryRevisionRead_();
    if (again > 0) return again;
    const seed = Date.now();
    CacheService.getScriptCache().put(APP_INVENTORY_REVISION_KEY_, String(seed), APP_INVENTORY_REVISION_TTL_SECONDS_);
    return seed;
  });
  return Number(seeded) > 0 ? Number(seeded) : -1;
}

/**
 * Incrementa la revisión de inventario. Debe invocarse dentro del ScriptLock
 * de la escritura de inventario (PrototipoTraspasosService lo hace).
 *
 * @return {number} Nueva revisión (-1 si falló).
 */
function appInventoryRevisionBump_() {
  try {
    const current = appInventoryRevisionRead_();
    const next = current > 0 ? current + 1 : Date.now();
    CacheService.getScriptCache().put(APP_INVENTORY_REVISION_KEY_, String(next), APP_INVENTORY_REVISION_TTL_SECONDS_);
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