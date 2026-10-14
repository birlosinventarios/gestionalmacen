/**
 * z4-AuditoriaExcedentesController
 *
 * @fileoverview Controlador RPC del módulo de auditoría de excedentes. Expone
 * endpoints compatibles con google.script.run, normaliza sus argumentos y
 * delega toda la lógica de negocio a AuditoriaExcedentesService mediante el
 * ejecutor común execController_().
 *
 * Responsabilidades:
 * - Exponer el bootstrap y el dashboard métrico del módulo.
 * - Abrir, consultar, listar, recalcular y cerrar auditorías.
 * - Abrir, consultar y cerrar ubicaciones auditadas.
 * - Registrar escaneos individuales de IdUnico.
 * - Consultar el detalle histórico y el detalle en vivo de una auditoría.
 * - Consultar el pulso operativo en vivo.
 * - Validar identificadores, ubicaciones, filtros, opciones y payloads.
 * - Verificar la existencia del ejecutor y de cada método del servicio.
 * - Mantener nombres de operación estables para trazabilidad.
 * - Publicar un endpoint ping sin consultar información operativa.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - AuditoriaExcedentesService.
 *
 * Reglas de diseño y seguridad:
 * - El controlador no contiene reglas de negocio ni acceso a datos.
 * - Los payloads ausentes se normalizan como objetos vacíos.
 * - Los arreglos y valores primitivos se rechazan cuando se espera un objeto.
 * - Los identificadores y ubicaciones obligatorios no pueden estar vacíos.
 * - Cada método del servicio se valida antes de ser invocado.
 * - Todo endpoint, incluido ping(), pasa por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 *
 * API pública:
 * - obtenerBootstrap().
 * - obtenerDashboardMetricos().
 * - abrirAuditoria(payload).
 * - listarAuditorias(filtros).
 * - obtenerAuditoriaPorId(idauditoria).
 * - obtenerAuditoriaActiva(idauditoria).
 * - recalcularResumen(idauditoria, options).
 * - cerrarAuditoria(payload).
 * - abrirUbicacion(payload).
 * - registrarEscaneoIdUnico(payload).
 * - cerrarUbicacion(payload).
 * - obtenerDetalleUbicacion(idauditoria, ubicacion).
 * - obtenerDetalleAuditoria(idauditoria).
 * - obtenerDetalleAuditoriaEnVivo(idauditoria).
 * - obtenerPulsoAuditoriaEnVivo(idauditoria).
 * - ping().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_AEC = "AuditoriaExcedentesController";

/** @const {string} Nombre del módulo funcional. */
const CTRL_AEC_MODULE = "AuditoriaExcedentes";

/** @const {string} Identificador controlado de la compilación. */
const CTRL_AEC_BUILD = "AUDITORIA-CTRL-2026-10-14-01";

/**
 * Catálogo inmutable de nombres públicos y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_AEC_OPERATIONS = Object.freeze({
  GET_BOOTSTRAP: "obtenerBootstrap",
  GET_DASHBOARD_METRICS: "obtenerDashboardMetricos",
  OPEN_AUDIT: "abrirAuditoria",
  LIST_AUDITS: "listarAuditorias",
  GET_AUDIT_BY_ID: "obtenerAuditoriaPorId",
  GET_ACTIVE_AUDIT: "obtenerAuditoriaActiva",
  RECALCULATE_SUMMARY: "recalcularResumen",
  CLOSE_AUDIT: "cerrarAuditoria",
  OPEN_LOCATION: "abrirUbicacion",
  REGISTER_UNIQUE_ID_SCAN: "registrarEscaneoIdUnico",
  CLOSE_LOCATION: "cerrarUbicacion",
  GET_LOCATION_DETAIL: "obtenerDetalleUbicacion",
  GET_AUDIT_DETAIL: "obtenerDetalleAuditoria",
  GET_LIVE_AUDIT_DETAIL: "obtenerDetalleAuditoriaEnVivo",
  GET_LIVE_AUDIT_PULSE: "obtenerPulsoAuditoriaEnVivo",
  PING: "ping"
});

// =============================================================================
// NORMALIZACIÓN Y VALIDACIÓN PRIVADA
// =============================================================================

/**
 * Convierte un valor a texto y elimina espacios exteriores.
 *
 * @param {*} value Valor recibido.
 * @return {string} Texto normalizado o una cadena vacía.
 * @private
 */
