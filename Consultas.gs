function obtenerMegaDataInicial() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. USUARIOS (Filtrado por ROL: RESPONSABLE)
    const hojaUsuarios = ss.getSheetByName('USUARIOS');
    // Leemos Col B (Nombre) y Col C (Rol)
    const dataUsuarios = hojaUsuarios.getRange(2, 1, hojaUsuarios.getLastRow() - 1, 3).getValues();

    const usuariosProcesados = dataUsuarios
      .map(f => ({
        nombre: String(f[1]).trim(),
        rol: String(f[2]).trim().toUpperCase()
      }))
      .filter(u => u.nombre !== "")
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
      
    // 2. MAPA DE UBICACIONES (Hoja 'UBICACIONES')
    const datosUbi = ss.getSheetByName('UBICACIONES').getDataRange().getValues().slice(1);
    const bodegas = [...new Set(datosUbi.map(f => f[1]))].filter(Boolean).sort();
    const mapaUbicaciones = datosUbi.map(f => ({
      bodega: String(f[1]).trim().toUpperCase(),
      ubi: String(f[2]).trim()
    })).filter(f => f.bodega && f.ubi);

    // 3. CATALOGO DE PRODUCTOS (Hoja 'CATALOGO')
    // Traemos A (ID), B (Código) y C (Descripción)
    const hojaCat = ss.getSheetByName('CATALOGO');
    const dataCat = hojaCat.getRange(2, 1, hojaCat.getLastRow() - 1, 3).getValues();
    
    let mapaProductos = {};
    let todosLosCodigos = [];
    
    dataCat.forEach(f => {
      const codigo = String(f[1]).trim().toUpperCase();
      if (codigo) {
        mapaProductos[codigo] = {
          id: f[0],         // Columna A
          descripcion: f[2] // Columna C
        };
        todosLosCodigos.push(codigo);
      }
    });

    // 4. CONFIGURACIÓN DE ETIQUETAS (Hoja 'CONFIG_ETIQUETAS')
    // Estructura sugerida: Col A: Nombre, Col B: Alto, Col C: Ancho
    const hojaConfig = ss.getSheetByName('ETIQUETAS');
    let mapaMedidas = {};
    if (hojaConfig) {
      const dataMedidas = hojaConfig.getDataRange().getValues().slice(1);
      dataMedidas.forEach(f => {
        mapaMedidas[f[0]] = { alto: f[1], ancho: f[2] };
      });
    }

    // RETORNO MAESTRO
    return { 
      usuarios: usuariosProcesados, 
      bodegas: bodegas, 
      mapaUbicaciones: mapaUbicaciones,
      codigos: todosLosCodigos.sort(),
      mapaProductos: mapaProductos,
      mapaMedidas: mapaMedidas,
      nombresEtiquetas: Object.keys(mapaMedidas)
    }; 
    
  } catch (e) {
    console.error("Error en MegaData Unificado: " + e.message);
    return { usuarios: [], bodegas: [], mapaUbicaciones: [], codigos: [], mapaProductos: {} 
    };
  }
}

function buscarCodigosPorFiltro(termino) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('CATALOGO'); // Ajusta al nombre de tu hoja
  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().flat();
  const filtro = termino.toUpperCase();

  // Filtrado rápido y limitación de resultados
  const resultados = datos
    .filter(codigo => codigo && String(codigo).toUpperCase().includes(filtro))
    .slice(0, 25); // No satures el DOM con más de 25 opciones

  return resultados;
}


function buscarProductoPorCodigo(codigo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('CATALOGO');
  const filtro = codigo.trim().toUpperCase();
  
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return { encontrado: false };

  // Leemos desde la fila 2, columna 2 (B) y traemos 2 columnas (B y C)
  // data[x][0] será la columna B (Código)
  // data[x][1] será la columna C (Descripción)
  const data = hoja.getRange(2, 2, ultimaFila - 1, 2).getValues();
  
  const filaEncontrada = data.find(f => String(f[0]).trim().toUpperCase() === filtro);

  if (filaEncontrada) {
    return { 
      encontrado: true, 
      descripcion: filaEncontrada[1] 
    };
  }
  
  return { encontrado: false };
}

