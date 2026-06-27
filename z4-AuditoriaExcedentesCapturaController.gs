/**
 * AuditoriaExcedentesCapturaController.gs
 */

var CTRL_AECC = "AuditoriaExcedentesCapturaController";

function AuditoriaExcedentesCapturaController_obtenerBootstrapCaptura() {
  return execController_(CTRL_AECC, "obtenerBootstrapCaptura", function () {
    return AuditoriaExcedentesCapturaService.obtenerBootstrapCaptura();
  });
}

function AuditoriaExcedentesCapturaController_obtenerAuditoriasAbiertas() {
  return execController_(CTRL_AECC, "obtenerAuditoriasAbiertas", function () {
    return AuditoriaExcedentesCapturaService.obtenerAuditoriasAbiertas();
  });
}

function AuditoriaExcedentesCapturaController_obtenerPaqueteCaptura(idauditoria) {
  return execController_(CTRL_AECC, "obtenerPaqueteCaptura", function () {
    return AuditoriaExcedentesCapturaService.obtenerPaqueteCaptura(idauditoria);
  });
}

function AuditoriaExcedentesCapturaController_abrirUbicacionPorEscaneo(payload) {
  return execController_(CTRL_AECC, "abrirUbicacionPorEscaneo", function () {
    return AuditoriaExcedentesCapturaService.abrirUbicacionPorEscaneo(payload || {});
  });
}

function AuditoriaExcedentesCapturaController_obtenerEstadoUbicacion(payload) {
  return execController_(CTRL_AECC, "obtenerEstadoUbicacion", function () {
    return AuditoriaExcedentesCapturaService.obtenerEstadoUbicacion(payload || {});
  });
}

function AuditoriaExcedentesCapturaController_registrarEscaneoIdUnico(payload) {
  return execController_(CTRL_AECC, "registrarEscaneoIdUnico", function () {
    return AuditoriaExcedentesCapturaService.registrarEscaneoIdUnico(payload || {});
  });
}

function AuditoriaExcedentesCapturaController_registrarEscaneosLote(payload) {
  return execController_(CTRL_AECC, "registrarEscaneosLote", function () {
    return AuditoriaExcedentesCapturaService.registrarEscaneosLote(payload || {});
  });
}

function AuditoriaExcedentesCapturaController_cerrarUbicacion(payload) {
  return execController_(CTRL_AECC, "cerrarUbicacion", function () {
    return AuditoriaExcedentesCapturaService.cerrarUbicacion(payload || {});
  });
}

function AuditoriaExcedentesCapturaController_cerrarAuditoria(payload) {
  return execController_(CTRL_AECC, "cerrarAuditoria", function () {
    return AuditoriaExcedentesCapturaService.cerrarAuditoria(payload || {});
  });
}

function AuditoriaExcedentesCapturaController_ping() {
  return execController_(CTRL_AECC, "ping", function () {
    return {
      ok: true,
      controller: CTRL_AECC,
      modulo: "AuditoriaExcedentesCaptura",
      build: "CAPTURA-OPTIMIZADA-2026-06-27"
    };
  });
}