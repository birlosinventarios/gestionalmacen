/**
 * HistorialTraspasosService.gs
 * Servicio de dominio para la vista HistorialTraspasos
 */

const HistorialTraspasosService = (() => {

  const DOMAIN = Object.freeze({
    BODEGA_PRINCIPAL: "1 - ALMACEN BIRLOS",
    ROLES_RESPONSABLES: ["RESPONSABLE", "ADMIN"]
  });

  function _toSafeStr_(value) {
    return toStr_(value || "");
  }

  function _toSafeUpper_(value) {
    return toStrUpper_(value || "");
  }

  function _toSafeNum_(value) {
    return toNum_(value || 0);
  }

  function _tipoUI_(tipo) {
    const t = _toSafeUpper_(tipo);
    if (t === "ACOMODO") return "Acomodo";
    if (t === "SURTIDO") return "Surtido";
    if (t === "CAMBIO DE BODEGA") return "Cambio de bodega";
    return _toSafeStr_(tipo);
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

  function _buildSolicitantes_() {
    return _buildUsuarios_().map(u => u.nombre);
  }

  function _buildResponsables_() {
    return _buildUsuarios_()
      .filter(u => DOMAIN.ROLES_RESPONSABLES.includes(u.rol))
      .map(u => u.nombre);
  }

  function _buildBodegas_() {
    const bodegas = UbicacionesExcedentesRepository.getBodegas()
      .map(x => _toSafeUpper_(x))
      .filter(Boolean);

    return [...new Set([DOMAIN.BODEGA_PRINCIPAL, ...bodegas])].sort();
  }

  function _buildUbicaciones_() {
    const ubicaciones = UbicacionesExcedentesRepository.getUbicaciones()
      .map(x => _toSafeUpper_(x))
      .filter(Boolean);

    return [...new Set(ubicaciones)].sort();
  }

  function _mapRegistroToView_(item) {
    const fecha = item.fechatraspaso ? formatDate_(item.fechatraspaso) : "";
    const hora = item.horatraspaso ? formatTime_(item.horatraspaso) : "";
    const tipoUI = _tipoUI_(item.tipomovimiento);

    const origen = _toSafeStr_(item.bodegasalida) || "---";
    const destino = _toSafeStr_(item.bodegaentrada) || "---";
    const responsable = _toSafeUpper_(item.responsable) || "Sin asignar";

    return {
      fila: item.fila,
      fecha: fecha || "---",
      hora: hora || "---",
      tipo: tipoUI,
      serie: _toSafeStr_(item.serie) || "---",
      origen: origen,
      uSalida: _toSafeStr_(item.ubicacionsalida) || "---",
      destino: destino,
      uEntrada: _toSafeStr_(item.ubicacionentrada) || "---",
      solicitante: _toSafeUpper_(item.solicitante) || "---",
      codigo: _toSafeUpper_(item.codigo) || "SIN CODIGO",
      descripcion: _toSafeUpper_(item.descripcion) || "",
      cantidad: _toSafeNum_(item.cantidad),
      folio: _toSafeStr_(item.folio),
      responsable: responsable,
      idUnico: _toSafeStr_(item.idunico),
      bodegaOriginal: _toSafeUpper_(item.tipomovimiento) === "ACOMODO"
        ? (_toSafeStr_(item.bodegaentrada) || "GENERAL")
        : (_toSafeStr_(item.bodegasalida) || "GENERAL")
    };
  }

  function _validarFila_(numFila) {
    const fila = Number(numFila);
    if (!fila || isNaN(fila) || fila < 2) {
      throw new Error("La fila indicada no es válida.");
    }
    return fila;
  }

  function _validarSolicitante_(solicitante, solicitantesSet) {
    const valor = _toSafeUpper_(solicitante);
    if (!valor) throw new Error("El solicitante es obligatorio.");
    if (!solicitantesSet.has(valor)) {
      throw new Error(`El solicitante "${valor}" no es válido.`);
    }
    return valor;
  }

  function _validarResponsable_(responsable, responsablesSet) {
    const valor = _toSafeUpper_(responsable);
    if (!valor) throw new Error("El responsable es obligatorio.");
    if (!responsablesSet.has(valor)) {
      throw new Error(`El responsable "${valor}" no es válido.`);
    }
    return valor;
  }

  function _validarBodega_(bodega, bodegasSet, nombreCampo) {
    const valor = _toSafeUpper_(bodega);
    if (!valor) throw new Error(`La ${nombreCampo} es obligatoria.`);
    if (!bodegasSet.has(valor)) {
      throw new Error(`La ${nombreCampo} "${valor}" no es válida.`);
    }
    return valor;
  }

  function _validarSerie_(serie) {
    return _toSafeUpper_(serie);
  }

  function _validarFolio_(folio) {
    return _toSafeStr_(folio);
  }

  function _validarCantidad_(cantidad) {
    const valor = _toSafeNum_(cantidad);
    if (valor <= 0) {
      throw new Error("La cantidad debe ser mayor a cero.");
    }
    return valor;
  }

  function _obtenerSignoCantidadOriginal_(fila) {
    const hoja = getSheetByKey_("TRASPASOS");
    const cantidadActual = hoja.getRange(fila, COL.TRASPASOS.CANTIDAD + 1).getValue();
    const tipoActual = _toSafeUpper_(hoja.getRange(fila, COL.TRASPASOS.TIPOMOVIMIENTO + 1).getValue());

    const n = Number(cantidadActual || 0);

    if (n < 0) return -1;
    if (n > 0) return 1;

    // Fallback si llegara a venir 0 en la hoja
    if (tipoActual === "SURTIDO" || tipoActual === "CAMBIO DE BODEGA") return -1;
    return 1;
  }

  function getBootstrap() {
    return {
      usuarios: _buildUsuarios_(),
      solicitantes: _buildSolicitantes_(),
      responsables: _buildResponsables_(),
      bodegas: _buildBodegas_(),
      ubicaciones: _buildUbicaciones_()
    };
  }

  function obtenerRegistros() {
    return TraspasosRepository.getAll()
      .map(_mapRegistroToView_);
  }

  function actualizarRegistro(numFila, datos) {
    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      lock.waitLock(30000);
      locked = true;

      const fila = _validarFila_(numFila);

      const solicitantesSet = new Set(_buildSolicitantes_());
      const responsablesSet = new Set(_buildResponsables_());
      const bodegasSet = new Set(_buildBodegas_());

      const serie = _validarSerie_(datos.serie);
      const origen = _validarBodega_(datos.origen, bodegasSet, "bodega de salida");
      const destino = _validarBodega_(datos.destino, bodegasSet, "bodega de entrada");
      const solicitante = _validarSolicitante_(datos.solicitante, solicitantesSet);
      const responsable = _validarResponsable_(datos.responsable, responsablesSet);
      const folio = _validarFolio_(datos.folio);
      const cantidadEditada = _validarCantidad_(datos.cantidad);

      const signoOriginal = _obtenerSignoCantidadOriginal_(fila);
      const cantidadFinal = signoOriginal < 0 ? -Math.abs(cantidadEditada) : Math.abs(cantidadEditada);

      const hoja = getSheetByKey_("TRASPASOS");
      const ultimaFila = hoja.getLastRow();

      if (fila > ultimaFila) {
        throw new Error(`La fila ${fila} no existe en la hoja de traspasos.`);
      }

      hoja.getRange(fila, COL.TRASPASOS.SERIE + 1).setValue(serie);
      hoja.getRange(fila, COL.TRASPASOS.BODEGA_SALIDA + 1).setValue(origen);
      hoja.getRange(fila, COL.TRASPASOS.BODEGA_ENTRADA + 1).setValue(destino);
      hoja.getRange(fila, COL.TRASPASOS.SOLICITANTE + 1).setValue(solicitante);
      hoja.getRange(fila, COL.TRASPASOS.CANTIDAD + 1).setValue(cantidadFinal);
      hoja.getRange(fila, COL.TRASPASOS.FOLIO + 1).setValue(folio);
      hoja.getRange(fila, COL.TRASPASOS.RESPONSABLE + 1).setValue(responsable);

      SpreadsheetApp.flush();

      if (typeof TraspasosRepository !== "undefined" && TraspasosRepository.clearCache) {
        TraspasosRepository.clearCache();
      }

      return {
        ok: true,
        mensaje: "✅ Registro actualizado correctamente.",
        fila: fila
      };

    } catch (error) {
      throw new Error("No se pudo actualizar el registro del historial: " + error.message);
    } finally {
      if (locked) lock.releaseLock();
    }
  }

  return {
    getBootstrap,
    obtenerRegistros,
    actualizarRegistro
  };

})();