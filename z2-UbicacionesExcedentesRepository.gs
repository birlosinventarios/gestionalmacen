/**
 * UbicacionesExcedentesRepository.gs
 */

const UbicacionesExcedentesRepository = (() => {

  // =========================================================
  // HELPERS PRIVADOS
  // =========================================================
  function readSource_() {
    return getRowsByKey_("UBICACIONES_EXCEDENTES");
  }

  function toKey_(value) {
    return toStrUpper_(value || "")
      .replace(/\s+/g, "")
      .trim();
  }

  /**
   * NORMALIZACIÓN DE FILA
   *
   * SUPOSICIÓN ACTUAL:
   * - COL.UBICACIONES_EXCEDENTES.IDUBICACIONES_EXCEDENTES = identificador escaneable
   *   ejemplo: B1B101
   * - COL.UBICACIONES_EXCEDENTES.UBICACION = ubicación canónica
   *   ejemplo: B1-01
   * - COL.UBICACIONES_EXCEDENTES.BODEGA = BODEGA 1
   *
   * Si tu hoja realmente usa otra columna para el QR, aquí es donde se ajusta.
   */
  function normalize_(fila) {
    var identificadorRaw = fila[COL.UBICACIONES_EXCEDENTES.IDUBICACIONES_EXCEDENTES] || "";
    var bodegaRaw = fila[COL.UBICACIONES_EXCEDENTES.BODEGA] || "";
    var ubicacionRaw = fila[COL.UBICACIONES_EXCEDENTES.UBICACION] || "";

    var identificador = toStrUpper_(identificadorRaw);
    var bodega = toStrUpper_(bodegaRaw);
    var ubicacion = toStrUpper_(ubicacionRaw);

    return {
      // Se conserva como TEXTO, no como número
      idubicacionesexcedentes: identificador,
      identificador: identificador,

      bodega: bodega,
      ubicacion: ubicacion,

      // llaves auxiliares normalizadas
      _keyIdentificador: toKey_(identificador),
      _keyUbicacion: toKey_(ubicacion),
      _keyBodega: toStrUpper_(bodega).trim()
    };
  }

  function getField_(field) {
    return getData_().map(x => x[field]);
  }

  function uniqueBy_(arr, mapper) {
    var seen = {};
    var out = [];

    (arr || []).forEach(function (item) {
      var key = mapper(item);
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    });

    return out;
  }

  // =========================================================
  // CACHE
  // =========================================================
  var cache_ = null;

  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(x => x.ubicacion);

      console.log("[CACHE] Ubicaciones de excedentes cargadas:", cache_.length);
    }

    return cache_;
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================
  return {

    /**
     * Devuelve todas las ubicaciones
     */
    getAll: function () {
      return [...getData_()]
        .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion, "es", { sensitivity: "base", numeric: true }));
    },

    /**
     * Devuelve ubicaciones por bodega
     */
    getPorBodega: function (bodega) {
      var filtro = toStrUpper_(bodega || "").trim();
      return getData_().filter(t => t.bodega === filtro);
    },

    /**
     * Devuelve ubicaciones por ubicación canónica
     * ejemplo: B1-01
     */
    getPorUbicacion: function (ubicacion) {
      var filtro = toKey_(ubicacion || "");
      return getData_().filter(t => t._keyUbicacion === filtro);
    },

    /**
     * Devuelve un SOLO registro por ubicación canónica
     * ejemplo: B1-01
     */
    getOnePorUbicacion: function (ubicacion) {
      var filtro = toKey_(ubicacion || "");
      return getData_().find(t => t._keyUbicacion === filtro) || null;
    },

    /**
     * Devuelve un SOLO registro por identificador escaneable
     * ejemplo: B1B101
     */
    getByIdentificador: function (identificador) {
      var filtro = toKey_(identificador || "");
      return getData_().find(t => t._keyIdentificador === filtro) || null;
    },

    /**
     * Alias por compatibilidad con services más genéricos
     */
    getById: function (identificador) {
      return this.getByIdentificador(identificador);
    },

    /**
     * Devuelve todas las bodegas involucradas
     */
    getBodegas: function () {
      return uniqueBy_(
        getField_("bodega").filter(Boolean),
        function (x) { return toStrUpper_(x); }
      ).sort(function (a, b) {
        return a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
      });
    },

    /**
     * Devuelve todas las ubicaciones canónicas
     */
    getUbicaciones: function () {
      return uniqueBy_(
        getField_("ubicacion").filter(Boolean),
        function (x) { return toKey_(x); }
      ).sort(function (a, b) {
        return a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
      });
    },

    /**
     * Devuelve todos los identificadores escaneables
     */
    getIdentificadores: function () {
      return uniqueBy_(
        getField_("identificador").filter(Boolean),
        function (x) { return toKey_(x); }
      ).sort(function (a, b) {
        return a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
      });
    },

    /**
     * Limpia caché
     */
    clearCache: function () {
      cache_ = null;
      console.log("[CACHE] Ubicaciones de excedentes limpias");
    }
  };

})();
