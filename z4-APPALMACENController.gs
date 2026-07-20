
/**
 * APPALMACENController.gs
 */

// CONFIGURACIÓN DE VISTAS PERMITIDAS
// =========================================================
var APPALMACEN_VISTAS_PERMITIDAS = Object.freeze([
  // Vistas visibles en menú
  "FormularioTraspasos",
  "MonitorTraspasos",
  "FormularioEtiquetasIdentificadoras",
  "FormularioEtiquetasExcedentes",
  "FormularioEtiquetasExcedentesReimpresion",
  "FormularioDetallesProducto",
  "HistorialTraspasos",
  "GestorExcedentes",
  "NegativosBirlos",
  "MonitorReabastecimiento",
  "AuditoriaExcedentes",
  "PrototipoTraspasos",

  // Vistas ocultas / navegación interna
  "AuditoriaExcedentesDetalle",
  "AuditoriaExcedentesCaptura"
]);


// =========================================================
// HELPERS PRIVADOS
// =========================================================
function _appalmacen_toStr_(value) {
  return String(value == null ? "" : value).trim();
}

function _appalmacen_nombreVistaValido_(nombreArchivo) {
  var nombre = _appalmacen_toStr_(nombreArchivo);

  // Solo letras, números, guion y guion bajo.
  // Evita cosas como "../archivo" o nombres inyectados.
  return /^[A-Za-z0-9_-]+$/.test(nombre);
}

function _appalmacen_assertVistaPermitida_(nombreArchivo) {
  var nombre = _appalmacen_toStr_(nombreArchivo);

  if (!nombre) {
    throw new Error("Debes indicar el nombre de una vista");
  }

  if (!_appalmacen_nombreVistaValido_(nombre)) {
    throw new Error("El nombre de la vista contiene caracteres no permitidos");
  }

  if (APPALMACEN_VISTAS_PERMITIDAS.indexOf(nombre) === -1) {
    throw new Error("La vista solicitada no está permitida: " + nombre);
  }

  return nombre;
}

// =========================================================
// BOOTSTRAP PRINCIPAL
// =========================================================
function APPALMACENController_getBootstrap() {
  var t0 = Date.now();
  console.log("[BOOT][SERVER][CTRL] APPALMACENController_getBootstrap :: INICIO");

  try {
    var resultado = BootstrapServices.getInfoInicial();

    console.log(
      "[BOOT][SERVER][CTRL] APPALMACENController_getBootstrap :: FIN",
      (Date.now() - t0) + " ms"
    );

    return resultado;
  } catch (error) {
    console.error("[BOOT][SERVER][CTRL] ERROR en APPALMACENController_getBootstrap:", error);
    throw error;
  }
}

// =========================================================
// CARGA DE CONTENIDO HTML DE VISTAS
// =========================================================
function APPALMACENController_obtenerContenidoVista(nombreArchivo) {
  var t0 = Date.now();
  var vista = "";

  try {
    vista = _appalmacen_assertVistaPermitida_(nombreArchivo);

    console.log("[BOOT][SERVER][CTRL] obtenerContenidoVista :: INICIO", vista);

    // Se usa template porque algunas vistas pueden traer scriptlets.
    var template = HtmlService.createTemplateFromFile(vista);
    var html = template.evaluate().getContent();

    console.log(
      "[BOOT][SERVER][CTRL] obtenerContenidoVista :: FIN",
      vista,
      (Date.now() - t0) + " ms"
    );

    return html;
  } catch (error) {
    console.error(
      "[BOOT][SERVER][CTRL] ERROR obtenerContenidoVista:",
      {
        nombreArchivo: nombreArchivo,
        vistaNormalizada: vista,
        mensaje: error && error.message ? error.message : error,
        stack: error && error.stack ? error.stack : ""
      }
    );

    throw new Error(
      error && error.message
        ? error.message
        : ("No se pudo cargar la vista solicitada: " + _appalmacen_toStr_(nombreArchivo))
    );
  }
}

