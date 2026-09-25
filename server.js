const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get formatted date sequence for Period ID (e.g. 202609250001)
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// In-Memory Database with optional persistence
const db = {
  users: {
    'demo_user': {
      id: 'demo_user',
      name: 'Player 8892',
      mobile: '+91 98765 43210',
      balance: 5000.00,
      createdAt: new Date().toISOString()
    }
  },
  walletLedger: [],
  userBets: [], // All bets placed by users with settlement results
  // Current game states for each duration mode
  games: {
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
      // Admin control settings
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
  },
  auditLogs: []
};

// Initial mock history generator to make charts rich and lively upon boot
function seedInitialHistory(gameKey) {
  const game = db.games[gameKey];
  const today = getTodayString();
  const seedCount = 15;
  
  for (let i = 1; i <= seedCount; i++) {
    const periodSeq = String(i).padStart(4, '0');
    const periodId = `${today}${periodSeq}`;
    const num = Math.floor(Math.random() * 10);
    const outcome = getNumberProperties(num);

    game.history.unshift({
      periodId,
      number: num,
      color: outcome.color,
      colors: outcome.colors,
      size: outcome.size,
      totalBets: Math.floor(Math.random() * 2500) + 500,
      totalPayout: Math.floor(Math.random() * 2000) + 400,
      settledAt: new Date(Date.now() - (seedCount - i) * game.duration * 1000).toISOString(),
      mode: 'random'
    });
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
  const game = db.games[gameKey];
  const today = getTodayString();
  const periodSeq = String(game.sequence).padStart(4, '0');
  game.currentPeriod = `${today}${periodSeq}`;
  game.sequence += 1;
  game.remainingSeconds = game.duration;
  game.status = 'OPEN';
  game.activeBets = [];
  
  // Note: we preserve game.manualOverrideNumber if admin set it, or it will be used once
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
  const game = db.games[gameKey];
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
  const game = db.games[gameKey];
  game.status = 'SETTLING';

  let winningNumber = 0;
  let determinationMethod = 'random';

  // Admin control decisions
  if (game.manualOverrideNumber !== null && game.manualOverrideNumber !== undefined) {
    winningNumber = parseInt(game.manualOverrideNumber, 10);
    determinationMethod = 'manual_override';
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

  // Process payouts & update wallets & ledgers
  settlement.settlementDetails.forEach(s => {
    totalWageredThisRound += s.amount;
    const user = db.users[s.userId];
    
    // Update persisted bet record
    const targetBet = db.userBets.find(b => b.id === s.betId);
    if (targetBet) {
      targetBet.status = s.isWin ? 'WON' : 'LOST';
      targetBet.payout = s.payout;
      targetBet.winningNumber = winningNumber;
      targetBet.winningColor = settlement.properties.color;
      targetBet.settledAt = new Date().toISOString();
    }

    if (user && s.isWin && s.payout > 0) {
      user.balance = Math.round((user.balance + s.payout) * 100) / 100;
      
      // Double entry ledger for win payout
      db.walletLedger.unshift({
        id: uuidv4(),
        userId: user.id,
        type: 'PAYOUT_CREDIT',
        amount: s.payout,
        referenceId: game.currentPeriod,
        description: `Win Payout on Period ${game.currentPeriod} (Option: ${s.option}, Winning Number: ${winningNumber})`,
        balanceAfter: user.balance,
        createdAt: new Date().toISOString()
      });
    }
  });

  const houseNet = Math.round((totalWageredThisRound - settlement.totalPayout) * 100) / 100;

  const historyItem = {
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

  // Audit log for admin traceability
  db.auditLogs.unshift({
    id: uuidv4(),
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
  });

  // Notify WebSocket clients of the settlement result
  broadcast({
    type: 'ROUND_SETTLED',
    gameKey,
    result: historyItem,
    settlementDetails: settlement.settlementDetails
  });

  // Reset manual override if set for one-shot control
  game.manualOverrideNumber = null;

  // Start next round
  startNewRound(gameKey);
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
    ['wingo_30', 'wingo_60', 'wingo_180', 'wingo_300'].forEach(key => {
      const game = db.games[key];
      game.remainingSeconds -= 1;

      if (game.remainingSeconds <= game.lockDuration && game.status === 'OPEN') {
        game.status = 'LOCKED';
      }

      if (game.remainingSeconds <= 0) {
        settleRound(key);
      }
    });

    // Broadcast tick state every second
    broadcast({
      type: 'TICK',
      games: {
        'wingo_30': {
          periodId: db.games.wingo_30.currentPeriod,
          remainingSeconds: db.games.wingo_30.remainingSeconds,
          status: db.games.wingo_30.status,
          activeBetsCount: db.games.wingo_30.activeBets.length,
          controlMode: db.games.wingo_30.controlMode,
          manualOverrideNumber: db.games.wingo_30.manualOverrideNumber
        },
        'wingo_60': {
          periodId: db.games.wingo_60.currentPeriod,
          remainingSeconds: db.games.wingo_60.remainingSeconds,
          status: db.games.wingo_60.status,
          activeBetsCount: db.games.wingo_60.activeBets.length,
          controlMode: db.games.wingo_60.controlMode,
          manualOverrideNumber: db.games.wingo_60.manualOverrideNumber
        },
        'wingo_180': {
          periodId: db.games.wingo_180.currentPeriod,
          remainingSeconds: db.games.wingo_180.remainingSeconds,
          status: db.games.wingo_180.status,
          activeBetsCount: db.games.wingo_180.activeBets.length,
          controlMode: db.games.wingo_180.controlMode,
          manualOverrideNumber: db.games.wingo_180.manualOverrideNumber
        },
        'wingo_300': {
          periodId: db.games.wingo_300.currentPeriod,
          remainingSeconds: db.games.wingo_300.remainingSeconds,
          status: db.games.wingo_300.status,
          activeBetsCount: db.games.wingo_300.activeBets.length,
          controlMode: db.games.wingo_300.controlMode,
          manualOverrideNumber: db.games.wingo_300.manualOverrideNumber
        }
      }
    });
  }, 1000);
}

// WebSocket Connection Handler
wss.on('connection', ws => {
  // Send initial snapshot on connect
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    games: db.games,
    user: db.users['demo_user']
  }));

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      console.error('WS message error', e);
    }
  });
});

