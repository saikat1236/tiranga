require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { DBService } = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'tiranga_jwt_secret_2026_super_key';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Token Generator
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, mobile: user.mobile, username: user.username, role: user.role || 'player' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Optional Auth Middleware (attaches req.user if token is present)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  } else if (req.body && req.body.token) {
    token = req.body.token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = DBService.getUserById(decoded.userId);
      if (user) {
        req.user = user;
      }
    } catch (e) {
      // Token invalid or expired - proceed as unauthenticated
    }
  }
  next();
}

// Require Authentication - blocks access for unauthenticated users
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
  }
  next();
}

// Require Admin Role
function adminAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }
  next();
}

app.use(authMiddleware);

// Helper to get formatted date sequence for Period ID (e.g. 202609260001)
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// In-Memory Game State Manager for real-time 1s ticks and live exposures
const games = {
  'wingo_30': {
    id: 'wingo_30',
    name: 'Win Go 30s',
    duration: 30,
    lockDuration: 5,
    currentPeriod: null,
    sequence: 1,
    remainingSeconds: 30,
    status: 'OPEN', // 'OPEN' | 'LOCKED' | 'SETTLING'
    activeBets: [],
    controlMode: 'manual', // 'random' | 'manual' | 'min_payout' | 'max_payout'
    manualOverrideNumber: null, // 0-9
    history: []
  },
  'wingo_60': {
    id: 'wingo_60',
    name: 'Win Go 1Min',
    duration: 60,
    lockDuration: 5,
    currentPeriod: null,
    sequence: 1,
    remainingSeconds: 60,
    status: 'OPEN',
    activeBets: [],
    controlMode: 'manual',
    manualOverrideNumber: 7, // Default demo forced outcome
    history: []
  },
  'wingo_180': {
    id: 'wingo_180',
    name: 'Win Go 3Min',
    duration: 180,
    lockDuration: 10,
    currentPeriod: null,
    sequence: 1,
    remainingSeconds: 180,
    status: 'OPEN',
    activeBets: [],
    controlMode: 'random',
    manualOverrideNumber: null,
    history: []
  },
  'wingo_300': {
    id: 'wingo_300',
    name: 'Win Go 5Min',
    duration: 300,
    lockDuration: 10,
    currentPeriod: null,
    sequence: 1,
    remainingSeconds: 300,
    status: 'OPEN',
    activeBets: [],
    controlMode: 'random',
    manualOverrideNumber: null,
    history: []
  }
};

// Seed or load history from SQLite database
function seedInitialHistory(gameKey) {
  const game = games[gameKey];
  const existingHistory = DBService.getGameHistory(gameKey, 50);

  if (existingHistory && existingHistory.length > 0) {
    game.history = existingHistory;
    game.sequence = existingHistory.length + 1;
    return;
  }

  const today = getTodayString();
  const seedCount = 15;
  
  for (let i = 1; i <= seedCount; i++) {
    const periodSeq = String(i).padStart(4, '0');
    const periodId = `${today}${periodSeq}`;
    const num = Math.floor(Math.random() * 10);
    const outcome = getNumberProperties(num);
    const historyItem = {
      gameKey,
      periodId,
      number: num,
      color: outcome.color,
      colors: outcome.colors,
      size: outcome.size,
      totalBets: Math.floor(Math.random() * 2500) + 500,
      totalPayout: Math.floor(Math.random() * 2000) + 400,
      settledAt: new Date(Date.now() - (seedCount - i) * game.duration * 1000).toISOString(),
      mode: 'random'
    };

    game.history.unshift(historyItem);
    DBService.addGameHistory(historyItem);
  }
  game.sequence = seedCount + 1;
}

// Return color attributes for numbers 0-9 per Tiranga standard rules
function getNumberProperties(num) {
  let colors = [];
  let primaryColor = '';
  
  if (num === 0) {
    colors = ['red', 'violet'];
    primaryColor = 'red-violet';
  } else if (num === 5) {
    colors = ['green', 'violet'];
    primaryColor = 'green-violet';
  } else if ([1, 3, 7, 9].includes(num)) {
    colors = ['green'];
    primaryColor = 'green';
  } else {
    colors = ['red'];
    primaryColor = 'red';
  }

  const size = num >= 5 ? 'Big' : 'Small';

  return {
    number: num,
    color: primaryColor,
    colors: colors,
    size: size
  };
}

// Initialize round for a game
function startNewRound(gameKey) {
  const game = games[gameKey];
  const today = getTodayString();
  const periodSeq = String(game.sequence).padStart(4, '0');
  game.currentPeriod = `${today}${periodSeq}`;
  game.sequence += 1;
  game.remainingSeconds = game.duration;
  game.status = 'OPEN';
  game.activeBets = [];
}

