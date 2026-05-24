
/**
 * Lógica sobre catalogo
 */

const CatalogoService = (() => {

  return {

    /**
     * Registros por codigo dinámico
     */
    getRegistrosPorCodigo: function(codigo) {
      const texto = toStrUpper_(codigo);

      return CatalogoRepository.getAll()
        .filter(x =>
          (x.codigo).startsWith(texto)
        );
    },

    /**
     * Registros por descripcion dinámica
     */
    getRegistrosPorDescripcion: function(descripcion) {
      const texto = toStrUpper_(descripcion);

      return CatalogoRepository.getAll()
        .filter(x =>
          (x.descripcion).includes(texto)
        );
    },

    /**
     * Registros por idproducto dinámico
     */
    getRegistrosPorIdProducto: function(idproducto) {
      const texto = toStrUpper_(idproducto);

      return CatalogoRepository.getAll()
        .filter(x =>
          (x.idproducto).startsWith(texto)
        );
    },

  };

})();



function debugCatalogoService() {

const codigo= "ECO-";
const descripcion = "ANTICONGELANTE";
const idproducto= "1024";


    debugServiceCall_(
      "getRegistrosPorCodigo",
      { codigo: codigo },
      () => CatalogoService.getRegistrosPorCodigo(codigo),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorDescripcion",
      { descripcion: descripcion },
      () => CatalogoService.getRegistrosPorDescripcion(descripcion),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorIdProducto",
      { idproducto: idproducto },
      () => CatalogoService.getRegistrosPorIdProducto(idproducto),
      { limit: 3 }
    );

}