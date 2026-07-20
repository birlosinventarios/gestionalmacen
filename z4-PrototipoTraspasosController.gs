/**
 * PrototipoTraspasosController.gs
 * Funciones globales invocables desde google.script.run
 */

function PrototipoTraspasosController_getBootstrap() {
  return PrototipoTraspasosService.getBootstrap();
}

function PrototipoTraspasosController_obtenerEstadoFolios(forceRefresh) {
  return PrototipoTraspasosService.obtenerEstadoFolios(forceRefresh === true);
}

function PrototipoTraspasosController_procesarMovimientosFinal(cola) {
  return PrototipoTraspasosService.procesarMovimientosFinal(cola);
}

