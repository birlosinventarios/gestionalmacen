/**
 * FormularioEtiquetasExcedentesReimpresionController.gs
 * Funciones globales invocables desde google.script.run
 */

function FormularioEtiquetasExcedentesReimpresionController_getBootstrap() {
  return FormularioEtiquetasExcedentesReimpresionService.getBootstrap();
}

function FormularioEtiquetasExcedentesReimpresionController_obtenerBase() {
  return FormularioEtiquetasExcedentesReimpresionService.obtenerBase();
}

function FormularioEtiquetasExcedentesReimpresionController_procesarReimpresion(lista) {
  return FormularioEtiquetasExcedentesReimpresionService.procesarReimpresion(lista);
}