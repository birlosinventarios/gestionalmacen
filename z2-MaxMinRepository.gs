/**
 * MaxMinRepository.gs
 * Lectura de hoja MAXMIN
 */

const MaxMinRepository = (() => {

  function readSource_() {
    return getRowsByKey_("MAXMIN");
  }

  function normalize_(fila) {
    return {
      codigo: toStrUpper_(fila[COL.MAXMIN.CODIGO] || ""),
      minimo: toNum_(fila[COL.MAXMIN.MINIMO] || ""),
      maximo: toNum_(fila[COL.MAXMIN.MAXIMO] || "")
    };
  }

  function getField_(field) {
    return getData_().map(x => x[field]);
  }

  // Lectura de todo el origen de datos una sola vez
  let cache_ = null;

  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(x => x.codigo);

      console.log("[CACHE] MaxMin cargado");
    }

    return cache_;
  }

  return {

    /**
     * Todos los registros ordenados por código
     */
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },

    /**
     * Registros por código
     */
    getPorCodigo: function(codigo) {
      const filtro = toStrUpper_(codigo || "");
      return getData_().filter(t => t.codigo === filtro);
    },

    /**
     * Registros con mínimo > 0
     */
    getConMinimo: function() {
      return getData_().filter(t => t.minimo > 0);
    },

    /**
     * Registros con máximo > 0
     */
    getConMaximo: function() {
      return getData_().filter(t => t.maximo > 0);
    },

    /**
     * Registros con ambos mínimo y máximo > 0
     */
    getConParametros: function() {
      return getData_().filter(t => t.minimo > 0 || t.maximo > 0);
    },

    /**
     * Registros sin parametrización
     */
    getSinParametros: function() {
      return getData_().filter(t => t.minimo <= 0 && t.maximo <= 0);
    },

    /**
     * Devuelve todos los códigos
     */
    getCodigos: function() {
      return getField_("codigo");
    },

    /**
     * Devuelve todos los mínimos
     */
    getMinimos: function() {
      return getField_("minimo");
    },

    /**
     * Devuelve todos los máximos
     */
    getMaximos: function() {
      return getField_("maximo");
    },

    /**
     * Limpia caché
     */
    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] MaxMin limpio");
    }

  };

})();



function debugMaxMinRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================

  const CODIGO_PRUEBA = "T5S-1/4X31/2";
  const LIMITE = 10;

  // ===============================
  //  getAll
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getAll",
    {},
    () => MaxMinRepository.getAll(),
    { limit: LIMITE }
  );

  // ===============================
  //  getPorCodigo
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getPorCodigo",
    { codigo: CODIGO_PRUEBA },
    () => MaxMinRepository.getPorCodigo(CODIGO_PRUEBA),
    { limit: LIMITE }
  );

  // ===============================
  //  getConMinimo
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getConMinimo",
    {},
    () => MaxMinRepository.getConMinimo(),
    { limit: LIMITE }
  );

  // ===============================
  //  getConMaximo
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getConMaximo",
    {},
    () => MaxMinRepository.getConMaximo(),
    { limit: LIMITE }
  );

  // ===============================
  //  getConParametros
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getConParametros",
    {},
    () => MaxMinRepository.getConParametros(),
    { limit: LIMITE }
  );

  // ===============================
  //  getSinParametros
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getSinParametros",
    {},
    () => MaxMinRepository.getSinParametros(),
    { limit: LIMITE }
  );

  // ===============================
  //  getCodigos
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getCodigos",
    {},
    () => MaxMinRepository.getCodigos(),
    { limit: LIMITE }
  );

  // ===============================
  //  getMinimos
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getMinimos",
    {},
    () => MaxMinRepository.getMinimos(),
    { limit: LIMITE }
  );

  // ===============================
  //  getMaximos
  // ===============================

  debugRepositoryCall_(
    "MaxMinRepository.getMaximos",
    {},
    () => MaxMinRepository.getMaximos(),
    { limit: LIMITE }
  );
}

function debugMethodsMaxMinRepository() {
  return debugRepositoryMethods_("MaxMinRepository", MaxMinRepository);
}