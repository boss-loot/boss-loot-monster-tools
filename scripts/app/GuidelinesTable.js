import {
  ApplicationV2,
  HandlebarsApplicationMixin,
  DialogV2,
  MODULE_NAME,
  SETTING_GUIDELINES,
  BASE_GUIDELINES,
  CR_ORDER,
} from '../constants.js';
import { parseJSON, getGuidelinesTable } from '../utils.js';

export class GuidelinesTable extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.uiTitle = game.i18n.localize(`${MODULE_NAME}.Guidelines.WindowTitle`);
  }
  static DEFAULT_OPTIONS = {
    id: `${MODULE_NAME}-guidelines`,
    classes: ['blmt'],
    window: {
      title: 'Default Title',
      resizable: true,
    },
    position: {
      width: 1020,
      height: 1035,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_NAME}/templates/guidelines-table.hbs`,
    },
  };

  /**
   * UI Title
   */
  get title() {
    return this.uiTitle;
  }

  async _prepareContext(_options) {
    const table = getGuidelinesTable();
    return {
      rows: CR_ORDER.map(cr => table[cr]).filter(Boolean),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const form = this.element.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', this._onSubmit.bind(this));

    const licenseBtn = form.querySelector('[data-action="license"]');
    if (licenseBtn) licenseBtn.addEventListener('click', this._onLicense.bind(this));

    const resetBtn = form.querySelector('[data-action="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', this._onReset.bind(this));

    const importBtn = form.querySelector('[data-action="import"]');
    if (importBtn) importBtn.addEventListener('click', this._onImport.bind(this));

    const exportBtn = form.querySelector('[data-action="export"]');
    if (exportBtn) exportBtn.addEventListener('click', this._onExport.bind(this));
  }

  async _onSubmit(event) {
    event.preventDefault();

    const formData = new foundry.applications.ux.FormDataExtended(event.currentTarget).object;
    const formDataParsed = foundry.utils.expandObject(formData);

    await game.settings.set(MODULE_NAME, SETTING_GUIDELINES, formDataParsed);
    ui.notifications.info(game.i18n.localize(`${MODULE_NAME}.Guidelines.SaveNotification`), { console: false });
    await this.render({ force: true });
  }

  async _onReset() {
    const answer = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${MODULE_NAME}.Guidelines.ResetConfirmTitle`) },
      rejectClose: false,
      content: game.i18n.localize(`${MODULE_NAME}.Guidelines.ResetConfirmContent`),
      modal: true,
      defaultYes: false,
    });

    if (!answer) return;

    await game.settings.set(MODULE_NAME, SETTING_GUIDELINES, BASE_GUIDELINES);
    ui.notifications.info(game.i18n.localize(`${MODULE_NAME}.Guidelines.ResetNotification`), { console: false });
    await this.render({ force: true });
  }

  _onExport() {
    const table = getGuidelinesTable();
    const data = JSON.stringify(table, null, 2);
    const filename = game.i18n.localize(`${MODULE_NAME}.Guidelines.ExportFilename`);

    foundry.utils.saveDataToFile(data, 'json', filename);
  }

  async _onImport() {
    await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.Title`) },
      position: { width: 400 },
      content: await foundry.applications.handlebars.renderTemplate('templates/apps/import-data.hbs', {
        hint1: game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.Hint1`),
        hint2: game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.Hint2`),
      }),
      buttons: [
        {
          action: 'import',
          label: game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.ButtonOk`),
          icon: 'fa-solid fa-file-import',
          callback: (event, button) => {
            const form = button.form;
            if (!form.data.files.length) {
              return ui.notifications.error(game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.Error.NoFileSelected`));
            }
            foundry.utils.readTextFromFile(form.data.files[0]).then(json => this.importFromJSON(json));
          },
          default: true,
        },
        {
          action: 'no',
          label: game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.ButtonCancel`),
          icon: 'fa-solid fa-xmark',
        },
      ],
    });
  }

  async importFromJSON(json) {
    const parsedJSON = parseJSON(json, { strictKeys: true });

    if (!parsedJSON.ok) {
      console.warn('Guidelines import validation failed:', parsedJSON.errors);
      ui.notifications.error(game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.Error.InvalidInput`), { console: false });
      return;
    }

    await game.settings.set(MODULE_NAME, SETTING_GUIDELINES, parsedJSON.data);
    ui.notifications.info(game.i18n.localize(`${MODULE_NAME}.Guidelines.Import.ImportOk`), { console: false });
  }

  _onLicense() {
    DialogV2.wait({
      content: game.i18n.localize(`${MODULE_NAME}.Guidelines.LicenseContent`),
      rejectClose: false,
      form: { closeOnSubmit: true },
      window: { title: game.i18n.localize(`${MODULE_NAME}.Guidelines.LicenseTitle`) },
      position: { width: 300 },

      buttons: [
        {
          action: 'ok',
          label: game.i18n.localize(`${MODULE_NAME}.Guidelines.LicenseOk`),
        },
      ],
    });
  }
}
