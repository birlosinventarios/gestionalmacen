/**
 * z0-ImpresionPrintJobBuilder.gs
 *
 * Constructor de trabajos de impresión ONLINE compatibles con el endpoint
 * del puente de impresión que recibe el contrato /print { content }.
 *
 * Responsabilidades:
 * - Validar y normalizar los lotes imprimibles.
 * - Construir contenido de texto para etiquetas de excedentes.
 * - Construir contenido de texto para etiquetas identificadoras.
 * - Mantener una anchura lógica uniforme para impresoras térmicas.
 * - Incorporar metadatos sin modificar el objeto recibido.
 * - Entregar un contrato printJob estable a ImpresionPuenteService.
 *
 * Contrato de salida:
 * {
 *   tipo: string,
 *   origen: "APPALMACEN",
 *   content: string,
 *   meta: Object
 * }
 *
 * Dependencias:
 * - No requiere servicios externos ni APIs de Google Apps Script.
 *
 * Invariantes:
 * - La anchura lógica de cada separador permanece en 48 caracteres.
 * - El origen de todos los trabajos permanece como APPALMACEN.
 * - Los lotes vacíos producen un error descriptivo.
 * - Los valores nulos se convierten en cadenas seguras.
 * - Código y descripción se limitan a 40 caracteres.
 * - Cada etiqueta termina con espacio suficiente para avance y corte físico.
 *
 * API pública:
 * - ImpresionPrintJobBuilder.buildExcedentesJob(lote, fechaHora, meta).
 * - ImpresionPrintJobBuilder.buildIdentificadorasJob(lote, fechaHora, meta).
 */
