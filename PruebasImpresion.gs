/**
 * PruebasImpresion.gs
 *
 * Conjunto de pruebas manuales para diagnosticar el puente de impresión ONLINE
 * utilizado por APPALMACEN.
 *
 * Responsabilidades:
 * - Verificar la disponibilidad del endpoint de salud del puente.
 * - Enviar una impresión de texto controlada al endpoint HTTP.
 * - Validar la configuración leída por ImpresionPuenteService.
 * - Ejecutar pruebas integradas mediante ImpresionPuenteService.
 * - Registrar resultados suficientes para diagnóstico sin revelar secretos.
 *
 * Dependencias globales:
 * - PropertiesService
 * - UrlFetchApp
 * - Logger
 * - Utilities
 * - ImpresionPuenteService
 *
 * Propiedades requeridas en Script Properties:
 * - PRINT_BRIDGE_URL
 * - PRINT_BRIDGE_HEALTH_URL
 * - PRINT_BRIDGE_TOKEN
 *
 * Consideraciones de seguridad:
 * - Este archivo no contiene ni asigna credenciales.
 * - PRINT_BRIDGE_TOKEN debe configurarse manualmente en Script Properties.
 * - Los logs no deben incluir tokens, encabezados Authorization ni secretos.
 * - Los endpoints deben usar HTTPS.
 * - Las respuestas remotas se registran de forma limitada.
 *
 * Uso:
 * Estas funciones son pruebas manuales. No deben ejecutarse desde disparadores
 * automáticos ni exponerse directamente a clientes sin autorización.
 */

/** Nombre de la propiedad que contiene el endpoint de impresión. */
const PRINT_TEST_URL_PROPERTY_ = "PRINT_BRIDGE_URL";

/** Nombre de la propiedad que contiene el endpoint de salud. */
const PRINT_TEST_HEALTH_URL_PROPERTY_ = "PRINT_BRIDGE_HEALTH_URL";

/** Nombre de la propiedad que contiene el token del puente. */
const PRINT_TEST_TOKEN_PROPERTY_ = "PRINT_BRIDGE_TOKEN";

/** Longitud máxima registrada de una respuesta remota. */
const PRINT_TEST_MAX_RESPONSE_LOG_LENGTH_ = 1000;

/** Tiempo máximo de conexión y respuesta controlado por el entorno de Apps Script. */
const PRINT_TEST_EXPECTED_OK_BODY_ = "OK";

/**
 * Obtiene las propiedades de configuración del puente de impresión.
 *
 * @return {{printUrl:string,healthUrl:string,token:string}} Configuración.
 * @throws {Error} Si falta una propiedad requerida o una URL no usa HTTPS.
 * @private
 */
function getPrintTestConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var config = {
    printUrl: String(
      properties.getProperty(PRINT_TEST_URL_PROPERTY_) || ""
    ).trim(),
    healthUrl: String(
      properties.getProperty(PRINT_TEST_HEALTH_URL_PROPERTY_) || ""
    ).trim(),
    token: String(
      properties.getProperty(PRINT_TEST_TOKEN_PROPERTY_) || ""
    ).trim()
  };

  var missing = [];

  if (!config.printUrl) {
    missing.push(PRINT_TEST_URL_PROPERTY_);
  }
  if (!config.healthUrl) {
    missing.push(PRINT_TEST_HEALTH_URL_PROPERTY_);
  }
  if (!config.token) {
    missing.push(PRINT_TEST_TOKEN_PROPERTY_);
  }

  if (missing.length > 0) {
    throw new Error(
      "Faltan propiedades de impresión: " + missing.join(", ") + "."
    );
  }

  validateHttpsUrl_(config.printUrl, PRINT_TEST_URL_PROPERTY_);
  validateHttpsUrl_(config.healthUrl, PRINT_TEST_HEALTH_URL_PROPERTY_);

  return config;
}

