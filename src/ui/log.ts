/** The session's record as plain text, for pasting into a bug report. */
import type { AppState, WireLine } from '../app/state';

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

export function formatTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`;
}

const DIRECTION_LABEL: Record<WireLine['direction'], string> = { tx: 'TX', rx: 'RX', stray: '??' };

/** Every frame exchanged with the device, one per line. */
export function wireText(lines: readonly WireLine[]): string {
  return lines
    .map((line) => {
      const note = line.note === undefined ? '' : `  ; ${line.note}`;
      return `${formatTime(line.at)} ${DIRECTION_LABEL[line.direction]} ${line.hex}${note}`;
    })
    .join('\n');
}

/**
 * What was done and what went over the air: the commands the controls ran
 * with their output, then the frames. Nothing here identifies the owner; the
 * serial number is never read.
 */
export function sessionLog(state: Pick<AppState, 'console' | 'wire'>, version: string): string {
  const commands = state.console.map((line) => line.text).join('\n');
  return [
    `Sphere ${version} session log`,
    '',
    '== Commands ==',
    commands === '' ? '(none)' : commands,
    '',
    '== Frames ==',
    state.wire.length === 0 ? '(none)' : wireText(state.wire),
    '',
  ].join('\n');
}
