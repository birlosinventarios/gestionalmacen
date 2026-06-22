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



function debugExistenciasRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================
  const CODIGO_PRUEBA = "T5S-1/4X31/2";
  const DESCRIPCION_PRUEBA = "TORNILLO GRADO 5 ESTANDAR DE 1/4 X 3 1/2";
  const IDPRODUCTO_PRUEBA = 158;
  const LIMITE = 5;

  // ===============================
  //  getAll
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getAll",
    {},
    () => ExistenciasRepository.getAll(),
    { limit: LIMITE }
  );

  // ===============================
  //  getPorIdProducto
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getPorIdProducto",
    { idproducto: IDPRODUCTO_PRUEBA },
    () => ExistenciasRepository.getPorIdProducto(IDPRODUCTO_PRUEBA),
    { limit: LIMITE }
  );

  // ===============================
  //  getPorCodigo
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getPorCodigo",
    { codigo: CODIGO_PRUEBA },
    () => ExistenciasRepository.getPorCodigo(CODIGO_PRUEBA),
    { limit: LIMITE }
  );

  // ===============================
  //  getPorDescripcion
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getPorDescripcion",
    { descripcion: DESCRIPCION_PRUEBA },
    () => ExistenciasRepository.getPorDescripcion(DESCRIPCION_PRUEBA),
    { limit: LIMITE }
  );

  // ===============================
  //  getExistenciasBirlos
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getExistenciasBirlos",
    {},
    () => ExistenciasRepository.getExistenciasBirlos(),
    { limit: LIMITE }
  );

  // ===============================
  //  getExcedentesBodega
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getExcedentesBodega",
    {},
    () => ExistenciasRepository.getExcedentesBodega(),
    { limit: LIMITE }
  );

  // ===============================
  //  getExcedentesCasaBlanca
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getExcedentesCasaBlanca",
    {},
    () => ExistenciasRepository.getExcedentesCasaBlanca(),
    { limit: LIMITE }
  );

  // ===============================
  //  getNegativosBirlos
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getNegativosBirlos",
    {},
    () => ExistenciasRepository.getNegativosBirlos(),
    { limit: LIMITE }
  );

  // ===============================
  //  getNegativosBodega
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getNegativosBodega",
    {},
    () => ExistenciasRepository.getNegativosBodega(),
    { limit: LIMITE }
  );

  // ===============================
  //  getNegativosCasaBlanca
  // ===============================
  debugRepositoryCall_(
    "ExistenciasRepository.getNegativosCasaBlanca",
    {},
    () => ExistenciasRepository.getNegativosCasaBlanca(),
    { limit: LIMITE }
  );
}

function debugMethodsExistenciasRepository() {
  return debugRepositoryMethods_("ExistenciasRepository", ExistenciasRepository);
}