/**
 * PrototipoTraspasosService.gs
 * Servicio de dominio para la vista PrototipoTraspasos
 */

const PrototipoTraspasosService = (() => {

  const DOMAIN = Object.freeze({
    BODEGA_PRINCIPAL: "1 - ALMACEN BIRLOS",
    TIPOS: Object.freeze({
      ACOMODO: "ACOMODO",
      SURTIDO: "SURTIDO"
    }),
    STATUS_CERRADO_LOGICO: "CERRADO"
  });

  // =========================================================
  // HELPERS GENERALES
  // =========================================================
  function _toSafeStr_(value) {
    return toStr_(value || "");
  }

  function _toSafeUpper_(value) {
    return toStrUpper_(value || "");
  }

  function _toSafeNum_(value) {
    return toNum_(value || 0);
  }

  function _obtenerContextoTemporal_(ss) {
    const zonaHoraria = ss.getSpreadsheetTimeZone();
    const ahora = new Date();

    return {
      fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
      hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss"),
      ahora: ahora
    };
  }

  function _buildUsuarios_() {
    return UsuariosRepository.getAll()
      .map(u => ({
        idusuario: u.idusuario,
        nombre: _toSafeUpper_(u.nombre),
        rol: _toSafeUpper_(u.rol)
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  function _buildSolicitantesSet_() {
    return new Set(_buildUsuarios_().map(u => u.nombre));
  }

  function _buildMapaCatalogo_() {
    return CatalogoRepository.getAll().reduce((acc, item) => {
      const codigo = _toSafeUpper_(item.codigo);
      if (!codigo) return acc;

      acc[codigo] = {
        idproducto: _toSafeStr_(item.idproducto),
        codigo: codigo,
        descripcion: _toSafeUpper_(item.descripcion),
        status: _toSafeUpper_(item.status)
      };

      return acc;
    }, {});
  }

  function _pad2_(n) {
    return String(n).padStart(2, "0");
  }

  function _generarMarcaTiempoCompacta_(fecha) {
    return (
      fecha.getFullYear() +
      _pad2_(fecha.getMonth() + 1) +
      _pad2_(fecha.getDate()) +
      _pad2_(fecha.getHours()) +
      _pad2_(fecha.getMinutes()) +
      _pad2_(fecha.getSeconds())
    );
  }

  function _inferirBodegaPorUbicacion_(ubicacion) {
    const u = _toSafeUpper_(ubicacion);

    if (u.startsWith("B1")) return "Bodega 1";
    if (u.startsWith("B2")) return "Bodega 2";
    if (u.startsWith("B3")) return "Bodega 3";
    if (u.startsWith("BM")) return "Bodega Mostrador";
    if (u.startsWith("CB1")) return "Casa Blanca 1";
    if (u.startsWith("CB2")) return "Casa Blanca 2";

    return DOMAIN.BODEGA_PRINCIPAL;
  }

  function _validarTipo_(tipo) {
    const t = _toSafeUpper_(tipo);
    if (t !== DOMAIN.TIPOS.ACOMODO && t !== DOMAIN.TIPOS.SURTIDO) {
      throw new Error(`Tipo de movimiento no válido: ${tipo}`);
    }
    return t;
  }

  function _validarSolicitante_(solicitante, solicitantesSet) {
    const valor = _toSafeUpper_(solicitante);
    if (!valor) {
      throw new Error("El solicitante es obligatorio.");
    }

    if (!solicitantesSet.has(valor)) {
      throw new Error(`El solicitante "${valor}" no es válido.`);
    }

    return valor;
  }

  function _validarCantidad_(cantidad, maxPermitido, etiqueta = "cantidad") {
    const valor = _toSafeNum_(cantidad);

    if (valor <= 0) {
      throw new Error(`La ${etiqueta} debe ser mayor a cero.`);
    }

    if (maxPermitido != null && valor > Number(maxPermitido)) {
      throw new Error(`La ${etiqueta} no puede ser mayor a ${maxPermitido}.`);
    }

    return valor;
  }

  function _obtenerFilaExcedentePorIdUnico_(idUnico) {
    const hoja = getSheetByKey_("EXCEDENTES");
    const values = hoja.getDataRange().getValues();
    if (values.length < 2) return null;

    const filas = values.slice(1);

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const valorId = _toSafeStr_(fila[COL.EXCEDENTES.IDUNICO]);
      if (valorId === _toSafeStr_(idUnico)) {
        return {
          rowNumber: i + 2,
          raw: fila
        };
      }
    }

    return null;
  }

  function _obtenerEstadoFolios_() {
    return ExcedentesRepository.getAll()
      .filter(item => _toSafeStr_(item.idunico) && Number(item.cantidad) > 0)
      .map(item => ({
        idUnico: _toSafeStr_(item.idunico),
        sku: _toSafeUpper_(item.codigo),
        descripcion: _toSafeUpper_(item.descripcion),
        ubicacionActual: _toSafeUpper_(item.status), // compatibilidad con tu modelo actual
        balance: _toSafeNum_(item.cantidad)
      }));
  }

  function _validarFolioExistente_(idUnico, estadoFolios) {
    const id = _toSafeStr_(idUnico);
    if (!id) {
      throw new Error("No se recibió un ID único válido.");
    }

    const encontrado = estadoFolios.find(f => _toSafeStr_(f.idUnico) === id);
    if (!encontrado) {
      throw new Error(`El folio "${id}" no existe o ya no tiene saldo disponible.`);
    }

    return encontrado;
  }

  function _buildBootstrap() {
    return {
      usuarios: _buildUsuarios_(),
      estadoFolios: _obtenerEstadoFolios_()
    };
  }

  // =========================================================
  // HELPERS DE ESCRITURA EN HOJAS
  // =========================================================
  function _actualizarExcedenteExistente_(rowNumber, payload) {
    const hoja = getSheetByKey_("EXCEDENTES");

    if (payload.cantidad != null) {
      hoja.getRange(rowNumber, COL.EXCEDENTES.CANTIDAD + 1).setValue(Number(payload.cantidad || 0));
    }

    if (payload.ubicacionActual != null) {
      // OJO: hoy esta columna en tu estructura sigue llamándose STATUS
      hoja.getRange(rowNumber, COL.EXCEDENTES.STATUS + 1).setValue(_toSafeUpper_(payload.ubicacionActual));
    }
  }

  function _insertarNuevoExcedente_(item, config) {
    const hoja = getSheetByKey_("EXCEDENTES");

    const fila = [
      _toSafeStr_(item.idUnico),          // IDUNICO
      config.fecha,                       // FECHA
      config.hora,                        // HORA
      _toSafeStr_(item.idproducto),       // IDPRODUCTO
      _toSafeUpper_(item.codigo),         // CODIGO
      _toSafeUpper_(item.descripcion),    // DESCRIPCION
      Number(item.cantidad || 0),         // CANTIDAD
      _toSafeUpper_(item.ubicacionActual) // STATUS / UBICACION ACTUAL
    ];

    const startRow = hoja.getLastRow() + 1;
    hoja.getRange(startRow, 1, 1, 8).setValues([fila]);
  }

  function _appendTraspasoRows_(movimientos, config) {
    const hoja = getSheetByKey_("TRASPASOS");

    const rows = movimientos.map(mov => {
      return [
        config.fecha,                       // FECHA
        config.hora,                        // HORA
        mov.tipo,                           // TIPOMOVIMIENTO
        _toSafeUpper_(mov.serie),           // SERIE
        _toSafeStr_(mov.bodegaSalida),      // BODEGA_SALIDA
        _toSafeStr_(mov.ubicacionSalida),   // UBICACION_SALIDA
        _toSafeStr_(mov.bodegaEntrada),     // BODEGA_ENTRADA
        _toSafeStr_(mov.ubicacionEntrada),  // UBICACION_ENTRADA
        _toSafeUpper_(mov.solicitante),     // SOLICITANTE
        _toSafeUpper_(mov.codigo),          // CODIGO
        _toSafeUpper_(mov.descripcion),     // DESCRIPCION
        Number(mov.cantidad || 0),          // CANTIDAD
        "",                                 // FOLIO
        "",                                 // RESPONSABLE
        _toSafeStr_(mov.idUnicoBase || "")  // IDUNICO
      ];
    });

    const startRow = hoja.getLastRow() + 1;
    hoja.getRange(startRow, 1, rows.length, 15).setValues(rows);
  }

  function _crearHtmlRemanentes_(remanentes, config) {
    if (!remanentes || remanentes.length === 0) return "";

    const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
    tmpl.lote = remanentes.map(item => ({
      codigo: item.codigo,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      ubicacion: item.ubicacionActual,
      id: item.idUnico,
      idUnico: item.idUnico
    }));

    tmpl.fechaHora = config.fecha + " " + config.hora;
    return tmpl.evaluate().getContent();
  }

  // =========================================================
  // API DEL SERVICE
  // =========================================================
  function getBootstrap() {
    return _buildBootstrap();
  }

  function obtenerEstadoFolios() {
    return _obtenerEstadoFolios_();
  }

  /**
   * Procesa la cola del prototipo.
   *
   * item esperado (shape aproximado):
   * {
   *   tipo: "Acomodo" | "Surtido",
   *   solicitante,
   *   codigo,              // aquí llega el folio/ID escaneado
   *   cantidad,
   *   ubicacion,           // nueva ubicación (en Acomodo) o actual (en Surtido)
   *   idSeleccionado,      // opcional, si el frontend lo manda
   *   sku,                 // opcional
   *   descripcion          // opcional
   * }
   */
  function procesarMovimientosFinal(cola) {
    if (!Array.isArray(cola) || cola.length === 0) {
      throw new Error("La cola de movimientos está vacía.");
    }

    if (!cola.every(x => x && typeof x === "object")) {
      throw new Error("La cola contiene elementos inválidos.");
    }

    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      lock.waitLock(30000);
      locked = true;

      const ssExcedentes = getSpreadsheetByFileKey_(SHEETS.EXCEDENTES.file);
      const config = _obtenerContextoTemporal_(ssExcedentes);

      const solicitantesSet = _buildSolicitantesSet_();
      const mapaCatalogo = _buildMapaCatalogo_();
      const estadoFolios = _obtenerEstadoFolios_();

      const movimientosTraspaso = [];
      const remanentesGenerados = [];

      cola.forEach(item => {
        const tipo = _validarTipo_(item.tipo);
        const solicitante = _validarSolicitante_(item.solicitante, solicitantesSet);

        const idUnicoEscaneado = _toSafeStr_(item.codigo || item.idUnico || (item.idSeleccionado && item.idSeleccionado.idUnico));
        const folioActual = _validarFolioExistente_(idUnicoEscaneado, estadoFolios);

        const sku = _toSafeUpper_(item.sku || (item.idSeleccionado && item.idSeleccionado.sku) || folioActual.sku);
        const descripcion = _toSafeUpper_(item.descripcion || (item.idSeleccionado && item.idSeleccionado.descripcion) || folioActual.descripcion);
        const idproducto = _toSafeStr_((mapaCatalogo[sku] && mapaCatalogo[sku].idproducto) || "");

        if (!sku) {
          throw new Error(`El folio "${idUnicoEscaneado}" no tiene SKU asociado.`);
        }

        if (!descripcion) {
          throw new Error(`El folio "${idUnicoEscaneado}" no tiene descripción asociada.`);
        }

        if (!idproducto) {
          throw new Error(`El SKU "${sku}" no tiene ID producto en catálogo.`);
        }

        const saldoDisponible = Number(folioActual.balance || 0);
        const cantidadSolicitada = _validarCantidad_(item.cantidad, saldoDisponible);

        const ubicacionActual = _toSafeUpper_(folioActual.ubicacionActual);
        const filaExcedente = _obtenerFilaExcedentePorIdUnico_(idUnicoEscaneado);

        if (!filaExcedente) {
          throw new Error(`No se encontró la fila física del folio "${idUnicoEscaneado}" en BD-EXCEDENTES.`);
        }

        if (tipo === DOMAIN.TIPOS.ACOMODO) {
          const nuevaUbicacion = _toSafeUpper_(item.ubicacion);

          if (!nuevaUbicacion) {
            throw new Error(`Debes indicar una ubicación destino para el acomodo del folio "${idUnicoEscaneado}".`);
          }

          // 1) Actualizar ubicación del mismo excedente
          _actualizarExcedenteExistente_(filaExcedente.rowNumber, {
            ubicacionActual: nuevaUbicacion
          });

          // 2) Registrar traspaso
          movimientosTraspaso.push({
            tipo: "Acomodo",
            serie: nuevaUbicacion,
            bodegaSalida: DOMAIN.BODEGA_PRINCIPAL,
            ubicacionSalida: DOMAIN.BODEGA_PRINCIPAL,
            bodegaEntrada: _inferirBodegaPorUbicacion_(nuevaUbicacion),
            ubicacionEntrada: nuevaUbicacion,
            solicitante: solicitante,
            codigo: sku,
            descripcion: descripcion,
            cantidad: Math.abs(cantidadSolicitada),
            idUnicoBase: idUnicoEscaneado
          });
        }

        if (tipo === DOMAIN.TIPOS.SURTIDO) {
          // 1) Consumir folio original (lo cerramos lógicamente)
          _actualizarExcedenteExistente_(filaExcedente.rowNumber, {
            cantidad: 0,
            ubicacionActual: ubicacionActual || DOMAIN.STATUS_CERRADO_LOGICO
          });

          // 2) Registrar movimiento de salida
          movimientosTraspaso.push({
            tipo: "Surtido",
            serie: ubicacionActual,
            bodegaSalida: _inferirBodegaPorUbicacion_(ubicacionActual),
            ubicacionSalida: ubicacionActual,
            bodegaEntrada: DOMAIN.BODEGA_PRINCIPAL,
            ubicacionEntrada: DOMAIN.BODEGA_PRINCIPAL,
            solicitante: solicitante,
            codigo: sku,
            descripcion: descripcion,
            cantidad: -Math.abs(cantidadSolicitada),
            idUnicoBase: idUnicoEscaneado
          });

          // 3) Si hubo remanente, crear nuevo excedente y preparar impresión
          const remanente = saldoDisponible - cantidadSolicitada;

          if (remanente > 0) {
            const nuevoIdUnico = `${_generarMarcaTiempoCompacta_(config.ahora)}${idproducto}R`;

            const nuevoRemanente = {
              idUnico: nuevoIdUnico,
              idproducto: idproducto,
              codigo: sku,
              descripcion: descripcion,
              cantidad: remanente,
              ubicacionActual: ubicacionActual
            };

            _insertarNuevoExcedente_(nuevoRemanente, config);
            remanentesGenerados.push(nuevoRemanente);
          }
        }
      });

      // Registrar todos los movimientos en TRASPASOS
      if (movimientosTraspaso.length > 0) {
        _appendTraspasoRows_(movimientosTraspaso, config);
      }

      SpreadsheetApp.flush();

      if (typeof ExcedentesRepository !== "undefined" && ExcedentesRepository.clearCache) {
        ExcedentesRepository.clearCache();
      }

      if (typeof TraspasosRepository !== "undefined" && TraspasosRepository.clearCache) {
        TraspasosRepository.clearCache();
      }

      return {
        ok: true,
        totalProcesados: cola.length,
        remanentesGenerados: remanentesGenerados.length,
        htmlImpresion: _crearHtmlRemanentes_(remanentesGenerados, config)
      };

    } catch (error) {
      throw new Error("No se pudieron procesar los movimientos del prototipo: " + error.message);
    } finally {
      if (locked) lock.releaseLock();
    }
  }

  return {
    getBootstrap,
    obtenerEstadoFolios,
    procesarMovimientosFinal
  };

})();