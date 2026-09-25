// Real-time API Client & WebSocket Manager

class AppAPI {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.userId = 'demo_user';
  }

  init() {
    this.connectWebSocket();
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('✅ Connected to game server WebSocket');
        this.reconnectAttempts = 0;
        this.emit('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data);
        } catch (e) {
          console.error('Error parsing WS message', e);
        }
      };

      this.ws.onclose = () => {
        console.warn('⚠️ WebSocket disconnected. Reconnecting in 2s...');
        this.emit('disconnected');
        setTimeout(() => this.connectWebSocket(), Math.min(5000, 1000 * Math.pow(1.5, this.reconnectAttempts++)));
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error', err);
      };
    } catch (e) {
      console.error('Failed to create WebSocket', e);
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error(`Error in event callback for ${event}`, e); }
      });
    }
  }

  // REST API Methods
  async getState() {
    const res = await fetch(`/api/state?userId=${this.userId}`);
    return await res.json();
  }

  async placeBet(gameKey, option, amount) {
    const res = await fetch('/api/bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.userId, gameKey, option, amount })
    });
    return await res.json();
  }

  async rechargeWallet(amount) {
    const res = await fetch('/api/wallet/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.userId, amount })
    });
    return await res.json();
  }

  async getMyBets(gameKey) {
    const url = gameKey ? `/api/bets/my?userId=${this.userId}&gameKey=${gameKey}` : `/api/bets/my?userId=${this.userId}`;
    const res = await fetch(url);
    return await res.json();
  }

  async getWalletLedger() {
    const res = await fetch(`/api/wallet/ledger?userId=${this.userId}`);
    return await res.json();
  }

  // Admin APIs
  async getAdminExposure(gameKey) {
    const res = await fetch(`/api/admin/exposure?gameKey=${gameKey}`);
    return await res.json();
  }

  async setAdminMode(gameKey, mode) {
    const res = await fetch('/api/admin/set-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameKey, mode })
    });
    return await res.json();
  }

  async setAdminOutcome(gameKey, winningNumber) {
    const res = await fetch('/api/admin/set-outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameKey, winningNumber })
    });
    return await res.json();
  }

  async forceSettle(gameKey) {
    const res = await fetch('/api/admin/force-settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameKey })
    });
    return await res.json();
  }

  async speedTimer(gameKey, seconds = 5) {
    const res = await fetch('/api/admin/speed-timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameKey, seconds })
    });
    return await res.json();
  }

  async getAdminUsers() {
    const res = await fetch('/api/admin/users');
    return await res.json();
  }

  async adjustUserBalance(userId, newBalance, reason) {
    const res = await fetch('/api/admin/adjust-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, newBalance, reason })
    });
    return await res.json();
  }

  async getAuditLogs() {
    const res = await fetch('/api/admin/audit-logs');
    return await res.json();
  }
}

window.api = new AppAPI();
