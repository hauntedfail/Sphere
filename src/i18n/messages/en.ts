/**
 * Every sentence the page shows, in English. The other languages are checked
 * against this one: same keys, same parameters.
 *
 * A space at either end of a message is deliberate: the page puts a value or
 * a control right beside it.
 */
export const en = {
  page: {
    skip: 'Skip to the controls',
    lede: 'Set up an IQOS ILUMA from this page over Bluetooth. No account, no app, and nothing leaves your browser.',
    connect: 'Connect a device',
    connecting: 'Connecting',
    demo: 'Try a simulated device',
    demoLead: 'No device at hand? Pick a model to try it simulated.',
    demoTile: 'Try a simulated {{model}}',
    before: {
      title: 'Before you connect',
      wake: 'Wake the device: open the charger lid, or press its button.',
      close: 'Close the IQOS app. The device accepts one connection at a time.',
      pair: 'The first time, your system asks to pair. Accept it.',
    },
    notListed: 'Device not listed?',
    listAll: 'List every nearby device',
    models: 'Supported models',
    privacy: {
      title: 'What stays on this page',
      everything:
        "Everything. The page's security policy forbids network requests, so nothing can be sent anywhere.",
      labels: "Saved device labels live in this browser's storage and nowhere else.",
      serial: 'The serial number is never read. Browsers block it, and Sphere does not need it.',
    },
    matrix: {
      title: 'What works on which model',
      feature: 'Feature',
      yes: 'yes',
      no: 'no',
      basics: 'Battery, info, diagnosis',
      find: 'Find my IQOS, lock',
      light: 'Brightness, vibration',
      chargeVibration: 'Vibrate when charging starts',
      gesture: 'Smart gesture',
      autoStart: 'Auto start',
      flex: 'FlexPuff, FlexBattery',
    },
    deviceHeading: 'Device',
    settingsHeading: 'Settings',
    credits: {
      software: 'Sphere is free software under GPL-3.0, built on the',
      and: 'crate and',
      trademark: '. Not affiliated with Philip Morris International; IQOS is their trademark.',
      typefaces: 'Typefaces: Doto and Instrument Sans, under the SIL Open Font License 1.1.',
      licences: 'Font licences',
      drawings: ". The device drawings are Sphere's own.",
    },
  },
  bar: {
    notConnected: 'not connected',
    simulated: 'simulated {{model}}',
    state: {
      idle: 'idle',
      connecting: 'connecting',
      vibrating: 'vibrating',
      working: 'working',
      ready: 'ready',
    },
  },
  notice: {
    unsupported:
      'This browser has no Web Bluetooth, so it cannot reach a device. Use Chrome, Edge or Opera on desktop or Android. On an iPhone or iPad, use Bluefy.',
    insecure: 'Bluetooth only works on a secure page. Open Sphere over HTTPS or from localhost.',
    simulatorStillWorks: ' The simulated device still works here.',
  },
  field: {
    readFailed: 'read failed',
    reading: 'reading',
    notRead: 'not read',
  },
  device: {
    batteryPending: 'Battery ',
    batteryAfterLevel: ' battery',
    art: '{{model}}, {{battery}}',
    artUnknown: 'battery not read',
    artLevel: 'battery {{level}}%',
    bluetooth: 'Bluetooth',
    simulated: 'Simulated',
    simulatedNote: 'This device is simulated. Nothing is transmitted.',
    chooseModel: 'The name "{{name}}" does not say which model this is. Choose it to unlock its settings:',
    refresh: 'Refresh',
    readDiagnosis: 'Read diagnosis',
    disconnect: 'Disconnect',
    details: 'Details',
    none: 'n/a',
    serialHidden: 'hidden by the browser',
    serialNone: 'N/A',
    unverified: 'unverified reading',
    unverifiedNote:
      '* Decoded the way the iqos CLI does. The upstream project has not confirmed what these numbers measure.',
    logNote:
      'Reporting a problem? The session log lists what each control sent and every frame that came back. ',
    copyLog: 'Copy session log',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    saveAs: 'Save this device as',
    save: 'Save',
    labelPlaceholder: 'label',
    rows: {
      productNumber: 'product number',
      stickFirmware: 'stick firmware',
      holder: 'holder',
      holderNoAnswer: 'no answer',
      holderProduct: 'holder product',
      holderFirmware: 'holder firmware',
      batteryVoltage: 'battery voltage',
      modelNumber: 'model number',
      softwareRev: 'software rev',
      manufacturer: 'manufacturer',
      serialNumber: 'serial number',
      totalPuffs: 'total puffs',
      daysUsed: 'days used',
    },
  },
  settings: {
    nav: 'Settings',
    notReported: 'The device does not report this setting.',
    lastSet: 'Last set here: {{value}}.',
    value: {
      on: 'on',
      off: 'off',
      locked: 'locked',
      unlocked: 'unlocked',
    },
    light: {
      title: 'Light',
      lead: 'How strongly the status lights shine.',
      low: 'Low is easier on the eyes in the dark.',
      high: 'High is easier to read in daylight.',
      brightness: 'Brightness',
      optionLow: 'Low',
      optionHigh: 'High',
    },
    vibration: {
      title: 'Vibration',
      lead: 'The device taps out where a session stands, so you can follow it without looking. Choose which moments it marks.',
      separate: 'Each signal is separate: keep the ones you rely on, silence the rest.',
      silent: 'Switching every signal off makes the device silent, not disabled.',
      heating: 'Heating starts',
      starting: 'A session starts',
      puffEnd: 'A session is ending',
      terminated: 'A session is stopped by hand',
      charge: 'Charging starts',
    },
    autoStart: {
      title: 'Auto start',
      lead: 'With auto start on, heating begins the moment a stick is inserted.',
      byHand: 'With it off, insert the stick and hold the button to start a session yourself.',
    },
    flexPuff: {
      title: 'FlexPuff',
      lead: 'Near the end of a session the device checks whether the stick is used up. If it is not, FlexPuff can add up to four puffs.',
      pace: 'It follows your pace, so not every session is extended.',
      paused: 'A session that was paused is not extended.',
    },
    gesture: {
      title: 'Smart gesture',
      lead: 'Gestures let the device answer without its button.',
      lift: 'Lift it between sessions and its lights show how many uses are left.',
      tap: 'Double-tap it during a session and it vibrates to say how much remains.',
      on: 'On',
      off: 'Off',
    },
    flexBattery: {
      title: 'FlexBattery',
      lead: 'How the holder spends a charge.',
      performance: 'Performance: up to three sessions in a row before the holder goes back in the charger.',
      eco: 'Eco: one session per charge, which is gentler on the battery over its life. Pause is not available.',
      pause:
        'Pause mode: put a session on hold for up to eight minutes. With it on, Performance gives two sessions in a row.',
      mode: 'Mode',
      optionPerformance: 'Performance',
      optionEco: 'Eco',
      pauseMode: 'Pause mode',
    },
    lock: {
      title: 'Lock',
      lead: 'A locked device cannot be used until it is unlocked again.',
      lend: 'Lock it before you lend it out or put it away, and unlock it here when you want it back.',
      unlocked: 'Unlocked',
      locked: 'Locked',
    },
    find: {
      title: 'Find my IQOS',
      lead: 'Mislaid it nearby? Make it vibrate and follow the sound.',
      keeps: 'It keeps vibrating until you stop it, and it has to be connected to hear you.',
      vibrate: 'Vibrate',
      vibrating: 'The device is vibrating.',
      off: 'Off',
      start: 'Start vibrating',
      stop: 'Stop vibrating',
    },
    missing: {
      unknownModel: 'Settings appear once the model is known.',
      notOn: 'Not on {{model}}: {{features}}.',
      separator: ', ',
      brightness: 'brightness',
      vibration: 'vibration',
      flexpuff: 'FlexPuff',
      flexbattery: 'FlexBattery',
      autostart: 'auto start',
      smartgesture: 'smart gesture',
      lock: 'lock',
    },
  },
  saved: {
    title: 'Saved devices',
    connect: 'Connect',
    forget: 'Forget',
    last: 'Last connected: {{name}}. ',
    reconnect: 'Reconnect',
  },
  error: {
    transport: 'transport error: {{detail}}',
  },
} as const;

type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
/** A dictionary: the keys of the English one, with any text. */
export type Messages = Shape<typeof en>;

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
/** The dotted path to one message, such as `page.lede`. */
export type MessageKey = Paths<typeof en>;
