/**
 * z3-ReabastecimientoService.gs
 *
 * @fileoverview Servicio de dominio del proceso REABASTECIMIENTO-v1: rondín,
 * creación de solicitudes, toma de la solicitud, atención por SKU, surtido de
 * excedentes integrado con Bitacora-TRASPASOS y cierre controlado.
 *
 * MODELO
 * - REABASTECIMIENTO_SOLICITUDES: una fila por ticket (bodega + área).
 * - REABASTECIMIENTO_PARTIDAS: una fila por SKU y ubicación de consumo.
 * - REABASTECIMIENTO_DETALLES: una fila por IDUNICO surtido; se vincula con la
 *   partida mediante ID_SOLICITUD + código.
 * - Las columnas se resuelven por nombre de encabezado en los Repositories.
 *
 * FLUJO (proceso 1 y 2)
 * 1. Rondín: bodega de piso (UBICACIONES_SURTIDO.ZONA) y área de suministro
 *    (UBICACIONES_SURTIDO.PASILLO). Se muestran SKU con excedentes vigentes.
 * 2. Crear solicitud: estado CREADA, partidas PENDIENTE.
 * 3. ATENDER (tomarSolicitud): registra auxiliar, fecha y hora de inicio.
 *    Estado ASIGNADA. Cada auxiliar que participa se agrega a la lista.
 * 4. MOSTRAR UBICACIONES: la partida pasa a EN_ATENCION y se listan las cajas
 *    surtibles ordenadas por bodega, ubicación, antigüedad e identificador.
 * 5. REGISTRAR: valida la etiqueta y aplica un movimiento SURTIDO total o
 *    parcial en Bitacora-TRASPASOS mediante PrototipoTraspasosService dentro del
 *    mismo ScriptLock. Un surtido parcial devuelve la etiqueta del remanente con
 *    el mismo IDUNICO.
 * 6. Concluir SKU: ATENDIDO o ATENDIDO_PARCIAL (requiere al menos una caja).
 * 7. CERRAR SOLICITUD: sin pendientes queda CERRADA; con SKU sin concluir exige
 *    motivo y queda CERRADA_CON_PENDIENTES. Se registra el usuario del cierre.
 *
 * REGLAS PRINCIPALES
 * - El estado de la solicitud se deriva de sus marcas y del estado de partidas.
 * - Folios, consecutivos, fechas, horas, saldos y conteos se generan en servidor.
 * - El navegador nunca es autoridad para código, ubicación, saldo, estado,
 *   fecha ni hora. El usuario se valida contra USUARIOS.
 * - Toda escritura y revalidación crítica ocurre bajo un único ScriptLock.
 *
 * DEPENDENCIAS
 * - CatalogoRepository, UsuariosRepository, UbicacionesSurtidoRepository.
 * - EstadoActualExcedentesService y PrototipoTraspasosService.
 * - Repositories de solicitudes, partidas y detalles de Reabastecimiento.
 * - Utilidades declaradas en z0-UtilidadesDatos.gs.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REABASTECIMIENTO-SERVICE-2026-11-19-01
 */
