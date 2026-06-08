/**
 * Lógica sobre ubicaciones de surtido
 * Service orientado a búsqueda dinámica/flexible
 */

const UbicacionesSurtidoService = (() => {

  return {

    /**
     * Registros por código dinámico
     */
    getRegistrosPorCodigo: function(codigo) {
      const texto = toStrUpper_(codigo);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          toStrUpper_(x.codigo).includes(texto)
        );
    },

    /**
     * Registros por bodega dinámica
     * (bodega viene numérica desde el repository, aquí se convierte a texto para búsqueda flexible)
     */
    getRegistrosPorBodega: function(bodega) {
      const texto = toStr_(bodega);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          toStr_(x.bodega).includes(texto)
        );
    },

    /**
     * Registros por pasillo dinámico
     */
    getRegistrosPorPasillo: function(pasillo) {
      const texto = toStr_(pasillo);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          toStr_(x.pasillo).includes(texto)
        );
    },

    /**
     * Registros por anaquel dinámico
     */
    getRegistrosPorAnaquel: function(anaquel) {
      const texto = toStr_(anaquel);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          toStr_(x.anaquel).includes(texto)
        );
    },

    /**
     * Registros por repisa dinámico
     */
    getRegistrosPorRepisa: function(repisa) {
      const texto = toStr_(repisa);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          toStr_(x.repisa).includes(texto)
        );
    },

    /**
     * Registros por ID producto dinámico
     * Se mantiene startsWith para búsqueda incremental sobre el ID
     */
    getRegistrosPorIdProducto: function(idproducto) {
      const texto = toStr_(idproducto);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          toStr_(x.idproducto).startsWith(texto)
        );
    },

    /**
     * Registros por ubicación dinámica
     */
    getRegistrosPorUbicacion: function(ubicacion) {
      const texto = toStrUpper_(ubicacion);

      return UbicacionesSurtidoRepository.getAll()
        .filter(x =>
          toStrUpper_(x.ubicacion).includes(texto)
        );
    }

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
