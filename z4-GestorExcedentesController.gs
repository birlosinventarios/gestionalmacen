/**
 * GestorExcedentesController.gs
 */

function GestorExcedentesController_obtenerVista() {
  const result = GestorExcedentesService.obtenerVista();

  result.__controllerDebug = {
    controller: "GestorExcedentesController",
    method: "GestorExcedentesController_obtenerVista",
    build: "CTRL-2026-06-22-01",
    dataLength: Array.isArray(result.data) ? result.data.length : -1,
    dataCompletaLength: Array.isArray(result.dataCompleta) ? result.dataCompleta.length : -1
  };

  console.log("[GestorExcedentesController] obtenerVista :: salida", result.__controllerDebug);

  return result;
}

function GestorExcedentesController_obtenerVistaRaw() {
  const result = GestorExcedentesService.obtenerVistaRaw();

  result.__controllerDebug = {
    controller: "GestorExcedentesController",
    method: "GestorExcedentesController_obtenerVistaRaw",
    build: "CTRL-2026-06-22-RAW-01",
    dataLength: Array.isArray(result.data) ? result.data.length : -1,
    dataCompletaLength: Array.isArray(result.dataCompleta) ? result.dataCompleta.length : -1
  };

  console.log("[GestorExcedentesController] obtenerVistaRaw :: salida", result.__controllerDebug);

  return result;
}

function GestorExcedentesController_obtenerExcedentesConsolidados() {
  return GestorExcedentesService.obtenerExcedentesConsolidados();
}

function GestorExcedentesController_getResumen() {
  return GestorExcedentesService.getResumen();
}

function GestorExcedentesController_clearCache() {
  return GestorExcedentesService.clearCache();
}

function GestorExcedentesController_pingVersion() {
  return {
    ok: true,
    controller: "GestorExcedentesController",
    build: "PING-2026-06-22-01"
  };
}
