/**
 * z0-ImpresionPuenteService.gs
 *
 * Servicio de transporte para enviar trabajos de impresión ONLINE desde
 * APPALMACEN hacia un puente web, túnel HTTPS o servidor local publicado.
 *
 * Responsabilidades:
 * - Leer la configuración del puente desde Script Properties.
 * - Validar endpoints, token y trabajos de impresión.
 * - Normalizar el payload enviado al endpoint de impresión.
 * - Ejecutar solicitudes HTTP mediante UrlFetchApp.
 * - Interpretar y limitar respuestas remotas para diagnóstico.
 * - Consultar el estado de salud del puente.
 * - Exponer únicamente configuración no sensible para depuración.
 *
 * Propiedades requeridas:
 * - PRINT_BRIDGE_URL
 * - PRINT_BRIDGE_HEALTH_URL
 * - PRINT_BRIDGE_TOKEN
 *
 * Dependencias globales:
 * - PropertiesService.
 * - UrlFetchApp.
 * - fmtDateNow_(), opcional.
 * - fmtTimeNow_(), opcional.
 *
 * Contrato público:
 * - ImpresionPuenteService.imprimir(printJob).
 * - ImpresionPuenteService.health().
 * - ImpresionPuenteService.debugConfig().
 *
 * Consideraciones de seguridad:
 * - Las credenciales no deben escribirse en este archivo ni enviarse a logs.
 * - debugConfig() no devuelve el token ni fragmentos del token.
 * - Los endpoints deben utilizar HTTPS.
 * - Las respuestas remotas se limitan antes de incorporarse a errores o logs.
 * - La autenticación se transmite exclusivamente mediante Authorization Bearer.
 *
 * Invariantes:
 * - El contenido imprimible es obligatorio.
 * - El formato predeterminado permanece como TEXT.
 * - El tipo predeterminado permanece como GENERICA.
 * - El origen predeterminado permanece como APPALMACEN.
 * - El encabezado de compatibilidad con el túnel se conserva.
 */