function _aecToString_(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Normaliza un argumento que debe ser un objeto.
 *
 * null y undefined se convierten en un objeto vacío. Los arreglos y valores
 * primitivos se rechazan para impedir contratos ambiguos en el servicio.
 *
 * @param {*} value Valor recibido desde la interfaz.
 * @param {string} argumentName Nombre del argumento para el mensaje de error.
 * @param {string} operationName Operación pública asociada.
 * @return {!Object} Objeto seguro para delegación.
 * @throws {TypeError} Si el valor no es un objeto válido.
 * @private
 */
function _aecNormalizeObject_(value, argumentName, operationName) {
  if (value == null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "El argumento " + argumentName + " de " + operationName +
        " debe ser un objeto válido."
    );
  }

  return value;
}

/**
 * Valida un identificador obligatorio de auditoría.
 *
 * @param {*} idAuditoria Identificador recibido desde la interfaz.
 * @param {string} operationName Operación que requiere el identificador.
 * @return {string} Identificador normalizado.
 * @throws {Error} Si el identificador está vacío.
 * @private
 */
function _aecRequireAuditId_(idAuditoria, operationName) {
  const normalizedId = _aecToString_(idAuditoria);

  if (!normalizedId) {
    throw new Error(
      "El identificador de auditoría es obligatorio para " +
        operationName + "."
    );
  }

  return normalizedId;
}

/**
 * Valida una ubicación obligatoria.
 *
 * @param {*} ubicacion Ubicación recibida desde la interfaz.
 * @param {string} operationName Operación que requiere la ubicación.
 * @return {string} Ubicación normalizada.
 * @throws {Error} Si la ubicación está vacía.
 * @private
 */
function _aecRequireLocation_(ubicacion, operationName) {
  const normalizedLocation = _aecToString_(ubicacion).toUpperCase();

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
function _aecGetService_(methodName) {
  if (
    typeof AuditoriaExcedentesService === "undefined" ||
    !AuditoriaExcedentesService
  ) {
    throw new Error("AuditoriaExcedentesService no está disponible.");
  }

  if (
    !methodName ||
    typeof AuditoriaExcedentesService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio de auditoría no implementa la operación: " +
        methodName + "."
    );
  }

  return AuditoriaExcedentesService;
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
function _aecExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(CTRL_AEC, operationName, callback);
}

/**
 * Delega una operación sin argumentos al servicio de dominio.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @return {*} Resultado de la llamada delegada.
 * @private
 */
function _aecExecuteServiceMethod_(operationName, serviceMethod) {
  return _aecExecute_(operationName, function () {
    const service = _aecGetService_(serviceMethod);
    return service[serviceMethod]();
  });
}

/**
 * Delega una operación cuyo único argumento es un objeto normalizado.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {*} payload Datos recibidos desde el cliente.
 * @param {string=} argumentName Nombre descriptivo del argumento.
 * @return {*} Resultado de la llamada delegada.
 * @private
 */
function _aecExecuteObjectMethod_(
  operationName,
  serviceMethod,
  payload,
  argumentName
) {
  return _aecExecute_(operationName, function () {
    const normalizedPayload = _aecNormalizeObject_(
      payload,
      argumentName || "payload",
      operationName
    );
    const service = _aecGetService_(serviceMethod);
    return service[serviceMethod](normalizedPayload);
  });
}

/**
 * Delega una operación cuyo único argumento es un Id de auditoría.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @param {*} idAuditoria Identificador recibido desde el cliente.
 * @return {*} Resultado de la llamada delegada.
 * @private
 */
function _aecExecuteAuditIdMethod_(
  operationName,
  serviceMethod,
  idAuditoria
) {
  return _aecExecute_(operationName, function () {
    const normalizedId = _aecRequireAuditId_(
      idAuditoria,
      operationName
    );
    const service = _aecGetService_(serviceMethod);
    return service[serviceMethod](normalizedId);
  });
}

// =============================================================================
// API PÚBLICA: INICIALIZACIÓN Y CONSULTAS
// =============================================================================

/**
 * Obtiene catálogos, configuración y datos iniciales del módulo.
 *
 * @return {*} Bootstrap generado por el servicio de dominio.
 */
function AuditoriaExcedentesController_obtenerBootstrap() {
  return _aecExecuteServiceMethod_(
    CTRL_AEC_OPERATIONS.GET_BOOTSTRAP,
    CTRL_AEC_OPERATIONS.GET_BOOTSTRAP
  );
}

