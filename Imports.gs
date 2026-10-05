/**
 * Imports.gs
 *
 * Centraliza los elementos que se inyectan en los templates HTML:
 * - resources externos
 * - tema activo
 * - loader
 * - sidebar
 * - variables comunes
 */

function APPALMACEN_applyTemplateImports_(template, pagina) {
  var appTheme =
    APPALMACEN_THEME[APPALMACEN_THEME_ACTIVE] ||
    APPALMACEN_THEME.white;

  /**
   * =========================================================
   * RESOLVER TEMA DE SIDEBAR
   * =========================================================
   *
   * APPALMACEN_COMPONENTS.SIDEBAR.THEME:
   * - "dark": sidebar negra siempre
   * - "light": sidebar clara siempre
   * - "app": sidebar depende del tema activo de la app
   */

  var sidebarThemeKey =
    APPALMACEN_COMPONENTS &&
    APPALMACEN_COMPONENTS.SIDEBAR &&
    APPALMACEN_COMPONENTS.SIDEBAR.THEME
      ? APPALMACEN_COMPONENTS.SIDEBAR.THEME
      : "dark";

  var sidebarTheme;

  if (sidebarThemeKey === "app") {
    sidebarTheme =
      APPALMACEN_THEME_ACTIVE === "black"
        ? APPALMACEN_SIDEBAR_THEMES.dark
        : APPALMACEN_SIDEBAR_THEMES.light;
  } else {
    sidebarTheme =
      APPALMACEN_SIDEBAR_THEMES[sidebarThemeKey] ||
      APPALMACEN_SIDEBAR_THEMES.dark;
  }

  /**
   * Tema final enviado al cliente.
   *
   * Es el tema de la app, pero con la sidebar resuelta
   * de forma independiente.
   */

  var theme = Object.assign({}, appTheme, {
    sidebar: sidebarTheme
  });

  /**
   * =========================================================
   * RESOLVER TEMA DE LOADER
   * =========================================================
   *
   * APPALMACEN_COMPONENTS.LOADER.THEME:
   * - "app": usa appTheme.loader
   * - "white": fuerza loader white
   * - "black": fuerza loader black
   */

  var loaderThemeKey =
    APPALMACEN_COMPONENTS &&
    APPALMACEN_COMPONENTS.LOADER &&
    APPALMACEN_COMPONENTS.LOADER.THEME
      ? APPALMACEN_COMPONENTS.LOADER.THEME
      : "app";

  var loaderTheme =
    loaderThemeKey === "app"
      ? appTheme.loader
      : loaderThemeKey;

  if (loaderTheme !== "white" && loaderTheme !== "black") {
    loaderTheme = "white";
  }

  /**
   * =========================================================
   * CONFIGURACION DEL LOADER
   * =========================================================
   */

  var loaderConfig = {
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

  /**
   * =========================================================
   * DOCUMENTO / RECURSOS
   * =========================================================
   */

  template.DOCUMENT_TITLE =
    APPALMACEN_BRAND.DOCUMENT_TITLE;

  template.IMPORT_RESOURCE_TAGS =
    Fito_Library.importTags(APPALMACEN_TEMPLATE.IMPORT_BUNDLE);

  /**
   * =========================================================
   * SIDEBAR
   * =========================================================
   *
   * Si es pagina de pruebas, carga ambas sidebars.
   * Si es app normal, carga solo la sidebar activa.
   */

  template.SIDEBAR_BUNDLE =
    pagina === APPALMACEN_ROUTING.TEST_PAGE
      ? Fito_Library.sidebarAllBundle()
      : Fito_Library.sidebarBundle(APPALMACEN_COMPONENTS.SIDEBAR.ACTIVE);

  /**
   * =========================================================
   * JSON PARA CLIENTE
   * =========================================================
   */

  template.APPALMACEN_COMPONENTS_JSON =
    JSON.stringify(APPALMACEN_COMPONENTS);

  template.APPALMACEN_TESTING_JSON =
    typeof APPALMACEN_TESTING !== "undefined"
      ? JSON.stringify(APPALMACEN_TESTING)
      : JSON.stringify({});

  template.APPALMACEN_THEME_JSON =
    JSON.stringify(theme);

  template.APPALMACEN_THEMES_JSON =
    JSON.stringify(APPALMACEN_THEME);

  template.APPALMACEN_SIDEBAR_THEMES_JSON =
    JSON.stringify(APPALMACEN_SIDEBAR_THEMES);

  template.APPALMACEN_BRAND_JSON =
    JSON.stringify(APPALMACEN_BRAND);

  /**
   * =========================================================
   * LOADER
   * =========================================================
   */

  template.LOADER_HTML =
    loaderTheme === "white"
      ? Fito_Library.renderLoaderWhite(loaderConfig)
      : Fito_Library.renderLoaderBlack(loaderConfig);

  /**
   * =========================================================
   * VARIABLES COMUNES
   * =========================================================
   */

  template.PAGE_NAME =
    pagina || APPALMACEN_TEMPLATE.DEFAULT_PAGE;

  template.ancho =
    APPALMACEN_TEMPLATE.LABEL.WIDTH;

  template.alto =
    APPALMACEN_TEMPLATE.LABEL.HEIGHT;

  template.fechaHora = Utilities.formatDate(
    new Date(),
    "GMT-6",
    "dd/MM/yyyy HH:mm"
  );

  template.lote =
    typeof obtenerDatosParaWeb === "function"
      ? obtenerDatosParaWeb()
      : [];

  return template;
}