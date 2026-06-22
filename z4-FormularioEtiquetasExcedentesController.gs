/**
 * FormularioEtiquetasExcedentesController.gs
 * Funciones globales invocables desde google.script.run
 */

function FormularioEtiquetasExcedentesController_getBootstrap() {
  return FormularioEtiquetasExcedentesService.getBootstrap();
}

function FormularioEtiquetasExcedentesController_buscarProductoPorCodigo(codigo) {
  return FormularioEtiquetasExcedentesService.buscarProductoPorCodigo(codigo);
}

function FormularioEtiquetasExcedentesController_procesarLote(lote) {
  return FormularioEtiquetasExcedentesService.procesarLote(lote);
}