// Calculate payouts for a given number outcome
function calculateOutcomePayouts(bets, winningNumber) {
  const props = getNumberProperties(winningNumber);
  let totalPayout = 0;
  const settlementDetails = [];

  for (const bet of bets) {
    const netStake = bet.amount * 0.98; // 2% service deduction per Tiranga specification
    let isWin = false;
    let multiplier = 0;
    let payout = 0;

    const opt = String(bet.option).toLowerCase();

    // Color checks
    if (opt === 'green') {
      if ([1, 3, 7, 9].includes(winningNumber)) {
        isWin = true;
        multiplier = 2.0;
        payout = netStake * 2;
      } else if (winningNumber === 5) {
        // Green + Violet: half win 1.5x
        isWin = true;
        multiplier = 1.5;
        payout = netStake * 1.5;
      }
    } else if (opt === 'red') {
      if ([2, 4, 6, 8].includes(winningNumber)) {
        isWin = true;
        multiplier = 2.0;
        payout = netStake * 2;
      } else if (winningNumber === 0) {
        // Red + Violet: half win 1.5x
        isWin = true;
        multiplier = 1.5;
        payout = netStake * 1.5;
      }
    } else if (opt === 'violet') {
      if (winningNumber === 0 || winningNumber === 5) {
        isWin = true;
        multiplier = 4.5;
        payout = netStake * 4.5;
      }
    } else if (opt === 'big') {
      if (props.size === 'Big') {
        isWin = true;
        multiplier = 2.0;
        payout = netStake * 2;
      }
    } else if (opt === 'small') {
      if (props.size === 'Small') {
        isWin = true;
        multiplier = 2.0;
        payout = netStake * 2;
      }
    } else {
      // Exact number 0-9
      const betNum = parseInt(bet.option, 10);
      if (!isNaN(betNum) && betNum === winningNumber) {
        isWin = true;
        multiplier = 9.0;
        payout = netStake * 9;
      }
    }

    payout = Math.round(payout * 100) / 100;
    totalPayout += payout;

    settlementDetails.push({
      betId: bet.id,
      userId: bet.userId,
      option: bet.option,
      amount: bet.amount,
      netStake: Math.round(netStake * 100) / 100,
      isWin,
      multiplier,
      payout
    });
  }

  return {
    winningNumber,
    properties: props,
    totalPayout: Math.round(totalPayout * 100) / 100,
    settlementDetails
  };
}