/**
 * Obtiene las métricas consolidadas del dashboard principal.
 *
 * @return {*} Métricas generadas por el servicio de dominio.
 */
function AuditoriaExcedentesController_obtenerDashboardMetricos() {
  return _aecExecuteServiceMethod_(
    CTRL_AEC_OPERATIONS.GET_DASHBOARD_METRICS,
    CTRL_AEC_OPERATIONS.GET_DASHBOARD_METRICS
  );
}

/**
 * Lista auditorías aplicando filtros opcionales.
 *
 * @param {*} filtros Criterios de búsqueda, estado y paginación.
 * @return {*} Colección filtrada de auditorías.
 */
function AuditoriaExcedentesController_listarAuditorias(filtros) {
  return _aecExecuteObjectMethod_(
    CTRL_AEC_OPERATIONS.LIST_AUDITS,
    CTRL_AEC_OPERATIONS.LIST_AUDITS,
    filtros,
    "filtros"
  );
}

/**
 * Obtiene una auditoría mediante su identificador.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @return {*} Auditoría localizada por el servicio.
 */
function AuditoriaExcedentesController_obtenerAuditoriaPorId(idauditoria) {
  return _aecExecuteAuditIdMethod_(
    CTRL_AEC_OPERATIONS.GET_AUDIT_BY_ID,
    CTRL_AEC_OPERATIONS.GET_AUDIT_BY_ID,
    idauditoria
  );
}

/**
 * Obtiene y valida una auditoría que todavía esté activa.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @return {*} Auditoría activa localizada por el servicio.
 */
function AuditoriaExcedentesController_obtenerAuditoriaActiva(idauditoria) {
  return _aecExecuteAuditIdMethod_(
    CTRL_AEC_OPERATIONS.GET_ACTIVE_AUDIT,
    CTRL_AEC_OPERATIONS.GET_ACTIVE_AUDIT,
    idauditoria
  );
}

// =============================================================================
// API PÚBLICA: CICLO DE VIDA DE LA AUDITORÍA
// =============================================================================

/**
 * Abre una nueva auditoría con los parámetros enviados por la interfaz.
 *
 * @param {*} payload Datos de alcance, usuario y configuración de apertura.
 * @return {*} Auditoría creada por el servicio.
 */
function AuditoriaExcedentesController_abrirAuditoria(payload) {
  return _aecExecuteObjectMethod_(
    CTRL_AEC_OPERATIONS.OPEN_AUDIT,
    CTRL_AEC_OPERATIONS.OPEN_AUDIT,
    payload
  );
}

/**
 * Recalcula el resumen consolidado de una auditoría.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @param {*} options Opciones de recálculo y actualización.
 * @return {*} Resumen recalculado por el servicio.
 */
function AuditoriaExcedentesController_recalcularResumen(
  idauditoria,
  options
) {
  return _aecExecute_(
    CTRL_AEC_OPERATIONS.RECALCULATE_SUMMARY,
    function () {
      const normalizedId = _aecRequireAuditId_(
        idauditoria,
        CTRL_AEC_OPERATIONS.RECALCULATE_SUMMARY
      );
      const normalizedOptions = _aecNormalizeObject_(
        options,
        "options",
        CTRL_AEC_OPERATIONS.RECALCULATE_SUMMARY
      );
      const service = _aecGetService_(
        CTRL_AEC_OPERATIONS.RECALCULATE_SUMMARY
      );

      return service.recalcularResumen(
        normalizedId,
        normalizedOptions
      );
    }
  );
}

/**
 * Cierra una auditoría después de validar su estado final.
 *
 * @param {*} payload Identificador, observaciones y contexto de cierre.
 * @return {*} Resultado definitivo de la auditoría.
 */
function AuditoriaExcedentesController_cerrarAuditoria(payload) {
  return _aecExecuteObjectMethod_(
    CTRL_AEC_OPERATIONS.CLOSE_AUDIT,
    CTRL_AEC_OPERATIONS.CLOSE_AUDIT,
    payload
  );
}

// =============================================================================
// API PÚBLICA: UBICACIONES Y ESCANEOS
// =============================================================================

/**
 * Abre una ubicación dentro de una auditoría activa.
 *
 * @param {*} payload Auditoría, ubicación y contexto operativo.
 * @return {*} Estado de apertura de la ubicación.
 */
