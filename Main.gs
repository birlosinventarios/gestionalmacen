/**
 * Main.gs
 *
 * Punto de entrada de APPALMACEN para Google Apps Script.
 *
 * Responsabilidades:
 * - Crear el menú del Spreadsheet al abrir el archivo.
 * - Atender solicitudes HTTP GET de la aplicación web.
 * - Validar y resolver páginas permitidas, pruebas y vistas de impresión.
 * - Aplicar los recursos comunes a las plantillas HTML.
 * - Abrir la aplicación web y conservar accesos históricos desde el Spreadsheet.
 * - Proporcionar helpers para incluir parciales HTML y datos de respaldo.
 *
 * Dependencias globales:
 * - SpreadsheetApp
 * - HtmlService
 * - Utilities
 * - APPALMACEN_TESTING
 * - APPALMACEN_ROUTING
 * - APPALMACEN_TEMPLATE
 * - APPALMACEN_BRAND
 * - APPALMACEN_WEBAPP
 * - APPALMACEN_applyTemplateImports_()
 *
 * Puntos de entrada públicos:
 * - onOpen()
 * - doGet(e)
 * - abrirProyectoWeb()
 *
 * Compatibilidad histórica:
 * Las funciones abrir* adicionales se conservan porque pueden estar asociadas
 * con menús, botones, macros o accesos directos existentes.
 */

/** Nombre del menú personalizado visible en el Spreadsheet. */
const APPALMACEN_MENU_TITLE_ = "🔩 Aplicación Birlos y Tornillos";

/** Etiqueta de la acción principal del menú. */
const APPALMACEN_MENU_OPEN_LABEL_ = "⚙️ Abrir Aplicación";

/** Dimensiones estándar de los diálogos administrativos. */
const APPALMACEN_DIALOG_SIZE_ = Object.freeze({
  WIDTH: 1400,
  HEIGHT: 1200
});

/**
 * Escapa un valor antes de insertarlo en contenido HTML generado manualmente.
 *
 * @param {*} value Valor recibido.
 * @return {string} Texto seguro para HTML.
 * @private
 */
function APPALMACEN_escapeHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serializa un valor para insertarlo de forma segura en JavaScript embebido.
 *
 * @param {*} value Valor recibido.
 * @return {string} Literal JSON seguro para un bloque script.
 * @private
 */