const ImpresionPuenteService = (() => {
  /** Nombres de las propiedades utilizadas por el Service. */
  const PROPERTY_NAMES = Object.freeze({
    PRINT_URL: "PRINT_BRIDGE_URL",
    HEALTH_URL: "PRINT_BRIDGE_HEALTH_URL",
    TOKEN: "PRINT_BRIDGE_TOKEN"
  });

  /**
   * Configuración de respaldo no sensible.
   *
   * El token nunca debe tener un valor predeterminado dentro del código.
   */
  const DEFAULT_CONFIG = Object.freeze({
    PRINT_BRIDGE_URL:
      "https://trowel-narrow-collector.ngrok-free.dev/print",
    PRINT_BRIDGE_HEALTH_URL:
      "https://trowel-narrow-collector.ngrok-free.dev/health",
    PRINT_BRIDGE_TOKEN: ""
  });

  /** Encabezado utilizado para omitir la página intermedia del túnel. */
  const NGROK_SKIP_HEADER = "69420";

  /** Límite defensivo para respuestas incluidas en errores o resultados. */
  const MAX_RESPONSE_LENGTH = 2000;

  /**
   * Convierte un valor a texto y elimina espacios externos.
   *
   * @param {*} value Valor recibido.
   * @return {string} Texto normalizado.
   * @private
   */
  function toTrimmedString_(value) {
    return String(value == null ? "" : value).trim();
  }

  /**
   * Limita una respuesta remota antes de exponerla al consumidor.
   *
   * @param {*} value Respuesta recibida.
   * @return {string} Respuesta completa o truncada.
   * @private
   */
  function truncateResponse_(value) {
    const text = String(value == null ? "" : value);

    if (text.length <= MAX_RESPONSE_LENGTH) {
      return text;
    }

    return (
      text.slice(0, MAX_RESPONSE_LENGTH) +
      "... [RESPUESTA TRUNCADA]"
    );
  }

  /**
   * Deriva el endpoint de salud a partir del endpoint de impresión.
   *
   * @param {string} printUrl Endpoint de impresión.
   * @return {string} Endpoint de salud derivado o cadena vacía.
   * @private
   */
  function deriveHealthUrl_(printUrl) {
    const value = toTrimmedString_(printUrl);

    return value
      ? value.replace(/\/print\/?$/i, "/health")
      : "";
  }

  /**
   * Lee la configuración efectiva desde Script Properties y aplica fallbacks.
   *
   * @return {{urlPrint:string,urlHealth:string,token:string}}
   * @private
   */
  function getConfig_() {
    const properties = PropertiesService.getScriptProperties();
    const urlPrint = toTrimmedString_(
      properties.getProperty(PROPERTY_NAMES.PRINT_URL) ||
      DEFAULT_CONFIG.PRINT_BRIDGE_URL
    );
    let urlHealth = toTrimmedString_(
      properties.getProperty(PROPERTY_NAMES.HEALTH_URL) ||
      DEFAULT_CONFIG.PRINT_BRIDGE_HEALTH_URL
    );
    const token = toTrimmedString_(
      properties.getProperty(PROPERTY_NAMES.TOKEN) ||
      DEFAULT_CONFIG.PRINT_BRIDGE_TOKEN
    );

    if (!urlHealth && urlPrint) {
      urlHealth = deriveHealthUrl_(urlPrint);
    }

    return {
      urlPrint,
      urlHealth,
      token
    };
  }

  /**
   * Valida que una URL utilice HTTPS.
   *
   * @param {string} url URL por validar.
   * @param {string} propertyName Propiedad asociada.
   * @return {void}
   * @throws {Error} Si la URL no utiliza HTTPS.
   * @private
   */
  function assertHttpsUrl_(url, propertyName) {
    if (!/^https:\/\//i.test(toTrimmedString_(url))) {
      throw new Error(
        propertyName + " debe contener una URL HTTPS válida."
      );
    }
  }

  /**
   * Valida la configuración requerida por las operaciones remotas.
   *
   * @param {Object} config Configuración efectiva.
   * @return {void}
   * @throws {Error} Si falta una propiedad o una URL no es segura.
   * @private
   */
  function assertConfig_(config) {
    if (!config.urlPrint) {
      throw new Error("No está configurado PRINT_BRIDGE_URL.");
    }
    if (!config.urlHealth) {
      throw new Error("No está configurado PRINT_BRIDGE_HEALTH_URL.");
    }
    if (!config.token) {
      throw new Error("No está configurado PRINT_BRIDGE_TOKEN.");
    }

    assertHttpsUrl_(config.urlPrint, PROPERTY_NAMES.PRINT_URL);
    assertHttpsUrl_(config.urlHealth, PROPERTY_NAMES.HEALTH_URL);
  }

  /**
   * Normaliza los metadatos del trabajo sin compartir la referencia original.
   *
   * @param {*} metadata Metadatos recibidos.
   * @return {Object} Copia superficial o objeto vacío.
   * @private
   */
  function normalizeMetadata_(metadata) {
    return metadata && typeof metadata === "object"
      ? Object.assign({}, metadata)
      : {};
  }

  /**
   * Valida y normaliza un trabajo de impresión.
   *
   * @param {*} printJob Trabajo recibido.
   * @return {Object} Payload compatible con el puente.
   * @throws {Error} Si el trabajo o su contenido no son válidos.
   * @private
   */
  function buildPayload_(printJob) {
    if (!printJob || typeof printJob !== "object") {
      throw new Error("No se recibió un paquete de impresión válido.");
    }

    const content = String(
      printJob.content ||
      printJob.html ||
      ""
    );

    if (!content.trim()) {
      throw new Error(
        "El paquete de impresión ONLINE no contiene contenido."
      );
    }

    return {
      content,
      html: printJob.html || content,
      formato: printJob.formato || "TEXT",
      tipo: printJob.tipo || "GENERICA",
      origen: printJob.origen || "APPALMACEN",
      meta: normalizeMetadata_(printJob.meta)
    };
  }

  /**
   * Construye los encabezados autenticados utilizados por el puente.
   *
   * @param {string} token Token Bearer.
   * @return {Object} Encabezados HTTP.
   * @private
   */
  function buildHeaders_(token) {
    return {
      Authorization: "Bearer " + token,
      "ngrok-skip-browser-warning": NGROK_SKIP_HEADER
    };
  }

  /**
   * Determina si un código HTTP representa una respuesta exitosa.
   *
   * @param {*} responseCode Código HTTP.
   * @return {boolean}
   * @private
   */
  function isSuccessfulStatus_(responseCode) {
    const code = Number(responseCode);
    return code >= 200 && code < 300;
  }

  /**
   * Construye la marca temporal devuelta después de una impresión exitosa.
   *
   * @return {{fecha:string,hora:string}}
   * @private
   */
  function buildSentTimestamp_() {
    return {
      fecha:
        typeof fmtDateNow_ === "function"
          ? fmtDateNow_()
          : "",
      hora:
        typeof fmtTimeNow_ === "function"
          ? fmtTimeNow_()
          : ""
    };
  }

  /**
   * Envía un trabajo de impresión al endpoint ONLINE.
   *
   * @param {Object} printJob Trabajo generado por ImpresionPrintJobBuilder.
   * @return {{ok:boolean,code:number,body:string,usado:string,enviadoEn:Object}}
   * @throws {Error} Si la configuración, el trabajo o la respuesta son inválidos.
   */
  function imprimir(printJob) {
    const config = getConfig_();
    assertConfig_(config);

    const payload = buildPayload_(printJob);
    const response = UrlFetchApp.fetch(config.urlPrint, {
      method: "post",
      contentType: "application/json",
      headers: buildHeaders_(config.token),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();
    const responseBody = truncateResponse_(response.getContentText());

    if (!isSuccessfulStatus_(responseCode)) {
      throw new Error(
        "Puente de impresión respondió código " +
        responseCode +
        ": " +
        responseBody
      );
    }

    return {
      ok: true,
      code: responseCode,
      body: responseBody,
      usado: config.urlPrint,
      enviadoEn: buildSentTimestamp_()
    };
  }

  /**
   * Consulta el endpoint de salud del puente.
   *
   * La solicitud incluye autenticación para mantener el mismo acceso protegido
   * que la operación de impresión.
   *
   * @return {{ok:boolean,code:number,body:string,usado:string}}
   * @throws {Error} Si la configuración no es válida o falla UrlFetchApp.
   */
  function health() {
    const config = getConfig_();
    assertConfig_(config);

    const response = UrlFetchApp.fetch(config.urlHealth, {
      method: "get",
      headers: buildHeaders_(config.token),
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();
    const responseBody = truncateResponse_(response.getContentText());

    return {
      ok: isSuccessfulStatus_(responseCode),
      code: responseCode,
      body: responseBody,
      usado: config.urlHealth
    };
  }

  /**
   * Devuelve configuración no sensible para diagnóstico autorizado.
   *
   * No expone el token ni una vista parcial del mismo.
   *
   * @return {{ok:boolean,urlPrint:string,urlHealth:string,tokenConfigurado:boolean}}
   */
  function debugConfig() {
    const config = getConfig_();

    return {
      ok: true,
      urlPrint: config.urlPrint,
      urlHealth: config.urlHealth,
      tokenConfigurado: Boolean(config.token)
    };
  }

  return Object.freeze({
    imprimir,
    health,
    debugConfig
  });
})();
