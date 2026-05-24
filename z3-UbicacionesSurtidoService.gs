
/**
 * Lógica sobre ubicaciones de surtido
 */

const UbicacionesSurtidoService = (() => {

  return {

    /**
     * Registros por codigo dinámico
     */
    getRegistrosPorCodigo: function(codigo) {
      const texto = toStrUpper_(codigo);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          (x.codigo).includes(texto)
        );
    },

    /**
     * Registros por bodega dinámica
     */
    getRegistrosPorBodega: function(bodega) {
      const texto = toStrUpper_(bodega);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          (x.bodega).includes(texto)
        );
    },

    /**
     * Registros por pasillo dinámico
     */
    getRegistrosPorPasillo: function(pasillo) {
      const texto = toStrUpper_(pasillo);

      return UbicacionesSurtidoRepository.getAll()
              .filter(x =>
                (x.pasillo).includes(texto)
              );
          },

    /**
     * Registros por anaquel dinámico
     */
    getRegistrosPorAnaquel: function(anaquel) {
      const texto = toStrUpper_(anaquel);

      return UbicacionesSurtidoRepository.getAll()
              .filter(x =>
                (x.anaquel).includes(texto)
              );
          },
          
    /**
     * Registros por repisa dinámico
     */
    getRegistrosPorRepisa: function(repisa) {
      const texto = toStrUpper_(repisa);

      return UbicacionesSurtidoRepository.getAll()
              .filter(x =>
                (x.repisa).includes(texto)
              );
          },

    /**
     * Registros por repisa dinámico
     */
    getRegistrosPorIdProducto: function(idproducto) {
      const texto = toStrUpper_(idproducto);

      return UbicacionesSurtidoRepository.getAll()
              .filter(x =>
                (x.idproducto).startsWith(texto)
              );
          },

    /**
     * Registros por ubicacion dinámico
     */
    getRegistrosPorUbicacion: function(ubicacion) {
      const texto = toStrUpper_(ubicacion);

      return UbicacionesSurtidoRepository.getAll()
              .filter(x =>
                (x.ubicacion).includes(texto)
              );
          },
  };

})();


function debugUbicacionSurtidoService() {

const codigo = "t5s-1";
const bodega = "1";
const pasillo = "1";
const anaquel = "1";
const repisa = "1";
const idproducto = "1";
const ubicacion = "b1";

    debugServiceCall_(
      "getRegistrosPorCodigo",
      { codigo: codigo },
      () => UbicacionesSurtidoService.getRegistrosPorCodigo(codigo),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorBodega",
      { bodega: bodega },
      () => UbicacionesSurtidoService.getRegistrosPorBodega(bodega),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorPasillo",
      { pasillo: pasillo },
      () => UbicacionesSurtidoService.getRegistrosPorPasillo(pasillo),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorAnaquel",
      { anaquel: anaquel },
      () => UbicacionesSurtidoService.getRegistrosPorAnaquel(anaquel),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorRepisa",
      { repisa: repisa },
      () => UbicacionesSurtidoService.getRegistrosPorRepisa(repisa),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorIdProducto",
      { idproducto: idproducto },
      () => UbicacionesSurtidoService.getRegistrosPorIdProducto(idproducto),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorUbicacion",
      { ubicacion: ubicacion },
      () => UbicacionesSurtidoService.getRegistrosPorUbicacion(ubicacion),
      { limit: 3 }
    );


}