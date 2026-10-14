/**
 * z4-NegativosBirlosController
 *
 * @fileoverview Controlador RPC del módulo de existencias negativas de Birlos.
 * Expone la función global consumida por google.script.run, valida el contrato
 * mínimo de respuesta y delega toda la lógica de negocio a
 * NegativosBirlosService mediante execController_().
 *
 * Responsabilidades:
 * - Obtener la vista consolidada de negativos de Birlos.
 * - Validar la disponibilidad del ejecutor común.
 * - Validar la disponibilidad del servicio de dominio y de su método público.
 * - Comprobar la estructura general de la respuesta antes de devolverla.
 * - Mantener un nombre de operación estable para trazabilidad y diagnóstico.
 * - Propagar los errores mediante el mecanismo común de controladores.
 *
 * Este controlador no debe:
 * - Consultar repositorios ni hojas de cálculo directamente.
 * - Consolidar existencias, excedentes o saldos por IdUnico.
 * - Clasificar bodegas o ubicaciones.
 * - Alterar los registros, ubicaciones o metadatos devueltos por el servicio.
 * - Implementar reglas de negocio propias del módulo.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - NegativosBirlosService.getVista().
 *
 * Contrato esperado de getVista():
 * - negativos: arreglo de registros consolidados.
 * - ubicacionesSurtido: arreglo de ubicaciones disponibles.
 * - meta: objeto con modos de balance, compilación y diagnóstico controlado.
 *
 * Reglas de diseño y seguridad:
 * - Todos los endpoints públicos pasan por execController_().
 * - El método del servicio se valida antes de invocarse.
 * - La respuesta debe ser un objeto no nulo y no puede ser un arreglo.
 * - negativos y ubicacionesSurtido deben ser arreglos.
 * - meta debe ser un objeto no nulo y no puede ser un arreglo.
 * - La respuesta se valida sin modificar la información del dominio.
 * - Las constantes y el catálogo de operaciones son inmutables.
 *
 * API pública:
 * - getVista().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_NEGATIVOS_BIRLOS = "NegativosBirlosController";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_NEGATIVOS_BIRLOS_OPERATIONS = Object.freeze({
  GET_VIEW: "getVista"
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
function _negativosBirlosGetService_(methodName) {
  if (
    typeof NegativosBirlosService === "undefined" ||
    !NegativosBirlosService
  ) {
    throw new Error("NegativosBirlosService no está disponible.");
  }

  if (
    !methodName ||
    typeof NegativosBirlosService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio de negativos no implementa la operación: " +
        methodName + "."
    );
  }

  return NegativosBirlosService;
}

/**
 * Valida que un valor sea un objeto no nulo y no sea un arreglo.
 *
 * @param {*} value Valor que se desea validar.
 * @param {string} contractName Nombre del contrato para el mensaje de error.
 * @return {!Object} El mismo objeto validado.
 * @throws {TypeError} Si el valor no cumple el contrato mínimo.
 * @private
 */
function _negativosBirlosRequireObject_(value, contractName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "El contrato " + contractName + " debe ser un objeto válido."
    );
  }

  return value;
}

/**
 * Valida que un valor sea un arreglo.
 *
 * @param {*} value Valor que se desea validar.
 * @param {string} contractName Nombre del contrato para el mensaje de error.
 * @return {!Array<*>} El mismo arreglo validado.
 * @throws {TypeError} Si el valor no es un arreglo.
 * @private
 */
function _negativosBirlosRequireArray_(value, contractName) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      "El contrato " + contractName + " debe ser un arreglo válido."
    );
  }

  return value;
}

/**
 * Valida el contrato estructural mínimo de la vista completa.
 *
 * La función no inspecciona registros individuales ni completa propiedades
 * ausentes. Únicamente confirma las secciones requeridas por la interfaz.
 *
 * @param {*} value Respuesta devuelta por NegativosBirlosService.getVista().
 * @param {string} operationName Operación asociada al contrato.
 * @return {!Object} Vista completa validada y sin modificaciones.
 * @throws {TypeError} Si falta una sección o su tipo es incompatible.
 * @private
 */
function _negativosBirlosRequireView_(value, operationName) {
  const view = _negativosBirlosRequireObject_(
    value,
    operationName
  );

  _negativosBirlosRequireArray_(
    view.negativos,
    operationName + ".negativos"
  );
  _negativosBirlosRequireArray_(
    view.ubicacionesSurtido,
    operationName + ".ubicacionesSurtido"
  );
  _negativosBirlosRequireObject_(
    view.meta,
    operationName + ".meta"
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
function _negativosBirlosExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_NEGATIVOS_BIRLOS,
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
 * @throws {TypeError} Si responseValidator no es una función.
 * @private
 */
function _negativosBirlosExecuteServiceMethod_(
  operationName,
  serviceMethod,
  responseValidator
) {
  return _negativosBirlosExecute_(operationName, function () {
    if (typeof responseValidator !== "function") {
      throw new TypeError(
        "La operación del controlador requiere un validador de respuesta."
      );
    }

    const service = _negativosBirlosGetService_(serviceMethod);
    const result = service[serviceMethod]();
    return responseValidator(result, operationName);
  });
}

// =============================================================================
// API PÚBLICA DEL MÓDULO
// =============================================================================

/**
 * Obtiene la vista consolidada de existencias negativas de Birlos.
 *
 * La respuesta contiene los negativos enriquecidos, las ubicaciones de surtido
 * sanitizadas y los metadatos de los modos de balance. El controlador valida el
 * contrato general sin recalcular ni modificar la información del servicio.
 *
 * @return {!Object} Vista completa y estructuralmente validada.
 */
function NegativosBirlosController_getVista() {
  return _negativosBirlosExecuteServiceMethod_(
    CTRL_NEGATIVOS_BIRLOS_OPERATIONS.GET_VIEW,
    CTRL_NEGATIVOS_BIRLOS_OPERATIONS.GET_VIEW,
    _negativosBirlosRequireView_
  );
}
