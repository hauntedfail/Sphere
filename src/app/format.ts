/** Console output text, kept close to what the `iqos` CLI prints. */
import type { DeviceStatus } from '../device/iqos';
import { type Diagnosis, formatFirmware } from '../protocol/identity';
import { type DeviceModel, modelLabel, supports } from '../protocol/model';
import type { VibrationSettings } from '../protocol/vibration';
import { type DeviceBook, sortedLabels } from '../storage/devices';
import type { ConnectedDevice, FlexBatteryState } from './state';

export const onOff = (value: boolean): string => (value ? 'on' : 'off');
export const enabledText = (value: boolean): string => (value ? 'enabled' : 'disabled');

/** What to show for the serial number, which browsers refuse to read. */
export function serialText(device: ConnectedDevice): string {
  if (device.info.serialNumber !== undefined) return device.info.serialNumber;
  return device.kind === 'ble' ? 'hidden by the browser' : 'N/A';
}

export function formatInfo(device: ConnectedDevice, status: DeviceStatus): string[] {
  const { info } = device;
  const lines = [
    'Device Information:',
    `  Model:           ${modelLabel(device.model)}`,
    `  Model number:    ${info.modelNumber ?? 'N/A'}`,
    `  Serial number:   ${serialText(device)}`,
    `  Manufacturer:    ${info.manufacturerName ?? 'N/A'}`,
    `  Software rev:    ${info.softwareRevision ?? 'N/A'}`,
    `  Product number:  ${status.productNumber}`,
    `  Stick firmware:  ${formatFirmware(status.stickFirmware)}`,
  ];
  if (status.holderProductNumber !== undefined) {
    lines.push(`  Holder product:  ${status.holderProductNumber}`);
  }
  if (status.holderFirmware !== undefined) {
    lines.push(`  Holder firmware: ${formatFirmware(status.holderFirmware)}`);
  }
  if (status.holderError !== undefined) {
    lines.push(`  Holder:          no answer (${status.holderError})`);
  }
  lines.push(
    status.batteryVoltage === undefined
      ? '  Battery voltage: read failed'
      : `  Battery voltage: ${status.batteryVoltage.toFixed(3)}V`,
  );
  return lines;
}

export function formatDiagnosis(diagnosis: Diagnosis): string[] {
  const lines = ['Diagnosis:'];
  if (diagnosis.puffCount !== undefined) lines.push(`  Total puffs:     ${diagnosis.puffCount}`);
  if (diagnosis.daysUsed !== undefined) lines.push(`  Days used:       ${diagnosis.daysUsed}`);
  if (diagnosis.batteryVoltage !== undefined) {
    lines.push(`  Battery voltage: ${diagnosis.batteryVoltage.toFixed(2)}V`);
  }
  return lines;
}

export function formatVibration(settings: VibrationSettings): string {
  const parts = [
    `heating=${onOff(settings.heating)}`,
    `starting=${onOff(settings.starting)}`,
    `puffend=${onOff(settings.puffEnd)}`,
    `terminated=${onOff(settings.terminated)}`,
  ];
  if (settings.charge !== undefined) parts.push(`charge=${onOff(settings.charge)}`);
  return `Vibration: ${parts.join(' ')}`;
}

export function formatFlexbattery(settings: FlexBatteryState): string {
  return `FlexBattery: mode=${settings.mode}, pause=${onOff(settings.pause)}`;
}

export function formatSavedDevices(book: DeviceBook): string[] {
  const labels = sortedLabels(book);
  if (labels.length === 0) return ['No saved devices'];
  return labels.flatMap((label) => {
    const device = book.devices[label];
    if (device === undefined) return [];
    return [
      label,
      `  id: ${device.id}`,
      `  local_name: ${device.name}`,
      `  model: ${modelLabel(device.model)}`,
    ];
  });
}

/**
 * `help` output. With no device connected, every command is listed. `demo`
 * is listed only where the build has a simulator to run it.
 */
export function helpLines(model: DeviceModel | null, simulator: boolean): string[] {
  const has = (capability: Parameters<typeof supports>[1]): boolean =>
    model === null || supports(model, capability);

  const lines = [
    'Available commands:',
    '  connect [label|--last|--all]   Connect over Bluetooth',
    ...(simulator ? ['  demo [model]                   Connect to a simulated device'] : []),
    '  disconnect                     Close the connection',
    '  battery                        Display battery level',
    '  device [list|save|remove]      Manage saved device labels',
    '  findmyiqos                     Vibrate the device until Enter is pressed',
    '  version                        Display the Sphere version',
  ];
  if (has('lock')) lines.push('  lock | unlock                  Lock or unlock the device');
  if (has('autostart')) lines.push('  autostart [on|off|status]      Configure auto-start');
  lines.push('  diagnosis                      Retrieve telemetry data');

  const deviceCommands: string[] = [];
  if (has('brightness')) deviceCommands.push('  brightness [high|low]          Set brightness');
  if (has('smartgesture')) {
    deviceCommands.push('  smartgesture [enable|disable]  Configure Smart Gesture');
  }
  if (has('flexpuff')) {
    deviceCommands.push('  flexpuff [enable|disable|status]  Configure FlexPuff');
  }
  if (has('vibration')) {
    const flags = has('charge-vibration')
      ? 'heating|starting|terminated|puffend|charge'
      : 'heating|starting|terminated|puffend';
    deviceCommands.push(`  vibration [${flags}] [on|off] ...`);
  }
  if (has('flexbattery')) deviceCommands.push('  flexbattery [performance|eco|pause on|off]');
  if (deviceCommands.length > 0) lines.push('', 'Device commands:', ...deviceCommands);

  lines.push(
    '',
    '  info                           Device metadata, firmware, and voltage snapshot',
    '  refresh                        Read every setting again',
    '  model <model>                  Choose the model when the name is not recognised',
    '  clear                          Clear this console',
    '  help                           This help',
    '  quit | exit                    Disconnect',
  );
  return lines;
}
