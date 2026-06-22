/**
 * Main.gs 
 * */

/**
 * Se ejecuta automáticamente al abrir el Spreadsheet.
 * Menú simplificado: solo acceso al proyecto web.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('🔩 Aplicación Birlos y Tornillos')
    .addItem('⚙️ Abrir Aplicación', 'abrirProyectoWeb')
    .addToUi();
}


/**
 * Función principal de Aplicación Web.
 * Gestiona la navegación por parámetros (?p=...)
 */
function doGet(e) {
  // Ahora la página por defecto si no hay parámetros es el nuevo Gestor
  var pagina = e.parameter.p || 'APPALMACEN';
  
  // 1. CASO ESPECIAL: IMPRESIÓN DE ETIQUETAS
  if (pagina === 'imprimir' || pagina === 'EtiquetaExcedentesImpresa') {
    try {
      var tmp = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
      tmp.lote = e.parameter.datos ? JSON.parse(e.parameter.datos) : []; 
      tmp.fechaHora = Utilities.formatDate(new Date(), "GMT-6", "dd/MM/yyyy hh:mm a");
      
      return tmp.evaluate()
                .setTitle("Imprimir Etiquetas")
                .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (err) {
      return HtmlService.createHtmlOutput("<h2>Error en Impresión</h2><p>" + err.message + "</p>");
    }
  }

  // 2. LISTA DE PÁGINAS PERMITIDAS (Incluye el nuevo GestorExcedentes)
  var paginasPermitidas = [
    'GestorExcedentes', // Tu nueva Propuesta 1
    'PrototipoTraspasos',
    'PrototipoExcedentes',
    'FormularioTraspasos',
    'APPALMACEN', 
    'FormularioEtiquetas', 
    'FormularioEtiquetasExcedentes',
    'FormularioEtiquetasExcedentesReimpresion', 
    'MonitorTraspasos',
    'HistorialTraspasos',
    'ConsultaExcedentes'
  ];
  
  if (paginasPermitidas.indexOf(pagina) === -1) {
    return HtmlService.createHtmlOutput("<h2>Error: '" + pagina + "' no existe.</h2>");
  }

  try {
    var html = HtmlService.createTemplateFromFile(pagina);
    
    // Parámetros compartidos para los templates
    html.ancho = 12.5; 
    html.alto = 8;
    html.fechaHora = Utilities.formatDate(new Date(), "GMT-6", "dd/MM/yyyy HH:mm");
    html.lote = (typeof obtenerDatosParaWeb === 'function') ? obtenerDatosParaWeb() : []; 

    var evaluado = html.evaluate()
      .setTitle("Almacén - " + pagina.replace(/_/g, ' '))
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      
    return evaluado;
      
  } catch (error) {
    return HtmlService.createHtmlOutput("<h1>Error de carga</h1><p>" + error.message + "</p>");
  }
}


/**
 * Abre el proyecto web en una nueva ventana/pestaña.
 */
function abrirProyectoWeb() {
  const url = "https://script.google.com/macros/s/AKfycbyu75nLi2e1gREn7Atp3qb6UPyIEn4ioXQkawl7slQxtHrz-UNW1tJBFakA6HdpLeY0dw/exec";

  const html = HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
      </head>
      <body style="font-family: Arial, sans-serif; padding: 18px; text-align: center;">
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #1c1d1f;">
          Abriendo proyecto...
        </p>

        <script>
          window.open("${url}", "_blank");
          google.script.host.close();
        </script>

        <p style="margin-top: 10px; font-size: 12px; color: #666;">
          Si no se abrió automáticamente,
          <a href="${url}" target="_blank" style="color:#d93025; font-weight:bold;">
            haz clic aquí
          </a>.
        </p>
      </body>
    </html>
  `)
  .setWidth(360)
  .setHeight(140);

  SpreadsheetApp.getUi().showModelessDialog(html, 'Abrir proyecto');
}


/**
 * Función para abrir el Gestor desde el menú de la hoja de cálculo
 */
function abrirGestorExcedentes() {
  var template = HtmlService.createTemplateFromFile('GestorExcedentes'); 
  var html = template.evaluate()
      .setTitle('Gestor de Excedentes PRO')
      .setWidth(1600)
      .setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '🚀 Panel de Control Excedentes');
}

// --- MANTENIMIENTO DE TUS FUNCIONES DE APERTURA ANTERIORES ---

function abrirConsultaExcedentes() {
  var html = HtmlService.createTemplateFromFile('ConsultaExcedentes').evaluate().setWidth(1400).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '📋 Consulta de excedentes');
}

function abrirHistorialTraspasos() {
  var html = HtmlService.createTemplateFromFile('HistorialTraspasos').evaluate().setWidth(1400).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '📋 Historial de Traspasos');
}

function abrirFormularioTraspasos() {
  var html = HtmlService.createTemplateFromFile('FormularioTraspasos').evaluate().setWidth(1400).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '📋 Registrar Traspasos');
}

function abrirAppAlmacen() {
  var html = HtmlService.createTemplateFromFile('APPALMACEN').evaluate().setWidth(1400).setHeight(1200).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  SpreadsheetApp.getUi().showModalDialog(html, 'APPALMACEN');
}

function abrirFormularioEtiquetasExcedentes() {
  var html = HtmlService.createTemplateFromFile('FormularioEtiquetasExcedentes').evaluate().setWidth(1400).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Generador de Etiquetas');
}

function abrirFormularioEtiquetasExcedentesCasillero() {
  var html = HtmlService.createTemplateFromFile('FormularioEtiquetasExcedentesCasillero').evaluate().setWidth(1400).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Generador de Etiquetas Excedente - Casillero');
}

function abrirFormularioEtiquetasExcedentesReimpresion() {
  var html = HtmlService.createTemplateFromFile('FormularioEtiquetasExcedentesReimpresion').evaluate().setWidth(1400).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Generador de Etiquetas - Reimpresion');
}

function abrirFormularioEtiquetas() {
  var html = HtmlService.createTemplateFromFile('FormularioEtiquetas').evaluate().setWidth(1400).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '🏷️ Generador de Etiquetas');
}

function abrirFormularioMonitorTraspasos() {
  var html = HtmlService.createTemplateFromFile('MonitorTraspasos').evaluate().setWidth(1600).setHeight(1200);
  SpreadsheetApp.getUi().showModalDialog(html, '📋 Monitor de Traspasos');
}

function incluir(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

function obtenerDatosParaWeb() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getActiveSheet();
  var data = hoja.getRange(2, 1, 1, 3).getValues(); 
  return [{ codigo: data[0][0], descripcion: data[0][1], id: data[0][2] }];
}