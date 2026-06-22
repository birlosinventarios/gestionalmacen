/**
 * FormularioTraspasosService.gs
 * Servicio de dominio para la vista FormularioTraspasos
 */

const FormularioTraspasosService = (() => {

  const DOMAIN = Object.freeze({
    BODEGA_PRINCIPAL: "1 - ALMACEN BIRLOS",
    TIPOS: Object.freeze({
      ACOMODO: "ACOMODO",
      SURTIDO: "SURTIDO",
      CAMBIO_BODEGA: "CAMBIO DE BODEGA"
    }),
    TIPOS_UI: Object.freeze({
      ACOMODO: "Acomodo",
      SURTIDO: "Surtido",
      CAMBIO_BODEGA: "Cambio de bodega"
    })
  });

  function _obtenerContextoTemporal_(ss) {
    const zonaHoraria = ss.getSpreadsheetTimeZone();
    const ahora = new Date();

    return {
      fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
      hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss")
    };
  }

  function _canonTipoUI_(tipo) {
    const t = toStrUpper_(tipo);

    if (t === DOMAIN.TIPOS.ACOMODO) return DOMAIN.TIPOS_UI.ACOMODO;
    if (t === DOMAIN.TIPOS.SURTIDO) return DOMAIN.TIPOS_UI.SURTIDO;
    if (t === DOMAIN.TIPOS.CAMBIO_BODEGA) return DOMAIN.TIPOS_UI.CAMBIO_BODEGA;

    throw new Error(`Tipo de movimiento no válido: ${tipo}`);
  }

  function _canonTipoUpper_(tipo) {
    return toStrUpper_(_canonTipoUI_(tipo));
  }

  function _buildUsuarios_() {
    return UsuariosRepository.getAll()
      .map(u => ({
        idusuario: u.idusuario,
        nombre: toStrUpper_(u.nombre),
        rol: toStrUpper_(u.rol)
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  function _buildBodegas_() {
    const datos = UbicacionesExcedentesRepository.getBodegas()
      .map(x => toStrUpper_(x))
      .filter(Boolean);

    return [...new Set(datos)].sort();
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

  function _buildMapaUbicacionesExcedentes_() {
    return UbicacionesExcedentesRepository.getAll()
      .map(item => ({
        bodega: toStrUpper_(item.bodega),
        ubi: toStrUpper_(item.ubicacion)
      }))
      .filter(x => x.bodega && x.ubi);
  }

  function _crearContextoValidacion_() {
    const usuarios = _buildUsuarios_();
    const bodegas = _buildBodegas_();
    const mapaCatalogo = _buildMapaCatalogo_();
    const mapaUbicacionesExcedentes = _buildMapaUbicacionesExcedentes_();

    return {
      usuariosSet: new Set(usuarios.map(x => x.nombre)),
      bodegasSet: new Set(bodegas),
      mapaCatalogo,
      mapaUbicacionesExcedentes
    };
  }

  function _validarSolicitante_(solicitante, usuariosSet) {
    const nombre = toStrUpper_(solicitante);

    if (!nombre) {
      throw new Error("El solicitante es obligatorio.");
    }

    if (!usuariosSet.has(nombre)) {
      throw new Error(`El solicitante "${nombre}" no existe.`);
    }

    return nombre;
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

  function _validarBodega_(bodega, bodegasSet, nombreCampo) {
    const valor = toStrUpper_(bodega);

    if (!valor) {
      throw new Error(`La ${nombreCampo} es obligatoria.`);
    }

    // Se permite la bodega principal aunque no viva en UBICACIONES
    if (valor !== DOMAIN.BODEGA_PRINCIPAL && !bodegasSet.has(valor)) {
      throw new Error(`La ${nombreCampo} "${valor}" no es válida.`);
    }

    return valor;
  }

  function _validarUbicacionExcedente_(bodega, ubicacion, mapaUbicacionesExcedentes, nombreCampo) {
    const bod = toStrUpper_(bodega);
    const ubi = toStrUpper_(ubicacion);

    if (!ubi) {
      throw new Error(`La ${nombreCampo} es obligatoria.`);
    }

    // Si pertenece a la bodega principal lógica, no se valida contra UBICACIONES
    if (bod === DOMAIN.BODEGA_PRINCIPAL && ubi === DOMAIN.BODEGA_PRINCIPAL) {
      return ubi;
    }

    const permitidas = mapaUbicacionesExcedentes
      .filter(x => x.bodega === bod)
      .map(x => x.ubi);

    if (!permitidas.includes(ubi)) {
      throw new Error(`La ${nombreCampo} "${ubi}" no pertenece a la bodega "${bod}".`);
    }

    return ubi;
  }

  function _resolverMovimiento_(item, ctx) {
    const tipoUI = _canonTipoUI_(item.tipo);
    const tipoUpper = _canonTipoUpper_(item.tipo);

    const solicitante = _validarSolicitante_(item.solicitante, ctx.usuariosSet);
    const { codigo, producto } = _validarCodigo_(item.codigo, ctx.mapaCatalogo);

    const descripcion = toStrUpper_(item.descripcion || producto.descripcion);
    if (!descripcion) {
      throw new Error(`El código "${codigo}" no tiene descripción.`);
    }

    const cantidadAbs = Math.abs(toNum_(item.cantidad));
    if (cantidadAbs <= 0) {
      throw new Error(`La cantidad del código "${codigo}" debe ser mayor a cero.`);
    }

    let bodegaSalida = "";
    let ubiSalida = "";
    let bodegaEntrada = "";
    let ubiEntrada = "";
    let serie = "";
    let cantidadFirmada = 0;

    if (tipoUpper === DOMAIN.TIPOS.SURTIDO) {
      bodegaSalida = _validarBodega_(
        item.bodegaSalida || DOMAIN.BODEGA_PRINCIPAL,
        ctx.bodegasSet,
        "bodega de salida"
      );

      ubiSalida = _validarUbicacionExcedente_(
        bodegaSalida,
        item.ubiSalida,
        ctx.mapaUbicacionesExcedentes,
        "ubicación de salida"
      );

      bodegaEntrada = DOMAIN.BODEGA_PRINCIPAL;
      ubiEntrada = DOMAIN.BODEGA_PRINCIPAL;

      serie = ubiSalida;
      cantidadFirmada = -cantidadAbs;

    } else if (tipoUpper === DOMAIN.TIPOS.ACOMODO) {
      bodegaEntrada = _validarBodega_(
        item.bodegaEntrada || item.bodegaSalida || DOMAIN.BODEGA_PRINCIPAL,
        ctx.bodegasSet,
        "bodega de entrada"
      );

      ubiEntrada = _validarUbicacionExcedente_(
        bodegaEntrada,
        item.ubiEntrada || item.ubiSalida,
        ctx.mapaUbicacionesExcedentes,
        "ubicación de entrada"
      );

      bodegaSalida = DOMAIN.BODEGA_PRINCIPAL;
      ubiSalida = DOMAIN.BODEGA_PRINCIPAL;

      serie = ubiEntrada;
      cantidadFirmada = cantidadAbs;

    } else if (tipoUpper === DOMAIN.TIPOS.CAMBIO_BODEGA) {
      bodegaSalida = _validarBodega_(
        item.bodegaSalida,
        ctx.bodegasSet,
        "bodega de salida"
      );

      ubiSalida = _validarUbicacionExcedente_(
        bodegaSalida,
        item.ubiSalida,
        ctx.mapaUbicacionesExcedentes,
        "ubicación de salida"
      );

      bodegaEntrada = _validarBodega_(
        item.bodegaEntrada,
        ctx.bodegasSet,
        "bodega de entrada"
      );

      ubiEntrada = _validarUbicacionExcedente_(
        bodegaEntrada,
        item.ubiEntrada,
        ctx.mapaUbicacionesExcedentes,
        "ubicación de entrada"
      );

      if (bodegaSalida === bodegaEntrada && ubiSalida === ubiEntrada) {
        throw new Error("La salida y la entrada no pueden ser exactamente la misma ubicación.");
      }

      serie = ubiSalida;
      cantidadFirmada = -cantidadAbs;
    }

    return {
      tipo: tipoUI,
      solicitante,
      codigo,
      descripcion,
      cantidad: cantidadFirmada,
      cantidadAbsoluta: cantidadAbs,
      bodegaSalida,
      ubiSalida,
      bodegaEntrada,
      ubiEntrada,
      serie,
      idproducto: toStr_(producto.idproducto)
    };
  }

  function _mapEntityToRow_(entity, config) {
    const fila = new Array(15).fill("");

    fila[COL.TRASPASOS.FECHA] = config.fecha;
    fila[COL.TRASPASOS.HORA] = config.hora;
    fila[COL.TRASPASOS.TIPOMOVIMIENTO] = entity.tipo;
    fila[COL.TRASPASOS.SERIE] = entity.serie;
    fila[COL.TRASPASOS.BODEGA_SALIDA] = entity.bodegaSalida;
    fila[COL.TRASPASOS.UBICACION_SALIDA] = entity.ubiSalida;
    fila[COL.TRASPASOS.BODEGA_ENTRADA] = entity.bodegaEntrada;
    fila[COL.TRASPASOS.UBICACION_ENTRADA] = entity.ubiEntrada;
    fila[COL.TRASPASOS.SOLICITANTE] = entity.solicitante;
    fila[COL.TRASPASOS.CODIGO] = entity.codigo;
    fila[COL.TRASPASOS.DESCRIPCION] = entity.descripcion;
    fila[COL.TRASPASOS.CANTIDAD] = entity.cantidad;
    fila[COL.TRASPASOS.FOLIO] = "";
    fila[COL.TRASPASOS.RESPONSABLE] = "";
    fila[COL.TRASPASOS.IDUNICO] = entity.idunico;

    return fila;
  }

  function getBootstrap() {
    return {
      usuarios: _buildUsuarios_(),
      bodegas: _buildBodegas_(),
      codigos: _buildCodigos_(),
      mapaCatalogo: _buildMapaCatalogo_(),
      mapaUbicacionesExcedentes: _buildMapaUbicacionesExcedentes_()
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
      idproducto: toStr_(producto.idproducto),
      descripcion: toStrUpper_(producto.descripcion),
      status: toStrUpper_(producto.status)
    };
  }

  function obtenerUbicacionesPorBodega(bodega) {
    const bod = toStrUpper_(bodega);
    if (!bod) return [];

    return UbicacionesExcedentesRepository.getPorBodega(bod)
      .map(x => toStrUpper_(x.ubicacion))
      .filter(Boolean)
      .filter((x, i, arr) => arr.indexOf(x) === i)
      .sort();
  }

  function registrarLote(lote) {
    if (!Array.isArray(lote) || lote.length === 0) {
      throw new Error("El lote está vacío.");
    }

    if (!lote.every(x => x && typeof x === "object")) {
      throw new Error("El lote contiene elementos inválidos.");
    }

    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      lock.waitLock(30000);
      locked = true;

      const ss = getSpreadsheetByFileKey_(SHEETS.TRASPASOS.file);
      const hoja = getSheetByKey_("TRASPASOS");
      const config = _obtenerContextoTemporal_(ss);
      const ctx = _crearContextoValidacion_();

      const rows = lote.map(item => {
        const entity = _resolverMovimiento_(item, ctx);
        entity.idunico = "";
        return _mapEntityToRow_(entity, config);
      });

      const startRow = hoja.getLastRow() + 1;
      hoja.getRange(startRow, 1, rows.length, 15).setValues(rows);

      SpreadsheetApp.flush();

      if (typeof TraspasosRepository !== "undefined" && TraspasosRepository.clearCache) {
        TraspasosRepository.clearCache();
      }

      return {
        ok: true,
        mensaje: `✅ ${rows.length} movimientos registrados correctamente.`,
        total: rows.length
      };

    } catch (error) {
      throw new Error("No se pudo registrar el lote de traspasos: " + error.message);
    } finally {
      if (locked) lock.releaseLock();
    }
  }

  return {
    getBootstrap,
    buscarProductoPorCodigo,
    obtenerUbicacionesPorBodega,
    registrarLote
  };

})();

function debugFormularioTraspasosService() {
  debugServiceCall_(
    "FormularioTraspasosService.getBootstrap",
    {},
    () => FormularioTraspasosService.getBootstrap(),
    { limit: 5 }
  );

  debugServiceCall_(
    "FormularioTraspasosService.buscarProductoPorCodigo",
    { codigo: "PLP-10X3" },
    () => FormularioTraspasosService.buscarProductoPorCodigo("PLP-10X3"),
    { limit: 5 }
  );

  debugServiceCall_(
    "FormularioTraspasosService.obtenerUbicacionesPorBodega",
    { bodega: "BODEGA 1" },
    () => FormularioTraspasosService.obtenerUbicacionesPorBodega("BODEGA 1"),
    { limit: 5 }
  );
}
