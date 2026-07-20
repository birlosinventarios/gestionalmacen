/**
 * DetallesProductoRepository.gs
 * Repositorio para lectura y escritura de la hoja DETALLESPRODUCTO
 */

const DetallesProductoRepository = (() => {

  const HEADERS = [
    "ID",
    "CODIGO",
    "DESCRIPCION",
    "TIPOHILO",
    "HILO",
    "LARGOCUERPO",
    "LARGOCABEZA",
    "ANCHOCUERPO",
    "ANCHOCABEZA",
    "LARGOTOTAL",
    "ANCHOTOTAL",
    "PESOTEORICO",
    "ROSCADO",
    "LARGOROSCADO"
  ];

  function _getSheet_() {
    const config = SHEETS.DETALLES_PRODUCTOS;

    if (!config) {
      throw new Error("No existe la configuración SHEETS.DETALLES_PRODUCTOS.");
    }

    const ss = getSpreadsheetByFileKey_(config.file);
    let hoja = ss.getSheetByName(config.name);

    if (!hoja) {
      hoja = ss.insertSheet(config.name);
    }

    _ensureHeaders_(hoja);

    return hoja;
  }

  function _ensureHeaders_(hoja) {
    const currentHeaders = hoja.getRange(1, 1, 1, HEADERS.length).getValues()[0];

    const headersInvalidos = HEADERS.some(function (header, index) {
      return toStrUpper_(currentHeaders[index]) !== header;
    });

    if (headersInvalidos) {
      hoja.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      hoja.setFrozenRows(1);
    }
  }

  function _normalizarFila_(fila) {
    return {
      ID: toStr_(fila[COL.DETALLES_PRODUCTOS.ID]),
      CODIGO: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.CODIGO]),
      DESCRIPCION: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.DESCRIPCION]),
      TIPOHILO: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.TIPOHILO]),
      HILO: toNum_(fila[COL.DETALLES_PRODUCTOS.HILO]),
      LARGOCUERPO: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOCUERPO]),
      LARGOCABEZA: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOCABEZA]),
      ANCHOCUERPO: toNum_(fila[COL.DETALLES_PRODUCTOS.ANCHOCUERPO]),
      ANCHOCABEZA: toNum_(fila[COL.DETALLES_PRODUCTOS.ANCHOCABEZA]),
      LARGOTOTAL: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOTOTAL]),
      ANCHOTOTAL: toNum_(fila[COL.DETALLES_PRODUCTOS.ANCHOTOTAL]),
      PESOTEORICO: toNum_(fila[COL.DETALLES_PRODUCTOS.PESOTEORICO]),
      ROSCADO: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.ROSCADO]),
      LARGOROSCADO: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOROSCADO])
    };
  }

  function _toRow_(item) {
    return [
      toStr_(item.ID),
      toStrUpper_(item.CODIGO),
      toStrUpper_(item.DESCRIPCION),
      toStrUpper_(item.TIPOHILO),
      toNum_(item.HILO),
      toNum_(item.LARGOCUERPO),
      toNum_(item.LARGOCABEZA),
      toNum_(item.ANCHOCUERPO),
      toNum_(item.ANCHOCABEZA),
      toNum_(item.LARGOTOTAL),
      toNum_(item.ANCHOTOTAL),
      toNum_(item.PESOTEORICO),
      toStrUpper_(item.ROSCADO),
      toNum_(item.LARGOROSCADO)
    ];
  }

  function getAll() {
    const hoja = _getSheet_();
    const lastRow = hoja.getLastRow();

    if (lastRow < 2) {
      return [];
    }

    const values = hoja
      .getRange(2, 1, lastRow - 1, HEADERS.length)
      .getValues();

    return values
      .map(function (fila) {
        return _normalizarFila_(fila);
      })
      .filter(function (item) {
        return item.ID && item.CODIGO;
      });
  }

  function getUnoPorId(id) {
    const idBuscado = toStr_(id);

    if (!idBuscado) {
      return null;
    }

    const rows = getAll();

    return rows.find(function (item) {
      return toStr_(item.ID) === idBuscado;
    }) || null;
  }

  function getUnoPorCodigo(codigo) {
    const codigoBuscado = toStrUpper_(codigo);

    if (!codigoBuscado) {
      return null;
    }

    const rows = getAll();

    return rows.find(function (item) {
      return toStrUpper_(item.CODIGO) === codigoBuscado;
    }) || null;
  }

  function getPorId(id) {
    const idBuscado = toStr_(id);

    if (!idBuscado) {
      return [];
    }

    return getAll().filter(function (item) {
      return toStr_(item.ID) === idBuscado;
    });
  }

  function getPorCodigo(codigo) {
    const codigoBuscado = toStrUpper_(codigo);

    if (!codigoBuscado) {
      return [];
    }

    return getAll().filter(function (item) {
      return toStrUpper_(item.CODIGO) === codigoBuscado;
    });
  }

  function _findRowById_(id) {
    const hoja = _getSheet_();
    const lastRow = hoja.getLastRow();
    const idBuscado = toStr_(id);

    if (!idBuscado || lastRow < 2) {
      return -1;
    }

    const values = hoja
      .getRange(2, COL.DETALLES_PRODUCTOS.ID + 1, lastRow - 1, 1)
      .getValues();

    for (let i = 0; i < values.length; i++) {
      const idActual = toStr_(values[i][0]);

      if (idActual === idBuscado) {
        return i + 2;
      }
    }

    return -1;
  }

  function existePorId(id) {
    return _findRowById_(id) > 0;
  }

  function upsert(item) {
    const hoja = _getSheet_();

    if (!item || !item.ID) {
      throw new Error("No se puede guardar detalle sin ID.");
    }

    if (!item.CODIGO) {
      throw new Error("No se puede guardar detalle sin CODIGO.");
    }

    const row = _toRow_(item);
    const rowNumber = _findRowById_(item.ID);

    if (rowNumber > 0) {
      hoja.getRange(rowNumber, 1, 1, HEADERS.length).setValues([row]);

      return {
        ok: true,
        accion: "ACTUALIZADO",
        rowNumber: rowNumber,
        item: _normalizarFila_(row)
      };
    }

    hoja.appendRow(row);

    return {
      ok: true,
      accion: "CREADO",
      rowNumber: hoja.getLastRow(),
      item: _normalizarFila_(row)
    };
  }

  function insertarLote(items) {
    const hoja = _getSheet_();

    if (!Array.isArray(items) || items.length === 0) {
      return {
        ok: true,
        insertados: 0
      };
    }

    const rows = items.map(function (item) {
      return _toRow_(item);
    });

    hoja
      .getRange(hoja.getLastRow() + 1, 1, rows.length, HEADERS.length)
      .setValues(rows);

    return {
      ok: true,
      insertados: rows.length
    };
  }

  function debugGetAll() {
    return debugRepositoryCall_(
      "DetallesProductoRepository.getAll",
      {},
      function () {
        return getAll();
      },
      {
        limit: 10
      }
    );
  }

  function debugMethods() {
    return debugRepositoryMethods_(
      "DetallesProductoRepository",
      DetallesProductoRepository
    );
  }

  return {
    getAll: getAll,
    getUnoPorId: getUnoPorId,
    getUnoPorCodigo: getUnoPorCodigo,
    getPorId: getPorId,
    getPorCodigo: getPorCodigo,
    existePorId: existePorId,
    upsert: upsert,
    insertarLote: insertarLote,
    debugGetAll: debugGetAll,
    debugMethods: debugMethods
  };

})();