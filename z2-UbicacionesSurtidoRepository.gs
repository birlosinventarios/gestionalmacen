/**
 * UbicacionesSurtidoRepository.gs
 * Lectura de hoja UBICACIONES_SURTIDO
 */

const UbicacionesSurtidoRepository = (() => {

  function readSource_() {
    return getRowsByKey_("UBICACIONES_SURTIDO");
  }

  function normalize_(fila) {
    return {

      idubicacion: toNum_(fila[COL.UBICACIONES_SURTIDO.IDUBICACION] || ""),
      codigo: toStrUpper_(fila[COL.UBICACIONES_SURTIDO.CODIGO]),
      bodega: toNum_(fila[COL.UBICACIONES_SURTIDO.BODEGA]),
      pasillo: toNum_(fila[COL.UBICACIONES_SURTIDO.PASILLO]),
      anaquel: toNum_(fila[COL.UBICACIONES_SURTIDO.ANAQUEL]),
      repisa: toNum_(fila[COL.UBICACIONES_SURTIDO.REPISA]),
      idproducto: toNum_(fila[COL.UBICACIONES_SURTIDO.IDPRODUCTO]),
      ubicacion: toStrUpper_(fila[COL.UBICACIONES_SURTIDO.UBICACION]),
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
      console.log("[CACHE] Ubicaciones de surtido cargadas");
    }

    return cache_;
  }

  return {

    // Devuelve todas las ubicaciones  
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },

    // Devuelve todas las ubicaciones por codigo    
    getPorCodigo: function(codigo) {
      const filtro = toStrUpper_(codigo || "");
      return getData_().filter(t => t.codigo === filtro);
    },

    // Devuelve todas las ubicaciones por bodega
    getPorBodega: function(bodega) {
      const filtro = toNum_(bodega || "");
      return getData_().filter(t => t.bodega === filtro);
    },

    // Devuelve todas las ubicaciones por pasillo
    getPorPasillo: function(pasillo) {
      const filtro = toNum_(pasillo || "");
      return getData_().filter(t => t.pasillo === filtro);
    },

    // Devuelve todas las ubicaciones por anaquel
    getPorAnaquel: function(anaquel) {
      const filtro = toNum_(anaquel || "");
      return getData_().filter(t => t.anaquel === filtro);
    },

    // Devuelve todas las ubicaciones por repisa
    getPorRepisa: function(repisa) {
      const filtro = toNum_(repisa || "");
      return getData_().filter(t => t.repisa === filtro);
    },

    // Devuelve todas las ubicaciones por idproducto
    getPorIdProducto: function(idproducto) {
      const filtro = toNum_(idproducto || "");
      return getData_().filter(t => t.idproducto === filtro);
    },

    // Devuelve todas las ubicaciones por ubicacion
    getPorUbicacion: function(ubicacion) {
      const filtro = toStrUpper_(ubicacion || "");
      return getData_().filter(t => t.ubicacion === filtro);
    },

    //  Devuelve todos las bodegas involucradas
    getBodegas: function() {
      return getField_("bodega");
    },

    //  Devuelve todos los pasillos involucrados
    getPasillos: function() {
      return getField_("pasillo");
    },

    //  Devuelve todos los anaqueles involucrados
    getAnaqueles: function() {
      return getField_("anaquel");
    },
  
    //  Devuelve todos las repisas involucradas
    getRepisas: function() {
      return getField_("repisa");
    },

    //  Devuelve todos las ubicaciones involucradas
    getUbicaciones: function() {
      return getField_("ubicacion");
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] Ubicaciones de surtido limpias");
    }

  };

})();
