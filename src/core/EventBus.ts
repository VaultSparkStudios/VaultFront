export type GameEvent = object;

export interface EventConstructor<T extends GameEvent = GameEvent> {
  new (...args: any[]): T;
}

export interface EventBusCheckpoint {
  readonly listenerCounts: ReadonlyMap<EventConstructor, number>;
}

export class EventBus {
  private listeners: Map<EventConstructor, Array<(event: GameEvent) => void>> =
    new Map();

  emit<T extends GameEvent>(event: T): void {
    const eventConstructor = event.constructor as EventConstructor<T>;
    const callbacks = this.listeners.get(eventConstructor);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(event);
      }
    }
  }

  on<T extends GameEvent>(
    eventType: EventConstructor<T>,
    callback: (event: T) => void,
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    const callbacks = this.listeners.get(eventType)!;
    callbacks.push(callback as (event: GameEvent) => void);
    return () => this.off(eventType, callback);
  }

  off<T extends GameEvent>(
    eventType: EventConstructor<T>,
    callback: (event: T) => void,
  ): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback as (event: GameEvent) => void);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  checkpoint(): EventBusCheckpoint {
    return {
      listenerCounts: new Map(
        [...this.listeners].map(([eventType, callbacks]) => [
          eventType,
          callbacks.length,
        ]),
      ),
    };
  }

  restore(checkpoint: EventBusCheckpoint): void {
    for (const [eventType, callbacks] of this.listeners) {
      const retained = checkpoint.listenerCounts.get(eventType) ?? 0;
      if (retained === 0) {
        this.listeners.delete(eventType);
      } else if (callbacks.length > retained) {
        callbacks.splice(retained);
      }
    }
  }

  listenerCountForTest(): number {
    return [...this.listeners.values()].reduce(
      (sum, callbacks) => sum + callbacks.length,
      0,
    );
  }
}
