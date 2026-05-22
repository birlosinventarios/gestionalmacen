
/**
 * Lógica sobre excedentes
 */

const ExcedentesService = (() => {

  /**
   * Helper privado:
   * Obtiene los folios (idunico) únicos por status.
   */
  function obtenerFoliosPorStatus_(status) {
    return [...new Set(
      ExcedentesRepository.getPorStatus(status)
        .map(x => x.idunico)
        .filter(Boolean)
    )].sort((a, b) => String(a).localeCompare(String(b)));
  }

  return {

    /**
     * Folios con status DISPONIBLE
     */
    obtenerFoliosDisponibles: function() {
      return obtenerFoliosPorStatus_("DISPONIBLE");
    },

    /**
     * Folios con status ACOMODADO
     */
    obtenerFoliosAcomodados: function() {
      return obtenerFoliosPorStatus_("ACOMODADO");
    },

    /**
     * Folios usados.
     * Ajusta aquí si tu valor real de status es SURTIDO, USADO, etc.
     */
    obtenerFoliosUsados: function() {
      return obtenerFoliosPorStatus_("SURTIDO");
    },

    /**
     * Devuelve el registro completo de un folio
     */
    obtenerRegistroPorFolio: function(idunico) {
      return ExcedentesRepository.getPorIdUnico(idunico);
    },

    /**
     * Devuelve true si el folio existe y está disponible
     */
    estaDisponible: function(idunico) {
      return ExcedentesRepository.getPorIdUnico(idunico)
        .some(x => x.status === "DISPONIBLE");
    },

    /**
     * Devuelve true si el folio existe y está acomodado
     */
    estaAcomodado: function(idunico) {
      return ExcedentesRepository.getPorIdUnico(idunico)
        .some(x => x.status === "ACOMODADO");
    },

    /**
     * Devuelve true si el folio ya fue usado / surtido
     */
    estaUsado: function(idunico) {
      return ExcedentesRepository.getPorIdUnico(idunico)
        .some(x => x.status === "SURTIDO");
    },

    /**
     * Conteo por status
     */
    contarFoliosPorStatus: function(status) {
      return obtenerFoliosPorStatus_(status).length;
    }

  };




function debugExcedentesService() {

  const IDUNICO_PRUEBA = "202605141622201581";

  debugServiceCall_(
    "obtenerFoliosDisponibles",
    null,
    () => ExcedentesService.obtenerFoliosDisponibles(),
    { limit: 10 }
  );

  debugServiceCall_(
    "obtenerFoliosAcomodados",
    null,
    () => ExcedentesService.obtenerFoliosAcomodados(),
    { limit: 10 }
  );

  debugServiceCall_(
    "obtenerFoliosUsados",
    null,
    () => ExcedentesService.obtenerFoliosUsados(),
    { limit: 10 }
  );

  debugServiceCall_(
    "obtenerRegistroPorFolio",
    { idunico: IDUNICO_PRUEBA },
    () => ExcedentesService.obtenerRegistroPorFolio(IDUNICO_PRUEBA)
  );

  debugServiceCall_(
    "estaDisponible",
    { idunico: IDUNICO_PRUEBA },
    () => ExcedentesService.estaDisponible(IDUNICO_PRUEBA)
  );

  debugServiceCall_(
    "estaAcomodado",
    { idunico: IDUNICO_PRUEBA },
    () => ExcedentesService.estaAcomodado(IDUNICO_PRUEBA)
  );

  debugServiceCall_(
    "estaUsado",
    { idunico: IDUNICO_PRUEBA },
    () => ExcedentesService.estaUsado(IDUNICO_PRUEBA)
  );
}






})();
