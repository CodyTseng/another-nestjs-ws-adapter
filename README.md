# Another NestJS WS Adapter

An adapter modified based on the official `WsAdapter`.

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

## License

MIT
