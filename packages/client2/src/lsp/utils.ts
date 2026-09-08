export interface IDisposable {
    dispose(): void;
}

export class Disposable implements IDisposable {
    static None = Object.freeze<IDisposable>({ dispose() { } });

    private _store = new DisposableStore();

    constructor() { }

    public dispose(): void {
        this._store.dispose();
    }

    protected _register<T extends IDisposable>(t: T): T {
        if ((t as any) === this) {
            throw new Error('Cannot register a disposable on itself!');
        }
        return this._store.add(t);
    }
}

export class DisposableStore implements IDisposable {
    static DISABLE_DISPOSED_WARNING = false;

    private _toDispose = new Set<IDisposable>();
    private _isDisposed = false;

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this.clear();
    }

    public clear(): void {
        if (this._toDispose.size === 0) {
            return;
        }

        try {
            for (const item of this._toDispose) {
                item.dispose();
            }
        } finally {
            this._toDispose.clear();
        }
    }

    public add<T extends IDisposable>(t: T): T {
        if (!t) {
            return t;
        }
        if ((t as any) === this) {
            throw new Error('Cannot register a disposable on itself!');
        }

        if (this._isDisposed) {
            if (!DisposableStore.DISABLE_DISPOSED_WARNING) {
                console.warn(
                    new Error(
                        'Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!'
                    ).stack
                );
            }
        } else {
            this._toDispose.add(t);
        }

        return t;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Cancellation
// ────────────────────────────────────────────────────────────────────────────

/** Structural subset of monaco.CancellationToken, so utils stays monaco-free */
export interface ICancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested: (listener: () => void) => IDisposable;
}

/**
 * Stop waiting on an in-flight LSP request once the editor cancels it.
 *
 * The typed JSON-RPC layer doesn't expose request ids, so this cannot send a
 * protocol-level `$/cancelRequest`; the server still finishes the work. What it
 * does do is unblock the provider immediately and guarantee a stale response is
 * never converted or applied — which is what the editor actually needs.
 */
export function raceCancellation<T>(
    promise: Promise<T>,
    token: ICancellationToken,
): Promise<T | undefined> {
    if (token.isCancellationRequested) {
        return Promise.resolve(undefined);
    }
    return new Promise<T | undefined>((resolve, reject) => {
        let settled = false;
        const subscription = token.onCancellationRequested(() => {
            if (settled) return;
            settled = true;
            subscription.dispose();
            resolve(undefined);
        });
        promise.then(
            (value) => {
                if (settled) return;
                settled = true;
                subscription.dispose();
                resolve(value);
            },
            (err) => {
                if (settled) return;
                settled = true;
                subscription.dispose();
                reject(err);
            },
        );
    });
}
