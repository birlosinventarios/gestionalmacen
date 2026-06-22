/**
 * HistorialTraspasosController.gs
 * Funciones globales invocables desde google.script.run
 */

function HistorialTraspasosController_getBootstrap() {
  return HistorialTraspasosService.getBootstrap();
}

function HistorialTraspasosController_obtenerRegistros() {
  return HistorialTraspasosService.obtenerRegistros();
}

function HistorialTraspasosController_actualizarRegistro(numFila, datos) {
  return HistorialTraspasosService.actualizarRegistro(numFila, datos);
}