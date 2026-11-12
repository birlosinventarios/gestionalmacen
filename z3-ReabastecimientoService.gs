/**
 * z3-ReabastecimientoService.gs
 *
 * @fileoverview Servicio de dominio para crear, consultar y atender tickets de
 * Reabastecimiento. Coordina fuentes autoritativas, repositorios de persistencia,
 * validaciones de negocio, concurrencia e invalidación selectiva de cachés.
 *
 * MODELO
 * - REABASTECIMIENTO_SOLICITUDES: una fila por ticket.
 * - REABASTECIMIENTO_PARTIDAS: una fila por SKU y ubicación solicitados.
 * - REABASTECIMIENTO_DETALLES: una fila por IDUNICO escaneado; se vincula con
 *   la partida mediante ID_SOLICITUD + código y no persiste consecutivo de partida.
 *
 * REGLAS PRINCIPALES
 * - El estado de la solicitud se deriva de las marcas de inicio y cierre.
 * - El estado de una partida se persiste como PENDIENTE o ATENDIDO.
 * - ATENDIDO significa que el usuario consultó las ubicaciones de excedente.
 * - El surtido físico se acredita mediante IDUNICO registrados en DETALLES.
 * - Folios, consecutivos, fechas, horas y conteos se generan en servidor.
 * - El navegador nunca es autoridad para código, descripción, ubicación,
 *   cantidad, estado, fecha, hora ni usuario.
 * - Toda escritura y revalidación crítica ocurre bajo un único ScriptLock.
 *
 * DEPENDENCIAS
 * - CatalogoRepository, UsuariosRepository y UbicacionesSurtidoRepository.
 * - EstadoActualExcedentesService.
 * - ReabastecimientoSolicitudesRepository.
 * - ReabastecimientoPartidasRepository.
 * - ReabastecimientoDetallesRepository.
 * - Utilidades declaradas en z0-UtilidadesDatos.gs.
 *
 * SEGURIDAD
 * - No registra folios, códigos, ubicaciones, IDUNICO ni nombres de usuario.
 * - Los errores públicos usan códigos estables sin exponer detalles internos.
 * - Las escrituras son idempotentes cuando el estado ya refleja el resultado.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REABASTECIMIENTO-SERVICE-2026-11-12-05
 */
