/**
 * TraspasosRepository.gs
 * Lectura de hoja Bitacora-TRASPASOS
 */

const TraspasosRepository = (() => {

  function readSource_() {
    return getRowsByKey_("TRASPASOS");
  }

  function normalize_(fila, filaReal) {
    return {
      fila: filaReal,
      fechatraspaso: toDate_(fila[COL.TRASPASOS.FECHA] || ""),
      horatraspaso: toTime_(fila[COL.TRASPASOS.HORA] || ""),
      tipomovimiento: toStrUpper_(fila[COL.TRASPASOS.TIPOMOVIMIENTO] || ""),
      serie: toStrUpper_(fila[COL.TRASPASOS.SERIE] || ""),
      bodegasalida: toStrUpper_(fila[COL.TRASPASOS.BODEGA_SALIDA] || ""),
      ubicacionsalida: toStrUpper_(fila[COL.TRASPASOS.UBICACION_SALIDA] || ""),
      bodegaentrada: toStrUpper_(fila[COL.TRASPASOS.BODEGA_ENTRADA] || ""),
      ubicacionentrada: toStrUpper_(fila[COL.TRASPASOS.UBICACION_ENTRADA] || ""),
      solicitante: toStrUpper_(fila[COL.TRASPASOS.SOLICITANTE] || ""),
      codigo: toStrUpper_(fila[COL.TRASPASOS.CODIGO] || ""),
      descripcion: toStrUpper_(fila[COL.TRASPASOS.DESCRIPCION] || ""),
      cantidad: toNum_(fila[COL.TRASPASOS.CANTIDAD] || ""),
      folio: toStr_(fila[COL.TRASPASOS.FOLIO] || ""),
      responsable: toStrUpper_(fila[COL.TRASPASOS.RESPONSABLE] || ""),
      idunico: toStr_(fila[COL.TRASPASOS.IDUNICO] || "")
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
            .map((fila, index) => normalize_(fila, index + 2))
            .filter(x => x.codigo);

      console.log("[CACHE] Traspasos Cargados");
    }

    return cache_;
  }

  return {

    // Devuelve todos los traspasos    
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },

    getAllRaw: function() {
      return [...getData_()];
    },
    
    getAllByFechaHora: function() {
      return [...getData_()].sort((a, b) => {
        const fa = a.fechatraspaso instanceof Date ? a.fechatraspaso.getTime() : 0;
        const fb = b.fechatraspaso instanceof Date ? b.fechatraspaso.getTime() : 0;

        const ha = a.horatraspaso instanceof Date
          ? a.horatraspaso.getHours() * 3600000 +
            a.horatraspaso.getMinutes() * 60000 +
            a.horatraspaso.getSeconds() * 1000
          : 0;

        const hb = b.horatraspaso instanceof Date
          ? b.horatraspaso.getHours() * 3600000 +
            b.horatraspaso.getMinutes() * 60000 +
            b.horatraspaso.getSeconds() * 1000
          : 0;

        const ta = fa + ha;
        const tb = fb + hb;

        if (ta !== tb) return ta - tb;

        return Number(a.fila || 0) - Number(b.fila || 0);
      });
    },

    // Devuelve ultimos traspasos 
    getUltimos: function(limit) {
      return [...getData_()].slice(-limit);
    },

    // Devuelve todos los traspasos por fecha  
    getPorFecha: function(fechatraspaso) {
      return getData_().filter(t => sameDate_(t.fechatraspaso, fechatraspaso));
    },

    // Devuelve todos los traspasos por hora 
    getPorHora: function(horatraspaso) {
      return getData_().filter(t => sameTime_(t.horatraspaso, horatraspaso));
    },

    // Devuelve todos los traspasos por tipo de movimiento   
    getPorTipoMovimiento: function(tipomovimiento) {
      const filtro = toStrUpper_(tipomovimiento || "");
      return getData_().filter(t => t.tipomovimiento === filtro);
    },

    // Devuelve todos los traspasos por serie
    getPorSerie: function(serie) {
      const filtro = toStrUpper_(serie || "");
      return getData_().filter(t => t.serie === filtro);
    },

    // Devuelve todos los traspasos por bodega de salida
    getPorBodegaSalida: function(bodegasalida) {
      const filtro = toStrUpper_(bodegasalida || "");
      return getData_().filter(t => t.bodegasalida === filtro);
    },

    // Devuelve todos los traspasos por ubicacion de salida
    getPorUbicacionSalida: function(ubicacionsalida) {
      const filtro = toStrUpper_(ubicacionsalida || "");
      return getData_().filter(t => t.ubicacionsalida === filtro);
    },

    // Devuelve todos los traspasos por bodega de entrada
    getPorBodegaEntrada: function(bodegaentrada) {
      const filtro = toStrUpper_(bodegaentrada || "");
      return getData_().filter(t => t.bodegaentrada === filtro);
    },

    // Devuelve todos los traspasos por ubicacion de salida
    getPorUbicacionEntrada: function(ubicacionentrada) {
      const filtro = toStrUpper_(ubicacionentrada || "");
      return getData_().filter(t => t.ubicacionentrada === filtro);
    },

    // Devuelve todos los traspasos por solicitante    
    getPorSolicitante: function(solicitante) {
      const filtro = toStrUpper_(solicitante || "");
      return getData_().filter(t => t.solicitante === filtro);
    },

    // Devuelve todos los traspasos por codigo    
    getPorCodigo: function(codigo) {
      const filtro = toStrUpper_(codigo || "");
      return getData_().filter(t => t.codigo === filtro);
    },

    // Devuelve todos los traspasos por descripcion    
    getPorDescripcion: function(descripcion) {
      const filtro = toStrUpper_(descripcion || "");

      return getData_().filter(t => t.descripcion === filtro);
    },

    // Devuelve todos los traspasos por folio   
    getPorFolio: function(folio) {
      const filtro = toStr_(folio || "");
      return getData_().filter(t => t.folio === filtro);
    },

    // Devuelve todos los traspasos por responsable    
    getPorResponsable: function(responsable) {
      const filtro = toStrUpper_(responsable || "");
      return getData_().filter(t => t.responsable === filtro);
    },

    // Devuelve todos los traspasos por idunico   
    getPorIdUnico: function(idunico) {
      const filtro = toStr_(idunico || "");
      return getData_().filter(t => t.idunico === filtro);
    },

    //  Devuelve todos las series involucradas
    getSeries: function() {
      return getField_("serie");
    },

    //  Devuelve todos las bodegas con salida involucradas
    getBodegasSalida: function() {
      return getField_("bodegasalida");
    },

    //  Devuelve todos las ubicaciones con salida involucradas
    getUbicacionesSalida: function() {
      return getField_("ubicacionsalida");
    },

    //  Devuelve todos las bodegas con entrada involucradas
    getBodegasEntrada: function() {
      return getField_("bodegaentrada");
    },

    //  Devuelve todos las ubicaciones con entrada involucradas
    getUbicacionesEntrada: function() {
      return getField_("ubicacionentrada");
    },

    //  Devuelve todos los solicitantes involucrados
    getSolicitantes: function() {
      return getField_("solicitante");
    },

    //  Devuelve todos los codigos involucrados
    getCodigos: function() {
      return getField_("codigo");
    },

    //  Devuelve todos los folios involucrados
    getFolios: function() {
      return getField_("folio");
    },
    
    //  Devuelve todos los responsables involucrados
    getResponsables: function() {
      return getField_("responsable");
    },

    //  Devuelve todos los idunicos involucrados
    getIdUnicos: function() {
      return getField_("idunico");
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] traspasos limpios");
    }

  };

})();
