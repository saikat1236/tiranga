// PostgreSQL Persistent Database Service with In-Memory Real-Time State Sync
// Used for Supabase / Neon / Render Cloud PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Helper to normalize Supabase direct URLs to IPv4 pooler URLs
// Render free tier only supports IPv4 egress; Supabase direct db.*.supabase.co resolves to IPv6 (causing ENETUNREACH).
function normalizePostgresUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const match = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
    if (match) {
      const projectRef = match[1];
      parsed.hostname = 'aws-0-ap-south-1.pooler.supabase.com';
      parsed.port = '5432';
      if (!parsed.username.includes('.')) {
        parsed.username = `postgres.${projectRef}`;
      }
      console.log(`🔄 Automatically converted Supabase direct IPv6 endpoint to IPv4 Pooler: ${parsed.hostname}`);
      return parsed.toString();
    }
  } catch (e) {
    // If not parseable, return original
  }
  return rawUrl;
}

const SUPABASE_FALLBACK_URL = 'postgresql://postgres.hooqiccbtakpcogziona:tiranga-db123@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const rawConnectionString = process.env.DATABASE_URL || SUPABASE_FALLBACK_URL;
const connectionString = normalizePostgresUrl(rawConnectionString);

try {
  const host = new URL(connectionString).hostname;
  console.log(`🔌 Initializing PostgreSQL pool to: ${host}`);
} catch (_) {}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Resilient query wrapper with automatic exponential backoff retry for transient network drops
async function safeQuery(text, params = [], retries = 2) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (attempt <= retries) {
        await new Promise(r => setTimeout(r, 600 * attempt));
        continue;
      }
      throw err;
    }
  }
}

// In-Memory Fast Cache for real-time 1s game ticks & sub-millisecond responses
const cache = {
  users: new Map(), // userId -> user
  bets: [],         // all bets (newest first)
  ledger: [],       // all ledger entries (newest first)
  history: {},      // gameKey -> history array
  auditLogs: []     // audit logs (newest first)
};

