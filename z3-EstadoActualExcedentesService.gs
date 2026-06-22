/**
 * EstadoActualExcedentesService.gs
 * ------------------------------------------------------------
 * Fuente oficial del estado actual consolidado de excedentes.
 *
 * OBJETIVO:
 * - Resolver el estado actual por IdUnico a partir de:
 *   - ExcedentesRepository (base)
 *   - TraspasosRepository (último movimiento)
 *
 * USOS FUTUROS:
 * - GestorExcedentesService
 * - AuditoriaExcedentesService
 * - Monitores / reportes / conciliación operativa
 *
 * NOTA:
 * Este service NO escribe nada en hojas.
 * Solo resuelve el estado consolidado actual.
 */

const EstadoActualExcedentesService = (() => {

  const DOMAIN = Object.freeze({
    STATUS_PENDIENTES: Object.freeze([
      "",
      "DISPONIBLE",
      "PENDIENTE",
      "SIN UBICACION",
      "SIN UBICACIÓN"
    ]),

    ESTATUS_LOGICOS: Object.freeze({
      CERRADO: "CERRADO",
      PENDIENTE_UBICACION: "PENDIENTE_UBICACION",
      UBICADO: "UBICADO",
      DESCONOCIDO: "DESCONOCIDO"
    }),

    BODEGA_FALLBACK: "PENDIENTE DE UBICACIÓN",

    TIPO_AUDITORIA: Object.freeze({
      GLOBAL: "GLOBAL",
      POR_BODEGA: "POR_BODEGA"
    }),

    VALOR_TODAS: "TODAS"
  });

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

  function _clone_(obj) {
    return JSON.parse(JSON.stringify(obj));
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

  function _esStatusPendiente_(status) {
    const s = _toSafeUpper_(status);
    return DOMAIN.STATUS_PENDIENTES.includes(s);
  }

  function _esVigente_(saldo) {
    return Number(saldo || 0) > 0;
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

  function _obtenerNombreBodegaPorSerie_(serie, fallback = DOMAIN.BODEGA_FALLBACK) {
    const s = _toSafeUpper_(serie);

    if (!s) return fallback;

    if (s.startsWith("B1")) return "BODEGA 1";
    if (s.startsWith("B2")) return "BODEGA 2";
    if (s.startsWith("B3")) return "BODEGA 3";
    if (s.startsWith("BM")) return "BODEGA MOSTRADOR";
    if (s.startsWith("CB1")) return "CASA BLANCA 1";
    if (s.startsWith("CB2")) return "CASA BLANCA 2";
    if (s.startsWith("CU")) return "CUARTO ALTO RIESGO";
    if (s.startsWith("MO")) return "MOSTRADOR";

    return _toSafeUpper_(fallback) || DOMAIN.BODEGA_FALLBACK;
  }

  // =========================================================
  // INDEXACIÓN BASE
  // =========================================================
  function _indexarExcedentesPorIdUnico_() {
    const rows = ExcedentesRepository.getAll()
      .filter(item => _toSafeStr_(item.idunico));

    /**
     * Si por alguna razón existe más de una fila por IdUnico,
     * tomamos la más reciente por fecha/hora.
     */
    return rows.reduce((acc, row) => {
      const id = _toSafeStr_(row.idunico);
      const ts = _timestampFromExcedente_(row);

      if (!acc[id] || ts >= acc[id]._timestamp) {
        acc[id] = {
          idUnico: id,
          codigo: _toSafeUpper_(row.codigo),
          descripcion: _toSafeUpper_(row.descripcion),
          saldoBase: _toSafeNum_(row.cantidad),
          estatusRegistro: _toSafeUpper_(row.status),
          idproducto: _toSafeStr_(row.idproducto),
          fechaBase: formatDate_(row.fechaexcedente),
          horaBase: formatTime_(row.horaexcedente),
          _timestamp: ts
        };
      }

      return acc;
    }, {});
  }

  function _indexarUltimoMovimientoPorIdUnico_() {
    const movimientos = TraspasosRepository.getAll()
      .filter(m => _toSafeStr_(m.idunico));

    return movimientos.reduce((acc, mov) => {
      const id = _toSafeStr_(mov.idunico);
      const ts = _timestampFromMovimiento_(mov);

      if (!acc[id] || ts >= acc[id]._timestamp) {
        acc[id] = {
          idUnico: id,
          ultimoTipo: _toSafeUpper_(mov.tipomovimiento),
          ultimaSerie: _toSafeUpper_(mov.serie),
          ultimaUbicacionEntrada: _toSafeUpper_(mov.ubicacionentrada),
          ultimaUbicacionSalida: _toSafeUpper_(mov.ubicacionsalida),
          ultimaBodegaEntrada: _toSafeUpper_(mov.bodegaentrada),
          ultimaBodegaSalida: _toSafeUpper_(mov.bodegasalida),
          cantidadMovimiento: _toSafeNum_(mov.cantidad),
          ultimaFecha: formatDate_(mov.fechatraspaso),
          ultimaHora: formatTime_(mov.horatraspaso),
          _timestamp: ts
        };
      }

      return acc;
    }, {});
  }

  // =========================================================
  // RESOLUCIÓN DE ESTADO ACTUAL
  // =========================================================
  function _resolverSaldoActual_(base, ultimoMov) {
    const saldoBase = _toSafeNum_(base.saldoBase);
    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");
    const cantidadMovimiento = _toSafeNum_(ultimoMov ? ultimoMov.cantidadMovimiento : 0);

    // Si ya no está vigente en BD-EXCEDENTES, no lo revivimos
    if (!_esVigente_(saldoBase)) {
      return saldoBase;
    }

    // Si el último movimiento fue acomodo o cambio de bodega,
    // el saldo operativo visible de ese ID suele venir del movimiento.
    if (
      tipoUltimo === "ACOMODO" ||
      tipoUltimo === "CAMBIO DE BODEGA"
    ) {
      return Math.abs(cantidadMovimiento || saldoBase);
    }

    // Si el último movimiento fue surtido, dejamos el saldo base resuelto
    if (tipoUltimo === "SURTIDO") {
      return saldoBase;
    }

    // Fallback
    return saldoBase;
  }

  function _resolverUbicacionActual_(base, ultimoMov) {
    const saldoBase = _toSafeNum_(base.saldoBase);
    const statusBase = _toSafeUpper_(base.estatusRegistro);

    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");
    const ultimaUbicacionEntrada = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionEntrada : "");
    const ultimaUbicacionSalida = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionSalida : "");
    const ultimaSerie = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaSerie : "");

    // Si el ID ya no está vigente, no tiene ubicación operativa auditable
    if (!_esVigente_(saldoBase)) {
      return "";
    }

    // Si último movimiento fue acomodo o cambio de bodega,
    // la ubicación actual lógica debe salir de la ENTRADA.
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

    // Si fue surtido y aún sigue vigente (remanente / caso especial)
    if (tipoUltimo === "SURTIDO") {
      if (_esUbicacionFisica_(ultimaUbicacionSalida)) {
        return ultimaUbicacionSalida;
      }

      if (_esUbicacionFisica_(ultimaSerie)) {
        return ultimaSerie;
      }
    }

    // Fallback al status de BD-EXCEDENTES si ahí vive una ubicación física real
    if (_esUbicacionFisica_(statusBase)) {
      return statusBase;
    }

    return "";
  }

  function _resolverBodegaActual_(ubicacionActual, ultimoMov, base) {
    const ubicacion = _toSafeUpper_(ubicacionActual);

    if (_esUbicacionFisica_(ubicacion)) {
      return _obtenerNombreBodegaPorSerie_(ubicacion, DOMAIN.BODEGA_FALLBACK);
    }

    // Si no se pudo inferir por ubicación, fallback opcional a última bodega de entrada/salida
    const ultimaBodegaEntrada = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaBodegaEntrada : "");
    const ultimaBodegaSalida = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaBodegaSalida : "");

    if (ultimaBodegaEntrada && ultimaBodegaEntrada !== "1 - ALMACEN BIRLOS") {
      return ultimaBodegaEntrada;
    }

    if (ultimaBodegaSalida && ultimaBodegaSalida !== "1 - ALMACEN BIRLOS") {
      return ultimaBodegaSalida;
    }

    // Sin ubicación física -> pendiente
    if (_esVigente_(base.saldoBase)) {
      return DOMAIN.BODEGA_FALLBACK;
    }

    return "";
  }

  function _resolverEstatusLogico_(saldoActual, ubicacionActual, estatusRegistro, ultimoMov) {
    const vigente = _esVigente_(saldoActual);
    const tieneUbicacionFisica = _esUbicacionFisica_(ubicacionActual);
    const statusBase = _toSafeUpper_(estatusRegistro);
    const ultimoTipo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");

    if (!vigente) {
      return DOMAIN.ESTATUS_LOGICOS.CERRADO;
    }

    if (tieneUbicacionFisica) {
      return DOMAIN.ESTATUS_LOGICOS.UBICADO;
    }

    if (_esStatusPendiente_(statusBase)) {
      return DOMAIN.ESTATUS_LOGICOS.PENDIENTE_UBICACION;
    }

    if (ultimoTipo === "SURTIDO" && vigente && !tieneUbicacionFisica) {
      return DOMAIN.ESTATUS_LOGICOS.PENDIENTE_UBICACION;
    }

    return DOMAIN.ESTATUS_LOGICOS.DESCONOCIDO;
  }

  // =========================================================
  // CONSTRUCCIÓN DEL DATASET CONSOLIDADO
  // =========================================================
  function _construirEstado_() {
    const mapaBase = _indexarExcedentesPorIdUnico_();
    const mapaMov = _indexarUltimoMovimientoPorIdUnico_();

    return Object.keys(mapaBase)
      .map(id => {
        const base = mapaBase[id];
        const ultimoMov = mapaMov[id] || null;

        const saldoActual = _resolverSaldoActual_(base, ultimoMov);
        const ubicacionActual = _resolverUbicacionActual_(base, ultimoMov);
        const bodegaActual = _resolverBodegaActual_(ubicacionActual, ultimoMov, base);
        const estatusLogico = _resolverEstatusLogico_(saldoActual, ubicacionActual, base.estatusRegistro, ultimoMov);

        const vigente = _esVigente_(saldoActual);
        const conUbicacion = vigente && _esUbicacionFisica_(ubicacionActual);
        const pendienteUbicacion = vigente && !conUbicacion;
        const auditable = vigente && conUbicacion;

        return {
          // Identificación base
          idUnico: base.idUnico,
          codigo: base.codigo,
          descripcion: base.descripcion,
          idproducto: base.idproducto,

          // Estado actual resuelto
          saldoActual: saldoActual,
          vigente: vigente,
          ubicacionActual: ubicacionActual,
          bodegaActual: bodegaActual,
          estatusLogico: estatusLogico,

          // Flags operativos
          conUbicacion: conUbicacion,
          pendienteUbicacion: pendienteUbicacion,
          auditable: auditable,

          // Base original
          saldoBase: base.saldoBase,
          estatusRegistro: base.estatusRegistro,
          fechaBase: base.fechaBase,
          horaBase: base.horaBase,

          // Trazabilidad del último movimiento
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
        const ubiA = _toSafeUpper_(a.ubicacionActual) || "ZZZZZZ";
        const ubiB = _toSafeUpper_(b.ubicacionActual) || "ZZZZZZ";

        const cmpUbi = ubiA.localeCompare(ubiB, "es", {
          sensitivity: "base",
          numeric: true
        });

        if (cmpUbi !== 0) return cmpUbi;

        return _toSafeUpper_(a.codigo).localeCompare(_toSafeUpper_(b.codigo), "es", {
          sensitivity: "base",
          numeric: true
        });
      });
  }

  // =========================================================
  // CACHE
  // =========================================================
  let cacheEstado_ = null;

  function _getEstado_() {
    if (cacheEstado_ === null) {
      cacheEstado_ = _construirEstado_();
      console.log("[CACHE] EstadoActualExcedentesService cargado", {
        total: cacheEstado_.length
      });
    }

    return cacheEstado_;
  }

  // =========================================================
  // NORMALIZADORES DE FILTRO
  // =========================================================
  function _normalizarConfigAuditoria_(config) {
    // Permite:
    // getAuditables("BODEGA 1")
    // getAuditables({ tipoAuditoria: "POR_BODEGA", bodegaObjetivo: "BODEGA 1" })
    // getAuditables()
    if (typeof config === "string") {
      const bodega = _toSafeUpper_(config);
      if (!bodega || bodega === DOMAIN.VALOR_TODAS) {
        return {
          tipoAuditoria: DOMAIN.TIPO_AUDITORIA.GLOBAL,
          bodegaObjetivo: DOMAIN.VALOR_TODAS
        };
      }

      return {
        tipoAuditoria: DOMAIN.TIPO_AUDITORIA.POR_BODEGA,
        bodegaObjetivo: bodega
      };
    }

    const tipoAuditoria = _toSafeUpper_(config && config.tipoAuditoria);
    const bodegaObjetivo = _toSafeUpper_(config && config.bodegaObjetivo);

    if (!tipoAuditoria && !bodegaObjetivo) {
      return {
        tipoAuditoria: DOMAIN.TIPO_AUDITORIA.GLOBAL,
        bodegaObjetivo: DOMAIN.VALOR_TODAS
      };
    }

    if (tipoAuditoria === DOMAIN.TIPO_AUDITORIA.GLOBAL || bodegaObjetivo === DOMAIN.VALOR_TODAS) {
      return {
        tipoAuditoria: DOMAIN.TIPO_AUDITORIA.GLOBAL,
        bodegaObjetivo: DOMAIN.VALOR_TODAS
      };
    }

    return {
      tipoAuditoria: DOMAIN.TIPO_AUDITORIA.POR_BODEGA,
      bodegaObjetivo: bodegaObjetivo || DOMAIN.VALOR_TODAS
    };
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================
  function getAll() {
    return _clone_(_getEstado_());
  }

  function getVigentes() {
    return _clone_(_getEstado_().filter(item => item.vigente));
  }

  function getAuditables(config) {
    const cfg = _normalizarConfigAuditoria_(config);

    let salida = _getEstado_().filter(item => item.auditable);

    if (
      cfg.tipoAuditoria === DOMAIN.TIPO_AUDITORIA.POR_BODEGA &&
      cfg.bodegaObjetivo &&
      cfg.bodegaObjetivo !== DOMAIN.VALOR_TODAS
    ) {
      salida = salida.filter(item => _toSafeUpper_(item.bodegaActual) === cfg.bodegaObjetivo);
    }

    return _clone_(salida);
  }

  function getPorIdUnico(idUnico) {
    const id = _toSafeStr_(idUnico);
    return _clone_(_getEstado_().filter(item => item.idUnico === id));
  }

  function getUnoPorIdUnico(idUnico) {
    return getPorIdUnico(idUnico)[0] || null;
  }

  function getPorUbicacion(ubicacion) {
    const ubi = _toSafeUpper_(ubicacion);
    return _clone_(_getEstado_().filter(item => _toSafeUpper_(item.ubicacionActual) === ubi));
  }

  function getPorBodega(bodega) {
    const bod = _toSafeUpper_(bodega);

    if (!bod || bod === DOMAIN.VALOR_TODAS) {
      return getAll();
    }

    return _clone_(_getEstado_().filter(item => _toSafeUpper_(item.bodegaActual) === bod));
  }

  function getResumen() {
    const all = _getEstado_();
    const vigentes = all.filter(item => item.vigente);
    const auditables = all.filter(item => item.auditable);
    const pendientesUbicacion = all.filter(item => item.pendienteUbicacion);
    const cerrados = all.filter(item => !item.vigente);

    const porBodega = auditables.reduce((acc, item) => {
      const bodega = _toSafeUpper_(item.bodegaActual) || DOMAIN.BODEGA_FALLBACK;

      if (!acc[bodega]) {
        acc[bodega] = {
          bodega: bodega,
          totalIdUnicos: 0,
          stockTotal: 0
        };
      }

      acc[bodega].totalIdUnicos += 1;
      acc[bodega].stockTotal += _toSafeNum_(item.saldoActual);

      return acc;
    }, {});

    return {
      totalIdUnicos: all.length,
      vigentes: vigentes.length,
      cerrados: cerrados.length,
      conUbicacion: all.filter(item => item.conUbicacion).length,
      pendientesUbicacion: pendientesUbicacion.length,
      auditables: auditables.length,
      stockTotalVigente: vigentes.reduce((acc, item) => acc + _toSafeNum_(item.saldoActual), 0),
      stockTotalAuditable: auditables.reduce((acc, item) => acc + _toSafeNum_(item.saldoActual), 0),
      bodegasAuditables: Object.keys(porBodega).sort(),
      porBodega: Object.keys(porBodega)
        .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base", numeric: true }))
        .map(k => porBodega[k])
    };
  }

  function clearCache() {
    cacheEstado_ = null;
    console.log("[CACHE] EstadoActualExcedentesService limpio");
  }

  return {
    getAll,
    getVigentes,
    getAuditables,
    getPorIdUnico,
    getUnoPorIdUnico,
    getPorUbicacion,
    getPorBodega,
    getResumen,
    clearCache
  };

})();


