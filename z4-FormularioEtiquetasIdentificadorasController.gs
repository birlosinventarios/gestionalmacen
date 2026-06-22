/**
 * FormularioEtiquetasIdentificadorasController.gs
 * Funciones globales invocables desde google.script.run
 */

function FormularioEtiquetasIdentificadorasController_getBootstrap() {
  return FormularioEtiquetasIdentificadorasService.getBootstrap();
}

function FormularioEtiquetasIdentificadorasController_buscarProductoPorCodigo(codigo) {
  return FormularioEtiquetasIdentificadorasService.buscarProductoPorCodigo(codigo);
}

function FormularioEtiquetasIdentificadorasController_procesarLote(lote) {
  return FormularioEtiquetasIdentificadorasService.procesarLote(lote);
}
