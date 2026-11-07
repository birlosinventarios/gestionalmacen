/**
 * z2-UbicacionesMaxMinRepository.gs
 *
 * @fileoverview Repositorio autoritativo de lectura y escritura para la hoja
 * UBICACIONES_MAXMIN almacenada en el libro lógico GESTION4.
 *
 * Este módulo encapsula el contrato físico de la hoja, normaliza los registros,
 * conserva el número real de fila para operaciones de mantenimiento, proporciona
 * consultas por código e identidad funcional y ejecuta escrituras protegidas con
 * ScriptLock.
 *
 * FUENTE AUTORITATIVA
 * - FILES.GESTION4.
 * - SHEETS.UBICACIONES_MAXMIN.
 * - COL.UBICACIONES_MAXMIN.
 * - UBICACIONES_MAXMIN_HEADERS.
 * - UBICACIONES_MAXMIN_EXPECTED_WIDTH.
 * - UBICACIONES_MAXMIN_CONFIG.
 *
 * IDENTIDAD FUNCIONAL
 * La combinación CODIGO + BODEGA + UBICACION identifica un registro lógico.
 * Un mismo código puede aparecer en varias bodegas o ubicaciones, pero no debe
 * repetirse en la misma bodega y ubicación.
 *
 * CAMPOS ADMINISTRADOS POR EL SERVIDOR
 * - FECHA.
 * - HORA.
 * - FECHA y HORA se generan en el servidor.
 * - USUARIO debe llegar validado por el Service contra UsuariosRepository.
 * - VALIDACION se conserva en actualizaciones y no se acepta como autoridad del cliente.
 *
 * RESPONSABILIDADES
 * - Validar dependencias, columnas, ancho y encabezados físicos.
 * - Leer y normalizar registros sin exponer arreglos físicos.
 * - Tolerar celdas numéricas vacías o marcadores operativos durante la lectura.
 * - Mantener validación numérica estricta antes de cualquier escritura.
 * - Mantener una caché local durante la ejecución actual.
 * - Entregar copias defensivas a los consumidores.
 * - Insertar, actualizar y realizar upsert bajo ScriptLock.
 * - Releer el origen dentro del lock antes de decidir una escritura.
 * - Invalidar la caché después de cualquier modificación.
 * - Medir lectura, normalización, caché, bloqueo, escritura y flush mediante
 *   las trazas compartidas de APPALMACEN.
 *
 * ESTE REPOSITORIO NO DEBE
 * - Consultar CATALOGO ni resolver descripciones de producto.
 * - Aplicar reglas de interfaz o permisos de negocio.
 * - Confiar directamente en datos enviados por el navegador.
 * - Resolver usuarios. El Service entrega USUARIO previamente validado.
 * - Sobrescribir VALIDACION durante la captura inicial.
 * - Calcular PORCENTAJE. El Service debe entregar el valor ya validado.
 * - Ocultar la fila física cuando una celda numérica histórica es inválida.
 * - Usar el número de fila como identidad funcional del registro.
 *
 * DEPENDENCIAS GLOBALES
 * - getRowsByKey_(sourceKey).
 * - getSheetByKey_(sourceKey).
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 * - LockService, SpreadsheetApp, Session y Utilities.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version UBICACIONES-MAXMIN-REPOSITORY-2026-11-07-04
 */
const UbicacionesMaxMinRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "UBICACIONES_MAXMIN",
    LOG_PREFIX: "[UbicacionesMaxMinRepository]",
    HEADER_ROW: 1,
    FIRST_DATA_ROW: 2,
    DATE_FORMAT: "dd/MM/yyyy",
    TIME_FORMAT: "HH:mm"
  });

  /** @private @const {!Array<string>} */
  const REQUIRED_COLUMNS = Object.freeze([
    "CODIGO",
    "DESCRIPCION",
    "BODEGA",
    "UBICACION",
    "EXISTENCIA",
    "PORCENTAJE",
    "MAXIMO",
    "MINIMO",
    "ZONA_BODEGA",
    "ZONA_ABASTECIMIENTO",
    "ZONA_NIVEL",
    "FECHA",
    "HORA",
    "USUARIO",
    "VALIDACION"
  ]);

  /**
   * Caché normalizada de la ejecución actual.
   *
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /** Nombre estable utilizado para seleccionar la configuración de rendimiento. */
  const PERF_MODULE = "UBICACIONES_MAXMIN";

  /**
   * Crea una traza propia cuando el consumidor no proporciona una.
   *
   * @param {string} operation Operación lógica.
   * @param {?Object=} parentTrace Traza del Service o Controller.
   * @return {{trace:!Object,owned:boolean}} Contexto de trazabilidad.
   * @private
   */
  function _traceContext_(operation, parentTrace) {
    if (parentTrace && typeof parentTrace === "object") {
      perfMark_(parentTrace, "REPOSITORY_" + operation + "_STARTED", {
        module: PERF_MODULE,
        layer: "REPOSITORY"
      });
      return { trace: parentTrace, owned: false };
    }

    return {
      trace: perfStart_("UBICACIONES_MAXMIN_REPOSITORY_" + operation, {
        module: PERF_MODULE,
        layer: "REPOSITORY"
      }),
      owned: true
    };
  }

  /** Finaliza solo las trazas creadas por el Repository. */
  function _finishTrace_(context, status, metadata) {
    if (!context || !context.trace) return;
    if (context.owned) {
      perfEnd_(context.trace, status, metadata || {});
      return;
    }
    perfMark_(context.trace, "REPOSITORY_STAGE_COMPLETED", Object.assign({
      status: status || "ok"
    }, metadata || {}));
  }

  // ===========================================================================
  // DEPENDENCIAS Y CONTRATOS
  // ===========================================================================

  /**
   * Verifica las dependencias globales obligatorias.
   *
   * @return {void}
   * @throws {Error} Si falta una dependencia funcional o una API de Apps Script.
   * @private
   */
  function _validateDependencies_() {
    const functions = [
      ["getRowsByKey_", typeof getRowsByKey_],
      ["getSheetByKey_", typeof getSheetByKey_],
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_],
      ["perfStart_", typeof perfStart_],
      ["perfMark_", typeof perfMark_],
      ["perfEnd_", typeof perfEnd_],
      ["perfFail_", typeof perfFail_],
      ["perfMeasure_", typeof perfMeasure_],
      ["withScriptLock_", typeof withScriptLock_]
    ];

    const missing = functions
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (typeof LockService === "undefined") {
      missing.push("LockService");
    }
    if (typeof SpreadsheetApp === "undefined") {
      missing.push("SpreadsheetApp");
    }
    if (typeof Session === "undefined") {
      missing.push("Session");
    }
    if (typeof Utilities === "undefined") {
      missing.push("Utilities");
    }

    if (missing.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan dependencias globales: ${missing.join(", ")}.`
      );
    }
  }

  /**
   * Obtiene y valida la configuración declarativa del módulo.
   *
   * @return {!Object} Configuración validada.
   * @throws {Error} Si la configuración no está disponible.
   * @private
   */
  function _getConfig_() {
    if (
      typeof UBICACIONES_MAXMIN_CONFIG === "undefined" ||
      !UBICACIONES_MAXMIN_CONFIG ||
      typeof UBICACIONES_MAXMIN_CONFIG !== "object"
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe UBICACIONES_MAXMIN_CONFIG.`
      );
    }
    return UBICACIONES_MAXMIN_CONFIG;
  }

  /**
   * Obtiene y valida el mapa de columnas de UBICACIONES_MAXMIN.
   *
   * @return {!Object} Mapa de índices validado.
   * @throws {Error} Si faltan columnas o existen índices inválidos o duplicados.
   * @private
   */
  function _getColumns_() {
    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.UBICACIONES_MAXMIN ||
      typeof COL.UBICACIONES_MAXMIN !== "object"
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe COL.UBICACIONES_MAXMIN.`
      );
    }

    const columns = COL.UBICACIONES_MAXMIN;
    const missingColumns = REQUIRED_COLUMNS.filter(function (columnName) {
      return !Object.prototype.hasOwnProperty.call(columns, columnName);
    });

    if (missingColumns.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan columnas requeridas: ` +
          `${missingColumns.join(", ")}.`
      );
    }

    const indexes = Object.create(null);
    REQUIRED_COLUMNS.forEach(function (columnName) {
      const index = columns[columnName];
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          `${CFG.LOG_PREFIX} COL.UBICACIONES_MAXMIN.${columnName} ` +
            `contiene el índice inválido "${index}".`
        );
      }
      if (Object.prototype.hasOwnProperty.call(indexes, index)) {
        throw new Error(
          `${CFG.LOG_PREFIX} Las columnas ${indexes[index]} y ${columnName} ` +
            `comparten el índice ${index}.`
        );
      }
      indexes[index] = columnName;
    });

    return columns;
  }

  /**
   * Obtiene el contrato de encabezados esperado.
   *
   * @return {!Array<string>} Copia del contrato de encabezados.
   * @throws {Error} Si el contrato no existe o tiene un ancho incompatible.
   * @private
   */
  function _getExpectedHeaders_() {
    if (
      typeof UBICACIONES_MAXMIN_HEADERS === "undefined" ||
      !Array.isArray(UBICACIONES_MAXMIN_HEADERS)
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe UBICACIONES_MAXMIN_HEADERS.`
      );
    }
    if (
      typeof UBICACIONES_MAXMIN_EXPECTED_WIDTH !== "number" ||
      !Number.isInteger(UBICACIONES_MAXMIN_EXPECTED_WIDTH) ||
      UBICACIONES_MAXMIN_EXPECTED_WIDTH <= 0
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} UBICACIONES_MAXMIN_EXPECTED_WIDTH es inválido.`
      );
    }
    if (
      UBICACIONES_MAXMIN_HEADERS.length !==
      UBICACIONES_MAXMIN_EXPECTED_WIDTH
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} El ancho de encabezados no coincide con el ancho ` +
          `esperado (${UBICACIONES_MAXMIN_EXPECTED_WIDTH}).`
      );
    }
    return UBICACIONES_MAXMIN_HEADERS.slice();
  }

  /**
   * Obtiene la hoja autoritativa configurada.
   *
   * @return {!GoogleAppsScript.Spreadsheet.Sheet} Hoja validada.
   * @throws {Error} Si la hoja no está disponible.
   * @private
   */
  function _getSheet_(trace) {
    _validateDependencies_();
    const sheet = getSheetByKey_(CFG.SOURCE_KEY, trace);
    if (!sheet || typeof sheet.getRange !== "function") {
      throw new Error(
        `${CFG.LOG_PREFIX} No fue posible resolver la hoja ${CFG.SOURCE_KEY}.`
      );
    }
    return sheet;
  }

  /**
   * Valida el ancho y los encabezados físicos de la hoja.
   *
   * @param {!GoogleAppsScript.Spreadsheet.Sheet=} sheet Hoja opcional ya resuelta.
   * @return {{sheetName:string,width:number,headers:!Array<string>}} Diagnóstico.
   * @throws {Error} Si la hoja no cumple el contrato físico.
   * @private
   */
  function _validateSheetContract_(sheet, trace) {
    const source = sheet || _getSheet_(trace);
    const contractStartedAt = Date.now();
    const expectedHeaders = _getExpectedHeaders_();
    const expectedWidth = UBICACIONES_MAXMIN_EXPECTED_WIDTH;
    const lastColumn = source.getLastColumn();

    if (lastColumn !== expectedWidth) {
      const error = new Error(
        `${CFG.LOG_PREFIX} La hoja ${source.getName()} tiene ${lastColumn} ` +
          `columna(s); se esperaban ${expectedWidth}.`
      );
      error.code = _getConfig_().ERROR_CODES.ANCHO_INVALIDO;
      throw error;
    }

    const actualHeaders = source
      .getRange(CFG.HEADER_ROW, 1, 1, expectedWidth)
      .getDisplayValues()[0]
      .map(function (header) {
        return toStrUpper_(header);
      });

    const mismatches = expectedHeaders.reduce(function (items, expected, index) {
      const normalizedExpected = toStrUpper_(expected);
      if (actualHeaders[index] !== normalizedExpected) {
        items.push({
          column: index + 1,
          expected: normalizedExpected,
          actual: actualHeaders[index]
        });
      }
      return items;
    }, []);

    if (mismatches.length > 0) {
      const summary = mismatches
        .map(function (item) {
          return `columna ${item.column}: "${item.actual}" != "${item.expected}"`;
        })
        .join("; ");
      const error = new Error(
        `${CFG.LOG_PREFIX} Encabezados incompatibles en ${source.getName()}: ` +
          `${summary}.`
      );
      error.code = _getConfig_().ERROR_CODES.ENCABEZADOS_INVALIDOS;
      throw error;
    }

    const result = {
      sheetName: source.getName(),
      width: expectedWidth,
      headers: actualHeaders.slice()
    };
    perfMark_(trace, "REPOSITORY_CONTRACT_VALIDATED", {
      elapsedMs: Date.now() - contractStartedAt,
      width: expectedWidth
    });
    return result;
  }

  // ===========================================================================
  // NORMALIZACIÓN Y PROYECCIÓN
  // ===========================================================================

  /** @private @const {!Set<string>} */
  const EMPTY_NUMERIC_MARKERS = new Set([
    "",
    "-",
    "N/A",
    "NA",
    "PENDIENTE",
    "SIN DATO"
  ]);

  /**
   * Convierte una celda numérica leída desde la hoja a un número finito.
   *
   * Las filas pendientes pueden contener una celda vacía o un marcador operativo.
   * Esos valores se interpretan como cero exclusivamente durante la lectura. Los
   * separadores de miles y espacios se eliminan antes de convertir.
   *
   * La función no oculta errores reales: cualquier texto no reconocido produce un
   * error que incluye campo, fila física y valor recibido.
   *
   * @param {*} value Valor leído desde Google Sheets.
   * @param {string} fieldName Campo asociado.
   * @param {number} sheetRow Número físico de fila.
   * @return {number} Valor finito normalizado.
   * @throws {TypeError} Si la celda no es convertible.
   * @private
   */
  function _toReadNumber_(value, fieldName, sheetRow) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    const normalized = String(value == null ? "" : value)
      .trim()
      .toUpperCase();

    if (EMPTY_NUMERIC_MARKERS.has(normalized)) {
      return 0;
    }

    const numericText = normalized
      .replace(/,/g, "")
      .replace(/\s+/g, "");
    const number = Number(numericText);

    if (!Number.isFinite(number)) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} El campo ${fieldName} contiene un número inválido ` +
        `en la fila ${sheetRow}: "${normalized}".`
      );
    }

    return number;
  }

  /**
   * Convierte un valor de escritura a un número finito.
   *
   * A diferencia de la lectura, esta función no acepta marcadores operativos ni
   * texto con formato. El Service debe entregar números o cadenas numéricas
   * válidas. Los vacíos se normalizan a cero para campos opcionales.
   *
   * @param {*} value Valor recibido desde el Service.
   * @param {string} fieldName Campo asociado.
   * @return {number} Valor finito normalizado.
   * @throws {TypeError} Si el valor no representa un número finito.
   * @private
   */
  function _toWriteNumber_(value, fieldName) {
    if (value === "" || value === null || value === undefined) {
      return 0;
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} El campo ${fieldName} debe contener un número válido.`
      );
    }

    return number;
  }

  /**
   * Construye una clave canónica de identidad funcional.
   *
   * @param {*} codigo Código de producto.
   * @param {*} bodega Bodega.
   * @param {*} ubicacion Ubicación.
   * @return {string} Clave CODIGO|BODEGA|UBICACION.
   * @private
   */
  function _buildIdentityKey_(codigo, bodega, ubicacion) {
    return [
      toStrUpper_(codigo),
      toStrUpper_(bodega),
      toStrUpper_(ubicacion)
    ].join("|");
  }

  /**
   * Convierte una fila física al contrato normalizado del repositorio.
   *
   * @param {!Array<*>} row Fila física.
   * @param {number} sheetRow Número real de fila en Google Sheets.
   * @return {!Object} Entidad normalizada e inmutable.
   * @throws {TypeError} Si la fila no es válida o tiene un ancho insuficiente.
   * @private
   */
  function _normalizeRow_(row, sheetRow) {
    if (!Array.isArray(row)) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} La fila ${sheetRow} tiene un formato inválido.`
      );
    }
    if (row.length < UBICACIONES_MAXMIN_EXPECTED_WIDTH) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} La fila ${sheetRow} contiene ${row.length} ` +
          `columna(s); se esperaban ${UBICACIONES_MAXMIN_EXPECTED_WIDTH}.`
      );
    }

    const columns = _getColumns_();
    const codigo = toStrUpper_(row[columns.CODIGO]);
    const bodega = toStrUpper_(row[columns.BODEGA]);
    const ubicacion = toStrUpper_(row[columns.UBICACION]);

    return Object.freeze({
      numFila: sheetRow,
      identidad: _buildIdentityKey_(codigo, bodega, ubicacion),
      codigo: codigo,
      descripcion: toStr_(row[columns.DESCRIPCION]),
      bodega: bodega,
      ubicacion: ubicacion,
      existencia: _toReadNumber_(row[columns.EXISTENCIA], "EXISTENCIA", sheetRow),
      porcentaje: _toReadNumber_(row[columns.PORCENTAJE], "PORCENTAJE", sheetRow),
      maximo: _toReadNumber_(row[columns.MAXIMO], "MAXIMO", sheetRow),
      minimo: _toReadNumber_(row[columns.MINIMO], "MINIMO", sheetRow),
      zonaBodega: toStrUpper_(row[columns.ZONA_BODEGA]),
      zonaAbastecimiento: toStrUpper_(row[columns.ZONA_ABASTECIMIENTO]),
      zonaNivel: toStrUpper_(row[columns.ZONA_NIVEL]),
      fecha: toStr_(row[columns.FECHA]),
      hora: toStr_(row[columns.HORA]),
      usuario: toStrUpper_(row[columns.USUARIO]),
      validacion: toStrUpper_(row[columns.VALIDACION])
    });
  }

  /**
   * Crea una copia defensiva de una entidad normalizada.
   *
   * @param {!Object} item Entidad interna.
   * @return {!Object} Copia segura para el consumidor.
   * @private
   */
  function _copyItem_(item) {
    return {
      numFila: item.numFila,
      identidad: item.identidad,
      codigo: item.codigo,
      descripcion: item.descripcion,
      bodega: item.bodega,
      ubicacion: item.ubicacion,
      existencia: item.existencia,
      porcentaje: item.porcentaje,
      maximo: item.maximo,
      minimo: item.minimo,
      zonaBodega: item.zonaBodega,
      zonaAbastecimiento: item.zonaAbastecimiento,
      zonaNivel: item.zonaNivel,
      fecha: item.fecha,
      hora: item.hora,
      usuario: item.usuario,
      validacion: item.validacion
    };
  }

  /**
   * Convierte una entidad normalizada al arreglo físico A:O.
   *
   * @param {!Object} item Entidad lista para persistencia.
   * @return {!Array<*>} Arreglo de 15 columnas.
   * @private
   */
  function _toPhysicalRow_(item) {
    const columns = _getColumns_();
    const row = new Array(UBICACIONES_MAXMIN_EXPECTED_WIDTH).fill("");

    row[columns.CODIGO] = item.codigo;
    row[columns.DESCRIPCION] = item.descripcion;
    row[columns.BODEGA] = item.bodega;
    row[columns.UBICACION] = item.ubicacion;
    row[columns.EXISTENCIA] = item.existencia;
    row[columns.PORCENTAJE] = item.porcentaje;
    row[columns.MAXIMO] = item.maximo;
    row[columns.MINIMO] = item.minimo;
    row[columns.ZONA_BODEGA] = item.zonaBodega;
    row[columns.ZONA_ABASTECIMIENTO] = item.zonaAbastecimiento;
    row[columns.ZONA_NIVEL] = item.zonaNivel;
    row[columns.FECHA] = item.fecha;
    row[columns.HORA] = item.hora;
    row[columns.USUARIO] = item.usuario;
    row[columns.VALIDACION] = item.validacion;

    return row;
  }

  // ===========================================================================
  // LECTURA Y CACHÉ
  // ===========================================================================

  /**
   * Lee y normaliza todos los registros válidos desde la fuente.
   *
   * @param {boolean=} validateContract Indica si debe validar encabezados.
   * @return {!Array<!Object>} Entidades internas normalizadas.
   * @private
   */
  function _readNormalizedData_(validateContract = true, trace) {
    _validateDependencies_();
    _getColumns_();
    _getConfig_();

    if (validateContract) {
      _validateSheetContract_(null, trace);
    }

    const rows = getRowsByKey_(CFG.SOURCE_KEY, trace);
    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La fuente ${CFG.SOURCE_KEY} no devolvió un arreglo.`
      );
    }

    const normalizeStartedAt = Date.now();
    const normalized = rows
      .map(function (row, index) {
        return _normalizeRow_(row, CFG.FIRST_DATA_ROW + index);
      })
      .filter(function (item) {
        return Boolean(item.codigo || item.bodega || item.ubicacion);
      });
    perfMark_(trace, "REPOSITORY_ROWS_NORMALIZED", {
      elapsedMs: Date.now() - normalizeStartedAt,
      inputRows: rows.length,
      outputRows: normalized.length
    });
    return normalized;
  }

  /**
   * Obtiene la caché local o carga la fuente una sola vez por ejecución.
   *
   * @return {!Array<!Object>} Caché interna.
   * @private
   */
  function _getCachedData_(trace) {
    if (cache_ !== null) {
      perfMark_(trace, "REPOSITORY_CACHE_HIT", { records: cache_.length });
      return cache_;
    }
    perfMark_(trace, "REPOSITORY_CACHE_MISS");
    cache_ = _readNormalizedData_(true, trace);
    console.log(
      `${CFG.LOG_PREFIX} Caché cargada: ${cache_.length} registro(s).`
    );
    return cache_;
  }

  /**
   * Invalida la caché local.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log(`${CFG.LOG_PREFIX} Caché invalidada.`);
  }

  /**
   * Ordena por código, bodega y ubicación usando reglas de español y números.
   *
   * @param {!Object} left Primer registro.
   * @param {!Object} right Segundo registro.
   * @return {number} Resultado para Array.prototype.sort().
   * @private
   */
  function _compareItems_(left, right) {
    const options = { numeric: true, sensitivity: "base" };
    return (
      left.codigo.localeCompare(right.codigo, "es-MX", options) ||
      left.bodega.localeCompare(right.bodega, "es-MX", options) ||
      left.ubicacion.localeCompare(right.ubicacion, "es-MX", options)
    );
  }

  /**
   * Devuelve todos los registros ordenados por código, bodega y ubicación.
   *
   * @return {!Array<!Object>} Copias defensivas ordenadas.
   */
  function getAll(parentTrace) {
    const context = _traceContext_("GET_ALL", parentTrace);
    try {
      const copyStartedAt = Date.now();
      const result = _getCachedData_(context.trace)
        .map(_copyItem_)
        .sort(_compareItems_);
      perfMark_(context.trace, "REPOSITORY_RESULT_COPIED_SORTED", {
        elapsedMs: Date.now() - copyStartedAt,
        records: result.length
      });
      _finishTrace_(context, "ok", { records: result.length });
      return result;
    } catch (error) {
      if (context.owned) perfFail_(context.trace, error);
      else perfMark_(context.trace, "REPOSITORY_GET_ALL_FAILED", {
        message: error && error.message ? error.message : String(error || "")
      });
      throw error;
    }
  }

  /**
   * Busca todas las ubicaciones asociadas a un código exacto.
   *
   * @param {*} codigo Código de producto.
   * @return {!Array<!Object>} Coincidencias ordenadas.
   */
  function getPorCodigo(codigo) {
    const normalizedCode = toStrUpper_(codigo);
    if (!normalizedCode) {
      return [];
    }
    return _getCachedData_()
      .filter(function (item) {
        return item.codigo === normalizedCode;
      })
      .map(_copyItem_)
      .sort(_compareItems_);
  }

  /**
   * Busca todos los registros de una bodega exacta.
   *
   * @param {*} bodega Bodega.
   * @return {!Array<!Object>} Coincidencias ordenadas.
   */
  function getPorBodega(bodega) {
    const normalizedWarehouse = toStrUpper_(bodega);
    if (!normalizedWarehouse) {
      return [];
    }
    return _getCachedData_()
      .filter(function (item) {
        return item.bodega === normalizedWarehouse;
      })
      .map(_copyItem_)
      .sort(_compareItems_);
  }

  /**
   * Busca un registro mediante su identidad funcional exacta.
   *
   * @param {*} codigo Código.
   * @param {*} bodega Bodega.
   * @param {*} ubicacion Ubicación.
   * @return {?Object} Copia del registro o null.
   */
  function getPorIdentidad(codigo, bodega, ubicacion) {
    const identity = _buildIdentityKey_(codigo, bodega, ubicacion);
    if (identity === "||") {
      return null;
    }
    const found = _getCachedData_().find(function (item) {
      return item.identidad === identity;
    });
    return found ? _copyItem_(found) : null;
  }

  /**
   * Obtiene un registro mediante su número físico de fila.
   *
   * @param {*} numFila Número de fila.
   * @return {?Object} Copia del registro o null.
   */
  function getPorNumeroFila(numFila) {
    const rowNumber = Number(numFila);
    if (!Number.isInteger(rowNumber) || rowNumber < CFG.FIRST_DATA_ROW) {
      return null;
    }
    const found = _getCachedData_().find(function (item) {
      return item.numFila === rowNumber;
    });
    return found ? _copyItem_(found) : null;
  }

  /**
   * Valida públicamente el contrato físico sin modificar información.
   *
   * @return {{sheetName:string,width:number,headers:!Array<string>}} Diagnóstico.
   */
  function validarContrato(trace) {
    _validateDependencies_();
    _getColumns_();
    _getConfig_();
    return _validateSheetContract_(null, trace);
  }

  // ===========================================================================
  // CONTEXTO DE SERVIDOR Y VALIDACIÓN DE ESCRITURA
  // ===========================================================================

  /**
   * Construye FECHA y HORA autoritativas del servidor.
   *
   * USUARIO no se obtiene de Session porque el flujo funcional exige seleccionar
   * un usuario operativo. El Service debe validar ese nombre contra
   * UsuariosRepository antes de invocar este repositorio.
   *
   * @return {{fecha:string,hora:string}} Metadatos temporales.
   * @private
   */
  function _getServerAudit_() {
    const now = new Date();
    const timezone = Session.getScriptTimeZone();
    return {
      fecha: Utilities.formatDate(now, timezone, CFG.DATE_FORMAT),
      hora: Utilities.formatDate(now, timezone, CFG.TIME_FORMAT)
    };
  }

  /**
   * Valida y normaliza un payload para persistencia.
   *
   * El Service debe aplicar reglas de dominio más específicas. El Repository
   * garantiza el contrato mínimo necesario para una escritura consistente.
   *
   * @param {*} payload Datos recibidos desde el Service.
   * @return {!Object} Entidad normalizada y lista para escribir.
   * @throws {TypeError|Error} Si el payload no cumple el contrato mínimo.
   * @private
   */
  function _normalizeWritePayload_(payload) {
    const config = _getConfig_();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      const error = new TypeError(
        `${CFG.LOG_PREFIX} El payload de escritura debe ser un objeto válido.`
      );
      error.code = config.ERROR_CODES.PAYLOAD_INVALIDO;
      throw error;
    }

    const codigo = toStrUpper_(payload.codigo);
    const bodega = toStrUpper_(payload.bodega);
    const ubicacion = toStrUpper_(payload.ubicacion);
    const usuario = toStrUpper_(payload.usuario);

    if (!codigo) {
      const error = new Error(`${CFG.LOG_PREFIX} CODIGO es obligatorio.`);
      error.code = config.ERROR_CODES.CODIGO_REQUERIDO;
      throw error;
    }
    if (!bodega) {
      const error = new Error(`${CFG.LOG_PREFIX} BODEGA es obligatoria.`);
      error.code = config.ERROR_CODES.BODEGA_REQUERIDA;
      throw error;
    }
    if (!ubicacion) {
      const error = new Error(`${CFG.LOG_PREFIX} UBICACION es obligatoria.`);
      error.code = config.ERROR_CODES.UBICACION_REQUERIDA;
      throw error;
    }

    const audit = _getServerAudit_();
    return {
      numFila: Number.isInteger(Number(payload.numFila))
        ? Number(payload.numFila)
        : 0,
      identidad: _buildIdentityKey_(codigo, bodega, ubicacion),
      codigo: codigo,
      descripcion: toStr_(payload.descripcion),
      bodega: bodega,
      ubicacion: ubicacion,
      existencia: _toWriteNumber_(payload.existencia, "EXISTENCIA"),
      porcentaje: _toWriteNumber_(payload.porcentaje, "PORCENTAJE"),
      maximo: _toWriteNumber_(payload.maximo, "MAXIMO"),
      minimo: _toWriteNumber_(payload.minimo, "MINIMO"),
      zonaBodega: toStrUpper_(payload.zonaBodega),
      zonaAbastecimiento: toStrUpper_(payload.zonaAbastecimiento),
      zonaNivel: toStrUpper_(payload.zonaNivel),
      fecha: audit.fecha,
      hora: audit.hora,
      usuario: usuario,
      validacion: ""
    };
  }

  /**
   * Ejecuta una operación crítica protegida con ScriptLock.
   *
   * @param {function(): *} operation Operación crítica.
   * @return {*} Resultado de la operación.
   * @throws {Error} Si no se obtiene el lock dentro del tiempo configurado.
   * @private
   */
  function _withScriptLock_(operation, trace) {
    if (typeof operation !== "function") {
      throw new TypeError(
        `${CFG.LOG_PREFIX} La operación protegida debe ser una función.`
      );
    }
    const config = _getConfig_();
    return withScriptLock_(
      "UBICACIONES_MAXMIN_WRITE",
      operation,
      config.LIMITS.LOCK_TIMEOUT_MS,
      trace
    );
  }

  // ===========================================================================
  // ESCRITURAS
  // ===========================================================================

  /**
   * Inserta un registro nuevo si su identidad funcional no existe.
   *
   * @param {!Object} payload Datos normalizados por el Service.
   * @return {!Object} Registro persistido.
   * @throws {Error} Si la identidad ya existe o la hoja es incompatible.
   */
  function insertar(payload) {
    const normalized = _normalizeWritePayload_(payload);

    return _withScriptLock_(function () {
      const sheet = _getSheet_();
      _validateSheetContract_(sheet);
      const freshData = _readNormalizedData_(false);
      const duplicate = freshData.find(function (item) {
        return item.identidad === normalized.identidad;
      });

      if (duplicate) {
        const error = new Error(
          `${CFG.LOG_PREFIX} Ya existe ${normalized.identidad} en la fila ` +
            `${duplicate.numFila}.`
        );
        error.code = _getConfig_().ERROR_CODES.REGISTRO_DUPLICADO;
        throw error;
      }

      const targetRow = Math.max(sheet.getLastRow() + 1, CFG.FIRST_DATA_ROW);
      const physicalRow = _toPhysicalRow_(normalized);
      sheet
        .getRange(targetRow, 1, 1, UBICACIONES_MAXMIN_EXPECTED_WIDTH)
        .setValues([physicalRow]);
      SpreadsheetApp.flush();
      clearCache();

      return _copyItem_(
        _normalizeRow_(physicalRow, targetRow)
      );
    });
  }

  /**
   * Actualiza una fila existente y verifica nuevamente su identidad bajo lock.
   *
   * @param {*} numFila Número físico de fila.
   * @param {!Object} payload Datos normalizados por el Service.
   * @return {!Object} Registro actualizado.
   * @throws {Error} Si la fila no existe o la identidad colisiona con otra fila.
   */
  function actualizar(numFila, payload, parentTrace) {
    const context = _traceContext_("UPDATE", parentTrace);
    try {
      const rowNumber = Number(numFila);
      if (!Number.isInteger(rowNumber) || rowNumber < CFG.FIRST_DATA_ROW) {
        const error = new TypeError(
          `${CFG.LOG_PREFIX} El número de fila debe ser un entero mayor o igual a ` +
          `${CFG.FIRST_DATA_ROW}.`
        );
        error.code = _getConfig_().ERROR_CODES.REGISTRO_NO_ENCONTRADO;
        throw error;
      }

      const normalized = perfMeasure_(
        context.trace,
        "REPOSITORY_PAYLOAD_NORMALIZED",
        function () { return _normalizeWritePayload_(payload); }
      );

      const result = _withScriptLock_(function () {
        const sheet = perfMeasure_(
          context.trace,
          "REPOSITORY_SHEET_RESOLVED",
          function () { return _getSheet_(context.trace); }
        );
        _validateSheetContract_(sheet, context.trace);
        const freshData = _readNormalizedData_(false, context.trace);

        const lookupStartedAt = Date.now();
        const current = freshData.find(function (item) {
          return item.numFila === rowNumber;
        });
        if (!current) {
          const error = new Error(
            `${CFG.LOG_PREFIX} No existe un registro en la fila solicitada.`
          );
          error.code = _getConfig_().ERROR_CODES.REGISTRO_NO_ENCONTRADO;
          throw error;
        }
        const duplicate = freshData.find(function (item) {
          return item.identidad === normalized.identidad && item.numFila !== rowNumber;
        });
        perfMark_(context.trace, "REPOSITORY_ROW_LOOKUP_COMPLETED", {
          elapsedMs: Date.now() - lookupStartedAt,
          recordsScanned: freshData.length,
          duplicateFound: Boolean(duplicate)
        });
        if (duplicate) {
          const error = new Error(
            `${CFG.LOG_PREFIX} La identidad funcional ya existe en otra fila.`
          );
          error.code = _getConfig_().ERROR_CODES.REGISTRO_DUPLICADO;
          throw error;
        }

        const persisted = { ...normalized, validacion: current.validacion };
        const physicalRow = perfMeasure_(
          context.trace,
          "REPOSITORY_PHYSICAL_ROW_BUILT",
          function () { return _toPhysicalRow_(persisted); }
        );

        const writeStartedAt = Date.now();
        sheet
          .getRange(rowNumber, 1, 1, UBICACIONES_MAXMIN_EXPECTED_WIDTH)
          .setValues([physicalRow]);
        perfMark_(context.trace, "REPOSITORY_ROW_WRITTEN", {
          elapsedMs: Date.now() - writeStartedAt,
          width: UBICACIONES_MAXMIN_EXPECTED_WIDTH
        });

        const flushStartedAt = Date.now();
        SpreadsheetApp.flush();
        perfMark_(context.trace, "REPOSITORY_FLUSH_COMPLETED", {
          elapsedMs: Date.now() - flushStartedAt
        });

        clearCache();
        perfMark_(context.trace, "REPOSITORY_CACHE_CLEARED");
        return _copyItem_(_normalizeRow_(physicalRow, rowNumber));
      }, context.trace);

      _finishTrace_(context, "ok", { updated: true });
      return result;
    } catch (error) {
      if (context.owned) perfFail_(context.trace, error);
      else perfMark_(context.trace, "REPOSITORY_UPDATE_FAILED", {
        message: error && error.message ? error.message : String(error || "")
      });
      throw error;
    }
  }

  /**
   * Inserta o actualiza un registro mediante su identidad funcional.
   *
   * La decisión se toma dentro de un único ScriptLock para evitar inserciones
   * duplicadas causadas por solicitudes concurrentes.
   *
   * @param {!Object} payload Datos normalizados por el Service.
   * @return {{operation:string,record:!Object}} Resultado de persistencia.
   */
  function upsert(payload) {
    const normalized = _normalizeWritePayload_(payload);

    return _withScriptLock_(function () {
      const sheet = _getSheet_();
      _validateSheetContract_(sheet);
      const freshData = _readNormalizedData_(false);
      const existing = freshData.find(function (item) {
        return item.identidad === normalized.identidad;
      });

      if (existing) {
        const persisted = {
          ...normalized,
          validacion: existing.validacion
        };
        const existingPhysicalRow = _toPhysicalRow_(persisted);
        sheet
          .getRange(
            existing.numFila,
            1,
            1,
            UBICACIONES_MAXMIN_EXPECTED_WIDTH
          )
          .setValues([existingPhysicalRow]);
        SpreadsheetApp.flush();
        clearCache();
        return {
          operation: "UPDATED",
          record: _copyItem_(
            _normalizeRow_(existingPhysicalRow, existing.numFila)
          )
        };
      }

      const targetRow = Math.max(sheet.getLastRow() + 1, CFG.FIRST_DATA_ROW);
      const physicalRow = _toPhysicalRow_(normalized);
      sheet
        .getRange(targetRow, 1, 1, UBICACIONES_MAXMIN_EXPECTED_WIDTH)
        .setValues([physicalRow]);
      SpreadsheetApp.flush();
      clearCache();
      return {
        operation: "INSERTED",
        record: _copyItem_(
          _normalizeRow_(physicalRow, targetRow)
        )
      };
    });
  }

  /**
   * Diagnostica celdas numéricas no convertibles sin interrumpir en el primer error.
   *
   * Esta operación es de solo lectura y no devuelve IDs de Spreadsheet. Resulta
   * útil para localizar datos históricos incompatibles en EXISTENCIA, PORCENTAJE,
   * MAXIMO o MINIMO.
   *
   * @return {!Array<!Object>} Hallazgos con fila, campo y valor visible.
   */
  function diagnosticarCeldasNumericas() {
    _validateDependencies_();
    _validateSheetContract_();

    const rows = getRowsByKey_(CFG.SOURCE_KEY);
    const columns = _getColumns_();
    const fields = [
      ["EXISTENCIA", columns.EXISTENCIA],
      ["PORCENTAJE", columns.PORCENTAJE],
      ["MAXIMO", columns.MAXIMO],
      ["MINIMO", columns.MINIMO]
    ];
    const findings = [];

    rows.forEach(function(row, index) {
      const sheetRow = CFG.FIRST_DATA_ROW + index;
      fields.forEach(function(field) {
        try {
          _toReadNumber_(row[field[1]], field[0], sheetRow);
        } catch (error) {
          findings.push({
            fila: sheetRow,
            campo: field[0],
            valor: String(row[field[1]] == null ? "" : row[field[1]]).trim(),
            mensaje: error.message
          });
        }
      });
    });

    return findings;
  }

  // ===========================================================================
  // API PÚBLICA
  // ===========================================================================

  return Object.freeze({
    getAll,
    getPorCodigo,
    getPorBodega,
    getPorIdentidad,
    getPorNumeroFila,
    validarContrato,
    insertar,
    actualizar,
    upsert,
    clearCache,
    diagnosticarCeldasNumericas
  });
})();
