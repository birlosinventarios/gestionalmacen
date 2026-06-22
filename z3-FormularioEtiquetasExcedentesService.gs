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
      producto
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
      idUnico,                    // COL.EXCEDENTES.IDUNICO
      config.fecha,               // COL.EXCEDENTES.FECHA
      config.hora,                // COL.EXCEDENTES.HORA
      idproducto,                 // COL.EXCEDENTES.IDPRODUCTO
      codigo,                     // COL.EXCEDENTES.CODIGO
      descripcion,                // COL.EXCEDENTES.DESCRIPCION
      cantidad,                   // COL.EXCEDENTES.CANTIDAD
      DOMAIN.STATUS_INICIAL       // COL.EXCEDENTES.STATUS
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

  function getBootstrap() {
    return {
      codigos: _buildCodigos_(),
      mapaCatalogo: _buildMapaCatalogo_()
    };
  }

  function buscarProductoPorCodigo(codigo) {
    const cod = toStrUpper_(codigo);
    if (!cod) {
      return { encontrado: false };
    }

    const producto = CatalogoRepository.getPorCodigo(cod)[0];
    if (!producto) {
      return { encontrado: false };
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

      // 1) Guardar en BD-EXCEDENTES
      const rows = lote.map(item => _mapExcedenteToRow_(item, config, mapaCatalogo));
      const startRow = hoja.getLastRow() + 1;
      hoja.getRange(startRow, 1, rows.length, 8).setValues(rows);

      SpreadsheetApp.flush();

      if (typeof ExcedentesRepository !== "undefined" && ExcedentesRepository.clearCache) {
        ExcedentesRepository.clearCache();
      }

      // 2) Generar HTML de impresión
      const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');

      tmpl.lote = lote.map(item => _mapPrintItem_(item, mapaCatalogo));
      tmpl.fechaHora = config.fecha + " " + config.hora;

      return tmpl.evaluate().getContent();

    } catch (error) {
      throw new Error("No se pudo procesar el lote de etiquetas de excedentes: " + error.message);
    } finally {
      if (locked) lock.releaseLock();
    }
  }

  return {
    getBootstrap,
    buscarProductoPorCodigo,
    procesarLote
  };

})();
