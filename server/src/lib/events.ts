import { EventEmitter } from 'node:events';

/**
 * Server-wide event hub. The SSE route subscribes; engine + worker publish.
 * Events are intentionally coarse — clients re-pull state via REST on most of
 * them. Keeps the wire format trivial and reconnect-safe.
 */
export type AppEvent =
  | { type: 'vote'; sessionId: string; ballotId: string }
  | { type: 'ballot_opened'; sessionId: string; ballotId: string; position: number }
  | {
      type: 'ballot_closed';
      sessionId: string;
      ballotId: string;
      winningWord: string;
      reason: string;
      probabilities?: { text: string; p: number }[];
      sampledUpset?: boolean;
    }
  | { type: 'prestage_opened'; sessionId: string; ballotId: string; assumedWord: string }
  | { type: 'prestage_invalidated'; sessionId: string; ballotId: string }
  | { type: 'runoff'; sessionId: string; ballotId: string; until: string }
  | { type: 'session_active'; sessionId: string }
  | { type: 'session_complete'; sessionId: string }
  | { type: 'state'; sessionId: string }; // generic "something changed, re-pull"

class EventHub {
  private emitter = new EventEmitter();
  private activeConnections = 0;

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: AppEvent) {
    this.emitter.emit('event', event);
  }

  subscribe(handler: (event: AppEvent) => void): () => void {
    this.emitter.on('event', handler);
    this.activeConnections++;
    return () => {
      this.emitter.off('event', handler);
      this.activeConnections--;
    };
  }

  get connectionCount() {
    return this.activeConnections;
  }
}

export const hub = new EventHub();
