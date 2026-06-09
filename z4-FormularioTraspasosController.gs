/**
 * FormularioTraspasosController.gs
 * Funciones globales invocables desde google.script.run
 */

function FormularioTraspasosController_getBootstrap() {
  return FormularioTraspasosService.getBootstrap();
}

function FormularioTraspasosController_buscarProductoPorCodigo(codigo) {
  return FormularioTraspasosService.buscarProductoPorCodigo(codigo);
}

function FormularioTraspasosController_obtenerUbicacionesPorBodega(bodega) {
  return FormularioTraspasosService.obtenerUbicacionesPorBodega(bodega);
}

function FormularioTraspasosController_registrarLote(lote) {
  return FormularioTraspasosService.registrarLote(lote);
}