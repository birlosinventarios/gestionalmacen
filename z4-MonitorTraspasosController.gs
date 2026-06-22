/**
 * MonitorTraspasosController.gs
 * Funciones globales invocables desde google.script.run
 */

function MonitorTraspasosController_getBootstrap() {
  return MonitorTraspasosService.getBootstrap();
}

function MonitorTraspasosController_obtenerPendientes() {
  return MonitorTraspasosService.obtenerPendientes();
}

function MonitorTraspasosController_registrarMovimiento(numFila, folio, responsable) {
  return MonitorTraspasosService.registrarMovimiento(numFila, folio, responsable);
}
