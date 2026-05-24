
/**
 * Lógica sobre excedentes
 */

const ExcedentesService = (() => {

  return {

    /**
     * Registros con status DISPONIBLE
     */
    
    getRegistrosDisponibles: function() {
      return ExcedentesRepository.getPorStatus("DISPONIBLE");
    },

    /**
     * Registros con status ACOMODADO
     */
    
    getRegistrosAcomodados: function() {
      return ExcedentesRepository.getPorStatus("ACOMODADO");
    },

    /**
     * Registros con status SURTIDO
     */
    
    getRegistrosSurtidos: function() {
      return ExcedentesRepository.getPorStatus("SURTIDO");
    },

    /**
     * Registros disponibles por Codigo dinamica
     */
    
    getRegistrosDisponiblesPorCodigo: function(codigo) {
      const texto = toStrUpper_(codigo);

      return this.getRegistrosDisponibles()
        .filter(x =>
          (x.codigo).includes(texto)
        );
    },

    /**
     * Registros disponibles por descripcion dinamica
     */    
    getRegistrosDisponiblesPorDescripcion: function(descripcion) {
      const texto = toStrUpper_(descripcion);

      return this.getRegistrosDisponibles()
        .filter(x =>
          (x.descripcion).includes(texto)
        );
    },

    /**
     * Registros disponibles por idunico dinamico
     */    
    getRegistrosDisponiblesPorIdunico: function(idunico) {
      const texto = toStrUpper_(idunico);

      return this.getRegistrosDisponibles()
        .filter(x =>
          (x.idunico).includes(texto)
        );
    },

    /**
     * Validadores de status
     */ 
    estaDisponible: function(idunico) {
      return this.getRegistrosDisponibles()
        .some(x => x.idunico === idunico);
    },

    estaAcomodado: function(idunico) {
      return this.getRegistrosAcomodados()
        .some(x => x.idunico === idunico);
    },

    estaSurtido: function(idunico) {
      return this.getRegistrosSurtidos()
        .some(x => x.idunico === idunico);
    }
  };
})();


function debugExcedentesService() {

const codigo = "T5S-";
const descripcion = "TORNILLO";
const idunico = "202605151020";
const idunicocompleto = "202605151020003571";


    debugServiceCall_(
      "getRegistrosDisponibles",
      null,
      () => ExcedentesService.getRegistrosDisponibles(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosAcomodados",
      null,
      () => ExcedentesService.getRegistrosAcomodados(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosSurtidos",
      null,
      () => ExcedentesService.getRegistrosSurtidos(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosDisponiblesPorCodigo",
      { codigo: codigo },
      () => ExcedentesService.getRegistrosDisponiblesPorCodigo(codigo),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosDisponiblesPorDescripcion",
      { descripcion: descripcion },
      () => ExcedentesService.getRegistrosDisponiblesPorDescripcion(descripcion),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosDisponiblesPorIdunico",
      { idunico: idunico },
      () => ExcedentesService.getRegistrosDisponiblesPorIdunico(idunico),
      { limit: 3 }
    );

    debugServiceCall_(
      "estaDisponible",
      { idunicocompleto: idunicocompleto },
      () => ExcedentesService.estaDisponible(idunicocompleto)
    );

    debugServiceCall_(
      "estaAcomodado",
      { idunicocompleto: idunicocompleto },
      () => ExcedentesService.estaAcomodado(idunicocompleto)
    );

    debugServiceCall_(
      "estaSurtido",
      { idunicocompleto: idunicocompleto },
      () => ExcedentesService.estaSurtido(idunicocompleto)
    );

}