// REST API Endpoints

// 1. Get full state
app.get('/api/state', (req, res) => {
  const userId = req.query.userId || 'demo_user';
  const user = db.users[userId] || db.users['demo_user'];
  
  res.json({
    success: true,
    user,
    games: db.games
  });
});

// 2. Place Bet
app.post('/api/bet', (req, res) => {
  const { userId = 'demo_user', gameKey = 'wingo_60', option, amount } = req.body;
  const game = db.games[gameKey];

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

  const user = db.users[userId];
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  if (user.balance < betAmount) {
    return res.status(400).json({ success: false, error: 'Insufficient wallet balance. Please recharge demo credits.' });
  }

  // Deduct balance
  user.balance = Math.round((user.balance - betAmount) * 100) / 100;

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

  game.activeBets.push(betRecord);
  db.userBets.unshift(betRecord);

  // Add to ledger
  db.walletLedger.unshift({
    id: uuidv4(),
    userId: user.id,
    type: 'PREDICTION_DEBIT',
    amount: -betAmount,
    referenceId: game.currentPeriod,
    description: `Bet on Period ${game.currentPeriod} - Option: ${option}`,
    balanceAfter: user.balance,
    createdAt: new Date().toISOString()
  });

  // Broadcast bet placed event (admin live dashboard sees this immediately)
  broadcast({
    type: 'BET_PLACED',
    gameKey,
    bet: betRecord,
    updatedExposure: calculateAdminExposure(gameKey)
  });

  res.json({
    success: true,
    bet: betRecord,
    newBalance: user.balance
  });
});

// 3. User Wallet Recharge
app.post('/api/wallet/recharge', (req, res) => {
  const { userId = 'demo_user', amount = 1000 } = req.body;
  const user = db.users[userId];
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const addAmount = Math.max(1, parseFloat(amount));
  user.balance = Math.round((user.balance + addAmount) * 100) / 100;

  db.walletLedger.unshift({
    id: uuidv4(),
    userId: user.id,
    type: 'DEMO_CREDIT',
    amount: addAmount,
    referenceId: 'TOPUP_' + Date.now(),
    description: `Demo Wallet Recharge +₹${addAmount}`,
    balanceAfter: user.balance,
    createdAt: new Date().toISOString()
  });

  broadcast({
    type: 'USER_UPDATED',
    user
  });

  res.json({ success: true, balance: user.balance });
});

// 4. Get User Bet History
app.get('/api/bets/my', (req, res) => {
  const userId = req.query.userId || 'demo_user';
  const gameKey = req.query.gameKey;
  let bets = db.userBets.filter(b => b.userId === userId);
  if (gameKey) {
    bets = bets.filter(b => b.gameKey === gameKey);
  }
  res.json({
    success: true,
    bets: bets.slice(0, 50)
  });
});

// 5. Get User Wallet Ledger
app.get('/api/wallet/ledger', (req, res) => {
  const userId = req.query.userId || 'demo_user';
  const userLedger = db.walletLedger.filter(l => l.userId === userId);
  res.json({ success: true, ledger: userLedger });
});

