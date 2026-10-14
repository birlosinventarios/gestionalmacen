/**
 * z3-AuditoriaExcedentesDetalleService
 *
 * @fileoverview Servicio de dominio para administrar el detalle operativo de
 * auditorías de excedentes por ubicación.
 *
 * Coordina la apertura y el cierre de ubicaciones, el registro individual de
 * IdUnicos, la detección de duplicados, el cálculo de faltantes y la generación
 * de resúmenes deduplicados. La información persistida se obtiene mediante los
 * repositorios de auditoría y detalle, mientras que el universo esperado se
 * consulta en EstadoActualExcedentesService.
 *
 * Responsabilidades:
 * - Validar la existencia y el estado de una auditoría.
 * - Consultar el detalle completo o filtrado por ubicación.
 * - Distinguir marcadores abiertos, cerrados y el marcador más reciente.
 * - Evitar la reapertura accidental de ubicaciones cerradas.
 * - Validar que una ubicación pertenezca al alcance de la auditoría.
 * - Registrar escaneos y determinar si son correctos o sobrantes.
 * - Generar faltantes al cerrar una ubicación.
 * - Deduplicar IdUnicos al calcular indicadores y resúmenes.
 * - Exponer listados consistentes de ubicaciones auditadas y abiertas.
 *
 * Dependencias globales:
 * - AuditoriaExcedentesRepository.
 * - AuditoriaExcedentesDetalleRepository.
 * - EstadoActualExcedentesService.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 * - normalizeWarehouseToken_(value).
 * - inferWarehouseByLocation_(location, fallback).
 * - fmtTimeNow_(), compareEs_(left, right) y clonePlain_(value).
 *
 * Reglas de integridad:
 * - Las operaciones de escritura requieren una auditoría ABIERTA.
 * - Una ubicación cerrada no puede abrirse nuevamente en la misma auditoría.
 * - Solo puede existir un marcador abierto por ubicación.
 * - Un IdUnico no debe registrarse más de una vez dentro de la auditoría.
 * - Los faltantes se calculan desde el universo vigente del servidor.
 * - Los resúmenes cuentan IdUnicos únicos y no filas físicas duplicadas.
 * - El repositorio de detalle conserva los números físicos en _rowNumber.
 *
 * Concurrencia:
 * - Este servicio no adquiere LockService.
 * - La capa invocadora debe proteger las secuencias de lectura y escritura cuando
 *   varias solicitudes puedan modificar la misma auditoría simultáneamente.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const AuditoriaExcedentesDetalleService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    ALL_WAREHOUSES: "TODAS",
    FIRST_SEQUENCE: 1,
    LOG_PREFIX: "[AuditoriaExcedentesDetalleService]"
  });

  /** @private @const {!Object} */
  const STATUS = Object.freeze({
    ABIERTA: "ABIERTA",
    CERRADA: "CERRADA"
  });

  /** @private @const {!Object} */
  const TIPOS_AUDITORIA = Object.freeze({
    GLOBAL: "GLOBAL",
    POR_BODEGA: "POR_BODEGA"
  });

  /** @private @const {!Object} */
  const RESULTADOS = Object.freeze({
    CORRECTO: "CORRECTO",
    SOBRANTE: "SOBRANTE",
    DUPLICADO_EN_UBICACION: "DUPLICADO_EN_UBICACION",
    DUPLICADO_EN_AUDITORIA: "DUPLICADO_EN_AUDITORIA"
  });

  // ==========================================================================
  // VALIDACIÓN Y NORMALIZACIÓN
  // ==========================================================================

  /**
   * Verifica que los servicios y utilidades obligatorios estén disponibles.
   *
   * @return {void}
   * @throws {Error} Si falta alguna dependencia global.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_],
      ["normalizeWarehouseToken_", typeof normalizeWarehouseToken_],
      ["inferWarehouseByLocation_", typeof inferWarehouseByLocation_],
      ["fmtTimeNow_", typeof fmtTimeNow_],
      ["compareEs_", typeof compareEs_],
      ["clonePlain_", typeof clonePlain_]
    ];

    const missingFunctions = functions
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan utilidades globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }

    const services = [
      ["AuditoriaExcedentesRepository", typeof AuditoriaExcedentesRepository],
      [
        "AuditoriaExcedentesDetalleRepository",
        typeof AuditoriaExcedentesDetalleRepository
      ],
      ["EstadoActualExcedentesService", typeof EstadoActualExcedentesService]
    ];

    const missingServices = services
      .filter(function (dependency) {
        return dependency[1] === "undefined";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingServices.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan servicios obligatorios: ` +
          `${missingServices.join(", ")}.`
      );
    }
  }

  /**
   * Valida que un argumento sea un objeto de payload utilizable.
   *
   * @param {*} payload Valor recibido por una operación pública.
   * @param {string} operationName Nombre de la operación para diagnóstico.
   * @return {!Object} El mismo objeto validado.
   * @throws {TypeError} Si el valor no es un objeto plano.
   * @private
   */
  function _payloadOrThrow_(payload, operationName) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError(`${operationName} requiere un objeto payload válido.`);
    }

    return payload;
  }

  /**
   * Obtiene una auditoría y, opcionalmente, exige que continúe abierta.
   *
   * Prioriza la lectura fresca cuando el repositorio la ofrece para evitar tomar
   * decisiones de escritura con datos cacheados.
   *
   * @param {*} idAuditoria Identificador de la auditoría.
   * @param {boolean=} requireOpen Si es false, permite auditorías cerradas.
   * @return {!Object} Auditoría localizada.
   * @throws {Error} Si el ID está vacío, no existe o no está abierta.
   * @private
   */
  function _getAuditoriaOrThrow_(idAuditoria, requireOpen = true) {
    _assertDependencies_();

    const id = toStr_(idAuditoria);
    if (!id) {
      throw new Error("Se requiere IdAuditoria.");
    }

    const audit =
      typeof AuditoriaExcedentesRepository.getByIdAuditoriaFresh === "function"
        ? AuditoriaExcedentesRepository.getByIdAuditoriaFresh(id)
        : AuditoriaExcedentesRepository.getByIdAuditoria(id);

    if (!audit) {
      throw new Error(`No existe la auditoría ${id}.`);
    }

    if (requireOpen && toStrUpper_(audit.estatus) !== STATUS.ABIERTA) {
      throw new Error(`La auditoría ${id} no está ${STATUS.ABIERTA}.`);
    }

    return audit;
  }

  /**
   * Obtiene todo el detalle de una auditoría.
   *
   * @param {*} idAuditoria Identificador de la auditoría.
   * @param {boolean=} fresh Si no es false, prioriza una lectura fresca.
   * @return {!Array<!Object>} Filas de detalle o un arreglo vacío.
   * @private
   */
  function _getDetalleByAuditoria_(idAuditoria, fresh = true) {
    _assertDependencies_();

    const id = toStr_(idAuditoria);
    if (!id) {
      return [];
    }

    if (
      fresh &&
      typeof AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh ===
        "function"
    ) {
      return (
        AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(id) || []
      );
    }

    return AuditoriaExcedentesDetalleRepository.getByIdAuditoria(id) || [];
  }

  /**
   * Obtiene las filas pertenecientes a una ubicación específica.
   *
   * @param {*} idAuditoria Identificador de la auditoría.
   * @param {*} ubicacion Ubicación solicitada.
   * @param {boolean=} fresh Si no es false, prioriza una lectura fresca.
   * @return {!Array<!Object>} Filas coincidentes.
   * @private
   */
  function _getDetallesUbicacion_(idAuditoria, ubicacion, fresh = true) {
    const id = toStr_(idAuditoria);
    const normalizedLocation = toStrUpper_(ubicacion);

    if (!id || !normalizedLocation) {
      return [];
    }

    return _getDetalleByAuditoria_(id, fresh).filter(function (item) {
      return toStrUpper_(item.ubicacion) === normalizedLocation;
    });
  }

  // ==========================================================================
  // MARCADORES Y SECUENCIAS
  // ==========================================================================

  /**
   * Devuelve los marcadores de una ubicación, del más reciente al más antiguo.
   *
   * Un marcador es una fila sin IdUnico y con hora de inicio. El orden utiliza
   * primero la secuencia y, como desempate, el número físico de fila.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @param {*} ubicacion Ubicación solicitada.
   * @param {boolean=} fresh Indica si debe usarse lectura fresca.
   * @return {!Array<!Object>} Marcadores ordenados de forma descendente.
   * @private
   */
  function _getMarcadoresUbicacion_(idAuditoria, ubicacion, fresh = true) {
    return _getDetallesUbicacion_(idAuditoria, ubicacion, fresh)
      .filter(function (item) {
        return !toStr_(item.idunico) && Boolean(item.horainicioubicacion);
      })
      .sort(function (left, right) {
        const sequenceDifference =
          toNum_(right.secuenciaubicacion) -
          toNum_(left.secuenciaubicacion);

        if (sequenceDifference !== 0) {
          return sequenceDifference;
        }

        return toNum_(right._rowNumber) - toNum_(left._rowNumber);
      });
  }

  /**
   * Devuelve el marcador abierto más reciente de una ubicación.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @param {*} ubicacion Ubicación solicitada.
   * @param {boolean=} fresh Indica si debe usarse lectura fresca.
   * @return {?Object} Marcador abierto o null.
   * @private
   */
  function _getMarcadorAbiertoUbicacion_(idAuditoria, ubicacion, fresh = true) {
    return (
      _getMarcadoresUbicacion_(idAuditoria, ubicacion, fresh).find(
        function (item) {
          return !item.horafinubicacion;
        }
      ) || null
    );
  }

  /**
   * Devuelve el marcador más reciente, sin importar si está abierto o cerrado.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @param {*} ubicacion Ubicación solicitada.
   * @param {boolean=} fresh Indica si debe usarse lectura fresca.
   * @return {?Object} Último marcador o null.
   * @private
   */
  function _getUltimoMarcadorUbicacion_(idAuditoria, ubicacion, fresh = true) {
    return _getMarcadoresUbicacion_(idAuditoria, ubicacion, fresh)[0] || null;
  }

  /**
   * Calcula la siguiente secuencia de ubicación dentro de la auditoría.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @return {number} Siguiente secuencia positiva disponible.
   * @private
   */
  function _getSecuenciaSiguiente_(idAuditoria) {
    const maximumSequence = _getDetalleByAuditoria_(idAuditoria, true).reduce(
      function (maximum, item) {
        return Math.max(maximum, toNum_(item.secuenciaubicacion));
      },
      0
    );

    return Math.max(CFG.FIRST_SEQUENCE, maximumSequence + 1);
  }

  // ==========================================================================
  // ALCANCE Y UNIVERSO ESPERADO
  // ==========================================================================

  /**
   * Determina si una ubicación pertenece al alcance de la auditoría.
   *
   * @param {!Object} auditoria Auditoría validada.
   * @param {*} ubicacion Ubicación evaluada, reservada para trazabilidad.
   * @param {*} bodegaInferida Bodega asociada o inferida.
   * @return {boolean} true si pertenece al alcance.
   * @private
   */
  function _esUbicacionDentroDelAlcance_(
    auditoria,
    ubicacion,
    bodegaInferida
  ) {
    if (!auditoria || typeof auditoria !== "object") {
      return false;
    }

    const tipo = toStrUpper_(auditoria.tipoauditoria);
    if (tipo === TIPOS_AUDITORIA.GLOBAL) {
      return true;
    }

    if (tipo === TIPOS_AUDITORIA.POR_BODEGA) {
      const targetWarehouse = normalizeWarehouseToken_(
        auditoria.bodegaobjetivo
      );
      const locationWarehouse = normalizeWarehouseToken_(
        bodegaInferida || inferWarehouseByLocation_(ubicacion, "")
      );

      return Boolean(
        targetWarehouse &&
          locationWarehouse &&
          targetWarehouse === locationWarehouse
      );
    }

    return false;
  }

  /**
   * Obtiene los registros esperados para una ubicación desde el estado actual.
   *
   * @param {!Object} auditoria Auditoría validada.
   * @param {*} ubicacion Ubicación solicitada.
   * @return {!Array<!Object>} Registros auditables esperados en la ubicación.
   * @private
   */
  function _getEsperadosPorUbicacion_(auditoria, ubicacion) {
    const tipo = toStrUpper_(auditoria.tipoauditoria);
    const config =
      tipo === TIPOS_AUDITORIA.POR_BODEGA
        ? {
            tipoAuditoria: TIPOS_AUDITORIA.POR_BODEGA,
            bodegaObjetivo: toStrUpper_(auditoria.bodegaobjetivo)
          }
        : {
            tipoAuditoria: TIPOS_AUDITORIA.GLOBAL,
            bodegaObjetivo: CFG.ALL_WAREHOUSES
          };

    const normalizedLocation = toStrUpper_(ubicacion);
    if (!normalizedLocation) {
      return [];
    }

    return (EstadoActualExcedentesService.getAuditables(config) || []).filter(
      function (item) {
        return (
          toStrUpper_(item.ubicacionActual || item.ubicacion) ===
          normalizedLocation
        );
      }
    );
  }

  /**
   * Deduplica filas por IdUnico conservando la primera aparición.
   *
   * @param {!Array<!Object>} rows Filas que se desean deduplicar.
   * @return {!Array<!Object>} Filas únicas por IdUnico.
   * @private
   */
  function _uniqueRowsById_(rows) {
    const source = Array.isArray(rows) ? rows : [];
    const uniqueById = Object.create(null);

    source.forEach(function (row) {
      const id = toStrUpper_(row && row.idunico);
      if (id && !Object.prototype.hasOwnProperty.call(uniqueById, id)) {
        uniqueById[id] = row;
      }
    });

    return Object.keys(uniqueById).map(function (id) {
      return uniqueById[id];
    });
  }

  /**
   * Construye el resumen persistido de una ubicación.
   *
   * Los indicadores se calculan con IdUnicos deduplicados para evitar que filas
   * repetidas inflen las métricas. Los marcadores no cuentan como inventario.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @param {*} ubicacion Ubicación solicitada.
   * @return {!Object} Estado e indicadores de la ubicación.
   * @private
   */
  function _buildResumenUbicacion_(idAuditoria, ubicacion) {
    const items = _getDetallesUbicacion_(idAuditoria, ubicacion, true);
    const markers = items.filter(function (item) {
      return !toStr_(item.idunico) && Boolean(item.horainicioubicacion);
    });
    const openMarker =
      markers.find(function (item) {
        return !item.horafinubicacion;
      }) || null;
    const closedMarker =
      markers.find(function (item) {
        return Boolean(item.horafinubicacion);
      }) || null;
    const rowsWithId = items.filter(function (item) {
      return Boolean(toStr_(item.idunico));
    });
    const correct = _uniqueRowsById_(
      rowsWithId.filter(function (item) {
        return item.escorrecto === true;
      })
    );
    const missing = _uniqueRowsById_(
      rowsWithId.filter(function (item) {
        return item.esfaltante === true;
      })
    );
    const surplus = _uniqueRowsById_(
      rowsWithId.filter(function (item) {
        return item.essobrante === true;
      })
    );
    const scanned = _uniqueRowsById_(
      rowsWithId.filter(function (item) {
        return item.esfaltante !== true;
      })
    );

    return {
      idauditoria: toStr_(idAuditoria),
      ubicacion: toStrUpper_(ubicacion),
      abierta: Boolean(openMarker),
      cerrada: Boolean(closedMarker) && !openMarker,
      esperados: correct.length + missing.length,
      escaneados: scanned.length,
      correctos: correct.length,
      faltantes: missing.length,
      sobrantes: surplus.length,
      tieneDiferencia: missing.length > 0 || surplus.length > 0,
      totalRegistros: items.length,
      totalFilasConId: rowsWithId.length
    };
  }

  // ==========================================================================
  // OPERACIONES PÚBLICAS
  // ==========================================================================

  /**
   * Abre una ubicación dentro de una auditoría.
   *
   * Si ya existe un marcador abierto, devuelve el estado actual sin insertar una
   * fila adicional. Si el último marcador está cerrado, rechaza la reapertura.
   *
   * @param {!Object} payload Debe contener idauditoria y ubicacion.
   * @return {!Object} Marcador abierto y resumen vigente.
   * @throws {Error} Si la auditoría, ubicación o alcance no son válidos.
   */
  function abrirUbicacion(payload) {
    const input = _payloadOrThrow_(payload, "abrirUbicacion()");
    const idAuditoria = toStr_(input.idauditoria);
    const location = toStrUpper_(input.ubicacion);

    if (!idAuditoria) {
      throw new Error("abrirUbicacion() requiere payload.idauditoria.");
    }
    if (!location) {
      throw new Error("abrirUbicacion() requiere payload.ubicacion.");
    }

    const audit = _getAuditoriaOrThrow_(idAuditoria, true);
    const openMarker = _getMarcadorAbiertoUbicacion_(
      idAuditoria,
      location,
      true
    );

    if (openMarker) {
      return {
        ok: true,
        mensaje: "La ubicación ya estaba abierta.",
        marcador: openMarker,
        resumen: _buildResumenUbicacion_(idAuditoria, location)
      };
    }

    const lastMarker = _getUltimoMarcadorUbicacion_(
      idAuditoria,
      location,
      true
    );

    if (lastMarker && lastMarker.horafinubicacion) {
      throw new Error(
        `La ubicación ${location} ya fue cerrada en esta auditoría.`
      );
    }

    const warehouse = inferWarehouseByLocation_(location, "");
    if (!_esUbicacionDentroDelAlcance_(audit, location, warehouse)) {
      throw new Error(
        `La ubicación ${location} no pertenece al alcance de la auditoría.`
      );
    }

    const marker = AuditoriaExcedentesDetalleRepository.insert({
      idauditoria: idAuditoria,
      secuenciaubicacion: _getSecuenciaSiguiente_(idAuditoria),
      bodega: warehouse,
      ubicacion: location,
      horainicioubicacion: fmtTimeNow_(),
      horafinubicacion: "",
      idunico: "",
      codigo: "",
      descripcion: "",
      horaescaneoidunico: "",
      escorrecto: false,
      esfaltante: false,
      essobrante: false,
      observaciones: toStr_(input.observaciones)
    });

    return {
      ok: true,
      mensaje: "Ubicación abierta correctamente.",
      marcador: marker,
      resumen: _buildResumenUbicacion_(idAuditoria, location)
    };
  }

  /**
   * Obtiene el universo esperado para una ubicación.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @param {*} ubicacion Ubicación requerida.
   * @return {!Object} Total y copia simple de los registros esperados.
   */
  function obtenerEsperadosPorUbicacion(idAuditoria, ubicacion) {
    const audit = _getAuditoriaOrThrow_(idAuditoria, true);
    const location = toStrUpper_(ubicacion);

    if (!location) {
      throw new Error(
        "obtenerEsperadosPorUbicacion() requiere una ubicación válida."
      );
    }

    const data = _getEsperadosPorUbicacion_(audit, location);
    return {
      idauditoria: toStr_(idAuditoria),
      ubicacion: location,
      totalEsperados: data.length,
      data: clonePlain_(data)
    };
  }

  /**
   * Registra un IdUnico escaneado dentro de una ubicación.
   *
   * La operación abre automáticamente la ubicación si aún no existe un marcador
   * abierto. Los duplicados se informan sin insertar una fila adicional.
   *
   * @param {!Object} payload Debe contener idauditoria, ubicacion e idunico.
   * @return {!Object} Clasificación, registro persistido y resumen actualizado.
   * @throws {Error} Si el payload o el alcance no son válidos.
   */
  function registrarEscaneoIdUnico(payload) {
    const input = _payloadOrThrow_(payload, "registrarEscaneoIdUnico()");
    const idAuditoria = toStr_(input.idauditoria);
    const location = toStrUpper_(input.ubicacion);
    const uniqueId = toStrUpper_(input.idunico);

    if (!idAuditoria) {
      throw new Error(
        "registrarEscaneoIdUnico() requiere payload.idauditoria."
      );
    }
    if (!location) {
      throw new Error(
        "registrarEscaneoIdUnico() requiere payload.ubicacion."
      );
    }
    if (!uniqueId) {
      throw new Error(
        "registrarEscaneoIdUnico() requiere payload.idunico."
      );
    }

    const audit = _getAuditoriaOrThrow_(idAuditoria, true);
    let marker = _getMarcadorAbiertoUbicacion_(
      idAuditoria,
      location,
      true
    );

    if (!marker) {
      abrirUbicacion({ idauditoria: idAuditoria, ubicacion: location });
      marker = _getMarcadorAbiertoUbicacion_(
        idAuditoria,
        location,
        true
      );
    }

    if (!marker) {
      throw new Error(`No se pudo abrir la ubicación ${location}.`);
    }

    const existing =
      AuditoriaExcedentesDetalleRepository.findEscaneo(
        idAuditoria,
        uniqueId
      );

    if (existing) {
      const sameLocation = toStrUpper_(existing.ubicacion) === location;
      return {
        ok: false,
        duplicado: true,
        tipoResultado: sameLocation
          ? RESULTADOS.DUPLICADO_EN_UBICACION
          : RESULTADOS.DUPLICADO_EN_AUDITORIA,
        mensaje: sameLocation
          ? `El IdUnico ${uniqueId} ya fue escaneado en esta ubicación.`
          : `El IdUnico ${uniqueId} ya fue escaneado en la auditoría.`,
        registroExistente: existing,
        resumen: _buildResumenUbicacion_(idAuditoria, location)
      };
    }

    const current = EstadoActualExcedentesService.getUnoPorIdUnico(uniqueId);
    const currentLocation = toStrUpper_(
      current && (current.ubicacionActual || current.ubicacion)
    );
    const currentWarehouse = toStrUpper_(
      current && (current.bodegaActual || current.bodega)
    );
    const isCorrect = Boolean(
      current &&
        _esUbicacionDentroDelAlcance_(
          audit,
          currentLocation,
          currentWarehouse
        ) &&
        currentLocation === location
    );
    const observations = !current
      ? "IDUNICO NO ENCONTRADO EN ESTADO ACTUAL"
      : isCorrect
        ? ""
        : `ESPERADO EN ${currentLocation || "SIN UBICACIÓN"}`;

    const record = AuditoriaExcedentesDetalleRepository.insert({
      idauditoria: idAuditoria,
      secuenciaubicacion: marker.secuenciaubicacion,
      bodega: inferWarehouseByLocation_(location, marker.bodega || ""),
      ubicacion: location,
      horainicioubicacion: "",
      horafinubicacion: "",
      idunico: uniqueId,
      codigo: toStrUpper_(current && current.codigo),
      descripcion: toStrUpper_(current && current.descripcion),
      horaescaneoidunico: fmtTimeNow_(),
      escorrecto: isCorrect,
      esfaltante: false,
      essobrante: !isCorrect,
      observaciones: observations
    });

    return {
      ok: true,
      tipoResultado: isCorrect
        ? RESULTADOS.CORRECTO
        : RESULTADOS.SOBRANTE,
      mensaje: isCorrect
        ? "Escaneo correcto."
        : "Escaneo registrado como sobrante.",
      registro: record,
      actual: current,
      resumen: _buildResumenUbicacion_(idAuditoria, location)
    };
  }

  /**
   * Cierra una ubicación y genera las filas faltantes.
   *
   * Si la ubicación ya estaba cerrada, la operación es idempotente y devuelve el
   * resumen actual. Los faltantes se calculan contra el universo del servidor.
   *
   * @param {!Object} payload Debe contener idauditoria y ubicacion.
   * @return {!Object} Totales y resumen después del cierre.
   * @throws {Error} Si la ubicación nunca fue abierta o la auditoría no es válida.
   */
  function cerrarUbicacion(payload) {
    const input = _payloadOrThrow_(payload, "cerrarUbicacion()");
    const idAuditoria = toStr_(input.idauditoria);
    const location = toStrUpper_(input.ubicacion);
    const observations = toStr_(input.observaciones);

    if (!idAuditoria) {
      throw new Error("cerrarUbicacion() requiere payload.idauditoria.");
    }
    if (!location) {
      throw new Error("cerrarUbicacion() requiere payload.ubicacion.");
    }

    const audit = _getAuditoriaOrThrow_(idAuditoria, true);
    const marker = _getMarcadorAbiertoUbicacion_(
      idAuditoria,
      location,
      true
    );

    if (!marker) {
      const lastMarker = _getUltimoMarcadorUbicacion_(
        idAuditoria,
        location,
        true
      );

      if (lastMarker && lastMarker.horafinubicacion) {
        return {
          ok: true,
          mensaje: "La ubicación ya estaba cerrada.",
          resumen: _buildResumenUbicacion_(idAuditoria, location)
        };
      }

      throw new Error(
        `La ubicación ${location} no ha sido abierta en esta auditoría.`
      );
    }

    const expected = _getEsperadosPorUbicacion_(audit, location);
    const scanned =
      AuditoriaExcedentesDetalleRepository
        .getEscaneadosByAuditoriaYUbicacion(idAuditoria, location) || [];
    const scannedIds = new Set(
      scanned
        .map(function (item) {
          return toStrUpper_(item.idunico);
        })
        .filter(Boolean)
    );
    const missing = expected.filter(function (item) {
      const id = toStrUpper_(item.idUnico || item.idunico);
      return id && !scannedIds.has(id);
    });

    if (missing.length > 0) {
      AuditoriaExcedentesDetalleRepository.insertMany(
        missing.map(function (item) {
          return {
            idauditoria: idAuditoria,
            secuenciaubicacion: marker.secuenciaubicacion,
            bodega: toStrUpper_(
              item.bodegaActual || item.bodega || marker.bodega
            ),
            ubicacion: location,
            horainicioubicacion: "",
            horafinubicacion: "",
            idunico: toStrUpper_(item.idUnico || item.idunico),
            codigo: toStrUpper_(item.codigo),
            descripcion: toStrUpper_(item.descripcion),
            horaescaneoidunico: "",
            escorrecto: false,
            esfaltante: true,
            essobrante: false,
            observaciones: "NO ESCANEADO AL CERRAR UBICACIÓN"
          };
        })
      );
    }

    const rowNumber = Number(marker._rowNumber);
    if (!Number.isInteger(rowNumber) || rowNumber < 2) {
      throw new Error(
        `El marcador de ${location} no contiene un número de fila válido.`
      );
    }

    AuditoriaExcedentesDetalleRepository.updateByRowNumber(rowNumber, {
      horafinubicacion: fmtTimeNow_(),
      observaciones: observations || marker.observaciones || ""
    });

    return {
      ok: true,
      mensaje: "Ubicación cerrada correctamente.",
      totalEsperados: expected.length,
      totalEscaneados: scanned.length,
      totalFaltantesGenerados: missing.length,
      resumen: _buildResumenUbicacion_(idAuditoria, location)
    };
  }

  /**
   * Devuelve el detalle y resumen de una ubicación.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @param {*} ubicacion Ubicación solicitada.
   * @return {!Object} Detalle y resumen vigente.
   */
  function getDetalleUbicacion(idAuditoria, ubicacion) {
    const id = toStr_(idAuditoria);
    const location = toStrUpper_(ubicacion);

    if (!id) {
      throw new Error("getDetalleUbicacion() requiere idauditoria.");
    }
    if (!location) {
      throw new Error("getDetalleUbicacion() requiere ubicacion.");
    }

    const data = _getDetallesUbicacion_(id, location, true);
    return {
      idauditoria: id,
      ubicacion: location,
      resumen: _buildResumenUbicacion_(id, location),
      data,
      detalle: data
    };
  }

  /**
   * Lista ubicaciones con actividad o marcadores dentro de una auditoría.
   *
   * El resultado consolida filas físicas por ubicación y conserva la secuencia
   * más alta encontrada. Las ubicaciones se ordenan por secuencia y nombre.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @return {!Array<!Object>} Ubicaciones auditadas consolidadas.
   */
  function listarUbicacionesAuditadas(idAuditoria) {
    const details = _getDetalleByAuditoria_(idAuditoria, true);
    const byLocation = Object.create(null);

    details.forEach(function (item) {
      const location = toStrUpper_(item.ubicacion);
      if (!location) {
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(byLocation, location)) {
        byLocation[location] = {
          ubicacion: location,
          bodega: toStrUpper_(item.bodega),
          secuenciaubicacion: toNum_(item.secuenciaubicacion),
          abierta: false,
          cerrada: false,
          tieneActividad: false,
          marcadorIncompleto: false
        };
      }

      const summary = byLocation[location];
      summary.secuenciaubicacion = Math.max(
        summary.secuenciaubicacion,
        toNum_(item.secuenciaubicacion)
      );

      if (item.idunico) {
        summary.tieneActividad = true;
      }

      if (!item.idunico) {
        if (item.horainicioubicacion && !item.horafinubicacion) {
          summary.abierta = true;
        }
        if (item.horainicioubicacion && item.horafinubicacion) {
          summary.cerrada = true;
        }
        if (!item.horainicioubicacion) {
          summary.marcadorIncompleto = true;
        }
      }
    });

    return Object.keys(byLocation)
      .map(function (location) {
        return byLocation[location];
      })
      .filter(function (item) {
        return item.abierta || item.cerrada || item.tieneActividad;
      })
      .sort(function (left, right) {
        return (
          left.secuenciaubicacion - right.secuenciaubicacion ||
          compareEs_(left.ubicacion, right.ubicacion)
        );
      });
  }

  /**
   * Lista los marcadores que continúan abiertos en una auditoría.
   *
   * @param {*} idAuditoria Identificador de auditoría.
   * @return {!Array<!Object>} Ubicaciones abiertas en orden físico.
   */
  function listarUbicacionesAbiertas(idAuditoria) {
    return _getDetalleByAuditoria_(idAuditoria, true)
      .filter(function (item) {
        return (
          !item.idunico &&
          item.horainicioubicacion &&
          !item.horafinubicacion
        );
      })
      .map(function (item) {
        return {
          ubicacion: item.ubicacion,
          bodega: item.bodega,
          secuenciaubicacion: item.secuenciaubicacion,
          horainicioubicacion: item.horainicioubicacion
        };
      });
  }

  return Object.freeze({
    abrirUbicacion,
    obtenerEsperadosPorUbicacion,
    registrarEscaneoIdUnico,
    cerrarUbicacion,
    getDetalleUbicacion,
    listarUbicacionesAuditadas,
    listarUbicacionesAbiertas
  });
})();
