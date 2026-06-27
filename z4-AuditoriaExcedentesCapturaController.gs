/**
 * AuditoriaExcedentesCapturaController.gs
 */

function _aecc_exec_(label, fn) {
  try {
    console.log("[AuditoriaExcedentesCapturaController] " + label + " :: INICIO");
    var result = fn();

    console.log(
      "[AuditoriaExcedentesCapturaController] " + label + " :: OK",
      result && typeof result === "object"
        ? JSON.stringify(result).slice(0, 1000)
        : result
    );

    return result;
  } catch (error) {
    console.error("[AuditoriaExcedentesCapturaController] " + label + " :: ERROR message", error && error.message);
    console.error("[AuditoriaExcedentesCapturaController] " + label + " :: ERROR stack", error && error.stack);
    console.error("[AuditoriaExcedentesCapturaController] " + label + " :: ERROR raw", error);
    throw new Error(error && error.message ? error.message : ("Error en " + label));
  }
}

/**
 * Bootstrap específico para captura
 */
function AuditoriaExcedentesCapturaController_obtenerBootstrapCaptura() {
  return _aecc_exec_("obtenerBootstrapCaptura", function () {
    return AuditoriaExcedentesCapturaService.obtenerBootstrapCaptura();
  });
}

/**
 * Obtener auditorías abiertas
 */
function AuditoriaExcedentesCapturaController_obtenerAuditoriasAbiertas() {
  return _aecc_exec_("obtenerAuditoriasAbiertas", function () {
    return AuditoriaExcedentesCapturaService.obtenerAuditoriasAbiertas();
  });
}

/**
 * Abrir ubicación por escaneo
 * payload:
 * {
 *   idauditoria,
 *   identificadorUbicacion
 * }
 */
function AuditoriaExcedentesCapturaController_abrirUbicacionPorEscaneo(payload) {
  return _aecc_exec_("abrirUbicacionPorEscaneo", function () {
    return AuditoriaExcedentesCapturaService.abrirUbicacionPorEscaneo(payload || {});
  });
}

/**
 * Obtener estado vivo de ubicación
 * payload:
 * {
 *   idauditoria,
 *   ubicacion
 * }
 */
function AuditoriaExcedentesCapturaController_obtenerEstadoUbicacion(payload) {
  return _aecc_exec_("obtenerEstadoUbicacion", function () {
    return AuditoriaExcedentesCapturaService.obtenerEstadoUbicacion(payload || {});
  });
}

/**
 * Registrar escaneo IdUnico
 * payload:
 * {
 *   idauditoria,
 *   ubicacion,
 *   idunico
 * }
 */
function AuditoriaExcedentesCapturaController_registrarEscaneoIdUnico(payload) {
  return _aecc_exec_("registrarEscaneoIdUnico", function () {
    return AuditoriaExcedentesCapturaService.registrarEscaneoIdUnico(payload || {});
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
function AuditoriaExcedentesCapturaController_cerrarUbicacion(payload) {
  return _aecc_exec_("cerrarUbicacion", function () {
    return AuditoriaExcedentesCapturaService.cerrarUbicacion(payload || {});
  });
}

/**
 * Cerrar auditoría desde captura
 * payload:
 * {
 *   idauditoria,
 *   observaciones,
 *   cerrarUbicacionesAbiertas
 * }
 */
function AuditoriaExcedentesCapturaController_cerrarAuditoria(payload) {
  return _aecc_exec_("cerrarAuditoria", function () {
    return AuditoriaExcedentesCapturaService.cerrarAuditoria(payload || {});
  });
}

/**
 * Ping simple
 */
function AuditoriaExcedentesCapturaController_ping() {
  return _aecc_exec_("ping", function () {
    return {
      ok: true,
      controller: "AuditoriaExcedentesCapturaController",
      modulo: "AuditoriaExcedentesCaptura",
      build: "AUDITORIA-CAPTURA-CTRL-2026-06-26-01"
    };
  });
}

/**
 * =========================================================
 * DEBUGGERS
 * =========================================================
 */

function debugAuditoriaExcedentesCapturaController_ping() {
  return AuditoriaExcedentesCapturaController_ping();
}

function debugAuditoriaExcedentesCapturaController_obtenerBootstrapCaptura() {
  return AuditoriaExcedentesCapturaController_obtenerBootstrapCaptura();
}

function debugAuditoriaExcedentesCapturaController_obtenerAuditoriasAbiertas() {
  return AuditoriaExcedentesCapturaController_obtenerAuditoriasAbiertas();
}

function debugAuditoriaExcedentesCapturaController_abrirUbicacionPorEscaneo() {
  return AuditoriaExcedentesCapturaController_abrirUbicacionPorEscaneo({
    idauditoria: "AUD-PRUEBA-001",
    identificadorUbicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesCapturaController_obtenerEstadoUbicacion() {
  return AuditoriaExcedentesCapturaController_obtenerEstadoUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesCapturaController_registrarEscaneoIdUnico() {
  return AuditoriaExcedentesCapturaController_registrarEscaneoIdUnico({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19",
    idunico: "202605141622201581"
  });
}

function debugAuditoriaExcedentesCapturaController_cerrarUbicacion() {
  return AuditoriaExcedentesCapturaController_cerrarUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesCapturaController_cerrarAuditoria() {
  return AuditoriaExcedentesCapturaController_cerrarAuditoria({
    idauditoria: "AUD-PRUEBA-001",
    observaciones: "CIERRE DESDE CAPTURA",
    cerrarUbicacionesAbiertas: true
  });
}
