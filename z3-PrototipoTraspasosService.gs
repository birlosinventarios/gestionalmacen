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
    STATUS_CERRADO_LOGICO: "CERRADO",
    STATUS_DISPONIBLE: "DISPONIBLE",
    STATUS_ACOMODADO: "ACOMODADO",
    STATUS_SURTIDO: "SURTIDO",
    STATUS_PARCIAL: "PARCIAL",
    STATUS_REMANENTE: "DISPONIBLE"
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

  function _buildBodegas_() {
    const datos = UbicacionesExcedentesRepository.getBodegas()
      .map(x => _toSafeUpper_(x))
      .filter(Boolean);

    return [...new Set(datos)].sort();
  }

  function _buildMapaUbicacionesExcedentes_() {
    return UbicacionesExcedentesRepository.getAll()
      .map(item => ({
        bodega: _toSafeUpper_(item.bodega),
        ubi: _toSafeUpper_(item.ubicacion)
      }))
      .filter(x => x.bodega && x.ubi);
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

  function _pad3_(n) {
    return String(n).padStart(3, "0");
  }

  function _generarMarcaTiempoCompacta_(fecha) {
    return (
      fecha.getFullYear() +
      _pad2_(fecha.getMonth() + 1) +
      _pad2_(fecha.getDate()) +
      _pad2_(fecha.getHours()) +
      _pad2_(fecha.getMinutes()) +
      _pad2_(fecha.getSeconds()) +
      _pad3_(fecha.getMilliseconds())
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
    const buscado = _toSafeStr_(idUnico);

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const valorId = _toSafeStr_(fila[COL.EXCEDENTES.IDUNICO]);
      if (valorId === buscado) {
        return {
          rowNumber: i + 2,
          raw: fila
        };
      }
    }

    return null;
  }

  // =========================================================
  // DATASETS POR TIPO
  // =========================================================

  /**
   * ACOMODO:
   * Solo IDs únicos que siguen en excedentes con saldo > 0
   * y status exactamente DISPONIBLE.
   */
  function _obtenerFoliosParaAcomodo_() {
    return ExcedentesRepository.getAll()
      .filter(item =>
        _toSafeStr_(item.idunico) &&
        _toSafeNum_(item.cantidad) > 0 &&
        _toSafeUpper_(item.status) === DOMAIN.STATUS_DISPONIBLE
      )
      .map(item => ({
        idUnico: _toSafeStr_(item.idunico),
        sku: _toSafeUpper_(item.codigo),
        descripcion: _toSafeUpper_(item.descripcion),
        ubicacionActual: _toSafeUpper_(item.status),
        balance: _toSafeNum_(item.cantidad)
      }))
      .sort((a, b) =>
        String(a.idUnico || "").localeCompare(
          String(b.idUnico || ""),
          "es",
          { numeric: true, sensitivity: "base" }
        )
      );
  }

  /**
   * SURTIDO:
   * Se alimenta del cálculo consolidado de GestorExcedentes.
   * Solo IDs con saldo vigente y con ubicación.
   */
  function _obtenerFoliosParaSurtido_() {
    return GestorExcedentesService.obtenerExcedentesConsolidados()
      .filter(item =>
        _toSafeStr_(item.eidUnico) &&
        _toSafeNum_(item.esaldo) > 0 &&
        item.conUbicacion === true
      )
      .map(item => ({
        idUnico: _toSafeStr_(item.eidUnico),
        sku: _toSafeUpper_(item.ecodigo),
        descripcion: _toSafeUpper_(item.edescripcion),
        ubicacionActual: _toSafeUpper_(item.eserie),
        balance: _toSafeNum_(item.esaldo),
        bodegaActual: _toSafeStr_(item.ebodegaActual)
      }))
      .sort((a, b) =>
        String(a.idUnico || "").localeCompare(
          String(b.idUnico || ""),
          "es",
          { numeric: true, sensitivity: "base" }
        )
      );
  }

  /**
   * Compatibilidad / utilidad general
   */
  function _obtenerEstadoFolios_() {
    return {
      acomodo: _obtenerFoliosParaAcomodo_(),
      surtido: _obtenerFoliosParaSurtido_()
    };
  }

  function _validarFolioPorTipo_(idUnico, tipo, foliosAcomodo, foliosSurtido) {
    const id = _toSafeStr_(idUnico);
    const tipoUpper = _toSafeUpper_(tipo);

    if (!id) {
      throw new Error("No se recibió un ID único válido.");
    }

    let encontrado = null;

    if (tipoUpper === DOMAIN.TIPOS.ACOMODO) {
      encontrado = foliosAcomodo.find(f => _toSafeStr_(f.idUnico) === id);

      if (!encontrado) {
        throw new Error(`El folio "${id}" no está disponible para Acomodo.`);
      }

      return encontrado;
    }

    if (tipoUpper === DOMAIN.TIPOS.SURTIDO) {
      encontrado = foliosSurtido.find(f => _toSafeStr_(f.idUnico) === id);

      if (!encontrado) {
        throw new Error(`El folio "${id}" no está disponible para Surtido.`);
      }

      return encontrado;
    }

    throw new Error(`No se pudo validar el folio "${id}" para el tipo "${tipo}".`);
  }

  function _buildBootstrap() {
    const usuarios = _buildUsuarios_();
    const bodegas = _buildBodegas_();
    const mapaUbicacionesExcedentes = _buildMapaUbicacionesExcedentes_();
    const estadoFoliosAcomodo = _obtenerFoliosParaAcomodo_();
    const estadoFoliosSurtido = _obtenerFoliosParaSurtido_();

    return {
      usuarios,
      bodegas,
      mapaUbicacionesExcedentes,
      estadoFoliosAcomodo,
      estadoFoliosSurtido,

      // compatibilidad temporal
      estadoFolios: estadoFoliosAcomodo
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

      // Catálogo solo se usa como apoyo para surtido parcial/remanentes.
      const mapaCatalogo = _buildMapaCatalogo_();

      const foliosAcomodo = _obtenerFoliosParaAcomodo_();
      const foliosSurtido = _obtenerFoliosParaSurtido_();

      const movimientosTraspaso = [];
      const remanentesGenerados = [];

      cola.forEach((item, index) => {
        const tipo = _validarTipo_(item.tipo);
        const solicitante = _validarSolicitante_(item.solicitante, solicitantesSet);

        const idUnicoEscaneado = _toSafeStr_(
          item.codigo ||
          item.idUnico ||
          (item.idSeleccionado && item.idSeleccionado.idUnico)
        );

        const folioActual = _validarFolioPorTipo_(
          idUnicoEscaneado,
          tipo,
          foliosAcomodo,
          foliosSurtido
        );

        // Para ambos tipos tomamos SKU/Descripción desde el folio vigente
        // o desde el payload si el frontend los mandó.
        const sku = _toSafeUpper_(
          item.sku ||
          (item.idSeleccionado && item.idSeleccionado.sku) ||
          folioActual.sku
        );

        const descripcion = _toSafeUpper_(
          item.descripcion ||
          (item.idSeleccionado && item.idSeleccionado.descripcion) ||
          folioActual.descripcion
        );

        if (!sku) {
          throw new Error(`El folio "${idUnicoEscaneado}" no tiene SKU asociado.`);
        }

        if (!descripcion) {
          throw new Error(`El folio "${idUnicoEscaneado}" no tiene descripción asociada.`);
        }

        const saldoDisponible = Number(folioActual.balance || 0);

        let cantidadSolicitada = 0;

        if (tipo === DOMAIN.TIPOS.ACOMODO) {
          // En acomodo siempre se usa la cantidad completa del idUnico/folio vigente
          cantidadSolicitada = saldoDisponible;

          const cantidadCapturada = _toSafeNum_(item.cantidad || 0);
          if (cantidadCapturada > 0 && cantidadCapturada !== saldoDisponible) {
            console.warn(`⚠️ [Acomodo] Se ignoró cantidad capturada (${cantidadCapturada}) y se usó saldo completo (${saldoDisponible}) para el folio ${idUnicoEscaneado}.`);
          }
        } else {
          cantidadSolicitada = _validarCantidad_(item.cantidad, saldoDisponible);
        }

        const ubicacionActual = _toSafeUpper_(folioActual.ubicacionActual);
        const filaExcedente = _obtenerFilaExcedentePorIdUnico_(idUnicoEscaneado);

        if (!filaExcedente) {
          throw new Error(`No se encontró la fila física del folio "${idUnicoEscaneado}" en BD-EXCEDENTES.`);
        }

        // =====================================================
        // ACOMODO
        // =====================================================
        if (tipo === DOMAIN.TIPOS.ACOMODO) {
          const nuevaUbicacion = _toSafeUpper_(item.ubicacion);

          if (!nuevaUbicacion) {
            throw new Error(`Debes indicar una ubicación destino para el acomodo del folio "${idUnicoEscaneado}".`);
          }

          // 1) Marcar el excedente como estado lógico ACOMODADO
          _actualizarExcedenteExistente_(filaExcedente.rowNumber, {
            ubicacionActual: DOMAIN.STATUS_ACOMODADO
          });

          // 2) Registrar traspaso de acomodo con la ubicación física real
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

          return; // importante: en acomodo no hay remanente ni catálogo obligatorio
        }

        // =====================================================
        // SURTIDO
        // =====================================================
        if (tipo === DOMAIN.TIPOS.SURTIDO) {
          const remanente = saldoDisponible - cantidadSolicitada;
          const esParcial = remanente > 0;
          const nuevoStatusOriginal = esParcial
            ? DOMAIN.STATUS_PARCIAL
            : DOMAIN.STATUS_SURTIDO;

          // 1) Marcar el registro original SOLO por status
          _actualizarExcedenteExistente_(filaExcedente.rowNumber, {
            ubicacionActual: nuevoStatusOriginal
          });

          // 2) Registrar movimiento de salida en TRASPASOS
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

          // 3) Solo si fue parcial, crear nuevo ID remanente
          if (esParcial) {
            const idproducto = _toSafeStr_(
              (mapaCatalogo[sku] && mapaCatalogo[sku].idproducto) || ""
            );

            if (!idproducto) {
              throw new Error(`El SKU "${sku}" no tiene ID producto en catálogo.`);
            }

            const nuevoIdUnico = `${_generarMarcaTiempoCompacta_(config.ahora)}${idproducto}R${index + 1}`;

            const nuevoRemanente = {
              idUnico: nuevoIdUnico,
              idproducto: idproducto,
              codigo: sku,
              descripcion: descripcion,
              cantidad: remanente,
              ubicacionActual: DOMAIN.STATUS_REMANENTE
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
        htmlImpresion: _crearHtmlRemanentes_(remanentesGenerados, config),
        estadoFolios: _obtenerEstadoFolios_()
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