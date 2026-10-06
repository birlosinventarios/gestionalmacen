/**
 * CatalogoRepository.gs
 *
 * Repositorio de solo lectura para la hoja lógica CATALOGO.
 *
 * Responsabilidades:
 * - Leer los registros físicos desde la fuente configurada como CATALOGO.
 * - Normalizar identificadores, códigos, descripciones y estados.
 * - Mantener una caché en memoria durante la ejecución actual.
 * - Exponer consultas por código, IDPRODUCTO, descripción y estado.
 * - Proporcionar proyecciones simples para códigos, descripciones,
 *   identificadores y estados.
 * - Permitir la invalidación explícita de la caché local.
 *
 * Invariantes:
 * - El repositorio no inserta, actualiza ni elimina productos.
 * - Los registros sin código se excluyen de la colección normalizada.
 * - Los textos de código, descripción y estado se normalizan en mayúsculas.
 * - IDPRODUCTO conserva el contrato textual utilizado por los consumidores.
 * - No se eliminan duplicados de forma implícita.
 *
 * Dependencias globales:
 * - getRowsByKey_(sheetKey)
 * - toStr_(value)
 * - toStrUpper_(value)
 * - COL.CATALOGO.IDPRODUCTO
 * - COL.CATALOGO.CODIGO
 * - COL.CATALOGO.DESCRIPCION
 * - COL.CATALOGO.STATUS
 *
 * API pública:
 * - getAll()
 * - getAllRaw()
 * - getCodigos()
 * - getDescripciones()
 * - getIdProductos()
 * - getStatus()
 * - getPorCodigo(codigo)
 * - getPorIdProducto(idproducto)
 * - getPorDescripcion(descripcion)
 * - getPorStatus(status)
 * - clearCache()
 */
const CatalogoRepository = (() => {
  "use strict";

  /** @const {string} Clave lógica de la fuente de catálogo. */
  const SOURCE_KEY = "CATALOGO";

  /**
   * Caché normalizada de la ejecución actual.
   *
   * null indica que la fuente todavía no se ha leído o que la caché fue
   * invalidada. Un arreglo vacío representa una lectura válida sin productos.
   *
   * @type {Array<Object>|null}
   */
  let cache_ = null;

  /**
   * Lee todas las filas físicas de la fuente CATALOGO.
   *
   * @return {Array<Array<*>>} Filas obtenidas por la utilidad de datos.
   * @private
   */
  function readSource_() {
    return getRowsByKey_(SOURCE_KEY);
  }

  /**
   * Convierte una fila física al contrato normalizado del repositorio.
   *
   * @param {Array<*>} fila Fila física de CATALOGO.
   * @return {{
   *   idproducto:string,
   *   codigo:string,
   *   descripcion:string,
   *   status:string
   * }} Producto normalizado.
   * @private
   */
  function normalize_(fila) {
    return {
      idproducto: toStr_(fila[COL.CATALOGO.IDPRODUCTO]),
      codigo: toStrUpper_(fila[COL.CATALOGO.CODIGO]),
      descripcion: toStrUpper_(fila[COL.CATALOGO.DESCRIPCION]),
      status: toStrUpper_(fila[COL.CATALOGO.STATUS])
    };
  }

  /**
   * Obtiene el catálogo normalizado desde caché o lo construye en la primera
   * lectura de la ejecución actual.
   *
   * Solo se conservan registros con código. La colección interna no se ordena
   * para preservar el orden físico usado por getAllRaw().
   *
   * @return {Array<Object>} Colección interna almacenada en caché.
   * @private
   */
  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(producto => producto.codigo);

      console.log("[CACHE] Catalogo cargado");
    }

    return cache_;
  }

  /**
   * Proyecta un campo de todos los productos normalizados.
   *
   * Array.prototype.map() entrega una colección nueva y evita exponer el
   * arreglo interno de la caché.
   *
   * @param {string} field Propiedad por proyectar.
   * @return {Array<*>} Valores del campo solicitado.
   * @private
   */
  function getField_(field) {
    return getData_().map(producto => producto[field]);
  }

  /**
   * Devuelve todos los productos ordenados alfabéticamente por código.
   *
   * Se crea una copia antes de ordenar para no modificar la caché interna.
   *
   * @return {Array<Object>} Copia ordenada del catálogo.
   */
  function getAll() {
    return [...getData_()].sort((a, b) =>
      a.codigo.localeCompare(b.codigo)
    );
  }

  /**
   * Devuelve una copia superficial del catálogo en su orden normalizado.
   *
   * @return {Array<Object>}
   */
  function getAllRaw() {
    return [...getData_()];
  }

  /** @return {Array<string>} Códigos normalizados del catálogo. */
  function getCodigos() {
    return getField_("codigo");
  }

  /** @return {Array<string>} Descripciones normalizadas del catálogo. */
  function getDescripciones() {
    return getField_("descripcion");
  }

  /** @return {Array<string>} Identificadores de producto del catálogo. */
  function getIdProductos() {
    return getField_("idproducto");
  }

  /** @return {Array<string>} Estados normalizados del catálogo. */
  function getStatus() {
    return getField_("status");
  }

  /**
   * Busca productos por código normalizado.
   *
   * El retorno permanece como arreglo para conservar compatibilidad y hacer
   * visibles posibles códigos duplicados.
   *
   * @param {*} codigo Código solicitado.
   * @return {Array<Object>} Coincidencias exactas por código.
   */
  function getPorCodigo(codigo) {
    const filtro = toStrUpper_(codigo);
    return getData_().filter(producto => producto.codigo === filtro);
  }

  /**
   * Busca productos por IDPRODUCTO textual.
   *
   * @param {*} idproducto Identificador solicitado.
   * @return {Array<Object>} Coincidencias exactas por identificador.
   */
  function getPorIdProducto(idproducto) {
    const filtro = toStr_(idproducto);
    return getData_().filter(producto => producto.idproducto === filtro);
  }

  /**
   * Busca productos por descripción normalizada.
   *
   * @param {*} descripcion Descripción solicitada.
   * @return {Array<Object>} Coincidencias exactas por descripción.
   */
  function getPorDescripcion(descripcion) {
    const filtro = toStrUpper_(descripcion);
    return getData_().filter(producto => producto.descripcion === filtro);
  }

  /**
   * Busca productos por estado.
   *
   * Se conserva toStr_() para mantener exactamente el contrato original de
   * esta consulta. Los estados almacenados ya fueron normalizados al leer.
   *
   * @param {*} status Estado solicitado.
   * @return {Array<Object>} Coincidencias exactas por estado.
   */
  function getPorStatus(status) {
    const filtro = toStr_(status);
    return getData_().filter(producto => producto.status === filtro);
  }

  /**
   * Invalida la caché local para que la siguiente consulta relea CATALOGO.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log("[CACHE] Catalogo limpio");
  }

  return Object.freeze({
    getAll,
    getAllRaw,
    getCodigos,
    getDescripciones,
    getIdProductos,
    getStatus,
    getPorCodigo,
    getPorIdProducto,
    getPorDescripcion,
    getPorStatus,
    clearCache
  });
})();
