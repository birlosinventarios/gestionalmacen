/**
 * AuditoriaExcedentesController.gs
 */

/**
 * Bootstrap principal
 */
function AuditoriaExcedentesController_obtenerBootstrap() {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerBootstrap",
    () => AuditoriaExcedentesService.obtenerBootstrap()
  );
}

/**
 * Dashboard métrico principal
 */
function AuditoriaExcedentesController_obtenerDashboardMetricos() {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerDashboardMetricos",
    () => AuditoriaExcedentesService.obtenerDashboardMetricos()
  );
}

/**
 * Abrir auditoría
 */
function AuditoriaExcedentesController_abrirAuditoria(payload) {
  return execController_(
    "AuditoriaExcedentesController",
    "abrirAuditoria",
    () => AuditoriaExcedentesService.abrirAuditoria(payload || {})
  );
}

/**
 * Listar auditorías
 */
function AuditoriaExcedentesController_listarAuditorias(filtros) {
  return execController_(
    "AuditoriaExcedentesController",
    "listarAuditorias",
    () => AuditoriaExcedentesService.listarAuditorias(filtros || {})
  );
}

/**
 * Obtener auditoría por ID
 */
function AuditoriaExcedentesController_obtenerAuditoriaPorId(idauditoria) {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerAuditoriaPorId",
    () => AuditoriaExcedentesService.obtenerAuditoriaPorId(idauditoria)
  );
}

/**
 * Obtener auditoría activa
 */
function AuditoriaExcedentesController_obtenerAuditoriaActiva(idauditoria) {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerAuditoriaActiva",
    () => AuditoriaExcedentesService.obtenerAuditoriaActiva(idauditoria)
  );
}

/**
 * Recalcular resumen
 */
function AuditoriaExcedentesController_recalcularResumen(
  idauditoria,
  options
) {
  return execController_(
    "AuditoriaExcedentesController",
    "recalcularResumen",
    () => AuditoriaExcedentesService.recalcularResumen(
      idauditoria,
      options || {}
    )
  );
}

/**
 * Cerrar auditoría
 */
function AuditoriaExcedentesController_cerrarAuditoria(payload) {
  return execController_(
    "AuditoriaExcedentesController",
    "cerrarAuditoria",
    () => AuditoriaExcedentesService.cerrarAuditoria(payload || {})
  );
}

/**
 * Abrir ubicación
 */
function AuditoriaExcedentesController_abrirUbicacion(payload) {
  return execController_(
    "AuditoriaExcedentesController",
    "abrirUbicacion",
    () => AuditoriaExcedentesService.abrirUbicacion(payload || {})
  );
}

/**
 * Registrar escaneo
 */
function AuditoriaExcedentesController_registrarEscaneoIdUnico(payload) {
  return execController_(
    "AuditoriaExcedentesController",
    "registrarEscaneoIdUnico",
    () => AuditoriaExcedentesService.registrarEscaneoIdUnico(payload || {})
  );
}

/**
 * Cerrar ubicación
 */
function AuditoriaExcedentesController_cerrarUbicacion(payload) {
  return execController_(
    "AuditoriaExcedentesController",
    "cerrarUbicacion",
    () => AuditoriaExcedentesService.cerrarUbicacion(payload || {})
  );
}

/**
 * Obtener detalle ubicación
 */
function AuditoriaExcedentesController_obtenerDetalleUbicacion(
  idauditoria,
  ubicacion
) {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerDetalleUbicacion",
    () => AuditoriaExcedentesService.obtenerDetalleUbicacion(
      idauditoria,
      ubicacion
    )
  );
}

/**
 * Obtener detalle auditoría
 */
function AuditoriaExcedentesController_obtenerDetalleAuditoria(
  idauditoria
) {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerDetalleAuditoria",
    () => AuditoriaExcedentesService.obtenerDetalleAuditoria(
      idauditoria
    )
  );
}

/**
 * Ping
 */
function AuditoriaExcedentesController_ping() {
  return execController_(
    "AuditoriaExcedentesController",
    "ping",
    () => ({
      ok: true,
      controller: "AuditoriaExcedentesController",
      modulo: "AuditoriaExcedentes",
      build: "AUDITORIA-CTRL-2026-06-25-01"
    })
  );
}

/**
 * Detalle vivo
 */
function AuditoriaExcedentesController_obtenerDetalleAuditoriaEnVivo(
  idauditoria
) {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerDetalleAuditoriaEnVivo",
    () => AuditoriaExcedentesService.obtenerDetalleAuditoriaEnVivo(
      idauditoria
    )
  );
}

/**
 * Pulso vivo
 */
function AuditoriaExcedentesController_obtenerPulsoAuditoriaEnVivo(
  idauditoria
) {
  return execController_(
    "AuditoriaExcedentesController",
    "obtenerPulsoAuditoriaEnVivo",
    () => AuditoriaExcedentesService.obtenerPulsoAuditoriaEnVivo(
      idauditoria
    )
  );
}