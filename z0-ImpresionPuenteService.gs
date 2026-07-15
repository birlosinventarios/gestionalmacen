/**
 * ImpresionPuenteService.gs
 * Servicio para enviar impresiones ONLINE por puente web/ngrok/server local.
 */

const ImpresionPuenteService = (() => {

  const DEFAULT_CONFIG = Object.freeze({
    PRINT_BRIDGE_URL: "https://trowel-narrow-collector.ngrok-free.dev/print",
    PRINT_BRIDGE_HEALTH_URL: "https://trowel-narrow-collector.ngrok-free.dev/health",
    PRINT_BRIDGE_TOKEN: "Birlosytornillos123456"
  });

  function _getConfig_() {
    const props = PropertiesService.getScriptProperties();

    const urlPrint =
      props.getProperty("PRINT_BRIDGE_URL") ||
      DEFAULT_CONFIG.PRINT_BRIDGE_URL;

    let urlHealth =
      props.getProperty("PRINT_BRIDGE_HEALTH_URL") ||
      DEFAULT_CONFIG.PRINT_BRIDGE_HEALTH_URL;

    const token =
      props.getProperty("PRINT_BRIDGE_TOKEN") ||
      DEFAULT_CONFIG.PRINT_BRIDGE_TOKEN;

    if (!urlHealth && urlPrint) {
      urlHealth = String(urlPrint).replace(/\/print\/?$/i, "/health");
    }

    return {
      urlPrint: urlPrint,
      urlHealth: urlHealth,
      token: token
    };
  }

  function _assertConfig_(cfg) {
    if (!cfg.urlPrint) {
      throw new Error("No está configurado PRINT_BRIDGE_URL.");
    }

    if (!cfg.urlHealth) {
      throw new Error("No está configurado PRINT_BRIDGE_HEALTH_URL.");
    }

    if (!cfg.token) {
      throw new Error("No está configurado PRINT_BRIDGE_TOKEN.");
    }
  }

  function imprimir(printJob) {
    const cfg = _getConfig_();
    _assertConfig_(cfg);

    if (!printJob || typeof printJob !== "object") {
      throw new Error("No se recibió un paquete de impresión válido.");
    }

    const content = String(printJob.content || "");

    if (!content.trim()) {
      throw new Error("El paquete de impresión ONLINE no contiene contenido.");
    }

    const payload = {
      content: content,
      html: printJob.html || "",
      formato: printJob.formato || "TEXT",
      tipo: printJob.tipo || "GENERICA",
      origen: printJob.origen || "APPALMACEN",
      meta: printJob.meta || {}
    };

    const options = {
      method: "post",
      contentType: "application/json",
      headers: {
        "Authorization": "Bearer " + cfg.token,
        "ngrok-skip-browser-warning": "69420"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(cfg.urlPrint, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code !== 200) {
      throw new Error("Puente de impresión respondió código " + code + ": " + body);
    }

    return {
      ok: true,
      code: code,
      body: body,
      usado: cfg.urlPrint,
      enviadoEn: {
        fecha: typeof fmtDateNow_ === "function" ? fmtDateNow_() : "",
        hora: typeof fmtTimeNow_ === "function" ? fmtTimeNow_() : ""
      }
    };
  }

  function health() {
    const cfg = _getConfig_();
    _assertConfig_(cfg);

    const response = UrlFetchApp.fetch(cfg.urlHealth, {
      method: "get",
      headers: {
        "ngrok-skip-browser-warning": "69420"
      },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    return {
      ok: code === 200,
      code: code,
      body: body,
      usado: cfg.urlHealth
    };
  }

  function debugConfig() {
    const cfg = _getConfig_();

    return {
      ok: true,
      urlPrint: cfg.urlPrint,
      urlHealth: cfg.urlHealth,
      tokenConfigurado: !!cfg.token,
      tokenPreview: cfg.token ? String(cfg.token).slice(0, 6) + "..." : ""
    };
  }

  return {
    imprimir,
    health,
    debugConfig
  };

})();