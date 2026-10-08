/**
 * Imports.gs
 *
 * Centraliza la preparación de variables y recursos inyectados en las
 * plantillas HTML de APPALMACEN.
 *
 * Responsabilidades:
 * - Resolver el tema visual activo de la aplicación.
 * - Resolver de forma independiente el tema de la barra lateral.
 * - Resolver y validar el tema del loader.
 * - Generar los bundles de recursos y navegación.
 * - Serializar la configuración que consume el navegador.
 * - Inicializar variables comunes utilizadas por vistas y etiquetas.
 *
 * Dependencias globales:
 * - APPALMACEN_THEME
 * - APPALMACEN_THEME_ACTIVE
 * - APPALMACEN_SIDEBAR_THEMES
 * - APPALMACEN_COMPONENTS
 * - APPALMACEN_LOADER
 * - APPALMACEN_BRAND
 * - APPALMACEN_TEMPLATE
 * - APPALMACEN_ROUTING
 * - APPALMACEN_TESTING, opcional
 * - Fito_Library
 * - Utilities
 * - obtenerDatosParaWeb(), opcional
 *
 * Contrato de salida:
 * La función pública interna APPALMACEN_applyTemplateImports_ agrega al objeto
 * template todas las propiedades requeridas por el shell APPALMACEN y devuelve
 * la misma instancia recibida.
 *
 * Invariantes:
 * - El tema de la aplicación siempre tiene un fallback válido.
 * - La barra lateral puede utilizar tema dark, light o derivado de la app.
 * - El loader solo recibe los temas white o black.
 * - Las configuraciones del cliente se serializan mediante JSON.stringify().
 * - La ausencia de APPALMACEN_TESTING produce un objeto JSON vacío.
 * - La ausencia de obtenerDatosParaWeb() produce un lote vacío.
 */

/**
 * Resuelve el tema visual principal de la aplicación.
 *
 * @return {Object} Tema activo o tema blanco de respaldo.
 * @private
 */
function APPALMACEN_resolveAppTheme_() {
  return (
    APPALMACEN_THEME[APPALMACEN_THEME_ACTIVE] ||
    APPALMACEN_THEME.white
  );
}

/**
 * Resuelve el tema de la barra lateral sin modificar el tema principal.
 *
 * Valores admitidos:
 * - dark: fuerza el tema oscuro.
 * - light: fuerza el tema claro.
 * - app: deriva el tema desde APPALMACEN_THEME_ACTIVE.
 *
 * @return {Object} Configuración visual de la barra lateral.
 * @private
 */
function APPALMACEN_resolveSidebarTheme_() {
  var sidebarConfig =
    APPALMACEN_COMPONENTS && APPALMACEN_COMPONENTS.SIDEBAR
      ? APPALMACEN_COMPONENTS.SIDEBAR
      : {};

  var sidebarThemeKey = sidebarConfig.THEME || "dark";

  if (sidebarThemeKey === "app") {
    return APPALMACEN_THEME_ACTIVE === "black"
      ? APPALMACEN_SIDEBAR_THEMES.dark
      : APPALMACEN_SIDEBAR_THEMES.light;
  }

  return (
    APPALMACEN_SIDEBAR_THEMES[sidebarThemeKey] ||
    APPALMACEN_SIDEBAR_THEMES.dark
  );
}

/**
 * Resuelve y valida el tema del loader.
 *
 * @param {Object} appTheme Tema visual activo de la aplicación.
 * @return {string} Tema white o black.
 * @private
 */
function APPALMACEN_resolveLoaderTheme_(appTheme) {
  var loaderConfig =
    APPALMACEN_COMPONENTS && APPALMACEN_COMPONENTS.LOADER
      ? APPALMACEN_COMPONENTS.LOADER
      : {};

  var loaderThemeKey = loaderConfig.THEME || "app";
  var loaderTheme =
    loaderThemeKey === "app"
      ? appTheme.loader
      : loaderThemeKey;

  return loaderTheme === "black" ? "black" : "white";
}

/**
 * Construye la configuración utilizada por Fito_Library para renderizar el
 * loader inicial.
 *
 * @return {Object} Configuración normalizada del loader.
 * @private
 */
function APPALMACEN_buildLoaderConfig_() {
  return {
    mode: APPALMACEN_LOADER.MODE,
    rootId: APPALMACEN_LOADER.ROOT_ID,
    appName: APPALMACEN_BRAND.APP_NAME,
    appSubtitle: APPALMACEN_BRAND.APP_SUBTITLE,
    logoUrl: APPALMACEN_BRAND.LOGO_URL,
    logoFallback: APPALMACEN_BRAND.LOGO_FALLBACK,
    loadingText: APPALMACEN_LOADER.LOADING_TEXT,
    includeStyles: true,
    minifyCss: false
  };
}

