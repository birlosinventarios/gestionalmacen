/**
 * z2-ExcedentesRepository
 *
 * @fileoverview Repositorio de solo lectura para la hoja lógica BD-EXCEDENTES.
 *
 * Centraliza la lectura, validación, normalización y consulta de los excedentes.
 * Conserva el número físico de fila para procesos que necesitan trazabilidad y
 * mantiene una caché local durante la ejecución actual de Google Apps Script.
 * También ofrece una ruta instrumentada, independiente de la caché, destinada
 * a construir el estado operativo con información vigente.
 *
 * Dependencias globales:
 * - COL.EXCEDENTES con los índices de todas las columnas utilizadas.
 * - getRowsByKey_(sourceKey) y getSheetByKey_(sourceKey).
 * - toStrUpper_(value), toDate_(value), toTime_(value) y toNum_(value).
 * - sameDate_(left, right) y sameTime_(left, right).
 * - Servicios de Spreadsheet de Google Apps Script.
 *
 * Invariantes de dominio:
 * - CANTIDAD representa la cantidad inicial histórica del excedente.
 * - RESPONSABLEIMPRESION debe ocupar el índice 8 de BD-EXCEDENTES.
 * - Un registro general es válido cuando contiene CODIGO.
 * - Un registro para estado operativo es válido cuando contiene IDUNICO.
 * - Este repositorio no inserta, actualiza ni elimina registros.
 * - La identidad y autorización del responsable se validan en el servidor.
 *
 * Estrategia de caché:
 * - getAll(), getAllRaw(), getUltimos(), las consultas y las proyecciones usan
 *   una caché normalizada por ejecución.
 * - getAllForEstado() realiza una lectura directa para entregar datos vigentes y
 *   medir por separado los tiempos de lectura y normalización.
 * - clearCache() debe invocarse después de cualquier cambio en BD-EXCEDENTES
 *   ocurrido durante la misma ejecución.
 * - La API pública devuelve copias defensivas y no expone la caché interna.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const ExcedentesRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "EXCEDENTES",
    HEADER_ROW: 1,
    FIRST_DATA_ROW: 2,
    RESPONSABLE_IMPRESION_INDEX: 8,
    LOG_PREFIX: "[ExcedentesRepository]",
    PERF_PREFIX: "[APPALMACEN][EXCEDENTES_REPOSITORY_PERF]"
  });

  /** @private @const {!Array<string>} */
  const REQUIRED_COLUMNS = Object.freeze([
    "IDUNICO",
    "FECHA",
    "HORA",
    "IDPRODUCTO",
    "CODIGO",
    "DESCRIPCION",
    "CANTIDAD",
    "STATUS",
    "RESPONSABLEIMPRESION"
  ]);

  /**
   * Caché normalizada de la ejecución actual.
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /**
   * Verifica la existencia de las dependencias globales requeridas.
   *
   * @return {void}
   * @throws {Error} Si falta alguna utilidad obligatoria.
   * @private
   */
  function _validateDependencies_() {
    const dependencyStatus = [
      ["getRowsByKey_", typeof getRowsByKey_],
      ["getSheetByKey_", typeof getSheetByKey_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toDate_", typeof toDate_],
      ["toTime_", typeof toTime_],
      ["toNum_", typeof toNum_],
      ["sameDate_", typeof sameDate_],
      ["sameTime_", typeof sameTime_]
    ];

    const missingFunctions = dependencyStatus
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan dependencias globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }
  }

  /**
   * Obtiene y valida el contrato de columnas de BD-EXCEDENTES.
   *
   * @return {!Object} Mapa validado de índices de columna.
   * @throws {Error} Si la configuración no existe, está incompleta o contiene
   *   índices inválidos o duplicados.
   * @private
   */
  function _getColumns_() {
    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.EXCEDENTES ||
      typeof COL.EXCEDENTES !== "object"
    ) {
      throw new Error(`${CFG.LOG_PREFIX} No existe COL.EXCEDENTES.`);
    }

    const columns = COL.EXCEDENTES;
    const missingColumns = REQUIRED_COLUMNS.filter(function (columnName) {
      return !Object.prototype.hasOwnProperty.call(columns, columnName);
    });

    if (missingColumns.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan columnas requeridas: ` +
          `${missingColumns.join(", ")}.`
      );
    }

    const usedIndexes = Object.create(null);
    REQUIRED_COLUMNS.forEach(function (columnName) {
      const index = columns[columnName];

      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          `${CFG.LOG_PREFIX} COL.EXCEDENTES.${columnName} contiene el índice ` +
            `inválido "${index}".`
        );
      }

      if (Object.prototype.hasOwnProperty.call(usedIndexes, index)) {
        throw new Error(
          `${CFG.LOG_PREFIX} Las columnas ${usedIndexes[index]} y ` +
            `${columnName} comparten el índice ${index}.`
        );
      }

      usedIndexes[index] = columnName;
    });

    if (
      columns.RESPONSABLEIMPRESION !== CFG.RESPONSABLE_IMPRESION_INDEX
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} RESPONSABLEIMPRESION debe ocupar el índice ` +
          `${CFG.RESPONSABLE_IMPRESION_INDEX} de BD-EXCEDENTES.`
      );
    }

    return columns;
  }

  /**
   * Calcula el ancho mínimo necesario para leer todas las columnas requeridas.
   *
   * @param {!Object} columns Contrato de columnas validado.
   * @return {number} Cantidad de columnas que se deben leer.
   * @private
   */
  function _getSourceWidth_(columns) {
    const indexes = REQUIRED_COLUMNS.map(function (columnName) {
      return columns[columnName];
    });

    return Math.max.apply(null, indexes) + 1;
  }

  /**
   * Valida dependencias y devuelve el contrato estructural del origen.
   *
   * @return {{columns: !Object, width: number}}
   * @private
   */
  function _getSourceContract_() {
    _validateDependencies_();

    const columns = _getColumns_();
    return Object.freeze({
      columns,
      width: _getSourceWidth_(columns)
    });
  }

  /**
   * Normaliza un valor para comparaciones textuales exactas.
   *
   * @param {*} value Valor de entrada.
   * @return {string} Texto normalizado en mayúsculas.
   * @private
   */
  function _normalizeText_(value) {
    return toStrUpper_(value);
  }

  /**
   * Lee todas las filas mediante la utilidad estándar del proyecto.
   *
   * @return {!Array<!Array<*>>} Filas físicas del origen.
   * @throws {Error} Si la fuente no devuelve un arreglo.
   * @private
   */
  function _readSource_() {
    _getSourceContract_();

    const rows = getRowsByKey_(CFG.SOURCE_KEY);
    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La fuente ${CFG.SOURCE_KEY} no devolvió un arreglo.`
      );
    }

    return rows;
  }

  /**
   * Lee directamente las filas requeridas para construir el estado operativo.
   *
   * @return {!Array<!Array<*>>} Filas físicas sin encabezado.
   * @throws {Error} Si la hoja o su interfaz no son válidas.
   * @private
   */
  function _readSourceForEstado_() {
    const contract = _getSourceContract_();
    const sheet = getSheetByKey_(CFG.SOURCE_KEY);

    if (
      !sheet ||
      typeof sheet.getLastRow !== "function" ||
      typeof sheet.getRange !== "function"
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} No fue posible obtener una hoja válida para ` +
          `${CFG.SOURCE_KEY}.`
      );
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < CFG.FIRST_DATA_ROW) {
      return [];
    }

    return sheet
      .getRange(
        CFG.FIRST_DATA_ROW,
        1,
        lastRow - CFG.HEADER_ROW,
        contract.width
      )
      .getValues();
  }

  /**
   * Convierte una fila física al contrato normalizado del repositorio.
   *
   * @param {!Array<*>} row Fila física.
   * @param {number} rowNumber Número real de fila en la hoja.
   * @param {!Object} columns Contrato validado de columnas.
   * @return {!Object} Entidad normalizada e inmutable.
   * @throws {TypeError} Si la fila o el número físico son inválidos.
   * @private
   */
  function _normalizeRow_(row, rowNumber, columns) {
    if (!Array.isArray(row)) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} La fila física ${rowNumber} tiene un formato inválido.`
      );
    }

    if (!Number.isInteger(rowNumber) || rowNumber < CFG.FIRST_DATA_ROW) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} El número de fila "${rowNumber}" es inválido.`
      );
    }

    return Object.freeze({
      rowNumber,
      idunico: _normalizeText_(row[columns.IDUNICO]),
      fechaexcedente: toDate_(row[columns.FECHA]),
      horaexcedente: toTime_(row[columns.HORA]),
      idproducto: _normalizeText_(row[columns.IDPRODUCTO]),
      codigo: _normalizeText_(row[columns.CODIGO]),
      descripcion: _normalizeText_(row[columns.DESCRIPCION]),
      cantidad: toNum_(row[columns.CANTIDAD]),
      status: _normalizeText_(row[columns.STATUS]),
      responsableImpresion: _normalizeText_(
        row[columns.RESPONSABLEIMPRESION]
      )
    });
  }

  /**
   * Normaliza una fila para la consolidación del estado operativo.
   *
   * @param {!Array<*>} row Fila física.
   * @param {!Object} columns Contrato validado de columnas.
   * @return {!Object} Registro requerido por la capa de estado.
   * @throws {TypeError} Si la fila no es un arreglo.
   * @private
   */
  function _normalizeForEstado_(row, columns) {
    if (!Array.isArray(row)) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} Se recibió una fila inválida para el estado operativo.`
      );
    }

    const rawDate = row[columns.FECHA];
    const rawTime = row[columns.HORA];

    return {
      idunico: _normalizeText_(row[columns.IDUNICO]),
      fechaexcedente:
        rawDate instanceof Date ? new Date(rawDate.getTime()) : toDate_(rawDate),
      horaexcedente:
        rawTime instanceof Date ? new Date(rawTime.getTime()) : toTime_(rawTime),
      idproducto: _normalizeText_(row[columns.IDPRODUCTO]),
      codigo: _normalizeText_(row[columns.CODIGO]),
      descripcion: _normalizeText_(row[columns.DESCRIPCION]),
      cantidad: toNum_(row[columns.CANTIDAD]),
      status: _normalizeText_(row[columns.STATUS]),
      responsableImpresion: _normalizeText_(
        row[columns.RESPONSABLEIMPRESION]
      )
    };
  }

  /**
   * Crea una copia defensiva de una entidad, incluidas sus fechas mutables.
   *
   * @param {!Object} item Entidad normalizada.
   * @return {!Object} Copia independiente para código consumidor.
   * @private
   */
  function _copyItem_(item) {
    return {
      rowNumber: item.rowNumber,
      idunico: item.idunico,
      fechaexcedente:
        item.fechaexcedente instanceof Date
          ? new Date(item.fechaexcedente.getTime())
          : item.fechaexcedente,
      horaexcedente:
        item.horaexcedente instanceof Date
          ? new Date(item.horaexcedente.getTime())
          : item.horaexcedente,
      idproducto: item.idproducto,
      codigo: item.codigo,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      status: item.status,
      responsableImpresion: item.responsableImpresion
    };
  }

  /**
   * Obtiene y normaliza el origen una sola vez durante la ejecución actual.
   *
   * @return {!Array<!Object>} Caché interna; no debe exponerse directamente.
   * @private
   */
  function _getCachedData_() {
    if (cache_ !== null) {
      return cache_;
    }

    const contract = _getSourceContract_();
    cache_ = _readSource_()
      .map(function (row, index) {
        return _normalizeRow_(
          row,
          index + CFG.FIRST_DATA_ROW,
          contract.columns
        );
      })
      .filter(function (item) {
        return Boolean(item.codigo);
      });

    const printOwnerCount = cache_.reduce(function (total, item) {
      return total + (item.responsableImpresion ? 1 : 0);
    }, 0);

    console.log(
      `${CFG.LOG_PREFIX} Caché cargada: ${cache_.length} registro(s), ` +
        `${printOwnerCount} con responsable de impresión.`
    );

    return cache_;
  }

  /**
   * Proyecta una propiedad de las entidades almacenadas en caché.
   *
   * @param {string} field Propiedad permitida del contrato normalizado.
   * @return {!Array<*>} Valores en orden físico.
   * @throws {Error} Si se solicita una propiedad no permitida.
   * @private
   */
  function _getField_(field) {
    const allowedFields = Object.freeze([
      "idproducto",
      "codigo",
      "idunico",
      "status",
      "responsableImpresion"
    ]);

    if (!allowedFields.includes(field)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La proyección "${field}" no está permitida.`
      );
    }

    return _getCachedData_().map(function (item) {
      return item[field];
    });
  }

  /**
   * Filtra una propiedad por igualdad textual normalizada.
   *
   * @param {string} field Propiedad del contrato normalizado.
   * @param {*} value Valor buscado.
   * @return {!Array<!Object>} Copias defensivas de las coincidencias.
   * @private
   */
  function _filterByText_(field, value) {
    const filter = _normalizeText_(value);
    if (!filter) {
      return [];
    }

    return _getCachedData_()
      .filter(function (item) {
        return item[field] === filter;
      })
      .map(_copyItem_);
  }

  /**
   * Compara dos excedentes por código con reglas numéricas en español.
   *
   * @param {!Object} left Primer registro.
   * @param {!Object} right Segundo registro.
   * @return {number} Resultado compatible con Array.prototype.sort().
   * @private
   */
  function _compareByCode_(left, right) {
    return left.codigo.localeCompare(right.codigo, "es", {
      numeric: true,
      sensitivity: "base"
    });
  }

  /**
   * Devuelve todos los excedentes válidos ordenados por código.
   *
   * @return {!Array<!Object>} Copias independientes ordenadas por código.
   */
  function getAll() {
    return _getCachedData_().map(_copyItem_).sort(_compareByCode_);
  }

  /**
   * Devuelve todos los excedentes válidos en el orden físico del origen.
   *
   * @return {!Array<!Object>} Copias independientes en orden físico.
   */
  function getAllRaw() {
    return _getCachedData_().map(_copyItem_);
  }

  /**
   * Lee y normaliza sin caché los excedentes del estado operativo.
   *
   * Registra métricas de lectura y normalización. No incluye rowNumber para
   * conservar el contrato histórico de esta ruta especializada.
   *
   * @return {!Array<!Object>} Registros vigentes con IDUNICO válido.
   */
  function getAllForEstado() {
    const totalStartedAt = Date.now();
    const readStartedAt = Date.now();
    const source = _readSourceForEstado_();
    const readMs = Date.now() - readStartedAt;
    const contract = _getSourceContract_();
    const normalizeStartedAt = Date.now();
    const result = [];
    let rowsWithPrintOwner = 0;

    source.forEach(function (row) {
      const item = _normalizeForEstado_(row, contract.columns);
      if (!item.idunico) {
        return;
      }

      if (item.responsableImpresion) {
        rowsWithPrintOwner += 1;
      }

      result.push(item);
    });

    const normalizeMs = Date.now() - normalizeStartedAt;
    console.log(
      `${CFG.PERF_PREFIX} ${JSON.stringify({
        operation: "GET_ALL_FOR_ESTADO",
        totalMs: Date.now() - totalStartedAt,
        readMs,
        normalizeMs,
        sourceRows: source.length,
        resultRows: result.length,
        rowsWithPrintOwner,
        width: contract.width
      })}`
    );

    return result;
  }

  /**
   * Devuelve los últimos registros según su orden físico.
   *
   * @param {*} limit Número máximo de registros.
   * @return {!Array<!Object>} Últimos registros como copias independientes.
   */
  function getUltimos(limit) {
    const numericLimit = Number(limit);
    if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
      return [];
    }

    const normalizedLimit = Math.floor(numericLimit);
    return _getCachedData_().slice(-normalizedLimit).map(_copyItem_);
  }

  /** @param {*} idunico @return {!Array<!Object>} */
  function getPorIdUnico(idunico) {
    return _filterByText_("idunico", idunico);
  }

  /**
   * Busca excedentes cuya fecha coincide mediante sameDate_().
   * @param {*} fechaexcedente Fecha solicitada.
   * @return {!Array<!Object>} Copias defensivas de las coincidencias.
   */
  function getPorFecha(fechaexcedente) {
    if (fechaexcedente === null || typeof fechaexcedente === "undefined") {
      return [];
    }

    return _getCachedData_()
      .filter(function (item) {
        return sameDate_(item.fechaexcedente, fechaexcedente);
      })
      .map(_copyItem_);
  }

  /**
   * Busca excedentes cuya hora coincide mediante sameTime_().
   * @param {*} horaexcedente Hora solicitada.
   * @return {!Array<!Object>} Copias defensivas de las coincidencias.
   */
  function getPorHora(horaexcedente) {
    if (horaexcedente === null || typeof horaexcedente === "undefined") {
      return [];
    }

    return _getCachedData_()
      .filter(function (item) {
        return sameTime_(item.horaexcedente, horaexcedente);
      })
      .map(_copyItem_);
  }

  /** @param {*} idproducto @return {!Array<!Object>} */
  function getPorIdProducto(idproducto) {
    return _filterByText_("idproducto", idproducto);
  }

  /** @param {*} codigo @return {!Array<!Object>} */
  function getPorCodigo(codigo) {
    return _filterByText_("codigo", codigo);
  }

  /** @param {*} descripcion @return {!Array<!Object>} */
  function getPorDescripcion(descripcion) {
    return _filterByText_("descripcion", descripcion);
  }

  /** @param {*} status @return {!Array<!Object>} */
  function getPorStatus(status) {
    return _filterByText_("status", status);
  }

  /** @param {*} responsable @return {!Array<!Object>} */
  function getPorResponsableImpresion(responsable) {
    return _filterByText_("responsableImpresion", responsable);
  }

  /** @return {!Array<string>} IDs de producto en orden físico. */
  function getIdProductos() {
    return _getField_("idproducto");
  }

  /** @return {!Array<string>} Códigos en orden físico. */
  function getCodigos() {
    return _getField_("codigo");
  }

  /** @return {!Array<string>} Identificadores únicos en orden físico. */
  function getIdUnicos() {
    return _getField_("idunico");
  }

  /** @return {!Array<string>} Estados en orden físico. */
  function getStatus() {
    return _getField_("status");
  }

  /** @return {!Array<string>} Responsables de impresión en orden físico. */
  function getResponsablesImpresion() {
    return _getField_("responsableImpresion");
  }

  /**
   * Invalida la caché local para forzar una nueva lectura en la próxima consulta.
   *
   * @return {boolean} Siempre devuelve true después de invalidar la caché.
   */
  function clearCache() {
    cache_ = null;
    console.log(`${CFG.LOG_PREFIX} Caché invalidada.`);
    return true;
  }

  return Object.freeze({
    getAll,
    getAllRaw,
    getAllForEstado,
    getUltimos,
    getPorIdUnico,
    getPorFecha,
    getPorHora,
    getPorIdProducto,
    getPorCodigo,
    getPorDescripcion,
    getPorStatus,
    getPorResponsableImpresion,
    getIdProductos,
    getCodigos,
    getIdUnicos,
    getStatus,
    getResponsablesImpresion,
    clearCache
  });
})();
