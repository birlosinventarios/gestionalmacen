/**
 * z2-DocumentosRepository.gs
 *
 * @fileoverview Repositorio autoritativo para la hoja MAT_DOCUMENTOS.
 *
 * RESPONSABILIDADES
 * - Leer y mapear documentos de la cola operativa del almacén.
 * - Tratar COTIZACION_NUM como clave natural única, obligatoria e inmutable.
 * - Generar ID_DOCUMENTO_MAT e ID_CONSECUTIVODIARIO en el servidor.
 * - Insertar y actualizar filas con ancho controlado.
 * - Proteger operaciones de lectura-modificación-escritura mediante ScriptLock.
 * - Mantener una caché privada válida únicamente durante la ejecución actual.
 * - Validar el contrato físico de la hoja antes de la primera escritura.
 *
 * FUERA DE ALCANCE
 * - No administra MAT_DOCUMENTODETALLE.
 * - No calcula reglas de surtido, verificación, empaque, pago o entrega.
 * - No coordina transacciones compuestas entre cabecera y detalle.
 * - No autoriza usuarios ni valida permisos funcionales.
 *
 * INVARIANTES
 * - MAT_DOCUMENTOS contiene como máximo una fila por COTIZACION_NUM.
 * - COTIZACION_NUM se almacena como texto y nunca se convierte a número.
 * - ID_DOCUMENTO_MAT, ID_CONSECUTIVODIARIO y COTIZACION_NUM son inmutables.
 * - La lectura que determina una inserción y la escritura ocurren bajo el mismo
 *   ScriptLock.
 * - Toda escritura invalida la caché privada del repositorio.
 *
 * DEPENDENCIAS
 * - z0-UtilidadesDatos.gs
 * - z1-Constants.gs
 * - SHEETS.MAT_DOCUMENTOS
 * - COL.MAT_DOCUMENTOS
 * - GESTION_MATERIAL_DOCUMENTOS
 * - GESTION_MATERIAL_DOCUMENTOS_HEADERS
 * - GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS
 *
 * @author Sigifredo de la Cruz Ramos
 * @version MAT-DOC-REP-2026-10-26-01
 */
