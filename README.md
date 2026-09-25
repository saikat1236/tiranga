# tiranga

# Tiranga Colour Prediction Game Web App & Master Admin Controller

A modern, high-performance **Tiranga / Win Go style Colour Prediction Game** web application with full real-time WebSocket synchronization and a powerful **Master Admin Control Panel** that lets you control the game output, force winning outcomes, inspect live exposures, and optimize house profit.

Built according to the specification outlined in `Tiranga_Colour_Prediction_App_Working_Model.docx`.

---

## 🌟 Key Features

### 🎮 Player Game Interface
- **Tiranga Win Go Gameplay**:
  - **4 Timed Modes**: Win Go 30s, Win Go 1Min (default), Win Go 3Min, Win Go 5Min.
  - **Colour Betting**: Green (2x / 1.5x), Violet (4.5x), Red (2x / 1.5x).
  - **Exact Number Betting (0–9)**: High-yield **9x** multiplier!
  - **Big / Small Betting**: Big (5–9) & Small (0–4) with 2x multiplier.
  - **Split Colors**: Number 0 (Red + Violet) and Number 5 (Green + Violet).
- **Interactive Betting Drawer**:
  - Quantity counter (`-` / `+`) and unit selection (₹1, ₹10, ₹100, ₹1,000).
  - Multiplier chips (X1, X5, X10, X20, X50, X100).
  - Dynamic calculation with published 2% service handling fee.
- **Real-Time Digital Countdown**:
  - Live seconds counter with circular animated progress.
  - **Auto Lock Period**: Final 5 seconds lock betting and display a holographic warning overlay.
- **Victory Celebrations & Audio**:
  - Fullscreen confetti burst canvas on win.
  - Web Audio API synthesizer for countdown ticking, bet chime, win fanfare, and loss cues (no external audio dependencies).
- **Game Records, Trend Chart & Ledger**:
  - **Game Record**: Complete history of past periods, numbers, colors, and Big/Small.
  - **Trend Chart**: Visual zigzag lottery bead grid tracking recent patterns.
  - **My History**: Real-time record of all player bets with `WON`, `LOST`, or `PENDING` status.
  - **Wallet Ledger**: Transparent double-entry transaction history (`DEMO_CREDIT`, `PREDICTION_DEBIT`, `PAYOUT_CREDIT`).

---

### ⚙️ Master Admin Control Panel (Direct Outcome Control)
- **Game Output Control Modes**:
  1. 🎯 **Manual Override**: Directly force the exact winning number (`0` through `9`) for the next round.
  2. 🛡️ **House Advantage (Min Payout)**: Algorithmic profit optimizer that calculates all player bets and selects the number that pays out the least money, guaranteeing maximum house profit!
  3. 🎲 **Fair Random**: Cryptographically secure server random number generator (`crypto.randomInt`).
  4. 🎁 **Promotional (Max Payout)**: Auto-selects the outcome with maximum player winnings.
- **Direct 0–9 Outcome Keypad**:
  - Click any number button (0–9) to immediately lock it as the guaranteed winner for the next period.
  - Prominent status indicator displays the currently forced outcome.
- **Live Exposure & House Profit Simulator**:
  - Real-time table evaluating all 10 potential outcomes (0 to 9) against currently committed bets.
  - Displays total player payout, house net profit/margin, and a one-click **"🎯 Force Outcome"** button for each row.
- **Round Speed Control**:
  - **⚡ Force Settle Now**: Instantly settles the round without waiting for the countdown.
  - **⏩ Fast Forward**: Speeds up timer to 5 seconds remaining to test locking and settlement.
- **Player & Wallet Management**:
  - Live player list, balances, wager volume, and win statistics.
  - Quick top-up (+₹1,000) or manual custom balance adjustment with ledger logging.
- **Audit Log Trail**:
  - Full audit records of all settled rounds, outcome determination methods (`manual_override`, `min_payout_algorithm`, `random_fair`), and financial breakdown.

---

### 🔲 Dual-View Split Screen
- Switch seamlessly between:
  - **🔲 Split Screen**: Side-by-side view (Player on the left, Admin on the right) for live testing.
  - **🎮 Player App**: Focused mobile-optimized experience.
  - **⚙️ Admin Panel**: Full desktop dashboard view.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm`

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/saikat1236/tiranga.git
cd tiranga

# Install dependencies
npm install
```

### 3. Run Locally
```bash
npm start
```
The application will launch at:
👉 **`http://localhost:3000`**

---

## 📁 Project Structure

```
tiranga/
├── package.json               # Dependencies and scripts
├── server.js                  # Express + WebSocket server, Game engine & settlement
├── Tiranga_...Working_Model.docx # Technical architecture document
├── public/
│   ├── index.html             # Single-page application with Split Screen layout
│   ├── css/
│   │   ├── style.css          # Design system, variables, modals & responsive views
│   │   ├── game.css           # Win Go betting board, timers, number balls & trend charts
│   │   └── admin.css          # Admin panel, outcome keypad, exposure simulator & audit tables
│   └── js/
│       ├── sound.js           # Web Audio API sound generator (no external files needed)
│       ├── api.js             # WebSocket client & REST fallback APIs
│       ├── game.js            # Player UI, betting modal, trend chart & celebrations
│       ├── admin.js           # Admin controller, outcome override & balance manager
│       └── app.js             # View orchestrator, toast system & modal handlers
```

---

## 📜 Game Rules & Payout Table

| Bet Option | Winning Conditions | Multiplier |
|---|---|---|
| **Green** | Numbers 1, 3, 7, 9 | **2.0x** |
| **Green** | Number 5 (Green + Violet split) | **1.5x** |
| **Red** | Numbers 2, 4, 6, 8 | **2.0x** |
| **Red** | Number 0 (Red + Violet split) | **1.5x** |
| **Violet** | Numbers 0 or 5 | **4.5x** |
| **Number (0–9)** | Exact match on selected number | **9.0x** |
| **Big** | Numbers 5, 6, 7, 8, 9 | **2.0x** |
| **Small** | Numbers 0, 1, 2, 3, 4 | **2.0x** |

*A 2% service charge is deducted from the gross stake on contract placement.*

---

## 🛡️ License

This project is open-source under the ISC License.
