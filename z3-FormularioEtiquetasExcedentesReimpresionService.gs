/**
 * FormularioEtiquetasExcedentesReimpresionService.gs
 * Servicio de dominio para la vista de reimpresión de etiquetas de excedentes
 */

const FormularioEtiquetasExcedentesReimpresionService = (() => {

  function _obtenerContextoTemporal_(ss) {
    const zonaHoraria = ss.getSpreadsheetTimeZone();
    const ahora = new Date();

    return {
      fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
      hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss")
    };
  }

  /**
   * Mapea un registro del repository al formato que espera la vista:
   * IDUNICO, CODIGO, DESCRIPCION, CANTIDAD, UBICACION
   *
   * Nota:
   * - Por ahora UBICACION sigue viniendo desde item.status
   *   porque así está hoy tu ExcedentesRepository.
   * - Ya lo normalizamos aquí con el nombre correcto para la vista.
   */
  function _mapBaseItemToView_(item) {
    return {
      IDUNICO: toStr_(item.idunico),
      CODIGO: toStrUpper_(item.codigo),
      DESCRIPCION: toStrUpper_(item.descripcion),
      CANTIDAD: toNum_(item.cantidad),
      UBICACION: toStrUpper_(item.status), // ← aquí ya sale renombrado como UBICACION
      IDPRODUCTO: toStr_(item.idproducto)
    };
  }

  function _obtenerBaseNormalizada_() {
    return ExcedentesRepository.getAll()
      .filter(x => x.idunico && x.codigo)
      .map(_mapBaseItemToView_);
  }

  function _obtenerValoresUnicos_(lista, campo) {
    return [...new Set(
      lista
        .map(x => toStr_(x[campo]))
        .filter(Boolean)
    )].sort();
  }

  function _validarListaReimpresion_(lista) {
    if (!Array.isArray(lista) || lista.length === 0) {
      throw new Error("La lista de reimpresión está vacía.");
    }

    if (!lista.every(x => x && typeof x === "object")) {
      throw new Error("La lista contiene elementos inválidos.");
    }
  }

  function _validarItemReimpresion_(item) {
    const idUnico = toStr_(item.idUnico);
    const codigo = toStrUpper_(item.codigo);
    const descripcion = toStrUpper_(item.descripcion);
    const cantidad = toNum_(item.cantidad);
    const ubicacion = toStrUpper_(item.ubicacion);

    if (!idUnico) {
      throw new Error("Uno de los elementos no tiene ID único.");
    }

    if (!codigo) {
      throw new Error(`El elemento ${idUnico} no tiene código.`);
    }

    if (!descripcion) {
      throw new Error(`El elemento ${idUnico} no tiene descripción.`);
    }

    if (cantidad <= 0) {
      throw new Error(`El elemento ${idUnico} tiene cantidad inválida.`);
    }

    return {
      idUnico,
      codigo,
      descripcion,
      cantidad,
      ubicacion
    };
  }

  /**
   * Bootstrap ligero para la vista
   */
  function getBootstrap() {
    const base = _obtenerBaseNormalizada_();

    return {
      totalRegistros: base.length,
      ids: _obtenerValoresUnicos_(base, "IDUNICO"),
      codigos: _obtenerValoresUnicos_(base, "CODIGO"),
      ubicaciones: _obtenerValoresUnicos_(base, "UBICACION")
    };
  }

  /**
   * Devuelve toda la base en el formato que la vista actual ya usa
   */
  function obtenerBase() {
    return _obtenerBaseNormalizada_();
  }

  /**
   * Genera el HTML de reimpresión usando la plantilla existente.
   * No guarda nada en BD; solo prepara impresión.
   */
  function procesarReimpresion(lista) {
    _validarListaReimpresion_(lista);

    const ss = getSpreadsheetByFileKey_(SHEETS.EXCEDENTES.file);
    const config = _obtenerContextoTemporal_(ss);

    const loteValidado = lista.map(_validarItemReimpresion_);

    const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
    tmpl.lote = loteValidado.map(item => ({
      codigo: item.codigo,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      ubicacion: item.ubicacion,
      id: item.idUnico,
      idUnico: item.idUnico
    }));

    tmpl.fechaHora = config.fecha + " " + config.hora;
    return tmpl.evaluate().getContent();
  }

  return {
    getBootstrap,
    obtenerBase,
    procesarReimpresion
  };

})();