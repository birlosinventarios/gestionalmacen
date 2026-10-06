/**
 * PrototipoTraspasosService.gs
 *
 * Servicio de dominio responsable de consultar, validar y aplicar movimientos
 * de acomodo y surtido sobre excedentes.
 *
 * Reglas invariantes:
 * - BD-EXCEDENTES.CANTIDAD representa la cantidad inicial histórica y nunca se
 *   modifica durante un traspaso.
 * - El saldo vigente se obtiene a partir de Bitacora-TRASPASOS.
 * - Los únicos tipos admitidos son ACOMODO y SURTIDO.
 * - Un surtido parcial conserva el mismo IdUnico y establece STATUS PARCIAL.
 * - La etiqueta de remanente muestra el saldo posterior confirmado.
 * - La idempotencia de inventario depende de idOperacion.
 * - STATUS solo se actualiza para operaciones realmente aplicadas.
 *
 * Secuencia crítica de persistencia:
 * 1. Adquirir el candado global de inventario.
 * 2. Invalidar cachés de lectura y reconstruir el estado vigente.
 * 3. Validar y mapear todos los movimientos.
 * 4. Aplicar movimientos idempotentes en existencias.
 * 5. Registrar únicamente movimientos aplicados en Bitacora-TRASPASOS.
 * 6. Actualizar exclusivamente STATUS en BD-EXCEDENTES.
 * 7. Ejecutar SpreadsheetApp.flush() antes de liberar el candado.
 * 8. Preparar impresión y limpiar cachés fuera de la sección protegida.
 *
 * Dependencias principales:
 * - UsuariosRepository, UbicacionesExcedentesRepository y CatalogoRepository.
 * - ExcedentesRepository, TraspasosRepository y ExistenciasRepository.
 * - GestorExcedentesService y APPALMACENCache.
 * - LockService, SpreadsheetApp, HtmlService y Utilities.
 * - Helpers globales de normalización y acceso a hojas.
 *
 * API pública:
 * - getBootstrap()
 * - obtenerEstadoFolios(forceRefresh)
 * - procesarMovimientosFinal(cola)
 */
