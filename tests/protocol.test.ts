import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from '../src/protocol/bytes';
import { SphereError } from '../src/protocol/errors';
import { cleanDeviceText, deviceInfoText } from '../src/protocol/gatt';
import {
  DIAGNOSIS_COMMANDS,
  EMPTY_DIAGNOSIS,
  LOAD_DEVICE_TIME,
  LOAD_HOLDER_FIRMWARE,
  LOAD_HOLDER_PRODUCT_NUMBER,
  LOAD_LIFE_DATA,
  LOAD_PRODUCT_NUMBER,
  LOAD_STICK_FIRMWARE,
  LOAD_TELEMETRY,
  applyDiagnosisFrame,
  formatFirmware,
  parseBatteryLevel,
  parseBatteryVoltage,
  parseFirmware,
  parseProductNumber,
} from '../src/protocol/identity';
import {
  KNOWN_MODELS,
  type Capability,
  type DeviceModel,
  hasHolder,
  modelFromLocalName,
  modelLabel,
  parseModelSelector,
  supports,
} from '../src/protocol/model';
import { frameError } from '../src/protocol/scp';
import {
  LOAD_AUTOSTART,
  LOAD_BRIGHTNESS,
  LOAD_FLEXBATTERY,
  LOAD_FLEXPUFF,
  LOAD_PAUSEMODE,
  autostartCommand,
  brightnessCommands,
  flexbatteryModeCommand,
  flexpuffCommand,
  lockCommands,
  parseAutostart,
  parseBrightness,
  parseBrightnessLevel,
  parseFlexbatteryMode,
  parseFlexpuff,
  parsePauseMode,
  pauseModeCommand,
  smartGestureCommand,
  unlockCommands,
} from '../src/protocol/settings';
import {
  LOAD_CHARGE_VIBRATION,
  LOAD_VIBRATION,
  START_VIBRATE,
  STOP_VIBRATE,
  parseChargeVibration,
  parseVibration,
  vibrationCommands,
} from '../src/protocol/vibration';

const hexAll = (frames: readonly Uint8Array[]): string[] => frames.map(toHex);

describe('device model', () => {
  it('classifies local names, most specific first', () => {
    expect(modelFromLocalName('IQOS ILUMA i PRIME')).toBe('iluma-i-prime');
    expect(modelFromLocalName('IQOS ILUMA i ONE')).toBe('iluma-i-one');
    expect(modelFromLocalName('IQOS ILUMA i')).toBe('iluma-i');
    expect(modelFromLocalName('IQOS ILUMA PRIME')).toBe('iluma-prime');
    expect(modelFromLocalName('IQOS ILUMA ONE')).toBe('iluma-one');
    expect(modelFromLocalName('  iqos iluma ')).toBe('iluma');
    expect(modelFromLocalName('mystery device')).toBe('unknown');
  });

  it('maps capabilities by model', () => {
    const models: DeviceModel[] = [
      'iluma-one',
      'iluma',
      'iluma-prime',
      'iluma-i-one',
      'iluma-i',
      'iluma-i-prime',
      'unknown',
    ];
    const matrix: [Capability, boolean[]][] = [
      ['brightness', [true, true, true, true, true, true, false]],
      ['vibration', [true, true, true, true, true, true, false]],
      ['lock', [true, true, true, true, true, true, false]],
      ['flexpuff', [false, false, false, false, true, true, false]],
      ['flexbattery', [false, false, false, false, true, true, false]],
      ['smartgesture', [false, true, true, true, true, true, false]],
      ['autostart', [false, false, false, true, true, true, false]],
      ['charge-vibration', [false, true, true, false, true, true, false]],
    ];
    for (const [capability, expected] of matrix) {
      expect(models.map((model) => supports(model, capability)), capability).toEqual(expected);
    }
  });

  it('knows which models have a holder', () => {
    expect(hasHolder('iluma-i')).toBe(true);
    expect(hasHolder('iluma-prime')).toBe(true);
    expect(hasHolder('iluma-one')).toBe(false);
    expect(hasHolder('iluma-i-one')).toBe(false);
    expect(hasHolder('unknown')).toBe(false);
  });

  it('parses model selectors like the CLI', () => {
    expect(parseModelSelector('iluma')).toBe('iluma');
    expect(parseModelSelector(' ILUMA_I prime ')).toBe('iluma-i-prime');
    expect(parseModelSelector('iluma i one')).toBe('iluma-i-one');
    expect(parseModelSelector('minera')).toBeNull();
    expect(parseModelSelector('unknown')).toBeNull();
  });

  it('labels every model', () => {
    for (const model of KNOWN_MODELS) expect(modelLabel(model)).toMatch(/^ILUMA/);
    expect(modelLabel('unknown')).toBe('unknown model');
  });
});

