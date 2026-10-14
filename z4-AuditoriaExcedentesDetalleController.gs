/**
 * z4-AuditoriaExcedentesDetalleController
 *
 * @fileoverview Controlador RPC del detalle operativo de auditorías de
 * excedentes. Expone endpoints compatibles con google.script.run, valida los
 * contratos mínimos de entrada y delega la lógica de negocio a
 * AuditoriaExcedentesDetalleService mediante execController_().
 *
 * Responsabilidades:
 * - Abrir y cerrar ubicaciones dentro de una auditoría activa.
 * - Consultar los IdUnicos esperados por ubicación.
 * - Registrar escaneos individuales de IdUnico.
 * - Obtener el detalle conciliado de una ubicación.
 * - Listar ubicaciones auditadas y ubicaciones todavía abiertas.
 * - Normalizar payloads, identificadores de auditoría y ubicaciones.
 * - Validar la existencia del ejecutor y del método de servicio solicitado.
 * - Mantener nombres de operación estables para trazabilidad.
 * - Publicar un endpoint ping sin consultar información operativa.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - AuditoriaExcedentesDetalleService.
 *
 * Reglas de diseño y seguridad:
 * - El controlador no contiene reglas de negocio ni acceso directo a datos.
 * - Los payloads ausentes se normalizan como objetos vacíos.
 * - Los arreglos y valores primitivos se rechazan cuando se espera un objeto.
 * - El Id de auditoría y la ubicación son obligatorios en consultas de detalle.
 * - Las ubicaciones se normalizan en mayúsculas antes de delegarse.
 * - Cada método del servicio se valida antes de ser invocado.
 * - Todos los endpoints pasan por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 *
 * API pública:
 * - abrirUbicacion(payload).
 * - obtenerEsperadosPorUbicacion(idauditoria, ubicacion).
 * - registrarEscaneoIdUnico(payload).
 * - cerrarUbicacion(payload).
 * - getDetalleUbicacion(idauditoria, ubicacion).
 * - listarUbicacionesAuditadas(idauditoria).
 * - listarUbicacionesAbiertas(idauditoria).
 * - ping().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_AEDC = "AuditoriaExcedentesDetalleController";

/** @const {string} Nombre del módulo funcional. */
const CTRL_AEDC_MODULE = "AuditoriaExcedentesDetalle";

/** @const {string} Identificador controlado de la compilación. */
const CTRL_AEDC_BUILD = "AUDITORIA-DETALLE-CTRL-2026-10-14-01";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_AEDC_OPERATIONS = Object.freeze({
  OPEN_LOCATION: "abrirUbicacion",
  GET_EXPECTED_BY_LOCATION: "obtenerEsperadosPorUbicacion",
  REGISTER_UNIQUE_ID_SCAN: "registrarEscaneoIdUnico",
  CLOSE_LOCATION: "cerrarUbicacion",
  GET_LOCATION_DETAIL: "getDetalleUbicacion",
  LIST_AUDITED_LOCATIONS: "listarUbicacionesAuditadas",
  LIST_OPEN_LOCATIONS: "listarUbicacionesAbiertas",
  PING: "ping"
});

// =============================================================================
// NORMALIZACIÓN Y VALIDACIÓN PRIVADA
// =============================================================================

/**
 * Convierte un valor a texto y elimina espacios exteriores.
 *
 * @param {*} value Valor recibido desde la interfaz.
 * @return {string} Texto normalizado o cadena vacía.
 * @private
 */
