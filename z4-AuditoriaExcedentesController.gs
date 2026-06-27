/**
 * AuditoriaExcedentesController.gs
 */

function _aec_exec_(label, fn) {
  try {
    console.log("[AuditoriaExcedentesController] " + label + " :: INICIO");
    var result = fn();

    console.log(
      "[AuditoriaExcedentesController] " + label + " :: OK",
      result && typeof result === "object"
        ? JSON.stringify(result).slice(0, 1000)
        : result
    );

    return result;
  } catch (error) {
    console.error("[AuditoriaExcedentesController] " + label + " :: ERROR message", error && error.message);
    console.error("[AuditoriaExcedentesController] " + label + " :: ERROR stack", error && error.stack);
    console.error("[AuditoriaExcedentesController] " + label + " :: ERROR raw", error);
    throw new Error(error && error.message ? error.message : ("Error en " + label));
  }
}

/**
 * Bootstrap principal
 */
function AuditoriaExcedentesController_obtenerBootstrap() {
  return _aec_exec_("obtenerBootstrap", function () {
    return AuditoriaExcedentesService.obtenerBootstrap();
  });
}

/**
 * Dashboard métrico principal
 */
function AuditoriaExcedentesController_obtenerDashboardMetricos() {
  return _aec_exec_("obtenerDashboardMetricos", function () {
    return AuditoriaExcedentesService.obtenerDashboardMetricos();
  });
}

/**
 * Abrir auditoría
 * payload esperado:
 * {
 *   auditor,
 *   tipoauditoria,   // GLOBAL | POR_BODEGA
 *   bodegaobjetivo,  // TODAS o una bodega
 *   observaciones
 * }
 */
function AuditoriaExcedentesController_abrirAuditoria(payload) {
  return _aec_exec_("abrirAuditoria", function () {
    return AuditoriaExcedentesService.abrirAuditoria(payload || {});
  });
}

/**
 * Listar auditorías con filtros opcionales
 * filtros:
 * {
 *   estatus,
 *   auditor,
 *   tipoauditoria,
 *   bodegaobjetivo
 * }
 */
function AuditoriaExcedentesController_listarAuditorias(filtros) {
  return _aec_exec_("listarAuditorias", function () {
    return AuditoriaExcedentesService.listarAuditorias(filtros || {});
  });
}

/**
 * Obtener auditoría por ID
 */
function AuditoriaExcedentesController_obtenerAuditoriaPorId(idauditoria) {
  return _aec_exec_("obtenerAuditoriaPorId", function () {
    return AuditoriaExcedentesService.obtenerAuditoriaPorId(idauditoria);
  });
}

/**
 * Obtener auditoría activa (cabecera + detalle + resumen)
 */
function AuditoriaExcedentesController_obtenerAuditoriaActiva(idauditoria) {
  return _aec_exec_("obtenerAuditoriaActiva", function () {
    return AuditoriaExcedentesService.obtenerAuditoriaActiva(idauditoria);
  });
}

/**
 * Recalcular resumen
 * options:
 * {
 *   persistir: true|false
 * }
 */
function AuditoriaExcedentesController_recalcularResumen(idauditoria, options) {
  return _aec_exec_("recalcularResumen", function () {
    return AuditoriaExcedentesService.recalcularResumen(idauditoria, options || {});
  });
}

/**
 * Cerrar auditoría
 * payload:
 * {
 *   idauditoria,
 *   observaciones,
 *   cerrarUbicacionesAbiertas: true|false
 * }
 */
function AuditoriaExcedentesController_cerrarAuditoria(payload) {
  return _aec_exec_("cerrarAuditoria", function () {
    return AuditoriaExcedentesService.cerrarAuditoria(payload || {});
  });
}

/**
 * Abrir ubicación desde el controller principal
 * payload:
 * {
 *   idauditoria,
 *   ubicacion,
 *   observaciones
 * }
 */
function AuditoriaExcedentesController_abrirUbicacion(payload) {
  return _aec_exec_("abrirUbicacion", function () {
    return AuditoriaExcedentesService.abrirUbicacion(payload || {});
  });
}

/**
 * Registrar escaneo de IdUnico desde el controller principal
 * payload:
 * {
 *   idauditoria,
 *   ubicacion,
 *   idunico
 * }
 */
