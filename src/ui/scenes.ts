/**
 * The pictures Sphere shows, each a pure function of dot position and time.
 *
 * They are Sphere's own drawings: schematic, a few dozen dots across, and
 * made to explain a setting rather than to portray a product. The device
 * picture has one variant per supported model, told apart by the things a
 * person would notice: one body or two, a wrap, a screen on the holder.
 */
import type { DeviceModel } from '../protocol/model';
import type { Scene } from './dots';

type Box = readonly [left: number, top: number, right: number, bottom: number];

const TAU = Math.PI * 2;

function inBox(x: number, y: number, [left, top, right, bottom]: Box): boolean {
  return x >= left && x <= right && y >= top && y <= bottom;
}

/** Inside `box` with its corners cut back by `cut` dots. */
function inRounded(x: number, y: number, box: Box, cut = 1): boolean {
  if (!inBox(x, y, box)) return false;
  const [left, top, right, bottom] = box;
  return Math.min(x - left, right - x) + Math.min(y - top, bottom - y) >= cut;
}

function shrink([left, top, right, bottom]: Box, by = 1): Box {
  return [left + by, top + by, right - by, bottom - by];
}

/** On the one-dot rim of a rounded box. */
function onRim(x: number, y: number, box: Box, cut = 1): boolean {
  return inRounded(x, y, box, cut) && !inRounded(x, y, shrink(box), cut);
}

/** A value swinging between 0 and 1 once every `period` seconds. */
function swing(time: number, period: number, offset = 0): number {
  return 0.5 + 0.5 * Math.sin((time / period + offset) * TAU);
}

