/**
 * AuditoriaExcedentesService.gs
 * ------------------------------------------------------------
 * Service de auditoría de excedentes
 * Compatible con:
 * - Utilities.gs
 * - CONSTANTS.gs
 * - UbicacionesExcedentesRepository
 * - ExcedentesRepository
 *
 * IMPORTANTE:
 * Este service queda funcional en estructura y flujo,
 * pero la resolución de "esperados por ubicación" queda
 * como dependencia futura, porque el ExcedentesRepository
 * actual no contiene bodega / ubicación por ID único.
 * ------------------------------------------------------------
 */

const AUDITORIA_ESTATUS = Object.freeze({
  EN_CURSO: "EN_CURSO",
  PENDIENTE_CIERRE: "PENDIENTE_CIERRE",
  CERRADA: "CERRADA",
  CANCELADA: "CANCELADA"
});

const AUDITORIA_TIPO = Object.freeze({
  GLOBAL: "GLOBAL",
  POR_BODEGA: "POR_BODEGA"
});

const AUDITORIA_OBS = Object.freeze({
  PENDIENTE: "PENDIENTE",
  VALIDADO: "VALIDADO",
  SOBRANTE: "SOBRANTE",
  FALTANTE_GENERADO_AL_CIERRE: "FALTANTE GENERADO AL CIERRE",
  APERTURA_SIN_ESPERADOS: "APERTURA SIN ESPERADOS"
});

/**
 * ============================================================
 * API PÚBLICA
 * ============================================================
 */

/**
 * Crea el encabezado del evento de auditoría
 * payload:
 * {
 *   auditor: "SIGIFREDO ...",
 *   tipoAuditoria: "GLOBAL" | "POR_BODEGA",
 *   bodegaObjetivo: "BODEGA 1",
 *   observaciones: ""
 * }
 */
function AuditoriaExcedentesService_crearAuditoria(payload) {
  return debugServiceCall_(
    "AuditoriaExcedentesService_crearAuditoria",
    payload,
    () => {
      payload = payload || {};

      const auditor = toStrUpper_(payload.auditor);
      const tipoAuditoria = toStrUpper_(payload.tipoAuditoria);
      const bodegaObjetivoRecibida = toStrUpper_(payload.bodegaObjetivo);
      const observaciones = toStr_(payload.observaciones);

      if (!auditor) {
        throw new Error("Debes indicar el auditor.");
      }

      if (
        tipoAuditoria !== AUDITORIA_TIPO.GLOBAL &&
        tipoAuditoria !== AUDITORIA_TIPO.POR_BODEGA
      ) {
        throw new Error("TipoAuditoria inválido. Usa GLOBAL o POR_BODEGA.");
      }

      if (tipoAuditoria === AUDITORIA_TIPO.POR_BODEGA && !bodegaObjetivoRecibida) {
        throw new Error("Debes seleccionar una bodega objetivo para auditoría POR_BODEGA.");
      }

      const idAuditoria = _auditGenerarIdAuditoria_();
      const now = new Date();
      const fecha = formatDate_(now);
      const horaInicio = formatTime_(now);

      const bodegaObjetivo =
        tipoAuditoria === AUDITORIA_TIPO.GLOBAL
          ? "TODAS"
          : bodegaObjetivoRecibida;

      const idUnicosEsperadosTotales = _auditCalcularIdsEsperadosTotales_(
        tipoAuditoria,
        bodegaObjetivo
      );

      const sh = getSheetByKey_("AUDITORIA_EXCEDENTES");
      const row = _auditBuildRow_(18);

      row[COL.AUDITORIA_EXCEDENTES.IDAUDITORIA] = idAuditoria;
      row[COL.AUDITORIA_EXCEDENTES.FECHA] = fecha;
      row[COL.AUDITORIA_EXCEDENTES.HORAINICIO] = horaInicio;
      row[COL.AUDITORIA_EXCEDENTES.HORAFIN] = "";
      row[COL.AUDITORIA_EXCEDENTES.DURACIONMIN] = "";
      row[COL.AUDITORIA_EXCEDENTES.AUDITOR] = auditor;
      row[COL.AUDITORIA_EXCEDENTES.TIPOAUDITORIA] = tipoAuditoria;
      row[COL.AUDITORIA_EXCEDENTES.BODEGAOBJETIVO] = bodegaObjetivo;
      row[COL.AUDITORIA_EXCEDENTES.ESTATUS] = AUDITORIA_ESTATUS.EN_CURSO;
      row[COL.AUDITORIA_EXCEDENTES.UBICACIONESAUDITADAS] = 0;
      row[COL.AUDITORIA_EXCEDENTES.UBICACIONESCONDIFERENCIA] = 0;
      row[COL.AUDITORIA_EXCEDENTES.IDUNICOS_ESPERADOS_TOTALES] = idUnicosEsperadosTotales;
      row[COL.AUDITORIA_EXCEDENTES.IDUNICOS_ESCANEADOS_TOTALES] = 0;
      row[COL.AUDITORIA_EXCEDENTES.IDUNICOS_CORRECTOS_TOTALES] = 0;
      row[COL.AUDITORIA_EXCEDENTES.IDUNICOS_FALTANTES_TOTALES] = 0;
      row[COL.AUDITORIA_EXCEDENTES.IDUNICOS_SOBRANTES_TOTALES] = 0;
      row[COL.AUDITORIA_EXCEDENTES.CONFIABILIDADTOTAL] = 0;
      row[COL.AUDITORIA_EXCEDENTES.OBSERVACIONES] = observaciones;

      sh.appendRow(row);

      return {
        ok: true,
        idAuditoria,
        fecha,
        horaInicio,
        auditor,
        tipoAuditoria,
        bodegaObjetivo,
        estatus: AUDITORIA_ESTATUS.EN_CURSO,
        idUnicosEsperadosTotales
      };
    }
  );
}

