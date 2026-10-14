/**
 * z3-NegativosBirlosService
 *
 * @fileoverview Servicio de dominio para construir la vista de existencias
 * negativas de Birlos y enriquecer cada SKU con dos balances de excedentes:
 * el balance histórico de EXISTENCIAS y el balance vigente por IdUnico.
 *
 * Responsabilidades:
 * - Consultar los registros negativos desde ExistenciasRepository.
 * - Conservar una ubicación de surtido válida por código.
 * - Clasificar bodegas de Casa Blanca y bodegas de excedentes.
 * - Consultar excedentes auditables desde EstadoActualExcedentesService.
 * - Consolidar saldos e IdUnicos vigentes por SKU y tipo de bodega.
 * - Enriquecer cada negativo sin sobrescribir el balance histórico.
 * - Mantener el contrato compatible con la vista existente.
 * - Devolver una respuesta tolerante cuando ocurre un error operativo.
 *
 * Dependencias globales:
 * - ExistenciasRepository.
 * - UbicacionesSurtidoRepository.
 * - EstadoActualExcedentesService como fuente opcional del balance por IdUnico.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 *
 * Reglas de integridad:
 * - Solo participan registros con código e IdUnico válidos.
 * - Los saldos por IdUnico deben ser mayores que cero.
 * - Cada IdUnico se contabiliza una sola vez por código.
 * - Casa Blanca y las bodegas de excedentes se contabilizan por separado.
 * - excedenteTotalIdUnico es la suma de ambos segmentos.
 * - El balance de EXISTENCIAS se conserva sin alteraciones semánticas.
 * - El servicio no realiza escrituras ni modifica inventarios.
 *
 * Política de errores:
 * - La ausencia del servicio canónico no interrumpe la vista.
 * - Los endpoints públicos devuelven estructuras vacías compatibles ante error.
 * - Los errores se registran con un prefijo uniforme y sin emojis técnicos.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const NegativosBirlosService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    LOCALE: "es-MX",
    GLOBAL_AUDIT_TYPE: "GLOBAL",
    ALL_WAREHOUSES: "TODAS",
    DEFAULT_BALANCE_MODE: "EXISTENCIAS",
    ID_BALANCE_MODE: "IDUNICO",
    BUILD: "NEGATIVOS-BIRLOS-BALANCE-DUAL-2026-10-14",
    LOG_PREFIX: "[NegativosBirlosService]"
  });

  // ==========================================================================
  // VALIDACIÓN Y FUENTES
  // ==========================================================================

  /**
   * Verifica las dependencias obligatorias del servicio.
   *
   * EstadoActualExcedentesService es opcional porque el contrato de la vista
   * permite operar únicamente con el balance histórico de EXISTENCIAS.
   *
   * @return {void}
   * @throws {Error} Si falta un repositorio o utilidad indispensable.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_]
    ];
    const missingFunctions = functions
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan utilidades globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }

    const repositories = [
      ["ExistenciasRepository", typeof ExistenciasRepository],
      [
        "UbicacionesSurtidoRepository",
        typeof UbicacionesSurtidoRepository
      ]
    ];
    const missingRepositories = repositories
      .filter(function (dependency) {
        return dependency[1] === "undefined";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingRepositories.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan repositorios obligatorios: ` +
          `${missingRepositories.join(", ")}.`
      );
    }
  }

  /**
   * Devuelve un valor si es arreglo o una colección vacía.
   *
   * @param {*} value Valor recibido desde una fuente externa.
   * @return {!Array<*>} Arreglo seguro.
   * @private
   */
  function _safeArray_(value) {
    return Array.isArray(value) ? value : [];
  }

  /**
   * Consulta las existencias negativas de Birlos.
   *
   * @return {!Array<!Object>} Registros negativos informados por el repositorio.
   * @throws {Error} Si el repositorio no implementa el contrato requerido.
   * @private
   */
  function _getNegativos_() {
    if (typeof ExistenciasRepository.getNegativosBirlos !== "function") {
      throw new Error(
        `${CFG.LOG_PREFIX} ExistenciasRepository no implementa ` +
          "getNegativosBirlos()."
      );
    }

    return _safeArray_(ExistenciasRepository.getNegativosBirlos());
  }

  /**
   * Conserva la primera ubicación de surtido válida por código.
   *
   * Los códigos o ubicaciones vacíos se descartan. Esta estrategia mantiene
   * compatibilidad con la vista actual, cuyo saldo se maneja a nivel SKU.
   *
   * @return {!Array<!Object>} Ubicaciones únicas y ordenadas por código.
   * @private
   */
  function _getUbicacionesSurtidoSanitizadas_() {
    if (typeof UbicacionesSurtidoRepository.getAll !== "function") {
      throw new Error(
        `${CFG.LOG_PREFIX} UbicacionesSurtidoRepository no implementa getAll().`
      );
    }

    const index = Object.create(null);
    _safeArray_(UbicacionesSurtidoRepository.getAll()).forEach(
      function (item) {
        const code = toStrUpper_(item && item.codigo);
        const location = toStrUpper_(item && item.ubicacion);

        if (!code || !location) {
          return;
        }

        if (!Object.prototype.hasOwnProperty.call(index, code)) {
          index[code] = {
            codigo: code,
            ubicacion: location,
            idproducto: toStr_(item.idproducto),
            bodega: toStr_(item.bodega),
            pasillo: toStr_(item.pasillo),
            anaquel: toStr_(item.anaquel),
            repisa: toStr_(item.repisa)
          };
        }
      }
    );

    return Object.keys(index)
      .map(function (code) {
        return index[code];
      })
      .sort(function (left, right) {
        return left.codigo.localeCompare(right.codigo, CFG.LOCALE, {
          numeric: true,
          sensitivity: "base"
        });
      });
  }

  // ==========================================================================
  // CLASIFICACIÓN DE BODEGAS
  // ==========================================================================

  /**
   * Determina si una bodega pertenece al segmento Casa Blanca.
   *
   * @param {*} bodega Nombre o código de bodega.
   * @return {boolean} true cuando pertenece a Casa Blanca.
   * @private
   */
  function _esCasaBlanca_(bodega) {
    const value = toStrUpper_(bodega);
    return (
      value === "CASA BLANCA 1" ||
      value === "CASA BLANCA 2" ||
      value.startsWith("CB1") ||
      value.startsWith("CB2")
    );
  }

  /**
   * Determina si una bodega pertenece al segmento de excedentes.
   *
   * @param {*} bodega Nombre o código de bodega.
   * @return {boolean} true cuando pertenece a una bodega reconocida.
   * @private
   */
  function _esBodegaExcedente_(bodega) {
    const value = toStrUpper_(bodega);
    return (
      value === "BODEGA 1" ||
      value === "BODEGA 2" ||
      value === "BODEGA 3" ||
      value === "BODEGA MOSTRADOR" ||
      value === "CUARTO ALTO RIESGO" ||
      value === "MOSTRADOR" ||
      value.startsWith("B1") ||
      value.startsWith("B2") ||
      value.startsWith("B3") ||
      value.startsWith("BM") ||
      value.startsWith("CU") ||
      value.startsWith("MO")
    );
  }

  // ==========================================================================
  // BALANCE VIGENTE POR ID ÚNICO
  // ==========================================================================

  /**
   * Crea la estructura inicial del balance de un SKU.
   *
   * @param {string} code Código normalizado.
   * @return {!Object} Acumulador vacío del código.
   * @private
   */
  function _createBalance_(code) {
    return {
      codigo: code,
      excedentebodegaIdUnico: 0,
      excedentecasablancaIdUnico: 0,
      excedenteTotalIdUnico: 0,
      idsUnicosExcedenteBodega: [],
      idsUnicosExcedenteCasaBlanca: [],
      detalleIdUnicoExcedentes: [],
      detalleIdUnicoBodega: [],
      detalleIdUnicoCasaBlanca: []
    };
  }

  /**
   * Consolida los excedentes auditables por código e IdUnico.
   *
   * Evita contar dos veces el mismo IdUnico dentro de un SKU. Si el servicio
   * canónico no está disponible, devuelve un índice vacío compatible.
   *
   * @return {!Object<string,!Object>} Balance vigente indexado por código.
   * @private
   */
  function _construirBalanceIdUnicoPorCodigo_() {
    const index = Object.create(null);

    if (
      typeof EstadoActualExcedentesService === "undefined" ||
      !EstadoActualExcedentesService ||
      typeof EstadoActualExcedentesService.getAuditables !== "function"
    ) {
      console.warn(
        CFG.LOG_PREFIX + " EstadoActualExcedentesService no disponible."
      );
      return index;
    }

    let auditables;
    try {
      auditables = _safeArray_(
        EstadoActualExcedentesService.getAuditables({
          tipoAuditoria: CFG.GLOBAL_AUDIT_TYPE,
          bodegaObjetivo: CFG.ALL_WAREHOUSES
        })
      );
    } catch (error) {
      console.error(
        CFG.LOG_PREFIX + " No se pudo construir el balance por IdUnico:",
        error
      );
      return index;
    }

    const processedIdsByCode = Object.create(null);
    auditables.forEach(function (item) {
      const code = toStrUpper_(item && item.codigo);
      const uniqueId = toStr_(item && (item.idUnico || item.idunico));
      const warehouse = toStrUpper_(
        item && (item.bodegaActual || item.bodega)
      );
      const location = toStrUpper_(
        item && (item.ubicacionActual || item.ubicacion)
      );
      const currentBalance = Number(item && item.saldoActual);

      if (
        !code ||
        !uniqueId ||
        !Number.isFinite(currentBalance) ||
        currentBalance <= 0
      ) {
        return;
      }

      if (!processedIdsByCode[code]) {
        processedIdsByCode[code] = new Set();
      }
      if (processedIdsByCode[code].has(uniqueId)) {
        return;
      }
      processedIdsByCode[code].add(uniqueId);

      if (!index[code]) {
        index[code] = _createBalance_(code);
      }

      const detail = {
        idUnico: uniqueId,
        bodega: warehouse,
        ubicacion: location,
        sku: code,
        cantidadIdUnico: currentBalance
      };
      const balance = index[code];

      if (_esCasaBlanca_(warehouse)) {
        balance.excedentecasablancaIdUnico += currentBalance;
        balance.idsUnicosExcedenteCasaBlanca.push(uniqueId);
        balance.detalleIdUnicoCasaBlanca.push(detail);
        balance.detalleIdUnicoExcedentes.push(detail);
      } else if (_esBodegaExcedente_(warehouse)) {
        balance.excedentebodegaIdUnico += currentBalance;
        balance.idsUnicosExcedenteBodega.push(uniqueId);
        balance.detalleIdUnicoBodega.push(detail);
        balance.detalleIdUnicoExcedentes.push(detail);
      }

      balance.excedenteTotalIdUnico =
        balance.excedentebodegaIdUnico +
        balance.excedentecasablancaIdUnico;
    });

    return index;
  }

  // ==========================================================================
  // ENRIQUECIMIENTO Y RESPUESTA
  // ==========================================================================

  /**
   * Enriquece los negativos con balances histórico y vigente.
   *
   * @param {!Array<!Object>} negativos Registros negativos de EXISTENCIAS.
   * @return {!Array<!Object>} Registros enriquecidos para la interfaz.
   * @private
   */
  function _enriquecerNegativosConBalances_(negativos) {
    const balances = _construirBalanceIdUnicoPorCodigo_();

    return _safeArray_(negativos).map(function (item) {
      const code = toStrUpper_(item && item.codigo);
      const idBalance = balances[code] || null;
      const warehouseSurplus = toNum_(item && item.excedentebodega);
      const whiteHouseSurplus = toNum_(
        item && item.excedentecasablanca
      );
      const historicalTotal = warehouseSurplus + whiteHouseSurplus;
      const warehouseIdBalance = idBalance
        ? toNum_(idBalance.excedentebodegaIdUnico)
        : 0;
      const whiteHouseIdBalance = idBalance
        ? toNum_(idBalance.excedentecasablancaIdUnico)
        : 0;

      return Object.assign({}, item, {
        idproducto: item && item.idproducto,
        codigo: code,
        descripcion: toStrUpper_(item && item.descripcion),
        almacenbirlos: toNum_(item && item.almacenbirlos),
        excedentebodega: warehouseSurplus,
        excedentecasablanca: whiteHouseSurplus,
        excedenteTotalExistencias: historicalTotal,
        excedentebodegaIdUnico: warehouseIdBalance,
        excedentecasablancaIdUnico: whiteHouseIdBalance,
        excedenteTotalIdUnico:
          warehouseIdBalance + whiteHouseIdBalance,
        idsUnicosExcedenteBodega: idBalance
          ? [...idBalance.idsUnicosExcedenteBodega]
          : [],
        idsUnicosExcedenteCasaBlanca: idBalance
          ? [...idBalance.idsUnicosExcedenteCasaBlanca]
          : [],
        detalleIdUnicoExcedentes: idBalance
          ? idBalance.detalleIdUnicoExcedentes.map(function (detail) {
              return Object.assign({}, detail);
            })
          : [],
        detalleIdUnicoBodega: idBalance
          ? idBalance.detalleIdUnicoBodega.map(function (detail) {
              return Object.assign({}, detail);
            })
          : [],
        detalleIdUnicoCasaBlanca: idBalance
          ? idBalance.detalleIdUnicoCasaBlanca.map(function (detail) {
              return Object.assign({}, detail);
            })
          : [],
        modoBalanceDisponibleIdUnico: Boolean(idBalance)
      });
    });
  }

  /**
   * Construye los metadatos estándar de la vista.
   *
   * @param {string=} errorMessage Mensaje opcional de error.
   * @return {!Object} Metadatos compatibles con la interfaz.
   * @private
   */
  function _buildMeta_(errorMessage) {
    const meta = {
      modoBalanceDefault: CFG.DEFAULT_BALANCE_MODE,
      modosBalanceDisponibles: [
        CFG.DEFAULT_BALANCE_MODE,
        CFG.ID_BALANCE_MODE
      ],
      build: CFG.BUILD
    };

    if (errorMessage) {
      meta.error = toStr_(errorMessage);
    }
    return meta;
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================

  /**
   * Devuelve negativos, ubicaciones de surtido y metadatos de balance.
   *
   * La operación es tolerante: ante cualquier error devuelve colecciones vacías
   * con el mismo contrato esperado por la vista.
   *
   * @return {!Object} Vista completa para NegativosBirlos.
   * @public
   */
  function getVista() {
    try {
      _assertDependencies_();
      const negativos = _enriquecerNegativosConBalances_(
        _getNegativos_()
      );
      const ubicacionesSurtido =
        _getUbicacionesSurtidoSanitizadas_();

      return {
        negativos,
        ubicacionesSurtido,
        meta: _buildMeta_()
      };
    } catch (error) {
      const message =
        error && error.message ? error.message : String(error || "");
      console.error(CFG.LOG_PREFIX + " getVista falló:", message);
      if (error && error.stack) {
        console.error(CFG.LOG_PREFIX + " getVista stack:", error.stack);
      }

      return {
        negativos: [],
        ubicacionesSurtido: [],
        meta: _buildMeta_(message)
      };
    }
  }

  return Object.freeze({
    getVista
  });
})();
