
function obtenerMegaDataInicial() {
  try {
    const base = BootstrapServices.getInfoInicial();

    const mapaProductos = Object.keys(base.mapaCatalogo || {}).reduce((acc, codigo) => {
      const producto = base.mapaCatalogo[codigo] || {};
      acc[codigo] = {
        id: producto.idproducto || "",
        descripcion: producto.descripcion || ""
      };
      return acc;
    }, {});

    return {
      usuarios: base.usuarios || [],
      bodegas: base.bodegas || [],
      mapaUbicaciones: base.mapaUbicacionesExcedentes || [],
      codigos: base.codigos || [],
      mapaProductos: mapaProductos,
      mapaMedidas: base.mapaMedidas || {},
      nombresEtiquetas: base.nombresEtiquetas || []
    };

  } catch (e) {
    console.error("Error en obtenerMegaDataInicial(): " + e.message);
    return {
      usuarios: [],
      bodegas: [],
      mapaUbicaciones: [],
      codigos: [],
      mapaProductos: {},
      mapaMedidas: {},
      nombresEtiquetas: []
    };
  }
}
 
function buscarCodigosPorFiltro(termino) {
  const filtro = toStrUpper_(termino);

  return CatalogoRepository.getCodigos()
    .filter(codigo => codigo && codigo.includes(filtro))
    .slice(0, 25);
}

function buscarProductoPorCodigo(codigo) {
  const filtro = toStrUpper_(codigo);
  if (!filtro) return { encontrado: false };

  const registro = CatalogoRepository.getPorCodigo(filtro)[0];

  if (registro) {
    return {
      encontrado: true,
      id: registro.idproducto,
      descripcion: registro.descripcion
    };
  }

  return { encontrado: false };
}

function obtenerUbicacionesPorBodega(bodegaNombre) {
  if (!bodegaNombre) return [];

  try {
    const bodegaBusqueda = toStrUpper_(bodegaNombre);

    const ubicaciones = getRowsByKey_("UBICACIONES_EXCEDENTES")
      .filter(fila => toStrUpper_(fila[COL.UBICACIONES_EXCEDENTES.BODEGA]) === bodegaBusqueda)
      .map(fila => toStrUpper_(fila[COL.UBICACIONES_EXCEDENTES.UBICACION]))
      .filter(Boolean);

    return [...new Set(ubicaciones)].sort();

  } catch (e) {
    console.error("Error en obtenerUbicacionesPorBodega(): " + e.message);
    throw new Error("No se pudieron obtener las ubicaciones de la bodega.");
  }
}


function procesarLoteEtiquetas(lote) {
  const ss = getSpreadsheetByFileKey_(SHEETS.ETIQUETAS.file);
  const config = _obtenerContextoTemporal(ss);

  const loteConFolio = lote.map(item => {
    const marcaTiempo = config.fecha.split('/').reverse().join('') + config.hora.replace(/:/g, '');
    item.folio = `${marcaTiempo}&${item.codigo}&#ETIQ`;
    return item;
  });

  const tmpl = HtmlService.createTemplateFromFile('EtiquetaIdentificadoraImpresa');
  tmpl.lote = loteConFolio;
  tmpl.fechaHora = config.fecha + " " + config.hora;

  return tmpl.evaluate().getContent();
}


/**
 * Obtiene las filas de la Bitácora que NO tienen Folio (Col M) o Responsable (Col N)

function obtenerTraspasosPendientes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('Bitacora-TRASPASOS');
  if (!hoja) return [];

  const data = hoja.getDataRange().getValues();
  const encabezados = data[0];
  const filas = data.slice(1);

  // Mapeo dinámico basado en tu estructura A-N
  return filas.map((f, index) => {
    return {
      fila: index + 2, // Guardamos el número de fila real para actualizar después
      tipo: f[2],       // Col C
      serie: f[3],      // Col D
      origen: f[4],     // Col E
      uSalida: f[5],    // Col F
      destino: f[6],    // Col G
      uEntrada: f[7],   // Col H
      solicitante: f[8], // Col I
      codigo: f[9],     // Col J
      descripcion: f[10], // Col K
      cantidad: f[11],  // Col L
      folio: f[12],     // Col M
      responsable: f[13], // Col N
      // Propiedad auxiliar para el separador visual en el HTML
      bodegaOriginal: f[2] === "Acomodo" ? f[6] : f[4] 
    };
  }).filter(item => {
    // FILTRO CRÍTICO: Solo lo que no tiene Folio O Responsable
    return (!item.folio || String(item.folio).trim() === "") || 
           (!item.responsable || String(item.responsable).trim() === "");
  });
}  */