// Calculate the simulation exposure table for Admin
function calculateAdminExposure(gameKey) {
  const game = games[gameKey];
  const bets = game.activeBets || [];
  
  let totalWagered = 0;
  bets.forEach(b => totalWagered += b.amount);

  const breakdownByOption = {
    green: 0,
    red: 0,
    violet: 0,
    big: 0,
    small: 0,
    numbers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  bets.forEach(b => {
    const opt = String(b.option).toLowerCase();
    if (breakdownByOption[opt] !== undefined) {
      breakdownByOption[opt] += b.amount;
    } else {
      const n = parseInt(opt, 10);
      if (n >= 0 && n <= 9) breakdownByOption.numbers[n] += b.amount;
    }
  });

  const outcomeTable = [];
  for (let num = 0; num <= 9; num++) {
    const sim = calculateOutcomePayouts(bets, num);
    const houseProfit = Math.round((totalWagered - sim.totalPayout) * 100) / 100;
    outcomeTable.push({
      number: num,
      color: sim.properties.color,
      colors: sim.properties.colors,
      size: sim.properties.size,
      totalPayout: sim.totalPayout,
      houseProfit: houseProfit,
      isHousePositive: houseProfit >= 0
    });
  }

  // Find min and max payout numbers
  const sortedByPayout = [...outcomeTable].sort((a, b) => a.totalPayout - b.totalPayout);
  const minPayoutNum = sortedByPayout[0].number;
  const maxPayoutNum = sortedByPayout[sortedByPayout.length - 1].number;

  return {
    gameKey,
    periodId: game.currentPeriod,
    totalBetsCount: bets.length,
    totalWagered: Math.round(totalWagered * 100) / 100,
    controlMode: game.controlMode,
    manualOverrideNumber: game.manualOverrideNumber,
    breakdownByOption,
    outcomeTable,
    suggestedMinPayoutNumber: minPayoutNum,
    suggestedMaxPayoutNumber: maxPayoutNum
  };
}

// Settle round and determine outcome based on Admin rules
function settleRound(gameKey) {
  const game = games[gameKey];
  game.status = 'SETTLING';

  let winningNumber = 0;
  let determinationMethod = 'random';

  // Admin control decisions
  if (game.manualOverrideNumber !== null && game.manualOverrideNumber !== undefined) {
    winningNumber = parseInt(game.manualOverrideNumber, 10);
    determinationMethod = 'manual_override';
  } else if (game.manualOverrideTarget) {
    const target = String(game.manualOverrideTarget).toLowerCase();
    const exposure = calculateAdminExposure(gameKey);
    let candidateNumbers = [];
    if (target === 'big') candidateNumbers = [5, 6, 7, 8, 9];
    else if (target === 'small') candidateNumbers = [0, 1, 2, 3, 4];
    else if (target === 'green') candidateNumbers = [1, 3, 7, 9, 5];
    else if (target === 'red') candidateNumbers = [2, 4, 6, 8, 0];
    else if (target === 'violet') candidateNumbers = [0, 5];

    if (candidateNumbers.length > 0) {
      // Pick the candidate number that pays least total money out among valid candidates
      const sortedCandidates = exposure.outcomeTable
        .filter(o => candidateNumbers.includes(o.number))
        .sort((a, b) => a.totalPayout - b.totalPayout);
      winningNumber = sortedCandidates[0].number;
      determinationMethod = `forced_${target}`;
    } else {
      winningNumber = crypto.randomInt(0, 10);
      determinationMethod = 'random_fair';
    }
  } else if (game.controlMode === 'min_payout') {
    const exposure = calculateAdminExposure(gameKey);
    winningNumber = exposure.suggestedMinPayoutNumber;
    determinationMethod = 'min_payout_algorithm';
  } else if (game.controlMode === 'max_payout') {
    const exposure = calculateAdminExposure(gameKey);
    winningNumber = exposure.suggestedMaxPayoutNumber;
    determinationMethod = 'max_payout_algorithm';
  } else {
    // Fair cryptographically secure random
    winningNumber = crypto.randomInt(0, 10);
    determinationMethod = 'random_fair';
  }

  const settlement = calculateOutcomePayouts(game.activeBets, winningNumber);
  let totalWageredThisRound = 0;

  // Process payouts & update wallets & ledgers in SQLite Database
  settlement.settlementDetails.forEach(s => {
    totalWageredThisRound += s.amount;

    // Update persisted bet record in SQLite
    DBService.updateBetSettlement(s.betId, {
      status: s.isWin ? 'WON' : 'LOST',
      payout: s.payout,
      winningNumber: winningNumber,
      winningColor: settlement.properties.color,
      winningSize: settlement.properties.size
    });

    if (s.isWin && s.payout > 0) {
      const user = DBService.getUserById(s.userId);
      if (user) {
        const newBal = Math.round((user.balance + s.payout) * 100) / 100;
        DBService.updateUserBalance(user.id, newBal);

        // Record credit in ledger
        DBService.addLedgerEntry({
          userId: user.id,
          type: 'PAYOUT_CREDIT',
          amount: s.payout,
          referenceId: game.currentPeriod,
          description: `Win Payout on Period ${game.currentPeriod} (Option: ${s.option}, Winning Number: ${winningNumber})`,
          balanceAfter: newBal
        });

        // Live sync updated user balance across WebSocket clients
        broadcast({
          type: 'USER_UPDATED',
          user: DBService.formatUserStats(DBService.getUserById(user.id)),
          dashboardStats: DBService.getDashboardStats()
        });
      }
    }
  });

  const houseNet = Math.round((totalWageredThisRound - settlement.totalPayout) * 100) / 100;

  const historyItem = {
    gameKey,
    periodId: game.currentPeriod,
    number: winningNumber,
    color: settlement.properties.color,
    colors: settlement.properties.colors,
    size: settlement.properties.size,
    totalBets: Math.round(totalWageredThisRound * 100) / 100,
    totalPayout: settlement.totalPayout,
    houseProfit: houseNet,
    settledAt: new Date().toISOString(),
    mode: determinationMethod
  };

  game.history.unshift(historyItem);
  if (game.history.length > 100) game.history.pop();

  // Save history to SQLite
  DBService.addGameHistory(historyItem);

  // Audit log saved to SQLite for admin traceability
  const auditLogItem = {
    gameKey,
    periodId: game.currentPeriod,
    winningNumber,
    color: settlement.properties.color,
    size: settlement.properties.size,
    totalWagered: totalWageredThisRound,
    totalPayout: settlement.totalPayout,
    houseProfit: houseNet,
    determinationMethod,
    betsCount: game.activeBets.length,
    timestamp: new Date().toISOString()
  };
  DBService.addAuditLog(auditLogItem);

  // Notify WebSocket clients of the settlement result
  broadcast({
    type: 'ROUND_SETTLED',
    gameKey,
    result: historyItem,
    settlementDetails: settlement.settlementDetails,
    dashboardStats: DBService.getDashboardStats()
  });

  // Preserve manual override if admin has locked in manual mode
  if (game.controlMode !== 'manual') {
    game.manualOverrideNumber = null;
    game.manualOverrideTarget = null;
    if (DBService.updateGameSettings) {
      DBService.updateGameSettings(gameKey, {
        controlMode: game.controlMode,
        manualOverrideNumber: null,
        manualOverrideTarget: null
      });
    }
  }

  // Start next round
  startNewRound(gameKey);

  // Notify all clients and admin that a new round period has started
  broadcast({
    type: 'ROUND_STARTED',
    gameKey,
    periodId: game.currentPeriod,
    remainingSeconds: game.remainingSeconds,
    status: game.status
  });
}

// Global broadcast to connected WebSocket clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Main Game Loop Timer running every second
function initGameLoop() {
  ['wingo_30', 'wingo_60', 'wingo_180', 'wingo_300'].forEach(key => {
    seedInitialHistory(key);
    startNewRound(key);
  });

  setInterval(() => {
    // 1. Decrement countdowns and handle locks/settlements for all games
    Object.keys(games).forEach(key => {
      const game = games[key];
      
      if (game.isPaused) return;
      if (game.status === 'SETTLING') return;

      game.remainingSeconds -= 1;

      // Lock round in the last 5 seconds (prevent new bets)
      if (game.remainingSeconds <= game.lockDuration && game.status === 'OPEN') {
        game.status = 'LOCKED';
        broadcast({
          type: 'ROUND_LOCKED',
          gameKey: key,
          periodId: game.currentPeriod,
          remainingSeconds: Math.max(0, game.remainingSeconds)
        });
      }

      // Settle round when counter reaches 0
      if (game.remainingSeconds <= 0) {
        settleRound(key);
      }
    });

    // 2. Broadcast single unified TICK containing all 4 timeframe games to all players & admin
    const gamesPayload = {};
    Object.keys(games).forEach(k => {
      const g = games[k];
      gamesPayload[k] = {
        id: g.id,
        name: g.name,
        periodId: g.currentPeriod,
        currentPeriod: g.currentPeriod,
        remainingSeconds: Math.max(0, g.remainingSeconds),
        status: g.isPaused ? 'PAUSED' : g.status,
        isPaused: !!g.isPaused,
        duration: g.duration,
        lockDuration: g.lockDuration,
        activeBetsCount: g.activeBets ? g.activeBets.length : 0,
        controlMode: g.controlMode,
        manualOverrideNumber: g.manualOverrideNumber,
        manualOverrideTarget: g.manualOverrideTarget
      };
    });

    broadcast({
      type: 'TICK',
      games: gamesPayload,
      serverTime: Date.now()
    });
  }, 1000);
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  // Send initial full system state to newly connected client (without forcing a default user)
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    games: games,
    dashboardStats: DBService.getDashboardStats()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'AUTH' && data.token) {
        try {
          const decoded = jwt.verify(data.token, JWT_SECRET);
          const user = DBService.getUserById(decoded.userId);
          if (user) {
            ws.userId = user.id;
            ws.send(JSON.stringify({
              type: 'USER_STATE',
              user: DBService.formatUserStats(user)
            }));
          }
        } catch (e) {
          // invalid token
        }
      } else if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      console.error('WS message error', e);
    }
  });
});

