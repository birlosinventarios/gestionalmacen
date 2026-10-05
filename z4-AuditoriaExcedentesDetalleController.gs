const CTRL_AEDC = "AuditoriaExcedentesDetalleController";

/**
 * Abrir ubicación
 */
function AuditoriaExcedentesDetalleController_abrirUbicacion(payload) {
  return execController_(
    CTRL_AEDC,
    "abrirUbicacion",
    () => AuditoriaExcedentesDetalleService.abrirUbicacion(payload || {})
  );
}

/**
 * Obtener esperados por ubicación
 */
function AuditoriaExcedentesDetalleController_obtenerEsperadosPorUbicacion( idauditoria, ubicacion ) {
  return execController_(
    CTRL_AEDC,
    "obtenerEsperadosPorUbicacion",
    () => AuditoriaExcedentesDetalleService.obtenerEsperadosPorUbicacion(
      idauditoria,
      ubicacion
    )
  );
}

/**
 * Registrar escaneo
 */
function AuditoriaExcedentesDetalleController_registrarEscaneoIdUnico(payload) {
  return execController_(
    CTRL_AEDC,
    "registrarEscaneoIdUnico",
    () => AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico(
      payload || {}
    )
  );
}

/**
 * Cerrar ubicación
 */
function AuditoriaExcedentesDetalleController_cerrarUbicacion(payload) {
  return execController_(
    CTRL_AEDC,
    "cerrarUbicacion",
    () => AuditoriaExcedentesDetalleService.cerrarUbicacion(payload || {})
  );
}

/**
 * Obtener detalle ubicación
 */
function AuditoriaExcedentesDetalleController_getDetalleUbicacion(
  idauditoria,
  ubicacion
) {
  return execController_(
    CTRL_AEDC,
    "getDetalleUbicacion",
    () => AuditoriaExcedentesDetalleService.getDetalleUbicacion(
      idauditoria,
      ubicacion
    )
  );
}

/**
 * Listar ubicaciones auditadas
 */
function AuditoriaExcedentesDetalleController_listarUbicacionesAuditadas( idauditoria ) {
  return execController_(
    CTRL_AEDC,
    "listarUbicacionesAuditadas",
    () => AuditoriaExcedentesDetalleService.listarUbicacionesAuditadas(
      idauditoria
    )
  );
}

/**
 * Listar ubicaciones abiertas
 */
function AuditoriaExcedentesDetalleController_listarUbicacionesAbiertas( idauditoria ) {
  return execController_(
    CTRL_AEDC,
    "listarUbicacionesAbiertas",
    () => AuditoriaExcedentesDetalleService.listarUbicacionesAbiertas(
      idauditoria
    )
  );
}

/**
 * Ping
 */
function AuditoriaExcedentesDetalleController_ping() {
  return execController_(
    CTRL_AEDC,
    "ping",
    () => ({
      ok: true,
      controller: CTRL_AEDC,
      modulo: "AuditoriaExcedentesDetalle",
      build: "AUDITORIA-DETALLE-CTRL-2026-06-22-01"
    })
  );
}