/**
 * Valida que una URL esté completa y utilice HTTPS.
 *
 * @param {string} url URL por validar.
 * @param {string} propertyName Nombre de la propiedad para el mensaje de error.
 * @return {void}
 * @throws {Error} Si la URL no es HTTPS.
 * @private
 */
function validateHttpsUrl_(url, propertyName) {
  if (!/^https:\/\//i.test(String(url || ""))) {
    throw new Error(
      propertyName + " debe contener una URL HTTPS válida."
    );
  }
}

/**
 * Limita una respuesta remota antes de enviarla a los logs.
 *
 * @param {*} value Respuesta recibida.
 * @return {string} Texto limitado para diagnóstico.
 * @private
 */
function truncatePrintTestLog_(value) {
  var text = String(value == null ? "" : value);

  if (text.length <= PRINT_TEST_MAX_RESPONSE_LOG_LENGTH_) {
    return text;
  }

  return (
    text.slice(0, PRINT_TEST_MAX_RESPONSE_LOG_LENGTH_) +
    "... [RESPUESTA TRUNCADA]"
  );
}

/**
 * Construye el contenido de texto utilizado por la prueba HTTP directa.
 *
 * @return {string} Ticket de diagnóstico.
 * @private
 */
function buildFixedPrintTestContent_() {
  var now = new Date();
  var timeZone = Session.getScriptTimeZone() || "GMT-6";

  return [
    "================================================",
    "          BIRLOS Y TORNILLOS INVENTARIOS        ",
    "================================================",
    "",
    "          AUDITORIA DE ENLACE FIJO             ",
    "",
    " ---------------------------------------------- ",
    "  FECHA:     " + Utilities.formatDate(now, timeZone, "dd/MM/yyyy"),
    "  HORA:      " + Utilities.formatDate(now, timeZone, "HH:mm:ss"),
    "  RED:       PUENTE HTTPS",
    "  ESTADO:    ONLINE (PRUEBA DIRECTA)",
    "  HARDWARE:  IMPRESORA TERMICA GD-40",
    "  LIENZO:    ETIQUETA INDUSTRIAL 100x150 mm",
    " ---------------------------------------------- ",
    "",
    "             CONEXION EXITOSA                  ",
    "       LISTO PARA PROCESAR TRABAJOS ONLINE     ",
    "",
    "================================================",
    "",
    "",
    "",
    ""
  ].join("\n");
}

/**
 * Envía una prueba directa al endpoint HTTP de impresión.
 *
 * Esta prueba omite ImpresionPuenteService deliberadamente para aislar la
 * conectividad, autenticación y respuesta del puente.
 *
 * @return {{correcto:boolean,codigo:number,respuesta:string}} Resultado resumido.
 * @throws {Error} Si falta configuración o la solicitud no puede ejecutarse.
 */
function probarImpresionFija() {
  var config = getPrintTestConfig_();
  var payload = {
    content: buildFixedPrintTestContent_()
  };
  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + config.token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  Logger.log(
    "[PRINT_TEST] Iniciando prueba directa de impresión ONLINE."
  );

  try {
    var response = UrlFetchApp.fetch(config.printUrl, options);
    var responseCode = response.getResponseCode();
    var responseBody = String(response.getContentText() || "").trim();
    var correcto =
      responseCode >= 200 &&
      responseCode < 300 &&
      responseBody === PRINT_TEST_EXPECTED_OK_BODY_;

    Logger.log(
      "[PRINT_TEST] Resultado: " +
      JSON.stringify({
        correcto: correcto,
        codigo: responseCode,
        respuesta: truncatePrintTestLog_(responseBody)
      })
    );

    return {
      correcto: correcto,
      codigo: responseCode,
      respuesta: responseBody
    };
  } catch (error) {
    Logger.log(
      "[PRINT_TEST] Error de conexión: " +
      String(error && error.message ? error.message : error)
    );
    throw error;
  }
}