/**
 * Abre una ubicación para auditoría
 * payload:
 * {
 *   idAuditoria: "AUD-...",
 *   idUbicacion: "IDUBICACION_ESCANEADO"
 * }
 *
 * Regla:
 * - valida ubicación
 * - valida que no exista otra ubicación abierta
 * - intenta precargar esperados como PENDIENTE
 */
function AuditoriaExcedentesService_abrirUbicacionAuditoria(payload) {
  return debugServiceCall_(
    "AuditoriaExcedentesService_abrirUbicacionAuditoria",
    payload,
    () => {
      payload = payload || {};

      const idAuditoria = toStrUpper_(payload.idAuditoria);
      const idUbicacion = toStrUpper_(payload.idUbicacion);

      if (!idAuditoria) {
        throw new Error("IdAuditoria es obligatorio.");
      }

      if (!idUbicacion) {
        throw new Error("Debes escanear un ID de ubicación válido.");
      }

      const auditoria = _auditObtenerAuditoriaById_(idAuditoria);
      _auditValidarAuditoriaAbierta_(auditoria);
      _auditValidarSinUbicacionAbierta_(idAuditoria);

      const ubicacionInfo = _auditGetUbicacionById_(idUbicacion);
      if (!ubicacionInfo) {
        throw new Error(`La ubicación ${idUbicacion} no existe en el repositorio de ubicaciones.`);
      }

      const bodega = toStrUpper_(ubicacionInfo.bodega);
      const ubicacion = toStrUpper_(ubicacionInfo.ubicacion);

      if (!bodega || !ubicacion) {
        throw new Error("La ubicación existe, pero no tiene bodega/ubicación válidas.");
      }

      if (
        auditoria.tipoAuditoria === AUDITORIA_TIPO.POR_BODEGA &&
        auditoria.bodegaObjetivo !== bodega
      ) {
        throw new Error(
          `La ubicación ${ubicacion} pertenece a la bodega ${bodega}, fuera del alcance de esta auditoría.`
        );
      }

      const secuenciaUbicacion = _auditSiguienteSecuenciaUbicacion_(idAuditoria);
      const horaInicioUbicacion = formatTime_(new Date());
      const shDetalle = getSheetByKey_("AUDITORIA_EXCEDENTES_DETALLE");

      // IMPORTANTE:
      // Esta función hoy queda preparada, pero la parte de obtener esperados
      // depende de que después conectemos la fuente real de ubicación por IDUNICO.
      const esperados = _auditGetEsperadosByUbicacion_(bodega, ubicacion);

      if (esperados.length > 0) {
        const rows = esperados.map(item => {
          const row = _auditBuildRow_(14);

          row[COL.AUDITORIA_EXCEDENTES_DETALLE.IDAUDITORIA] = idAuditoria;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.SECUENCIAUBICACION] = secuenciaUbicacion;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.BODEGA] = bodega;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.UBICACION] = ubicacion;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAINICIOUBICACION] = horaInicioUbicacion;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAFINUBICACION] = "";
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.IDUNICO] = toStrUpper_(item.idUnico);
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.CODIGO] = toStrUpper_(item.codigo);
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.DESCRIPCION] = toStr_(item.descripcion);
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAESCANEOIDUNICO] = "";
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESCORRECTO] = false;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESFALTANTE] = false;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESSOBRANTE] = false;
          row[COL.AUDITORIA_EXCEDENTES_DETALLE.OBSERVACIONES] = AUDITORIA_OBS.PENDIENTE;

          return row;
        });

        shDetalle
          .getRange(shDetalle.getLastRow() + 1, 1, rows.length, rows[0].length)
          .setValues(rows);
      } else {
        // fila técnica para marcar apertura de ubicación sin esperados
        const row = _auditBuildRow_(14);

        row[COL.AUDITORIA_EXCEDENTES_DETALLE.IDAUDITORIA] = idAuditoria;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.SECUENCIAUBICACION] = secuenciaUbicacion;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.BODEGA] = bodega;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.UBICACION] = ubicacion;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAINICIOUBICACION] = horaInicioUbicacion;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAFINUBICACION] = "";
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.IDUNICO] = "";
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.CODIGO] = "";
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.DESCRIPCION] = "";
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAESCANEOIDUNICO] = "";
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESCORRECTO] = false;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESFALTANTE] = false;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESSOBRANTE] = false;
        row[COL.AUDITORIA_EXCEDENTES_DETALLE.OBSERVACIONES] = AUDITORIA_OBS.APERTURA_SIN_ESPERADOS;

        shDetalle.appendRow(row);
      }

      return {
        ok: true,
        idAuditoria,
        secuenciaUbicacion,
        idUbicacion,
        bodega,
        ubicacion,
        horaInicioUbicacion,
        esperados,
        progreso: _auditGetResumenUbicacion_(idAuditoria, secuenciaUbicacion)
      };
    }
  );
}