function obtenerUbicacionesPorBodega(bodegaNombre) {
  if (!bodegaNombre) return [];
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('UBICACIONES'); // Asegúrate que el nombre sea exacto
    const fullData = hoja.getDataRange().getValues();
    
    // Supongamos: Columna B (index 1) es Bodega, Columna C (index 2) es Ubicación
    const ubicaciones = fullData
      .slice(1) // Quitamos encabezados
      .filter(fila => {
        // Limpieza de datos para comparación segura
        const bodegaFila = String(fila[1]).trim().toUpperCase();
        const bodegaBusqueda = String(bodegaNombre).trim().toUpperCase();
        return bodegaFila === bodegaBusqueda;
      })
      .map(fila => String(fila[2]).trim()) // Extraer ubicación
      .filter((valor, indice, self) => valor !== "" && self.indexOf(valor) === indice); // Únicos y no vacíos

    return ubicaciones.sort(); // Ordenar A-Z
  } catch (e) {
    console.error("Error: " + e.message);
    throw new Error("No se pudo acceder a la hoja de Ubicaciones");
  }
}

function procesarLoteEtiquetas(lote) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _obtenerContextoTemporal(ss); // Reutilizamos tu función de fecha/hora
  
  // Inyectamos el Folio Único a cada etiqueta del lote
  const loteConFolio = lote.map(item => {
    // Generamos el folio usando la lógica: marcatiempobase&idcodigo&#caja
    // Como aquí no hay "caja" de destino, usamos "ALM" o el ID
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
 */
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
}

/**
 * Obtiene la lista de usuarios con rol de responsable (Hoja USUARIOS)
 */
function obtenerAgentesResponsables() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('USUARIOS');
  if (!hoja) return ["Admin"];
  
  // Asumiendo que los nombres están en la Col B (index 1)
  return hoja.getDataRange().getValues().slice(1)
    .map(f => f[1])
    .filter(Boolean)
    .sort();
}


/**
 * Esta función es la que llama tu formulario Generador de Etiquetas
 */
function procesarLoteEtiquetasExcedentes(lote) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = _obtenerContextoTemporal(ss); 
    
    // --- PASO CRÍTICO: Guardar en Base de Datos primero ---
    // Si esto falla, el catch atrapará el error y no se imprimirá nada
    guardarExcedentesEnBD(lote, config);
    
    // --- PASO 2: Generar la plantilla de impresión ---
    const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
    
    tmpl.lote = lote.map(item => {
      return {
        codigo: item.codigo,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        id: item.id,           // ID del catálogo para QR
        idUnico: item.idUnico, // Folio único generado en el cliente
        cajaNo: item.cajaNo,
        totalCajas: item.totalCajas
      };
    });
    
    tmpl.fechaHora = config.fecha + " " + config.hora;
    
    return tmpl.evaluate().getContent();
    
  } catch (e) {
    console.error("Error en proceso unificado de excedentes: " + e.message);
    throw new Error(e.message); 
  }
}

