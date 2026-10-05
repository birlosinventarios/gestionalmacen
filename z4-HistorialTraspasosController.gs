/**
 * HistorialTraspasosController.gs
 */

const CTRL_HISTORIAL_TRASPASOS = "HistorialTraspasosController";

function HistorialTraspasosController_getBootstrap() {
  return execController_(
    CTRL_HISTORIAL_TRASPASOS,
    "getBootstrap",
    () => HistorialTraspasosService.getBootstrap()
  );
}

function HistorialTraspasosController_obtenerRegistros() {
  return execController_(
    CTRL_HISTORIAL_TRASPASOS,
    "obtenerRegistros",
    () => HistorialTraspasosService.obtenerRegistros()
  );
}

function HistorialTraspasosController_actualizarRegistro(numFila, datos) {
  return execController_(
    CTRL_HISTORIAL_TRASPASOS,
    "actualizarRegistro",
    () => HistorialTraspasosService.actualizarRegistro(numFila, datos)
  );
}