/**
 * Registra el escaneo de un ID único
 * payload:
 * {
 *   idAuditoria: "AUD-...",
 *   idUnico: "2026..."
 * }
 *
 * Regla:
 * - si estaba esperado => VALIDADO
 * - si no estaba esperado => SOBRANTE
 */
function AuditoriaExcedentesService_registrarEscaneoAuditoria(payload) {
  return debugServiceCall_(
    "AuditoriaExcedentesService_registrarEscaneoAuditoria",
    payload,
    () => {
      payload = payload || {};

      const idAuditoria = toStrUpper_(payload.idAuditoria);
      const idUnico = toStrUpper_(payload.idUnico);

      if (!idAuditoria) {
        throw new Error("IdAuditoria es obligatorio.");
      }

      if (!idUnico) {
        throw new Error("Debes escanear un ID único válido.");
      }

      const auditoria = _auditObtenerAuditoriaById_(idAuditoria);
      _auditValidarAuditoriaAbierta_(auditoria);

      const ubicacionAbierta = _auditObtenerUbicacionAbierta_(idAuditoria);
      if (!ubicacionAbierta) {
        throw new Error("No hay una ubicación abierta para registrar escaneos.");
      }

      const horaEscaneo = formatTime_(new Date());
      const secuenciaUbicacion = toNum_(ubicacionAbierta.secuenciaUbicacion);
      const data = _auditGetDetalleData_();
      const shDetalle = getSheetByKey_("AUDITORIA_EXCEDENTES_DETALLE");

      const matchEsperado = data.find(item =>
        item.idAuditoria === idAuditoria &&
        toNum_(item.secuenciaUbicacion) === secuenciaUbicacion &&
        item.idUnico === idUnico &&
        item.idUnico !== "" &&
        item.esSobrante !== true
      );

      if (matchEsperado) {
        if (matchEsperado.observaciones === AUDITORIA_OBS.VALIDADO) {
          throw new Error(`El ID único ${idUnico} ya fue validado en esta ubicación.`);
        }

        shDetalle
          .getRange(matchEsperado._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.HORAESCANEOIDUNICO + 1)
          .setValue(horaEscaneo);

        shDetalle
          .getRange(matchEsperado._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.ESCORRECTO + 1)
          .setValue(true);

        shDetalle
          .getRange(matchEsperado._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.ESFALTANTE + 1)
          .setValue(false);

        shDetalle
          .getRange(matchEsperado._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.ESSOBRANTE + 1)
          .setValue(false);

        shDetalle
          .getRange(matchEsperado._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.OBSERVACIONES + 1)
          .setValue(AUDITORIA_OBS.VALIDADO);

        return {
          ok: true,
          idAuditoria,
          secuenciaUbicacion,
          idUnico,
          resultado: "VALIDADO",
          progreso: _auditGetResumenUbicacion_(idAuditoria, secuenciaUbicacion)
        };
      }

      const yaSobrante = data.some(item =>
        item.idAuditoria === idAuditoria &&
        toNum_(item.secuenciaUbicacion) === secuenciaUbicacion &&
        item.idUnico === idUnico &&
        item.esSobrante === true
      );

      if (yaSobrante) {
        throw new Error(`El ID único ${idUnico} ya fue registrado como sobrante en esta ubicación.`);
      }

      const infoId = _auditGetIdUnicoById_(idUnico) || {};
      const row = _auditBuildRow_(14);

      row[COL.AUDITORIA_EXCEDENTES_DETALLE.IDAUDITORIA] = idAuditoria;
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.SECUENCIAUBICACION] = secuenciaUbicacion;
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.BODEGA] = toStrUpper_(ubicacionAbierta.bodega);
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.UBICACION] = toStrUpper_(ubicacionAbierta.ubicacion);
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAINICIOUBICACION] = toStr_(ubicacionAbierta.horaInicioUbicacion);
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAFINUBICACION] = "";
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.IDUNICO] = idUnico;
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.CODIGO] = toStrUpper_(infoId.codigo);
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.DESCRIPCION] = toStr_(infoId.descripcion);
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAESCANEOIDUNICO] = horaEscaneo;
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESCORRECTO] = false;
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESFALTANTE] = false;
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.ESSOBRANTE] = true;
      row[COL.AUDITORIA_EXCEDENTES_DETALLE.OBSERVACIONES] = AUDITORIA_OBS.SOBRANTE;

      shDetalle.appendRow(row);

      return {
        ok: true,
        idAuditoria,
        secuenciaUbicacion,
        idUnico,
        resultado: "SOBRANTE",
        progreso: _auditGetResumenUbicacion_(idAuditoria, secuenciaUbicacion)
      };
    }
  );
}

