function FormularioEtiquetasExcedentesController_getBootstrap() {
  try {
    return FormularioEtiquetasExcedentesService.getBootstrap();
  } catch (error) {
    console.error("❌ Error getBootstrap:", error);
    throw new Error(error.message || "Error al cargar bootstrap");
  }
}

function FormularioEtiquetasExcedentesController_buscarProductoPorCodigo(codigo) {
  try {
    return FormularioEtiquetasExcedentesService.buscarProductoPorCodigo(codigo);
  } catch (error) {
    console.error("❌ Error buscarProductoPorCodigo:", error);
    throw new Error(error.message || "Error al buscar producto");
  }
}

function FormularioEtiquetasExcedentesController_procesarLote(lote) {
  try {
    console.log("📦 Procesando lote:", lote.length);
    return FormularioEtiquetasExcedentesService.procesarLote(lote);
  } catch (error) {
    console.error("❌ Error procesarLote:", error);
    throw new Error(error.message || "Error en generación de etiquetas");
  }
}