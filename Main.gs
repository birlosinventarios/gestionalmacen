/**
 * Main.gs
 */


/**
 * Se ejecuta automaticamente al abrir el Spreadsheet.
 * Menu simplificado: solo acceso al proyecto web.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu("🔩 Aplicación Birlos y Tornillos")
    .addItem("⚙️ Abrir Aplicación", "abrirProyectoWeb")
    .addToUi();
}


/**
 * Funcion principal de Aplicacion Web.
 * Gestiona la navegacion por parametros (?p=...).
 */
function doGet(e) {
  e = e || {};
  e.parameter = e.parameter || {};

  if (
    typeof APPALMACEN_TESTING !== "undefined" &&
    APPALMACEN_TESTING.ENABLED &&
    e.parameter &&
    e.parameter[APPALMACEN_TESTING.QUERY_PARAM]
  ) {
    var testView = String(e.parameter[APPALMACEN_TESTING.QUERY_PARAM] || "").trim();

    if (testView === APPALMACEN_TESTING.TESTS.sidebars.KEY) {
      var testTemplate = HtmlService.createTemplateFromFile(
        APPALMACEN_TESTING.TESTS.sidebars.FILE
      );

      APPALMACEN_applyTemplateImports_(
        testTemplate,
        APPALMACEN_TESTING.TESTS.sidebars.FILE
      );

      return testTemplate
        .evaluate()
        .setTitle(APPALMACEN_TESTING.TESTS.sidebars.TITLE)
        .addMetaTag("viewport", "width=device-width, initial-scale=1")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }

  var pagina = e.parameter.p || APPALMACEN_TEMPLATE.DEFAULT_PAGE;

  if (APPALMACEN_ROUTING.PRINT_PAGES.indexOf(pagina) !== -1) {
    try {
      var tmp = HtmlService.createTemplateFromFile("EtiquetaExcedentesImpresa");

      tmp.lote = e.parameter.datos
        ? JSON.parse(e.parameter.datos)
        : [];

      tmp.fechaHora = Utilities.formatDate(
        new Date(),
        "GMT-6",
        "dd/MM/yyyy hh:mm a"
      );

      return tmp
        .evaluate()
        .setTitle("Imprimir Etiquetas")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

    } catch (err) {
      return HtmlService.createHtmlOutput(
        "<h2>" +
          APPALMACEN_ROUTING.ERRORS.PRINT_ERROR_TITLE +
        "</h2><p>" +
          err.message +
        "</p>"
      );
    }
  }

  if (APPALMACEN_ROUTING.PAGES_ALLOWED.indexOf(pagina) === -1) {
    return HtmlService.createHtmlOutput(
      "<h2>" +
        APPALMACEN_ROUTING.ERRORS.PAGE_NOT_FOUND_PREFIX +
        pagina +
        APPALMACEN_ROUTING.ERRORS.PAGE_NOT_FOUND_SUFFIX +
      "</h2>"
    );
  }

  try {
    var template = HtmlService.createTemplateFromFile(pagina);

    APPALMACEN_applyTemplateImports_(template, pagina);

    return template
      .evaluate()
      .setTitle(APPALMACEN_BRAND.DOCUMENT_TITLE)
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (error) {
    return HtmlService.createHtmlOutput(
      "<h1>Error de carga</h1><p>" + error.message + "</p>"
    );
  }
}


/**
 * Abre el proyecto web en una nueva ventana/pestana.
 */
function abrirProyectoWeb() {
  const url = APPALMACEN_WEBAPP.URL;

  const html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html>' +
    '<html>' +
      '<head>' +
        '<base target="_top">' +
      '</head>' +

      '<body style="font-family: Arial, sans-serif; padding: 18px; text-align: center;">' +
        '<p style="margin: 0 0 12px 0; font-size: 14px; color: #1c1d1f;">' +
          'Abriendo proyecto...' +
        '</p>' +

        '<script>' +
          'window.open("' + url + '", "_blank");' +
          'google.script.host.close();' +
        '</script>' +

        '<p style="margin-top: 10px; font-size: 12px; color: #666;">' +
          'Si no se abrió automáticamente, ' +
          '' + url + '' +
            'haz clic aquí' +
          '</a>.' +
        '</p>' +
      '</body>' +
    '</html>'
  )
    .setWidth(360)
    .setHeight(140);

  SpreadsheetApp.getUi().showModelessDialog(html, "Abrir proyecto");
}


/**
 * Funcion para abrir el Gestor desde el menu de la hoja de calculo.
 */
function abrirGestorExcedentes() {
  var template = HtmlService.createTemplateFromFile("GestorExcedentes");

  var html = template
    .evaluate()
    .setTitle("Gestor de Excedentes PRO")
    .setWidth(1600)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "🚀 Panel de Control Excedentes"
  );
}


