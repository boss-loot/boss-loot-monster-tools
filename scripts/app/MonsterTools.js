import { ApplicationV2, HandlebarsApplicationMixin, CR_ORDER, CR_STEP_LIMIT, MODULE_NAME, NAMESPACE } from '../constants.js';
import { crNumberToString, crStringToNumber, formatSignedNumber, chooseHp, getGuidelinesTable } from '../utils.js';
import { getAbilityScore, rollbackActor, scaleDamageDiceOnItems, setAbilityScore, addMultiattack } from '../actor-updates.js';
import { GuidelinesTable } from './GuidelinesTable.js';

export class MonsterTools extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(npcData, options = {}) {
    super(options);

    this.actors = npcData.actors;
    this.tokens = npcData.tokens;
    this.table = getGuidelinesTable();

    const windowTitle = game.i18n.localize(`${MODULE_NAME}.MonsterTools.WindowTitle`);
    const moduleVersion = game.modules.get(MODULE_NAME)?.version;
    this.uiTitle = `${windowTitle} - v${moduleVersion}`;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_NAME}-monster-tools`,
    classes: ['blmt'],
    window: {
      title: 'Default Title',
      resizable: true,
    },
    position: {
      width: 520,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_NAME}/templates/monster-tools.hbs`,
    },
  };

  /**
   * UI Title
   */
  get title() {
    return this.uiTitle;
  }

  async _prepareContext(_options) {
    // There will be always just one actor
    const crValue = foundry.utils.getProperty(this.actors[0], 'system.details.cr'); // eg: 0.5
    const currentStringCr = crNumberToString(crValue) ?? '0'; // eg: "1/2" or fallback to 0
    const chosenStringCr = this._chosenCr ?? currentStringCr;

    const crData = this.table[chosenStringCr]; // data specific to the CR: prof, ac, pubHp, atkBonus, multi, etc

    const hpMode = this._hpMode ?? 'avg'; // TODO: maybe a constant with all the possible values

    const targetPubHp = chooseHp(crData, hpMode);
    const targetAbilityBonus = crData.abilityBonus;
    const targetDamageStep = crData.damageDiceStep;

    const tokenList = this.tokens.filter(token => token.actor);
    const tokenCount = tokenList.length;
    const tokenNames = tokenList.map(token => token.document.name).join(', ');
    const tokenPortraits = tokenList.map(token => {
      let img = token.document.texture.src; // Prefer token image
      const textureExtension = img?.split('.')?.pop()?.toLowerCase();
      if (textureExtension in CONST.VIDEO_FILE_EXTENSIONS) {
        img = token.actor.img;
      }
      return { img, name: token.document.name };
    });

    const isSingleToken = tokenCount === 1;
    const newActorName = '';
    const newTokenNamePlaceholder = isSingleToken
      ? game.i18n.localize(`${MODULE_NAME}.MonsterTools.TokenNamePlaceholderSingle`)
      : game.i18n.localize(`${MODULE_NAME}.MonsterTools.TokenNamePlaceholderMulti`);
    const selectionHint = tokenCount > 1 ? game.i18n.localize(`${MODULE_NAME}.MonsterTools.MultipleSelectedHint`) : '';

    const previewAbilityBonus = this.table[currentStringCr].abilityBonus;
    const abilityDeltaDisplay = formatSignedNumber(targetAbilityBonus - previewAbilityBonus);
    const previewDamageStep = this.table[currentStringCr].damageDiceStep;
    const damageDeltaDisplay = formatSignedNumber(targetDamageStep - previewDamageStep);

    const currentCrDropdown = {
      [currentStringCr]: true,
    };

    // Disabled CR options will apply to the original CR
    const limitCrSteps = this._limitCrSteps ?? true;
    const disabledCrOptions = {};
    if (limitCrSteps) {
      const originalCR = foundry.utils.getProperty(this.actors[0], `flags.${MODULE_NAME}.backupData.originalCR`) ?? currentStringCr; // TODO: make sure originalCR is stored as Number
      const baseIndex = CR_ORDER.indexOf(crNumberToString(originalCR));
      const minIndex = Math.max(0, baseIndex - CR_STEP_LIMIT);
      const maxIndex = Math.min(CR_ORDER.length - 1, baseIndex + CR_STEP_LIMIT);
      const allowed = new Set(CR_ORDER.slice(minIndex, maxIndex + 1));

      for (const cr of CR_ORDER) {
        if (!allowed.has(cr)) disabledCrOptions[cr] = true;
      }
    }

    return {
      moduleId: MODULE_NAME,
      tokenCount,
      canCreateActor: isSingleToken,
      tokenNames,
      tokenPortraits,
      newActorName,
      newTokenNamePlaceholder,
      selectionHint,
      currentCrDropdown,
      crOptions: CR_ORDER,
      chosenCr: chosenStringCr,
      hpMode,
      limitCrSteps,
      disabledCrOptions,
      applyAC: this._applyAC ?? true,
      applyHP: this._applyHP ?? true,
      applyAbilities: this._applyAbilities ?? true,
      scaleDamageDice: this._scaleDamageDice ?? true,
      scaleInitiative: this._scaleInitiative ?? true,
      crData,
      targetPubHp,
      abilityDeltaDisplay,
      damageDeltaDisplay,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const form = this.element.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', this._onSubmit.bind(this));

    const openGuidelines = form.querySelector('button[data-action="openGuidelines"]');
    openGuidelines.addEventListener('click', async () => {
      new GuidelinesTable().render({ force: true });
    });

    const targetCr = form.querySelector('select[name="targetCR"]');
    if (targetCr) {
      targetCr.addEventListener('change', ev => {
        this._chosenCr = ev.currentTarget.value;
        this.render({ force: true });
      });
    }

    const hpModes = form.querySelectorAll('input[name="hpMode"]');
    for (const hpMode of hpModes) {
      hpMode.addEventListener('change', ev => {
        this._hpMode = ev.currentTarget.value;
        this.render({ force: true });
      });
    }

    for (const name of ['limitCrSteps', 'applyAC', 'applyHP', 'applyAbilities', 'scaleDamageDice', 'scaleInitiative']) {
      const checkbox = form.querySelector(`input[name="${name}"]`);
      if (!checkbox) continue;
      checkbox.addEventListener('change', ev => {
        // Event listener needed for when the checkbox are updated and the CR dropdown is changed.
        this[`_${name}`] = ev.currentTarget.checked;
        if (name === 'limitCrSteps') this.render({ force: true });
      });
    }
  }

  async _onSubmit(event) {
    event.preventDefault();

    const action = event.submitter?.dataset?.action; // "apply" or "revert"
    const formData = new foundry.applications.ux.FormDataExtended(event.currentTarget).object;

    switch (action) {
      case 'apply':
        await this._applyChanges(foundry.utils.expandObject(formData));
        break;
      case 'revert':
        await this._revertChanges();
        break;
      case 'actor':
        await this._createActorFromChanges(foundry.utils.expandObject(formData));
        break;
      default:
        console.error(`${NAMESPACE} | Unknown button action!`);
    }
  }

  async _revertChanges() {
    for (const actor of this.actors) {
      await rollbackActor(actor);
    }
    ui.notifications.info(game.i18n.localize(`${MODULE_NAME}.Notifications.RevertedActors`), { console: false });
    this._chosenCr = null; // TODO: Maybe return the new CR from rollbackActor insted of null
    this.render({ force: true });
  }

  async _applyChanges(data) {
    for (const actor of this.actors) {
      const updates = await this._buildActorUpdates(actor, data);

      await actor.update(updates);

      if (data.scaleDamageDice) {
        await scaleDamageDiceOnItems(actor, Number(data.updates.damageDeltaDisplay));
      }

      /*
        CR 0–1/8: 1 attack
        CR 1/4–4: 2 attacks
        CR 5–25: 3 attacks
        CR 26+: 4 attacks
      */
      const targetCR = crStringToNumber(data.targetCR); // Number
      if (targetCR > 25) {
        await addMultiattack(actor, 'four', data.targetCR);
      } else if (targetCR > 4) {
        await addMultiattack(actor, 'three', data.targetCR);
      } else if (targetCR > 0.125) {
        await addMultiattack(actor, 'two', data.targetCR);
      } else {
        await addMultiattack(actor, 'one', data.targetCR);
      }
    }

    ui.notifications.info(game.i18n.localize(`${MODULE_NAME}.Notifications.AppliedActors`), { console: false });

    this.render({ force: true });
  }

  async _createActorFromChanges(data) {
    for (const actor of this.actors) {
      const updates = await this._buildActorUpdates(actor, data, false);

      const src = actor.toObject();
      const actorData = foundry.utils.mergeObject(src, updates);

      // Sanitize the updates
      delete actorData._id;
      if (actorData.flags?.[MODULE_NAME]?.backupData) {
        delete actorData.flags[MODULE_NAME].backupData;
      }
      actorData.folder = null; // Always create the actor on root level

      const newActor = await Actor.create(actorData);

      if (data.scaleDamageDice) {
        await scaleDamageDiceOnItems(newActor, Number(data.updates.damageDeltaDisplay), false);
      }

      /*
        CR 0–1/8: 1 attack
        CR 1/4–4: 2 attacks
        CR 5–25: 3 attacks
        CR 26+: 4 attacks
      */
      const targetCR = crStringToNumber(data.targetCR); // Number
      if (targetCR > 25) {
        await addMultiattack(newActor, 'four', data.targetCR, false);
      } else if (targetCR > 4) {
        await addMultiattack(newActor, 'three', data.targetCR, false);
      } else if (targetCR > 0.125) {
        await addMultiattack(newActor, 'two', data.targetCR, false);
      } else {
        await addMultiattack(newActor, 'one', data.targetCR, false);
      }
    }

    ui.notifications.info(game.i18n.localize(`${MODULE_NAME}.Notifications.CreateActor`), { console: false });

    this.render({ force: true });
  }

  async _buildActorUpdates(actor, data, trackRollback = true) {
    const requestedName = data.actorName.trim();
    const targetCR = crStringToNumber(data.targetCR); // Number

    const updates = {};

    const crValue = foundry.utils.getProperty(actor, 'system.details.cr'); // Number, eg: 0.5
    const abilityDelta = Number(data.updates.abilityDeltaDisplay);

    if (crValue !== targetCR) {
      updates['system.details.cr'] = targetCR;

      const originalCr = foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData.originalCR`);
      if (originalCr == null && trackRollback) {
        updates[`flags.${MODULE_NAME}.backupData.originalCR`] = crValue;
      }
    }

    // TODO: Update the token name instead of the actor name
    if (requestedName && actor.name !== requestedName) {
      updates.name = requestedName;

      if (!foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData.originalName`) && trackRollback) {
        updates[`flags.${MODULE_NAME}.backupData.originalName`] = actor.name;
      }
    }

    if (data.applyAC) {
      const acValue = foundry.utils.getProperty(actor, 'system.attributes.ac.value');
      const acCalc = foundry.utils.getProperty(actor, 'system.attributes.ac.calc');
      const acLabel = foundry.utils.getProperty(actor, 'system.attributes.ac.label');

      updates['system.attributes.ac.value'] = Number(data.updates.ac);

      if (!foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData.originalAC`) && trackRollback) {
        updates[`flags.${MODULE_NAME}.backupData.originalAC.value`] = acValue;
        updates[`flags.${MODULE_NAME}.backupData.originalAC.calc`] = acCalc; // useless but keep it
        updates[`flags.${MODULE_NAME}.backupData.originalAC.label`] = acLabel; // useless but keep it
      }
    }

    if (data.applyHP) {
      const hp = foundry.utils.getProperty(actor, 'system.attributes.hp');
      const newHp = Number(data.updates.hp);

      updates['system.attributes.hp.max'] = newHp;
      updates['system.attributes.hp.value'] = newHp;

      if (!foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData.originalHP`) && trackRollback) {
        updates[`flags.${MODULE_NAME}.backupData.originalHP`] = { max: hp.max, value: hp.value };
      }
    }

    if (data.applyAbilities) {
      if (abilityDelta !== 0) {
        const origAbilities = getAbilityScore(actor);
        setAbilityScore(actor, abilityDelta, updates);

        if (!foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData.originalAbilities`) && trackRollback) {
          updates[`flags.${MODULE_NAME}.backupData.originalAbilities`] = origAbilities;
        }
      }
    }

    if (data.scaleInitiative) {
      // Update the initiative bonus
      const origInitiativeBonus = foundry.utils.getProperty(actor, 'system.attributes.init.bonus');
      const newInitiativeBonus = data.updates.init;

      updates['system.attributes.init.bonus'] = newInitiativeBonus;

      if (!foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData.originalInitiativeBonus`) && trackRollback) {
        updates[`flags.${MODULE_NAME}.backupData.originalInitiativeBonus`] = origInitiativeBonus;
      }
    }

    return updates;
  }
}
