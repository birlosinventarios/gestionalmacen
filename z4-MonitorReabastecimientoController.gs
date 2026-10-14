/**
 * z4-MonitorReabastecimientoController
 *
 * @fileoverview Controlador RPC del monitor de reabastecimiento. Expone las
 * funciones globales consumidas por google.script.run, valida los contratos de
 * respuesta mínimos y delega toda la lógica de negocio a
 * MonitorReabastecimientoService mediante execController_().
 *
 * Responsabilidades:
 * - Obtener la vista completa del monitor de reabastecimiento.
 * - Obtener únicamente los registros consolidados cuando el consumidor no
 *   requiere los indicadores del encabezado.
 * - Obtener únicamente el resumen ejecutivo y los KPI del monitor.
 * - Validar la disponibilidad del ejecutor común y del servicio de dominio.
 * - Validar cada método del servicio antes de invocarlo.
 * - Comprobar la estructura general de las respuestas antes de devolverlas.
 * - Mantener nombres de operación estables para trazabilidad y diagnóstico.
 * - Evitar cálculos, clasificación de semáforos y acceso directo a datos.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - MonitorReabastecimientoService.
 *
 * Contratos esperados:
 * - getVista() devuelve un objeto con registros y resumen.
 * - getRegistros() devuelve un arreglo de registros consolidados.
 * - getResumen() devuelve un objeto con métricas e indicadores.
 *
 * Reglas de diseño y seguridad:
 * - El controlador no recalcula existencias, excedentes ni prioridades.
 * - Las respuestas se validan sin modificar los datos de dominio.
 * - Cada método del servicio se comprueba antes de invocarse.
 * - Todos los endpoints públicos pasan por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 * - Los errores de negocio y lectura pertenecen al servicio de dominio.
 *
 * API pública:
 * - getVista().
 * - getRegistros().
 * - getResumen().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_MONITOR_REABASTECIMIENTO =
  "MonitorReabastecimientoController";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_MONITOR_REABASTECIMIENTO_OPERATIONS = Object.freeze({
  GET_VIEW: "getVista",
  GET_RECORDS: "getRegistros",
  GET_SUMMARY: "getResumen"
});

// =============================================================================
// VALIDACIÓN PRIVADA DE DEPENDENCIAS Y CONTRATOS
// =============================================================================

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Método público que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _monitorReabastecimientoGetService_(methodName) {
  if (
    typeof MonitorReabastecimientoService === "undefined" ||
    !MonitorReabastecimientoService
  ) {
    throw new Error("MonitorReabastecimientoService no está disponible.");
  }

  if (
    !methodName ||
    typeof MonitorReabastecimientoService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio del monitor no implementa la operación: " +
        methodName + "."
    );
  }

  return MonitorReabastecimientoService;
}

/**
 * Valida que una respuesta sea un objeto no nulo y no sea un arreglo.
 *
 * @param {*} value Valor devuelto por el servicio.
 * @param {string} operationName Operación asociada al contrato.
 * @return {!Object} El mismo objeto validado.
 * @throws {TypeError} Si la respuesta no cumple el contrato mínimo.
 * @private
 */
function _monitorReabastecimientoRequireObject_(value, operationName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "La operación " + operationName +
        " devolvió un objeto de respuesta inválido."
    );
  }

  return value;
}

/**
 * Valida que una respuesta sea un arreglo.
 *
 * @param {*} value Valor devuelto por el servicio.
 * @param {string} operationName Operación asociada al contrato.
 * @return {!Array<*>} El mismo arreglo validado.
 * @throws {TypeError} Si la respuesta no es un arreglo.
 * @private
 */
function _monitorReabastecimientoRequireArray_(value, operationName) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      "La operación " + operationName +
        " devolvió una colección inválida."
    );
  }

  return value;
}

/**
 * Valida el contrato estructural mínimo de la vista completa.
 *
 * La función no inspecciona registros ni métricas individuales. Solo confirma
 * que el servicio entregue las dos secciones requeridas por la interfaz.
 *
 * @param {*} value Respuesta devuelta por getVista().
 * @param {string} operationName Operación asociada al contrato.
 * @return {!Object} Respuesta completa validada.
 * @throws {TypeError} Si faltan registros o resumen.
 * @private
 */
function _monitorReabastecimientoRequireView_(value, operationName) {
  const view = _monitorReabastecimientoRequireObject_(
    value,
    operationName
  );

  _monitorReabastecimientoRequireArray_(
    view.registros,
    operationName + ".registros"
  );
  _monitorReabastecimientoRequireObject_(
    view.resumen,
    operationName + ".resumen"
  );

  return view;
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
function _monitorReabastecimientoExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_MONITOR_REABASTECIMIENTO,
    operationName,
    callback
  );
}

/**
 * Delega una operación sin argumentos al servicio y valida su respuesta.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {function(*, string): *} responseValidator Validador del contrato.
 * @return {*} Respuesta validada de la operación.
 * @private
 */
function _monitorReabastecimientoExecuteServiceMethod_(
  operationName,
  serviceMethod,
  responseValidator
) {
  return _monitorReabastecimientoExecute_(operationName, function () {
    const service = _monitorReabastecimientoGetService_(serviceMethod);
    const result = service[serviceMethod]();

    if (typeof responseValidator !== "function") {
      throw new TypeError(
        "La operación del controlador requiere un validador de respuesta."
      );
    }

    return responseValidator(result, operationName);
  });
}

// =============================================================================
// API PÚBLICA DEL MONITOR
// =============================================================================

/**
 * Obtiene la vista completa del monitor de reabastecimiento.
 *
 * La respuesta incluye registros consolidados y el resumen ejecutivo utilizado
 * por los encabezados KPI de la interfaz.
 *
 * @return {!Object} Vista completa validada.
 */
function MonitorReabastecimientoController_getVista() {
  return _monitorReabastecimientoExecuteServiceMethod_(
    CTRL_MONITOR_REABASTECIMIENTO_OPERATIONS.GET_VIEW,
    CTRL_MONITOR_REABASTECIMIENTO_OPERATIONS.GET_VIEW,
    _monitorReabastecimientoRequireView_
  );
}

/**
 * Obtiene únicamente los registros consolidados del monitor.
 *
 * Este endpoint es útil para consumidores que no requieren calcular o mostrar
 * los indicadores del resumen.
 *
 * @return {!Array<*>} Registros consolidados validados.
 */
function MonitorReabastecimientoController_getRegistros() {
  return _monitorReabastecimientoExecuteServiceMethod_(
    CTRL_MONITOR_REABASTECIMIENTO_OPERATIONS.GET_RECORDS,
    CTRL_MONITOR_REABASTECIMIENTO_OPERATIONS.GET_RECORDS,
    _monitorReabastecimientoRequireArray_
  );
}

/**
 * Obtiene únicamente el resumen ejecutivo del monitor.
 *
 * La estructura contiene los KPI y encabezados generados por el servicio de
 * dominio. El controlador no recalcula ni completa métricas ausentes.
 *
 * @return {!Object} Resumen ejecutivo validado.
 */
function MonitorReabastecimientoController_getResumen() {
  return _monitorReabastecimientoExecuteServiceMethod_(
    CTRL_MONITOR_REABASTECIMIENTO_OPERATIONS.GET_SUMMARY,
    CTRL_MONITOR_REABASTECIMIENTO_OPERATIONS.GET_SUMMARY,
    _monitorReabastecimientoRequireObject_
  );
}
