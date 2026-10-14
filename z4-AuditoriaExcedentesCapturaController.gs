/**
 * z4-AuditoriaExcedentesCapturaController
 *
 * @fileoverview Controlador RPC del módulo de captura de auditorías de
 * excedentes. Su responsabilidad es validar el contrato mínimo de la solicitud,
 * delegar las operaciones al servicio de dominio y centralizar la ejecución
 * mediante execController_().
 *
 * Responsabilidades:
 * - Exponer endpoints públicos compatibles con google.script.run.
 * - Validar la disponibilidad del ejecutor y del servicio de dominio.
 * - Normalizar identificadores y payloads antes de delegarlos.
 * - Rechazar arreglos, valores primitivos y objetos no válidos como payload.
 * - Mantener nombres de operación estables para trazabilidad y diagnóstico.
 * - Evitar lógica de negocio, persistencia o cálculos dentro del controlador.
 * - Publicar un endpoint ping con información controlada de compilación.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - AuditoriaExcedentesCapturaService.
 *
 * Reglas de diseño:
 * - El controlador solo orquesta y adapta contratos.
 * - Los errores de negocio pertenecen al servicio de dominio.
 * - Todo endpoint, incluido ping(), se ejecuta mediante execController_().
 * - Los payloads ausentes se normalizan como objetos vacíos.
 * - Los métodos del servicio se validan antes de ser invocados.
 * - Las constantes globales se mantienen inmutables.
 *
 * API pública:
 * - obtenerBootstrapCaptura().
 * - obtenerAuditoriasAbiertas().
 * - obtenerPaqueteCaptura(idauditoria).
 * - abrirUbicacionPorEscaneo(payload).
 * - obtenerEstadoUbicacion(payload).
 * - registrarEscaneoIdUnico(payload).
 * - registrarEscaneosLote(payload).
 * - cerrarUbicacion(payload).
 * - cerrarAuditoria(payload).
 * - enriquecerSobrantesLote(payload).
 * - actualizarObservacionesSobrantes(payload).
 * - ping().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_AECC = "AuditoriaExcedentesCapturaController";

/** @const {string} Nombre del módulo funcional. */
const CTRL_AECC_MODULE = "AuditoriaExcedentesCaptura";

/** @const {string} Identificador controlado de la compilación. */
const CTRL_AECC_BUILD = "CAPTURA-OPTIMIZADA-2026-10-14";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_AECC_OPERATIONS = Object.freeze({
  GET_BOOTSTRAP: "obtenerBootstrapCaptura",
  GET_OPEN_AUDITS: "obtenerAuditoriasAbiertas",
  GET_CAPTURE_PACKAGE: "obtenerPaqueteCaptura",
  OPEN_LOCATION_BY_SCAN: "abrirUbicacionPorEscaneo",
  GET_LOCATION_STATE: "obtenerEstadoUbicacion",
  REGISTER_UNIQUE_ID_SCAN: "registrarEscaneoIdUnico",
  REGISTER_SCAN_BATCH: "registrarEscaneosLote",
  CLOSE_LOCATION: "cerrarUbicacion",
  CLOSE_AUDIT: "cerrarAuditoria",
  ENRICH_SURPLUS_BATCH: "enriquecerSobrantesLote",
  UPDATE_SURPLUS_NOTES: "actualizarObservacionesSobrantes",
  PING: "ping"
});

// =============================================================================
// UTILIDADES PRIVADAS DEL CONTROLADOR
// =============================================================================

/**
 * Convierte un valor a texto y elimina espacios exteriores.
 *
 * @param {*} value Valor recibido.
 * @return {string} Texto normalizado o cadena vacía.
 * @private
 */
