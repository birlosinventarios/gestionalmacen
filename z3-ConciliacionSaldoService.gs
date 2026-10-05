/**
 * ConciliacionSaldoService.gs
 *
 * Servicio de dominio para Conciliacion de saldo.
 *
 * REGLAS
 * - Agrupa por FECHA + HORA + SERIE.
 * - ACOMODO y SURTIDO pueden convivir en el mismo grupo.
 * - Traduce bodegas fisicas a almacenes administrativos.
 * - ACOMODO: SERIE debe coincidir con UBICACION_ENTRADA.
 * - SURTIDO: SERIE debe coincidir con UBICACION_SALIDA.
 * - Solo completa filas PENDIENTES.
 * - El responsable debe tener rol RESPONSABLE.
 * - Fecha y hora de respuesta se generan en servidor.
 * - No modifica existencias, excedentes, saldos ni ubicaciones.
 */
const ConciliacionSaldoService = (() => {
  "use strict";

  const DOMAIN = Object.freeze({
    TIPOS_VALIDOS: Object.freeze(["ACOMODO", "SURTIDO"]),

    ESTADOS_FILA: Object.freeze({
      PENDIENTE: "PENDIENTE",
      ATENDIDO: "ATENDIDO",
      ATENDIDO_HISTORICO: "ATENDIDO_HISTORICO",
      INCONSISTENTE: "INCONSISTENTE"
    }),

    ESTADOS_GRUPO: Object.freeze({
      PENDIENTE: "PENDIENTE",
      PARCIAL: "PARCIAL",
      ATENDIDO: "ATENDIDO",
      ATENDIDO_HISTORICO: "ATENDIDO_HISTORICO",
      INCONSISTENTE: "INCONSISTENTE"
    }),

    ESTADOS_TRABAJO: Object.freeze([
      "PENDIENTE",
      "PARCIAL",
      "INCONSISTENTE"
    ]),

    ALMACENES: Object.freeze({
      PRINCIPAL: "1 - ALMACEN BIRLOS",
      EXCEDENTE_BODEGA: "2 - EXCEDENTE BODEGA",
      EXCEDENTE_CASA_BLANCA: "3 - EXCEDENTE CASA BLANCA"
    }),

    BODEGAS_EXCEDENTE_BODEGA: Object.freeze([
      "BODEGA 1",
      "BODEGA 2",
      "BODEGA 3",
      "BODEGA MOSTRADOR"
    ]),

    BODEGAS_EXCEDENTE_CASA_BLANCA: Object.freeze([
      "CASA BLANCA 1",
      "CASA BLANCA 2"
    ])
  });

  const CFG = Object.freeze({
    LOCK_TIMEOUT_MS: 30000,
    MAX_FOLIO_LENGTH: 80,
    MAX_GROUP_ROWS: 1000,
    DEFAULT_VIEW_LIMIT: 500
  });

  function _perfConciliacionStart_(
    operation,
    metadata
  ) {
    const now =
      Date.now();

    return {
      operation:
        String(
          operation ||
          "CONCILIACION_OPERATION"
        ),

      startedAt:
        now,

      lastAt:
        now,

      metadata:
        metadata &&
        typeof metadata ===
          "object"
          ? metadata
          : {},

      marks:
        []
    };
  }

  function _perfConciliacionMark_(
    trace,
    stage,
    metadata
  ) {
    if (
      !trace
    ) {
      return;
    }

    const now =
      Date.now();

    trace.marks.push({
      stage:
        String(
          stage ||
          "MARK"
        ),

      segmentMs:
        now -
        trace.lastAt,

      totalMs:
        now -
        trace.startedAt,

      metadata:
        metadata &&
        typeof metadata ===
          "object"
          ? metadata
          : {}
    });

    trace.lastAt =
      now;
  }

  function _perfConciliacionEnd_(
    trace,
    status,
    metadata
  ) {
    if (
      !trace
    ) {
      return null;
    }

    const result = {
      operation:
        trace.operation,

      status:
        String(
          status ||
          "ok"
        ),

      totalMs:
        Date.now() -
        trace.startedAt,

      metadata:
        Object.assign(
          {},
          trace.metadata,
          metadata || {}
        ),

      marks:
        trace.marks.slice()
    };

    console.log(
      "[APPALMACEN]" +
      "[CONCILIACION_BACKEND_PERF] " +
      JSON.stringify(
        result
      )
    );

    return result;
  }  

  function _str_(value) {
    return toStr_(value || "");
  }

  function _upper_(value) {
    return toStrUpper_(value || "");
  }

  function _num_(value) {
    return toNum_(value || 0);
  }

  function _getAllFreshForConciliacion_() {
    if (
      typeof TraspasosRepository !==
        "undefined" &&
      TraspasosRepository &&
      typeof TraspasosRepository
        .getAllForConciliacionFresh ===
        "function"
    ) {
      return TraspasosRepository
        .getAllForConciliacionFresh();
    }

    if (
      typeof TraspasosRepository !==
        "undefined" &&
      TraspasosRepository &&
      typeof TraspasosRepository
        .getAllFresh ===
        "function"
    ) {
      console.warn(
        "[CONCILIACION] " +
        "getAllForConciliacionFresh no está disponible. " +
        "Se utilizará getAllFresh como respaldo."
      );

      return TraspasosRepository
        .getAllFresh();
    }

    throw new Error(
      "TraspasosRepository no está disponible " +
      "o no expone un método de lectura compatible."
    );
  }

  function _dateTimeMs_(fecha, hora) {
    const f = _str_(fecha).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const h = _str_(hora).match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!f || !h) return 0;

    const date = new Date(
      Number(f[3]),
      Number(f[2]) - 1,
      Number(f[1]),
      Number(h[1]),
      Number(h[2]),
      Number(h[3])
    );

    return isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function _buildGroupKey_(movement) {
    return [
      _str_(movement.fecha),
      _str_(movement.hora),
      _upper_(movement.serie)
    ].join("|");
  }

  function _isAllowedType_(value) {
    return DOMAIN.TIPOS_VALIDOS.indexOf(_upper_(value)) !== -1;
  }

  function _classifyRow_(movement) {
    const f = !!_str_(movement.folio);
    const r = !!_str_(movement.responsable);
    const fr = !!_str_(movement.fecharespuesta);
    const hr = !!_str_(movement.horarespuesta);

    if (!f && !r && !fr && !hr) return DOMAIN.ESTADOS_FILA.PENDIENTE;
    if (f && r && fr && hr) return DOMAIN.ESTADOS_FILA.ATENDIDO;
    if (f && r && !fr && !hr) return DOMAIN.ESTADOS_FILA.ATENDIDO_HISTORICO;
    return DOMAIN.ESTADOS_FILA.INCONSISTENTE;
  }

  function _resolveAdministrativeWarehouse_(physicalWarehouse) {
    const value = _upper_(physicalWarehouse);

    if (value === DOMAIN.ALMACENES.PRINCIPAL) {
      return DOMAIN.ALMACENES.PRINCIPAL;
    }

    if (DOMAIN.BODEGAS_EXCEDENTE_BODEGA.indexOf(value) !== -1) {
      return DOMAIN.ALMACENES.EXCEDENTE_BODEGA;
    }

    if (DOMAIN.BODEGAS_EXCEDENTE_CASA_BLANCA.indexOf(value) !== -1) {
      return DOMAIN.ALMACENES.EXCEDENTE_CASA_BLANCA;
    }

    return "";
  }

  function _validateAdministrativeMovement_(movement) {
    const errors = [];
    const warnings = [];
    const type = movement.tipomovimiento;
    const series = movement.serie;
    const quantity = Math.abs(_num_(movement.cantidad));

    let sourceWarehouse = "";
    let targetWarehouse = "";

    if (!series) errors.push("SERIE_REQUERIDA");
    if (!movement.codigo) errors.push("CODIGO_REQUERIDO");
    if (!movement.idunico) errors.push("IDUNICO_REQUERIDO");
    if (!(quantity > 0)) errors.push("CANTIDAD_INVALIDA");

    if (type === "ACOMODO") {
      if (series !== movement.ubicacionentrada) {
        errors.push("SERIE_NO_COINCIDE_CON_UBICACION_ENTRADA");
      }

      if (movement.bodegasalida !== DOMAIN.ALMACENES.PRINCIPAL) {
        errors.push("ORIGEN_ACOMODO_NO_ES_ALMACEN_BIRLOS");
      }

      sourceWarehouse = DOMAIN.ALMACENES.PRINCIPAL;
      targetWarehouse = _resolveAdministrativeWarehouse_(
        movement.bodegaentrada
      );

      if (!targetWarehouse) {
        errors.push("ALMACEN_ENTRADA_ADMINISTRATIVO_NO_RECONOCIDO");
      }
    } else if (type === "SURTIDO") {
      if (series !== movement.ubicacionsalida) {
        errors.push("SERIE_NO_COINCIDE_CON_UBICACION_SALIDA");
      }

      if (movement.bodegaentrada !== DOMAIN.ALMACENES.PRINCIPAL) {
        errors.push("DESTINO_SURTIDO_NO_ES_ALMACEN_BIRLOS");
      }

      sourceWarehouse = _resolveAdministrativeWarehouse_(
        movement.bodegasalida
      );
      targetWarehouse = DOMAIN.ALMACENES.PRINCIPAL;

      if (!sourceWarehouse) {
        errors.push("ALMACEN_SALIDA_ADMINISTRATIVO_NO_RECONOCIDO");
      }
    } else {
      errors.push("TIPO_MOVIMIENTO_NO_PERMITIDO");
    }

    if (sourceWarehouse && sourceWarehouse === targetWarehouse) {
      errors.push("ALMACEN_SALIDA_IGUAL_A_ENTRADA");
    }

    return {
      valido: errors.length === 0,
      errores: errors,
      advertencias: warnings,
      cantidadadministrativa: quantity,
      almacensalidaadministrativo: sourceWarehouse,
      almacenentradaadministrativo: targetWarehouse
    };
  }

  function _normalizeMovement_(
    row
  ) {
    const fecha =
      _str_(
        row
          .fechatraspasoTexto
      );

    const hora =
      _str_(
        row
          .horatraspasoTexto
      );

    const fechaRespuesta =
      _str_(
        row
          .fecharespuestaTexto
      );

    const horaRespuesta =
      _str_(
        row
          .horarespuestaTexto
      );

    const movement = {
      fila:
        Math.floor(
          Number(
            row.fila || 0
          )
        ),

      fecha:
        fecha,

      hora:
        hora,

      fechaHoraMs:
        _dateTimeMs_(
          fecha,
          hora
        ),

      tipomovimiento:
        _upper_(
          row.tipomovimiento
        ),

      serie:
        _upper_(
          row.serie
        ),

      bodegasalida:
        _upper_(
          row.bodegasalida
        ),

      ubicacionsalida:
        _upper_(
          row.ubicacionsalida
        ),

      bodegaentrada:
        _upper_(
          row.bodegaentrada
        ),

      ubicacionentrada:
        _upper_(
          row.ubicacionentrada
        ),

      solicitante:
        _upper_(
          row.solicitante
        ),

      codigo:
        _upper_(
          row.codigo
        ),

      descripcion:
        _upper_(
          row.descripcion
        ),

      cantidad:
        _num_(
          row.cantidad
        ),

      folio:
        _str_(
          row.folio
        ),

      responsable:
        _upper_(
          row.responsable
        ),

      idunico:
        _str_(
          row.idunico
        ),

      fecharespuesta:
        fechaRespuesta,

      horarespuesta:
        horaRespuesta
    };

    movement.clavegrupo =
      _buildGroupKey_(
        movement
      );

    movement.estadoconciliacion =
      _classifyRow_(
        movement
      );

    movement.validacionadministrativa =
      _validateAdministrativeMovement_(
        movement
      );

    movement.cantidadadministrativa =
      movement
        .validacionadministrativa
        .cantidadadministrativa;

    movement.almacensalidaadministrativo =
      movement
        .validacionadministrativa
        .almacensalidaadministrativo;

    movement.almacenentradaadministrativo =
      movement
        .validacionadministrativa
        .almacenentradaadministrativo;

    return movement;
  }

  function _pushUnique_(array, value, preserveCase) {
    const safe = preserveCase === true ? _str_(value) : _upper_(value);
    if (safe && array.indexOf(safe) === -1) array.push(safe);
  }

  function _createGroup_(movement) {
    return {
      clavegrupo: movement.clavegrupo,
      fecha: movement.fecha,
      hora: movement.hora,
      fechaHoraMs: movement.fechaHoraMs,
      serie: movement.serie,

      totalmovimientos: 0,
      totalacomodos: 0,
      totalsurtidos: 0,
      cantidadacomodos: 0,
      cantidadsurtidos: 0,
      cantidadneta: 0,
      cantidadabsoluta: 0,

      pendientes: 0,
      atendidos: 0,
      atendidoshistoricos: 0,
      inconsistentes: 0,

      movimientosvalidos: 0,
      movimientosinvalidos: 0,
      conciliable: true,
      erroresvalidacion: [],

      filas: [],
      filaspendientes: [],
      tiposmovimiento: [],
      idunicos: [],
      codigos: [],
      solicitantes: [],
      origenes: [],
      destinos: [],
      almacenessalidaadministrativos: [],
      almacenesentradaadministrativos: [],
      folios: [],
      responsables: [],
      alertas: [],

      estadogrupo: DOMAIN.ESTADOS_GRUPO.PENDIENTE,
      segundostranscurridos: 0,
      minutostranscurridos: 0,
      horastranscurridas: 0,
      diastranscurridos: 0,
      tiempotranscurridotexto: "",
      movimientos: []
    };
  }

  function _addMovement_(group, movement) {
    group.totalmovimientos += 1;
    group.cantidadneta = round2_(group.cantidadneta + movement.cantidad);
    group.cantidadabsoluta = round2_(
      group.cantidadabsoluta + Math.abs(movement.cantidad)
    );
    group.filas.push(movement.fila);

    if (movement.tipomovimiento === "ACOMODO") {
      group.totalacomodos += 1;
      group.cantidadacomodos = round2_(
        group.cantidadacomodos + movement.cantidadadministrativa
      );
    }

    if (movement.tipomovimiento === "SURTIDO") {
      group.totalsurtidos += 1;
      group.cantidadsurtidos = round2_(
        group.cantidadsurtidos + movement.cantidadadministrativa
      );
    }

    if (movement.estadoconciliacion === DOMAIN.ESTADOS_FILA.PENDIENTE) {
      group.pendientes += 1;
      group.filaspendientes.push(movement.fila);
    } else if (movement.estadoconciliacion === DOMAIN.ESTADOS_FILA.ATENDIDO) {
      group.atendidos += 1;
    } else if (
      movement.estadoconciliacion === DOMAIN.ESTADOS_FILA.ATENDIDO_HISTORICO
    ) {
      group.atendidoshistoricos += 1;
    } else {
      group.inconsistentes += 1;
    }

    if (movement.validacionadministrativa.valido) {
      group.movimientosvalidos += 1;
    } else {
      group.movimientosinvalidos += 1;
      movement.validacionadministrativa.errores.forEach(function (errorCode) {
        _pushUnique_(group.erroresvalidacion, errorCode);
      });
    }

    _pushUnique_(group.tiposmovimiento, movement.tipomovimiento);
    _pushUnique_(group.idunicos, movement.idunico, true);
    _pushUnique_(group.codigos, movement.codigo);
    _pushUnique_(group.solicitantes, movement.solicitante);
    _pushUnique_(
      group.origenes,
      [movement.bodegasalida, movement.ubicacionsalida]
        .filter(Boolean)
        .join(" / ")
    );
    _pushUnique_(
      group.destinos,
      [movement.bodegaentrada, movement.ubicacionentrada]
        .filter(Boolean)
        .join(" / ")
    );
    _pushUnique_(
      group.almacenessalidaadministrativos,
      movement.almacensalidaadministrativo
    );
    _pushUnique_(
      group.almacenesentradaadministrativos,
      movement.almacenentradaadministrativo
    );
    _pushUnique_(group.folios, movement.folio, true);
    _pushUnique_(group.responsables, movement.responsable);

    group.movimientos.push(movement);
  }

  function _elapsedText_(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    if (days > 0) return days + " d " + hours + " h";
    if (hours > 0) return hours + " h " + minutes + " min";
    return minutes + " min";
  }

  function _finalizeGroup_(group, nowMs) {
    if (group.inconsistentes > 0) {
      group.estadogrupo = DOMAIN.ESTADOS_GRUPO.INCONSISTENTE;
    } else if (group.pendientes === group.totalmovimientos) {
      group.estadogrupo = DOMAIN.ESTADOS_GRUPO.PENDIENTE;
    } else if (group.atendidos === group.totalmovimientos) {
      group.estadogrupo = DOMAIN.ESTADOS_GRUPO.ATENDIDO;
    } else if (group.atendidoshistoricos === group.totalmovimientos) {
      group.estadogrupo = DOMAIN.ESTADOS_GRUPO.ATENDIDO_HISTORICO;
    } else {
      group.estadogrupo = DOMAIN.ESTADOS_GRUPO.PARCIAL;
    }

    group.conciliable =
      group.movimientosinvalidos === 0 &&
      group.inconsistentes === 0 &&
      group.pendientes > 0;

    if (group.tiposmovimiento.length > 1) group.alertas.push("GRUPO_MIXTO");
    if (group.solicitantes.length > 1) group.alertas.push("SOLICITANTE_MULTIPLE");
    if (group.origenes.length > 1) group.alertas.push("ORIGEN_MULTIPLE");
    if (group.destinos.length > 1) group.alertas.push("DESTINO_MULTIPLE");
    if (group.folios.length > 1) group.alertas.push("FOLIO_MULTIPLE");
    if (group.responsables.length > 1) group.alertas.push("RESPONSABLE_MULTIPLE");
    if (group.movimientosinvalidos > 0) {
      group.alertas.push("MOVIMIENTOS_ADMINISTRATIVOS_INVALIDOS");
    }

    if (group.fechaHoraMs > 0) {
      group.segundostranscurridos = Math.max(
        0,
        Math.floor((nowMs - group.fechaHoraMs) / 1000)
      );
      group.minutostranscurridos = Math.floor(group.segundostranscurridos / 60);
      group.horastranscurridas = Math.floor(group.segundostranscurridos / 3600);
      group.diastranscurridos = Math.floor(group.segundostranscurridos / 86400);
      group.tiempotranscurridotexto = _elapsedText_(
        group.segundostranscurridos
      );
    }

    group.filas.sort(function (a, b) { return a - b; });
    group.filaspendientes.sort(function (a, b) { return a - b; });
    group.movimientos.sort(function (a, b) {
      return a.fila - b.fila || compareEs_(a.codigo, b.codigo);
    });

    return group;
  }

  function _buildGroups_(rows) {
    const map = {};
    const invalidRows = [];
    const nowMs = Date.now();

    (Array.isArray(rows) ? rows : []).forEach(function (raw) {
      const movement = _normalizeMovement_(raw);
      if (!_isAllowedType_(movement.tipomovimiento)) return;

      if (!movement.fila || !movement.fecha || !movement.hora || !movement.serie) {
        invalidRows.push({
          fila: movement.fila,
          motivo: "FALTA_FECHA_HORA_SERIE_O_FILA",
          fecha: movement.fecha,
          hora: movement.hora,
          serie: movement.serie
        });
        return;
      }

      if (!map[movement.clavegrupo]) {
        map[movement.clavegrupo] = _createGroup_(movement);
      }

      _addMovement_(map[movement.clavegrupo], movement);
    });

    const priority = {
      INCONSISTENTE: 1,
      PARCIAL: 2,
      PENDIENTE: 3,
      ATENDIDO_HISTORICO: 4,
      ATENDIDO: 5
    };

    return {
      grupos: Object.keys(map)
        .map(function (key) {
          return _finalizeGroup_(map[key], nowMs);
        })
        .sort(function (a, b) {
          return (
            (priority[a.estadogrupo] || 99) -
              (priority[b.estadogrupo] || 99) ||
            a.fechaHoraMs - b.fechaHoraMs ||
            compareEs_(a.serie, b.serie)
          );
        }),
      filasinvalidas: invalidRows
    };
  }

  function _getResponsibles_(forceRefresh) {
    if (forceRefresh === true && UsuariosRepository.clearCache) {
      UsuariosRepository.clearCache();
    }

    return UsuariosRepository
      .getPorRol("RESPONSABLE")
      .map(function (user) {
        return {
          idusuario: _num_(user.idusuario),
          nombre: _upper_(user.nombre),
          rol: _upper_(user.rol)
        };
      })
      .filter(function (user) {
        return user.nombre && user.rol === "RESPONSABLE";
      })
      .sort(function (a, b) {
        return compareEs_(a.nombre, b.nombre);
      });
  }

  function _assertResponsible_(responsible) {
    const normalized = _upper_(responsible);
    if (!normalized) throw new Error("El responsable es obligatorio.");

    const exists = _getResponsibles_(true).some(function (user) {
      return user.nombre === normalized;
    });

    if (!exists) {
      throw new Error(
        "El usuario seleccionado no existe o no tiene rol RESPONSABLE."
      );
    }

    return normalized;
  }

  function _summary_(groups, invalidRows) {
    return {
      totalgrupos: groups.length,
      grupospendientes: groups.filter(function (g) {
        return g.estadogrupo === "PENDIENTE";
      }).length,
      gruposparciales: groups.filter(function (g) {
        return g.estadogrupo === "PARCIAL";
      }).length,
      gruposinconsistentes: groups.filter(function (g) {
        return g.estadogrupo === "INCONSISTENTE";
      }).length,
      gruposatendidos: groups.filter(function (g) {
        return g.estadogrupo === "ATENDIDO";
      }).length,
      gruposhistoricos: groups.filter(function (g) {
        return g.estadogrupo === "ATENDIDO_HISTORICO";
      }).length,
      gruposnoconciliables: groups.filter(function (g) {
        return g.pendientes > 0 && g.conciliable !== true;
      }).length,
      movimientospendientes: groups.reduce(function (t, g) {
        return t + g.pendientes;
      }, 0),
      movimientosinvalidos: groups.reduce(function (t, g) {
        return t + g.movimientosinvalidos;
      }, 0),
      filasinvalidas: invalidRows.length
    };
  }

  function _workGroups_(groups) {
    return groups.filter(function (group) {
      return DOMAIN.ESTADOS_TRABAJO.indexOf(group.estadogrupo) !== -1;
    });
  }

  function _countGroupsByStatus_(groups) {
    return (groups || []).reduce(
      function (accumulator, group) {
        const status =
          _upper_(
            group &&
            group.estadogrupo
          ) ||
          "SIN_ESTADO";

        accumulator[status] =
          Number(
            accumulator[status] || 0
          ) + 1;

        return accumulator;
      },
      {}
    );
  }


  function _filterGroups_(groups, filters) {
    const cfg = filters || {};
    const state = _upper_(cfg.estado);
    const series = _upper_(cfg.serie);
    const type = _upper_(cfg.tipomovimiento);
    const query = _upper_(cfg.query);
    let output = [...groups];

    if (state && state !== "TODOS") {
      output = state === "TRABAJO"
        ? _workGroups_(output)
        : output.filter(function (g) { return g.estadogrupo === state; });
    }

    if (series) {
      output = output.filter(function (g) { return g.serie === series; });
    }

    if (type) {
      output = output.filter(function (g) {
        return g.tiposmovimiento.indexOf(type) !== -1;
      });
    }

    if (cfg.soloConciliables === true) {
      output = output.filter(function (g) { return g.conciliable === true; });
    }

    if (query) {
      output = output.filter(function (g) {
        return _upper_([
          g.clavegrupo,
          g.serie,
          g.tiposmovimiento.join(" "),
          g.codigos.join(" "),
          g.idunicos.join(" "),
          g.solicitantes.join(" "),
          g.almacenessalidaadministrativos.join(" "),
          g.almacenesentradaadministrativos.join(" ")
        ].join(" ")).indexOf(query) !== -1;
      });
    }

    const requested = Math.floor(Number(cfg.limit || CFG.DEFAULT_VIEW_LIMIT));
    const limit = Math.max(1, Math.min(CFG.DEFAULT_VIEW_LIMIT, requested || CFG.DEFAULT_VIEW_LIMIT));
    return output.slice(0, limit);
  }

  function _validateFolio_(
    value
  ) {
    const folio =
      _str_(
        value
      );

    if (
      !folio
    ) {
      throw new Error(
        "El folio es obligatorio."
      );
    }

    if (
      folio.length >
      CFG.MAX_FOLIO_LENGTH
    ) {
      throw new Error(
        "El folio no puede exceder " +
        CFG.MAX_FOLIO_LENGTH +
        " caracteres."
      );
    }

    if (
      !/^\d+$/.test(
        folio
      )
    ) {
      throw new Error(
        "El folio debe contener únicamente números."
      );
    }

    return folio;
  }

  function _normalizeRows_(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map(function (row) { return Math.floor(Number(row)); })
      .filter(function (row) { return Number.isFinite(row) && row >= 2; })
    )).sort(function (a, b) { return a - b; });
  }

  function _sameRows_(a, b) {
    return a.length === b.length && a.every(function (value, index) {
      return value === b[index];
    });
  }

  function obtenerBootstrap() {
    const trace =
      _perfConciliacionStart_(
        "CONCILIACION_OBTENER_BOOTSTRAP"
      );

    try {
      const readStartedAt =
        Date.now();

      const source =
        _getAllFreshForConciliacion_();

      _perfConciliacionMark_(
        trace,
        "TRASPASOS_READ",
        {
          elapsedMs:
            Date.now() -
            readStartedAt,

          rows:
            Array.isArray(
              source
            )
              ? source.length
              : 0
        }
      );

      const groupsStartedAt =
        Date.now();

      const built =
        _buildGroups_(
          source
        );

      _perfConciliacionMark_(
        trace,
        "GROUPS_BUILT",
        {
          elapsedMs:
            Date.now() -
            groupsStartedAt,

          groups:
            built.grupos.length,

          invalidRows:
            built
              .filasinvalidas
              .length
        }
      );

      const workStartedAt =
        Date.now();

      const groups =
        _workGroups_(
          built.grupos
        );

      const statusCounts =
        _countGroupsByStatus_(
          built.grupos
        );      

      _perfConciliacionMark_(
        trace,
        "WORK_GROUPS_FILTERED",
        {
          elapsedMs:
            Date.now() -
            workStartedAt,

          groups:
            groups.length,

          statusCounts:
            statusCounts
        }
      );

      const responsibleStartedAt =
        Date.now();

      const responsibles =
        _getResponsibles_(
          false
        );

      _perfConciliacionMark_(
        trace,
        "RESPONSIBLES_READY",
        {
          elapsedMs:
            Date.now() -
            responsibleStartedAt,

          responsibles:
            responsibles.length
        }
      );

      const summaryStartedAt =
        Date.now();

      const summary =
        _summary_(
          built.grupos,
          built.filasinvalidas
        );

      _perfConciliacionMark_(
        trace,
        "SUMMARY_READY",
        {
          elapsedMs:
            Date.now() -
            summaryStartedAt,

          pendingGroups:
            Number(
              summary
                .grupospendientes ||
              0
            ),

          pendingMovements:
            Number(
              summary
                .movimientospendientes ||
              0
            )
        }
      );

      const temporalStartedAt =
        Date.now();

      const temporal =
        getTemporalContext_();

      _perfConciliacionMark_(
        trace,
        "TEMPORAL_CONTEXT_READY",
        {
          elapsedMs:
            Date.now() -
            temporalStartedAt
        }
      );

      const result = {
        ok:
          true,

        modulo:
          "CONCILIACION_SALDO",

        grupos:
          groups,

        responsables:
          responsibles,

        resumen:
          summary,

        filasinvalidas:
          built.filasinvalidas,

        catalogoalmacenes:
          {
            ...DOMAIN.ALMACENES
          },

        generadoEn:
          {
            fecha:
              temporal.fecha,

            hora:
              temporal.hora
          }
      };

      const serializeStartedAt =
        Date.now();

      let responseChars =
        -1;

      try {
        responseChars =
          JSON.stringify(
            result
          ).length;
      } catch (
        error
      ) {
        responseChars =
          -1;
      }

      _perfConciliacionMark_(
        trace,
        "RESPONSE_READY",
        {
          elapsedMs:
            Date.now() -
            serializeStartedAt,

          responseChars:
            responseChars,

          groups:
            groups.length,

          movements:
            groups.reduce(
              function(
                total,
                group
              ) {
                return (
                  total +
                  Number(
                    group
                      .totalmovimientos ||
                    0
                  )
                );
              },
              0
            )
        }
      );

      _perfConciliacionEnd_(
        trace,
        "ok",
        {
          sourceRows:
            source.length,

          totalGroups:
            built.grupos.length,

          workGroups:
            groups.length,

          responsibles:
            responsibles.length,

          responseChars:
            responseChars,
          
          statusCounts:
            statusCounts
        }
      );

      return result;
    } catch (
      error
    ) {
      _perfConciliacionMark_(
        trace,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfConciliacionEnd_(
        trace,
        "error"
      );

      throw error;
    }
  }

  function listarGrupos(
    filters
  ) {
    const trace =
      _perfConciliacionStart_(
        "CONCILIACION_LISTAR_GRUPOS",
        {
          filters:
            filters || {}
        }
      );

    try {
      const readStartedAt =
        Date.now();

      const source =
        _getAllFreshForConciliacion_();

      _perfConciliacionMark_(
        trace,
        "TRASPASOS_READ",
        {
          elapsedMs:
            Date.now() -
            readStartedAt,

          rows:
            source.length
        }
      );

      const buildStartedAt =
        Date.now();

      const built =
        _buildGroups_(
          source
        );

      _perfConciliacionMark_(
        trace,
        "GROUPS_BUILT",
        {
          elapsedMs:
            Date.now() -
            buildStartedAt,

          groups:
            built.grupos.length
        }
      );

      const filterStartedAt =
        Date.now();

      const groups =
        _filterGroups_(
          built.grupos,
          filters || {
            estado:
              "TRABAJO"
          }
        );

      _perfConciliacionMark_(
        trace,
        "GROUPS_FILTERED",
        {
          elapsedMs:
            Date.now() -
            filterStartedAt,

          groups:
            groups.length
        }
      );

      const summary =
        _summary_(
          built.grupos,
          built.filasinvalidas
        );

      const result = {
        ok:
          true,

        grupos:
          groups,

        data:
          groups,

        total:
          groups.length,

        resumen:
          summary,

        filasinvalidas:
          built.filasinvalidas
      };

      _perfConciliacionEnd_(
        trace,
        "ok",
        {
          sourceRows:
            source.length,

          totalGroups:
            built.grupos.length,

          returnedGroups:
            groups.length
        }
      );

      return result;
    } catch (
      error
    ) {
      _perfConciliacionMark_(
        trace,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfConciliacionEnd_(
        trace,
        "error"
      );

      throw error;
    }
  }

  function obtenerGrupo(
    claveGrupo
  ) {
    const trace =
      _perfConciliacionStart_(
        "CONCILIACION_OBTENER_GRUPO"
      );

    try {
      const key =
        _str_(
          claveGrupo
        );

      if (
        !key
      ) {
        throw new Error(
          "La clave del grupo es obligatoria."
        );
      }

      _perfConciliacionMark_(
        trace,
        "INPUT_VALIDATED"
      );

      const readStartedAt =
        Date.now();

      const source =
        _getAllFreshForConciliacion_();

      _perfConciliacionMark_(
        trace,
        "TRASPASOS_READ",
        {
          elapsedMs:
            Date.now() -
            readStartedAt,

          rows:
            source.length
        }
      );

      const buildStartedAt =
        Date.now();

      const built =
        _buildGroups_(
          source
        );

      const group =
        built.grupos.find(
          function(item) {
            return (
              item.clavegrupo ===
              key
            );
          }
        );

      _perfConciliacionMark_(
        trace,
        "GROUPS_BUILT_AND_SEARCHED",
        {
          elapsedMs:
            Date.now() -
            buildStartedAt,

          groups:
            built.grupos.length,

          found:
            Boolean(
              group
            )
        }
      );

      if (
        !group
      ) {
        throw new Error(
          "No existe el grupo de conciliación solicitado."
        );
      }

      const result = {
        ok:
          true,

        grupo:
          group
      };

      _perfConciliacionEnd_(
        trace,
        "ok",
        {
          movements:
            group.totalmovimientos,

          pending:
            group.pendientes
        }
      );

      return result;
    } catch (
      error
    ) {
      _perfConciliacionMark_(
        trace,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfConciliacionEnd_(
        trace,
        "error"
      );

      throw error;
    }
  }

  function registrarConciliacion(
    payload
  ) {
    const input =
      payload || {};

    const trace =
      _perfConciliacionStart_(
        "CONCILIACION_REGISTRAR",
        {
          inputRows:
            Array.isArray(
              input.filas ||
              input.rownumbers ||
              input.rowNumbers
            )
              ? (
                  input.filas ||
                  input.rownumbers ||
                  input.rowNumbers
                ).length
              : 0
        }
      );

    try {
      const validationStartedAt =
        Date.now();

      const key =
        _str_(
          input.clavegrupo ||
          input.claveGrupo
        );

      const folio =
        _validateFolio_(
          input.folio
        );

      const submittedRows =
        _normalizeRows_(
          input.filas ||
          input.rownumbers ||
          input.rowNumbers
        );

      if (
        !key
      ) {
        throw new Error(
          "La clave del grupo es obligatoria."
        );
      }

      _perfConciliacionMark_(
        trace,
        "INPUT_VALIDATED",
        {
          elapsedMs:
            Date.now() -
            validationStartedAt,

          submittedRows:
            submittedRows.length,

          keyLength:
            key.length,

          folioLength:
            folio.length
        }
      );

      const responsibleStartedAt =
        Date.now();

      const responsible =
        _assertResponsible_(
          input.responsable
        );

      _perfConciliacionMark_(
        trace,
        "RESPONSIBLE_VALIDATED",
        {
          elapsedMs:
            Date.now() -
            responsibleStartedAt
        }
      );

      const lock =
        LockService.getScriptLock();

      const lockStartedAt =
        Date.now();

      let locked =
        false;

      let result;

      try {
        locked =
          lock.tryLock(
            CFG.LOCK_TIMEOUT_MS
          );

        if (
          !locked
        ) {
          throw new Error(
            "Otra conciliación está siendo registrada. " +
            "No se realizaron cambios."
          );
        }

        _perfConciliacionMark_(
          trace,
          "LOCK_ACQUIRED",
          {
            elapsedMs:
              Date.now() -
              lockStartedAt
          }
        );

        const sourceStartedAt =
          Date.now();

        const source =
          _getAllFreshForConciliacion_();

        _perfConciliacionMark_(
          trace,
          "TRASPASOS_FRESH_READ",
          {
            elapsedMs:
              Date.now() -
              sourceStartedAt,

            rows:
              source.length
          }
        );

        const groupsStartedAt =
          Date.now();

        const built =
          _buildGroups_(
            source
          );

        const group =
          built.grupos.find(
            function(item) {
              return (
                item.clavegrupo ===
                key
              );
            }
          );

        _perfConciliacionMark_(
          trace,
          "GROUP_REBUILT_AND_FOUND",
          {
            elapsedMs:
              Date.now() -
              groupsStartedAt,

            totalGroups:
              built.grupos.length,

            found:
              Boolean(
                group
              )
          }
        );

        if (
          !group
        ) {
          throw new Error(
            "El grupo ya no existe o cambió en la hoja."
          );
        }

        if (
          group.inconsistentes >
          0
        ) {
          throw new Error(
            "El grupo contiene registros administrativos inconsistentes."
          );
        }

        if (
          group.movimientosinvalidos >
            0 ||
          group.conciliable !==
            true
        ) {
          throw new Error(
            "El grupo contiene movimientos que no pueden registrarse " +
            "en el sistema administrativo: " +
            group.erroresvalidacion.join(
              ", "
            ) +
            "."
          );
        }

        const currentRows =
          [
            ...group
              .filaspendientes
          ].sort(
            function(a, b) {
              return a - b;
            }
          );

        if (
          !currentRows.length
        ) {
          throw new Error(
            "El grupo ya no tiene movimientos pendientes."
          );
        }

        if (
          currentRows.length >
          CFG.MAX_GROUP_ROWS
        ) {
          throw new Error(
            "El grupo excede el límite permitido de movimientos."
          );
        }

        if (
          submittedRows.length &&
          !_sameRows_(
            submittedRows,
            currentRows
          )
        ) {
          throw new Error(
            "El grupo cambió desde que se cargó la vista. " +
            "Actualiza antes de registrar."
          );
        }

        _perfConciliacionMark_(
          trace,
          "GROUP_VALIDATED",
          {
            rows:
              currentRows.length,

            movements:
              group.totalmovimientos,

            pending:
              group.pendientes
          }
        );

        const freshRowsStartedAt =
          Date.now();

        const freshRows =
          TraspasosRepository
            .getByFilasFresh(
              currentRows
            );

        _perfConciliacionMark_(
          trace,
          "TARGET_ROWS_READ_FRESH",
          {
            elapsedMs:
              Date.now() -
              freshRowsStartedAt,

            requested:
              currentRows.length,

            received:
              freshRows.length
          }
        );

        const freshByRow =
          new Map(
            freshRows.map(
              function(row) {
                return [
                  Number(
                    row.fila
                  ),
                  row
                ];
              }
            )
          );

        const rowValidationStartedAt =
          Date.now();

        const invalid =
          [];

        currentRows.forEach(
          function(
            rowNumber
          ) {
            const raw =
              freshByRow.get(
                rowNumber
              );

            if (
              !raw
            ) {
              invalid.push({
                fila:
                  rowNumber,

                motivo:
                  "FILA_NO_EXISTE"
              });

              return;
            }

            const movement =
              _normalizeMovement_(
                raw
              );

            if (
              movement.clavegrupo !==
              key
            ) {
              invalid.push({
                fila:
                  rowNumber,

                motivo:
                  "GRUPO_NO_COINCIDE"
              });
            } else if (
              movement
                .estadoconciliacion !==
              "PENDIENTE"
            ) {
              invalid.push({
                fila:
                  rowNumber,

                motivo:
                  "YA_NO_ESTA_PENDIENTE"
              });
            } else if (
              !movement
                .validacionadministrativa
                .valido
            ) {
              invalid.push({
                fila:
                  rowNumber,

                motivo:
                  "MOVIMIENTO_ADMINISTRATIVO_INVALIDO",

                errores:
                  movement
                    .validacionadministrativa
                    .errores
              });
            }
          }
        );

        _perfConciliacionMark_(
          trace,
          "TARGET_ROWS_VALIDATED",
          {
            elapsedMs:
              Date.now() -
              rowValidationStartedAt,

            valid:
              currentRows.length -
              invalid.length,

            invalid:
              invalid.length
          }
        );

        if (
          invalid.length
        ) {
          result = {
            ok:
              false,

            mensaje:
              "No se escribió ninguna conciliación porque " +
              "el grupo cambió o contiene errores.",

            clavegrupo:
              key,

            actualizados:
              0,

            omitidos:
              invalid.length,

            detalleomitidos:
              invalid
          };

          _perfConciliacionMark_(
            trace,
            "WRITE_SKIPPED",
            {
              invalid:
                invalid.length
            }
          );
        } else {
          const temporalStartedAt =
            Date.now();

          const temporal =
            getTemporalContext_();

          _perfConciliacionMark_(
            trace,
            "TEMPORAL_CONTEXT_READY",
            {
              elapsedMs:
                Date.now() -
                temporalStartedAt
            }
          );

          const writeStartedAt =
            Date.now();

          const write =
            TraspasosRepository
              .updateConciliacionByFilas(
                currentRows,
                {
                  folio:
                    folio,

                  responsable:
                    responsible,

                  fecharespuesta:
                    temporal.fecha,

                  horarespuesta:
                    temporal.hora
                }
              );

          _perfConciliacionMark_(
            trace,
            "ROWS_WRITTEN",
            {
              elapsedMs:
                Date.now() -
                writeStartedAt,

              requested:
                currentRows.length,

              updated:
                Number(
                  write.actualizados ||
                  0
                )
            }
          );

          const flushStartedAt =
            Date.now();

          SpreadsheetApp.flush();

          _perfConciliacionMark_(
            trace,
            "FLUSH_COMPLETED",
            {
              elapsedMs:
                Date.now() -
                flushStartedAt
            }
          );

          result = {
            ok:
              true,

            mensaje:
              "Conciliación registrada correctamente.",

            clavegrupo:
              key,

            serie:
              group.serie,

            fecha:
              group.fecha,

            hora:
              group.hora,

            folio:
              folio,

            responsable:
              responsible,

            fecharespuesta:
              temporal.fecha,

            horarespuesta:
              temporal.hora,

            solicitados:
              currentRows.length,

            actualizados:
              write.actualizados,

            omitidos:
              0,

            filasactualizadas:
              write.filas,

            detalleomitidos:
              []
          };
        }
      } finally {
        if (
          locked
        ) {
          lock.releaseLock();

          _perfConciliacionMark_(
            trace,
            "LOCK_RELEASED"
          );
        }
      }

      const cacheStartedAt =
        Date.now();

      TraspasosRepository
        .clearCache();

      _perfConciliacionMark_(
        trace,
        "LOCAL_CACHE_CLEARED",
        {
          elapsedMs:
            Date.now() -
            cacheStartedAt
        }
      );

      _perfConciliacionEnd_(
        trace,
        result &&
        result.ok === true
          ? "ok"
          : "rejected",
        {
          requested:
            submittedRows.length,

          updated:
            Number(
              result &&
              result.actualizados ||
              0
            ),

          omitted:
            Number(
              result &&
              result.omitidos ||
              0
            )
        }
      );

      return result;
    } catch (
      error
    ) {
      try {
        if (
          typeof TraspasosRepository !==
            "undefined" &&
          TraspasosRepository &&
          typeof TraspasosRepository
            .clearCache ===
            "function"
        ) {
          TraspasosRepository
            .clearCache();

          _perfConciliacionMark_(
            trace,
            "LOCAL_CACHE_CLEARED_AFTER_ERROR"
          );
        }
      } catch (
        cacheError
      ) {
        console.warn(
          "[CONCILIACION] " +
          "No se pudo limpiar TraspasosRepository " +
          "después del error.",
          cacheError &&
          cacheError.message
            ? cacheError.message
            : String(
                cacheError || ""
              )
        );

        _perfConciliacionMark_(
          trace,
          "LOCAL_CACHE_CLEAR_FAILED",
          {
            message:
              cacheError &&
              cacheError.message
                ? cacheError.message
                : String(
                    cacheError || ""
                  )
          }
        );
      }

      _perfConciliacionMark_(
        trace,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfConciliacionEnd_(
        trace,
        "error"
      );

      throw error;
    }
  }

  function ping() {
    return {
      ok: true,
      service: "ConciliacionSaldoService",
      modulo: "CONCILIACION_SALDO",
      build: "CONCILIACION-SALDO-SERVICE-2026-09-14-02",
      agrupacion: "FECHA|HORA|SERIE",
      almacenes: { ...DOMAIN.ALMACENES },
      tipospermitidos: [...DOMAIN.TIPOS_VALIDOS]
    };
  }

  return {
    obtenerBootstrap,
    listarGrupos,
    obtenerGrupo,
    registrarConciliacion,
    ping
  };
})();
