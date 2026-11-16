<div align="center">
  <img src="public/logo-mark.png" alt="UnityWealth Logo" width="88" height="88" />
  <h1>UnityWealth</h1>
  <p><strong>Cross-Border Family Portfolio, Tax-Smart Rebalancing &amp; RSU Wealth Platform</strong></p>
  <p>
    Built for Indian households managing combined domestic &amp; global wealth across Indian Mutual Funds, NSE/BSE Stocks, US ETFs, Employer RSUs, Arbitrage/Debt Funds, and Real Estate.
  </p>
  <p>
    <a href="https://unitywealth.up.railway.app"><strong>Live App</strong></a> ·
    <a href="#key-features">Key Features</a> ·
    <a href="#architecture--data-model">Architecture</a> ·
    <a href="#local-development">Local Setup</a> ·
    <a href="#deployment-railway">Deployment</a>
  </p>
</div>

---

## Key Features

### 1. Unified Family & Individual Portfolio Dashboard
- **Combined & Per-Member Views:** Instant 6-character **Family Invite Code** (`Join Family`) merges spouse/family accounts into a single real-time household view while keeping individual member tabs one click away.
- **Live Multi-Currency Valuation (`INR` & `USD`):** Real-time USD/INR FX conversion, live US/NSE equity quotes (Yahoo Finance, TradingView, Finnhub, AlphaVantage), and in-memory indexed **AMFI NAV** lookups (`13,700+` schemes & `17,500+` ISINs in `O(1)`).
- **Unified Asset Name Normalizer:** Clean display names across verbose CAMS/KFintech RTA scheme codes and US ETF umbrella trusts (`src/lib/formatAssetName.ts`).
- **Flash-Free Light / Dark / Auto Theme:** Synchronous `<head>` theme boot (`uw_theme`) with one-click header and sidebar toggles.

### 2. Multi-Broker AI Statement Import & Gmail Auto-Sync
- **PDF / XLSX / CSV / ODS Statement Extraction:** Powered by **Gemini 2.5 Flash** (`/api/gemini/extract`) with tailored rules for:
  - **India:** CAMS / KFintech / MFCentral CAS, Zerodha Console (Holdings XLSX/CSV), INDmoney
  - **US / Global:** E\*TRADE (vested RSU/ESPP + future unvested RSU schedules), Charles Schwab, Interactive Brokers (IBKR)
- **Safety Guards:** Automatically rejects realized Capital-Gain / Tax-P&L-only files so redeemed units are never mistaken for open holdings, and prevents double-counting Zerodha `Quantity Long Term`.
- **Automatic Tax-Lot & RSU Extraction:** Captures open tranche purchase/vest dates, per-unit cost basis, and future RSU vest schedules directly during statement upload.

### 3. India `> ₹1 Cr` Top-Bracket Tax-Smart Rebalancing & AI CIO Strategist
- **Hierarchical Target Engine:** Set top-level **Equity vs Debt**, **Indian vs Foreign Equity**, and granular **Foreign Theme / Ticker** targets (`Target Config`).
- **Domain Classification Safeguards:**
  - Any **Arbitrage**, **Liquid**, **Money Market**, **Gilt**, or **Corporate Bond** fund is strictly classified as **Debt** for portfolio stability — while **Arbitrage Funds** are accurately modeled under **Indian Equity taxation (`14.95%` LTCG >12m)** instead of `35.88%–39.00%` marginal slab Debt tax.
- **Post-Finance-Act-2024/2025 Indian Tax Math (`src/shared/taxAndRsuMath.ts`):**
  - Models the statutory **15% surcharge cap** on Sec 111A / 112A / 112 capital gains (`14.95%` effective LTCG on Indian Equity `>12m` & Foreign Equity/RSUs `>24m`; `23.92%` Indian Equity STCG) vs uncapped **Marginal Slab** (`35.88%` for ₹1–2 Cr; `39.00%` for `> ₹2 Cr` New Regime) on Foreign Equity `<=24m` and Sec 50AA Debt MFs.
  - Prioritizes **fresh RSU vests (`~₹0` gain above vest FMV = `~0%` extra capital gains tax)** ahead of appreciated STCG/LTCG lots.
