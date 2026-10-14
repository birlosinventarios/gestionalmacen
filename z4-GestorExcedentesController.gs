/**
 * z4-GestorExcedentesController
 *
 * @fileoverview Controlador RPC del gestor de excedentes. Expone las funciones
 * globales consumidas por google.script.run, valida los contratos de respuesta
 * mínimos y delega la lógica de negocio a GestorExcedentesService mediante
 * execController_().
 *
 * Responsabilidades:
 * - Obtener la vista ligera estricta utilizada por la pantalla principal.
 * - Obtener la vista completa para compatibilidad y diagnóstico.
 * - Consultar excedentes consolidados y el resumen general.
 * - Solicitar la invalidación de las cachés operativas.
 * - Verificar la disponibilidad del controlador mediante pingVersion().
 * - Validar la existencia del ejecutor y de cada método del servicio.
 * - Adjuntar metadatos técnicos controlados a las respuestas de vista.
 * - Registrar métricas estructurales sin exponer datos operativos.
 * - Mantener nombres de operación y compilación estables para trazabilidad.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - GestorExcedentesService.
 *
 * Contratos de respuesta:
 * - obtenerVista() devuelve data y resumen, sin dataCompleta.
 * - obtenerVistaRaw() devuelve data, dataCompleta y resumen.
 * - Los endpoints estrictos propagan errores al failureHandler del navegador.
 * - __controllerDebug contiene únicamente métricas estructurales controladas.
 *
 * Reglas de diseño y seguridad:
 * - El controlador no recalcula saldos ni modifica registros del dominio.
 * - Las respuestas del servicio deben ser objetos válidos.
 * - Las colecciones esperadas se validan antes de calcular longitudes.
 * - Cada método del servicio se valida antes de invocarse.
 * - Todos los endpoints públicos pasan por execController_().
 * - Las constantes, operaciones y compilaciones son inmutables.
 *
 * API pública:
 * - obtenerVista().
 * - obtenerVistaRaw().
 * - obtenerExcedentesConsolidados().
 * - getResumen().
 * - clearCache().
 * - pingVersion().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_GESTOR_EXCEDENTES = "GestorExcedentesController";

/** @const {string} Prefijo uniforme de diagnóstico del controlador. */
const CTRL_GESTOR_EXCEDENTES_LOG_PREFIX =
  "[GestorExcedentesController]";

/**
 * Identificadores inmutables de compilación por contrato público.
 *
 * @const {!Object<string, string>}
 */
const CTRL_GESTOR_EXCEDENTES_BUILDS = Object.freeze({
  LIGHT_VIEW: "CTRL-2026-10-14-LIGHT-STRICT-03",
  RAW_VIEW: "CTRL-2026-10-14-RAW-03",
  PING: "PING-2026-10-14-03"
});

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_GESTOR_EXCEDENTES_OPERATIONS = Object.freeze({
  GET_LIGHT_VIEW: "obtenerVista",
  GET_RAW_VIEW: "obtenerVistaRaw",
  GET_CONSOLIDATED_SURPLUS: "obtenerExcedentesConsolidados",
  GET_SUMMARY: "getResumen",
  CLEAR_CACHE: "clearCache",
  PING_VERSION: "pingVersion"
});

// =============================================================================
// VALIDACIÓN Y DIAGNÓSTICO PRIVADO
// =============================================================================

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Método que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _gestorExcedentesGetService_(methodName) {
  if (
    typeof GestorExcedentesService === "undefined" ||
    !GestorExcedentesService
  ) {
    throw new Error("GestorExcedentesService no está disponible.");
  }

  if (
    !methodName ||
    typeof GestorExcedentesService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio del gestor no implementa la operación: " +
        methodName + "."
    );
  }

  return GestorExcedentesService;
}