function _aedcToString_(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Normaliza un payload RPC como objeto plano.
 *
 * Los valores null y undefined se convierten en un objeto vacío. Los arreglos y
 * valores primitivos se rechazan para evitar contratos ambiguos en el servicio.
 *
 * @param {*} payload Payload recibido desde el cliente.
 * @param {string} operationName Operación utilizada en el mensaje de error.
 * @return {!Object} Payload seguro para delegación.
 * @throws {TypeError} Si el payload no es un objeto válido.
 * @private
 */
function _aedcNormalizePayload_(payload, operationName) {
  if (payload == null) {
    return {};
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError(
      "El payload de " + operationName + " debe ser un objeto válido."
    );
  }

  return payload;
}

/**
 * Valida un identificador obligatorio de auditoría.
 *
 * @param {*} idAuditoria Identificador recibido desde el cliente.
 * @param {string} operationName Operación que requiere el identificador.
 * @return {string} Identificador normalizado.
 * @throws {Error} Si el identificador está vacío.
 * @private
 */
function _aedcRequireAuditId_(idAuditoria, operationName) {
  const normalizedId = _aedcToString_(idAuditoria);

  if (!normalizedId) {
    throw new Error(
      "El identificador de auditoría es obligatorio para " +
        operationName + "."
    );
  }

  return normalizedId;
}

/**
 * Valida y normaliza una ubicación obligatoria.
 *
 * @param {*} ubicacion Ubicación recibida desde el cliente.
 * @param {string} operationName Operación que requiere la ubicación.
 * @return {string} Ubicación normalizada en mayúsculas.
 * @throws {Error} Si la ubicación está vacía.
 * @private
 */
function _aedcRequireLocation_(ubicacion, operationName) {
  const normalizedLocation = _aedcToString_(ubicacion).toUpperCase();

  if (!normalizedLocation) {
    throw new Error(
      "La ubicación es obligatoria para " + operationName + "."
    );
  }

  return normalizedLocation;
}

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Nombre del método que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _aedcGetService_(methodName) {
  if (
    typeof AuditoriaExcedentesDetalleService === "undefined" ||
    !AuditoriaExcedentesDetalleService
  ) {
    throw new Error("AuditoriaExcedentesDetalleService no está disponible.");
  }

  if (
    !methodName ||
    typeof AuditoriaExcedentesDetalleService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio de detalle no implementa la operación: " +
        methodName + "."
    );
  }

  return AuditoriaExcedentesDetalleService;
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
 * @throws {Error} Si el ejecutor común no está disponible.
 * @private
 */
function _aedcExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(CTRL_AEDC, operationName, callback);
}

/**
 * Delega una operación cuyo único argumento es un payload normalizado.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {*} payload Payload recibido desde el cliente.
 * @return {*} Resultado de la operación delegada.
 * @private
 */
function _aedcExecutePayloadMethod_(
  operationName,
  serviceMethod,
  payload
) {
  return _aedcExecute_(operationName, function () {
    const normalizedPayload = _aedcNormalizePayload_(
      payload,
      operationName
    );
    const service = _aedcGetService_(serviceMethod);
    return service[serviceMethod](normalizedPayload);
  });
}

/**
 * Delega una operación cuyo único argumento es un Id de auditoría.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {*} idAuditoria Identificador recibido desde el cliente.
 * @return {*} Resultado de la operación delegada.
 * @private
 */
function _aedcExecuteAuditIdMethod_(
  operationName,
  serviceMethod,
  idAuditoria
) {
  return _aedcExecute_(operationName, function () {
    const normalizedId = _aedcRequireAuditId_(
      idAuditoria,
      operationName
    );
    const service = _aedcGetService_(serviceMethod);
    return service[serviceMethod](normalizedId);
  });
}

/**
 * Delega una consulta que requiere Id de auditoría y ubicación.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {*} idAuditoria Identificador de la auditoría.
 * @param {*} ubicacion Ubicación solicitada.
 * @return {*} Resultado de la consulta delegada.
 * @private
 */
function _aedcExecuteLocationQuery_(
  operationName,
  serviceMethod,
  idAuditoria,
  ubicacion
) {
  return _aedcExecute_(operationName, function () {
    const normalizedId = _aedcRequireAuditId_(
      idAuditoria,
      operationName
    );
    const normalizedLocation = _aedcRequireLocation_(
      ubicacion,
      operationName
    );
    const service = _aedcGetService_(serviceMethod);

    return service[serviceMethod](
      normalizedId,
      normalizedLocation
    );
  });
}

// =============================================================================
// API PÚBLICA: OPERACIÓN DE UBICACIONES
// =============================================================================

/**
 * Abre una ubicación dentro de una auditoría activa.
 *
 * @param {*} payload Auditoría, ubicación y contexto del usuario.
 * @return {*} Resultado de apertura generado por el servicio.
 */
