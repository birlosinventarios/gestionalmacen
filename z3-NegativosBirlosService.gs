/**
 * NegativosBirlosService.gs
 * Service específico para la vista NegativosBirlos.html
 */

const NegativosBirlosService = (() => {

  // =========================================================
  // HELPERS SEGUROS
  // =========================================================
  function _toSafeStr_(value) {
    return toStr_(value || "");
  }

  function _toSafeUpper_(value) {
    return toStrUpper_(value || "");
  }

  function _toSafeNum_(value) {
    return toNum_(value || 0);
  }

  // =========================================================
  // FUENTE ACTUAL: EXISTENCIAS
  // =========================================================
  function getNegativos_() {
    return ExistenciasRepository.getNegativosBirlos();
  }

  /**
   * Devuelve una sola ubicación válida por código.
   * - Ignora códigos vacíos.
   * - Ignora ubicaciones vacías.
   * - Conserva la primera ubicación válida encontrada por SKU.
   */
  function getUbicacionesSurtidoSanitizadas_() {
    const mapa = {};

    UbicacionesSurtidoRepository.getAll().forEach(item => {
      const codigo = _toSafeUpper_(item.codigo);
      const ubicacion = _toSafeUpper_(item.ubicacion);

      if (!codigo) return;
      if (!ubicacion) return;

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
      .sort((a, b) => a.codigo.localeCompare(b.codigo, "es", {
        sensitivity: "base",
        numeric: true
      }));
  }

  // =========================================================
  // CLASIFICACIÓN DE BODEGAS PARA BALANCE POR ID ÚNICO
  // =========================================================
  function _esCasaBlanca_(bodega) {
    const b = _toSafeUpper_(bodega);

    return (
      b === "CASA BLANCA 1" ||
      b === "CASA BLANCA 2" ||
      b.startsWith("CB1") ||
      b.startsWith("CB2")
    );
  }

  function _esBodegaExcedente_(bodega) {
    const b = _toSafeUpper_(bodega);

    return (
      b === "BODEGA 1" ||
      b === "BODEGA 2" ||
      b === "BODEGA 3" ||
      b === "BODEGA MOSTRADOR" ||
      b === "CUARTO ALTO RIESGO" ||
      b === "MOSTRADOR" ||
      b.startsWith("B1") ||
      b.startsWith("B2") ||
      b.startsWith("B3") ||
      b.startsWith("BM") ||
      b.startsWith("CU") ||
      b.startsWith("MO")
    );
  }

  // =========================================================
  // BALANCE NUEVO: ID ÚNICO / ESTADO ACTUAL
  // =========================================================
  function _construirBalanceIdUnicoPorCodigo_() {
    const mapa = {};

    if (
      typeof EstadoActualExcedentesService === "undefined" ||
      !EstadoActualExcedentesService ||
      typeof EstadoActualExcedentesService.getAuditables !== "function"
    ) {
      console.warn("[NegativosBirlosService] EstadoActualExcedentesService no disponible.");
      return mapa;
    }

    const auditables = EstadoActualExcedentesService.getAuditables({
      tipoAuditoria: "GLOBAL",
      bodegaObjetivo: "TODAS"
    });

    (auditables || []).forEach(item => {
      const codigo = _toSafeUpper_(item.codigo);
      const idUnico = _toSafeStr_(item.idUnico);
      const bodegaActual = _toSafeUpper_(item.bodegaActual);
      const saldoActual = _toSafeNum_(item.saldoActual);

      if (!codigo) return;
      if (!idUnico) return;
      if (saldoActual <= 0) return;

      const detalleIdUnico = {
        idUnico: idUnico,
        bodega: bodegaActual,
        ubicacion: _toSafeUpper_(item.ubicacionActual),
        sku: codigo,
        cantidadIdUnico: saldoActual
      };


      if (!mapa[codigo]) {
        mapa[codigo] = {
          codigo: codigo,

          excedentebodegaIdUnico: 0,
          excedentecasablancaIdUnico: 0,
          excedenteTotalIdUnico: 0,

          idsUnicosExcedenteBodega: [],
          idsUnicosExcedenteCasaBlanca: [],

          detalleIdUnicoExcedentes: [],
          detalleIdUnicoBodega: [],
          detalleIdUnicoCasaBlanca: []
        };
      }

      if (_esCasaBlanca_(bodegaActual)) {
        mapa[codigo].excedentecasablancaIdUnico += saldoActual;
        mapa[codigo].idsUnicosExcedenteCasaBlanca.push(idUnico);

        mapa[codigo].detalleIdUnicoCasaBlanca.push(detalleIdUnico);
        mapa[codigo].detalleIdUnicoExcedentes.push(detalleIdUnico);

      } else if (_esBodegaExcedente_(bodegaActual)) {
        mapa[codigo].excedentebodegaIdUnico += saldoActual;
        mapa[codigo].idsUnicosExcedenteBodega.push(idUnico);

        mapa[codigo].detalleIdUnicoBodega.push(detalleIdUnico);
        mapa[codigo].detalleIdUnicoExcedentes.push(detalleIdUnico);
      }

      mapa[codigo].excedenteTotalIdUnico =
        mapa[codigo].excedentebodegaIdUnico +
        mapa[codigo].excedentecasablancaIdUnico;
    });

    return mapa;
  }

  // =========================================================
  // ENRIQUECER NEGATIVOS CON AMBOS BALANCES
  // =========================================================
  function _enriquecerNegativosConBalances_(negativos) {
    const balanceIdUnicoPorCodigo = _construirBalanceIdUnicoPorCodigo_();

    return (negativos || []).map(item => {
      const codigo = _toSafeUpper_(item.codigo);
      const balanceIdUnico = balanceIdUnicoPorCodigo[codigo] || null;

      const excedentebodega = _toSafeNum_(item.excedentebodega);
      const excedentecasablanca = _toSafeNum_(item.excedentecasablanca);
      const excedenteTotalExistencias = excedentebodega + excedentecasablanca;

      const excedentebodegaIdUnico = balanceIdUnico
        ? _toSafeNum_(balanceIdUnico.excedentebodegaIdUnico)
        : 0;

      const excedentecasablancaIdUnico = balanceIdUnico
        ? _toSafeNum_(balanceIdUnico.excedentecasablancaIdUnico)
        : 0;

      const excedenteTotalIdUnico =
        excedentebodegaIdUnico + excedentecasablancaIdUnico;

      return {
        ...item,

        // Identificación base
        idproducto: item.idproducto,
        codigo: codigo,
        descripcion: _toSafeUpper_(item.descripcion),

        // Negativo en piso/Birlos.
        // Este se conserva desde EXISTENCIAS.
        almacenbirlos: _toSafeNum_(item.almacenbirlos),

        // =====================================================
        // MODO 1: BALANCE DESDE EXISTENCIAS
        // =====================================================
        excedentebodega: excedentebodega,
        excedentecasablanca: excedentecasablanca,
        excedenteTotalExistencias: excedenteTotalExistencias,

        // =====================================================
        // MODO 2: BALANCE DESDE ID ÚNICO
        // =====================================================
        excedentebodegaIdUnico: excedentebodegaIdUnico,
        excedentecasablancaIdUnico: excedentecasablancaIdUnico,
        excedenteTotalIdUnico: excedenteTotalIdUnico,

        idsUnicosExcedenteBodega: balanceIdUnico
          ? [...(balanceIdUnico.idsUnicosExcedenteBodega || [])]
          : [],

        idsUnicosExcedenteCasaBlanca: balanceIdUnico
          ? [...(balanceIdUnico.idsUnicosExcedenteCasaBlanca || [])]
          : [],

        detalleIdUnicoExcedentes: balanceIdUnico
          ? [...(balanceIdUnico.detalleIdUnicoExcedentes || [])]
          : [],

        detalleIdUnicoBodega: balanceIdUnico
          ? [...(balanceIdUnico.detalleIdUnicoBodega || [])]
          : [],

        detalleIdUnicoCasaBlanca: balanceIdUnico
          ? [...(balanceIdUnico.detalleIdUnicoCasaBlanca || [])]
          : [],

        // Diagnóstico para UI/debug
        modoBalanceDisponibleIdUnico: !!balanceIdUnico
      };
    });
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================
  return {

    /**
     * Mantiene compatibilidad con la vista actual:
     * regresa { negativos, ubicacionesSurtido }
     *
     * Ahora cada negativo incluye:
     * - Balance por EXISTENCIAS.
     * - Balance por ID ÚNICO.
     */
    getVista: function() {
      try {
        const negativosBase = getNegativos_();
        const negativos = _enriquecerNegativosConBalances_(negativosBase);
        const ubicacionesSurtido = getUbicacionesSurtidoSanitizadas_();

        return {
          negativos: negativos || [],
          ubicacionesSurtido: ubicacionesSurtido || [],
          meta: {
            modoBalanceDefault: "EXISTENCIAS",
            modosBalanceDisponibles: ["EXISTENCIAS", "IDUNICO"],
            build: "NEGATIVOS-BIRLOS-BALANCE-DUAL-2026-07-03"
          }
        };

      } catch (error) {
        console.error("❌ Error NegativosBirlosService.getVista :: message", error && error.message);
        console.error("❌ Error NegativosBirlosService.getVista :: stack", error && error.stack);
        console.error("❌ Error NegativosBirlosService.getVista :: raw", error);

        return {
          negativos: [],
          ubicacionesSurtido: [],
          meta: {
            modoBalanceDefault: "EXISTENCIAS",
            modosBalanceDisponibles: ["EXISTENCIAS", "IDUNICO"],
            error: error && error.message ? error.message : String(error)
          }
        };
      }
    }

  };

})();