/**
 * Valida que una respuesta del servicio sea un objeto no nulo y no un arreglo.
 *
 * @param {*} result Resultado devuelto por el servicio.
 * @param {string} operationName Operación pública asociada.
 * @return {!Object} El mismo objeto validado.
 * @throws {TypeError} Si el contrato de respuesta no es válido.
 * @private
 */
function _gestorExcedentesRequireObject_(result, operationName) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError(
      "La operación " + operationName +
        " devolvió un contrato de respuesta inválido."
    );
  }

  return result;
}

/**
 * Obtiene la longitud segura de una colección esperada.
 *
 * Se devuelve -1 cuando el valor no es un arreglo para distinguir un contrato
 * ausente o inválido de una colección válida sin elementos.
 *
 * @param {*} value Valor que se desea inspeccionar.
 * @return {number} Longitud del arreglo o -1.
 * @private
 */
function _gestorExcedentesArrayLength_(value) {
  return Array.isArray(value) ? value.length : -1;
}

/**
 * Construye los metadatos controlados de una respuesta de vista.
 *
 * @param {!Object} result Respuesta validada del servicio.
 * @param {string} methodName Método público del controlador.
 * @param {string} build Identificador de compilación.
 * @param {boolean} includeFullData Indica si se reportará dataCompletaLength.
 * @return {!Object} Metadatos sin información operativa sensible.
 * @private
 */
function _gestorExcedentesBuildDebug_(
  result,
  methodName,
  build,
  includeFullData
) {
  const debug = {
    controller: CTRL_GESTOR_EXCEDENTES,
    method: methodName,
    build,
    dataLength: _gestorExcedentesArrayLength_(result.data),
    hasDataCompleta: Array.isArray(result.dataCompleta)
  };

  if (includeFullData) {
    debug.dataCompletaLength =
      _gestorExcedentesArrayLength_(result.dataCompleta);
  }

  return debug;
}

/**
 * Adjunta metadatos técnicos no sensibles a una respuesta de vista.
 *
 * Se conserva la propiedad histórica __controllerDebug para compatibilidad con
 * los diagnósticos existentes de la interfaz.
 *
 * @param {!Object} result Respuesta validada del servicio.
 * @param {!Object} debug Metadatos controlados.
 * @return {!Object} Respuesta enriquecida.
 * @private
 */
function _gestorExcedentesAttachDebug_(result, debug) {
  result.__controllerDebug = Object.freeze(
    Object.assign({}, debug)
  );
  return result;
}

/**
 * Registra la salida estructural de una operación de vista.
 *
 * @param {string} operationName Operación registrada.
 * @param {!Object} debug Metadatos técnicos controlados.
 * @return {void}
 * @private
 */
function _gestorExcedentesLogView_(operationName, debug) {
  console.log(
    CTRL_GESTOR_EXCEDENTES_LOG_PREFIX +
      " " + operationName + " :: salida",
    debug
  );
}

// =============================================================================
// EJECUCIÓN Y DELEGACIÓN COMÚN
// =============================================================================

/**
 * Ejecuta un endpoint mediante el wrapper común de controladores.
 *
 * @param {string} operationName Nombre estable de la operación.
 * @param {function(): *} callback Trabajo delegado.
 * @return {*} Resultado devuelto por execController_().
 * @throws {Error} Si execController_ no está disponible.
 * @throws {TypeError} Si callback no es una función.
 * @private
 */
function _gestorExcedentesExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_GESTOR_EXCEDENTES,
    operationName,
    callback
  );
}

/**
 * Delega una operación sin argumentos al servicio de dominio.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @return {*} Resultado de la operación delegada.
 * @private
 */
function _gestorExcedentesExecuteServiceMethod_(
  operationName,
  serviceMethod
) {
  return _gestorExcedentesExecute_(operationName, function () {
    const service = _gestorExcedentesGetService_(serviceMethod);
    return service[serviceMethod]();
  });
}

