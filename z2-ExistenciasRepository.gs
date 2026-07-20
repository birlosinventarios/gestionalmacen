/**
 * ExistenciasRepository.gs
 * Lectura de hoja EXISTENCIAS
 */

const ExistenciasRepository = (() => {

  function readSource_() {
    return getRowsByKey_("EXISTENCIAS");
  }

  function normalize_(fila) {
    return {
      idproducto: toNum_(fila[COL.EXISTENCIAS.IDPRODUCTO] || ""),
      codigo: toStrUpper_(fila[COL.EXISTENCIAS.CODIGO] || ""),
      descripcion: toStrUpper_(fila[COL.EXISTENCIAS.DESCRIPCION] || ""),
      almacenbirlos: toNum_(fila[COL.EXISTENCIAS.ALMACENBIRLOS] || ""),
      excedentebodega: toNum_(fila[COL.EXISTENCIAS.EXCEDENTEBODEGA] || ""),
      excedentecasablanca: toNum_(fila[COL.EXISTENCIAS.EXCEDENTECASABLANCA] || "")
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
      console.log("[CACHE] Existencias Cargadas");
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
    
    getAllRaw: function() {
      return [...getData_()];
    },

    /**
     * Registros por ID producto
     */
    getPorIdProducto: function(idproducto) {
      const filtro = toNum_(idproducto || 0);
      return getData_().filter(t => t.idproducto === filtro);
    },

    /**
     * Registros por código
     */
    getPorCodigo: function(codigo) {
      const filtro = toStrUpper_(codigo || "");
      return getData_().filter(t => t.codigo === filtro);
    },

    /**
     * Registros por descripción
     */
    getPorDescripcion: function(descripcion) {
      const filtro = toStrUpper_(descripcion || "");
      return getData_().filter(t => t.descripcion === filtro);
    },

    /**
     * Todos los registros con existencias en Almacén Birlos > 0
     */
    getExistenciasBirlos: function() {
      return getData_().filter(t => t.almacenbirlos > 0);
    },

    /**
     * Todos los registros con excedente en Bodega > 0
     */
    getExcedentesBodega: function() {
      return getData_().filter(t => t.excedentebodega > 0);
    },

    /**
     * Todos los registros con excedente en Casa Blanca > 0
     */
    getExcedentesCasaBlanca: function() {
      return getData_().filter(t => t.excedentecasablanca > 0);
    },

    /**
     * Todos los registros con saldo negativo en Almacén Birlos
     */
    getNegativosBirlos: function() {
      return getData_().filter(t => t.almacenbirlos < 0);
    },

    /**
     * Todos los registros con saldo negativo en Excedente Bodega
     */
    getNegativosBodega: function() {
      return getData_().filter(t => t.excedentebodega < 0);
    },

    /**
     * Todos los registros con saldo negativo en Excedente Casa Blanca
     */
    getNegativosCasaBlanca: function() {
      return getData_().filter(t => t.excedentecasablanca < 0);
    },

    /**
     * Limpiar caché
     */
    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] Existencias limpias");
    }
  };

})();