/**
 * Debuggers para EstadoActualExcedentesService
 * ------------------------------------------------------------
 * Requiere:
 * - debugServiceCall_()
 * - debugRepositoryMethods_() opcional
 */

function debugEstadoActualExcedentesService_getAll() {
  return debugServiceCall_(
    "EstadoActualExcedentesService.getAll",
    {},
    () => EstadoActualExcedentesService.getAll(),
    { limit: 20 }
  );
}

function debugEstadoActualExcedentesService_getVigentes() {
  return debugServiceCall_(
    "EstadoActualExcedentesService.getVigentes",
    {},
    () => EstadoActualExcedentesService.getVigentes(),
    { limit: 20 }
  );
}

function debugEstadoActualExcedentesService_getAuditablesGlobal() {
  return debugServiceCall_(
    "EstadoActualExcedentesService.getAuditables [GLOBAL]",
    {
      tipoAuditoria: "GLOBAL",
      bodegaObjetivo: "TODAS"
    },
    () => EstadoActualExcedentesService.getAuditables({
      tipoAuditoria: "GLOBAL",
      bodegaObjetivo: "TODAS"
    }),
    { limit: 20 }
  );
}

function debugEstadoActualExcedentesService_getAuditablesBodega() {
  const BODEGA_PRUEBA = "BODEGA 1";

  return debugServiceCall_(
    "EstadoActualExcedentesService.getAuditables [POR_BODEGA]",
    {
      tipoAuditoria: "POR_BODEGA",
      bodegaObjetivo: BODEGA_PRUEBA
    },
    () => EstadoActualExcedentesService.getAuditables({
      tipoAuditoria: "POR_BODEGA",
      bodegaObjetivo: BODEGA_PRUEBA
    }),
    { limit: 20 }
  );
}

