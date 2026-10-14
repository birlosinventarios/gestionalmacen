/**
 * z4-MonitorTraspasosController
 *
 * @fileoverview Controlador RPC del monitor de traspasos. Expone las funciones
 * globales consumidas por google.script.run, valida los contratos mínimos de
 * entrada y delega toda la lógica de negocio a MonitorTraspasosService mediante
 * execController_().
 *
 * Responsabilidades:
 * - Obtener el bootstrap requerido por la vista del monitor.
 * - Consultar los movimientos de traspaso pendientes.
 * - Validar la fila, el folio y el responsable antes de registrar un movimiento.
 * - Verificar la disponibilidad del ejecutor y de cada método del servicio.
 * - Mantener nombres de operación estables para trazabilidad y diagnóstico.
 * - Conservar al servicio como autoridad de autorización y persistencia.
 *
 * Este controlador no debe:
 * - Leer o escribir directamente en hojas de cálculo.
 * - Interpretar columnas físicas del monitor o de la bitácora.
 * - Determinar si un movimiento puede registrarse por reglas de negocio.
 * - Modificar el folio o el responsable más allá de retirar espacios exteriores.
 * - Construir contratos de persistencia específicos del repositorio.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - MonitorTraspasosService.
 *
 * Reglas de diseño y seguridad:
 * - El número de fila debe ser un entero positivo.
 * - El folio debe ser un texto no vacío.
 * - El responsable debe ser un texto no vacío.
 * - Cada método del servicio se valida antes de invocarse.
 * - Todos los endpoints públicos pasan por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 * - Las reglas definitivas de registro pertenecen al servicio de dominio.
 *
 * API pública:
 * - getBootstrap().
 * - obtenerPendientes().
 * - registrarMovimiento(numFila, folio, responsable).
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_MONITOR_TRASPASOS = "MonitorTraspasosController";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_MONITOR_TRASPASOS_OPERATIONS = Object.freeze({
  GET_BOOTSTRAP: "getBootstrap",
  GET_PENDING: "obtenerPendientes",
  REGISTER_MOVEMENT: "registrarMovimiento"
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
function _monitorTraspasosToString_(value) {
  return String(value == null ? "" : value).trim();
}

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
function _monitorTraspasosRequireRowNumber_(
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
 * Valida un campo textual obligatorio antes de delegarlo al servicio.
 *
 * La función conserva el contenido original, salvo por la eliminación de
 * espacios exteriores. La normalización y semántica definitivas pertenecen al
 * servicio de dominio.
 *
 * @param {*} value Valor recibido desde la interfaz.
 * @param {string} fieldName Nombre del campo para el mensaje de error.
 * @param {string} operationName Operación pública asociada.
 * @return {string} Texto no vacío listo para delegación.
 * @throws {Error} Si el valor está vacío.
 * @private
 */
function _monitorTraspasosRequireText_(
  value,
  fieldName,
  operationName
) {
  const normalizedValue = _monitorTraspasosToString_(value);

  if (!normalizedValue) {
    throw new Error(
      "El campo " + fieldName + " es obligatorio para " +
        operationName + "."
    );
  }

  return normalizedValue;
}

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Método público que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _monitorTraspasosGetService_(methodName) {
  if (
    typeof MonitorTraspasosService === "undefined" ||
    !MonitorTraspasosService
  ) {
    throw new Error("MonitorTraspasosService no está disponible.");
  }

  if (
    !methodName ||
    typeof MonitorTraspasosService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio del monitor no implementa la operación: " +
        methodName + "."
    );
  }

  return MonitorTraspasosService;
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
function _monitorTraspasosExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_MONITOR_TRASPASOS,
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
function _monitorTraspasosExecuteServiceMethod_(
  operationName,
  serviceMethod
) {
  return _monitorTraspasosExecute_(operationName, function () {
    const service = _monitorTraspasosGetService_(serviceMethod);
    return service[serviceMethod]();
  });
}

// =============================================================================
// API PÚBLICA DEL MONITOR
// =============================================================================

/**
 * Obtiene catálogos, permisos y configuración inicial para la vista.
 *
 * @return {*} Bootstrap generado por MonitorTraspasosService.
 */
function MonitorTraspasosController_getBootstrap() {
  return _monitorTraspasosExecuteServiceMethod_(
    CTRL_MONITOR_TRASPASOS_OPERATIONS.GET_BOOTSTRAP,
    CTRL_MONITOR_TRASPASOS_OPERATIONS.GET_BOOTSTRAP
  );
}

/**
 * Obtiene los movimientos que permanecen pendientes de registro.
 *
 * La selección, ordenamiento y proyección de los registros corresponden al
 * servicio de dominio. El controlador únicamente coordina la llamada RPC.
 *
 * @return {*} Movimientos pendientes generados por el servicio.
 */
function MonitorTraspasosController_obtenerPendientes() {
  return _monitorTraspasosExecuteServiceMethod_(
    CTRL_MONITOR_TRASPASOS_OPERATIONS.GET_PENDING,
    CTRL_MONITOR_TRASPASOS_OPERATIONS.GET_PENDING
  );
}

/**
 * Registra un movimiento pendiente del monitor de traspasos.
 *
 * El controlador valida que numFila sea un entero positivo y que folio y
 * responsable sean textos no vacíos. La autorización, consistencia, concurrencia
 * y persistencia definitiva pertenecen a MonitorTraspasosService.
 *
 * @param {*} numFila Número físico o lógico de la fila pendiente.
 * @param {*} folio Folio que se asociará al movimiento.
 * @param {*} responsable Persona responsable de la operación.
 * @return {*} Resultado del registro informado por el servicio.
 */
function MonitorTraspasosController_registrarMovimiento(
  numFila,
  folio,
  responsable
) {
  const operationName =
    CTRL_MONITOR_TRASPASOS_OPERATIONS.REGISTER_MOVEMENT;

  return _monitorTraspasosExecute_(operationName, function () {
    const normalizedRowNumber =
      _monitorTraspasosRequireRowNumber_(
        numFila,
        operationName
      );
    const normalizedFolio = _monitorTraspasosRequireText_(
      folio,
      "folio",
      operationName
    );
    const normalizedResponsible = _monitorTraspasosRequireText_(
      responsable,
      "responsable",
      operationName
    );
    const service = _monitorTraspasosGetService_(operationName);

    return service.registrarMovimiento(
      normalizedRowNumber,
      normalizedFolio,
      normalizedResponsible
    );
  });
}
