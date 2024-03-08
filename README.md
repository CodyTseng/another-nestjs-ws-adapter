# Another NestJS WS Adapter

An adapter modified based on the official [`WsAdapter`](https://docs.nestjs.com/websockets/adapter#ws-library).

## Differences from the official `WsAdapter`

- Support any format of message, you can pre-process the message before finding the handler. The official `WsAdapter` only supports messages in the format of `{ "event": string, "data": any }`.

## Installation

```bash
npm install another-nestjs-ws-adapter
```

## Usage

```typescript
const app = await NestFactory.create(AppModule);

// The default behavior is same as the official `WsAdapter`
const wsAdapter = new WsAdapter(app);

// If you want to handle the message in a different format, you can set the message pre-processor like this.
wsAdapter.setMessagePreprocessor((message: any) => {
  const [event, ...data] = message;
  return { event, data };
});

app.useWebSocketAdapter(wsAdapter);
```

## API

### `setMessagePreprocessor`

```typescript
type MessagePreprocessor = (message: any, client: WebSocket) => { event: string, data: any } | void;
setMessagePreprocessor(preprocessor: MessagePreprocessor): void;
```

Set the message pre-processor. The pre-processor will be called before finding the handler. If the pre-processor returns `void`, the message will be ignored. Otherwise, the message will be processed by the pre-processor and the result should be in the format of `{ event: string, data: any }`. The `client` parameter is the WebSocket client that sends the message.

## License

MIT
