/** The settings pane: one section a setting, from state to DOM nodes. */
import type { AppState } from '../app/state';
import type { Translate } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages/en';
import { type Capability, modelLabel, supports } from '../protocol/model';
import { type Child, h } from './dom';
import {
  type Feature,
  type PaneUi,
  type Run,
  button,
  choiceRow,
  feature,
  fieldValue,
  switchRow,
} from './pane-parts';
import {
  autoStartScene,
  batteryScene,
  brightnessScene,
  deviceForm,
  findScene,
  flexPuffScene,
  gestureScene,
  lockScene,
  vibrationScene,
} from './scenes';

const FEATURE_NAMES: Partial<Record<Capability, MessageKey>> = {
  brightness: 'settings.missing.brightness',
  vibration: 'settings.missing.vibration',
  flexpuff: 'settings.missing.flexpuff',
  flexbattery: 'settings.missing.flexbattery',
  autostart: 'settings.missing.autostart',
  smartgesture: 'settings.missing.smartgesture',
  lock: 'settings.missing.lock',
};

/** What to say about a setting the device cannot be asked about. */
function lastSet(t: Translate, value: boolean | null, whenTrue: MessageKey, whenFalse: MessageKey): HTMLElement {
  return h(
    'p',
    { class: 'row-note aside' },
    value === null ? t('settings.notReported') : t('settings.lastSet', { value: t(value ? whenTrue : whenFalse) }),
  );
}

