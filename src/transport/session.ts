/**
 * SCP request/response session on top of a notify-capable byte channel.
 *
 * One request is on the wire at a time. A reply is accepted only when its
 * command identity matches the pending request and it passes length, CRC and
 * device-error checks; everything else is reported as a stray frame and
 * otherwise ignored. Ported from the request path of `src/ble.rs` in the
 * `iqos` crate.
 *
 * One deliberate difference: upstream invalidates the whole session after a
 * timeout, forcing a reconnect. SCP frames carry no sequence number, so if a
 * command times out and the same command is sent again, a late reply to the
 * first can be taken for the second. Every command here is idempotent, which
 * makes that a stale reading at worst, so this session stays usable instead.
 */
import { describeError, encodeError, decodeError, transportError } from '../protocol/errors';
import { FrameAssembler, fragment, frameError, headersMatch, responseError } from '../protocol/scp';

/** The byte channel a session drives: GATT in the browser, a simulator in tests. */
export interface ScpPort {
  /** Write one fragment and resolve once the peer has acknowledged it. */
  write(chunk: Uint8Array): Promise<void>;
  /** Receive notification payloads. Returns an unsubscribe function. */
  subscribe(listener: (chunk: Uint8Array) => void): () => void;
}

/** Anything that can answer an SCP command with one validated response frame. */
export interface Transport {
  request(command: Uint8Array): Promise<Uint8Array>;
}

export type WireDirection = 'tx' | 'rx' | 'stray';

export interface WireEvent {
  readonly direction: WireDirection;
  readonly frame: Uint8Array;
  /** Why a frame was dropped or rejected, when it was. */
  readonly note?: string;
}

export interface SessionOptions {
  /** How long to wait for a matching reply. */
  readonly timeoutMs?: number;
  /** Observer for every frame sent, received or dropped. */
  readonly onWire?: (event: WireEvent) => void;
}

export const DEFAULT_TIMEOUT_MS = 5000;

interface Pending {
  readonly command: Uint8Array;
  readonly settle: (result: Uint8Array | Error) => void;
}

export class ScpSession implements Transport {
  private readonly assembler = new FrameAssembler();
  private readonly timeoutMs: number;
  private readonly onWire: (event: WireEvent) => void;
  private readonly unsubscribe: () => void;
  private pending: Pending | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closedReason: string | null = null;

  constructor(
    private readonly port: ScpPort,
    options: SessionOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onWire = options.onWire ?? (() => undefined);
    this.unsubscribe = port.subscribe((chunk) => this.receive(chunk));
  }

  /** Send a command and resolve with its validated response frame. */
  request(command: Uint8Array): Promise<Uint8Array> {
    const result = this.queue.then(() => this.transact(command));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Stop the session. Pending and future requests fail with `reason`. */
  close(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    this.unsubscribe();
    this.pending?.settle(transportError(reason));
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  private transact(command: Uint8Array): Promise<Uint8Array> {
    if (this.closedReason !== null) return Promise.reject(transportError(this.closedReason));

    const invalid = frameError(command);
    if (invalid !== null) return Promise.reject(encodeError(invalid));
    const chunks = fragment(command);

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        settle(transportError('timed out waiting for the device to answer'));
      }, this.timeoutMs);

      const settle = (result: Uint8Array | Error): void => {
        if (this.pending !== pending) return;
        this.pending = null;
        clearTimeout(timer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const pending: Pending = { command, settle };
      // Fragments left over from a reply that never completed belong to an
      // earlier request; they must not corrupt this one's reply.
      this.assembler.reset();
      this.pending = pending;
      this.onWire({ direction: 'tx', frame: command });

      this.writeAll(chunks, pending).catch((error: unknown) => {
        settle(transportError(`write failed: ${describeError(error)}`, error));
      });
    });
  }

  /** Write the fragments in order, stopping if the request is already over. */
  private async writeAll(chunks: readonly Uint8Array[], owner: Pending): Promise<void> {
    for (const chunk of chunks) {
      if (this.pending !== owner) return;
      await this.port.write(chunk);
    }
  }

  private receive(chunk: Uint8Array): void {
    let frame: Uint8Array | null;
    try {
      frame = this.assembler.push(chunk);
    } catch (error) {
      this.assembler.reset();
      this.onWire({ direction: 'stray', frame: chunk, note: describeError(error) });
      this.pending?.settle(decodeError(describeError(error)));
      return;
    }
    if (frame === null) return;

    const pending = this.pending;
    if (pending === null || !headersMatch(pending.command, frame)) {
      this.onWire({ direction: 'stray', frame, note: 'no request is waiting for this frame' });
      return;
    }

    const invalid = responseError(frame);
    if (invalid !== null) {
      this.onWire({ direction: 'rx', frame, note: invalid });
      pending.settle(decodeError(invalid));
      return;
    }

    this.onWire({ direction: 'rx', frame });
    pending.settle(frame);
  }
}
