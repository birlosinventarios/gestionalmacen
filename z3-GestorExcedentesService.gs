/**
 * GestorExcedentesService.gs
 * Servicio de dominio para la vista GestorExcedentes
 *
 * FUENTE DE VERDAD ACTUAL:
 * - BD-EXCEDENTES --> balance vigente, idUnico, status/ubicación actual
 * - TRASPASOS     --> trazabilidad opcional del último movimiento
 *
 * REGLAS DE NEGOCIO:
 * - Un ID único está vigente si su cantidad > 0
 * - Un ID único está pendiente si sigue vigente y su status = DISPONIBLE (o vacío)
 * - Un ID único tiene ubicación si sigue vigente y su status ya no es DISPONIBLE
 */

const GestorExcedentesService = (() => {

  const DOMAIN = Object.freeze({
    STATUS_PENDIENTES: Object.freeze([
      "",
      "DISPONIBLE",
      "PENDIENTE",
      "SIN UBICACION",
      "SIN UBICACIÓN"
    ]),
    BODEGA_FALLBACK: "Pendiente de ubicación"
  });

  // =========================================================
  // HELPERS GENERALES
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

  function _timestampFromExcedente_(row) {
    const fecha = row.fechaexcedente instanceof Date
      ? row.fechaexcedente.getTime()
      : 0;

    let horaMs = 0;
    if (row.horaexcedente instanceof Date) {
      horaMs =
        row.horaexcedente.getHours() * 3600000 +
        row.horaexcedente.getMinutes() * 60000 +
        row.horaexcedente.getSeconds() * 1000;
    }

    return fecha + horaMs;
  }

  function _timestampFromMovimiento_(mov) {
    const fecha = mov.fechatraspaso instanceof Date
      ? mov.fechatraspaso.getTime()
      : 0;

    let horaMs = 0;
    if (mov.horatraspaso instanceof Date) {
      horaMs =
        mov.horatraspaso.getHours() * 3600000 +
        mov.horatraspaso.getMinutes() * 60000 +
        mov.horatraspaso.getSeconds() * 1000;
    }

    return fecha + horaMs;
  }

  function _obtenerNombreBodegaPorSerie_(serie, fallback = DOMAIN.BODEGA_FALLBACK) {
    const s = _toSafeUpper_(serie);

    if (!s) return fallback;

    if (s.startsWith("B1")) return "Bodega 1";
    if (s.startsWith("B2")) return "Bodega 2";
    if (s.startsWith("B3")) return "Bodega 3";
    if (s.startsWith("BM")) return "Bodega Mostrador";
    if (s.startsWith("CB1")) return "Casa Blanca 1";
    if (s.startsWith("CB2")) return "Casa Blanca 2";

    return _toSafeStr_(fallback) || DOMAIN.BODEGA_FALLBACK;
  }

  function _esStatusPendiente_(status) {
    const s = _toSafeUpper_(status);
    return DOMAIN.STATUS_PENDIENTES.includes(s);
  }

  function _esVigente_(saldo) {
    return Number(saldo || 0) > 0;
  }

  function _tieneUbicacionRegistrada_(status, saldo) {
    if (!_esVigente_(saldo)) return false;
    return !_esStatusPendiente_(status);
  }

  function _esUbicacionFisica_(valor) {
    const v = _toSafeUpper_(valor);

    return (
      v.startsWith("B1") ||
      v.startsWith("B2") ||
      v.startsWith("B3") ||
      v.startsWith("BM") ||
      v.startsWith("CB1") ||
      v.startsWith("CB2") ||
      v.startsWith("CU") ||
      v.startsWith("MO")
    );
  }

  function _resolverSaldoActual_(base, ultimoMov) {
    const saldoBase = _toSafeNum_(base.esaldo);
    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");
    const cantidadMovimiento = _toSafeNum_(ultimoMov ? ultimoMov.cantidadMovimiento : 0);

    // Si el excedente ya no está vigente en BD-EXCEDENTES, no lo revivimos con TRASPASOS
    if (!_esVigente_(saldoBase)) {
      return saldoBase;
    }

    // Si el último movimiento fue acomodo o cambio de bodega,
    // la cantidad de ese movimiento representa el saldo operativo visible de ese ID
    if (
      tipoUltimo === "ACOMODO" ||
      tipoUltimo === "CAMBIO DE BODEGA"
    ) {
      return Math.abs(cantidadMovimiento || saldoBase);
    }

    // Si el último movimiento fue surtido, dejamos el saldo que ya resuelva BD-EXCEDENTES
    // para no revivir IDs ya cerrados o consumidos
    if (tipoUltimo === "SURTIDO") {
      return saldoBase;
    }

    // Fallback
    return saldoBase;
  }

  function _resolverUbicacionActual_(base, ultimoMov) {
    const saldoBase = _toSafeNum_(base.esaldo);
    const statusBase = _toSafeUpper_(base.estatusRegistro);

    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");
    const ultimaUbicacionEntrada = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionEntrada : "");
    const ultimaUbicacionSalida = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionSalida : "");
    const ultimaSerie = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaSerie : "");

    // Si el ID ya no está vigente, no le mostramos ubicación operativa
    if (!_esVigente_(saldoBase)) {
      return "";
    }

    // Si el último movimiento fue acomodo o cambio de bodega,
    // la ubicación actual debe salir de la ENTRADA
    if (
      tipoUltimo === "ACOMODO" ||
      tipoUltimo === "CAMBIO DE BODEGA"
    ) {
      if (_esUbicacionFisica_(ultimaUbicacionEntrada)) {
        return ultimaUbicacionEntrada;
      }

      if (_esUbicacionFisica_(ultimaSerie)) {
        return ultimaSerie;
      }
    }

    // Si el último movimiento fue surtido y el ID siguiera vigente
    // (caso raro), usamos salida como referencia secundaria
    if (tipoUltimo === "SURTIDO") {
      if (_esUbicacionFisica_(ultimaUbicacionSalida)) {
        return ultimaUbicacionSalida;
      }

      if (_esUbicacionFisica_(ultimaSerie)) {
        return ultimaSerie;
      }
    }

    // Fallback al valor guardado en BD-EXCEDENTES si ahí vive una ubicación física real
    if (_esUbicacionFisica_(statusBase)) {
      return statusBase;
    }

    return "";
  }


  // =========================================================
  // INDEXACIÓN DE BD-EXCEDENTES
  // =========================================================
  function _indexarExcedentesPorIdUnico_() {
    const rows = ExcedentesRepository.getAll()
      .filter(item => _toSafeStr_(item.idunico));

    /**
     * Si por alguna razón hay más de una fila con el mismo ID único,
     * tomamos la más reciente por fecha/hora.
     */
    const mapa = rows.reduce((acc, row) => {
      const id = _toSafeStr_(row.idunico);
      const ts = _timestampFromExcedente_(row);

      if (!acc[id] || ts >= acc[id]._timestamp) {
        acc[id] = {
          eidUnico: id,
          ecodigo: _toSafeUpper_(row.codigo),
          edescripcion: _toSafeUpper_(row.descripcion),
          esaldo: _toSafeNum_(row.cantidad),
          estatusRegistro: _toSafeUpper_(row.status),
          idproducto: _toSafeStr_(row.idproducto),
          _timestamp: ts
        };
      }

      return acc;
    }, {});

    return mapa;
  }

  // =========================================================
  // INDEXACIÓN DE ÚLTIMO MOVIMIENTO (TRAZABILIDAD OPCIONAL)
  // =========================================================
  function _indexarUltimoMovimientoPorIdUnico_() {
    const movimientos = TraspasosRepository.getAll()
      .filter(m => _toSafeStr_(m.idunico));

    const mapa = movimientos.reduce((acc, mov) => {
      const id = _toSafeStr_(mov.idunico);
      const ts = _timestampFromMovimiento_(mov);

      if (!acc[id] || ts >= acc[id]._timestamp) {
        acc[id] = {
          idUnico: id,
          ultimoTipo: _toSafeUpper_(mov.tipomovimiento),
          ultimaSerie: _toSafeUpper_(mov.serie),
          ultimaUbicacionEntrada: _toSafeUpper_(mov.ubicacionentrada),
          ultimaUbicacionSalida: _toSafeUpper_(mov.ubicacionsalida),
          ultimaBodegaEntrada: _toSafeStr_(mov.bodegaentrada),
          ultimaBodegaSalida: _toSafeStr_(mov.bodegasalida),
          cantidadMovimiento: _toSafeNum_(mov.cantidad),
          ultimaFecha: formatDate_(mov.fechatraspaso),
          ultimaHora: formatTime_(mov.horatraspaso),
          _timestamp: ts
        };
      }

      return acc;
    }, {});

    return mapa;
  }

  // =========================================================
  // CONSTRUCCIÓN DE DATASET PRINCIPAL
  // =========================================================
  function _construirVista_() {
    const mapaExcedentes = _indexarExcedentesPorIdUnico_();
    const mapaMovimientos = _indexarUltimoMovimientoPorIdUnico_();

    const dataCompleta = Object.keys(mapaExcedentes)
      .map(id => {
        const base = mapaExcedentes[id];
        const ultimoMov = mapaMovimientos[id] || null;
        const saldo = _resolverSaldoActual_(base, ultimoMov);
        const serieActual = _resolverUbicacionActual_(base, ultimoMov);

        const vigente = _esVigente_(saldo);
        const conUbicacion = vigente && _esUbicacionFisica_(serieActual);
        const pendienteUbicacion = vigente && !conUbicacion;

        const bodegaActual = conUbicacion
          ? _obtenerNombreBodegaPorSerie_(serieActual, "Ubicación manual")
          : DOMAIN.BODEGA_FALLBACK;

        return {
          // shape principal consumible por tu HTML actual
          eidUnico: base.eidUnico,
          ecodigo: base.ecodigo,
          edescripcion: base.edescripcion,
          esaldo: saldo,
          eserie: serieActual,
          ebodegaActual: bodegaActual,

          // enriquecimiento backend
          idproducto: base.idproducto,
          estatusRegistro: base.estatusRegistro,
          vigente: vigente,
          pendienteUbicacion: pendienteUbicacion,
          conUbicacion: conUbicacion,

          // trazabilidad opcional del último movimiento
          ultimoMovimientoTipo: ultimoMov ? ultimoMov.ultimoTipo : "",
          ultimaSerieMovimiento: ultimoMov ? ultimoMov.ultimaSerie : "",
          ultimaUbicacionEntrada: ultimoMov ? ultimoMov.ultimaUbicacionEntrada : "",
          ultimaUbicacionSalida: ultimoMov ? ultimoMov.ultimaUbicacionSalida : "",
          ultimaBodegaEntrada: ultimoMov ? ultimoMov.ultimaBodegaEntrada : "",
          ultimaBodegaSalida: ultimoMov ? ultimoMov.ultimaBodegaSalida : "",
          ultimaFechaMovimiento: ultimoMov ? ultimoMov.ultimaFecha : "",
          ultimaHoraMovimiento: ultimoMov ? ultimoMov.ultimaHora : ""
        };
      })

      .sort((a, b) => {
        const ubicA = _toSafeUpper_(a.eserie) || "ZZZZZZ";
        const ubicB = _toSafeUpper_(b.eserie) || "ZZZZZZ";

        const cmpUbicacion = ubicA.localeCompare(
          ubicB,
          "es",
          { sensitivity: "base", numeric: true }
        );

        if (cmpUbicacion !== 0) {
          return cmpUbicacion;
        }

        return _toSafeUpper_(a.ecodigo).localeCompare(
          _toSafeUpper_(b.ecodigo),
          "es",
          { sensitivity: "base", numeric: true }
        );
      });


    const dataVigente = dataCompleta.filter(item => item.vigente);

    const idsUnicosConUbicacion = dataVigente.filter(item => item.conUbicacion).length;
    const idsUnicosPendientes = dataVigente.filter(item => item.pendienteUbicacion).length;
    const idsUnicosVigentes = dataVigente.length;

    const resumen = {
      totalIdsRegistrados: dataCompleta.length,
      idsUnicosVigentes: idsUnicosVigentes,
      idsUnicosPendientes: idsUnicosPendientes,
      idsUnicosConUbicacion: idsUnicosConUbicacion,
      stockTotalVigente: dataVigente.reduce((acc, item) => acc + (Number(item.esaldo) || 0), 0),

      // Alias por compatibilidad semántica si en tu UI todavía usas "folios"
      foliosVigentes: idsUnicosVigentes,
      foliosPendientes: idsUnicosPendientes,
      foliosConUbicacion: idsUnicosConUbicacion
    };

    return {
      data: dataVigente,       // para la tabla activa / operativa
      dataCompleta: dataCompleta,
      resumen: resumen
    };
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================

  /**
   * Nuevo contrato recomendado para la vista completa:
   * {
   *   data: [...solo vigentes...],
   *   dataCompleta: [...todos...],
   *   resumen: {...}
   * }
   */
  function obtenerVista() {
    return _construirVista_();
  }

  /**
   * Compatibilidad con tu HTML actual:
   * regresa solamente el array que la tabla ya consume.
   */
  function obtenerExcedentesConsolidados() {
    return _construirVista_().data;
  }

  /**
   * Resumen listo para tus nuevos métricos.
   */
  function getResumen() {
    return _construirVista_().resumen;
  }

  return {
    obtenerVista,
    obtenerExcedentesConsolidados,
    getResumen
  };

})();