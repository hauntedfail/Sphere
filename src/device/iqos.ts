/**
 * Typed device operations over an SCP transport: the browser counterpart of
 * the `Iqos<T>` facade in the `iqos` crate, with the same command sequences
 * and capability checks.
 */
import { SphereError, unsupportedError } from '../protocol/errors';
import {
  type ComponentKind,
  DIAGNOSIS_COMMANDS,
  type Diagnosis,
  EMPTY_DIAGNOSIS,
  type FirmwareVersion,
  LOAD_LIFE_DATA,
  applyDiagnosisFrame,
  firmwareCommand,
  parseBatteryVoltage,
  parseFirmware,
  parseProductNumber,
  productNumberCommand,
} from '../protocol/identity';
import { type Capability, type DeviceModel, hasHolder, modelLabel, supports } from '../protocol/model';
import { headersMatch } from '../protocol/scp';
import {
  type BrightnessLevel,
  type FlexBatterySettings,
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
  parseFlexbatteryMode,
  parseFlexpuff,
  parsePauseMode,
  pauseModeCommand,
  smartGestureCommand,
  unlockCommands,
} from '../protocol/settings';
import {
  LOAD_CHARGE_VIBRATION,
  LOAD_VIBRATION,
  START_VIBRATE,
  STOP_VIBRATE,
  type VibrationSettings,
  parseChargeVibration,
  parseVibration,
  vibrationCommands,
} from '../protocol/vibration';
import type { Transport } from '../transport/session';

/** Firmware and product identity read over SCP. */
export interface DeviceStatus {
  readonly productNumber: string;
  readonly stickFirmware: FirmwareVersion;
  /** Present on holder models when the holder answered. */
  readonly holderProductNumber?: string;
  readonly holderFirmware?: FirmwareVersion;
  /** Why the holder fields are missing on a holder model. */
  readonly holderError?: string;
  /** Volts, decoded the way the CLI does. Absent when the read failed. */
  readonly batteryVoltage?: number;
}

const CAPABILITY_NAMES: Record<Capability, string> = {
  brightness: 'brightness',
  vibration: 'vibration',
  flexpuff: 'FlexPuff',
  flexbattery: 'FlexBattery',
  smartgesture: 'Smart Gesture',
  autostart: 'Auto Start',
  lock: 'device lock',
  'charge-vibration': 'charge-start vibration',
};

export class Iqos {
  constructor(
    private readonly transport: Transport,
    readonly model: DeviceModel,
  ) {}

  supports(capability: Capability): boolean {
    return supports(this.model, capability);
  }

  async readBrightness(): Promise<BrightnessLevel> {
    this.require('brightness');
    return parseBrightness(await this.transport.request(LOAD_BRIGHTNESS));
  }

  async setBrightness(level: BrightnessLevel): Promise<void> {
    this.require('brightness');
    await this.sendAll(brightnessCommands(level));
  }

  async readFlexpuff(): Promise<boolean> {
    this.require('flexpuff');
    return parseFlexpuff(await this.transport.request(LOAD_FLEXPUFF));
  }

  async setFlexpuff(enabled: boolean): Promise<void> {
    this.require('flexpuff');
    await this.transport.request(flexpuffCommand(enabled));
  }

  async setSmartGesture(enabled: boolean): Promise<void> {
    this.require('smartgesture');
    await this.transport.request(smartGestureCommand(enabled));
  }

  async readAutostart(): Promise<boolean> {
    this.require('autostart');
    return parseAutostart(await this.transport.request(LOAD_AUTOSTART));
  }

  async setAutostart(enabled: boolean): Promise<void> {
    this.require('autostart');
    await this.transport.request(autostartCommand(enabled));
  }

  async lock(): Promise<void> {
    this.require('lock');
    await this.sendAll(lockCommands());
  }

  async unlock(): Promise<void> {
    this.require('lock');
    await this.sendAll(unlockCommands());
  }

  async readFlexbattery(): Promise<Required<FlexBatterySettings>> {
    this.require('flexbattery');
    const mode = parseFlexbatteryMode(await this.transport.request(LOAD_FLEXBATTERY));
    const pause = parsePauseMode(await this.transport.request(LOAD_PAUSEMODE));
    return { mode, pause };
  }