function AuditoriaExcedentesDetalleController_abrirUbicacion(payload) {
  return _aedcExecutePayloadMethod_(
    CTRL_AEDC_OPERATIONS.OPEN_LOCATION,
    CTRL_AEDC_OPERATIONS.OPEN_LOCATION,
    payload
  );
}

/**
 * Obtiene los IdUnicos esperados para una ubicación de la auditoría.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @param {*} ubicacion Ubicación que se desea consultar.
 * @return {*} Esperados consolidados por el servicio.
 */
function AuditoriaExcedentesDetalleController_obtenerEsperadosPorUbicacion(
  idauditoria,
  ubicacion
) {
  return _aedcExecuteLocationQuery_(
    CTRL_AEDC_OPERATIONS.GET_EXPECTED_BY_LOCATION,
    CTRL_AEDC_OPERATIONS.GET_EXPECTED_BY_LOCATION,
    idauditoria,
    ubicacion
  );
}

/**
 * Registra un escaneo individual de IdUnico en la ubicación abierta.
 *
 * @param {*} payload Auditoría, ubicación, IdUnico y contexto operativo.
 * @return {*} Resultado validado del escaneo.
 */
function AuditoriaExcedentesDetalleController_registrarEscaneoIdUnico(
  payload
) {
  return _aedcExecutePayloadMethod_(
    CTRL_AEDC_OPERATIONS.REGISTER_UNIQUE_ID_SCAN,
    CTRL_AEDC_OPERATIONS.REGISTER_UNIQUE_ID_SCAN,
    payload
  );
}

/**
 * Cierra una ubicación y solicita su conciliación al servicio.
 *
 * @param {*} payload Identificadores, observaciones y usuario de cierre.
 * @return {*} Resultado definitivo de la ubicación.
 */
function AuditoriaExcedentesDetalleController_cerrarUbicacion(payload) {
  return _aedcExecutePayloadMethod_(
    CTRL_AEDC_OPERATIONS.CLOSE_LOCATION,
    CTRL_AEDC_OPERATIONS.CLOSE_LOCATION,
    payload
  );
}

// =============================================================================
// API PÚBLICA: CONSULTAS DE DETALLE Y LISTADOS
// =============================================================================

/**
 * Obtiene el detalle conciliado de una ubicación específica.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @param {*} ubicacion Ubicación que se desea consultar.
 * @return {*} Detalle generado por el servicio.
 */
function AuditoriaExcedentesDetalleController_getDetalleUbicacion(
  idauditoria,
  ubicacion
) {
  return _aedcExecuteLocationQuery_(
    CTRL_AEDC_OPERATIONS.GET_LOCATION_DETAIL,
    CTRL_AEDC_OPERATIONS.GET_LOCATION_DETAIL,
    idauditoria,
    ubicacion
  );
}

/**
 * Lista las ubicaciones que ya fueron auditadas.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @return {*} Colección de ubicaciones auditadas.
 */
function AuditoriaExcedentesDetalleController_listarUbicacionesAuditadas(
  idauditoria
) {
  return _aedcExecuteAuditIdMethod_(
    CTRL_AEDC_OPERATIONS.LIST_AUDITED_LOCATIONS,
    CTRL_AEDC_OPERATIONS.LIST_AUDITED_LOCATIONS,
    idauditoria
  );
}

/**
 * Lista las ubicaciones que permanecen abiertas para captura.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @return {*} Colección de ubicaciones abiertas.
 */
function AuditoriaExcedentesDetalleController_listarUbicacionesAbiertas(
  idauditoria
) {
  return _aedcExecuteAuditIdMethod_(
    CTRL_AEDC_OPERATIONS.LIST_OPEN_LOCATIONS,
    CTRL_AEDC_OPERATIONS.LIST_OPEN_LOCATIONS,
    idauditoria
  );
}

/**
 * Verifica la disponibilidad del controlador sin consultar datos operativos.
 *
 * @return {!Object} Estado, controlador, módulo y compilación.
 */
function AuditoriaExcedentesDetalleController_ping() {
  return _aedcExecute_(CTRL_AEDC_OPERATIONS.PING, function () {
    return {
      ok: true,
      controller: CTRL_AEDC,
      modulo: CTRL_AEDC_MODULE,
      build: CTRL_AEDC_BUILD
    };
  });
}
