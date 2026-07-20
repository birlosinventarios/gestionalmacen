/**
 * DetallesProductoService.gs
 * Servicio de captura y validación de DETALLESPRODUCTO
 */

const DetallesProductoService = (() => {

  const TIPOS_HILO_VALIDOS = ["METRICO", "STANDARD"];
  const ROSCADOS_VALIDOS = ["COMPLETO", "PARCIAL"];

  function _round_(num, dec = 4) {
    const n = Number(num || 0);
    return Number(n.toFixed(dec));
  }

  function _get_(obj, keys, fallback = "") {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (
        obj &&
        obj[key] !== null &&
        obj[key] !== undefined &&
        String(obj[key]).trim() !== ""
      ) {
        return obj[key];
      }
    }

    return fallback;
  }

  function _leerCatalogo_() {
    return getRowsByKey_("CATALOGO")
      .map(function (fila) {
        return {
          ID: toStr_(fila[COL.CATALOGO.IDPRODUCTO]),
          CODIGO: toStrUpper_(fila[COL.CATALOGO.CODIGO]),
          DESCRIPCION: toStrUpper_(fila[COL.CATALOGO.DESCRIPCION]),
          STATUS: toStrUpper_(fila[COL.CATALOGO.STATUS])
        };
      })
      .filter(function (x) {
        return x.ID && x.CODIGO;
      });
  }

  function _catalogoPorCodigo_(codigo) {
    const c = toStrUpper_(codigo);

    return _leerCatalogo_().find(function (x) {
      return x.CODIGO === c;
    }) || null;
  }

  function _catalogoPorId_(id) {
    const filtro = toStr_(id);

    return _leerCatalogo_().find(function (x) {
      return toStr_(x.ID) === filtro;
    }) || null;
  }

  function _resolverProductoBase_(payload) {
    const id = toStr_(_get_(payload, ["ID", "id"]));
    const codigo = toStrUpper_(_get_(payload, ["CODIGO", "codigo"]));

    let producto = null;

    if (id) {
      producto = _catalogoPorId_(id);
    }

    if (!producto && codigo) {
      producto = _catalogoPorCodigo_(codigo);
    }

    if (!producto) {
      throw new Error("El producto no existe en CATALOGO.");
    }

    return producto;
  }

  function _numberRequired_(valor, nombre, mayorQueCero) {
    const n = Number(valor);

    if (isNaN(n)) {
      throw new Error(nombre + " debe ser numérico.");
    }

    if (mayorQueCero && n <= 0) {
      throw new Error(nombre + " debe ser mayor a cero.");
    }

    if (!mayorQueCero && n < 0) {
      throw new Error(nombre + " no puede ser negativo.");
    }

    return n;
  }

  function _normalizarDetalle_(payload) {
    const producto = _resolverProductoBase_(payload);

    const tipoHilo = toStrUpper_(_get_(payload, ["TIPOHILO", "tipoHilo"]));
    const roscado = toStrUpper_(_get_(payload, ["ROSCADO", "roscado"]));

    if (!TIPOS_HILO_VALIDOS.includes(tipoHilo)) {
      throw new Error("TIPOHILO debe ser METRICO o STANDARD.");
    }

    if (!ROSCADOS_VALIDOS.includes(roscado)) {
      throw new Error("ROSCADO debe ser COMPLETO o PARCIAL.");
    }

    const hilo = _numberRequired_(
      _get_(payload, ["HILO", "hilo"]),
      "HILO",
      true
    );

    const largoCuerpo = _numberRequired_(
      _get_(payload, ["LARGOCUERPO", "largoCuerpo"]),
      "LARGOCUERPO",
      true
    );

    const largoCabeza = _numberRequired_(
      _get_(payload, ["LARGOCABEZA", "largoCabeza"], 0),
      "LARGOCABEZA",
      false
    );

    const anchoCuerpo = _numberRequired_(
      _get_(payload, ["ANCHOCUERPO", "anchoCuerpo"]),
      "ANCHOCUERPO",
      true
    );

    const anchoCabeza = _numberRequired_(
      _get_(payload, ["ANCHOCABEZA", "anchoCabeza"]),
      "ANCHOCABEZA",
      true
    );

    const pesoTeorico = _numberRequired_(
      _get_(payload, ["PESOTEORICO", "pesoTeorico"]),
      "PESOTEORICO",
      true
    );

    let largoRoscado = Number(
      _get_(payload, ["LARGOROSCADO", "largoRoscado"], 0)
    );

    if (roscado === "COMPLETO") {
      largoRoscado = largoCuerpo;
    }

    if (roscado === "PARCIAL") {
      largoRoscado = _numberRequired_(largoRoscado, "LARGOROSCADO", true);

      if (largoRoscado >= largoCuerpo) {
        throw new Error("Cuando ROSCADO es PARCIAL, LARGOROSCADO debe ser menor a LARGOCUERPO.");
      }
    }

    const largoTotal = _round_(largoCuerpo + largoCabeza);
    const anchoTotal = _round_(Math.max(anchoCuerpo, anchoCabeza));

    return {
      ID: producto.ID,
      CODIGO: producto.CODIGO,
      DESCRIPCION: producto.DESCRIPCION,
      TIPOHILO: tipoHilo,
      HILO: _round_(hilo),
      LARGOCUERPO: _round_(largoCuerpo),
      LARGOCABEZA: _round_(largoCabeza),
      ANCHOCUERPO: _round_(anchoCuerpo),
      ANCHOCABEZA: _round_(anchoCabeza),
      LARGOTOTAL: largoTotal,
      ANCHOTOTAL: anchoTotal,
      PESOTEORICO: _round_(pesoTeorico),
      ROSCADO: roscado,
      LARGOROSCADO: _round_(largoRoscado)
    };
  }

  function getBootstrap() {
    const catalogo = _leerCatalogo_();
    const detalles = DetallesProductoRepository.getAll();

    const mapaCatalogo = catalogo.reduce(function (acc, item) {
      acc[item.CODIGO] = item;
      return acc;
    }, {});

    const mapaDetallesPorId = detalles.reduce(function (acc, item) {
      acc[toStr_(item.ID)] = item;
      return acc;
    }, {});

    const mapaDetallesPorCodigo = detalles.reduce(function (acc, item) {
      acc[toStrUpper_(item.CODIGO)] = item;
      return acc;
    }, {});

    return {
      catalogo: catalogo,
      detalles: detalles,
      codigos: catalogo.map(function (x) {
        return x.CODIGO;
      }).filter(Boolean).sort(),
      ids: catalogo.map(function (x) {
        return x.ID;
      }).filter(Boolean).sort(),
      mapaCatalogo: mapaCatalogo,
      mapaDetallesPorId: mapaDetallesPorId,
      mapaDetallesPorCodigo: mapaDetallesPorCodigo,
      tiposHilo: TIPOS_HILO_VALIDOS,
      roscados: ROSCADOS_VALIDOS
    };
  }

  function buscarProductoPorCodigo(codigo) {
    const producto = _catalogoPorCodigo_(codigo);

    if (!producto) {
      return {
        encontrado: false,
        mensaje: "Producto no encontrado en CATALOGO."
      };
    }

    const detalle = DetallesProductoRepository.getUnoPorId(producto.ID);

    return {
      encontrado: true,
      producto: producto,
      detalle: detalle
    };
  }

  function buscarProductoPorId(id) {
    const producto = _catalogoPorId_(id);

    if (!producto) {
      return {
        encontrado: false,
        mensaje: "Producto no encontrado en CATALOGO."
      };
    }

    const detalle = DetallesProductoRepository.getUnoPorId(producto.ID);

    return {
      encontrado: true,
      producto: producto,
      detalle: detalle
    };
  }

  function guardarDetalle(payload) {
    return withScriptLock_("DetallesProductoService.guardarDetalle", function () {
      const detalle = _normalizarDetalle_(payload);
      const res = DetallesProductoRepository.upsert(detalle);

      return {
        ok: true,
        accion: res.accion,
        rowNumber: res.rowNumber,
        detalle: res.item
      };
    }, 30000);
  }

  function obtenerDetalles() {
    return DetallesProductoRepository.getAll();
  }

  return {
    getBootstrap: getBootstrap,
    buscarProductoPorCodigo: buscarProductoPorCodigo,
    buscarProductoPorId: buscarProductoPorId,
    guardarDetalle: guardarDetalle,
    obtenerDetalles: obtenerDetalles
  };

})();