// Main Application Controller & View Orchestrator

class MainApp {
  constructor() {
    this.currentViewMode = 'split'; // 'player' | 'admin' | 'split'
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
    // View Switcher Buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.view;
        this.setViewMode(mode);
      });
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