/**
 * Cierra la ubicación abierta
 * payload:
 * {
 *   idAuditoria: "AUD-...",
 *   idUbicacion: "IDUBICACION_REESCANEADO"
 * }
 *
 * Regla:
 * - valida que el QR cierre la misma ubicación
 * - todo PENDIENTE pasa a FALTANTE
 */
function AuditoriaExcedentesService_cerrarUbicacionAuditoria(payload) {
  return debugServiceCall_(
    "AuditoriaExcedentesService_cerrarUbicacionAuditoria",
    payload,
    () => {
      payload = payload || {};

      const idAuditoria = toStrUpper_(payload.idAuditoria);
      const idUbicacion = toStrUpper_(payload.idUbicacion);

      if (!idAuditoria) {
        throw new Error("IdAuditoria es obligatorio.");
      }

      if (!idUbicacion) {
        throw new Error("Debes reescanear la ubicación para cerrar.");
      }

      const auditoria = _auditObtenerAuditoriaById_(idAuditoria);
      _auditValidarAuditoriaAbierta_(auditoria);

      const ubicacionAbierta = _auditObtenerUbicacionAbierta_(idAuditoria);
      if (!ubicacionAbierta) {
        throw new Error("No hay ubicación abierta para cerrar.");
      }

      const ubicacionInfo = _auditGetUbicacionById_(idUbicacion);
      if (!ubicacionInfo) {
        throw new Error(`La ubicación ${idUbicacion} no existe.`);
      }

      const bodegaEscaneada = toStrUpper_(ubicacionInfo.bodega);
      const ubicacionEscaneada = toStrUpper_(ubicacionInfo.ubicacion);

      if (
        bodegaEscaneada !== toStrUpper_(ubicacionAbierta.bodega) ||
        ubicacionEscaneada !== toStrUpper_(ubicacionAbierta.ubicacion)
      ) {
        throw new Error("La ubicación escaneada para cierre no coincide con la ubicación actualmente abierta.");
      }

      const secuenciaUbicacion = toNum_(ubicacionAbierta.secuenciaUbicacion);
      const horaFinUbicacion = formatTime_(new Date());
      const detalle = _auditGetDetalleData_().filter(item =>
        item.idAuditoria === idAuditoria &&
        toNum_(item.secuenciaUbicacion) === secuenciaUbicacion
      );

      const shDetalle = getSheetByKey_("AUDITORIA_EXCEDENTES_DETALLE");

      detalle.forEach(item => {
        shDetalle
          .getRange(item._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.HORAFINUBICACION + 1)
          .setValue(horaFinUbicacion);

        const esFilaTecnica = !item.idUnico;
        if (esFilaTecnica) return;

        if (
          item.observaciones === AUDITORIA_OBS.PENDIENTE &&
          item.esCorrecto !== true &&
          item.esSobrante !== true
        ) {
          shDetalle
            .getRange(item._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.ESFALTANTE + 1)
            .setValue(true);

          shDetalle
            .getRange(item._rowNumber, COL.AUDITORIA_EXCEDENTES_DETALLE.OBSERVACIONES + 1)
            .setValue(AUDITORIA_OBS.FALTANTE_GENERADO_AL_CIERRE);
        }
      });

      _auditRecalcularTotalesEvento_(idAuditoria);

      return {
        ok: true,
        idAuditoria,
        secuenciaUbicacion,
        bodega: toStrUpper_(ubicacionAbierta.bodega),
        ubicacion: toStrUpper_(ubicacionAbierta.ubicacion),
        horaFinUbicacion,
        resumenUbicacion: _auditGetResumenUbicacion_(idAuditoria, secuenciaUbicacion)
      };
    }
  );
}