describe('brightness', () => {
  it('keeps the load command stable', () => {
    expect(toHex(LOAD_BRIGHTNESS)).toBe('00 C0 02 23 C3');
  });

  it('builds the write sequences', () => {
    expect(hexAll(brightnessCommands('high'))).toEqual([
      '00 C0 46 23 64 00 00 00 4F',
      '00 C0 02 23 C3',
      '00 C9 44 24 64 00 00 00 34',
    ]);
    expect(hexAll(brightnessCommands('low'))).toEqual([
      '00 C0 46 23 1E 00 00 00 E1',
      '00 C0 02 23 C3',
      '00 C9 44 24 1E 00 00 00 9A',
    ]);
  });

  it('parses responses', () => {
    expect(parseBrightness(fromHex('00 C0 86 23 64 00 00 00 D5'))).toBe('high');
    expect(parseBrightness(fromHex('00 C0 86 23 1E 00 00 00 00'))).toBe('low');
  });

  it('rejects bad responses', () => {
    expect(() => parseBrightness(fromHex('00 00 86 23 64 00 00 00 00'))).toThrow(/header/);
    expect(() => parseBrightness(fromHex('00 C0 86 23 FF 00 00 00 00'))).toThrow(/level/);
    expect(() => parseBrightness(fromHex('00 C0 86 23'))).toThrow(/short/);
  });

  it('parses level names', () => {
    expect(parseBrightnessLevel('HIGH')).toBe('high');
    expect(parseBrightnessLevel(' low ')).toBe('low');
    expect(parseBrightnessLevel('medium')).toBeNull();
  });
});

describe('flexpuff', () => {
  it('keeps commands stable', () => {
    expect(toHex(LOAD_FLEXPUFF)).toBe('00 D2 05 22 03 00 00 00 17');
    expect(toHex(flexpuffCommand(true))).toBe('00 D2 45 22 03 01 00 00 0A');
    expect(toHex(flexpuffCommand(false))).toBe('00 D2 45 22 03 00 00 00 61');
  });

  it('parses responses', () => {
    expect(parseFlexpuff(fromHex('00 90 85 22 03 01 00 00 90'))).toBe(true);
    expect(parseFlexpuff(fromHex('00 90 85 22 03 00 00 00 FB'))).toBe(false);
  });

  it('rejects bad responses', () => {
    expect(() => parseFlexpuff(fromHex('00 90 85 22'))).toThrow(/short/);
    expect(() => parseFlexpuff(fromHex('00 00 85 22 03 01 00 00 00'))).toThrow(/header/);
    expect(() => parseFlexpuff(fromHex('00 90 85 22 04 01 00 00 F2'))).toThrow(/header/);
    expect(() => parseFlexpuff(fromHex('00 90 85 22 03 FF 00 00 00'))).toThrow(/flag/);
  });
});

