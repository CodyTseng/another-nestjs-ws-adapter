import { INestApplicationContext, Logger } from '@nestjs/common';
import { AbstractWsAdapter } from '@nestjs/websockets';
import { MessageMappingProperties } from '@nestjs/websockets/gateway-metadata-explorer';
import * as http from 'http';
import { EMPTY, Observable, fromEvent } from 'rxjs';
import { filter, first, mergeMap, share, takeUntil } from 'rxjs/operators';
import { OPEN, WebSocket, WebSocketServer } from 'ws';

type HttpServerRegistryKey = number;
type HttpServerRegistryEntry = any;
type WsServerRegistryKey = number;
type WsServerRegistryEntry = Map<string, WebSocketServer>;
type MessagePreprocessor = (
  message: any,
  client: WebSocket,
) => { event: string; data: any } | void;

const UNDERLYING_HTTP_SERVER_PORT = 0;

function isNil(value: any): value is null | undefined {
  return value === null || value === undefined;
}

function normalizePath(path?: string): string {
  return path
    ? path.startsWith('/')
      ? ('/' + path.replace(/\/+$/, '')).replace(/\/+/g, '/')
      : '/' + path.replace(/\/+$/, '')
    : '/';
}

/**
 * @publicApi
 */
export class WsAdapter extends AbstractWsAdapter {
  protected readonly logger = new Logger(WsAdapter.name);
  protected readonly httpServersRegistry = new Map<
    HttpServerRegistryKey,
    HttpServerRegistryEntry
  >();
  protected readonly wsServersRegistry = new Map<
    WsServerRegistryKey,
    WsServerRegistryEntry
  >();

  protected messagePreprocessor: MessagePreprocessor = message => message;

  constructor(appOrHttpServer?: INestApplicationContext | any) {
    super(appOrHttpServer);
  }

  public create(
    port: number,
    options: Record<string, any> & {
      namespace?: string;
      path?: string;
    } = {},
  ) {
    const { path, namespace, ...wsOptions } = options;
    if (namespace) {
      const error = new Error(
        '"WsAdapter" does not support namespaces. If you need namespaces in your project, consider using the "@nestjs/platform-socket.io" package instead.',
      );
      this.logger.error(error);
      throw error;
    }

    if (port === UNDERLYING_HTTP_SERVER_PORT && this.httpServer) {
      this.ensureHttpServerExists(port, this.httpServer);
      const wsServer = this.bindErrorHandler(
        new WebSocketServer({
          noServer: true,
          ...wsOptions,
        }),
      );

      this.addWsServerToRegistry(wsServer, port, path);
      return wsServer;
    }

    if (path && port !== UNDERLYING_HTTP_SERVER_PORT) {
      // Multiple servers with different paths
      // sharing a single HTTP/S server running on different port
      // than a regular HTTP application
      const httpServer = this.ensureHttpServerExists(port);
      httpServer?.listen(port);

      const wsServer = this.bindErrorHandler(
        new WebSocketServer({
          noServer: true,
          ...wsOptions,
        }),
      );
      this.addWsServerToRegistry(wsServer, port, path);
      return wsServer;
    }
    return this.bindErrorHandler(
      new WebSocketServer({
        port,
        path,
        ...wsOptions,
      }),
    );
  }

  public bindMessageHandlers(
    client: WebSocket,
    handlers: MessageMappingProperties[],
    transform: (data: any) => Observable<any>,
  ) {
    const handlersMap = new Map<string, MessageMappingProperties>();
    handlers.forEach(handler => handlersMap.set(handler.message, handler));

    const close$ = fromEvent(client, 'close').pipe(share(), first());
    const source$ = fromEvent(client, 'message').pipe(
      mergeMap(data =>
        this.bindMessageHandler(client, data, handlersMap, transform).pipe(
          filter(result => !isNil(result)),
        ),
      ),
      takeUntil(close$),
    );
    const onMessage = (response: any) => {
      if (client.readyState !== OPEN) {
        return;
      }
      client.send(JSON.stringify(response));
    };
    source$.subscribe(onMessage);
  }

  public bindMessageHandler(
    client: WebSocket,
    buffer: any,
    handlersMap: Map<string, MessageMappingProperties>,
    transform: (data: any) => Observable<any>,
  ): Observable<any> {
    try {
      const message = this.messagePreprocessor(JSON.parse(buffer.data), client);
      if (!message) {
        return EMPTY;
      }
      const messageHandler = handlersMap.get(message.event);

      if (!messageHandler) {
        return EMPTY;
      }

      const { callback } = messageHandler;
      return transform(callback(message.data, message.event));
    } catch {
      return EMPTY;
    }
  }

  public bindErrorHandler(server: WebSocketServer) {
    server.on('connection', (ws: any) =>
      ws.on('error', (err: any) => this.logger.error(err)),
    );
    server.on('error', (err: any) => this.logger.error(err));
    return server;
  }

  public bindClientDisconnect(client: any, callback: Function) {
    client.on('close', callback);
  }

  public async close(server: WebSocketServer) {
    const closeEventSignal = new Promise((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve(undefined))),
    );
    for (const ws of server.clients) {
      ws.terminate();
    }
    await closeEventSignal;
  }

  public async dispose() {
    const closeEventSignals = Array.from(this.httpServersRegistry)
      .filter(([port]) => port !== UNDERLYING_HTTP_SERVER_PORT)
      .map(([, server]) => new Promise(resolve => server.close(resolve)));

    await Promise.all(closeEventSignals);
    this.httpServersRegistry.clear();
    this.wsServersRegistry.forEach(entries => entries.clear());
    this.wsServersRegistry.clear();
  }

  public async setMessagePreprocessor(preprocessor: MessagePreprocessor) {
    this.messagePreprocessor = preprocessor;
  }

  protected ensureHttpServerExists(
    port: number,
    httpServer = http.createServer(),
  ) {
    if (this.httpServersRegistry.has(port)) {
      return;
    }
    this.httpServersRegistry.set(port, httpServer);

    httpServer.on('upgrade', (request, socket, head) => {
      try {
        const baseUrl = 'ws://' + request.headers.host + '/';
        const pathname = new URL(normalizePath(request.url), baseUrl).pathname;
        const wsServer = this.wsServersRegistry.get(port)?.get(pathname);

        if (wsServer) {
          wsServer.handleUpgrade(request, socket, head, (ws: unknown) => {
            wsServer.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      } catch (err) {
        socket.end('HTTP/1.1 400\r\n' + err.message);
      }
    });
    return httpServer;
  }

  protected addWsServerToRegistry(
    wsServer: WebSocketServer,
    port: number,
    path?: string,
  ) {
    const entries: WsServerRegistryEntry =
      this.wsServersRegistry.get(port) ?? new Map();

    entries.set(normalizePath(path), wsServer);
    this.wsServersRegistry.set(port, entries);
  }
}
