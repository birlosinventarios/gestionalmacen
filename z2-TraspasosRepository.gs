/**
 * TraspasosRepository.gs
 * Lectura de hoja Bitacora-TRASPASOS
 */

const TraspasosRepository = (() => {

  function readSource_() {
    return getRows_(SHEETS.TRASPASOS);
  }

  function normalize_(fila) {
    return {
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
        .map(normalize_)
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
      const filtro = toNum_(folio || "");
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

function debugTraspasosRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================

  const CODIGO_PRUEBA = "T5S-1/2X3";
  const DESCRIPCION_PRUEBA = "TORNILLO GRADO 5 ESTANDAR DE 1/2 x 3";
  const IDUNICO_PRUEBA = "20260515170044177941";
  const FECHA_PRUEBA = "14/05/2026";
  const HORA_PRUEBA = "15:51:20";
  const TIPOMOVIMIENTO_PRUEBA = "Acomodo";
  const SERIE_PRUEBA = "B1-19";
  const BODEGASALIDA_PRUEBA = "Bodega 1";
  const UBICACIONSALIDA_PRUEBA = "B1-19";
  const BODEGAENTRADA_PRUEBA = "Bodega 1";
  const UBICACIONENTRADA_PRUEBA = "B1-19";
  const SOLICITANTE_PRUEBA = "SIGIFREDO DE LA CRUZ";
  const FOLIO_PRUEBA = "1111";
  const RESPONSABLE_PRUEBA = "SIGIFREDO DE LA CRUZ RAMOS";
  const LIMITE = 50;
 
  // ===============================
  //  getAll
  // ===============================

  const all = TraspasosRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 3));

  // ===============================
  //  getUltimos
  // ===============================

  const ultimos = TraspasosRepository.getUltimos(LIMITE);
  console.log("[getUltimos] total:", ultimos.length);
  console.log("[getUltimos] muestra:", JSON.stringify(ultimos.slice(0, 5), null, 3));

  // ===============================
  //  getPorFecha
  // ===============================

  const porfecha = TraspasosRepository.getPorFecha(FECHA_PRUEBA);
  console.log(`[getPorFecha(${FECHA_PRUEBA})] total:`, porfecha.length);
  console.log("[getPorFecha] muestra:", JSON.stringify(porfecha.slice(0, 5), null, 3));

  // ===============================
  //  getPorHora
  // ===============================

  const porHora = TraspasosRepository.getPorHora(HORA_PRUEBA);
  console.log(`[getPorHora(${HORA_PRUEBA})] total:`, porHora.length);
  console.log("[getPorHora] muestra:", JSON.stringify(porHora.slice(0, 5), null, 3));

  // ===============================
  //  getPorTipoMovimiento
  // ===============================

  const tipomovimiento = TraspasosRepository.getPorTipoMovimiento(TIPOMOVIMIENTO_PRUEBA);
  console.log(`[getPorTipoMovimiento(${TIPOMOVIMIENTO_PRUEBA})] total:`, tipomovimiento.length);
  console.log("[getPorTipoMovimiento] muestra:", JSON.stringify(tipomovimiento.slice(0, 5), null, 3));

  // ===============================
  //  getPorSerie
  // ===============================

  const serie = TraspasosRepository.getPorSerie(SERIE_PRUEBA);
  console.log(`[getPorSerie(${SERIE_PRUEBA})] total:`, serie.length);
  console.log("[getPorSerie] muestra:", JSON.stringify(serie.slice(0, 5), null, 3));

  // ===============================
  //  getPorBodegaSalida
  // ===============================

  const bodegasalida = TraspasosRepository.getPorBodegaSalida(BODEGASALIDA_PRUEBA);
  console.log(`[getPorBodegaSalida(${BODEGASALIDA_PRUEBA})] total:`, bodegasalida.length);
  console.log("[getPorBodegaSalida] muestra:", JSON.stringify(bodegasalida.slice(0, 5), null, 3));

  // ===============================
  //  getPorUbicacionSalida
  // ===============================

  const ubicacionsalida = TraspasosRepository.getPorUbicacionSalida(UBICACIONSALIDA_PRUEBA);
  console.log(`[getPorUbicacionSalida(${UBICACIONSALIDA_PRUEBA})] total:`, ubicacionsalida.length);
  console.log("[getPorUbicacionSalida] muestra:", JSON.stringify(ubicacionsalida.slice(0, 5), null, 3));


  // ===============================
  //  getPorBodegaEntrada
  // ===============================

  const bodegaentrada = TraspasosRepository.getPorBodegaEntrada(BODEGAENTRADA_PRUEBA);
  console.log(`[getPorBodegaEntrada(${BODEGAENTRADA_PRUEBA})] total:`, bodegaentrada.length);
  console.log("[getPorBodegaEntrada] muestra:", JSON.stringify(bodegaentrada.slice(0, 5), null, 3));

  // ===============================
  //  getPorUbicacionEntrada
  // ===============================

  const ubicacionentrada = TraspasosRepository.getPorUbicacionEntrada(UBICACIONENTRADA_PRUEBA);
  console.log(`[getPorUbicacionEntrada(${UBICACIONENTRADA_PRUEBA})] total:`, ubicacionentrada.length);
  console.log("[getPorUbicacionEntrada] muestra:", JSON.stringify(ubicacionentrada.slice(0, 5), null, 3));

  // ===============================
  //  getPorSolicitante
  // ===============================

  const porSolicitante = TraspasosRepository.getPorSolicitante(SOLICITANTE_PRUEBA);
  console.log(`[getPorSolicitante(${SOLICITANTE_PRUEBA})] total:`, porSolicitante.length);
  console.log("[getPorSolicitante] muestra:", JSON.stringify(porSolicitante.slice(0, 5), null, 3));

  // ===============================
  //  getPorCodigo
  // ===============================

  const porCodigo = TraspasosRepository.getPorCodigo(CODIGO_PRUEBA);
  console.log(`[getPorCodigo(${CODIGO_PRUEBA})] total:`, porCodigo.length);
  console.log("[getPorCodigo] muestra:", JSON.stringify(porCodigo.slice(0, 5), null, 3));

  // ===============================
  //  getPorDescripcion
  // ===============================

  const porDescripcion = TraspasosRepository.getPorDescripcion(DESCRIPCION_PRUEBA);
  console.log(`[getPorDescripcion(${DESCRIPCION_PRUEBA})] total:`, porDescripcion.length);
  console.log("[getPorDescripcion] muestra:", JSON.stringify(porDescripcion.slice(0, 5), null, 3));

  // ===============================
  //  getPorFolio
  // ===============================

  const porFolio = TraspasosRepository.getPorFolio(FOLIO_PRUEBA);
  console.log(`[getPorFolio(${FOLIO_PRUEBA})] total:`, porFolio.length);
  console.log("[getPorFolio] muestra:", JSON.stringify(porFolio.slice(0, 5), null, 3));

  // ===============================
  //  getPorResponsable
  // ===============================

  const porResponsable = TraspasosRepository.getPorResponsable(RESPONSABLE_PRUEBA);
  console.log(`[getPorResponsable(${RESPONSABLE_PRUEBA})] total:`, porResponsable.length);
  console.log("[getPorResponsable] muestra:", JSON.stringify(porResponsable.slice(0, 5), null, 3));

  // ===============================
  //  getPorIdUnico
  // ===============================

  const idunico = TraspasosRepository.getPorIdUnico(IDUNICO_PRUEBA);
  console.log(`[getPorIdUnico(${IDUNICO_PRUEBA})] total:`, idunico.length);
  console.log("[getPorIdUnico] muestra:", JSON.stringify(idunico.slice(0, 5), null, 3));

  // ===============================
  //  getSeries
  // ===============================

  const series = TraspasosRepository.getSeries();
  console.log("[getSeries] total:", series.length);
  console.log("[getSeries] muestra:", JSON.stringify(series.slice(0, 5), null, 3));

  // ===============================
  //  getBodegasSalida
  // ===============================

  const bodegassalida = TraspasosRepository.getBodegasSalida();
  console.log("[getBodegasSalida] total:", bodegassalida.length);
  console.log("[getBodegasSalida] muestra:", JSON.stringify(bodegassalida.slice(0, 5), null, 3));

  // ===============================
  //  getUbicacionesSalida
  // ===============================

  const ubicacionessalida = TraspasosRepository.getUbicacionesSalida();
  console.log("[getUbicacionesSalida] total:", ubicacionessalida.length);
  console.log("[getUbicacionesSalida] muestra:", JSON.stringify(ubicacionessalida.slice(0, 5), null, 3));

  // ===============================
  //  getBodegasEntrada
  // ===============================

  const bodegasentrada = TraspasosRepository.getBodegasEntrada();
  console.log("[getBodegasEntrada] total:", bodegasentrada.length);
  console.log("[getBodegasEntrada] muestra:", JSON.stringify(bodegasentrada.slice(0, 5), null, 3));

  // ===============================
  //  getUbicacionesEntrada
  // ===============================

  const ubicacionesentrada = TraspasosRepository.getUbicacionesEntrada();
  console.log("[getUbicacionesEntrada] total:", ubicacionesentrada.length);
  console.log("[getUbicacionesEntrada] muestra:", JSON.stringify(ubicacionesentrada.slice(0, 5), null, 3));

  // ===============================
  //  getSolicitantes
  // ===============================

  const solicitantes = TraspasosRepository.getSolicitantes();
  console.log("[getSolicitantes] total:", solicitantes.length);
  console.log("[getSolicitantes] muestra:", JSON.stringify(solicitantes.slice(0, 5), null, 3));

  // ===============================
  //  getCodigos
  // ===============================

  const codigos = TraspasosRepository.getCodigos();
  console.log("[getCodigos] total:", codigos.length);
  console.log("[getCodigos] muestra:", JSON.stringify(codigos.slice(0, 5), null, 3));

  // ===============================
  //  getFolios
  // ===============================

  const folios = TraspasosRepository.getFolios();
  console.log("[getFolios] total:", folios.length);
  console.log("[getFolios] muestra:", JSON.stringify(folios.slice(0, 5), null, 3));

  // ===============================
  //  getResponsables
  // ===============================

  const responsables = TraspasosRepository.getResponsables();
  console.log("[getResponsables] total:", responsables.length);
  console.log("[getResponsables] muestra:", JSON.stringify(responsables.slice(0, 5), null, 3));

  // ===============================
  //  getIdUnicos
  // ===============================

  const idunicos = TraspasosRepository.getIdUnicos();
  console.log("[getIdUnicos] total:", idunicos.length);
  console.log("[getIdUnicos] muestra:", JSON.stringify(idunicos.slice(0, 5), null, 3));


}