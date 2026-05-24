
/**
 * Lógica sobre ubicaciones de excedentes
 */

const UbicacionesExcedentesService = (() => {

  return {

    /**
     * Registros por bodega dinámico
     */
    getRegistrosPorBodega: function(bodega) {
      const texto = toStrUpper_(bodega);

      return UbicacionesExcedentesRepository.getAll()
        .filter(x =>
          (x.bodega).includes(texto)
        );
    },

    /**
     * Registros por ubicacion dinámica
     */
    getRegistrosPorUbicacion: function(ubicacion) {
      const texto = toStrUpper_(ubicacion);

      return UbicacionesExcedentesRepository.getAll()
        .filter(x =>
          (x.ubicacion).includes(texto)
        );
    },

    /**
     * Registros por idubicacionesexcedentes dinámico
     */
    getRegistrosPorIdUbicacionExcedentes: function(idubicacionesexcedentes) {
      const texto = toStrUpper_(idubicacionesexcedentes);

      return UbicacionesExcedentesRepository.getAll()
        .filter(x =>
          (x.idubicacionesexcedentes).startsWith(texto)
        );
    },

  };

})();



function debugUbicacionExcedentesService() {

const bodega = "MOSTRADOR";
const ubicacion = "BM-1";
const idubicacionesexcedentes = "11";


    debugServiceCall_(
      "getRegistrosPorBodega",
      { bodega: bodega },
      () => UbicacionesExcedentesService.getRegistrosPorBodega(bodega),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorUbicacion",
      { ubicacion: ubicacion },
      () => UbicacionesExcedentesService.getRegistrosPorUbicacion(ubicacion),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorIdUbicacionExcedentes",
      { idubicacionesexcedentes: idubicacionesexcedentes },
      () => UbicacionesExcedentesService.getRegistrosPorIdUbicacionExcedentes(idubicacionesexcedentes),
      { limit: 3 }
    );

}