// Script to completely clean and fresh the Supabase PostgreSQL database
require('dotenv').config();
const { pool } = require('./pg_service');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function freshDatabase() {
  console.log('🔄 Cleaning all tables in Supabase PostgreSQL...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Truncate all tables
    await client.query(`
      TRUNCATE TABLE bets, wallet_ledger, game_history, audit_logs, game_settings, users CASCADE;
    `);
    console.log('✅ All previous records truncated.');

    const now = new Date().toISOString();
    const salt = bcrypt.genSaltSync(10);

    // 2. Create Master Admin
    const adminHash = bcrypt.hashSync('admin123', salt);
    await client.query(`
      INSERT INTO users (id, mobile, username, password_hash, name, balance, status, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, ['admin_master', '9000000000', 'admin', adminHash, 'Master Admin', 0.00, 'active', 'admin', now, now]);
    console.log('✅ Default Master Admin created: admin / admin123');

    // 3. Create Demo Player
    const playerHash = bcrypt.hashSync('password123', salt);
    const demoUserId = 'demo_user';
    const initialBalance = 1000.00;
    await client.query(`
      INSERT INTO users (id, mobile, username, password_hash, name, balance, status, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [demoUserId, '9876543210', 'player', playerHash, 'Demo Player', initialBalance, 'active', 'player', now, now]);

    // Ledger for welcome bonus
    const ledgerId = uuidv4();
    await client.query(`
      INSERT INTO wallet_ledger (id, user_id, type, amount, reference_id, description, balance_after, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [ledgerId, demoUserId, 'WELCOME_BONUS', initialBalance, 'INIT_SEED', 'Welcome Signup Bonus +₹1000', initialBalance, now]);
    console.log('✅ Default Demo Player created: 9876543210 / password123 (Balance: ₹1,000)');

    // 4. Initialize Game Settings (all random fair play by default)
    const games = ['wingo_30', 'wingo_60', 'wingo_180', 'wingo_300'];
    for (const g of games) {
      await client.query(`
        INSERT INTO game_settings (game_key, control_mode, manual_override_number, updated_at)
        VALUES ($1, 'random', NULL, NOW())
      `, [g]);
    }
    console.log('✅ Game Settings reset to fair random play.');

    // 5. Seed initial 15 history items per game
    const today = now.slice(0, 10).replace(/-/g, '');
    const numberColors = {
      0: { color: 'red-violet', colors: ['red', 'violet'], size: 'small' },
      1: { color: 'green', colors: ['green'], size: 'small' },
      2: { color: 'red', colors: ['red'], size: 'small' },
      3: { color: 'green', colors: ['green'], size: 'small' },
      4: { color: 'red', colors: ['red'], size: 'small' },
      5: { color: 'green-violet', colors: ['green', 'violet'], size: 'big' },
      6: { color: 'red', colors: ['red'], size: 'big' },
      7: { color: 'green', colors: ['green'], size: 'big' },
      8: { color: 'red', colors: ['red'], size: 'big' },
      9: { color: 'green', colors: ['green'], size: 'big' }
    };

    const durations = { wingo_30: 30, wingo_60: 60, wingo_180: 180, wingo_300: 300 };
    for (const g of games) {
      for (let i = 1; i <= 15; i++) {
        const periodSeq = String(i).padStart(4, '0');
        const periodId = `${today}${periodSeq}`;
        const num = Math.floor(Math.random() * 10);
        const props = numberColors[num];
        const settledAt = new Date(Date.now() - (15 - i) * durations[g] * 1000).toISOString();
        const totalBets = Math.floor(Math.random() * 2500) + 500;
        const totalPayout = Math.floor(Math.random() * 2000) + 400;
        const houseProfit = totalBets - totalPayout;

        await client.query(`
          INSERT INTO game_history (id, game_key, period_id, number, color, colors, size, total_bets, total_payout, house_profit, mode, settled_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'random_fair', $11)
        `, [uuidv4(), g, periodId, num, props.color, JSON.stringify(props.colors), props.size, totalBets, totalPayout, houseProfit, settledAt]);
      }
    }
    console.log('✅ Initial seed history created for all 4 games.');

    await client.query('COMMIT');
    console.log('🎉 Database refresh complete! Fresh, clean state ready for tracking.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error refreshing database:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

freshDatabase();
