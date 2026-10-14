/**
 * z2-UsuariosRepository
 *
 * @fileoverview Repositorio de solo lectura para la fuente lógica USUARIOS.
 *
 * Centraliza la lectura, validación, normalización y consulta del catálogo de
 * usuarios. Mantiene una caché local durante la ejecución actual de Google Apps
 * Script y devuelve copias defensivas para impedir que los consumidores alteren
 * accidentalmente el estado interno del repositorio.
 *
 * Responsabilidades:
 * - Leer las filas asociadas a la clave lógica USUARIOS.
 * - Convertir cada fila física a un objeto de dominio normalizado.
 * - Exponer consultas exactas por identificador, nombre y rol.
 * - Exponer proyecciones de identificadores, nombres y roles.
 * - Invalidar explícitamente la caché local cuando cambie la fuente.
 *
 * Responsabilidades excluidas:
 * - No autentica usuarios ni aplica reglas de autorización.
 * - No filtra usuarios por rol de forma implícita.
 * - No inserta, actualiza ni elimina registros.
 * - No expone directamente filas físicas ni referencias internas de la caché.
 *
 * Dependencias globales:
 * - getRowsByKey_(sourceKey).
 * - toNum_(value) y toStrUpper_(value).
 * - COL.USUARIOS.IDUSUARIOS, COL.USUARIOS.NOMBRE y COL.USUARIOS.ROL.
 *
 * Reglas de mantenimiento:
 * - NOMBRE identifica un registro utilizable y no debe estar vacío.
 * - IDUSUARIOS se normaliza como número para conservar el contrato existente.
 * - NOMBRE y ROL se normalizan en mayúsculas.
 * - Las consultas con criterios vacíos o inválidos devuelven [].
 * - Los métodos de consulta conservan duplicados para permitir su detección.
 * - Las proyecciones conservan el orden físico y los valores duplicados.
 * - La caché es local a la ejecución y no sustituye CacheService.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const UsuariosRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "USUARIOS",
    LOCALE: "es-MX",
    LOG_PREFIX: "[UsuariosRepository]"
  });

  /** @private @const {!Array<string>} */
  const REQUIRED_COLUMNS = Object.freeze([
    "IDUSUARIOS",
    "NOMBRE",
    "ROL"
  ]);

  /** @private @const {!Array<string>} */
  const PROJECTABLE_FIELDS = Object.freeze([
    "idusuario",
    "nombre",
    "rol"
  ]);

  /**
   * Caché normalizada de la ejecución actual.
   *
   * null indica que la fuente aún no se ha leído o que la caché fue invalidada.
   * Un arreglo vacío representa una lectura válida sin usuarios utilizables.
   *
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /**
   * Verifica que las dependencias funcionales requeridas estén disponibles.
   *
   * @return {void}
   * @throws {Error} Si falta alguna dependencia global.
   * @private
   */
  function _validateDependencies_() {
    const dependencyStatus = [
      ["getRowsByKey_", typeof getRowsByKey_],
      ["toNum_", typeof toNum_],
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
   * Obtiene y valida el contrato físico de columnas de USUARIOS.
   *
   * @return {!Object} Mapa validado de índices de columna.
   * @throws {Error} Si la configuración es inexistente, incompleta o ambigua.
   * @private
   */
  function _getColumns_() {
    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.USUARIOS ||
      typeof COL.USUARIOS !== "object"
    ) {
      throw new Error(`${CFG.LOG_PREFIX} No existe COL.USUARIOS.`);
    }

    const columns = COL.USUARIOS;
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
          `${CFG.LOG_PREFIX} COL.USUARIOS.${columnName} contiene el índice ` +
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

    return columns;
  }

  /**
   * Lee todas las filas físicas de la fuente configurada.
   *
   * @return {!Array<!Array<*>>} Filas obtenidas del origen.
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
   * Convierte una fila física al contrato normalizado de usuario.
   *
   * @param {!Array<*>} row Fila física obtenida de USUARIOS.
   * @param {number=} rowIndex Índice base cero utilizado para diagnóstico.
   * @return {!Object} Usuario normalizado e inmutable.
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
    return Object.freeze({
      idusuario: toNum_(row[columns.IDUSUARIOS]),
      nombre: toStrUpper_(row[columns.NOMBRE]),
      rol: toStrUpper_(row[columns.ROL])
    });
  }

  /**
   * Crea una copia independiente de una entidad almacenada en caché.
   *
   * @param {!Object} item Usuario normalizado.
   * @return {!Object} Copia defensiva para el consumidor.
   * @private
   */
  function _copyItem_(item) {
    return {
      idusuario: item.idusuario,
      nombre: item.nombre,
      rol: item.rol
    };
  }

  /**
   * Obtiene la colección normalizada y la conserva durante la ejecución actual.
   *
   * Solo se mantienen registros con NOMBRE. No se eliminan duplicados ni se
   * aplican reglas implícitas de rol.
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
        return Boolean(item.nombre);
      });

    console.log(
      `${CFG.LOG_PREFIX} Caché cargada: ${cache_.length} registro(s).`
    );

    return cache_;
  }

  /**
   * Filtra la caché y devuelve copias independientes.
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

    return _getCachedData_().filter(predicate).map(_copyItem_);
  }

  /**
   * Proyecta una propiedad pública permitida.
   *
   * @param {string} field Propiedad por proyectar.
   * @return {!Array<*>} Valores en el orden físico de la fuente.
   * @throws {Error} Si el campo solicitado no está autorizado.
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
   * Normaliza un identificador de consulta sin interpretar vacíos como cero.
   *
   * @param {*} value Identificador recibido.
   * @return {?number} Entero positivo o null cuando el criterio es inválido.
   * @private
   */
  function _normalizeIdFilter_(value) {
    if (value === null || typeof value === "undefined" || value === "") {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      return null;
    }

    return toNum_(value);
  }

  /**
   * Compara dos usuarios por nombre con orden alfanumérico natural.
   *
   * @param {!Object} left Primer usuario.
   * @param {!Object} right Segundo usuario.
   * @return {number} Resultado compatible con Array.prototype.sort().
   * @private
   */
  function _compareByName_(left, right) {
    return left.nombre.localeCompare(right.nombre, CFG.LOCALE, {
      numeric: true,
      sensitivity: "base"
    });
  }

  /**
   * Devuelve todos los usuarios válidos ordenados por nombre.
   *
   * @return {!Array<!Object>} Copias independientes ordenadas por nombre.
   */
  function getAll() {
    return _getCachedData_().map(_copyItem_).sort(_compareByName_);
  }

  /**
   * Busca usuarios por identificador numérico.
   *
   * El resultado permanece como arreglo para conservar compatibilidad y permitir
   * detectar identificadores duplicados en la fuente.
   *
   * @param {*} idusuario Identificador recibido por el consumidor.
   * @return {!Array<!Object>} Usuarios cuyo identificador coincide.
   */
  function getPorId(idusuario) {
    const filter = _normalizeIdFilter_(idusuario);
    if (filter === null) {
      return [];
    }

    return _filterAndCopy_(function (item) {
      return item.idusuario === filter;
    });
  }

  /**
   * Busca usuarios mediante coincidencia exacta de nombre normalizado.
   *
   * @param {*} nombre Nombre recibido por el consumidor.
   * @return {!Array<!Object>} Usuarios cuyo nombre coincide.
   */
  function getPorNombre(nombre) {
    const filter = toStrUpper_(nombre);
    if (!filter) {
      return [];
    }

    return _filterAndCopy_(function (item) {
      return item.nombre === filter;
    });
  }

  /**
   * Busca usuarios mediante coincidencia exacta de rol normalizado.
   *
   * Este método realiza una consulta de datos y no constituye una validación de
   * autorización. Las reglas de acceso pertenecen a la capa de seguridad.
   *
   * @param {*} rol Rol recibido por el consumidor.
   * @return {!Array<!Object>} Usuarios cuyo rol coincide.
   */
  function getPorRol(rol) {
    const filter = toStrUpper_(rol);
    if (!filter) {
      return [];
    }

    return _filterAndCopy_(function (item) {
      return item.rol === filter;
    });
  }

  /** @return {!Array<number>} Identificadores en orden físico. */
  function getIds() {
    return _getField_("idusuario");
  }

  /** @return {!Array<string>} Nombres normalizados en orden físico. */
  function getNombres() {
    return _getField_("nombre");
  }

  /** @return {!Array<string>} Roles normalizados en orden físico. */
  function getRoles() {
    return _getField_("rol");
  }

  /**
   * Invalida la caché local para que la siguiente consulta relea USUARIOS.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log(`${CFG.LOG_PREFIX} Caché invalidada.`);
  }

  return Object.freeze({
    getAll,
    getPorId,
    getPorNombre,
    getPorRol,
    getIds,
    getNombres,
    getRoles,
    clearCache
  });
})();