describe('flexbattery', () => {
  it('keeps commands stable', () => {
    expect(toHex(LOAD_FLEXBATTERY)).toBe('00 C9 00 25 FB');
    expect(toHex(LOAD_PAUSEMODE)).toBe('00 C9 07 24 02 00 00 00 18');
    expect(toHex(flexbatteryModeCommand('eco'))).toBe('00 C9 44 25 01 00 00 00 4D');
    expect(toHex(flexbatteryModeCommand('performance'))).toBe('00 C9 44 25 00 00 00 00 5B');
    expect(toHex(pauseModeCommand(true))).toBe('00 C9 47 24 02 01 00 00 05');
    expect(toHex(pauseModeCommand(false))).toBe('00 C9 47 24 02 00 00 00 6E');
  });

  it('parses the mode', () => {
    expect(parseFlexbatteryMode(fromHex('00 08 84 25 00 00 00 00 C1'))).toBe('performance');
    expect(parseFlexbatteryMode(fromHex('00 08 84 25 01 00 00 00 D7'))).toBe('eco');
    expect(() => parseFlexbatteryMode(fromHex('00 08 84'))).toThrow(/short/);
    expect(() => parseFlexbatteryMode(fromHex('00 00 84 25 00 00 00 00 00'))).toThrow(/header/);
    expect(() => parseFlexbatteryMode(fromHex('00 08 84 25 FF 00 00 00 00'))).toThrow(/mode/);
  });

  it('parses pause mode', () => {
    expect(parsePauseMode(fromHex('00 08 87 24 02 01 00 00 9F'))).toBe(true);
    expect(parsePauseMode(fromHex('00 08 87 24 02 00 00 00 F4'))).toBe(false);
    expect(() => parsePauseMode(fromHex('00 08 87'))).toThrow(/short/);
    expect(() => parsePauseMode(fromHex('00 00 87 24 02 01 00 00 00'))).toThrow(/header/);
    expect(() => parsePauseMode(fromHex('00 08 87 24 01 01 00 00 A5'))).toThrow(/setting ID/);
    expect(() => parsePauseMode(fromHex('00 08 87 24 02 FF 00 00 00'))).toThrow(/flag/);
  });
});

describe('smart gesture and auto start', () => {
  it('keeps commands stable', () => {
    expect(toHex(smartGestureCommand(true))).toBe('00 C9 47 24 04 01 00 00 71');
    expect(toHex(smartGestureCommand(false))).toBe('00 C9 47 24 04 00 00 00 1A');
    expect(toHex(autostartCommand(true))).toBe('00 C9 47 24 01 01 00 00 3F');
    expect(toHex(autostartCommand(false))).toBe('00 C9 47 24 01 00 00 00 54');
    expect(toHex(LOAD_AUTOSTART)).toBe('00 C9 07 24 01 00 00 00 22');
  });

  it('parses auto start', () => {
    expect(parseAutostart(fromHex('00 08 87 24 01 01 00 00 A5'))).toBe(true);
    expect(parseAutostart(fromHex('00 08 87 24 01 00 00 00 00'))).toBe(false);
    expect(() => parseAutostart(fromHex('00 08 87'))).toThrow(/short/);
    expect(() => parseAutostart(fromHex('00 00 87 24 01 01 00 00 A5'))).toThrow(/header/);
    expect(() => parseAutostart(fromHex('00 08 87 24 02 01 00 00 A5'))).toThrow(/setting ID/);
    expect(() => parseAutostart(fromHex('00 08 87 24 01 FF 00 00 A5'))).toThrow(/flag/);
  });
});

describe('lock', () => {
  it('builds the lock and unlock sequences', () => {
    expect(hexAll(lockCommands())).toEqual([
      '00 C9 44 04 02 FF 00 00 5A',
      '00 C9 00 04 1C',
      '00 C0 01 00 15',
    ]);
    expect(hexAll(unlockCommands())).toEqual([
      '00 C9 44 04 00 00 00 00 5D',
      '00 C9 00 04 1C',
      '00 C0 01 00 15',
    ]);
  });
});