  /** Write the mode, and Pause Mode too when `settings.pause` is given. */
  async setFlexbattery(settings: FlexBatterySettings): Promise<void> {
    this.require('flexbattery');
    await this.transport.request(flexbatteryModeCommand(settings.mode));
    await this.transport.request(LOAD_FLEXBATTERY);
    if (settings.pause !== undefined) {
      await this.transport.request(pauseModeCommand(settings.pause));
      await this.transport.request(LOAD_PAUSEMODE);
    }
  }

  async readVibration(): Promise<VibrationSettings> {
    this.require('vibration');
    const charge = this.supports('charge-vibration') ? await this.readChargeVibration() : undefined;
    const settings = parseVibration(await this.transport.request(LOAD_VIBRATION), this.model);
    return charge === undefined ? settings : { ...settings, charge };
  }

  /** Apply vibration settings, reading the charge flag first if it is missing. */
  async updateVibration(settings: VibrationSettings): Promise<void> {
    this.require('vibration');
    const complete =
      this.supports('charge-vibration') && settings.charge === undefined
        ? { ...settings, charge: await this.readChargeVibration() }
        : settings;
    await this.sendAll(vibrationCommands(complete, this.model));
  }

  async readFirmware(kind: ComponentKind): Promise<FirmwareVersion> {
    return parseFirmware(await this.transport.request(firmwareCommand(kind)), kind);
  }

  async readProductNumber(kind: ComponentKind): Promise<string> {
    return parseProductNumber(await this.transport.request(productNumberCommand(kind)), kind);
  }

  async readBatteryVoltage(): Promise<number> {
    return parseBatteryVoltage(await this.transport.request(LOAD_LIFE_DATA));
  }

  async readDiagnosis(): Promise<Diagnosis> {
    let diagnosis = EMPTY_DIAGNOSIS;
    for (const command of DIAGNOSIS_COMMANDS) {
      const response = await this.transport.request(command);
      if (!headersMatch(command, response)) {
        throw new SphereError('decode', 'diagnostic response does not match request');
      }
      diagnosis = applyDiagnosisFrame(diagnosis, response);
    }
    return diagnosis;
  }

  /**
   * Read product numbers, firmware versions and battery voltage.
   *
   * The charger's own identity is required. The holder may be out of its
   * charger and the voltage frame is not understood on every model, so
   * failures there are reported in the result instead of failing the read.
   */
  async readStatus(): Promise<DeviceStatus> {
    const productNumber = await this.readProductNumber('stick');
    const stickFirmware = await this.readFirmware('stick');
    const holder = hasHolder(this.model) ? await this.readHolderIdentity() : {};
    const batteryVoltage = await this.readBatteryVoltage().catch(recoverDeviceError);
    return {
      productNumber,
      stickFirmware,
      ...holder,
      ...(typeof batteryVoltage === 'number' ? { batteryVoltage } : {}),
    };
  }

  async findStart(): Promise<void> {
    await this.transport.request(START_VIBRATE);
  }

  async findStop(): Promise<void> {
    await this.transport.request(STOP_VIBRATE);
  }

  private async readChargeVibration(): Promise<boolean> {
    return parseChargeVibration(await this.transport.request(LOAD_CHARGE_VIBRATION));
  }

  private async readHolderIdentity(): Promise<
    Pick<DeviceStatus, 'holderProductNumber' | 'holderFirmware' | 'holderError'>
  > {
    try {
      const holderProductNumber = await this.readProductNumber('holder');
      const holderFirmware = await this.readFirmware('holder');
      return { holderProductNumber, holderFirmware };
    } catch (error) {
      const failure = recoverDeviceError(error);
      return { holderError: failure.message };
    }
  }

  private async sendAll(commands: readonly Uint8Array[]): Promise<void> {
    for (const command of commands) await this.transport.request(command);
  }

  private require(capability: Capability): void {
    if (!this.supports(capability)) {
      throw unsupportedError(
        `${CAPABILITY_NAMES[capability]} is not supported for model ${modelLabel(this.model)}`,
      );
    }
  }
}

/** Pass through device-side failures as values; rethrow programming errors. */
function recoverDeviceError(error: unknown): SphereError {
  if (error instanceof SphereError) return error;
  throw error;
}
