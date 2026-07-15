/**
 * ImpresionPuenteController.gs
 * Funciones globales invocables desde google.script.run
 */

function ImpresionPuenteController_imprimir(printJob) {
  return execController_(
    "ImpresionPuenteController",
    "imprimir",
    function () {
      return ImpresionPuenteService.imprimir(printJob || {});
    }
  );
}

function ImpresionPuenteController_health() {
  return execController_(
    "ImpresionPuenteController",
    "health",
    function () {
      return ImpresionPuenteService.health();
    }
  );
}

function ImpresionPuenteController_debugConfig() {
  return execController_(
    "ImpresionPuenteController",
    "debugConfig",
    function () {
      return ImpresionPuenteService.debugConfig();
    }
  );
}