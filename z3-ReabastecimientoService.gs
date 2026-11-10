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
 * - REABASTECIMIENTO_DETALLES: una fila por IDUNICO escaneado.
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
 * - MonitorReabastecimientoService.
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
 * @version REABASTECIMIENTO-SERVICE-2026-11-10-01
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
      ["MonitorReabastecimientoService", typeof MonitorReabastecimientoService],
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

  function normalizeWarehouseFilter_(warehouse) {
    const normalized = toStrUpper_(warehouse);
    return normalized || CFG.ALL_WAREHOUSES;
  }

  function isEligibleCandidate_(item, warehouse) {
    const warehouseFilter = normalizeWarehouseFilter_(warehouse);
    const matchesWarehouse = warehouseFilter === CFG.ALL_WAREHOUSES ||
      toStrUpper_(item && item.bodegakey) === warehouseFilter ||
      toStrUpper_(item && item.bodegalabel) === warehouseFilter;
    return Boolean(
      matchesWarehouse &&
      toStrUpper_(item && item.statuscatalogo) === "ACTIVO" &&
      toStrUpper_(item && item.ubicacionsurtido) &&
      toNum_(item && item.cantidadobjetivorelleno) > 0 &&
      toNum_(item && item.excedenteTotalIdUnico) > 0 &&
      CFG.ELIGIBLE_ACTIONS.includes(toStrUpper_(item && item.accionoperativa))
    );
  }

  function projectCandidate_(item) {
    return {
      codigo: toStrUpper_(item.codigo),
      descripcion: toStrUpper_(item.descripcion),
      ubicacionSurtido: toStrUpper_(item.ubicacionsurtido),
      bodegaKey: toStrUpper_(item.bodegakey),
      bodegaLabel: toStrUpper_(item.bodegalabel),
      existenciaActual: toNum_(item.existenciaactual),
      minimo: toNum_(item.minimo),
      maximo: toNum_(item.maximo),
      cantidadObjetivoRelleno: toNum_(item.cantidadobjetivorelleno),
      excedenteDisponibleIdUnico: toNum_(item.excedenteTotalIdUnico),
      accionOperativa: toStrUpper_(item.accionoperativa),
      prioridadOrden: toNum_(item.prioridadorden),
      prioridadEtiqueta: toStrUpper_(item.prioridadetiqueta)
    };
  }

  function getCandidatesByWarehouse(warehouse) {
    const trace = startTrace_("REABASTECIMIENTO_GET_CANDIDATES", {});
    try {
      assertDependencies_();
      const normalizedWarehouse = normalizeWarehouseFilter_(warehouse);
      const source = MonitorReabastecimientoService.getRegistros();
      if (!Array.isArray(source)) throw new TypeError("El monitor debe devolver un arreglo.");
      const records = source
        .filter(function(item) { return isEligibleCandidate_(item, normalizedWarehouse); })
        .map(projectCandidate_)
        .sort(function(left, right) {
          return left.prioridadOrden - right.prioridadOrden ||
            left.codigo.localeCompare(right.codigo, CFG.LOCALE, {
              numeric: true,
              sensitivity: "base"
            });
        });
      finishTrace_(trace, { sourceRows: source.length, resultRows: records.length });
      return {
        bodega: normalizedWarehouse,
        registros: records,
        total: records.length,
        reglas: {
          catalogoActivo: true,
          requiereUbicacion: true,
          requiereObjetivoPositivo: true,
          requiereExcedenteIdUnico: true,
          accionesPermitidas: CFG.ELIGIBLE_ACTIONS.slice()
        }
      };
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  function buildCandidateMap_(warehouse) {
    return getCandidatesByWarehouse(warehouse).registros.reduce(function(map, item) {
      map[item.codigo + "|" + item.ubicacionSurtido] = item;
      return map;
    }, Object.create(null));
  }

  function normalizeCreationPayload_(payload, trace) {
    const input = payload && typeof payload === "object" ? payload : {};
    const applicant = validateUser_(input.solicitante, trace);
    const warehouse = toStrUpper_(input.bodega);
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
      const key = code + "|" + location;
      if (unique[key]) {
        throw domainError_(REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_DUPLICADA, "La solicitud contiene SKU y ubicación duplicados.");
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
          const identity = ReabastecimientoSolicitudesRepository.createIdentityUnderLock(temporal, trace);
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
          ReabastecimientoPartidasRepository.appendManyUnderLock(parts, trace);
          ReabastecimientoSolicitudesRepository.appendUnderLock({
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
          }, trace);
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
      const detailsByPart = details.reduce(function(map, item) {
        if (!map[item.idPartidaConsecutivo]) map[item.idPartidaConsecutivo] = [];
        map[item.idPartidaConsecutivo].push(item);
        return map;
      }, Object.create(null));
      const result = {
        solicitud: Object.assign({}, request, { estado: deriveRequestState_(request) }),
        partidas: parts.map(function(part) {
          return Object.assign({}, part, {
            detalles: detailsByPart[part.idPartidaConsecutivo] || [],
            cajasEscaneadas: (detailsByPart[part.idPartidaConsecutivo] || []).length
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
          const sequence = ReabastecimientoDetallesRepository.nextDetailConsecutiveUnderLock(id, partId, trace);
          ReabastecimientoDetallesRepository.appendUnderLock({
            idSolicitud: id,
            idPartidaConsecutivo: partId,
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
