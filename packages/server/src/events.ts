export type HubEvent =
  | { type: 'changed'; paths: string[] }
  | { type: 'synced'; shareIds: string[] }
  | { type: 'applied'; files: string[] }
  /** The set of watched locations changed (project added, share created). */
  | { type: 'roots' };

type Listener = (e: HubEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: HubEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get size() {
    return this.listeners.size;
  }
}
