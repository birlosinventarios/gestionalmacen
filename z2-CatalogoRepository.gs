/**
 * UsuariosRepository.gs
 * Lectura de hoja USUARIOS
 */

const CatalogoRepository = (() => {

  function readSource_() {
    return getRowsByKey_("CATALOGO");
  }

  function normalize_(fila) {
    return {
      idproducto: toStr_(fila[COL.CATALOGO.IDPRODUCTO]),
      codigo: toStrUpper_(fila[COL.CATALOGO.CODIGO]),
      descripcion: toStrUpper_(fila[COL.CATALOGO.DESCRIPCION]),
      status: toStrUpper_(fila[COL.CATALOGO.STATUS])
    };
  }

  function getField_(field) {
    return getData_().map(x => x[field]);
  }

  // Lectura de todo el origen de datos una sola ve
let cache_ = null;

function getData_() {
  if (cache_ === null) {
    cache_ = readSource_()
      .map(normalize_)
      .filter(x => x.codigo);

    console.log("[CACHE] Catalogo cargado");
  }

  return cache_;
}

  return {

    //  Todos los registros
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },

    //  Devuelve todos los codigos 
    getCodigos: function() {
      return getField_("codigo");
    },

    //  Devuelve todas las descripciones
    getDescripciones: function() {
      return getField_("descripcion");
    },

    //  Devuelve todos los idproductos
    getIdProductos: function() {
      return getField_("idproducto");
    }, 

    //  Devuelve todos los status
    getStatus: function() {
      return getField_("status");
    },        

    //  Devuelve toda la informacion por Codigo
    getPorCodigo: function(codigo) {
      const filtro = toStrUpper_(codigo);
      return getData_().filter(t => t.codigo === filtro);
    },

    //  Devuelve toda la informacion por IdProductos
    getPorIdProducto: function(idproducto) {
      const filtro = toStr_(idproducto);
      return getData_().filter(t => t.idproducto === filtro);
    },

    //  Devuelve un codigo, usar para busqueda por descripcion
    getPorDescripcion: function(descripcion) {
      const filtro = toStrUpper_(descripcion);
      return getData_().filter(t => t.descripcion === filtro);
    },

    //  Devuelve toda la informacion por status
    getPorStatus: function(status) {
      const filtro = toStr_(status);
      return getData_().filter(t => t.status === filtro);
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] Catalogo limpio");
    }
    };



})();


function debugCatalogoRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================

  const CODIGO_PRUEBA = "PLP-10X3";     
  const DESCRIPCION_PRUEBA = "PIJA PARA LAMINA PHILLIPS CABEZA PLANA 10 X 3";
  const IDPRODUCTO_PRUEBA = "13112"; 
  const STATUS_PRUEBA = "ACTIVO"; 

  // ===============================
  //  getAll
  // ===============================

  const all = CatalogoRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 3));

  // ===============================
  //  getCodigos
  // ===============================

  const codigos = CatalogoRepository.getCodigos();
  console.log("[getCodigos] total:", codigos.length);
  console.log("[getCodigos] muestra:", JSON.stringify(codigos.slice(0, 5), null, 3));

  // ===============================
  //  getDescripciones
  // ===============================

  const descripciones = CatalogoRepository.getDescripciones();
  console.log("[getDescripciones] total:", descripciones.length);
  console.log("[getDescripciones] muestra:", JSON.stringify(descripciones.slice(0, 5), null, 3));

  // ===============================
  //  getIdProductos
  // ===============================

  const idProductos = CatalogoRepository.getIdProductos();
  console.log("[getIdProductos] total:", idProductos.length);
  console.log("[getIdProductos] muestra:", JSON.stringify(idProductos.slice(0, 5), null, 3));

  // ===============================
  //  getPorCodigo
  // ===============================

  const porCodigo = CatalogoRepository.getPorCodigo(CODIGO_PRUEBA);
  console.log(`[getPorCodigo(${CODIGO_PRUEBA})] total:`, porCodigo.length);
  console.log("[getPorCodigo] muestra:", JSON.stringify(porCodigo.slice(0, 5), null, 3));

  // ===============================
  //  getPorIdProducto
  // ===============================

  const porIdProducto = CatalogoRepository.getPorIdProducto(IDPRODUCTO_PRUEBA);
  console.log(`[getPorIdProducto(${IDPRODUCTO_PRUEBA})] total:`, porIdProducto.length);
  console.log("[getPorIdProducto] muestra:", JSON.stringify(porIdProducto.slice(0, 5), null, 3));

  // ===============================
  //  getPorDescripcion
  // ===============================

  const porDescripcion = CatalogoRepository.getPorDescripcion(DESCRIPCION_PRUEBA);
  console.log(`[getPorDescripcion(${DESCRIPCION_PRUEBA})] total:`, porDescripcion.length);
  console.log("[getPorDescripcion] muestra:", JSON.stringify(porDescripcion.slice(0, 5), null, 3));

  // ===============================
  //  getPorStatus
  // ===============================

  const porStatus = CatalogoRepository.getPorStatus(STATUS_PRUEBA);
  console.log(`[getPorStatus(${IDPRODUCTO_PRUEBA})] total:`, porStatus.length);
  console.log("[getPorStatus] muestra:", JSON.stringify(porStatus.slice(0, 5), null, 3));
}