// Admin: Get Users list
app.get('/api/admin/users', (req, res) => {
  const usersList = Object.values(db.users).map(u => {
    const bets = db.userBets.filter(b => b.userId === u.id);
    const totalWagered = bets.reduce((sum, b) => sum + b.amount, 0);
    const totalWon = bets.filter(b => b.status === 'WON').reduce((sum, b) => sum + b.payout, 0);
    return {
      ...u,
      totalBetsCount: bets.length,
      totalWagered: Math.round(totalWagered * 100) / 100,
      totalWon: Math.round(totalWon * 100) / 100
    };
  });
  res.json({ success: true, users: usersList });
});

// Admin: Get live exposure simulation for current round
app.get('/api/admin/exposure', (req, res) => {
  const gameKey = req.query.gameKey || 'wingo_60';
  const exposure = calculateAdminExposure(gameKey);
  res.json({ success: true, exposure });
});

// Admin: Set game control mode (random / manual / min_payout / max_payout)
app.post('/api/admin/set-mode', (req, res) => {
  const { gameKey = 'wingo_60', mode } = req.body;
  const game = db.games[gameKey];
  if (!game) return res.status(400).json({ success: false, error: 'Invalid game' });

  if (!['random', 'manual', 'min_payout', 'max_payout'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'Invalid mode' });
  }

  game.controlMode = mode;

  broadcast({
    type: 'ADMIN_MODE_CHANGED',
    gameKey,
    controlMode: game.controlMode,
    manualOverrideNumber: game.manualOverrideNumber
  });

  res.json({ success: true, controlMode: game.controlMode, manualOverrideNumber: game.manualOverrideNumber });
});

// Admin: Force exact winning number for next settlement
app.post('/api/admin/set-outcome', (req, res) => {
  const { gameKey = 'wingo_60', winningNumber } = req.body;
  const game = db.games[gameKey];
  if (!game) return res.status(400).json({ success: false, error: 'Invalid game' });

  if (winningNumber === null || winningNumber === undefined || winningNumber === '') {
    game.manualOverrideNumber = null;
  } else {
    const num = parseInt(winningNumber, 10);
    if (isNaN(num) || num < 0 || num > 9) {
      return res.status(400).json({ success: false, error: 'Number must be between 0 and 9' });
    }
    game.manualOverrideNumber = num;
    game.controlMode = 'manual';
  }

  broadcast({
    type: 'ADMIN_OUTCOME_PRESET',
    gameKey,
    controlMode: game.controlMode,
    manualOverrideNumber: game.manualOverrideNumber
  });

  res.json({
    success: true,
    gameKey,
    periodId: game.currentPeriod,
    manualOverrideNumber: game.manualOverrideNumber,
    properties: game.manualOverrideNumber !== null ? getNumberProperties(game.manualOverrideNumber) : null
  });
});

// Admin: Force settle round right now
app.post('/api/admin/force-settle', (req, res) => {
  const { gameKey = 'wingo_60' } = req.body;
  const game = db.games[gameKey];
  if (!game) return res.status(400).json({ success: false, error: 'Invalid game' });

  settleRound(gameKey);

  res.json({ success: true, message: 'Round force settled successfully!' });
});

// Admin: Speed up timer (sets remaining to 5 seconds to test lock and settle quickly)
app.post('/api/admin/speed-timer', (req, res) => {
  const { gameKey = 'wingo_60', seconds = 6 } = req.body;
  const game = db.games[gameKey];
  if (!game) return res.status(400).json({ success: false, error: 'Invalid game' });

  game.remainingSeconds = Math.max(1, parseInt(seconds, 10));
  res.json({ success: true, remainingSeconds: game.remainingSeconds });
});

// Admin: Adjust user balance directly
app.post('/api/admin/adjust-balance', (req, res) => {
  const { userId = 'demo_user', newBalance, reason = 'Admin Balance Adjustment' } = req.body;
  const user = db.users[userId];
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const targetBal = Math.max(0, parseFloat(newBalance));
  const diff = Math.round((targetBal - user.balance) * 100) / 100;
  user.balance = targetBal;

  db.walletLedger.unshift({
    id: uuidv4(),
    userId: user.id,
    type: diff >= 0 ? 'DEMO_CREDIT' : 'REVERSAL',
    amount: diff,
    referenceId: 'ADMIN_ADJ_' + Date.now(),
    description: `${reason} (${diff >= 0 ? '+' : ''}₹${diff})`,
    balanceAfter: user.balance,
    createdAt: new Date().toISOString()
  });

  broadcast({
    type: 'USER_UPDATED',
    user
  });

  res.json({ success: true, user });
});

// Admin: Get Audit logs
app.get('/api/admin/audit-logs', (req, res) => {
  res.json({ success: true, auditLogs: db.auditLogs });
});

// Start Server
initGameLoop();
server.listen(PORT, () => {
  console.log(`🚀 Tiranga Colour Prediction App server running at http://localhost:${PORT}`);
});
