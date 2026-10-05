/**
 * APPALMACENCache.gs
 * Cache general para datasets compartidos y consultas pesadas de APPALMACEN.
 *
 * Este módulo NO reemplaza AuditoriaExcedentesLiveCache.
 * Sirve para:
 * - Bootstrap general de la SPA.
 * - Folios operativos de PrototipoTraspasos.
 * - Consultas pesadas reutilizables como GestorExcedentes.
 */

const APPALMACENCache = (() => {
  const CFG = Object.freeze({
    PREFIX: "APPALMACEN_V1_",

    TTL: Object.freeze({
      BOOTSTRAP: 900,          // 15 minutos
      PROTOTIPO_FOLIOS: 45,    // 45 segundos
      GESTOR_EXCEDENTES: 60,   // 1 minuto
      NEGATIVOS: 120,          // 2 minutos
      REABASTECIMIENTO: 120    // 2 minutos
    }),

    MAX_CACHE_CHARS: 90000
  });

  const KEYS = Object.freeze({
    BOOTSTRAP: "BOOTSTRAP",
    PROTOTIPO_FOLIOS: "PROTOTIPO_FOLIOS",
    GESTOR_EXCEDENTES: "GESTOR_EXCEDENTES",
    NEGATIVOS: "NEGATIVOS",
    REABASTECIMIENTO: "REABASTECIMIENTO"
  });

  // =========================================================
  // HELPERS BASE
  // =========================================================

  function _toStr_(value) {
    return String(value == null ? "" : value).trim();
  }

  function _tz_() {
    return Session.getScriptTimeZone() || "America/Mexico_City";
  }

  function _nowStamp_() {
    const now = new Date();

    return {
      fecha: Utilities.formatDate(now, _tz_(), "dd/MM/yyyy"),
      hora: Utilities.formatDate(now, _tz_(), "HH:mm:ss"),
      timestamp: now.getTime()
    };
  }

  function _safeKey_(name) {
    const clean = _toStr_(name)
      .toUpperCase()
      .replace(/[^A-Z0-9_\-]/g, "_")
      .slice(0, 120);

    if (!clean) {
      throw new Error("APPALMACENCache requiere una llave válida.");
    }

    return CFG.PREFIX + clean;
  }

  function _wrap_(name, data) {
    return {
      ok: true,
      schema: "APPALMACEN_CACHE_V1",
      key: name,
      generadoEn: _nowStamp_(),
      data: data
    };
  }

  function _unwrap_(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (payload.schema !== "APPALMACEN_CACHE_V1") {
      return null;
    }

    return payload.data == null ? null : payload.data;
  }

  function _getRaw_(name) {
    const cache = CacheService.getScriptCache();
    const raw = cache.get(_safeKey_(name));

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("[APPALMACENCache] Cache corrupto. Se ignorará:", name, error);
      return null;
    }
  }

  function _putRaw_(name, data, ttlSeconds) {
    const cache = CacheService.getScriptCache();
    const payload = _wrap_(name, data);
    const json = JSON.stringify(payload);

    if (json.length > CFG.MAX_CACHE_CHARS) {
      throw new Error(
        "[APPALMACENCache] Payload demasiado grande para CacheService. key=" +
          name +
          " chars=" +
          json.length
      );
    }

    cache.put(_safeKey_(name), json, ttlSeconds || 60);

    return data;
  }

  function _removeRaw_(name) {
    CacheService.getScriptCache().remove(_safeKey_(name));
    return true;
  }

  // =========================================================
  // API GENÉRICA
  // =========================================================

  function get(name) {
    const payload = _getRaw_(name);
    return _unwrap_(payload);
  }

  function put(name, data, ttlSeconds) {
    return _putRaw_(name, data, ttlSeconds || 60);
  }

  function remove(name) {
    return _removeRaw_(name);
  }

  function remember(name, ttlSeconds, builder, options) {
    const config = options || {};

    if (typeof builder !== "function") {
      throw new Error(
        "APPALMACENCache.remember requiere un builder function."
      );
    }

    if (config.forceRefresh !== true) {
      const cached = get(name);

      if (cached != null) {
        console.log("[APPALMACENCache] HIT:", name);
        return cached;
      }
    }

    console.log("[APPALMACENCache] MISS:", name);

    /*
    * El builder se ejecuta sin ScriptLock.
    *
    * CacheService es una optimizacion. Dos solicitudes pueden
    * reconstruir el mismo dato al mismo tiempo sin comprometer
    * la integridad del inventario.
    *
    * El ScriptLock global se reserva para escrituras operativas.
    */
    const fresh = builder();

    try {
      put(name, fresh, ttlSeconds);
    } catch (cacheError) {
      console.warn(
        "[APPALMACENCache] No se pudo guardar en cache:",
        name,
        cacheError && cacheError.message
          ? cacheError.message
          : cacheError
      );
    }

    return fresh;
  }

  // =========================================================
  // BOOTSTRAP GENERAL
  // =========================================================

  function getBootstrap() {
    return get(KEYS.BOOTSTRAP);
  }

  function putBootstrap(data) {
    return put(KEYS.BOOTSTRAP, data, CFG.TTL.BOOTSTRAP);
  }

  function rememberBootstrap(
    builder,
    options
  ) {
    const config =
      options || {};

    if (
      config.forceRefresh !==
      true
    ) {
      const cached =
        getBootstrap();

      if (
        cached != null
      ) {
        console.log(
          "[APPALMACENCache] HIT: " +
          KEYS.BOOTSTRAP
        );

        return cached;
      }
    }

    console.log(
      "[APPALMACENCache] " +
      "BYPASS_TOO_LARGE: " +
      KEYS.BOOTSTRAP
    );

    return builder();
  }

  function clearBootstrap() {
    return remove(KEYS.BOOTSTRAP);
  }

  // =========================================================
  // PROTOTIPO TRASPASOS: FOLIOS
  // =========================================================

  function getPrototipoFolios() {
    return get(KEYS.PROTOTIPO_FOLIOS);
  }

  function putPrototipoFolios(data) {
    return put(KEYS.PROTOTIPO_FOLIOS, data, CFG.TTL.PROTOTIPO_FOLIOS);
  }

  function rememberPrototipoFolios(
    builder,
    options
  ) {
    const config =
      options || {};

    if (
      config.forceRefresh !==
      true
    ) {
      const cached =
        getPrototipoFolios();

      if (
        cached != null
      ) {
        console.log(
          "[APPALMACENCache] HIT: " +
          KEYS.PROTOTIPO_FOLIOS
        );

        return cached;
      }
    }

    console.log(
      "[APPALMACENCache] " +
      "BYPASS_TOO_LARGE: " +
      KEYS.PROTOTIPO_FOLIOS
    );

    return builder();
  }

  function clearPrototipoFolios() {
    return remove(KEYS.PROTOTIPO_FOLIOS);
  }

  // =========================================================
  // GESTOR EXCEDENTES
  // =========================================================

  function getGestorExcedentes() {
    return get(KEYS.GESTOR_EXCEDENTES);
  }

  function putGestorExcedentes(data) {
    return put(KEYS.GESTOR_EXCEDENTES, data, CFG.TTL.GESTOR_EXCEDENTES);
  }

  function rememberGestorExcedentes(builder, options) {
    return remember(
      KEYS.GESTOR_EXCEDENTES,
      CFG.TTL.GESTOR_EXCEDENTES,
      builder,
      options || {}
    );
  }

  function clearGestorExcedentes() {
    return remove(KEYS.GESTOR_EXCEDENTES);
  }

  // =========================================================
  // NEGATIVOS
  // =========================================================

  function getNegativos() {
    return get(KEYS.NEGATIVOS);
  }

  function putNegativos(data) {
    return put(KEYS.NEGATIVOS, data, CFG.TTL.NEGATIVOS);
  }

  function rememberNegativos(builder, options) {
    return remember(
      KEYS.NEGATIVOS,
      CFG.TTL.NEGATIVOS,
      builder,
      options || {}
    );
  }

  function clearNegativos() {
    return remove(KEYS.NEGATIVOS);
  }

  // =========================================================
  // REABASTECIMIENTO
  // =========================================================

  function getReabastecimiento() {
    return get(KEYS.REABASTECIMIENTO);
  }

  function putReabastecimiento(data) {
    return put(KEYS.REABASTECIMIENTO, data, CFG.TTL.REABASTECIMIENTO);
  }

  function rememberReabastecimiento(builder, options) {
    return remember(
      KEYS.REABASTECIMIENTO,
      CFG.TTL.REABASTECIMIENTO,
      builder,
      options || {}
    );
  }

  function clearReabastecimiento() {
    return remove(KEYS.REABASTECIMIENTO);
  }

  // =========================================================
  // LIMPIEZAS
  // =========================================================

  function clearOperational() {
    clearPrototipoFolios();
    clearGestorExcedentes();
    clearNegativos();
    clearReabastecimiento();

    console.log("[APPALMACENCache] clearOperational :: OK");
    return true;
  }

  function clearAll() {
    clearBootstrap();
    clearOperational();

    console.log("[APPALMACENCache] clearAll :: OK");
    return true;
  }

  // =========================================================
  // DEBUG CONTROLADO
  // =========================================================

  function debugGetRaw(name) {
    return _getRaw_(name);
  }

  function debugKeys() {
    return {
      prefix: CFG.PREFIX,
      keys: KEYS,
      ttl: CFG.TTL
    };
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================

  return {
    CFG,
    KEYS,

    get,
    put,
    remove,
    remember,

    getBootstrap,
    putBootstrap,
    rememberBootstrap,
    clearBootstrap,

    getPrototipoFolios,
    putPrototipoFolios,
    rememberPrototipoFolios,
    clearPrototipoFolios,

    getGestorExcedentes,
    putGestorExcedentes,
    rememberGestorExcedentes,
    clearGestorExcedentes,

    getNegativos,
    putNegativos,
    rememberNegativos,
    clearNegativos,

    getReabastecimiento,
    putReabastecimiento,
    rememberReabastecimiento,
    clearReabastecimiento,

    clearOperational,
    clearAll,

    debugGetRaw,
    debugKeys
  };
})();