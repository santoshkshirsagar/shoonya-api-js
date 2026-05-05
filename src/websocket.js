'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');

const WS_URL = 'wss://api.shoonya.com/NorenWSTP/';

/**
 * WebSocket client for Shoonya live market data.
 *
 * Events emitted:
 *   'connected'           – authentication succeeded, ready to subscribe
 *   'touchline'           – touchline ack (t:'tk') or update (t:'tf')
 *   'depth'               – depth ack (t:'dk') or update (t:'df')
 *   'order'               – order update ack (t:'ok') or update (t:'om')
 *   'touchlineUnsubscribed' – unsubscribe touchline ack (t:'uk')
 *   'depthUnsubscribed'   – unsubscribe depth ack (t:'udk')
 *   'orderUnsubscribed'   – unsubscribe order update ack (t:'uok')
 *   'error'               – Error object
 *   'close'               – connection closed
 *
 * @extends EventEmitter
 */
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

    // Track subscriptions so they survive reconnects
    this._touchlineSubs = new Set(); // "NSE|22"
    this._depthSubs = new Set();     // "NSE|22"
    this._orderSubActid = null;      // actid if order updates are subscribed
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
      this._send({ t: 'c', uid, actid, source: 'WEB', usertoken: accessToken });
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this._handleMessage(msg);
    });

    ws.on('close', () => {
      this._connected = false;
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
      case 'ck':
        if (msg.s === 'Ok') {
          this._connected = true;
          this._resubscribeAll();
          this.emit('connected', msg);
        } else {
          this.emit('error', new Error(`WebSocket auth failed (uid: ${msg.uid})`));
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
   *   Accepted formats:
   *     "NSE|22"
   *     ["NSE|22", "BSE|508123"]
   *     [{exch:"NSE", token:"22"}]
   */
  subscribeTouchline(scrips) {
    const list = this._normalize(scrips);
    list.forEach(s => this._touchlineSubs.add(s));
    if (this._connected) {
      this._send({ t: 't', k: list.join('|') });
    }
  }

  /**
   * Unsubscribe from touchline feed for one or more scrips.
   *
   * @param {string|string[]|{exch:string,token:string}[]} scrips
   */
  unsubscribeTouchline(scrips) {
    const list = this._normalize(scrips);
    list.forEach(s => this._touchlineSubs.delete(s));
    if (this._connected) {
      this._send({ t: 'u', k: list.join('|') });
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

  /**
   * Unsubscribe from depth feed for one or more scrips.
   *
   * @param {string|string[]|{exch:string,token:string}[]} scrips
   */
  unsubscribeDepth(scrips) {
    const list = this._normalize(scrips);
    list.forEach(s => this._depthSubs.delete(s));
    if (this._connected) {
      this._send({ t: 'ud', k: list.join('#') });
    }
  }

  /**
   * Subscribe to order update feed for the logged-in account.
   * Emits 'order' events for both the ack (t:'ok') and every update (t:'om').
   *
   * @param {string} [actid] - Defaults to the actid stored in the client session
   */
  subscribeOrderUpdates(actid) {
    this._orderSubActid = actid || this._client.getSession().actid;
    if (this._connected) {
      this._send({ t: 'o', actid: this._orderSubActid });
    }
  }

  /**
   * Unsubscribe from the order update feed.
   */
  unsubscribeOrderUpdates() {
    this._orderSubActid = null;
    if (this._connected) {
      this._send({ t: 'ud' });
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _resubscribeAll() {
    if (this._touchlineSubs.size > 0) {
      this._send({ t: 't', k: [...this._touchlineSubs].join('|') });
    }
    if (this._depthSubs.size > 0) {
      this._send({ t: 'd', k: [...this._depthSubs].join('#') });
    }
    if (this._orderSubActid) {
      this._send({ t: 'o', actid: this._orderSubActid });
    }
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  /**
   * Normalise scrip input to an array of "EXCH|TOKEN" strings.
   */
  _normalize(scrips) {
    const arr = Array.isArray(scrips) ? scrips : [scrips];
    return arr.map(s => (typeof s === 'string' ? s : `${s.exch}|${s.token}`));
  }
}

module.exports = { ShoonyaWebSocket };
