import type { Tour } from '../types';
import { tryCreated, tryOpenDialog, tryValue, tryVisible } from './helpers';

export const tradingOverviewTour: Tour = {
  id: 'trading-overview',
  section: '/trading',
  title: 'Trading workspace overview',
  summary: 'The eight trading tabs, how trading records relate to tax, and the difference between performance and tax results.',
  minutes: 5,
  needsData: true,
  steps: [
    { title: 'Trading & Investments', route: '/trading', target: 'h1', body: `This workspace covers every market you trade: Australian and US/international shares, ETFs and managed funds, crypto and stablecoins, NFTs, forex, futures, options, CFDs and prop-firm accounts.

All records here are ordinary transactions in the shared ledger — they also appear in Transactions, Tax Calculations and reports.` },
    { title: 'The tabs', target: '.tabs', body: `- **Trade ledger** — every trade, transfer, deposit/withdrawal and in-kind income
- **Accounts** — brokers, exchanges, wallets, prop firms and their **tax treatment**
- **Instruments** — symbols, asset classes, contract sizes
- **Holdings & lots** — the acquisition parcels used for CGT
- **Performance** — broker-style profit and loss
- **Derivatives & positions** — futures, CFD, forex, short and written-option results
- **Prop firms** — fees, payouts and refunds
- **Corporate actions** — splits, mergers, spin-offs, returns of capital` },
    { title: 'Ledger filters', target: '.toolbar', body: 'Show the selected year or all years, one account, or one asset class. Deposits and withdrawals appear here but are **never** treated as profit.' },
    { title: 'Tax classification column', target: 'col:Tax classification', body: `Every trade gets a tax classification from its **account’s tax treatment**:
- **Capital (CGT event)** — investor accounts
- **Revenue trading gain/loss** — trader / profit-making accounts
- **Needs specialist review** — treatment not decided yet (excluded from tax totals until you decide)
- **Simulated** — prop-firm evaluation / demo accounts (excluded from tax)` },
    { title: 'Performance ≠ tax', body: `A broker’s profit, an economic profit and a tax result are different numbers:
- **Performance** uses the money you made, per account, including simulated accounts.
- **Tax** uses parcels pooled across accounts, historical AUD rates for each leg, the CGT discount, losses and the account’s tax treatment.

The Performance tab is clearly labelled “not a tax calculation”.` },
    { title: 'Where results show up', body: `- Capital results → **Tax Calculations → Capital gains** and the CGT schedules in reports
- Revenue results → **Revenue trading results**
- Review items → **Awaiting review**, excluded until classified
- Every figure links back to the trades behind it.` },
    { title: 'Next tutorials', body: 'Continue with **Accounts & tax treatment**, then **Recording trades** for each market, **Holdings & lots**, **Derivatives & options**, **Prop firms**, **Corporate actions** and **Performance**.' }
  ]
};

