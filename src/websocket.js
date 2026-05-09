'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');

const WS_URL = 'wss://api.shoonya.com/NorenWSAPI/';
const PING_INTERVAL_MS = 3000;

class ShoonyaWebSocket extends EventEmitter {
  /**
   * @param {import('./client').ShoonyaClient} client - An authenticated ShoonyaClient instance
   * @param {object}  [options]
   * @param {string}  [options.wsUrl]          - Override WebSocket URL
   * @param {boolean} [options.reconnect]      - Auto-reconnect on drop (default: true)
   * @param {number}  [options.reconnectDelay] - Milliseconds between reconnect attempts (default: 3000)
   */
  constructor(client, { wsUrl = WS_URL, reconnect = true, reconnectDelay = 3000 } = {}) {
    super();
    this._client = client;
    this._wsUrl = wsUrl;
    this._reconnect = reconnect;
    this._reconnectDelay = reconnectDelay;

    this._ws = null;
    this._connected = false;
    this._closing = false;
    this._pingTimer = null;

    // Track subscriptions so they survive reconnects
    this._touchlineSubs = new Set(); // "NSE|22"
    this._depthSubs = new Set();     // "NSE|22"
    this._orderSubActid = null;
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  connect() {
    this._closing = false;
    this._openSocket();
  }

  disconnect() {
    this._closing = true;
    this._connected = false;
    this._stopPing();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  _openSocket() {
    const ws = new WebSocket(this._wsUrl);
    this._ws = ws;

    ws.on('open', () => {
      const { accessToken, uid, actid } = this._client.getSession();
      // Connect message: t='a', token field is 'accesstoken'
      this._send({ t: 'a', uid, actid, source: 'API', accesstoken: accessToken });
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this._handleMessage(msg);
    });

    ws.on('close', () => {
      this._connected = false;
      this._stopPing();
      this.emit('close');
      if (!this._closing && this._reconnect) {
        setTimeout(() => this._openSocket(), this._reconnectDelay);
      }
    });

    ws.on('error', (err) => this.emit('error', err));
  }

  // ---------------------------------------------------------------------------
  // Message router
  // ---------------------------------------------------------------------------

  _handleMessage(msg) {
    switch (msg.t) {
      // 'ak' is the OAuth flow ack; 'ck' is the legacy login ack — handle both
      case 'ak':
      case 'ck':
        if (msg.s === 'OK') {
          this._connected = true;
          this._startPing();
          this._resubscribeAll();
          this.emit('connected', msg);
        } else {
          this.emit('error', new Error(`WebSocket auth failed: ${msg.emsg || msg.s}`));
        }
        break;

      case 'tk':  // touchline ack
      case 'tf':  // touchline feed update
        this.emit('touchline', msg);
        break;

      case 'dk':  // depth ack
      case 'df':  // depth feed update
        this.emit('depth', msg);
        break;

      case 'ok':  // order update subscription ack
      case 'om':  // order update feed
        this.emit('order', msg);
        break;

      case 'uk':  // unsubscribe touchline ack
        this.emit('touchlineUnsubscribed', msg);
        break;

      case 'udk': // unsubscribe depth ack
        this.emit('depthUnsubscribed', msg);
        break;

      case 'uok': // unsubscribe order update ack
        this.emit('orderUnsubscribed', msg);
        break;

      default:
        this.emit('message', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to touchline (LTP + top-of-book) for one or more scrips.
   *
   * @param {string|string[]|{exch:string,token:string}[]} scrips
   *   "NSE|22"  |  ["NSE|22","BSE|508123"]  |  [{exch:"NSE",token:"22"}]
   */
  subscribeTouchline(scrips) {
    const list = this._normalize(scrips);
    list.forEach(s => this._touchlineSubs.add(s));
    if (this._connected) {
      this._send({ t: 't', k: list.join('#') });
    }
  }

  /** @param {string|string[]|{exch:string,token:string}[]} scrips */
  unsubscribeTouchline(scrips) {
    const list = this._normalize(scrips);
    list.forEach(s => this._touchlineSubs.delete(s));
    if (this._connected) {
      this._send({ t: 'u', k: list.join('#') });
    }
  }

  /**
   * Subscribe to full market depth (5-level order book) for one or more scrips.
   *
   * @param {string|string[]|{exch:string,token:string}[]} scrips
   */
  subscribeDepth(scrips) {
    const list = this._normalize(scrips);
    list.forEach(s => this._depthSubs.add(s));
    if (this._connected) {
      this._send({ t: 'd', k: list.join('#') });
    }
  }

  /** @param {string|string[]|{exch:string,token:string}[]} scrips */
  unsubscribeDepth(scrips) {
    const list = this._normalize(scrips);
    list.forEach(s => this._depthSubs.delete(s));
    if (this._connected) {
      this._send({ t: 'ud', k: list.join('#') });
    }
  }

  /**
   * Subscribe to order update feed for the logged-in account.
   * @param {string} [actid] - Defaults to the actid stored in the client session
   */
  subscribeOrderUpdates(actid) {
    this._orderSubActid = actid || this._client.getSession().actid;
    if (this._connected) {
      this._send({ t: 'o', actid: this._orderSubActid });
    }
  }

  unsubscribeOrderUpdates() {
    const actid = this._orderSubActid;
    this._orderSubActid = null;
    if (this._connected) {
      this._send({ t: 'uo', actid });
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _resubscribeAll() {
    if (this._touchlineSubs.size > 0) {
      this._send({ t: 't', k: [...this._touchlineSubs].join('#') });
    }
    if (this._depthSubs.size > 0) {
      this._send({ t: 'd', k: [...this._depthSubs].join('#') });
    }
    if (this._orderSubActid) {
      this._send({ t: 'o', actid: this._orderSubActid });
    }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send('{"t":"h"}');
      }
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  // WebSocket messages are raw JSON strings (no 'jData=' prefix — that's REST only)
  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  _normalize(scrips) {
    const arr = Array.isArray(scrips) ? scrips : [scrips];
    return arr.map(s => (typeof s === 'string' ? s : `${s.exch}|${s.token}`));
  }
}

module.exports = { ShoonyaWebSocket };
