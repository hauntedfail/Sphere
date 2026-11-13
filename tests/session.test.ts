import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromHex, toHex } from '../src/protocol/bytes';
import { SphereError } from '../src/protocol/errors';
import { classicFrame } from '../src/protocol/scp';
import { LOAD_BRIGHTNESS, LOAD_FLEXBATTERY } from '../src/protocol/settings';
import { ScpSession, type ScpPort, type WireEvent } from '../src/transport/session';

/** A port the test drives by hand. */
class ManualPort implements ScpPort {
  readonly written: Uint8Array[] = [];
  failWrites = false;
  private listener: ((chunk: Uint8Array) => void) | null = null;

  async write(chunk: Uint8Array): Promise<void> {
    if (this.failWrites) throw new Error('GATT operation failed');
    this.written.push(chunk);
  }

  subscribe(listener: (chunk: Uint8Array) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(hex: string): void {
    this.listener?.(fromHex(hex));
  }

  get subscribed(): boolean {
    return this.listener !== null;
  }
}

const BRIGHTNESS_HIGH = '00 C0 86 23 64 00 00 00 D5';

describe('ScpSession', () => {
  let port: ManualPort;
  let wire: WireEvent[];
  let session: ScpSession;

  beforeEach(() => {
    vi.useFakeTimers();
    port = new ManualPort();
    wire = [];
    session = new ScpSession(port, { timeoutMs: 1000, onWire: (event) => wire.push(event) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };

  it('resolves with the matching response', async () => {
    const reply = session.request(LOAD_BRIGHTNESS);
    await flush();
    expect(port.written.map(toHex)).toEqual(['00 C0 02 23 C3']);

    port.emit(BRIGHTNESS_HIGH);
    expect(toHex(await reply)).toBe(BRIGHTNESS_HIGH);
    expect(wire.map((event) => event.direction)).toEqual(['tx', 'rx']);
  });

  it('skips frames that answer something else', async () => {
    const reply = session.request(LOAD_BRIGHTNESS);
    await flush();
    port.emit('00 08 84 25 00 00 00 00 C1');
    port.emit(BRIGHTNESS_HIGH);

    expect(toHex(await reply)).toBe(BRIGHTNESS_HIGH);
    expect(wire.map((event) => event.direction)).toEqual(['tx', 'stray', 'rx']);
  });

  it('reports frames that arrive with nothing pending', () => {
    port.emit(BRIGHTNESS_HIGH);
    expect(wire).toHaveLength(1);
    expect(wire[0]?.direction).toBe('stray');
  });

  it('reassembles a fragmented response', async () => {
    const command = classicFrame(0xc9, 0x07, 0x04, [0x04, 0x00, 0x00, 0x00]);
    const reply = session.request(command);
    await flush();
    port.emit('00 08 8B 04 04 00 00 00 00 00 00 00 00 00 00 00 00 00 56');
    expect((await reply).length).toBe(19);
  });

  it('writes long commands as countdown fragments', async () => {
    const command = classicFrame(0xc9, 0x4f, 0x04, [0x5b, 0x04, 0x00, 0xff, 0xff, 0xff, ...new Array<number>(18).fill(0)]);
    const reply = session.request(command);
    await flush();
    expect(port.written.map((chunk) => chunk.length)).toEqual([20, 10]);
    expect(port.written[0]?.[0]).toBe(0x01);
    expect(port.written[1]?.[0]).toBe(0x00);

    port.emit(toHex(classicFrame(0x08, 0xc3, 0x04)));
    await expect(reply).resolves.toBeInstanceOf(Uint8Array);
  });

  it('runs requests one at a time, in order', async () => {
    const first = session.request(LOAD_BRIGHTNESS);
    const second = session.request(LOAD_FLEXBATTERY);
    await flush();
    expect(port.written).toHaveLength(1);

    port.emit(BRIGHTNESS_HIGH);
    await first;
    await flush();
    expect(port.written.map(toHex)).toEqual(['00 C0 02 23 C3', '00 C9 00 25 FB']);

    port.emit('00 08 84 25 01 00 00 00 D7');
    expect(toHex(await second)).toBe('00 08 84 25 01 00 00 00 D7');
  });

  it('times out, then keeps working', async () => {
    const lost = session.request(LOAD_BRIGHTNESS);
    const assertion = expect(lost).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    const retry = session.request(LOAD_BRIGHTNESS);
    await flush();
    port.emit(BRIGHTNESS_HIGH);
    expect(toHex(await retry)).toBe(BRIGHTNESS_HIGH);
  });

  it('rejects a response with a bad checksum', async () => {
    const reply = session.request(LOAD_BRIGHTNESS);
    const assertion = expect(reply).rejects.toThrow(/CRC-8/);
    await flush();
    port.emit('00 C0 86 23 64 00 00 00 D6');
    await assertion;
    expect(wire.at(-1)?.note).toMatch(/CRC-8/);
  });

  it('rejects a device error response', async () => {
    const reply = session.request(LOAD_BRIGHTNESS);
    const assertion = expect(reply).rejects.toThrow(/device error/i);
    await flush();
    port.emit(toHex(classicFrame(0xc0, 0xa2, 0x23)));
    await assertion;
  });

  it('rejects the pending request when fragments are malformed', async () => {
    const reply = session.request(LOAD_BRIGHTNESS);
    const assertion = expect(reply).rejects.toThrow(/fragment/);
    await flush();
    port.emit('02 01');
    await assertion;
    expect(wire.at(-1)?.direction).toBe('stray');
  });

  it('drops fragments left over from a reply that never completed', async () => {
    const lost = session.request(LOAD_BRIGHTNESS);
    const lostAssertion = expect(lost).rejects.toThrow(/timed out/);
    await flush();
    port.emit('02 ' + new Array(19).fill('00').join(' '));
    await vi.advanceTimersByTimeAsync(1000);
    await lostAssertion;

    const next = session.request(LOAD_BRIGHTNESS);
    await flush();
    port.emit(BRIGHTNESS_HIGH);
    expect(toHex(await next)).toBe(BRIGHTNESS_HIGH);
  });

  it('stops writing fragments once the request is over', async () => {
    const gate: (() => void)[] = [];
    const slow: ScpPort = {
      write: (chunk) =>
        new Promise<void>((resolve) => {
          port.written.push(chunk);
          gate.push(resolve);
        }),
      subscribe: () => () => undefined,
    };
    const slowSession = new ScpSession(slow, { timeoutMs: 1000 });
    const command = classicFrame(0xc9, 0x4f, 0x04, [0x5b, 0x04, 0x00, 0xff, 0xff, 0xff, ...new Array<number>(18).fill(0)]);
    const stuck = slowSession.request(command);
    const assertion = expect(stuck).rejects.toThrow(/timed out/);
    await flush();
    expect(port.written).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    gate[0]?.();
    await flush();
    // The second fragment of the abandoned command is never sent.
    expect(port.written).toHaveLength(1);
  });

  it('refuses to send an invalid command', async () => {
    await expect(session.request(fromHex('00 C0 01 00 F6'))).rejects.toMatchObject({ kind: 'encode' });
    expect(port.written).toHaveLength(0);
  });

  it('surfaces write failures as transport errors', async () => {
    port.failWrites = true;
    await expect(session.request(LOAD_BRIGHTNESS)).rejects.toMatchObject({
      kind: 'transport',
      message: expect.stringMatching(/write failed/),
    });
  });

  it('fails pending and later requests once closed', async () => {
    const reply = session.request(LOAD_BRIGHTNESS);
    const assertion = expect(reply).rejects.toThrow(/device disconnected/);
    await flush();
    session.close('device disconnected');
    await assertion;

    expect(session.closed).toBe(true);
    expect(port.subscribed).toBe(false);
    await expect(session.request(LOAD_BRIGHTNESS)).rejects.toBeInstanceOf(SphereError);
    session.close('again');
  });
});