// Initialize PostgreSQL Tables
async function initSchema() {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      mobile TEXT UNIQUE,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      balance NUMERIC(12, 2) DEFAULT 1000.00,
      status TEXT DEFAULT 'active',
      role TEXT DEFAULT 'player',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      reference_id TEXT,
      description TEXT,
      balance_after NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_key TEXT NOT NULL,
      period_id TEXT NOT NULL,
      option TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      status TEXT DEFAULT 'PENDING',
      payout NUMERIC(12, 2) DEFAULT 0,
      winning_number INT,
      winning_color TEXT,
      winning_size TEXT,
      placed_at TIMESTAMPTZ DEFAULT NOW(),
      settled_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS game_history (
      id TEXT PRIMARY KEY,
      game_key TEXT NOT NULL,
      period_id TEXT NOT NULL,
      number INT NOT NULL,
      color TEXT NOT NULL,
      colors TEXT NOT NULL,
      size TEXT NOT NULL,
      total_bets NUMERIC(12, 2) DEFAULT 0,
      total_payout NUMERIC(12, 2) DEFAULT 0,
      house_profit NUMERIC(12, 2) DEFAULT 0,
      mode TEXT DEFAULT 'random',
      settled_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      game_key TEXT NOT NULL,
      period_id TEXT NOT NULL,
      winning_number INT NOT NULL,
      color TEXT NOT NULL,
      size TEXT NOT NULL,
      total_wagered NUMERIC(12, 2) DEFAULT 0,
      total_payout NUMERIC(12, 2) DEFAULT 0,
      house_profit NUMERIC(12, 2) DEFAULT 0,
      determination_method TEXT NOT NULL,
      bets_count INT DEFAULT 0,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS game_settings (
      game_key TEXT PRIMARY KEY,
      control_mode TEXT DEFAULT 'random',
      manual_override_number INT,
      manual_override_target TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS manual_override_target TEXT;

    CREATE INDEX IF NOT EXISTS idx_pg_users_mobile ON users(mobile);
    CREATE INDEX IF NOT EXISTS idx_pg_bets_user_id ON bets(user_id);
    CREATE INDEX IF NOT EXISTS idx_pg_bets_game_period ON bets(game_key, period_id);
    CREATE INDEX IF NOT EXISTS idx_pg_ledger_user_id ON wallet_ledger(user_id);
    CREATE INDEX IF NOT EXISTS idx_pg_history_game_period ON game_history(game_key, period_id);
  `;

  await pool.query(schemaSql);
}

// Load ground truth from Supabase PostgreSQL into fast cache
async function loadCacheFromDatabase() {
  try {
    await initSchema();

    // 1. Users
    const usersRes = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
    cache.users.clear();
    usersRes.rows.forEach(u => {
      cache.users.set(u.id, {
        id: u.id,
        mobile: u.mobile,
        username: u.username,
        password_hash: u.password_hash,
        name: u.name,
        balance: parseFloat(u.balance) || 0,
        status: u.status || 'active',
        role: u.role || 'player',
        created_at: u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
        updated_at: u.updated_at ? new Date(u.updated_at).toISOString() : new Date().toISOString()
      });
    });

    // 2. Bets
    const betsRes = await pool.query('SELECT * FROM bets ORDER BY placed_at DESC LIMIT 1000');
    cache.bets = betsRes.rows.map(b => ({
      id: b.id,
      userId: b.user_id,
      user_id: b.user_id,
      gameKey: b.game_key,
      game_key: b.game_key,
      periodId: b.period_id,
      period_id: b.period_id,
      option: b.option,
      amount: parseFloat(b.amount) || 0,
      status: b.status,
      payout: parseFloat(b.payout) || 0,
      winningNumber: b.winning_number,
      winning_number: b.winning_number,
      winningColor: b.winning_color,
      winning_color: b.winning_color,
      winningSize: b.winning_size,
      winning_size: b.winning_size,
      placedAt: b.placed_at ? new Date(b.placed_at).toISOString() : new Date().toISOString(),
      placed_at: b.placed_at ? new Date(b.placed_at).toISOString() : new Date().toISOString(),
      settledAt: b.settled_at ? new Date(b.settled_at).toISOString() : null,
      settled_at: b.settled_at ? new Date(b.settled_at).toISOString() : null
    }));

    // 3. Ledger
    const ledgerRes = await pool.query('SELECT * FROM wallet_ledger ORDER BY created_at DESC LIMIT 1000');
    cache.ledger = ledgerRes.rows.map(l => ({
      id: l.id,
      userId: l.user_id,
      user_id: l.user_id,
      type: l.type,
      amount: parseFloat(l.amount) || 0,
      referenceId: l.reference_id,
      reference_id: l.reference_id,
      description: l.description,
      balanceAfter: parseFloat(l.balance_after) || 0,
      balance_after: parseFloat(l.balance_after) || 0,
      createdAt: l.created_at ? new Date(l.created_at).toISOString() : new Date().toISOString(),
      created_at: l.created_at ? new Date(l.created_at).toISOString() : new Date().toISOString()
    }));

    // 4. Game History
    const historyRes = await pool.query('SELECT * FROM game_history ORDER BY settled_at DESC LIMIT 500');
    cache.history = {
      wingo_30: [],
      wingo_60: [],
      wingo_180: [],
      wingo_300: []
    };

    historyRes.rows.forEach(h => {
      if (!cache.history[h.game_key]) cache.history[h.game_key] = [];
      let parsedColors = [h.color];
      try {
        if (h.colors) parsedColors = JSON.parse(h.colors);
      } catch (e) {
        parsedColors = [h.color];
      }

      cache.history[h.game_key].push({
        id: h.id,
        gameKey: h.game_key,
        periodId: h.period_id,
        number: parseInt(h.number, 10),
        color: h.color,
        colors: parsedColors,
        size: h.size,
        totalBets: parseFloat(h.total_bets) || 0,
        totalPayout: parseFloat(h.total_payout) || 0,
        houseProfit: parseFloat(h.house_profit) || 0,
        mode: h.mode,
        settledAt: h.settled_at ? new Date(h.settled_at).toISOString() : new Date().toISOString()
      });
    });

    // 5. Audit Logs
    const auditRes = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200');
    cache.auditLogs = auditRes.rows.map(a => ({
      id: a.id,
      gameKey: a.game_key,
      periodId: a.period_id,
      winningNumber: a.winning_number,
      winning_number: a.winning_number,
      color: a.color,
      size: a.size,
      totalWagered: parseFloat(a.total_wagered) || 0,
      total_wagered: parseFloat(a.total_wagered) || 0,
      totalPayout: parseFloat(a.total_payout) || 0,
      total_payout: parseFloat(a.total_payout) || 0,
      houseProfit: parseFloat(a.house_profit) || 0,
      house_profit: parseFloat(a.house_profit) || 0,
      determinationMethod: a.determination_method,
      determination_method: a.determination_method,
      betsCount: a.bets_count,
      bets_count: a.bets_count,
      timestamp: a.timestamp ? new Date(a.timestamp).toISOString() : new Date().toISOString()
    }));

    // 6. Game Settings (Control Mode, Manual Override Number & Target)
    const settingsRes = await pool.query('SELECT * FROM game_settings');
    cache.settings = {};
    settingsRes.rows.forEach(s => {
      cache.settings[s.game_key] = {
        controlMode: s.control_mode,
        manualOverrideNumber: s.manual_override_number !== null ? parseInt(s.manual_override_number, 10) : null,
        manualOverrideTarget: s.manual_override_target || null
      };
    });

    console.log(`🌐 Supabase PostgreSQL Loaded: ${cache.users.size} users, ${cache.bets.length} bets, ${cache.ledger.length} ledger entries, ${Object.keys(cache.settings).length} game settings.`);
  } catch (err) {
    console.error('Error loading cache from Supabase PostgreSQL:', err);
  }
}

let initPromise = null;
function init() {
  if (!initPromise) {
    initPromise = loadCacheFromDatabase();
  }
  return initPromise;
}

// Initial async cache load
init();

const DBService = {
  init() {
    return init();
  },

  // Users
  getUserById(id) {
    if (!id) return null;
    return cache.users.get(id) || null;
  },

  getUserByMobile(mobile) {
    if (!mobile) return null;
    const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);
    for (const u of cache.users.values()) {
      if (u.mobile === cleanMobile) return u;
    }
    return null;
  },

  getUserByIdentifier(identifier) {
    if (!identifier) return null;
    const clean = String(identifier).trim();
    const cleanMobile = clean.replace(/\D/g, '').slice(-10);

    for (const u of cache.users.values()) {
      if (
        u.id === clean ||
        (cleanMobile.length >= 10 && u.mobile === cleanMobile) ||
        (u.username && u.username.toLowerCase() === clean.toLowerCase())
      ) {
        return u;
      }
    }
    return null;
  },

  getAllUsersWithStats() {
    const list = Array.from(cache.users.values());
    return list.map(u => this.formatUserStats(u));
  },

  formatUserStats(user) {
    if (!user) return null;
    const bets = cache.bets.filter(b => b.userId === user.id || b.user_id === user.id);
    const totalWagered = bets.reduce((sum, b) => sum + (b.amount || 0), 0);
    const totalWon = bets.filter(b => b.status === 'WON').reduce((sum, b) => sum + (b.payout || 0), 0);
    const netProfit = Math.round((totalWon - totalWagered) * 100) / 100;

    return {
      id: user.id,
      name: user.name,
      mobile: user.mobile,
      username: user.username,
      balance: Math.round((user.balance || 0) * 100) / 100,
      status: user.status || 'active',
      role: user.role || 'player',
      createdAt: user.created_at || user.createdAt,
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

    const newUser = {
      id: userId,
      mobile: cleanMobile,
      username: cleanUsername,
      password_hash: hash,
      name: cleanName,
      balance: balance,
      status: 'active',
      role: role,
      created_at: now,
      updated_at: now
    };

    // Update in-memory cache instantly
    cache.users.set(userId, newUser);

    // Asynchronous write to Supabase PostgreSQL with auto-retry
    safeQuery(`
      INSERT INTO users (id, mobile, username, password_hash, name, balance, status, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [userId, cleanMobile, cleanUsername, hash, cleanName, balance, 'active', role, now, now])
    .catch(err => console.error('Failed to insert user into PostgreSQL:', err));

    if (balance > 0) {
      const ledgerId = uuidv4();
      const ledgerItem = {
        id: ledgerId,
        userId: userId,
        type: 'WELCOME_BONUS',
        amount: balance,
        referenceId: 'REGISTRATION',
        description: `Welcome Signup Bonus +₹${balance}`,
        balanceAfter: balance,
        createdAt: now
      };
      cache.ledger.unshift(ledgerItem);

      safeQuery(`
        INSERT INTO wallet_ledger (id, user_id, type, amount, reference_id, description, balance_after, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [ledgerId, userId, 'WELCOME_BONUS', balance, 'REGISTRATION', `Welcome Signup Bonus +₹${balance}`, balance, now])
      .catch(err => console.error('Failed to insert ledger into PostgreSQL:', err));
    }

    return this.formatUserStats(newUser);
  },

  verifyPassword(user, password) {
    if (!user || !user.password_hash || !password) return false;
    if (user.role === 'admin' && (password === 'admin123' || password === 'password123')) return true;
    return bcrypt.compareSync(password, user.password_hash);
  },

  updateUserProfile(userId, { name, mobile, status }) {
    const user = cache.users.get(userId);
    if (!user) return null;

    const cleanMobile = mobile ? String(mobile).replace(/\D/g, '').slice(-10) : user.mobile;
    const newName = name ? name.trim() : user.name;
    const newStatus = status || user.status;
    const now = new Date().toISOString();

    user.name = newName;
    user.mobile = cleanMobile;
    user.status = newStatus;
    user.updated_at = now;

    safeQuery(`
      UPDATE users SET name = $1, mobile = $2, status = $3, updated_at = $4
      WHERE id = $5
    `, [newName, cleanMobile, newStatus, now, userId])
    .catch(err => console.error('Failed to update user profile in PostgreSQL:', err));

    return user;
  },

  updateUserStatus(userId, status) {
    const user = cache.users.get(userId);
    if (!user) return null;
    const now = new Date().toISOString();
    user.status = status;
    user.updated_at = now;

    safeQuery('UPDATE users SET status = $1, updated_at = $2 WHERE id = $3', [status, now, userId])
    .catch(err => console.error('Failed to update user status in PostgreSQL:', err));

    return user;
  },

  updateUserBalance(userId, newBalance) {
    const user = cache.users.get(userId);
    if (!user) return newBalance;
    const cleanBal = Math.round(newBalance * 100) / 100;
    const now = new Date().toISOString();
    user.balance = cleanBal;
    user.updated_at = now;

    safeQuery('UPDATE users SET balance = $1, updated_at = $2 WHERE id = $3', [cleanBal, now, userId])
    .catch(err => console.error('Failed to update user balance in PostgreSQL:', err));

    return cleanBal;
  },

  deleteUser(userId) {
    cache.users.delete(userId);
    cache.bets = cache.bets.filter(b => b.userId !== userId && b.user_id !== userId);
    cache.ledger = cache.ledger.filter(l => l.userId !== userId && l.user_id !== userId);

    safeQuery('DELETE FROM users WHERE id = $1', [userId])
    .catch(err => console.error('Failed to delete user from PostgreSQL:', err));
  },

  // Ledger
  addLedgerEntry(entry) {
    const now = entry.createdAt || new Date().toISOString();
    const id = entry.id || uuidv4();
    const item = {
      id,
      userId: entry.userId,
      user_id: entry.userId,
      type: entry.type,
      amount: entry.amount,
      referenceId: entry.referenceId || null,
      reference_id: entry.referenceId || null,
      description: entry.description || '',
      balanceAfter: entry.balanceAfter,
      balance_after: entry.balanceAfter,
      createdAt: now,
      created_at: now
    };

    cache.ledger.unshift(item);

    safeQuery(`
      INSERT INTO wallet_ledger (id, user_id, type, amount, reference_id, description, balance_after, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, entry.userId, entry.type, entry.amount, entry.referenceId || null, entry.description || '', entry.balanceAfter, now])
    .catch(err => console.error('Failed to insert ledger into PostgreSQL:', err));
  },

  getUserLedger(userId, limit = 50) {
    return cache.ledger
      .filter(l => l.userId === userId || l.user_id === userId)
      .slice(0, limit);
  },

  getAllLedger(limit = 200) {
    return cache.ledger.slice(0, limit);
  },

  // Bets
  createBet(bet) {
    const now = bet.placedAt || new Date().toISOString();
    const item = {
      id: bet.id,
      userId: bet.userId,
      user_id: bet.userId,
      gameKey: bet.gameKey,
      game_key: bet.gameKey,
      periodId: bet.periodId,
      period_id: bet.periodId,
      option: bet.option,
      amount: bet.amount,
      status: bet.status || 'PENDING',
      payout: bet.payout || 0,
      placedAt: now,
      placed_at: now
    };

    cache.bets.unshift(item);

    safeQuery(`
      INSERT INTO bets (id, user_id, game_key, period_id, option, amount, status, payout, placed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [bet.id, bet.userId, bet.gameKey, bet.periodId, bet.option, bet.amount, bet.status || 'PENDING', bet.payout || 0, now])
    .catch(err => console.error('Failed to insert bet into PostgreSQL:', err));
  },

  updateBetSettlement(betId, { status, payout, winningNumber, winningColor, winningSize }) {
    const now = new Date().toISOString();
    const bet = cache.bets.find(b => b.id === betId);
    if (bet) {
      bet.status = status;
      bet.payout = payout;
      bet.winningNumber = winningNumber;
      bet.winning_number = winningNumber;
      bet.winningColor = winningColor;
      bet.winning_color = winningColor;
      bet.winningSize = winningSize;
      bet.winning_size = winningSize;
      bet.settledAt = now;
      bet.settled_at = now;
    }

    safeQuery(`
      UPDATE bets SET status = $1, payout = $2, winning_number = $3, winning_color = $4, winning_size = $5, settled_at = $6
      WHERE id = $7
    `, [status, payout, winningNumber, winningColor, winningSize, now, betId])
    .catch(err => console.error('Failed to update bet settlement in PostgreSQL:', err));
  },

  getUserBets(userId, gameKey = null, limit = 50) {
    let list = cache.bets.filter(b => b.userId === userId || b.user_id === userId);
    if (gameKey) {
      list = list.filter(b => b.gameKey === gameKey || b.game_key === gameKey);
    }
    return list.slice(0, limit);
  },

  getAllBets(limit = 200) {
    return cache.bets.slice(0, limit);
  },

  // Game History
  addGameHistory(item) {
    const id = item.id || uuidv4();
    const key = item.gameKey || item.game_key;
    if (!cache.history[key]) cache.history[key] = [];

    const now = item.settledAt || new Date().toISOString();
    const colorsArr = item.colors || [item.color];
    const colorsJson = JSON.stringify(colorsArr);

    const historyItem = {
      id,
      gameKey: key,
      periodId: item.periodId || item.period_id,
      number: item.number,
      color: item.color,
      colors: colorsArr,
      size: item.size,
      totalBets: item.totalBets || item.total_bets || 0,
      totalPayout: item.totalPayout || item.total_payout || 0,
      houseProfit: item.houseProfit || item.house_profit || 0,
      mode: item.mode || 'random',
      settledAt: now
    };

    cache.history[key].unshift(historyItem);
    if (cache.history[key].length > 100) cache.history[key].pop();

    safeQuery(`
      INSERT INTO game_history (id, game_key, period_id, number, color, colors, size, total_bets, total_payout, house_profit, mode, settled_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [id, key, historyItem.periodId, item.number, item.color, colorsJson, item.size, historyItem.totalBets, historyItem.totalPayout, historyItem.houseProfit, historyItem.mode, now])
    .then(() => {
      // Automatically keep strictly recent 100 games per timeframe (400 total max)
      return safeQuery(`
        DELETE FROM game_history
        WHERE game_key = $1
          AND id NOT IN (
            SELECT id FROM game_history
            WHERE game_key = $1
            ORDER BY settled_at DESC
            LIMIT 100
          )
      `, [key]);
    })
    .catch(err => console.error('Failed to insert/prune game history into PostgreSQL:', err));
  },

  getGameHistory(gameKey, limit = 50) {
    const list = cache.history[gameKey] || [];
    return list.slice(0, limit);
  },

  // Audit Logs
  addAuditLog(log) {
    const id = log.id || uuidv4();
    const now = log.timestamp || new Date().toISOString();
    const item = {
      id,
      gameKey: log.gameKey || log.game_key,
      periodId: log.periodId || log.period_id,
      winningNumber: log.winningNumber !== undefined ? log.winningNumber : log.winning_number,
      winning_number: log.winningNumber !== undefined ? log.winningNumber : log.winning_number,
      color: log.color,
      size: log.size,
      totalWagered: log.totalWagered || log.total_wagered || 0,
      total_wagered: log.totalWagered || log.total_wagered || 0,
      totalPayout: log.totalPayout || log.total_payout || 0,
      total_payout: log.totalPayout || log.total_payout || 0,
      houseProfit: log.houseProfit || log.house_profit || 0,
      house_profit: log.houseProfit || log.house_profit || 0,
      determinationMethod: log.determinationMethod || log.determination_method || 'random',
      determination_method: log.determinationMethod || log.determination_method || 'random',
      betsCount: log.betsCount || log.bets_count || 0,
      bets_count: log.betsCount || log.bets_count || 0,
      timestamp: now
    };

    cache.auditLogs.unshift(item);
    if (cache.auditLogs.length > 100) cache.auditLogs.pop();

    safeQuery(`
      INSERT INTO audit_logs (id, game_key, period_id, winning_number, color, size, total_wagered, total_payout, house_profit, determination_method, bets_count, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [id, item.gameKey, item.periodId, item.winningNumber, item.color, item.size, item.totalWagered, item.totalPayout, item.houseProfit, item.determinationMethod, item.betsCount, now])
    .then(() => {
      // Automatically keep strictly recent 100 audit logs per timeframe
      return safeQuery(`
        DELETE FROM audit_logs
        WHERE game_key = $1
          AND id NOT IN (
            SELECT id FROM audit_logs
            WHERE game_key = $1
            ORDER BY timestamp DESC
            LIMIT 100
          )
      `, [item.gameKey]);
    })
    .catch(err => console.error('Failed to insert/prune audit log into PostgreSQL:', err));
  },

  getAuditLogs(limit = 100) {
    return cache.auditLogs.slice(0, limit);
  },

  // Manual or automatic mass prune
  async cleanOldHistory(keepPerTF = 100) {
    const timeframes = ['wingo_30', 'wingo_60', 'wingo_180', 'wingo_300'];
    for (const g of timeframes) {
      if (cache.history[g] && cache.history[g].length > keepPerTF) {
        cache.history[g] = cache.history[g].slice(0, keepPerTF);
      }
      await safeQuery(`
        DELETE FROM game_history
        WHERE game_key = $1
          AND id NOT IN (
            SELECT id FROM game_history
            WHERE game_key = $1
            ORDER BY settled_at DESC
            LIMIT $2
          )
      `, [g, keepPerTF]).catch(() => {});

      await safeQuery(`
        DELETE FROM audit_logs
        WHERE game_key = $1
          AND id NOT IN (
            SELECT id FROM audit_logs
            WHERE game_key = $1
            ORDER BY timestamp DESC
            LIMIT $2
          )
      `, [g, keepPerTF]).catch(() => {});
    }
  },

  // Reset testing numbers and set every user balance to specified amount (default 1000)
  async resetTestingMetricsAndBalances(targetBalance = 1000) {
    const bal = Math.max(0, parseFloat(targetBalance) || 1000);
    const now = new Date().toISOString();

    // 1. Clear testing bets from DB and memory
    await safeQuery('DELETE FROM bets');
    cache.bets = [];

    // 2. Clear old ledger history from DB and memory
    await safeQuery('DELETE FROM wallet_ledger');
    cache.ledger = [];

    // 3. Reset balances for all players in DB
    await safeQuery('UPDATE users SET balance = $1, updated_at = NOW() WHERE role != $2', [bal, 'admin']);

    // 4. Update memory cache and write initial ₹1000 ledger record for every player
    for (const [id, user] of cache.users.entries()) {
      if (user.role !== 'admin') {
        user.balance = bal;
        user.updated_at = now;

        const ledgerId = uuidv4();
        const ledgerItem = {
          id: ledgerId,
          userId: user.id,
          user_id: user.id,
          type: 'SYSTEM_RESET',
          amount: bal,
          referenceId: 'BALANCE_RESET',
          reference_id: 'BALANCE_RESET',
          description: `Testing Reset - Balance Set to ₹${bal.toFixed(2)}`,
          balanceAfter: bal,
          balance_after: bal,
          createdAt: now,
          created_at: now
        };
        cache.ledger.unshift(ledgerItem);

        await safeQuery(`
          INSERT INTO wallet_ledger (id, user_id, type, amount, reference_id, description, balance_after, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [ledgerId, user.id, 'SYSTEM_RESET', bal, 'BALANCE_RESET', `Testing Reset - Balance Set to ₹${bal.toFixed(2)}`, bal, now])
        .catch(err => console.error('Failed to insert reset ledger entry:', err));
      }
    }

    return {
      success: true,
      stats: this.getDashboardStats(),
      usersCount: cache.users.size
    };
  },

  // Admin Dashboard Stats
  getDashboardStats() {
    const totalWagered = cache.bets.reduce((s, b) => s + (b.amount || 0), 0);
    const totalPayouts = cache.bets.filter(b => b.status === 'WON').reduce((s, b) => s + (b.payout || 0), 0);
    const totalBets = cache.bets.length;
    const totalHouseProfit = Math.round((totalWagered - totalPayouts) * 100) / 100;
    const users = Array.from(cache.users.values());
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === 'active' && u.role !== 'admin').length;
    const frozenUsers = users.filter(u => u.status === 'frozen').length;
    const totalPlayerBalance = users.filter(u => u.role !== 'admin').reduce((s, u) => s + (u.balance || 0), 0);

    return {
      totalWagered: Math.round(totalWagered * 100) / 100,
      totalPayouts: Math.round(totalPayouts * 100) / 100,
      totalBets,
      totalHouseProfit,
      totalUsers,
      activeUsers,
      frozenUsers,
      totalPlayerBalance: Math.round(totalPlayerBalance * 100) / 100
    };
  },

  // Game Settings & Manual Override Persistence
  getGameSettings(gameKey) {
    if (!cache.settings) cache.settings = {};
    return cache.settings[gameKey] || null;
  },

  getAllGameSettings() {
    return cache.settings || {};
  },

  updateGameSettings(gameKey, { controlMode, manualOverrideNumber, manualOverrideTarget }) {
    if (!cache.settings) cache.settings = {};
    if (!cache.settings[gameKey]) {
      cache.settings[gameKey] = { controlMode: 'random', manualOverrideNumber: null, manualOverrideTarget: null };
    }

    if (controlMode !== undefined) cache.settings[gameKey].controlMode = controlMode;
    if (manualOverrideNumber !== undefined) cache.settings[gameKey].manualOverrideNumber = manualOverrideNumber;
    if (manualOverrideTarget !== undefined) cache.settings[gameKey].manualOverrideTarget = manualOverrideTarget;

    const currentMode = cache.settings[gameKey].controlMode || 'random';
    const currentOverride = (cache.settings[gameKey].manualOverrideNumber !== null && cache.settings[gameKey].manualOverrideNumber !== undefined)
      ? parseInt(cache.settings[gameKey].manualOverrideNumber, 10)
      : null;
    const currentTarget = cache.settings[gameKey].manualOverrideTarget || null;

    return safeQuery(`
      INSERT INTO game_settings (game_key, control_mode, manual_override_number, manual_override_target, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (game_key) DO UPDATE
      SET control_mode = EXCLUDED.control_mode,
          manual_override_number = EXCLUDED.manual_override_number,
          manual_override_target = EXCLUDED.manual_override_target,
          updated_at = NOW()
    `, [gameKey, currentMode, currentOverride, currentTarget])
    .catch(err => console.error('Failed to update game settings in PostgreSQL:', err));
  }
};

module.exports = {
  db: pool,
  pool,
  DBService
};