function debugEstadoActualExcedentesService_getPorIdUnico() {
  const IDUNICO_PRUEBA = "202605141622201581";

  return debugServiceCall_(
    "EstadoActualExcedentesService.getPorIdUnico",
    { idUnico: IDUNICO_PRUEBA },
    () => EstadoActualExcedentesService.getPorIdUnico(IDUNICO_PRUEBA),
    { limit: 10 }
  );
}

function debugEstadoActualExcedentesService_getUnoPorIdUnico() {
  const IDUNICO_PRUEBA = "202605141622201581";

  return debugServiceCall_(
    "EstadoActualExcedentesService.getUnoPorIdUnico",
    { idUnico: IDUNICO_PRUEBA },
    () => EstadoActualExcedentesService.getUnoPorIdUnico(IDUNICO_PRUEBA),
    { limit: 10 }
  );
}

function debugEstadoActualExcedentesService_getPorUbicacion() {
  const UBICACION_PRUEBA = "B1-19";

  return debugServiceCall_(
    "EstadoActualExcedentesService.getPorUbicacion",
    { ubicacion: UBICACION_PRUEBA },
    () => EstadoActualExcedentesService.getPorUbicacion(UBICACION_PRUEBA),
    { limit: 20 }
  );
}

function debugEstadoActualExcedentesService_getPorBodega() {
  const BODEGA_PRUEBA = "BODEGA 1";

  return debugServiceCall_(
    "EstadoActualExcedentesService.getPorBodega",
    { bodega: BODEGA_PRUEBA },
    () => EstadoActualExcedentesService.getPorBodega(BODEGA_PRUEBA),
    { limit: 20 }
  );
}

