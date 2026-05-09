# shoonya-api-js

Node.js SDK for the [Shoonya](https://shoonya.com) trading API.

- Full REST API coverage — auth, watchlists, market data, orders, positions, holdings
- WebSocket live feed — touchline, full depth, order updates
- Auto-reconnect with subscription replay
- Zero dependencies beyond `ws`

## Requirements

Node.js 18+

## Installation

```bash
npm install shoonya-api-js
```

---

## Quick start

```js
const { ShoonyaClient, ShoonyaWebSocket } = require('shoonya-api-js');

const client = new ShoonyaClient();

// 1. Authenticate
const checksum = ShoonyaClient.generateChecksum(CLIENT_ID, SECRET, code);
await client.generateAccessToken({ code, checksum });

// 2. REST calls — token is injected automatically
const positions = await client.getPositionBook();

// 3. WebSocket live feed
const ws = new ShoonyaWebSocket(client);
ws.on('connected', () => ws.subscribeTouchline('NSE|2885'));
ws.on('touchline', (tick) => console.log(tick.lp));
ws.connect();
```

---

## Authentication

Shoonya uses an OAuth-style code flow:

1. Redirect the user to the Shoonya login page.
2. On success, Shoonya redirects back with a `code` in the URL query string.
3. Generate a checksum: `SHA-256(clientId + secretCode + code)`.
4. Call `generateAccessToken` — the client stores the token for all future requests.

```js
const { ShoonyaClient } = require('shoonya-api-js');

const client = new ShoonyaClient();

const checksum = ShoonyaClient.generateChecksum('YOUR_CLIENT_ID', 'YOUR_SECRET', code);
const session  = await client.generateAccessToken({ code, checksum });

console.log(session.access_token); // save for session restore
console.log(session.expires_in);
```

### Restore a saved session

To restore a full session including `uid` and `actid`:

```js
client.setSession({
  accessToken: 'ea97cd3f...',
  uid:         'MYUSERID',
  actid:       'MYACCOUNT',
});
```

```js
const { accessToken, uid, actid } = client.getSession();
```

### Logout

```js
await client.logout();
```

---

## User & account

```js
const user    = await client.getUserDetails();   // exchanges, products, etc.
const profile = await client.getClientDetails(); // bank details, DP accounts, etc.
```

---

## Watch lists

```js
// List all watchlist names
const { values } = await client.getWatchlistNames();

// Scrips in a watchlist
const watchlist = await client.getWatchlist('default');

// Search
const results = await client.searchScrip({ stext: 'RELIANCE' });
const nseOnly  = await client.searchScrip({ stext: 'INFY', exch: 'NSE' });

// Add scrips  (format: "EXCH|TOKEN#EXCH|TOKEN")
await client.addScripsToWatchlist({ wlname: 'default', scrips: 'NSE|2885#BSE|500325' });

// Reorder
await client.reorderWatchlistScrips({ wlname: 'default', scrips: 'BSE|500325#NSE|2885' });

// Delete
await client.deleteScripsFromWatchlist({ wlname: 'default', scrips: 'NSE|2885' });

// Rename
await client.renameWatchlist({ wlname: 'default', newwlname: 'MyStocks' });
```

---

## Market data

```js
const info  = await client.getSecurityInfo({ exch: 'NSE', token: '2885' });
const quote = await client.getQuotes({ exch: 'NSE', token: '2885' });

console.log(quote.lp);   // last traded price
console.log(quote.bp1);  // best bid
console.log(quote.sp1);  // best ask
```

---

## Orders

### Place

```js
const { norenordno } = await client.placeOrder({
  exch:     'NSE',
  tsym:     'RELIANCE-EQ',
  qty:      '1',
  prc:      '2500.00',
  prd:      'I',       // I = Intraday  C = Delivery  M = Margin  H = High-leverage  B = Bracket
  trantype: 'B',       // B = Buy  S = Sell
  prctyp:   'LMT',     // LMT  SL-LMT  DS  2L  3L
  ret:      'DAY',     // DAY  IOC  EOS
});
```

**Optional fields:**

| Field | Description |
|---|---|
| `trgprc` | Trigger price — required for SL-LMT |
| `dscqty` | Disclosed quantity |
| `amo` | `"Yes"` for after-market order |
| `bpprc` | Book profit price (Bracket orders) |
| `blprc` | Book loss price (Bracket / High-leverage) |
| `trailprc` | Trailing price (Bracket / High-leverage) |
| `remarks` | User tag attached to the order |

### Modify

```js
await client.modifyOrder({
  exch:       'NSE',
  tsym:       'RELIANCE-EQ',
  norenordno: '20052600000103',
  prctyp:     'LMT',
  prc:        '2450.00',
  qty:        '1',
});
```

### Cancel

```js
await client.cancelOrder({ norenordno: '20052600000103' });
```

### Order margin

```js
const margin = await client.getOrderMargin({
  exch: 'NSE', tsym: 'RELIANCE-EQ',
  qty: '10', prc: '2500.00',
  prd: 'I', trantype: 'B', prctyp: 'LMT',
});
console.log(margin.remarks);     // "Order Success" or "Insufficient Balance"
console.log(margin.ordermargin); // margin required
```

### Basket margin

```js
const basket = await client.getBasketMargin({
  exch: 'NSE', tsym: 'RELIANCE-EQ',
  qty: '10', prc: '2500.00',
  prd: 'I', trantype: 'B', prctyp: 'LMT',
  basketlists: [
    { exch: 'NSE', tsym: 'INFY-EQ', qty: '5', prc: '1500.00', prd: 'I', trantype: 'B', prctyp: 'LMT' },
  ],
});
```

---

## Order book & trade book

```js
const orders       = await client.getOrderBook();           // all today's orders
const intradayOrds = await client.getOrderBook({ prd: 'I' });

const history      = await client.getSingleOrderHistory('20121300065716');
const [status]     = await client.getSingleOrderStatus({ norenordno: '20121300065716', exch: 'NSE' });
console.log(status.status); // OPEN  COMPLETE  REJECTED  CANCELED

const trades       = await client.getTradeBook();
```

---

## Positions

```js
const positions = await client.getPositionBook();
for (const pos of positions) {
  console.log(pos.tsym, pos.netqty, pos.lp);
}

const interop = await client.getInteropPositionBook();

// Convert Intraday → Delivery
await client.convertProduct({
  exch: 'NSE', tsym: 'RELIANCE-EQ', qty: '1',
  prd: 'C', prevprd: 'I', trantype: 'B', postype: 'Day',
});
```

---

## Holdings & limits

```js
const holdings = await client.getHoldings({ prd: 'C' });

const limits   = await client.getLimits();
console.log(limits.cash);       // available cash
console.log(limits.marginused); // margin used today

const derLimits  = await client.getLimits({ seg: 'DER' });
const subLimits  = await client.getSubLimits();
const { payout } = await client.getMaxPayoutAmount();
```

---

## Error handling

All API failures (HTTP errors and `stat: 'Not_Ok'` responses) throw `ShoonyaApiError`.

```js
const { ShoonyaClient, ShoonyaApiError } = require('shoonya-api-js');

try {
  await client.placeOrder({ /* ... */ });
} catch (err) {
  if (err instanceof ShoonyaApiError) {
    console.error(err.message);   // "Session Expired : Invalid Session Key"
    console.error(err.response);  // raw API response object
  } else {
    throw err; // network or unexpected error
  }
}
```

---

## WebSocket — live market data

`ShoonyaWebSocket` connects to `wss://api.shoonya.com/NorenWSAPI/`. It extends `EventEmitter` and automatically re-authenticates and re-subscribes all active feeds if the connection drops.

### Setup

```js
const { ShoonyaClient, ShoonyaWebSocket } = require('shoonya-api-js');

const client = new ShoonyaClient();
await client.generateAccessToken({ code, checksum });

const ws = new ShoonyaWebSocket(client);
```

**Constructor options:**

| Option | Default | Description |
|---|---|---|
| `wsUrl` | `wss://api.shoonya.com/NorenWSAPI/` | Override WebSocket URL |
| `reconnect` | `true` | Auto-reconnect on drop |
| `reconnectDelay` | `3000` | Ms between reconnect attempts |

### Connect & disconnect

```js
ws.connect();    // opens socket and authenticates
ws.disconnect(); // closes cleanly, disables auto-reconnect
```

A keepalive heartbeat (`{"t":"h"}`) is sent automatically every 3 seconds after authentication — no setup required.

### Events

| Event | Fired when |
|---|---|
| `connected` | Auth ack received (`t:'ak'` OAuth flow or `t:'ck'` legacy) — safe to subscribe |
| `touchline` | Touchline ack (`t:'tk'`) or live update (`t:'tf'`) |
| `depth` | Depth ack (`t:'dk'`) or live update (`t:'df'`) |
| `order` | Order sub ack (`t:'ok'`) or order event (`t:'om'`) |
| `touchlineUnsubscribed` | Unsubscribe touchline ack (`t:'uk'`) |
| `depthUnsubscribed` | Unsubscribe depth ack (`t:'udk'`) |
| `orderUnsubscribed` | Unsubscribe order feed ack (`t:'uok'`) |
| `error` | Network or auth error |
| `close` | Connection closed |

```js
ws.on('connected', () => console.log('Ready'));

ws.on('touchline', (tick) => {
  console.log(tick.e, tick.tk, tick.lp);  // exchange, token, LTP
});

ws.on('depth', (tick) => {
  console.log(tick.bp1, tick.sp1);        // best bid / ask
});

ws.on('order', (msg) => {
  if (msg.t === 'om') {
    console.log(msg.norenordno, msg.status, msg.reporttype);
  }
});

ws.on('error', console.error);
ws.on('close', () => console.log('Disconnected'));
```

### Touchline feed

Receives LTP, OHLC, volume, top-of-book bid/ask, and open interest.

Scrips can be passed as a string, array of strings, or array of `{exch, token}` objects — all three forms work for every subscribe/unsubscribe method.

```js
ws.subscribeTouchline('NSE|2885');
ws.subscribeTouchline(['NSE|2885', 'NSE|1594', 'BSE|508123']);
ws.subscribeTouchline([{ exch: 'NSE', token: '2885' }]);

ws.unsubscribeTouchline('NSE|2885');
ws.unsubscribeTouchline(['NSE|2885', 'BSE|508123']);
```

Sample payload (`t:'tf'`):

```json
{
  "t":  "tf",
  "e":  "NSE",
  "tk": "2885",
  "lp": "2450.00",
  "pc": "1.23",
  "v":  "1234567",
  "o":  "2400.00",
  "h":  "2460.00",
  "l":  "2390.00",
  "c":  "2420.50",
  "ap": "2435.20",
  "bp1":"2449.95",
  "sp1":"2450.00",
  "bq1":"100",
  "sq1":"200",
  "oi": "12345",
  "poi":"11000"
}
```

### Depth feed

Receives 5-level bid/ask ladder, circuit limits, and open interest.

```js
ws.subscribeDepth('NSE|2885');
ws.subscribeDepth(['NSE|2885', 'NFO|35000']);

ws.unsubscribeDepth('NSE|2885');
```

Sample payload (`t:'df'`):

```json
{
  "t":   "df",
  "e":   "NSE",
  "tk":  "22",
  "lp":  "1156.50",
  "tbq": "120952",
  "tsq": "113700",
  "bp1": "1156.00", "bq1": "42",  "bo1": "3",
  "bp2": "1155.80", "bq2": "67",  "bo2": "5",
  "bp3": "1155.70", "bq3": "83",  "bo3": "2",
  "bp4": "1155.65", "bq4": "139", "bo4": "8",
  "bp5": "1155.60", "bq5": "393", "bo5": "12",
  "sp1": "1156.80", "sq1": "17",  "so1": "2",
  "sp2": "1157.00", "sq2": "63",  "so2": "4",
  "sp3": "1157.20", "sq3": "53",  "so3": "3",
  "sp4": "1157.50", "sq4": "33",  "so4": "1",
  "sp5": "1158.00", "sq5": "94",  "so5": "7",
  "lc":  "1040.85",
  "uc":  "1272.25",
  "oi":  "123456"
}
```

### Order update feed

Receive real-time fills, rejections, modifications, and cancellations for the account.

```js
ws.subscribeOrderUpdates();            // uses actid from client session
ws.subscribeOrderUpdates('MYACCOUNT'); // or explicit actid

ws.unsubscribeOrderUpdates();
```

Sample payload (`t:'om'`):

```json
{
  "t":          "om",
  "norenordno": "20052600000103",
  "uid":        "MYUSER",
  "actid":      "MYACCOUNT",
  "exch":       "NSE",
  "tsym":       "RELIANCE-EQ",
  "qty":        "10",
  "prc":        "2500.00",
  "prd":        "I",
  "status":     "COMPLETE",
  "reporttype": "Fill",
  "trantype":   "B",
  "prctyp":     "LMT",
  "ret":        "DAY",
  "fillshares": "10",
  "avgprc":     "2498.50",
  "flqty":      "10",
  "flprc":      "2498.50",
  "flid":       "101",
  "filltm":     "10:32:15",
  "exchorderid":"1234567890"
}
```

`reporttype` values: `New`, `Fill`, `Replaced`, `Canceled`, `Rejected`.

### Full example

```js
const { ShoonyaClient, ShoonyaWebSocket } = require('shoonya-api-js');

async function main() {
  const client = new ShoonyaClient();
  const checksum = ShoonyaClient.generateChecksum(CLIENT_ID, SECRET, code);
  await client.generateAccessToken({ code, checksum });

  const ws = new ShoonyaWebSocket(client, { reconnect: true });

  ws.on('connected', () => {
    ws.subscribeTouchline(['NSE|2885', 'NSE|1594']); // RELIANCE, INFOSYS
    ws.subscribeDepth('NSE|2885');
    ws.subscribeOrderUpdates();
  });

  ws.on('touchline', (tick) => {
    console.log(`[${tick.e}|${tick.tk}] LTP: ${tick.lp}  Chg: ${tick.pc}%`);
  });

  ws.on('depth', (tick) => {
    console.log(`[${tick.e}|${tick.tk}] Bid: ${tick.bp1} × ${tick.bq1}  Ask: ${tick.sp1} × ${tick.sq1}`);
  });

  ws.on('order', (msg) => {
    if (msg.t === 'om') {
      console.log(`Order ${msg.norenordno}: ${msg.status} (${msg.reporttype})`);
    }
  });

  ws.on('error', console.error);
  ws.connect();
}

main();
```

### Runnable WebSocket test script

Copy this into `test_websocket.js` and run with `node test_websocket.js`. It mirrors the Python `test_websocket_feed.py` example from the Shoonya reference repo.

```js
// test_websocket.js
const { ShoonyaClient, ShoonyaWebSocket } = require('shoonya-api-js');

// ── Credentials ──────────────────────────────────────────────────────────────
// Fill these in from your broker dashboard / cred.yml equivalent
const ACCESS_TOKEN = 'your_access_token_here';
const UID          = 'YOUR_USER_ID';
const ACCOUNT_ID   = 'YOUR_ACCOUNT_ID';

// ── Scrips to watch (exchange|token) ─────────────────────────────────────────
// NSE|11630 = HDFC Bank, NSE|22 = ACC, BSE|522032 = ACC on BSE
const TOUCHLINE_SCRIPS = ['NSE|11630', 'NSE|22'];
const DEPTH_SCRIP      = 'NSE|11630';

// ── Symbol map so callbacks print a friendly name ─────────────────────────────
const SYMBOL_DICT = {}; // keyed by "EXCH|TOKEN"

// ── Callbacks ─────────────────────────────────────────────────────────────────
function onConnected() {
  console.log('[ws] connected — subscribing feeds');
  ws.subscribeTouchline(TOUCHLINE_SCRIPS);
  ws.subscribeDepth(DEPTH_SCRIP);
  ws.subscribeOrderUpdates();
}

function onTouchline(msg) {
  // msg fields:
  //   e   exchange       tk  token
  //   lp  LTP            pc  % change
  //   v   volume         o   open
  //   h   high           l   low
  //   c   close          ap  avg trade price
  //   bp1 best bid       sp1 best ask
  //   ft  feed timestamp (Unix seconds)
  const key = `${msg.e}|${msg.tk}`;

  if (SYMBOL_DICT[key]) {
    Object.assign(SYMBOL_DICT[key], msg); // merge partial updates
  } else {
    SYMBOL_DICT[key] = { ...msg };
  }

  const ts = msg.ft ? new Date(msg.ft * 1000).toLocaleTimeString() : '';
  console.log(`[touchline] ${key}  LTP=${msg.lp}  chg=${msg.pc}%  vol=${msg.v}  ${ts}`);
}

function onDepth(msg) {
  // msg fields:
  //   bp1–bp5  bid prices     bq1–bq5  bid quantities
  //   sp1–sp5  ask prices     sq1–sq5  ask quantities
  //   tbq      total bid qty  tsq      total ask qty
  //   lc       lower circuit  uc       upper circuit
  const key = `${msg.e}|${msg.tk}`;
  console.log(
    `[depth]     ${key}  bid=${msg.bp1}×${msg.bq1}  ask=${msg.sp1}×${msg.sq1}` +
    `  totalBid=${msg.tbq}  totalAsk=${msg.tsq}`
  );
}

function onOrder(msg) {
  // msg.t === 'ok'  → subscription ack
  // msg.t === 'om'  → live order event
  //   norenordno  status  reporttype  fillshares  avgprc
  if (msg.t === 'om') {
    console.log(`[order] ${msg.norenordno}  ${msg.status}  ${msg.reporttype}`);
  } else {
    console.log('[order] subscribed to order feed');
  }
}

function onError(err) {
  console.error('[ws] error:', err.message);
}

function onClose() {
  console.log('[ws] disconnected');
}

// ── Setup ─────────────────────────────────────────────────────────────────────
const client = new ShoonyaClient();
client.setSession({ accessToken: ACCESS_TOKEN, uid: UID, actid: ACCOUNT_ID });

const ws = new ShoonyaWebSocket(client, { reconnect: true, reconnectDelay: 3000 });

ws.on('connected', onConnected);
ws.on('touchline',  onTouchline);
ws.on('depth',      onDepth);
ws.on('order',      onOrder);
ws.on('error',      onError);
ws.on('close',      onClose);

ws.connect();
console.log('[ws] connecting…');

// ── Graceful shutdown on Ctrl-C ───────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[ws] shutting down');
  ws.disconnect();
  process.exit(0);
});
```

**Expected output** once connected:

```
[ws] connecting…
[ws] connected — subscribing feeds
[touchline] NSE|11630  LTP=1723.45  chg=0.82%  vol=3421900  14:23:01
[depth]     NSE|11630  bid=1723.40×150  ask=1723.50×200  totalBid=982340  totalAsk=876120
[touchline] NSE|22     LTP=2198.00  chg=-0.34%  vol=87234   14:23:02
[order] subscribed to order feed
```

---

## Custom base URL

```js
const client = new ShoonyaClient({ baseUrl: 'https://api.shoonya.com' });
const ws     = new ShoonyaWebSocket(client, { wsUrl: 'wss://api.shoonya.com/NorenWSAPI/' });
```

---

## API reference

### REST — `ShoonyaClient`

| Method | Endpoint |
|---|---|
| `generateAccessToken({ code, checksum })` | `POST /NorenWClientAPI/GenAcsTok` |
| `logout()` | `POST /NorenWClientTP/Logout` |
| `getUserDetails()` | `POST /NorenWClientAPI/UserDetails` |
| `getClientDetails()` | `POST /NorenWClientAPI/ClientDetails` |
| `getWatchlistNames()` | `POST /NorenWClientAPI/MWList` |
| `getWatchlist(wlname)` | `POST /NorenWClientAPI/MarketWatch` |
| `searchScrip({ stext, exch? })` | `POST /NorenWClientAPI/SearchScrip` |
| `addScripsToWatchlist({ wlname, scrips })` | `POST /NorenWClientAPI/AddMultiScripsToMW` |
| `reorderWatchlistScrips({ wlname, scrips })` | `POST /NorenWClientAPI/ReorderMWScrips` |
| `deleteScripsFromWatchlist({ wlname, scrips })` | `POST /NorenWClientAPI/DeleteMultiMWScrips` |
| `renameWatchlist({ wlname, newwlname })` | `POST /NorenWClientAPI/RenameMW` |
| `getSecurityInfo({ exch, token })` | `POST /NorenWClientAPI/GetSecurityInfo` |
| `getQuotes({ exch, token })` | `POST /NorenWClientAPI/GetQuotes` |
| `placeOrder({ exch, tsym, qty, prc, prd, trantype, prctyp, ret, ... })` | `POST /NorenWClientAPI/PlaceOrder` |
| `modifyOrder({ exch, norenordno, prctyp, prc, qty, tsym, ... })` | `POST /NorenWClientAPI/ModifyOrder` |
| `cancelOrder({ norenordno, ... })` | `POST /NorenWClientAPI/CancelOrder` |
| `getOrderMargin({ exch, tsym, qty, prc, prd, trantype, prctyp, ... })` | `POST /NorenWClientAPI/GetOrderMargin` |
| `getBasketMargin({ ..., basketlists? })` | `POST /NorenWClientAPI/GetBasketMargin` |
| `getBasketOptSeq({ exch, trantype, prd, tsym, qty, prc, prctyp, ... })` | `POST /NorenWClient/GetBasketOptSeq` |
| `getOrderBook({ prd? })` | `POST /NorenWClientAPI/OrderBook` |
| `getSingleOrderHistory(norenordno)` | `POST /NorenWClientAPI/SingleOrdHist` |
| `getSingleOrderStatus({ norenordno, exch? })` | `POST /NorenWClientAPI/SingleOrdStatus` |
| `getTradeBook()` | `POST /NorenWClientAPI/TradeBook` |
| `getPositionBook()` | `POST /NorenWClientAPI/PositionBook` |
| `getInteropPositionBook()` | `POST /NorenWClientAPI/InteropPositionBook` |
| `convertProduct({ exch, tsym, qty, prd, prevprd, trantype, postype })` | `POST /NorenWClientAPI/ProductConversion` |
| `getHoldings({ prd? })` | `POST /NorenWClientAPI/Holdings` |
| `getLimits({ prd?, seg?, exch? })` | `POST /NorenWClientAPI/Limits` |
| `getSubLimits()` | `POST /NorenWClientAPI/GetSubLimits` |
| `getMaxPayoutAmount({ seg?, exch?, prd? })` | `POST /NorenWClientAPI/GetMaxPayoutAmount` |

### WebSocket — `ShoonyaWebSocket`

| Method | Description |
|---|---|
| `connect()` | Open connection and authenticate |
| `disconnect()` | Close connection, disable auto-reconnect |
| `subscribeTouchline(scrips)` | Subscribe to LTP + top-of-book feed |
| `unsubscribeTouchline(scrips)` | Unsubscribe touchline |
| `subscribeDepth(scrips)` | Subscribe to 5-level order book feed |
| `unsubscribeDepth(scrips)` | Unsubscribe depth |
| `subscribeOrderUpdates([actid])` | Subscribe to account order events |
| `unsubscribeOrderUpdates()` | Unsubscribe order events |
