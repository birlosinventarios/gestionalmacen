/**
 * UbicacionesExcedentesRepository.gs
 * Lectura de hoja UBICACIONES
 */

const UbicacionesExcedentesRepository = (() => {

  function readSource_() {
    return getRows_(SHEETS.UBICACIONES_EXCEDENTES);
  }

  function normalize_(fila) {
    return {
      idubicacionesexcedentes: toNum_(fila[COL.UBICACIONES_EXCEDENTES.IDUBICACIONES_EXCEDENTES] || ""),
      bodega: toStrUpper_(fila[COL.UBICACIONES_EXCEDENTES.BODEGA] || ""),
      ubicacion: toStrUpper_(fila[COL.UBICACIONES_EXCEDENTES.UBICACION] || "")
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
        .filter(x => x.ubicacion);
      console.log("[CACHE] Ubicaciones de excedentes Cargadas");
    }

    return cache_;
  }

  return {

    // Devuelve todas las ubicaciones    
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion));
    },

    // Devuelve todos las ubicaciones de excedentes por bodega
    getPorBodega: function(bodega) {
      const filtro = toStrUpper_(bodega || "");
      return getData_().filter(t => t.bodega === filtro);
    },

    // Devuelve todos las ubicaciones de excedentes por ubicacion
    getPorUbicacion: function(ubicacion) {
      const filtro = toStrUpper_(ubicacion || "");
      return getData_().filter(t => t.ubicacion === filtro);
    },

    //  Devuelve todos las bodegas involucradas
    getBodegas: function() {
      return getField_("bodega");
    },

    //  Devuelve todos las bodegas con salida involucradas
    getUbicaciones: function() {
      return getField_("ubicacion");
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] Ubicaciones de excedentes limpias");
    }

  };

})();

function debugUbicacionesExcedentesRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================

  const BODEGA_PRUEBA = "Bodega 1";
  const UBICACION_PRUEBA = "B1-19";
 
  // ===============================
  //  getAll
  // ===============================

  const all = UbicacionesExcedentesRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 3));

  // ===============================
  //  getPorBodega
  // ===============================

  const porbodega = UbicacionesExcedentesRepository.getPorBodega(BODEGA_PRUEBA);
  console.log(`[getPorBodega(${BODEGA_PRUEBA})] total:`, porbodega.length);
  console.log("[getPorBodega] muestra:", JSON.stringify(porbodega.slice(0, 5), null, 3));

  // ===============================
  //  getPorUbicacion
  // ===============================

  const porubicacion = UbicacionesExcedentesRepository.getPorUbicacion(UBICACION_PRUEBA);
  console.log(`[getPorUbicacion(${UBICACION_PRUEBA})] total:`, porubicacion.length);
  console.log("[getPorUbicacion] muestra:", JSON.stringify(porubicacion.slice(0, 5), null, 3));

  // ===============================
  //  getBodegas
  // ===============================

  const bodegas = UbicacionesExcedentesRepository.getBodegas();
  console.log("[getBodegas] total:", bodegas.length);
  console.log("[getBodegas] muestra:", JSON.stringify(bodegas.slice(0, 5), null, 3));

  // ===============================
  //  getUbicaciones
  // ===============================

  const ubicaciones = UbicacionesExcedentesRepository.getUbicaciones();
  console.log("[getUbicaciones] total:", ubicaciones.length);
  console.log("[getUbicaciones] muestra:", JSON.stringify(ubicaciones.slice(0, 5), null, 3));

}