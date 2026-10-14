/**
 * z4-DetallesProductoController
 *
 * @fileoverview Controlador RPC del módulo de detalles de producto. Expone las
 * funciones globales que consume google.script.run, valida los contratos mínimos
 * de entrada y delega toda la lógica de negocio a DetallesProductoService por
 * medio del ejecutor común execController_().
 *
 * Responsabilidades:
 * - Obtener el paquete inicial requerido por la vista.
 * - Buscar productos mediante código o identificador interno.
 * - Normalizar y validar los criterios de búsqueda antes de delegarlos.
 * - Validar payloads de escritura y rechazar contratos ambiguos.
 * - Guardar detalles de producto mediante el servicio de dominio.
 * - Consultar la colección de detalles registrada.
 * - Verificar la disponibilidad del ejecutor y de cada método del servicio.
 * - Mantener nombres de operación estables para trazabilidad y diagnóstico.
 * - Evitar reglas de negocio y acceso directo a datos dentro del controlador.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - DetallesProductoService.
 *
 * Reglas de diseño y seguridad:
 * - El controlador solamente orquesta y adapta contratos RPC.
 * - Los códigos e identificadores de búsqueda no pueden estar vacíos.
 * - El payload de escritura debe ser un objeto y no puede ser un arreglo.
 * - Cada método del servicio se valida antes de invocarse.
 * - Todos los endpoints públicos pasan por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 * - Los errores de negocio y persistencia pertenecen al servicio de dominio.
 *
 * API pública:
 * - getBootstrap().
 * - buscarProductoPorCodigo(codigo).
 * - buscarProductoPorId(id).
 * - guardarDetalle(payload).
 * - obtenerDetalles().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_DETALLES_PRODUCTO = "DetallesProductoController";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * Los valores coinciden deliberadamente con los nombres de los métodos del
 * servicio para reducir errores de escritura durante la delegación.
 *
 * @const {!Object<string, string>}
 */
const CTRL_DETALLES_PRODUCTO_OPERATIONS = Object.freeze({
  GET_BOOTSTRAP: "getBootstrap",
  FIND_BY_CODE: "buscarProductoPorCodigo",
  FIND_BY_ID: "buscarProductoPorId",
  SAVE_DETAIL: "guardarDetalle",
  GET_DETAILS: "obtenerDetalles"
});

// =============================================================================
// NORMALIZACIÓN Y VALIDACIÓN PRIVADA
// =============================================================================

/**
 * Convierte un valor desconocido a texto y elimina espacios exteriores.
 *
 * @param {*} value Valor recibido desde la interfaz.
 * @return {string} Texto normalizado o una cadena vacía.
 * @private
 */
function _detallesProductoToString_(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Valida y normaliza un criterio textual obligatorio de búsqueda.
 *
 * El controlador no transforma el contenido a mayúsculas porque la semántica de
 * búsqueda pertenece al servicio. Únicamente elimina espacios exteriores y
 * rechaza valores vacíos.
 *
 * @param {*} value Criterio recibido desde el cliente.
 * @param {string} fieldName Nombre del campo utilizado en el mensaje de error.
 * @param {string} operationName Operación pública asociada.
 * @return {string} Criterio normalizado.
 * @throws {Error} Si el criterio está vacío.
 * @private
 */
function _detallesProductoRequireText_(
  value,
  fieldName,
  operationName
) {
  const normalizedValue = _detallesProductoToString_(value);

  if (!normalizedValue) {
    throw new Error(
      "El campo " + fieldName + " es obligatorio para " +
        operationName + "."
    );
  }

  return normalizedValue;
}

/**
 * Normaliza un payload RPC como objeto plano.
 *
 * A diferencia de filtros opcionales, guardarDetalle requiere un contrato
 * explícito. Por ello, null, undefined, arreglos y valores primitivos se rechazan
 * antes de llegar al servicio de dominio.
 *
 * @param {*} payload Payload recibido desde la interfaz.
 * @param {string} operationName Operación utilizada en el mensaje de error.
 * @return {!Object} Payload válido para delegación.
 * @throws {TypeError} Si el payload no es un objeto válido.
 * @private
 */
function _detallesProductoRequirePayload_(payload, operationName) {
  if (
    payload == null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new TypeError(
      "El payload de " + operationName + " debe ser un objeto válido."
    );
  }

  return payload;
}

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Nombre del método que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _detallesProductoGetService_(methodName) {
  if (
    typeof DetallesProductoService === "undefined" ||
    !DetallesProductoService
  ) {
    throw new Error("DetallesProductoService no está disponible.");
  }

  if (
    !methodName ||
    typeof DetallesProductoService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio de detalles no implementa la operación: " +
        methodName + "."
    );
  }

  return DetallesProductoService;
}