/**
 * Construye el bundle de la barra lateral correspondiente a la página.
 *
 * Las páginas de prueba reciben todas las barras laterales. Las páginas
 * normales reciben únicamente la barra lateral activa.
 *
 * @param {string} pagina Nombre lógico de la página solicitada.
 * @return {string} HTML y recursos de la barra lateral.
 * @private
 */
function APPALMACEN_buildSidebarBundle_(pagina) {
  return pagina === APPALMACEN_ROUTING.TEST_PAGE
    ? Fito_Library.sidebarAllBundle()
    : Fito_Library.sidebarBundle(
        APPALMACEN_COMPONENTS.SIDEBAR.ACTIVE
      );
}

/**
 * Obtiene el lote común utilizado por plantillas que requieren datos iniciales.
 *
 * @return {Array<*>} Datos normalizados o arreglo vacío.
 * @private
 */
function APPALMACEN_getTemplateBatch_() {
  if (typeof obtenerDatosParaWeb !== "function") {
    return [];
  }

  var lote = obtenerDatosParaWeb();
  return Array.isArray(lote) ? lote : [];
}

/**
 * Inyecta recursos, configuración serializada y variables comunes en una
 * plantilla de Google Apps Script HtmlService.
 *
 * @param {Object} template Plantilla creada mediante HtmlService.
 * @param {string=} pagina Nombre lógico de la página solicitada.
 * @return {Object} La misma plantilla enriquecida con sus dependencias.
 * @throws {Error} Si no se recibió una plantilla válida.
 */
function APPALMACEN_applyTemplateImports_(template, pagina) {
  if (!template || typeof template !== "object") {
    throw new Error(
      "APPALMACEN_applyTemplateImports_: se requiere una plantilla válida."
    );
  }

  var appTheme = APPALMACEN_resolveAppTheme_();
  var sidebarTheme = APPALMACEN_resolveSidebarTheme_();
  var loaderTheme = APPALMACEN_resolveLoaderTheme_(appTheme);
  var loaderConfig = APPALMACEN_buildLoaderConfig_();

  /**
   * Tema final enviado al navegador. La configuración de la barra lateral se
   * combina sin mutar el objeto original de APPALMACEN_THEME.
   */
  var theme = Object.assign({}, appTheme, {
    sidebar: sidebarTheme
  });

  // Documento y recursos externos.
  template.DOCUMENT_TITLE = APPALMACEN_BRAND.DOCUMENT_TITLE;
  template.IMPORT_RESOURCE_TAGS = Fito_Library.importTags(
    APPALMACEN_TEMPLATE.IMPORT_BUNDLE
  );

  // Navegación lateral.
  template.SIDEBAR_BUNDLE = APPALMACEN_buildSidebarBundle_(pagina);

  // Configuración serializada para el navegador.
  template.APPALMACEN_COMPONENTS_JSON = JSON.stringify(
    APPALMACEN_COMPONENTS
  );
  template.APPALMACEN_TESTING_JSON =
    typeof APPALMACEN_TESTING !== "undefined"
      ? JSON.stringify(APPALMACEN_TESTING)
      : JSON.stringify({});
  template.APPALMACEN_THEME_JSON = JSON.stringify(theme);
  template.APPALMACEN_THEMES_JSON = JSON.stringify(APPALMACEN_THEME);
  template.APPALMACEN_SIDEBAR_THEMES_JSON = JSON.stringify(
    APPALMACEN_SIDEBAR_THEMES
  );
  template.APPALMACEN_BRAND_JSON = JSON.stringify(APPALMACEN_BRAND);

  // Loader inicial.
  template.LOADER_HTML =
    loaderTheme === "white"
      ? Fito_Library.renderLoaderWhite(loaderConfig)
      : Fito_Library.renderLoaderBlack(loaderConfig);

  // Variables comunes para vistas y plantillas de impresión.
  template.PAGE_NAME =
    pagina || APPALMACEN_TEMPLATE.DEFAULT_PAGE;
  template.ancho = APPALMACEN_TEMPLATE.LABEL.WIDTH;
  template.alto = APPALMACEN_TEMPLATE.LABEL.HEIGHT;
  template.fechaHora = Utilities.formatDate(
    new Date(),
    "GMT-6",
    "dd/MM/yyyy HH:mm"
  );
  template.lote = APPALMACEN_getTemplateBatch_();

  return template;
}
