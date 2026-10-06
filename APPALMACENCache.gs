/**
 * APPALMACENCache.gs
 *
 * Fachada central de caché para datasets compartidos y consultas costosas de
 * APPALMACEN. Utiliza CacheService.getScriptCache() como optimización de
 * lectura, sin convertir la caché en fuente de verdad ni mecanismo de bloqueo.
 *
 * Responsabilidades:
 * - Normalizar y aislar las claves utilizadas por CacheService.
 * - Serializar datos dentro de un sobre versionado.
 * - Validar el tamaño máximo antes de escribir en caché.
 * - Recuperar, almacenar, recordar e invalidar datasets genéricos.
 * - Exponer operaciones especializadas para bootstrap, folios del prototipo,
 *   gestor de excedentes, negativos y reabastecimiento.
 * - Proporcionar limpiezas operativas y diagnósticos controlados.
 *
 * Reglas de seguridad y consistencia:
 * - CacheService es una optimización y nunca sustituye la persistencia.
 * - Los builders se ejecutan sin ScriptLock.
 * - El ScriptLock global se reserva para escrituras operativas de inventario.
 * - Dos solicitudes pueden reconstruir el mismo dato simultáneamente sin
 *   comprometer la integridad funcional.
 * - Un error al guardar en caché no invalida el dato recién construido.
 * - Los payloads corruptos o de un schema distinto se ignoran.
 * - Este módulo no reemplaza AuditoriaExcedentesLiveCache.
 *
 * Política de tamaño:
 * - Los payloads serializados mayores a 90,000 caracteres se rechazan.
 * - rememberBootstrap() y rememberPrototipoFolios() conservan el bypass
 *   existente: consultan caché, pero no intentan guardar reconstrucciones que
 *   históricamente pueden exceder el límite disponible.
 *
 * Dependencias:
 * - CacheService, Session y Utilities.
 *
 * API pública:
 * - Genérica: get(), put(), remove(), remember().
 * - Bootstrap: getBootstrap(), putBootstrap(), rememberBootstrap(),
 *   clearBootstrap().
 * - Prototipo: getPrototipoFolios(), putPrototipoFolios(),
 *   rememberPrototipoFolios(), clearPrototipoFolios().
 * - Gestor, negativos y reabastecimiento: get/put/remember/clear.
 * - Limpieza: clearOperational(), clearAll().
 * - Diagnóstico: debugGetRaw(), debugKeys().
 */