export const tradingAccountsTour: Tour = {
  id: 'trading-accounts',
  section: '/trading',
  title: 'Trading accounts & tax treatment',
  summary: 'Account types, the investor-vs-trader decision, cost-basis overrides, prop-firm statuses, opening balances and cash balances.',
  minutes: 7,
  steps: [
    { title: 'Accounts', route: '/trading?tab=accounts', target: 'tab:Accounts', body: 'One account per broker, exchange, wallet, futures/forex/CFD/options account, prop-firm account and bank account you use.' },
    { title: 'Add an account', target: 'button:+ Add account', body: 'Opens the account form.', tryIt: tryOpenDialog('Click “+ Add account”.') },
    { before: [{ ensureDialog: 'button:+ Add account' }], title: 'Name and type', target: 'label:Account type', body: `Types: Australian share broker, US share broker, international broker, crypto exchange, crypto wallet (self-custody), futures, forex, CFD, options, prop-firm evaluation, prop-firm funded, bank, cash/other.

The type sets sensible defaults (e.g. imports into a US broker account assume US shares).` },
    { title: 'Institution and identifier', target: 'label:Account identifier (masked)', body: 'The broker/exchange/bank name, and optionally a **masked** identifier such as the last four digits. Never store passwords, API keys or seed phrases.' },
    { title: 'Account currency', target: 'label:Account currency', body: 'The currency the account is held in (AUD, USD…). Used for cash balances and as the default currency when importing.' },
    { title: 'The most important choice: tax treatment', target: 'label:Australian tax treatment of gains', body: `How gains and losses in this account are taxed in Australia:
- **Investor — capital account (CGT)** — gains are capital gains; the 50% discount can apply after 12 months; losses only offset capital gains.
- **Carrying on a business of trading (revenue)** — gains are ordinary income, losses can reduce other income (subject to loss rules); no CGT discount.
- **Isolated profit-making undertaking (revenue)** — a one-off scheme to make a profit; revenue treatment.
- **Not yet determined — review required** — results are excluded and the year is blocked until you decide.
- **Not applicable** — bank/cash accounts.

This depends on your circumstances (frequency, scale, organisation, intention). If unsure, choose “Not yet determined” and ask your tax agent.`, tryIt: tryValue('Choose a tax treatment.', 'label:Australian tax treatment of gains', (v) => !!v) },
    { title: 'Changing treatment later', body: 'You can change the treatment at any time. All automatically classified records of the account are re-classified straight away; classifications you set yourself on individual records are kept.' },
    { title: 'Cost-basis method override', target: 'label:Cost-basis method override', body: 'Normally the method comes from Settings (FIFO by default per asset class). Set an override here if this account uses a different, supportable method — e.g. specific identification from broker contract notes.' },
    { title: 'Prop-firm status', target: 'label:Prop-firm status', body: `- **Evaluation / challenge (simulated)** and **Funded — simulated capital** — trades are excluded from tax (they are not real gains or losses) but still appear in Performance
- **Funded — live capital** — treated like a real account
Fees and payouts are recorded separately (see the Prop firms tutorial).` },
    { title: 'Opening cash balance', target: 'label:Opening cash balance', body: 'The cash balance on the day your records start. Used for cash-balance reconciliation against statements.' },
    { title: 'Archiving', target: 'label:Archived', body: 'Archive closed accounts to hide them from pickers. Their history stays.' },
    { title: 'Your turn', target: 'button:Add', body: 'Give the account a name and institution, then click **Add**. (Practice accounts can be deleted from the same form.)', tryIt: tryVisible('Click “Add”.', 'text:Changes save automatically') },
    { title: 'Recorded cash balance', before: [{ closeDialogs: true }], target: 'col:Recorded cash balance', body: 'Opening balance + deposits − withdrawals ± trade cash flows − fees, per currency, from your records. Compare it with statements in Reconciliation → Statement balances.' }
  ]
};

