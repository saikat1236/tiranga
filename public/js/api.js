// Real-time API Client & WebSocket Manager with SQLite Auth Support

class AppAPI {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.userId = localStorage.getItem('tiranga_user_id') || 'demo_user';
    this.token = localStorage.getItem('tiranga_token') || null;
    this.currentUser = null;
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  setAuth(token, user) {
    this.token = token;
    this.currentUser = user;
    if (token) {
      localStorage.setItem('tiranga_token', token);
    } else {
      localStorage.removeItem('tiranga_token');
    }

    if (user && user.id) {
      this.userId = user.id;
      localStorage.setItem('tiranga_user_id', user.id);
      localStorage.setItem('tiranga_user_profile', JSON.stringify(user));
    }
    this.emit('auth_changed', { token, user });
  }

  setUserId(id) {
    this.userId = id;
    localStorage.setItem('tiranga_user_id', id);
    this.emit('user_switched', id);
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

  // ==========================================
  //            Authentication APIs
  // ==========================================
  async signup(data) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.success && result.token) {
      this.setAuth(result.token, result.user);
    }
    return result;
  }

  async login(identifier, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const result = await res.json();
    if (result.success && result.token) {
      this.setAuth(result.token, result.user);
    }
    return result;
  }

  async getProfile() {
    const res = await fetch(`/api/auth/me?userId=${this.userId}`, {
      headers: this.getHeaders()
    });
    const result = await res.json();
    if (result.success && result.user) {
      this.currentUser = result.user;
    }
    return result;
  }

  logout() {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem('tiranga_token');
    localStorage.removeItem('tiranga_user_profile');
    this.userId = 'demo_user';
    localStorage.setItem('tiranga_user_id', 'demo_user');
    this.emit('auth_changed', { token: null, user: null });
    this.emit('user_switched', 'demo_user');
  }

  // ==========================================
  //               Game REST APIs
  // ==========================================
  async getState() {
    const res = await fetch(`/api/state?userId=${this.userId}`, {
      headers: this.getHeaders()
    });
    return await res.json();
  }

  async placeBet(gameKey, option, amount) {
    const res = await fetch('/api/bet', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ userId: this.userId, gameKey, option, amount })
    });
    return await res.json();
  }

  async rechargeWallet(amount) {
    const res = await fetch('/api/wallet/recharge', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ userId: this.userId, amount })
    });
    return await res.json();
  }

  async getMyBets(gameKey) {
    const url = gameKey ? `/api/bets/my?userId=${this.userId}&gameKey=${gameKey}` : `/api/bets/my?userId=${this.userId}`;
    const res = await fetch(url, { headers: this.getHeaders() });
    return await res.json();
  }

  async getWalletLedger() {
    const res = await fetch(`/api/wallet/ledger?userId=${this.userId}`, {
      headers: this.getHeaders()
    });
    return await res.json();
  }

  // ==========================================
  //            User Management APIs
  // ==========================================
  async getUsers() {
    const res = await fetch('/api/users');
    return await res.json();
  }

  async getUserDetails(userId) {
    const res = await fetch(`/api/users/${userId}`);
    return await res.json();
  }

  async createUser(userData) {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    return await res.json();
  }

  async updateUser(userId, data) {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  }

  async toggleUserStatus(userId, status) {
    const res = await fetch(`/api/users/${userId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    return await res.json();
  }

  async adjustUserBalanceAdvanced(userId, action, amount, reason) {
    const res = await fetch(`/api/users/${userId}/adjust-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, amount, reason })
    });
    return await res.json();
  }

  async deleteUser(userId) {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'DELETE'
    });
    return await res.json();
  }

  // ==========================================
  //                Admin APIs
  // ==========================================
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
