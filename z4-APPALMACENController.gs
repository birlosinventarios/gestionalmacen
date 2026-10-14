/**
 * z4-APPALMACENController
 *
 * @fileoverview Controlador principal del shell APPALMACEN. Expone el bootstrap
 * general de la aplicación y la carga segura del contenido HTML de las vistas.
 *
 * Responsabilidades:
 * - Mantener la lista blanca de vistas permitidas.
 * - Normalizar y validar nombres de archivos de vista.
 * - Bloquear rutas relativas, extensiones, separadores e identificadores ajenos.
 * - Delegar la construcción del bootstrap a BootstrapServices.
 * - Evaluar plantillas HTML que puedan contener scriptlets controlados.
 * - Registrar tiempos de ejecución y errores con un formato uniforme.
 * - Propagar errores públicos sin exponer detalles internos innecesarios.
 *
 * Dependencias globales:
 * - BootstrapServices.getInfoInicial().
 * - HtmlService.createTemplateFromFile().
 *
 * Reglas de seguridad:
 * - Solo se aceptan vistas incluidas en APPALMACEN_VISTAS_PERMITIDAS.
 * - Los nombres solo pueden contener letras, números, guion y guion bajo.
 * - No se aceptan rutas, extensiones, puntos, espacios ni separadores.
 * - La plantilla debe generar contenido HTML no vacío.
 * - Los detalles técnicos completos se registran únicamente en el servidor.
 *
 * API pública:
 * - APPALMACENController_getBootstrap().
 * - APPALMACENController_obtenerContenidoVista(nombreArchivo).
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {!Object} Configuración técnica del controlador. */
var APPALMACEN_CONTROLLER_CONFIG = Object.freeze({
  LOG_PREFIX: "[APPALMACEN][CONTROLLER]",
  VIEW_NAME_PATTERN: /^[A-Za-z0-9_-]+$/,
  BOOTSTRAP_OPERATION: "APPALMACENController_getBootstrap",
  VIEW_OPERATION: "APPALMACENController_obtenerContenidoVista"
});

/**
 * Lista blanca e inmutable de vistas que el controlador puede renderizar.
 *
 * Las primeras vistas son accesibles desde navegación principal. Las últimas se
 * utilizan en flujos internos, pero conservan la misma validación de seguridad.
 *
 * @const {!Array<string>}
 */
var APPALMACEN_VISTAS_PERMITIDAS = Object.freeze([
  // Vistas visibles en el menú principal.
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
  "ConciliacionSaldo",
  "VerificacionEntrada",

  // Vistas ocultas o utilizadas por navegación interna.
  "AuditoriaExcedentesDetalle",
  "AuditoriaExcedentesCaptura"
]);

/**
 * Índice privado para validar pertenencia a la lista blanca en tiempo constante.
 *
 * @private
 * @const {!Object<string, boolean>}
 */
var APPALMACEN_VISTAS_PERMITIDAS_INDEX = Object.freeze(
  APPALMACEN_VISTAS_PERMITIDAS.reduce(function (index, viewName) {
    index[viewName] = true;
    return index;
  }, Object.create(null))
);

// =============================================================================
// VALIDACIÓN DE DEPENDENCIAS Y UTILIDADES PRIVADAS
// =============================================================================

/**
 * Verifica las dependencias necesarias para la operación solicitada.
 *
 * @param {boolean=} requiresHtmlService Indica si se renderizará una plantilla.
 * @return {void}
 * @throws {Error} Si falta una dependencia obligatoria.
 * @private
 */
function _appalmacen_assertDependencies_(requiresHtmlService) {
  if (
    typeof BootstrapServices === "undefined" ||
    !BootstrapServices ||
    typeof BootstrapServices.getInfoInicial !== "function"
  ) {
    throw new Error(
      "El servicio de inicialización de APPALMACEN no está disponible."
    );
  }

  if (
    requiresHtmlService === true &&
    (
      typeof HtmlService === "undefined" ||
      !HtmlService ||
      typeof HtmlService.createTemplateFromFile !== "function"
    )
  ) {
    throw new Error("El servicio de plantillas HTML no está disponible.");
  }
}

/**
 * Convierte un valor a texto y elimina espacios exteriores.
 *
 * @param {*} value Valor de entrada.
 * @return {string} Texto normalizado o una cadena vacía.
 * @private
 */