describe('vibration', () => {
  it('keeps commands stable', () => {
    expect(toHex(LOAD_VIBRATION)).toBe('00 C9 00 23 E9');
    expect(toHex(LOAD_CHARGE_VIBRATION)).toBe('00 C9 07 04 04 00 00 00 08');
    expect(toHex(START_VIBRATE)).toBe('00 C0 45 22 01 1E 00 00 C3');
    expect(toHex(STOP_VIBRATE)).toBe('00 C0 45 22 00 1E 00 00 D5');
  });

  it('parses the main response', () => {
    expect(parseVibration(fromHex('00 08 84 23 10 00 01 10 77'), 'iluma-one')).toEqual({
      heating: true,
      starting: false,
      puffEnd: false,
      terminated: true,
    });
    expect(parseVibration(fromHex('00 08 84 23 10 00 11 11 D8'), 'iluma-i')).toEqual({
      heating: true,
      starting: true,
      puffEnd: true,
      terminated: true,
    });
  });

  it('accepts the alternate variant byte only on holder models', () => {
    const frame = fromHex('00 08 84 23 03 00 10 01 77');
    expect(parseVibration(frame, 'iluma')).toEqual({
      heating: false,
      starting: true,
      puffEnd: true,
      terminated: false,
    });
    expect(() => parseVibration(frame, 'iluma-one')).toThrow(/header mismatch/);
  });

  it('rejects bad main responses', () => {
    expect(() => parseVibration(fromHex('00 08 84 23'), 'iluma')).toThrow(/short/);
    expect(() => parseVibration(fromHex('00 C0 84 23 10 00 01 10 77'), 'iluma')).toThrow(/header/);
  });

  it('parses the charge-start response', () => {
    const on = fromHex('00 08 8B 04 04 00 00 00 00 00 00 00 00 00 00 00 00 00 56');
    const off = fromHex('00 08 8B 04 04 00 00 00 00 09 00 00 00 00 00 00 00 00 EE');
    expect(parseChargeVibration(on)).toBe(true);
    expect(parseChargeVibration(off)).toBe(false);
    expect(() => parseChargeVibration(fromHex('00 08 8B 04'))).toThrow(/short/);
    const other = fromHex('00 08 8B 04 05 00 00 00 00 00 00 00 00 00 00 00 00 00 B3');
    expect(() => parseChargeVibration(other)).toThrow(/unknown/);
  });

  it('builds a single frame for one-piece models', () => {
    const commands = vibrationCommands(
      { heating: true, starting: false, puffEnd: true, terminated: false },
      'iluma-one',
    );
    expect(hexAll(commands)).toEqual(['00 C9 44 23 10 00 01 01 65']);
  });

  it('builds the charge-start sequence for holder models', () => {
    const commands = vibrationCommands(
      { heating: true, starting: false, puffEnd: false, terminated: false, charge: true },
      'iluma',
    );
    expect(hexAll(commands)).toEqual([
      '00 C9 44 23 10 00 01 00 62',
      '00 C9 4F 04 5B 04 00 FF FF FF 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 06',
      '00 C9 4F 04 72 05 00 FF FF FF 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 72',
      '00 C9 47 04 00 FF FF 00 DA',
      '00 C9 07 04 04 00 00 00 08',
      '00 C9 07 04 05 00 00 00 1E',
    ]);
  });

  it('builds the charge-off sequence when another flag is on', () => {
    const commands = vibrationCommands(
      { heating: false, starting: true, puffEnd: false, terminated: false, charge: false },
      'iluma-i',
    );
    expect(hexAll(commands)).toEqual([
      '00 C9 44 23 10 00 10 00 20',
      '00 C9 4F 04 64 04 00 FF FF FF 09 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 0C',
      '00 C9 4F 04 4D 05 00 FF FF FF 09 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 78',
      '00 C9 47 04 00 FF FF 00 DA',
      '00 C9 07 04 04 00 00 00 08',
      '00 C9 07 04 05 00 00 00 1E',
    ]);
  });

  it('sends only the main frame when everything is off', () => {
    const commands = vibrationCommands(
      { heating: false, starting: false, puffEnd: false, terminated: false, charge: false },
      'iluma-i',
    );
    expect(hexAll(commands)).toEqual(['00 C9 44 23 10 00 00 00 77']);
  });

  it('rejects mismatched charge-start input', () => {
    const base = { heating: false, starting: false, puffEnd: false, terminated: false };
    expect(() => vibrationCommands({ ...base, charge: true }, 'iluma-one')).toThrow(
      /charge-start vibration is not supported/,
    );
    expect(() => vibrationCommands(base, 'iluma')).toThrow(/required/);
    expect(() => vibrationCommands(base, 'unknown')).toThrow(SphereError);
  });

  it('only ever produces valid frames', () => {
    for (const charge of [true, false]) {
      for (let bits = 0; bits < 16; bits++) {
        const commands = vibrationCommands(
          {
            heating: (bits & 1) !== 0,
            starting: (bits & 2) !== 0,
            puffEnd: (bits & 4) !== 0,
            terminated: (bits & 8) !== 0,
            charge,
          },
          'iluma-i-prime',
        );
        for (const command of commands) expect(frameError(command)).toBeNull();
      }
    }
  });
});

