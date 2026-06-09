/**
 * GestorExcedentesService.gs
 * Servicio de dominio para la vista GestorExcedentes
 */

const GestorExcedentesService = (() => {

  function _toSafeStr_(value) {
    return toStr_(value || "");
  }

  function _toSafeUpper_(value) {
    return toStrUpper_(value || "");
  }

  function _toSafeNum_(value) {
    return toNum_(value || 0);
  }

  function _tipoUpper_(value) {
    return _toSafeUpper_(value);
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

  function _obtenerNombreBodegaPorSerie_(serie, fallback = "ALMACÉN CENTRAL") {
    const s = _toSafeUpper_(serie);

    if (s.startsWith("B1")) return "Bodega 1";
    if (s.startsWith("B2")) return "Bodega 2";
    if (s.startsWith("B3")) return "Bodega 3";
    if (s.startsWith("BM")) return "Bodega Mostrador";
    if (s.startsWith("CB1")) return "Casa Blanca 1";
    if (s.startsWith("CB2")) return "Casa Blanca 2";

    return _toSafeStr_(fallback) || "ALMACÉN CENTRAL";
  }

  /**
   * Convierte un movimiento del repository a una forma uniforme
   * que luego consolidaremos.
   */
  function _mapMovimiento_(mov) {
    const tipo = _tipoUpper_(mov.tipomovimiento);
    const cantidad = _toSafeNum_(mov.cantidad);

    return {
      eidUnico: _toSafeStr_(mov.idunico),
      ecodigo: _toSafeUpper_(mov.codigo),
      edescripcion: _toSafeUpper_(mov.descripcion),
      ecantidad: cantidad,
      etipo: tipo,
      eserie: _toSafeUpper_(mov.serie),
      ebodegaEntrada: _toSafeStr_(mov.bodegaentrada),
      ebodegaSalida: _toSafeStr_(mov.bodegasalida),
      etimestamp: _timestampFromMovimiento_(mov)
    };
  }

  /**
   * Consolida saldo por ID único.
   * Mantiene los datos del movimiento más reciente para serie / bodega actual.
   */
  function _consolidarExcedentes_(movimientos) {
    const movimientosValidos = movimientos
      .map(_mapMovimiento_)
      .filter(m => m.eidUnico && m.ecodigo);

    // Ordenamos cronológicamente para que al reducir el último movimiento
    // quede como referencia visual actual
    movimientosValidos.sort((a, b) => a.etimestamp - b.etimestamp);

    const mapa = movimientosValidos.reduce((acc, mov) => {
      const id = mov.eidUnico;

      if (!acc[id]) {
        acc[id] = {
          eidUnico: mov.eidUnico,
          ecodigo: mov.ecodigo,
          edescripcion: mov.edescripcion,
          eserie: mov.eserie,
          ebodegaActual: _obtenerNombreBodegaPorSerie_(mov.eserie),
          esaldo: 0,
          ecantidad: 0,
          _ultimoTimestamp: mov.etimestamp
        };
      }

      // Saldo neto acumulado
      acc[id].esaldo += Number(mov.ecantidad || 0);

      // Guardamos la última cantidad de movimiento solo por trazabilidad visual
      acc[id].ecantidad = Number(mov.ecantidad || 0);

      // Si este movimiento es más reciente, actualizamos referencia visual
      if (mov.etimestamp >= acc[id]._ultimoTimestamp) {
        acc[id]._ultimoTimestamp = mov.etimestamp;
        acc[id].ecodigo = mov.ecodigo;
        acc[id].edescripcion = mov.edescripcion;
        acc[id].eserie = mov.eserie;
        acc[id].ebodegaActual = _obtenerNombreBodegaPorSerie_(
          mov.eserie,
          mov.ecantidad >= 0 ? mov.ebodegaEntrada : mov.ebodegaSalida
        );
      }

      return acc;
    }, {});

    return Object.values(mapa)
      .filter(item => Number(item.esaldo) > 0)
      .map(item => ({
        eidUnico: item.eidUnico,
        ecodigo: item.ecodigo,
        edescripcion: item.edescripcion,
        ecantidad: item.ecantidad,
        esaldo: item.esaldo,
        eserie: item.eserie,
        ebodegaActual: item.ebodegaActual
      }));
  }

  /**
   * Método principal para la vista
   * Regresa el array consolidado exactamente en el shape que la vista consume.
   */
  function obtenerExcedentesConsolidados() {
    const movimientos = TraspasosRepository.getAll()
      .filter(m => _toSafeStr_(m.idunico));

    return _consolidarExcedentes_(movimientos);
  }

  /**
   * Resumen opcional por si luego quieres usarlo en métricas backend.
   */
  function getResumen() {
    const data = obtenerExcedentesConsolidados();

    return {
      totalIds: data.length,
      stockTotal: data.reduce((acc, item) => acc + (Number(item.esaldo) || 0), 0),
      bodegasDetectadas: [...new Set(data.map(x => _obtenerNombreBodegaPorSerie_(x.eserie, x.ebodegaActual)))]
    };
  }

  return {
    obtenerExcedentesConsolidados,
    getResumen
  };

})();
