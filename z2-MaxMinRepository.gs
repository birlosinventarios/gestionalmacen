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
