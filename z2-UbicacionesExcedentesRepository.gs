/**
 * z2-UbicacionesExcedentesRepository
 *
 * @fileoverview Repositorio de solo lectura para la fuente lógica
 * UBICACIONES_EXCEDENTES.
 *
 * Centraliza la lectura, validación, normalización y consulta de identificadores,
 * bodegas y ubicaciones destinadas al almacenamiento de excedentes. Mantiene una
 * caché local durante la ejecución actual de Google Apps Script y devuelve copias
 * defensivas para impedir modificaciones accidentales del estado interno.
 *
 * Dependencias globales:
 * - getRowsByKey_(sourceKey).
 * - toStrUpper_(value).
 * - COL.UBICACIONES_EXCEDENTES.IDUBICACIONES_EXCEDENTES.
 * - COL.UBICACIONES_EXCEDENTES.BODEGA.
 * - COL.UBICACIONES_EXCEDENTES.UBICACION.
 *
 * Reglas de normalización:
 * - Los identificadores se conservan como texto para no perder ceros iniciales.
 * - Los valores visibles se normalizan en mayúsculas.
 * - Las claves de identificador y ubicación eliminan todos los espacios.
 * - La clave de bodega conserva espacios internos y elimina los externos.
 * - Los registros sin ubicación se excluyen de la colección cacheada.
 * - getAll() conserva duplicados físicos; las proyecciones públicas se deduplican.
 * - Los criterios vacíos devuelven arreglos vacíos o null, según el contrato.
 * - La caché es local a la ejecución y no sustituye CacheService.
 *
 * Compatibilidad:
 * - idubicacionesexcedentes e identificador conservan el mismo valor.
 * - getById() permanece como alias de getByIdentificador().
 *
 * @author Sigifredo de la Cruz Ramos
 */

const UbicacionesExcedentesRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "UBICACIONES_EXCEDENTES",
    LOCALE: "es-MX",
    LOG_PREFIX: "[UbicacionesExcedentesRepository]"
  });

  /** @private @const {!Array<string>} */
  const REQUIRED_COLUMNS = Object.freeze([
    "IDUBICACIONES_EXCEDENTES",
    "BODEGA",
    "UBICACION"
  ]);

  /** @private @const {!Array<string>} */
  const PROJECTABLE_FIELDS = Object.freeze([
    "bodega",
    "ubicacion",
    "identificador"
  ]);

  /**
   * Caché normalizada de la ejecución actual.
   *
   * null indica que la fuente aún no se ha leído o que fue invalidada. Un arreglo
   * vacío representa una lectura válida sin registros utilizables.
   *
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /**
   * Verifica la existencia de las dependencias funcionales requeridas.
   *
   * @return {void}
   * @throws {Error} Si falta alguna dependencia global.
   * @private
   */
  function _validateDependencies_() {
    const dependencyStatus = [
      ["getRowsByKey_", typeof getRowsByKey_],
      ["toStrUpper_", typeof toStrUpper_]
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
   * Obtiene y valida el contrato físico de columnas.
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
      !COL.UBICACIONES_EXCEDENTES ||
      typeof COL.UBICACIONES_EXCEDENTES !== "object"
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe COL.UBICACIONES_EXCEDENTES.`
      );
    }

    const columns = COL.UBICACIONES_EXCEDENTES;
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
          `${CFG.LOG_PREFIX} COL.UBICACIONES_EXCEDENTES.${columnName} ` +
            `contiene el índice inválido "${index}".`
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

    return columns;
  }

  /**
   * Lee todas las filas físicas de la fuente configurada.
   *
   * @return {!Array<!Array<*>>} Filas entregadas por la utilidad de datos.
   * @throws {Error} Si la fuente no devuelve un arreglo.
   * @private
   */
  function _readSource_() {
    _validateDependencies_();
    _getColumns_();

    const rows = getRowsByKey_(CFG.SOURCE_KEY);
    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La fuente ${CFG.SOURCE_KEY} no devolvió un arreglo.`
      );
    }

    return rows;
  }

  /**
   * Construye una clave canónica para identificadores y ubicaciones.
   *
   * @param {*} value Valor de entrada.
   * @return {string} Texto en mayúsculas sin espacios.
   * @private
   */
  function _toCanonicalKey_(value) {
    return toStrUpper_(value).replace(/\s+/g, "").trim();
  }

  /**
   * Construye una clave de bodega conservando los espacios internos.
   *
   * @param {*} value Valor de entrada.
   * @return {string} Texto en mayúsculas sin espacios externos.
   * @private
   */
  function _toWarehouseKey_(value) {
    return toStrUpper_(value).trim();
  }

  /**
   * Convierte una fila física al contrato interno del repositorio.
   *
   * @param {!Array<*>} row Fila física de UBICACIONES_EXCEDENTES.
   * @param {number=} rowIndex Índice base cero utilizado para diagnóstico.
   * @return {!Object} Registro normalizado e inmutable.
   * @throws {TypeError} Si la fila no es un arreglo.
   * @private
   */
  function _normalizeRow_(row, rowIndex = -1) {
    if (!Array.isArray(row)) {
      const position = rowIndex >= 0 ? ` en el índice ${rowIndex}` : "";
      throw new TypeError(
        `${CFG.LOG_PREFIX} La fila${position} tiene un formato inválido.`
      );
    }

    const columns = _getColumns_();
    const identificador = toStrUpper_(
      row[columns.IDUBICACIONES_EXCEDENTES]
    );
    const bodega = toStrUpper_(row[columns.BODEGA]);
    const ubicacion = toStrUpper_(row[columns.UBICACION]);

    return Object.freeze({
      idubicacionesexcedentes: identificador,
      identificador,
      bodega,
      ubicacion,
      _keyIdentificador: _toCanonicalKey_(identificador),
      _keyUbicacion: _toCanonicalKey_(ubicacion),
      _keyBodega: _toWarehouseKey_(bodega)
    });
  }

  /**
   * Crea una copia pública sin exponer las claves auxiliares internas.
   *
   * @param {!Object} item Registro normalizado.
   * @return {!Object} Copia independiente para el consumidor.
   * @private
   */
  function _copyPublicItem_(item) {
    return {
      idubicacionesexcedentes: item.idubicacionesexcedentes,
      identificador: item.identificador,
      bodega: item.bodega,
      ubicacion: item.ubicacion
    };
  }

  /**
   * Obtiene la colección normalizada y la conserva durante la ejecución actual.
   *
   * @return {!Array<!Object>} Caché interna; no debe exponerse directamente.
   * @private
   */
  function _getCachedData_() {
    if (cache_ !== null) {
      return cache_;
    }

    cache_ = _readSource_()
      .map(function (row, index) {
        return _normalizeRow_(row, index);
      })
      .filter(function (item) {
        return Boolean(item.ubicacion);
      });

    console.log(
      `${CFG.LOG_PREFIX} Caché cargada: ${cache_.length} registro(s).`
    );

    return cache_;
  }

  /**
   * Filtra la caché y devuelve copias públicas independientes.
   *
   * @param {function(!Object): boolean} predicate Criterio de selección.
   * @return {!Array<!Object>} Coincidencias como copias defensivas.
   * @private
   */
  function _filterAndCopy_(predicate) {
    if (typeof predicate !== "function") {
      throw new TypeError(
        `${CFG.LOG_PREFIX} El criterio de filtrado debe ser una función.`
      );
    }

    return _getCachedData_().filter(predicate).map(_copyPublicItem_);
  }

  /**
   * Proyecta un campo público permitido.
   *
   * @param {string} field Propiedad por proyectar.
   * @return {!Array<string>} Valores en el orden físico de la fuente.
   * @throws {Error} Si el campo no pertenece al contrato de proyección.
   * @private
   */
  function _getField_(field) {
    if (!PROJECTABLE_FIELDS.includes(field)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La proyección "${field}" no está permitida.`
      );
    }

    return _getCachedData_().map(function (item) {
      return item[field];
    });
  }

  /**
   * Elimina duplicados conservando la primera aparición de cada clave.
   *
   * @param {!Array<*>} items Colección de entrada.
   * @param {function(*): string} keySelector Función de clave de unicidad.
   * @return {!Array<*>} Elementos únicos en orden de primera aparición.
   * @private
   */
  function _uniqueBy_(items, keySelector) {
    if (!Array.isArray(items)) {
      throw new TypeError(`${CFG.LOG_PREFIX} La colección debe ser un arreglo.`);
    }
    if (typeof keySelector !== "function") {
      throw new TypeError(
        `${CFG.LOG_PREFIX} El selector de unicidad debe ser una función.`
      );
    }

    const seen = new Set();
    return items.filter(function (item) {
      const key = keySelector(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Ordena textos usando reglas regionales y comparación numérica natural.
   *
   * @param {string} left Primer valor.
   * @param {string} right Segundo valor.
   * @return {number} Resultado compatible con Array.prototype.sort().
   * @private
   */
  function _compareText_(left, right) {
    return left.localeCompare(right, CFG.LOCALE, {
      sensitivity: "base",
      numeric: true
    });
  }

  /**
   * Devuelve todos los registros válidos ordenados por ubicación visible.
   *
   * getAll() conserva registros duplicados presentes en la fuente.
   *
   * @return {!Array<!Object>} Copias públicas ordenadas por ubicación.
   */
  function getAll() {
    return _getCachedData_()
      .map(_copyPublicItem_)
      .sort(function (left, right) {
        return _compareText_(left.ubicacion, right.ubicacion);
      });
  }

  /**
   * Busca todos los registros pertenecientes a una bodega exacta.
   *
   * @param {*} bodega Nombre de bodega solicitado.
   * @return {!Array<!Object>} Coincidencias exactas normalizadas.
   */
  function getPorBodega(bodega) {
    const filter = _toWarehouseKey_(bodega);
    if (!filter) {
      return [];
    }

    return _filterAndCopy_(function (item) {
      return item._keyBodega === filter;
    });
  }

  /**
   * Busca registros mediante la clave canónica de ubicación.
   *
   * @param {*} ubicacion Ubicación solicitada, por ejemplo B1-01.
   * @return {!Array<!Object>} Coincidencias por clave canónica.
   */
  function getPorUbicacion(ubicacion) {
    const filter = _toCanonicalKey_(ubicacion);
    if (!filter) {
      return [];
    }

    return _filterAndCopy_(function (item) {
      return item._keyUbicacion === filter;
    });
  }

  /**
   * Devuelve la primera coincidencia de una ubicación canónica.
   *
   * Conserva el contrato histórico y no arroja error si existen duplicados.
   * Para detectar duplicidad debe utilizarse getPorUbicacion().
   *
   * @param {*} ubicacion Ubicación solicitada.
   * @return {?Object} Primera coincidencia como copia pública o null.
   */
  function getOnePorUbicacion(ubicacion) {
    const filter = _toCanonicalKey_(ubicacion);
    if (!filter) {
      return null;
    }

    const item = _getCachedData_().find(function (record) {
      return record._keyUbicacion === filter;
    });

    return item ? _copyPublicItem_(item) : null;
  }

  /**
   * Devuelve el registro asociado a un identificador escaneable.
   *
   * @param {*} identificador Identificador solicitado, por ejemplo B1B101.
   * @return {?Object} Primera coincidencia como copia pública o null.
   */
  function getByIdentificador(identificador) {
    const filter = _toCanonicalKey_(identificador);
    if (!filter) {
      return null;
    }

    const item = _getCachedData_().find(function (record) {
      return record._keyIdentificador === filter;
    });

    return item ? _copyPublicItem_(item) : null;
  }

  /**
   * Alias compatible para consumidores genéricos.
   *
   * @param {*} identificador Identificador solicitado.
   * @return {?Object} Primera coincidencia o null.
   */
  function getById(identificador) {
    return getByIdentificador(identificador);
  }

  /**
   * Devuelve las bodegas visibles, únicas y ordenadas.
   *
   * @return {!Array<string>} Bodegas sin valores vacíos.
   */
  function getBodegas() {
    return _uniqueBy_(
      _getField_("bodega").filter(Boolean),
      _toWarehouseKey_
    ).sort(_compareText_);
  }

  /**
   * Devuelve las ubicaciones visibles, canónicamente únicas y ordenadas.
   *
   * @return {!Array<string>} Ubicaciones sin valores vacíos.
   */
  function getUbicaciones() {
    return _uniqueBy_(
      _getField_("ubicacion").filter(Boolean),
      _toCanonicalKey_
    ).sort(_compareText_);
  }

  /**
   * Devuelve los identificadores escaneables, únicos y ordenados.
   *
   * @return {!Array<string>} Identificadores sin valores vacíos.
   */
  function getIdentificadores() {
    return _uniqueBy_(
      _getField_("identificador").filter(Boolean),
      _toCanonicalKey_
    ).sort(_compareText_);
  }

  /**
   * Invalida la caché local para que la siguiente consulta relea la fuente.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log(`${CFG.LOG_PREFIX} Caché invalidada.`);
  }

  return Object.freeze({
    getAll,
    getPorBodega,
    getPorUbicacion,
    getOnePorUbicacion,
    getByIdentificador,
    getById,
    getBodegas,
    getUbicaciones,
    getIdentificadores,
    clearCache
  });
})();