export const instrumentsTour: Tour = {
  id: 'trading-instruments',
  section: '/trading',
  title: 'Instruments, asset classes & contract details',
  summary: 'Symbols, asset classes, pricing currency, multipliers, tick values, expiry, strike, call/put, stablecoins and spam tokens.',
  minutes: 5,
  steps: [
    { title: 'Instruments', route: '/trading?tab=instruments', target: 'tab:Instruments', body: 'Every share, ETF, coin, token, contract or option you trade is an instrument. Imports create instruments automatically; you can add or correct them here.' },
    { title: 'Add an instrument', target: 'button:+ Add instrument', body: 'Opens the instrument form.', tryIt: tryOpenDialog('Click “+ Add instrument”.') },
    { before: [{ ensureDialog: 'button:+ Add instrument' }], title: 'Symbol and name', target: 'label:Symbol', body: 'Use the ticker the broker uses (e.g. BHP, AAPL, BTC, ESZ5). Name, exchange/market, country and ISIN are optional.' },
    { title: 'Asset class', target: 'label:Asset class', body: `Decides how the engines treat it:
- **Shares, ETFs, managed funds, bonds, crypto, stablecoins, NFTs, bought options** → acquisition parcels and CGT (or revenue, per account)
- **Futures, CFDs, forex positions** → opened/closed positions with profit and loss
- Short sales and written options of any class → position matching`, tryIt: tryValue('Choose “Futures contract”.', 'label:Asset class', 'future') },
    { title: 'Pricing currency', target: 'label:Pricing currency', body: 'The currency prices are quoted in (USD for US shares and CME futures, AUD for ASX). Trades are converted from this currency at historical rates.' },
    { title: 'Contract multiplier', before: [{ ensureDialog: 'button:+ Add instrument' }, { select: ['label:Asset class', 'future'] }], target: 'label:Contract multiplier / size', body: 'Futures, options and CFDs: how much one point is worth per contract (e.g. 50 for an E-mini S&P future, 100 for US equity options). Profit = price change × quantity × multiplier. A missing multiplier is flagged.' },
    { title: 'Tick size and value, expiry', target: 'label:Tick value', body: 'Optional contract specifications for futures: minimum price move, its value, and the expiry date.' },
    { title: 'Options', before: [{ select: ['label:Asset class', 'option'] }], target: 'label:Call / put', body: 'For options record the underlying, strike, expiry and call/put. Exercising a bought call adds the option cost to the shares you receive.' },
    { title: 'Stablecoins', before: [{ select: ['label:Asset class', 'stablecoin'] }], target: 'label:Documented peg (info only)', body: 'You may note the intended peg (e.g. USD), but it is **never used as a rate**. USDT, USDC etc. need their own price records, because they do not always trade at exactly 1.' },
    { title: 'Spam / dust tokens', before: [{ select: ['label:Asset class', 'crypto'] }], target: 'label:Spam / dust token (exclude from calculations)', body: 'Tick for unsolicited airdropped spam tokens. Their records are excluded from calculations and listed so your agent can see what was excluded.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'Nothing is saved until you click **Add**, so practising here is safe.' }
  ]
};

export const recordSharesTour: Tour = {
  id: 'trading-shares',
  section: '/trading',
  title: 'Recording share trades (AU & US)',
  summary: 'Every field of a buy/sell, fees and brokerage, US trades with time zones and USD, settlement and tax-event dates.',
  minutes: 8,
  needsData: true,
  steps: [
    { title: 'Manual entry or import', route: '/trading', target: 'button:+ New record', body: 'Most people import trades from broker CSVs (see the Imports tutorial). Here you will learn every field by entering one manually — useful for corrections and small accounts.', tryIt: tryOpenDialog('Click “+ New record”.') },
    { title: 'Record type: Trade', target: 'label:Record type', body: 'Trades start with the **Trade** type and the **Buy** side.', before: [{ ensureDialog: 'button:+ New record' }, { select: ['label:Record type', 'trade'] }] },
    { title: 'Account', target: 'label:Account', body: 'Choose the broker account. Its **tax treatment** decides whether this trade is a capital (CGT) or revenue item.', tryIt: tryValue('Choose an account (e.g. DEMO AU Broker).', 'label:Account', (v) => !!v) },
    { title: 'Side / event', target: 'label:Side / event', body: `- **Buy** / **Sell** — normal purchases and sales
- **Sell short / write** and **Buy to cover / close** — short positions and written options
- **Swap** — crypto for crypto
- **Send / Receive** — transfers
- **Income** — rewards received in kind
- **Realised P&L**, **Financing**, **Settlement** — statement lines
- **Expiry**, **Exercise**, **Assignment** — options` },
    { title: 'Instrument', target: 'label:Instrument', body: 'Pick the share or add it with **+ New** (symbol, name, asset class, currency).' },
    { title: 'Quantity, price and gross', target: 'label:Unit price', body: 'Enter quantity and unit price. The gross consideration is worked out as quantity × price × multiplier — only fill “Gross consideration” if your statement shows a different total.' },
    { title: 'Brokerage and fees', target: 'label:Commission / brokerage', body: `Brokerage, exchange/clearing fees and other fees are **not** separate deductions for CGT assets: on a buy they are added to the cost base, on a sell they reduce the proceeds.

For trader (revenue) accounts they reduce the trading result.

If fees are charged in another currency (e.g. USD commission on an AUD trade), set **Fee currency**.` },
    { title: 'Date, time and time zone (very important for US trades)', target: 'label:Time zone', body: `Enter the time exactly as the broker shows it and choose its time zone (e.g. **America/New_York** for US exchanges).

Example: a sale at 3:30 PM New York time on 6 March is 7:30 AM on 7 March in Sydney. The app uses the **Sydney date** for the financial year — so a US sale on the afternoon of 30 June belongs to the **next** Australian financial year.` },
    { title: 'Currency for US shares', target: 'label:Currency / asset', body: 'Set USD for US shares. The cost (on the buy date) and the proceeds (on the sell date) are each converted at their own historical AUD rate — this is how currency movements become part of your gain or loss.' },
    { title: 'Settlement date and tax event date', target: 'label:Settlement date', body: `- **Trade date** (the Date field) is normally the date of the CGT event — the contract date.
- **Settlement date** (T+2 etc.) is kept for reconciliation only.
- **Tax event date** (further down) overrides the date used for tax only when your agent advises a different date.` },
    { title: 'Cost-basis method for this sale', before: [{ select: ['label:Side / event', 'sell'] }], target: 'label:Cost-basis method (this disposal)', body: 'For a sale you can choose which parcels are sold: FIFO (oldest first), LIFO, highest cost first, or **Specific identification**, which shows a parcel picker. Leave it on the default unless your records identify the parcels sold.' },
    { title: 'Source ID', target: 'label:Source ID (broker / tx hash)', body: 'The broker’s trade or order number. It prevents the same trade being imported twice and helps your agent match contract notes.' },
    { title: 'Your turn: record a buy', before: [{ select: ['label:Side / event', 'buy'] }], target: 'button:Add record', body: 'Fill in account, instrument, date, quantity, price and brokerage. Click **Add record**.', tryIt: tryCreated('Add a trade.', (t) => t.kind === 'trade') },
    { title: 'Conversion panel', target: 'text:Historical AUD conversion', body: 'For foreign-currency trades, this panel shows the exact AUD rate used, where it came from and how it was chosen. AUD trades say no conversion is needed. The Currency tutorials explain overrides.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'The buy creates an acquisition parcel (see **Holdings & lots**). When you later sell, the app matches the sale to parcels and calculates the gain or loss.' }
  ]
};

export const cryptoTour: Tour = {
  id: 'trading-crypto',
  section: '/trading',
  title: 'Crypto: buys, swaps, stablecoins, transfers, staking',
  summary: 'Crypto-to-crypto swaps, buying with USDT, own-wallet transfers and network fees, staking/airdrops/forks, lost or stolen coins and opening balances.',
  minutes: 9,
  needsData: true,
  steps: [
    { title: 'Crypto in Australian tax (overview)', route: '/trading', body: `For investors, each crypto asset is a CGT asset. Key events:
- **Selling for AUD/USD** — disposal
- **Swapping one coin for another** — disposal of the coin given **and** acquisition of the coin received
- **Buying with a stablecoin** — disposal of the stablecoin
- **Moving between your own wallets** — not a disposal (but a fee paid in coins is)
- **Staking rewards** — income when received; the coins then have that value as cost base` },
    { title: 'Start a crypto record', target: 'button:+ New record', body: 'Open the editor.', tryIt: tryOpenDialog('Click “+ New record”.') },
    { title: 'Buying with AUD', before: [{ ensureDialog: 'button:+ New record' }, { select: ['label:Record type', 'trade'] }], target: 'label:Currency / asset', body: 'A normal **Buy** with currency AUD: quantity of coins, price per coin, exchange fee. The cost base is price × quantity + fee.' },
    { title: 'Buying with a stablecoin (e.g. BTC/USDT)', target: 'label:Currency / asset', body: `If you paid in USDT, set the currency to **USDT**. The app then records **two** events:
- a disposal of the USDT you spent, at its AUD value
- the acquisition of the coin you bought, at the same AUD value

USDT needs a price record (e.g. USDT/AUD). It is **never** assumed to be worth exactly US$1.` },
    { title: 'Swaps (crypto → crypto)', before: [{ select: ['label:Side / event', 'swap'] }], target: 'label:Asset received', body: 'Choose **Swap**: the instrument is the coin you gave, **Asset received** and **Quantity received** describe what you got.' },
    { title: 'AUD market value', target: 'label:AUD market value at the time', body: `Enter the AUD value of the swap at that moment (from the exchange record or a price source). It is both the **proceeds** of the coin given and the **cost base** of the coin received.

If it is blank but price records exist for the coin, the app fills it automatically and says how. If neither, the swap is flagged **missing disposal value**.` },
    { title: 'Transfers between your own wallets', before: [{ select: ['label:Side / event', 'send'] }], target: 'label:Own-account transfer?', body: `Record the **Send** from one account and the **Receive** in the other, then mark them **Yes — between my own accounts**.

Reconciliation → Transfer matching can find and pair them for you. Unmatched transfers are flagged because they might be disposals.` },
    { title: 'Network fees', target: 'label:Network fee (asset units)', body: 'Gas or network fees paid in the coin are a tiny disposal of that coin at market value. Enter the fee in coin units on the **Send** record.' },
    { title: 'Transfers to someone else', target: 'label:Own-account transfer?', body: 'Choose **No — to/from a third party** for payments or gifts. A send becomes a disposal at market value; a receive becomes an acquisition. Both are flagged for review.' },
    { title: 'Staking rewards, airdrops, mining', before: [{ select: ['label:Record type', 'income'] }, { select: ['label:Category', 'crypto_staking'] }], target: 'label:Instrument (dividend / in-kind income)', body: `Use record type **Income** with a crypto category and the coin as the instrument:
- **Amount** — the AUD (or other currency) value when received
- **Quantity** — the number of coins

Staking is ordinary income. Airdrops and mining default to **needs review** (it depends on the circumstances); chain-split (fork) coins have a nil cost base.` },
    { title: 'Opening balances and lost coins', before: [{ select: ['label:Record type', 'adjustment'] }], target: 'label:Adjustment type', body: `Use **Adjustment**:
- **Opening balance** — coins you held before your records start, with their original cost and date (so later sales have a cost base)
- **Lost / stolen** — removes the coins from your holdings and flags a possible capital loss for review (evidence needed)` },
    { title: 'Spam tokens', body: 'Mark unwanted airdropped tokens as spam on the instrument (Trading → Instruments). They are excluded from calculations and listed separately.' },
    { title: 'DeFi, lending, wrapped tokens, bridges', body: 'These can be recorded with swaps, sends/receives, income and fees, but their tax treatment depends on the arrangement and is **not** decided by the app — classify them or leave them as “Needs review” for your agent.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'Close without adding — this was a tour of the fields. Crypto exchanges’ CSVs can be imported in bulk (Imports tutorial).' }
  ]
};

export const derivativesTour: Tour = {
  id: 'trading-derivatives',
  section: '/trading',
  title: 'Futures, CFDs, forex & options',
  summary: 'Contract multipliers, how positions are matched and P&L converted, financing charges, statement P&L, bought and written options, exercise and expiry.',
  minutes: 9,
  needsData: true,
  steps: [
    { title: 'How derivatives are calculated', route: '/trading?tab=positions', target: 'tab:Derivatives & positions', body: `Futures, CFDs, forex positions and all short positions are **matched oldest-first** per account and contract:
- Long: profit = (exit − entry) × quantity × multiplier
- Short: profit = (entry − exit) × quantity × multiplier
- Profit in the contract currency is converted to AUD at the **closing trade’s** historical rate; each fee at its own trade’s rate.` },
    { title: 'Realised results table', target: 'panel:Realised derivative', body: 'Each closed position: date, account, instrument, direction, quantity, P&L and fees in the contract currency, net AUD and its classification. Notes explain any flags.' },
    { title: 'Tax classification of derivatives', target: 'col:Classification', body: `- Trader / profit-making accounts → **Revenue trading**
- Investor (capital) accounts → **Needs specialist review** — gains on CFDs, futures and forex are commonly on revenue account; your agent should confirm
- Not yet determined → **Needs review**
- Prop evaluation → **Simulated** (excluded)` },
    { title: 'Open positions', target: 'panel:Open futures / CFD / forex / short positions', body: 'Positions not yet closed: direction, quantity and average entry. They have no tax effect until closed.' },
    { title: 'Recording a futures trade', before: [{ route: '/trading' }, { click: 'button:+ New record' }, { select: ['label:Record type', 'trade'] }], target: 'label:Contract multiplier', body: 'Record each fill as a Buy or Sell with quantity (contracts) and price. The multiplier comes from the instrument; enter it here only if this trade differs.' },
    { title: 'Fees on derivatives', target: 'label:Exchange / clearing fees', body: 'Commission, exchange/clearing and other fees reduce the realised result. They are split proportionally when a position is closed in parts.' },
    { title: 'Statement P&L rows', before: [{ select: ['label:Side / event', 'realised_pnl'] }], target: 'label:Amount (signed: + profit / − loss or charge)', body: `Some brokers only give closed-trade P&L. Record those as **Realised P&L** (or **Settlement** for daily futures variation margin) with a **signed** amount: + profit, − loss.

Don’t record both the individual fills **and** the statement P&L for the same contract — the app warns about possible double counting.` },
    { title: 'Financing / swap charges', before: [{ select: ['label:Side / event', 'financing'] }], target: 'label:Amount (signed: + profit / − loss or charge)', body: 'CFD and forex overnight funding: side **Financing**, negative amount for a charge (e.g. −6.40). For traders it reduces the trading result; for investors it is a financing expense flagged for review.' },
    { title: 'Forex positions', body: 'Record forex trades on an instrument like EURUSD with asset class **Forex position**: quantity in base units, price as the exchange rate, currency the quote currency (USD for EURUSD). The P&L is in USD and converted to AUD at the closing date.' },
    { title: 'Bought options', before: [{ select: ['label:Side / event', 'buy'] }], target: 'label:Side / event', body: `- **Buy** an option: the premium × multiplier + fees is its cost base
- **Sell** it: normal disposal
- **Expiry** worthless: a capital loss of the premium (investor accounts)
- **Exercise** a call: link the share purchase in “related records” — the option cost is added to the shares’ cost base` },
    { title: 'Written (sold) options', target: 'label:Side / event', body: `- **Sell short / write**: on investor accounts the premium is a capital gain when written (CGT event D2, no discount)
- **Buy to cover / close**, **Assignment**: flagged for specialist review
- On trader accounts written options are matched like any short position.` },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'Close without adding. See also **Performance** for broker-style results that include open positions.' }
  ]
};

export const lotsTour: Tour = {
  id: 'trading-lots',
  section: '/trading',
  title: 'Holdings, parcels (lots) & cost-basis methods',
  summary: 'How acquisition parcels work, partial disposals, pooling, adjustments, FIFO vs specific identification, and tracing a sale to its parcels.',
  minutes: 8,
  needsData: true,
  steps: [
    { title: 'What a parcel (lot) is', route: '/trading?tab=lots', target: 'tab:Holdings & lots', body: `Each purchase (or swap-in, reward, opening balance) creates a **parcel**: quantity, acquisition date and AUD cost base.

When you sell, the sale is matched to parcels. Each parcel keeps its own date, so the 12-month CGT discount test is applied parcel by parcel.` },
    { title: 'Open parcels', target: 'panel:Open acquisition parcels', body: 'Parcels still held today, with remaining quantity and remaining cost base. Fully sold parcels disappear from this list but remain in the calculations and reports.' },
    { title: 'Acquired date', target: 'col:Acquired', body: 'The date (in your Australian time zone) used for the 12-month discount test. The ATO excludes the day you buy and the day you sell — bought 1 July 2023 qualifies if sold on or after 2 July 2024.' },
    { title: 'Origin', target: 'col:Origin', body: '**purchase**, **swap** (received in a crypto swap), **income** (staking/rewards), **quote asset** (stablecoin received when selling), **opening** balance, **corporate action** (spin-off), **fork**, **external receive**.' },
    { title: 'Treatment pools', target: 'col:Treatment', body: 'Identical assets are pooled across all your accounts **within the same tax treatment** — capital holdings separate from trader holdings. That is why moving coins between your own wallets doesn’t break the parcel history.' },
    { title: 'Remaining cost base', target: 'col:Remaining cost base', body: 'Partial sales reduce the cost base in proportion: sell 50 of 100 units and half the cost goes with the sale. **unknown** in red means a missing exchange rate — fix the rate and the parcel updates.' },
    { title: 'Adjustments', target: 'col:Adjustments', body: 'Explains changes to a parcel: share splits, returns of capital, rollovers to a new company, tax-deferred distributions, option premiums added on exercise.' },
    { title: 'Holdings by account', target: 'panel:Holdings by account', body: 'Quantities per account from your recorded flows — compare these with broker or exchange statements (Reconciliation → Statement balances). A negative holding means a missing purchase or transfer in.' },
    { title: 'Cost-basis methods', route: '/settings?tab=tax', target: 'panel:Cost-basis method by asset class', body: `Which parcels a sale uses:
- **FIFO** (default) — oldest first
- **Specific identification** — you choose parcels on each sale
- **LIFO**, **Highest cost first** — parcel-selection orders, appropriate only where your records identify the parcels sold

The app never picks a method because it gives less tax. Average cost is not used for CGT.` },
    { title: 'Method precedence', body: 'A method chosen on a particular sale beats the account’s override, which beats this asset-class default.' },
    { title: 'Specific identification on a sale', before: [{ route: '/trading' }, { click: 'button:+ New record' }, { select: ['label:Record type', 'trade'] }, { select: ['label:Side / event', 'sell'] }, { select: ['label:Cost-basis method (this disposal)', 'SPECIFIC'] }], target: 'label:Cost-basis method (this disposal)', body: 'Choose **Specific identification** on a sale and pick an instrument: a table of its parcels appears so you can enter how many units come from each. If your selection doesn’t cover the whole sale, the rest is matched FIFO and flagged.' },
    { title: 'Tracing a sale to its parcels', before: [{ closeDialogs: true }, { route: '/tax-calc' }], target: 'text:Disposals and parcel allocations', body: 'In Tax Calculations, the disposals table lists every sale with proceeds, cost base, gain and discount eligibility. **Click a row** to see exactly which parcels were used, how many days each was held and whether it got the discount.' },
    { title: 'Missing cost base', body: 'If you sell more than your records show you bought, the excess has **no acquisition record** and the gain is unknown (never assumed to be zero). Fix it by importing older trades, recording an **opening balance** adjustment, or matching a transfer in.' }
  ]
};

export const performanceTour: Tour = {
  id: 'trading-performance',
  section: '/trading',
  title: 'Trading performance',
  summary: 'Broker-style P&L by account, instrument, asset class, currency and direction, win rate, fees and open exposure.',
  minutes: 4,
  needsData: true,
  steps: [
    { title: 'Performance is not tax', route: '/trading?tab=performance', target: '.notice', body: 'This tab shows economic results like your broker does — per account, including simulated prop-firm trading. Use Tax Calculations for tax figures.' },
    { title: 'Filters', target: '.toolbar', body: 'Financial year or all years, account, asset class, currency, long/short, and whether to include simulated (evaluation) accounts.' },
    { title: 'Summary tiles', target: 'stat:Realised P&L', body: 'Realised profit after fees in AUD, total fees, number of closed events and win rate (share of closed events with a profit). Events with missing AUD values are counted underneath.' },
    { title: 'Per instrument', target: 'col:Realised (native)', body: '**Realised (native)** is in the trading currency (e.g. USD) — “mixed” when an instrument was traded in several currencies. **Realised (AUD)** converts each leg at its historical rate.' },
    { title: 'Open exposure', target: 'panel:Open positions / exposure', body: 'What you still hold, its cost base and an approximate exposure using the **last recorded trade price** — there is no live market data in this app.' }
  ]
};

export const propTour: Tour = {
  id: 'trading-prop',
  section: '/trading',
  title: 'Prop-firm accounts, fees & payouts',
  summary: 'Evaluation vs funded accounts, challenge/reset/subscription fees, payouts, refunds, profit share and classification.',
  minutes: 5,
  needsData: true,
  steps: [
    { title: 'Prop firms', route: '/trading?tab=prop', target: 'tab:Prop firms', body: 'Funded-trader programmes involve fees (evaluations, resets, subscriptions), simulated or live trading, and payouts under a profit share.' },
    { title: 'Totals', target: 'stat:Evaluation / reset / platform fees', body: 'Fees paid, payouts received and refunds for the year in AUD (converted at historical rates), plus your prop accounts and their status.' },
    { title: 'Accounts', body: `Create one account per prop-firm account (Trading → Accounts) and set its **Prop-firm status**:
- **Evaluation / challenge** and **Funded — simulated** → trades excluded from tax
- **Funded — live capital** → treated as real trading
Record the firm, payout currency and profit-share %.` },
    { title: 'Fees and payouts are separate records', target: '.notice', body: `Record fees as **Fee** records (categories: evaluation/challenge fee, reset fee, subscription/platform fee, withdrawal/termination fee) and payouts/refunds as **Income** (prop-firm payout / refund).

They default to **Needs specialist review** because their tax character depends on your situation — e.g. business income and business expenses if you carry on a trading business.` },
    { title: 'Classify once, used everywhere', body: 'When you set the classification (e.g. Business income) on a payout — individually or with Bulk edit — it automatically appears in the **Tax & Business** business ledger and profit and loss. No re-entry.' },
    { title: 'Evidence', body: 'Attach payout statements and fee invoices to the records (Attach file… in the editor). Missing evidence is flagged.' },
    { title: 'Importing prop-firm statements', body: 'Imports → “Prop-firm payouts & fees” maps a statement’s type column (payout, refund, evaluation fee, reset fee, subscription) to the right categories automatically.' }
  ]
};

export const corporateActionsTour: Tour = {
  id: 'trading-corporate',
  section: '/trading',
  title: 'Corporate actions',
  summary: 'Splits, consolidations, bonus issues, scrip-for-scrip rollovers, demergers/spin-offs, returns of capital and symbol changes.',
  minutes: 5,
  steps: [
    { title: 'Corporate actions', route: '/trading?tab=corporate', target: 'tab:Corporate actions', body: 'Company events that change your holdings or cost base without you trading. Record them here and the parcel engine applies them on the effective date.' },
    { title: 'Add one', target: 'button:+ Add corporate action', body: 'Opens the form.', tryIt: tryOpenDialog('Click “+ Add corporate action”.') },
    { before: [{ ensureDialog: 'button:+ Add corporate action' }], title: 'Type', target: 'label:Type', body: `- **Split / reverse split / bonus** — units × new ÷ old; total cost base and dates unchanged
- **Merger rollover** — shares exchanged for shares of another company with scrip-for-scrip rollover: parcels move to the new company, keeping original dates and cost base (eligibility flagged)
- **Spin-off** — part of the cost base moves to new shares (enter the %), acquisition dates inherited (demerger relief, flagged)
- **Return of capital** — cost base reduced by the cash per unit; any excess is a capital gain (G1)
- **Symbol change** — moves holdings to the renamed instrument
- **Taxable merger / other** — recorded and flagged; enter the resulting sale/purchase manually after review` },
    { title: 'Ratio', target: 'label:Old units', body: 'Old units : New units. A 2-for-1 split is 1 : 2; a 1-for-10 consolidation is 10 : 1.' },
    { title: 'New instrument and cost-base share', before: [{ select: ['label:Type', 'spinoff'] }], target: 'label:% of cost base to new instrument', body: 'For spin-offs, choose the new instrument and the percentage of the original cost base allocated to it — the company’s demerger booklet or ATO class ruling gives this figure.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'The Holdings & lots “Adjustments” column shows each corporate action applied to each parcel.' }
  ]
};