export function settingsPane(state: AppState, run: Run, ui: PaneUi): Child[] {
  const device = state.device;
  if (device === null) return [];
  const { t } = state.i18n;
  const can = (capability: Capability): boolean => supports(device.model, capability);
  const { allInOne } = deviceForm(device.model);
  const features: Feature[] = [];

  if (can('brightness')) {
    const level = fieldValue(state.brightness);
    features.push({
      id: 'light',
      title: t('settings.light.title'),
      scene: brightnessScene(level),
      guide: {
        lead: t('settings.light.lead'),
        points: [t('settings.light.low'), t('settings.light.high')],
      },
      rows: [
        choiceRow(
          ui,
          t,
          t('settings.light.brightness'),
          [
            {
              key: 'brightness-low',
              label: t('settings.light.optionLow'),
              selected: level === 'low',
              choose: () => run('brightness low'),
            },
            {
              key: 'brightness-high',
              label: t('settings.light.optionHigh'),
              selected: level === 'high',
              choose: () => run('brightness high'),
            },
          ],
          { field: state.brightness },
        ),
      ],
    });
  }

  if (can('vibration')) {
    const settings = fieldValue(state.vibration);
    const withCharge = can('charge-vibration');
    const flags: readonly (readonly [string, string, boolean | undefined])[] = [
      ['heating', t('settings.vibration.heating'), settings?.heating],
      ['starting', t('settings.vibration.starting'), settings?.starting],
      ['puffend', t('settings.vibration.puffEnd'), settings?.puffEnd],
      ['terminated', t('settings.vibration.terminated'), settings?.terminated],
      ...(withCharge ? ([['charge', t('settings.vibration.charge'), settings?.charge]] as const) : []),
    ];
    features.push({
      id: 'vibration',
      title: t('settings.vibration.title'),
      scene: vibrationScene(flags.filter(([, , on]) => on === true).length, flags.length, allInOne),
      guide: {
        lead: t('settings.vibration.lead'),
        points: [t('settings.vibration.separate'), t('settings.vibration.silent')],
      },
      field: state.vibration,
      rows: flags.map(([key, title, on]) =>
        switchRow(ui, t, `vibration-${key}`, title, on, () => run(`vibration ${key} ${on === true ? 'off' : 'on'}`)),
      ),
    });
  }

  if (can('autostart')) {
    const enabled = fieldValue(state.autostart);
    features.push({
      id: 'auto-start',
      title: t('settings.autoStart.title'),
      scene: autoStartScene(enabled, allInOne),
      guide: {
        lead: t('settings.autoStart.lead'),
        points: [t('settings.autoStart.byHand')],
      },
      rows: [
        switchRow(
          ui,
          t,
          'autostart',
          t('settings.autoStart.title'),
          enabled,
          () => run(`autostart ${enabled === true ? 'off' : 'on'}`),
          { field: state.autostart },
        ),
      ],
    });
  }

  if (can('flexpuff')) {
    const enabled = fieldValue(state.flexpuff);
    features.push({
      id: 'flexpuff',
      title: t('settings.flexPuff.title'),
      scene: flexPuffScene(enabled),
      guide: {
        lead: t('settings.flexPuff.lead'),
        points: [t('settings.flexPuff.pace'), t('settings.flexPuff.paused')],
      },
      rows: [
        switchRow(
          ui,
          t,
          'flexpuff',
          t('settings.flexPuff.title'),
          enabled,
          () => run(`flexpuff ${enabled === true ? 'disable' : 'enable'}`),
          { field: state.flexpuff },
        ),
      ],
    });
  }

  if (can('smartgesture')) {
    features.push({
      id: 'gestures',
      title: t('settings.gesture.title'),
      scene: gestureScene(state.smartGesture, allInOne),
      guide: {
        lead: t('settings.gesture.lead'),
        points: [t('settings.gesture.lift'), t('settings.gesture.tap')],
      },
      rows: [
        choiceRow(
          ui,
          t,
          t('settings.gesture.title'),
          [
            {
              key: 'smartgesture-enable',
              label: t('settings.gesture.on'),
              selected: state.smartGesture === true,
              choose: () => run('smartgesture enable'),
            },
            {
              key: 'smartgesture-disable',
              label: t('settings.gesture.off'),
              selected: state.smartGesture === false,
              choose: () => run('smartgesture disable'),
            },
          ],
          { aside: lastSet(t, state.smartGesture, 'settings.value.on', 'settings.value.off') },
        ),
      ],
    });
  }

  if (can('flexbattery')) {
    const settings = fieldValue(state.flexbattery);
    features.push({
      id: 'battery',
      title: t('settings.flexBattery.title'),
      scene: batteryScene(settings?.mode, settings?.pause),
      guide: {
        lead: t('settings.flexBattery.lead'),
        points: [
          t('settings.flexBattery.performance'),
          t('settings.flexBattery.eco'),
          t('settings.flexBattery.pause'),
        ],
      },
      field: state.flexbattery,
      rows: [
        choiceRow(ui, t, t('settings.flexBattery.mode'), [
          {
            key: 'flexbattery-performance',
            label: t('settings.flexBattery.optionPerformance'),
            selected: settings?.mode === 'performance',
            choose: () => run('flexbattery performance'),
          },
          {
            key: 'flexbattery-eco',
            label: t('settings.flexBattery.optionEco'),
            selected: settings?.mode === 'eco',
            choose: () => run('flexbattery eco'),
          },
        ]),
        switchRow(ui, t, 'flexbattery-pause', t('settings.flexBattery.pauseMode'), settings?.pause, () =>
          run(`flexbattery pause ${settings?.pause === true ? 'off' : 'on'}`),
        ),
      ],
    });
  }

  if (can('lock')) {
    features.push({
      id: 'lock',
      title: t('settings.lock.title'),
      scene: lockScene(state.locked),
      guide: {
        lead: t('settings.lock.lead'),
        points: [t('settings.lock.lend')],
      },
      rows: [
        choiceRow(
          ui,
          t,
          t('settings.lock.title'),
          [
            {
              key: 'unlock',
              label: t('settings.lock.unlocked'),
              selected: state.locked === false,
              choose: () => run('unlock'),
            },
            {
              key: 'lock',
              label: t('settings.lock.locked'),
              selected: state.locked === true,
              choose: () => run('lock'),
            },
          ],
          { aside: lastSet(t, state.locked, 'settings.value.locked', 'settings.value.unlocked') },
        ),
      ],
    });
  }

  features.push({
    id: 'find',
    title: t('settings.find.title'),
    scene: findScene(state.finding),
    guide: {
      lead: t('settings.find.lead'),
      points: [t('settings.find.keeps')],
    },
    rows: [
      h(
        'div',
        { class: 'row find-row' },
        h(
          'div',
          { class: 'row-text' },
          h('span', { class: 'row-title' }, t('settings.find.vibrate')),
          h(
            'p',
            { class: `row-note${state.finding ? ' alarm-text' : ''}` },
            t(state.finding ? 'settings.find.vibrating' : 'settings.find.off'),
          ),
        ),
        state.finding
          ? button('find', t('settings.find.stop'), () => run(''), 'alarm')
          : button('find', t('settings.find.start'), () => run('findmyiqos')),
      ),
    ],
  });

  const children: Child[] = [
    h(
      'nav',
      { class: 'jump', attrs: { 'aria-label': t('settings.nav') } },
      ...features.map((spec) => h('a', { key: `jump-${spec.id}`, attrs: { href: `#${spec.id}` } }, spec.title)),
    ),
    h('div', { class: 'features' }, ...features.map((spec) => feature(ui, t, spec))),
  ];

  const missing = (Object.keys(FEATURE_NAMES) as Capability[])
    .filter((capability) => !can(capability))
    .flatMap((capability) => {
      const name = FEATURE_NAMES[capability];
      return name === undefined ? [] : [t(name)];
    });
  if (missing.length > 0) {
    children.push(
      h(
        'p',
        { class: 'footnote' },
        device.model === 'unknown'
          ? t('settings.missing.unknownModel')
          : t('settings.missing.notOn', {
              model: modelLabel(device.model),
              features: missing.join(t('settings.missing.separator')),
            }),
      ),
    );
  }
  return children;
}
