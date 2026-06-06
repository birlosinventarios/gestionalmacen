
/**
 * NegativosBirlosService.gs
 * Service específico para la vista NegativosBirlos.html
 */

const NegativosBirlosService = (() => {

  function getNegativos_() {
    return ExistenciasRepository.getNegativosBirlos();
  }

  function getUbicacionesSurtido_() {
    return UbicacionesSurtidoRepository.getAll();
  }

  return {

    /**
     * Devuelve la estructura mínima que hoy consume NegativosBirlos.html
     * Mantiene compatibilidad con la vista actual.
     */
    getVista: function() {
      try {
        const negativos = getNegativos_();
        const ubicacionesSurtido = getUbicacionesSurtido_();

        return {
          negativos: negativos || [],
          ubicacionesSurtido: ubicacionesSurtido || []
        };

      } catch (error) {
        console.error("❌ Error NegativosBirlosService.getVista:", error);
        return {
          negativos: [],
          ubicacionesSurtido: []
        };
      }
    }

  };

})();