/** Where `time` is within a loop of `period` seconds, 0 to 1. */
function loop(time: number, period: number): number {
  return (((time % period) + period) % period) / period;
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Alternates between two dot offsets, for something that is buzzing. */
function jitter(time: number): number {
  return Math.floor(time * 11) % 2;
}

// ── The emblem ──────────────────────────────────────────────────────────────

export const GLOBE_SIZE = 40;
const LIGHT = [-0.5, -0.56, 0.66] as const;

/** A globe with a graticule, turning under a fixed light. */
export function globeScene(size = GLOBE_SIZE): Scene {
  return (column, row, time) => {
    const x = ((column + 0.5) / size) * 2 - 1;
    const y = ((row + 0.5) / size) * 2 - 1;
    const inside = 1 - x * x - y * y;
    if (inside <= 0) return 0;
    const z = Math.sqrt(inside);
    const lit = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
    const level = 0.1 + lit * 0.9;

    const longitude = Math.atan2(x, z) + time * 0.35;
    const latitude = Math.asin(y);
    const meridian = (longitude / TAU) * 12;
    const parallel = (latitude / Math.PI) * 7;
    const nearMeridian = Math.abs(meridian - Math.round(meridian)) < 0.11 / Math.max(0.3, Math.cos(latitude));
    const nearParallel = Math.abs(parallel - Math.round(parallel)) < 0.13;
    // The graticule is cut out of the lit side and drawn onto the dark side.
    if (nearMeridian || nearParallel) return level > 0.45 ? level * 0.15 : level + 0.4;
    return level;
  };
}

// ── The device ──────────────────────────────────────────────────────────────

export const DEVICE_COLUMNS = 24;
export const DEVICE_ROWS = 30;

/** What distinguishes one model's picture from another's. */
export interface DeviceForm {
  /** A single body, rather than a holder that lives in a pocket charger. */
  readonly allInOne: boolean;
  /** A wrap around the charger. */
  readonly wrap: boolean;
  /** A screen where the earlier models have a single light. */
  readonly screen: boolean;
  readonly known: boolean;
}

export function deviceForm(model: DeviceModel): DeviceForm {
  return {
    allInOne: model === 'iluma-one' || model === 'iluma-i-one',
    wrap: model === 'iluma-prime' || model === 'iluma-i-prime',
    screen: model === 'iluma-i' || model === 'iluma-i-one' || model === 'iluma-i-prime',
    known: model !== 'unknown',
  };
}

export interface DeviceView {
  /** Battery level, 0 to 100, or `null` while it is not known. */
  readonly level: number | null;
  /** Find My IQOS is vibrating the device. */
  readonly finding: boolean;
}

const LOW_LEVEL = 15;
const CHARGER: Box = [2, 4, 13, 27];
const HOLDER: Box = [17, 2, 20, 27];
const BODY: Box = [8, 2, 15, 27];

/** The battery, drawn as a column of rows filling from the bottom of `well`. */
function fill(x: number, y: number, time: number, well: Box, view: DeviceView): number {
  if (!inBox(x, y, well)) return 0;
  const [, top, , bottom] = well;
  const rows = bottom - top + 1;
  const fromBottom = bottom - y;
  if (view.level === null) {
    // Not read yet: one row climbs the well.
    return fromBottom === Math.floor(loop(time, 1.6) * rows) ? 0.55 : 0;
  }
  const filled = Math.round((clamp(view.level / 100) * rows));
  const shown = view.level > 0 ? Math.max(1, filled) : 0;
  if (fromBottom >= shown) return 0;
  if (view.level <= LOW_LEVEL) return 0.35 + 0.6 * swing(time, 0.9);
  return 0.62 + 0.2 * swing(time, 2.6, -fromBottom / rows);
}

/** A screen counting down: its dots go out from the top, then it refills. */
function countdown(y: number, time: number, top: number, rows: number): number {
  const gone = Math.floor(loop(time, 4.8) * (rows + 1));
  return y - top < gone ? 0.16 : 1;
}

/** The connected device, model by model, with its battery level inside it. */
export function deviceScene(model: DeviceModel, view: DeviceView): Scene {
  const form = deviceForm(model);
  const strength = form.known ? 1 : 0.4;

  if (form.allInOne) {
    return (column, row, time) => {
      const x = column - (view.finding ? jitter(time) : 0);
      const y = row;
      if (onRim(x, y, BODY, 2)) return 0.9;
      if (!inRounded(x, y, BODY, 2)) return 0;
      // The cap closes over the stick; the lights sit just under it.
      if (y === 7) return 0.9;
      if (form.screen) {
        if (inBox(x, y, [10, 9, 13, 12])) return countdown(y, time, 9, 4);
      } else if (y === 10 && (x === 11 || x === 12)) {
        return 0.5 + 0.5 * swing(time, 2.2);
      }
      return fill(x, y, time, [10, 15, 13, 24], view);
    };
  }

  return (column, row, time) => {
    const y = row;
    const holderX = column - (view.finding ? jitter(time) : 0);
    if (onRim(holderX, y, HOLDER)) return 0.9 * strength;
    if (inRounded(holderX, y, HOLDER)) {
      if (!form.known) return 0;
      if (form.screen) return inBox(holderX, y, [18, 6, 19, 12]) ? countdown(y, time, 6, 7) : 0;
      // One light, and the button under it.
      if (y === 7) return 0.5 + 0.5 * swing(time, 2.2);
      return y === 11 || y === 12 ? 0.45 : 0;
    }

    const x = column;
    // The wrap runs round the charger and stands a dot proud of it.
    if (form.wrap && y >= 12 && y <= 14 && x >= 1 && x <= 14) return 1;
    if (onRim(x, y, CHARGER, 2)) return 0.9 * strength;
    if (!form.known || !inRounded(x, y, CHARGER, 2)) return 0;
    return form.wrap
      ? fill(x, y, time, [4, 16, 11, 24], view)
      : fill(x, y, time, [4, 7, 11, 24], view);
  };
}

// ── The settings ────────────────────────────────────────────────────────────

export const GUIDE_COLUMNS = 40;
export const GUIDE_ROWS = 12;

/** Status lights, dim or bright. `undefined` while the level is not known. */
export function brightnessScene(level: 'low' | 'high' | undefined): Scene {
  const centres = [11, 17, 23, 29];
  return (column, row, time) => {
    const high = level === undefined ? swing(time, 3.6) > 0.5 : level === 'high';
    if (row >= 9 && row <= 10 && onRim(column, row, [7, 9, 33, 12])) return 0.3;
    let best = 0;
    for (const centre of centres) {
      const distance = Math.hypot(column - centre, row - 4.5);
      if (distance < 1.2) best = Math.max(best, high ? 1 : 0.42);
      else if (high && distance < 3.4) {
        best = Math.max(best, 0.34 * (1 - distance / 3.4) * (0.65 + 0.35 * swing(time, 2.4)));
      }
    }
    return best;
  };
}

/** A holder with waves coming off it: more signals switched on, more waves. */
export function vibrationScene(enabled: number, total: number, allInOne: boolean): Scene {
  const waves = enabled <= 0 || total <= 0 ? 0 : Math.ceil((enabled / total) * 3);
  const half = allInOne ? 1.5 : 0.5;
  return (column, row, time) => {
    const x = column - (waves > 0 ? jitter(time) : 0);
    const body: Box = [14, 5.5 - half, 25, 5.5 + half];
    if (inRounded(x, row, body)) return 0.9;
    const outward = column < 14 ? 14 - column : column > 25 ? column - 25 : 0;
    if (outward === 0) return 0;
    const distance = Math.hypot(outward, row - 5.5);
    for (let wave = 1; wave <= waves; wave++) {
      const radius = 2 + wave * 2.4;
      if (Math.abs(distance - radius) < 0.6 && Math.abs(row - 5.5) <= radius * 0.72) {
        return Math.max(0, Math.sin(time * 5 - wave * 1.1)) * (1 - wave * 0.2);
      }
    }
    return 0;
  };
}

/** A stick going in. With auto start, the holder heats; without, it waits for its button. */
export function autoStartScene(on: boolean | undefined, allInOne: boolean): Scene {
  const holder: Box = allInOne ? [17, 6, 22, 13] : [18, 6, 21, 13];
  return (column, row, time) => {
    const phase = loop(time, 3.8);
    const stickTop = phase < 0.35 ? Math.round(-7 + (phase / 0.35) * 7) : 0;
    const glow = on === false ? 0 : clamp((phase - 0.42) / 0.28);
    if (inBox(column, row, holder)) return 0.3 + 0.7 * glow;
    if ((column === 19 || column === 20) && row >= stickTop && row <= stickTop + 6 && row < 6) return 0.6;
    if (on === false) {
      // Nothing happens until the button is pressed.
      const button = holder[2] + 2;
      return phase > 0.4 && column === button && (row === 8 || row === 9) ? swing(time, 0.8) : 0;
    }
    // Warmth rising on both sides.
    const beside = column === holder[0] - 2 || column === holder[0] - 3 || column === holder[2] + 2 || column === holder[2] + 3;
    if (!beside || row < 6) return 0;
    return (row + Math.floor(time * 6)) % 3 === 0 ? 0.55 * glow : 0;
  };
}

/** Fourteen puffs counted off, and up to four more when FlexPuff allows them. */
export function flexPuffScene(on: boolean | undefined): Scene {
  return (column, row, time) => {
    if (row !== 5 && row !== 6) return 0;
    const head = Math.floor(loop(time, 6.4) * 23) - 2;
    if (column >= 2 && column <= 28 && column % 2 === 0) {
      return (column - 2) / 2 <= head ? 1 : 0.26;
    }
    if (on === false || column < 32 || column > 38 || column % 2 !== 0) return 0;
    const extra = 14 + (column - 32) / 2;
    return extra <= head ? 1 : 0.14 + 0.2 * swing(time, 1.4);
  };
}

/** Lifting the holder to light it, and tapping it twice. */
export function gestureScene(on: boolean | null, allInOne: boolean): Scene {
  const active = on !== false;
  const thick = allInOne ? 2 : 1;
  return (column, row, time) => {
    // Left: the holder rises off the table and its lights come on.
    const lift = active ? Math.round(3 * swing(time, 3.4)) : 0;
    if (row === 11 && column >= 3 && column <= 17) return 0.24;
    const bottom = 9 - lift;
    if (inRounded(column, row, [5, bottom - thick, 15, bottom], 1)) return active ? 0.9 : 0.4;
    if (lift >= 2 && row === bottom - thick - 2 && (column === 8 || column === 12)) return 1;

    // Right: two taps, each sending a ring off the top of the holder.
    if (inRounded(column, row, [24, 8 - thick, 34, 8], 1)) return active ? 0.9 : 0.4;
    if (!active || row >= 8 - thick) return 0;
    const moment = loop(time, 3.2) * 3.2;
    for (const tap of [0.4, 0.9]) {
      const age = moment - tap;
      if (age <= 0 || age > 0.55) continue;
      const distance = Math.hypot(column - 29, row - (8 - thick));
      if (Math.abs(distance - age * 11) < 0.65) return 1 - age / 0.55;
    }
    return 0;
  };
}

/**
 * The holder's battery as the sessions it gives in a row: three in
 * Performance, two and a pause when pause is on, one in Eco.
 */
export function batteryScene(mode: 'performance' | 'eco' | undefined, pause: boolean | undefined): Scene {
  const slots: readonly Box[] = [
    [9, 4, 14, 7],
    [16, 4, 21, 7],
    [23, 4, 28, 7],
  ];
  return (column, row, time) => {
    if (onRim(column, row, [7, 2, 30, 9])) return 0.85;
    if (inBox(column, row, [31, 4, 32, 7])) return 0.85;
    const paused = mode === 'performance' && pause === true;
    const sessions =
      mode === 'eco' ? 1 : mode === 'performance' ? (paused ? 2 : 3) : 1 + Math.floor(loop(time, 3.6) * 3);
    for (const [index, slot] of slots.entries()) {
      if (!inBox(column, row, slot)) continue;
      if (index < sessions) return 0.68 + 0.32 * swing(time, 2.6, -index * 0.18);
      // The last cell holds the pause sign.
      if (paused && index === 2 && (column === 24 || column === 27)) return 0.4 + 0.5 * swing(time, 1.8);
      return 0;
    }
    return 0;
  };
}

/** A padlock, shut or open. While the state is unknown it does both, faintly. */
export function lockScene(locked: boolean | null): Scene {
  const strength = locked === null ? 0.5 : 1;
  return (column, row, time) => {
    const shut = locked ?? swing(time, 3.6) > 0.5;
    if (inRounded(column, row, [15, 6, 24, 11])) {
      const keyhole = (column === 19 || column === 20) && (row === 8 || row === 9);
      return keyhole ? 0 : (shut ? 0.95 : 0.55) * strength;
    }
    // The shackle: an arch with both feet in the body, or lifted with one foot out.
    const rise = shut ? 0 : 1;
    const y = row + rise;
    const arch = (y === 1 || y === 2) && inRounded(column, y, [17, 1, 22, 2]);
    const leftLeg = (column === 17 || column === 18) && y >= 3 && row <= 5;
    const rightLeg = (column === 21 || column === 22) && y >= 3 && y <= (shut ? 5 : 3);
    return arch || leftLeg || rightLeg ? 0.9 * strength : 0;
  };
}

/** Rings spreading from the device: slow while idle, urgent while it buzzes. */
export function findScene(finding: boolean): Scene {
  const span = 20;
  const rings = finding ? 3 : 1;
  return (column, row, time) => {
    const x = column - (finding ? jitter(time) : 0);
    if (inBox(x, row, [19, 5, 20, 6])) return 1;
    const distance = Math.hypot(column - 19.5, row - 5.5);
    for (let ring = 0; ring < rings; ring++) {
      const radius = (time * (finding ? 10 : 3.5) + (ring * span) / rings) % span;
      if (radius > 1.6 && Math.abs(distance - radius) < 0.7) {
        return (1 - radius / span) * (finding ? 1 : 0.5);
      }
    }
    return 0;
  };
}