/**
 * Cierra la auditoría
 * payload:
 * {
 *   idAuditoria: "AUD-...",
 *   observaciones: ""
 * }
 */
function AuditoriaExcedentesService_cerrarAuditoria(payload) {
  return debugServiceCall_(
    "AuditoriaExcedentesService_cerrarAuditoria",
    payload,
    () => {
      payload = payload || {};

      const idAuditoria = toStrUpper_(payload.idAuditoria);
      const observacionesExtra = toStr_(payload.observaciones);

      if (!idAuditoria) {
        throw new Error("IdAuditoria es obligatorio.");
      }

      const auditoria = _auditObtenerAuditoriaById_(idAuditoria);
      _auditValidarAuditoriaAbierta_(auditoria);

      const ubicacionAbierta = _auditObtenerUbicacionAbierta_(idAuditoria);
      if (ubicacionAbierta) {
        throw new Error(
          `Aún existe una ubicación abierta (${ubicacionAbierta.bodega} / ${ubicacionAbierta.ubicacion}). Debes cerrarla antes de cerrar la auditoría.`
        );
      }

      _auditRecalcularTotalesEvento_(idAuditoria);

      const shAudit = getSheetByKey_("AUDITORIA_EXCEDENTES");
      const auditoriaRecalc = _auditObtenerAuditoriaById_(idAuditoria);

      const horaFin = formatTime_(new Date());
      const duracionMin = _auditCalcularDuracionMin_(
        auditoriaRecalc.fecha,
        auditoriaRecalc.horaInicio,
        horaFin
      );

      shAudit
        .getRange(auditoriaRecalc._rowNumber, COL.AUDITORIA_EXCEDENTES.HORAFIN + 1)
        .setValue(horaFin);

      shAudit
        .getRange(auditoriaRecalc._rowNumber, COL.AUDITORIA_EXCEDENTES.DURACIONMIN + 1)
        .setValue(duracionMin);

      shAudit
        .getRange(auditoriaRecalc._rowNumber, COL.AUDITORIA_EXCEDENTES.ESTATUS + 1)
        .setValue(AUDITORIA_ESTATUS.CERRADA);

      if (observacionesExtra) {
        const actual = toStr_(auditoriaRecalc.observaciones);
        const nuevas = actual ? `${actual} | ${observacionesExtra}` : observacionesExtra;

        shAudit
          .getRange(auditoriaRecalc._rowNumber, COL.AUDITORIA_EXCEDENTES.OBSERVACIONES + 1)
          .setValue(nuevas);
      }

      const cierre = _auditObtenerAuditoriaById_(idAuditoria);

      return {
        ok: true,
        idAuditoria,
        estatus: AUDITORIA_ESTATUS.CERRADA,
        horaFin,
        duracionMin,
        resumen: {
          ubicacionesAuditadas: cierre.ubicacionesAuditadas,
          ubicacionesConDiferencia: cierre.ubicacionesConDiferencia,
          idUnicosEsperadosTotales: cierre.idUnicosEsperadosTotales,
          idUnicosEscaneadosTotales: cierre.idUnicosEscaneadosTotales,
          idUnicosCorrectosTotales: cierre.idUnicosCorrectosTotales,
          idUnicosFaltantesTotales: cierre.idUnicosFaltantesTotales,
          idUnicosSobrantesTotales: cierre.idUnicosSobrantesTotales,
          confiabilidadTotal: cierre.confiabilidadTotal,
          observaciones: cierre.observaciones
        }
      };
    }
  );
}

/**
 * Lista eventos para la vista principal
 */
function AuditoriaExcedentesService_listarEventos(filtros) {
  return debugServiceCall_(
    "AuditoriaExcedentesService_listarEventos",
    filtros,
    () => {
      filtros = filtros || {};

      const fecha = toStr_(filtros.fecha);
      const estatus = toStrUpper_(filtros.estatus);
      const auditor = toStrUpper_(filtros.auditor);

      let rows = _auditGetAuditoriaData_();

      if (fecha) {
        rows = rows.filter(x => toStr_(x.fecha) === fecha);
      }

      if (estatus) {
        rows = rows.filter(x => toStrUpper_(x.estatus) === estatus);
      }

      if (auditor) {
        rows = rows.filter(x => toStrUpper_(x.auditor) === auditor);
      }

      rows.sort((a, b) => {
        const ta = `${toStr_(a.fecha)} ${toStr_(a.horaInicio)}`;
        const tb = `${toStr_(b.fecha)} ${toStr_(b.horaInicio)}`;
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });

      return {
        ok: true,
        items: rows.map(item => ({
          idAuditoria: item.idAuditoria,
          fecha: item.fecha,
          horaInicio: item.horaInicio,
          horaFin: item.horaFin,
          duracionMin: item.duracionMin,
          auditor: item.auditor,
          tipoAuditoria: item.tipoAuditoria,
          bodegaObjetivo: item.bodegaObjetivo,
          estatus: item.estatus,
          ubicacionesAuditadas: item.ubicacionesAuditadas,
          ubicacionesConDiferencia: item.ubicacionesConDiferencia,
          idUnicosEsperadosTotales: item.idUnicosEsperadosTotales,
          idUnicosEscaneadosTotales: item.idUnicosEscaneadosTotales,
          idUnicosCorrectosTotales: item.idUnicosCorrectosTotales,
          idUnicosFaltantesTotales: item.idUnicosFaltantesTotales,
          idUnicosSobrantesTotales: item.idUnicosSobrantesTotales,
          confiabilidadTotal: item.confiabilidadTotal,
          observaciones: item.observaciones
        }))
      };
    }
  );
}