// =============================================================================
// EJECUCIÓN Y DELEGACIÓN COMÚN
// =============================================================================

/**
 * Ejecuta un endpoint mediante el wrapper común de controladores.
 *
 * @param {string} operationName Nombre estable de la operación.
 * @param {function(): *} callback Trabajo que se ejecutará dentro del wrapper.
 * @return {*} Resultado devuelto por execController_().
 * @throws {Error} Si execController_ no está disponible.
 * @throws {TypeError} Si callback no es una función.
 * @private
 */
function _detallesProductoExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_DETALLES_PRODUCTO,
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
function _detallesProductoExecuteServiceMethod_(
  operationName,
  serviceMethod
) {
  return _detallesProductoExecute_(operationName, function () {
    const service = _detallesProductoGetService_(serviceMethod);
    return service[serviceMethod]();
  });
}

/**
 * Delega una búsqueda con un único criterio textual obligatorio.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {*} value Criterio recibido desde la interfaz.
 * @param {string} fieldName Nombre descriptivo del criterio.
 * @return {*} Resultado de la búsqueda delegada.
 * @private
 */
function _detallesProductoExecuteSearch_(
  operationName,
  serviceMethod,
  value,
  fieldName
) {
  return _detallesProductoExecute_(operationName, function () {
    const normalizedValue = _detallesProductoRequireText_(
      value,
      fieldName,
      operationName
    );
    const service = _detallesProductoGetService_(serviceMethod);
    return service[serviceMethod](normalizedValue);
  });
}

// =============================================================================
// API PÚBLICA DEL MÓDULO
// =============================================================================

/**
 * Obtiene catálogos y configuración inicial para la vista.
 *
 * @return {*} Bootstrap generado por DetallesProductoService.
 */
function DetallesProductoController_getBootstrap() {
  return _detallesProductoExecuteServiceMethod_(
    CTRL_DETALLES_PRODUCTO_OPERATIONS.GET_BOOTSTRAP,
    CTRL_DETALLES_PRODUCTO_OPERATIONS.GET_BOOTSTRAP
  );
}

/**
 * Busca un producto mediante su código operativo.
 *
 * El código se valida como texto obligatorio. Cualquier normalización adicional,
 * regla de coincidencia o validación de existencia corresponde al servicio.
 *
 * @param {*} codigo Código recibido desde la interfaz.
 * @return {*} Producto localizado o respuesta de ausencia del servicio.
 */
function DetallesProductoController_buscarProductoPorCodigo(codigo) {
  return _detallesProductoExecuteSearch_(
    CTRL_DETALLES_PRODUCTO_OPERATIONS.FIND_BY_CODE,
    CTRL_DETALLES_PRODUCTO_OPERATIONS.FIND_BY_CODE,
    codigo,
    "codigo"
  );
}

/**
 * Busca un producto mediante su identificador interno.
 *
 * @param {*} id Identificador recibido desde la interfaz.
 * @return {*} Producto localizado o respuesta de ausencia del servicio.
 */
function DetallesProductoController_buscarProductoPorId(id) {
  return _detallesProductoExecuteSearch_(
    CTRL_DETALLES_PRODUCTO_OPERATIONS.FIND_BY_ID,
    CTRL_DETALLES_PRODUCTO_OPERATIONS.FIND_BY_ID,
    id,
    "id"
  );
}

/**
 * Guarda o actualiza el detalle de un producto.
 *
 * El controlador valida únicamente que exista un objeto de entrada. La
 * autorización, reglas de negocio, campos obligatorios y persistencia pertenecen
 * a DetallesProductoService.
 *
 * @param {*} payload Datos del producto que se desean persistir.
 * @return {*} Resultado de la operación de guardado.
 */
function DetallesProductoController_guardarDetalle(payload) {
  const operationName = CTRL_DETALLES_PRODUCTO_OPERATIONS.SAVE_DETAIL;

  return _detallesProductoExecute_(operationName, function () {
    const normalizedPayload = _detallesProductoRequirePayload_(
      payload,
      operationName
    );
    const service = _detallesProductoGetService_(operationName);
    return service.guardarDetalle(normalizedPayload);
  });
}

/**
 * Obtiene la colección de detalles de producto registrada.
 *
 * @return {*} Detalles devueltos por el servicio de dominio.
 */
function DetallesProductoController_obtenerDetalles() {
  return _detallesProductoExecuteServiceMethod_(
    CTRL_DETALLES_PRODUCTO_OPERATIONS.GET_DETAILS,
    CTRL_DETALLES_PRODUCTO_OPERATIONS.GET_DETAILS
  );
}
