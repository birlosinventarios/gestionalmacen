/**
 * MonitorReabastecimientoController.gs
 */

const CTRL_MONITOR_REABASTECIMIENTO =
  "MonitorReabastecimientoController";

function MonitorReabastecimientoController_getVista() {
  return execController_(
    CTRL_MONITOR_REABASTECIMIENTO,
    "getVista",
    () => MonitorReabastecimientoService.getVista()
  );
}

/**
 * Opcional:
 * Devuelve solo los registros consolidados
 */
function MonitorReabastecimientoController_getRegistros() {
  return execController_(
    CTRL_MONITOR_REABASTECIMIENTO,
    "getRegistros",
    () => MonitorReabastecimientoService.getRegistros()
  );
}

/**
 * Opcional:
 * Devuelve solo el resumen / headers KPI
 */
function MonitorReabastecimientoController_getResumen() {
  return execController_(
    CTRL_MONITOR_REABASTECIMIENTO,
    "getResumen",
    () => MonitorReabastecimientoService.getResumen()
  );
}