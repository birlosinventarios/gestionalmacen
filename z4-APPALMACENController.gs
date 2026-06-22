/**
 * APPALMACENController.gs
 * Funciones globales invocables desde google.script.run
 */

function APPALMACENController_getBootstrap() {
  const t0 = Date.now();
  console.log("[BOOT][SERVER][CTRL] APPALMACENController_getBootstrap :: INICIO");

  try {
    const resultado = BootstrapServices.getInfoInicial();

    console.log(
      "[BOOT][SERVER][CTRL] APPALMACENController_getBootstrap :: FIN",
      `${Date.now() - t0} ms`
    );

    return resultado;
  } catch (error) {
    console.error("[BOOT][SERVER][CTRL] ERROR en APPALMACENController_getBootstrap:", error);
    throw error;
  }
}

function APPALMACENController_obtenerContenidoVista(nombreArchivo) {
  const t0 = Date.now();
  console.log("[BOOT][SERVER][CTRL] obtenerContenidoVista :: INICIO", nombreArchivo);

  try {
    const template = HtmlService.createTemplateFromFile(nombreArchivo);
    const html = template.evaluate().getContent();

    console.log(
      "[BOOT][SERVER][CTRL] obtenerContenidoVista :: FIN",
      nombreArchivo,
      `${Date.now() - t0} ms`
    );

    return html;
  } catch (error) {
    console.error("[BOOT][SERVER][CTRL] ERROR obtenerContenidoVista:", nombreArchivo, error);
    throw error;
  }
}
``