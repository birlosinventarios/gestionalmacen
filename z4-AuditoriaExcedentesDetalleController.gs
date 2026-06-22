/**
 * AuditoriaExcedentesDetalleController.gs
 * ------------------------------------------------------------
 * Controller especializado del detalle operativo de auditoría.
 *
 * RESPONSABILIDAD:
 * - abrir ubicación
 * - obtener esperados por ubicación
 * - registrar escaneos
 * - cerrar ubicación
 * - consultar detalle operativo
 *
 * DEPENDE DE:
 * - AuditoriaExcedentesDetalleService
 */

function _aedc_exec_(label, fn) {
  try {
    console.log(`[AuditoriaExcedentesDetalleController] ${label} :: INICIO`);
    const result = fn();
    console.log(`[AuditoriaExcedentesDetalleController] ${label} :: OK`, result && typeof result === "object"
      ? JSON.stringify(result).slice(0, 1000)
      : result
    );
    return result;
  } catch (error) {
    console.error(`[AuditoriaExcedentesDetalleController] ${label} :: ERROR message`, error && error.message);
    console.error(`[AuditoriaExcedentesDetalleController] ${label} :: ERROR stack`, error && error.stack);
    console.error(`[AuditoriaExcedentesDetalleController] ${label} :: ERROR raw`, error);
    throw new Error(error && error.message ? error.message : `Error en ${label}`);
  }
}

/**
 * Abrir ubicación
 * payload:
 * {
 *   idauditoria,
 *   ubicacion,
 *   observaciones
 * }
 */
function AuditoriaExcedentesDetalleController_abrirUbicacion(payload) {
  return _aedc_exec_("abrirUbicacion", () => {
    return AuditoriaExcedentesDetalleService.abrirUbicacion(payload || {});
  });
}

/**
 * Obtener esperados por ubicación
 */
function AuditoriaExcedentesDetalleController_obtenerEsperadosPorUbicacion(idauditoria, ubicacion) {
  return _aedc_exec_("obtenerEsperadosPorUbicacion", () => {
    return AuditoriaExcedentesDetalleService.obtenerEsperadosPorUbicacion(idauditoria, ubicacion);
  });
}

/**
 * Registrar escaneo de IdUnico
 * payload:
 * {
 *   idauditoria,
 *   ubicacion,
 *   idunico
 * }
 */
function AuditoriaExcedentesDetalleController_registrarEscaneoIdUnico(payload) {
  return _aedc_exec_("registrarEscaneoIdUnico", () => {
    return AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico(payload || {});
  });
}

/**
 * Cerrar ubicación
 * payload:
 * {
 *   idauditoria,
 *   ubicacion,
 *   observaciones
 * }
 */
function AuditoriaExcedentesDetalleController_cerrarUbicacion(payload) {
  return _aedc_exec_("cerrarUbicacion", () => {
    return AuditoriaExcedentesDetalleService.cerrarUbicacion(payload || {});
  });
}

/**
 * Obtener detalle de una ubicación
 */
function AuditoriaExcedentesDetalleController_getDetalleUbicacion(idauditoria, ubicacion) {
  return _aedc_exec_("getDetalleUbicacion", () => {
    return AuditoriaExcedentesDetalleService.getDetalleUbicacion(idauditoria, ubicacion);
  });
}

/**
 * Listar ubicaciones auditadas
 */
function AuditoriaExcedentesDetalleController_listarUbicacionesAuditadas(idauditoria) {
  return _aedc_exec_("listarUbicacionesAuditadas", () => {
    return AuditoriaExcedentesDetalleService.listarUbicacionesAuditadas(idauditoria);
  });
}

/**
 * Listar ubicaciones abiertas
 */
function AuditoriaExcedentesDetalleController_listarUbicacionesAbiertas(idauditoria) {
  return _aedc_exec_("listarUbicacionesAbiertas", () => {
    return AuditoriaExcedentesDetalleService.listarUbicacionesAbiertas(idauditoria);
  });
}

/**
 * Ping simple del detalle
 */
function AuditoriaExcedentesDetalleController_ping() {
  return _aedc_exec_("ping", () => {
    return {
      ok: true,
      controller: "AuditoriaExcedentesDetalleController",
      modulo: "AuditoriaExcedentesDetalle",
      build: "AUDITORIA-DETALLE-CTRL-2026-06-22-01"
    };
  });
}

/**
 * =========================================================
 * DEBUGGERS
 * =========================================================
 */

function debugAuditoriaExcedentesDetalleController_ping() {
  return AuditoriaExcedentesDetalleController_ping();
}

function debugAuditoriaExcedentesDetalleController_abrirUbicacion() {
  return AuditoriaExcedentesDetalleController_abrirUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesDetalleController_obtenerEsperadosPorUbicacion() {
  return AuditoriaExcedentesDetalleController_obtenerEsperadosPorUbicacion("AUD-PRUEBA-001", "B1-19");
}