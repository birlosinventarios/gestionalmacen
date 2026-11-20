/**
 * z4-UbicacionesSurtidoController.gs
 *
 * @fileoverview Endpoints de la vista CodificacionUbicacionesSurtido.
 *
 * Cada función recibe UN objeto (google.script.run transmite un solo
 * argumento) y responde con el sobre común de la app:
 *
 *   { ok: true, operation, data, metadata: { elapsedMs, perf? } }
 *
 * Los errores llegan como "[CODIGO] mensaje". Solo se exponen los códigos de
 * UBICACIONES_SURTIDO_CODIFICACION_CONFIG.ERROR_CODES; cualquier otro error se
 * presenta con un mensaje de servicio (el detalle queda en los registros).
 *
 * RENDIMIENTO
 * Igual que Reabastecimiento: con APPALMACEN_RENDIMIENTO.ENABLED, el desglose
 * del servidor viaja en metadata.perf; por eso el prefijo
 * UbicacionesSurtidoController_ está excluido del interceptor del navegador.
 *
 * ENDPOINTS
 * - UbicacionesSurtidoController_getCatalogo({forceRefresh?})
 * - UbicacionesSurtidoController_getSegmento({bodegaClave, segmento?})
 * - UbicacionesSurtidoController_guardar({bodegaClave, segmento, filas[]})
 *
 * @author Sigifredo de la Cruz Ramos
 * @version UBICACIONES-SURTIDO-CONTROLLER-2026-11-20-01
 */

/** @const {!Object} Configuración del Controller. */
const UBICACIONES_SURTIDO_CONTROLLER_CONFIG = Object.freeze({
  VERSION: "UBICACIONES-SURTIDO-CONTROLLER-2026-11-20-01",
  INTERNAL_MESSAGE: "No fue posible completar la operación de ubicaciones. Revisa los registros del servidor."
});

/**
 * Convierte un error en uno apto para el navegador.
 *
 * @param {*} error Error original.
 * @return {!Error} "[CODIGO] mensaje".
 * @private
 */
function UbicacionesSurtidoController_publicError_(error) {
  const codes = Object.keys(UBICACIONES_SURTIDO_CODIFICACION_CONFIG.ERROR_CODES)
    .map(function(key) { return UBICACIONES_SURTIDO_CODIFICACION_CONFIG.ERROR_CODES[key]; });
  const code = toStrUpper_(error && error.code);
  const known = codes.indexOf(code) !== -1;
  const publicCode = known ? code : UBICACIONES_SURTIDO_CODIFICACION_CONFIG.ERROR_CODES.ERROR_INTERNO;
  const message = known ? toStr_(error && error.message) : UBICACIONES_SURTIDO_CONTROLLER_CONFIG.INTERNAL_MESSAGE;
  const result = new Error("[" + publicCode + "] " + message);
  result.code = publicCode;
  return result;
}

/**
 * Ejecuta un endpoint con medición, sobre común y errores públicos.
 *
 * @param {string} operation Nombre de la operación.
 * @param {*} payload Argumento del navegador (debe ser objeto).
 * @param {function(!Object):*} executor Lógica del Service.
 * @return {!Object} Sobre { ok, operation, data, metadata }.
 * @private
 */
function UbicacionesSurtidoController_execute_(operation, payload, executor) {
  const startedAt = Date.now();
  if (typeof appPerfSinkReset_ === "function") appPerfSinkReset_();
  const trace = perfStart_("UBICSURT_CONTROLLER_" + operation, {});
  try {
    const input = payload == null ? {} : payload;
    if (typeof input !== "object" || Array.isArray(input)) {
      const invalid = new Error("La solicitud debe ser un objeto.");
      invalid.code = UBICACIONES_SURTIDO_CODIFICACION_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO;
      throw invalid;
    }
    const data = executor(input);
    perfEnd_(trace, "ok", { elapsedMs: Date.now() - startedAt });
    const response = {
      ok: true,
      operation: operation,
      data: data,
      metadata: {
        controllerVersion: UBICACIONES_SURTIDO_CONTROLLER_CONFIG.VERSION,
        elapsedMs: Date.now() - startedAt
      }
    };
    const stages = typeof appPerfSinkDrain_ === "function" ? appPerfSinkDrain_() : [];
    if (typeof isPerformanceLoggingEnabled_ === "function" && isPerformanceLoggingEnabled_()) {
      response.metadata.perf = { serverMs: response.metadata.elapsedMs, controller: [], services: stages };
    }
    return response;
  } catch (error) {
    perfEnd_(trace, "error", { code: toStr_(error && error.code), message: toStr_(error && error.message) });
    if (typeof appPerfSinkDrain_ === "function") appPerfSinkDrain_();
    console.error("[UbicacionesSurtidoController] " + operation, error && error.stack ? error.stack : error);
    const publicError = UbicacionesSurtidoController_publicError_(error);
    if (typeof isPerformanceLoggingEnabled_ === "function" && isPerformanceLoggingEnabled_()) {
      publicError.message = publicError.message + " ⟦serverMs=" + (Date.now() - startedAt) + "⟧";
    }
    throw publicError;
  }
}

/**
 * Catálogo de bodegas, áreas de suministro y niveles (APPALMACEN4 → UBICACIONES).
 * @param {{forceRefresh?:boolean}=} payload
 * @return {!Object} Sobre con {bodegas, bin, segmentoSinPasillo}.
 */
function UbicacionesSurtidoController_getCatalogo(payload) {
  return UbicacionesSurtidoController_execute_("GET_CATALOGO", payload, function(input) {
    return UbicacionesSurtidoCodificacionService.getCatalogo({ forceRefresh: input.forceRefresh === true });
  });
}

/**
 * Segmentos de una bodega con su avance y, opcionalmente, las filas de uno.
 * @param {{bodegaClave:string, segmento?:string}} payload
 * @return {!Object} Sobre con {bodega, resumen, segmentos, filas, codigosEnUso, ...}.
 */
function UbicacionesSurtidoController_getSegmento(payload) {
  return UbicacionesSurtidoController_execute_("GET_SEGMENTO", payload, function(input) {
    return UbicacionesSurtidoCodificacionService.getSegmento({ bodegaClave: input.bodegaClave, segmento: input.segmento });
  });
}

/**
 * Guarda la captura de varias filas.
 * @param {{bodegaClave:string, segmento:string, filas:!Array<!Object>}} payload
 * @return {!Object} Sobre con {guardadas, limpiadas, advertencias, vista}.
 */
function UbicacionesSurtidoController_guardar(payload) {
  return UbicacionesSurtidoController_execute_("GUARDAR", payload, function(input) {
    return UbicacionesSurtidoCodificacionService.guardar({
      bodegaClave: input.bodegaClave,
      segmento: input.segmento,
      filas: input.filas
    });
  });
}
