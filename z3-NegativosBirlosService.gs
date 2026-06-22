/**
 * NegativosBirlosService.gs
 * Service específico para la vista NegativosBirlos.html
 */

const NegativosBirlosService = (() => {

  function getNegativos_() {
    return ExistenciasRepository.getNegativosBirlos();
  }

  /**
   * Devuelve una sola ubicación válida por código.
   * - Ignora códigos vacíos
   * - Ignora ubicaciones vacías
   * - Conserva la primera ubicación válida encontrada por SKU
   */
  function getUbicacionesSurtidoSanitizadas_() {
    const mapa = {};

    UbicacionesSurtidoRepository.getAll().forEach(item => {
      const codigo = toStrUpper_(item.codigo);
      const ubicacion = toStrUpper_(item.ubicacion);

      // Validaciones duras
      if (!codigo) return;
      if (!ubicacion) return;

      // Si ya existe una ubicación válida para ese código, no la sobrescribimos
      if (!mapa[codigo]) {
        mapa[codigo] = {
          codigo: codigo,
          ubicacion: ubicacion,
          idproducto: item.idproducto || "",
          bodega: item.bodega || "",
          pasillo: item.pasillo || "",
          anaquel: item.anaquel || "",
          repisa: item.repisa || ""
        };
      }
    });

    return Object.values(mapa)
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  return {

    /**
     * Mantiene compatibilidad con la vista actual:
     * regresa { negativos, ubicacionesSurtido }
     * pero ya con ubicaciones saneadas.
     */
    getVista: function() {
      try {
        const negativos = getNegativos_();
        const ubicacionesSurtido = getUbicacionesSurtidoSanitizadas_();

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