const APPALMACENCache = (() => {
  "use strict";

  /** Configuración inmutable de prefijo, TTL y tamaño máximo. */
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

  /** Nombres lógicos inmutables de los datasets administrados. */
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

  /** Normaliza valores usados en claves y metadatos. */
  function _toStr_(value) {
    return String(value == null ? "" : value).trim();
  }

  /** Obtiene la zona horaria del script con fallback operativo. */
  function _tz_() {
    return Session.getScriptTimeZone() || "America/Mexico_City";
  }

  /** Construye la marca temporal incorporada al sobre de caché. */
  function _nowStamp_() {
    const now = new Date();

    return {
      fecha: Utilities.formatDate(now, _tz_(), "dd/MM/yyyy"),
      hora: Utilities.formatDate(now, _tz_(), "HH:mm:ss"),
      timestamp: now.getTime()
    };
  }

  /** Sanitiza, limita y prefija una clave lógica. */
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

  /** Encapsula datos en un contrato versionado y trazable. */
  function _wrap_(name, data) {
    return {
      ok: true,
      schema: "APPALMACEN_CACHE_V1",
      key: name,
      generadoEn: _nowStamp_(),
      data: data
    };
  }

  /** Valida el schema y extrae datos de un sobre compatible. */
  function _unwrap_(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (payload.schema !== "APPALMACEN_CACHE_V1") {
      return null;
    }

    return payload.data == null ? null : payload.data;
  }

  /** Recupera y deserializa el sobre almacenado. */
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

  /** Serializa y guarda datos después de validar su tamaño. */
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

  /** Elimina una clave normalizada de ScriptCache. */
  function _removeRaw_(name) {
    CacheService.getScriptCache().remove(_safeKey_(name));
    return true;
  }

  // =========================================================
  // API GENÉRICA
  // =========================================================

  /** Obtiene los datos de una clave o null cuando no son utilizables. */
  function get(name) {
    const payload = _getRaw_(name);
    return _unwrap_(payload);
  }

  /** Guarda datos con un TTL configurable. */
  function put(name, data, ttlSeconds) {
    return _putRaw_(name, data, ttlSeconds || 60);
  }

  /** Elimina un dataset de caché. */
  function remove(name) {
    return _removeRaw_(name);
  }

  /**
   * Devuelve caché vigente o construye y almacena el dato.
   * @param {string} name Clave lógica.
   * @param {number} ttlSeconds Vigencia en segundos.
   * @param {Function} builder Constructor síncrono de datos.
   * @param {Object} [options] Opciones; forceRefresh=true omite la lectura.
   * @return {*} Dato cacheado o recién construido.
   */
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

  /** Obtiene el bootstrap general. */
  function getBootstrap() {
    return get(KEYS.BOOTSTRAP);
  }

  /** Guarda el bootstrap general. */
  function putBootstrap(data) {
    return put(KEYS.BOOTSTRAP, data, CFG.TTL.BOOTSTRAP);
  }

  /** Recupera bootstrap o ejecuta el builder sin persistir el resultado. */
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

  /** Elimina el bootstrap general. */
  function clearBootstrap() {
    return remove(KEYS.BOOTSTRAP);
  }

  // =========================================================
  // PROTOTIPO TRASPASOS: FOLIOS
  // =========================================================

  /** Obtiene los folios operativos del prototipo. */
  function getPrototipoFolios() {
    return get(KEYS.PROTOTIPO_FOLIOS);
  }

  /** Guarda los folios operativos del prototipo. */
  function putPrototipoFolios(data) {
    return put(KEYS.PROTOTIPO_FOLIOS, data, CFG.TTL.PROTOTIPO_FOLIOS);
  }

  /** Recupera folios o ejecuta el builder sin persistir el resultado. */
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

  /** Elimina los folios operativos del prototipo. */
  function clearPrototipoFolios() {
    return remove(KEYS.PROTOTIPO_FOLIOS);
  }

  // =========================================================
  // GESTOR EXCEDENTES
  // =========================================================

  /** Obtiene el dataset del gestor de excedentes. */
  function getGestorExcedentes() {
    return get(KEYS.GESTOR_EXCEDENTES);
  }

  /** Guarda el dataset del gestor de excedentes. */
  function putGestorExcedentes(data) {
    return put(KEYS.GESTOR_EXCEDENTES, data, CFG.TTL.GESTOR_EXCEDENTES);
  }

  /** Recuerda o construye el dataset del gestor. */
  function rememberGestorExcedentes(builder, options) {
    return remember(
      KEYS.GESTOR_EXCEDENTES,
      CFG.TTL.GESTOR_EXCEDENTES,
      builder,
      options || {}
    );
  }

  /** Elimina el dataset del gestor. */
  function clearGestorExcedentes() {
    return remove(KEYS.GESTOR_EXCEDENTES);
  }

  // =========================================================
  // NEGATIVOS
  // =========================================================

  /** Obtiene el dataset de negativos. */
  function getNegativos() {
    return get(KEYS.NEGATIVOS);
  }

  /** Guarda el dataset de negativos. */
  function putNegativos(data) {
    return put(KEYS.NEGATIVOS, data, CFG.TTL.NEGATIVOS);
  }

  /** Recuerda o construye el dataset de negativos. */
  function rememberNegativos(builder, options) {
    return remember(
      KEYS.NEGATIVOS,
      CFG.TTL.NEGATIVOS,
      builder,
      options || {}
    );
  }

  /** Elimina el dataset de negativos. */
  function clearNegativos() {
    return remove(KEYS.NEGATIVOS);
  }

  // =========================================================
  // REABASTECIMIENTO
  // =========================================================

  /** Obtiene el dataset de reabastecimiento. */
  function getReabastecimiento() {
    return get(KEYS.REABASTECIMIENTO);
  }

  /** Guarda el dataset de reabastecimiento. */
  function putReabastecimiento(data) {
    return put(KEYS.REABASTECIMIENTO, data, CFG.TTL.REABASTECIMIENTO);
  }

  /** Recuerda o construye el dataset de reabastecimiento. */
  function rememberReabastecimiento(builder, options) {
    return remember(
      KEYS.REABASTECIMIENTO,
      CFG.TTL.REABASTECIMIENTO,
      builder,
      options || {}
    );
  }

  /** Elimina el dataset de reabastecimiento. */
  function clearReabastecimiento() {
    return remove(KEYS.REABASTECIMIENTO);
  }

  // =========================================================
  // LIMPIEZAS
  // =========================================================

  /** Invalida todos los datasets operativos, excepto bootstrap. */
  function clearOperational() {
    clearPrototipoFolios();
    clearGestorExcedentes();
    clearNegativos();
    clearReabastecimiento();

    console.log("[APPALMACENCache] clearOperational :: OK");
    return true;
  }

  /** Invalida bootstrap y todos los datasets operativos. */
  function clearAll() {
    clearBootstrap();
    clearOperational();

    console.log("[APPALMACENCache] clearAll :: OK");
    return true;
  }

  // =========================================================
  // DEBUG CONTROLADO
  // =========================================================

  /** Devuelve el sobre crudo para diagnóstico controlado. */
  function debugGetRaw(name) {
    return _getRaw_(name);
  }

  /** Devuelve configuración de claves y TTL sin contenidos cacheados. */
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

  return Object.freeze({
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
  });
})();