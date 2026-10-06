/**
 * UbicacionesExcedentesRepository.gs
 *
 * Repositorio de solo lectura para la fuente lógica UBICACIONES_EXCEDENTES.
 *
 * Responsabilidades:
 * - Leer y normalizar identificadores, bodegas y ubicaciones de excedentes.
 * - Mantener una caché local durante la ejecución actual de Apps Script.
 * - Exponer búsquedas por bodega, ubicación canónica e identificador escaneable.
 * - Proporcionar colecciones únicas y ordenadas de bodegas, ubicaciones e
 *   identificadores.
 * - Conservar los alias requeridos por servicios genéricos existentes.
 *
 * Reglas de normalización:
 * - Los identificadores se conservan como texto, nunca como números.
 * - Los valores visibles se normalizan en mayúsculas.
 * - Las claves de identificador y ubicación eliminan espacios para permitir
 *   comparaciones canónicas.
 * - La clave de bodega conserva espacios internos y elimina espacios externos.
 * - Los registros sin ubicación se excluyen de la colección cacheada.
 * - El repositorio no elimina registros duplicados de getAll(); solo deduplica
 *   las proyecciones públicas de bodegas, ubicaciones e identificadores.
 *
 * Dependencias globales:
 * - getRowsByKey_(sheetKey)
 * - toStrUpper_(value)
 * - COL.UBICACIONES_EXCEDENTES.IDUBICACIONES_EXCEDENTES
 * - COL.UBICACIONES_EXCEDENTES.BODEGA
 * - COL.UBICACIONES_EXCEDENTES.UBICACION
 *
 * API pública:
 * - getAll()
 * - getPorBodega(bodega)
 * - getPorUbicacion(ubicacion)
 * - getOnePorUbicacion(ubicacion)
 * - getByIdentificador(identificador)
 * - getById(identificador)
 * - getBodegas()
 * - getUbicaciones()
 * - getIdentificadores()
 * - clearCache()
 */
