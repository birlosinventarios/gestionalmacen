/**
 * FormularioEtiquetasExcedentesService.gs
 * Servicio de dominio para la vista FormularioEtiquetasExcedentes
 */

const FormularioEtiquetasExcedentesService = (() => {

  const DOMAIN = Object.freeze({
    STATUS_INICIAL: "DISPONIBLE"
  });

  function _obtenerContextoTemporal_(ss) {
    const zonaHoraria = ss.getSpreadsheetTimeZone();
    const ahora = new Date();

    return {
      fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
      hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss")
    };
  }

  function _buildCodigos_() {
    const datos = CatalogoRepository.getCodigos()
      .map(x => toStrUpper_(x))
      .filter(Boolean);

    return [...new Set(datos)].sort();
  }

  function _buildMapaCatalogo_() {
    return CatalogoRepository.getAll().reduce((acc, item) => {
      const codigo = toStrUpper_(item.codigo);
      if (!codigo) return acc;

      acc[codigo] = {
        idproducto: toStr_(item.idproducto),
        codigo: codigo,
        descripcion: toStrUpper_(item.descripcion),
        status: toStrUpper_(item.status)
      };

      return acc;
    }, {});
  }

  function _validarCodigo_(codigo, mapaCatalogo) {
    const cod = toStrUpper_(codigo);

    if (!cod) {
      throw new Error("El código es obligatorio.");
    }

    const producto = mapaCatalogo[cod];

    if (!producto) {
      throw new Error(`El código "${cod}" no existe en el catálogo.`);
    }

    return {
      codigo: cod,
      producto: producto
    };
  }

  function _validarCantidad_(cantidad, codigo) {
    const valor = toNum_(cantidad);

    if (valor <= 0) {
      throw new Error(`La cantidad del código "${codigo}" debe ser mayor a cero.`);
    }

    return valor;
  }

  function _validarIdUnico_(idUnico, codigo) {
    const valor = toStr_(idUnico);

    if (!valor) {
      throw new Error(`La etiqueta del código "${codigo}" no tiene idUnico.`);
    }

    return valor;
  }

  function _mapExcedenteToRow_(item, config, mapaCatalogo) {
    const { codigo, producto } = _validarCodigo_(item.codigo, mapaCatalogo);

    const descripcion = toStrUpper_(item.descripcion || producto.descripcion);
    const idproducto = toStr_(item.id || producto.idproducto);
    const cantidad = _validarCantidad_(item.cantidad, codigo);
    const idUnico = _validarIdUnico_(item.idUnico, codigo);

    if (!descripcion) {
      throw new Error(`El código "${codigo}" no tiene descripción.`);
    }

    if (!idproducto) {
      throw new Error(`El código "${codigo}" no tiene ID producto.`);
    }

    return [
      idUnico,
      config.fecha,
      config.hora,
      idproducto,
      codigo,
      descripcion,
      cantidad,
      DOMAIN.STATUS_INICIAL
    ];
  }

  function _mapPrintItem_(item, mapaCatalogo) {
    const { codigo, producto } = _validarCodigo_(item.codigo, mapaCatalogo);

    return {
      codigo: codigo,
      descripcion: toStrUpper_(item.descripcion || producto.descripcion),
      cantidad: _validarCantidad_(item.cantidad, codigo),
      id: toStr_(item.id || producto.idproducto),
      idUnico: _validarIdUnico_(item.idUnico, codigo),
      cajaNo: toNum_(item.cajaNo),
      totalCajas: toNum_(item.totalCajas)
    };
  }

  function _prepararHtmlOnline_(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "");
  }

  function _renderEtiquetaExcedentes_(loteImpresion, fechaHora, modoImpresion) {
    const tmpl = HtmlService.createTemplateFromFile("EtiquetaExcedentesImpresa");

    tmpl.lote = loteImpresion;
    tmpl.fechaHora = fechaHora;
    tmpl.modoImpresion = modoImpresion || "LOCAL";

    return tmpl.evaluate().getContent();
  }

  function getBootstrap() {
    return {
      codigos: _buildCodigos_(),
      mapaCatalogo: _buildMapaCatalogo_()
    };
  }

  function buscarProductoPorCodigo(codigo) {
    const cod = toStrUpper_(codigo);

    if (!cod) {
      return {
        encontrado: false
      };
    }

    const producto = CatalogoRepository.getPorCodigo(cod)[0];

    if (!producto) {
      return {
        encontrado: false
      };
    }

    return {
      encontrado: true,
      codigo: cod,
      id: toStr_(producto.idproducto),
      idproducto: toStr_(producto.idproducto),
      descripcion: toStrUpper_(producto.descripcion),
      status: toStrUpper_(producto.status)
    };
  }

  function procesarLote(lote) {
    if (!Array.isArray(lote) || lote.length === 0) {
      throw new Error("El lote de etiquetas de excedentes está vacío.");
    }

    if (!lote.every(x => x && typeof x === "object")) {
      throw new Error("El lote contiene elementos inválidos.");
    }

    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      lock.waitLock(30000);
      locked = true;

      const ss = getSpreadsheetByFileKey_(SHEETS.EXCEDENTES.file);
      const hoja = getSheetByKey_("EXCEDENTES");
      const config = _obtenerContextoTemporal_(ss);
      const mapaCatalogo = _buildMapaCatalogo_();

      const fechaHora = config.fecha + " " + config.hora;

      const rows = lote.map(item => _mapExcedenteToRow_(item, config, mapaCatalogo));

      const startRow = hoja.getLastRow() + 1;
      hoja.getRange(startRow, 1, rows.length, 8).setValues(rows);

      SpreadsheetApp.flush();

      if (typeof ExcedentesRepository !== "undefined" && ExcedentesRepository.clearCache) {
        ExcedentesRepository.clearCache();
      }

      const loteImpresion = lote.map(item => _mapPrintItem_(item, mapaCatalogo));

      const htmlImpresion = _renderEtiquetaExcedentes_(
        loteImpresion,
        fechaHora,
        "LOCAL"
      );

      const htmlOnline = _prepararHtmlOnline_(
        _renderEtiquetaExcedentes_(
          loteImpresion,
          fechaHora,
          "ONLINE"
        )
      );

      const printJob = {
        tipo: "ETIQUETAS_EXCEDENTES",
        origen: "FormularioEtiquetasExcedentes",
        formato: "HTML",
        html: htmlOnline,
        content: htmlOnline,
        meta: {
          modulo: "FormularioEtiquetasExcedentes",
          total: loteImpresion.length,
          fechaHora: fechaHora,
          etiqueta: "EXCEDENTES",
          formatoEtiqueta: "HTML",
          papel: "100x155mm"
        }
      };

      return {
        ok: true,
        modoCompatible: ["LOCAL", "ONLINE"],
        htmlImpresion: htmlImpresion,
        printJob: printJob,
        total: loteImpresion.length
      };

    } catch (error) {
      throw new Error("No se pudo procesar el lote de etiquetas de excedentes: " + error.message);
    } finally {
      if (locked) {
        lock.releaseLock();
      }
    }
  }

  return {
    getBootstrap,
    buscarProductoPorCodigo,
    procesarLote
  };

})();