/**
 * Obtiene la lista de usuarios con rol de responsable (Hoja USUARIOS)
 */
function obtenerAgentesResponsables() {
  try {
    const usuarios = UsuariosRepository.getAll();

    const responsables = usuarios
      .filter(u => toStrUpper_(u.rol) === "RESPONSABLE")
      .map(u => toStrUpper_(u.nombre))
      .filter(Boolean)
      .sort();

    return responsables.length ? responsables : ["ADMIN"];

  } catch (e) {
    console.error("Error en obtenerAgentesResponsables(): " + e.message);
    return ["ADMIN"];
  }
}



/**
 * Esta función es la que llama tu formulario Generador de Etiquetas
 */

function procesarLoteEtiquetasExcedentes(lote) {
  try {
    const ss = getSpreadsheetByFileKey_(SHEETS.EXCEDENTES.file);
    const config = _obtenerContextoTemporal(ss);

    guardarExcedentesEnBD(lote, config);

    const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');

    tmpl.lote = lote.map(item => {
      return {
        codigo: item.codigo,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        id: item.id,
        idUnico: item.idUnico,
        cajaNo: item.cajaNo,
        totalCajas: item.totalCajas
      };
    });

    tmpl.fechaHora = config.fecha + " " + config.hora;

    return tmpl.evaluate().getContent();

  } catch (e) {
    console.error("Error en procesarLoteEtiquetasExcedentes(): " + e.message);
    throw new Error(e.message);
  }
}



function procesarReimpresionExcedentes(lista) {
  const ss = getSpreadsheetByFileKey_(SHEETS.EXCEDENTES.file);
  const config = _obtenerContextoTemporal(ss);

  const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');

  tmpl.lote = lista.map(item => {
    return {
      codigo: item.codigo,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      ubicacion: item.ubicacion,
      id: item.idUnico,
      idUnico: item.idUnico
    };
  });

  tmpl.fechaHora = config.fecha + " " + config.hora;
  return tmpl.evaluate().getContent();
}



function obtenerTodosLosCodigos() {
  try {
    return CatalogoRepository.getCodigos();
  } catch (e) {
    console.error("Error al cargar códigos: " + e.message);
    return [];
  }
}


/**
 * Sanitización de Grado Industrial para IDs
 * Elimina cualquier metadato de fecha inyectado por el motor de GAS.
 */
function limpiarID(valor) {
  if (valor === undefined || valor === null || valor === "") return "";
  // Forzamos String y cortamos en el primer espacio o coma
  return String(valor).split(/[ ,]+/)[0].trim();
}

function buscarPorCodigo() {
  const cod = document.getElementById('codigoInput').value.trim().toUpperCase();
  if (!cod) return;

  google.script.run.withSuccessHandler(res => {
    if (res.encontrado) {
      document.getElementById('descripcionInput').value = res.descripcion;
      // IMPORTANTE: Asegúrate de que res.id sea el nombre correcto de la propiedad que viene del mapaProductos en consultas.gs
      document.getElementById('idInput').value = res.id || "Error-Sin-ID"; 
    } else {
      lanzarNotificacion("❌ Producto no encontrado", "error");
      limpiarCampos();
    }
  }).buscarProductoPorCodigo(cod);
}