/**
 * ============================================================
 * HELPERS PRIVADOS DEL SERVICE
 * ============================================================
 */

function _auditBuildRow_(length) {
  return Array.from({ length: length }, () => "");
}

function _auditGenerarIdAuditoria_() {
  const now = new Date();
  const stamp = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyyMMdd-HHmmss-SSS"
  );
  return `AUD-${stamp}`;
}

function _auditGetAuditoriaData_() {
  const rows = getRowsByKey_("AUDITORIA_EXCEDENTES");

  return rows.map((r, index) => ({
    _rowNumber: index + 2,
    idAuditoria: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES.IDAUDITORIA]),
    fecha: r[COL.AUDITORIA_EXCEDENTES.FECHA],
    horaInicio: r[COL.AUDITORIA_EXCEDENTES.HORAINICIO],
    horaFin: r[COL.AUDITORIA_EXCEDENTES.HORAFIN],
    duracionMin: r[COL.AUDITORIA_EXCEDENTES.DURACIONMIN],
    auditor: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES.AUDITOR]),
    tipoAuditoria: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES.TIPOAUDITORIA]),
    bodegaObjetivo: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES.BODEGAOBJETIVO]),
    estatus: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES.ESTATUS]),
    ubicacionesAuditadas: toNum_(r[COL.AUDITORIA_EXCEDENTES.UBICACIONESAUDITADAS]),
    ubicacionesConDiferencia: toNum_(r[COL.AUDITORIA_EXCEDENTES.UBICACIONESCONDIFERENCIA]),
    idUnicosEsperadosTotales: toNum_(r[COL.AUDITORIA_EXCEDENTES.IDUNICOS_ESPERADOS_TOTALES]),
    idUnicosEscaneadosTotales: toNum_(r[COL.AUDITORIA_EXCEDENTES.IDUNICOS_ESCANEADOS_TOTALES]),
    idUnicosCorrectosTotales: toNum_(r[COL.AUDITORIA_EXCEDENTES.IDUNICOS_CORRECTOS_TOTALES]),
    idUnicosFaltantesTotales: toNum_(r[COL.AUDITORIA_EXCEDENTES.IDUNICOS_FALTANTES_TOTALES]),
    idUnicosSobrantesTotales: toNum_(r[COL.AUDITORIA_EXCEDENTES.IDUNICOS_SOBRANTES_TOTALES]),
    confiabilidadTotal: toNum_(r[COL.AUDITORIA_EXCEDENTES.CONFIABILIDADTOTAL]),
    observaciones: toStr_(r[COL.AUDITORIA_EXCEDENTES.OBSERVACIONES])
  }));
}

function _auditGetDetalleData_() {
  const rows = getRowsByKey_("AUDITORIA_EXCEDENTES_DETALLE");

  return rows.map((r, index) => ({
    _rowNumber: index + 2,
    idAuditoria: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.IDAUDITORIA]),
    secuenciaUbicacion: toNum_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.SECUENCIAUBICACION]),
    bodega: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.BODEGA]),
    ubicacion: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.UBICACION]),
    horaInicioUbicacion: toStr_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAINICIOUBICACION]),
    horaFinUbicacion: toStr_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAFINUBICACION]),
    idUnico: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.IDUNICO]),
    codigo: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.CODIGO]),
    descripcion: toStr_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.DESCRIPCION]),
    horaEscaneoIdUnico: toStr_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.HORAESCANEOIDUNICO]),
    esCorrecto: r[COL.AUDITORIA_EXCEDENTES_DETALLE.ESCORRECTO] === true,
    esFaltante: r[COL.AUDITORIA_EXCEDENTES_DETALLE.ESFALTANTE] === true,
    esSobrante: r[COL.AUDITORIA_EXCEDENTES_DETALLE.ESSOBRANTE] === true,
    observaciones: toStrUpper_(r[COL.AUDITORIA_EXCEDENTES_DETALLE.OBSERVACIONES])
  }));
}