/**
 * Mantenimiento de funciones de apertura anteriores.
 */

function abrirConsultaExcedentes() {
  var html = HtmlService
    .createTemplateFromFile("ConsultaExcedentes")
    .evaluate()
    .setWidth(1400)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "📋 Consulta de excedentes"
  );
}


function abrirHistorialTraspasos() {
  var html = HtmlService
    .createTemplateFromFile("HistorialTraspasos")
    .evaluate()
    .setWidth(1400)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "📋 Historial de Traspasos"
  );
}


function abrirFormularioTraspasos() {
  var html = HtmlService
    .createTemplateFromFile("FormularioTraspasos")
    .evaluate()
    .setWidth(1400)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "📋 Registrar Traspasos"
  );
}


function abrirAppAlmacen() {
  var template = HtmlService.createTemplateFromFile("APPALMACEN");

  APPALMACEN_applyTemplateImports_(
    template,
    APPALMACEN_TEMPLATE.DEFAULT_PAGE
  );

  var html = template
    .evaluate()
    .setWidth(1400)
    .setHeight(1200)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  SpreadsheetApp.getUi().showModalDialog(html, "APPALMACEN");
}


function abrirFormularioEtiquetasExcedentes() {
  var html = HtmlService
    .createTemplateFromFile("FormularioEtiquetasExcedentes")
    .evaluate()
    .setWidth(1400)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "📦 Generador de Etiquetas"
  );
}


function abrirFormularioEtiquetasExcedentesCasillero() {
  var html = HtmlService
    .createTemplateFromFile("FormularioEtiquetasExcedentesCasillero")
    .evaluate()
    .setWidth(1400)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "📦 Generador de Etiquetas Excedente - Casillero"
  );
}


function abrirFormularioEtiquetasExcedentesReimpresion() {
  var html = HtmlService
    .createTemplateFromFile("FormularioEtiquetasExcedentesReimpresion")
    .evaluate()
    .setWidth(1400)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "📦 Generador de Etiquetas - Reimpresion"
  );
}


function abrirFormularioEtiquetas() {
  var html = HtmlService
    .createTemplateFromFile("FormularioEtiquetas")
    .evaluate()
    .setWidth(1400)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "🏷️ Generador de Etiquetas"
  );
}


function abrirFormularioMonitorTraspasos() {
  var html = HtmlService
    .createTemplateFromFile("MonitorTraspasos")
    .evaluate()
    .setWidth(1600)
    .setHeight(1200);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "📋 Monitor de Traspasos"
  );
}


/**
 * Incluye archivos HTML parciales.
 */
function incluir(nombreArchivo) {
  return HtmlService
    .createTemplateFromFile(nombreArchivo)
    .evaluate()
    .getContent();
}


/**
 * Datos de prueba o fallback para templates web.
 */
function obtenerDatosParaWeb() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getActiveSheet();

  var data = hoja
    .getRange(2, 1, 1, 3)
    .getValues();

  return [
    {
      codigo: data[0][0],
      descripcion: data[0][1],
      id: data[0][2]
    }
  ];
}