// ==========================================
//           AUTHENTICATION APIS
// ==========================================

// 1. Sign Up / Register New User
app.post(['/api/auth/register', '/api/auth/signup'], (req, res) => {
  try {
    const { name, mobile, password, username, initialBalance = 1000 } = req.body;

    if (!mobile || !String(mobile).trim()) {
      return res.status(400).json({ success: false, error: 'Mobile number is required' });
    }

    const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);
    if (cleanMobile.length < 10) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number' });
    }

    if (!password || String(password).length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long' });
    }

    const existing = DBService.getUserByMobile(cleanMobile);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this mobile number already exists. Please log in.' });
    }

    const newUser = DBService.createUser({
      name: name && name.trim() ? name.trim() : 'Player ' + cleanMobile.slice(-4),
      mobile: cleanMobile,
      username: username ? username.trim() : null,
      password: String(password),
      initialBalance: parseFloat(initialBalance) || 1000
    });

    const token = generateToken(newUser);

    broadcast({
      type: 'USERS_UPDATED',
      users: DBService.getAllUsersWithStats()
    });

    res.json({
      success: true,
      message: 'Account created successfully! Welcome bonus credited to your wallet.',
      token,
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: err.message || 'Registration failed' });
  }
});

// 2. Log In Existing User
app.post('/api/auth/login', (req, res) => {
  try {
    const { identifier, mobile, username, password } = req.body;
    const loginId = identifier || mobile || username;

    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: 'Mobile number/username and password are required' });
    }

    const user = DBService.getUserByIdentifier(loginId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Account not found. Please check your mobile or create an account.' });
    }

    const isValid = DBService.verifyPassword(user, String(password));
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Incorrect password. Please verify and try again.' });
    }

    const formattedUser = DBService.formatUserStats(user);
    const token = generateToken(formattedUser);

    res.json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: formattedUser
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// 3. Get Current Authenticated User Profile
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = DBService.getUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  res.json({
    success: true,
    user: DBService.formatUserStats(user)
  });
});

// 4. Log Out
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// ==========================================
//               GAME APIS
// ==========================================

// 1. Get full state
app.get('/api/state', requireAuth, (req, res) => {
  let user = DBService.getUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  
  res.json({
    success: true,
    user: DBService.formatUserStats(user),
    games: games
  });
});

