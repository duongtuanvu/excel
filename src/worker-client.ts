import type { Request, Requests, Response } from './protocol';

export class EngineClient {
  private worker = new Worker(new URL('./report.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 0;
  private failure: Error | null = null;
  constructor() {
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const msg = event.data;
      const task = this.pending.get(msg.id);
      if (!task) return;
      this.pending.delete(msg.id);
      if (msg.ok) task.resolve(msg.data);
      else task.reject(new Error(msg.error));
    };
    this.worker.onerror = (event) => this.fail(new Error(event.message || 'Không khởi tạo được bộ xử lý dữ liệu. Hãy tải lại trang.'));
    this.worker.onmessageerror = () => this.fail(new Error('Lỗi truyền dữ liệu từ worker.'));
  }
  private fail(error: Error) {
    this.failure = error;
    this.pending.forEach(task => task.reject(error));
    this.pending.clear();
    this.worker.terminate();
  }
  request<K extends keyof Requests>(type: K, input: Requests[K]['input'], transfer: Transferable[] = []): Promise<Requests[K]['output']> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<Requests[K]['output']>((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: value => resolve(value as Requests[K]['output']), reject });
      try { this.worker.postMessage({ id, type, input } as Request, transfer); }
      catch (e) { this.pending.delete(id); reject(e); }
    });
  }
  close() { this.fail(new Error('Bộ xử lý đã đóng.')); }
}