function _auditObtenerAuditoriaById_(idAuditoria) {
  const auditoria = _auditGetAuditoriaData_().find(
    x => x.idAuditoria === toStrUpper_(idAuditoria)
  );

  if (!auditoria) {
    throw new Error(`No existe la auditoría ${idAuditoria}.`);
  }

  return auditoria;
}

function _auditValidarAuditoriaAbierta_(auditoria) {
  const estatus = toStrUpper_(auditoria.estatus);

  if (
    estatus !== AUDITORIA_ESTATUS.EN_CURSO &&
    estatus !== AUDITORIA_ESTATUS.PENDIENTE_CIERRE
  ) {
    throw new Error(`La auditoría no está abierta. Estatus actual: ${estatus || "SIN ESTATUS"}.`);
  }
}

function _auditObtenerUbicacionAbierta_(idAuditoria) {
  const data = _auditGetDetalleData_().filter(
    x => x.idAuditoria === toStrUpper_(idAuditoria)
  );

  if (data.length === 0) return null;

  const sinCerrar = data
    .filter(x => !toStr_(x.horaFinUbicacion))
    .sort((a, b) => b.secuenciaUbicacion - a.secuenciaUbicacion);

  if (sinCerrar.length === 0) return null;

  const item = sinCerrar[0];
  return {
    secuenciaUbicacion: item.secuenciaUbicacion,
    bodega: item.bodega,
    ubicacion: item.ubicacion,
    horaInicioUbicacion: item.horaInicioUbicacion
  };
}

function _auditValidarSinUbicacionAbierta_(idAuditoria) {
  const abierta = _auditObtenerUbicacionAbierta_(idAuditoria);
  if (abierta) {
    throw new Error(
      `Ya existe una ubicación abierta en esta auditoría: ${abierta.bodega} / ${abierta.ubicacion}.`
    );
  }
}

function _auditSiguienteSecuenciaUbicacion_(idAuditoria) {
  const data = _auditGetDetalleData_().filter(
    x => x.idAuditoria === toStrUpper_(idAuditoria)
  );

  if (data.length === 0) return 1;

  return Math.max.apply(
    null,
    data.map(x => toNum_(x.secuenciaUbicacion))
  ) + 1;
}

function _auditCalcularDuracionMin_(fecha, horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return "";

  const d = toDate_(fecha);
  const t1 = toTime_(horaInicio);
  const t2 = toTime_(horaFin);

  if (!d || !t1 || !t2) return "";

  const inicio = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    t1.getHours(),
    t1.getMinutes(),
    t1.getSeconds()
  );

  const fin = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    t2.getHours(),
    t2.getMinutes(),
    t2.getSeconds()
  );

  const diffMs = fin.getTime() - inicio.getTime();
  if (diffMs < 0) return "";

  return Math.round(diffMs / 60000);
}

function _auditCalcularIdsEsperadosTotales_(tipoAuditoria, bodegaObjetivo) {
  // Si después implementas un método explícito, se usa
  if (typeof ExcedentesRepository.countEsperadosAuditoria === "function") {
    return toNum_(ExcedentesRepository.countEsperadosAuditoria(tipoAuditoria, bodegaObjetivo));
  }

  if (typeof ExcedentesRepository.getEsperadosByBodega === "function" && tipoAuditoria === AUDITORIA_TIPO.POR_BODEGA) {
    return (ExcedentesRepository.getEsperadosByBodega(bodegaObjetivo) || []).length;
  }

  if (typeof ExcedentesRepository.getEsperadosGlobal === "function" && tipoAuditoria === AUDITORIA_TIPO.GLOBAL) {
    return (ExcedentesRepository.getEsperadosGlobal() || []).length;
  }

  // Mientras no exista esa lógica, dejamos 0 transparente
  return 0;
}

function _auditGetUbicacionById_(idUbicacion) {
  if (!UbicacionesExcedentesRepository || typeof UbicacionesExcedentesRepository.getAll !== "function") {
    throw new Error("UbicacionesExcedentesRepository no está disponible.");
  }

  const idBuscado = toNum_(idUbicacion);

  return UbicacionesExcedentesRepository.getAll().find(
    x => toNum_(x.idubicacionesexcedentes) === idBuscado
  ) || null;
}

function _auditGetEsperadosByUbicacion_(bodega, ubicacion) {
  /**
   * IMPORTANTE:
   * Aquí hoy NO puedo resolver correctamente los esperados por ubicación
   * porque tu ExcedentesRepository actual NO contiene bodega / ubicación.
   *
   * Este método queda preparado para el momento en que:
   * - ExcedentesRepository exponga los esperados por ubicación, o
   * - exista otra fuente que relacione idunico -> bodega/ubicacion
   */

  if (typeof ExcedentesRepository.getEsperadosByBodegaYUbicacion === "function") {
    return (ExcedentesRepository.getEsperadosByBodegaYUbicacion(bodega, ubicacion) || []).map(item => ({
      idUnico: toStrUpper_(item.idunico || item.idUnico),
      codigo: toStrUpper_(item.codigo),
      descripcion: toStr_(item.descripcion)
    }));
  }

  // Por ahora transparente: sin inventar datos
  return [];
}

