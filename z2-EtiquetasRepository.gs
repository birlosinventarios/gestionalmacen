/**
 * EtiquetasRepository.gs
 * Lectura de hoja ETIQUETAS
 */

const EtiquetasRepository = (() => {

  function readSource_() {
    return getRowsByKey_("ETIQUETAS");
  }

  function normalize_(fila) {
    return {
      nombre: toStrUpper_(fila[COL.ETIQUETAS.NOMBRE] || ""),
      ancho: toNum_(fila[COL.ETIQUETAS.ANCHO] || ""),
      alto: toNum_(fila[COL.ETIQUETAS.ALTO] || "")
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
        .filter(x => x.nombre);
      console.log("[CACHE] Etiquetas cargadas");
    }

    return cache_;
  }

  return {

    // Devuelve todas las etiquetas 
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

     /**
     * Registros por nombre dinámico
     */
    getPorNombre: function(nombre) {
      const texto = toStrUpper_(nombre);

      return EtiquetasRepository.getAll()
        .filter(x =>
          (x.nombre).includes(texto)
        );
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] Etiquetas limpias");
    }

  };

})();

