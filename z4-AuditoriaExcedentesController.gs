/**
 * AuditoriaExcedentesController.gs
 * ------------------------------------------------------------
 * Controllers para UI / HTML service.
 * Encapsulan llamadas al service y devuelven respuestas seguras.
 * ------------------------------------------------------------
 */

function AuditoriaExcedentesController_crearAuditoria(payload) {
  return AuditoriaExcedentesService_crearAuditoria(payload || {});
}

function AuditoriaExcedentesController_abrirUbicacion(payload) {
  return AuditoriaExcedentesService_abrirUbicacionAuditoria(payload || {});
}

function AuditoriaExcedentesController_registrarEscaneo(payload) {
  return AuditoriaExcedentesService_registrarEscaneoAuditoria(payload || {});
}

function AuditoriaExcedentesController_cerrarUbicacion(payload) {
  return AuditoriaExcedentesService_cerrarUbicacionAuditoria(payload || {});
}

function AuditoriaExcedentesController_cerrarAuditoria(payload) {
  return AuditoriaExcedentesService_cerrarAuditoria(payload || {});
}

function AuditoriaExcedentesController_listarEventos(filtros) {
  return AuditoriaExcedentesService_listarEventos(filtros || {});
}
