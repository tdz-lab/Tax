import type { Tour } from '../types';
import { tryOpenDialog, tryRoute, tryValue, tryVisible } from './helpers';

export const currencyBasicsTour: Tour = {
  id: 'currency-basics',
  section: '/settings',
  title: 'How currency conversion works',
  summary: 'Original amounts, AUD per unit, rate provenance, the rate methodology settings, look-back, cross rates and why rates are never guessed.',
  minutes: 8,
  needsData: true,
  steps: [
    { title: 'The rule: keep the original, convert with a documented rate', route: '/settings?tab=rates', body: `Every foreign-currency record keeps its **original amount and currency** (e.g. 4,199 USD). The AUD value is always worked out as amount × rate — it is never typed over, and a rounded AUD figure is never converted back.

For each record the app stores **which rate** was used and **why**, so your tax agent can reproduce every number.` },
    { title: 'Rates are never invented', body: `If no suitable historical rate exists, the record is flagged **no rate**:
- it is **not** converted at today’s rate
- it is **not** treated as zero
- totals depending on it show **INCOMPLETE**

You fix it by importing rates or entering a rate with its source.` },
    { title: 'Methodology settings', target: 'panel:Historical-rate methodology', body: 'These settings decide which rate each record gets. Changing them re-checks every record immediately (manual and broker rates are left alone). Your choice should be explained to your agent — the full report lists it.' },
    { title: '1. Execution rates first', target: 'label:Prefer execution / intraday rates nearest the trade time', body: 'Some brokers state the exact conversion they applied to a trade (an **execution rate**). When ticked, those are used first. Imported files with an “FX rate” column create such rates, pinned to the trade.' },
    { title: '2. Which date’s daily rate', target: 'label:Daily rate date basis', body: `Daily reference rates (such as the RBA’s published rates) are one per day. Which day?
- **Date of the event in your (Australian) time zone** — default; consistent with how the financial year is assigned
- **Date at the trading venue** — e.g. the New York date for a US trade

A US trade at 3:30 PM on 6 March New York is 7 March in Sydney — these options pick different days’ rates.` },
    { title: '3. Weekends and public holidays', target: 'label:Look back for prior published rate (days)', body: 'Daily rates aren’t published on weekends or holidays. The app can use the nearest **earlier** published rate, up to this many days back. Each time it does, the record is marked “prior day −N” and listed in data quality. Set 0 to require an exact date.' },
    { title: '4. Preferred source', target: 'label:Preferred source name', body: 'If you hold rates from several sources for the same day (e.g. RBA and a broker), the one named here wins. Otherwise the first imported is used.' },
    { title: '5. Cross rates via USD', target: 'label:Allow cross rates via USD', body: 'When there is no direct AUD rate for a currency (or a coin priced only in USD), the app can combine X→USD and USD→AUD. Both underlying rates are recorded on the conversion.' },
    { title: 'Re-checking all records', target: 'button:Re-resolve all conversions', body: 'Runs the methodology over every record again. This happens automatically after rate imports, manual rates or setting changes; the button is there for reassurance.' },
    { title: 'Direction of rates — a common trap', target: 'panel:Historical rates & prices', body: `A rate always means **1 base = rate quote**:
- RBA style: **AUD/USD 0.6543** = 1 AUD buys 0.6543 USD
- Price style: **USD/AUD 1.5283** = 1 USD costs 1.5283 AUD

Both describe the same thing. The app stores the rate exactly as quoted, plus the derived “AUD per 1 unit”, so the direction is never ambiguous. The “Meaning” column spells it out.` },
    { title: 'Seeing the conversion on a record', before: [{ route: '/transactions' }, { select: ['[aria-label="Currency filter"]', 'USD'] }], target: 'col:AUD', body: 'Here are USD records. Each AUD figure comes from that record’s own historical rate. Click a record to open it.', tryIt: tryOpenDialog('Click any USD record.') },
    { before: [{ ensureDialog: 'css:table.dt tbody tr.clickable td:nth-child(3)' }], title: 'The conversion panel', target: 'panel:Historical AUD conversion', body: `- **AUD per 1 USD** — the multiplier used
- **Rate as quoted** — e.g. “0.63 (USD per 1 AUD)”
- **Rate date** — and “prior day −N” if a weekend look-back was used
- **Type / source** — daily reference, execution, manual or cross, and who published it
- **Methodology** — exactly how it was chosen` },
    { title: 'Rate history', target: 'panel:Historical AUD conversion', body: 'If a rate is replaced (new import, methodology change, manual override), the previous one is kept in **Rate history** with the reason. Overrides are also in the audit history and the full report.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'Next: **Importing exchange rates** and **Manual rates & fixing missing rates**.' }
  ]
};

export const ratesImportTour: Tour = {
  id: 'currency-import',
  section: '/imports',
  title: 'Importing exchange rates & crypto prices',
  summary: 'Long and wide rate tables (e.g. RBA historical data), naming the source, direction, crypto/stablecoin prices and what happens after import.',
  minutes: 7,
  steps: [
    { title: 'Where rates come from', route: '/imports', body: `The app does not download rates itself (it works offline and never assumes a source). You download published tables and import them, for example:
- the **RBA** historical exchange-rate tables (daily AUD rates for major currencies)
- a broker’s or exchange’s conversion/price history
- crypto price history (e.g. BTC/AUD, USDT/AUD) from a source you trust

Always keep the original downloaded file as evidence.` },
    { title: 'Choose the file type', target: 'label:What does the file contain?', body: 'Choose **Historical exchange rates / prices**. (A file in the app’s own rate layout is recognised automatically.)', tryIt: tryValue('Choose “Historical exchange rates / prices”.', 'label:What does the file contain?', 'rates') },
    { title: 'Long layout', body: `One rate per row:
**Date, Base, Quote, Rate, Source, Type**
e.g. 2025-03-03, AUD, USD, 0.6250, RBA F11, daily_reference

Type can be daily_reference, execution, intraday, manual or price. The sample file “Historical exchange rates” (fictional values) shows the layout.` },
    { title: 'Wide layout (RBA style)', body: `A date column and one column per currency code:
**Date, USD, EUR, GBP, JPY…**

After choosing your file, pick **Wide** under “Rate table layout”, then:
- the **date column**
- whether values are **units of currency per 1 AUD** (RBA style) or **AUD per 1 unit**
- a **source name** (required), e.g. “RBA F11 downloaded 3 July 2025”

Use **Skip leading rows** to step over title rows above the real header.` },
    { title: 'Sample rate file', target: 'button:Historical exchange rates', body: 'Download this fictional sample to see the long layout. Its rates are invented and marked DEMO — never use them for a real return.' },
    { title: 'Choose a file', target: 'button:Choose CSV file', body: 'Select your rate file. You will then check the mapping and preview every row before anything is saved.' },
    { title: 'Preview and duplicates', body: 'Each rate row is validated (positive rate, both codes, date, source). Rows already imported with the same pair, date, source and time are skipped, so re-importing the same table is safe.' },
    { title: 'After the import', body: 'All records are re-checked straight away: those missing rates pick them up, and you get a message such as “12 conversion(s) updated; 0 still missing a rate”. Rate imports can be rolled back from Import history like any other import.' },
    { title: 'Crypto and stablecoin prices', body: `Import prices the same way with the coin as base:
- **BTC, AUD, 98250.10** — 1 BTC = 98,250.10 AUD
- **USDT, USD, 0.9991** — combined with USD/AUD via cross rates

These value swaps, staking rewards and network fees automatically when no AUD value was supplied.` },
    { title: 'Viewing your rates', target: 'nav:Settings & Data', body: 'All rates are listed in **Settings → Currencies & rates**, filterable by pair, with source and type.', tryIt: tryRoute('Open Settings & Data.', '/settings') }
  ]
};

export const ratesManualTour: Tour = {
  id: 'currency-manual',
  section: '/settings',
  title: 'Manual rates, overrides & fixing missing rates',
  summary: 'Finding records without a rate, adding a rate with its source, overriding one record’s rate, removing an override and keeping the audit trail.',
  minutes: 7,
  needsData: true,
  steps: [
    { title: 'Finding records without a rate', route: '/transactions', target: 'text:Missing rate', body: 'Tick **Missing rate** in Transactions to list foreign-currency records that have no historical rate. The Dashboard tile “Missing historical exchange rate” and Reconciliation show the same.' },
    { title: 'Two ways to fix', body: `- **Add a rate for the date** (Settings → Currencies & rates) — fixes every record on that date and currency, and is the normal way
- **Override one record** — when a specific rate applies only to that record (e.g. the rate your card provider actually charged)

Both require a **source**; overrides also need a **reason**.` },
    { title: 'Add a rate manually', route: '/settings?tab=rates', target: 'button:+ Add rate manually', body: 'Opens the rate form.', tryIt: tryOpenDialog('Click “+ Add rate manually”.') },
    { before: [{ ensureDialog: 'button:+ Add rate manually' }], title: 'Base, quote and rate', target: 'label:Base', body: '1 **Base** = **Rate** × **Quote**. For an RBA-style USD rate: Base AUD, Quote USD, Rate 0.6543. For a price: Base USD, Quote AUD, Rate 1.5283.' },
    { title: 'Date and type', target: 'label:Type', body: '**manual** for a rate you looked up, **daily reference** for an official daily rate, **execution** or **intraday** (time-specific), **price** for crypto.' },
    { title: 'Source is required', target: 'label:Source (required)', body: 'Where the rate comes from — e.g. “RBA F11 table”, “CommSec contract note 123456”. It appears on every record that uses the rate and in the full report’s rate-source list.' },
    { title: 'Saving', target: 'button:Save rate', body: 'Saving re-checks all records and tells you how many were updated. Close this form without saving if you are just practising.' },
    { title: 'Override one record’s rate', before: [{ closeDialogs: true }, { route: '/transactions' }, { select: ['[aria-label="Currency filter"]', 'USD'] }], target: 'col:AUD', body: 'Open a USD record to see its conversion panel.', tryIt: tryOpenDialog('Click a USD record.') },
    { before: [{ ensureDialog: 'css:table.dt tbody tr.clickable td:nth-child(3)' }], title: 'Override rate', target: 'button:Override rate', body: 'Opens the override form on this record (or “Enter rate manually” when the rate is missing).', tryIt: tryVisible('Click “Override rate”.', 'label:Reason') },
    { title: 'Rate, direction, source, reason', target: 'label:Reason', body: `- **Rate** and **Direction** (USD per 1 AUD, or AUD per 1 USD)
- **Source** — e.g. “Broker contract note”
- **Reason** — e.g. “Broker applied its own conversion rate”

The override is pinned: later imports or setting changes never replace it. The previous rate moves to the rate history and the change is written to the audit history.` },
    { title: 'Removing an override', body: 'An overridden record shows **Remove override**. The methodology rate is then applied again, and both changes stay in the history.' },
    { title: 'In the reports', body: 'Report B lists every manual override with its reason and source, the full currency conversion ledger, and a summary of every rate source used.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'Tip: prefer importing official daily tables over many single overrides — they are easier for your agent to check.' }
  ]
};

export const marketsTimeTour: Tour = {
  id: 'currency-markets',
  section: '/settings',
  title: 'Markets, time zones & financial-year boundaries',
  summary: 'Your tax time zone, trade-venue time zones, daylight saving, 30 June trades, trade/settlement/tax-event dates, 12-hour display and the currency registry.',
  minutes: 6,
  steps: [
    { title: 'Your time zone', route: '/settings?tab=general', target: 'label:Your time zone', body: 'The financial year of every record is decided by the date in **your** time zone (default Australia/Sydney). Choose your state’s zone — e.g. Australia/Perth or Australia/Brisbane (no daylight saving).' },
    { title: 'Each record keeps its own time zone', body: `When you record or import a trade you also record the zone the time was given in:
- ASX: Australia/Sydney
- NYSE/NASDAQ: America/New_York
- CME futures: America/Chicago
- Many crypto exchanges: UTC

The app stores the exact instant, so daylight-saving changes in either country are handled correctly.` },
    { title: 'The 30 June trap', body: `A US share sold at 3:00 PM New York time on **30 June** happened at about 5:00 AM on **1 July** in Sydney — so it belongs to the **next** Australian financial year.

Records whose date differs between the venue and your zone across 30 June are flagged **Financial-year boundary timing** in Reconciliation, so you and your agent can confirm.` },
    { title: 'Three different dates', body: `- **Transaction date/time** — when the trade happened (contract date) — normally the CGT event date
- **Settlement date** — when cash and shares changed hands (T+1/T+2) — for reconciliation only
- **Tax event date** — optional override, only if your agent says the event date differs` },
    { title: 'Date and time display', target: 'label:Time format', body: 'Times are shown in 12-hour AM/PM format by default; switch to 24-hour if you prefer. Changing the display never changes stored data.' },
    { title: 'Date format', target: 'label:Date format', body: 'Australian day/month/year by default. (Date pickers in forms follow your computer’s regional settings.)' },
    { title: 'Default currency', target: 'label:Default transaction currency', body: 'The currency new records start with. All tax figures are always in AUD.' },
    { title: 'Currency registry', route: '/settings?tab=rates', target: 'panel:Currency registry', body: 'All common ISO 4217 currencies are built in (AUD, USD, EUR, GBP, NZD, CAD, JPY, CHF, SGD, HKD and many more). Add any other 3-letter code here. Crypto assets and stablecoins are **instruments**, not currencies — add them under Trading → Instruments and import their prices.' },
    { title: 'Importing files from overseas brokers', body: 'In the import wizard, set **Time zone of times in file** to the broker’s zone and check the **date format** — US brokers usually use month/day/year. The wizard warns when dates like 01/02/2025 are ambiguous. If the file includes a UTC offset or “Z”, the exact moment is used automatically.' }
  ]
};