describe('firmware', () => {
  it('keeps commands stable', () => {
    expect(toHex(LOAD_STICK_FIRMWARE)).toBe('00 C0 00 00 00');
    expect(toHex(LOAD_HOLDER_FIRMWARE)).toBe('00 C9 00 00 00');
  });

  it('parses stick and holder responses', () => {
    expect(parseFirmware(fromHex('00 C0 88 00 00 00 02 05 07 18'), 'stick')).toEqual({
      major: 2,
      minor: 5,
      patch: 7,
      year: 24,
    });
    const holder = parseFirmware(fromHex('00 08 88 00 00 00 01 02 03 19'), 'holder');
    expect(formatFirmware(holder)).toBe('v1.2.3.25');
  });

  it('rejects bad responses', () => {
    expect(() => parseFirmware(fromHex('00 C9 88 00 00 00 02 05 07 18'), 'stick')).toThrow(/header/);
    expect(() => parseFirmware(fromHex('00 C0 88 00'), 'stick')).toThrow(/short/);
  });
});

describe('product number', () => {
  it('keeps commands stable', () => {
    expect(toHex(LOAD_PRODUCT_NUMBER)).toBe('00 C0 00 03 09');
    expect(toHex(LOAD_HOLDER_PRODUCT_NUMBER)).toBe('00 C9 00 03 09');
  });

  it('decodes captured responses without the CRC byte', () => {
    const stick = fromHex('00 C0 88 03 54 4C 32 45 59 59 38 52 4D 31 57 51 48 30 86');
    const holder = fromHex('00 08 88 03 54 4A 50 35 48 43 55 42 5A 56 47 47 43 4E 4E');
    expect(parseProductNumber(stick, 'stick')).toBe('TL2EYY8RM1WQH0');
    expect(parseProductNumber(holder, 'holder')).toBe('TJP5HCUBZVGGCN');
  });

  it('replaces non-printable bytes with dots', () => {
    expect(parseProductNumber(fromHex('00 08 88 03 41 00 FF AA'), 'holder')).toBe('A..');
  });

  it('rejects bad responses', () => {
    expect(() => parseProductNumber(fromHex('00 C9 88 03 41 AA'), 'stick')).toThrow(/header/);
    expect(() => parseProductNumber(fromHex('00 C0 88'), 'stick')).toThrow(/short/);
    expect(() => parseProductNumber(fromHex('00 C0 88 03 AA'), 'stick')).toThrow(/payload/);
  });
});