/**
 * Consulta directamente el endpoint de salud del puente.
 *
 * @return {{correcto:boolean,codigo:number,respuesta:string}} Resultado resumido.
 * @throws {Error} Si falta configuración o falla UrlFetchApp.
 */
function probarHealthGD40() {
  var config = getPrintTestConfig_();
  var options = {
    method: "get",
    headers: {
      "ngrok-skip-browser-warning": "69420",
      Authorization: "Bearer " + config.token
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(config.healthUrl, options);
    var responseCode = response.getResponseCode();
    var responseBody = String(response.getContentText() || "").trim();
    var correcto = responseCode >= 200 && responseCode < 300;

    Logger.log(
      "[PRINT_HEALTH_TEST] " +
      JSON.stringify({
        correcto: correcto,
        codigo: responseCode,
        respuesta: truncatePrintTestLog_(responseBody)
      })
    );

    return {
      correcto: correcto,
      codigo: responseCode,
      respuesta: responseBody
    };
  } catch (error) {
    Logger.log(
      "[PRINT_HEALTH_TEST] Error: " +
      String(error && error.message ? error.message : error)
    );
    throw error;
  }
}

/**
 * Muestra instrucciones para configurar el puente de forma segura.
 *
 * Esta función no guarda valores ni secretos. La configuración debe realizarse
 * desde Configuración del proyecto > Propiedades del script.
 *
 * @return {{propiedades:Array<string>,configurado:boolean}}
 */
function configurarPuenteImpresionOnline() {
  var propertyNames = [
    PRINT_TEST_URL_PROPERTY_,
    PRINT_TEST_HEALTH_URL_PROPERTY_,
    PRINT_TEST_TOKEN_PROPERTY_
  ];
  var properties = PropertiesService.getScriptProperties();
  var configurado = propertyNames.every(function (propertyName) {
    return Boolean(properties.getProperty(propertyName));
  });

  Logger.log(
    "[PRINT_CONFIG] Configure manualmente en Script Properties: " +
    propertyNames.join(", ") +
    ". Estado actual: " +
    (configurado ? "COMPLETO" : "INCOMPLETO")
  );

  return {
    propiedades: propertyNames,
    configurado: configurado
  };
}

/**
 * Registra la configuración no sensible interpretada por ImpresionPuenteService.
 *
 * El Service es responsable de ocultar tokens y demás secretos.
 *
 * @return {*} Respuesta de diagnóstico del Service.
 */
function probarConfigImpresionPuente() {
  var result = ImpresionPuenteService.debugConfig();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Ejecuta la prueba de salud mediante ImpresionPuenteService.
 *
 * @return {*} Respuesta normalizada del Service.
 */
function probarHealthImpresionPuente() {
  var result = ImpresionPuenteService.health();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Envía una prueba de impresión utilizando el contrato oficial printJob.
 *
 * @return {*} Respuesta normalizada de ImpresionPuenteService.
 */
function probarImpresionPuenteOnline() {
  var now = new Date();
  var timeZone = Session.getScriptTimeZone() || "GMT-6";
  var printJob = {
    tipo: "TEST",
    origen: "APPALMACEN",
    content: [
      "================================================",
      "        BIRLOS Y TORNILLOS INVENTARIOS",
      "================================================",
      "",
      "          PRUEBA IMPRESION ONLINE",
      "",
      "FECHA/HORA: " +
        Utilities.formatDate(now, timeZone, "dd/MM/yyyy HH:mm:ss"),
      "MODO: ONLINE",
      "PUENTE: SERVER LOCAL / TUNEL HTTPS",
      "",
      "Si esta etiqueta sale, el puente ONLINE funciona.",
      "",
      "================================================",
      "",
      "",
      "",
      ""
    ].join("\n"),
    meta: {
      modulo: "TEST",
      origen: "Apps Script",
      timestamp: now.toISOString()
    }
  };

  var result = ImpresionPuenteService.imprimir(printJob);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
