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

/**
 * =========================================================
 * DEBUGGERS
 * =========================================================
 */
function debugUbicacionesExcedentesRepository() {
  const BODEGA_PRUEBA = "BODEGA 1";
  const UBICACION_PRUEBA = "B1-01";
  const IDENTIFICADOR_PRUEBA = "B1B101";

  const all = UbicacionesExcedentesRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 2));

  const porBodega = UbicacionesExcedentesRepository.getPorBodega(BODEGA_PRUEBA);
  console.log("[getPorBodega] total:", porBodega.length);
  console.log("[getPorBodega] muestra:", JSON.stringify(porBodega.slice(0, 5), null, 2));

  const porUbicacion = UbicacionesExcedentesRepository.getPorUbicacion(UBICACION_PRUEBA);
  console.log("[getPorUbicacion] total:", porUbicacion.length);
  console.log("[getPorUbicacion] muestra:", JSON.stringify(porUbicacion.slice(0, 5), null, 2));

  const oneUbicacion = UbicacionesExcedentesRepository.getOnePorUbicacion(UBICACION_PRUEBA);
  console.log("[getOnePorUbicacion] resultado:", JSON.stringify(oneUbicacion, null, 2));

  const byIdentificador = UbicacionesExcedentesRepository.getByIdentificador(IDENTIFICADOR_PRUEBA);
  console.log("[getByIdentificador] resultado:", JSON.stringify(byIdentificador, null, 2));

  const bodegas = UbicacionesExcedentesRepository.getBodegas();
  console.log("[getBodegas] total:", bodegas.length);
  console.log("[getBodegas] muestra:", JSON.stringify(bodegas.slice(0, 5), null, 2));

  const ubicaciones = UbicacionesExcedentesRepository.getUbicaciones();
  console.log("[getUbicaciones] total:", ubicaciones.length);
  console.log("[getUbicaciones] muestra:", JSON.stringify(ubicaciones.slice(0, 5), null, 2));

  const identificadores = UbicacionesExcedentesRepository.getIdentificadores();
  console.log("[getIdentificadores] total:", identificadores.length);
  console.log("[getIdentificadores] muestra:", JSON.stringify(identificadores.slice(0, 5), null, 2));
}