function _appalmacen_toStr_(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Determina si el nombre de una vista cumple el formato seguro permitido.
 *
 * El patrón rechaza puntos, extensiones, barras, espacios y rutas relativas.
 * Esta validación se complementa con la lista blanca y no la sustituye.
 *
 * @param {*} nombreArchivo Nombre proporcionado por el cliente.
 * @return {boolean} true cuando el formato es seguro.
 * @private
 */
function _appalmacen_nombreVistaValido_(nombreArchivo) {
  var normalizedName = _appalmacen_toStr_(nombreArchivo);
  return APPALMACEN_CONTROLLER_CONFIG.VIEW_NAME_PATTERN.test(normalizedName);
}

/**
 * Valida y normaliza el nombre de una vista antes de acceder al sistema de
 * plantillas.
 *
 * @param {*} nombreArchivo Nombre solicitado por el cliente.
 * @return {string} Nombre normalizado y autorizado.
 * @throws {Error} Si el nombre está vacío, tiene formato inseguro o no aparece
 *   en la lista blanca.
 * @private
 */
function _appalmacen_assertVistaPermitida_(nombreArchivo) {
  var normalizedName = _appalmacen_toStr_(nombreArchivo);

  if (!normalizedName) {
    throw new Error("Debes indicar el nombre de una vista.");
  }

  if (!_appalmacen_nombreVistaValido_(normalizedName)) {
    throw new Error(
      "El nombre de la vista contiene caracteres no permitidos."
    );
  }

  if (!APPALMACEN_VISTAS_PERMITIDAS_INDEX[normalizedName]) {
    throw new Error("La vista solicitada no está permitida: " + normalizedName);
  }

  return normalizedName;
}

/**
 * Construye un mensaje público seguro a partir de un error desconocido.
 *
 * @param {*} error Error capturado.
 * @param {string} fallbackMessage Mensaje predeterminado.
 * @return {string} Mensaje seguro para el consumidor.
 * @private
 */
function _appalmacen_errorMessage_(error, fallbackMessage) {
  var message = _appalmacen_toStr_(error && error.message);
  return message || fallbackMessage;
}

/**
 * Registra el inicio de una operación del controlador.
 *
 * @param {string} operation Nombre lógico de la operación.
 * @param {!Object=} metadata Información diagnóstica sin datos sensibles.
 * @return {number} Marca temporal inicial en milisegundos.
 * @private
 */
function _appalmacen_logStart_(operation, metadata) {
  var startedAt = Date.now();
  console.log(
    APPALMACEN_CONTROLLER_CONFIG.LOG_PREFIX + " " + operation + " :: INICIO",
    metadata || {}
  );
  return startedAt;
}

/**
 * Registra la finalización exitosa de una operación.
 *
 * @param {string} operation Nombre lógico de la operación.
 * @param {number} startedAt Marca temporal devuelta por logStart.
 * @param {!Object=} metadata Información diagnóstica adicional.
 * @return {void}
 * @private
 */
function _appalmacen_logSuccess_(operation, startedAt, metadata) {
  console.log(
    APPALMACEN_CONTROLLER_CONFIG.LOG_PREFIX + " " + operation + " :: FIN",
    Object.assign(
      {
        elapsedMs: Math.max(0, Date.now() - Number(startedAt || Date.now()))
      },
      metadata || {}
    )
  );
}

/**
 * Registra un error del controlador con contexto técnico para diagnóstico.
 *
 * @param {string} operation Nombre lógico de la operación.
 * @param {*} error Error capturado.
 * @param {number} startedAt Marca temporal inicial.
 * @param {!Object=} metadata Contexto no sensible de la solicitud.
 * @return {void}
 * @private
 */
function _appalmacen_logError_(operation, error, startedAt, metadata) {
  console.error(
    APPALMACEN_CONTROLLER_CONFIG.LOG_PREFIX + " " + operation + " :: ERROR",
    Object.assign(
      {
        elapsedMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
        message: _appalmacen_toStr_(error && error.message) || String(error || ""),
        stack: _appalmacen_toStr_(error && error.stack)
      },
      metadata || {}
    )
  );
}

// =============================================================================
// API PÚBLICA DEL CONTROLADOR
// =============================================================================

/**
 * Obtiene la información inicial requerida por el shell APPALMACEN.
 *
 * La construcción del contrato se delega a BootstrapServices. El controlador
 * únicamente valida la dependencia, mide la operación y propaga el error para
 * que la capa RPC conserve su comportamiento esperado.
 *
 * @return {!Object} Contrato inicial de la aplicación.
 * @throws {Error} Si el servicio de bootstrap no está disponible o falla.
 */
function APPALMACENController_getBootstrap() {
  var operation = APPALMACEN_CONTROLLER_CONFIG.BOOTSTRAP_OPERATION;
  var startedAt = _appalmacen_logStart_(operation);

  try {
    _appalmacen_assertDependencies_(false);
    var result = BootstrapServices.getInfoInicial();

    if (!result || typeof result !== "object") {
      throw new Error("El servicio de inicialización devolvió un resultado inválido.");
    }

    _appalmacen_logSuccess_(operation, startedAt);
    return result;
  } catch (error) {
    _appalmacen_logError_(operation, error, startedAt);
    throw error;
  }
}

/**
 * Renderiza el contenido HTML de una vista incluida en la lista blanca.
 *
 * Se utiliza createTemplateFromFile() porque algunas vistas pueden contener
 * scriptlets controlados por el proyecto. El nombre se valida antes de invocar
 * HtmlService para impedir acceso a archivos arbitrarios.
 *
 * @param {*} nombreArchivo Nombre lógico de la vista solicitada.
 * @return {string} HTML evaluado de la vista.
 * @throws {Error} Si la vista no está autorizada o no genera contenido.
 */
function APPALMACENController_obtenerContenidoVista(nombreArchivo) {
  var operation = APPALMACEN_CONTROLLER_CONFIG.VIEW_OPERATION;
  var startedAt = _appalmacen_logStart_(operation);
  var normalizedView = "";

  try {
    _appalmacen_assertDependencies_(true);
    normalizedView = _appalmacen_assertVistaPermitida_(nombreArchivo);

    var template = HtmlService.createTemplateFromFile(normalizedView);
    var html = template.evaluate().getContent();

    if (!_appalmacen_toStr_(html)) {
      throw new Error(
        "La vista autorizada no generó contenido HTML: " + normalizedView
      );
    }

    _appalmacen_logSuccess_(operation, startedAt, {
      view: normalizedView,
      htmlChars: String(html).length
    });

    return html;
  } catch (error) {
    _appalmacen_logError_(operation, error, startedAt, {
      requestedView: _appalmacen_toStr_(nombreArchivo),
      normalizedView: normalizedView
    });

    throw new Error(
      _appalmacen_errorMessage_(
        error,
        "No se pudo cargar la vista solicitada."
      )
    );
  }
}