- **Lot-by-Lot Execution (`Which Lot to Sell?`):** Expandable per-SELL-order tranche picker aware of **Specific-ID** (US brokers) vs **FIFO-within-folio** (Indian demat/MF folios), **60-day LTCG Cliff Guard**, **Multi-PAN ₹1.25L Sec 112A Tax-Free Harvest**, **Tax-Loss Harvesting**, **Minimum-Tax Cash Raiser**, and **Zero-Sell Monthly SIP** routing.
- **Interactive Gemini Wealth & Tax Strategist (`/api/ai/wealth-copilot`):** Ask natural-language portfolio, tax, RSU, and cash-flow questions grounded in live household data.

### 4. Future RSU Vesting Tracker & Forward Drift Simulator
- **Grant & Vest Schedule Builder:** Track unvested employer RSU grants (`QCOM`, `GOOGL`, `MSFT`, `NVDA`, etc.) with customizable tax-withholding sell-to-cover (`31.2%`–`39.0%`).
- **Forward Allocation Drift (`+6M / +12M / +24M`):** Simulates portfolio drift under **Bear (`-20%`) / Flat (`0%`) / Bull (`+20%`)** stock price scenarios without polluting current liquid rebalancing math.
- **Pre-Vest Playbooks & 1-Click Vesting:** Compares **Playbook A (*Sell-at-Vest @ ~₹0 cap-gains tax*)** vs **Playbook B (*Hold Stock & Counter-SIP*)**, plus 1-click **`Mark Vested`** conversion into a live Holding + dated `RSU Vest` Tax Lot.

### 5. Wealth Journey, Real Estate & Compliance Exports
- **Wealth Journey & True Cash-Flow XIRR:** Monthly net-worth snapshots in PostgreSQL, milestone tracking, compounding projections, and Newton-Raphson **True XIRR** across dated tranches.
- **Real Estate & Accelerated Home Loan Tracker:** Tracks paid-in property equity in Family Net Worth (strictly excluded from liquid Equity/Debt rebalancing), multi-split milestone payments (**Credit Cards, MDR gateway fees, Reward Points, Home Loan disbursements, 1% Form 26QB TDS, Stamp Duty**), Self-vs-Loan OCR ratio planner, 15-year vs 30-year EMI catch-up tracker, and lump-sum prepayment simulator.
- **1-Click Compliance & Family Continuity Exports:**
  - **ITR Schedule FA CSV:** Calendar-year (`Jan 1 – Dec 31`) Foreign Assets disclosure worksheet for Indian tax filing.
  - **Family Emergency ICE Vault (Printable PDF):** Consolidated asset, broker, folio, and nominee directory for family continuity.

---

## Architecture & Data Model

```mermaid
flowchart LR
  subgraph Client["React 19 + TypeScript + Tailwind v4 (Vite)"]
    UI["Dashboard • Wealth Journey • Real Estate • Rebalance & RSU • Markets"]
    Shared["Shared Pure Math Engine\n(portfolioMath • taxAndRsuMath • realEstateMath)"]
  end

  subgraph Server["Node.js + Express API (server.ts)"]
    Auth["Firebase ID Token + Household Guard"]
    Quotes["Live Quote & O(1) AMFI NAV Engine\n(Bounded TTL LRU Caches)"]
    AI["Gemini 2.5 Statement Extractor\n& AI Tax/Wealth Copilot"]
    Mail["Gmail OAuth / Resend Alert Gateway"]
  end

  subgraph Storage["Hybrid Cloud Persistence"]
    FS[("Cloud Firestore\nUsers • Households • Live Holdings • Targets")]
    PG[("PostgreSQL\nuw_wealth_snapshots • uw_real_estate\nuw_tax_planning • uw_notifications")]
  end

  UI --> Shared
  UI <-->|"Real-time onSnapshot"| FS
  UI <-->|"Bearer Firebase ID Token"| Auth
  Auth --> Quotes
  Auth --> AI
  Auth --> Mail
  Auth <--> PG
```

### Project Structure

