/**
 * CatalogoRepository.gs
 * Lectura de hoja CATALOGO
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