const ReabastecimientoService = (() => {
  "use strict";

  const CFG = Object.freeze({
    MODULE: "REABASTECIMIENTO",
    LOG_PREFIX: "[ReabastecimientoService]",
    LOCALE: "es-MX",
    ALL_WAREHOUSES: "TODAS",
    ELIGIBLE_ACTIONS: Object.freeze([
      "RELLENO PREVENTIVO",
      "RELLENO URGENTE"
    ])
  });

  function domainError_(code, message, details) {
    const error = new Error(String(message || "Error de Reabastecimiento."));
    error.name = "ReabastecimientoDomainError";
    error.code = String(code || REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO);
    if (details && typeof details === "object") error.details = details;
    return error;
  }

  function assertDependencies_() {
    const requiredFunctions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_],
      ["withScriptLock_", typeof withScriptLock_],
      ["getReabastecimientoTemporalContext_", typeof getReabastecimientoTemporalContext_],
      ["padPositiveInteger_", typeof padPositiveInteger_],
      ["perfStart_", typeof perfStart_],
      ["perfMark_", typeof perfMark_],
      ["perfEnd_", typeof perfEnd_],
      ["perfFail_", typeof perfFail_],
      ["clearReabastecimientoCaches_", typeof clearReabastecimientoCaches_]
    ];
    const missingFunctions = requiredFunctions
      .filter(function(entry) { return entry[1] !== "function"; })
      .map(function(entry) { return entry[0]; });
    if (missingFunctions.length) {
      throw new Error(CFG.LOG_PREFIX + " Faltan utilidades: " + missingFunctions.join(", ") + ".");
    }
    const requiredObjects = [
      ["CatalogoRepository", typeof CatalogoRepository],
      ["UsuariosRepository", typeof UsuariosRepository],
      ["UbicacionesSurtidoRepository", typeof UbicacionesSurtidoRepository],
      ["EstadoActualExcedentesService", typeof EstadoActualExcedentesService],
      ["ReabastecimientoSolicitudesRepository", typeof ReabastecimientoSolicitudesRepository],
      ["ReabastecimientoPartidasRepository", typeof ReabastecimientoPartidasRepository],
      ["ReabastecimientoDetallesRepository", typeof ReabastecimientoDetallesRepository]
    ];
    const missingObjects = requiredObjects
      .filter(function(entry) { return entry[1] === "undefined"; })
      .map(function(entry) { return entry[0]; });
    if (missingObjects.length) {
      throw new Error(CFG.LOG_PREFIX + " Faltan componentes: " + missingObjects.join(", ") + ".");
    }
  }

  function startTrace_(operation, metadata) {
    return perfStart_(operation, Object.assign({
      module: CFG.MODULE,
      layer: "SERVICE"
    }, metadata || {}));
  }

  function finishTrace_(trace, metadata) {
    return perfEnd_(trace, "ok", metadata || {});
  }

  function failTrace_(trace, error) {
    perfFail_(trace, error, {
      code: toStr_(error && error.code),
      errorName: toStr_(error && error.name)
    });
  }

  function validateUser_(name, trace) {
    const normalized = toStrUpper_(name);
    if (!normalized) {
      throw domainError_(
        REABASTECIMIENTO_CONFIG.ERROR_CODES.USUARIO_REQUERIDO,
        "El usuario es obligatorio."
      );
    }
    const matches = typeof UsuariosRepository.getPorNombreDirecto === "function"
      ? UsuariosRepository.getPorNombreDirecto(normalized, trace)
      : UsuariosRepository.getPorNombre(normalized);
    if (!Array.isArray(matches) || matches.length === 0) {
      throw domainError_(
        REABASTECIMIENTO_CONFIG.ERROR_CODES.USUARIO_NO_ENCONTRADO,
        "El usuario no existe en el catálogo autorizado."
      );
    }
    if (matches.length > 1) {
      throw domainError_(
        REABASTECIMIENTO_CONFIG.ERROR_CODES.USUARIO_NO_ENCONTRADO,
        "El usuario es ambiguo porque existen registros duplicados."
      );
    }
    return matches[0];
  }

  function deriveRequestState_(request) {
    const startDate = Boolean(request && request.fechaInicioAtencion);
    const startTime = Boolean(request && request.horaInicioAtencion);
    const closeDate = Boolean(request && request.fechaCierreAtencion);
    const closeTime = Boolean(request && request.horaCierreAtencion);
    const hasStart = startDate && startTime;
    const hasClose = closeDate && closeTime;
    const partialStart = startDate !== startTime;
    const partialClose = closeDate !== closeTime;
    const states = REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS;
    if (partialStart || partialClose || (hasClose && !hasStart)) return states.INCONSISTENTE;
    if (!hasStart && !hasClose) return states.ABIERTA;
    if (hasStart && !hasClose) return states.EN_ATENCION;
    if (hasStart && hasClose) return states.CERRADA;
    return states.INCONSISTENTE;
  }

  /**
   * Catálogo canónico inferido desde el prefijo de UBICACION.
   * BA y CB se excluyen porque no representan ubicaciones almacenables.
   * @private
   */
  const SALES_FLOOR_WAREHOUSES = Object.freeze({
    B1: Object.freeze({ id: "B1", label: "BODEGA 1" }),
    B2: Object.freeze({ id: "B2", label: "BODEGA 2" }),
    B3: Object.freeze({ id: "B3", label: "BODEGA 3" }),
    MO: Object.freeze({ id: "MO", label: "MOSTRADOR" }),
    CU: Object.freeze({ id: "CU", label: "CUARTO ALTO VALOR" })
  });

  /**
   * Normaliza una clave de bodega inferida sin aceptar prefijos descartados.
   * @param {*} warehouse Clave recibida.
   * @return {string} B1, B2, B3, MO, CU o cadena vacía.
   * @private
   */
  function normalizeSalesFloorWarehouse_(warehouse) {
    const value = toStrUpper_(warehouse);
    return Object.prototype.hasOwnProperty.call(SALES_FLOOR_WAREHOUSES, value)
      ? value
      : "";
  }

  /**
   * Infiere la bodega de piso desde el inicio de UBICACION.
   * El orden evita interpretar BA como Bodega 1 y descarta CB completamente.
   * @param {*} location Ubicación de surtido.
   * @return {string} Clave válida o cadena vacía si debe excluirse.
   * @private
   */
  function inferSalesFloorWarehouse_(location) {
    const value = toStrUpper_(location);
    if (!value || value.startsWith("BA") || value.startsWith("CB")) return "";
    if (value.startsWith("B1")) return "B1";
    if (value.startsWith("B2")) return "B2";
    if (value.startsWith("B3")) return "B3";
    if (value.startsWith("MO")) return "MO";
    if (value.startsWith("CU")) return "CU";
    return "";
  }

  /** Orden alfanumérico natural para ubicaciones de surtido. */
  function compareSupplyLocation_(left, right) {
    return toStrUpper_(left).localeCompare(toStrUpper_(right), CFG.LOCALE, {
      numeric: true,
      sensitivity: "base"
    });
  }

  /**
   * Devuelve las bodegas de piso configuradas en UBICACIONES_SURTIDO.
   *
   * @return {!Array<!Object>} Identificadores y etiquetas seguras.
   * @private
   */
  function getSalesFloorWarehouses_() {
    const available = UbicacionesSurtidoRepository.getAll().reduce(function(set, item) {
      const warehouseKey = inferSalesFloorWarehouse_(item && item.ubicacion);
      if (warehouseKey) set.add(warehouseKey);
      return set;
    }, new Set());
    return Object.keys(SALES_FLOOR_WAREHOUSES)
      .filter(function(key) { return available.has(key); })
      .map(function(key) {
        return {
          id: SALES_FLOOR_WAREHOUSES[key].id,
          label: SALES_FLOOR_WAREHOUSES[key].label
        };
      });
  }

  /** Construye un índice único de productos activos por código. */
  function buildActiveCatalogIndex_() {
    return CatalogoRepository.getAllRaw().reduce(function(index, product) {
      const code = toStrUpper_(product && product.codigo);
      if (!code || toStrUpper_(product && product.status) !== "ACTIVO") return index;
      if (!index[code]) {
        index[code] = {
          codigo: code,
          descripcion: toStrUpper_(product.descripcion),
          idproducto: toStr_(product.idproducto)
        };
      }
      return index;
    }, Object.create(null));
  }

  /** Agrupa excedentes vigentes y ubicados por código. */
  function buildCurrentExcessByCode_() {
    return EstadoActualExcedentesService.getVigentes().reduce(function(index, item) {
      const code = toStrUpper_(item && item.codigo);
      const idUnico = toStrUpper_(item && item.idUnico);
      const balance = toNum_(item && item.saldoActual);
      const location = toStrUpper_(item && item.ubicacionActual);
      if (!code || !idUnico || balance <= 0 || !location || item.vigente !== true) {
        return index;
      }
      if (!index[code]) index[code] = [];
      index[code].push({
        idUnico: idUnico,
        codigo: code,
        descripcion: toStrUpper_(item.descripcion),
        cantidadIdUnico: balance,
        ubicacionExcedente: location,
        bodegaExcedente: toStrUpper_(item.bodegaActual)
      });
      return index;
    }, Object.create(null));
  }

  /**
   * Obtiene el catálogo manual de excedentes para una bodega de piso.
   * Una fila representa la combinación SKU + ubicación de surtido + IDUNICO.
   *
   * @param {*} warehouse Clave inferida de la bodega de piso.
   * @return {!Object} Bootstrap y registros manuales.
   */
  function getManualRequestExcess(warehouse) {
    const trace = startTrace_("REABASTECIMIENTO_GET_MANUAL_EXCESS", {});
    try {
      assertDependencies_();
      const warehouses = getSalesFloorWarehouses_();
      const warehouseId = normalizeSalesFloorWarehouse_(warehouse);
      if (!toStr_(warehouse)) {
        const bootstrap = {
          bodegaSurtido: null,
          bodegasPisoVenta: warehouses,
          registros: [],
          totalIdUnicos: 0,
          totalSkus: 0,
          cantidadTotal: 0
        };
        finishTrace_(trace, { bootstrapOnly: true, warehouses: warehouses.length });
        return bootstrap;
      }
      if (!warehouses.some(function(item) { return item.id === warehouseId; })) {
        throw domainError_(
          REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO,
          "La bodega de piso de venta no corresponde a un prefijo de ubicación permitido."
        );
      }
      const supplyLocations = UbicacionesSurtidoRepository.getAll().filter(function(item) {
        return inferSalesFloorWarehouse_(item && item.ubicacion) === warehouseId;
      });
      const activeCatalog = buildActiveCatalogIndex_();
      const excessByCode = buildCurrentExcessByCode_();
      const records = [];
      supplyLocations.forEach(function(supply) {
        const code = toStrUpper_(supply.codigo);
        const supplyLocation = toStrUpper_(supply.ubicacion);
        const product = activeCatalog[code];
        if (!code || !supplyLocation || !product || !excessByCode[code]) return;
        excessByCode[code].forEach(function(excess) {
          records.push({
            codigo: code,
            descripcion: product.descripcion || excess.descripcion,
            ubicacionExcedente: excess.ubicacionExcedente,
            bodegaExcedente: excess.bodegaExcedente,
            cantidadIdUnico: excess.cantidadIdUnico,
            idUnico: excess.idUnico,
            ubicacionSurtido: supplyLocation,
            bodegaSurtido: warehouseId
          });
        });
      });
      records.sort(function(left, right) {
        return compareSupplyLocation_(left.ubicacionSurtido, right.ubicacionSurtido) ||
          left.codigo.localeCompare(right.codigo, CFG.LOCALE, { numeric: true, sensitivity: "base" }) ||
          left.idUnico.localeCompare(right.idUnico, CFG.LOCALE, { numeric: true, sensitivity: "base" });
      });
      const uniqueSkus = new Set(records.map(function(item) { return item.codigo; }));
      const quantitiesById = records.reduce(function(index, item) {
        if (!Object.prototype.hasOwnProperty.call(index, item.idUnico)) {
          index[item.idUnico] = toNum_(item.cantidadIdUnico);
        }
        return index;
      }, Object.create(null));
      const result = {
        bodegaSurtido: warehouseId,
        bodegasPisoVenta: warehouses,
        registros: records,
        totalIdUnicos: Object.keys(quantitiesById).length,
        totalSkus: uniqueSkus.size,
        cantidadTotal: round2_(Object.keys(quantitiesById).reduce(function(total, idUnico) {
          return total + quantitiesById[idUnico];
        }, 0))
      };
      finishTrace_(trace, {
        supplyLocations: supplyLocations.length,
        rows: records.length,
        skus: result.totalSkus,
        idUnicos: result.totalIdUnicos
      });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  /**
   * Conserva compatibilidad temporal con consumidores del endpoint anterior.
   * @param {*} warehouse Bodega de piso.
   * @return {!Object} Contrato manual detallado.
   */
  function getCandidatesByWarehouse(warehouse) {
    return getManualRequestExcess(warehouse);
  }

  /**
   * Construye candidatos autoritativos por código y ubicación de surtido.
   * Solo incorpora combinaciones con producto activo y excedente vigente.
   */
  function buildCandidateMap_(warehouse) {
    return getManualRequestExcess(warehouse).registros.reduce(function(map, item) {
      const key = item.codigo + "|" + item.ubicacionSurtido;
      if (!map[key]) {
        map[key] = {
          codigo: item.codigo,
          descripcion: item.descripcion,
          ubicacionSurtido: item.ubicacionSurtido,
          bodegaKey: String(item.bodegaSurtido)
        };
      }
      return map;
    }, Object.create(null));
  }

  function normalizeCreationPayload_(payload, trace) {
    const input = payload && typeof payload === "object" ? payload : {};
    const applicant = validateUser_(input.solicitante, trace);
    const warehouse = normalizeSalesFloorWarehouse_(input.bodega);
    if (!warehouse) {
      throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO, "La bodega es obligatoria.");
    }
    const requested = Array.isArray(input.partidas) ? input.partidas : [];
    if (!requested.length) {
      throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO, "Debe seleccionar al menos un SKU.");
    }
    const maximum = Number(REABASTECIMIENTO_CONFIG.LIMITES.MAX_SKUS_POR_SOLICITUD || 99);
    if (requested.length > maximum) {
      throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.LIMITE_PARTIDAS_EXCEDIDO, "La solicitud excede el límite de SKU.");
    }
    const candidateMap = buildCandidateMap_(warehouse);
    const unique = Object.create(null);
    const items = requested.map(function(item, index) {
      const code = toStrUpper_(item && item.codigo);
      const location = toStrUpper_(item && item.ubicacion);
      const candidate = candidateMap[code + "|" + location];
      if (!candidate) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO, "Uno de los SKU ya no es elegible para reabastecimiento.", { index: index });
      }
      const key = code;
      if (unique[key]) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_DUPLICADA, "La solicitud contiene un código duplicado.");
      }
      unique[key] = true;
      return candidate;
    });
    return { solicitante: applicant.nombre, bodega: warehouse, partidas: items };
  }

  function createRequest(payload) {
    const trace = startTrace_("REABASTECIMIENTO_CREATE_REQUEST", {});
    try {
      assertDependencies_();
      const normalized = normalizeCreationPayload_(payload, trace);
      const result = withScriptLock_(
        "REABASTECIMIENTO_CREATE_REQUEST",
        function() {
          const temporal = getReabastecimientoTemporalContext_();
          const identity = ReabastecimientoSolicitudesRepository
            .createIdentityUnderLock(temporal, trace);
          const parts = normalized.partidas.map(function(item, index) {
            return {
              idSolicitud: identity.idSolicitud,
              idPartidaConsecutivo: padPositiveInteger_(
                index + 1,
                REABASTECIMIENTO_CONFIG.CONSECUTIVOS.PARTIDA_DIGITOS,
                "ID_PARTIDACONSECUTIVO"
              ),
              codigoSolicitado: item.codigo,
              descripcionSolicitada: item.descripcion,
              ubicacionSolicitada: item.ubicacionSurtido,
              estado: REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS.PENDIENTE,
              fechaAtencion: "",
              horaAtencion: "",
              usuarioAtencion: ""
            };
          });
          const header = {
            idSolicitud: identity.idSolicitud,
            idSolicitudConsecutivo: identity.idSolicitudConsecutivo,
            fechaCreacion: temporal.fecha,
            horaCreacion: temporal.hora,
            solicitante: normalized.solicitante,
            bodega: normalized.bodega,
            skusSolicitados: parts.length,
            fechaInicioAtencion: "",
            horaInicioAtencion: "",
            fechaCierreAtencion: "",
            horaCierreAtencion: "",
            cajasInvolucradas: ""
          };

          try {
            ReabastecimientoSolicitudesRepository.appendUnderLock(header, trace);
            ReabastecimientoPartidasRepository.appendManyUnderLock(parts, trace);

            const persistedHeader = ReabastecimientoSolicitudesRepository
              .getById(identity.idSolicitud, trace);
            const persistedParts = ReabastecimientoPartidasRepository
              .getBySolicitud(identity.idSolicitud, trace);
            if (!persistedHeader || persistedParts.length !== parts.length) {
              throw new Error(
                "No fue posible confirmar la persistencia completa de la solicitud."
              );
            }
          } catch (writeError) {
            let rollbackError = null;
            try {
              ReabastecimientoPartidasRepository.deleteBySolicitudUnderLock(
                identity.idSolicitud,
                trace
              );
              ReabastecimientoSolicitudesRepository.deleteByIdUnderLock(
                identity.idSolicitud,
                trace
              );
              perfMark_(trace, "CREATE_REQUEST_ROLLBACK_COMPLETED", {
                expectedParts: parts.length
              });
            } catch (compensationError) {
              rollbackError = compensationError;
              perfMark_(trace, "CREATE_REQUEST_ROLLBACK_FAILED", {
                errorName: toStr_(compensationError && compensationError.name)
              });
            }
            if (rollbackError) {
              const criticalError = new Error(
                "La creación falló y la reversión automática no pudo completarse. " +
                "Revise las hojas de Reabastecimiento antes de reintentar."
              );
              criticalError.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO;
              throw criticalError;
            }
            throw writeError;
          }

          return {
            idSolicitud: identity.idSolicitud,
            fechaCreacion: temporal.fecha,
            horaCreacion: temporal.hora,
            solicitante: normalized.solicitante,
            bodega: normalized.bodega,
            skusSolicitados: parts.length,
            estado: REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS.ABIERTA
          };
        },
        REABASTECIMIENTO_CONFIG.LIMITES.LOCK_TIMEOUT_MS,
        trace
      );
      clearReabastecimientoCaches_();
      finishTrace_(trace, { parts: result.skusSolicitados });
      return result;
    } catch (error) {
      clearReabastecimientoCaches_();
      failTrace_(trace, error);
      throw error;
    }
  }

  function getRequests(filters) {
    const trace = startTrace_("REABASTECIMIENTO_GET_REQUESTS", {});
    try {
      assertDependencies_();
      const config = filters && typeof filters === "object" ? filters : {};
      const stateFilter = toStrUpper_(config.estado);
      const warehouseFilter = toStrUpper_(config.bodega);
      const requestFilter = toStrUpper_(config.idSolicitud);
      const results = ReabastecimientoSolicitudesRepository.getAll(trace)
        .map(function(request) {
          return Object.assign({}, request, { estado: deriveRequestState_(request) });
        })
        .filter(function(request) {
          return (!stateFilter || request.estado === stateFilter) &&
            (!warehouseFilter || request.bodega === warehouseFilter) &&
            (!requestFilter || request.idSolicitud === requestFilter);
        })
        .sort(function(left, right) {
          return right.idSolicitud.localeCompare(left.idSolicitud, CFG.LOCALE, {
            numeric: true,
            sensitivity: "base"
          });
        });
      finishTrace_(trace, { rows: results.length });
      return results;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  function getRequestDetail(idSolicitud) {
    const trace = startTrace_("REABASTECIMIENTO_GET_REQUEST_DETAIL", {});
    try {
      assertDependencies_();
      const id = toStrUpper_(idSolicitud);
      const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
      if (!request) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_NO_ENCONTRADA, "La solicitud no existe.");
      }
      const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
      const details = ReabastecimientoDetallesRepository.getBySolicitud(id, trace);
      const detailsByCode = details.reduce(function(map, item) {
        const code = toStrUpper_(item.codigo);
        if (!map[code]) map[code] = [];
        map[code].push(item);
        return map;
      }, Object.create(null));
      const result = {
        solicitud: Object.assign({}, request, { estado: deriveRequestState_(request) }),
        partidas: parts.map(function(part) {
          return Object.assign({}, part, {
            detalles: detailsByCode[toStrUpper_(part.codigoSolicitado)] || [],
            cajasEscaneadas:
              (detailsByCode[toStrUpper_(part.codigoSolicitado)] || []).length
          });
        }),
        totalPartidas: parts.length,
        totalDetalles: details.length,
        cajasUnicas: ReabastecimientoDetallesRepository.countUniqueBoxes(id, trace)
      };
      finishTrace_(trace, { parts: result.totalPartidas, details: result.totalDetalles });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  function attendPart(payload) {
    const trace = startTrace_("REABASTECIMIENTO_ATTEND_PART", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const partId = toStr_(input.idPartidaConsecutivo);
      const user = validateUser_(input.usuario, trace);
      if (!id || !partId) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO, "Solicitud y partida son obligatorias.");
      }
      const result = withScriptLock_(
        "REABASTECIMIENTO_ATTEND_PART",
        function() {
          const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
          if (!request) throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_NO_ENCONTRADA, "La solicitud no existe.");
          const state = deriveRequestState_(request);
          if (state === REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS.CERRADA) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_CERRADA, "La solicitud ya está cerrada.");
          }
          if (state === REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS.INCONSISTENTE) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_INCONSISTENTE, "La solicitud tiene marcas temporales inconsistentes.");
          }
          const temporal = getReabastecimientoTemporalContext_();
          const update = ReabastecimientoPartidasRepository.markAttendedUnderLock(id, partId, temporal, user.nombre, trace);
          if (!request.fechaInicioAtencion && !request.horaInicioAtencion) {
            ReabastecimientoSolicitudesRepository.updateTemporalFieldsUnderLock(id, {
              fechaInicioAtencion: temporal.fecha,
              horaInicioAtencion: temporal.hora
            }, trace);
          }
          return {
            idSolicitud: id,
            idPartidaConsecutivo: partId,
            atendida: true,
            yaAtendida: update.alreadyAttended === true,
            fechaAtencion: temporal.fecha,
            horaAtencion: temporal.hora,
            usuarioAtencion: user.nombre
          };
        },
        REABASTECIMIENTO_CONFIG.LIMITES.LOCK_TIMEOUT_MS,
        trace
      );
      clearReabastecimientoCaches_();
      finishTrace_(trace, { alreadyAttended: result.yaAtendida });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  function resolveIdUnico_(idUnico) {
    const token = toStr_(idUnico);
    if (!token) {
      throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_REQUERIDO, "El IDUNICO es obligatorio.");
    }
    const state = EstadoActualExcedentesService.getUnoPorIdUnico(token);
    if (!state || state.existeBD !== true) {
      throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_NO_ENCONTRADO, "El IDUNICO no existe en excedentes.");
    }
    if (state.validoBD !== true || state.vigente !== true || toNum_(state.saldoActual) <= 0) {
      throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_SIN_SALDO, "El IDUNICO no tiene saldo vigente disponible.");
    }
    return state;
  }

  function validateIdUnico(payload) {
    const trace = startTrace_("REABASTECIMIENTO_VALIDATE_IDUNICO", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const partId = toStr_(input.idPartidaConsecutivo);
      const detail = getRequestDetail(id);
      const part = detail.partidas.find(function(item) { return item.idPartidaConsecutivo === partId; });
      if (!part) throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_NO_ENCONTRADA, "La partida no existe.");
      if (detail.solicitud.estado === REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS.CERRADA) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_CERRADA, "La solicitud ya está cerrada.");
      }
      const state = resolveIdUnico_(input.idUnico);
      if (toStrUpper_(state.codigo) !== toStrUpper_(part.codigoSolicitado)) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_CODIGO_INCORRECTO, "El IDUNICO no corresponde al código de la partida.");
      }
      if (ReabastecimientoDetallesRepository.hasIdUnicoInSolicitud(id, state.idUnico, trace)) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_DUPLICADO, "El IDUNICO ya fue registrado en esta solicitud.");
      }
      const result = {
        valido: true,
        idUnico: toStr_(state.idUnico),
        codigo: toStrUpper_(state.codigo),
        descripcion: toStrUpper_(state.descripcion),
        cantidad: toNum_(state.saldoActual),
        bodega: toStrUpper_(state.bodegaActual),
        ubicacion: toStrUpper_(state.ubicacionActual)
      };
      finishTrace_(trace, { valid: true });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  function registerIdUnico(payload) {
    const trace = startTrace_("REABASTECIMIENTO_REGISTER_IDUNICO", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const partId = toStr_(input.idPartidaConsecutivo);
      const user = validateUser_(input.usuario, trace);
      const result = withScriptLock_(
        "REABASTECIMIENTO_REGISTER_IDUNICO",
        function() {
          const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
          if (!request) throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_NO_ENCONTRADA, "La solicitud no existe.");
          const requestState = deriveRequestState_(request);
          if (requestState === REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS.CERRADA) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_CERRADA, "La solicitud ya está cerrada.");
          }
          const part = ReabastecimientoPartidasRepository.getByKey(id, partId, trace);
          if (!part) throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_NO_ENCONTRADA, "La partida no existe.");
          const state = resolveIdUnico_(input.idUnico);
          if (toStrUpper_(state.codigo) !== toStrUpper_(part.codigoSolicitado)) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_CODIGO_INCORRECTO, "El IDUNICO no corresponde al código de la partida.");
          }
          if (ReabastecimientoDetallesRepository.hasIdUnicoInSolicitud(id, state.idUnico, trace)) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_DUPLICADO, "El IDUNICO ya fue registrado en esta solicitud.");
          }
          const temporal = getReabastecimientoTemporalContext_();
          const sequence =
            ReabastecimientoDetallesRepository.nextDetailConsecutiveUnderLock(
              id,
              trace
            );
          ReabastecimientoDetallesRepository.appendUnderLock({
            idSolicitud: id,
            idDetalleConsecutivo: sequence,
            idUnico: state.idUnico,
            codigo: state.codigo,
            descripcion: state.descripcion,
            cantidad: state.saldoActual,
            fechaEscaneo: temporal.fecha,
            horaEscaneo: temporal.hora,
            usuarioResponsable: user.nombre
          }, trace);
          return {
            idSolicitud: id,
            idPartidaConsecutivo: partId,
            idDetalleConsecutivo: sequence,
            idUnico: toStr_(state.idUnico),
            codigo: toStrUpper_(state.codigo),
            descripcion: toStrUpper_(state.descripcion),
            cantidad: toNum_(state.saldoActual),
            fechaEscaneo: temporal.fecha,
            horaEscaneo: temporal.hora,
            usuarioResponsable: user.nombre
          };
        },
        REABASTECIMIENTO_CONFIG.LIMITES.LOCK_TIMEOUT_MS,
        trace
      );
      clearReabastecimientoCaches_();
      finishTrace_(trace, { created: true });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  function closeRequest(payload) {
    const trace = startTrace_("REABASTECIMIENTO_CLOSE_REQUEST", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      validateUser_(input.usuario, trace);
      const result = withScriptLock_(
        "REABASTECIMIENTO_CLOSE_REQUEST",
        function() {
          const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
          if (!request) throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_NO_ENCONTRADA, "La solicitud no existe.");
          const currentState = deriveRequestState_(request);
          if (currentState === REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS.CERRADA) {
            return {
              idSolicitud: id,
              cerrada: true,
              yaCerrada: true,
              cajasInvolucradas: toNum_(request.cajasInvolucradas),
              fechaCierre: request.fechaCierreAtencion,
              horaCierre: request.horaCierreAtencion
            };
          }
          if (currentState === REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS.INCONSISTENTE) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_INCONSISTENTE, "La solicitud tiene marcas temporales inconsistentes.");
          }
          const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
          if (!parts.length || parts.some(function(part) {
            return part.estado !== REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS.ATENDIDO;
          })) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.TRANSICION_INVALIDA, "Todas las partidas deben estar atendidas antes del cierre.");
          }
          const boxes = ReabastecimientoDetallesRepository.countUniqueBoxes(id, trace);
          if (boxes < 1) {
            throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.TRANSICION_INVALIDA, "La solicitud requiere al menos un IDUNICO escaneado.");
          }
          const temporal = getReabastecimientoTemporalContext_();
          ReabastecimientoSolicitudesRepository.updateTemporalFieldsUnderLock(id, {
            fechaCierreAtencion: temporal.fecha,
            horaCierreAtencion: temporal.hora,
            cajasInvolucradas: boxes
          }, trace);
          return {
            idSolicitud: id,
            cerrada: true,
            yaCerrada: false,
            cajasInvolucradas: boxes,
            fechaCierre: temporal.fecha,
            horaCierre: temporal.hora
          };
        },
        REABASTECIMIENTO_CONFIG.LIMITES.LOCK_TIMEOUT_MS,
        trace
      );
      clearReabastecimientoCaches_();
      finishTrace_(trace, { boxes: result.cajasInvolucradas, alreadyClosed: result.yaCerrada });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  function clearCache() {
    return clearReabastecimientoCaches_();
  }

  return Object.freeze({
    getExcedentesSolicitudManual: getManualRequestExcess,
    getCandidatosPorBodega: getCandidatesByWarehouse,
    crearSolicitud: createRequest,
    getSolicitudes: getRequests,
    getDetalleSolicitud: getRequestDetail,
    atenderPartida: attendPart,
    validarIdUnico: validateIdUnico,
    registrarIdUnico: registerIdUnico,
    cerrarSolicitud: closeRequest,
    derivarEstadoSolicitud: deriveRequestState_,
    clearCache
  });
})();