function _auditGetIdUnicoById_(idUnico) {
  if (!ExcedentesRepository || typeof ExcedentesRepository.getPorIdUnico !== "function") {
    return null;
  }

  const rows = ExcedentesRepository.getPorIdUnico(idUnico) || [];
  if (!rows.length) return null;

  return rows[0];
}

function _auditGetResumenUbicacion_(idAuditoria, secuenciaUbicacion) {
  const detalle = _auditGetDetalleData_().filter(
    x =>
      x.idAuditoria === toStrUpper_(idAuditoria) &&
      toNum_(x.secuenciaUbicacion) === toNum_(secuenciaUbicacion)
  );

  const reales = detalle.filter(x => !!x.idUnico);

  const esperados = reales.filter(x => x.esSobrante !== true).length;
  const correctos = reales.filter(x => x.esCorrecto === true).length;
  const faltantes = reales.filter(x => x.esFaltante === true).length;
  const sobrantes = reales.filter(x => x.esSobrante === true).length;
  const escaneados = correctos + sobrantes;

  const confiabilidad =
    esperados > 0 ? Number(((correctos / esperados) * 100).toFixed(2)) : 0;

  return {
    secuenciaUbicacion: toNum_(secuenciaUbicacion),
    esperados,
    escaneados,
    correctos,
    faltantes,
    sobrantes,
    confiabilidad,
    tieneDiferencia: faltantes > 0 || sobrantes > 0
  };
}

function _auditRecalcularTotalesEvento_(idAuditoria) {
  const auditoria = _auditObtenerAuditoriaById_(idAuditoria);
  const shAudit = getSheetByKey_("AUDITORIA_EXCEDENTES");
  const detalle = _auditGetDetalleData_().filter(
    x => x.idAuditoria === toStrUpper_(idAuditoria)
  );

  const secuencias = [...new Set(detalle.map(x => toNum_(x.secuenciaUbicacion)).filter(Boolean))];
  const resumenes = secuencias.map(sec => _auditGetResumenUbicacion_(idAuditoria, sec));

  const ubicacionesAuditadas = resumenes.length;
  const ubicacionesConDiferencia = resumenes.filter(x => x.tieneDiferencia).length;
  const idUnicosEscaneadosTotales = resumenes.reduce((acc, x) => acc + x.escaneados, 0);
  const idUnicosCorrectosTotales = resumenes.reduce((acc, x) => acc + x.correctos, 0);
  const idUnicosFaltantesTotales = resumenes.reduce((acc, x) => acc + x.faltantes, 0);
  const idUnicosSobrantesTotales = resumenes.reduce((acc, x) => acc + x.sobrantes, 0);

  const esperadosTotales = toNum_(auditoria.idUnicosEsperadosTotales);
  const confiabilidadTotal =
    esperadosTotales > 0
      ? Number(((idUnicosCorrectosTotales / esperadosTotales) * 100).toFixed(2))
      : 0;

  shAudit
    .getRange(auditoria._rowNumber, COL.AUDITORIA_EXCEDENTES.UBICACIONESAUDITADAS + 1)
    .setValue(ubicacionesAuditadas);

  shAudit
    .getRange(auditoria._rowNumber, COL.AUDITORIA_EXCEDENTES.UBICACIONESCONDIFERENCIA + 1)
    .setValue(ubicacionesConDiferencia);

  shAudit
    .getRange(auditoria._rowNumber, COL.AUDITORIA_EXCEDENTES.IDUNICOS_ESCANEADOS_TOTALES + 1)
    .setValue(idUnicosEscaneadosTotales);

  shAudit
    .getRange(auditoria._rowNumber, COL.AUDITORIA_EXCEDENTES.IDUNICOS_CORRECTOS_TOTALES + 1)
    .setValue(idUnicosCorrectosTotales);

  shAudit
    .getRange(auditoria._rowNumber, COL.AUDITORIA_EXCEDENTES.IDUNICOS_FALTANTES_TOTALES + 1)
    .setValue(idUnicosFaltantesTotales);

  shAudit
    .getRange(auditoria._rowNumber, COL.AUDITORIA_EXCEDENTES.IDUNICOS_SOBRANTES_TOTALES + 1)
    .setValue(idUnicosSobrantesTotales);

  shAudit
    .getRange(auditoria._rowNumber, COL.AUDITORIA_EXCEDENTES.CONFIABILIDADTOTAL + 1)
    .setValue(confiabilidadTotal);
}