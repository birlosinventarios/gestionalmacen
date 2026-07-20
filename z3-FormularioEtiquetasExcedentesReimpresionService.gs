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
   * Mapea el estado consolidado calculado por EstadoActualExcedentesService
   * al formato que espera la vista de reimpresión.
   */
  function _mapEstadoActualToView_(item) {
    const ubicacionActual = toStrUpper_(item.ubicacionActual || "");
    const estatusRegistro = toStrUpper_(item.estatusRegistro || "");
    const estatusLogico = toStrUpper_(item.estatusLogico || "");

    let ubicacionVisual = "";

    if (ubicacionActual) {
      ubicacionVisual = ubicacionActual;
    } else if (estatusRegistro === "DISPONIBLE") {
      ubicacionVisual = "DISPONIBLE";
    } else {
      ubicacionVisual = "SIN UBICACION";
    }

    return {
      IDUNICO: toStr_(item.idUnico),
      CODIGO: toStrUpper_(item.codigo),
      DESCRIPCION: toStrUpper_(item.descripcion),

      CANTIDAD: toNum_(item.saldoActual || item.saldoBase || 0),

      // Lo que verá la vista en la columna Ubicación.
      UBICACION: ubicacionVisual,

      // Ubicación física real calculada desde traspasos.
      ESTADOACTUALEXCEDENTES: ubicacionActual,

      // Estatus de BD-Excedentes y estatus lógico calculado.
      ESTATUS: estatusRegistro || "DISPONIBLE",
      ESTATUSLOGICO: estatusLogico,

      BODEGAACTUAL: toStrUpper_(item.bodegaActual || ""),
      IDPRODUCTO: toStr_(item.idproducto || "")
    };
  }

  /**
   * Fuente correcta para reimpresión:
   * EstadoActualExcedentesService ya calcula la ubicación actual real
   * usando TraspasosRepository + BD-Excedentes.
   */
  function _obtenerBaseNormalizada_() {
    if (
      typeof EstadoActualExcedentesService !== "undefined" &&
      typeof EstadoActualExcedentesService.getVigentes === "function"
    ) {
      return EstadoActualExcedentesService.getVigentes()
        .filter(x => x && x.idUnico && x.codigo)
        .map(_mapEstadoActualToView_);
    }

    // Fallback defensivo si por alguna razón no existe el servicio consolidado.
    return ExcedentesRepository.getAll()
      .filter(x => x.idunico && x.codigo)
      .map(function (item) {
        const estatus = toStrUpper_(item.status || "");

        return {
          IDUNICO: toStr_(item.idunico),
          CODIGO: toStrUpper_(item.codigo),
          DESCRIPCION: toStrUpper_(item.descripcion),
          CANTIDAD: toNum_(item.cantidad),
          UBICACION: estatus === "DISPONIBLE" ? "DISPONIBLE" : "SIN UBICACION",
          ESTADOACTUALEXCEDENTES: "",
          ESTATUS: estatus || "DISPONIBLE",
          ESTATUSLOGICO: "",
          BODEGAACTUAL: "",
          IDPRODUCTO: toStr_(item.idproducto)
        };
      });
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

  function getBootstrap() {
    const base = _obtenerBaseNormalizada_();

    return {
      totalRegistros: base.length,
      ids: _obtenerValoresUnicos_(base, "IDUNICO"),
      codigos: _obtenerValoresUnicos_(base, "CODIGO"),
      ubicaciones: _obtenerValoresUnicos_(base, "UBICACION")
    };
  }

  function obtenerBase() {
    return _obtenerBaseNormalizada_();
  }

  function _prepararHtmlOnline_(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "");
  }

  function _renderEtiquetaExcedentesReimpresion_(loteValidado, fechaHora, modoImpresion) {
    const tmpl = HtmlService.createTemplateFromFile("EtiquetaExcedentesImpresa");

    tmpl.lote = loteValidado.map(item => ({
      codigo: item.codigo,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      ubicacion: item.ubicacion,
      id: item.idUnico,
      idUnico: item.idUnico
    }));

    tmpl.fechaHora = fechaHora;
    tmpl.modoImpresion = modoImpresion || "LOCAL";

    return tmpl.evaluate().getContent();
  }

  function procesarReimpresion(lista) {
    _validarListaReimpresion_(lista);

    const ss = getSpreadsheetByFileKey_(SHEETS.EXCEDENTES.file);
    const config = _obtenerContextoTemporal_(ss);

    const fechaHora = config.fecha + " " + config.hora;
    const loteValidado = lista.map(_validarItemReimpresion_);

    const htmlImpresion = _renderEtiquetaExcedentesReimpresion_(
      loteValidado,
      fechaHora,
      "LOCAL"
    );

    const htmlOnline = _prepararHtmlOnline_(
      _renderEtiquetaExcedentesReimpresion_(
        loteValidado,
        fechaHora,
        "ONLINE"
      )
    );

    const printJob = {
      tipo: "REIMPRESION_ETIQUETAS_EXCEDENTES",
      origen: "FormularioEtiquetasExcedentesReimpresion",
      formato: "HTML",
      html: htmlOnline,
      content: htmlOnline,
      meta: {
        modulo: "FormularioEtiquetasExcedentesReimpresion",
        total: loteValidado.length,
        fechaHora: fechaHora,
        etiqueta: "EXCEDENTES_REIMPRESION",
        formatoEtiqueta: "HTML",
        papel: "150x100mm"
      }
    };

    return {
      ok: true,
      modoCompatible: ["LOCAL", "ONLINE"],
      htmlImpresion: htmlImpresion,
      printJob: printJob,
      total: loteValidado.length
    };
  }

  return {
    getBootstrap,
    obtenerBase,
    procesarReimpresion
  };

})();