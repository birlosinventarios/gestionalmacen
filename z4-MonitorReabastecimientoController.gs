/**
 * MonitorReabastecimientoController.gs
 * Funciones globales invocables desde google.script.run
 */

function MonitorReabastecimientoController_getVista() {
  return MonitorReabastecimientoService.getVista();
}

/**
 * Opcional:
 * Devuelve solo los registros consolidados
 */
function MonitorReabastecimientoController_getRegistros() {
  return MonitorReabastecimientoService.getRegistros();
}

/**
 * Opcional:
 * Devuelve solo el resumen / headers KPI
 */
function MonitorReabastecimientoController_getResumen() {
  return MonitorReabastecimientoService.getResumen();
}