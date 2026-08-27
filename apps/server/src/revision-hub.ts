export interface RevisionEvent {
  documentId: string;
  revision: number;
  cursor: number;
  commandId: string;
  changedIds: string[];
}

type SubscriptionMessage = { type: "revision"; event: RevisionEvent } | { type: "heartbeat" };

export class RevisionSubscription {
  readonly #onClose: () => void;
  readonly #queue: SubscriptionMessage[] = [];
  #resolveNext: ((message: SubscriptionMessage | undefined) => void) | undefined;
  #closed = false;

  constructor(onClose: () => void) {
    this.#onClose = onClose;
  }

  next(): Promise<SubscriptionMessage | undefined> {
    const message = this.#queue.shift();
    if (message) {
      return Promise.resolve(message);
    }
    if (this.#closed) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      this.#resolveNext = resolve;
    });
  }

  push(event: RevisionEvent): void {
    this.#enqueue({ type: "revision", event });
  }

  heartbeat(): void {
    if (this.#queue.length === 0) {
      this.#enqueue({ type: "heartbeat" });
    }
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#queue.length = 0;
    this.#resolveNext?.(undefined);
    this.#resolveNext = undefined;
    this.#onClose();
  }

  #enqueue(message: SubscriptionMessage): void {
    if (this.#closed) {
      return;
    }
    if (this.#resolveNext) {
      const resolve = this.#resolveNext;
      this.#resolveNext = undefined;
      resolve(message);
      return;
    }

    // Revision notifications are wake-ups, so retaining the newest bounded set is sufficient.
    if (this.#queue.length >= 16) {
      this.#queue.shift();
    }
    this.#queue.push(message);
  }
}

export class RevisionHub {
  readonly #subscriptions = new Map<string, Set<RevisionSubscription>>();
  readonly #maxSubscribers: number;
  #subscriberCount = 0;

  constructor(maxSubscribers = 64) {
    if (!Number.isSafeInteger(maxSubscribers) || maxSubscribers <= 0) {
      throw new TypeError("maxSubscribers must be a positive integer");
    }
    this.#maxSubscribers = maxSubscribers;
  }

  subscribe(documentId: string): RevisionSubscription {
    if (this.#subscriberCount >= this.#maxSubscribers) {
      throw new Error("Revision subscriber capacity has been reached");
    }

    const subscriptions = this.#subscriptions.get(documentId) ?? new Set();
    let subscription: RevisionSubscription;
    subscription = new RevisionSubscription(() => {
      if (!subscriptions.delete(subscription)) {
        return;
      }
      this.#subscriberCount -= 1;
      if (subscriptions.size === 0) {
        this.#subscriptions.delete(documentId);
      }
    });
    subscriptions.add(subscription);
    this.#subscriptions.set(documentId, subscriptions);
    this.#subscriberCount += 1;
    return subscription;
  }

  publish(event: RevisionEvent): void {
    for (const subscription of this.#subscriptions.get(event.documentId) ?? []) {
      subscription.push(event);
    }
  }

  get subscriberCount(): number {
    return this.#subscriberCount;
  }
}
