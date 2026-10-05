/**
 * FormularioEtiquetasIdentificadorasController.gs
 */

const CTRL_ETIQUETAS_IDENTIFICADORAS =
  "FormularioEtiquetasIdentificadorasController";

function FormularioEtiquetasIdentificadorasController_getBootstrap() {
  return execController_(
    CTRL_ETIQUETAS_IDENTIFICADORAS,
    "getBootstrap",
    () => FormularioEtiquetasIdentificadorasService.getBootstrap()
  );
}

function FormularioEtiquetasIdentificadorasController_buscarProductoPorCodigo(codigo) {
  return execController_(
    CTRL_ETIQUETAS_IDENTIFICADORAS,
    "buscarProductoPorCodigo",
    () => FormularioEtiquetasIdentificadorasService.buscarProductoPorCodigo(codigo)
  );
}

function FormularioEtiquetasIdentificadorasController_procesarLote(lote) {
  return execController_(
    CTRL_ETIQUETAS_IDENTIFICADORAS,
    "procesarLote",
    () => FormularioEtiquetasIdentificadorasService.procesarLote(lote)
  );
}