// 2. Place Bet
app.post('/api/bet', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { gameKey = 'wingo_60', option, amount } = req.body;
  const game = games[gameKey];

  if (!game) {
    return res.status(400).json({ success: false, error: 'Invalid game mode' });
  }

  if (game.status === 'LOCKED' || game.remainingSeconds <= game.lockDuration) {
    return res.status(400).json({ success: false, error: 'Round is locked. No bets accepted in last 5 seconds.' });
  }

  const betAmount = parseFloat(amount);
  if (isNaN(betAmount) || betAmount < 1) {
    return res.status(400).json({ success: false, error: 'Invalid bet amount. Minimum is ₹1' });
  }

  const user = DBService.getUserById(userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  if (user.status === 'frozen') {
    return res.status(403).json({ success: false, error: 'Account is frozen by Admin. Betting is restricted.' });
  }

  if (user.balance < betAmount) {
    return res.status(400).json({ success: false, error: 'Insufficient wallet balance. Please recharge demo credits.' });
  }

  // Deduct balance in SQLite
  const newBalance = Math.round((user.balance - betAmount) * 100) / 100;
  DBService.updateUserBalance(user.id, newBalance);

  const betId = uuidv4();
  const betRecord = {
    id: betId,
    userId: user.id,
    gameKey,
    periodId: game.currentPeriod,
    option: String(option),
    amount: betAmount,
    status: 'PENDING',
    payout: 0,
    placedAt: new Date().toISOString()
  };

  // Add to active bets for round settlement
  game.activeBets.push(betRecord);

  // Persist bet in SQLite
  DBService.createBet(betRecord);

  // Add to double-entry ledger in SQLite
  DBService.addLedgerEntry({
    userId: user.id,
    type: 'PREDICTION_DEBIT',
    amount: -betAmount,
    referenceId: game.currentPeriod,
    description: `Bet on Period ${game.currentPeriod} - Option: ${option}`,
    balanceAfter: newBalance
  });

  // Broadcast bet placed event (admin live dashboard sees this immediately)
  broadcast({
    type: 'BET_PLACED',
    gameKey,
    bet: betRecord,
    updatedExposure: calculateAdminExposure(gameKey),
    dashboardStats: DBService.getDashboardStats()
  });

  res.json({
    success: true,
    bet: betRecord,
    newBalance: newBalance
  });
});

// 3. User Wallet Recharge
app.post('/api/wallet/recharge', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { amount = 1000 } = req.body;
  const user = DBService.getUserById(userId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const addAmount = Math.max(1, parseFloat(amount));
  const newBalance = Math.round((user.balance + addAmount) * 100) / 100;

  DBService.updateUserBalance(user.id, newBalance);

  DBService.addLedgerEntry({
    userId: user.id,
    type: 'DEMO_CREDIT',
    amount: addAmount,
    referenceId: 'TOPUP_' + Date.now(),
    description: `Demo Wallet Recharge +₹${addAmount}`,
    balanceAfter: newBalance
  });

  const updatedUser = DBService.formatUserStats(DBService.getUserById(user.id));

  broadcast({
    type: 'USER_UPDATED',
    user: updatedUser,
    dashboardStats: DBService.getDashboardStats()
  });

  res.json({ success: true, balance: newBalance, user: updatedUser });
});

// 4. Get User Bet History
app.get('/api/bets/my', requireAuth, (req, res) => {
  const userId = req.user.id;
  const gameKey = req.query.gameKey;
  const bets = DBService.getUserBets(userId, gameKey, 50);

  res.json({
    success: true,
    bets: bets.map(b => ({
      id: b.id,
      userId: b.user_id,
      gameKey: b.game_key,
      periodId: b.period_id,
      option: b.option,
      amount: b.amount,
      status: b.status,
      payout: b.payout,
      winningNumber: b.winning_number,
      winningColor: b.winning_color,
      winningSize: b.winning_size,
      placedAt: b.placed_at,
      settledAt: b.settled_at
    }))
  });
});

// 5. Get User Wallet Ledger
app.get('/api/wallet/ledger', requireAuth, (req, res) => {
  const userId = req.user.id;
  const ledger = DBService.getUserLedger(userId, 50);

  res.json({
    success: true,
    ledger: ledger.map(l => ({
      id: l.id,
      userId: l.user_id,
      type: l.type,
      amount: l.amount,
      referenceId: l.reference_id,
      description: l.description,
      balanceAfter: l.balance_after,
      createdAt: l.created_at
    }))
  });
});


// ==========================================
//                ADMIN APIS
// ==========================================

// Admin: Get live exposure simulation for current round
app.get('/api/admin/exposure', adminAuth, (req, res) => {
  const gameKey = req.query.gameKey || 'wingo_60';
  const exposure = calculateAdminExposure(gameKey);
  res.json({ success: true, exposure });
});