const ImpresionPrintJobBuilder = (() => {
  /** Anchura lógica utilizada para separadores y contenido térmico. */
  const LINE_WIDTH = 48;

  /** Longitud máxima visible para código y descripción. */
  const TEXT_FIELD_MAX_LENGTH = 40;

  /** Origen común de los trabajos construidos por este módulo. */
  const JOB_ORIGIN = "APPALMACEN";

  /** Avance final utilizado entre etiquetas consecutivas. */
  const LABEL_TRAILING_FEED = "\n\n\n\n";

  /**
   * Convierte un valor a texto sin producir las cadenas "null" o "undefined".
   *
   * @param {*} value Valor recibido.
   * @return {string} Texto normalizado.
   * @private
   */
  function toSafeString_(value) {
    return String(value == null ? "" : value);
  }

  /**
   * Construye una línea repetida con longitud controlada.
   *
   * @param {*} character Carácter utilizado para la línea.
   * @param {number=} length Longitud solicitada.
   * @return {string} Línea construida.
   * @private
   */
  function createLine_(character, length) {
    const finalCharacter = toSafeString_(character) || "-";
    const requestedLength = Number(length);
    const finalLength =
      Number.isInteger(requestedLength) && requestedLength > 0
        ? requestedLength
        : LINE_WIDTH;

    return finalCharacter.charAt(0).repeat(finalLength);
  }

  /**
   * Limita un texto a la longitud máxima solicitada.
   *
   * @param {*} value Valor recibido.
   * @param {number} maxLength Longitud máxima.
   * @return {string} Texto completo o truncado.
   * @private
   */
  function truncateText_(value, maxLength) {
    const text = toSafeString_(value);
    const limit = Number(maxLength);

    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error("La longitud máxima debe ser un entero no negativo.");
    }

    return text.length > limit
      ? text.slice(0, limit)
      : text;
  }

  /**
   * Valida y devuelve una copia superficial del lote recibido.
   *
   * @param {*} batch Lote solicitado.
   * @param {string} emptyMessage Mensaje para un lote vacío.
   * @return {Array<Object>} Copia del lote válido.
   * @throws {Error} Si el lote no contiene elementos.
   * @private
   */
  function normalizeBatch_(batch, emptyMessage) {
    const items = Array.isArray(batch)
      ? batch.slice()
      : [];

    if (items.length === 0) {
      throw new Error(emptyMessage);
    }

    return items;
  }

  /**
   * Normaliza los metadatos sin compartir la referencia del objeto original.
   *
   * @param {*} metadata Metadatos recibidos.
   * @return {Object} Copia superficial o objeto vacío.
   * @private
   */
  function normalizeMetadata_(metadata) {
    return metadata && typeof metadata === "object"
      ? Object.assign({}, metadata)
      : {};
  }

  /**
   * Construye la cabecera común de una etiqueta térmica.
   *
   * @param {string} labelTitle Título específico de la etiqueta.
   * @param {number} index Índice base cero.
   * @param {number} total Total de etiquetas.
   * @param {*} dateTime Fecha y hora visibles.
   * @return {Array<string>} Líneas de la cabecera.
   * @private
   */
  function buildHeaderLines_(labelTitle, index, total, dateTime) {
    return [
      createLine_("=", LINE_WIDTH),
      "        BIRLOS Y TORNILLOS",
      labelTitle,
      createLine_("=", LINE_WIDTH),
      "ETQ: " + (index + 1) + " / " + total,
      "FECHA: " + toSafeString_(dateTime),
      createLine_("-", LINE_WIDTH)
    ];
  }

  /**
   * Convierte un arreglo de líneas en un bloque imprimible con avance final.
   *
   * @param {Array<string>} lines Líneas de la etiqueta.
   * @return {string} Contenido térmico de una etiqueta.
   * @private
   */
  function finalizeLabel_(lines) {
    return lines.join("\n") + "\n" + LABEL_TRAILING_FEED;
  }

  /**
   * Construye un trabajo ONLINE para etiquetas de excedentes.
   *
   * Cada elemento puede proporcionar:
   * - codigo
   * - descripcion
   * - cantidad
   * - idUnico o id
   * - ubicacion, opcional
   *
   * @param {Array<Object>} lote Etiquetas por imprimir.
   * @param {*} fechaHora Fecha y hora visibles.
   * @param {Object=} meta Metadatos del trabajo.
   * @return {{tipo:string,origen:string,content:string,meta:Object}}
   * @throws {Error} Si el lote está vacío.
   */
  function buildExcedentesJob(lote, fechaHora, meta) {
    const items = normalizeBatch_(
      lote,
      "No hay etiquetas de excedentes para imprimir ONLINE."
    );

    const content = items
      .map((item, index) => {
        const safeItem = item && typeof item === "object"
          ? item
          : {};
        const lines = buildHeaderLines_(
          "          ETIQUETA EXCEDENTE",
          index,
          items.length,
          fechaHora
        );

        lines.push(
          "SKU:  " + truncateText_(safeItem.codigo, TEXT_FIELD_MAX_LENGTH),
          "DESC: " + truncateText_(safeItem.descripcion, TEXT_FIELD_MAX_LENGTH),
          "CANT: " + toSafeString_(safeItem.cantidad || 0) + " PZAS",
          "ID:   " + toSafeString_(safeItem.idUnico || safeItem.id || "")
        );

        if (safeItem.ubicacion) {
          lines.push("UBI:  " + toSafeString_(safeItem.ubicacion));
        }

        lines.push(createLine_("=", LINE_WIDTH));
        return finalizeLabel_(lines);
      })
      .join("");

    return {
      tipo: "EXCEDENTES",
      origen: JOB_ORIGIN,
      content: content,
      meta: normalizeMetadata_(meta)
    };
  }

  /**
   * Construye un trabajo ONLINE para etiquetas identificadoras.
   *
   * Cada elemento puede proporcionar:
   * - codigo
   * - descripcion
   * - id o idproducto
   * - tipo
   *
   * @param {Array<Object>} lote Etiquetas por imprimir.
   * @param {*} fechaHora Fecha y hora visibles.
   * @param {Object=} meta Metadatos del trabajo.
   * @return {{tipo:string,origen:string,content:string,meta:Object}}
   * @throws {Error} Si el lote está vacío.
   */
  function buildIdentificadorasJob(lote, fechaHora, meta) {
    const items = normalizeBatch_(
      lote,
      "No hay etiquetas identificadoras para imprimir ONLINE."
    );

    const content = items
      .map((item, index) => {
        const safeItem = item && typeof item === "object"
          ? item
          : {};
        const lines = buildHeaderLines_(
          "       ETIQUETA IDENTIFICADORA",
          index,
          items.length,
          fechaHora
        );

        lines.push(
          "SKU:  " + truncateText_(safeItem.codigo, TEXT_FIELD_MAX_LENGTH),
          "DESC: " + truncateText_(safeItem.descripcion, TEXT_FIELD_MAX_LENGTH),
          "ID:   " + toSafeString_(safeItem.id || safeItem.idproducto || ""),
          "TIPO: " + toSafeString_(safeItem.tipo || ""),
          createLine_("=", LINE_WIDTH)
        );

        return finalizeLabel_(lines);
      })
      .join("");

    return {
      tipo: "IDENTIFICADORAS",
      origen: JOB_ORIGIN,
      content: content,
      meta: normalizeMetadata_(meta)
    };
  }

  return Object.freeze({
    buildExcedentesJob,
    buildIdentificadorasJob
  });
})();