const UbicacionesExcedentesRepository = (() => {
  "use strict";

  /** @const {string} Clave lógica de la fuente de ubicaciones. */
  const SOURCE_KEY = "UBICACIONES_EXCEDENTES";

  /**
   * Caché normalizada de la ejecución actual.
   *
   * null significa que la fuente no se ha leído o que la caché fue invalidada.
   * Un arreglo vacío representa una lectura válida sin ubicaciones.
   *
   * @type {Array<Object>|null}
   */
  let cache_ = null;

  /**
   * Lee todas las filas físicas de UBICACIONES_EXCEDENTES.
   *
   * @return {Array<Array<*>>} Filas entregadas por la utilidad de datos.
   * @private
   */
  function readSource_() {
    return getRowsByKey_(SOURCE_KEY);
  }

  /**
   * Construye una clave canónica para identificadores y ubicaciones.
   *
   * La clave se normaliza en mayúsculas y elimina todos los espacios. Esto
   * permite comparar valores como "B1-01" y "B1 - 01" sin modificar el valor
   * visible almacenado en el objeto normalizado.
   *
   * @param {*} value Valor de entrada.
   * @return {string} Clave canónica sin espacios.
   * @private
   */
  function toKey_(value) {
    return toStrUpper_(value || "")
      .replace(/\s+/g, "")
      .trim();
  }

  /**
   * Convierte una fila física al contrato del repositorio.
   *
   * @param {Array<*>} fila Fila de UBICACIONES_EXCEDENTES.
   * @return {{
   *   idubicacionesexcedentes:string,
   *   identificador:string,
   *   bodega:string,
   *   ubicacion:string,
   *   _keyIdentificador:string,
   *   _keyUbicacion:string,
   *   _keyBodega:string
   * }} Registro normalizado.
   * @private
   */
  function normalize_(fila) {
    const identificadorRaw =
      fila[COL.UBICACIONES_EXCEDENTES.IDUBICACIONES_EXCEDENTES] || "";
    const bodegaRaw =
      fila[COL.UBICACIONES_EXCEDENTES.BODEGA] || "";
    const ubicacionRaw =
      fila[COL.UBICACIONES_EXCEDENTES.UBICACION] || "";

    const identificador = toStrUpper_(identificadorRaw);
    const bodega = toStrUpper_(bodegaRaw);
    const ubicacion = toStrUpper_(ubicacionRaw);

    return {
      // El identificador se conserva como texto para no perder formato.
      idubicacionesexcedentes: identificador,
      identificador,
      bodega,
      ubicacion,

      // Claves auxiliares utilizadas en búsquedas canónicas.
      _keyIdentificador: toKey_(identificador),
      _keyUbicacion: toKey_(ubicacion),
      _keyBodega: toStrUpper_(bodega).trim()
    };
  }

  /**
   * Obtiene la colección normalizada desde caché o la construye en la primera
   * consulta de la ejecución actual.
   *
   * @return {Array<Object>} Colección interna cacheada.
   * @private
   */
  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(registro => registro.ubicacion);

      console.log(
        "[CACHE] Ubicaciones de excedentes cargadas:",
        cache_.length
      );
    }

    return cache_;
  }

  /**
   * Proyecta un campo de todos los registros normalizados.
   *
   * @param {string} field Propiedad por proyectar.
   * @return {Array<*>} Valores del campo solicitado.
   * @private
   */
  function getField_(field) {
    return getData_().map(registro => registro[field]);
  }

  /**
   * Elimina duplicados conservando la primera aparición de cada clave.
   *
   * Las claves vacías también se procesan de forma determinista. Los métodos
   * públicos filtran valores vacíos antes de invocar este helper.
   *
   * @param {Array<*>} items Colección de entrada.
   * @param {Function} keySelector Función que devuelve la clave de unicidad.
   * @return {Array<*>} Elementos únicos en orden de primera aparición.
   * @private
   */
  function uniqueBy_(items, keySelector) {
    const seen = new Set();
    const uniqueItems = [];

    (items || []).forEach(item => {
      const key = keySelector(item);

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      uniqueItems.push(item);
    });

    return uniqueItems;
  }

  /**
   * Ordena textos usando reglas regionales y comparación numérica natural.
   *
   * @param {string} a Primer valor.
   * @param {string} b Segundo valor.
   * @return {number}
   * @private
   */
  function compareText_(a, b) {
    return a.localeCompare(b, "es", {
      sensitivity: "base",
      numeric: true
    });
  }

  /**
   * Devuelve todas las ubicaciones ordenadas por su valor canónico visible.
   *
   * Se crea una copia antes de ordenar para no modificar la caché interna.
   *
   * @return {Array<Object>} Registros normalizados.
   */
  function getAll() {
    return [...getData_()].sort((a, b) =>
      compareText_(a.ubicacion, b.ubicacion)
    );
  }

  /**
   * Busca todos los registros correspondientes a una bodega.
   *
   * @param {*} bodega Nombre de bodega solicitado.
   * @return {Array<Object>} Coincidencias exactas normalizadas.
   */
  function getPorBodega(bodega) {
    const filtro = toStrUpper_(bodega || "").trim();
    return getData_().filter(registro => registro.bodega === filtro);
  }

  /**
   * Busca registros por ubicación canónica.
   *
   * @param {*} ubicacion Ubicación solicitada, por ejemplo B1-01.
   * @return {Array<Object>} Coincidencias por clave canónica.
   */
  function getPorUbicacion(ubicacion) {
    const filtro = toKey_(ubicacion || "");
    return getData_().filter(
      registro => registro._keyUbicacion === filtro
    );
  }

  /**
   * Devuelve la primera coincidencia de una ubicación canónica.
   *
   * Este método conserva el contrato existente y no arroja error si existen
   * duplicados. Para detectarlos debe utilizarse getPorUbicacion().
   *
   * @param {*} ubicacion Ubicación solicitada.
   * @return {Object|null} Primera coincidencia o null.
   */
  function getOnePorUbicacion(ubicacion) {
    const filtro = toKey_(ubicacion || "");
    return getData_().find(
      registro => registro._keyUbicacion === filtro
    ) || null;
  }

  /**
   * Devuelve el registro asociado a un identificador escaneable.
   *
   * @param {*} identificador Identificador solicitado, por ejemplo B1B101.
   * @return {Object|null} Primera coincidencia o null.
   */
  function getByIdentificador(identificador) {
    const filtro = toKey_(identificador || "");
    return getData_().find(
      registro => registro._keyIdentificador === filtro
    ) || null;
  }

  /**
   * Alias de compatibilidad para consumidores genéricos.
   *
   * @param {*} identificador Identificador solicitado.
   * @return {Object|null}
   */
  function getById(identificador) {
    return getByIdentificador(identificador);
  }

  /**
   * Devuelve las bodegas únicas y ordenadas.
   *
   * @return {Array<string>}
   */
  function getBodegas() {
    return uniqueBy_(
      getField_("bodega").filter(Boolean),
      value => toStrUpper_(value)
    ).sort(compareText_);
  }

  /**
   * Devuelve las ubicaciones canónicas únicas y ordenadas.
   *
   * @return {Array<string>}
   */
  function getUbicaciones() {
    return uniqueBy_(
      getField_("ubicacion").filter(Boolean),
      value => toKey_(value)
    ).sort(compareText_);
  }

  /**
   * Devuelve los identificadores escaneables únicos y ordenados.
   *
   * @return {Array<string>}
   */
  function getIdentificadores() {
    return uniqueBy_(
      getField_("identificador").filter(Boolean),
      value => toKey_(value)
    ).sort(compareText_);
  }

  /**
   * Invalida la caché local para que la siguiente consulta relea la fuente.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log("[CACHE] Ubicaciones de excedentes limpias");
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
