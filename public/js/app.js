class MainApp {
  constructor() {
    // Automatically detect mobile / tablet screens
    const isMobileOrTablet = window.innerWidth < 1024;
    this.currentViewMode = isMobileOrTablet ? 'player' : 'split';
  }

  async init() {
    this.bindGlobalEvents();
    this.setupModalDismissal();

    // Start WebSocket
    window.api.init();

    // Listen to WebSocket events
    window.api.on('INIT_STATE', (data) => {
      window.gameCtrl.setFullState(data);
      window.adminCtrl.loadExposure();
      window.adminCtrl.loadUsers();
      window.adminCtrl.loadAuditLogs();
    });

    window.api.on('TICK', (data) => {
      window.gameCtrl.updateFromTick(data);
      window.adminCtrl.updateFromTick(data);
    });

    window.api.on('ROUND_SETTLED', (data) => {
      window.gameCtrl.onRoundSettled(data);
      window.adminCtrl.loadExposure();
      window.adminCtrl.loadAuditLogs();
      window.adminCtrl.loadUsers();
    });

    window.api.on('BET_PLACED', (data) => {
      if (data.gameKey === window.gameCtrl.currentGameKey) {
        if (window.gameCtrl.activeTab === 'mybets') {
          window.gameCtrl.renderMyBets();
        }
      }
      if (data.gameKey === window.adminCtrl.currentGameKey) {
        window.adminCtrl.loadExposure();
      }
    });

    window.api.on('USER_UPDATED', (data) => {
      if (data.user && data.user.id === window.api.userId) {
        window.gameCtrl.renderUserState(data.user);
      }
      window.adminCtrl.loadUsers();
    });

    window.api.on('ADMIN_OUTCOME_PRESET', (data) => {
      if (data.gameKey === window.adminCtrl.currentGameKey) {
        window.adminCtrl.manualOverrideNumber = data.manualOverrideNumber;
        window.adminCtrl.controlMode = data.controlMode;
        window.adminCtrl.renderControlModeState();
      }
    });

    // Initialize sub-controllers
    window.gameCtrl.init();
    window.adminCtrl.init();

    // Set initial view mode
    this.setViewMode(this.currentViewMode);

    // Initial state fetch as fallback
    try {
      const state = await window.api.getState();
      if (state.success) {
        window.gameCtrl.setFullState(state);
      }
    } catch (e) {
      console.warn('Initial REST state fetch error', e);
    }
  }

  bindGlobalEvents() {
    // Top View Switcher Buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.view;
        this.setViewMode(mode);
      });
    });

    // Mobile Bottom Navigation Buttons
    document.querySelectorAll('.mobile-nav-item').forEach(navBtn => {
      navBtn.addEventListener('click', () => {
        const target = navBtn.dataset.mobview;
        if (target === 'game') {
          this.setViewMode('player');
          // Switch to record tab
          const recordTab = document.querySelector('.history-nav-tab[data-tab="record"]');
          if (recordTab) recordTab.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (target === 'trend') {
          this.setViewMode('player');
          const trendTab = document.querySelector('.history-nav-tab[data-tab="trend"]');
          if (trendTab) trendTab.click();
          const histSec = document.querySelector('.history-section');
          if (histSec) histSec.scrollIntoView({ behavior: 'smooth' });
        } else if (target === 'mybets') {
          this.setViewMode('player');
          const betsTab = document.querySelector('.history-nav-tab[data-tab="mybets"]');
          if (betsTab) betsTab.click();
          const histSec = document.querySelector('.history-section');
          if (histSec) histSec.scrollIntoView({ behavior: 'smooth' });
        } else if (target === 'admin') {
          this.setViewMode('admin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });

    // Handle screen resize smoothly
    window.addEventListener('resize', () => {
      if (window.innerWidth < 1024 && this.currentViewMode === 'split') {
        this.setViewMode('player');
      }
    });

    // Audio Mute/Unmute Toggle
    const soundToggleBtn = document.getElementById('btn-sound-toggle');
    if (soundToggleBtn) {
      soundToggleBtn.addEventListener('click', () => {
        const isMuted = window.soundCtrl.toggleMute();
        soundToggleBtn.textContent = isMuted ? '🔇' : '🔊';
        window.showToast(isMuted ? 'Audio muted' : 'Audio enabled', 'info');
      });
    }

    // Rules Modal trigger
    const rulesBtn = document.getElementById('btn-how-to-play');
    if (rulesBtn) {
      rulesBtn.addEventListener('click', () => {
        document.getElementById('rules-modal').classList.add('open');
      });
    }
  }

  setViewMode(mode) {
    this.currentViewMode = mode;

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });

    // Update bottom nav active indicators
    document.querySelectorAll('.mobile-nav-item').forEach(navBtn => {
      const mobTarget = navBtn.dataset.mobview;
      if (mode === 'admin') {
        navBtn.classList.toggle('active', mobTarget === 'admin');
        navBtn.classList.toggle('admin-active', mobTarget === 'admin');
      } else {
        navBtn.classList.toggle('admin-active', false);
        if (mobTarget === 'admin') {
          navBtn.classList.remove('active');
        } else if (mobTarget === 'game' && mode === 'player') {
          navBtn.classList.add('active');
        }
      }
    });

    const mainContainer = document.getElementById('main-content-container');
    const playerPanel = document.getElementById('player-app-panel');
    const adminPanel = document.getElementById('admin-app-panel');

    // Reset layout classes
    mainContainer.className = 'main-wrapper';

    if (mode === 'player') {
      mainContainer.classList.add('single-mode-player');
      playerPanel.style.display = 'block';
      adminPanel.style.display = 'none';
    } else if (mode === 'admin') {
      mainContainer.classList.add('single-mode-admin');
      playerPanel.style.display = 'none';
      adminPanel.style.display = 'block';
    } else if (mode === 'split') {
      mainContainer.classList.add('split-mode-container');
      playerPanel.style.display = 'block';
      adminPanel.style.display = 'block';
    }
  }

  setupModalDismissal() {
    // Close modals on clicking overlay or close buttons
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('modal-close-btn') || e.target.closest('.modal-close-btn')) {
          modal.classList.remove('open');
        }
      });
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      }
    });
  }
}

// Global Toast System
window.showToast = function(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span style="font-weight:900;">${icon}</span> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

// Auto-boot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new MainApp();
  window.app.init();
});