function _aeccToString_(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Normaliza un payload RPC como objeto plano.
 *
 * Los valores null y undefined se convierten en un objeto vacío. Los arreglos y
 * valores primitivos se rechazan para evitar contratos ambiguos en el servicio.
 *
 * @param {*} payload Payload recibido desde la interfaz.
 * @param {string} operationName Operación utilizada en el mensaje de error.
 * @return {!Object} Payload seguro para delegación.
 * @throws {TypeError} Si el payload no es un objeto válido.
 * @private
 */
function _aeccNormalizePayload_(payload, operationName) {
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
 * Valida un identificador de auditoría obligatorio.
 *
 * @param {*} idAuditoria Identificador recibido desde la interfaz.
 * @return {string} Identificador normalizado.
 * @throws {Error} Si el identificador está vacío.
 * @private
 */
function _aeccRequireAuditId_(idAuditoria) {
  const normalizedId = _aeccToString_(idAuditoria);

  if (!normalizedId) {
    throw new Error("El identificador de auditoría es obligatorio.");
  }

  return normalizedId;
}

/**
 * Obtiene y valida el servicio de dominio.
 *
 * @param {string} methodName Método que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _aeccGetService_(methodName) {
  if (
    typeof AuditoriaExcedentesCapturaService === "undefined" ||
    !AuditoriaExcedentesCapturaService
  ) {
    throw new Error(
      "AuditoriaExcedentesCapturaService no está disponible."
    );
  }

  if (
    !methodName ||
    typeof AuditoriaExcedentesCapturaService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio de captura no implementa la operación: " + methodName + "."
    );
  }

  return AuditoriaExcedentesCapturaService;
}

/**
 * Ejecuta una operación pública mediante el wrapper común de controladores.
 *
 * Centraliza la validación de execController_(), conserva el nombre lógico del
 * controlador y evita repetir la misma estructura en todos los endpoints.
 *
 * @param {string} operationName Nombre estable de la operación.
 * @param {function(): *} callback Trabajo que se ejecutará dentro del wrapper.
 * @return {*} Resultado devuelto por execController_().
 * @throws {Error} Si el ejecutor común no está disponible.
 * @private
 */
function _aeccExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(CTRL_AECC, operationName, callback);
}

/**
 * Delega una operación sin argumentos al servicio de captura.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @return {*} Resultado de la operación delegada.
 * @private
 */
function _aeccExecuteServiceMethod_(operationName, serviceMethod) {
  return _aeccExecute_(operationName, function () {
    const service = _aeccGetService_(serviceMethod);
    return service[serviceMethod]();
  });
}

/**
 * Delega una operación con payload normalizado al servicio de captura.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {*} payload Payload recibido desde el cliente.
 * @return {*} Resultado de la operación delegada.
 * @private
 */
function _aeccExecutePayloadMethod_(
  operationName,
  serviceMethod,
  payload
) {
  return _aeccExecute_(operationName, function () {
    const normalizedPayload = _aeccNormalizePayload_(
      payload,
      operationName
    );
    const service = _aeccGetService_(serviceMethod);
    return service[serviceMethod](normalizedPayload);
  });
}

// =============================================================================
// API PÚBLICA DE CAPTURA DE AUDITORÍAS
// =============================================================================

/**
 * Obtiene catálogos, configuración y datos iniciales de la captura.
 *
 * @return {*} Contrato inicial generado por el servicio de dominio.
 */
function AuditoriaExcedentesCapturaController_obtenerBootstrapCaptura() {
  return _aeccExecuteServiceMethod_(
    CTRL_AECC_OPERATIONS.GET_BOOTSTRAP,
    CTRL_AECC_OPERATIONS.GET_BOOTSTRAP
  );
}

/**
 * Obtiene las auditorías que todavía admiten captura operativa.
 *
 * @return {*} Colección generada por el servicio de dominio.
 */
function AuditoriaExcedentesCapturaController_obtenerAuditoriasAbiertas() {
  return _aeccExecuteServiceMethod_(
    CTRL_AECC_OPERATIONS.GET_OPEN_AUDITS,
    CTRL_AECC_OPERATIONS.GET_OPEN_AUDITS
  );
}

/**
 * Obtiene el paquete completo de captura de una auditoría.
 *
 * @param {*} idauditoria Identificador de la auditoría solicitada.
 * @return {*} Paquete de captura generado por el servicio.
 */
function AuditoriaExcedentesCapturaController_obtenerPaqueteCaptura(
  idauditoria
) {
  return _aeccExecute_(
    CTRL_AECC_OPERATIONS.GET_CAPTURE_PACKAGE,
    function () {
      const auditId = _aeccRequireAuditId_(idauditoria);
      const service = _aeccGetService_(
        CTRL_AECC_OPERATIONS.GET_CAPTURE_PACKAGE
      );
      return service.obtenerPaqueteCaptura(auditId);
    }
  );
}

/**
 * Abre una ubicación a partir de los datos de un escaneo.
 *
 * @param {*} payload Datos de auditoría, ubicación y lectura.
 * @return {*} Estado de apertura generado por el servicio.
 */
function AuditoriaExcedentesCapturaController_abrirUbicacionPorEscaneo(
  payload
) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.OPEN_LOCATION_BY_SCAN,
    CTRL_AECC_OPERATIONS.OPEN_LOCATION_BY_SCAN,
    payload
  );
}