function procesarMovimientosFinal(cola) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaBitacora = ss.getSheetByName('Bitacora-TRASPASOS');
  const hojaExcedentes = ss.getSheetByName('BD-EXCEDENTES');
  const config = _obtenerContextoTemporal(ss); // Tu función de fecha/hora
  
  let remanentesParaImprimir = [];

  try {
    cola.forEach(mov => {
      const cantidadMovimiento = parseFloat(mov.cantidad);
      
      // 1. REGISTRAR EN BITÁCORA (Movimiento estándar)
      // Ajusta los índices según tus columnas (A-O)
      hojaBitacora.appendRow([
        new Date(),           // Col A: Fecha
        config.hora,          // Col B: Hora
        mov.tipo,             // Col C: Tipo (Acomodo/Surtido)
        "",                   // Col D: Serie
        mov.tipo === 'Acomodo' ? "RECEPCION" : mov.ubicacion, // Col E: Origen
        "",                   // Col F
        mov.tipo === 'Surtido' ? "SURTIDO" : mov.ubicacion,   // Col G: Destino
        "",                   // Col H
        mov.solicitante,      // Col I
        mov.codigo,           // Col J
        mov.descripcion || "",// Col K
        cantidadMovimiento,   // Col L
        "",                   // Col M
        mov.solicitante,      // Col N: Responsable
        mov.codigo            // Col O: ID UNICO (Llave Maestra)
      ]);

      // 2. LÓGICA DE REMANENTE (Solo para Surtido Parcial)
      if (mov.tipo === 'Surtido' && mov.idSeleccionado) {
        const saldoAnterior = parseFloat(mov.idSeleccionado.balance);
        const diferencia = saldoAnterior - cantidadMovimiento;

        if (diferencia > 0) {
          // Generar nuevo ID para el sobrante
          const nuevoIdUnico = `${Date.now()}&${mov.idSeleccionado.codigo}&#REM`;
          
          // Insertar el remanente en la BD de Excedentes
          // Estructura: IDUNICO, FECHA, ... CODIGO, DESC, CANT, UBIC
          hojaExcedentes.appendRow([
            nuevoIdUnico,           // Col A: Nuevo ID
            config.fecha,           // Col B: Fecha
            "", "",                 // Col C, D
            mov.idSeleccionado.codigo, // Col E
            mov.idSeleccionado.descripcion,// Col F
            diferencia,             // Col G: El sobrante
            mov.ubicacion           // Col H: Se queda en la misma ubicación
          ]);

          // Añadir a la lista de impresión
          remanentesParaImprimir.push({
            id: nuevoIdUnico, // Para el QR
            idUnico: nuevoIdUnico, // Para el Footer
            codigo: mov.idSeleccionado.codigo,
            descripcion: mov.idSeleccionado.descripcion,
            cantidad: diferencia
          });
        }
      }
    });

    // 3. GENERAR HTML SI HAY IMPRESIONES PENDIENTES
    let htmlResultado = null;
    if (remanentesParaImprimir.length > 0) {
      const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
      tmpl.lote = remanentesParaImprimir;
      tmpl.fechaHora = config.fecha + " " + config.hora;
      htmlResultado = tmpl.evaluate().getContent();
    }

    return {
      success: true,
      htmlImpresion: htmlResultado
    };

  } catch (e) {
    console.error("Error en procesarMovimientosFinal: " + e.message);
    throw new Error("Error al sincronizar: " + e.message);
  }
}

function procesarReimpresionExcedentes(lista) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _obtenerContextoTemporal(ss);
  const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
  
  // Re-mapeamos la lista para que coincida con tu HTML actual
  tmpl.lote = lista.map(item => {
    return {
      codigo: item.codigo,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      ubicacion: item.ubicacion,
      id: item.idUnico,      // <--- Tu HTML busca item.id para el QR
      idUnico: item.idUnico  // <--- Tu HTML busca item.idUnico para el Footer
    };
  });
  
  tmpl.fechaHora = config.fecha + " " + config.hora;
  return tmpl.evaluate().getContent();
}

function obtenerTodosLosCodigos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('CATALOGO');
    if (!hoja) return [];
    
    // Suponiendo que los códigos están en la Columna B (2)
    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return [];
    
    const codigos = hoja.getRange(2, 2, ultimaFila - 1, 1).getValues()
      .flat() // Convierte [[cod1], [cod2]] en [cod1, cod2]
      .filter(Boolean) // Quita vacíos
      .map(c => String(c).trim().toUpperCase()); // Normaliza
      
    return [...new Set(codigos)].sort(); // Devuelve únicos ordenados
  } catch (e) {
    console.error("Error al cargar códigos: " + e.message);
    return [];
  }
}

