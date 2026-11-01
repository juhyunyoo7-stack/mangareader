import { RpcClient } from './rpc.ts';

let importClient: RpcClient | undefined;

export function getImportWorker(): RpcClient {
  importClient ??= new RpcClient(
    new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module', name: 'import' }),
  );
  return importClient;
}