function APPALMACEN_toInlineJson_(value) {
  return JSON.stringify(String(value == null ? "" : value))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Crea una salida HTML de error con contenido escapado.
 *
 * @param {string} title Título visible.
 * @param {*} error Error o mensaje recibido.
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 * @private
 */
function APPALMACEN_buildErrorOutput_(title, error) {
  var message =
    error && error.message
      ? error.message
      : String(error || "Error desconocido.");

  return HtmlService.createHtmlOutput(
    "<h1>" + APPALMACEN_escapeHtml_(title) + "</h1>" +
    "<p>" + APPALMACEN_escapeHtml_(message) + "</p>"
  );
}

/**
 * Evalúa una plantilla y aplica la configuración estándar de una página web.
 *
 * @param {string} fileName Archivo HTML de la plantilla.
 * @param {string} pageName Nombre lógico de la página.
 * @param {string} title Título del documento.
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 * @private
 */
function APPALMACEN_renderPage_(fileName, pageName, title) {
  var template = HtmlService.createTemplateFromFile(fileName);
  APPALMACEN_applyTemplateImports_(template, pageName);

  return template
    .evaluate()
    .setTitle(title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Abre una plantilla HTML dentro de un diálogo modal del Spreadsheet.
 *
 * @param {string} fileName Archivo HTML.
 * @param {string} dialogTitle Título del diálogo.
 * @param {number=} width Ancho del diálogo.
 * @param {number=} height Alto del diálogo.
 * @private
 */
function APPALMACEN_openModal_(fileName, dialogTitle, width, height) {
  var html = HtmlService
    .createTemplateFromFile(fileName)
    .evaluate()
    .setWidth(width || APPALMACEN_DIALOG_SIZE_.WIDTH)
    .setHeight(height || APPALMACEN_DIALOG_SIZE_.HEIGHT);

  SpreadsheetApp.getUi().showModalDialog(html, dialogTitle);
}

/**
 * Se ejecuta automáticamente al abrir el Spreadsheet.
 *
 * Crea un menú simplificado con acceso a la aplicación web.
 *
 * @return {void}
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(APPALMACEN_MENU_TITLE_)
    .addItem(APPALMACEN_MENU_OPEN_LABEL_, "abrirProyectoWeb")
    .addToUi();
}

/**
 * Punto de entrada HTTP de la aplicación web.
 *
 * Orden de resolución:
 * 1. Vista de pruebas habilitada.
 * 2. Página especial de impresión.
 * 3. Validación contra la lista de páginas permitidas.
 * 4. Plantilla normal de APPALMACEN.
 *
 * @param {GoogleAppsScript.Events.DoGet=} e Evento HTTP GET.
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var event = e || {};
  var parameters = event.parameter || {};

  if (
    typeof APPALMACEN_TESTING !== "undefined" &&
    APPALMACEN_TESTING.ENABLED &&
    parameters[APPALMACEN_TESTING.QUERY_PARAM]
  ) {
    var testView = String(
      parameters[APPALMACEN_TESTING.QUERY_PARAM] || ""
    ).trim();

    if (testView === APPALMACEN_TESTING.TESTS.sidebars.KEY) {
      return APPALMACEN_renderPage_(
        APPALMACEN_TESTING.TESTS.sidebars.FILE,
        APPALMACEN_TESTING.TESTS.sidebars.FILE,
        APPALMACEN_TESTING.TESTS.sidebars.TITLE
      );
    }
  }

  var pagina = parameters.p || APPALMACEN_TEMPLATE.DEFAULT_PAGE;

  if (APPALMACEN_ROUTING.PRINT_PAGES.indexOf(pagina) !== -1) {
    try {
      var printTemplate = HtmlService.createTemplateFromFile(
        "EtiquetaExcedentesImpresa"
      );

      printTemplate.lote = parameters.datos
        ? JSON.parse(parameters.datos)
        : [];
      printTemplate.fechaHora = Utilities.formatDate(
        new Date(),
        "GMT-6",
        "dd/MM/yyyy hh:mm a"
      );

      return printTemplate
        .evaluate()
        .setTitle("Imprimir Etiquetas")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (error) {
      return APPALMACEN_buildErrorOutput_(
        APPALMACEN_ROUTING.ERRORS.PRINT_ERROR_TITLE,
        error
      );
    }
  }

  if (APPALMACEN_ROUTING.PAGES_ALLOWED.indexOf(pagina) === -1) {
    return HtmlService.createHtmlOutput(
      "<h2>" +
      APPALMACEN_escapeHtml_(
        APPALMACEN_ROUTING.ERRORS.PAGE_NOT_FOUND_PREFIX +
        pagina +
        APPALMACEN_ROUTING.ERRORS.PAGE_NOT_FOUND_SUFFIX
      ) +
      "</h2>"
    );
  }

  try {
    return APPALMACEN_renderPage_(
      pagina,
      pagina,
      APPALMACEN_BRAND.DOCUMENT_TITLE
    );
  } catch (error) {
    return APPALMACEN_buildErrorOutput_("Error de carga", error);
  }
}

/**
 * Abre el proyecto web en una nueva pestaña desde un diálogo no modal.
 *
 * La URL se serializa para JavaScript y se escapa por separado para el enlace
 * de respaldo. Esto evita romper el HTML cuando la configuración contiene
 * caracteres especiales.
 *
 * @return {void}
 */
function abrirProyectoWeb() {
  var url = String(APPALMACEN_WEBAPP.URL || "").trim();

  if (!url) {
    throw new Error("APPALMACEN_WEBAPP.URL no está configurada.");
  }

  var urlHtml = APPALMACEN_escapeHtml_(url);
  var urlJson = APPALMACEN_toInlineJson_(url);

  var html = HtmlService.createHtmlOutput(
    "<!DOCTYPE html>" +
    "<html>" +
      "<head>" +
        "<base target=\"_top\">" +
      "</head>" +
      "<body style=\"font-family:Arial,sans-serif;padding:18px;text-align:center;\">" +
        "<p style=\"margin:0 0 12px;font-size:14px;color:#1c1d1f;\">" +
          "Abriendo proyecto..." +
        "</p>" +
        "<script>" +
          "window.open(" + urlJson + ",\"_blank\");" +
          "google.script.host.close();" +
        "</script>" +
        "<p style=\"margin-top:10px;font-size:12px;color:#666;\">" +
          "Si no se abrió automáticamente, " +
          "<a href=\"" + urlHtml + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
            "haz clic aquí" +
          "</a>." +
        "</p>" +
      "</body>" +
    "</html>"
  )
    .setWidth(360)
    .setHeight(140);

  SpreadsheetApp.getUi().showModelessDialog(html, "Abrir proyecto");
}

/** Abre el gestor histórico de excedentes desde el Spreadsheet. */
function abrirGestorExcedentes() {
  APPALMACEN_openModal_(
    "GestorExcedentes",
    "🚀 Panel de Control Excedentes",
    1600,
    1200
  );
}

/** Abre la consulta histórica de excedentes. */
function abrirConsultaExcedentes() {
  APPALMACEN_openModal_(
    "ConsultaExcedentes",
    "📋 Consulta de excedentes"
  );
}

/** Abre el historial de traspasos. */
function abrirHistorialTraspasos() {
  APPALMACEN_openModal_(
    "HistorialTraspasos",
    "📋 Historial de Traspasos"
  );
}

/** Abre el formulario histórico de traspasos. */
function abrirFormularioTraspasos() {
  APPALMACEN_openModal_(
    "FormularioTraspasos",
    "📋 Registrar Traspasos"
  );
}

/**
 * Abre el shell APPALMACEN en un diálogo modal y aplica sus imports.
 *
 * @return {void}
 */
function abrirAppAlmacen() {
  var template = HtmlService.createTemplateFromFile("APPALMACEN");
  APPALMACEN_applyTemplateImports_(
    template,
    APPALMACEN_TEMPLATE.DEFAULT_PAGE
  );

  var html = template
    .evaluate()
    .setWidth(APPALMACEN_DIALOG_SIZE_.WIDTH)
    .setHeight(APPALMACEN_DIALOG_SIZE_.HEIGHT)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  SpreadsheetApp.getUi().showModalDialog(html, "APPALMACEN");
}

/** Abre el generador de etiquetas de excedentes. */
function abrirFormularioEtiquetasExcedentes() {
  APPALMACEN_openModal_(
    "FormularioEtiquetasExcedentes",
    "📦 Generador de Etiquetas"
  );
}

/** Abre el generador histórico de etiquetas para casillero. */
function abrirFormularioEtiquetasExcedentesCasillero() {
  APPALMACEN_openModal_(
    "FormularioEtiquetasExcedentesCasillero",
    "📦 Generador de Etiquetas Excedente - Casillero"
  );
}

/** Abre la vista de reimpresión de etiquetas de excedentes. */
function abrirFormularioEtiquetasExcedentesReimpresion() {
  APPALMACEN_openModal_(
    "FormularioEtiquetasExcedentesReimpresion",
    "📦 Generador de Etiquetas - Reimpresion"
  );
}

/** Abre el generador histórico de etiquetas. */
function abrirFormularioEtiquetas() {
  APPALMACEN_openModal_(
    "FormularioEtiquetas",
    "🏷️ Generador de Etiquetas"
  );
}

/** Abre el monitor de traspasos. */
function abrirFormularioMonitorTraspasos() {
  APPALMACEN_openModal_(
    "MonitorTraspasos",
    "📋 Monitor de Traspasos",
    1600,
    1200
  );
}

/**
 * Evalúa e incluye un archivo HTML parcial.
 *
 * @param {string} nombreArchivo Nombre del archivo sin extensión.
 * @return {string} Contenido HTML evaluado.
 */
function incluir(nombreArchivo) {
  var fileName = String(nombreArchivo || "").trim();

  if (!fileName) {
    throw new Error("incluir: el nombre del archivo es obligatorio.");
  }

  return HtmlService
    .createTemplateFromFile(fileName)
    .evaluate()
    .getContent();
}

/**
 * Obtiene datos de respaldo para plantillas web que esperan un lote inicial.
 *
 * @return {Array<{codigo:*,descripcion:*,id:*}>} Primer registro disponible.
 */
function obtenerDatosParaWeb() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getActiveSheet();

  if (sheet.getLastRow() < 2 || sheet.getLastColumn() < 3) {
    return [];
  }

  var data = sheet.getRange(2, 1, 1, 3).getValues();

  return [
    {
      codigo: data[0][0],
      descripcion: data[0][1],
      id: data[0][2]
    }
  ];
}
