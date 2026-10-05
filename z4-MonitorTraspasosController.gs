/**
 * MonitorTraspasosController.gs
 */

const CTRL_MONITOR_TRASPASOS = "MonitorTraspasosController";

function MonitorTraspasosController_getBootstrap() {
  return execController_(
    CTRL_MONITOR_TRASPASOS,
    "getBootstrap",
    () => MonitorTraspasosService.getBootstrap()
  );
}

function MonitorTraspasosController_obtenerPendientes() {
  return execController_(
    CTRL_MONITOR_TRASPASOS,
    "obtenerPendientes",
    () => MonitorTraspasosService.obtenerPendientes()
  );
}

function MonitorTraspasosController_registrarMovimiento(
  numFila,
  folio,
  responsable
) {
  return execController_(
    CTRL_MONITOR_TRASPASOS,
    "registrarMovimiento",
    () => MonitorTraspasosService.registrarMovimiento(
      numFila,
      folio,
      responsable
    )
  );
}