function AuditoriaExcedentesController_abrirUbicacion(payload) {
  return _aecExecuteObjectMethod_(
    CTRL_AEC_OPERATIONS.OPEN_LOCATION,
    CTRL_AEC_OPERATIONS.OPEN_LOCATION,
    payload
  );
}

/**
 * Registra el escaneo de un IdUnico dentro de una ubicación abierta.
 *
 * @param {*} payload Auditoría, ubicación, IdUnico y usuario responsable.
 * @return {*} Resultado validado del escaneo.
 */
function AuditoriaExcedentesController_registrarEscaneoIdUnico(payload) {
  return _aecExecuteObjectMethod_(
    CTRL_AEC_OPERATIONS.REGISTER_UNIQUE_ID_SCAN,
    CTRL_AEC_OPERATIONS.REGISTER_UNIQUE_ID_SCAN,
    payload
  );
}

/**
 * Cierra una ubicación y solicita su conciliación al servicio.
 *
 * @param {*} payload Identificadores y observaciones de cierre.
 * @return {*} Resultado del cierre de ubicación.
 */
function AuditoriaExcedentesController_cerrarUbicacion(payload) {
  return _aecExecuteObjectMethod_(
    CTRL_AEC_OPERATIONS.CLOSE_LOCATION,
    CTRL_AEC_OPERATIONS.CLOSE_LOCATION,
    payload
  );
}

/**
 * Obtiene el detalle de una ubicación específica de la auditoría.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @param {*} ubicacion Ubicación que se desea consultar.
 * @return {*} Detalle consolidado de la ubicación.
 */
function AuditoriaExcedentesController_obtenerDetalleUbicacion(
  idauditoria,
  ubicacion
) {
  return _aecExecute_(
    CTRL_AEC_OPERATIONS.GET_LOCATION_DETAIL,
    function () {
      const normalizedId = _aecRequireAuditId_(
        idauditoria,
        CTRL_AEC_OPERATIONS.GET_LOCATION_DETAIL
      );
      const normalizedLocation = _aecRequireLocation_(
        ubicacion,
        CTRL_AEC_OPERATIONS.GET_LOCATION_DETAIL
      );
      const service = _aecGetService_(
        CTRL_AEC_OPERATIONS.GET_LOCATION_DETAIL
      );

      return service.obtenerDetalleUbicacion(
        normalizedId,
        normalizedLocation
      );
    }
  );
}

// =============================================================================
// API PÚBLICA: DETALLE Y MONITOREO EN VIVO
// =============================================================================

/**
 * Obtiene el detalle consolidado de una auditoría.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @return {*} Detalle histórico generado por el servicio.
 */
function AuditoriaExcedentesController_obtenerDetalleAuditoria(
  idauditoria
) {
  return _aecExecuteAuditIdMethod_(
    CTRL_AEC_OPERATIONS.GET_AUDIT_DETAIL,
    CTRL_AEC_OPERATIONS.GET_AUDIT_DETAIL,
    idauditoria
  );
}

/**
 * Obtiene el detalle vigente sin depender de un estado previamente almacenado.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @return {*} Detalle vivo generado por el servicio.
 */
function AuditoriaExcedentesController_obtenerDetalleAuditoriaEnVivo(
  idauditoria
) {
  return _aecExecuteAuditIdMethod_(
    CTRL_AEC_OPERATIONS.GET_LIVE_AUDIT_DETAIL,
    CTRL_AEC_OPERATIONS.GET_LIVE_AUDIT_DETAIL,
    idauditoria
  );
}

/**
 * Obtiene el pulso operativo vigente de una auditoría.
 *
 * @param {*} idauditoria Identificador de la auditoría.
 * @return {*} Métricas vivas de avance y estado.
 */
function AuditoriaExcedentesController_obtenerPulsoAuditoriaEnVivo(
  idauditoria
) {
  return _aecExecuteAuditIdMethod_(
    CTRL_AEC_OPERATIONS.GET_LIVE_AUDIT_PULSE,
    CTRL_AEC_OPERATIONS.GET_LIVE_AUDIT_PULSE,
    idauditoria
  );
}

/**
 * Verifica que el controlador esté disponible sin consultar datos operativos.
 *
 * @return {!Object} Estado, controlador, módulo y compilación.
 */
function AuditoriaExcedentesController_ping() {
  return _aecExecute_(CTRL_AEC_OPERATIONS.PING, function () {
    return {
      ok: true,
      controller: CTRL_AEC,
      modulo: CTRL_AEC_MODULE,
      build: CTRL_AEC_BUILD
    };
  });
}
