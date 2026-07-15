/**
 * FormularioEtiquetasIdentificadorasService.gs
 * Servicio de dominio para la vista FormularioEtiquetasIdentificadoras
 */

const FormularioEtiquetasIdentificadorasService = (() => {

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

  function _buildMapaMedidas_() {
    return EtiquetasRepository.getAll().reduce((acc, item) => {
      const nombre = toStrUpper_(item.nombre);
      if (!nombre) return acc;

      acc[nombre] = {
        ancho: toNum_(item.ancho),
        alto: toNum_(item.alto)
      };

      return acc;
    }, {});
  }

  function _buildNombresEtiquetas_() {
    return EtiquetasRepository.getAll()
      .map(x => toStrUpper_(x.nombre))
      .filter(Boolean)
      .filter((x, i, arr) => arr.indexOf(x) === i)
      .sort();
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

  function _validarTipoEtiqueta_(tipo, mapaMedidas) {
    const valor = toStrUpper_(tipo);

    if (!valor) {
      throw new Error("El tipo de etiqueta es obligatorio.");
    }

    const medida = mapaMedidas[valor];

    if (!medida) {
      throw new Error(`El tipo de etiqueta "${valor}" no existe.`);
    }

    return {
      tipo: valor,
      medida: medida
    };
  }

  function _prepararHtmlOnline_(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "");
  }

  function _renderEtiquetaIdentificadora_(loteNormalizado, fechaHora, modoImpresion) {
    const tmpl = HtmlService.createTemplateFromFile("EtiquetaIdentificadoraImpresa");

    tmpl.lote = loteNormalizado;
    tmpl.fechaHora = fechaHora;
    tmpl.modoImpresion = modoImpresion || "LOCAL";

    return tmpl.evaluate().getContent();
  }

  function getBootstrap() {
    return {
      codigos: _buildCodigos_(),
      mapaCatalogo: _buildMapaCatalogo_(),
      mapaMedidas: _buildMapaMedidas_(),
      nombresEtiquetas: _buildNombresEtiquetas_()
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
      idproducto: toStr_(producto.idproducto),
      descripcion: toStrUpper_(producto.descripcion),
      status: toStrUpper_(producto.status)
    };
  }

  function procesarLote(lote) {
    if (!Array.isArray(lote) || lote.length === 0) {
      throw new Error("El lote de etiquetas está vacío.");
    }

    if (!lote.every(x => x && typeof x === "object")) {
      throw new Error("El lote contiene elementos inválidos.");
    }

    const mapaCatalogo = _buildMapaCatalogo_();
    const mapaMedidas = _buildMapaMedidas_();

    const ss = getSpreadsheetByFileKey_(SHEETS.ETIQUETAS.file);
    const config = _obtenerContextoTemporal_(ss);

    const fechaHora = config.fecha + " " + config.hora;

    const marcaTiempoBase =
      config.fecha.split("/").reverse().join("") +
      config.hora.replace(/:/g, "");

    const loteNormalizado = lote.map((item, index) => {
      const { codigo, producto } = _validarCodigo_(item.codigo, mapaCatalogo);
      const { tipo, medida } = _validarTipoEtiqueta_(item.tipo, mapaMedidas);

      const descripcion = toStrUpper_(item.descripcion || producto.descripcion);
      const id = toStr_(item.id || producto.idproducto);

      if (!descripcion) {
        throw new Error(`El código "${codigo}" no tiene descripción.`);
      }

      if (!id) {
        throw new Error(`El código "${codigo}" no tiene ID producto.`);
      }

      return {
        tipo: tipo,
        codigo: codigo,
        descripcion: descripcion,
        id: id,
        alto: toNum_(item.alto || medida.alto),
        ancho: toNum_(item.ancho || medida.ancho),
        folio: `${marcaTiempoBase}&${codigo}&#ETIQ`
      };
    });

    const htmlImpresion = _renderEtiquetaIdentificadora_(
      loteNormalizado,
      fechaHora,
      "LOCAL"
    );

    const htmlOnline = _prepararHtmlOnline_(
      _renderEtiquetaIdentificadora_(
        loteNormalizado,
        fechaHora,
        "ONLINE"
      )
    );

    const printJob = {
      tipo: "ETIQUETAS_IDENTIFICADORAS",
      origen: "FormularioEtiquetasIdentificadoras",
      formato: "HTML",
      html: htmlOnline,
      content: htmlOnline,
      meta: {
        modulo: "FormularioEtiquetasIdentificadoras",
        total: loteNormalizado.length,
        fechaHora: fechaHora,
        etiqueta: "IDENTIFICADORA",
        formatoEtiqueta: "HTML",
        papel: "100x155mm"
      }
    };

    return {
      ok: true,
      modoCompatible: ["LOCAL", "ONLINE"],
      htmlImpresion: htmlImpresion,
      printJob: printJob,
      total: loteNormalizado.length
    };
  }

  return {
    getBootstrap,
    buscarProductoPorCodigo,
    procesarLote
  };

})();