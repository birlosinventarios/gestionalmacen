/**
 * PrototipoTraspasosController.gs
 * Funciones globales invocables desde google.script.run
 */

function PrototipoTraspasosController_getBootstrap() {
  return PrototipoTraspasosService.getBootstrap();
}

function PrototipoTraspasosController_obtenerEstadoFolios() {
  return PrototipoTraspasosService.obtenerEstadoFolios();
}

function PrototipoTraspasosController_procesarMovimientosFinal(cola) {
  return PrototipoTraspasosService.procesarMovimientosFinal(cola);
}

