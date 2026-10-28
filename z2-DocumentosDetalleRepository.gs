/**
 * z2-DocumentosDetalleRepository.gs
 *
 * @fileoverview Repositorio autoritativo para MAT_DOCUMENTODETALLE.
 *
 * RESPONSABILIDADES
 * - Leer y mapear el desglose de SKU asociado a una cotización.
 * - Garantizar que cada detalle pertenezca a una cabecera existente en
 *   MAT_DOCUMENTOS.
 * - Insertar detalles individualmente o por lote con escritura controlada.
 * - Actualizar un renglón únicamente cuando COTIZACION_NUM + SURTIDO_CODIGO
 *   identifique una sola fila física.
 * - Mantener una caché privada válida durante la ejecución actual.
 * - Validar ancho, encabezados e índices antes de operar.
 *
 * RELACIÓN
 * MAT_DOCUMENTOS.COTIZACION_NUM = MAT_DOCUMENTODETALLE.COTIZACION_NUM
 *
 * DECISIÓN DE IDENTIDAD
 * El esquema actual no contiene ID_DOCUMENTODETALLE ni una secuencia de renglón.
 * Por ello:
 * - COTIZACION_NUM identifica el conjunto de detalles.
 * - COTIZACION_NUM + SURTIDO_CODIGO puede identificar un renglón solamente si
 *   dicho código aparece una vez dentro de la cotización.
 * - Si existen dos filas con la misma combinación, las actualizaciones por código
 *   se rechazan como ambiguas. El repositorio nunca elige una fila arbitraria.
 *
 * FUERA DE ALCANCE
 * - No crea ni modifica cabeceras en MAT_DOCUMENTOS.
 * - No calcula reglas de surtido, verificación, empaque o incidencias.
 * - No elimina físicamente filas como parte del flujo normal.
 * - No coordina una importación atómica de cabecera y detalle.
 *
 * DEPENDENCIAS
 * - z0-UtilidadesDatos.gs
 * - z1-Constants.gs
 * - z2-DocumentosRepository.gs
 *
 * @author Sigifredo de la Cruz Ramos
 * @version MAT-DET-REP-2026-10-26-01
 */
