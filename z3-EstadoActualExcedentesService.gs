/**
 * EstadoActualExcedentesService.gs
 */

const EstadoActualExcedentesService = (() => {

  const DOMAIN = Object.freeze({
    TIPO_AUDITORIA: Object.freeze({
      GLOBAL: "GLOBAL",
      POR_BODEGA: "POR_BODEGA"
    }),

    VALOR_TODAS: "TODAS",

    BODEGA_FALLBACK: "PENDIENTE DE UBICACIÓN",

    ESTATUS_LOGICOS: Object.freeze({
      UBICADO: "UBICADO",
      PENDIENTE_UBICACION: "PENDIENTE_UBICACION",
      FUERA_DE_AUDITORIA: "FUERA_DE_AUDITORIA",
      INVALIDO_BD: "INVALIDO_BD",
      SIN_REGISTRO_BD: "SIN_REGISTRO_BD",
      SIN_TRASPASOS: "SIN_TRASPASOS",
      DESCONOCIDO: "DESCONOCIDO"
    }),

    /**
     * AJUSTA ESTA LISTA si manejas otros valores válidos en BD-EXCEDENTES.
     * Aquí se define qué STATUS permiten que el IdUnico entre al universo.
     */
    STATUS_BD_VALIDOS: Object.freeze([
      "",
      "ACOMODADO",
      "DISPONIBLE",
      "PENDIENTE",
      "SIN UBICACION",
      "SIN UBICACIÓN"
    ]),

    /**
     * AJUSTA ESTA LISTA si manejas otros valores terminales / inválidos.
     */
    STATUS_BD_INVALIDOS: Object.freeze([
      "SURTIDO",
      "PARCIAL",
      "CERRADO",
      "CANCELADO",
      "ELIMINADO",
      "BAJA",
      "INACTIVO"
    ])

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

  function _normalizarConfigAuditoria_(config) {
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

    if (
      tipoAuditoria === DOMAIN.TIPO_AUDITORIA.GLOBAL ||
      bodegaObjetivo === DOMAIN.VALOR_TODAS
    ) {
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
  // REGLAS DE VALIDACIÓN BD-EXCEDENTES
  // =========================================================
  function _esStatusBDValido_(status) {
    const s = _toSafeUpper_(status);

    if (DOMAIN.STATUS_BD_INVALIDOS.includes(s)) {
      return false;
    }

    if (DOMAIN.STATUS_BD_VALIDOS.includes(s)) {
      return true;
    }

    return false;
  }

  // =========================================================
  // INDEXACIÓN BD-EXCEDENTES
  // =========================================================
  function _indexarExcedentesPorIdUnico_() {
    const rows = (
      ExcedentesRepository.getAllRaw
        ? ExcedentesRepository.getAllRaw()
        : ExcedentesRepository.getAll()
    ).filter(item => _toSafeStr_(item.idunico));

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
          validoBD: _esStatusBDValido_(row.status),
          _timestamp: ts
        };
      }

      return acc;
    }, {});
  }

  // =========================================================
  // INDEXACIÓN TRASPASOS
  // =========================================================
  function _indexarUltimoMovimientoPorIdUnico_() {
    const movimientos = (
      TraspasosRepository.getAllRaw
        ? TraspasosRepository.getAllRaw()
        : TraspasosRepository.getAll()
    ).filter(m => _toSafeStr_(m.idunico));


    return movimientos.reduce((acc, mov) => {
      const id = _toSafeStr_(mov.idunico);
      const ts = _timestampFromMovimiento_(mov);

      const fila = _toSafeNum_(mov.fila || 0);

      if (
        !acc[id] ||
        ts > acc[id]._timestamp ||
        (ts === acc[id]._timestamp && fila >= _toSafeNum_(acc[id]._fila || 0))
      ) {
        acc[id] = {
          idUnico: id,
          ultimoTipo: _toSafeUpper_(mov.tipomovimiento),
          ultimaSerie: _toSafeUpper_(mov.serie),
          ultimaUbicacionEntrada: _toSafeUpper_(mov.ubicacionentrada),
          ultimaUbicacionSalida: _toSafeUpper_(mov.ubicacionsalida),
          ultimaBodegaEntrada: _toSafeUpper_(mov.bodegaentrada),
          ultimaBodegaSalida: _toSafeUpper_(mov.bodegasalida),
          cantidadMovimiento: _toSafeNum_(mov.cantidad),
          codigoMovimiento: _toSafeUpper_(mov.codigo),
          descripcionMovimiento: _toSafeUpper_(mov.descripcion),
          ultimaFecha: formatDate_(mov.fechatraspaso),
          ultimaHora: formatTime_(mov.horatraspaso),
          _timestamp: ts,
          _fila: fila
        };
      }
      return acc;
    }, {});
  }

  // =========================================================
  // RESOLUCIÓN DE ESTADO ACTUAL DESDE TRASPASOS
  // =========================================================
  function _resolverUbicacionActualDesdeTraspasos_(ultimoMov) {
    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");
    const ultimaUbicacionEntrada = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionEntrada : "");
    const ultimaUbicacionSalida = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaUbicacionSalida : "");
    const ultimaSerie = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaSerie : "");

    // Regla principal:
    // El balance / ubicación actual lo determina TRASPASOS.

    if (tipoUltimo === "ACOMODO" || tipoUltimo === "CAMBIO DE BODEGA") {
      if (_esUbicacionFisica_(ultimaUbicacionEntrada)) {
        return ultimaUbicacionEntrada;
      }

      if (_esUbicacionFisica_(ultimaSerie)) {
        return ultimaSerie;
      }

      return "";
    }

    // Si el último fue surtido, sale del universo auditable.
    if (tipoUltimo === "SURTIDO") {
      return "";
    }

    // Fallback defensivo para tipos distintos:
    if (_esUbicacionFisica_(ultimaUbicacionEntrada)) {
      return ultimaUbicacionEntrada;
    }

    if (_esUbicacionFisica_(ultimaSerie)) {
      return ultimaSerie;
    }

    if (_esUbicacionFisica_(ultimaUbicacionSalida)) {
      return ultimaUbicacionSalida;
    }

    return "";
  }

  function _resolverBodegaActual_(ubicacionActual, ultimoMov) {
    const ubicacion = _toSafeUpper_(ubicacionActual);

    if (_esUbicacionFisica_(ubicacion)) {
      return _obtenerNombreBodegaPorSerie_(ubicacion, DOMAIN.BODEGA_FALLBACK);
    }

    const ultimaBodegaEntrada = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaBodegaEntrada : "");
    const ultimaBodegaSalida = _toSafeUpper_(ultimoMov ? ultimoMov.ultimaBodegaSalida : "");

    if (ultimaBodegaEntrada && ultimaBodegaEntrada !== "1 - ALMACEN BIRLOS") {
      return ultimaBodegaEntrada;
    }

    if (ultimaBodegaSalida && ultimaBodegaSalida !== "1 - ALMACEN BIRLOS") {
      return ultimaBodegaSalida;
    }

    return DOMAIN.BODEGA_FALLBACK;
  }

  function _resolverSaldoActual_(base, ultimoMov) {
    // Informativo, no define vigencia
    const saldoBase = _toSafeNum_(base ? base.saldoBase : 0);
    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");
    const cantidadMovimiento = _toSafeNum_(ultimoMov ? ultimoMov.cantidadMovimiento : 0);

    if (tipoUltimo === "ACOMODO" || tipoUltimo === "CAMBIO DE BODEGA") {
      return Math.abs(cantidadMovimiento || saldoBase);
    }

    if (tipoUltimo === "SURTIDO") {
      return 0;
    }

    return saldoBase || Math.abs(cantidadMovimiento || 0);
  }

  function _resolverEstatusLogico_(base, ultimoMov, ubicacionActual) {
    const existeBD = !!base;
    const validoBD = base ? base.validoBD === true : false;
    const tieneUbicacionFisica = _esUbicacionFisica_(ubicacionActual);
    const tipoUltimo = _toSafeUpper_(ultimoMov ? ultimoMov.ultimoTipo : "");

    if (!ultimoMov) {
      return existeBD
        ? DOMAIN.ESTATUS_LOGICOS.SIN_TRASPASOS
        : DOMAIN.ESTATUS_LOGICOS.SIN_REGISTRO_BD;
    }

    if (!existeBD) {
      return DOMAIN.ESTATUS_LOGICOS.SIN_REGISTRO_BD;
    }

    if (!validoBD) {
      return DOMAIN.ESTATUS_LOGICOS.INVALIDO_BD;
    }

    if (tieneUbicacionFisica) {
      return DOMAIN.ESTATUS_LOGICOS.UBICADO;
    }

    if (tipoUltimo === "SURTIDO") {
      return DOMAIN.ESTATUS_LOGICOS.FUERA_DE_AUDITORIA;
    }

    return DOMAIN.ESTATUS_LOGICOS.PENDIENTE_UBICACION;
  }

  // =========================================================
  // CONSTRUCCIÓN DEL DATASET CONSOLIDADO
  // =========================================================
  function _construirEstado_() {
    const mapaBase = _indexarExcedentesPorIdUnico_();
    const mapaMov = _indexarUltimoMovimientoPorIdUnico_();

    // MODELO INVERTIDO:
    // La base principal es TRASPASOS.
    // BD-EXCEDENTES solo valida / enriquece.
    const ids = Array.from(
      new Set([
        ...Object.keys(mapaMov),
        ...Object.keys(mapaBase)
      ])
    );

    return ids
      .map(id => {
        const base = mapaBase[id] || null;
        const ultimoMov = mapaMov[id] || null;

        const ubicacionActual = _resolverUbicacionActualDesdeTraspasos_(ultimoMov);
        const bodegaActual = _resolverBodegaActual_(ubicacionActual, ultimoMov);
        const saldoActual = _resolverSaldoActual_(base, ultimoMov);
        const estatusLogico = _resolverEstatusLogico_(base, ultimoMov, ubicacionActual);

        const existeBD = !!base;
        const validoBD = base ? base.validoBD === true : false;
        const vigente = existeBD && validoBD;
        const conUbicacion = _esUbicacionFisica_(ubicacionActual);
        const pendienteUbicacion = vigente && !conUbicacion;
        const auditable = vigente && conUbicacion;

        return {
          // Identificación
          idUnico: id,
          codigo: base
            ? base.codigo
            : _toSafeUpper_(ultimoMov ? ultimoMov.codigoMovimiento : ""),
          descripcion: base
            ? base.descripcion
            : _toSafeUpper_(ultimoMov ? ultimoMov.descripcionMovimiento : ""),
          idproducto: base ? base.idproducto : "",

          // Validación BD
          existeBD: existeBD,
          estatusRegistro: base ? base.estatusRegistro : "",
          validoBD: validoBD,
          vigente: vigente,

          // Estado operativo desde TRASPASOS
          saldoActual: saldoActual,
          ubicacionActual: ubicacionActual,
          bodegaActual: bodegaActual,
          estatusLogico: estatusLogico,

          // Flags operativos
          conUbicacion: conUbicacion,
          pendienteUbicacion: pendienteUbicacion,
          auditable: auditable,

          // Base original (informativo)
          saldoBase: base ? base.saldoBase : 0,
          fechaBase: base ? base.fechaBase : "",
          horaBase: base ? base.horaBase : "",

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

        const cmpCodigo = _toSafeUpper_(a.codigo).localeCompare(_toSafeUpper_(b.codigo), "es", {
          sensitivity: "base",
          numeric: true
        });

        if (cmpCodigo !== 0) return cmpCodigo;

        return _toSafeStr_(a.idUnico).localeCompare(_toSafeStr_(b.idUnico), "es", {
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
    const invalidosBD = all.filter(item => item.estatusLogico === DOMAIN.ESTATUS_LOGICOS.INVALIDO_BD);
    const sinRegistroBD = all.filter(item => item.estatusLogico === DOMAIN.ESTATUS_LOGICOS.SIN_REGISTRO_BD);

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
      invalidosBD: invalidosBD.length,
      sinRegistroBD: sinRegistroBD.length,
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

