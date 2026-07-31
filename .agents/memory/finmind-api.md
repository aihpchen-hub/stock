---
name: FinMind API datasets
description: Correct FinMind dataset names and response field formats for Taiwan stock data
---

## Dataset names (v4 API)
- Price: `TaiwanStockPrice` — fields: date, close, open, max, min, Trading_Volume
- Monthly revenue: `TaiwanStockMonthRevenue` — fields: date, revenue, revenue_month, revenue_year (no YoY field; calculate manually)
- Institutional buy/sell: `TaiwanStockInstitutionalInvestorsBuySell` — NOT `TaiwanStockInstitutionalInvestors`

## Institutional investor field format
- Fields: date, stock_id, name, buy, sell — NO `net_buy` field; calculate as `buy - sell`
- Units: **shares (股)**, not NTD. Convert to 張 by ÷1000 for display.
- name values: `Foreign_Investor`, `Foreign_Dealer_Self`, `Investment_Trust`, `Dealer_self`, `Dealer_Hedging`
- Aggregate: foreignNet = Foreign_Investor + Foreign_Dealer_Self; trustNet = Investment_Trust; dealerNet = Dealer_self + Dealer_Hedging

## Guest mode limits
- ~30 requests/day without token
- With free token (FINMIND_TOKEN env var): 600 req/hour
- 3–5 stocks × 3 datasets = 9–15 calls per full analysis (fits guest mode for dev/demo)

**Why:** Wrong dataset name returned 0 results silently; buy-sell units being shares (not NTD) caused wrong display.
