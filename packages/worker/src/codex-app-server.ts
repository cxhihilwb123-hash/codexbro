import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type JsonRpcId = number | string;

export interface CodexAppServerMessage {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface CodexAppServerClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  requestTimeoutMs?: number;
  onNotification?: (message: CodexAppServerMessage) => void | Promise<void>;
  onServerRequest?: (message: Required<Pick<CodexAppServerMessage, "id" | "method">> & { params?: unknown }) => Promise<unknown>;
  onStderr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export type CodexAppServerClientHandlers = Pick<
  CodexAppServerClientOptions,
  "onNotification" | "onServerRequest" | "onStderr" | "onExit"
>;

interface PendingRequest<T> {
  method: string;
  timer: NodeJS.Timeout;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class CodexAppServerClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest<unknown>>();
  private readonly requestTimeoutMs: number;
  private handlers: CodexAppServerClientHandlers;

  constructor(private readonly options: CodexAppServerClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.handlers = options;
  }

  setHandlers(handlers: CodexAppServerClientHandlers) {
    this.handlers = handlers;
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.stdin.writable);
  }

  async start() {
    if (this.child) return;
    const child = spawn(this.options.command, this.options.args ?? ["app-server"], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        RUST_LOG: process.env.RUST_LOG ?? "warn",
        ...(this.options.env ?? {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.handlers.onStderr?.(chunk.toString());
    });
    child.on("close", (code, signal) => {
      for (const [id, request] of this.pending) {
        clearTimeout(request.timer);
        request.reject(new Error(`codex app-server exited before ${request.method} completed.`));
        this.pending.delete(id);
      }
      this.handlers.onExit?.(code, signal);
    });
    child.on("error", (error) => {
      for (const [id, request] of this.pending) {
        clearTimeout(request.timer);
        request.reject(error);
        this.pending.delete(id);
      }
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codexbro-worker",
        title: "CodexBro Worker",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.notify("initialized", {});
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = this.requestTimeoutMs) {
    const child = this.requireChild();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        timer,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method: string, params?: unknown) {
    const child = this.requireChild();
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id: JsonRpcId, result: unknown) {
    const child = this.requireChild();
    child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id: JsonRpcId, code: number, message: string) {
    const child = this.requireChild();
    child.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  }

  destroy() {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 3000).unref();
  }

  private requireChild() {
    if (!this.child?.stdin.writable) {
      throw new Error("codex app-server is not running.");
    }
    return this.child;
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: CodexAppServerMessage;
    try {
      message = JSON.parse(trimmed) as CodexAppServerMessage;
    } catch {
      this.handlers.onStderr?.(`Unparseable codex app-server line: ${trimmed.slice(0, 500)}`);
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      this.handleResponse(message);
      return;
    }

    if (message.id !== undefined && message.method) {
      void this.handleServerRequest(message as Required<Pick<CodexAppServerMessage, "id" | "method">> & { params?: unknown });
      return;
    }

    if (message.method) {
      void this.handlers.onNotification?.(message);
    }
  }

  private handleResponse(message: CodexAppServerMessage) {
    const request = message.id === undefined ? undefined : this.pending.get(message.id);
    if (!request || message.id === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      request.reject(new Error(`${request.method} failed: ${message.error.message}`));
      return;
    }
    request.resolve(message.result);
  }

  private async handleServerRequest(message: Required<Pick<CodexAppServerMessage, "id" | "method">> & { params?: unknown }) {
    if (!this.handlers.onServerRequest) {
      this.respondError(message.id, -32601, `Unsupported server request: ${message.method}`);
      return;
    }

    try {
      const result = await this.handlers.onServerRequest(message);
      this.respond(message.id, result ?? {});
    } catch (error) {
      this.respondError(message.id, -32000, error instanceof Error ? error.message : String(error));
    }
  }
}
