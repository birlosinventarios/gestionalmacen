/**
 * z4-HistorialTraspasosController
 *
 * @fileoverview Controlador RPC del historial de traspasos. Expone las funciones
 * globales consumidas por google.script.run, valida los contratos mínimos de
 * entrada y delega toda la lógica de negocio a HistorialTraspasosService mediante
 * execController_().
 *
 * Responsabilidades:
 * - Obtener el bootstrap requerido por la vista del historial.
 * - Consultar los registros de traspasos disponibles.
 * - Validar el número de fila solicitado para una actualización.
 * - Validar la estructura general de los datos que se desean actualizar.
 * - Verificar la disponibilidad del ejecutor y de cada método del servicio.
 * - Mantener nombres de operación estables para trazabilidad y diagnóstico.
 * - Conservar al servicio como autoridad de autorización y persistencia.
 *
 * Este controlador no debe:
 * - Leer o escribir directamente en hojas de cálculo.
 * - Resolver permisos de edición o reglas de negocio.
 * - Interpretar columnas físicas del historial.
 * - Modificar los datos recibidos más allá de la validación estructural.
 * - Construir contratos de persistencia específicos del repositorio.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - HistorialTraspasosService.
 *
 * Reglas de diseño y seguridad:
 * - El número de fila debe ser un entero positivo.
 * - El argumento datos debe ser un objeto no nulo y no puede ser un arreglo.
 * - El payload de actualización no puede estar vacío.
 * - Cada método del servicio se valida antes de invocarse.
 * - Todos los endpoints públicos pasan por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 * - Las reglas definitivas de actualización pertenecen al servicio de dominio.
 *
 * API pública:
 * - getBootstrap().
 * - obtenerRegistros().
 * - actualizarRegistro(numFila, datos).
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_HISTORIAL_TRASPASOS = "HistorialTraspasosController";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_HISTORIAL_TRASPASOS_OPERATIONS = Object.freeze({
  GET_BOOTSTRAP: "getBootstrap",
  GET_RECORDS: "obtenerRegistros",
  UPDATE_RECORD: "actualizarRegistro"
});

// =============================================================================
// NORMALIZACIÓN Y VALIDACIÓN PRIVADA
// =============================================================================

/**
 * Valida y normaliza un número de fila recibido desde la interfaz.
 *
 * Number() permite aceptar valores numéricos serializados como texto por la capa
 * RPC. Después de convertirlos, se exige que representen un entero positivo.
 *
 * @param {*} rowNumber Número de fila recibido desde el cliente.
 * @param {string} operationName Operación asociada al mensaje de error.
 * @return {number} Número de fila entero y positivo.
 * @throws {TypeError} Si el valor no representa un entero positivo.
 * @private
 */
function _historialTraspasosRequireRowNumber_(
  rowNumber,
  operationName
) {
  const normalizedRowNumber = Number(rowNumber);

  if (
    !Number.isInteger(normalizedRowNumber) ||
    normalizedRowNumber <= 0
  ) {
    throw new TypeError(
      "El número de fila de " + operationName +
        " debe ser un entero positivo."
    );
  }

  return normalizedRowNumber;
}

/**
 * Valida el objeto con los datos de actualización.
 *
 * El controlador no valida nombres de campos ni reglas de edición. Únicamente
 * rechaza valores ausentes, primitivos, arreglos y objetos sin propiedades
 * propias enumerables.
 *
 * @param {*} data Datos recibidos desde la interfaz.
 * @param {string} operationName Operación asociada al mensaje de error.
 * @return {!Object} Objeto listo para delegarse sin modificaciones.
 * @throws {TypeError} Si el contrato estructural no es válido.
 * @throws {Error} Si el objeto no contiene propiedades actualizables.
 * @private
 */
function _historialTraspasosRequireUpdateData_(data, operationName) {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError(
      "Los datos de " + operationName + " deben ser un objeto válido."
    );
  }

  if (Object.keys(data).length === 0) {
    throw new Error(
      "Los datos de " + operationName + " no pueden estar vacíos."
    );
  }

  return data;
}

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Método público que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _historialTraspasosGetService_(methodName) {
  if (
    typeof HistorialTraspasosService === "undefined" ||
    !HistorialTraspasosService
  ) {
    throw new Error("HistorialTraspasosService no está disponible.");
  }

  if (
    !methodName ||
    typeof HistorialTraspasosService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio del historial no implementa la operación: " +
        methodName + "."
    );
  }

  return HistorialTraspasosService;
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
function _historialTraspasosExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_HISTORIAL_TRASPASOS,
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
function _historialTraspasosExecuteServiceMethod_(
  operationName,
  serviceMethod
) {
  return _historialTraspasosExecute_(operationName, function () {
    const service = _historialTraspasosGetService_(serviceMethod);
    return service[serviceMethod]();
  });
}

// =============================================================================
// API PÚBLICA DEL HISTORIAL
// =============================================================================

/**
 * Obtiene catálogos, permisos y configuración inicial para la vista.
 *
 * @return {*} Bootstrap generado por HistorialTraspasosService.
 */
function HistorialTraspasosController_getBootstrap() {
  return _historialTraspasosExecuteServiceMethod_(
    CTRL_HISTORIAL_TRASPASOS_OPERATIONS.GET_BOOTSTRAP,
    CTRL_HISTORIAL_TRASPASOS_OPERATIONS.GET_BOOTSTRAP
  );
}

/**
 * Obtiene los registros disponibles en el historial de traspasos.
 *
 * La selección, proyección y autorización de los registros corresponde al
 * servicio de dominio. El controlador únicamente coordina la llamada RPC.
 *
 * @return {*} Registros generados por HistorialTraspasosService.
 */
function HistorialTraspasosController_obtenerRegistros() {
  return _historialTraspasosExecuteServiceMethod_(
    CTRL_HISTORIAL_TRASPASOS_OPERATIONS.GET_RECORDS,
    CTRL_HISTORIAL_TRASPASOS_OPERATIONS.GET_RECORDS
  );
}

/**
 * Actualiza un registro existente del historial de traspasos.
 *
 * El controlador valida que numFila sea un entero positivo y que datos sea un
 * objeto no vacío. La autorización, campos editables, coherencia, concurrencia y
 * persistencia definitiva pertenecen a HistorialTraspasosService.
 *
 * @param {*} numFila Número físico o lógico de fila recibido desde la vista.
 * @param {*} datos Campos que se desean actualizar.
 * @return {*} Resultado de la actualización informado por el servicio.
 */
function HistorialTraspasosController_actualizarRegistro(
  numFila,
  datos
) {
  const operationName =
    CTRL_HISTORIAL_TRASPASOS_OPERATIONS.UPDATE_RECORD;

  return _historialTraspasosExecute_(operationName, function () {
    const normalizedRowNumber =
      _historialTraspasosRequireRowNumber_(
        numFila,
        operationName
      );
    const validatedData = _historialTraspasosRequireUpdateData_(
      datos,
      operationName
    );
    const service = _historialTraspasosGetService_(operationName);

    return service.actualizarRegistro(
      normalizedRowNumber,
      validatedData
    );
  });
}
