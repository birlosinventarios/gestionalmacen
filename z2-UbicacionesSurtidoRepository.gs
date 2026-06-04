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
      descripcion: toStrUpper_(fila[COL.UBICACIONES_SURTIDO.DESCRIPCION]),
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

    // Devuelve todas las ubicaciones por descripcion    
    getPorDescripcion: function(descripcion) {
      const filtro = toStrUpper_(descripcion || "");
      return getData_().filter(t => t.descripcion === filtro);
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

function debugUbicacionesSurtidoRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================

  const CODIGO_PRUEBA = "T5S-1/2X3";
  const BODEGA_PRUEBA = "1";
  const PASILLO_PRUEBA = "1";
  const ANAQUEL_PRUEBA = "1";
  const REPISA_PRUEBA = "1";
  const IDPRODUCTO_PRUEBA = "96";
  const UBICACION_PRUEBA = "B3 - P5"
 
  // ===============================
  //  getAll
  // ===============================

  const all = UbicacionesSurtidoRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 3));

  // ===============================
  //  getPorCodigo
  // ===============================

  const porCodigo = UbicacionesSurtidoRepository.getPorCodigo(CODIGO_PRUEBA);
  console.log(`[getPorCodigo(${CODIGO_PRUEBA})] total:`, porCodigo.length);
  console.log("[getPorCodigo] muestra:", JSON.stringify(porCodigo.slice(0, 5), null, 3));

  // ===============================
  //  getPorBodega
  // ===============================

  const bodega = UbicacionesSurtidoRepository.getPorBodega(BODEGA_PRUEBA);
  console.log(`[getPorBodega(${BODEGA_PRUEBA})] total:`, bodega.length);
  console.log("[getPorBodega] muestra:", JSON.stringify(bodega.slice(0, 5), null, 3));

  // ===============================
  //  getPorPasillo
  // ===============================

  const pasillo = UbicacionesSurtidoRepository.getPorPasillo(PASILLO_PRUEBA);
  console.log(`[getPorPasillo(${PASILLO_PRUEBA})] total:`, pasillo.length);
  console.log("[getPorPasillo] muestra:", JSON.stringify(pasillo.slice(0, 5), null, 3));

  // ===============================
  //  getPorAnaquel
  // ===============================

  const anaquel = UbicacionesSurtidoRepository.getPorAnaquel(ANAQUEL_PRUEBA);
  console.log(`[getPorAnaquel(${ANAQUEL_PRUEBA})] total:`, anaquel.length);
  console.log("[getPorAnaquel] muestra:", JSON.stringify(anaquel.slice(0, 5), null, 3));

  // ===============================
  //  getPorRepisa
  // ===============================

  const repisa = UbicacionesSurtidoRepository.getPorRepisa(REPISA_PRUEBA);
  console.log(`[getPorRepisa(${REPISA_PRUEBA})] total:`, repisa.length);
  console.log("[getPorRepisa] muestra:", JSON.stringify(repisa.slice(0, 5), null, 3));

  // ===============================
  //  getPorIdProducto
  // ===============================

  const idproducto = UbicacionesSurtidoRepository.getPorIdProducto(IDPRODUCTO_PRUEBA);
  console.log(`[getPorIdProducto(${IDPRODUCTO_PRUEBA})] total:`, idproducto.length);
  console.log("[getPorIdProducto] muestra:", JSON.stringify(idproducto.slice(0, 5), null, 3));

  // ===============================
  //  getPorUbicacion
  // ===============================

  const ubicacion = UbicacionesSurtidoRepository.getPorUbicacion(UBICACION_PRUEBA);
  console.log(`[getPorUbicacion(${UBICACION_PRUEBA})] total:`, ubicacion.length);
  console.log("[getPorUbicacion] muestra:", JSON.stringify(ubicacion.slice(0, 5), null, 3));

  // ===============================
  //  getBodegas
  // ===============================

  const bodegas = UbicacionesSurtidoRepository.getBodegas();
  console.log("[getBodegas] total:", bodegas.length);
  console.log("[getBodegas] muestra:", JSON.stringify(bodegas.slice(0, 5), null, 3));

  // ===============================
  //  getPasillos
  // ===============================

  const pasillos = UbicacionesSurtidoRepository.getPasillos();
  console.log("[getPasillos] total:", pasillos.length);
  console.log("[getPasillos] muestra:", JSON.stringify(pasillos.slice(0, 5), null, 3));

  // ===============================
  //  getAnaqueles
  // ===============================

  const anaqueles = UbicacionesSurtidoRepository.getAnaqueles();
  console.log("[getAnaqueles] total:", anaqueles.length);
  console.log("[getAnaqueles] muestra:", JSON.stringify(anaqueles.slice(0, 5), null, 3));

  // ===============================
  //  getRepisas
  // ===============================

  const repisas = UbicacionesSurtidoRepository.getRepisas();
  console.log("[getRepisas] total:", repisas.length);
  console.log("[getRepisas] muestra:", JSON.stringify(repisas.slice(0, 5), null, 3));

  // ===============================
  //  getUbicaciones
  // ===============================

  const ubicaciones = UbicacionesSurtidoRepository.getUbicaciones();
  console.log("[getUbicaciones] total:", ubicaciones.length);
  console.log("[getUbicaciones] muestra:", JSON.stringify(ubicaciones.slice(0, 5), null, 3));

}