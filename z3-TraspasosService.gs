
/**
 * Lógica sobre ubicaciones de excedentes
 */

const TraspasosService = (() => {

  return {

    /**
     * Traspasos pendientes de mover saldo en CONTPAQi
     */
    getPendientes: function() {
      return TraspasosRepository.getAll()
        .filter(x => !x.folio || x.folio === "");
    },


    /**
     * Traspasos con tipo de movimiento ACOMODO
     */
    
    getAcomodos: function() {
      return TraspasosRepository.getPorTipoMovimiento("ACOMODO");
    },

    /**
     * Traspasos con tipo de movimiento SURTIDO
     */
    
    getSurtidos: function() {
      return TraspasosRepository.getPorTipoMovimiento("SURTIDO");
    },


    /**
     * Traspasos por fecha dinámico
     */
    getTraspasosPorFecha: function(fecha) {
      return TraspasosRepository.getAll()
        .filter(x => sameDate_(x.fechatraspaso, fecha));
    },


    /**
     * Traspasos por tipo de movimiento
     */
    getTraspasosPorTipoMovimiento: function(tipomovimiento) {
      const texto = toStrUpper_(tipomovimiento);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.tipomovimiento).includes(texto)
        );
    },

    /**
     * Traspasos por serie dinámico
     */
    getTraspasosPorSerie: function(serie) {
      const texto = toStrUpper_(serie);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.serie).startsWith(texto)
        );
    },

    /**
     * Traspasos por bodega salida
     */
    getTraspasosPorBodegaSalida: function(bodegasalida) {
      const texto = toStrUpper_(bodegasalida);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.bodegasalida).includes(texto)
        );
    },
    /**
     * Traspasos por ubicacion salida
     */
    getTraspasosPorUbicacionSalida: function(ubicacionsalida) {
      const texto = toStrUpper_(ubicacionsalida);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.ubicacionsalida).includes(texto)
        );
    },

    /**
     * Traspasos por bodega entrada
     */
    getTraspasosPorBodegaEntrada: function(bodegaentrada) {
      const texto = toStrUpper_(bodegaentrada);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.bodegaentrada).includes(texto)
        );
    },

    /**
     * Traspasos por ubicacion salida
     */
    getTraspasosPorUbicacionEntrada: function(ubicacionentrada) {
      const texto = toStrUpper_(ubicacionentrada);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.ubicacionentrada).includes(texto)
        );
    },

    /**
     * Traspasos por Solicitante
     */
    getTraspasosPorSolicitante: function(solicitante) {
      const texto = toStrUpper_(solicitante);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.solicitante).includes(texto)
        );
    },

    /**
     * Traspasos por codigo
     */
    getTraspasosPorCodigo: function(codigo) {
      const texto = toStrUpper_(codigo);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.codigo).includes(texto)
        );
    },

    /**
     * Traspasos por descripcion
     */
    getTraspasosPorDescripcion: function(descripcion) {
      const texto = toStrUpper_(descripcion);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.descripcion).includes(texto)
        );
    },

    /**
     * Traspasos por folio
     */
    getTraspasosPorFolio: function(folio) {
      const texto = toStrUpper_(folio);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.folio).includes(texto)
        );
    },
    
    /**
     * Traspasos por responsable
     */
    getTraspasosPorResponsable: function(responsable) {
      const texto = toStrUpper_(responsable);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.responsable).includes(texto)
        );
    },

    /**
     * Traspasos por idunico
     */
    getTraspasosPorIdUnico: function(idunico) {
      const texto = toStrUpper_(idunico);

      return TraspasosRepository.getAll()
        .filter(x =>
          toStrUpper_(x.idunico).includes(texto)
        );
    },

  };

})();


function debugTraspasosService() {

const fecha = "14/05/2026";
const tipomovimiento = "Acomodo";
const serie = "BM-25";
const bodegasalida = "Bodega 2";
const ubicacionsalida = "B2-25";
const bodegaentrada = "Bodega mostrador";
const ubicacionentrada = "BM-21";
const solicitante = "SIGIFREDO DE LA CRUZ";
const codigo = "PLH-1/4X5";
const descripcion = "PIJA PARA LAMINA CABEZA HEX. 1/4X5";
const folio = "1111";
const responsable = "acosta";
const idunico = "2026051416054731671";


    debugServiceCall_(
      "getAcomodos",
      null,
      () => TraspasosService.getAcomodos(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getSurtidos",
      null,
      () => TraspasosService.getSurtidos(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getPendientes",
      null,
      () => TraspasosService.getPendientes(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorFecha",
      { fecha: fecha },
      () => TraspasosService.getTraspasosPorFecha(fecha),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorTipoMovimiento",
      { tipomovimiento: tipomovimiento },
      () => TraspasosService.getTraspasosPorTipoMovimiento(tipomovimiento),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorSerie",
      { serie: serie },
      () => TraspasosService.getTraspasosPorSerie(serie),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorBodegaSalida",
      { bodegasalida: bodegasalida },
      () => TraspasosService.getTraspasosPorBodegaSalida(bodegasalida),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorUbicacionSalida",
      { ubicacionsalida: ubicacionsalida },
      () => TraspasosService.getTraspasosPorUbicacionSalida(ubicacionsalida),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorBodegaEntrada",
      { bodegaentrada: bodegaentrada },
      () => TraspasosService.getTraspasosPorBodegaEntrada(bodegaentrada),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorUbicacionEntrada",
      { ubicacionentrada: ubicacionentrada },
      () => TraspasosService.getTraspasosPorUbicacionEntrada(ubicacionentrada),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorSolicitante",
      { solicitante: solicitante },
      () => TraspasosService.getTraspasosPorSolicitante(solicitante),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorCodigo",
      { codigo: codigo },
      () => TraspasosService.getTraspasosPorCodigo(codigo),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorDescripcion",
      { descripcion: descripcion },
      () => TraspasosService.getTraspasosPorDescripcion(descripcion),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorFolio",
      { folio: folio },
      () => TraspasosService.getTraspasosPorFolio(folio),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorResponsable",
      { responsable: responsable },
      () => TraspasosService.getTraspasosPorResponsable(responsable),
      { limit: 3 }
    );

    debugServiceCall_(
      "getTraspasosPorIdUnico",
      { idunico: idunico },
      () => TraspasosService.getTraspasosPorIdUnico(idunico),
      { limit: 3 }
    );


}