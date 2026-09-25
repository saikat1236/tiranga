// Admin Panel Controller - Game Output & House Control

class AdminController {
  constructor() {
    this.currentGameKey = 'wingo_60';
    this.controlMode = 'manual';
    this.manualOverrideNumber = 7; // Default preset
    this.exposureData = null;
    this.usersList = [];
    this.auditLogs = [];
  }

  init() {
    this.bindEvents();
    this.loadExposure();
    this.loadUsers();
    this.loadAuditLogs();
  }

  bindEvents() {
    // Game switcher for admin
    const adminGameSelect = document.getElementById('admin-game-select');
    if (adminGameSelect) {
      adminGameSelect.addEventListener('change', (e) => {
        this.currentGameKey = e.target.value;
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

    // Clear Override Button
    const clearBtn = document.getElementById('btn-clear-override');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        await this.clearOverride();
      });
    }

    // Force Settle Now Button
    const forceSettleBtn = document.getElementById('btn-admin-force-settle');
    if (forceSettleBtn) {
      forceSettleBtn.addEventListener('click', async () => {
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

    // Refresh data button
    const refreshBtn = document.getElementById('btn-admin-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadExposure();
        this.loadUsers();
        this.loadAuditLogs();
        window.showToast('Admin data refreshed', 'info');
      });
    }

    // Balance adjust modal
    const submitAdjustBal = document.getElementById('btn-submit-adjust-bal');
    if (submitAdjustBal) {
      submitAdjustBal.addEventListener('click', async () => {
        const userId = document.getElementById('adjust-user-id').value;
        const newBal = parseFloat(document.getElementById('adjust-balance-val').value);
        if (!isNaN(newBal)) {
          await this.adjustUserBalance(userId, newBal);
          document.getElementById('adjust-balance-modal').classList.remove('open');
        }
      });
    }
  }

  updateFromTick(tickData) {
    if (!tickData.games) return;
    const game = tickData.games[this.currentGameKey];
    if (!game) return;

    // Update banner period & countdown
    const periodEl = document.getElementById('admin-live-period');
    const timerEl = document.getElementById('admin-live-timer');
    const betsCountEl = document.getElementById('admin-live-bets-count');

    if (periodEl) periodEl.textContent = game.periodId;
    if (timerEl) {
      const min = Math.floor(game.remainingSeconds / 60);
      const sec = game.remainingSeconds % 60;
      timerEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      if (game.remainingSeconds <= 5) {
        timerEl.style.color = '#ef4444';
      } else {
        timerEl.style.color = '#ffb703';
      }
    }
    if (betsCountEl) betsCountEl.textContent = game.activeBetsCount;

    // Update UI mode badges if changed
    if (game.controlMode !== this.controlMode || game.manualOverrideNumber !== this.manualOverrideNumber) {
      this.controlMode = game.controlMode;
      this.manualOverrideNumber = game.manualOverrideNumber;
      this.renderControlModeState();
    }
  }

  async setControlMode(mode) {
    try {
      const res = await window.api.setAdminMode(this.currentGameKey, mode);
      if (res.success) {
        this.controlMode = res.controlMode;
        this.manualOverrideNumber = res.manualOverrideNumber;
        this.renderControlModeState();
        window.showToast(`Game mode switched to ${mode.toUpperCase()}!`, 'success');
      }
    } catch (e) {
      window.showToast('Failed to switch mode', 'error');
    }
  }

  async forceWinningNumber(num) {
    try {
      const res = await window.api.setAdminOutcome(this.currentGameKey, num);
      if (res.success) {
        this.controlMode = 'manual';
        this.manualOverrideNumber = num;
        this.renderControlModeState();
        window.soundCtrl.playAlert();
        window.showToast(`🎯 TARGET LOCKED: Number [${num}] will win the next round!`, 'success');
      }
    } catch (e) {
      window.showToast('Failed to set outcome override', 'error');
    }
  }

  async clearOverride() {
    try {
      const res = await window.api.setAdminOutcome(this.currentGameKey, null);
      if (res.success) {
        this.manualOverrideNumber = null;
        this.renderControlModeState();
        window.showToast('Manual outcome cleared. Reverted to automatic mode.', 'info');
      }
    } catch (e) {
      window.showToast('Failed to clear override', 'error');
    }
  }

  async forceSettle() {
    try {
      const res = await window.api.forceSettle(this.currentGameKey);
      if (res.success) {
        window.soundCtrl.playWin();
        window.showToast('⚡ Round force-settled immediately!', 'success');
        this.loadExposure();
        this.loadAuditLogs();
        this.loadUsers();
      }
    } catch (e) {
      window.showToast('Failed to force settle', 'error');
    }
  }

  async speedTimer(seconds = 5) {
    try {
      const res = await window.api.speedTimer(this.currentGameKey, seconds);
      if (res.success) {
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

    // Update active override banner
    const bannerBox = document.getElementById('active-override-status-box');
    const labelEl = document.getElementById('active-override-label');

    // Highlight keypad
    document.querySelectorAll('.override-key-btn').forEach(key => {
      const keyNum = parseInt(key.dataset.num, 10);
      key.classList.toggle('selected', keyNum === this.manualOverrideNumber);
    });

    if (this.manualOverrideNumber !== null && this.manualOverrideNumber !== undefined) {
      if (bannerBox) {
        bannerBox.style.display = 'flex';
        bannerBox.style.border = '1px solid #ef4444';
        bannerBox.style.background = 'rgba(239, 68, 68, 0.15)';
      }
      if (labelEl) {
        const colorName = [1,3,7,9].includes(this.manualOverrideNumber) ? 'GREEN' :
                          [2,4,6,8].includes(this.manualOverrideNumber) ? 'RED' :
                          this.manualOverrideNumber === 0 ? 'RED + VIOLET' : 'GREEN + VIOLET';
        const sizeName = this.manualOverrideNumber >= 5 ? 'BIG' : 'SMALL';
        labelEl.innerHTML = `🎯 <strong>MANUAL OVERRIDE ACTIVE:</strong> Next Winning Outcome is Forced to <strong>[Number ${this.manualOverrideNumber}]</strong> (${colorName}, ${sizeName})`;
      }
    } else {
      if (bannerBox) {
        bannerBox.style.display = 'flex';
        bannerBox.style.border = '1px solid var(--border-light)';
        bannerBox.style.background = 'rgba(0, 0, 0, 0.2)';
      }
      if (labelEl) {
        let desc = 'No manual override. Outcome is fair random.';
        if (this.controlMode === 'min_payout') desc = '🛡️ House Profit Mode: Game will automatically pick the outcome with lowest payout!';
        if (this.controlMode === 'max_payout') desc = '🎁 Max Payout Mode: Outcome with highest player payout will be selected.';
        labelEl.innerHTML = desc;
      }
    }
  }

  async loadExposure() {
    try {
      const res = await window.api.getAdminExposure(this.currentGameKey);
      if (res.success) {
        this.exposureData = res.exposure;
        this.renderExposureTable();
        this.renderBetOptionBreakdown();
      }
    } catch (e) {
      console.error('Failed to load exposure', e);
    }
  }

  renderExposureTable() {
    const tbody = document.getElementById('exposure-table-body');
    if (!tbody || !this.exposureData) return;

    const { outcomeTable, suggestedMinPayoutNumber, totalWagered } = this.exposureData;

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
            <button class="btn-force-row" onclick="window.adminCtrl.forceWinningNumber(${row.number})" ${isSelected ? 'style="background:#10b981;border-color:#10b981;"' : ''}>
              ${isSelected ? '✓ SELECTED' : '🎯 Force Outcome'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderBetOptionBreakdown() {
    if (!this.exposureData) return;
    const { breakdownByOption, totalWagered, totalBetsCount } = this.exposureData;

    const wageredEl = document.getElementById('admin-total-wagered');
    if (wageredEl) wageredEl.textContent = `₹${totalWagered.toLocaleString('en-IN')}`;

    // Options breakdown summary
    const optSummary = document.getElementById('admin-options-breakdown');
    if (optSummary) {
      optSummary.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.8rem;font-family:var(--font-mono);">
          <span style="color:#00e676;">Green: ₹${breakdownByOption.green || 0}</span>
          <span style="color:#ff2a55;">Red: ₹${breakdownByOption.red || 0}</span>
          <span style="color:#a855f7;">Violet: ₹${breakdownByOption.violet || 0}</span>
          <span style="color:#f59e0b;">Big: ₹${breakdownByOption.big || 0}</span>
          <span style="color:#38bdf8;">Small: ₹${breakdownByOption.small || 0}</span>
        </div>
      `;
    }
  }

  async loadUsers() {
    try {
      const res = await window.api.getAdminUsers();
      if (res.success) {
        this.usersList = res.users;
        this.renderUsers();
      }
    } catch (e) {
      console.error('Failed to load users', e);
    }
  }

  renderUsers() {
    const grid = document.getElementById('admin-users-grid');
    if (!grid) return;

    grid.innerHTML = this.usersList.map(u => `
      <div class="user-manage-card">
        <div class="user-manage-header">
          <div>
            <div class="user-manage-name">${u.name}</div>
            <div style="font-size:0.75rem;color:var(--text-dim);font-family:var(--font-mono);">${u.mobile || u.id}</div>
          </div>
          <div class="user-manage-balance">₹${u.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);display:flex;justify-content:space-between;">
          <span>Total Bets: ${u.totalBetsCount}</span>
          <span>Wagered: ₹${u.totalWagered}</span>
          <span style="color:#10b981;">Won: ₹${u.totalWon}</span>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn btn-secondary" style="flex:1;padding:6px;font-size:0.8rem;" onclick="window.adminCtrl.openAdjustModal('${u.id}', ${u.balance})">
            ⚙️ Adjust Balance
          </button>
          <button class="btn btn-primary" style="flex:1;padding:6px;font-size:0.8rem;" onclick="window.adminCtrl.quickTopup('${u.id}', 1000)">
            +₹1,000 Topup
          </button>
        </div>
      </div>
    `).join('');
  }

  openAdjustModal(userId, currentBalance) {
    const modal = document.getElementById('adjust-balance-modal');
    document.getElementById('adjust-user-id').value = userId;
    document.getElementById('adjust-balance-val').value = currentBalance;
    modal.classList.add('open');
  }

  async quickTopup(userId, amount) {
    try {
      const user = this.usersList.find(u => u.id === userId);
      const newBal = (user ? user.balance : 0) + amount;
      await this.adjustUserBalance(userId, newBal);
    } catch (e) {
      window.showToast('Topup failed', 'error');
    }
  }

  async adjustUserBalance(userId, newBal) {
    try {
      const res = await window.api.adjustUserBalance(userId, newBal, 'Admin Manual Adjustment');
      if (res.success) {
        window.showToast(`Updated balance to ₹${newBal.toLocaleString('en-IN')}`, 'success');
        this.loadUsers();
      }
    } catch (e) {
      window.showToast('Balance adjustment failed', 'error');
    }
  }

  async loadAuditLogs() {
    try {
      const res = await window.api.getAuditLogs();
      if (res.success) {
        this.auditLogs = res.auditLogs;
        this.renderAuditLogs();
      }
    } catch (e) {
      console.error('Failed to load audit logs', e);
    }
  }

  renderAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    tbody.innerHTML = this.auditLogs.slice(0, 15).map(log => {
      return `
        <tr>
          <td style="font-family:var(--font-mono);font-size:0.78rem;">${log.periodId}</td>
          <td>
            <span class="num-cell-ball num-ball-${log.winningNumber}">${log.winningNumber}</span>
          </td>
          <td>
            <span class="method-tag ${log.determinationMethod}">
              ${log.determinationMethod === 'manual_override' ? '🎯 ADMIN FORCED' : log.determinationMethod === 'min_payout_algorithm' ? '🛡️ HOUSE MAX PROFIT' : '🎲 RANDOM'}
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
}

window.adminCtrl = new AdminController();