/**
 * Obtiene el estado vigente de una ubicación dentro de la auditoría.
 *
 * @param {*} payload Identificadores necesarios para resolver la ubicación.
 * @return {*} Estado consolidado de la ubicación.
 */
function AuditoriaExcedentesCapturaController_obtenerEstadoUbicacion(
  payload
) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.GET_LOCATION_STATE,
    CTRL_AECC_OPERATIONS.GET_LOCATION_STATE,
    payload
  );
}

/**
 * Registra un escaneo individual de IdUnico.
 *
 * @param {*} payload Datos del escaneo y contexto de la ubicación.
 * @return {*} Resultado validado del registro.
 */
function AuditoriaExcedentesCapturaController_registrarEscaneoIdUnico(
  payload
) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.REGISTER_UNIQUE_ID_SCAN,
    CTRL_AECC_OPERATIONS.REGISTER_UNIQUE_ID_SCAN,
    payload
  );
}

/**
 * Registra un micro-lote de escaneos en una sola llamada RPC.
 *
 * @param {*} payload Lote y contexto operativo de la captura.
 * @return {*} Resultado consolidado del lote.
 */
function AuditoriaExcedentesCapturaController_registrarEscaneosLote(
  payload
) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.REGISTER_SCAN_BATCH,
    CTRL_AECC_OPERATIONS.REGISTER_SCAN_BATCH,
    payload
  );
}

/**
 * Cierra una ubicación después de validar su estado de captura.
 *
 * @param {*} payload Datos de cierre y observaciones aplicables.
 * @return {*} Resultado del cierre de ubicación.
 */
function AuditoriaExcedentesCapturaController_cerrarUbicacion(payload) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.CLOSE_LOCATION,
    CTRL_AECC_OPERATIONS.CLOSE_LOCATION,
    payload
  );
}

/**
 * Cierra una auditoría y solicita su conciliación final al servicio.
 *
 * @param {*} payload Identificador, usuario y observaciones de cierre.
 * @return {*} Resultado final de la auditoría.
 */
function AuditoriaExcedentesCapturaController_cerrarAuditoria(payload) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.CLOSE_AUDIT,
    CTRL_AECC_OPERATIONS.CLOSE_AUDIT,
    payload
  );
}

/**
 * Enriquece un lote de sobrantes con información autoritativa.
 *
 * @param {*} payload Sobrantes que se desean enriquecer.
 * @return {*} Lote enriquecido por el servicio.
 */
function AuditoriaExcedentesCapturaController_enriquecerSobrantesLote(
  payload
) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.ENRICH_SURPLUS_BATCH,
    CTRL_AECC_OPERATIONS.ENRICH_SURPLUS_BATCH,
    payload
  );
}

/**
 * Actualiza observaciones asociadas a sobrantes de la auditoría.
 *
 * @param {*} payload Identificadores y observaciones que se actualizarán.
 * @return {*} Resultado de la actualización.
 */
function AuditoriaExcedentesCapturaController_actualizarObservacionesSobrantes(
  payload
) {
  return _aeccExecutePayloadMethod_(
    CTRL_AECC_OPERATIONS.UPDATE_SURPLUS_NOTES,
    CTRL_AECC_OPERATIONS.UPDATE_SURPLUS_NOTES,
    payload
  );
}

/**
 * Verifica la disponibilidad del controlador sin consultar datos operativos.
 *
 * El endpoint se mantiene dentro de execController_() para conservar el mismo
 * esquema de trazabilidad y manejo de errores que el resto de la API.
 *
 * @return {!Object} Estado, controlador, módulo y compilación.
 */
function AuditoriaExcedentesCapturaController_ping() {
  return _aeccExecute_(CTRL_AECC_OPERATIONS.PING, function () {
    return {
      ok: true,
      controller: CTRL_AECC,
      modulo: CTRL_AECC_MODULE,
      build: CTRL_AECC_BUILD
    };
  });
}
