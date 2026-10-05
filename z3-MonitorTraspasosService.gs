/**
 * MonitorTraspasosService.gs
 * Servicio de dominio para la vista MonitorTraspasos
 */

const MonitorTraspasosService = (() => {

  const DOMAIN = Object.freeze({
    ROLES_RESPONSABLES: ["RESPONSABLE", "ADMIN"]
  });

  function _isPendiente_(item) {
    const folio = toStr_(item.folio);
    const responsable = toStr_(item.responsable);

    return !folio || !responsable;
  }

  function _buildResponsables_() {
    const responsables = UsuariosRepository.getAll()
      .filter(u => DOMAIN.ROLES_RESPONSABLES.includes(toStrUpper_(u.rol)))
      .map(u => toStrUpper_(u.nombre))
      .filter(Boolean);

    return [...new Set(responsables)].sort();
  }

  function _mapPendiente_(item) {
    return {
      fila: item.fila,
      fechatraspaso: item.fechatraspaso ? formatDate_(item.fechatraspaso) : "",
      horatraspaso: item.horatraspaso ? formatTime_(item.horatraspaso) : "",
      tipomovimiento: toStrUpper_(item.tipomovimiento),
      serie: toStr_(item.serie),
      bodegasalida: toStr_(item.bodegasalida),
      ubicacionsalida: toStr_(item.ubicacionsalida),
      bodegaentrada: toStr_(item.bodegaentrada),
      ubicacionentrada: toStr_(item.ubicacionentrada),
      solicitante: toStrUpper_(item.solicitante),
      codigo: toStrUpper_(item.codigo),
      descripcion: toStrUpper_(item.descripcion),
      cantidad: Number(item.cantidad || 0),
      folio: toStr_(item.folio),
      responsable: toStrUpper_(item.responsable),
      idunico: toStr_(item.idunico)
    };
  }

  function _validarFila_(numFila) {
    const fila = Number(numFila);
    if (!fila || isNaN(fila) || fila < 2) {
      throw new Error("La fila indicada no es válida.");
    }
    return fila;
  }

  function _validarFolio_(folio) {
    const valor = toStr_(folio);
    if (!valor) {
      throw new Error("El folio es obligatorio.");
    }
    return valor;
  }

  function _validarResponsable_(responsable, responsablesSet) {
    const valor = toStrUpper_(responsable);

    if (!valor) {
      throw new Error("El responsable es obligatorio.");
    }

    if (!responsablesSet.has(valor)) {
      throw new Error(`El responsable "${valor}" no es válido.`);
    }

    return valor;
  }

  function _getHojaTraspasos_() {
    return getSheetByKey_("TRASPASOS");
  }

  function getBootstrap() {
    return {
      responsables: _buildResponsables_()
    };
  }

  function obtenerPendientes() {
    return TraspasosRepository.getAll()
      .filter(_isPendiente_)
      .sort((a, b) => a.fila - b.fila)
      .map(_mapPendiente_);
  }

  function registrarMovimiento(numFila, folio, responsable) {
    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      lock.waitLock(30000);
      locked = true;

      const fila = _validarFila_(numFila);
      const folioValidado = _validarFolio_(folio);

      const responsables = _buildResponsables_();
      const responsablesSet = new Set(responsables);
      const responsableValidado = _validarResponsable_(responsable, responsablesSet);

      const hoja = _getHojaTraspasos_();
      const ultimaFila = hoja.getLastRow();

      if (fila > ultimaFila) {
        throw new Error(`La fila ${fila} no existe en la hoja de traspasos.`);
      }

      // Leemos folio y responsable actuales para evitar sobrescribir algo ya procesado
      const valoresActuales = hoja
        .getRange(fila, COL.TRASPASOS.FOLIO + 1, 1, 2)
        .getValues()[0];

      const folioActual = toStr_(valoresActuales[0]);
      const responsableActual = toStr_(valoresActuales[1]);

      if (folioActual || responsableActual) {
        throw new Error("Este movimiento ya fue procesado o ya no está pendiente.");
      }

      hoja.getRange(fila, COL.TRASPASOS.FOLIO + 1).setValue(folioValidado);
      hoja.getRange(fila, COL.TRASPASOS.RESPONSABLE + 1).setValue(responsableValidado);

      SpreadsheetApp.flush();

      if (typeof clearOperationalCaches_ === "function") {
        clearOperationalCaches_();
      } else if (typeof TraspasosRepository !== "undefined" && TraspasosRepository.clearCache) {
        TraspasosRepository.clearCache();
      }

      return {
        ok: true,
        mensaje: "✅ Traspaso procesado con éxito.",
        fila: fila,
        folio: folioValidado,
        responsable: responsableValidado
      };

    } catch (error) {
      throw new Error("No se pudo procesar el movimiento: " + error.message);
    } finally {
      if (locked) lock.releaseLock();
    }
  }

  return {
    getBootstrap,
    obtenerPendientes,
    registrarMovimiento
  };

})();