```text
UnityWealth/
├── index.html                        # App shell, PWA icons & flash-free theme boot script
├── server.ts                         # Express API server, quote/FX feeds, Gemini extraction & email gateway
├── public/                           # Standalone U emblem logo, favicons & webmanifest
└── src/
    ├── App.tsx                       # Main application shell, Firestore sync & household orchestration
    ├── types.ts                      # Core TypeScript domain interfaces
    ├── index.css                     # Tailwind v4 theme & semantic Dark Mode surfaces
    ├── shared/                       # Isomorphic client + server domain math & caches
    │   ├── portfolioMath.ts          # Asset classification, drift, accuracy & Zero-Sell SIP math
    │   ├── taxAndRsuMath.ts          # >₹1Cr Indian tax engine, Lot optimizer, RSU simulator, XIRR & Schedule FA
    │   ├── formatters.ts             # Compact INR/USD formatters & invite-code helpers
    │   └── lruCache.ts               # Bounded O(1) TTL LRU cache
    ├── server/                       # Backend-only persistence & indexing modules
    │   ├── postgresStore.ts          # PostgreSQL connection pool, schema & JSONB stores
    │   └── amfiIndex.ts              # Inverted-index AMFI Mutual Fund NAV & ISIN matcher
    ├── lib/                          # Client utilities & hooks
    │   ├── firebase.ts               # Firebase Auth & Firestore client setup
    │   ├── formatAssetName.ts        # Unified Indian MF + US ETF/Stock name shortener
    │   ├── realEstateMath.ts         # Property equity, card rewards, EMI & prepayment math
    │   └── useTheme.ts               # Light / Dark / System theme hook
    └── components/                   # Modular UI views, modals & drawers
        ├── HoldingsExplorer.tsx      # Searchable/filterable holdings table + expandable tax lots
        ├── HoldingTaxLotsDrawer.tsx  # Per-holding purchase/RSU vest tranche drawer
        ├── TaxSmartInsightsPanel.tsx # >₹1Cr tax cards, Cash Raiser & Gemini AI Strategist
        ├── RsuFuturePlannerPanel.tsx # Unvested RSU schedule & +6M/+12M/+24M drift simulator
        ├── RealEstateView.tsx        # Property milestones, card/loan splits & EMI simulator
        ├── WealthJourneyView.tsx     # Historical net-worth curve, XIRR & compounding projections
        ├── QuickAddModal.tsx         # Live symbol search, manual add & multi-file upload modal
        ├── ThemeToggle.tsx           # Light / Dark / System theme controls
        └── views/                    # Lazy-loaded route views (Rebalance, Targets, Markets, Auth)
```

---

## Local Development

### Prerequisites
- **Node.js** `>= 20` and `npm`
- **Firebase Project** (Authentication + Cloud Firestore; client config in `firebase-applet-config.json`)
- **PostgreSQL** *(optional locally — automatically falls back to in-memory/local state when `DATABASE_URL` is omitted)*

### 1. Install Dependencies
```bash
git clone https://github.com/hgarg5072/unitywealth.git
cd unitywealth
npm install
```

### 2. Configure Environment Variables
Create a `.env.local` (or `.env`) file in the project root:

```bash
# Required for AI statement parsing (/api/gemini/extract) & AI Tax Strategist (/api/ai/wealth-copilot)
GEMINI_API_KEY="your_gemini_api_key"

# Public URL of the app (used for OAuth callbacks & family invite links)
APP_URL="http://localhost:3000"

# PostgreSQL connection string (recommended for persistent snapshots, real estate & tax/RSU plans)
DATABASE_URL="postgresql://user:password@localhost:5432/unitywealth"

# Optional: Live market quote fallbacks (Yahoo Finance & AMFI work without keys)
FINNHUB_API_KEY=""
ALPHAVANTAGE_API_KEY=""

# Optional: Google OAuth (Gmail CAS auto-sync & Gmail alert sender) / Resend email alerts
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
RESEND_API_KEY=""
RESEND_FROM=""
```

### 3. Start the Dev Server
```bash
npm run dev
```
Open `http://localhost:3000` (Express + Vite HMR middleware run together on a single port).

### Useful Scripts
| Command | Description |
|---|---|
| `npm run dev` | Start Express + Vite development server with hot reload (`tsx server.ts`) |
| `npm run lint` | Run full TypeScript typecheck (`tsc --noEmit`) |
| `npm run build` | Build production Vite client (`dist/`) + bundle Express server (`dist/server.cjs`) |
| `npm start` | Run compiled production server (`node dist/server.cjs`) |

---

## Deployment (Railway)

UnityWealth is configured for zero-downtime single-service deployment on **Railway** (Railpack builder) with a managed Railway PostgreSQL database:

- **Build Command:** `npm run build`
- **Start Command:** `npm start`
- **Healthcheck Endpoint:** `/api/health` (verifies server readiness, PostgreSQL pool status, and outgoing email configuration)
- **Auto-Deploy:** Pushing to `main` on GitHub automatically builds, runs `CREATE TABLE IF NOT EXISTS` migrations in PostgreSQL, warms the AMFI index, and swaps traffic once `/api/health` returns `200 OK`.