// Admin: Set game control mode (random / manual / min_payout / max_payout)
app.post('/api/admin/set-mode', adminAuth, (req, res) => {
  const { gameKey = 'wingo_60', mode } = req.body;
  if (!['random', 'manual', 'min_payout', 'max_payout'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'Invalid mode' });
  }

  const targetKeys = (gameKey === 'all' || !games[gameKey]) ? Object.keys(games) : [gameKey];
  targetKeys.forEach(k => {
    const g = games[k];
    if (g) {
      g.controlMode = mode;
      if (mode !== 'manual') {
        g.manualOverrideNumber = null;
        g.manualOverrideTarget = null;
      }
      if (DBService.updateGameSettings) {
        DBService.updateGameSettings(k, {
          controlMode: g.controlMode,
          manualOverrideNumber: g.manualOverrideNumber,
          manualOverrideTarget: g.manualOverrideTarget
        });
      }
      broadcast({
        type: 'ADMIN_OUTCOME_PRESET',
        gameKey: k,
        manualOverrideNumber: g.manualOverrideNumber,
        manualOverrideTarget: g.manualOverrideTarget,
        controlMode: g.controlMode
      });
    }
  });

  res.json({ success: true, mode, targetKeys });
});

// Admin: Set exact winning number or target category (Big, Small, Green, Red, Violet)
app.post('/api/admin/set-outcome', adminAuth, (req, res) => {
  const { gameKey = 'wingo_60', winningNumber, targetType, targetValue } = req.body;
  const targetKeys = (gameKey === 'all' || !games[gameKey]) ? Object.keys(games) : [gameKey];

  let num = null;
  let target = null;
  let isClearing = false;

  if (targetType === 'size' || targetType === 'color') {
    target = String(targetValue).toLowerCase();
    if (!['big', 'small', 'green', 'red', 'violet'].includes(target)) {
      isClearing = true;
    }
  } else if (winningNumber !== undefined && winningNumber !== null) {
    const parsed = parseInt(winningNumber, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 9) {
      num = parsed;
    } else {
      isClearing = true;
    }
  } else {
    isClearing = true;
  }

  targetKeys.forEach(k => {
    const g = games[k];
    if (g) {
      if (isClearing) {
        g.manualOverrideNumber = null;
        g.manualOverrideTarget = null;
        g.controlMode = 'random';
      } else {
        g.manualOverrideNumber = num;
        g.manualOverrideTarget = target;
        g.controlMode = 'manual';
      }
      if (DBService.updateGameSettings) {
        DBService.updateGameSettings(k, {
          controlMode: g.controlMode,
          manualOverrideNumber: g.manualOverrideNumber,
          manualOverrideTarget: g.manualOverrideTarget
        });
      }
      broadcast({
        type: 'ADMIN_OUTCOME_PRESET',
        gameKey: k,
        manualOverrideNumber: g.manualOverrideNumber,
        manualOverrideTarget: g.manualOverrideTarget,
        controlMode: g.controlMode
      });
    }
  });

  const message = isClearing 
    ? 'Manual override cleared. Reverted to automatic mode.'
    : (target ? `Target locked: Force ${target.toUpperCase()}` : `Target locked: Outcome set to Number ${num}`);

  res.json({
    success: true,
    manualOverrideNumber: isClearing ? null : num,
    manualOverrideTarget: isClearing ? null : target,
    controlMode: isClearing ? 'random' : 'manual',
    message
  });
});

// Admin: Force immediate settlement of current period
app.post('/api/admin/force-settle', adminAuth, (req, res) => {
  const { gameKey = 'wingo_60' } = req.body;
  const targetKeys = (gameKey === 'all' || !games[gameKey]) ? Object.keys(games) : [gameKey];
  targetKeys.forEach(k => settleRound(k));
  res.json({ success: true, message: `Round(s) settled immediately: ${targetKeys.join(', ')}` });
});

// Admin: Speed up timer (sets remaining to 5 seconds to test lock and settle quickly)
app.post('/api/admin/speed-timer', adminAuth, (req, res) => {
  const { gameKey = 'wingo_60', seconds = 6 } = req.body;
  const game = games[gameKey];
  if (!game) return res.status(400).json({ success: false, error: 'Invalid game' });

  game.remainingSeconds = Math.max(1, parseInt(seconds, 10));
  res.json({ success: true, remainingSeconds: game.remainingSeconds });
});

// Admin: Pause / Resume / Restart Game Loop
app.post('/api/admin/game-status', adminAuth, (req, res) => {
  const { gameKey = 'wingo_60', action = 'pause' } = req.body;
  const targetKeys = (gameKey === 'all' || !games[gameKey]) ? Object.keys(games) : [gameKey];

  targetKeys.forEach(k => {
    const g = games[k];
    if (g) {
      if (action === 'pause') {
        g.isPaused = true;
      } else if (action === 'resume') {
        g.isPaused = false;
      } else if (action === 'restart') {
        g.isPaused = false;
        startNewRound(k);
      }
    }
  });

  const statusMap = {};
  targetKeys.forEach(k => {
    statusMap[k] = { isPaused: !!games[k].isPaused, remainingSeconds: games[k].remainingSeconds, status: games[k].status };
  });

  broadcast({
    type: 'GAME_STATUS_CHANGED',
    gameKey,
    action,
    statusMap
  });

  res.json({ success: true, action, targetKeys, statusMap });
});

