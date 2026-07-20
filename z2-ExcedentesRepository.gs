/**
 * ExcedentesRepository.gs
 * Lectura de hoja BD-Excedentes
 */

const ExcedentesRepository = (() => {

  function readSource_() {
    return getRowsByKey_("EXCEDENTES");
  }

  function normalize_(fila) {
    return {
      idunico: toStrUpper_(fila[COL.EXCEDENTES.IDUNICO] || ""),
      fechaexcedente: toDate_(fila[COL.EXCEDENTES.FECHA] || ""),
      horaexcedente: toTime_(fila[COL.EXCEDENTES.HORA] || ""),
      idproducto: toStrUpper_(fila[COL.EXCEDENTES.IDPRODUCTO] || ""),
      codigo: toStrUpper_(fila[COL.EXCEDENTES.CODIGO] || ""),
      descripcion: toStrUpper_(fila[COL.EXCEDENTES.DESCRIPCION] || ""),
      cantidad: toNum_(fila[COL.EXCEDENTES.CANTIDAD] || ""),
      status: toStrUpper_(fila[COL.EXCEDENTES.STATUS] || "")
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
      console.log("[CACHE] Excedentes Cargados");
    }

    return cache_;
  }

  return {

    // Devuelve todos los excedentes    
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },

    getAllRaw: function() {
      return [...getData_()];
    },

    // Devuelve ultimos excedentes 
    getUltimos: function(limit) {
      return [...getData_()].slice(-limit);
    },

    // Devuelve todos los excedentes por idunico   
    getPorIdUnico: function(idunico) {
      const filtro = toStrUpper_(idunico || "");
      return getData_().filter(t => t.idunico === filtro);
    },

    // Devuelve todos los excedentes por fecha  
    getPorFecha: function(fechaexcedente) {
      return getData_().filter(t => sameDate_(t.fechaexcedente, fechaexcedente));
    },

    // Devuelve todos los excedentes por hora 
    getPorHora: function(horaexcedente) {
      return getData_().filter(t => sameTime_(t.horaexcedente, horaexcedente));
    },

    // Devuelve todos los excedentes por idproducto
    getPorIdProducto: function(idproducto) {
      const filtro = toStrUpper_(idproducto || "");
      return getData_().filter(t => t.idproducto === filtro);
    },

    // Devuelve todos los excedentes por codigo    
    getPorCodigo: function(codigo) {
      const filtro = toStrUpper_(codigo || "");
      return getData_().filter(t => t.codigo === filtro);
    },

    // Devuelve todos los excedentes por descripcion    
    getPorDescripcion: function(descripcion) {
      const filtro = toStrUpper_(descripcion || "");

      return getData_().filter(t => t.descripcion === filtro);
    },

    // Devuelve todos los excedentes por STATUS
    getPorStatus: function(status) {
      const filtro = toStrUpper_(status || "");
      return getData_().filter(t => t.status === filtro);
    },

    //  Devuelve todos los idproducto
    getIdProductos: function() {
      return getField_("idproducto");
    },

    //  Devuelve todos los codigos 
    getCodigos: function() {
      return getField_("codigo");
    },

    //  Devuelve todos los idunicos 
    getIdUnicos: function() {
      return getField_("idunico");
    },
    
    //  Devuelve todos los status 
    getStatus: function() {
      return getField_("status");
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] Excedentes limpio");
    }

  };

})();