/**
 * Ejecuta una operación de vista y adjunta su diagnóstico estructural.
 *
 * @param {string} operationName Nombre público de la operación.
 * @param {string} serviceMethod Método estricto del servicio.
 * @param {string} build Identificador de compilación.
 * @param {boolean} includeFullData Indica si se espera dataCompleta.
 * @return {!Object} Respuesta validada y enriquecida.
 * @private
 */
function _gestorExcedentesExecuteView_(
  operationName,
  serviceMethod,
  build,
  includeFullData
) {
  return _gestorExcedentesExecute_(operationName, function () {
    const service = _gestorExcedentesGetService_(serviceMethod);
    const result = _gestorExcedentesRequireObject_(
      service[serviceMethod](),
      operationName
    );
    const debug = _gestorExcedentesBuildDebug_(
      result,
      operationName,
      build,
      includeFullData
    );

    _gestorExcedentesAttachDebug_(result, debug);
    _gestorExcedentesLogView_(operationName, debug);

    return result;
  });
}

// =============================================================================
// API PÚBLICA DEL GESTOR
// =============================================================================

/**
 * Obtiene la vista ligera estricta utilizada por GestorExcedentes.html.
 *
 * La llamada usa obtenerVistaLigeraRaw() para propagar errores al failureHandler
 * del navegador y evitar el costo de dataCompleta.
 *
 * @return {!Object} Respuesta con data, resumen y diagnóstico controlado.
 */
function GestorExcedentesController_obtenerVista() {
  return _gestorExcedentesExecuteView_(
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.GET_LIGHT_VIEW,
    "obtenerVistaLigeraRaw",
    CTRL_GESTOR_EXCEDENTES_BUILDS.LIGHT_VIEW,
    false
  );
}

/**
 * Obtiene la vista completa para compatibilidad y diagnóstico.
 *
 * La respuesta incluye data, dataCompleta, resumen y longitudes estructurales.
 *
 * @return {!Object} Vista completa estricta del gestor.
 */
function GestorExcedentesController_obtenerVistaRaw() {
  return _gestorExcedentesExecuteView_(
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.GET_RAW_VIEW,
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.GET_RAW_VIEW,
    CTRL_GESTOR_EXCEDENTES_BUILDS.RAW_VIEW,
    true
  );
}

/**
 * Obtiene únicamente los excedentes consolidados vigentes.
 *
 * @return {*} Colección generada por el servicio de dominio.
 */
function GestorExcedentesController_obtenerExcedentesConsolidados() {
  return _gestorExcedentesExecuteServiceMethod_(
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.GET_CONSOLIDATED_SURPLUS,
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.GET_CONSOLIDATED_SURPLUS
  );
}

/**
 * Obtiene el resumen consolidado del gestor.
 *
 * @return {*} Resumen estricto generado por el servicio.
 */
function GestorExcedentesController_getResumen() {
  return _gestorExcedentesExecuteServiceMethod_(
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.GET_SUMMARY,
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.GET_SUMMARY
  );
}

/**
 * Solicita la invalidación de las cachés operativas del gestor.
 *
 * @return {*} Resultado de la limpieza informado por el servicio.
 */
function GestorExcedentesController_clearCache() {
  return _gestorExcedentesExecuteServiceMethod_(
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.CLEAR_CACHE,
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.CLEAR_CACHE
  );
}

/**
 * Verifica la versión del controlador sin consultar información operativa.
 *
 * El endpoint utiliza execController_() para conservar el mismo esquema de
 * trazabilidad y manejo de errores que el resto de la API.
 *
 * @return {!Object} Estado, controlador y compilación vigente.
 */
function GestorExcedentesController_pingVersion() {
  return _gestorExcedentesExecute_(
    CTRL_GESTOR_EXCEDENTES_OPERATIONS.PING_VERSION,
    function () {
      return {
        ok: true,
        controller: CTRL_GESTOR_EXCEDENTES,
        build: CTRL_GESTOR_EXCEDENTES_BUILDS.PING
      };
    }
  );
}