// Admin: Clean old history manually
app.post('/api/admin/clean-history', adminAuth, async (req, res) => {
  try {
    if (DBService.cleanOldHistory) {
      await DBService.cleanOldHistory(100);
    }
    res.json({ success: true, message: 'Game history cleaned: keeping recent 100 per timeframe (400 total).' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Reset testing metrics (bets/ledger) and set every player balance to 1000
app.post('/api/admin/reset-system', adminAuth, async (req, res) => {
  try {
    const targetBalance = (req.body && req.body.balance !== undefined) ? parseFloat(req.body.balance) : 1000;

    // 1. Clear any active bets in ongoing rounds
    Object.keys(games).forEach(k => {
      games[k].activeBets = [];
    });

    // 2. Perform DB purge and balance reset
    if (DBService.resetTestingMetricsAndBalances) {
      await DBService.resetTestingMetricsAndBalances(targetBalance);
    }

    const updatedStats = DBService.getDashboardStats();
    const updatedUsers = DBService.getAllUsersWithStats();

    // 3. Broadcast real-time updates to all connected admins & clients
    broadcast({
      type: 'DASHBOARD_STATS_UPDATED',
      dashboardStats: updatedStats
    });

    broadcast({
      type: 'USERS_UPDATED',
      users: updatedUsers,
      dashboardStats: updatedStats
    });

    // Notify connected player clients of their fresh balance
    wss.clients.forEach(client => {
      if (client.userId) {
        const u = DBService.getUserById(client.userId);
        if (u) {
          try {
            client.send(JSON.stringify({
              type: 'USER_UPDATED',
              user: DBService.formatUserStats(u),
              dashboardStats: updatedStats
            }));
          } catch (_) {}
        }
      }
    });

    res.json({
      success: true,
      message: `System reset successful. Testing metrics cleared and all user balances set to ₹${targetBalance.toFixed(2)}.`,
      dashboardStats: updatedStats,
      users: updatedUsers
    });
  } catch (err) {
    console.error('Failed to reset system metrics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Dedicated route to serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin: Get Audit logs
app.get('/api/admin/audit-logs', adminAuth, (req, res) => {
  const logs = DBService.getAuditLogs(100);
  res.json({ success: true, auditLogs: logs });
});

// Admin: Get ALL bets across all users
app.get('/api/admin/all-bets', adminAuth, (req, res) => {
  const bets = DBService.getAllBets(200);
  res.json({ success: true, bets });
});

// Admin: Get ALL ledger/payment entries across all users
app.get('/api/admin/all-ledger', adminAuth, (req, res) => {
  const ledger = DBService.getAllLedger(200);
  res.json({ success: true, ledger });
});

// Admin: Get dashboard stats
app.get('/api/admin/dashboard-stats', adminAuth, (req, res) => {
  const stats = DBService.getDashboardStats();
  res.json({ success: true, stats });
});

// Admin: Login endpoint (separate from player login for clarity)
app.post('/api/admin/login', (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Username/mobile and password are required' });
    }

    const user = DBService.getUserByIdentifier(identifier);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Account not found' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Admin credentials required.' });
    }

    const isValid = DBService.verifyPassword(user, String(password));
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      user: { id: user.id, name: user.name, role: user.role }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Admin: Impersonate / Login as user to test player perspective
app.post('/api/admin/login-as/:id', adminAuth, (req, res) => {
  const user = DBService.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const formatted = DBService.formatUserStats(user);
  const token = generateToken(formatted);

  res.json({
    success: true,
    token,
    user: formatted
  });
});

// Admin: User Management routes with admin auth
app.get('/api/users', adminAuth, (req, res) => {
  const usersList = DBService.getAllUsersWithStats();
  res.json({ success: true, users: usersList });
});

app.get('/api/users/:id', adminAuth, (req, res) => {
  const user = DBService.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const userBets = DBService.getUserBets(user.id, null, 50);
  const userLedger = DBService.getUserLedger(user.id, 50);

  res.json({
    success: true,
    user: DBService.formatUserStats(user),
    bets: userBets,
    ledger: userLedger
  });
});

app.post('/api/users', adminAuth, (req, res) => {
  const { name, mobile, initialBalance = 1000, password = 'password123' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }

  const cleanMobile = mobile ? String(mobile).replace(/\\D/g, '').slice(-10) : '9' + Math.floor(100000000 + Math.random() * 900000000);
  const balance = Math.max(0, parseFloat(initialBalance) || 0);

  const newUser = DBService.createUser({
    name: name.trim(),
    mobile: cleanMobile,
    password: String(password),
    initialBalance: balance
  });

  broadcast({
    type: 'USERS_UPDATED',
    users: DBService.getAllUsersWithStats()
  });

  res.json({ success: true, user: newUser });
});

app.put('/api/users/:id', adminAuth, (req, res) => {
  const user = DBService.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const { name, mobile, status } = req.body;
  const updated = DBService.updateUserProfile(req.params.id, { name, mobile, status });
  const formatted = DBService.formatUserStats(updated);

  broadcast({
    type: 'USER_UPDATED',
    user: formatted
  });

  res.json({ success: true, user: formatted });
});

app.post('/api/users/:id/status', adminAuth, (req, res) => {
  const user = DBService.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const { status } = req.body;
  const newStatus = status || (user.status === 'active' ? 'frozen' : 'active');
  const updated = DBService.updateUserStatus(req.params.id, newStatus);
  const formatted = DBService.formatUserStats(updated);

  broadcast({
    type: 'USER_UPDATED',
    user: formatted
  });

  res.json({ success: true, user: formatted });
});

app.delete('/api/users/:id', adminAuth, (req, res) => {
  const userId = req.params.id;
  if (userId === 'demo_user' || userId === 'admin_master') {
    return res.status(400).json({ success: false, error: 'Cannot delete this system account' });
  }

  const user = DBService.getUserById(userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  DBService.deleteUser(userId);

  broadcast({
    type: 'USERS_UPDATED',
    users: DBService.getAllUsersWithStats()
  });

  res.json({ success: true, message: 'User deleted successfully' });
});

app.post('/api/users/:id/adjust-balance', adminAuth, (req, res) => {
  const user = DBService.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const { action = 'set', amount = 0, reason = 'Admin Balance Adjustment' } = req.body;
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount < 0) {
    return res.status(400).json({ success: false, error: 'Invalid amount' });
  }

  let oldBal = user.balance;
  let newBal = oldBal;
  let ledgerType = 'DEMO_CREDIT';
  let diff = 0;

  if (action === 'credit') {
    newBal = Math.round((oldBal + numAmount) * 100) / 100;
    diff = numAmount;
    ledgerType = 'DEMO_CREDIT';
  } else if (action === 'debit') {
    newBal = Math.max(0, Math.round((oldBal - numAmount) * 100) / 100);
    diff = -(oldBal - newBal);
    ledgerType = 'ADMIN_DEBIT';
  } else {
    newBal = Math.max(0, Math.round(numAmount * 100) / 100);
    diff = Math.round((newBal - oldBal) * 100) / 100;
    ledgerType = diff >= 0 ? 'DEMO_CREDIT' : 'REVERSAL';
  }

  DBService.updateUserBalance(user.id, newBal);

  DBService.addLedgerEntry({
    userId: user.id,
    type: ledgerType,
    amount: diff,
    referenceId: 'ADMIN_ADJ_' + Date.now(),
    description: `${reason} (${diff >= 0 ? '+' : ''}₹${diff})`,
    balanceAfter: newBal
  });

  const formatted = DBService.formatUserStats(DBService.getUserById(user.id));
  broadcast({
    type: 'USER_UPDATED',
    user: formatted,
    dashboardStats: DBService.getDashboardStats()
  });

  res.json({ success: true, user: formatted });
});

app.post('/api/admin/adjust-balance', adminAuth, (req, res) => {
  const { userId = 'demo_user', newBalance, reason = 'Admin Balance Adjustment' } = req.body;
  const user = DBService.getUserById(userId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const targetBal = Math.max(0, parseFloat(newBalance));
  const diff = Math.round((targetBal - user.balance) * 100) / 100;

  DBService.updateUserBalance(user.id, targetBal);

  DBService.addLedgerEntry({
    userId: user.id,
    type: diff >= 0 ? 'DEMO_CREDIT' : 'REVERSAL',
    amount: diff,
    referenceId: 'ADMIN_ADJ_' + Date.now(),
    description: `${reason} (${diff >= 0 ? '+' : ''}₹${diff})`,
    balanceAfter: targetBal
  });

  const formatted = DBService.formatUserStats(DBService.getUserById(user.id));
  broadcast({
    type: 'USER_UPDATED',
    user: formatted,
    dashboardStats: DBService.getDashboardStats()
  });

  res.json({ success: true, user: formatted });
});

// Start Server
async function startServer() {
  if (DBService.init) {
    try {
      await DBService.init();
      // Restore persisted game settings (control mode & manual override) from Supabase
      if (DBService.getGameSettings) {
        ['wingo_30', 'wingo_60', 'wingo_180', 'wingo_300'].forEach(k => {
          const s = DBService.getGameSettings(k);
          if (s && games[k]) {
            if (s.controlMode) games[k].controlMode = s.controlMode;
            if (s.manualOverrideNumber !== null && s.manualOverrideNumber !== undefined) {
              games[k].manualOverrideNumber = s.manualOverrideNumber;
            }
            if (s.manualOverrideTarget) {
              games[k].manualOverrideTarget = s.manualOverrideTarget;
            }
          }
        });
      }
    } catch (e) {
      console.error('Database initialization warning:', e);
    }
  }
  initGameLoop();
  server.listen(PORT, () => {
    console.log(`🚀 Tiranga Colour Prediction App server running at http://localhost:${PORT}`);
  });
}

startServer();
