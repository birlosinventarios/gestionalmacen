/**
 * PrototipoTraspasosController.gs
 */

const CTRL_PROTOTIPO_TRASPASOS =
  "PrototipoTraspasosController";

function PrototipoTraspasosController_getBootstrap() {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "getBootstrap",
    () => PrototipoTraspasosService.getBootstrap()
  );
}

function PrototipoTraspasosController_obtenerEstadoFolios(
  forceRefresh
) {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "obtenerEstadoFolios",
    () => PrototipoTraspasosService.obtenerEstadoFolios(
      forceRefresh === true
    )
  );
}

function PrototipoTraspasosController_procesarMovimientosFinal(
  cola
) {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "procesarMovimientosFinal",
    () => PrototipoTraspasosService.procesarMovimientosFinal(
      cola
    )
  );
}

function PrototipoTraspasosController_clearCacheFolios() {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "clearCacheFolios",
    () => {
      if (
        typeof APPALMACENCache !== "undefined" &&
        typeof APPALMACENCache.clearPrototipoFolios === "function"
      ) {
        return APPALMACENCache.clearPrototipoFolios();
      }

      return false;
    }
  );
}