const DocumentosDetalleRepository = (function() {
  "use strict";

  /** @const {string} */
  const REPOSITORY_NAME = "DocumentosDetalleRepository";

  /** @const {Object} */
  const CONFIG = Object.freeze({
    SHEET_KEY: "MAT_DOCUMENTODETALLE",
    FIRST_DATA_ROW: 2,
    LOCK_LABEL: "MAT_DOCUMENTODETALLE_WRITE"
  });

  /**
   * Campos modificables después del alta.
   * COTIZACION_NUM y SURTIDO_CODIGO son inmutables porque forman la identidad
   * funcional disponible en el esquema actual.
   *
   * @const {Object<string, boolean>}
   */
  const MUTABLE_FIELDS = Object.freeze({
    surtidoCompleto: true,
    surtidoFaltante: true,
    surtidoParcial: true,
    surtidoObservaciones: true,
    verificacionCorrecto: true,
    verificacionError: true,
    verificacionErrorTipo1: true,
    verificacionErrorTipo2: true,
    verificacionErrorTipo3: true,
    verificacionErrorTipo4: true,
    verificacionErrorTipo5: true,
    verificadoUbicacion: true,
    verificadoUbicacionFecha: true,
    verificadoUbicacionHora: true,
    empaqueContenedorTipo: true,
    empaqueContenedorIdentificador: true
  });

  /** @type {?Array<Object>} Caché privada por ejecución. */
  let cache_ = null;

  /** @type {boolean} Indica si el contrato físico ya fue validado. */
  let contractValidated_ = false;

  // -------------------------------------------------------------------------
  // DEPENDENCIAS Y CONTRATOS
  // -------------------------------------------------------------------------

  /** @private @return {void} */
  function assertDependencies_() {
    if (typeof SHEETS === "undefined" || !SHEETS.MAT_DOCUMENTODETALLE) {
      throw createError_(
        "MAT_DET_CONFIG_MISSING",
        "No existe SHEETS.MAT_DOCUMENTODETALLE."
      );
    }

    if (typeof COL === "undefined" || !COL.MAT_DOCUMENTODETALLE) {
      throw createError_(
        "MAT_DET_COLUMNS_MISSING",
        "No existe COL.MAT_DOCUMENTODETALLE."
      );
    }

    if (
      typeof GESTION_MATERIAL_DOCUMENTOS === "undefined" ||
      !GESTION_MATERIAL_DOCUMENTOS
    ) {
      throw createError_(
        "MAT_DET_DOMAIN_MISSING",
        "GESTION_MATERIAL_DOCUMENTOS no está disponible."
      );
    }

    if (
      typeof GESTION_MATERIAL_DOCUMENTOS_HEADERS === "undefined" ||
      !GESTION_MATERIAL_DOCUMENTOS_HEADERS ||
      !Array.isArray(
        GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTODETALLE
      )
    ) {
      throw createError_(
        "MAT_DET_HEADERS_MISSING",
        "No existe el contrato de encabezados de MAT_DOCUMENTODETALLE."
      );
    }

    if (
      typeof GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS === "undefined" ||
      Number(
        GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS.MAT_DOCUMENTODETALLE || 0
      ) <= 0
    ) {
      throw createError_(
        "MAT_DET_WIDTH_MISSING",
        "No existe el ancho esperado de MAT_DOCUMENTODETALLE."
      );
    }

    if (
      typeof DocumentosRepository === "undefined" ||
      !DocumentosRepository ||
      typeof DocumentosRepository.getByCotizacionNumFresh !== "function"
    ) {
      throw createError_(
        "MAT_DET_PARENT_REPOSITORY_MISSING",
        "DocumentosRepository.getByCotizacionNumFresh() no está disponible."
      );
    }

    const requiredUtilities = [
      ["readSheetRows_", typeof readSheetRows_],
      ["writeRowsBatch_", typeof writeRowsBatch_],
      ["writeRowAt_", typeof writeRowAt_],
      ["withScriptLock_", typeof withScriptLock_],
      ["normalizeCotizacionNum_", typeof normalizeCotizacionNum_],
      ["normalizeTextField_", typeof normalizeTextField_],
      ["normalizeTriState_", typeof normalizeTriState_],
      ["normalizeEnumValue_", typeof normalizeEnumValue_],
      ["requirePlainObject_", typeof requirePlainObject_],
      ["assertSheetContract_", typeof assertSheetContract_],
      ["clonePlain_", typeof clonePlain_]
    ];

    requiredUtilities.forEach(function(entry) {
      if (entry[1] !== "function") {
        throw createError_(
          "MAT_DET_UTILITY_MISSING",
          "La utilidad " + entry[0] + " no está disponible."
        );
      }
    });
  }

  /** @private @return {void} */
  function assertColumnContract_() {
    const columns = COL.MAT_DOCUMENTODETALLE;
    const headers = GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTODETALLE;
    const expectedWidth = getExpectedWidth_();
    const indexes = Object.keys(columns).map(function(key) {
      return Number(columns[key]);
    });

    if (headers.length !== expectedWidth) {
      throw createError_(
        "MAT_DET_WIDTH_CONFLICT",
        "El ancho esperado no coincide con los encabezados del detalle."
      );
    }

    if (
      indexes.length !== expectedWidth ||
      uniqueNumberCount_(indexes) !== expectedWidth ||
      Math.min.apply(null, indexes) !== 0 ||
      Math.max.apply(null, indexes) !== expectedWidth - 1
    ) {
      throw createError_(
        "MAT_DET_COLUMNS_INVALID",
        "COL.MAT_DOCUMENTODETALLE debe contener índices únicos de 0 a " +
          (expectedWidth - 1) + "."
      );
    }
  }

  /**
   * Cuenta números únicos sin depender de Set para maximizar compatibilidad.
   *
   * @private
   * @param {Array<number>} values Valores.
   * @return {number}
   */
  function uniqueNumberCount_(values) {
    const index = Object.create(null);
    values.forEach(function(value) {
      index[String(value)] = true;
    });
    return Object.keys(index).length;
  }

  /** @private @param {Object=} trace @return {void} */
  function ensureContract_(trace) {
    assertDependencies_();
    assertColumnContract_();

    if (contractValidated_) return;

    assertSheetContract_(
      CONFIG.SHEET_KEY,
      GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTODETALLE,
      trace
    );

    contractValidated_ = true;
  }

  /** @private @return {number} */
  function getExpectedWidth_() {
    return Number(
      GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS.MAT_DOCUMENTODETALLE
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

  /** @private @return {number} */
  function getMaxDetailsPerCotizacion_() {
    return Math.max(
      1,
      Number(
        GESTION_MATERIAL_DOCUMENTOS.LIMITES
          .MAX_DETALLES_POR_COTIZACION || 2000
      )
    );
  }

  // -------------------------------------------------------------------------
  // ERRORES Y COPIAS DEFENSIVAS
  // -------------------------------------------------------------------------

  /**
   * Crea un error funcional con código y detalles seguros.
   *
   * @private
   * @param {string} code Código estable.
   * @param {string} message Mensaje.
   * @param {Object=} details Detalles.
   * @return {Error}
   */
  function createError_(code, message, details) {
    const error = new Error(
      String(message || "Error en DocumentosDetalleRepository.")
    );
    error.name = "DocumentosDetalleRepositoryError";
    error.code = String(code || "MAT_DET_REPOSITORY_ERROR");
    error.details = details && typeof details === "object"
      ? cloneSafe_(details)
      : {};
    return error;
  }

  /** @private @param {*} value @return {*} */
  function cloneSafe_(value) {
    if (value == null) return value;
    return clonePlain_(value);
  }

  /** @private @param {Array<Object>} values @return {Array<Object>} */
  function cloneList_(values) {
    return cloneSafe_(Array.isArray(values) ? values : []);
  }

  // -------------------------------------------------------------------------
  // NORMALIZACIÓN
  // -------------------------------------------------------------------------

  /**
   * Normaliza un código de surtido.
   *
   * @private
   * @param {*} value Valor.
   * @return {string}
   */
  function normalizeSurtidoCodigo_(value) {
    return normalizeTextField_(value, {
      fieldName: "SURTIDO_CODIGO",
      required: true,
      maxLength: 100
    }).toUpperCase();
  }

  /**
   * Normaliza uno de los cinco códigos de error de verificación.
   * Vacío significa que la posición no contiene una incidencia.
   *
   * @private
   * @param {*} value Valor.
   * @param {string} fieldName Campo.
   * @return {string}
   */
  function normalizeVerificationErrorType_(value, fieldName) {
    if (value == null || String(value).trim() === "") return "";

    return normalizeEnumValue_(
      value,
      GESTION_MATERIAL_DOCUMENTOS.VERIFICACION_ERRORES,
      {
        fieldName: fieldName,
        required: true
      }
    );
  }

  /**
   * Normaliza un tipo de contenedor. Vacío se transforma en SIN_CONTENEDOR.
   *
   * @private
   * @param {*} value Valor.
   * @return {string}
   */
  function normalizeContainerType_(value) {
    return normalizeEnumValue_(
      value,
      GESTION_MATERIAL_DOCUMENTOS.TIPOS_CONTENEDOR,
      {
        fieldName: "EMPAQUE_CONTENEDORTIPO",
        defaultValue:
          GESTION_MATERIAL_DOCUMENTOS.TIPOS_CONTENEDOR.SIN_CONTENEDOR
      }
    );
  }

  /**
   * Normaliza una fecha opcional al formato dd/MM/yyyy.
   *
   * @private
   * @param {*} value Valor.
   * @param {string} fieldName Campo.
   * @return {string}
   */
  function normalizeDateField_(value, fieldName) {
    if (value == null || value === "") return "";
    const date = toDate_(value);
    if (!date) {
      throw createError_(
        "MAT_DET_INVALID_DATE",
        fieldName + " debe usar el formato dd/MM/yyyy."
      );
    }
    return formatDate_(date);
  }

  /**
   * Normaliza una hora opcional al formato HH:mm:ss.
   *
   * @private
   * @param {*} value Valor.
   * @param {string} fieldName Campo.
   * @return {string}
   */
  function normalizeTimeField_(value, fieldName) {
    if (value == null || value === "") return "";
    const time = toTime_(value);
    if (!time) {
      throw createError_(
        "MAT_DET_INVALID_TIME",
        fieldName + " debe usar el formato HH:mm:ss."
      );
    }
    return formatTime_(time);
  }

  /**
   * Normaliza un detalle para escritura.
   *
   * @private
   * @param {Object} input Detalle.
   * @return {Object}
   */
  function normalizeDetail_(input) {
    requirePlainObject_(input, "detalle");

    const detail = {
      cotizacionNum: normalizeCotizacionNum_(
        pickValue_(input, ["cotizacionNum", "COTIZACION_NUM"])
      ),
      surtidoCodigo: normalizeSurtidoCodigo_(
        pickValue_(input, ["surtidoCodigo", "SURTIDO_CODIGO"])
      ),
      surtidoCompleto: normalizeTriState_(
        pickValue_(input, ["surtidoCompleto", "SURTIDO_COMPLETO"]),
        {
          fieldName: "SURTIDO_COMPLETO",
          allowPending: true
        }
      ),
      surtidoFaltante: normalizeTriState_(
        pickValue_(input, ["surtidoFaltante", "SURTIDO_FALTANTE"]),
        {
          fieldName: "SURTIDO_FALTANTE",
          allowPending: true
        }
      ),
      surtidoParcial: normalizeTriState_(
        pickValue_(input, ["surtidoParcial", "SURTIDO_PARCIAL"]),
        {
          fieldName: "SURTIDO_PARCIAL",
          allowPending: true
        }
      ),
      surtidoObservaciones: normalizeTextField_(
        pickValue_(input, [
          "surtidoObservaciones",
          "SURTIDO_OBSERVACIONES"
        ]),
        {
          fieldName: "SURTIDO_OBSERVACIONES",
          maxLength: Number(
            GESTION_MATERIAL_DOCUMENTOS.LIMITES.OBSERVACIONES_MAX_LENGTH ||
              1000
          )
        }
      ),
      verificacionCorrecto: normalizeTriState_(
        pickValue_(input, [
          "verificacionCorrecto",
          "VERIFICACION_CORRECTO"
        ]),
        {
          fieldName: "VERIFICACION_CORRECTO",
          allowPending: true
        }
      ),
      verificacionError: normalizeTriState_(
        pickValue_(input, ["verificacionError", "VERIFICACION_ERROR"]),
        {
          fieldName: "VERIFICACION_ERROR",
          allowPending: true
        }
      ),
      verificacionErrorTipo1: normalizeVerificationErrorType_(
        pickValue_(input, [
          "verificacionErrorTipo1",
          "VERIFICACION_ERROR_TIPO1"
        ]),
        "VERIFICACION_ERROR_TIPO1"
      ),
      verificacionErrorTipo2: normalizeVerificationErrorType_(
        pickValue_(input, [
          "verificacionErrorTipo2",
          "VERIFICACION_ERROR_TIPO2"
        ]),
        "VERIFICACION_ERROR_TIPO2"
      ),
      verificacionErrorTipo3: normalizeVerificationErrorType_(
        pickValue_(input, [
          "verificacionErrorTipo3",
          "VERIFICACION_ERROR_TIPO3"
        ]),
        "VERIFICACION_ERROR_TIPO3"
      ),
      verificacionErrorTipo4: normalizeVerificationErrorType_(
        pickValue_(input, [
          "verificacionErrorTipo4",
          "VERIFICACION_ERROR_TIPO4"
        ]),
        "VERIFICACION_ERROR_TIPO4"
      ),
      verificacionErrorTipo5: normalizeVerificationErrorType_(
        pickValue_(input, [
          "verificacionErrorTipo5",
          "VERIFICACION_ERROR_TIPO5"
        ]),
        "VERIFICACION_ERROR_TIPO5"
      ),
      verificadoUbicacion: normalizeTextField_(
        pickValue_(input, ["verificadoUbicacion", "VERIFICADO_UBICACION"]),
        {
          fieldName: "VERIFICADO_UBICACION",
          maxLength: Number(
            GESTION_MATERIAL_DOCUMENTOS.LIMITES.NOMBRE_MAX_LENGTH || 250
          )
        }
      ),
      verificadoUbicacionFecha: normalizeDateField_(
        pickValue_(input, [
          "verificadoUbicacionFecha",
          "VERIFICADO_UBICACIONFECHA"
        ]),
        "VERIFICADO_UBICACIONFECHA"
      ),
      verificadoUbicacionHora: normalizeTimeField_(
        pickValue_(input, [
          "verificadoUbicacionHora",
          "VERIFICADO_UBICACIONHORA"
        ]),
        "VERIFICADO_UBICACIONHORA"
      ),
      empaqueContenedorTipo: normalizeContainerType_(
        pickValue_(input, [
          "empaqueContenedorTipo",
          "EMPAQUE_CONTENEDORTIPO"
        ])
      ),
      empaqueContenedorIdentificador: normalizeTextField_(
        pickValue_(input, [
          "empaqueContenedorIdentificador",
          "EMPAQUE_CONTENEDORIDENTIFICADOR"
        ]),
        {
          fieldName: "EMPAQUE_CONTENEDORIDENTIFICADOR",
          maxLength: Number(
            GESTION_MATERIAL_DOCUMENTOS.LIMITES
              .CONTENEDOR_IDENTIFICADOR_MAX_LENGTH || 250
          )
        }
      )
    };

    validateDetailConsistency_(detail);
    return detail;
  }

  /**
   * Valida reglas que deben ser verdaderas para una sola fila.
   *
   * @private
   * @param {Object} detail Detalle normalizado.
   * @return {void}
   */
  function validateDetailConsistency_(detail) {
    const activeSurtidoStates = [
      detail.surtidoCompleto,
      detail.surtidoFaltante,
      detail.surtidoParcial
    ].filter(function(value) {
      return value === "SI";
    }).length;

    if (activeSurtidoStates > 1) {
      throw createError_(
        "MAT_DET_SURTIDO_STATE_CONFLICT",
        "Solo uno de SURTIDO_COMPLETO, SURTIDO_FALTANTE o " +
          "SURTIDO_PARCIAL puede tener el valor SI."
      );
    }

    const errorTypes = getVerificationErrorTypes_(detail);
    const uniqueErrorTypes = uniqueStrings_(errorTypes);

    if (uniqueErrorTypes.length !== errorTypes.length) {
      throw createError_(
        "MAT_DET_DUPLICATE_ERROR_TYPE",
        "Una incidencia de verificación no puede repetirse en la misma fila."
      );
    }

    if (detail.verificacionError === "NO" && errorTypes.length > 0) {
      throw createError_(
        "MAT_DET_ERROR_FLAG_CONFLICT",
        "VERIFICACION_ERROR no puede ser NO cuando existen tipos de error."
      );
    }

    if (detail.verificacionCorrecto === "SI" && errorTypes.length > 0) {
      throw createError_(
        "MAT_DET_VERIFICATION_CONFLICT",
        "VERIFICACION_CORRECTO no puede ser SI cuando existen errores."
      );
    }

    if (
      detail.verificacionCorrecto === "SI" &&
      detail.verificacionError === "SI"
    ) {
      throw createError_(
        "MAT_DET_VERIFICATION_FLAG_CONFLICT",
        "VERIFICACION_CORRECTO y VERIFICACION_ERROR no pueden ser SI a la vez."
      );
    }

    if (
      detail.empaqueContenedorTipo === "SIN_CONTENEDOR" &&
      detail.empaqueContenedorIdentificador
    ) {
      throw createError_(
        "MAT_DET_CONTAINER_CONFLICT",
        "No debe informarse un identificador cuando el tipo es SIN_CONTENEDOR."
      );
    }
  }

  /** @private @param {Object} detail @return {Array<string>} */
  function getVerificationErrorTypes_(detail) {
    return [
      detail.verificacionErrorTipo1,
      detail.verificacionErrorTipo2,
      detail.verificacionErrorTipo3,
      detail.verificacionErrorTipo4,
      detail.verificacionErrorTipo5
    ].filter(Boolean);
  }

  /** @private @param {Array<string>} values @return {Array<string>} */
  function uniqueStrings_(values) {
    const seen = Object.create(null);
    const result = [];
    values.forEach(function(value) {
      if (seen[value]) return;
      seen[value] = true;
      result.push(value);
    });
    return result;
  }

  /**
   * Mezcla un patch con un detalle y normaliza el resultado.
   *
   * @private
   * @param {Object} current Registro actual.
   * @param {Object} patch Cambios.
   * @return {Object}
   */
  function normalizeForUpdate_(current, patch) {
    requirePlainObject_(patch, "patch");
    assertImmutableFields_(current, patch);

    const merged = Object.assign({}, current);
    Object.keys(patch).forEach(function(key) {
      const field = resolveMutableFieldName_(key);
      if (field && MUTABLE_FIELDS[field]) merged[field] = patch[key];
    });

    const normalized = normalizeDetail_(merged);
    normalized.cotizacionNum = current.cotizacionNum;
    normalized.surtidoCodigo = current.surtidoCodigo;
    normalized._rowNumber = current._rowNumber;
    return normalized;
  }

  /** @private @param {Object} current @param {Object} patch @return {void} */
  function assertImmutableFields_(current, patch) {
    const aliases = {
      cotizacionNum: "cotizacionNum",
      COTIZACION_NUM: "cotizacionNum",
      surtidoCodigo: "surtidoCodigo",
      SURTIDO_CODIGO: "surtidoCodigo"
    };

    Object.keys(aliases).forEach(function(alias) {
      if (!Object.prototype.hasOwnProperty.call(patch, alias)) return;

      const currentField = aliases[alias];
      const requested = alias.indexOf("CODIGO") >= 0 || alias === "surtidoCodigo"
        ? normalizeSurtidoCodigo_(patch[alias])
        : normalizeCotizacionNum_(patch[alias]);

      if (requested !== current[currentField]) {
        throw createError_(
          GESTION_MATERIAL_DOCUMENTOS.ERRORES.COTIZACION_INMUTABLE,
          alias + " es inmutable después del alta.",
          { field: alias }
        );
      }
    });
  }

  /** @private @param {string} key @return {string} */
  function resolveMutableFieldName_(key) {
    const aliases = {
      SURTIDO_COMPLETO: "surtidoCompleto",
      SURTIDO_FALTANTE: "surtidoFaltante",
      SURTIDO_PARCIAL: "surtidoParcial",
      SURTIDO_OBSERVACIONES: "surtidoObservaciones",
      VERIFICACION_CORRECTO: "verificacionCorrecto",
      VERIFICACION_ERROR: "verificacionError",
      VERIFICACION_ERROR_TIPO1: "verificacionErrorTipo1",
      VERIFICACION_ERROR_TIPO2: "verificacionErrorTipo2",
      VERIFICACION_ERROR_TIPO3: "verificacionErrorTipo3",
      VERIFICACION_ERROR_TIPO4: "verificacionErrorTipo4",
      VERIFICACION_ERROR_TIPO5: "verificacionErrorTipo5",
      VERIFICADO_UBICACION: "verificadoUbicacion",
      VERIFICADO_UBICACIONFECHA: "verificadoUbicacionFecha",
      VERIFICADO_UBICACIONHORA: "verificadoUbicacionHora",
      EMPAQUE_CONTENEDORTIPO: "empaqueContenedorTipo",
      EMPAQUE_CONTENEDORIDENTIFICADOR:
        "empaqueContenedorIdentificador"
    };
    return MUTABLE_FIELDS[key] ? key : aliases[key] || "";
  }

  /** @private @param {Object} object @param {Array<string>} keys @return {*} */
  function pickValue_(object, keys) {
    for (let index = 0; index < keys.length; index++) {
      if (Object.prototype.hasOwnProperty.call(object, keys[index])) {
        return object[keys[index]];
      }
    }
    return "";
  }

  // -------------------------------------------------------------------------
  // MAPEO ENTRE FILAS Y OBJETOS
  // -------------------------------------------------------------------------

  /**
   * Convierte una fila física al contrato público.
   *
   * @private
   * @param {Array<*>} row Fila.
   * @param {number} rowNumber Número físico.
   * @return {Object}
   */
  function rowToObject_(row, rowNumber) {
    const c = COL.MAT_DOCUMENTODETALLE;

    return {
      cotizacionNum: String(
        row[c.COTIZACION_NUM] == null ? "" : row[c.COTIZACION_NUM]
      ).trim(),
      surtidoCodigo: toStrUpper_(row[c.SURTIDO_CODIGO]),
      surtidoCompleto: normalizeStoredTriState_(row[c.SURTIDO_COMPLETO]),
      surtidoFaltante: normalizeStoredTriState_(row[c.SURTIDO_FALTANTE]),
      surtidoParcial: normalizeStoredTriState_(row[c.SURTIDO_PARCIAL]),
      surtidoObservaciones: toStr_(row[c.SURTIDO_OBSERVACIONES]),
      verificacionCorrecto: normalizeStoredTriState_(
        row[c.VERIFICACION_CORRECTO]
      ),
      verificacionError: normalizeStoredTriState_(row[c.VERIFICACION_ERROR]),
      verificacionErrorTipo1: toStrUpper_(
        row[c.VERIFICACION_ERROR_TIPO1]
      ),
      verificacionErrorTipo2: toStrUpper_(
        row[c.VERIFICACION_ERROR_TIPO2]
      ),
      verificacionErrorTipo3: toStrUpper_(
        row[c.VERIFICACION_ERROR_TIPO3]
      ),
      verificacionErrorTipo4: toStrUpper_(
        row[c.VERIFICACION_ERROR_TIPO4]
      ),
      verificacionErrorTipo5: toStrUpper_(
        row[c.VERIFICACION_ERROR_TIPO5]
      ),
      verificadoUbicacion: toStr_(row[c.VERIFICADO_UBICACION]),
      verificadoUbicacionFecha: formatDateFromCell_(
        row[c.VERIFICADO_UBICACIONFECHA]
      ),
      verificadoUbicacionHora: formatTimeFromCell_(
        row[c.VERIFICADO_UBICACIONHORA]
      ),
      empaqueContenedorTipo:
        toStrUpper_(row[c.EMPAQUE_CONTENEDORTIPO]) || "SIN_CONTENEDOR",
      empaqueContenedorIdentificador: toStr_(
        row[c.EMPAQUE_CONTENEDORIDENTIFICADOR]
      ),
      _rowNumber: rowNumber
    };
  }

  /** @private @param {Object} detail @return {Array<*>} */
  function objectToRow_(detail) {
    const c = COL.MAT_DOCUMENTODETALLE;
    const row = new Array(getExpectedWidth_()).fill("");

    row[c.COTIZACION_NUM] = detail.cotizacionNum;
    row[c.SURTIDO_CODIGO] = detail.surtidoCodigo;
    row[c.SURTIDO_COMPLETO] = detail.surtidoCompleto;
    row[c.SURTIDO_FALTANTE] = detail.surtidoFaltante;
    row[c.SURTIDO_PARCIAL] = detail.surtidoParcial;
    row[c.SURTIDO_OBSERVACIONES] = detail.surtidoObservaciones;
    row[c.VERIFICACION_CORRECTO] = detail.verificacionCorrecto;
    row[c.VERIFICACION_ERROR] = detail.verificacionError;
    row[c.VERIFICACION_ERROR_TIPO1] = detail.verificacionErrorTipo1;
    row[c.VERIFICACION_ERROR_TIPO2] = detail.verificacionErrorTipo2;
    row[c.VERIFICACION_ERROR_TIPO3] = detail.verificacionErrorTipo3;
    row[c.VERIFICACION_ERROR_TIPO4] = detail.verificacionErrorTipo4;
    row[c.VERIFICACION_ERROR_TIPO5] = detail.verificacionErrorTipo5;
    row[c.VERIFICADO_UBICACION] = detail.verificadoUbicacion;
    row[c.VERIFICADO_UBICACIONFECHA] = detail.verificadoUbicacionFecha;
    row[c.VERIFICADO_UBICACIONHORA] = detail.verificadoUbicacionHora;
    row[c.EMPAQUE_CONTENEDORTIPO] = detail.empaqueContenedorTipo;
    row[c.EMPAQUE_CONTENEDORIDENTIFICADOR] =
      detail.empaqueContenedorIdentificador;

    return row;
  }

  /** @private @param {*} value @return {string} */
  function normalizeStoredTriState_(value) {
    try {
      return normalizeTriState_(value, { allowPending: true });
    } catch (error) {
      return toStrUpper_(value);
    }
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
  // LECTURA, ÍNDICES Y CACHÉ
  // -------------------------------------------------------------------------

  /** @private @param {Object=} trace @return {Array<Object>} */
  function loadFresh_(trace) {
    ensureContract_(trace);

    const rows = readSheetRows_(CONFIG.SHEET_KEY, getExpectedWidth_(), trace);
    const details = rows
      .map(function(row, index) {
        return rowToObject_(row, index + CONFIG.FIRST_DATA_ROW);
      })
      .filter(function(detail) {
        return Boolean(detail.cotizacionNum || detail.surtidoCodigo);
      });

    cache_ = details;
    return details;
  }

  /** @private @param {Object=} trace @return {Array<Object>} */
  function getInternal_(trace) {
    if (Array.isArray(cache_)) {
      perfMark_(trace, "MAT_DOCUMENTODETALLE_CACHE_HIT", {
        rows: cache_.length
      });
      return cache_;
    }
    return loadFresh_(trace);
  }

  /**
   * Filtra detalles por cotización.
   *
   * @private
   * @param {Array<Object>} details Detalles.
   * @param {string} cotizacionNum Cotización.
   * @return {Array<Object>}
   */
  function filterByCotizacion_(details, cotizacionNum) {
    return details.filter(function(detail) {
      return detail.cotizacionNum === cotizacionNum;
    });
  }

  /**
   * Filtra detalles por cotización y código.
   *
   * @private
   * @param {Array<Object>} details Detalles.
   * @param {string} cotizacionNum Cotización.
   * @param {string} surtidoCodigo Código.
   * @return {Array<Object>}
   */
  function filterByCotizacionAndCodigo_(
    details,
    cotizacionNum,
    surtidoCodigo
  ) {
    return details.filter(function(detail) {
      return detail.cotizacionNum === cotizacionNum &&
        detail.surtidoCodigo === surtidoCodigo;
    });
  }

  /**
   * Exige que la cabecera exista.
   * Debe llamarse dentro del mismo lock de la mutación del detalle.
   *
   * @private
   * @param {string} cotizacionNum Cotización.
   * @param {Object=} trace Tracker.
   * @return {Object}
   */
  function requireParentDocument_(cotizacionNum, trace) {
    const document = DocumentosRepository.getByCotizacionNumFresh(
      cotizacionNum,
      trace
    );

    if (!document) {
      throw createError_(
        GESTION_MATERIAL_DOCUMENTOS.ERRORES.DETALLE_SIN_CABECERA,
        "No existe la cotización " + cotizacionNum +
          " en MAT_DOCUMENTOS.",
        { cotizacionNum: cotizacionNum }
      );
    }

    return document;
  }

  /**
   * Valida el máximo de detalles permitidos después de una inserción.
   *
   * @private
   * @param {Array<Object>} currentDetails Detalles actuales.
   * @param {string} cotizacionNum Cotización.
   * @param {number} additionalRows Filas nuevas.
   * @return {void}
   */
  function assertDetailLimit_(currentDetails, cotizacionNum, additionalRows) {
    const currentCount = filterByCotizacion_(
      currentDetails,
      cotizacionNum
    ).length;
    const projected = currentCount + additionalRows;
    const maximum = getMaxDetailsPerCotizacion_();

    if (projected > maximum) {
      throw createError_(
        GESTION_MATERIAL_DOCUMENTOS.ERRORES.LOTE_DETALLE_EXCEDIDO,
        "La cotización " + cotizacionNum + " excedería el límite de " +
          maximum + " detalles.",
        {
          cotizacionNum: cotizacionNum,
          currentCount: currentCount,
          additionalRows: additionalRows,
          projected: projected,
          maximum: maximum
        }
      );
    }
  }

  // -------------------------------------------------------------------------
  // API PÚBLICA: CONSULTAS
  // -------------------------------------------------------------------------

  /** @param {Object=} trace @return {Array<Object>} */
  function getAll(trace) {
    assertDependencies_();
    return cloneList_(getInternal_(trace));
  }

  /** @param {Object=} trace @return {Array<Object>} */
  function getAllFresh(trace) {
    assertDependencies_();
    return cloneList_(loadFresh_(trace));
  }

  /**
   * Obtiene todos los SKU de una cotización.
   *
   * @param {*} cotizacionNum Cotización.
   * @param {Object=} trace Tracker.
   * @return {Array<Object>}
   */
  function getByCotizacionNum(cotizacionNum, trace) {
    const key = normalizeCotizacionNum_(cotizacionNum);
    return cloneList_(filterByCotizacion_(getInternal_(trace), key));
  }

  /** @param {*} cotizacionNum @param {Object=} trace @return {Array<Object>} */
  function getByCotizacionNumFresh(cotizacionNum, trace) {
    const key = normalizeCotizacionNum_(cotizacionNum);
    return cloneList_(filterByCotizacion_(loadFresh_(trace), key));
  }

  /**
   * Obtiene todas las coincidencias de código dentro de una cotización.
   *
   * @param {*} cotizacionNum Cotización.
   * @param {*} surtidoCodigo Código.
   * @param {Object=} trace Tracker.
   * @return {Array<Object>}
   */
  function getByCotizacionAndCodigo(cotizacionNum, surtidoCodigo, trace) {
    const key = normalizeCotizacionNum_(cotizacionNum);
    const code = normalizeSurtidoCodigo_(surtidoCodigo);
    return cloneList_(
      filterByCotizacionAndCodigo_(getInternal_(trace), key, code)
    );
  }

  /**
   * Indica si una cotización contiene detalles.
   *
   * @param {*} cotizacionNum Cotización.
   * @param {Object=} trace Tracker.
   * @return {boolean}
   */
  function existsByCotizacionNum(cotizacionNum, trace) {
    return getByCotizacionNum(cotizacionNum, trace).length > 0;
  }

  /**
   * Obtiene un detalle por número físico de fila.
   * El número se usa para diagnóstico y operaciones internas; no debe exponerse
   * como identidad de negocio en la vista.
   *
   * @param {number} rowNumber Fila física.
   * @param {Object=} trace Tracker.
   * @return {?Object}
   */
  function getByRowNumber(rowNumber, trace) {
    const safe = Math.floor(Number(rowNumber));
    if (!Number.isInteger(safe) || safe < CONFIG.FIRST_DATA_ROW) {
      throw createError_(
        "MAT_DET_INVALID_ROW_NUMBER",
        "rowNumber debe identificar una fila de datos."
      );
    }

    const detail = getInternal_(trace).filter(function(item) {
      return item._rowNumber === safe;
    })[0] || null;

    return cloneSafe_(detail);
  }

  // -------------------------------------------------------------------------
  // API PÚBLICA: MUTACIONES
  // -------------------------------------------------------------------------

  /**
   * Inserta un detalle.
   *
   * @param {Object} input Detalle.
   * @param {Object=} trace Tracker.
   * @return {Object}
   */
  function insert(input, trace) {
    const result = insertMany([input], trace);
    return result[0];
  }

  /**
   * Inserta un lote de detalles. Todas las filas deben pertenecer a la misma
   * COTIZACION_NUM para mantener una validación de cabecera clara y una escritura
   * eficiente.
   *
   * @param {Array<Object>} inputs Detalles.
   * @param {Object=} trace Tracker.
   * @return {Array<Object>}
   */
  function insertMany(inputs, trace) {
    assertDependencies_();

    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw createError_(
        GESTION_MATERIAL_DOCUMENTOS.ERRORES.PAYLOAD_INVALIDO,
        "insertMany() requiere un arreglo no vacío."
      );
    }

    return withScriptLock_(
      CONFIG.LOCK_LABEL + "_INSERT_MANY",
      function() {
        ensureContract_(trace);
        const normalized = inputs.map(normalizeDetail_);
        const cotizaciones = uniqueStrings_(normalized.map(function(detail) {
          return detail.cotizacionNum;
        }));

        if (cotizaciones.length !== 1) {
          throw createError_(
            "MAT_DET_MIXED_COTIZATIONS",
            "Un lote de detalle debe pertenecer a una sola COTIZACION_NUM.",
            { totalCotizaciones: cotizaciones.length }
          );
        }

        const cotizacionNum = cotizaciones[0];
        requireParentDocument_(cotizacionNum, trace);

        const currentDetails = loadFresh_(trace);
        assertDetailLimit_(currentDetails, cotizacionNum, normalized.length);

        const writeResult = writeRowsBatch_(
          CONFIG.SHEET_KEY,
          normalized.map(objectToRow_),
          getExpectedWidth_(),
          trace
        );

        SpreadsheetApp.flush();
        clearCache();

        const persisted = normalized.map(function(detail, index) {
          return Object.assign({}, detail, {
            _rowNumber: writeResult.firstRow + index
          });
        });

        perfMark_(trace, "MAT_DOCUMENT_DETAILS_INSERTED", {
          rows: persisted.length,
          firstRow: writeResult.firstRow
        });

        return cloneList_(persisted);
      },
      getLockTimeout_(),
      trace
    );
  }

  /**
   * Actualiza un detalle identificado inequívocamente por cotización y código.
   * Si existen dos coincidencias, la operación se rechaza para evitar modificar
   * arbitrariamente un renglón.
   *
   * @param {*} cotizacionNum Cotización.
   * @param {*} surtidoCodigo Código.
   * @param {Object} patch Cambios.
   * @param {Object=} trace Tracker.
   * @return {Object}
   */
  function updateByCotizacionAndCodigo(
    cotizacionNum,
    surtidoCodigo,
    patch,
    trace
  ) {
    assertDependencies_();
    const key = normalizeCotizacionNum_(cotizacionNum);
    const code = normalizeSurtidoCodigo_(surtidoCodigo);

    return withScriptLock_(
      CONFIG.LOCK_LABEL + "_UPDATE",
      function() {
        ensureContract_(trace);
        requireParentDocument_(key, trace);

        const matches = filterByCotizacionAndCodigo_(
          loadFresh_(trace),
          key,
          code
        );

        if (matches.length === 0) {
          throw createError_(
            "MAT_DET_NOT_FOUND",
            "No existe el código " + code + " en la cotización " + key + ".",
            { cotizacionNum: key, surtidoCodigo: code }
          );
        }

        if (matches.length > 1) {
          throw createError_(
            "MAT_DET_AMBIGUOUS_KEY",
            "La combinación COTIZACION_NUM + SURTIDO_CODIGO identifica " +
              matches.length + " filas. Se requiere una identidad adicional.",
            {
              cotizacionNum: key,
              surtidoCodigo: code,
              matches: matches.length
            }
          );
        }

        const updated = normalizeForUpdate_(matches[0], patch);
        writeRowAt_(
          CONFIG.SHEET_KEY,
          matches[0]._rowNumber,
          objectToRow_(updated),
          getExpectedWidth_(),
          trace
        );

        SpreadsheetApp.flush();
        clearCache();

        perfMark_(trace, "MAT_DOCUMENT_DETAIL_UPDATED", {
          rowNumber: matches[0]._rowNumber
        });

        return cloneSafe_(updated);
      },
      getLockTimeout_(),
      trace
    );
  }

  /**
   * Actualiza una fila física previamente obtenida y vuelve a verificar que siga
   * perteneciendo a la misma cotización y código. Se reserva para mantenimiento o
   * servicios internos; la interfaz no debe usar rowNumber como identidad.
   *
   * @param {number} rowNumber Fila física.
   * @param {Object} patch Cambios.
   * @param {Object=} trace Tracker.
   * @return {Object}
   */
  function updateByRowNumber(rowNumber, patch, trace) {
    assertDependencies_();
    const safeRowNumber = Math.floor(Number(rowNumber));

    if (!Number.isInteger(safeRowNumber) || safeRowNumber < 2) {
      throw createError_(
        "MAT_DET_INVALID_ROW_NUMBER",
        "rowNumber debe identificar una fila de datos."
      );
    }

    return withScriptLock_(
      CONFIG.LOCK_LABEL + "_UPDATE_ROW",
      function() {
        ensureContract_(trace);
        const current = loadFresh_(trace).filter(function(detail) {
          return detail._rowNumber === safeRowNumber;
        })[0];

        if (!current) {
          throw createError_(
            "MAT_DET_NOT_FOUND",
            "No existe detalle en la fila " + safeRowNumber + "."
          );
        }

        requireParentDocument_(current.cotizacionNum, trace);
        const updated = normalizeForUpdate_(current, patch);

        writeRowAt_(
          CONFIG.SHEET_KEY,
          safeRowNumber,
          objectToRow_(updated),
          getExpectedWidth_(),
          trace
        );

        SpreadsheetApp.flush();
        clearCache();
        return cloneSafe_(updated);
      },
      getLockTimeout_(),
      trace
    );
  }

  /** @return {boolean} */
  function clearCache() {
    cache_ = null;
    return true;
  }

  /** @return {boolean} */
  function resetContractValidation() {
    contractValidated_ = false;
    return true;
  }

  /**
   * Valida el contrato físico sin escribir información.
   *
   * @param {Object=} trace Tracker.
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

  return Object.freeze({
    getAll: getAll,
    getAllFresh: getAllFresh,
    getByCotizacionNum: getByCotizacionNum,
    getByCotizacionNumFresh: getByCotizacionNumFresh,
    getByCotizacionAndCodigo: getByCotizacionAndCodigo,
    existsByCotizacionNum: existsByCotizacionNum,
    getByRowNumber: getByRowNumber,
    insert: insert,
    insertMany: insertMany,
    updateByCotizacionAndCodigo: updateByCotizacionAndCodigo,
    updateByRowNumber: updateByRowNumber,
    clearCache: clearCache,
    resetContractValidation: resetContractValidation,
    validateContract: validateContract
  });
})();
