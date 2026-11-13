/** Known IQOS device models. `unknown` covers anything not yet modelled. */
export type DeviceModel =
  | 'iluma-one'
  | 'iluma'
  | 'iluma-prime'
  | 'iluma-i-one'
  | 'iluma-i'
  | 'iluma-i-prime'
  | 'unknown';

/** Device-level feature flags. */
export type Capability =
  | 'brightness'
  | 'vibration'
  | 'flexpuff'
  | 'flexbattery'
  | 'smartgesture'
  | 'autostart'
  | 'lock'
  | 'charge-vibration';

/** Models a user can select by name, in the order the CLI documents them. */
export const KNOWN_MODELS: readonly Exclude<DeviceModel, 'unknown'>[] = [
  'iluma-i',
  'iluma-i-one',
  'iluma-i-prime',
  'iluma',
  'iluma-one',
  'iluma-prime',
];

const MODEL_LABELS: Record<DeviceModel, string> = {
  'iluma-one': 'ILUMA ONE',
  iluma: 'ILUMA',
  'iluma-prime': 'ILUMA PRIME',
  'iluma-i-one': 'ILUMA i ONE',
  'iluma-i': 'ILUMA i',
  'iluma-i-prime': 'ILUMA i PRIME',
  unknown: 'unknown model',
};

export function modelLabel(model: DeviceModel): string {
  return MODEL_LABELS[model];
}

/** Infer a model from a BLE local name such as `IQOS ILUMA i PRIME`. */
export function modelFromLocalName(name: string): DeviceModel {
  const normalized = name.trim().toUpperCase();
  if (normalized.includes('ILUMA I PRIME')) return 'iluma-i-prime';
  if (normalized.includes('ILUMA I ONE')) return 'iluma-i-one';
  if (normalized.includes('ILUMA I')) return 'iluma-i';
  if (normalized.includes('ILUMA PRIME')) return 'iluma-prime';
  if (normalized.includes('ILUMA ONE')) return 'iluma-one';
  if (normalized.includes('ILUMA')) return 'iluma';
  return 'unknown';
}

/** Parse a model selector the way the CLI's `--model` option does. */
export function parseModelSelector(value: string): DeviceModel | null {
  const normalized = value.trim().toLowerCase().replace(/[_ ]/g, '-');
  return (KNOWN_MODELS as readonly string[]).includes(normalized)
    ? (normalized as DeviceModel)
    : null;
}

export function isIlumaIFamily(model: DeviceModel): boolean {
  return model === 'iluma-i-one' || model === 'iluma-i' || model === 'iluma-i-prime';
}

/** Whether the model is a holder plus charger rather than a one-piece device. */
export function hasHolder(model: DeviceModel): boolean {
  return (
    model === 'iluma' || model === 'iluma-prime' || model === 'iluma-i' || model === 'iluma-i-prime'
  );
}

/**
 * Capability matrix:
 * - brightness, vibration, lock: every known model;
 * - flexpuff, flexbattery: ILUMA i and ILUMA i PRIME;
 * - smartgesture: ILUMA, ILUMA PRIME and the ILUMA i series;
 * - autostart: the ILUMA i series;
 * - charge-vibration: holder models.
 */
export function supports(model: DeviceModel, capability: Capability): boolean {
  switch (capability) {
    case 'brightness':
    case 'vibration':
    case 'lock':
      return model !== 'unknown';
    case 'flexpuff':
    case 'flexbattery':
      return model === 'iluma-i' || model === 'iluma-i-prime';
    case 'smartgesture':
      return model === 'iluma' || model === 'iluma-prime' || isIlumaIFamily(model);
    case 'autostart':
      return isIlumaIFamily(model);
    case 'charge-vibration':
      return hasHolder(model);
  }
}
