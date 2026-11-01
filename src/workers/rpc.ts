/** Tiny typed postMessage RPC between the main thread and a worker. */
export interface RpcRequest {
  id: number;
  method: string;
  args: unknown;
}
export interface RpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string };
}
export interface RpcEvent {
  event: string;
  data: unknown;
}

export type Handlers = Record<
  string,
  (args: never, ctx: { emit: (event: string, data: unknown) => void }) => Promise<unknown> | unknown
>;

export interface Transferred<T> {
  value: T;
  transfer: Transferable[];
}
export function transferred<T>(value: T, transfer: Transferable[]): Transferred<T> {
  return { __transferred: true, value, transfer } as unknown as Transferred<T>;
}
function isTransferred(x: unknown): x is Transferred<unknown> {
  return (
    typeof x === 'object' && x !== null && (x as { __transferred?: boolean }).__transferred === true
  );
}

/** Install handlers inside a worker. */
export function serve(scope: DedicatedWorkerGlobalScope, handlers: Handlers): void {
  scope.onmessage = async (ev: MessageEvent<RpcRequest>) => {
    const { id, method, args } = ev.data;
    const h = handlers[method];
    if (!h) {
      scope.postMessage({
        id,
        ok: false,
        error: { message: `unknown method ${method}` },
      } satisfies RpcResponse);
      return;
    }
    try {
      const r = await h(args as never, {
        emit: (event, data) => scope.postMessage({ event, data } satisfies RpcEvent),
      });
      if (isTransferred(r)) {
        scope.postMessage({ id, ok: true, result: r.value } satisfies RpcResponse, r.transfer);
      } else {
        scope.postMessage({ id, ok: true, result: r } satisfies RpcResponse);
      }
    } catch (e) {
      const err = e as { message?: string; code?: string };
      scope.postMessage({
        id,
        ok: false,
        error: { message: String(err.message ?? e), code: err.code },
      } satisfies RpcResponse);
    }
  };
}

export class RpcError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export class RpcClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Set<(d: never) => void>>();
  constructor(private readonly worker: Worker) {
    worker.onmessage = (ev: MessageEvent<RpcResponse | RpcEvent>) => {
      const m = ev.data;
      if ('event' in m) {
        this.listeners.get(m.event)?.forEach((fn) => fn(m.data as never));
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result as never);
      else p.reject(new RpcError(m.error?.message ?? 'worker error', m.error?.code));
    };
    worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new RpcError(ev.message || 'worker crashed'));
      this.pending.clear();
    };
  }
  call<T>(method: string, args: unknown, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      this.worker.postMessage({ id, method, args } satisfies RpcRequest, transfer);
    });
  }
  on<T>(event: string, fn: (d: T) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as (d: never) => void);
    return () => set.delete(fn as (d: never) => void);
  }
  terminate(): void {
    this.worker.terminate();
  }
}
