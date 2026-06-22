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

function debugExcedentesRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================

  const CODIGO_PRUEBA = "T5S-1/4X31/2";
  const DESCRIPCION_PRUEBA = "TORNILLO GRADO 5 ESTANDAR DE 1/4 x 3 1/2";
  const IDPRODUCTO_PRUEBA = "158";
  const IDUNICO_PRUEBA = "202605141622201581";
  const FECHA_PRUEBA = "14/05/2026";
  const HORA_PRUEBA = "16:22:25";
  const STATUS_PRUEBA = "ACOMODADO";
  const LIMITE = 50;
 
  // ===============================
  //  getAll
  // ===============================

  const all = ExcedentesRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 3));

  // ===============================
  //  getUltimos
  // ===============================

  const ultimos = ExcedentesRepository.getUltimos(LIMITE);
  console.log("[getUltimos] total:", ultimos.length);
  console.log("[getUltimos] muestra:", JSON.stringify(ultimos.slice(0, 5), null, 3));

  // ===============================
  //  getPorIdUnico
  // ===============================

  const idunico = ExcedentesRepository.getPorIdUnico(IDUNICO_PRUEBA);
  console.log(`[getPorIdUnico(${IDUNICO_PRUEBA})] total:`, idunico.length);
  console.log("[getPorIdUnico] muestra:", JSON.stringify(idunico.slice(0, 5), null, 3));

  // ===============================
  //  getPorFecha
  // ===============================

  const porfecha = ExcedentesRepository.getPorFecha(FECHA_PRUEBA);
  console.log(`[getPorFecha(${FECHA_PRUEBA})] total:`, porfecha.length);
  console.log("[getPorFecha] muestra:", JSON.stringify(porfecha.slice(0, 5), null, 3));

  // ===============================
  //  getPorHora
  // ===============================

  const porHora = ExcedentesRepository.getPorHora(HORA_PRUEBA);
  console.log(`[getPorHora(${HORA_PRUEBA})] total:`, porHora.length);
  console.log("[getPorHora] muestra:", JSON.stringify(porHora.slice(0, 5), null, 3));

  // ===============================
  //  getPorIdProducto
  // ===============================

  const idProducto = ExcedentesRepository.getPorIdProducto(IDPRODUCTO_PRUEBA);
  console.log(`[getPorIdProducto(${IDPRODUCTO_PRUEBA})] total:`, idProducto.length);
  console.log("[getPorIdProducto] muestra:", JSON.stringify(idProducto.slice(0, 5), null, 3));

  // ===============================
  //  getPorCodigo
  // ===============================

  const porCodigo = ExcedentesRepository.getPorCodigo(CODIGO_PRUEBA);
  console.log(`[getPorCodigo(${CODIGO_PRUEBA})] total:`, porCodigo.length);
  console.log("[getPorCodigo] muestra:", JSON.stringify(porCodigo.slice(0, 5), null, 3));

  // ===============================
  //  getPorDescripcion
  // ===============================

  const porDescripcion = ExcedentesRepository.getPorDescripcion(DESCRIPCION_PRUEBA);
  console.log(`[getPorDescripcion(${DESCRIPCION_PRUEBA})] total:`, porDescripcion.length);
  console.log("[getPorDescripcion] muestra:", JSON.stringify(porDescripcion.slice(0, 5), null, 3));

  // ===============================
  //  getPorStatus
  // ===============================

  const porStatus = ExcedentesRepository.getPorStatus(STATUS_PRUEBA);
  console.log(`[getPorStatus(${STATUS_PRUEBA})] total:`, porStatus.length);
  console.log("[getPorStatus] muestra:", JSON.stringify(porStatus.slice(0, 5), null, 3));


  // ===============================
  //  getIdProductos
  // ===============================

  const idproductos = ExcedentesRepository.getIdProductos();
  console.log("[idproductos] total:", idproductos.length);
  console.log("[idproductos] muestra:", JSON.stringify(idproductos.slice(0, 5), null, 3));

  // ===============================
  //  getCodigos
  // ===============================

  const codigos = ExcedentesRepository.getCodigos();
  console.log("[getCodigos] total:", codigos.length);
  console.log("[getCodigos] muestra:", JSON.stringify(codigos.slice(0, 5), null, 3));

  // ===============================
  //  getIdUnicos
  // ===============================

  const idunicos = ExcedentesRepository.getIdUnicos();
  console.log("[getIdUnicos] total:", idunicos.length);
  console.log("[getIdUnicos] muestra:", JSON.stringify(idunicos.slice(0, 5), null, 3));
  
  // ===============================
  //  getStatus
  // ===============================

  const status = ExcedentesRepository.getStatus();
  console.log("[getStatus] total:", status.length);
  console.log("[getStatus] muestra:", JSON.stringify(status.slice(0, 5), null, 3));

}