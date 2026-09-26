// Admin Console Controller - Tiranga Master Control & Multi-User Management

class AdminController {
  constructor() {
    this.currentGameKey = 'wingo_60';
    this.controlMode = 'manual';
    this.manualOverrideNumber = 7;
    this.manualOverrideTarget = null;
    this.exposureData = null;
    this.usersList = [];
    this.auditLogs = [];
    this.allBets = [];
    this.allLedger = [];
    this.activeTab = 'control'; // 'control' | 'exposure' | 'users' | 'allbets' | 'payments' | 'audit'
    this.selectedAdjustAction = 'credit';
    this.searchQuery = '';
    this.statusFilter = 'all';
    this.isPaused = false;
    this.adminToken = localStorage.getItem('tiranga_admin_token') || null;
  }

  init() {
    this.setupModals();
    this.setupAdminLogin();
    this.checkAdminAuth();
  }

  // Admin Login Gate
  setupAdminLogin() {
    const loginForm = document.getElementById('form-admin-login');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const identifier = document.getElementById('admin-login-identifier').value.trim();
        const password = document.getElementById('admin-login-password').value;
        const errorEl = document.getElementById('admin-login-error');
        const submitBtn = document.getElementById('btn-admin-login-submit');

        if (!identifier || !password) {
          if (errorEl) { errorEl.textContent = 'Please enter credentials'; errorEl.style.display = 'block'; }
          return;
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Authenticating...'; }

        try {
          const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
          });
          const data = await res.json();
          if (data.success && data.token) {
            this.adminToken = data.token;
            localStorage.setItem('tiranga_admin_token', data.token);
            // Also set in api client for websocket reuse
            window.api.token = data.token;
            this.showAdminConsole();
            if (errorEl) errorEl.style.display = 'none';
          } else {
            if (errorEl) { errorEl.textContent = data.error || 'Login failed'; errorEl.style.display = 'block'; }
          }
        } catch (err) {
          if (errorEl) { errorEl.textContent = 'Network error'; errorEl.style.display = 'block'; }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Access Admin Console'; }
        }
      });
    }
  }

  checkAdminAuth() {
    if (this.adminToken) {
      window.api.token = this.adminToken;
      // Verify token by hitting a protected endpoint
      this.verifyAdminToken();
    } else {
      this.showLoginGate();
    }
  }

  async verifyAdminToken() {
    try {
      const res = await fetch('/api/admin/dashboard-stats', {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });
      if (res.ok) {
        this.showAdminConsole();
      } else {
        this.adminToken = null;
        localStorage.removeItem('tiranga_admin_token');
        this.showLoginGate();
      }
    } catch (e) {
      this.showLoginGate();
    }
  }

  showLoginGate() {
    const gate = document.getElementById('admin-login-gate');
    const main = document.getElementById('admin-main-container');
    if (gate) gate.style.display = 'flex';
    if (main) main.style.display = 'none';
  }

  showAdminConsole() {
    const gate = document.getElementById('admin-login-gate');
    const main = document.getElementById('admin-main-container');
    if (gate) gate.style.display = 'none';
    if (main) main.style.display = 'block';
    this.bindEvents();
    this.initWebSocket();
    this.loadExposure();
    this.loadUsers();
    this.loadAuditLogs();
    this.loadDashboardStats();
  }

  adminLogout() {
    this.adminToken = null;
    localStorage.removeItem('tiranga_admin_token');
    window.api.token = null;
    this.showLoginGate();
  }

  // Override API fetch to include admin token
  async adminFetch(url, options = {}) {
    const headers = { ...(options.headers || {}), 'Content-Type': 'application/json' };
    if (this.adminToken) {
      headers['Authorization'] = `Bearer ${this.adminToken}`;
    }
    return fetch(url, { ...options, headers });
  }

  initWebSocket() {
    window.api.init();

    window.api.on('connected', () => {
      const statusEl = document.getElementById('admin-ws-status');
      if (statusEl) statusEl.textContent = 'System Live & Connected';
    });

    window.api.on('disconnected', () => {
      const statusEl = document.getElementById('admin-ws-status');
      if (statusEl) statusEl.textContent = 'Reconnecting...';
    });

    window.api.on('INIT_STATE', (data) => {
      if (data.dashboardStats) {
        this.renderDashboardStats(data.dashboardStats);
      } else {
        this.loadDashboardStats();
      }
      this.loadExposure();
      this.loadUsers();
      this.loadAuditLogs();
    });

    window.api.on('TICK', (data) => {
      this.updateFromTick(data);
    });

    window.api.on('ROUND_STARTED', (data) => {
      if (data.gameKey === this.currentGameKey) {
        this.loadExposure();
      }
    });

    window.api.on('ROUND_SETTLED', (data) => {
      if (data.dashboardStats) {
        this.renderDashboardStats(data.dashboardStats);
      } else {
        this.loadDashboardStats();
      }
      this.loadExposure();
      this.loadAuditLogs();
      if (this.activeTab === 'users') this.loadUsers();
      if (this.activeTab === 'allbets') this.loadAllBets();
      if (this.activeTab === 'payments') this.loadAllLedger();
    });

    window.api.on('BET_PLACED', (data) => {
      if (data.gameKey === this.currentGameKey) {
        if (data.updatedExposure) {
          this.exposureData = data.updatedExposure;
          this.renderExposure();
        } else {
          this.loadExposure();
        }
      }
      if (data.dashboardStats) {
        this.renderDashboardStats(data.dashboardStats);
      } else {
        this.loadDashboardStats();
      }
      if (this.activeTab === 'allbets') this.loadAllBets();
      if (this.activeTab === 'payments') this.loadAllLedger();
      if (this.activeTab === 'users') this.loadUsers();
    });

    window.api.on('USER_UPDATED', (data) => {
      if (data.dashboardStats) {
        this.renderDashboardStats(data.dashboardStats);
      } else {
        this.loadDashboardStats();
      }
      if (this.activeTab === 'users') this.loadUsers();
      if (this.activeTab === 'payments') this.loadAllLedger();
    });

    window.api.on('USERS_UPDATED', (data) => {
      this.usersList = data.users || [];
      this.renderUsers();
      if (data.dashboardStats) {
        this.renderDashboardStats(data.dashboardStats);
      } else {
        this.loadDashboardStats();
      }
    });

    window.api.on('ADMIN_OUTCOME_PRESET', (data) => {
      if (data.gameKey === this.currentGameKey) {
        this.manualOverrideNumber = data.manualOverrideNumber;
        this.manualOverrideTarget = data.manualOverrideTarget;
        this.controlMode = data.controlMode;
        this.renderControlModeState();
      }
    });

    window.api.on('GAME_STATUS_CHANGED', (data) => {
      if (data.statusMap) {
        const current = data.statusMap[this.currentGameKey];
        if (current) {
          this.isPaused = !!current.isPaused;
          this.renderGameStatusBadge();
        }
      }
    });
  }

  bindEvents() {
    // Admin Top Navigation Tabs
    document.querySelectorAll('.admin-nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        this.switchAdminTab(targetTab);
      });
    });

    // Game switcher for admin
    const adminGameSelect = document.getElementById('admin-game-select');
    if (adminGameSelect) {
      adminGameSelect.addEventListener('change', (e) => {
        this.currentGameKey = e.target.value;
        if (this.allGamesState && this.allGamesState[this.currentGameKey]) {
          const g = this.allGamesState[this.currentGameKey];
          const periodEl = document.getElementById('admin-live-period');
          const timerEl = document.getElementById('admin-live-timer');
          if (periodEl) periodEl.textContent = g.periodId || g.currentPeriod || '--';
          if (timerEl) {
            const safeSec = Math.max(0, parseInt(g.remainingSeconds, 10) || 0);
            const min = Math.floor(safeSec / 60);
            const sec = safeSec % 60;
            timerEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
          }
          if (g.controlMode) {
            this.controlMode = g.controlMode;
            this.manualOverrideNumber = g.manualOverrideNumber;
            this.manualOverrideTarget = g.manualOverrideTarget;
            this.renderControlModeState();
          }
        }
        this.loadExposure();
      });
    }

    // Control Mode Pills (Manual, Min Payout, Random, Max Payout)
    document.querySelectorAll('.mode-pill-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        await this.setControlMode(mode);
      });
    });

    // Manual Outcome Number Keypad (0 to 9)
    document.querySelectorAll('.override-key-btn').forEach(key => {
      key.addEventListener('click', async () => {
        const num = parseInt(key.dataset.num, 10);
        await this.forceWinningNumber(num);
      });
    });

    // Category Outcome Buttons (Color & Size Overrides)
    document.querySelectorAll('.override-cat-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetType = btn.dataset.targetType; // 'color' | 'size'
        const targetVal = btn.dataset.targetVal;   // 'green' | 'violet' | 'red' | 'big' | 'small'
        await this.forceCategoryOutcome(targetType, targetVal);
      });
    });

    // Clear Override Button
    const clearBtn = document.getElementById('btn-clear-override');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        await this.clearOverride();
      });
    }

    // Force Settle Now Buttons (top bar and keypad)
    const forceSettleBtn = document.getElementById('btn-admin-force-settle');
    if (forceSettleBtn) {
      forceSettleBtn.addEventListener('click', async () => {
        await this.forceSettle();
      });
    }

    const keypadSettleBtn = document.getElementById('btn-keypad-settle-now');
    if (keypadSettleBtn) {
      keypadSettleBtn.addEventListener('click', async () => {
        await this.forceSettle();
      });
    }

    // Speed up timer to 5s
    const speedTimerBtn = document.getElementById('btn-admin-speed-timer');
    if (speedTimerBtn) {
      speedTimerBtn.addEventListener('click', async () => {
        await this.speedTimer(5);
      });
    }

    // Pause / Resume Game Loop
    const pauseBtn = document.getElementById('btn-admin-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', async () => {
        await this.toggleGamePause();
      });
    }

    // Restart Round
    const restartBtn = document.getElementById('btn-admin-restart');
    if (restartBtn) {
      restartBtn.addEventListener('click', async () => {
        await this.restartGameRound();
      });
    }

    // Clean old history
    const cleanHistBtn = document.getElementById('btn-admin-clean-history');
    if (cleanHistBtn) {
      cleanHistBtn.addEventListener('click', async () => {
        await this.cleanDatabaseHistory();
      });
    }

    // Refresh data button
    const refreshBtn = document.getElementById('btn-admin-global-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadExposure();
        this.loadUsers();
        this.loadAuditLogs();
        window.showToast('All dashboard metrics refreshed', 'info');
      });
    }

    const exportAuditBtn = document.getElementById('btn-export-audit');
    if (exportAuditBtn) {
      exportAuditBtn.addEventListener('click', () => {
        this.loadAuditLogs();
        window.showToast('Audit records re-synced', 'info');
      });
    }

    // Admin Logout Button
    const logoutBtn = document.getElementById('btn-admin-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        this.adminLogout();
      });
    }

    // All Bets Refresh
    const refreshAllBetsBtn = document.getElementById('btn-refresh-all-bets');
    if (refreshAllBetsBtn) {
      refreshAllBetsBtn.addEventListener('click', () => {
        this.loadAllBets();
        window.showToast('Bets data refreshed', 'info');
      });
    }

    // All Ledger Refresh
    const refreshAllLedgerBtn = document.getElementById('btn-refresh-all-ledger');
    if (refreshAllLedgerBtn) {
      refreshAllLedgerBtn.addEventListener('click', () => {
        this.loadAllLedger();
        window.showToast('Payment records refreshed', 'info');
      });
    }

    // User Search Input
    const searchInput = document.getElementById('user-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderUsers();
      });
    }

    // User Status Filter Select
    const statusFilter = document.getElementById('user-status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        this.statusFilter = e.target.value;
        this.renderUsers();
      });
    }

    // Open Create User Modal
    const openCreateUserBtn = document.getElementById('btn-open-create-user');
    if (openCreateUserBtn) {
      openCreateUserBtn.addEventListener('click', () => {
        document.getElementById('create-user-modal').classList.add('open');
      });
    }

    // Submit Create User
    const submitCreateUserBtn = document.getElementById('btn-submit-create-user');
    if (submitCreateUserBtn) {
      submitCreateUserBtn.addEventListener('click', async () => {
        await this.handleCreateUser();
      });
    }

    // Adjust Balance Action Type Pills (credit / debit / set)
    document.querySelectorAll('.action-type-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.action-type-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.selectedAdjustAction = pill.dataset.action;
      });
    });

    // Submit Adjust Balance
    const submitAdjustBal = document.getElementById('btn-submit-adjust-bal');
    if (submitAdjustBal) {
      submitAdjustBal.addEventListener('click', async () => {
        await this.handleExecuteAdjustBalance();
      });
    }

    // Drawer Sub-tabs
    document.querySelectorAll('.drawer-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.drawer-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.drawertab;
        const betsView = document.getElementById('drawer-bets-view');
        const ledgerView = document.getElementById('drawer-ledger-view');
        if (target === 'bets') {
          if (betsView) betsView.style.display = 'block';
          if (ledgerView) ledgerView.style.display = 'none';
        } else {
          if (betsView) betsView.style.display = 'none';
          if (ledgerView) ledgerView.style.display = 'block';
        }
      });
    });
  }

  setupModals() {
    // Universal Close Modal Buttons
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('open');
      });
    });

    // Dismiss by backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('open');
        }
      });
    });
  }

  switchAdminTab(tabKey) {
    this.activeTab = tabKey;

    document.querySelectorAll('.admin-nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabKey);
    });

    document.querySelectorAll('.admin-tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const targetPane = document.getElementById(`pane-${tabKey}`);
    if (targetPane) targetPane.classList.add('active');

    // Trigger tab specific loads
    if (tabKey === 'exposure') this.loadExposure();
    if (tabKey === 'users') this.loadUsers();
    if (tabKey === 'audit') this.loadAuditLogs();
    if (tabKey === 'allbets') this.loadAllBets();
    if (tabKey === 'payments') this.loadAllLedger();
  }

  updateFromTick(tickData) {
    let gamesMap = tickData.games;
    if (!gamesMap && tickData.gameKey) {
      gamesMap = { [tickData.gameKey]: tickData };
    }
    if (!gamesMap) return;

    this.allGamesState = gamesMap;

    // Update game select options with live countdowns
    const selectEl = document.getElementById('admin-game-select');
    if (selectEl && selectEl.options) {
      Array.from(selectEl.options).forEach(opt => {
        const g = gamesMap[opt.value];
        if (g) {
          const safeSec = Math.max(0, parseInt(g.remainingSeconds, 10) || 0);
          const m = Math.floor(safeSec / 60);
          const s = safeSec % 60;
          const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          const baseName = g.name || (opt.value === 'wingo_30' ? 'Win Go 30s' : opt.value === 'wingo_60' ? 'Win Go 1Min' : opt.value === 'wingo_180' ? 'Win Go 3Min' : 'Win Go 5Min');
          opt.textContent = `${baseName} (${timeStr})`;
        }
      });
    }

    const game = gamesMap[this.currentGameKey];
    if (!game) return;

    // Update pause state and status badge
    this.isPaused = !!game.isPaused;
    this.renderGameStatusBadge();

    // Update banner period & countdown
    const periodEl = document.getElementById('admin-live-period');
    const timerEl = document.getElementById('admin-live-timer');
    const betsCountEl = document.getElementById('admin-live-bets-count');

    if (periodEl) periodEl.textContent = game.periodId || game.currentPeriod;
    if (timerEl) {
      if (this.isPaused) {
        timerEl.textContent = 'PAUSED';
        timerEl.classList.remove('urgent');
      } else {
        const safeSec = Math.max(0, parseInt(game.remainingSeconds, 10) || 0);
        const min = Math.floor(safeSec / 60);
        const sec = safeSec % 60;
        timerEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        const lockSec = game.lockDuration || 5;
        if (safeSec <= lockSec) {
          timerEl.classList.add('urgent');
        } else {
          timerEl.classList.remove('urgent');
        }
      }
    }
    if (betsCountEl) {
      betsCountEl.textContent = game.activeBetsCount !== undefined ? game.activeBetsCount : (game.activeBets ? game.activeBets.length : 0);
    }

    // Update UI mode badges if changed
    if (game.controlMode !== this.controlMode || 
        game.manualOverrideNumber !== this.manualOverrideNumber ||
        game.manualOverrideTarget !== this.manualOverrideTarget) {
      this.controlMode = game.controlMode;
      this.manualOverrideNumber = game.manualOverrideNumber;
      this.manualOverrideTarget = game.manualOverrideTarget;
      this.renderControlModeState();
    }
  }

  async setControlMode(mode) {
    try {
      const res = await this.adminFetch(`/api/admin/set-mode`, {
        method: 'POST',
        body: JSON.stringify({ gameKey: this.currentGameKey, mode })
      });
      const data = await res.json();
      if (data.success) {
        this.controlMode = data.mode || mode;
        this.renderControlModeState();
        window.showToast(`Game mode set to ${mode.toUpperCase()}!`, 'success');
      }
    } catch (e) {
      window.showToast('Failed to switch mode', 'error');
    }
  }

  async forceWinningNumber(num) {
    try {
      const res = await this.adminFetch(`/api/admin/set-outcome`, {
        method: 'POST',
        body: JSON.stringify({ gameKey: this.currentGameKey, winningNumber: num })
      });
      const data = await res.json();
      if (data.success) {
        this.controlMode = 'manual';
        this.manualOverrideNumber = num;
        this.manualOverrideTarget = null;
        this.renderControlModeState();
        if (window.soundCtrl) window.soundCtrl.playAlert();
        window.showToast(`🎯 TARGET LOCKED: Number [${num}] will win the next round!`, 'success');
      }
    } catch (e) {
      window.showToast('Failed to set outcome override', 'error');
    }
  }

  async forceCategoryOutcome(targetType, targetValue) {
    try {
      const res = await this.adminFetch(`/api/admin/set-outcome`, {
        method: 'POST',
        body: JSON.stringify({
          gameKey: this.currentGameKey,
          targetType,
          targetValue
        })
      });
      const data = await res.json();
      if (data.success) {
        this.controlMode = 'manual';
        this.manualOverrideNumber = null;
        this.manualOverrideTarget = targetValue;
        this.renderControlModeState();
        if (window.soundCtrl) window.soundCtrl.playAlert();
        window.showToast(`🎯 TARGET LOCKED: Category [${targetValue.toUpperCase()}] forced for next round!`, 'success');
      }
    } catch (e) {
      window.showToast('Failed to set category override', 'error');
    }
  }

  async clearOverride() {
    try {
      const res = await this.adminFetch(`/api/admin/set-outcome`, {
        method: 'POST',
        body: JSON.stringify({ gameKey: this.currentGameKey, winningNumber: null, targetValue: null })
      });
      const data = await res.json();
      if (data.success) {
        this.manualOverrideNumber = null;
        this.manualOverrideTarget = null;
        this.renderControlModeState();
        window.showToast('Manual outcome cleared. Reverted to automatic mode.', 'info');
      }
    } catch (e) {
      window.showToast('Failed to clear override', 'error');
    }
  }

  async forceSettle() {
    try {
      const res = await this.adminFetch(`/api/admin/force-settle`, {
        method: 'POST',
        body: JSON.stringify({ gameKey: this.currentGameKey })
      });
      const data = await res.json();
      if (data.success) {
        if (window.soundCtrl) window.soundCtrl.playWin();
        window.showToast('⚡ Round force-settled immediately!', 'success');
        this.loadExposure();
        this.loadAuditLogs();
        this.loadUsers();
        this.loadDashboardStats();
      }
    } catch (e) {
      window.showToast('Failed to force settle', 'error');
    }
  }

  renderGameStatusBadge() {
    const badge = document.getElementById('admin-game-status-badge');
    const pauseBtn = document.getElementById('btn-admin-pause');
    if (badge) {
      if (this.isPaused) {
        badge.textContent = '⏸️ Paused';
        badge.className = 'badge badge-warning';
      } else {
        badge.textContent = '● Running';
        badge.className = 'badge badge-success';
      }
    }
    if (pauseBtn) {
      if (this.isPaused) {
        pauseBtn.innerHTML = '▶️ Resume';
        pauseBtn.classList.remove('btn-warning');
        pauseBtn.classList.add('btn-primary');
        pauseBtn.title = 'Resume game countdowns';
      } else {
        pauseBtn.innerHTML = '⏸️ Pause';
        pauseBtn.classList.remove('btn-primary');
        pauseBtn.classList.add('btn-warning');
        pauseBtn.title = 'Pause game countdowns';
      }
    }
  }

  async toggleGamePause() {
    const action = this.isPaused ? 'resume' : 'pause';
    try {
      const res = await this.adminFetch('/api/admin/game-status', {
        method: 'POST',
        body: JSON.stringify({ gameKey: this.currentGameKey, action })
      });
      const data = await res.json();
      if (data.success) {
        this.isPaused = (action === 'pause');
        this.renderGameStatusBadge();
        window.showToast(action === 'pause' ? 'Game loop paused' : 'Game loop resumed', 'info');
      }
    } catch (e) {
      window.showToast('Failed to update game status', 'error');
    }
  }

  async restartGameRound() {
    try {
      const res = await this.adminFetch('/api/admin/game-status', {
        method: 'POST',
        body: JSON.stringify({ gameKey: this.currentGameKey, action: 'restart' })
      });
      const data = await res.json();
      if (data.success) {
        this.isPaused = false;
        this.renderGameStatusBadge();
        this.loadExposure();
        window.showToast('Round restarted fresh!', 'info');
      }
    } catch (e) {
      window.showToast('Failed to restart round', 'error');
    }
  }

  async cleanDatabaseHistory() {
    if (!confirm('This will retain strictly recent 100 settled games per timeframe (max 400 total) and delete older historical rows. Continue?')) {
      return;
    }
    try {
      const res = await this.adminFetch('/api/admin/clean-history', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.loadAuditLogs();
        this.loadDashboardStats();
        window.showToast(data.message || 'Cleaned old history successfully!', 'info');
      }
    } catch (e) {
      window.showToast('Failed to clean history', 'error');
    }
  }

  async speedTimer(seconds = 5) {
    try {
      const res = await this.adminFetch(`/api/admin/speed-timer`, {
        method: 'POST',
        body: JSON.stringify({ gameKey: this.currentGameKey, seconds })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast(`Timer accelerated! Settle in ${seconds}s.`, 'info');
      }
    } catch (e) {
      window.showToast('Failed to speed timer', 'error');
    }
  }

  renderControlModeState() {
    // Highlight mode buttons
    document.querySelectorAll('.mode-pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.controlMode);
    });

    // Highlight keypad numbers (0 to 9)
    document.querySelectorAll('.override-key-btn').forEach(key => {
      const keyNum = parseInt(key.dataset.num, 10);
      key.classList.toggle('selected', keyNum === this.manualOverrideNumber);
    });

    // Highlight category buttons (Green, Violet, Red, Big, Small)
    document.querySelectorAll('.override-cat-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.targetVal === this.manualOverrideTarget);
    });

    const bannerBox = document.getElementById('active-override-status-box');
    const labelEl = document.getElementById('active-override-label');

    if (this.manualOverrideNumber !== null && this.manualOverrideNumber !== undefined) {
      if (bannerBox) {
        bannerBox.style.border = '1px solid #ef4444';
        bannerBox.style.background = 'rgba(239, 68, 68, 0.15)';
      }
      if (labelEl) {
        const colorName = [1,3,7,9].includes(this.manualOverrideNumber) ? 'GREEN' :
                          [2,4,6,8].includes(this.manualOverrideNumber) ? 'RED' :
                          this.manualOverrideNumber === 0 ? 'RED + VIOLET' : 'GREEN + VIOLET';
        const sizeName = this.manualOverrideNumber >= 5 ? 'BIG' : 'SMALL';
        labelEl.innerHTML = `🎯 <strong>MANUAL OVERRIDE ACTIVE:</strong> Next Outcome is Guaranteed to <strong>[Number ${this.manualOverrideNumber}]</strong> (${colorName}, ${sizeName})`;
      }
    } else if (this.manualOverrideTarget) {
      if (bannerBox) {
        bannerBox.style.border = '1px solid #f59e0b';
        bannerBox.style.background = 'rgba(245, 158, 11, 0.15)';
      }
      if (labelEl) {
        const t = this.manualOverrideTarget.toUpperCase();
        let detail = '';
        if (t === 'BIG') detail = 'Numbers [5, 6, 7, 8, 9]';
        else if (t === 'SMALL') detail = 'Numbers [0, 1, 2, 3, 4]';
        else if (t === 'GREEN') detail = 'Numbers [1, 3, 7, 9] (Violet: 5)';
        else if (t === 'RED') detail = 'Numbers [2, 4, 6, 8] (Violet: 0)';
        else if (t === 'VIOLET') detail = 'Numbers [0, 5]';
        labelEl.innerHTML = `🎯 <strong>CATEGORY OVERRIDE ACTIVE:</strong> Forcing <strong>[${t}]</strong> (${detail}) · Engine will auto-select minimum house payout!`;
      }
    } else {
      if (bannerBox) {
        bannerBox.style.border = '1px solid var(--border-light)';
        bannerBox.style.background = 'rgba(0, 0, 0, 0.2)';
      }
      if (labelEl) {
        let desc = 'No manual override. Outcome determined by algorithm.';
        if (this.controlMode === 'min_payout') desc = '🛡️ House Profit Mode: Game will automatically pick the outcome with lowest payout!';
        if (this.controlMode === 'max_payout') desc = '🎁 Max Payout Mode: Outcome with highest player payout will be selected.';
        if (this.controlMode === 'random') desc = '🎲 Fair Random: Cryptographically secure random server seed.';
        labelEl.innerHTML = desc;
      }
    }
  }

  async loadExposure() {
    try {
      const res = await this.adminFetch(`/api/admin/exposure?gameKey=${this.currentGameKey}`);
      const data = await res.json();
      if (data.success) {
        this.exposureData = data.exposure;
        this.renderExposureTable('exposure-table-body');
        this.renderExposureTable('exposure-table-body-preview');
        this.renderBetOptionBreakdown('admin-options-breakdown', 'admin-total-wagered');
        this.renderBetOptionBreakdown('admin-options-breakdown-preview', 'admin-total-wagered-preview');
      }
    } catch (e) {
      console.error('Failed to load exposure', e);
    }
  }

  renderExposureTable(targetId) {
    const tbody = document.getElementById(targetId);
    if (!tbody || !this.exposureData) return;

    const { outcomeTable, suggestedMinPayoutNumber } = this.exposureData;

    tbody.innerHTML = outcomeTable.map(row => {
      const isMin = row.number === suggestedMinPayoutNumber;
      const isSelected = row.number === this.manualOverrideNumber;
      const numClass = `num-ball-${row.number}`;

      return `
        <tr class="${isMin ? 'highlight-min' : ''}">
          <td>
            <span class="num-cell-ball ${numClass}">${row.number}</span>
          </td>
          <td>
            <span style="font-weight:700;text-transform:capitalize;">${row.color}</span> / 
            <span class="size-pill ${row.size.toLowerCase()}">${row.size}</span>
          </td>
          <td style="font-family:var(--font-mono);font-weight:700;">
            ₹${row.totalPayout.toFixed(2)}
          </td>
          <td>
            <span class="profit-badge ${row.isHousePositive ? 'positive' : 'negative'}">
              ${row.isHousePositive ? '+' : ''}₹${row.houseProfit.toFixed(2)}
            </span>
            ${isMin ? '<span style="font-size:0.7rem;color:#10b981;font-weight:700;margin-left:6px;">🛡️ MAX PROFIT</span>' : ''}
          </td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="window.adminCtrl.forceWinningNumber(${row.number})" ${isSelected ? 'style="background:#10b981;border-color:#10b981;color:#fff;"' : ''}>
              ${isSelected ? '✓ FORCED' : '🎯 Force Outcome'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderBetOptionBreakdown(targetSummaryId, targetWageredId) {
    if (!this.exposureData) return;
    const { breakdownByOption, totalWagered } = this.exposureData;

    const wageredEl = document.getElementById(targetWageredId);
    if (wageredEl) wageredEl.textContent = `₹${totalWagered.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    const optSummary = document.getElementById(targetSummaryId);
    if (optSummary) {
      optSummary.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.82rem;font-family:var(--font-mono);">
          <span style="color:#00e676;background:rgba(0,230,118,0.1);padding:3px 8px;border-radius:4px;">Green: ₹${(breakdownByOption.green || 0).toLocaleString('en-IN')}</span>
          <span style="color:#ff2a55;background:rgba(255,42,85,0.1);padding:3px 8px;border-radius:4px;">Red: ₹${(breakdownByOption.red || 0).toLocaleString('en-IN')}</span>
          <span style="color:#a855f7;background:rgba(168,85,247,0.1);padding:3px 8px;border-radius:4px;">Violet: ₹${(breakdownByOption.violet || 0).toLocaleString('en-IN')}</span>
          <span style="color:#f59e0b;background:rgba(245,158,11,0.1);padding:3px 8px;border-radius:4px;">Big: ₹${(breakdownByOption.big || 0).toLocaleString('en-IN')}</span>
          <span style="color:#38bdf8;background:rgba(56,189,248,0.1);padding:3px 8px;border-radius:4px;">Small: ₹${(breakdownByOption.small || 0).toLocaleString('en-IN')}</span>
        </div>
      `;
    }
  }

  // ========================================================
  //             USER MANAGEMENT CONTROLLER
  // ========================================================
  async loadUsers() {
    try {
      const res = await this.adminFetch('/api/users');
      const data = await res.json();
      if (data.success) {
        this.usersList = data.users;
        this.renderUsers();
      }
    } catch (e) {
      console.error('Failed to load users', e);
    }
  }

  renderUsers() {
    const tbody = document.getElementById('admin-users-table-body');
    if (!tbody) return;

    // Filter users by search query and status filter
    let filtered = this.usersList.filter(u => {
      const matchesSearch = !this.searchQuery || 
        u.name.toLowerCase().includes(this.searchQuery) ||
        (u.mobile && u.mobile.toLowerCase().includes(this.searchQuery)) ||
        u.id.toLowerCase().includes(this.searchQuery);

      const matchesStatus = this.statusFilter === 'all' || u.status === this.statusFilter;
      return matchesSearch && matchesStatus;
    });

    // Update summary stat boxes
    const totalUsers = this.usersList.length;
    const activeUsers = this.usersList.filter(u => u.status === 'active').length;
    const frozenUsers = this.usersList.filter(u => u.status === 'frozen').length;
    const totalBalance = this.usersList.reduce((sum, u) => sum + (u.balance || 0), 0);

    const statTotal = document.getElementById('stat-total-users');
    const statActive = document.getElementById('stat-active-users');
    const statFrozen = document.getElementById('stat-frozen-users');
    const statBal = document.getElementById('stat-total-balance');

    if (statTotal) statTotal.textContent = totalUsers;
    if (statActive) statActive.textContent = activeUsers;
    if (statFrozen) statFrozen.textContent = frozenUsers;
    if (statBal) statBal.textContent = `₹${totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">No users match the criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => {
      const isFrozen = u.status === 'frozen';
      const netPnlClass = (u.netProfit || 0) >= 0 ? 'text-green' : 'text-red';

      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="user-avatar-badge ${isFrozen ? 'frozen' : ''}">
                ${u.name.substring(0, 1).toUpperCase()}
              </div>
              <div>
                <div style="font-weight:700;font-size:0.95rem;color:var(--text-main);">${u.name}</div>
                <div style="font-size:0.75rem;color:var(--text-dim);font-family:var(--font-mono);">${u.mobile || u.id}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="status-pill ${isFrozen ? 'frozen' : 'active'}">
              ${isFrozen ? '❄️ Frozen' : '🟢 Active'}
            </span>
          </td>
          <td style="font-family:var(--font-mono);font-weight:700;font-size:1.05rem;color:#ffca3a;">
            ₹${(u.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </td>
          <td>
            <div style="font-size:0.8rem;color:var(--text-muted);">
              <div>Bets: <strong>${u.totalBetsCount || 0}</strong></div>
              <div>Wagered: ₹${(u.totalWagered || 0).toLocaleString('en-IN')}</div>
            </div>
          </td>
          <td>
            <div class="${netPnlClass}" style="font-family:var(--font-mono);font-weight:700;">
              ${(u.netProfit || 0) >= 0 ? '+' : ''}₹${(u.netProfit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </td>
          <td>
            <div class="user-action-btn-group">
              <button class="btn btn-secondary btn-sm" onclick="window.adminCtrl.openAdjustModal('${u.id}', '${escape(u.name)}', ${u.balance})" title="Deposit / Debit Balance">
                💳 Balance
              </button>
              <button class="btn btn-secondary btn-sm" onclick="window.adminCtrl.toggleFreeze('${u.id}', '${isFrozen ? 'active' : 'frozen'}')" title="${isFrozen ? 'Unfreeze Account' : 'Freeze Account'}">
                ${isFrozen ? '☀️ Unfreeze' : '❄️ Freeze'}
              </button>
              <button class="btn btn-secondary btn-sm" onclick="window.adminCtrl.openUserDrawer('${u.id}')" title="Inspect Bets & Ledger">
                🔍 Inspect
              </button>
              <button class="btn btn-primary btn-sm" onclick="window.adminCtrl.loginAsUser('${u.id}')" title="Switch to this user in Player App">
                🎮 Play As
              </button>
              ${u.id !== 'demo_user' ? `
                <button class="btn btn-danger btn-sm" onclick="window.adminCtrl.deleteUserAccount('${u.id}')" title="Delete User">
                  🗑️
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Create User Handler
  async handleCreateUser() {
    const nameInput = document.getElementById('create-user-name');
    const mobileInput = document.getElementById('create-user-mobile');
    const balanceInput = document.getElementById('create-user-balance');

    const name = nameInput.value.trim();
    if (!name) {
      window.showToast('Please enter user name', 'error');
      return;
    }

    const mobile = mobileInput.value.trim();
    const balance = parseFloat(balanceInput.value) || 0;

    try {
      const res = await this.adminFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name, mobile, initialBalance: balance })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast(`User ${name} created successfully!`, 'success');
        document.getElementById('create-user-modal').classList.remove('open');
        nameInput.value = '';
        mobileInput.value = '';
        this.loadUsers();
        this.loadDashboardStats();
      }
    } catch (e) {
      window.showToast('Failed to create user', 'error');
    }
  }

  // Adjust Balance Modal Opening
  openAdjustModal(userId, userName, currentBalance) {
    document.getElementById('adjust-user-id').value = userId;
    document.getElementById('adjust-user-name').textContent = unescape(userName);
    document.getElementById('adjust-user-current-bal').textContent = `Current: ₹${parseFloat(currentBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('adjust-balance-val').value = '';
    document.getElementById('adjust-balance-modal').classList.add('open');
  }

  async handleExecuteAdjustBalance() {
    const userId = document.getElementById('adjust-user-id').value;
    const amountVal = parseFloat(document.getElementById('adjust-balance-val').value);
    const reason = document.getElementById('adjust-balance-reason').value.trim() || 'Admin Adjustment';

    if (isNaN(amountVal) || amountVal < 0) {
      window.showToast('Please enter a valid amount', 'error');
      return;
    }

    try {
      const res = await this.adminFetch(`/api/users/${userId}/adjust-balance`, {
        method: 'POST',
        body: JSON.stringify({ action: this.selectedAdjustAction, amount: amountVal, reason })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast('User balance updated successfully!', 'success');
        document.getElementById('adjust-balance-modal').classList.remove('open');
        this.loadUsers();
        this.loadDashboardStats();
      }
    } catch (e) {
      window.showToast('Failed to adjust balance', 'error');
    }
  }

  // Toggle freeze/unfreeze
  async toggleFreeze(userId, newStatus) {
    try {
      const res = await this.adminFetch(`/api/users/${userId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast(`User account is now ${newStatus.toUpperCase()}`, 'info');
        this.loadUsers();
        this.loadDashboardStats();
      }
    } catch (e) {
      window.showToast('Failed to change user status', 'error');
    }
  }

  // Inspect user drawer
  async openUserDrawer(userId) {
    try {
      const res = await this.adminFetch(`/api/users/${userId}`);
      const data = await res.json();
      if (!data.success) return;

      const { user, bets, ledger } = data;
      document.getElementById('drawer-user-title').textContent = `${user.name} (${user.id})`;

      const metaBox = document.getElementById('drawer-user-meta-box');
      if (metaBox) {
        metaBox.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;background:rgba(0,0,0,0.3);padding:12px;border-radius:var(--radius-md);">
            <div><span style="font-size:0.75rem;color:var(--text-muted);">Current Balance</span><div style="font-size:1.1rem;font-weight:700;color:var(--color-gold);">₹${user.balance.toFixed(2)}</div></div>
            <div><span style="font-size:0.75rem;color:var(--text-muted);">Status</span><div><span class="status-pill ${user.status}">${user.status}</span></div></div>
            <div><span style="font-size:0.75rem;color:var(--text-muted);">Total Bets</span><div style="font-weight:700;">${user.totalBetsCount}</div></div>
            <div><span style="font-size:0.75rem;color:var(--text-muted);">Net Profit / Loss</span><div style="font-weight:700;color:${user.netProfit >= 0 ? '#10b981' : '#f43f5e'};">${user.netProfit >= 0 ? '+' : ''}₹${user.netProfit}</div></div>
          </div>
        `;
      }

      // Render bets table in drawer
      const betsTbody = document.getElementById('drawer-bets-tbody');
      if (betsTbody) {
        betsTbody.innerHTML = bets.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:16px;">No bets recorded for this user.</td></tr>' :
          bets.map(b => `
            <tr>
              <td style="font-family:var(--font-mono);font-size:0.78rem;">${b.periodId}</td>
              <td style="font-size:0.8rem;">${b.gameKey}</td>
              <td><span style="font-weight:700;text-transform:uppercase;">${b.option}</span></td>
              <td style="font-family:var(--font-mono);">₹${b.amount}</td>
              <td><span class="status-pill ${b.status.toLowerCase()}">${b.status}</span></td>
              <td style="font-family:var(--font-mono);font-weight:700;color:${b.payout > 0 ? '#10b981' : 'var(--text-muted)'};">₹${b.payout.toFixed(2)}</td>
              <td style="font-size:0.75rem;color:var(--text-dim);">${new Date(b.placedAt).toLocaleTimeString()}</td>
            </tr>
          `).join('');
      }

      // Render ledger table in drawer
      const ledgerTbody = document.getElementById('drawer-ledger-tbody');
      if (ledgerTbody) {
        ledgerTbody.innerHTML = ledger.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:16px;">No transactions recorded.</td></tr>' :
          ledger.map(l => `
            <tr>
              <td><span class="status-pill active" style="font-size:0.7rem;">${l.type}</span></td>
              <td style="font-size:0.8rem;">${l.description}</td>
              <td style="font-family:var(--font-mono);font-weight:700;color:${l.amount >= 0 ? '#10b981' : '#f43f5e'};">${l.amount >= 0 ? '+' : ''}₹${l.amount.toFixed(2)}</td>
              <td style="font-family:var(--font-mono);">₹${l.balanceAfter.toFixed(2)}</td>
              <td style="font-size:0.75rem;color:var(--text-dim);">${new Date(l.createdAt).toLocaleTimeString()}</td>
            </tr>
          `).join('');
      }

      document.getElementById('user-drawer-modal').classList.add('open');
    } catch (e) {
      window.showToast('Failed to load user details', 'error');
    }
  }

  // Switch to player app as this user
  // Switch to player app as this user
  async loginAsUser(userId) {
    try {
      const res = await this.adminFetch(`/api/admin/login-as/${userId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('tiranga_token', data.token);
        localStorage.setItem('tiranga_user_id', data.user.id);
        localStorage.setItem('tiranga_user_profile', JSON.stringify(data.user));
        window.showToast(`Switched active player to [${data.user.name || userId}]! Opening Player App...`, 'success');
        setTimeout(() => {
          window.open('/', '_blank');
        }, 400);
      } else {
        window.showToast(data.error || 'Failed to switch player', 'error');
      }
    } catch (e) {
      window.showToast('Failed to switch player session', 'error');
    }
  }

  // Delete User
  async deleteUserAccount(userId) {
    if (!confirm(`Are you sure you want to permanently delete user account [${userId}]?`)) {
      return;
    }

    try {
      const res = await this.adminFetch(`/api/users/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        window.showToast('User deleted successfully', 'info');
        this.loadUsers();
        this.loadDashboardStats();
      } else {
        window.showToast(data.error || 'Failed to delete user', 'error');
      }
    } catch (e) {
      window.showToast('Failed to delete user', 'error');
    }
  }

  // ========================================================
  //             AUDIT LOGS CONTROLLER
  // ========================================================
  async loadAuditLogs() {
    try {
      const res = await this.adminFetch('/api/admin/audit-logs');
      const data = await res.json();
      if (data.success) {
        this.auditLogs = data.auditLogs;
        this.renderAuditLogs();
      }
    } catch (e) {
      console.error('Failed to load audit logs', e);
    }
  }

  renderAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    if (this.auditLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No settlements recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.auditLogs.slice(0, 30).map(log => {
      return `
        <tr>
          <td style="font-family:var(--font-mono);font-size:0.8rem;font-weight:700;">${log.periodId}</td>
          <td>
            <span class="num-cell-ball num-ball-${log.winningNumber}">${log.winningNumber}</span>
          </td>
          <td>
            <span class="method-tag ${log.determinationMethod}">
              ${log.determinationMethod === 'manual_override' ? '🎯 ADMIN FORCED' : log.determinationMethod === 'min_payout_algorithm' ? '🛡️ HOUSE MAX PROFIT' : '🎲 FAIR RANDOM'}
            </span>
          </td>
          <td style="font-family:var(--font-mono);">₹${log.totalWagered.toFixed(2)}</td>
          <td style="font-family:var(--font-mono);">₹${log.totalPayout.toFixed(2)}</td>
          <td style="font-family:var(--font-mono);font-weight:700;color:${log.houseProfit >= 0 ? '#10b981' : '#f43f5e'};">
            ${log.houseProfit >= 0 ? '+' : ''}₹${log.houseProfit.toFixed(2)}
          </td>
          <td style="font-size:0.75rem;color:var(--text-dim);">${new Date(log.timestamp).toLocaleTimeString()}</td>
        </tr>
      `;
    }).join('');
  }

  // ========================================================
  //             ALL BETS CONTROLLER
  // ========================================================
  async loadAllBets() {
    try {
      const res = await this.adminFetch('/api/admin/all-bets');
      const data = await res.json();
      if (data.success) {
        this.allBets = data.bets;
        this.renderAllBets();
      }
    } catch (e) {
      console.error('Failed to load all bets', e);
    }
  }

  renderAllBets() {
    const tbody = document.getElementById('all-bets-table-body');
    if (!tbody) return;

    if (this.allBets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No bets recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.allBets.map(b => {
      const statusClass = b.status === 'WON' ? 'text-green' : b.status === 'LOST' ? 'text-red' : 'text-gold';
      return `
        <tr>
          <td>
            <div style="font-weight:700;font-size:0.85rem;">${b.user_name || b.user_id}</div>
            <div style="font-size:0.7rem;color:var(--text-dim);font-family:var(--font-mono);">${b.user_mobile || ''}</div>
          </td>
          <td style="font-family:var(--font-mono);font-size:0.78rem;">${b.period_id}</td>
          <td style="font-size:0.8rem;">${b.game_key}</td>
          <td><span style="font-weight:700;text-transform:uppercase;">${b.option}</span></td>
          <td style="font-family:var(--font-mono);">₹${b.amount}</td>
          <td><span class="${statusClass}" style="font-weight:700;">${b.status}</span></td>
          <td style="font-family:var(--font-mono);font-weight:700;color:${b.payout > 0 ? '#10b981' : 'var(--text-muted)'};">₹${(b.payout || 0).toFixed(2)}</td>
          <td style="font-size:0.75rem;color:var(--text-dim);">${new Date(b.placed_at).toLocaleString()}</td>
        </tr>
      `;
    }).join('');
  }

  // ========================================================
  //             ALL LEDGER / PAYMENTS CONTROLLER
  // ========================================================
  async loadAllLedger() {
    try {
      const res = await this.adminFetch('/api/admin/all-ledger');
      const data = await res.json();
      if (data.success) {
        this.allLedger = data.ledger;
        this.renderAllLedger();
      }
    } catch (e) {
      console.error('Failed to load all ledger', e);
    }
  }

  renderAllLedger() {
    const tbody = document.getElementById('all-ledger-table-body');
    if (!tbody) return;

    if (this.allLedger.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">No transactions recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.allLedger.map(l => {
      const isCredit = l.amount >= 0;
      return `
        <tr>
          <td>
            <div style="font-weight:700;font-size:0.85rem;">${l.user_name || l.user_id}</div>
            <div style="font-size:0.7rem;color:var(--text-dim);font-family:var(--font-mono);">${l.user_mobile || ''}</div>
          </td>
          <td><span class="status-pill active" style="font-size:0.7rem;">${l.type}</span></td>
          <td style="font-size:0.8rem;">${l.description}</td>
          <td style="font-family:var(--font-mono);font-weight:700;color:${isCredit ? '#10b981' : '#f43f5e'};">${isCredit ? '+' : ''}₹${Math.abs(l.amount).toFixed(2)}</td>
          <td style="font-family:var(--font-mono);">₹${l.balance_after.toFixed(2)}</td>
          <td style="font-size:0.75rem;color:var(--text-dim);">${new Date(l.created_at).toLocaleString()}</td>
        </tr>
      `;
    }).join('');
  }

  // ========================================================
  //             DASHBOARD STATS CONTROLLER
  // ========================================================
  async loadDashboardStats() {
    try {
      const res = await this.adminFetch('/api/admin/dashboard-stats');
      const data = await res.json();
      if (data.success) {
        this.renderDashboardStats(data.stats);
      }
    } catch (e) {
      console.error('Failed to load dashboard stats', e);
    }
  }

  renderDashboardStats(stats) {
    const fmt = (v) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    
    const el = (id) => document.getElementById(id);
    if (el('dash-total-wagered')) el('dash-total-wagered').textContent = fmt(stats.totalWagered);
    if (el('dash-total-payouts')) el('dash-total-payouts').textContent = fmt(stats.totalPayouts);
    if (el('dash-house-profit')) {
      el('dash-house-profit').textContent = `${stats.totalHouseProfit >= 0 ? '+' : ''}${fmt(stats.totalHouseProfit)}`;
      el('dash-house-profit').className = `dash-stat-value ${stats.totalHouseProfit >= 0 ? 'text-green' : 'text-red'}`;
    }
    if (el('dash-total-bets')) el('dash-total-bets').textContent = stats.totalBets;
    if (el('dash-active-users')) el('dash-active-users').textContent = stats.activeUsers;
    if (el('dash-player-funds')) el('dash-player-funds').textContent = fmt(stats.totalPlayerBalance);
  }
}

// Global toast notification helper
window.showToast = function(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

// Initialize Admin Controller upon load
document.addEventListener('DOMContentLoaded', () => {
  window.adminCtrl = new AdminController();
  window.adminCtrl.init();
});