function obtenerEstadoFolios() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hojaBit = ss.getSheetByName('Bitacora-TRASPASOS');
    const hojaExc = ss.getSheetByName('BD-EXCEDENTES');
    if (!hojaBit || !hojaExc) return [];

    const bitacora = hojaBit.getDataRange().getValues();
    const excedentes = hojaExc.getDataRange().getValues();
    const balances = {};
    
    // Hash Map para O(n) - Eficiencia máxima en búsqueda
    bitacora.slice(1).forEach(fila => {
      const id = limpiarID(fila[14]); // Col O
      if (!id) return;
      
      const tipo = String(fila[2] || "").trim(); // Col C
      const cant = parseFloat(fila[11]) || 0;    // Col L
      
      if (!balances[id]) balances[id] = 0;
      tipo === 'Acomodo' ? balances[id] += cant : balances[id] -= cant;
    });

    return excedentes.slice(1).map(fila => {
      const id = limpiarID(fila[0]); // Col A
      const bal = balances[id] || 0;
      
      // Lógica de estados centralizada en Backend (Lucidez)
      let estado = "Pendiente";
      if (id in balances) {
        if (bal > 0) estado = "Ubicado";
        else if (bal === 0) estado = "Surtido";
        else estado = "Negativo";
      }

      return {
        idUnico: id,
        sku: String(fila[4] || ""),
        descripcion: String(fila[5] || ""),
        cantidadOriginal: parseFloat(fila[6]) || 0,
        ubicacionActual: String(fila[7] || ""),
        balance: bal,
        estado: estado
      };
    });
  } catch (e) {
    console.error("Critical Failure [obtenerEstadoFolios]: " + e.message);
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

function buscarProductoPorCodigo(codigo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('CATALOGO');
  const filtro = codigo.trim().toUpperCase();
  
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return { encontrado: false };

  // Cambiamos el rango para incluir la Columna A (ID), B (Código) y C (Descripción)
  // getRange(fila, columna, numFilas, numColumnas)
  const data = hoja.getRange(2, 1, ultimaFila - 1, 3).getValues();
  
  // f[0] es ID (Col A), f[1] es Código (Col B), f[2] es Descripción (Col C)
  const filaEncontrada = data.find(f => String(f[1]).trim().toUpperCase() === filtro);

  if (filaEncontrada) {
    return { 
      encontrado: true, 
      id: filaEncontrada[0], // <--- AHORA SÍ ENVIAMOS EL ID
      descripcion: filaEncontrada[2] 
    };
  }
  
  return { encontrado: false };
}

/**
 * Obtiene la base de excedentes consolidada por IDUNICO.
 * Filtra vacíos y calcula el balance (Entradas - Salidas).
 */
function obtenerTodaLaBaseExcedentes() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('Bitacora-TRASPASOS') || ss.getSheetByName('Bitacora-Traspasos');
    if (!hoja) throw new Error("Hoja no encontrada");

    const valores = hoja.getDataRange().getValues();
    if (valores.length <= 1) return [];
    valores.shift(); // Quitar encabezados

    // Mapa para consolidar saldos por IDUNICO
    const mapaExcedentes = {};

    valores.forEach(fila => {
      const idUnico = String(fila || "").trim();
      if (!idUnico) return; // Despreciar vacíos

      const tipo = String(fila || "").toUpperCase();
      const cantidad = Number(fila) || 0;

      if (!mapaExcedentes[idUnico]) {
        mapaExcedentes[idUnico] = {
          idUnico: idUnico,
          codigo: String(fila || "").trim(),
          descripcion: String(fila || "").trim(),
          serie: String(fila || "").trim(),
          entradas: 0,
          salidas: 0,
          balance: 0
        };
      }

      // Lógica de Balance: Acomodo/Ingreso suma, Surtido/Salida resta
      if (tipo.includes("ACOMODO") || tipo.includes("ENTRADA") || tipo.includes("INGRESO")) {
        mapaExcedentes[idUnico].entradas += cantidad;
      } else if (tipo.includes("SURTIDO") || tipo.includes("SALIDA") || tipo.includes("TRASPASO")) {
        mapaExcedentes[idUnico].salidas += cantidad;
      }
    });

    // Convertir mapa a array y calcular balance final
    return Object.values(mapaExcedentes)
      .map(item => {
        item.balance = item.entradas - item.salidas;
        return item;
      })
      .filter(item => item.balance > 0) // Opcional: solo mostrar lo que tiene stock real
      .sort((a, b) => b.balance - a.balance); // Los de mayor stock arriba

  } catch (e) {
    Logger.log("Error: " + e.toString());
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