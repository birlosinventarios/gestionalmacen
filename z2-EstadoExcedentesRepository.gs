/**
 * EstadoExcedentesRepository.gs
 * ------------------------------------------------------------
 * Estado consolidado y vigente de excedentes por ID único.
 *
 * FUENTES:
 * - ExcedentesRepository   -> base por ID único / saldo / status
 * - TraspasosRepository    -> último movimiento para inferir ubicación actual
 *
 * OBJETIVO:
 * Proveer una capa reutilizable para:
 * - GestorExcedentesService
 * - AuditoriaExcedentesService
 *
 * MÉTODOS PÚBLICOS:
 * - getAll()
 * - getVigentes()
 * - getPorIdUnico(idUnico)
 * - getPorBodega(bodega)
 * - getPorBodegaYUbicacion(bodega, ubicacion)
 * - getEsperadosGlobal()
 * - getEsperadosByBodega(bodega)
 * - getEsperadosByBodegaYUbicacion(bodega, ubicacion)
 * - countEsperadosAuditoria(tipoAuditoria, bodegaObjetivo)
 * - clearCache()
 * ------------------------------------------------------------
 */

const EstadoExcedentesRepository = (() => {

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

  let cache_ = null;

  // =========================================================
  // HELPERS PRIVADOS
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
    const fecha = row && row.fechaexcedente instanceof Date
      ? row.fechaexcedente.getTime()
      : 0;

    let horaMs = 0;
    if (row && row.horaexcedente instanceof Date) {
      horaMs =
        row.horaexcedente.getHours() * 3600000 +
        row.horaexcedente.getMinutes() * 60000 +
        row.horaexcedente.getSeconds() * 1000;
    }

    return fecha + horaMs;
  }

  function _timestampFromMovimiento_(mov) {
    const fecha = mov && mov.fechatraspaso instanceof Date
      ? mov.fechatraspaso.getTime()
      : 0;

    let horaMs = 0;
    if (mov && mov.horatraspaso instanceof Date) {
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

    if (!_esVigente_(saldoBase)) {
      return saldoBase;
    }

    if (tipoUltimo === "ACOMODO" || tipoUltimo === "CAMBIO DE BODEGA") {
      return Math.abs(cantidadMovimiento || saldoBase);
    }

    if (tipoUltimo === "SURTIDO") {
      return saldoBase;
    }

    return saldoBase;
  }

  function _resolverUbicacionActual_(base, ultimoMov) {
    const saldoBase = _toSafeNum_(base.esaldo);
    const statusBase = _toSafeUpper_(base.estatusRegistro);

    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");
    const ultimaUbicacionEntrada = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionEntrada : "");
    const ultimaUbicacionSalida = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionSalida : "");
    const ultimaSerie = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaSerie : "");

    if (!_esVigente_(saldoBase)) {
      return "";
    }

    if (tipoUltimo === "ACOMODO" || tipoUltimo === "CAMBIO DE BODEGA") {
      if (_esUbicacionFisica_(ultimaUbicacionEntrada)) {
        return ultimaUbicacionEntrada;
      }
      if (_esUbicacionFisica_(ultimaSerie)) {
        return ultimaSerie;
      }
    }

    if (tipoUltimo === "SURTIDO") {
      if (_esUbicacionFisica_(ultimaUbicacionSalida)) {
        return ultimaUbicacionSalida;
      }
      if (_esUbicacionFisica_(ultimaSerie)) {
        return ultimaSerie;
      }
    }

    if (_esUbicacionFisica_(statusBase)) {
      return statusBase;
    }

    return "";
  }

  function _indexarExcedentesPorIdUnico_() {
    const rows = ExcedentesRepository.getAll()
      .filter(item => _toSafeStr_(item.idunico));

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

  function _indexarUltimoMovimientoPorIdUnico_() {
    if (typeof TraspasosRepository === "undefined" || !TraspasosRepository || typeof TraspasosRepository.getAll !== "function") {
      return {};
    }

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

  function _buildData_() {
    const mapaExcedentes = _indexarExcedentesPorIdUnico_();
    const mapaMovimientos = _indexarUltimoMovimientoPorIdUnico_();

    return Object.keys(mapaExcedentes)
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
          idunico: base.eidUnico,
          codigo: base.ecodigo,
          descripcion: base.edescripcion,
          saldo: saldo,
          serie: serieActual,
          bodegaactual: bodegaActual,
          ubicacionactual: serieActual,
          idproducto: base.idproducto,
          estatusregistro: base.estatusRegistro,
          vigente: vigente,
          pendienteubicacion: pendienteUbicacion,
          conubicacion: conUbicacion,
          ultimomovimientotipo: ultimoMov ? ultimoMov.ultimoTipo : "",
          ultimaserie: ultimoMov ? ultimoMov.ultimaSerie : "",
          ultimaubicacionentrada: ultimoMov ? ultimoMov.ultimaUbicacionEntrada : "",
          ultimaubicacionsalida: ultimoMov ? ultimoMov.ultimaUbicacionSalida : "",
          ultimabodegaentrada: ultimoMov ? ultimoMov.ultimaBodegaEntrada : "",
          ultimabodegasalida: ultimoMov ? ultimoMov.ultimaBodegaSalida : "",
          ultimafechamovimiento: ultimoMov ? ultimoMov.ultimaFecha : "",
          ultimahoramovimiento: ultimoMov ? ultimoMov.ultimaHora : ""
        };
      })
      .sort((a, b) => {
        const ubicA = _toSafeUpper_(a.ubicacionactual) || "ZZZZZZ";
        const ubicB = _toSafeUpper_(b.ubicacionactual) || "ZZZZZZ";

        const cmpUbicacion = ubicA.localeCompare(
          ubicB,
          "es",
          { sensitivity: "base", numeric: true }
        );

        if (cmpUbicacion !== 0) {
          return cmpUbicacion;
        }

        return _toSafeUpper_(a.codigo).localeCompare(
          _toSafeUpper_(b.codigo),
          "es",
          { sensitivity: "base", numeric: true }
        );
      });
  }

  function getData_() {
    if (cache_ === null) {
      cache_ = _buildData_();
      console.log("[CACHE] EstadoExcedentes cargado");
    }
    return cache_;
  }

  function _getEsperadosBase_() {
    return getData_().filter(item => item.vigente && item.conubicacion);
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================
  return {

    getAll: function() {
      return [...getData_()];
    },

    getVigentes: function() {
      return getData_().filter(item => item.vigente);
    },

    getPorIdUnico: function(idUnico) {
      const filtro = _toSafeUpper_(idUnico);
      return getData_().find(item => item.idunico === filtro) || null;
    },

    getPorBodega: function(bodega) {
      const filtro = _toSafeUpper_(bodega);
      return getData_().filter(item => item.bodegaactual === filtro);
    },

    getPorBodegaYUbicacion: function(bodega, ubicacion) {
      const b = _toSafeUpper_(bodega);
      const u = _toSafeUpper_(ubicacion);
      return getData_().filter(item => item.bodegaactual === b && item.ubicacionactual === u);
    },

    getEsperadosGlobal: function() {
      return _getEsperadosBase_();
    },

    getEsperadosByBodega: function(bodega) {
      const b = _toSafeUpper_(bodega);
      return _getEsperadosBase_().filter(item => item.bodegaactual === b);
    },

    getEsperadosByBodegaYUbicacion: function(bodega, ubicacion) {
      const b = _toSafeUpper_(bodega);
      const u = _toSafeUpper_(ubicacion);
      return _getEsperadosBase_().filter(item => item.bodegaactual === b && item.ubicacionactual === u);
    },

    countEsperadosAuditoria: function(tipoAuditoria, bodegaObjetivo) {
      const tipo = _toSafeUpper_(tipoAuditoria);
      const bodega = _toSafeUpper_(bodegaObjetivo);

      if (tipo === "GLOBAL") {
        return _getEsperadosBase_().length;
      }

      if (tipo === "POR_BODEGA") {
        return _getEsperadosBase_().filter(item => item.bodegaactual === bodega).length;
      }

      return 0;
    },

    getResumen: function() {
      const data = getData_();
      const vigentes = data.filter(x => x.vigente);
      const conUbicacion = vigentes.filter(x => x.conubicacion);
      const pendientes = vigentes.filter(x => x.pendienteubicacion);

      return {
        totalIdsRegistrados: data.length,
        idsUnicosVigentes: vigentes.length,
        idsUnicosConUbicacion: conUbicacion.length,
        idsUnicosPendientes: pendientes.length,
        stockTotalVigente: vigentes.reduce((acc, x) => acc + Number(x.saldo || 0), 0)
      };
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] EstadoExcedentes limpio");
    }
  };

})();