function debugEstadoActualExcedentesService_getResumen() {
  return debugServiceCall_(
    "EstadoActualExcedentesService.getResumen",
    {},
    () => EstadoActualExcedentesService.getResumen(),
    { limit: 10 }
  );
}

function debugEstadoActualExcedentesService_clearCache() {
  return debugServiceCall_(
    "EstadoActualExcedentesService.clearCache",
    {},
    () => {
      EstadoActualExcedentesService.clearCache();
      return { ok: true, mensaje: "Cache limpiado correctamente" };
    },
    { limit: 10 }
  );
}

/**
 * Debug maestro:
 * ejecuta lo más importante de una sola vez
 */
function debugEstadoActualExcedentesService() {
  console.log("==================================================");
  console.log("[DEBUG MASTER] EstadoActualExcedentesService");
  console.log("==================================================");

  debugEstadoActualExcedentesService_clearCache();
  debugEstadoActualExcedentesService_getAll();
  debugEstadoActualExcedentesService_getVigentes();
  debugEstadoActualExcedentesService_getAuditablesGlobal();
  debugEstadoActualExcedentesService_getAuditablesBodega();
  debugEstadoActualExcedentesService_getPorIdUnico();
  debugEstadoActualExcedentesService_getUnoPorIdUnico();
  debugEstadoActualExcedentesService_getPorUbicacion();
  debugEstadoActualExcedentesService_getPorBodega();
  debugEstadoActualExcedentesService_getResumen();

  console.log("==================================================");
  console.log("[DEBUG MASTER] FIN EstadoActualExcedentesService");
  console.log("==================================================");
}
