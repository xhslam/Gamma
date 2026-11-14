/**
 * VMark v0.9.99: src/lib/ptyInputQueue.ts
 * Commit f2bf1b3fce06ca21fe7cd19382bef9c4774d0558.
 * ISC License
 *
 * Copyright (c) 2026 Xiaolai Li
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
/**
 * Per-session ordered PTY input delivery.
 *
 * Purpose: asynchronous IPC and the backend blocking pool do not preserve the
 * order of concurrent writes. Keep one request in flight and batch input that
 * arrives while it completes, so keystrokes, IME commits and paste stay ordered.
 * Failed writes are not retried because they may already have written a prefix.
 * Closing the queue drops pending input without waiting for the current write.
 *
 * @coordinates-with lib/pty.ts — owns one queue per PTY and closes it on teardown
 * @module lib/ptyInputQueue
 */

/** Ordered input sink for one PTY session. */
export interface PtyInputQueue {
  /** Queue `data` for delivery after every earlier write; ignored once closed or empty. */
  write(data: string): void;
  /** Drop pending input and refuse further writes; an in-flight write is not awaited. */
  close(): void;
}

export function createPtyInputQueue(
  write: (data: string) => Promise<void>,
  onError: (error: unknown) => void,
): PtyInputQueue {
  let pending: string[] = [];
  let running = false;
  let closed = false;

  const drain = async () => {
    running = true;
    try {
      while (!closed && pending.length) {
        const data = pending.join("");
        pending = [];
        try {
          await write(data);
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    write(data: string): void {
      if (closed || !data) return;
      pending.push(data);
      if (!running) void drain();
    },
    close(): void {
      closed = true;
      pending = [];
    },
  };
}