function AuditoriaExcedentesController_registrarEscaneoIdUnico(payload) {
  return _aec_exec_("registrarEscaneoIdUnico", function () {
    return AuditoriaExcedentesService.registrarEscaneoIdUnico(payload || {});
  });
}

/**
 * Cerrar ubicación desde el controller principal
 * payload:
 * {
 *   idauditoria,
 *   ubicacion,
 *   observaciones
 * }
 */
function AuditoriaExcedentesController_cerrarUbicacion(payload) {
  return _aec_exec_("cerrarUbicacion", function () {
    return AuditoriaExcedentesService.cerrarUbicacion(payload || {});
  });
}

/**
 * Obtener detalle puntual de una ubicación
 */
function AuditoriaExcedentesController_obtenerDetalleUbicacion(idauditoria, ubicacion) {
  return _aec_exec_("obtenerDetalleUbicacion", function () {
    return AuditoriaExcedentesService.obtenerDetalleUbicacion(idauditoria, ubicacion);
  });
}

/**
 * Obtener detalle completo de auditoría
 */
function AuditoriaExcedentesController_obtenerDetalleAuditoria(idauditoria) {
  return _aec_exec_("obtenerDetalleAuditoria", function () {
    return AuditoriaExcedentesService.obtenerDetalleAuditoria(idauditoria);
  });
}

/**
 * Ping simple de versión / salud del módulo
 */
function AuditoriaExcedentesController_ping() {
  return _aec_exec_("ping", function () {
    return {
      ok: true,
      controller: "AuditoriaExcedentesController",
      modulo: "AuditoriaExcedentes",
      build: "AUDITORIA-CTRL-2026-06-25-01"
    };
  });
}

/**
 * =========================================================
 * DEBUGGERS
 * =========================================================
 */

function debugAuditoriaExcedentesController_ping() {
  return AuditoriaExcedentesController_ping();
}

function debugAuditoriaExcedentesController_obtenerBootstrap() {
  return AuditoriaExcedentesController_obtenerBootstrap();
}

function debugAuditoriaExcedentesController_obtenerDashboardMetricos() {
  return AuditoriaExcedentesController_obtenerDashboardMetricos();
}

function debugAuditoriaExcedentesController_listarAuditorias() {
  return AuditoriaExcedentesController_listarAuditorias({});
}

function debugAuditoriaExcedentesController_obtenerAuditoriaPorId() {
  return AuditoriaExcedentesController_obtenerAuditoriaPorId("AUD-PRUEBA-001");
}

function debugAuditoriaExcedentesController_obtenerAuditoriaActiva() {
  return AuditoriaExcedentesController_obtenerAuditoriaActiva("AUD-PRUEBA-001");
}

function debugAuditoriaExcedentesController_recalcularResumen() {
  return AuditoriaExcedentesController_recalcularResumen("AUD-PRUEBA-001", { persistir: false });
}

function debugAuditoriaExcedentesController_abrirAuditoria() {
  return AuditoriaExcedentesController_abrirAuditoria({
    auditor: "PRUEBA SISTEMA",
    tipoauditoria: "GLOBAL",
    bodegaobjetivo: "TODAS",
    observaciones: "PRUEBA DESDE CONTROLLER"
  });
}

function debugAuditoriaExcedentesController_cerrarAuditoria() {
  return AuditoriaExcedentesController_cerrarAuditoria({
    idauditoria: "AUD-PRUEBA-001",
    observaciones: "CIERRE DE PRUEBA",
    cerrarUbicacionesAbiertas: true
  });
}

function debugAuditoriaExcedentesController_abrirUbicacion() {
  return AuditoriaExcedentesController_abrirUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesController_registrarEscaneoIdUnico() {
  return AuditoriaExcedentesController_registrarEscaneoIdUnico({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19",
    idunico: "202605141622201581"
  });
}

function debugAuditoriaExcedentesController_cerrarUbicacion() {
  return AuditoriaExcedentesController_cerrarUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesController_obtenerDetalleUbicacion() {
  return AuditoriaExcedentesController_obtenerDetalleUbicacion("AUD-PRUEBA-001", "B1-19");
}

function debugAuditoriaExcedentesController_obtenerDetalleAuditoria() {
  return AuditoriaExcedentesController_obtenerDetalleAuditoria("AUD-PRUEBA-001");
}