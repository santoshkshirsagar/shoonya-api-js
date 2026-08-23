'use strict';

const { createHash } = require('crypto');

const DEFAULT_BASE = 'https://api.shoonya.com';

class ShoonyaApiError extends Error {
  constructor(message, response) {
    super(message);
    this.name = 'ShoonyaApiError';
    this.response = response;
  }
}

class ShoonyaClient {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] - Override the API base URL (default: https://api.shoonya.com)
   */
  constructor({ baseUrl = DEFAULT_BASE } = {}) {
    this._base = baseUrl.replace(/\/$/, '');
    this._token = null;
    this._uid = null;
    this._actid = null;
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate the SHA-256 checksum required for GenAcsTok.
   * Formula: SHA-256(clientId + secretCode + code)
   */
  static generateChecksum(clientId, secretCode, code) {
    return createHash('sha256')
      .update(`${clientId}${secretCode}${code}`)
      .digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

 /**
   * Manually set session credentials (useful when restoring a saved session).
   */
  setSession({ accessToken, uid, actid }) {
    if (accessToken !== undefined) this._token = accessToken;
    if (uid !== undefined) this._uid = uid;
    if (actid !== undefined) this._actid = actid;
  }

  getSession() {
    return { accessToken: this._token, uid: this._uid, actid: this._actid };
  }

  // ---------------------------------------------------------------------------
  // Internal request
  // ---------------------------------------------------------------------------

  async _post(path, data) {
    const url = `${this._base}${path}`;
    const body = `jData=${JSON.stringify(data)}`;

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;

    const res = await fetch(url, { method: 'POST', headers, body });

    if (!res.ok) {
      throw new ShoonyaApiError(`HTTP ${res.status}: ${res.statusText}`);
    }

    let json;
    try {
      json = await res.json();
    } catch {
      throw new ShoonyaApiError('Invalid JSON response from server');
    }

    // API returns stat: 'Not_Ok' on errors
    if (json && json.stat === 'Not_Ok') {
      throw new ShoonyaApiError(json.emsg || 'API error', json);
    }

    return json;
  }

  _pick(obj) {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null) result[k] = v;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Exchange an authorization code for an access token.
   * After a successful call the client stores the token and uid automatically.
   *
   * @param {object} params
   * @param {string} params.code       - Code from the redirect URL after login
   * @param {string} params.checksum   - SHA-256(clientId + secretCode + code)
   */
  async generateAccessToken({ code, checksum }) {
    const data = await this._post('/NorenWClientAPI/GenAcsTok', { code, checksum });
    this._token = data.access_token;
    this._uid = data.USERID || data.uid;
    this._actid = data.actid;
    return data;
  }

  async logout() {
    return this._post('/NorenWClientTP/Logout', { uid: this._uid });
  }

  async getUserDetails() {
    return this._post('/NorenWClientAPI/UserDetails', { uid: this._uid });
  }

  async getClientDetails({ uid, actid } = {}) {
    return this._post('/NorenWClientAPI/ClientDetails', {
      uid: uid || this._uid,
      actid: actid || this._actid,
    });
  }

  // ---------------------------------------------------------------------------
  // Watch lists
  // ---------------------------------------------------------------------------

  async getWatchlistNames() {
    return this._post('/NorenWClientAPI/MWList', { uid: this._uid });
  }

  /**
   * @param {string} wlname - Watchlist name
   */
  async getWatchlist(wlname) {
    return this._post('/NorenWClientAPI/MarketWatch', { uid: this._uid, wlname });
  }

  /**
   * @param {object} params
   * @param {string} params.stext - Search text
   * @param {string} [params.exch] - Exchange filter
   */
  async searchScrip({ stext, exch } = {}) {
    return this._post('/NorenWClientAPI/SearchScrip', this._pick({ uid: this._uid, stext, exch }));
  }

  /**
   * @param {object} params
   * @param {string} params.wlname - Watchlist name
   * @param {string} params.scrips - Pipe-hash separated scrips, e.g. "NSE|22#BSE|506734"
   */
  async addScripsToWatchlist({ wlname, scrips }) {
    return this._post('/NorenWClientAPI/AddMultiScripsToMW', { uid: this._uid, wlname, scrips });
  }

  async reorderWatchlistScrips({ wlname, scrips }) {
    return this._post('/NorenWClientAPI/ReorderMWScrips', { uid: this._uid, wlname, scrips });
  }

  async deleteScripsFromWatchlist({ wlname, scrips }) {
    return this._post('/NorenWClientAPI/DeleteMultiMWScrips', { uid: this._uid, wlname, scrips });
  }

  /**
   * @param {object} params
   * @param {string} params.wlname    - Current watchlist name
   * @param {string} params.newwlname - New watchlist name
   */
  async renameWatchlist({ wlname, newwlname }) {
    return this._post('/NorenWClientAPI/RenameMW', { uid: this._uid, wlname, newwlname });
  }

  // ---------------------------------------------------------------------------
  // Market data
  // ---------------------------------------------------------------------------

  /**
   * @param {object} params
   * @param {string} params.exch  - Exchange (e.g. "NSE")
   * @param {string} params.token - Contract token (e.g. "22")
   */
  async getSecurityInfo({ exch, token }) {
    return this._post('/NorenWClientAPI/GetSecurityInfo', { uid: this._uid, exch, token });
  }

  /**
   * @param {object} params
   * @param {string} params.exch  - Exchange
   * @param {string} params.token - Contract token
   */
  async getQuotes({ exch, token }) {
    return this._post('/NorenWClientAPI/GetQuotes', { uid: this._uid, exch, token });
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  /**
   * Place a new order.
   *
   * Required: exch, tsym, qty, prc, prd, trantype, prctyp, ret
   */
  async placeOrder({
    actid, exch, tsym, qty, prc, prd, trantype, prctyp, ret,
    trgprc, dscqty, remarks, ordersource, bpprc, blprc, trailprc,
    amo, tsym2, trantype2, qty2, prc2, tsym3, trantype3, qty3, prc3,
    ext_remarks, cl_ord_id, channel, usr_agent, app_inst_id, ipaddr,
    instname, cau_msg, algo_id,
  } = {}) {
    return this._post('/NorenWClientAPI/PlaceOrder', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      exch, tsym, qty, prc, prd, trantype, prctyp, ret,
      trgprc, dscqty, remarks, ordersource, bpprc, blprc, trailprc,
      amo, tsym2, trantype2, qty2, prc2, tsym3, trantype3, qty3, prc3,
      ext_remarks, cl_ord_id, channel, usr_agent, app_inst_id, ipaddr,
      instname, cau_msg, algo_id,
    }));
  }

  /**
   * Modify an existing order.
   *
   * Required: exch, norenordno, prctyp, prc, qty, tsym
   */
  async modifyOrder({
    exch, norenordno, prctyp, prc, qty, tsym, uid,
    ret, mkt_protection, trgprc, dscqty, ext_remarks, cl_ord_id,
    channel, usr_agent, app_inst_id, ipaddr, bpprc, blprc, trailprc,
    ordersource,
  } = {}) {
    return this._post('/NorenWClientAPI/ModifyOrder', this._pick({
      uid: uid || this._uid,
      exch, norenordno, prctyp, prc, qty, tsym,
      ret, mkt_protection, trgprc, dscqty, ext_remarks, cl_ord_id,
      channel, usr_agent, app_inst_id, ipaddr, bpprc, blprc, trailprc,
      ordersource,
    }));
  }

  /**
   * Cancel an order.
   *
   * Required: norenordno
   */
  async cancelOrder({
    norenordno, uid,
    ext_remarks, cl_ord_id, channel, usr_agent, app_inst_id, ordersource, ipaddr,
  } = {}) {
    return this._post('/NorenWClientAPI/CancelOrder', this._pick({
      norenordno,
      uid: uid || this._uid,
      ext_remarks, cl_ord_id, channel, usr_agent, app_inst_id, ordersource, ipaddr,
    }));
  }

  /**
   * Get margin required for a single order.
   *
   * Required: exch, tsym, qty, prc, prd, trantype, prctyp
   */
  async getOrderMargin({
    actid, exch, tsym, qty, prc, prd, trantype, prctyp,
    trgprc, blprc, rorgqty, fillshares, rorgprc, orgtrgprc,
    norenordno, snonum, rms_exch, rms_seg, rms_prd,
  } = {}) {
    return this._post('/NorenWClientAPI/GetOrderMargin', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      exch, tsym, qty, prc, prd, trantype, prctyp,
      trgprc, blprc, rorgqty, fillshares, rorgprc, orgtrgprc,
      norenordno, snonum, rms_exch, rms_seg, rms_prd,
    }));
  }

  /**
   * Get margin for a basket of orders.
   *
   * Required: exch, tsym, qty, prc, prd, trantype, prctyp
   */
  async getBasketMargin({
    actid, exch, tsym, qty, prc, prd, trantype, prctyp,
    trgprc, blprc, rorgqty, fillshares, rorgprc, orgtrgprc,
    norenordno, snonum, basketlists,
  } = {}) {
    return this._post('/NorenWClientAPI/GetBasketMargin', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      exch, tsym, qty, prc, prd, trantype, prctyp,
      trgprc, blprc, rorgqty, fillshares, rorgprc, orgtrgprc,
      norenordno, snonum, basketlists,
    }));
  }

  /**
   * Get basket option sequence and margin.
   *
   * Required: exch, trantype, prd, tsym, qty, prc, prctyp
   */
  async getBasketOptSeq({
    actid, exch, trantype, prd, tsym, qty, prc, prctyp, basketlists,
  } = {}) {
    return this._post('/NorenWClient/GetBasketOptSeq', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      exch, trantype, prd, tsym, qty, prc, prctyp, basketlists,
    }));
  }

  // ---------------------------------------------------------------------------
  // Order book / trade book
  // ---------------------------------------------------------------------------

  /**
   * @param {object} [params]
   * @param {string} [params.prd] - Filter by product
   */
  async getOrderBook({ prd } = {}) {
    return this._post('/NorenWClientAPI/OrderBook', this._pick({ uid: this._uid, prd }));
  }

  /**
   * @param {string} norenordno - Noren order number
   */
  async getSingleOrderHistory(norenordno) {
    return this._post('/NorenWClientAPI/SingleOrdHist', { uid: this._uid, norenordno });
  }

  /**
   * @param {object} params
   * @param {string} params.norenordno - Noren order number
   * @param {string} [params.actid]
   * @param {string} [params.exch]
   */
  async getSingleOrderStatus({ norenordno, actid, exch } = {}) {
    return this._post('/NorenWClientAPI/SingleOrdStatus', this._pick({
      uid: this._uid,
      norenordno,
      actid: actid || this._actid,
      exch,
    }));
  }

  async getTradeBook({ actid } = {}) {
    return this._post('/NorenWClientAPI/TradeBook', {
      uid: this._uid,
      actid: actid || this._actid,
    });
  }

  // ---------------------------------------------------------------------------
  // Positions
  // ---------------------------------------------------------------------------

  async getPositionBook({ actid } = {}) {
    return this._post('/NorenWClientAPI/PositionBook', {
      uid: this._uid,
      actid: actid || this._actid,
    });
  }

  async getInteropPositionBook({ actid } = {}) {
    return this._post('/NorenWClientAPI/InteropPositionBook', {
      actid: actid || this._actid,
    });
  }

  /**
   * Convert a position from one product type to another.
   *
   * Required: exch, tsym, qty, prd, prevprd, trantype, postype
   */
  async convertProduct({
    actid, exch, tsym, qty, prd, prevprd, trantype, postype, ordersource,
  } = {}) {
    return this._post('/NorenWClientAPI/ProductConversion', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      exch, tsym, qty, prd, prevprd, trantype, postype, ordersource,
    }));
  }

  // ---------------------------------------------------------------------------
  // Holdings & limits
  // ---------------------------------------------------------------------------

  /**
   * @param {object} [params]
   * @param {string} [params.prd] - Product name
   */
  async getHoldings({ actid, prd } = {}) {
    return this._post('/NorenWClientAPI/Holdings', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      prd,
    }));
  }

  /**
   * @param {object} [params]
   * @param {string} [params.prd]       - Product name
   * @param {string} [params.s_prdt_ali] - Product display name
   * @param {string} [params.seg]       - Segment (EQT/DER/FX/COM)
   * @param {string} [params.exch]      - Exchange
   */
  async getLimits({ actid, prd, s_prdt_ali, seg, exch } = {}) {
    return this._post('/NorenWClientAPI/Limits', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      prd, s_prdt_ali, seg, exch,
    }));
  }

  async getSubLimits({ actid } = {}) {
    return this._post('/NorenWClientAPI/GetSubLimits', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
    }));
  }

  /**
   * @param {object} [params]
   * @param {string} [params.seg]  - Segment (EQT/FX/DER/COM)
   * @param {string} [params.exch] - Exchange
   * @param {string} [params.prd]  - Product
   */
  async getMaxPayoutAmount({ actid, seg, exch, prd } = {}) {
    return this._post('/NorenWClientAPI/GetMaxPayoutAmount', this._pick({
      uid: this._uid,
      actid: actid || this._actid,
      seg, exch, prd,
    }));
  }

  // ---------------------------------------------------------------------------
  // Orders — exit bracket / cover
  // ---------------------------------------------------------------------------

  /**
   * Exit a bracket (prd: 'B') or cover (prd: 'H') order.
   *
   * Required: norenordno, prd ('H' or 'B')
   */
  async exitOrder({ norenordno, prd } = {}) {
    return this._post('/NorenWClientAPI/ExitSNOOrder', this._pick({
      uid: this._uid,
      norenordno,
      prd,
    }));
  }

  // ---------------------------------------------------------------------------
  // Market data — charts
  // ---------------------------------------------------------------------------

  /**
   * Intraday OHLCV candles (time-price series).
   *
   * @param {object} params
   * @param {string} params.exch  - Exchange (e.g. "NSE")
   * @param {string} params.token - Contract token
   * @param {number} params.st    - Start time as Unix timestamp (seconds)
   * @param {number} [params.et]  - End time as Unix timestamp (optional, defaults to now)
   * @param {string} [params.intrv] - Candle interval in minutes: "1","3","5","10","15","30","60","120","240"
   */
  async getTimePriceSeries({ exch, token, st, et, intrv } = {}) {
    return this._post('/NorenWClientAPI/TPSeries', this._pick({
      uid: this._uid,
      exch,
      token,
      st: st !== undefined ? String(st) : undefined,
      et: et !== undefined ? String(et) : undefined,
      intrv: intrv !== undefined ? String(intrv) : undefined,
    }));
  }

  /**
   * Daily (EOD) OHLCV candles.
   *
   * @param {object} params
   * @param {string} params.exch  - Exchange (e.g. "NSE")
   * @param {string} params.tsym  - Trading symbol (e.g. "RELIANCE-EQ")
   * @param {number} [params.from] - Start date as Unix timestamp (seconds)
   * @param {number} [params.to]   - End date as Unix timestamp (seconds)
   */
  async getDailyPriceSeries({ exch, tsym, from: fromDate, to: toDate } = {}) {
    return this._post('/NorenWClientAPI/EODChartData', this._pick({
      uid: this._uid,
      sym: `${exch}:${tsym}`,
      from: fromDate !== undefined ? String(fromDate) : undefined,
      to: toDate !== undefined ? String(toDate) : undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // Market data — options
  // ---------------------------------------------------------------------------

  /**
   * Get option chain for a symbol around a strike price.
   *
   * @param {object} params
   * @param {string} params.exch    - Exchange (e.g. "NFO")
   * @param {string} params.tsym    - Trading symbol of any option/future for that underlying
   * @param {number} params.strprc  - Mid/centre strike price for the chain
   * @param {number} [params.cnt]   - Number of strikes on each side (default 2, so 2×2×2 = 8 contracts)
   */
  async getOptionChain({ exch, tsym, strprc, cnt } = {}) {
    return this._post('/NorenWClientAPI/GetOptionChain', this._pick({
      uid: this._uid,
      exch,
      tsym,
      strprc: strprc !== undefined ? String(strprc) : undefined,
      cnt: cnt !== undefined ? String(cnt) : undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // Calculators
  // ---------------------------------------------------------------------------

  /**
   * Calculate SPAN + exposure margin for a list of positions.
   *
   * @param {object} params
   * @param {string} [params.actid]
   * @param {Array}  params.positions - Array of position objects
   *   Each object: { prd, exch, instname, symname, exd, optt, strprc, buyqty, sellqty, netqty }
   */
  async spanCalculator({ actid, positions } = {}) {
    return this._post('/NorenWClientAPI/SpanCalc', {
      actid: actid || this._actid,
      pos: positions,
    });
  }

  /**
   * Calculate option greeks (delta, gamma, theta, rho, vega).
   *
   * @param {object} params
   * @param {string} params.exd        - Expiry date in DD-MMM-YYYY format (e.g. "29-DEC-2022")
   * @param {string} params.strprc     - Strike price
   * @param {string} params.sptprc     - Spot price
   * @param {string} params.int_rate   - Interest rate
   * @param {string} params.volatility - Volatility
   * @param {string} params.optt       - Option type: "CE" or "PE"
   */
  async getOptionGreek({ actid, exd, strprc, sptprc, int_rate, volatility, optt } = {}) {
    return this._post('/NorenWClientAPI/GetOptionGreek', this._pick({
      actid: actid || this._actid,
      exd, strprc, sptprc, int_rate, volatility, optt,
    }));
  }

  // ---------------------------------------------------------------------------
  // Auth — forgot password
  // ---------------------------------------------------------------------------

  /**
   * Trigger a forgot-password OTP to the registered mobile/email.
   *
   * @param {object} params
   * @param {string} params.uid - User ID
   * @param {string} params.pan - PAN number
   */
  async forgotPasswordOTP({ uid, pan } = {}) {
    return this._post('/NorenWClientAPI/FgtPwdOTP', { uid, pan });
  }
}

module.exports = { ShoonyaClient, ShoonyaApiError };
