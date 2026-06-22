/**
 * AuditoriaExcedentesController.gs
 * ------------------------------------------------------------
 * Controller principal del módulo de auditoría de excedentes.
 *
 * RESPONSABILIDAD:
 * - exponer endpoints globales para google.script.run
 * - manejar errores controlados
 * - devolver respuestas consistentes al frontend
 *
 * DEPENDE DE:
 * - AuditoriaExcedentesService
 */

function _aec_exec_(label, fn) {
  try {
    console.log(`[AuditoriaExcedentesController] ${label} :: INICIO`);
    const result = fn();
    console.log(`[AuditoriaExcedentesController] ${label} :: OK`, result && typeof result === "object"
      ? JSON.stringify(result).slice(0, 1000)
      : result
    );
    return result;
  } catch (error) {
    console.error(`[AuditoriaExcedentesController] ${label} :: ERROR message`, error && error.message);
    console.error(`[AuditoriaExcedentesController] ${label} :: ERROR stack`, error && error.stack);
    console.error(`[AuditoriaExcedentesController] ${label} :: ERROR raw`, error);
    throw new Error(error && error.message ? error.message : `Error en ${label}`);
  }
}

/**
 * Bootstrap principal
 */
function AuditoriaExcedentesController_obtenerBootstrap() {
  return _aec_exec_("obtenerBootstrap", () => {
    return AuditoriaExcedentesService.obtenerBootstrap();
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
  return _aec_exec_("abrirAuditoria", () => {
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
  return _aec_exec_("listarAuditorias", () => {
    return AuditoriaExcedentesService.listarAuditorias(filtros || {});
  });
}

/**
 * Obtener auditoría por ID
 */
function AuditoriaExcedentesController_obtenerAuditoriaPorId(idauditoria) {
  return _aec_exec_("obtenerAuditoriaPorId", () => {
    return AuditoriaExcedentesService.obtenerAuditoriaPorId(idauditoria);
  });
}

/**
 * Obtener auditoría activa (cabecera + detalle + resumen)
 */
function AuditoriaExcedentesController_obtenerAuditoriaActiva(idauditoria) {
  return _aec_exec_("obtenerAuditoriaActiva", () => {
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
  return _aec_exec_("recalcularResumen", () => {
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
  return _aec_exec_("cerrarAuditoria", () => {
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
  return _aec_exec_("abrirUbicacion", () => {
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
  return _aec_exec_("registrarEscaneoIdUnico", () => {
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
  return _aec_exec_("cerrarUbicacion", () => {
    return AuditoriaExcedentesService.cerrarUbicacion(payload || {});
  });
}

/**
 * Obtener detalle puntual de una ubicación
 */
function AuditoriaExcedentesController_obtenerDetalleUbicacion(idauditoria, ubicacion) {
  return _aec_exec_("obtenerDetalleUbicacion", () => {
    return AuditoriaExcedentesService.obtenerDetalleUbicacion(idauditoria, ubicacion);
  });
}

/**
 * Obtener detalle completo de auditoría
 */
function AuditoriaExcedentesController_obtenerDetalleAuditoria(idauditoria) {
  return _aec_exec_("obtenerDetalleAuditoria", () => {
    return AuditoriaExcedentesService.obtenerDetalleAuditoria(idauditoria);
  });
}

/**
 * Ping simple de versión / salud del módulo
 */
function AuditoriaExcedentesController_ping() {
  return _aec_exec_("ping", () => {
    return {
      ok: true,
      controller: "AuditoriaExcedentesController",
      modulo: "AuditoriaExcedentes",
      build: "AUDITORIA-CTRL-2026-06-22-01"
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

function debugAuditoriaExcedentesController_listarAuditorias() {
  return AuditoriaExcedentesController_listarAuditorias({});
}
``