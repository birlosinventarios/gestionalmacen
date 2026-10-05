/**
 * FormularioEtiquetasExcedentesReimpresionController.gs
 * Funciones globales invocables desde google.script.run
 */

const CTRL_EXCEDENTES_REIMPRESION =
  "FormularioEtiquetasExcedentesReimpresionController";

function FormularioEtiquetasExcedentesReimpresionController_getBootstrap() {
  return execController_(
    CTRL_EXCEDENTES_REIMPRESION,
    "getBootstrap",
    () => FormularioEtiquetasExcedentesReimpresionService.getBootstrap()
  );
}

function FormularioEtiquetasExcedentesReimpresionController_obtenerBase() {
  return execController_(
    CTRL_EXCEDENTES_REIMPRESION,
    "obtenerBase",
    () => FormularioEtiquetasExcedentesReimpresionService.obtenerBase()
  );
}

function FormularioEtiquetasExcedentesReimpresionController_procesarReimpresion(lista) {
  return execController_(
    CTRL_EXCEDENTES_REIMPRESION,
    "procesarReimpresion",
    () => FormularioEtiquetasExcedentesReimpresionService.procesarReimpresion(lista)
  );
}