describe('diagnosis', () => {
  it('keeps commands stable', () => {
    expect(toHex(LOAD_TELEMETRY)).toBe('00 C9 10 02 01 01 75 D6');
    expect(toHex(LOAD_DEVICE_TIME)).toBe('00 C0 10 02 00 04 38 EF');
    expect(toHex(LOAD_LIFE_DATA)).toBe('00 C0 00 21 E7');
    expect(DIAGNOSIS_COMMANDS).toHaveLength(4);
  });

  it('decodes a captured telemetry frame', () => {
    const frame = fromHex(
      '00 08 90 22 01 01 00 00 00 00 F1 07 00 8E 01 00 00 00 28 07 00 20 02 00 00 00 AD 03 00 17 03 00 00 00 41 00 00 18 CB B8',
    );
    expect(frameError(frame)).toBeNull();
    const diagnosis = applyDiagnosisFrame(EMPTY_DIAGNOSIS, frame);
    expect(diagnosis.puffCount).toBe(0x07f1);
    expect(diagnosis.daysUsed).toBe(0x03ad);
    expect(diagnosis.telemetryRecords).toHaveLength(4);
    expect(toHex(diagnosis.telemetryRecords[0]!)).toBe('00 00 00 00 F1 07 00 8E');
  });

  it('keeps the raw device clock and ignores it as a counter', () => {
    const frame = fromHex('00 C0 90 0A 00 04 DA 07 01 01 2E E0 E3 1C FB C9');
    const diagnosis = applyDiagnosisFrame(EMPTY_DIAGNOSIS, frame);
    expect(toHex(diagnosis.deviceTimeRaw!)).toBe('DA 07 01 01 2E E0 E3 1C');
    expect(diagnosis.daysUsed).toBeUndefined();
  });

  it('decodes battery voltage from the life-data frame', () => {
    const frame = fromHex('00 C0 88 21 00 A8 10 00 00 00 00 00 00 00 00 00 00 00 00');
    expect(applyDiagnosisFrame(EMPTY_DIAGNOSIS, frame).batteryVoltage).toBeCloseTo(4.264, 5);
    expect(parseBatteryVoltage(fromHex('00 08 84 21 00 E8 0F 00 00'))).toBeCloseTo(4.072, 5);
  });

  it('accumulates across frames without mutating its input', () => {
    const telemetry = fromHex(
      '00 08 90 22 01 01 00 00 00 00 F1 07 00 8E 01 00 00 00 28 07 00 20 02 00 00 00 AD 03 00 17 03 00 00 00 41 00 00 18 CB B8',
    );
    const voltage = fromHex('00 C0 88 21 00 E8 0F 00 00 00 00 00 00 00 00 00 00 00 00');
    const first = applyDiagnosisFrame(EMPTY_DIAGNOSIS, telemetry);
    const second = applyDiagnosisFrame(first, voltage);
    expect(EMPTY_DIAGNOSIS).toEqual({ telemetryRecords: [] });
    expect(first.batteryVoltage).toBeUndefined();
    expect(second.puffCount).toBe(0x07f1);
    expect(second.batteryVoltage).toBeCloseTo(4.072, 5);
  });

  it('ignores unrelated frames', () => {
    expect(applyDiagnosisFrame(EMPTY_DIAGNOSIS, fromHex('00 C0 86 23 64 00 00 00 D5'))).toEqual(
      EMPTY_DIAGNOSIS,
    );
    const other = fromHex('00 08 90 0B 00 01 02 00 00 01 01 02 00 01 00 DC 23');
    expect(applyDiagnosisFrame(EMPTY_DIAGNOSIS, other)).toEqual(EMPTY_DIAGNOSIS);
  });

  it('rejects malformed frames', () => {
    expect(() => applyDiagnosisFrame(EMPTY_DIAGNOSIS, fromHex('00 08 88'))).toThrow(/short/);
    expect(() => applyDiagnosisFrame(EMPTY_DIAGNOSIS, fromHex('00 08 90 01 01 00 00'))).toThrow(
      /identifier/,
    );
    expect(() =>
      applyDiagnosisFrame(EMPTY_DIAGNOSIS, fromHex('00 08 90 05 01 01 00 00 00 00 00')),
    ).toThrow(/partial/);
    expect(() => parseBatteryVoltage(fromHex('00 C0 88 21 00 A8'))).toThrow(/battery voltage/);
    expect(() => parseBatteryVoltage(fromHex('00 C0 86 23 64 00 00 00 D5'))).toThrow();
  });
});

describe('battery characteristic', () => {
  it('reads the percentage from the third byte', () => {
    expect(parseBatteryLevel(fromHex('00 00 55'))).toBe(85);
    expect(parseBatteryLevel(fromHex('0F 00 64 01'))).toBe(100);
  });

  it('rejects short or out-of-range values', () => {
    expect(() => parseBatteryLevel(fromHex('00 00'))).toThrow(/battery/);
    expect(() => parseBatteryLevel(fromHex('00 00 65'))).toThrow(/battery/);
  });
});

describe('device information text', () => {
  it('drops trailing GATT NUL padding', () => {
    expect(deviceInfoText(fromHex('4D 30 30 32 32 00'))).toBe('M0022');
    expect(deviceInfoText(fromHex('41 42'))).toBe('AB');
  });

  it('removes control and format characters and caps the length', () => {
    expect(cleanDeviceText('a\nb\tc\u0000')).toBe('abc');
    expect(cleanDeviceText('safe\u202eevil\u200b')).toBe('safeevil');
    expect(cleanDeviceText('x'.repeat(100))).toHaveLength(64);
    expect(cleanDeviceText('IQOS ILUMA i')).toBe('IQOS ILUMA i');
  });
});