const ReabastecimientoService = (() => {
  "use strict";

  const CFG = Object.freeze({
    MODULE: "REABASTECIMIENTO",
    LOG_PREFIX: "[ReabastecimientoService]",
    LOCALE: "es-MX",
    ALL_WAREHOUSES: "TODAS",
    NO_AREA_LABEL: "SIN PASILLO",
    AREA_PREFIX: "PASILLO ",
    OPERATION_PREFIX: "REA-"
  });

  const RC = REABASTECIMIENTO_CONFIG;
  const ERR = RC.ERROR_CODES;
  const STATES = RC.SOLICITUD_ESTADOS_DERIVADOS;
  const PART = RC.PARTIDA_ESTADOS;

  // ==========================================================================
  // INFRAESTRUCTURA
  // ==========================================================================

  function domainError_(code, message, details) {
    const error = new Error(String(message || "Error de Reabastecimiento."));
    error.name = "ReabastecimientoDomainError";
    error.code = String(code || ERR.PAYLOAD_INVALIDO);
    if (details && typeof details === "object") error.details = details;
    return error;
  }

  function assertDependencies_() {
    const requiredFunctions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_],
      ["round2_", typeof round2_],
      ["compareEs_", typeof compareEs_],
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
      ["PrototipoTraspasosService", typeof PrototipoTraspasosService],
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

  /**
   * Cierra la traza. perfEnd_() la entrega al colector de la ejecución cuando
   * el switch APPALMACEN_RENDIMIENTO.ENABLED está activo, y el Controller la
   * devuelve al navegador (response.metadata.perf).
   */
  function finishTrace_(trace, metadata) {
    return perfEnd_(trace, "ok", metadata || {});
  }

  function failTrace_(trace, error) {
    perfFail_(trace, error, {
      code: toStr_(error && error.code),
      errorName: toStr_(error && error.name)
    });
  }

  /**
   * Mide una consulta a otro módulo como etapa de la traza.
   * Ejemplo de etapa: "SRC_ESTADO_EXCEDENTES" con elapsedMs y rows.
   */
  function measure_(trace, stage, executor) {
    const startedAt = Date.now();
    const result = executor();
    perfMark_(trace, stage, {
      elapsedMs: Date.now() - startedAt,
      rows: Array.isArray(result) ? result.length : undefined
    });
    return result;
  }

  /** Ejecuta un bloque de escritura bajo el ScriptLock global. */
  function underLock_(label, executor, trace) {
    return withScriptLock_(label, executor, RC.LIMITES.LOCK_TIMEOUT_MS, trace);
  }

  /** Repositorios cuyas hojas tienen copia en caché etiquetada por revisión. */
  function tableRepositories_() {
    return [
      ReabastecimientoSolicitudesRepository,
      ReabastecimientoPartidasRepository,
      ReabastecimientoDetallesRepository
    ].filter(function(repository) {
      return repository && typeof repository.hasPendingWrites === "function";
    });
  }

  /**
   * Confirma y anuncia una escritura. Debe llamarse DENTRO del candado de la
   * escritura, después de escribir.
   *
   * Pasos (cada uno medido por separado en REVISION_BUMPED):
   * 1. flushMs:   SpreadsheetApp.flush(). Otra ejecución que vea la revisión
   *               nueva y lea la hoja debe encontrar ya la escritura. La
   *               liberación del candado haría este flush de todos modos.
   * 2. storeMs:   sube la revisión global, la del folio y la de cada hoja
   *               escrita (solo CacheService, ver z0-ReabastecimientoTelemetria).
   * 3. publishMs: publica el espejo de cada hoja escrita con su revisión nueva,
   *               para que la siguiente consulta no relea la hoja.
   *
   * @param {string} idSolicitud Folio afectado.
   * @param {Object=} trace Traza activa.
   * @return {?Object} Resultado de reabRevisionBump_.
   */
  function bumpRevision_(idSolicitud, trace) {
    if (typeof reabRevisionBump_ !== "function") return null;
    const startedAt = Date.now();
    const written = tableRepositories_().filter(function(repository) {
      return repository.hasPendingWrites();
    });

    SpreadsheetApp.flush();
    const flushedAt = Date.now();

    const revision = reabRevisionBump_(idSolicitud, written.map(function(repository) {
      return repository.sheetKey;
    }));
    const storedAt = Date.now();

    let published = 0;
    written.forEach(function(repository) {
      const tableRevision = revision && revision.tables ? revision.tables[repository.sheetKey] : null;
      if (tableRevision && repository.publishSnapshot(tableRevision, trace)) published += 1;
    });

    perfMark_(trace, "REVISION_BUMPED", {
      elapsedMs: Date.now() - startedAt,
      flushMs: flushedAt - startedAt,
      storeMs: storedAt - flushedAt,
      publishMs: Date.now() - storedAt,
      revision: revision.revision,
      tables: written.length,
      published: published
    });
    return revision;
  }

  // ==========================================================================
  // USUARIOS
  // ==========================================================================

  /** Clave y vigencia de la caché del catálogo de usuarios. */
  const USERS_CACHE_KEY = "APPALMACEN_REAB_USUARIOS_V1";
  const USERS_CACHE_TTL_SECONDS = 21600;

  /**
   * Catálogo de usuarios desde CacheService (6 horas) con respaldo en la hoja
   * USUARIOS.
   *
   * RENDIMIENTO: leer USUARIOS cuesta ≈1.1 s (bitácora 20/11/2026). La lista
   * cambia poco, así que se guarda 6 horas. Se relee al momento cuando:
   * - un nombre no aparece en la copia (usuario recién dado de alta), o
   * - se pulsa "Actualizar catálogos" en el rondín (clearUsersCache_).
   * Prototipo: la validación solo confirma que el nombre exista.
   *
   * @param {Object=} trace Traza activa.
   * @param {boolean=} fresh true = ignora la copia y relee la hoja.
   * @return {!Array<{idusuario:number,nombre:string,rol:string}>}
   */
  function readUsersCatalog_(trace, fresh) {
    const startedAt = Date.now();
    try {
      const cached = fresh === true ? null : CacheService.getScriptCache().get(USERS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          perfMark_(trace, "USERS_CACHE_HIT", { rows: parsed.length, elapsedMs: Date.now() - startedAt });
          return parsed;
        }
      }
    } catch (error) {
      /* caché no disponible: se lee la hoja */
    }
    const users = UsuariosRepository.getAll().map(function(user) {
      return { idusuario: user.idusuario, nombre: toStrUpper_(user.nombre), rol: toStrUpper_(user.rol) };
    });
    try {
      CacheService.getScriptCache().put(USERS_CACHE_KEY, JSON.stringify(users), USERS_CACHE_TTL_SECONDS);
    } catch (error) {
      /* si la caché falla, la siguiente llamada vuelve a leer la hoja */
    }
    perfMark_(trace, "USERS_CACHE_MISS", { rows: users.length, elapsedMs: Date.now() - startedAt, fresh: fresh === true });
    return users;
  }

  /** Descarta la copia del catálogo de usuarios (Actualizar catálogos). */
  function clearUsersCache_() {
    try {
      CacheService.getScriptCache().remove(USERS_CACHE_KEY);
    } catch (error) {
      /* sin acción */
    }
  }

  function validateUser_(name, trace) {
    const normalized = toStrUpper_(name);
    if (!normalized) {
      throw domainError_(ERR.USUARIO_REQUERIDO, "Selecciona tu usuario antes de continuar.");
    }
    const byName = function(user) { return user.nombre === normalized; };
    let matches = readUsersCatalog_(trace).filter(byName);
    if (!matches.length) {
      // Puede ser un usuario dado de alta después de guardar la copia.
      matches = readUsersCatalog_(trace, true).filter(byName);
    }
    if (!Array.isArray(matches) || matches.length === 0) {
      throw domainError_(ERR.USUARIO_NO_ENCONTRADO, "El usuario no existe en el catálogo autorizado.");
    }
    if (matches.length > 1) {
      throw domainError_(ERR.USUARIO_NO_ENCONTRADO, "El usuario es ambiguo porque existen registros duplicados.");
    }
    return matches[0];
  }

  /** Agrega un usuario a la lista de auxiliares sin duplicarlo. */
  function withAuxiliary_(list, userName) {
    const result = (Array.isArray(list) ? list : []).map(toStrUpper_).filter(Boolean);
    const name = toStrUpper_(userName);
    if (name && result.indexOf(name) === -1) result.push(name);
    return result;
  }

  // ==========================================================================
  // FECHAS Y TIEMPOS
  // ==========================================================================

  function serializeTemporalValue_(value, pattern) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return Utilities.formatDate(value, getScriptTz_(), pattern);
    }
    return toStr_(value);
  }

  /** Convierte fecha dd/MM/yyyy y hora HH:mm a minutos absolutos comparables. */
  function toAbsoluteMinutes_(fecha, hora) {
    const dateText = serializeTemporalValue_(fecha, "dd/MM/yyyy");
    const timeText = serializeTemporalValue_(hora, "HH:mm");
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateText);
    const t = /^(\d{1,2}):(\d{2})/.exec(timeText);
    if (!d || !t) return null;
    const utc = Date.UTC(Number(d[3]), Number(d[2]) - 1, Number(d[1]), Number(t[1]), Number(t[2]));
    return Math.floor(utc / 60000);
  }

  /**
   * Minutos absolutos de "ahora" en la zona horaria del script.
   *
   * RENDIMIENTO: Utilities.formatDate es costoso (~2 ms por llamada). El rondín
   * calcula la antigüedad de miles de cajas; sin esta memoria se invocaba dos
   * veces por caja y sumaba 9–15 s por consulta (bitácora 20/11/2026). El valor
   * se conserva 30 s, suficiente para una ejecución completa.
   */
  let nowMemo_ = { at: 0, minutes: null };
  function nowAbsoluteMinutes_() {
    const nowMs = Date.now();
    if (nowMemo_.minutes != null && nowMs - nowMemo_.at < 30000) return nowMemo_.minutes;
    const now = new Date(nowMs);
    const minutes = toAbsoluteMinutes_(
      Utilities.formatDate(now, getScriptTz_(), "dd/MM/yyyy"),
      Utilities.formatDate(now, getScriptTz_(), "HH:mm")
    );
    nowMemo_ = { at: nowMs, minutes: minutes };
    return minutes;
  }

  function formatAbsoluteMinutes_(minutes) {
    if (minutes == null || !isFinite(minutes)) return "";
    const date = new Date(minutes * 60000);
    const pad = function(value) { return String(value).padStart(2, "0"); };
    return pad(date.getUTCDate()) + "/" + pad(date.getUTCMonth() + 1) + "/" +
      date.getUTCFullYear() + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
  }

  /**
   * Días transcurridos desde una fecha dd/MM/yyyy.
   * Las fechas ya vienen como texto del consolidado; solo se aplica una
   * expresión regular, sin formatear fechas por cada caja.
   */
  function ageInDays_(fecha) {
    const start = toAbsoluteMinutes_(fecha, "00:00");
    const now = nowAbsoluteMinutes_();
    if (start == null || now == null) return null;
    return Math.max(0, Math.floor((now - start) / 1440));
  }

  // ==========================================================================
  // ESTADOS
  // ==========================================================================

  function hasStart_(request) {
    return Boolean(request && request.fechaInicioAtencion && request.horaInicioAtencion);
  }

  function isConcluded_(part) {
    return RC.PARTIDA_ESTADOS_CONCLUIDOS.indexOf(toStrUpper_(part && part.estado)) !== -1;
  }

  /** Cuenta partidas por estado operativo. */
  function countParts_(parts) {
    const counts = { total: 0, pendientes: 0, enAtencion: 0, atendidos: 0, parciales: 0, concluidos: 0 };
    (Array.isArray(parts) ? parts : []).forEach(function(part) {
      counts.total += 1;
      const state = toStrUpper_(part.estado);
      if (state === PART.ATENDIDO) counts.atendidos += 1;
      else if (state === PART.ATENDIDO_PARCIAL) counts.parciales += 1;
      else if (state === PART.EN_ATENCION) counts.enAtencion += 1;
      else counts.pendientes += 1;
    });
    counts.concluidos = counts.atendidos + counts.parciales;
    return counts;
  }

  /**
   * Deriva el estado de la solicitud a partir de sus marcas y partidas.
   *
   * @param {!Object} request Cabecera.
   * @param {Array<!Object>=} parts Partidas; si se omiten se usa EN_ATENCION
   *     para solicitudes tomadas (compatibilidad con consumidores anteriores).
   * @return {string} Estado derivado.
   */
  function deriveRequestState_(request, parts) {
    const startDate = Boolean(request && request.fechaInicioAtencion);
    const startTime = Boolean(request && request.horaInicioAtencion);
    const closeDate = Boolean(request && request.fechaCierreAtencion);
    const closeTime = Boolean(request && request.horaCierreAtencion);
    const hasStart = startDate && startTime;
    const hasClose = closeDate && closeTime;
    if (startDate !== startTime || closeDate !== closeTime || (hasClose && !hasStart)) {
      return STATES.INCONSISTENTE;
    }
    if (hasClose) {
      return request.cierreConPendientes === true ? STATES.CERRADA_CON_PENDIENTES : STATES.CERRADA;
    }
    if (!hasStart) return STATES.CREADA;
    if (!Array.isArray(parts)) return STATES.EN_ATENCION;
    const counts = countParts_(parts);
    if (counts.total > 0 && counts.concluidos === counts.total) return STATES.ATENDIDA;
    if (counts.concluidos > 0) return STATES.PARCIALMENTE_ATENDIDA;
    if (counts.enAtencion > 0) return STATES.EN_ATENCION;
    return STATES.ASIGNADA;
  }

  function isClosedState_(state) {
    return state === STATES.CERRADA || state === STATES.CERRADA_CON_PENDIENTES;
  }

  /** Rechaza operaciones sobre solicitudes cerradas o con datos inválidos. */
  function assertOperable_(request, parts, options) {
    if (!request) {
      throw domainError_(ERR.SOLICITUD_NO_ENCONTRADA, "La solicitud no existe.");
    }
    const state = deriveRequestState_(request, parts);
    if (isClosedState_(state)) {
      throw domainError_(ERR.SOLICITUD_CERRADA, "La solicitud está cerrada y bloqueada; no admite cambios.");
    }
    if (state === STATES.INCONSISTENTE) {
      throw domainError_(ERR.SOLICITUD_INCONSISTENTE, "La solicitud tiene marcas de atención inválidas; repórtala al administrador.");
    }
    if (options && options.requireTaken === true && !hasStart_(request)) {
      throw domainError_(ERR.SOLICITUD_NO_TOMADA, "Primero toma la solicitud con el botón ATENDER.");
    }
    return state;
  }

  // ==========================================================================
  // BODEGAS Y ÁREAS DE SUMINISTRO
  // ==========================================================================

  /** Catálogo canónico de bodegas de piso. */
  const SALES_FLOOR_WAREHOUSES = Object.freeze({
    B1: Object.freeze({ id: "B1", label: "BODEGA 1" }),
    B2: Object.freeze({ id: "B2", label: "BODEGA 2" }),
    B3: Object.freeze({ id: "B3", label: "BODEGA 3" }),
    MO: Object.freeze({ id: "MO", label: "MOSTRADOR" }),
    CU: Object.freeze({ id: "CU", label: "CUARTO ALTO VALOR" })
  });

  function normalizeSalesFloorWarehouse_(warehouse) {
    const value = toStrUpper_(warehouse);
    if (Object.prototype.hasOwnProperty.call(SALES_FLOOR_WAREHOUSES, value)) return value;
    const byLabel = Object.keys(SALES_FLOOR_WAREHOUSES).find(function(key) {
      return SALES_FLOOR_WAREHOUSES[key].label === value;
    });
    return byLabel || "";
  }

  function getSalesFloorWarehouseLabel_(warehouse) {
    const key = normalizeSalesFloorWarehouse_(warehouse);
    return key ? SALES_FLOOR_WAREHOUSES[key].label : toStrUpper_(warehouse);
  }

  /** Infiere la bodega por el prefijo de UBICACION (respaldo de ZONA). */
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

  /**
   * Bodega de piso de una ubicación de surtido. ZONA (1..5) es la autoridad;
   * el prefijo de UBICACION se usa cuando ZONA está vacía o fuera de catálogo.
   */
  function resolveSupplyWarehouse_(supply) {
    const location = toStrUpper_(supply && supply.ubicacion);
    if (location.startsWith("BA") || location.startsWith("CB")) return "";
    const zone = String(Math.floor(toNum_(supply && supply.bodega)) || "");
    return RC.ZONAS_BODEGA[zone] || inferSalesFloorWarehouse_(location);
  }

  /** Área de suministro derivada de UBICACIONES_SURTIDO.PASILLO. */
  function resolveSupplyArea_(supply) {
    const aisle = Math.floor(toNum_(supply && supply.pasillo));
    return aisle > 0 ? CFG.AREA_PREFIX + aisle : CFG.NO_AREA_LABEL;
  }

  function compareArea_(left, right) {
    return toStrUpper_(left).localeCompare(toStrUpper_(right), CFG.LOCALE, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function compareSupplyLocation_(left, right) {
    return compareArea_(left, right);
  }

  /** Bodegas disponibles y áreas de suministro por bodega. */
  /**
   * Lee UBICACIONES_SURTIDO una sola vez por operación, sin ordenar.
   * @return {!Array<!Object>}
   */
  function readSupplyLocations_(trace) {
    return measure_(trace, "SRC_UBICACIONES_SURTIDO", function() {
      return typeof UbicacionesSurtidoRepository.getAllRaw === "function"
        ? UbicacionesSurtidoRepository.getAllRaw()
        : UbicacionesSurtidoRepository.getAll();
    });
  }

  /**
   * Bodegas y áreas de suministro disponibles.
   * @param {Object} trace Traza activa.
   * @param {Array<!Object>=} supplyRows Filas ya leídas (evita releer la hoja).
   */
  function getSalesFloorCatalog_(trace, supplyRows) {
    const areasByWarehouse = Object.create(null);
    (Array.isArray(supplyRows) ? supplyRows : readSupplyLocations_(trace)).forEach(function(item) {
      const warehouse = resolveSupplyWarehouse_(item);
      if (!warehouse) return;
      if (!areasByWarehouse[warehouse]) areasByWarehouse[warehouse] = Object.create(null);
      areasByWarehouse[warehouse][resolveSupplyArea_(item)] = true;
    });
    const warehouses = Object.keys(SALES_FLOOR_WAREHOUSES)
      .filter(function(key) { return Boolean(areasByWarehouse[key]); })
      .map(function(key) {
        return {
          id: SALES_FLOOR_WAREHOUSES[key].id,
          label: SALES_FLOOR_WAREHOUSES[key].label,
          areas: Object.keys(areasByWarehouse[key]).sort(compareArea_)
        };
      });
    return warehouses;
  }

  // ==========================================================================
  // EXCEDENTES
  // ==========================================================================

  function buildActiveCatalogIndex_(trace) {
    return indexActiveCatalog_(measure_(trace, "SRC_CATALOGO", function() {
      return CatalogoRepository.getAllRaw();
    }));
  }

  /** Índice código → producto ACTIVO de una lista de productos. */
  function indexActiveCatalog_(products) {
    return (Array.isArray(products) ? products : []).reduce(function(index, product) {
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

  /** Indica si el estatus de BD-EXCEDENTES permite surtir (ACOMODADO). */
  function isSurtibleStatus_(status) {
    const value = toStrUpper_(status);
    return value === "" || RC.ESTATUS_EXCEDENTE_SURTIBLES.indexOf(value) !== -1;
  }

  /** Excedente surtible: vigente, válido, acomodado, con ubicación y saldo. */
  function isSurtibleExcess_(item) {
    return Boolean(item) &&
      item.vigente === true &&
      item.validoBD === true &&
      item.conUbicacion === true &&
      toNum_(item.saldoActual) > 0 &&
      Boolean(toStr_(item.idUnico)) &&
      isSurtibleStatus_(item.estatusRegistro);
  }

  // --------------------------------------------------------------------------
  // CACHÉ DEL ESTADO DE EXCEDENTES SURTIBLES
  // --------------------------------------------------------------------------
  //
  // Consolidar BD-EXCEDENTES con toda la bitácora de traspasos cuesta ~3 s
  // (bitácora 20/11/2026) y lo usan el rondín y "Mostrar ubicaciones".
  //
  // - Se guarda en CacheService (por bloques) junto con la revisión de
  //   inventario vigente (appInventoryRevisionRead_).
  // - Cualquier ACOMODO o SURTIDO, desde cualquier vista, sube la revisión y
  //   la caché se descarta en la siguiente lectura.
  // - Cuando el cambio lo hace Reabastecimiento, la caché se corrige en el
  //   momento (patchSurtibleCache_) para no pagar la reconsolidación.
  // - Vigencia máxima de seguridad: SURTIBLE_CACHE_TTL_SECONDS.
  // - VALIDAR consulta primero esta caché (solo si ya existe con la revisión
  //   vigente; nunca la reconstruye) y, si la etiqueta no está, la consulta
  //   directo en la hoja para dar el mensaje exacto.
  // - REGISTRAR NO usa esta caché: bajo candado consulta la etiqueta
  //   directamente (getUnoPorIdUnicoDirecto), siempre con datos de la hoja.

  const SURTIBLE_CACHE_KEY = "APPALMACEN_REAB_SURTIBLES_V1";
  const SURTIBLE_CACHE_TTL_SECONDS = 300;

  /** Convierte un excedente a su forma compacta para la caché. */
  function compactExcess_(item) {
    return [
      toStr_(item.idUnico),
      toStrUpper_(item.codigo),
      toStrUpper_(item.descripcion),
      round2_(toNum_(item.saldoActual)),
      toStrUpper_(item.ubicacionActual),
      toStrUpper_(item.bodegaActual),
      toStrUpper_(item.estatusRegistro),
      toStr_(item.fechaBase)
    ];
  }

  /** Reconstruye un excedente compacto con los campos que usa este Service. */
  function expandExcess_(row) {
    return {
      idUnico: row[0],
      codigo: row[1],
      descripcion: row[2],
      saldoActual: row[3],
      ubicacionActual: row[4],
      bodegaActual: row[5],
      estatusRegistro: row[6],
      fechaBase: row[7],
      vigente: true,
      validoBD: true,
      conUbicacion: true
    };
  }

  /**
   * Excedentes surtibles (vigentes, válidos, con ubicación y saldo), desde la
   * caché si sigue vigente o reconsolidando y guardando.
   *
   * @param {Object=} trace Traza activa.
   * @param {{fresh?:boolean}=} options fresh: ignora la caché.
   * @return {!Array<!Object>}
   */
  function readSurtibleExcess_(trace, options) {
    // Ensure: si la revisión de inventario no existe (CacheService la perdió),
    // se siembra bajo candado para poder etiquetar la caché que se guarda.
    const revision = typeof appInventoryRevisionEnsure_ === "function"
      ? appInventoryRevisionEnsure_()
      : (typeof appInventoryRevisionRead_ === "function" ? appInventoryRevisionRead_() : -1);
    const fresh = Boolean(options && options.fresh);
    if (!fresh && revision >= 0) {
      const startedAt = Date.now();
      const cached = cacheGetChunked_(SURTIBLE_CACHE_KEY);
      if (cached && cached.rev === revision && Array.isArray(cached.rows)) {
        perfMark_(trace, "SRC_ESTADO_EXCEDENTES_CACHE_HIT", { elapsedMs: Date.now() - startedAt, rows: cached.rows.length, revision: revision });
        return cached.rows.map(expandExcess_);
      }
      perfMark_(trace, "SRC_ESTADO_EXCEDENTES_CACHE_MISS", { elapsedMs: Date.now() - startedAt, revision: revision });
    }
    const vigentes = measure_(trace, "SRC_ESTADO_EXCEDENTES", function() {
      return EstadoActualExcedentesService.getVigentes();
    });
    const surtibles = vigentes.filter(isSurtibleExcess_);
    if (revision >= 0) {
      const saveStartedAt = Date.now();
      const saved = cachePutChunked_(SURTIBLE_CACHE_KEY, { rev: revision, at: Date.now(), rows: surtibles.map(compactExcess_) }, SURTIBLE_CACHE_TTL_SECONDS);
      perfMark_(trace, "SRC_ESTADO_EXCEDENTES_CACHE_SAVED", { elapsedMs: Date.now() - saveStartedAt, saved: saved, rows: surtibles.length });
    }
    return surtibles.map(function(item) { return expandExcess_(compactExcess_(item)); });
  }

  /**
   * Corrige la caché tras un surtido de Reabastecimiento, sin reconsolidar.
   * Solo aplica si nadie más modificó inventario: la caché debe tener la
   * revisión previa al surtido y la actual debe ser exactamente la siguiente.
   *
   * @param {number} revisionBefore Revisión leída antes de aplicar el surtido.
   * @param {string} idUnico Etiqueta surtida.
   * @param {number} remaining Saldo restante (0 = surtido total).
   */
  function patchSurtibleCache_(revisionBefore, idUnico, remaining, trace) {
    try {
      const revisionNow = appInventoryRevisionRead_();
      if (revisionBefore < 0 || revisionNow !== revisionBefore + 1) {
        cacheRemoveChunked_(SURTIBLE_CACHE_KEY);
        return;
      }
      const cached = cacheGetChunked_(SURTIBLE_CACHE_KEY);
      if (!cached || cached.rev !== revisionBefore || !Array.isArray(cached.rows)) return;
      const token = toStrUpper_(idUnico);
      const rows = cached.rows
        .map(function(row) {
          if (toStrUpper_(row[0]) !== token) return row;
          const copy = row.slice();
          copy[3] = round2_(remaining);
          copy[6] = "PARCIAL";
          return copy;
        })
        .filter(function(row) { return toNum_(row[3]) > 0; });
      cachePutChunked_(SURTIBLE_CACHE_KEY, { rev: revisionNow, at: Date.now(), rows: rows }, SURTIBLE_CACHE_TTL_SECONDS);
      perfMark_(trace, "SURTIBLE_CACHE_PATCHED", { rows: rows.length, revision: revisionNow });
    } catch (error) {
      cacheRemoveChunked_(SURTIBLE_CACHE_KEY);
    }
  }

  /**
   * Busca una etiqueta en la caché de surtibles SIN reconstruirla.
   *
   * @param {string} token IDUNICO.
   * @param {Object=} trace Traza activa.
   * @return {?Object} Estado equivalente al de EstadoActualExcedentesService, o
   *     null si la caché no existe, está vencida o no contiene la etiqueta.
   */
  function findCachedSurtible_(token, trace) {
    const startedAt = Date.now();
    const revision = typeof appInventoryRevisionRead_ === "function" ? appInventoryRevisionRead_() : -1;
    if (revision < 0) return null;
    const cached = cacheGetChunked_(SURTIBLE_CACHE_KEY);
    if (!cached || cached.rev !== revision || !Array.isArray(cached.rows)) {
      perfMark_(trace, "SURTIBLE_LOOKUP_CACHE_MISS", { elapsedMs: Date.now() - startedAt, revision: revision });
      return null;
    }
    const wanted = toStrUpper_(token);
    const row = cached.rows.find(function(entry) { return toStrUpper_(entry[0]) === wanted; });
    perfMark_(trace, row ? "SURTIBLE_LOOKUP_CACHE_HIT" : "SURTIBLE_LOOKUP_NOT_IN_CACHE", { elapsedMs: Date.now() - startedAt, revision: revision });
    if (!row) return null;
    const state = expandExcess_(row);
    state.existeBD = true;
    return state;
  }

  function buildSurtibleExcessByCode_(trace) {
    return readSurtibleExcess_(trace).reduce(function(index, item) {
      if (!isSurtibleExcess_(item)) return index;
      const code = toStrUpper_(item.codigo);
      if (!code) return index;
      if (!index[code]) index[code] = [];
      index[code].push({
        idUnico: toStrUpper_(item.idUnico),
        codigo: code,
        descripcion: toStrUpper_(item.descripcion),
        cantidadIdUnico: round2_(toNum_(item.saldoActual)),
        ubicacionExcedente: toStrUpper_(item.ubicacionActual),
        bodegaExcedente: toStrUpper_(item.bodegaActual),
        fechaExcedente: toStr_(item.fechaBase),
        diasAntiguedad: ageInDays_(item.fechaBase)
      });
      return index;
    }, Object.create(null));
  }

  // --------------------------------------------------------------------------
  // CATÁLOGOS DEL RONDÍN (bodegas, áreas y SKU por ubicación de consumo)
  // --------------------------------------------------------------------------
  //
  // Leer UBICACIONES_SURTIDO (~16 mil filas) y CATALOGO (~16 mil filas) cuesta
  // ~3 s por consulta (bitácora 20/11/2026). Como estos catálogos pueden cambiar
  // en cualquier momento (carga de layouts), se guardan solo RONDIN_CACHE_TTL
  // segundos y la vista ofrece "Actualizar catálogos" (forceRefresh).
  //
  // Crear solicitud SIEMPRE revalida con lectura fresca de ambas hojas, de modo
  // que un catálogo en caché nunca produce una solicitud con datos vencidos.
  //
  // Estructura en caché (CacheService por bloques):
  //   <prefijo>BODEGAS   {at, warehouses:[{id,label,areas[]}]}
  //   <prefijo><B1..CU>  {at, rows:[[codigo, ubicacionConsumo, area, descripcion]]}

  const RONDIN_CACHE_PREFIX = "APPALMACEN_REAB_RONDIN_V1_";
  const RONDIN_CACHE_TTL_SECONDS = 120;

  /**
   * Lee ambas hojas, construye la base de todas las bodegas y la guarda.
   * @return {{at:number, warehouses:!Array, bases:!Object<string, !Array>}}
   */
  function buildRondinBase_(trace) {
    const supplyRows = readSupplyLocations_(trace);
    const warehouses = getSalesFloorCatalog_(trace, supplyRows);
    const activeCatalog = buildActiveCatalogIndex_(trace);
    const bases = Object.create(null);
    const seen = Object.create(null);
    supplyRows.forEach(function(supply) {
      const warehouseId = resolveSupplyWarehouse_(supply);
      const code = toStrUpper_(supply.codigo);
      const location = toStrUpper_(supply.ubicacion);
      const product = activeCatalog[code];
      if (!warehouseId || !code || !location || !product) return;
      const key = warehouseId + "|" + code + "|" + location;
      if (seen[key]) return;
      seen[key] = true;
      if (!bases[warehouseId]) bases[warehouseId] = [];
      bases[warehouseId].push([code, location, resolveSupplyArea_(supply), product.descripcion]);
    });
    const at = Date.now();
    const saveStartedAt = Date.now();
    cachePutChunked_(RONDIN_CACHE_PREFIX + "BODEGAS", { at: at, warehouses: warehouses }, RONDIN_CACHE_TTL_SECONDS);
    Object.keys(bases).forEach(function(warehouseId) {
      cachePutChunked_(RONDIN_CACHE_PREFIX + warehouseId, { at: at, rows: bases[warehouseId] }, RONDIN_CACHE_TTL_SECONDS);
    });
    perfMark_(trace, "RONDIN_BASE_CACHE_SAVED", { elapsedMs: Date.now() - saveStartedAt, warehouses: Object.keys(bases).length });
    return { at: at, warehouses: warehouses, bases: bases };
  }

  /**
   * Base del rondín desde caché o leyendo las hojas.
   *
   * @param {Object} trace Traza activa.
   * @param {string} warehouseId Bodega ("" = solo bodegas y áreas).
   * @param {boolean} fresh true = ignora la caché (Actualizar catálogos / crear).
   * @return {{at:number, warehouses:!Array, rows:!Array, cached:boolean}}
   */
  function readRondinBase_(trace, warehouseId, fresh) {
    if (!fresh) {
      const startedAt = Date.now();
      const meta = cacheGetChunked_(RONDIN_CACHE_PREFIX + "BODEGAS");
      if (meta && Array.isArray(meta.warehouses)) {
        if (!warehouseId) {
          perfMark_(trace, "RONDIN_CACHE_HIT", { elapsedMs: Date.now() - startedAt, bodegasOnly: true });
          return { at: meta.at, warehouses: meta.warehouses, rows: [], cached: true };
        }
        const base = cacheGetChunked_(RONDIN_CACHE_PREFIX + warehouseId);
        if (base && Array.isArray(base.rows) && base.at === meta.at) {
          perfMark_(trace, "RONDIN_CACHE_HIT", { elapsedMs: Date.now() - startedAt, rows: base.rows.length });
          return { at: meta.at, warehouses: meta.warehouses, rows: base.rows, cached: true };
        }
      }
      perfMark_(trace, "RONDIN_CACHE_MISS", { elapsedMs: Date.now() - startedAt });
    }
    const built = buildRondinBase_(trace);
    return { at: built.at, warehouses: built.warehouses, rows: built.bases[warehouseId] || [], cached: false };
  }

  /**
   * Catálogo del rondín para una bodega de piso.
   * Una fila representa la combinación SKU + ubicación de consumo + IDUNICO.
   *
   * @param {*} warehouse Clave de bodega de piso; vacía devuelve el bootstrap.
   * @param {{forceRefresh?:boolean}=} options forceRefresh: relee catálogos.
   * @return {!Object} Bodegas, áreas, registros y fecha de los catálogos.
   */
  function getManualRequestExcess(warehouse, options) {
    const trace = startTrace_("REABASTECIMIENTO_GET_MANUAL_EXCESS", {});
    try {
      assertDependencies_();
      const fresh = Boolean(options && options.forceRefresh === true);
      if (fresh) clearUsersCache_();
      const warehouseId = toStr_(warehouse) ? normalizeSalesFloorWarehouse_(warehouse) : "";
      const base = readRondinBase_(trace, warehouseId, fresh);
      const warehouses = base.warehouses;
      const catalogsAt = new Date(base.at).toISOString();
      perfMark_(trace, "MANUAL_WAREHOUSES_READY", { rows: warehouses.length, cached: base.cached });

      if (!toStr_(warehouse)) {
        finishTrace_(trace, { bootstrapOnly: true, warehouses: warehouses.length });
        return {
          bodegaSurtido: null,
          bodegasPisoVenta: warehouses,
          areasSuministro: [],
          registros: [],
          totalIdUnicos: 0,
          totalSkus: 0,
          cantidadTotal: 0,
          catalogosAl: catalogsAt,
          catalogosEnCache: base.cached
        };
      }
      const selected = warehouses.find(function(item) { return item.id === warehouseId; });
      if (!selected) {
        throw domainError_(ERR.PAYLOAD_INVALIDO, "La bodega seleccionada no tiene ubicaciones de surtido registradas.");
      }
      const excessByCode = buildSurtibleExcessByCode_(trace);
      perfMark_(trace, "MANUAL_SOURCES_READY", {
        supplyLocations: base.rows.length,
        codes: Object.keys(excessByCode).length
      });

      const records = joinRondinRecords_(warehouseId, base.rows, excessByCode);
      perfMark_(trace, "MANUAL_RECORDS_BUILT", { rows: records.length });
      records.sort(function(left, right) {
        return compareArea_(left.areaSuministro, right.areaSuministro) ||
          compareSupplyLocation_(left.ubicacionSurtido, right.ubicacionSurtido) ||
          compareEs_(left.codigo, right.codigo) ||
          compareEs_(left.idUnico, right.idUnico);
      });
      const uniqueSkus = Object.create(null);
      const quantitiesById = Object.create(null);
      const areas = Object.create(null);
      records.forEach(function(item) {
        uniqueSkus[item.codigo] = true;
        areas[item.areaSuministro] = true;
        if (!Object.prototype.hasOwnProperty.call(quantitiesById, item.idUnico)) {
          quantitiesById[item.idUnico] = toNum_(item.cantidadIdUnico);
        }
      });
      const result = {
        bodegaSurtido: warehouseId,
        bodegasPisoVenta: warehouses,
        areasSuministro: Object.keys(areas).sort(compareArea_),
        registros: records,
        totalIdUnicos: Object.keys(quantitiesById).length,
        totalSkus: Object.keys(uniqueSkus).length,
        cantidadTotal: round2_(Object.keys(quantitiesById).reduce(function(total, id) {
          return total + quantitiesById[id];
        }, 0)),
        catalogosAl: catalogsAt,
        catalogosEnCache: base.cached
      };
      finishTrace_(trace, { rows: records.length, skus: result.totalSkus, cached: base.cached });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }
  function getCandidatesByWarehouse(warehouse, options) {
    return getManualRequestExcess(warehouse, options);
  }

  /**
   * Une las filas base del rondín con los excedentes surtibles.
   *
   * @param {string} warehouseId Bodega de piso.
   * @param {!Array<!Array>} baseRows [codigo, ubicacionConsumo, area, descripcion].
   * @param {!Object<string, !Array<!Object>>} excessByCode Surtibles por código.
   * @return {!Array<!Object>} Una fila por código + ubicación de consumo + IDUNICO.
   */
  function joinRondinRecords_(warehouseId, baseRows, excessByCode) {
    const records = [];
    const seen = Object.create(null);
    baseRows.forEach(function(row) {
      const code = row[0];
      const supplyLocation = row[1];
      const area = row[2];
      const description = row[3];
      if (!excessByCode[code]) return;
      excessByCode[code].forEach(function(excess) {
        const key = code + "|" + supplyLocation + "|" + excess.idUnico;
        if (seen[key]) return;
        seen[key] = true;
        records.push({
          codigo: code,
          descripcion: description || excess.descripcion,
          ubicacionExcedente: excess.ubicacionExcedente,
          bodegaExcedente: excess.bodegaExcedente,
          cantidadIdUnico: excess.cantidadIdUnico,
          idUnico: excess.idUnico,
          fechaExcedente: excess.fechaExcedente,
          diasAntiguedad: excess.diasAntiguedad,
          ubicacionSurtido: supplyLocation,
          bodegaSurtido: warehouseId,
          areaSuministro: area
        });
      });
    });
    return records;
  }

  /**
   * Filas base del rondín (bodega indicada) para un conjunto de códigos,
   * leyendo de UBICACIONES_SURTIDO y CATALOGO SOLO las filas de esos códigos.
   * Equivale a la base completa de buildRondinBase_ restringida a los códigos.
   */
  function readRondinRowsForCodes_(warehouseId, codes, trace) {
    const supplyRows = typeof UbicacionesSurtidoRepository.getPorCodigosDirecto === "function"
      ? measure_(trace, "SRC_UBICACIONES_SURTIDO_DIRECTO", function() {
          return UbicacionesSurtidoRepository.getPorCodigosDirecto(codes, trace);
        })
      : readSupplyLocations_(trace);
    const products = typeof CatalogoRepository.getPorCodigosDirecto === "function"
      ? measure_(trace, "SRC_CATALOGO_DIRECTO", function() {
          return CatalogoRepository.getPorCodigosDirecto(codes, trace);
        })
      : CatalogoRepository.getAllRaw();
    const activeCatalog = indexActiveCatalog_(products);
    const wanted = Object.create(null);
    codes.forEach(function(code) { wanted[toStrUpper_(code)] = true; });
    const rows = [];
    const seen = Object.create(null);
    supplyRows.forEach(function(supply) {
      const code = toStrUpper_(supply.codigo);
      const location = toStrUpper_(supply.ubicacion);
      const product = activeCatalog[code];
      if (!wanted[code] || !location || !product) return;
      if (resolveSupplyWarehouse_(supply) !== warehouseId) return;
      const key = code + "|" + location;
      if (seen[key]) return;
      seen[key] = true;
      rows.push([code, location, resolveSupplyArea_(supply), product.descripcion]);
    });
    return rows;
  }

  /**
   * Candidatos autoritativos por código + ubicación de consumo.
   *
   * Revalida SOLO los códigos elegidos: lee de UBICACIONES_SURTIDO y CATALOGO
   * las filas de esos códigos (sin caché, ≈1 s) en lugar de releer las hojas
   * completas (≈5–6 s en la bitácora del 20/11/2026). El estado de excedentes
   * usa su caché por revisión de inventario; el surtido real se valida al
   * registrar, bajo candado.
   *
   * @param {string} warehouse Bodega de piso.
   * @param {!Object} trace Traza activa.
   * @param {!Array<string>} codes Códigos solicitados.
   */
  function buildCandidateMap_(warehouse, trace, codes) {
    const startedAt = Date.now();
    const warehouseId = normalizeSalesFloorWarehouse_(warehouse);
    const baseRows = readRondinRowsForCodes_(warehouseId, codes, trace);
    const records = joinRondinRecords_(warehouseId, baseRows, buildSurtibleExcessByCode_(trace));
    perfMark_(trace, "CREATE_CANDIDATES_REVALIDATED", { elapsedMs: Date.now() - startedAt, rows: records.length, codes: codes.length });
    return records.reduce(function(map, item) {
      const key = item.codigo + "|" + item.ubicacionSurtido;
      if (!map[key]) {
        map[key] = {
          codigo: item.codigo,
          descripcion: item.descripcion,
          ubicacionSurtido: item.ubicacionSurtido,
          areaSuministro: item.areaSuministro,
          bodegaKey: String(item.bodegaSurtido)
        };
      }
      return map;
    }, Object.create(null));
  }

  // ==========================================================================
  // CREACIÓN
  // ==========================================================================

  function normalizeCreationPayload_(payload, trace) {
    const input = payload && typeof payload === "object" ? payload : {};
    const applicant = validateUser_(input.solicitante, trace);
    const warehouseKey = normalizeSalesFloorWarehouse_(input.bodega);
    if (!warehouseKey) {
      throw domainError_(ERR.PAYLOAD_INVALIDO, "La bodega es obligatoria.");
    }
    const area = toStrUpper_(input.areaSuministro);
    if (!area) {
      throw domainError_(ERR.AREA_REQUERIDA, "Selecciona el área de suministro revisada.");
    }
    const requested = Array.isArray(input.partidas) ? input.partidas : [];
    if (!requested.length) {
      throw domainError_(ERR.PAYLOAD_INVALIDO, "Debe seleccionar al menos un SKU.");
    }
    const maximum = Number(RC.LIMITES.MAX_SKUS_POR_SOLICITUD || 99);
    if (requested.length > maximum) {
      throw domainError_(ERR.LIMITE_PARTIDAS_EXCEDIDO, "La solicitud excede el límite de SKU.");
    }
    const requestedCodes = requested
      .map(function(item) { return toStrUpper_(item && item.codigo); })
      .filter(Boolean);
    const candidateMap = buildCandidateMap_(warehouseKey, trace, requestedCodes);
    const unique = Object.create(null);
    const items = requested.map(function(item, index) {
      const code = toStrUpper_(item && item.codigo);
      const location = toStrUpper_(item && item.ubicacion);
      const candidate = candidateMap[code + "|" + location];
      if (!candidate) {
        throw domainError_(ERR.PAYLOAD_INVALIDO, "Uno de los SKU ya no tiene excedentes disponibles. Actualiza la lista.", { index: index });
      }
      if (candidate.areaSuministro !== area) {
        throw domainError_(ERR.PAYLOAD_INVALIDO, "Uno de los SKU no pertenece al área de suministro seleccionada.", { index: index });
      }
      if (unique[code]) {
        throw domainError_(ERR.PARTIDA_DUPLICADA, "La solicitud contiene un código duplicado.");
      }
      unique[code] = true;
      return candidate;
    });
    return {
      solicitante: applicant.nombre,
      bodegaClave: warehouseKey,
      bodega: getSalesFloorWarehouseLabel_(warehouseKey),
      areaSuministro: area,
      partidas: items
    };
  }

  function createRequest(payload) {
    const trace = startTrace_("REABASTECIMIENTO_CREATE_REQUEST", {});
    try {
      assertDependencies_();
      const normalized = normalizeCreationPayload_(payload, trace);
      perfMark_(trace, "CREATE_PAYLOAD_NORMALIZED", { parts: normalized.partidas.length });
      const result = underLock_("REABASTECIMIENTO_CREATE_REQUEST", function() {
        const temporal = getReabastecimientoTemporalContext_();
        const identity = ReabastecimientoSolicitudesRepository.createIdentityUnderLock(temporal, trace);
        const parts = normalized.partidas.map(function(item, index) {
          return {
            idSolicitud: identity.idSolicitud,
            idPartidaConsecutivo: padPositiveInteger_(index + 1, RC.CONSECUTIVOS.PARTIDA_DIGITOS, "ID_PARTIDACONSECUTIVO"),
            codigoSolicitado: item.codigo,
            descripcionSolicitada: item.descripcion,
            ubicacionSolicitada: item.ubicacionSurtido,
            estado: PART.PENDIENTE
          };
        });
        const header = {
          idSolicitud: identity.idSolicitud,
          idSolicitudConsecutivo: identity.idSolicitudConsecutivo,
          fechaCreacion: temporal.fecha,
          horaCreacion: temporal.hora,
          solicitante: normalized.solicitante,
          bodega: normalized.bodega,
          areaSuministro: normalized.areaSuministro,
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
          const persistedHeader = ReabastecimientoSolicitudesRepository.getById(identity.idSolicitud, trace);
          const persistedParts = ReabastecimientoPartidasRepository.getBySolicitud(identity.idSolicitud, trace);
          if (!persistedHeader || persistedParts.length !== parts.length) {
            throw new Error("No fue posible confirmar la persistencia completa de la solicitud.");
          }
        } catch (writeError) {
          let rollbackError = null;
          try {
            ReabastecimientoPartidasRepository.deleteBySolicitudUnderLock(identity.idSolicitud, trace);
            ReabastecimientoSolicitudesRepository.deleteByIdUnderLock(identity.idSolicitud, trace);
          } catch (compensationError) {
            rollbackError = compensationError;
          }
          // Otra ejecución pudo guardar en caché las filas ya revertidas con la
          // revisión vigente; subirla invalida esa copia.
          try { bumpRevision_(identity.idSolicitud, trace); } catch (_) { /* sin acción */ }
          if (rollbackError) {
            const criticalError = new Error(
              "La creación falló y la reversión automática no pudo completarse. " +
              "Revise las hojas de Reabastecimiento antes de reintentar."
            );
            criticalError.code = ERR.REGISTRO_INCOMPLETO;
            throw criticalError;
          }
          throw writeError;
        }
        bumpRevision_(identity.idSolicitud, trace);

        return {
          idSolicitud: identity.idSolicitud,
          fechaCreacion: temporal.fecha,
          horaCreacion: temporal.hora,
          solicitante: normalized.solicitante,
          bodega: normalized.bodega,
          areaSuministro: normalized.areaSuministro,
          skusSolicitados: parts.length,
          estado: STATES.CREADA
        };
      }, trace);
      clearReabastecimientoCaches_();
      finishTrace_(trace, { parts: result.skusSolicitados });
      return result;
    } catch (error) {
      clearReabastecimientoCaches_();
      failTrace_(trace, error);
      throw error;
    }
  }

  // ==========================================================================
  // PROYECCIONES Y SEGUIMIENTO
  // ==========================================================================

  /** Métricas de seguimiento: avance, tiempos y estimación de conclusión. */
  function buildTracking_(request, parts, details, state) {
    const counts = countParts_(parts);
    const startMinutes = hasStart_(request)
      ? toAbsoluteMinutes_(request.fechaInicioAtencion, request.horaInicioAtencion)
      : null;
    const closeMinutes = isClosedState_(state)
      ? toAbsoluteMinutes_(request.fechaCierreAtencion, request.horaCierreAtencion)
      : null;
    const referenceMinutes = closeMinutes != null ? closeMinutes : nowAbsoluteMinutes_();
    const elapsed = startMinutes != null && referenceMinutes != null
      ? Math.max(0, referenceMinutes - startMinutes)
      : null;
    const progress = counts.total > 0 ? Math.round((counts.concluidos / counts.total) * 100) : 0;
    let estimated = "";
    if (startMinutes != null && closeMinutes == null && counts.concluidos > 0 && counts.concluidos < counts.total) {
      estimated = formatAbsoluteMinutes_(startMinutes + Math.round((elapsed / counts.concluidos) * counts.total));
    }
    const piezas = round2_((Array.isArray(details) ? details : []).reduce(function(total, item) {
      return total + toNum_(item.cantidad);
    }, 0));
    return {
      totalSkus: counts.total,
      pendientes: counts.pendientes,
      enAtencion: counts.enAtencion,
      atendidos: counts.atendidos,
      atendidosParcial: counts.parciales,
      concluidos: counts.concluidos,
      porcentajeAvance: progress,
      minutosTranscurridos: elapsed,
      fechaHoraEstimadaConclusion: estimated,
      cajasSurtidas: (Array.isArray(details) ? details : []).length,
      piezasSurtidas: piezas
    };
  }

  function projectRequest_(request, parts, details) {
    const state = deriveRequestState_(request, parts);
    return {
      idSolicitud: toStrUpper_(request.idSolicitud),
      idSolicitudConsecutivo: toStr_(request.idSolicitudConsecutivo),
      fechaCreacion: serializeTemporalValue_(request.fechaCreacion, "dd/MM/yyyy"),
      horaCreacion: serializeTemporalValue_(request.horaCreacion, "HH:mm"),
      solicitante: toStrUpper_(request.solicitante),
      bodega: getSalesFloorWarehouseLabel_(request.bodega),
      areaSuministro: toStrUpper_(request.areaSuministro),
      skusSolicitados: Math.floor(toNum_(request.skusSolicitados)),
      fechaInicioAtencion: serializeTemporalValue_(request.fechaInicioAtencion, "dd/MM/yyyy"),
      horaInicioAtencion: serializeTemporalValue_(request.horaInicioAtencion, "HH:mm"),
      usuarioInicioAtencion: toStrUpper_(request.usuarioInicioAtencion),
      auxiliares: (request.auxiliares || []).slice(),
      fechaCierreAtencion: serializeTemporalValue_(request.fechaCierreAtencion, "dd/MM/yyyy"),
      horaCierreAtencion: serializeTemporalValue_(request.horaCierreAtencion, "HH:mm"),
      usuarioCierre: toStrUpper_(request.usuarioCierre),
      cierreConPendientes: request.cierreConPendientes === true,
      motivoCierre: toStr_(request.motivoCierre),
      cajasInvolucradas: Math.floor(toNum_(request.cajasInvolucradas)),
      estado: state,
      seguimiento: buildTracking_(request, parts, details, state)
    };
  }

  function projectScannedDetail_(detail) {
    return {
      idDetalleConsecutivo: toStr_(detail.idDetalleConsecutivo),
      idUnico: toStr_(detail.idUnico),
      codigo: toStrUpper_(detail.codigo),
      descripcion: toStrUpper_(detail.descripcion),
      cantidad: round2_(toNum_(detail.cantidad)),
      saldoAnterior: detail.saldoAnterior == null ? null : round2_(detail.saldoAnterior),
      saldoRestante: detail.saldoRestante == null ? null : round2_(detail.saldoRestante),
      tipoSurtido: toStrUpper_(detail.tipoSurtido),
      bodegaOrigen: toStrUpper_(detail.bodegaOrigen),
      ubicacionOrigen: toStrUpper_(detail.ubicacionOrigen),
      fechaEscaneo: serializeTemporalValue_(detail.fechaEscaneo, "dd/MM/yyyy"),
      horaEscaneo: serializeTemporalValue_(detail.horaEscaneo, "HH:mm"),
      usuarioResponsable: toStrUpper_(detail.usuarioResponsable)
    };
  }

  function projectPart_(part, details) {
    const safeDetails = Array.isArray(details) ? details : [];
    return {
      idSolicitud: toStrUpper_(part.idSolicitud),
      idPartidaConsecutivo: toStr_(part.idPartidaConsecutivo),
      codigoSolicitado: toStrUpper_(part.codigoSolicitado),
      descripcionSolicitada: toStrUpper_(part.descripcionSolicitada),
      ubicacionSolicitada: toStrUpper_(part.ubicacionSolicitada),
      estado: toStrUpper_(part.estado) || PART.PENDIENTE,
      fechaAtencion: serializeTemporalValue_(part.fechaAtencion, "dd/MM/yyyy"),
      horaAtencion: serializeTemporalValue_(part.horaAtencion, "HH:mm"),
      usuarioAtencion: toStrUpper_(part.usuarioAtencion),
      fechaConclusion: serializeTemporalValue_(part.fechaConclusion, "dd/MM/yyyy"),
      horaConclusion: serializeTemporalValue_(part.horaConclusion, "HH:mm"),
      usuarioConclusion: toStrUpper_(part.usuarioConclusion),
      detalles: safeDetails,
      cajasEscaneadas: safeDetails.length,
      piezasSurtidas: round2_(safeDetails.reduce(function(total, item) {
        return total + toNum_(item.cantidad);
      }, 0)),
      responsables: safeDetails.reduce(function(list, item) {
        return withAuxiliary_(list, item.usuarioResponsable);
      }, [])
    };
  }

  function groupDetailsByCode_(details) {
    return details.reduce(function(map, detail) {
      const code = toStrUpper_(detail.codigo);
      if (!map[code]) map[code] = [];
      map[code].push(detail);
      return map;
    }, Object.create(null));
  }

  function getRequests(filters) {
    const trace = startTrace_("REABASTECIMIENTO_GET_REQUESTS", {});
    try {
      assertDependencies_();
      const config = filters && typeof filters === "object" ? filters : {};
      // "Actualizar" del listado: lee las hojas aunque haya copia vigente
      // (muestra al instante ediciones manuales) y deja una copia fresca.
      if (config.forceRefresh === true) {
        tableRepositories_().forEach(function(repository) {
          if (typeof repository.preferSheet === "function") repository.preferSheet();
        });
        perfMark_(trace, "REQUESTS_FORCE_REFRESH");
      }
      const stateFilter = toStrUpper_(config.estado);
      const warehouseFilter = toStrUpper_(config.bodega);
      const requestFilter = toStrUpper_(config.idSolicitud);

      const source = measure_(trace, "SRC_SOLICITUDES", function() {
        return ReabastecimientoSolicitudesRepository.getAll(trace);
      });
      const partsById = measure_(trace, "SRC_PARTIDAS", function() {
        return ReabastecimientoPartidasRepository.getGroupedBySolicitud(trace);
      });
      const detailsById = measure_(trace, "SRC_DETALLES", function() {
        return ReabastecimientoDetallesRepository.getGroupedBySolicitud(trace);
      });
      const projected = source.map(function(request) {
        return projectRequest_(
          request,
          partsById[request.idSolicitud] || [],
          detailsById[request.idSolicitud] || []
        );
      });
      const results = projected
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
        throw domainError_(ERR.SOLICITUD_NO_ENCONTRADA, "La solicitud no existe.");
      }
      perfMark_(trace, "DETAIL_REQUEST_READY");
      const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
      perfMark_(trace, "DETAIL_PARTS_READY", { rows: parts.length });
      const rawDetails = ReabastecimientoDetallesRepository.getBySolicitud(id, trace);
      perfMark_(trace, "DETAIL_SCANS_READY", { rows: rawDetails.length });
      const publicDetails = rawDetails.map(projectScannedDetail_);
      const detailsByCode = groupDetailsByCode_(publicDetails);
      const result = {
        solicitud: projectRequest_(request, parts, rawDetails),
        partidas: parts.map(function(part) {
          return projectPart_(part, detailsByCode[toStrUpper_(part.codigoSolicitado)] || []);
        }),
        totalPartidas: parts.length,
        totalDetalles: publicDetails.length,
        cajasUnicas: ReabastecimientoDetallesRepository.countUniqueBoxes(id, trace)
      };
      finishTrace_(trace, { parts: result.totalPartidas, details: result.totalDetalles });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  /**
   * Adjunta el detalle actualizado de la solicitud a la respuesta de una acción.
   *
   * RENDIMIENTO: cada llamada google.script.run cuesta ~2–3 s fijos de red y
   * arranque (bitácora 20/11/2026). Devolver el detalle en la misma respuesta
   * evita que la vista haga una segunda llamada solo para recargar. Los
   * Repositories ya tienen los datos en memoria de esta ejecución, por lo que
   * el costo adicional es bajo. Debe invocarse ANTES de clearReabastecimientoCaches_.
   *
   * @param {!Object} result Respuesta de la acción.
   * @param {string} id Folio.
   * @return {!Object} La misma respuesta con la propiedad detalle.
   */
  function withDetail_(result, id) {
    try {
      result.detalle = getRequestDetail(id);
    } catch (error) {
      result.detalle = null;
    }
    return result;
  }

  // ==========================================================================
  // TOMA DE LA SOLICITUD (ATENDER)
  // ==========================================================================

  /**
   * Toma la solicitud para su atención. La primera toma registra auxiliar,
   * fecha y hora de inicio; las siguientes agregan al auxiliar participante.
   *
   * @param {*} payload {idSolicitud, usuario}
   * @return {!Object} Estado actualizado.
   */
  function takeRequest(payload) {
    const trace = startTrace_("REABASTECIMIENTO_TAKE_REQUEST", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const user = validateUser_(input.usuario, trace);
      const result = underLock_("REABASTECIMIENTO_TAKE_REQUEST", function() {
        const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
        const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
        assertOperable_(request, parts);
        const alreadyTaken = hasStart_(request);
        const auxiliaries = withAuxiliary_(request.auxiliares, user.nombre);
        const patch = { auxiliares: auxiliaries };
        const temporal = getReabastecimientoTemporalContext_();
        if (!alreadyTaken) {
          patch.fechaInicioAtencion = temporal.fecha;
          patch.horaInicioAtencion = temporal.hora;
          patch.usuarioInicioAtencion = user.nombre;
        }
        if (!alreadyTaken || auxiliaries.length !== (request.auxiliares || []).length) {
          ReabastecimientoSolicitudesRepository.updateFieldsUnderLock(id, patch, trace);
          bumpRevision_(id, trace);
        }
        const updated = ReabastecimientoSolicitudesRepository.getById(id, trace);
        return {
          idSolicitud: id,
          yaTomada: alreadyTaken,
          usuario: user.nombre,
          auxiliares: auxiliaries,
          estado: deriveRequestState_(updated, parts)
        };
      }, trace);
      withDetail_(result, id);
      clearReabastecimientoCaches_();
      finishTrace_(trace, { alreadyTaken: result.yaTomada });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  // ==========================================================================
  // UBICACIONES DE EXCEDENTE (MOSTRAR UBICACIONES)
  // ==========================================================================

  function sortBoxes_(boxes) {
    return boxes.sort(function(left, right) {
      return compareEs_(left.bodegaExcedente, right.bodegaExcedente) ||
        compareEs_(left.ubicacionExcedente, right.ubicacionExcedente) ||
        (toNum_(right.diasAntiguedad) - toNum_(left.diasAntiguedad)) ||
        compareEs_(left.idUnico, right.idUnico) ||
        (toNum_(left.cantidad) - toNum_(right.cantidad));
    });
  }

  /**
   * Lista las cajas surtibles del SKU y marca la partida EN_ATENCION.
   *
   * @param {*} payload {idSolicitud, idPartidaConsecutivo, usuario}
   * @return {!Object} Contrato del drawer de ubicaciones.
   */
  function getPartLocations(payload) {
    const trace = startTrace_("REABASTECIMIENTO_GET_PART_LOCATIONS", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const partId = toStr_(input.idPartidaConsecutivo);
      const user = validateUser_(input.usuario, trace);
      if (!id || !partId) {
        throw domainError_(ERR.PAYLOAD_INVALIDO, "Solicitud y partida son obligatorias.");
      }

      const attendance = underLock_("REABASTECIMIENTO_SHOW_PART_LOCATIONS", function() {
        const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
        const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
        assertOperable_(request, parts, { requireTaken: true });
        const part = ReabastecimientoPartidasRepository.getByKey(id, partId, trace);
        if (!part) throw domainError_(ERR.PARTIDA_NO_ENCONTRADA, "La partida no existe.");
        const temporal = getReabastecimientoTemporalContext_();
        const update = ReabastecimientoPartidasRepository.markInAttentionUnderLock(id, partId, temporal, user.nombre, trace);
        const auxiliaries = withAuxiliary_(request.auxiliares, user.nombre);
        const auxiliariesChanged = auxiliaries.length !== (request.auxiliares || []).length;
        if (auxiliariesChanged) {
          ReabastecimientoSolicitudesRepository.updateFieldsUnderLock(id, { auxiliares: auxiliaries }, trace);
        }
        if (update.updated || auxiliariesChanged) bumpRevision_(id, trace);
        return { part: part, estadoPartida: update.estado };
      }, trace);

      const part = attendance.part;
      const code = toStrUpper_(part.codigoSolicitado);
      const scannedDetails = ReabastecimientoDetallesRepository.getBySolicitud(id, trace);
      perfMark_(trace, "LOCATIONS_SCANS_READY", { rows: scannedDetails.length });
      const scannedIds = scannedDetails.reduce(function(set, detail) {
        set[toStrUpper_(detail.idUnico)] = true;
        return set;
      }, Object.create(null));

      const vigentes = readSurtibleExcess_(trace);
      const boxes = sortBoxes_(vigentes
        .filter(function(item) {
          return toStrUpper_(item && item.codigo) === code &&
            isSurtibleExcess_(item) &&
            !scannedIds[toStrUpper_(item.idUnico)];
        })
        .map(function(item) {
          return {
            idUnico: toStr_(item.idUnico),
            cantidad: round2_(toNum_(item.saldoActual)),
            bodegaExcedente: toStrUpper_(item.bodegaActual),
            ubicacionExcedente: toStrUpper_(item.ubicacionActual),
            estatus: toStrUpper_(item.estatusRegistro) || "ACOMODADO",
            fechaExcedente: toStr_(item.fechaBase),
            diasAntiguedad: ageInDays_(item.fechaBase)
          };
        }));

      const warehouses = boxes.reduce(function(set, box) {
        set[box.bodegaExcedente || "SIN BODEGA"] = true;
        return set;
      }, Object.create(null));
      const partDetails = scannedDetails
        .filter(function(detail) { return toStrUpper_(detail.codigo) === code; })
        .map(projectScannedDetail_);
      const result = {
        partida: {
          idPartidaConsecutivo: part.idPartidaConsecutivo,
          codigo: part.codigoSolicitado,
          descripcion: part.descripcionSolicitada,
          ubicacionSurtido: part.ubicacionSolicitada,
          estado: attendance.estadoPartida
        },
        resumen: {
          cajasEscaneadas: partDetails.length,
          piezasSurtidas: round2_(partDetails.reduce(function(total, item) { return total + toNum_(item.cantidad); }, 0)),
          cajasPorEscanear: boxes.length,
          piezasPorEscanear: round2_(boxes.reduce(function(total, box) { return total + toNum_(box.cantidad); }, 0)),
          bodegas: Object.keys(warehouses).length
        },
        cajasPorEscanear: boxes,
        cajasSurtidas: partDetails
      };
      withDetail_(result, id);
      clearReabastecimientoCaches_();
      finishTrace_(trace, { boxes: boxes.length });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  // ==========================================================================
  // VALIDACIÓN Y SURTIDO DE ETIQUETAS
  // ==========================================================================

  /**
   * Resuelve un IDUNICO y aplica las validaciones del proceso 2, punto 13.
   */
  /**
   * Estado vigente de una etiqueta con las reglas de surtido aplicadas.
   *
   * @param {*} idUnico Etiqueta escaneada.
   * @param {Object=} trace Traza activa.
   * @param {{preferCache?:boolean}=} options preferCache: consulta primero la
   *     caché de surtibles (VALIDAR). REGISTRAR no la usa.
   * @return {!Object} Estado de la etiqueta.
   */
  function resolveIdUnico_(idUnico, trace, options) {
    const token = toStr_(idUnico);
    if (!token) {
      throw domainError_(ERR.IDUNICO_REQUERIDO, "Escanea o captura la etiqueta del excedente.");
    }
    const cachedState = options && options.preferCache === true ? findCachedSurtible_(token, trace) : null;
    const state = cachedState || measure_(trace, "SRC_ESTADO_IDUNICO", function() {
      // Búsqueda directa: solo las filas de esta etiqueta (sin consolidar el almacén).
      return typeof EstadoActualExcedentesService.getUnoPorIdUnicoDirecto === "function"
        ? EstadoActualExcedentesService.getUnoPorIdUnicoDirecto(token)
        : EstadoActualExcedentesService.getUnoPorIdUnico(token);
    });
    if (!state || state.existeBD !== true) {
      throw domainError_(ERR.IDUNICO_NO_ENCONTRADO, "La etiqueta no existe en excedentes.");
    }
    if (state.validoBD !== true) {
      throw domainError_(
        ERR.IDUNICO_NO_SURTIBLE,
        "La etiqueta tiene estatus " + (toStrUpper_(state.estatusRegistro) || "inválido") + " y no puede surtirse."
      );
    }
    if (toNum_(state.saldoActual) <= 0) {
      throw domainError_(ERR.IDUNICO_SIN_SALDO, "La etiqueta ya fue surtida y no tiene cantidad disponible.");
    }
    if (state.conUbicacion !== true) {
      throw domainError_(ERR.IDUNICO_NO_SURTIBLE, "La etiqueta no tiene una ubicación de excedente vigente; primero regístrala con ACOMODO.");
    }
    if (!isSurtibleStatus_(state.estatusRegistro)) {
      throw domainError_(
        ERR.IDUNICO_NO_SURTIBLE,
        "La etiqueta está " + toStrUpper_(state.estatusRegistro) + "; solo se surten excedentes ACOMODADOS."
      );
    }
    return state;
  }

  /** Valida que la etiqueta corresponda a la partida y no se repita. */
  function assertLabelForPart_(id, part, state, trace) {
    if (toStrUpper_(state.codigo) !== toStrUpper_(part.codigoSolicitado)) {
      throw domainError_(
        ERR.IDUNICO_CODIGO_INCORRECTO,
        "La etiqueta es del SKU " + toStrUpper_(state.codigo) + " y no del SKU atendido."
      );
    }
    if (ReabastecimientoDetallesRepository.hasIdUnicoInSolicitud(id, state.idUnico, trace)) {
      throw domainError_(ERR.IDUNICO_DUPLICADO, "La etiqueta ya fue registrada en esta solicitud.");
    }
  }

  /** Normaliza la cantidad por surtir; vacía equivale al saldo completo. */
  function resolveQuantity_(value, balance) {
    const saldo = round2_(toNum_(balance));
    if (value === "" || value == null) return saldo;
    const quantity = round2_(Number(value));
    if (!isFinite(quantity) || quantity <= 0) {
      throw domainError_(ERR.CANTIDAD_INVALIDA, "La cantidad por surtir debe ser mayor que cero.");
    }
    if (quantity > saldo) {
      throw domainError_(ERR.CANTIDAD_INVALIDA, "La cantidad por surtir no puede ser mayor que la disponible (" + saldo + ").");
    }
    return quantity;
  }

  function validateIdUnico(payload) {
    const trace = startTrace_("REABASTECIMIENTO_VALIDATE_IDUNICO", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const partId = toStr_(input.idPartidaConsecutivo);
      const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
      const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
      assertOperable_(request, parts, { requireTaken: true });
      const part = ReabastecimientoPartidasRepository.getByKey(id, partId, trace);
      if (!part) throw domainError_(ERR.PARTIDA_NO_ENCONTRADA, "La partida no existe.");
      perfMark_(trace, "VALIDATE_CONTEXT_READY");
      // VALIDAR es informativo: usa la caché de surtibles si está vigente.
      // REGISTRAR vuelve a comprobar todo bajo candado contra la hoja.
      const state = resolveIdUnico_(input.idUnico, trace, { preferCache: true });
      assertLabelForPart_(id, part, state, trace);
      perfMark_(trace, "VALIDATE_RULES_PASSED");
      const saldo = round2_(toNum_(state.saldoActual));
      const result = {
        valido: true,
        idUnico: toStr_(state.idUnico),
        codigo: toStrUpper_(state.codigo),
        descripcion: toStrUpper_(state.descripcion),
        cantidad: saldo,
        saldoDisponible: saldo,
        estatus: toStrUpper_(state.estatusRegistro) || "ACOMODADO",
        bodega: toStrUpper_(state.bodegaActual),
        ubicacion: toStrUpper_(state.ubicacionActual),
        fechaExcedente: toStr_(state.fechaBase),
        diasAntiguedad: ageInDays_(state.fechaBase)
      };
      finishTrace_(trace, { valid: true });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  /**
   * Contexto ya validado para que Traspasos aplique el surtido sin consolidar
   * todo el almacén (bitácora 20/11/2026: folios 3.1 s + catálogo 1.3 s +
   * índice de filas 0.7 s).
   *
   * - foliosSurtido: el folio de la etiqueta con su saldo vigente, resuelto con
   *   el estado actual bajo este mismo ScriptLock (resolveIdUnico_).
   * - catalogo: el producto del SKU leído directamente de CATALOGO (estatus y
   *   IDPRODUCTO), para que Traspasos conserve su validación de producto ACTIVO.
   * - filasExcedentes: la fila física en BD-EXCEDENTES para actualizar STATUS.
   *
   * Cualquier pieza que falte se omite y Traspasos usa su cálculo completo.
   *
   * @return {!Object} Contexto para procesarMovimientosEnCandadoActivo().
   */
  function buildSurtidoContext_(state, balance, trace) {
    const id = toStr_(state.idUnico);
    const code = toStrUpper_(state.codigo);
    const context = {
      foliosSurtido: {},
      catalogo: null,
      filasExcedentes: null,
      // Usuarios de la caché de Reabastecimiento (6 h): Traspasos no relee la
      // hoja USUARIOS para validar al solicitante del movimiento.
      solicitantes: readUsersCatalog_(trace).map(function(user) { return user.nombre; })
    };
    context.foliosSurtido[id] = {
      idUnico: id,
      sku: code,
      descripcion: toStrUpper_(state.descripcion),
      ubicacionActual: toStrUpper_(state.ubicacionActual),
      balance: balance,
      bodegaActual: toStr_(state.bodegaActual)
    };
    if (state.filaBaseBD && Number(state.filaBaseBD.rowNumber) >= 2) {
      context.filasExcedentes = {};
      context.filasExcedentes[id] = {
        rowNumber: Number(state.filaBaseBD.rowNumber),
        item: { idproducto: toStr_(state.filaBaseBD.idproducto), cantidad: toNum_(state.filaBaseBD.cantidad) },
        raw: null
      };
    }
    /*
     * Producto para el movimiento de existencias. El IDPRODUCTO viene en la
     * fila de BD-EXCEDENTES de la etiqueta, así que no se busca en CATALOGO
     * (≈0.56 s). El SKU de la partida se verificó ACTIVO en CATALOGO, con
     * lectura directa sin caché, al crear la solicitud. Si la fila no trae un
     * IDPRODUCTO válido, se consulta CATALOGO como antes.
     */
    const baseProductId = state.filaBaseBD ? Number(state.filaBaseBD.idproducto) : NaN;
    if (Number.isInteger(baseProductId) && baseProductId > 0) {
      context.catalogo = {};
      context.catalogo[code] = {
        idproducto: String(baseProductId),
        codigo: code,
        descripcion: toStrUpper_(state.descripcion),
        status: "ACTIVO"
      };
      perfMark_(trace, "SURTIDO_PRODUCT_FROM_BASE_ROW", { idproducto: baseProductId });
    } else if (typeof CatalogoRepository.getPorCodigoDirecto === "function") {
      const products = measure_(trace, "SRC_CATALOGO_DIRECTO", function() {
        return CatalogoRepository.getPorCodigoDirecto(code, trace);
      });
      if (Array.isArray(products) && products.length) {
        const product = products[products.length - 1];
        context.catalogo = {};
        context.catalogo[code] = {
          idproducto: toStr_(product.idproducto),
          codigo: code,
          descripcion: toStrUpper_(product.descripcion),
          status: toStrUpper_(product.status)
        };
      }
    }
    return context;
  }

  /** Construye un idOperacion determinista para la idempotencia del surtido. */
  function buildOperationId_(idSolicitud, idUnico) {
    return CFG.OPERATION_PREFIX + toStrUpper_(idSolicitud) + "-" + toStr_(idUnico).replace(/[^A-Za-z0-9_-]/g, "");
  }

  /**
   * Registra el surtido de una etiqueta para la partida.
   *
   * Bajo un único ScriptLock: revalida etiqueta y partida, aplica el SURTIDO en
   * Bitacora-TRASPASOS (total o parcial), actualiza STATUS y existencias y
   * registra el detalle de la solicitud.
   *
   * @param {*} payload {idSolicitud, idPartidaConsecutivo, idUnico, usuario, cantidad?}
   * @return {!Object} Detalle persistido y paquete de impresión del remanente.
   */
  function registerIdUnico(payload) {
    const trace = startTrace_("REABASTECIMIENTO_REGISTER_IDUNICO", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const partId = toStr_(input.idPartidaConsecutivo);
      const user = validateUser_(input.usuario, trace);
      const result = underLock_("REABASTECIMIENTO_REGISTER_IDUNICO", function() {
        if (typeof EstadoActualExcedentesService.clearCache === "function") {
          EstadoActualExcedentesService.clearCache();
        }
        const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
        const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
        assertOperable_(request, parts, { requireTaken: true });
        const part = ReabastecimientoPartidasRepository.getByKey(id, partId, trace);
        if (!part) throw domainError_(ERR.PARTIDA_NO_ENCONTRADA, "La partida no existe.");
        perfMark_(trace, "REGISTER_CONTEXT_READY");
        const state = resolveIdUnico_(input.idUnico, trace);
        assertLabelForPart_(id, part, state, trace);
        perfMark_(trace, "REGISTER_RULES_PASSED");

        const balance = round2_(toNum_(state.saldoActual));
        const quantity = resolveQuantity_(input.cantidad, balance);
        const remaining = round2_(balance - quantity);
        const operationId = buildOperationId_(id, state.idUnico);
        const originWarehouse = toStrUpper_(state.bodegaActual);
        const originLocation = toStrUpper_(state.ubicacionActual);

        let movement;
        const movementStartedAt = Date.now();
        const inventoryRevisionBefore = typeof appInventoryRevisionRead_ === "function" ? appInventoryRevisionRead_() : -1;
        const surtidoContext = buildSurtidoContext_(state, balance, trace);
        try {
          movement = PrototipoTraspasosService.procesarMovimientosEnCandadoActivo([{
            tipo: "SURTIDO",
            id: operationId,
            idUnico: toStr_(state.idUnico),
            cantidad: quantity,
            solicitante: user.nombre,
            sku: toStrUpper_(state.codigo),
            descripcion: toStrUpper_(state.descripcion)
          }], surtidoContext);
        } catch (movementError) {
          throw domainError_(
            ERR.SURTIDO_FALLIDO,
            "No se pudo aplicar el surtido en inventario: " + toStr_(movementError && movementError.message)
          );
        }
        perfMark_(trace, "REGISTER_SURTIDO_TRASPASOS_APPLIED", {
          elapsedMs: Date.now() - movementStartedAt,
          partial: remaining > 0
        });
        if (!movement || (Number(movement.totalNuevos || 0) + Number(movement.totalYaAplicados || 0)) < 1) {
          throw domainError_(ERR.SURTIDO_FALLIDO, "El movimiento de surtido no fue confirmado por inventario.");
        }
        // La caché de surtibles se corrige con este surtido (sin reconsolidar).
        patchSurtibleCache_(inventoryRevisionBefore, state.idUnico, remaining, trace);

        const temporal = getReabastecimientoTemporalContext_();
        const record = {
          idSolicitud: id,
          idUnico: toStr_(state.idUnico),
          codigo: toStrUpper_(state.codigo),
          descripcion: toStrUpper_(state.descripcion),
          cantidad: quantity,
          saldoAnterior: balance,
          saldoRestante: remaining,
          tipoSurtido: remaining > 0 ? RC.TIPOS_SURTIDO.PARCIAL : RC.TIPOS_SURTIDO.TOTAL,
          bodegaOrigen: originWarehouse,
          ubicacionOrigen: originLocation,
          idOperacion: operationId,
          fechaEscaneo: temporal.fecha,
          horaEscaneo: temporal.hora,
          usuarioResponsable: user.nombre
        };
        try {
          record.idDetalleConsecutivo = ReabastecimientoDetallesRepository.nextDetailConsecutiveUnderLock(id, trace);
          ReabastecimientoDetallesRepository.appendUnderLock(record, trace);
          ReabastecimientoPartidasRepository.markInAttentionUnderLock(id, partId, temporal, user.nombre, trace);
          const auxiliaries = withAuxiliary_(request.auxiliares, user.nombre);
          if (auxiliaries.length !== (request.auxiliares || []).length) {
            ReabastecimientoSolicitudesRepository.updateFieldsUnderLock(id, { auxiliares: auxiliaries }, trace);
          }
          perfMark_(trace, "REGISTER_DETAIL_PERSISTED");
          bumpRevision_(id, trace);
        } catch (detailError) {
          console.error(CFG.LOG_PREFIX + " Surtido aplicado sin detalle de solicitud.", {
            operation: operationId,
            message: toStr_(detailError && detailError.message)
          });
          throw domainError_(
            ERR.REGISTRO_INCOMPLETO,
            "El surtido se aplicó en inventario, pero no se pudo anotar en la solicitud. " +
            "Reporta al encargado la etiqueta " + toStr_(state.idUnico) + " (operación " + operationId + ")."
          );
        }

        const hasRemnant = Number(movement.remanentesGenerados || 0) > 0;
        return Object.assign(projectScannedDetail_(record), {
          idSolicitud: id,
          idPartidaConsecutivo: partId,
          yaAplicado: Number(movement.totalNuevos || 0) === 0,
          impresion: hasRemnant
            ? {
                ok: true,
                remanentesGenerados: Number(movement.remanentesGenerados || 0),
                htmlImpresion: movement.htmlImpresion || "",
                printJob: movement.printJob || null
              }
            : null
        });
      }, trace);
      withDetail_(result, id);
      clearReabastecimientoCaches_();
      if (typeof EstadoActualExcedentesService.clearCache === "function") {
        EstadoActualExcedentesService.clearCache();
      }
      finishTrace_(trace, { created: true, partial: result.tipoSurtido === RC.TIPOS_SURTIDO.PARCIAL });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  // ==========================================================================
  // CONCLUSIÓN DE SKU
  // ==========================================================================

  /**
   * Confirma la atención de un SKU como ATENDIDO o ATENDIDO_PARCIAL.
   *
   * @param {*} payload {idSolicitud, idPartidaConsecutivo, usuario, resultado}
   * @return {!Object} Estado de la partida y de la solicitud.
   */
  function concludePart(payload) {
    const trace = startTrace_("REABASTECIMIENTO_CONCLUDE_PART", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const partId = toStr_(input.idPartidaConsecutivo);
      const finalState = toStrUpper_(input.resultado) || PART.ATENDIDO;
      if (RC.PARTIDA_ESTADOS_CONCLUIDOS.indexOf(finalState) === -1) {
        throw domainError_(ERR.TRANSICION_INVALIDA, "Indica si el SKU quedó ATENDIDO o ATENDIDO_PARCIAL.");
      }
      const user = validateUser_(input.usuario, trace);
      const result = underLock_("REABASTECIMIENTO_CONCLUDE_PART", function() {
        const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
        const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
        assertOperable_(request, parts, { requireTaken: true });
        const part = ReabastecimientoPartidasRepository.getByKey(id, partId, trace);
        if (!part) throw domainError_(ERR.PARTIDA_NO_ENCONTRADA, "La partida no existe.");
        const boxes = ReabastecimientoDetallesRepository.getByCodigo(id, part.codigoSolicitado, trace).length;
        if (boxes < 1) {
          throw domainError_(
            ERR.PARTIDA_SIN_CAJAS,
            "Registra al menos una caja del SKU antes de confirmarlo. Si no hay material, déjalo pendiente y justifica al cerrar."
          );
        }
        const temporal = getReabastecimientoTemporalContext_();
        const update = ReabastecimientoPartidasRepository.concludeUnderLock(id, partId, finalState, temporal, user.nombre, trace);
        const auxiliaries = withAuxiliary_(request.auxiliares, user.nombre);
        if (auxiliaries.length !== (request.auxiliares || []).length) {
          ReabastecimientoSolicitudesRepository.updateFieldsUnderLock(id, { auxiliares: auxiliaries }, trace);
        }
        if (update.updated) bumpRevision_(id, trace);
        const updatedParts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
        return {
          idSolicitud: id,
          idPartidaConsecutivo: partId,
          estado: update.estado,
          actualizada: update.updated,
          cajas: boxes,
          estadoSolicitud: deriveRequestState_(ReabastecimientoSolicitudesRepository.getById(id, trace), updatedParts)
        };
      }, trace);
      withDetail_(result, id);
      clearReabastecimientoCaches_();
      finishTrace_(trace, { state: result.estado });
      return result;
    } catch (error) {
      failTrace_(trace, error);
      throw error;
    }
  }

  /** Compatibilidad: atenderPartida concluye el SKU como ATENDIDO. */
  function attendPart(payload) {
    const input = Object.assign({}, payload || {}, { resultado: PART.ATENDIDO });
    return concludePart(input);
  }

  // ==========================================================================
  // CIERRE
  // ==========================================================================

  /**
   * Cierra y bloquea la solicitud.
   *
   * - Si todos los SKU están concluidos, queda CERRADA.
   * - Si existen SKU pendientes o en atención, exige motivo y queda
   *   CERRADA_CON_PENDIENTES.
   *
   * @param {*} payload {idSolicitud, usuario, motivo?}
   * @return {!Object} Resultado idempotente del cierre.
   */
  function closeRequest(payload) {
    const trace = startTrace_("REABASTECIMIENTO_CLOSE_REQUEST", {});
    try {
      assertDependencies_();
      const input = payload && typeof payload === "object" ? payload : {};
      const id = toStrUpper_(input.idSolicitud);
      const user = validateUser_(input.usuario, trace);
      const reason = toStr_(input.motivo).slice(0, RC.LIMITES.MOTIVO_MAX_LENGTH);
      const result = underLock_("REABASTECIMIENTO_CLOSE_REQUEST", function() {
        const request = ReabastecimientoSolicitudesRepository.getById(id, trace);
        if (!request) throw domainError_(ERR.SOLICITUD_NO_ENCONTRADA, "La solicitud no existe.");
        const parts = ReabastecimientoPartidasRepository.getBySolicitud(id, trace);
        const currentState = deriveRequestState_(request, parts);
        if (isClosedState_(currentState)) {
          return {
            idSolicitud: id,
            cerrada: true,
            yaCerrada: true,
            estado: currentState,
            cajasInvolucradas: toNum_(request.cajasInvolucradas),
            fechaCierre: serializeTemporalValue_(request.fechaCierreAtencion, "dd/MM/yyyy"),
            horaCierre: serializeTemporalValue_(request.horaCierreAtencion, "HH:mm"),
            usuarioCierre: toStrUpper_(request.usuarioCierre)
          };
        }
        assertOperable_(request, parts, { requireTaken: true });
        const pending = parts.filter(function(part) { return !isConcluded_(part); });
        if (pending.length > 0 && reason.length < RC.LIMITES.MOTIVO_MIN_LENGTH) {
          throw domainError_(
            ERR.MOTIVO_REQUERIDO,
            "Hay " + pending.length + " SKU sin concluir. Escribe el motivo para cerrar con pendientes.",
            { pendientes: pending.length }
          );
        }
        const boxes = ReabastecimientoDetallesRepository.countUniqueBoxes(id, trace);
        const temporal = getReabastecimientoTemporalContext_();
        const withPending = pending.length > 0;
        ReabastecimientoSolicitudesRepository.updateFieldsUnderLock(id, {
          fechaCierreAtencion: temporal.fecha,
          horaCierreAtencion: temporal.hora,
          cajasInvolucradas: boxes,
          usuarioCierre: user.nombre,
          cierreConPendientes: withPending ? "SI" : "NO",
          motivoCierre: reason
        }, trace);
        bumpRevision_(id, trace);
        return {
          idSolicitud: id,
          cerrada: true,
          yaCerrada: false,
          estado: withPending ? STATES.CERRADA_CON_PENDIENTES : STATES.CERRADA,
          pendientes: pending.length,
          cajasInvolucradas: boxes,
          fechaCierre: temporal.fecha,
          horaCierre: temporal.hora,
          usuarioCierre: user.nombre
        };
      }, trace);
      withDetail_(result, id);
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

  /**
   * Anuncia un cambio hecho por otro módulo en las hojas de Reabastecimiento
   * (por ejemplo, la Administración de excedentes al vaciar un detalle).
   * Confirma, sube la revisión y publica las copias de las hojas escritas,
   * igual que una escritura propia. DEBE llamarse dentro del ScriptLock.
   *
   * @param {string} idSolicitud Folio afectado.
   * @param {Object=} trace Traza activa.
   * @return {?Object} Revisión nueva.
   */
  function notifyExternalChange(idSolicitud, trace) {
    return bumpRevision_(toStrUpper_(idSolicitud), trace);
  }

  return Object.freeze({
    notificarCambioExterno: notifyExternalChange,
    getExcedentesSolicitudManual: getManualRequestExcess,
    getCandidatosPorBodega: getCandidatesByWarehouse,
    crearSolicitud: createRequest,
    getSolicitudes: getRequests,
    getDetalleSolicitud: getRequestDetail,
    tomarSolicitud: takeRequest,
    getUbicacionesPartida: getPartLocations,
    concluirPartida: concludePart,
    atenderPartida: attendPart,
    validarIdUnico: validateIdUnico,
    registrarIdUnico: registerIdUnico,
    cerrarSolicitud: closeRequest,
    derivarEstadoSolicitud: deriveRequestState_,
    clearCache
  });
})();