const DocumentosRepository = (function() {
  "use strict";

  /** @const {string} */
  const REPOSITORY_NAME = "DocumentosRepository";

  /** @const {Object} */
  const CONFIG = Object.freeze({
    SHEET_KEY: "MAT_DOCUMENTOS",
    FIRST_DATA_ROW: 2,
    LOCK_LABEL: "MAT_DOCUMENTOS_WRITE",
    ID_PREFIX: "MAT-DOC"
  });

  /**
   * Campos que pueden modificarse después del alta.
   * Las claves técnicas y los datos originales de la cotización permanecen
   * inmutables para preservar trazabilidad.
   *
   * @const {Object<string, boolean>}
   */
  const MUTABLE_FIELDS = Object.freeze({
    clienteNum: true,
    clienteNombre: true,
    vendedorNombre: true,
    surtidoNombre: true,
    surtidoDia: true,
    surtidoHoraInicio: true,
    surtidoHoraFin: true,
    verificadorNombre: true,
    verificacionDia: true,
    verificacionHoraInicio: true,
    verificacionHoraFin: true,
    verificadoUbicacion: true,
    verificadoUbicadoFecha: true,
    verificadoUbicadoHora: true,
    empaqueResumen: true,
    pagoMonto: true,
    pagoMetodo: true,
    pagoVerificacion: true,
    cfdiUso: true,
    entregaNombre: true,
    entregaDia: true,
    entregaHora: true
  });

  /** @type {?Array<Object>} Caché privada por ejecución. */
  let cache_ = null;

  /** @type {boolean} Evita validar repetidamente el mismo contrato físico. */
  let contractValidated_ = false;

  // -------------------------------------------------------------------------
  // DEPENDENCIAS Y CONTRATOS
  // -------------------------------------------------------------------------

  /**
   * Verifica las dependencias globales necesarias para operar.
   *
   * @private
   * @return {void}
   */
  function assertDependencies_() {
    if (typeof SHEETS === "undefined" || !SHEETS.MAT_DOCUMENTOS) {
      throw createError_(
        "MAT_DOC_CONFIG_MISSING",
        "No existe SHEETS.MAT_DOCUMENTOS."
      );
    }

    if (typeof COL === "undefined" || !COL.MAT_DOCUMENTOS) {
      throw createError_(
        "MAT_DOC_COLUMNS_MISSING",
        "No existe COL.MAT_DOCUMENTOS."
      );
    }

    if (
      typeof GESTION_MATERIAL_DOCUMENTOS === "undefined" ||
      !GESTION_MATERIAL_DOCUMENTOS
    ) {
      throw createError_(
        "MAT_DOC_DOMAIN_MISSING",
        "GESTION_MATERIAL_DOCUMENTOS no está disponible."
      );
    }

    if (
      typeof GESTION_MATERIAL_DOCUMENTOS_HEADERS === "undefined" ||
      !GESTION_MATERIAL_DOCUMENTOS_HEADERS ||
      !Array.isArray(GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTOS)
    ) {
      throw createError_(
        "MAT_DOC_HEADERS_MISSING",
        "No existe el contrato de encabezados de MAT_DOCUMENTOS."
      );
    }

    if (
      typeof GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS === "undefined" ||
      Number(
        GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS.MAT_DOCUMENTOS || 0
      ) <= 0
    ) {
      throw createError_(
        "MAT_DOC_WIDTH_MISSING",
        "No existe el ancho esperado de MAT_DOCUMENTOS."
      );
    }

    [
      "readSheetRows_",
      "writeRowsBatch_",
      "writeRowAt_",
      "withScriptLock_",
      "normalizeCotizacionNum_",
      "normalizeTextField_",
      "normalizeEnumValue_",
      "normalizeMoney_",
      "generateTechnicalId_",
      "nextDailyConsecutive_",
      "assertSheetContract_",
      "clonePlain_"
    ].forEach(function(functionName) {
      if (typeof globalThis[functionName] !== "function") {
        throw createError_(
          "MAT_DOC_UTILITY_MISSING",
          "La utilidad " + functionName + " no está disponible."
        );
      }
    });
  }

  /**
   * Valida el ancho e identidad de las columnas declaradas en COL.
   *
   * @private
   * @return {void}
   */
  function assertColumnContract_() {
    const columns = COL.MAT_DOCUMENTOS;
    const headers = GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTOS;
    const expectedWidth = getExpectedWidth_();
    const indexes = Object.keys(columns).map(function(key) {
      return Number(columns[key]);
    });

    if (headers.length !== expectedWidth) {
      throw createError_(
        "MAT_DOC_WIDTH_CONFLICT",
        "El ancho esperado no coincide con los encabezados de MAT_DOCUMENTOS."
      );
    }

    if (
      indexes.length !== expectedWidth ||
      new Set(indexes).size !== expectedWidth ||
      Math.min.apply(null, indexes) !== 0 ||
      Math.max.apply(null, indexes) !== expectedWidth - 1
    ) {
      throw createError_(
        "MAT_DOC_COLUMNS_INVALID",
        "COL.MAT_DOCUMENTOS debe contener índices únicos y consecutivos de 0 a " +
          (expectedWidth - 1) + "."
      );
    }
  }

  /**
   * Valida una sola vez por ejecución la estructura física de la hoja.
   *
   * @private
   * @param {Object=} trace Tracker opcional.
   * @return {void}
   */
  function ensureContract_(trace) {
    assertDependencies_();
    assertColumnContract_();

    if (contractValidated_) return;

    assertSheetContract_(
      CONFIG.SHEET_KEY,
      GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTOS,
      trace
    );

    contractValidated_ = true;
  }

  /** @private @return {number} */
  function getExpectedWidth_() {
    return Number(
      GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS.MAT_DOCUMENTOS
    );
  }

  /** @private @return {number} */
  function getLockTimeout_() {
    return Math.max(
      1,
      Number(
        GESTION_MATERIAL_DOCUMENTOS.LIMITES.LOCK_TIMEOUT_MS || 30000
      )
    );
  }

  // -------------------------------------------------------------------------
  // ERRORES Y COPIAS DEFENSIVAS
  // -------------------------------------------------------------------------

  /**
   * Crea un Error con código estable y detalles serializables.
   *
   * @private
   * @param {string} code Código funcional.
   * @param {string} message Mensaje legible.
   * @param {Object=} details Detalles seguros.
   * @return {Error}
   */
  function createError_(code, message, details) {
    const error = new Error(String(message || "Error en DocumentosRepository."));
    error.name = "DocumentosRepositoryError";
    error.code = String(code || "MAT_DOC_REPOSITORY_ERROR");
    error.details = details && typeof details === "object"
      ? cloneSafe_(details)
      : {};
    return error;
  }

  /**
   * Clona estructuras serializables sin exponer referencias internas.
   *
   * @private
   * @param {*} value Valor original.
   * @return {*}
   */
  function cloneSafe_(value) {
    if (value == null) return value;
    return clonePlain_(value);
  }

  /** @private @param {Array<Object>} rows @return {Array<Object>} */
  function cloneList_(rows) {
    return cloneSafe_(Array.isArray(rows) ? rows : []);
  }

  // -------------------------------------------------------------------------
  // NORMALIZACIÓN DE CAMPOS
  // -------------------------------------------------------------------------

  /**
   * Normaliza una fecha al contrato dd/MM/yyyy.
   *
   * @private
   * @param {*} value Valor recibido.
   * @param {Object=} options Opciones.
   * @return {string}
   */
  function normalizeDateField_(value, options) {
    const opts = options || {};
    const fieldName = String(opts.fieldName || "fecha");
    const fallbackNow = opts.fallbackNow === true;

    if (value === "" || value == null) {
      if (fallbackNow) return fmtDateNow_();
      return "";
    }

    const date = toDate_(value);
    if (!date) {
      throw createError_(
        "MAT_DOC_INVALID_DATE",
        fieldName + " debe usar el formato dd/MM/yyyy."
      );
    }

    return formatDate_(date);
  }

  /**
   * Normaliza una hora al contrato HH:mm:ss.
   *
   * @private
   * @param {*} value Valor recibido.
   * @param {Object=} options Opciones.
   * @return {string}
   */
  function normalizeTimeField_(value, options) {
    const opts = options || {};
    const fieldName = String(opts.fieldName || "hora");
    const fallbackNow = opts.fallbackNow === true;

    if (value === "" || value == null) {
      if (fallbackNow) return fmtTimeNow_();
      return "";
    }

    const time = toTime_(value);
    if (!time) {
      throw createError_(
        "MAT_DOC_INVALID_TIME",
        fieldName + " debe usar el formato HH:mm:ss."
      );
    }

    return formatTime_(time);
  }

  /**
   * Normaliza texto usando el límite de nombres del dominio.
   *
   * @private
   * @param {*} value Valor.
   * @param {string} fieldName Nombre funcional.
   * @return {string}
   */
  function normalizeName_(value, fieldName) {
    return normalizeTextField_(value, {
      fieldName: fieldName,
      required: false,
      maxLength: Number(
        GESTION_MATERIAL_DOCUMENTOS.LIMITES.NOMBRE_MAX_LENGTH || 250
      )
    });
  }

  /**
   * Normaliza un documento completo para inserción.
   *
   * @private
   * @param {Object} input Documento recibido.
   * @param {Array<Object>} currentDocuments Documentos existentes bajo lock.
   * @return {Object}
   */
  function normalizeForInsert_(input, currentDocuments) {
    requirePlainObject_(input, "documento");

    const cotizacionNum = normalizeCotizacionNum_(
      pickValue_(input, ["cotizacionNum", "COTIZACION_NUM"])
    );
    const cotizacionFecha = normalizeDateField_(
      pickValue_(input, ["cotizacionFecha", "COTIZACION_FECHA"]),
      {
        fieldName: "COTIZACION_FECHA",
        fallbackNow: true
      }
    );
    const cotizacionHora = normalizeTimeField_(
      pickValue_(input, ["cotizacionHora", "COTIZACION_HORA"]),
      {
        fieldName: "COTIZACION_HORA",
        fallbackNow: true
      }
    );

    return {
      idDocumentoMat: generateUniqueDocumentId_(currentDocuments),
      idConsecutivoDiario: nextDailyConsecutive_(
        currentDocuments,
        cotizacionFecha
      ),
      cotizacionFecha: cotizacionFecha,
      cotizacionHora: cotizacionHora,
      cotizacionNum: cotizacionNum,
      clienteNum: normalizeTextField_(
        pickValue_(input, ["clienteNum", "CLIENTE_NUM"]),
        {
          fieldName: "CLIENTE_NUM",
          maxLength: Number(
            GESTION_MATERIAL_DOCUMENTOS.LIMITES.CLIENTE_NUM_MAX_LENGTH || 100
          )
        }
      ),
      clienteNombre: normalizeName_(
        pickValue_(input, ["clienteNombre", "CLIENTE_NOMBRE"]),
        "CLIENTE_NOMBRE"
      ),
      vendedorNombre: normalizeName_(
        pickValue_(input, ["vendedorNombre", "VENDEDOR_NOMBRE"]),
        "VENDEDOR_NOMBRE"
      ),
      surtidoNombre: normalizeName_(
        pickValue_(input, ["surtidoNombre", "SURTIDO_NOMBRE"]),
        "SURTIDO_NOMBRE"
      ),
      surtidoDia: normalizeDateField_(
        pickValue_(input, ["surtidoDia", "SURTIDO_DIA"]),
        { fieldName: "SURTIDO_DIA" }
      ),
      surtidoHoraInicio: normalizeTimeField_(
        pickValue_(input, ["surtidoHoraInicio", "SURTIDO_HORAINICIO"]),
        { fieldName: "SURTIDO_HORAINICIO" }
      ),
      surtidoHoraFin: normalizeTimeField_(
        pickValue_(input, ["surtidoHoraFin", "SURTIDO_HORAFIN"]),
        { fieldName: "SURTIDO_HORAFIN" }
      ),
      verificadorNombre: normalizeName_(
        pickValue_(input, ["verificadorNombre", "VERIFICADOR_NOMBRE"]),
        "VERIFICADOR_NOMBRE"
      ),
      verificacionDia: normalizeDateField_(
        pickValue_(input, ["verificacionDia", "VERIFICACION_DIA"]),
        { fieldName: "VERIFICACION_DIA" }
      ),
      verificacionHoraInicio: normalizeTimeField_(
        pickValue_(input, [
          "verificacionHoraInicio",
          "VERIFICACION_HORAINICIO"
        ]),
        { fieldName: "VERIFICACION_HORAINICIO" }
      ),
      verificacionHoraFin: normalizeTimeField_(
        pickValue_(input, ["verificacionHoraFin", "VERIFICACION_HORAFIN"]),
        { fieldName: "VERIFICACION_HORAFIN" }
      ),
      verificadoUbicacion: normalizeName_(
        pickValue_(input, ["verificadoUbicacion", "VERIFICADO_UBICACION"]),
        "VERIFICADO_UBICACION"
      ),
      verificadoUbicadoFecha: normalizeDateField_(
        pickValue_(input, [
          "verificadoUbicadoFecha",
          "VERIFICADO_UBICADOFECHA"
        ]),
        { fieldName: "VERIFICADO_UBICADOFECHA" }
      ),
      verificadoUbicadoHora: normalizeTimeField_(
        pickValue_(input, [
          "verificadoUbicadoHora",
          "VERIFICADO_UBICADOHORA"
        ]),
        { fieldName: "VERIFICADO_UBICADOHORA" }
      ),
      empaqueResumen: normalizeTextField_(
        pickValue_(input, ["empaqueResumen", "EMPAQUE_RESUMEN"]),
        {
          fieldName: "EMPAQUE_RESUMEN",
          maxLength: Number(
            GESTION_MATERIAL_DOCUMENTOS.LIMITES.EMPAQUE_RESUMEN_MAX_LENGTH ||
              2000
          )
        }
      ),
      pagoMonto: normalizeMoney_(
        pickValue_(input, ["pagoMonto", "PAGO_MONTO"]),
        "PAGO_MONTO"
      ),
      pagoMetodo: normalizeEnumValue_(
        pickValue_(input, ["pagoMetodo", "PAGO_METODO"]),
        GESTION_MATERIAL_DOCUMENTOS.PAGO_METODOS,
        {
          fieldName: "PAGO_METODO",
          defaultValue: GESTION_MATERIAL_DOCUMENTOS.PAGO_METODOS.PENDIENTE
        }
      ),
      pagoVerificacion: normalizeEnumValue_(
        pickValue_(input, ["pagoVerificacion", "PAGO_VERIFICACION"]),
        GESTION_MATERIAL_DOCUMENTOS.PAGO_VERIFICACION_ESTADOS,
        {
          fieldName: "PAGO_VERIFICACION",
          defaultValue:
            GESTION_MATERIAL_DOCUMENTOS.PAGO_VERIFICACION_ESTADOS.PENDIENTE
        }
      ),
      cfdiUso: normalizeTextField_(
        pickValue_(input, ["cfdiUso", "CFDI_USO"]),
        {
          fieldName: "CFDI_USO",
          maxLength: 100
        }
      ),
      entregaNombre: normalizeName_(
        pickValue_(input, ["entregaNombre", "ENTREGA_NOMBRE"]),
        "ENTREGA_NOMBRE"
      ),
      entregaDia: normalizeDateField_(
        pickValue_(input, ["entregaDia", "ENTREGA_DIA"]),
        { fieldName: "ENTREGA_DIA" }
      ),
      entregaHora: normalizeTimeField_(
        pickValue_(input, ["entregaHora", "ENTREGA_HORA"]),
        { fieldName: "ENTREGA_HORA" }
      )
    };
  }

  /**
   * Aplica un patch permitido sobre un documento existente.
   *
   * @private
   * @param {Object} current Documento actual.
   * @param {Object} patch Cambios solicitados.
   * @return {Object}
   */
  function normalizeForUpdate_(current, patch) {
    requirePlainObject_(patch, "patch");

    assertImmutableFields_(current, patch);

    const merged = Object.assign({}, current);
    Object.keys(patch).forEach(function(key) {
      const camelKey = resolveMutableFieldName_(key);
      if (!camelKey || !MUTABLE_FIELDS[camelKey]) return;
      merged[camelKey] = patch[key];
    });

    const normalized = normalizeForInsertLike_(merged);
    normalized.idDocumentoMat = current.idDocumentoMat;
    normalized.idConsecutivoDiario = current.idConsecutivoDiario;
    normalized.cotizacionFecha = current.cotizacionFecha;
    normalized.cotizacionHora = current.cotizacionHora;
    normalized.cotizacionNum = current.cotizacionNum;
    normalized._rowNumber = current._rowNumber;
    return normalized;
  }

  /**
   * Normaliza todos los campos mutables sin generar identidad ni consecutivo.
   *
   * @private
   * @param {Object} value Documento combinado.
   * @return {Object}
   */
  function normalizeForInsertLike_(value) {
    return {
      clienteNum: normalizeTextField_(value.clienteNum, {
        fieldName: "CLIENTE_NUM",
        maxLength: Number(
          GESTION_MATERIAL_DOCUMENTOS.LIMITES.CLIENTE_NUM_MAX_LENGTH || 100
        )
      }),
      clienteNombre: normalizeName_(value.clienteNombre, "CLIENTE_NOMBRE"),
      vendedorNombre: normalizeName_(value.vendedorNombre, "VENDEDOR_NOMBRE"),
      surtidoNombre: normalizeName_(value.surtidoNombre, "SURTIDO_NOMBRE"),
      surtidoDia: normalizeDateField_(value.surtidoDia, {
        fieldName: "SURTIDO_DIA"
      }),
      surtidoHoraInicio: normalizeTimeField_(value.surtidoHoraInicio, {
        fieldName: "SURTIDO_HORAINICIO"
      }),
      surtidoHoraFin: normalizeTimeField_(value.surtidoHoraFin, {
        fieldName: "SURTIDO_HORAFIN"
      }),
      verificadorNombre: normalizeName_(
        value.verificadorNombre,
        "VERIFICADOR_NOMBRE"
      ),
      verificacionDia: normalizeDateField_(value.verificacionDia, {
        fieldName: "VERIFICACION_DIA"
      }),
      verificacionHoraInicio: normalizeTimeField_(
        value.verificacionHoraInicio,
        { fieldName: "VERIFICACION_HORAINICIO" }
      ),
      verificacionHoraFin: normalizeTimeField_(value.verificacionHoraFin, {
        fieldName: "VERIFICACION_HORAFIN"
      }),
      verificadoUbicacion: normalizeName_(
        value.verificadoUbicacion,
        "VERIFICADO_UBICACION"
      ),
      verificadoUbicadoFecha: normalizeDateField_(
        value.verificadoUbicadoFecha,
        { fieldName: "VERIFICADO_UBICADOFECHA" }
      ),
      verificadoUbicadoHora: normalizeTimeField_(
        value.verificadoUbicadoHora,
        { fieldName: "VERIFICADO_UBICADOHORA" }
      ),
      empaqueResumen: normalizeTextField_(value.empaqueResumen, {
        fieldName: "EMPAQUE_RESUMEN",
        maxLength: Number(
          GESTION_MATERIAL_DOCUMENTOS.LIMITES.EMPAQUE_RESUMEN_MAX_LENGTH ||
            2000
        )
      }),
      pagoMonto: normalizeMoney_(value.pagoMonto, "PAGO_MONTO"),
      pagoMetodo: normalizeEnumValue_(
        value.pagoMetodo,
        GESTION_MATERIAL_DOCUMENTOS.PAGO_METODOS,
        {
          fieldName: "PAGO_METODO",
          defaultValue: GESTION_MATERIAL_DOCUMENTOS.PAGO_METODOS.PENDIENTE
        }
      ),
      pagoVerificacion: normalizeEnumValue_(
        value.pagoVerificacion,
        GESTION_MATERIAL_DOCUMENTOS.PAGO_VERIFICACION_ESTADOS,
        {
          fieldName: "PAGO_VERIFICACION",
          defaultValue:
            GESTION_MATERIAL_DOCUMENTOS.PAGO_VERIFICACION_ESTADOS.PENDIENTE
        }
      ),
      cfdiUso: normalizeTextField_(value.cfdiUso, {
        fieldName: "CFDI_USO",
        maxLength: 100
      }),
      entregaNombre: normalizeName_(value.entregaNombre, "ENTREGA_NOMBRE"),
      entregaDia: normalizeDateField_(value.entregaDia, {
        fieldName: "ENTREGA_DIA"
      }),
      entregaHora: normalizeTimeField_(value.entregaHora, {
        fieldName: "ENTREGA_HORA"
      })
    };
  }

  /**
   * Impide modificar claves técnicas o información original de la cotización.
   *
   * @private
   * @param {Object} current Registro actual.
   * @param {Object} patch Cambios solicitados.
   * @return {void}
   */
  function assertImmutableFields_(current, patch) {
    const immutableAliases = {
      idDocumentoMat: "idDocumentoMat",
      ID_DOCUMENTO_MAT: "idDocumentoMat",
      idConsecutivoDiario: "idConsecutivoDiario",
      ID_CONSECUTIVODIARIO: "idConsecutivoDiario",
      cotizacionFecha: "cotizacionFecha",
      COTIZACION_FECHA: "cotizacionFecha",
      cotizacionHora: "cotizacionHora",
      COTIZACION_HORA: "cotizacionHora",
      cotizacionNum: "cotizacionNum",
      COTIZACION_NUM: "cotizacionNum"
    };

    Object.keys(immutableAliases).forEach(function(alias) {
      if (!Object.prototype.hasOwnProperty.call(patch, alias)) return;

      const currentKey = immutableAliases[alias];
      const requested = String(patch[alias] == null ? "" : patch[alias]).trim();
      const stored = String(
        current[currentKey] == null ? "" : current[currentKey]
      ).trim();

      if (requested !== stored) {
        throw createError_(
          GESTION_MATERIAL_DOCUMENTOS.ERRORES.COTIZACION_INMUTABLE,
          alias + " es inmutable después del alta.",
          { field: alias }
        );
      }
    });
  }

  /**
   * Resuelve nombres camelCase y UPPER_SNAKE_CASE a la propiedad interna.
   *
   * @private
   * @param {string} key Clave recibida.
   * @return {string}
   */
  function resolveMutableFieldName_(key) {
    const aliases = {
      CLIENTE_NUM: "clienteNum",
      CLIENTE_NOMBRE: "clienteNombre",
      VENDEDOR_NOMBRE: "vendedorNombre",
      SURTIDO_NOMBRE: "surtidoNombre",
      SURTIDO_DIA: "surtidoDia",
      SURTIDO_HORAINICIO: "surtidoHoraInicio",
      SURTIDO_HORAFIN: "surtidoHoraFin",
      VERIFICADOR_NOMBRE: "verificadorNombre",
      VERIFICACION_DIA: "verificacionDia",
      VERIFICACION_HORAINICIO: "verificacionHoraInicio",
      VERIFICACION_HORAFIN: "verificacionHoraFin",
      VERIFICADO_UBICACION: "verificadoUbicacion",
      VERIFICADO_UBICADOFECHA: "verificadoUbicadoFecha",
      VERIFICADO_UBICADOHORA: "verificadoUbicadoHora",
      EMPAQUE_RESUMEN: "empaqueResumen",
      PAGO_MONTO: "pagoMonto",
      PAGO_METODO: "pagoMetodo",
      PAGO_VERIFICACION: "pagoVerificacion",
      CFDI_USO: "cfdiUso",
      ENTREGA_NOMBRE: "entregaNombre",
      ENTREGA_DIA: "entregaDia",
      ENTREGA_HORA: "entregaHora"
    };

    return MUTABLE_FIELDS[key] ? key : aliases[key] || "";
  }

  /**
   * Genera un ID no repetido dentro de la fotografía actual protegida por lock.
   *
   * @private
   * @param {Array<Object>} currentDocuments Documentos vigentes.
   * @return {string}
   */
  function generateUniqueDocumentId_(currentDocuments) {
    const existing = new Set(
      (currentDocuments || []).map(function(document) {
        return toStrUpper_(document.idDocumentoMat);
      })
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateTechnicalId_(CONFIG.ID_PREFIX);
      if (!existing.has(candidate)) return candidate;
    }

    throw createError_(
      "MAT_DOC_ID_GENERATION_FAILED",
      "No fue posible generar un ID_DOCUMENTO_MAT único."
    );
  }

  /**
   * Obtiene el primer valor propio presente entre varios alias.
   *
   * @private
   * @param {Object} object Objeto fuente.
   * @param {Array<string>} keys Alias permitidos.
   * @return {*}
   */
  function pickValue_(object, keys) {
    for (let i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(object, keys[i])) {
        return object[keys[i]];
      }
    }
    return "";
  }

  // -------------------------------------------------------------------------
  // MAPEO ENTRE FILAS Y OBJETOS
  // -------------------------------------------------------------------------

  /**
   * Convierte una fila física al contrato público del repositorio.
   *
   * @private
   * @param {Array<*>} row Fila de MAT_DOCUMENTOS.
   * @param {number} rowNumber Número físico de fila.
   * @return {Object}
   */
  function rowToObject_(row, rowNumber) {
    const c = COL.MAT_DOCUMENTOS;

    return {
      idDocumentoMat: toStr_(row[c.ID_DOCUMENTO_MAT]),
      idConsecutivoDiario: Math.floor(toNum_(row[c.ID_CONSECUTIVODIARIO])),
      cotizacionFecha: formatDateFromCell_(row[c.COTIZACION_FECHA]),
      cotizacionHora: formatTimeFromCell_(row[c.COTIZACION_HORA]),
      cotizacionNum: String(
        row[c.COTIZACION_NUM] == null ? "" : row[c.COTIZACION_NUM]
      ).trim(),
      clienteNum: String(
        row[c.CLIENTE_NUM] == null ? "" : row[c.CLIENTE_NUM]
      ).trim(),
      clienteNombre: toStr_(row[c.CLIENTE_NOMBRE]),
      vendedorNombre: toStr_(row[c.VENDEDOR_NOMBRE]),
      surtidoNombre: toStr_(row[c.SURTIDO_NOMBRE]),
      surtidoDia: formatDateFromCell_(row[c.SURTIDO_DIA]),
      surtidoHoraInicio: formatTimeFromCell_(row[c.SURTIDO_HORAINICIO]),
      surtidoHoraFin: formatTimeFromCell_(row[c.SURTIDO_HORAFIN]),
      verificadorNombre: toStr_(row[c.VERIFICADOR_NOMBRE]),
      verificacionDia: formatDateFromCell_(row[c.VERIFICACION_DIA]),
      verificacionHoraInicio: formatTimeFromCell_(
        row[c.VERIFICACION_HORAINICIO]
      ),
      verificacionHoraFin: formatTimeFromCell_(row[c.VERIFICACION_HORAFIN]),
      verificadoUbicacion: toStr_(row[c.VERIFICADO_UBICACION]),
      verificadoUbicadoFecha: formatDateFromCell_(
        row[c.VERIFICADO_UBICADOFECHA]
      ),
      verificadoUbicadoHora: formatTimeFromCell_(
        row[c.VERIFICADO_UBICADOHORA]
      ),
      empaqueResumen: toStr_(row[c.EMPAQUE_RESUMEN]),
      pagoMonto: round2_(toNum_(row[c.PAGO_MONTO])),
      pagoMetodo: toStrUpper_(row[c.PAGO_METODO]),
      pagoVerificacion: toStrUpper_(row[c.PAGO_VERIFICACION]),
      cfdiUso: toStr_(row[c.CFDI_USO]),
      entregaNombre: toStr_(row[c.ENTREGA_NOMBRE]),
      entregaDia: formatDateFromCell_(row[c.ENTREGA_DIA]),
      entregaHora: formatTimeFromCell_(row[c.ENTREGA_HORA]),
      _rowNumber: rowNumber
    };
  }

  /**
   * Convierte un documento normalizado a una fila del ancho exacto.
   *
   * @private
   * @param {Object} document Documento normalizado.
   * @return {Array<*>}
   */
  function objectToRow_(document) {
    const c = COL.MAT_DOCUMENTOS;
    const row = new Array(getExpectedWidth_()).fill("");

    row[c.ID_DOCUMENTO_MAT] = document.idDocumentoMat;
    row[c.ID_CONSECUTIVODIARIO] = document.idConsecutivoDiario;
    row[c.COTIZACION_FECHA] = document.cotizacionFecha;
    row[c.COTIZACION_HORA] = document.cotizacionHora;
    row[c.COTIZACION_NUM] = document.cotizacionNum;
    row[c.CLIENTE_NUM] = document.clienteNum;
    row[c.CLIENTE_NOMBRE] = document.clienteNombre;
    row[c.VENDEDOR_NOMBRE] = document.vendedorNombre;
    row[c.SURTIDO_NOMBRE] = document.surtidoNombre;
    row[c.SURTIDO_DIA] = document.surtidoDia;
    row[c.SURTIDO_HORAINICIO] = document.surtidoHoraInicio;
    row[c.SURTIDO_HORAFIN] = document.surtidoHoraFin;
    row[c.VERIFICADOR_NOMBRE] = document.verificadorNombre;
    row[c.VERIFICACION_DIA] = document.verificacionDia;
    row[c.VERIFICACION_HORAINICIO] = document.verificacionHoraInicio;
    row[c.VERIFICACION_HORAFIN] = document.verificacionHoraFin;
    row[c.VERIFICADO_UBICACION] = document.verificadoUbicacion;
    row[c.VERIFICADO_UBICADOFECHA] = document.verificadoUbicadoFecha;
    row[c.VERIFICADO_UBICADOHORA] = document.verificadoUbicadoHora;
    row[c.EMPAQUE_RESUMEN] = document.empaqueResumen;
    row[c.PAGO_MONTO] = document.pagoMonto;
    row[c.PAGO_METODO] = document.pagoMetodo;
    row[c.PAGO_VERIFICACION] = document.pagoVerificacion;
    row[c.CFDI_USO] = document.cfdiUso;
    row[c.ENTREGA_NOMBRE] = document.entregaNombre;
    row[c.ENTREGA_DIA] = document.entregaDia;
    row[c.ENTREGA_HORA] = document.entregaHora;

    return row;
  }

  /** @private @param {*} value @return {string} */
  function formatDateFromCell_(value) {
    const date = toDate_(value);
    return date ? formatDate_(date) : toStr_(value);
  }

  /** @private @param {*} value @return {string} */
  function formatTimeFromCell_(value) {
    const time = toTime_(value);
    return time ? formatTime_(time) : toStr_(value);
  }

  // -------------------------------------------------------------------------
  // LECTURA Y CACHÉ
  // -------------------------------------------------------------------------

  /**
   * Lee directamente desde MAT_DOCUMENTOS y reconstruye la caché.
   *
   * @private
   * @param {Object=} trace Tracker opcional.
   * @return {Array<Object>}
   */
  function loadFresh_(trace) {
    ensureContract_(trace);

    const rows = readSheetRows_(CONFIG.SHEET_KEY, getExpectedWidth_(), trace);
    const documents = rows
      .map(function(row, index) {
        return rowToObject_(row, index + CONFIG.FIRST_DATA_ROW);
      })
      .filter(function(document) {
        return Boolean(document.cotizacionNum || document.idDocumentoMat);
      });

    assertNoDuplicateCotizations_(documents);
    cache_ = documents;
    return documents;
  }

  /**
   * Devuelve la caché o carga datos frescos.
   *
   * @private
   * @param {Object=} trace Tracker opcional.
   * @return {Array<Object>}
   */
  function getInternal_(trace) {
    if (Array.isArray(cache_)) {
      perfMark_(trace, "MAT_DOCUMENTOS_CACHE_HIT", {
        rows: cache_.length
      });
      return cache_;
    }
    return loadFresh_(trace);
  }

  /**
   * Detecta corrupción de unicidad en la hoja.
   *
   * @private
   * @param {Array<Object>} documents Documentos leídos.
   * @return {void}
   */
  function assertNoDuplicateCotizations_(documents) {
    const seen = Object.create(null);
    const duplicates = [];

    documents.forEach(function(document) {
      const key = document.cotizacionNum;
      if (!key) return;
      if (seen[key]) duplicates.push(key);
      seen[key] = true;
    });

    if (duplicates.length > 0) {
      throw createError_(
        "MAT_DOC_DUPLICATE_DATA",
        "MAT_DOCUMENTOS contiene COTIZACION_NUM duplicadas: " +
          uniqueBy_(duplicates, function(value) { return value; })
            .slice(0, 10)
            .join(", ") + "."
      );
    }
  }

  /** @private @param {Array<Object>} documents @param {string} cotizacionNum */
  function findByCotizacion_(documents, cotizacionNum) {
    for (let index = 0; index < documents.length; index++) {
      if (documents[index].cotizacionNum === cotizacionNum) {
        return documents[index];
      }
    }
    return null;
  }

  /** @private @param {Array<Object>} documents @param {string} id */
  function findById_(documents, id) {
    const normalizedId = toStrUpper_(id);
    if (!normalizedId) return null;

    for (let index = 0; index < documents.length; index++) {
      if (toStrUpper_(documents[index].idDocumentoMat) === normalizedId) {
        return documents[index];
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // API PÚBLICA: CONSULTAS
  // -------------------------------------------------------------------------

  /**
   * Obtiene todos los documentos utilizando caché por ejecución.
   *
   * @param {Object=} trace Tracker opcional.
   * @return {Array<Object>}
   */
  function getAll(trace) {
    assertDependencies_();
    return cloneList_(getInternal_(trace));
  }

  /**
   * Obtiene todos los documentos forzando lectura desde Google Sheets.
   *
   * @param {Object=} trace Tracker opcional.
   * @return {Array<Object>}
   */
  function getAllFresh(trace) {
    assertDependencies_();
    return cloneList_(loadFresh_(trace));
  }

  /**
   * Busca una cotización en la caché vigente.
   *
   * @param {*} cotizacionNum Clave natural.
   * @param {Object=} trace Tracker opcional.
   * @return {?Object}
   */
  function getByCotizacionNum(cotizacionNum, trace) {
    const key = normalizeCotizacionNum_(cotizacionNum);
    return cloneSafe_(findByCotizacion_(getInternal_(trace), key));
  }

  /**
   * Busca una cotización forzando lectura fresca.
   *
   * @param {*} cotizacionNum Clave natural.
   * @param {Object=} trace Tracker opcional.
   * @return {?Object}
   */
  function getByCotizacionNumFresh(cotizacionNum, trace) {
    const key = normalizeCotizacionNum_(cotizacionNum);
    return cloneSafe_(findByCotizacion_(loadFresh_(trace), key));
  }

  /**
   * Indica si existe una cotización.
   *
   * @param {*} cotizacionNum Clave natural.
   * @param {Object=} trace Tracker opcional.
   * @return {boolean}
   */
  function existsByCotizacionNum(cotizacionNum, trace) {
    return Boolean(getByCotizacionNum(cotizacionNum, trace));
  }

  /**
   * Busca por identificador técnico.
   *
   * @param {*} idDocumentoMat Identificador técnico.
   * @param {Object=} trace Tracker opcional.
   * @return {?Object}
   */
  function getByIdDocumentoMat(idDocumentoMat, trace) {
    assertDependencies_();
    return cloneSafe_(findById_(getInternal_(trace), idDocumentoMat));
  }

  // -------------------------------------------------------------------------
  // API PÚBLICA: MUTACIONES
  // -------------------------------------------------------------------------

  /**
   * Inserta una cotización nueva.
   *
   * La verificación de unicidad, la generación del consecutivo y la escritura se
   * ejecutan dentro del mismo ScriptLock.
   *
   * @param {Object} input Datos de la cabecera.
   * @param {Object=} trace Tracker opcional.
   * @return {Object} Documento persistido.
   */
  function insert(input, trace) {
    assertDependencies_();

    return withScriptLock_(
      CONFIG.LOCK_LABEL + "_INSERT",
      function() {
        ensureContract_(trace);
        const documents = loadFresh_(trace);
        const requestedCotizacion = normalizeCotizacionNum_(
          pickValue_(requirePlainObject_(input, "documento"), [
            "cotizacionNum",
            "COTIZACION_NUM"
          ])
        );

        if (findByCotizacion_(documents, requestedCotizacion)) {
          throw createError_(
            GESTION_MATERIAL_DOCUMENTOS.ERRORES.COTIZACION_DUPLICADA,
            "La cotización " + requestedCotizacion +
              " ya existe en MAT_DOCUMENTOS.",
            { cotizacionNum: requestedCotizacion }
          );
        }

        const document = normalizeForInsert_(input, documents);
        const writeResult = writeRowsBatch_(
          CONFIG.SHEET_KEY,
          [objectToRow_(document)],
          getExpectedWidth_(),
          trace
        );

        SpreadsheetApp.flush();
        clearCache();

        const persisted = Object.assign({}, document, {
          _rowNumber: writeResult.firstRow
        });

        perfMark_(trace, "MAT_DOCUMENT_INSERTED", {
          rowNumber: writeResult.firstRow
        });

        return cloneSafe_(persisted);
      },
      getLockTimeout_(),
      trace
    );
  }

  /**
   * Actualiza campos operativos permitidos de una cotización existente.
   *
   * @param {*} cotizacionNum Clave natural.
   * @param {Object} patch Campos por actualizar.
   * @param {Object=} trace Tracker opcional.
   * @return {Object} Documento actualizado.
   */
  function updateByCotizacionNum(cotizacionNum, patch, trace) {
    assertDependencies_();
    const key = normalizeCotizacionNum_(cotizacionNum);

    return withScriptLock_(
      CONFIG.LOCK_LABEL + "_UPDATE",
      function() {
        ensureContract_(trace);
        const documents = loadFresh_(trace);
        const current = findByCotizacion_(documents, key);

        if (!current) {
          throw createError_(
            GESTION_MATERIAL_DOCUMENTOS.ERRORES.COTIZACION_NO_EXISTE,
            "No existe la cotización " + key + " en MAT_DOCUMENTOS.",
            { cotizacionNum: key }
          );
        }

        const updated = normalizeForUpdate_(current, patch);
        writeRowAt_(
          CONFIG.SHEET_KEY,
          current._rowNumber,
          objectToRow_(updated),
          getExpectedWidth_(),
          trace
        );

        SpreadsheetApp.flush();
        clearCache();

        perfMark_(trace, "MAT_DOCUMENT_UPDATED", {
          rowNumber: current._rowNumber
        });

        return cloneSafe_(updated);
      },
      getLockTimeout_(),
      trace
    );
  }

  /**
   * Inserta o actualiza por COTIZACION_NUM.
   * Útil para cargas idempotentes controladas. No modifica campos inmutables.
   *
   * @param {Object} input Documento.
   * @param {Object=} trace Tracker opcional.
   * @return {{created:boolean, document:Object}}
   */
  function upsert(input, trace) {
    requirePlainObject_(input, "documento");
    const key = normalizeCotizacionNum_(
      pickValue_(input, ["cotizacionNum", "COTIZACION_NUM"])
    );
    const existing = getByCotizacionNumFresh(key, trace);

    if (!existing) {
      return {
        created: true,
        document: insert(input, trace)
      };
    }

    return {
      created: false,
      document: updateByCotizacionNum(key, input, trace)
    };
  }

  /**
   * Invalida la caché privada de esta ejecución.
   *
   * @return {boolean}
   */
  function clearCache() {
    cache_ = null;
    return true;
  }

  /**
   * Fuerza nuevamente la validación física del contrato.
   * Útil después de modificar encabezados durante mantenimiento.
   *
   * @return {boolean}
   */
  function resetContractValidation() {
    contractValidated_ = false;
    return true;
  }

  /**
   * Valida la configuración y la estructura física sin escribir datos.
   *
   * @param {Object=} trace Tracker opcional.
   * @return {Object}
   */
  function validateContract(trace) {
    contractValidated_ = false;
    ensureContract_(trace);
    return {
      repository: REPOSITORY_NAME,
      sheetKey: CONFIG.SHEET_KEY,
      width: getExpectedWidth_(),
      valid: true
    };
  }

  // -------------------------------------------------------------------------
  // CONTRATO PÚBLICO INMUTABLE
  // -------------------------------------------------------------------------

  return Object.freeze({
    getAll: getAll,
    getAllFresh: getAllFresh,
    getByCotizacionNum: getByCotizacionNum,
    getByCotizacionNumFresh: getByCotizacionNumFresh,
    existsByCotizacionNum: existsByCotizacionNum,
    getByIdDocumentoMat: getByIdDocumentoMat,
    insert: insert,
    updateByCotizacionNum: updateByCotizacionNum,
    upsert: upsert,
    clearCache: clearCache,
    resetContractValidation: resetContractValidation,
    validateContract: validateContract
  });
})();
