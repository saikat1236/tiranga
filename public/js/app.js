// Player Application Orchestrator & UI Manager

class MainApp {
  constructor() {}

  async init() {
    this.bindGlobalEvents();
    this.setupModalDismissal();

    // Start WebSocket
    window.api.init();

    // Listen to WebSocket events
    window.api.on('INIT_STATE', (data) => {
      window.gameCtrl.setFullState(data);
    });

    window.api.on('TICK', (data) => {
      window.gameCtrl.updateFromTick(data);
    });

    window.api.on('ROUND_SETTLED', (data) => {
      window.gameCtrl.onRoundSettled(data);
    });

    window.api.on('BET_PLACED', (data) => {
      if (data.gameKey === window.gameCtrl.currentGameKey) {
        if (window.gameCtrl.activeTab === 'mybets') {
          window.gameCtrl.renderMyBets();
        }
      }
    });

    window.api.on('USER_UPDATED', (data) => {
      if (data.user && data.user.id === window.api.userId) {
        window.gameCtrl.renderUserState(data.user);
      }
    });

    // Initialize Game Sub-controller
    window.gameCtrl.init();

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
    // Mobile Bottom Navigation Buttons
    document.querySelectorAll('.mobile-nav-item[data-mobview]').forEach(navBtn => {
      navBtn.addEventListener('click', () => {
        const target = navBtn.dataset.mobview;

        // Update active class on nav
        document.querySelectorAll('.mobile-nav-item[data-mobview]').forEach(b => b.classList.remove('active'));
        navBtn.classList.add('active');

        if (target === 'game') {
          const recordTab = document.querySelector('.history-nav-tab[data-tab="record"]');
          if (recordTab) recordTab.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (target === 'trend') {
          const trendTab = document.querySelector('.history-nav-tab[data-tab="trend"]');
          if (trendTab) trendTab.click();
          const histSec = document.querySelector('.history-section');
          if (histSec) histSec.scrollIntoView({ behavior: 'smooth' });
        } else if (target === 'mybets') {
          const betsTab = document.querySelector('.history-nav-tab[data-tab="mybets"]');
          if (betsTab) betsTab.click();
          const histSec = document.querySelector('.history-section');
          if (histSec) histSec.scrollIntoView({ behavior: 'smooth' });
        } else if (target === 'switchuser') {
          window.gameCtrl.openAccountModal();
        }
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

  setupModalDismissal() {
    // Close modal triggers
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
}

// Global Toast System
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

// Initialize App upon DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new MainApp();
  window.app.init();
});