function obtenerTodaLaBaseExcedentes() {
  try {
    const ss = getSpreadsheetByFileKey_(SHEETS.TRASPASOS.file);
    const hoja = getSheetByKey_("TRASPASOS");

    const valores = hoja.getDataRange().getValues();
    if (valores.length <= 1) return [];

    valores.shift();
    const zonaHoraria = ss.getSpreadsheetTimeZone();

    return valores
      .filter(fila => String(fila[14] || "").trim() !== "")
      .map((fila, index) => {
        return {
          idFila: index + 2,
          fecha: fila[0] instanceof Date
            ? Utilities.formatDate(fila[0], zonaHoraria, "dd/MM/yyyy")
            : String(fila[0] || ""),
          hora: fila[1] instanceof Date
            ? Utilities.formatDate(fila[1], zonaHoraria, "HH:mm:ss")
            : String(fila[1] || ""),
          tipoMovimiento: String(fila[2] || "").trim(),
          serie: String(fila[3] || "").trim(),
          bodegaSalida: String(fila[4] || "").trim(),
          ubiExcedenteSalida: String(fila[5] || "").trim(),
          bodegaEntrada: String(fila[6] || "").trim(),
          ubiExcedenteEntrada: String(fila[7] || "").trim(),
          solicitante: String(fila[8] || "").trim(),
          codigo: String(fila[9] || "").trim(),
          descripcion: String(fila[10] || "").trim(),
          cantidad: Number(fila[11]) || 0,
          folio: String(fila[12] || "").trim(),
          responsable: String(fila[13] || "").trim(),
          idUnico: String(fila[14] || "").trim()
        };
      })
      .reverse();

  } catch (error) {
    Logger.log("Error en obtenerTodaLaBaseExcedentes: " + error.toString());
    return [];
  }
}


function obtenerContenidoVista(nombreArchivo) {
  try {
    // 1. Creamos un template desde el archivo
    const template = HtmlService.createTemplateFromFile(nombreArchivo);
    
    // 2. .evaluate() procesa los scriptlets <?!= ... ?> y devuelve un HtmlOutput
    // 3. .getContent() extrae el HTML ya procesado (con estilos y sub-vistas incluidos)
    return template.evaluate().getContent();
  } catch (e) {
    return "<p>Error al cargar la vista: " + e.toString() + "</p>";
  }
}

function navegarA(nombreVista) {
    console.log("Navegando a:", nombreVista);
    lanzarNotificacion("Cargando...", "info");

    google.script.run
        .withSuccessHandler(function(html) {
            const contenedor = document.getElementById('contenedor-principal');
            
            // 1. Limpiamos el contenedor
            contenedor.innerHTML = html;

            // 2. RE-EJECUCIÓN MANUAL DE SCRIPTS
            const scripts = contenedor.querySelectorAll("script");
            scripts.forEach(oldScript => {
                const newScript = document.createElement("script");
                // Copiamos el contenido del script
                newScript.text = oldScript.innerHTML;
                // Lo pegamos en el body para que el navegador lo ejecute y lo borramos de inmediato
                document.body.appendChild(newScript).parentNode.removeChild(newScript);
            });

            // 3. DISPARADOR DE CARGA
            setTimeout(() => {
                const nombreFuncion = "cargar_" + nombreVista;
                if (typeof window[nombreFuncion] === "function") {
                    console.log("🚀 Disparando función: " + nombreFuncion);
                    window[nombreFuncion]();
                } else {
                    console.error("❌ No se encontró la función: " + nombreFuncion);
                }
            }, 600); // Aumentamos un poco el tiempo para asegurar estabilidad
        })
        .obtenerContenidoVista(nombreVista);
}

/**
 * Función de respaldo: Si la vista no tiene una función "cargar_", 
 * esto obliga a los scripts <script> dentro del HTML a ejecutarse.
 */
function forzarEjecucionScripts(contenedor) {
    const scripts = contenedor.querySelectorAll("script");
    scripts.forEach(oldScript => {
        const newScript = document.createElement("script");
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}



function obtenerEstadoFolios() {
  const maestro = obtenerInformacionExcedentes();
  const base = (maestro && maestro.baseExcedentes) || [];

  return base.map(item => ({
    idUnico: item.idUnico || item.eidUnico || "",
    sku: item.sku || item.ecodigo || "",
    descripcion: item.descripcion || item.edescripcion || "",
    ubicacionActual: item.ubicacionActual || item.eubicacion || "",
    balance: Number(item.balance != null ? item.balance : item.ecantidad || 0)
  }));
}

