/**
 * AuditoriaExcedentesDetalleService.gs
 * Versión corregida y consolidada.
 *
 * Correcciones principales:
 * - Usa fmtTimeNow_() para registrar horas actuales.
 * - Distingue marcador abierto, cerrado y último marcador.
 * - Evita reabrir accidentalmente ubicaciones cerradas.
 * - Normaliza y deduplica IdÚnico al calcular resúmenes.
 */
const AuditoriaExcedentesDetalleService = (() => {
  const STATUS = Object.freeze({
    ABIERTA: "ABIERTA",
    CERRADA: "CERRADA"
  });

  const TIPOS_AUDITORIA = Object.freeze({
    GLOBAL: "GLOBAL",
    POR_BODEGA: "POR_BODEGA"
  });

  function _getAuditoriaOrThrow_(idAuditoria, requireOpen) {
    const id = toStr_(idAuditoria);
    if (!id) throw new Error("Se requiere IdAuditoria.");

    const audit = AuditoriaExcedentesRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesRepository.getByIdAuditoriaFresh(id)
      : AuditoriaExcedentesRepository.getByIdAuditoria(id);

    if (!audit) throw new Error(`No existe la auditoría ${id}`);

    if (requireOpen !== false && toStrUpper_(audit.estatus) !== STATUS.ABIERTA) {
      throw new Error(`La auditoría ${id} no está ABIERTA`);
    }

    return audit;
  }

  function _getDetalleByAuditoria_(idAuditoria, fresh) {
    const id = toStr_(idAuditoria);
    if (!id) return [];

    if (fresh !== false && AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh) {
      return AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(id) || [];
    }

    return AuditoriaExcedentesDetalleRepository.getByIdAuditoria(id) || [];
  }

  function _getDetallesUbicacion_(idAuditoria, ubicacion, fresh) {
    const id = toStr_(idAuditoria);
    const ubi = toStrUpper_(ubicacion);

    return _getDetalleByAuditoria_(id, fresh).filter(item =>
      toStrUpper_(item.ubicacion) === ubi
    );
  }

  function _getMarcadoresUbicacion_(idAuditoria, ubicacion, fresh) {
    return _getDetallesUbicacion_(idAuditoria, ubicacion, fresh)
      .filter(item => !toStr_(item.idunico) && item.horainicioubicacion)
      .sort((a, b) => {
        const seq = toNum_(b.secuenciaubicacion) - toNum_(a.secuenciaubicacion);
        if (seq !== 0) return seq;
        return toNum_(b._rowNumber) - toNum_(a._rowNumber);
      });
  }

  function _getMarcadorAbiertoUbicacion_(idAuditoria, ubicacion, fresh) {
    return _getMarcadoresUbicacion_(idAuditoria, ubicacion, fresh)
      .find(item => !item.horafinubicacion) || null;
  }

  function _getUltimoMarcadorUbicacion_(idAuditoria, ubicacion, fresh) {
    return _getMarcadoresUbicacion_(idAuditoria, ubicacion, fresh)[0] || null;
  }

  function _getSecuenciaSiguiente_(idAuditoria) {
    return _getDetalleByAuditoria_(idAuditoria, true).reduce(
      (max, item) => Math.max(max, toNum_(item.secuenciaubicacion)),
      0
    ) + 1;
  }

  function _esUbicacionDentroDelAlcance_(auditoria, ubicacion, bodegaInferida) {
    const tipo = toStrUpper_(auditoria.tipoauditoria);
    if (tipo === TIPOS_AUDITORIA.GLOBAL) return true;

    if (tipo === TIPOS_AUDITORIA.POR_BODEGA) {
      return normalizeWarehouseToken_(bodegaInferida) ===
        normalizeWarehouseToken_(auditoria.bodegaobjetivo);
    }

    return false;
  }

  function _getEsperadosPorUbicacion_(auditoria, ubicacion) {
    const tipo = toStrUpper_(auditoria.tipoauditoria);
    const config = tipo === TIPOS_AUDITORIA.POR_BODEGA
      ? {
          tipoAuditoria: TIPOS_AUDITORIA.POR_BODEGA,
          bodegaObjetivo: toStrUpper_(auditoria.bodegaobjetivo)
        }
      : {
          tipoAuditoria: TIPOS_AUDITORIA.GLOBAL,
          bodegaObjetivo: "TODAS"
        };

    const ubi = toStrUpper_(ubicacion);
    return (EstadoActualExcedentesService.getAuditables(config) || []).filter(item =>
      toStrUpper_(item.ubicacionActual || item.ubicacion) === ubi
    );
  }

  function _uniqueRowsById_(rows) {
    const map = {};
    (rows || []).forEach(row => {
      const id = toStrUpper_(row.idunico);
      if (id && !map[id]) map[id] = row;
    });
    return Object.values(map);
  }

  function _buildResumenUbicacion_(idauditoria, ubicacion) {
    const items = _getDetallesUbicacion_(idauditoria, ubicacion, true);
    const markers = items.filter(item => !item.idunico && item.horainicioubicacion);
    const marcadorAbierto = markers.find(item => !item.horafinubicacion) || null;
    const marcadorCerrado = markers.find(item => item.horafinubicacion) || null;
    const filasConId = items.filter(item => item.idunico);

    const correctos = _uniqueRowsById_(filasConId.filter(item => item.escorrecto === true));
    const faltantes = _uniqueRowsById_(filasConId.filter(item => item.esfaltante === true));
    const sobrantes = _uniqueRowsById_(filasConId.filter(item => item.essobrante === true));
    const escaneados = _uniqueRowsById_(filasConId.filter(item => item.esfaltante !== true));

    return {
      idauditoria: toStr_(idauditoria),
      ubicacion: toStrUpper_(ubicacion),
      abierta: !!marcadorAbierto,
      cerrada: !!marcadorCerrado && !marcadorAbierto,
      esperados: correctos.length + faltantes.length,
      escaneados: escaneados.length,
      correctos: correctos.length,
      faltantes: faltantes.length,
      sobrantes: sobrantes.length,
      tieneDiferencia: faltantes.length > 0 || sobrantes.length > 0,
      totalRegistros: items.length,
      totalFilasConId: filasConId.length
    };
  }

  function abrirUbicacion(payload) {
    payload = payload || {};
    const idauditoria = toStr_(payload.idauditoria);
    const ubicacion = toStrUpper_(payload.ubicacion);

    if (!idauditoria) throw new Error("abrirUbicacion() requiere payload.idauditoria");
    if (!ubicacion) throw new Error("abrirUbicacion() requiere payload.ubicacion");

    const auditoria = _getAuditoriaOrThrow_(idauditoria, true);
    const markerOpen = _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion, true);

    if (markerOpen) {
      return {
        ok: true,
        mensaje: "La ubicación ya estaba abierta",
        marcador: markerOpen,
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    const lastMarker = _getUltimoMarcadorUbicacion_(idauditoria, ubicacion, true);
    if (lastMarker && lastMarker.horafinubicacion) {
      throw new Error(`La ubicación ${ubicacion} ya fue cerrada en esta auditoría.`);
    }

    const bodega = inferWarehouseByLocation_(ubicacion, "");
    if (!_esUbicacionDentroDelAlcance_(auditoria, ubicacion, bodega)) {
      throw new Error(`La ubicación ${ubicacion} no pertenece al alcance de la auditoría`);
    }

    const marker = AuditoriaExcedentesDetalleRepository.insert({
      idauditoria,
      secuenciaubicacion: _getSecuenciaSiguiente_(idauditoria),
      bodega,
      ubicacion,
      horainicioubicacion: fmtTimeNow_(),
      horafinubicacion: "",
      idunico: "",
      codigo: "",
      descripcion: "",
      horaescaneoidunico: "",
      escorrecto: false,
      esfaltante: false,
      essobrante: false,
      observaciones: toStr_(payload.observaciones)
    });

    return {
      ok: true,
      mensaje: "Ubicación abierta correctamente",
      marcador: marker,
      resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
    };
  }

  function obtenerEsperadosPorUbicacion(idauditoria, ubicacion) {
    const audit = _getAuditoriaOrThrow_(idauditoria, true);
    const data = _getEsperadosPorUbicacion_(audit, ubicacion);

    return {
      idauditoria: toStr_(idauditoria),
      ubicacion: toStrUpper_(ubicacion),
      totalEsperados: data.length,
      data: clonePlain_(data)
    };
  }

  function registrarEscaneoIdUnico(payload) {
    payload = payload || {};
    const idauditoria = toStr_(payload.idauditoria);
    const ubicacion = toStrUpper_(payload.ubicacion);
    const idunico = toStrUpper_(payload.idunico);

    if (!idauditoria) throw new Error("registrarEscaneoIdUnico() requiere payload.idauditoria");
    if (!ubicacion) throw new Error("registrarEscaneoIdUnico() requiere payload.ubicacion");
    if (!idunico) throw new Error("registrarEscaneoIdUnico() requiere payload.idunico");

    const audit = _getAuditoriaOrThrow_(idauditoria, true);
    let marker = _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion, true);

    if (!marker) {
      abrirUbicacion({ idauditoria, ubicacion });
      marker = _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion, true);
    }

    if (!marker) throw new Error(`No se pudo abrir la ubicación ${ubicacion}.`);

    const already = AuditoriaExcedentesDetalleRepository.findEscaneo(idauditoria, idunico);
    if (already) {
      const mismaUbicacion = toStrUpper_(already.ubicacion) === ubicacion;
      return {
        ok: false,
        duplicado: true,
        tipoResultado: mismaUbicacion ? "DUPLICADO_EN_UBICACION" : "DUPLICADO_EN_AUDITORIA",
        mensaje: mismaUbicacion
          ? `El IdUnico ${idunico} ya fue escaneado en esta ubicación`
          : `El IdUnico ${idunico} ya fue escaneado dentro de la auditoría`,
        registroExistente: already,
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    const actual = EstadoActualExcedentesService.getUnoPorIdUnico(idunico);
    const ubicacionActual = toStrUpper_(actual && (actual.ubicacionActual || actual.ubicacion));
    const bodegaActual = toStrUpper_(actual && (actual.bodegaActual || actual.bodega));
    const esCorrecto = !!actual &&
      _esUbicacionDentroDelAlcance_(audit, ubicacionActual, bodegaActual) &&
      ubicacionActual === ubicacion;

    const observaciones = !actual
      ? "IDUNICO NO ENCONTRADO EN ESTADO ACTUAL"
      : esCorrecto
        ? ""
        : `ESPERADO EN ${ubicacionActual || "SIN UBICACIÓN"}`;

    const registro = AuditoriaExcedentesDetalleRepository.insert({
      idauditoria,
      secuenciaubicacion: marker.secuenciaubicacion,
      bodega: inferWarehouseByLocation_(ubicacion, marker.bodega || ""),
      ubicacion,
      horainicioubicacion: "",
      horafinubicacion: "",
      idunico,
      codigo: toStrUpper_(actual && actual.codigo),
      descripcion: toStrUpper_(actual && actual.descripcion),
      horaescaneoidunico: fmtTimeNow_(),
      escorrecto: esCorrecto,
      esfaltante: false,
      essobrante: !esCorrecto,
      observaciones
    });

    return {
      ok: true,
      tipoResultado: esCorrecto ? "CORRECTO" : "SOBRANTE",
      mensaje: esCorrecto ? "Escaneo correcto" : "Escaneo registrado como sobrante",
      registro,
      actual,
      resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
    };
  }

  function cerrarUbicacion(payload) {
    payload = payload || {};
    const idauditoria = toStr_(payload.idauditoria);
    const ubicacion = toStrUpper_(payload.ubicacion);
    const observaciones = toStr_(payload.observaciones);

    if (!idauditoria) throw new Error("cerrarUbicacion() requiere payload.idauditoria");
    if (!ubicacion) throw new Error("cerrarUbicacion() requiere payload.ubicacion");

    const audit = _getAuditoriaOrThrow_(idauditoria, true);
    const marker = _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion, true);

    if (!marker) {
      const last = _getUltimoMarcadorUbicacion_(idauditoria, ubicacion, true);
      if (last && last.horafinubicacion) {
        return {
          ok: true,
          mensaje: "La ubicación ya estaba cerrada",
          resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
        };
      }
      throw new Error(`La ubicación ${ubicacion} no ha sido abierta en esta auditoría`);
    }

    const esperados = _getEsperadosPorUbicacion_(audit, ubicacion);
    const escaneados = AuditoriaExcedentesDetalleRepository
      .getEscaneadosByAuditoriaYUbicacion(idauditoria, ubicacion);
    const idsEscaneados = new Set(
      escaneados.map(item => toStrUpper_(item.idunico)).filter(Boolean)
    );

    const faltantes = esperados.filter(item =>
      !idsEscaneados.has(toStrUpper_(item.idUnico || item.idunico))
    );

    if (faltantes.length) {
      AuditoriaExcedentesDetalleRepository.insertMany(
        faltantes.map(item => ({
          idauditoria,
          secuenciaubicacion: marker.secuenciaubicacion,
          bodega: toStrUpper_(item.bodegaActual || item.bodega || marker.bodega),
          ubicacion,
          horainicioubicacion: "",
          horafinubicacion: "",
          idunico: toStrUpper_(item.idUnico || item.idunico),
          codigo: toStrUpper_(item.codigo),
          descripcion: toStrUpper_(item.descripcion),
          horaescaneoidunico: "",
          escorrecto: false,
          esfaltante: true,
          essobrante: false,
          observaciones: "NO ESCANEADO AL CERRAR UBICACIÓN"
        }))
      );
    }

    AuditoriaExcedentesDetalleRepository.updateByRowNumber(marker._rowNumber, {
      horafinubicacion: fmtTimeNow_(),
      observaciones: observaciones || marker.observaciones || ""
    });

    return {
      ok: true,
      mensaje: "Ubicación cerrada correctamente",
      totalEsperados: esperados.length,
      totalEscaneados: escaneados.length,
      totalFaltantesGenerados: faltantes.length,
      resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
    };
  }

  function getDetalleUbicacion(idauditoria, ubicacion) {
    const data = _getDetallesUbicacion_(idauditoria, ubicacion, true);
    return {
      idauditoria: toStr_(idauditoria),
      ubicacion: toStrUpper_(ubicacion),
      resumen: _buildResumenUbicacion_(idauditoria, ubicacion),
      data,
      detalle: data
    };
  }

  function listarUbicacionesAuditadas(
  idauditoria
) {
  const detalles =
    _getDetalleByAuditoria_(
      idauditoria,
      true
    );

  const map = {};

  detalles.forEach(
    item => {
      const ubi =
        toStrUpper_(
          item.ubicacion
        );

      if (!ubi) {
        return;
      }

      if (!map[ubi]) {
        map[ubi] = {
          ubicacion:
            ubi,

          bodega:
            toStrUpper_(
              item.bodega
            ),

          secuenciaubicacion:
            toNum_(
              item.secuenciaubicacion
            ),

          abierta:
            false,

          cerrada:
            false,

          tieneActividad:
            false,

          marcadorIncompleto:
            false
        };
      }

      map[ubi].secuenciaubicacion =
        Math.max(
          map[ubi]
            .secuenciaubicacion,

          toNum_(
            item.secuenciaubicacion
          )
        );

      if (
        item.idunico
      ) {
        map[ubi].tieneActividad =
          true;
      }

      if (
        !item.idunico
      ) {
        if (
          item.horainicioubicacion &&
          !item.horafinubicacion
        ) {
          map[ubi].abierta =
            true;
        }

        if (
          item.horainicioubicacion &&
          item.horafinubicacion
        ) {
          map[ubi].cerrada =
            true;
        }

        if (
          !item.horainicioubicacion
        ) {
          map[ubi].marcadorIncompleto =
            true;
        }
      }
    }
  );

  return Object.values(
    map
  )
    .filter(
      item =>
        item.abierta ||
        item.cerrada ||
        item.tieneActividad
    )
    .sort(
      (a, b) =>
        a.secuenciaubicacion -
          b.secuenciaubicacion ||
        compareEs_(
          a.ubicacion,
          b.ubicacion
        )
    );
}

  function listarUbicacionesAbiertas(idauditoria) {
    return _getDetalleByAuditoria_(idauditoria, true)
      .filter(item => !item.idunico && item.horainicioubicacion && !item.horafinubicacion)
      .map(item => ({
        ubicacion: item.ubicacion,
        bodega: item.bodega,
        secuenciaubicacion: item.secuenciaubicacion,
        horainicioubicacion: item.horainicioubicacion
      }));
  }

  return {
    abrirUbicacion,
    obtenerEsperadosPorUbicacion,
    registrarEscaneoIdUnico,
    cerrarUbicacion,
    getDetalleUbicacion,
    listarUbicacionesAuditadas,
    listarUbicacionesAbiertas
  };
})();