const PrototipoTraspasosService = (() => {
  const DOMAIN = Object.freeze({
    BODEGA_PRINCIPAL: "1 - ALMACEN BIRLOS",
    TIPOS: Object.freeze({
      ACOMODO: "ACOMODO",
      SURTIDO: "SURTIDO"
    }),
    STATUS_DISPONIBLE: "DISPONIBLE",
    STATUS_ACOMODADO: "ACOMODADO",
    STATUS_SURTIDO: "SURTIDO",
    STATUS_PARCIAL: "PARCIAL"
  });

  /** Inicia una traza detallada del procesamiento de movimientos. */
  function _perfMovimientoStart_(
    operation,
    metadata
  ) {
    const now = Date.now();

    return {
      operation: String(
        operation ||
        "TRASPASOS_MOVIMIENTO"
      ),

      startedAt: now,
      lastAt: now,

      metadata:
        metadata &&
        typeof metadata === "object"
          ? metadata
          : {},

      marks: []
    };
  }

  /** Registra una etapa y sus tiempos acumulado y parcial. */
  function _perfMovimientoMark_(
    trace,
    stage,
    metadata
  ) {
    if (!trace) {
      return;
    }

    const now = Date.now();

    trace.marks.push({
      stage: String(
        stage || "MARK"
      ),

      segmentMs:
        now -
        trace.lastAt,

      totalMs:
        now -
        trace.startedAt,

      metadata:
        metadata &&
        typeof metadata === "object"
          ? metadata
          : {}
    });

    trace.lastAt = now;
  }

  /** Finaliza, registra y devuelve la traza de movimientos. */
  function _perfMovimientoEnd_(
    trace,
    status,
    metadata
  ) {
    if (!trace) {
      return null;
    }

    const result = {
      operation:
        trace.operation,

      status:
        String(
          status || "ok"
        ),

      totalMs:
        Date.now() -
        trace.startedAt,

      metadata:
        Object.assign(
          {},
          trace.metadata,
          metadata || {}
        ),

      marks:
        trace.marks.slice()
    };

    console.log(
      "[APPALMACEN]" +
      "[MOVIMIENTO_BACKEND_PERF] " +
      JSON.stringify(result)
    );

    return result;
  }

  /** Inicia una traza general de operación backend. */
  function _perfBackendStart_(operation, metadata) {
      return {
        operation: String(operation || "BACKEND_OPERATION"),
        startedAt: Date.now(),
        lastAt: Date.now(),
        metadata: metadata || {},
        marks: []
      };
    }

    /** Agrega una marca temporal a una traza backend. */
  function _perfBackendMark_(trace, stage, metadata) {
      if (!trace) return;

      const now = Date.now();
      trace.marks.push({
        stage: String(stage || "MARK"),
        segmentMs: now - trace.lastAt,
        totalMs: now - trace.startedAt,
        metadata: metadata || {}
      });
      trace.lastAt = now;
    }

    /** Finaliza y registra una traza backend. */
  function _perfBackendEnd_(trace, status, metadata) {
      if (!trace) return;

      const result = {
        operation: trace.operation,
        status: String(status || "ok"),
        totalMs: Date.now() - trace.startedAt,
        metadata: Object.assign({}, trace.metadata, metadata || {}),
        marks: trace.marks
      };

      console.log(
        "[APPALMACEN][BACKEND_PERF] " + JSON.stringify(result)
      );

      return result;
    }

  // =========================================================
  // HELPERS GENERALES
  // =========================================================

  /**
   * Construye fecha y hora usando la zona horaria de la hoja.
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss Archivo fuente.
   * @return {{fecha:string,hora:string,ahora:Date}}
   */
  function _obtenerContextoTemporal_(ss) {
    const zonaHoraria = ss.getSpreadsheetTimeZone();
    const ahora = new Date();

    return {
      fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
      hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss"),
      ahora: ahora
    };
  }

  /** @return {Array<Object>} Usuarios normalizados y ordenados por nombre. */
  function _buildUsuarios_() {
    return UsuariosRepository.getAll()
      .map(usuario => ({
        idusuario: usuario.idusuario,
        nombre: toStrUpper_(usuario.nombre),
        rol: toStrUpper_(usuario.rol)
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  /** @return {Set<string>} Índice de solicitantes válidos. */
  function _buildSolicitantesSet_() {
    return new Set(
      _buildUsuarios_().map(usuario => usuario.nombre)
    );
  }

  /** @return {Array<string>} Bodegas únicas y ordenadas. */
  function _buildBodegas_() {
    const datos = UbicacionesExcedentesRepository.getBodegas()
      .map(value => toStrUpper_(value))
      .filter(Boolean);

    return [...new Set(datos)].sort();
  }

  /** @return {Array<{bodega:string,ubi:string}>} Mapa normalizado. */
  function _buildMapaUbicacionesExcedentes_() {
    return UbicacionesExcedentesRepository.getAll()
      .map(item => ({
        bodega: toStrUpper_(item.bodega),
        ubi: toStrUpper_(item.ubicacion)
      }))
      .filter(item => item.bodega && item.ubi);
  }

  /** @return {Object<string,Object>} Catálogo indexado por código. */
  function _buildMapaCatalogo_() {
    const source =
      typeof CatalogoRepository
        .getAllRaw === "function"
        ? CatalogoRepository
            .getAllRaw()
        : CatalogoRepository
            .getAll();

    return source.reduce(
      function(acc, item) {
        const codigo =
          toStrUpper_(
            item.codigo
          );

        if (!codigo) {
          return acc;
        }

        acc[codigo] = {
          idproducto:
            toStr_(
              item.idproducto
            ),

          codigo:
            codigo,

          descripcion:
            toStrUpper_(
              item.descripcion
            ),

          status:
            toStrUpper_(
              item.status
            )
        };

        return acc;
      },
      {}
    );
  }

  /**
   * Infiere la bodega asociada al prefijo de una ubicación.
   * @param {*} ubicacion Ubicación operativa.
   * @return {string}
   */
  function _inferirBodegaPorUbicacion_(ubicacion) {
    const value = toStrUpper_(ubicacion);

    if (value.startsWith("B1")) return "BODEGA 1";
    if (value.startsWith("B2")) return "BODEGA 2";
    if (value.startsWith("B3")) return "BODEGA 3";
    if (value.startsWith("BM")) return "BODEGA MOSTRADOR";
    if (value.startsWith("CB1")) return "CASA BLANCA 1";
    if (value.startsWith("CB2")) return "CASA BLANCA 2";
    if (value.startsWith("A1")) return "CASA BLANCA 2";
    if (value.startsWith("A2")) return "CASA BLANCA 2";
    if (value.startsWith("A3")) return "CASA BLANCA 2";
    if (value.startsWith("P1")) return "CASA BLANCA 2";
    if (value.startsWith("CU")) return "CUARTO ALTO RIESGO";
    if (value.startsWith("MO")) return "MOSTRADOR";

    return DOMAIN.BODEGA_PRINCIPAL;
  }

  /** Valida y normaliza el tipo de movimiento. */
  function _validarTipo_(tipo) {
    const value = toStrUpper_(tipo);

    if (
      value !== DOMAIN.TIPOS.ACOMODO &&
      value !== DOMAIN.TIPOS.SURTIDO
    ) {
      throw new Error(`Tipo de movimiento no válido: ${tipo}`);
    }

    return value;
  }

  /** Valida al solicitante contra el índice autorizado. */
  function _validarSolicitante_(solicitante, solicitantesSet) {
    const value = toStrUpper_(solicitante);

    if (!value) {
      throw new Error("El solicitante es obligatorio.");
    }

    if (!solicitantesSet.has(value)) {
      throw new Error(`El solicitante "${value}" no es válido.`);
    }

    return value;
  }

  /** Valida una cantidad positiva y su límite superior opcional. */
  function _validarCantidad_(cantidad, maxPermitido, etiqueta = "cantidad") {
    const value = toNum_(cantidad);

    if (value <= 0) {
      throw new Error(`La ${etiqueta} debe ser mayor a cero.`);
    }

    if (
      maxPermitido != null &&
      value > Number(maxPermitido)
    ) {
      throw new Error(
        `La ${etiqueta} no puede ser mayor a ${maxPermitido}.`
      );
    }

    return value;
  }

  /** Busca directamente una fila física por IdUnico. */
  function _obtenerFilaExcedentePorIdUnico_(idUnico) {
    const sheet = getSheetByKey_("EXCEDENTES");
    const values = sheet.getDataRange().getValues();

    if (values.length < 2) return null;

    const searched = toStr_(idUnico);
    const rows = values.slice(1);

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const currentId = toStr_(row[COL.EXCEDENTES.IDUNICO]);

      if (currentId === searched) {
        return {
          rowNumber: index + 2,
          raw: row
        };
      }
    }

    return null;
  }

  /**
   * Construye un índice IdUnico -> fila física y reporta duplicados.
   * @return {Map<string,Object>}
   */
  function _buildIndiceFilasExcedentes_() {
    const source =
      typeof ExcedentesRepository
        .getAllRaw === "function"
        ? ExcedentesRepository
            .getAllRaw()
        : ExcedentesRepository
            .getAll();

    const index =
      new Map();

    const duplicates =
      [];

    source.forEach(
      function(item) {
        const idUnico =
          toStr_(
            item.idunico
          );

        const rowNumber =
          Number(
            item.rowNumber || 0
          );

        if (
          !idUnico ||
          !Number.isInteger(
            rowNumber
          ) ||
          rowNumber < 2
        ) {
          return;
        }

        if (
          index.has(idUnico)
        ) {
          duplicates.push({
            idUnico:
              idUnico,

            previousRow:
              index.get(
                idUnico
              ).rowNumber,

            currentRow:
              rowNumber
          });
        }

        index.set(
          idUnico,
          {
            rowNumber:
              rowNumber,

            item:
              item,

            raw:
              null
          }
        );
      }
    );

    if (
      duplicates.length > 0
    ) {
      console.warn(
        "[TRASPASOS] " +
        "IDUNICO duplicados en BD-EXCEDENTES",
        JSON.stringify({
          total:
            duplicates.length,

          muestra:
            duplicates.slice(
              0,
              20
            )
        })
      );
    }

    return index;
  }

  // =========================================================
  // DATASETS POR TIPO
  // =========================================================

  /** Obtiene folios disponibles para acomodo y registra rendimiento. */
  function _obtenerFoliosParaAcomodo_(
    parentTrace
  ) {
    const startedAt =
      Date.now();

    const source =
      typeof ExcedentesRepository
        .getAllRaw === "function"
        ? ExcedentesRepository
            .getAllRaw()
        : ExcedentesRepository
            .getAll();

    _perfBackendMark_(
      parentTrace,
      "ACOMODO_REPOSITORY_READ",
      {
        sourceRows:
          Array.isArray(
            source
          )
            ? source.length
            : 0,

        elapsedMs:
          Date.now() -
          startedAt
      }
    );

    const transformStartedAt = Date.now();
    const result = source
      .filter(item =>
        toStr_(item.idunico) &&
        toNum_(item.cantidad) > 0 &&
        toStrUpper_(item.status) === DOMAIN.STATUS_DISPONIBLE
      )
      .map(item => ({
        idUnico: toStr_(item.idunico),
        sku: toStrUpper_(item.codigo),
        descripcion: toStrUpper_(item.descripcion),
        ubicacionActual: toStrUpper_(item.status),
        balance: toNum_(item.cantidad)
      }))
      .sort((a, b) =>
        String(a.idUnico || "").localeCompare(
          String(b.idUnico || ""),
          "es",
          { numeric: true, sensitivity: "base" }
        )
      );

    _perfBackendMark_(parentTrace, "ACOMODO_TRANSFORM", {
      resultRows: result.length,
      elapsedMs: Date.now() - transformStartedAt
    });

    return result;
  }

  /** Obtiene folios con saldo y ubicación para surtido. */
  function _obtenerFoliosParaSurtido_(parentTrace) {
    const startedAt = Date.now();
    const source = GestorExcedentesService.obtenerExcedentesConsolidados();

    _perfBackendMark_(parentTrace, "SURTIDO_CONSOLIDATION", {
      sourceRows: Array.isArray(source) ? source.length : 0,
      elapsedMs: Date.now() - startedAt
    });

    const transformStartedAt = Date.now();
    const result = source
      .filter(item =>
        toStr_(item.eidUnico) &&
        toNum_(item.esaldo) > 0 &&
        item.conUbicacion === true
      )
      .map(item => ({
        idUnico: toStr_(item.eidUnico),
        sku: toStrUpper_(item.ecodigo),
        descripcion: toStrUpper_(item.edescripcion),
        ubicacionActual: toStrUpper_(item.eserie),
        balance: toNum_(item.esaldo),
        bodegaActual: toStr_(item.ebodegaActual)
      }))
      .sort((a, b) =>
        String(a.idUnico || "").localeCompare(
          String(b.idUnico || ""),
          "es",
          { numeric: true, sensitivity: "base" }
        )
      );

    _perfBackendMark_(parentTrace, "SURTIDO_TRANSFORM", {
      resultRows: result.length,
      elapsedMs: Date.now() - transformStartedAt
    });

    return result;
  }

  /** Consolida los datasets de acomodo y surtido. */
  function _obtenerEstadoFolios_(parentTrace) {
    const acomodo =
    _obtenerFoliosParaAcomodo_(
      parentTrace
    );

    const surtido =
      _obtenerFoliosParaSurtido_(
      parentTrace
    );

    _perfBackendMark_(
      parentTrace,
      "STATE_BUILT",
    {
      acomodo:
        acomodo.length,

      surtido:
        surtido.length
    }
  );

    return {
      acomodo,
      surtido
    };
  }

  

  /** Valida que un folio pertenezca al dataset del tipo solicitado. */
  function _validarFolioPorTipo_(
    idUnico,
    tipo,
    foliosAcomodo,
    foliosSurtido
  ) {
    const id = toStr_(idUnico);
    const type = toStrUpper_(tipo);

    if (!id) {
      throw new Error("No se recibió un ID único válido.");
    }

    if (type === DOMAIN.TIPOS.ACOMODO) {
      const found = foliosAcomodo.find(
        item => toStr_(item.idUnico) === id
      );

      if (!found) {
        throw new Error(
          `El folio "${id}" no está disponible para Acomodo.`
        );
      }

      return found;
    }

    if (type === DOMAIN.TIPOS.SURTIDO) {
      const found = foliosSurtido.find(
        item => toStr_(item.idUnico) === id
      );

      if (!found) {
        throw new Error(
          `El folio "${id}" no está disponible para Surtido.`
        );
      }

      return found;
    }

    throw new Error(
      `No se pudo validar el folio "${id}" para el tipo "${tipo}".`
    );
  }

  /** Construye el contrato inicial requerido por la vista. */
  function _buildBootstrap() {
    const usuarios = _buildUsuarios_();
    const bodegas = _buildBodegas_();
    const mapaUbicacionesExcedentes =
      _buildMapaUbicacionesExcedentes_();
    const estadoFoliosAcomodo = _obtenerFoliosParaAcomodo_();
    const estadoFoliosSurtido = _obtenerFoliosParaSurtido_();

    return {
      usuarios,
      bodegas,
      mapaUbicacionesExcedentes,
      estadoFoliosAcomodo,
      estadoFoliosSurtido,
      estadoFolios: estadoFoliosAcomodo
    };
  }

  // =========================================================
  // PERSISTENCIA
  // =========================================================

  /**
   * Actualiza exclusivamente STATUS. CANTIDAD permanece histórica.
   */
  function _actualizarExcedenteExistente_(rowNumber, payload) {
    const sheet = getSheetByKey_("EXCEDENTES");

    if (!rowNumber || rowNumber < 2) {
      throw new Error(
        "No se recibió una fila válida de BD-EXCEDENTES."
      );
    }

    /*
     * BD-EXCEDENTES.CANTIDAD es la cantidad inicial histórica.
     * Este helper modifica exclusivamente STATUS.
     */
    if (payload && payload.status != null) {
      sheet
        .getRange(
          rowNumber,
          COL.EXCEDENTES.STATUS + 1
        )
        .setValue(
          toStrUpper_(payload.status)
        );
    }
  }

  /** Registra en lote los movimientos aplicados en TRASPASOS. */
  function _appendTraspasoRows_(movimientos, config) {
    if (!Array.isArray(movimientos) || movimientos.length === 0) {
      return;
    }

    const sheet = getSheetByKey_("TRASPASOS");

    const rows = movimientos.map(movement => [
      config.fecha,
      config.hora,
      movement.tipo,
      toStrUpper_(movement.serie),
      toStr_(movement.bodegaSalida),
      toStr_(movement.ubicacionSalida),
      toStr_(movement.bodegaEntrada),
      toStr_(movement.ubicacionEntrada),
      toStrUpper_(movement.solicitante),
      toStrUpper_(movement.codigo),
      toStrUpper_(movement.descripcion),
      Number(movement.cantidad || 0),

      // Columnas reservadas para un proceso futuro.
      "", // FOLIO
      "", // RESPONSABLE

      toStr_(movement.idUnicoBase || "")
    ]);

    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        rows.length,
        15
      )
      .setValues(rows);
  }

  /** Elimina scripts del HTML destinado al canal ONLINE. */
  function _prepararHtmlOnline_(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "");
  }

  /** Genera HTML de etiquetas para saldos parciales confirmados. */
  function _crearHtmlRemanentes_(
    remanentes,
    config,
    modoImpresion
  ) {
    if (!Array.isArray(remanentes) || remanentes.length === 0) {
      return "";
    }

    const template = HtmlService.createTemplateFromFile(
      "EtiquetaExcedentesImpresa"
    );

    template.lote = remanentes.map(item => {
      const saldoEtiqueta = item.saldoActual != null
        ? Number(item.saldoActual)
        : Number(item.cantidad || 0);

      if (
        !Number.isFinite(saldoEtiqueta) ||
        saldoEtiqueta <= 0
      ) {
        throw new Error(
          `No se puede imprimir el folio ` +
          `"${toStr_(item.idUnico)}" con saldo inválido.`
        );
      }

      return {
        codigo: toStrUpper_(item.codigo),
        descripcion: toStrUpper_(item.descripcion),
        cantidad: saldoEtiqueta,
        saldoActual: saldoEtiqueta,
        cantidadInicial: Number(item.cantidadInicial || 0),
        ubicacion: toStrUpper_(item.ubicacionActual),
        id: toStr_(item.idUnico),
        idUnico: toStr_(item.idUnico),
        status: toStrUpper_(
          item.status || DOMAIN.STATUS_PARCIAL
        )
      };
    });

    template.fechaHora = `${config.fecha} ${config.hora}`;
    template.modoImpresion = modoImpresion || "LOCAL";

    return template.evaluate().getContent();
  }

  /** Valida y adapta movimientos al contrato de ExistenciasRepository. */
  function _buildMovimientosExistencias_(
    movimientosTraspaso,
    mapaCatalogo
  ) {
    if (!Array.isArray(movimientosTraspaso)) {
      throw new Error(
        "Los movimientos de traspaso deben ser un arreglo."
      );
    }

    if (!mapaCatalogo || typeof mapaCatalogo !== "object") {
      throw new Error(
        "No se recibió un mapa de catálogo válido."
      );
    }

    return movimientosTraspaso.map((movement, index) => {
      const codigo = toStrUpper_(movement.codigo || "");

      if (!codigo) {
        throw new Error(
          `El movimiento ${index + 1} no tiene código.`
        );
      }

      const producto = mapaCatalogo[codigo];

      if (!producto) {
        throw new Error(
          `El código "${codigo}" no existe en CATALOGO.`
        );
      }

      if (toStrUpper_(producto.status) !== "ACTIVO") {
        throw new Error(
          `El código "${codigo}" no está ACTIVO en CATALOGO.`
        );
      }

      const idproducto = Number(producto.idproducto);

      if (!Number.isInteger(idproducto) || idproducto <= 0) {
        throw new Error(
          `El código "${codigo}" no tiene un IDPRODUCTO válido.`
        );
      }

      const cantidad = Math.abs(Number(movement.cantidad || 0));

      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new Error(
          `Cantidad inválida para el código "${codigo}".`
        );
      }

      const idunico = toStr_(movement.idUnicoBase || "");
      const tipomovimiento = toStrUpper_(movement.tipo || "");
      const bodegasalida = toStrUpper_(movement.bodegaSalida || "");
      const bodegaentrada = toStrUpper_(movement.bodegaEntrada || "");
      const idOperacion = toStr_(movement.idOperacion || "");

      if (!idunico) {
        throw new Error(
          `El movimiento del código "${codigo}" no tiene IDUNICO.`
        );
      }

      if (!tipomovimiento) {
        throw new Error(
          `El movimiento del código "${codigo}" no tiene tipo.`
        );
      }

      if (!bodegasalida || !bodegaentrada) {
        throw new Error(
          `El movimiento del código "${codigo}" no tiene origen o destino válido.`
        );
      }

      if (!idOperacion) {
        throw new Error(
          `El movimiento del código "${codigo}" no tiene idOperacion.`
        );
      }

      return {
        idunico,
        tipomovimiento,
        idproducto,
        codigo,
        cantidad,
        bodegasalida,
        bodegaentrada,
        idOperacion
      };
    });
  }

  // =========================================================
  // API
  // =========================================================

  /**
   * Devuelve el bootstrap de la vista.
   * @return {Object}
   */
  function getBootstrap() {
    return _buildBootstrap();
  }

    /**
   * Invalida cachés operativas usando el mecanismo más completo disponible.
   * @return {*} Resultado del limpiador global o true en el fallback.
   */
  function _limpiarCachesOperacionales_() {
    if (
      typeof clearTraspasosCaches_ ===
        "function"
    ) {
      return clearTraspasosCaches_();
    }

    if (
      typeof clearOperationalCaches_ ===
        "function"
    ) {
      return clearOperationalCaches_();
    }

    if (
      typeof ExcedentesRepository !==
        "undefined" &&
      ExcedentesRepository &&
      typeof ExcedentesRepository
        .clearCache ===
        "function"
    ) {
      ExcedentesRepository
        .clearCache();
    }

    if (
      typeof TraspasosRepository !==
        "undefined" &&
      TraspasosRepository &&
      typeof TraspasosRepository
        .clearCache ===
        "function"
    ) {
      TraspasosRepository
        .clearCache();
    }

    if (
      typeof ExistenciasRepository !==
        "undefined" &&
      ExistenciasRepository &&
      typeof ExistenciasRepository
        .clearCache ===
        "function"
    ) {
      ExistenciasRepository
        .clearCache();
    }

    if (
      typeof GestorExcedentesService !==
        "undefined" &&
      GestorExcedentesService &&
      typeof GestorExcedentesService
        .clearCache ===
        "function"
    ) {
      GestorExcedentesService
        .clearCache();
    }

    return true;
  }

  /**
   * Obtiene el estado de folios con caché y trazabilidad de rendimiento.
   * @param {*} forceRefresh Solo true booleano fuerza reconstrucción.
   * @return {{acomodo:Array<Object>,surtido:Array<Object>}}
   */
  function obtenerEstadoFolios(
    forceRefresh
  ) {
    const trace =
      _perfBackendStart_(
        "TRASPASOS_OBTENER_ESTADO_FOLIOS",
        {
          forceRefresh:
            forceRefresh === true
        }
      );

    try {
      if (forceRefresh === true) {
        const clearStartedAt =
          Date.now();

        _limpiarCachesOperacionales_();

        _perfBackendMark_(
          trace,
          "CACHES_CLEARED",
          {
            elapsedMs:
              Date.now() -
              clearStartedAt
          }
        );
      }

      let result;

      if (
        typeof APPALMACENCache !==
          "undefined" &&
        typeof APPALMACENCache
          .rememberPrototipoFolios ===
          "function"
      ) {
        const cacheStartedAt =
          Date.now();

        let factoryExecuted =
          false;

        result =
          APPALMACENCache
            .rememberPrototipoFolios(
              () => {
                factoryExecuted =
                  true;

                _perfBackendMark_(
                  trace,
                  "CACHE_MISS_FACTORY_START"
                );

                return (
                  _obtenerEstadoFolios_(
                    trace
                  )
                );
              },
              {
                forceRefresh:
                  forceRefresh === true
              }
            );

        _perfBackendMark_(
          trace,
          "CACHE_RESOLVED",
          {
            cacheHit:
              !factoryExecuted,

            elapsedMs:
              Date.now() -
              cacheStartedAt
          }
        );
      } else {
        _perfBackendMark_(
          trace,
          "CACHE_UNAVAILABLE"
        );

        result =
          _obtenerEstadoFolios_(
            trace
          );
      }

      _perfBackendEnd_(
        trace,
        "ok",
        {
          acomodo:
            Array.isArray(
              result &&
              result.acomodo
            )
              ? result.acomodo.length
              : 0,

          surtido:
            Array.isArray(
              result &&
              result.surtido
            )
              ? result.surtido.length
              : 0
        }
      );

      return result;
    } catch (error) {
      _perfBackendMark_(
        trace,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfBackendEnd_(
        trace,
        "error"
      );

      throw error;
    }
  }

  /**
   * Valida y aplica la cola final bajo candado global de inventario.
   *
   * La operación es idempotente por idOperacion. Solo los cambios confirmados
   * en existencias generan bitácora, actualización de STATUS y remanentes.
   *
   * @param {Array<Object>} cola Movimientos enviados por la vista.
   * @return {Object} Resultado operativo y payload opcional de impresión.
   * @throws {Error} Cuando falla validación, bloqueo o persistencia.
   */
  function procesarMovimientosFinal(cola) {
    if (!Array.isArray(cola) || cola.length === 0) {
      throw new Error("La cola de movimientos está vacía.");
    }

    if (!cola.every(item => item && typeof item === "object")) {
      throw new Error("La cola contiene elementos inválidos.");
    }

    const perfMovimiento = _perfMovimientoStart_(
      "TRASPASOS_PROCESAR_MOVIMIENTOS",
      {
        totalMovimientos:
          cola.length,

        acomodos:
          cola.filter(
            item =>
              toStrUpper_(
                item.tipo
              ) ===
              DOMAIN.TIPOS.ACOMODO
          ).length,

        surtidos:
          cola.filter(
            item =>
              toStrUpper_(
                item.tipo
              ) ===
              DOMAIN.TIPOS.SURTIDO
          ).length
      }
    );

    const lock = LockService.getScriptLock();
    const lockRequestId = Utilities.getUuid();
    let locked = false;
    let protectedResult = null;

    try {
      console.log(
        "[TRASPASOS LOCK] Solicitando candado",
        JSON.stringify({
          lockRequestId,
          totalMovimientos: cola.length,
          fecha: new Date().toISOString()
        })
      );

      locked = lock.tryLock(30000);

      if (!locked) {
        throw new Error(
          "Otra operación de inventario está siendo aplicada. " +
          "No se inició este proceso. Intenta nuevamente."
        );
      }

      _perfMovimientoMark_(
        perfMovimiento,
        "LOCK_ACQUIRED",
        {
          lockRequestId:
            lockRequestId
        }
      );

      console.log(
        "[TRASPASOS LOCK] Candado obtenido",
        JSON.stringify({
          lockRequestId,
          fecha: new Date().toISOString()
        })
      );

      const ssExcedentes = getSpreadsheetByFileKey_(
        SHEETS.EXCEDENTES.file
      );

      const config = _obtenerContextoTemporal_(ssExcedentes);

      _perfMovimientoMark_(
        perfMovimiento,
        "TEMPORAL_CONTEXT_READY"
      );

      const solicitantesSet = _buildSolicitantesSet_();

      _perfMovimientoMark_(
        perfMovimiento,
        "SOLICITANTES_READY",
        {
          total:
            solicitantesSet.size
        }
      );

      const mapaCatalogo = _buildMapaCatalogo_();

      _perfMovimientoMark_(
        perfMovimiento,
        "CATALOGO_READY",
        {
          total:
            Object.keys(
              mapaCatalogo
            ).length
        }
      );

      /*
       * Se limpian caches de lectura dentro del candado para volver
       * a validar los saldos vigentes y evitar usar datos obsoletos.
       */
      if (ExcedentesRepository.clearCache) {
        ExcedentesRepository.clearCache();
      }
      if (TraspasosRepository.clearCache) {
        TraspasosRepository.clearCache();
      }
      if (GestorExcedentesService.clearCache) {
        GestorExcedentesService.clearCache();
      }

      _perfMovimientoMark_(
        perfMovimiento,
        "VALIDATION_CACHES_CLEARED"
      );

      const foliosAcomodo = _obtenerFoliosParaAcomodo_();

      _perfMovimientoMark_(
        perfMovimiento,
        "FOLIOS_ACOMODO_READY",
        {
          total:
            foliosAcomodo.length
        }
      );

      const foliosSurtido = _obtenerFoliosParaSurtido_();

      _perfMovimientoMark_(
        perfMovimiento,
        "FOLIOS_SURTIDO_READY",
        {
          total:
            foliosSurtido.length
        }
      );

      const indiceFilasExcedentes =
        _buildIndiceFilasExcedentes_();

      _perfMovimientoMark_(
        perfMovimiento,
        "INDICE_FILAS_EXCEDENTES_READY",
        {
          total:
            indiceFilasExcedentes.size
        }
      );

      const movimientosTraspaso = [];

      const remanentesGenerados = [];

      const actualizacionesStatus = [];

      const operacionesYaAplicadas = [];

      const operacionesNuevas = [];

      cola.forEach((item, index) => {
        const tipo = _validarTipo_(item.tipo);
        const solicitante = _validarSolicitante_(
          item.solicitante,
          solicitantesSet
        );

        const idOperacion = toStr_(
          item.id || item.idOperacion || ""
        );

        if (!idOperacion) {
          throw new Error(
            `El movimiento ${index + 1} no tiene un identificador de operación.`
          );
        }

        /*
        * Evita repetir el mismo idOperacion dentro de la propia cola.
        */
        if (
          operacionesNuevas.some(
            operacion => operacion.idOperacion === idOperacion
          )
        ) {
          throw new Error(
            `La cola contiene el idOperacion duplicado: ${idOperacion}.`
          );
        }

        operacionesNuevas.push({
          idOperacion: idOperacion,
          indice: index
        });

        const idUnicoEscaneado = toStr_(
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

        const sku = toStrUpper_(
          item.sku ||
          (item.idSeleccionado && item.idSeleccionado.sku) ||
          folioActual.sku
        );

        const descripcion = toStrUpper_(
          item.descripcion ||
          (item.idSeleccionado && item.idSeleccionado.descripcion) ||
          folioActual.descripcion
        );

        if (!sku) {
          throw new Error(
            `El folio "${idUnicoEscaneado}" no tiene SKU asociado.`
          );
        }

        if (!descripcion) {
          throw new Error(
            `El folio "${idUnicoEscaneado}" no tiene descripción asociada.`
          );
        }

        const saldoDisponible = round2_(
          Number(folioActual.balance || 0)
        );

        const filaExcedente =
          indiceFilasExcedentes.get(
            idUnicoEscaneado
          ) || null;

        if (!filaExcedente) {
          throw new Error(
            `No se encontró la fila física del folio ` +
            `"${idUnicoEscaneado}" en BD-EXCEDENTES.`
          );
        }

        if (tipo === DOMAIN.TIPOS.ACOMODO) {
          const nuevaUbicacion = toStrUpper_(item.ubicacion);

          if (!nuevaUbicacion) {
            throw new Error(
              `Debes indicar una ubicación destino para el acomodo ` +
              `del folio "${idUnicoEscaneado}".`
            );
          }

          actualizacionesStatus.push({
            idOperacion:
              idOperacion,

            rowNumber:
              filaExcedente.rowNumber,

            status:
              DOMAIN.STATUS_ACOMODADO
          });

          movimientosTraspaso.push({
            tipo: DOMAIN.TIPOS.ACOMODO,
            serie: nuevaUbicacion,
            bodegaSalida: DOMAIN.BODEGA_PRINCIPAL,
            ubicacionSalida: DOMAIN.BODEGA_PRINCIPAL,
            bodegaEntrada: _inferirBodegaPorUbicacion_(nuevaUbicacion),
            ubicacionEntrada: nuevaUbicacion,
            solicitante,
            codigo: sku,
            descripcion,
            cantidad: Math.abs(saldoDisponible),
            idUnicoBase: idUnicoEscaneado,
            idOperacion
          });

          return;
        }

        if (tipo === DOMAIN.TIPOS.SURTIDO) {
          if (
            !Number.isFinite(saldoDisponible) ||
            saldoDisponible <= 0
          ) {
            throw new Error(
              `El folio "${idUnicoEscaneado}" no tiene saldo disponible.`
            );
          }

          const cantidadSurtida = round2_(
            _validarCantidad_(
              item.cantidad,
              saldoDisponible,
              "cantidad surtida"
            )
          );

          const saldoPosterior = round2_(
            saldoDisponible - cantidadSurtida
          );

          if (saldoPosterior < 0) {
            throw new Error(
              `La cantidad solicitada para el folio ` +
              `"${idUnicoEscaneado}" excede el saldo vigente ` +
              `de ${saldoDisponible}.`
            );
          }

          const esParcial = saldoPosterior > 0;
          const statusNuevo = esParcial
            ? DOMAIN.STATUS_PARCIAL
            : DOMAIN.STATUS_SURTIDO;

          const ubicacionActual = toStrUpper_(
            folioActual.ubicacionActual
          );

          const bodegaOrigen =
            toStrUpper_(folioActual.bodegaActual) ||
            _inferirBodegaPorUbicacion_(ubicacionActual);

          actualizacionesStatus.push({
            idOperacion:
              idOperacion,

            rowNumber:
              filaExcedente.rowNumber,

            status:
              statusNuevo
          });

          movimientosTraspaso.push({
            tipo: DOMAIN.TIPOS.SURTIDO,
            serie: ubicacionActual,
            bodegaSalida: bodegaOrigen,
            ubicacionSalida: ubicacionActual,
            bodegaEntrada: DOMAIN.BODEGA_PRINCIPAL,
            ubicacionEntrada: DOMAIN.BODEGA_PRINCIPAL,
            solicitante,
            codigo: sku,
            descripcion,
            cantidad: -Math.abs(cantidadSurtida),
            idUnicoBase: idUnicoEscaneado,
            idOperacion
          });

          if (esParcial) {
            remanentesGenerados.push({
              idOperacion:
                idOperacion,

              idUnico:
                idUnicoEscaneado,

              idproducto:
                toStr_(
                  filaExcedente
                    .item
                    .idproducto
                ),

              codigo:
                sku,

              descripcion:
                descripcion,

              cantidad:
                saldoPosterior,

              cantidadInicial:
                Number(
                  filaExcedente
                    .item
                    .cantidad || 0
                ),

              saldoAnterior:
                saldoDisponible,

              cantidadSurtida:
                cantidadSurtida,

              saldoActual:
                saldoPosterior,

              ubicacionActual:
                ubicacionActual,

              status:
                DOMAIN.STATUS_PARCIAL
            });
          }
        }
      });

      _perfMovimientoMark_(
        perfMovimiento,
        "COLA_VALIDATED_AND_MAPPED",
        {
          movimientos:
            movimientosTraspaso.length,

          remanentes:
            remanentesGenerados.length,

          statuses:
            actualizacionesStatus.length
        }
      );

      const movimientosExistencias = movimientosTraspaso.length > 0
        ? _buildMovimientosExistencias_(
            movimientosTraspaso,
            mapaCatalogo
          )
        : [];

      _perfMovimientoMark_(
        perfMovimiento,
        "EXISTENCIAS_PAYLOAD_READY",
        {
          total:
            movimientosExistencias.length
        }
      );

      let resultadoExistencias = {
        correcto: true,
        recibidos: 0,
        aplicados: 0,
        ignorados: 0,
        cambios: [],
        duplicados: []
      };

      /*
       * Estos arreglos deben existir fuera del bloque if porque
       * también se utilizan al construir protectedResult.
       */
      let movimientosAplicados = [];

      let actualizacionesStatusAplicadas = [];

      let remanentesAplicados = [];

      if (
        movimientosTraspaso.length > 0
      ) {
        /*
         * IMPORTANTE:
         * ExistenciasRepository debe usar idOperacion en su clave
         * de idempotencia. Ver lista de pendientes.
         */
        _perfMovimientoMark_(
          perfMovimiento,
          "EXISTENCIAS_APPLY_START",
          {
            total:
              movimientosExistencias.length
          }
        );

        resultadoExistencias =
          ExistenciasRepository
            .aplicarMovimientosTraspaso(
              movimientosExistencias
            );
        
        const idsOperacionAplicados =
          new Set(
            (
              Array.isArray(
                resultadoExistencias.cambios
              )
                ? resultadoExistencias.cambios
                : []
            )
              .map(function(change) {
                return toStr_(
                  change.idOperacion || ""
                );
              })
              .filter(Boolean)
          );

        const idsOperacionIgnorados =
          new Set(
            (
              Array.isArray(
                resultadoExistencias.duplicados
              )
                ? resultadoExistencias.duplicados
                : []
            )
              .map(function(change) {
                return toStr_(
                  change.idOperacion || ""
                );
              })
              .filter(Boolean)
          );

        movimientosAplicados =
          movimientosTraspaso.filter(
            function(movement) {
              return idsOperacionAplicados.has(
                toStr_(
                  movement.idOperacion || ""
                )
              );
            }
          );

        actualizacionesStatusAplicadas =
          actualizacionesStatus.filter(
            function(update) {
              return idsOperacionAplicados.has(
                toStr_(
                  update.idOperacion || ""
                )
              );
            }
          );

        remanentesAplicados =
          remanentesGenerados.filter(
            function(remanente) {
              return idsOperacionAplicados.has(
                toStr_(
                  remanente.idOperacion || ""
                )
              );
            }
          );

        operacionesYaAplicadas.push.apply(
          operacionesYaAplicadas,
          Array.from(
            idsOperacionIgnorados
          )
        );

        _perfMovimientoMark_(
          perfMovimiento,
          "EXISTENCIAS_APPLY_COMPLETED",
          {
            recibidos:
              Number(
                resultadoExistencias
                  .recibidos || 0
              ),

            aplicados:
              Number(
                resultadoExistencias
                  .aplicados || 0
              ),

            ignorados:
              Number(
                resultadoExistencias
                  .ignorados || 0
              ),

            duplicados:
              Array.isArray(
                resultadoExistencias
                  .duplicados
              )
                ? resultadoExistencias
                    .duplicados.length
                : 0
          }
        );

        

        /*
         * Solo se registra la bitácora cuando la afectación de
         * existencias terminó sin error.
         */
        _appendTraspasoRows_(
          movimientosAplicados,
          config
        );

        _perfMovimientoMark_(
          perfMovimiento,
          "TRASPASOS_APPENDED",
          {
            total:
              movimientosAplicados.length
          }
        );

        /*
         * STATUS se actualiza al final de la fase de escritura.
         * CANTIDAD nunca se modifica.
         */
        actualizacionesStatusAplicadas.forEach(
          function(update) {
            _actualizarExcedenteExistente_(
              update.rowNumber,
              {
                status:
                  update.status
              }
            );
          }
        );

        _perfMovimientoMark_(
          perfMovimiento,
          "STATUSES_UPDATED",
          {
            total:
              actualizacionesStatusAplicadas.length
          }
        );
      }

      _perfMovimientoMark_(
        perfMovimiento,
        "FLUSH_START"
      );

      SpreadsheetApp.flush();

      _perfMovimientoMark_(
        perfMovimiento,
        "FLUSH_COMPLETED"
      );

      protectedResult = {
        config:
          config,

        totalProcesados:
          cola.length,

        totalNuevos:
          movimientosAplicados.length,

        totalYaAplicados:
          operacionesYaAplicadas.length,

        operacionesYaAplicadas:
          operacionesYaAplicadas.slice(),

        remanentesGenerados:
          remanentesAplicados,

        resultadoExistencias:
          resultadoExistencias
      };
    } catch (error) {
      _perfMovimientoMark_(
        perfMovimiento,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfMovimientoEnd_(
        perfMovimiento,
        "error",
        {
          lockRequestId:
            lockRequestId,

          locked:
            locked === true
        }
      );

      throw new Error(
        "No se pudieron procesar los movimientos del prototipo: " +
        (
          error &&
          error.message
            ? error.message
            : String(
                error || ""
              )
        )
      );
    } finally {
      if (locked) {

        _perfMovimientoMark_(
          perfMovimiento,
          "LOCK_WORK_COMPLETED",
          {
            lockRequestId:
              lockRequestId
          }
        );

        console.log(
          "[TRASPASOS LOCK] Liberando candado",
          JSON.stringify({
            lockRequestId,
            fecha: new Date().toISOString()
          })
        );

        lock.releaseLock();
      }
    }

    /*
     * Trabajo que no necesita candado.
     */
    _limpiarCachesOperacionales_();

    _perfMovimientoMark_(
      perfMovimiento,
      "POST_OPERATION_CACHES_CLEARED"
    );

    const config = protectedResult.config;
    const remanentesGenerados = protectedResult.remanentesGenerados;
    const resultadoExistencias = protectedResult.resultadoExistencias;
    const fechaHora = `${config.fecha} ${config.hora}`;

    const htmlImpresion = _crearHtmlRemanentes_(
      remanentesGenerados,
      config,
      "LOCAL"
    );

    const htmlOnline = _prepararHtmlOnline_(
      _crearHtmlRemanentes_(
        remanentesGenerados,
        config,
        "ONLINE"
      )
    );

    const printJob = remanentesGenerados.length > 0
      ? {
          tipo: "SALDO_PARCIAL_TRASPASOS",
          origen: "PrototipoTraspasos",
          formato: "HTML",
          html: htmlOnline,
          content: htmlOnline,
          meta: {
            modulo: "PrototipoTraspasos",
            total: remanentesGenerados.length,
            fechaHora,
            etiqueta: "SALDO_PARCIAL_EXCEDENTE",
            formatoEtiqueta: "HTML",
            papel: "150x100mm"
          }
        }
      : null;

    _perfMovimientoMark_(
      perfMovimiento,
      "PRINT_PAYLOAD_READY",
        {
          remanentes:
            remanentesGenerados.length,

          htmlLocalChars:
            String(
              htmlImpresion || ""
            ).length,

          htmlOnlineChars:
            String(
              htmlOnline || ""
            ).length,

          hasPrintJob:
            Boolean(printJob)
        }
      );

    _perfMovimientoEnd_(
      perfMovimiento,
      "ok",
      {
        totalProcesados:
          protectedResult.totalProcesados,

        totalNuevos:
          protectedResult.totalNuevos,

        totalYaAplicados:
          protectedResult.totalYaAplicados,

        remanentes:
          remanentesGenerados.length,

        existenciasAplicadas:
          Number(
            resultadoExistencias.aplicados || 0
          ),

        existenciasIgnoradas:
          Number(
            resultadoExistencias.ignorados || 0
          )
      }
    );

    return {
      ok: true,

      totalProcesados: protectedResult.totalProcesados,

      totalNuevos: protectedResult.totalNuevos,

      totalYaAplicados: protectedResult.totalYaAplicados,

      operacionesYaAplicadas: protectedResult.operacionesYaAplicadas,

      remanentesGenerados: remanentesGenerados.length,

      existencias: {
        recibidos: Number( resultadoExistencias.recibidos || 0 ),

        aplicados: Number( resultadoExistencias.aplicados || 0 ),

        ignorados: Number( resultadoExistencias.ignorados || 0 ),

        cambios: Array.isArray( resultadoExistencias.cambios ) ? resultadoExistencias.cambios : [],

        duplicados: Array.isArray( resultadoExistencias.duplicados ) ? resultadoExistencias.duplicados : []
      },

      htmlImpresion: htmlImpresion,

      printJob: printJob
    };
  }

  return {
    getBootstrap,
    obtenerEstadoFolios,
    procesarMovimientosFinal
  };
})();