function debugEstadoExcedentesRepository() {
  const CODIGO_BODEGA = "BODEGA 1";
  const UBICACION = "B1-19";
  const IDUNICO = "202605141622201581";
  const LIMITE = 5;

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getAll",
    {},
    () => EstadoExcedentesRepository.getAll(),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getVigentes",
    {},
    () => EstadoExcedentesRepository.getVigentes(),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getPorIdUnico",
    { idunico: IDUNICO },
    () => EstadoExcedentesRepository.getPorIdUnico(IDUNICO),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getPorBodega",
    { bodega: CODIGO_BODEGA },
    () => EstadoExcedentesRepository.getPorBodega(CODIGO_BODEGA),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getPorBodegaYUbicacion",
    { bodega: CODIGO_BODEGA, ubicacion: UBICACION },
    () => EstadoExcedentesRepository.getPorBodegaYUbicacion(CODIGO_BODEGA, UBICACION),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getEsperadosGlobal",
    {},
    () => EstadoExcedentesRepository.getEsperadosGlobal(),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getEsperadosByBodega",
    { bodega: CODIGO_BODEGA },
    () => EstadoExcedentesRepository.getEsperadosByBodega(CODIGO_BODEGA),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getEsperadosByBodegaYUbicacion",
    { bodega: CODIGO_BODEGA, ubicacion: UBICACION },
    () => EstadoExcedentesRepository.getEsperadosByBodegaYUbicacion(CODIGO_BODEGA, UBICACION),
    { limit: LIMITE }
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.countEsperadosAuditoria",
    { tipoAuditoria: "GLOBAL", bodegaObjetivo: "TODAS" },
    () => EstadoExcedentesRepository.countEsperadosAuditoria("GLOBAL", "TODAS")
  );

  debugRepositoryCall_(
    "EstadoExcedentesRepository.getResumen",
    {},
    () => EstadoExcedentesRepository.getResumen(),
    { limit: LIMITE }
  );
}
