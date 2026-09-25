// Player Game UI & Controller

class GameController {
  constructor() {
    this.currentGameKey = 'wingo_60';
    this.gameState = null;
    this.userState = null;
    this.activeTab = 'record'; // 'record' | 'trend' | 'mybets' | 'ledger'
    
    // Betting Dialog State
    this.selectedOption = null;
    this.baseUnit = 10;
    this.quantity = 1;
    this.multiplier = 1;

    this.confettiCanvas = null;
  }

  init() {
    this.bindEvents();
    this.setupConfetti();
  }

  setupConfetti() {
    this.confettiCanvas = document.getElementById('confetti-canvas');
  }

  bindEvents() {
    // Game Duration Tabs
    document.querySelectorAll('.game-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = btn.dataset.game;
        this.switchGameMode(key);
      });
    });

    // Color buttons
    document.querySelectorAll('.btn-bet-color').forEach(btn => {
      btn.addEventListener('click', () => {
        const opt = btn.dataset.option;
        this.openBetModal(opt, 'color');
      });
    });

    // Number buttons
    document.querySelectorAll('.btn-bet-num').forEach(btn => {
      btn.addEventListener('click', () => {
        const opt = btn.dataset.num;
        this.openBetModal(opt, 'number');
      });
    });

    // Big / Small buttons
    document.querySelectorAll('.btn-bet-size').forEach(btn => {
      btn.addEventListener('click', () => {
        const opt = btn.dataset.size;
        this.openBetModal(opt, 'size');
      });
    });

    // History Nav Tabs
    document.querySelectorAll('.history-nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.history-nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.tab;
        this.renderHistoryTab();
      });
    });

    // Modal Qty controls
    const minusBtn = document.getElementById('bet-qty-minus');
    const plusBtn = document.getElementById('bet-qty-plus');
    const qtyInput = document.getElementById('bet-qty-input');

    if (minusBtn && plusBtn && qtyInput) {
      minusBtn.addEventListener('click', () => {
        if (this.quantity > 1) {
          this.quantity--;
          qtyInput.value = this.quantity;
          this.updateBetCalculation();
        }
      });

      plusBtn.addEventListener('click', () => {
        this.quantity++;
        qtyInput.value = this.quantity;
        this.updateBetCalculation();
      });

      qtyInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.quantity = isNaN(val) || val < 1 ? 1 : val;
        this.updateBetCalculation();
      });
    }

    // Modal Base chips (1, 10, 100, 1000)
    document.querySelectorAll('.bet-chip-btn').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.bet-chip-btn').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.baseUnit = parseInt(chip.dataset.unit, 10);
        this.updateBetCalculation();
      });
    });

    // Modal Multipliers (X1, X5, X10, X20, X50, X100)
    document.querySelectorAll('.multi-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.multi-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.multiplier = parseInt(btn.dataset.mult, 10);
        this.updateBetCalculation();
      });
    });

    // Confirm Bet Button
    const confirmBetBtn = document.getElementById('btn-confirm-bet');
    if (confirmBetBtn) {
      confirmBetBtn.addEventListener('click', () => this.submitBet());
    }

    // Quick recharge chips in wallet card
    document.querySelectorAll('.wallet-chip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const amt = parseInt(btn.dataset.recharge, 10);
        await this.handleRecharge(amt);
      });
    });

    // Recharge modal trigger
    const openRechargeBtn = document.getElementById('btn-open-recharge');
    if (openRechargeBtn) {
      openRechargeBtn.addEventListener('click', () => {
        document.getElementById('recharge-modal').classList.add('open');
      });
    }

    const submitRechargeBtn = document.getElementById('btn-submit-recharge');
    if (submitRechargeBtn) {
      submitRechargeBtn.addEventListener('click', async () => {
        const amt = parseInt(document.getElementById('recharge-amount-input').value, 10);
        if (!isNaN(amt) && amt > 0) {
          await this.handleRecharge(amt);
          document.getElementById('recharge-modal').classList.remove('open');
        }
      });
    }
  }

  switchGameMode(gameKey) {
    this.currentGameKey = gameKey;
    document.querySelectorAll('.game-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.game === gameKey);
    });

    // Update active game titles
    const game = this.gameState ? this.gameState[gameKey] : null;
    if (game) {
      const titleEl = document.getElementById('current-game-title');
      if (titleEl) titleEl.textContent = game.name;
    }

    this.renderCurrentRound();
    this.renderHistoryTab();
  }

  updateFromTick(tickData) {
    if (!tickData.games) return;
    const gameTick = tickData.games[this.currentGameKey];
    if (!gameTick) return;

    // Update digital flip countdown
    this.renderCountdown(gameTick.remainingSeconds, gameTick.status);

    // Update period number
    const periodEl = document.getElementById('current-period-num');
    if (periodEl && gameTick.periodId) {
      periodEl.textContent = gameTick.periodId;
    }

    // Toggle locked overlay
    const boardEl = document.getElementById('betting-board-container');
    const headerCard = document.getElementById('round-header-card');
    const lockedNum = document.getElementById('locked-countdown-num');

    if (gameTick.remainingSeconds <= 5) {
      if (boardEl) boardEl.classList.add('locked');
      if (headerCard) headerCard.classList.add('is-locked');
      if (lockedNum) lockedNum.textContent = gameTick.remainingSeconds;
      if (gameTick.remainingSeconds <= 5 && gameTick.remainingSeconds > 0) {
        window.soundCtrl.playTick(400); // lower urgent pitch
      }
    } else {
      if (boardEl) boardEl.classList.remove('locked');
      if (headerCard) headerCard.classList.remove('is-locked');
      window.soundCtrl.playTick(800); // normal clock tick
    }
  }

  renderCountdown(seconds, status) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;

    const mStr = String(min).padStart(2, '0');
    const sStr = String(sec).padStart(2, '0');

    const m0 = document.getElementById('digit-m0');
    const m1 = document.getElementById('digit-m1');
    const s0 = document.getElementById('digit-s0');
    const s1 = document.getElementById('digit-s1');

    if (m0) m0.textContent = mStr[0];
    if (m1) m1.textContent = mStr[1];
    if (s0) s0.textContent = sStr[0];
    if (s1) s1.textContent = sStr[1];
  }

  renderUserState(user) {
    this.userState = user;
    const balFormatted = `₹${parseFloat(user.balance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const walletPill = document.getElementById('header-wallet-balance');
    const heroBal = document.getElementById('hero-wallet-balance');

    if (walletPill) walletPill.textContent = balFormatted;
    if (heroBal) heroBal.textContent = balFormatted;
  }

  setFullState(data) {
    this.gameState = data.games;
    if (data.user) this.renderUserState(data.user);
    this.renderCurrentRound();
    this.renderHistoryTab();
  }

  renderCurrentRound() {
    if (!this.gameState) return;
    const game = this.gameState[this.currentGameKey];
    if (!game) return;

    const periodEl = document.getElementById('current-period-num');
    if (periodEl) periodEl.textContent = game.currentPeriod;

    const gameTitleEl = document.getElementById('current-game-title');
    if (gameTitleEl) gameTitleEl.textContent = game.name;

    this.renderCountdown(game.remainingSeconds, game.status);
  }

  openBetModal(option, type) {
    const game = this.gameState ? this.gameState[this.currentGameKey] : null;
    if (game && game.remainingSeconds <= 5) {
      window.showToast('Round is locked. Please wait for next period.', 'error');
      return;
    }

    this.selectedOption = option;
    this.quantity = 1;
    this.multiplier = 1;

    const modal = document.getElementById('bet-drawer-modal');
    const titleBadge = document.getElementById('modal-bet-target');
    const qtyInput = document.getElementById('bet-qty-input');

    if (qtyInput) qtyInput.value = 1;

    // Reset chip active state
    document.querySelectorAll('.bet-chip-btn').forEach(c => {
      c.classList.toggle('active', parseInt(c.dataset.unit, 10) === this.baseUnit);
    });
    document.querySelectorAll('.multi-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.mult, 10) === 1);
    });

    let headerBg = '#182030';
    let text = `Select ${option.toUpperCase()}`;

    if (type === 'color') {
      if (option === 'green') headerBg = '#059669';
      if (option === 'red') headerBg = '#e11d48';
      if (option === 'violet') headerBg = '#9333ea';
      text = `Win Go ${game ? game.name : ''} - Select ${option.toUpperCase()}`;
    } else if (type === 'number') {
      headerBg = '#2563eb';
      text = `Win Go ${game ? game.name : ''} - Select Number [${option}]`;
    } else if (type === 'size') {
      headerBg = option.toLowerCase() === 'big' ? '#d97706' : '#0284c7';
      text = `Win Go ${game ? game.name : ''} - Select [${option.toUpperCase()}]`;
    }

    const drawerHeader = document.getElementById('bet-drawer-header-box');
    if (drawerHeader) drawerHeader.style.background = headerBg;
    if (titleBadge) titleBadge.textContent = text;

    this.updateBetCalculation();
    modal.classList.add('open');
  }

  updateBetCalculation() {
    const totalAmount = this.baseUnit * this.quantity * this.multiplier;
    const netContract = totalAmount * 0.98; // 2% service charge
    const fee = totalAmount * 0.02;

    const totalEl = document.getElementById('calc-total-amount');
    const netEl = document.getElementById('calc-net-contract');
    const feeEl = document.getElementById('calc-fee-amount');

    if (totalEl) totalEl.textContent = `₹${totalAmount.toLocaleString('en-IN')}`;
    if (netEl) netEl.textContent = `₹${netContract.toFixed(2)}`;
    if (feeEl) feeEl.textContent = `₹${fee.toFixed(2)}`;
  }

  async submitBet() {
    const totalAmount = this.baseUnit * this.quantity * this.multiplier;

    if (!this.userState || this.userState.balance < totalAmount) {
      window.showToast('Insufficient wallet balance! Please recharge demo credits.', 'error');
      return;
    }

    try {
      const res = await window.api.placeBet(this.currentGameKey, this.selectedOption, totalAmount);
      if (res.success) {
        window.soundCtrl.playBetPlaced();
        window.showToast(`Bet of ₹${totalAmount} placed on ${this.selectedOption.toUpperCase()}!`, 'success');
        document.getElementById('bet-drawer-modal').classList.remove('open');
        this.renderUserState({ ...this.userState, balance: res.newBalance });
        if (this.activeTab === 'mybets') this.renderMyBets();
      } else {
        window.showToast(res.error || 'Failed to place bet', 'error');
      }
    } catch (e) {
      window.showToast('Network error while placing bet', 'error');
    }
  }

  async handleRecharge(amount) {
    try {
      const res = await window.api.rechargeWallet(amount);
      if (res.success) {
        window.soundCtrl.playWin();
        window.showToast(`Successfully added ₹${amount.toLocaleString('en-IN')} demo credits!`, 'success');
        this.renderUserState({ ...this.userState, balance: res.balance });
      }
    } catch (e) {
      window.showToast('Recharge failed', 'error');
    }
  }

  onRoundSettled(data) {
    if (data.gameKey === this.currentGameKey) {
      // Update local history
      if (this.gameState && this.gameState[this.currentGameKey]) {
        this.gameState[this.currentGameKey].history.unshift(data.result);
      }
      this.renderHistoryTab();

      // Check if current user had any bets in this round
      const mySettlements = (data.settlementDetails || []).filter(s => s.userId === window.api.userId);
      if (mySettlements.length > 0) {
        let totalWon = 0;
        let anyWin = false;

        mySettlements.forEach(s => {
          if (s.isWin) {
            anyWin = true;
            totalWon += s.payout;
          }
        });

        if (anyWin) {
          window.soundCtrl.playWin();
          this.triggerCelebration(totalWon, data.result);
        } else {
          window.soundCtrl.playLose();
          window.showToast(`Period ${data.result.periodId} ended. Result: [${data.result.number} ${data.result.size}]. Better luck next time!`, 'info');
        }
      }
    }
  }

  triggerCelebration(payoutAmount, result) {
    const modal = document.getElementById('win-celebration-modal');
    const amtEl = document.getElementById('win-modal-amount');
    const descEl = document.getElementById('win-modal-desc');

    if (amtEl) amtEl.textContent = `+₹${payoutAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    if (descEl) descEl.textContent = `Period: ${result.periodId} | Winning Number: ${result.number} (${result.size})`;

    modal.classList.add('open');
    this.launchConfetti();
  }

  launchConfetti() {
    if (!this.confettiCanvas) return;
    const ctx = this.confettiCanvas.getContext('2d');
    this.confettiCanvas.width = window.innerWidth;
    this.confettiCanvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#00e676', '#ff2a55', '#a855f7', '#ffb703', '#ffffff'];

    for (let i = 0; i < 90; i++) {
      particles.push({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        vx: (Math.random() - 0.5) * 16,
        vy: (Math.random() - 0.7) * 16,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        spin: (Math.random() - 0.5) * 10,
        life: 100
      });
    }

    let frame = 0;
    const animate = () => {
      frame++;
      ctx.clearRect(0, 0, this.confettiCanvas.width, this.confettiCanvas.height);

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35; // gravity
        p.rotation += p.spin;
        p.life -= 1.2;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.life / 100);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });

      if (frame < 120) {
        requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, this.confettiCanvas.width, this.confettiCanvas.height);
      }
    };

    animate();
  }

  renderHistoryTab() {
    if (this.activeTab === 'record') {
      this.renderGameRecord();
    } else if (this.activeTab === 'trend') {
      this.renderTrendChart();
    } else if (this.activeTab === 'mybets') {
      this.renderMyBets();
    } else if (this.activeTab === 'ledger') {
      this.renderWalletLedger();
    }
  }

  renderGameRecord() {
    const tbody = document.getElementById('record-table-body');
    if (!tbody || !this.gameState) return;

    const game = this.gameState[this.currentGameKey];
    if (!game || !game.history) return;

    tbody.innerHTML = game.history.map(item => {
      const numClass = `num-ball-${item.number}`;
      const sizeClass = item.size.toLowerCase();

      let colorDots = '';
      if (item.colors) {
        colorDots = item.colors.map(c => `<span class="color-dot" style="background:${c === 'red' ? '#ff2a55' : c === 'green' ? '#00e676' : '#a855f7'}"></span>`).join('');
      } else {
        colorDots = `<span class="color-dot" style="background:${item.color === 'red' ? '#ff2a55' : item.color === 'green' ? '#00e676' : '#a855f7'}"></span>`;
      }

      return `
        <tr>
          <td class="period-cell">${item.periodId}</td>
          <td><span class="num-cell-ball ${numClass}">${item.number}</span></td>
          <td><span class="size-pill ${sizeClass}">${item.size}</span></td>
          <td><div class="color-dots-group">${colorDots}</div></td>
        </tr>
      `;
    }).join('');
  }

  renderTrendChart() {
    const container = document.getElementById('trend-chart-mount');
    if (!container || !this.gameState) return;

    const game = this.gameState[this.currentGameKey];
    if (!game || !game.history) return;

    const historyItems = game.history.slice(0, 15);

    let html = `
      <table class="trend-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>0</th><th>1</th><th>2</th><th>3</th><th>4</th>
            <th>5</th><th>6</th><th>7</th><th>8</th><th>9</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
    `;

    historyItems.forEach(item => {
      const shortPeriod = item.periodId.slice(-4);
      let cells = '';
      for (let n = 0; n <= 9; n++) {
        if (n === item.number) {
          const numClass = `num-ball-${n}`;
          cells += `<td><div class="trend-num-active ${numClass}">${n}</div></td>`;
        } else {
          cells += `<td style="color:var(--text-dim);">${n}</td>`;
        }
      }

      html += `
        <tr>
          <td style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">${shortPeriod}</td>
          ${cells}
          <td><span class="size-pill ${item.size.toLowerCase()}">${item.size[0]}</span></td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  async renderMyBets() {
    const listEl = document.getElementById('my-bets-list-mount');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading your bets...</div>';

    try {
      const res = await window.api.getMyBets(this.currentGameKey);
      if (res.success && res.bets.length > 0) {
        listEl.innerHTML = res.bets.map(bet => {
          const isPending = bet.status === 'PENDING';
          const isWon = bet.status === 'WON';
          const statusClass = isPending ? 'pending' : isWon ? 'won' : 'lost';

          return `
            <div class="bet-history-card">
              <div class="bet-item-left">
                <span class="bet-period-tag">Period: ${bet.periodId}</span>
                <div class="bet-option-name">
                  <span>Choice:</span>
                  <span style="color:var(--color-gold);text-transform:uppercase;">${bet.option}</span>
                </div>
              </div>
              <div class="bet-item-right">
                <span class="bet-stake-amt">Stake: ₹${bet.amount}</span>
                <span class="bet-status-pill ${statusClass}">
                  ${isWon ? `+₹${bet.payout.toFixed(2)} WON` : isPending ? 'WAITING' : 'LOST'}
                </span>
              </div>
            </div>
          `;
        }).join('');
      } else {
        listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">No bets placed yet in this mode. Choose a color or number above to play!</div>';
      }
    } catch (e) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-red);">Error loading bets</div>';
    }
  }

  async renderWalletLedger() {
    const listEl = document.getElementById('ledger-list-mount');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading ledger records...</div>';

    try {
      const res = await window.api.getWalletLedger();
      if (res.success && res.ledger.length > 0) {
        listEl.innerHTML = res.ledger.map(entry => {
          const isCredit = entry.amount > 0;
          return `
            <div class="bet-history-card">
              <div class="bet-item-left">
                <span style="font-size:0.75rem;color:var(--text-dim);font-family:var(--font-mono);">${new Date(entry.createdAt).toLocaleTimeString()}</span>
                <span style="font-size:0.85rem;font-weight:600;">${entry.description}</span>
                <span style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-mono);">Ref: ${entry.referenceId}</span>
              </div>
              <div class="bet-item-right">
                <span style="font-family:var(--font-mono);font-weight:800;color:${isCredit ? '#10b981' : '#f43f5e'};font-size:0.95rem;">
                  ${isCredit ? '+' : ''}₹${Math.abs(entry.amount).toFixed(2)}
                </span>
                <span style="font-size:0.75rem;color:var(--text-dim);font-family:var(--font-mono);">Bal: ₹${entry.balanceAfter.toFixed(2)}</span>
              </div>
            </div>
          `;
        }).join('');
      } else {
        listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">No transactions recorded yet.</div>';
      }
    } catch (e) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-red);">Error loading ledger</div>';
    }
  }
}

window.gameCtrl = new GameController();
