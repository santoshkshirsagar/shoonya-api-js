# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test          # Run basic smoke tests (node test/basic.test.js)
npm install       # Install dependencies (only `ws` package)
```

No build step — this is vanilla JavaScript.

## Architecture

Three modules, three exports:

- **[src/client.js](src/client.js)** — `ShoonyaClient`: REST API client with 40+ trading methods (auth, orders, positions, holdings, market data, watchlists). Stores `accessToken`, `uid`, and `actid` on itself after login and injects them automatically into subsequent requests. Failed requests (HTTP errors or `stat: 'Not_Ok'` in response body) throw `ShoonyaApiError`.

- **[src/websocket.js](src/websocket.js)** — `ShoonyaWebSocket`: Extends `EventEmitter`. Manages a live WebSocket feed with auto-reconnect; replays subscriptions from internal `Set`s after reconnection. Emits named events: `touchline`, `depth`, `order`, `error`, `disconnect`. Accepts scrips as a string `"NSE|2885"`, an array of strings, or an array of `{exch, token}` objects — normalizes all formats internally.

- **[src/index.js](src/index.js)** — re-exports `ShoonyaClient`, `ShoonyaApiError`, `ShoonyaWebSocket`.

### Key patterns

- `ShoonyaClient._pick(obj)` strips `undefined`/`null` before sending payloads — use it whenever building request bodies.
- `ShoonyaClient.generateChecksum(clientId, secret, code)` is a static helper for the OAuth code-exchange flow.
- Tests use Node's built-in `assert` module; no test framework. Run a single test file with `node test/<file>`.
- No TypeScript, no linter, no formatter configured.
