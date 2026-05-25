const OWNED_APPS_PROPERTY = "_pcOwnedApplications";

export function renderSheetOwnedApplication(sheet, key, application, renderOptions = { force: true }) {
  if (!sheet || !key || !application) return application;

  sheet[OWNED_APPS_PROPERTY] ??= {};
  closeSheetOwnedApplication(sheet, key, { ownedReplacement: true });
  sheet[OWNED_APPS_PROPERTY][key] = application;

  if (typeof application.close === "function") {
    const closeApplication = application.close.bind(application);
    application.close = async (...args) => {
      if (sheet[OWNED_APPS_PROPERTY]?.[key] === application) delete sheet[OWNED_APPS_PROPERTY][key];
      return closeApplication(...args);
    };
  }

  if (typeof sheet.renderChild === "function") sheet.renderChild(application, renderOptions);
  else application.render(renderOptions);
  return application;
}

export function closeSheetOwnedApplication(sheet, key, closeOptions = {}) {
  const application = sheet?.[OWNED_APPS_PROPERTY]?.[key];
  if (!application) return;
  delete sheet[OWNED_APPS_PROPERTY][key];
  if (typeof application.close === "function") application.close(closeOptions);
}

export function closeSheetOwnedApplications(sheet) {
  const applications = sheet?.[OWNED_APPS_PROPERTY];
  if (!applications) return;

  for (const [key, application] of Object.entries(applications)) {
    delete applications[key];
    if (typeof application?.close === "function") application.close({ ownedSheetClosing: true });
  }
}
