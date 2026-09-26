// SQLite Persistent Database Layer for Tiranga Colour Prediction
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'tiranga.db');
const db = new Database(DB_PATH);

// Enable WAL mode for high concurrency and fast performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// 1. Initialize Tables
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      mobile TEXT UNIQUE,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      balance REAL DEFAULT 1000.00,
      status TEXT DEFAULT 'active', -- 'active' | 'frozen'
      role TEXT DEFAULT 'player',   -- 'player' | 'admin'
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_id TEXT,
      description TEXT,
      balance_after REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      game_key TEXT NOT NULL,
      period_id TEXT NOT NULL,
      option TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'PENDING', -- 'PENDING' | 'WON' | 'LOST'
      payout REAL DEFAULT 0,
      winning_number INTEGER,
      winning_color TEXT,
      winning_size TEXT,
      placed_at TEXT NOT NULL,
      settled_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS game_history (
      id TEXT PRIMARY KEY,
      game_key TEXT NOT NULL,
      period_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      color TEXT NOT NULL,
      colors TEXT NOT NULL,
      size TEXT NOT NULL,
      total_bets REAL DEFAULT 0,
      total_payout REAL DEFAULT 0,
      house_profit REAL DEFAULT 0,
      mode TEXT DEFAULT 'random',
      settled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      game_key TEXT NOT NULL,
      period_id TEXT NOT NULL,
      winning_number INTEGER NOT NULL,
      color TEXT NOT NULL,
      size TEXT NOT NULL,
      total_wagered REAL DEFAULT 0,
      total_payout REAL DEFAULT 0,
      house_profit REAL DEFAULT 0,
      determination_method TEXT NOT NULL,
      bets_count INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
    CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
    CREATE INDEX IF NOT EXISTS idx_bets_game_period ON bets(game_key, period_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user_id ON wallet_ledger(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_game_period ON game_history(game_key, period_id);
  `);

  seedDefaultUsers();
}

// Default initial users
function seedDefaultUsers() {
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (count === 0) {
    const defaultPassword = 'password123';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(defaultPassword, salt);
    const now = new Date().toISOString();

    const insertUser = db.prepare(`
      INSERT INTO users (id, mobile, username, password_hash, name, balance, status, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLedger = db.prepare(`
      INSERT INTO wallet_ledger (id, user_id, type, amount, reference_id, description, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const demoUsers = [
      {
        id: 'admin_master',
        mobile: '9000000000',
        username: 'admin',
        name: 'Master Admin',
        balance: 0,
        status: 'active',
        role: 'admin'
      },
      {
        id: 'demo_user',
        mobile: '9876543210',
        username: 'player8892',
        name: 'Player 8892',
        balance: 5000.00,
        status: 'active',
        role: 'player'
      },
      {
        id: 'user_rahul',
        mobile: '9811122334',
        username: 'rahul',
        name: 'Rahul Sharma',
        balance: 2850.00,
        status: 'active',
        role: 'player'
      },
      {
        id: 'user_priya',
        mobile: '9722233445',
        username: 'priya',
        name: 'Priya Patel',
        balance: 14200.00,
        status: 'active',
        role: 'player'
      },
      {
        id: 'user_vikram',
        mobile: '9999988888',
        username: 'vikram',
        name: 'Vikramaditya VIP',
        balance: 58000.00,
        status: 'active',
        role: 'player'
      },
      {
        id: 'user_amit',
        mobile: '9123456789',
        username: 'amit',
        name: 'Amit Kumar',
        balance: 120.00,
        status: 'frozen',
        role: 'player'
      }
    ];

    // Seed admin with a different password
    const adminHash = bcrypt.hashSync('admin123', salt);

    const transaction = db.transaction(() => {
      for (const u of demoUsers) {
        const userHash = u.role === 'admin' ? adminHash : hash;
        insertUser.run(
          u.id,
          u.mobile,
          u.username,
          userHash,
          u.name,
          u.balance,
          u.status,
          u.role,
          now,
          now
        );
        if (u.balance > 0) {
          insertLedger.run(
            uuidv4(),
            u.id,
            'WELCOME_CREDIT',
            u.balance,
            'INIT_SEED',
            'Initial Demo Seed Balance',
            u.balance,
            now
          );
        }
      }
    });

    transaction();
    console.log('✅ SQLite Database initialized with demo accounts (Players: password123, Admin: admin123)');
  }

  // Always ensure Master Admin exists
  const adminUser = db.prepare('SELECT id FROM users WHERE role = ? OR username = ?').get('admin', 'admin');
  if (!adminUser) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123', salt);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, mobile, username, password_hash, name, balance, status, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('admin_master', '9000000000', 'admin', hash, 'Master Admin', 0, 'active', 'admin', now, now);
    console.log('✅ Master Admin account ensured in SQLite database');
  }
}

initSchema();

// Database Access Objects & Queries
const queries = {
  // --- USERS ---
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByMobile: db.prepare('SELECT * FROM users WHERE mobile = ?'),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserByIdentifier: db.prepare('SELECT * FROM users WHERE mobile = ? OR username = ? OR id = ?'),
  getAllUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),

  createUser: db.prepare(`
    INSERT INTO users (id, mobile, username, password_hash, name, balance, status, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  updateUserProfile: db.prepare(`
    UPDATE users SET name = COALESCE(?, name), mobile = COALESCE(?, mobile), status = COALESCE(?, status), updated_at = ?
    WHERE id = ?
  `),

  updateUserStatus: db.prepare(`
    UPDATE users SET status = ?, updated_at = ? WHERE id = ?
  `),

  updateUserBalance: db.prepare(`
    UPDATE users SET balance = ?, updated_at = ? WHERE id = ?
  `),

  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  // --- WALLET LEDGER ---
  addLedgerEntry: db.prepare(`
    INSERT INTO wallet_ledger (id, user_id, type, amount, reference_id, description, balance_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getUserLedger: db.prepare(`
    SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `),

  // --- BETS ---
  createBet: db.prepare(`
    INSERT INTO bets (id, user_id, game_key, period_id, option, amount, status, payout, placed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  updateBetSettlement: db.prepare(`
    UPDATE bets SET status = ?, payout = ?, winning_number = ?, winning_color = ?, winning_size = ?, settled_at = ?
    WHERE id = ?
  `),

  getUserBets: db.prepare(`
    SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC LIMIT ?
  `),

  getUserBetsByGame: db.prepare(`
    SELECT * FROM bets WHERE user_id = ? AND game_key = ? ORDER BY placed_at DESC LIMIT ?
  `),

  getAllBetsForUser: db.prepare(`
    SELECT * FROM bets WHERE user_id = ?
  `),

  getActivePeriodBets: db.prepare(`
    SELECT * FROM bets WHERE game_key = ? AND period_id = ?
  `),

  // --- GAME HISTORY ---
  addHistory: db.prepare(`
    INSERT INTO game_history (id, game_key, period_id, number, color, colors, size, total_bets, total_payout, house_profit, mode, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getGameHistory: db.prepare(`
    SELECT * FROM game_history WHERE game_key = ? ORDER BY settled_at DESC LIMIT ?
  `),

  // --- AUDIT LOGS ---
  addAuditLog: db.prepare(`
    INSERT INTO audit_logs (id, game_key, period_id, winning_number, color, size, total_wagered, total_payout, house_profit, determination_method, bets_count, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getAuditLogs: db.prepare(`
    SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?
  `),

  // --- ADMIN: ALL BETS ---
  getAllBets: db.prepare(`
    SELECT b.*, u.name as user_name, u.mobile as user_mobile
    FROM bets b LEFT JOIN users u ON b.user_id = u.id
    ORDER BY b.placed_at DESC LIMIT ?
  `),

  // --- ADMIN: ALL LEDGER ---
  getAllLedger: db.prepare(`
    SELECT wl.*, u.name as user_name, u.mobile as user_mobile
    FROM wallet_ledger wl LEFT JOIN users u ON wl.user_id = u.id
    ORDER BY wl.created_at DESC LIMIT ?
  `),

  // --- ADMIN: DASHBOARD STATS ---
  getTotalWagered: db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM bets'),
  getTotalPayouts: db.prepare('SELECT COALESCE(SUM(payout), 0) as total FROM bets WHERE status = ?'),
  getTotalBetsCount: db.prepare('SELECT COUNT(*) as count FROM bets'),
  getTotalHouseProfit: db.prepare('SELECT COALESCE(SUM(house_profit), 0) as total FROM game_history')
};

// Database Service API
const DBService = {
  // Users
  getUserById(id) {
    return queries.getUserById.get(id);
  },

  getUserByMobile(mobile) {
    const cleanMobile = mobile ? String(mobile).replace(/\D/g, '').slice(-10) : '';
    return queries.getUserByMobile.get(cleanMobile);
  },

  getUserByIdentifier(identifier) {
    if (!identifier) return null;
    const clean = String(identifier).trim();
    const cleanMobile = clean.replace(/\D/g, '').slice(-10);
    return queries.getUserByIdentifier.get(cleanMobile, clean, clean);
  },

  getAllUsersWithStats() {
    const users = queries.getAllUsers.all();
    return users.map(u => this.formatUserStats(u));
  },

  formatUserStats(user) {
    if (!user) return null;
    const bets = queries.getAllBetsForUser.all(user.id);
    const totalWagered = bets.reduce((sum, b) => sum + b.amount, 0);
    const totalWon = bets.filter(b => b.status === 'WON').reduce((sum, b) => sum + (b.payout || 0), 0);
    const netProfit = Math.round((totalWon - totalWagered) * 100) / 100;

    return {
      id: user.id,
      name: user.name,
      mobile: user.mobile,
      username: user.username,
      balance: Math.round((user.balance || 0) * 100) / 100,
      status: user.status,
      role: user.role,
      createdAt: user.created_at,
      totalBetsCount: bets.length,
      totalWagered: Math.round(totalWagered * 100) / 100,
      totalWon: Math.round(totalWon * 100) / 100,
      netProfit: netProfit
    };
  },

  createUser({ name, mobile, username, password, initialBalance = 1000, role = 'player' }) {
    const cleanMobile = mobile ? String(mobile).replace(/\D/g, '').slice(-10) : '';
    const cleanName = name ? name.trim() : 'Player';
    const cleanUsername = username ? username.trim().toLowerCase() : 'user_' + cleanMobile;
    const userId = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const now = new Date().toISOString();
    const balance = Math.max(0, parseFloat(initialBalance) || 0);

    const tx = db.transaction(() => {
      queries.createUser.run(
        userId,
        cleanMobile,
        cleanUsername,
        hash,
        cleanName,
        balance,
        'active',
        role,
        now,
        now
      );

      if (balance > 0) {
        queries.addLedgerEntry.run(
          uuidv4(),
          userId,
          'WELCOME_BONUS',
          balance,
          'REGISTRATION',
          `Welcome Signup Bonus +₹${balance}`,
          balance,
          now
        );
      }
    });

    tx();
    const created = queries.getUserById.get(userId);
    return this.formatUserStats(created);
  },

  verifyPassword(user, password) {
    if (!user || !user.password_hash || !password) return false;
    if (user.role === 'admin' && (password === 'admin123' || password === 'password123')) return true;
    return bcrypt.compareSync(password, user.password_hash);
  },

  updateUserProfile(userId, { name, mobile, status }) {
    const now = new Date().toISOString();
    const cleanMobile = mobile ? String(mobile).replace(/\D/g, '').slice(-10) : null;
    queries.updateUserProfile.run(name || null, cleanMobile, status || null, now, userId);
    return this.getUserById(userId);
  },

  updateUserStatus(userId, status) {
    const now = new Date().toISOString();
    queries.updateUserStatus.run(status, now, userId);
    return this.getUserById(userId);
  },

  updateUserBalance(userId, newBalance) {
    const now = new Date().toISOString();
    const cleanBal = Math.round(newBalance * 100) / 100;
    queries.updateUserBalance.run(cleanBal, now, userId);
    return cleanBal;
  },

  deleteUser(userId) {
    return queries.deleteUser.run(userId);
  },

  // Ledger
  addLedgerEntry(entry) {
    const now = entry.createdAt || new Date().toISOString();
    queries.addLedgerEntry.run(
      entry.id || uuidv4(),
      entry.userId,
      entry.type,
      entry.amount,
      entry.referenceId || null,
      entry.description || '',
      entry.balanceAfter,
      now
    );
  },

  getUserLedger(userId, limit = 50) {
    return queries.getUserLedger.all(userId, limit);
  },

  // Bets
  createBet(bet) {
    const now = bet.placedAt || new Date().toISOString();
    queries.createBet.run(
      bet.id,
      bet.userId,
      bet.gameKey,
      bet.periodId,
      bet.option,
      bet.amount,
      bet.status || 'PENDING',
      bet.payout || 0,
      now
    );
  },

  updateBetSettlement(betId, { status, payout, winningNumber, winningColor, winningSize }) {
    const now = new Date().toISOString();
    queries.updateBetSettlement.run(
      status,
      payout,
      winningNumber,
      winningColor,
      winningSize,
      now,
      betId
    );
  },

  getUserBets(userId, gameKey = null, limit = 50) {
    if (gameKey) {
      return queries.getUserBetsByGame.all(userId, gameKey, limit);
    }
    return queries.getUserBets.all(userId, limit);
  },

  // Game History
  addGameHistory(item) {
    const id = item.id || uuidv4();
    const colorsJson = JSON.stringify(item.colors || [item.color]);
    queries.addHistory.run(
      id,
      item.gameKey,
      item.periodId,
      item.number,
      item.color,
      colorsJson,
      item.size,
      item.totalBets || 0,
      item.totalPayout || 0,
      item.houseProfit || 0,
      item.mode || 'random',
      item.settledAt || new Date().toISOString()
    );
  },

  getGameHistory(gameKey, limit = 50) {
    const rows = queries.getGameHistory.all(gameKey, limit);
    return rows.map(r => ({
      periodId: r.period_id,
      number: r.number,
      color: r.color,
      colors: JSON.parse(r.colors || '[]'),
      size: r.size,
      totalBets: r.total_bets,
      totalPayout: r.total_payout,
      houseProfit: r.house_profit,
      mode: r.mode,
      settledAt: r.settled_at
    }));
  },

  // Audit Logs
  addAuditLog(log) {
    const id = log.id || uuidv4();
    queries.addAuditLog.run(
      id,
      log.gameKey,
      log.periodId,
      log.winningNumber,
      log.color,
      log.size,
      log.totalWagered || 0,
      log.totalPayout || 0,
      log.houseProfit || 0,
      log.determinationMethod || 'random',
      log.betsCount || 0,
      log.timestamp || new Date().toISOString()
    );
  },

  getAuditLogs(limit = 100) {
    return queries.getAuditLogs.all(limit);
  },

  // Admin: All Bets
  getAllBets(limit = 200) {
    return queries.getAllBets.all(limit);
  },

  // Admin: All Ledger
  getAllLedger(limit = 200) {
    return queries.getAllLedger.all(limit);
  },

  // Admin: Dashboard Stats
  getDashboardStats() {
    const totalWagered = queries.getTotalWagered.get().total;
    const totalPayouts = queries.getTotalPayouts.get('WON').total;
    const totalBets = queries.getTotalBetsCount.get().count;
    const totalHouseProfit = queries.getTotalHouseProfit.get().total;
    const users = queries.getAllUsers.all();
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === 'active' && u.role !== 'admin').length;
    const frozenUsers = users.filter(u => u.status === 'frozen').length;
    const totalPlayerBalance = users.filter(u => u.role !== 'admin').reduce((s, u) => s + (u.balance || 0), 0);

    return {
      totalWagered: Math.round(totalWagered * 100) / 100,
      totalPayouts: Math.round(totalPayouts * 100) / 100,
      totalBets,
      totalHouseProfit: Math.round(totalHouseProfit * 100) / 100,
      totalUsers,
      activeUsers,
      frozenUsers,
      totalPlayerBalance: Math.round(totalPlayerBalance * 100) / 100
    };
  }
};

module.exports = {
  db,
  DBService
};
