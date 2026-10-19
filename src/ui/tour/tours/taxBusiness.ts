import type { Tour } from '../types';
import { tryCreated, tryOpenDialog, tryValue } from './helpers';

export const taxProfileTour: Tour = {
  id: 'tax-profile',
  section: '/tax',
  title: 'Tax profile & taxpayer details',
  summary: 'Residency, Medicare, private cover, HELP, carried-forward losses and other per-year answers that decide which rules apply.',
  minutes: 4,
  steps: [
    { title: 'Why the tax profile matters', route: '/tax?tab=profile', target: 'panel:Tax profile', body: 'These answers are recorded **per financial year** and decide which rates and offsets apply. Without a residency answer the app will not show a tax estimate. Choose **Unknown** rather than guessing — affected amounts are then flagged instead of estimated.' },
    { title: 'Residency', target: 'label:Residency for tax purposes', body: `- **Australian resident (full year)** — resident rates, tax-free threshold, LITO, Medicare levy, 50% CGT discount
- **Foreign resident** — non-resident rates, no Medicare levy, generally no CGT discount (flagged)
- **Part-year resident** and **working holiday maker** — recorded, but estimates are not calculated (special rules)`, tryIt: tryValue('Choose a residency status.', 'label:Residency for tax purposes', (v) => v !== 'unknown') },
    { title: 'Medicare levy', target: 'label:Medicare levy exemption', body: 'Most people pay the full 2% levy (“None”). Half or full exemptions apply only in specific circumstances (e.g. certain visa holders, Defence Force members). Low-income reductions are applied automatically for years where the thresholds are verified.' },
    { title: 'Private hospital cover, spouse, dependants', target: 'label:Private hospital cover (full year)', body: 'Used to flag the **Medicare levy surcharge** and family thresholds. These are **not calculated** by the app — they are listed for your tax agent.' },
    { title: 'HELP / study loans', target: 'label:HELP / study loan debt', body: 'If you have a HELP/VSL/SFSS debt, repayments are **not calculated** here — the report reminds your agent.' },
    { title: 'Carried-forward capital losses', target: 'label:Net capital losses carried into this year (override)', body: `Leave blank and the app works out losses carried forward from the earlier years you have recorded.

If you have losses from years **before** you started using the app, enter the total here for the first year you record — it overrides the calculated figure.` },
    { title: 'Instalments and other offsets', target: 'label:PAYG instalments paid', body: 'PAYG instalments you paid during the year are credited in the estimate. **Other tax offsets** are only for offsets you have verified yourself (describe them) — the app does not work them out.' },
    { title: 'Notes for the tax agent', target: 'label:Notes for the tax agent', body: 'Anything your agent should know about this year. It saves automatically.' },
    { title: 'Taxpayer details', target: 'panel:Taxpayer details', body: 'Name, date of birth, contact details and your tax agent appear on reports. Only the **last three digits** of your TFN can be stored — never the full number.' }
  ]
};

export const incomeTour: Tour = {
  id: 'income',
  section: '/tax',
  title: 'Recording income',
  summary: 'Salary, interest, dividends with franking credits, distributions, foreign income with withholding, government payments and more.',
  minutes: 6,
  steps: [
    { title: 'The income list', route: '/tax?tab=income', target: 'tab:Income', body: 'All income records for the selected year — whether entered here, imported, or recorded in the Trading workspace (e.g. dividends, staking rewards, prop-firm payouts).' },
    { title: 'Add income', target: 'button:+ New record', body: 'New records from this tab start as **Income**.', tryIt: tryOpenDialog('Click “+ New record”.') },
    { before: [{ ensureDialog: 'button:+ New record' }], title: 'Choose the right category', target: 'label:Category', body: `The category sets the default tax classification:
- **Salary and wages**, **Allowances and bonuses**, **Government payments**
- **Interest income**, **Australian dividends**, **Managed-fund / ETF distributions**
- **Foreign dividends / interest / other foreign income**
- **Rental income**, **Business income**
- **Prop-firm payout**, **Crypto staking / mining / airdrop** (review needed where marked)

Use “Other income” when nothing fits.` },
    { title: 'Gross amounts', target: 'label:Amount', body: 'Always enter the **gross** amount — before tax withheld or foreign tax. Withholding is entered separately below so it can be credited.' },
    { title: 'Tax withheld', target: 'label:PAYG / TFN tax withheld (AUD)', body: 'PAYG withheld from wages, or TFN withholding on interest/dividends — in AUD. It reduces the estimated tax payable.' },
    { title: 'Dividends and franking credits', target: 'label:Franking credit (AUD)', body: `From your dividend statement enter the **franked amount**, **unfranked amount** and **franking credit**.

Franking credits are added to assessable income (“grossed up”) and then refunded as an offset. If the franked/unfranked split is missing, the dividend is treated as unfranked and flagged.` },
    { title: 'Foreign income and foreign tax', target: 'label:Foreign tax paid (in transaction currency)', body: 'For foreign dividends or interest, set the currency (e.g. USD), the **gross** amount and the foreign tax withheld. Both are converted at the historical rate for the payment date. Foreign tax up to $1,000 is claimed as an offset; above that a limit calculation is flagged.' },
    { title: 'Distributions', target: 'label:Tax-deferred component', body: 'Managed funds and ETFs: from the annual tax statement, enter the tax-deferred amount (reduces the cost base of your units) and the capital-gain component (goes into CGT).' },
    { title: 'Business income', target: 'label:Business income', body: 'Tick for sole-trader income so it goes into the business profit and loss (and GST fields appear).' },
    { title: 'Your turn', target: 'button:Add record', body: 'Record a practice salary payment: date in the selected year, category **Salary and wages**, amount and tax withheld. Click **Add record**.', tryIt: tryCreated('Add an income record.', (t) => t.kind === 'income') },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'The record now appears in the income list, on the Dashboard, in Tax Calculations (as “Salary and wages”) and in both reports.' }
  ]
};

export const expensesTour: Tour = {
  id: 'expenses',
  section: '/tax',
  title: 'Expenses, deductions, GST and split payments',
  summary: 'Work-related and business expenses, business-use %, GST, splitting one payment, and what is (and isn’t) deductible.',
  minutes: 6,
  steps: [
    { title: 'Expenses & deductions', route: '/tax?tab=expenses', target: 'tab:Expenses & deductions', body: 'Expenses and standalone fees for the selected year. Brokerage on share/crypto trades is **not** listed here — it is part of each trade’s cost base or proceeds.' },
    { title: 'Not everything is deductible', body: `Each category has a default classification:
- **Potentially deductible** — work-related, self-education, memberships, tax-agent fees, donations to DGRs, investment expenses
- **Business expense** — sole-trader running costs
- **Needs review** — equipment over $300 (depreciate it instead), bank fees, trading/data fees, prop-firm fees
- **Not deductible** — private/personal

Deductibility always depends on your circumstances — receipts and a clear work/business connection are needed.` },
    { title: 'New expense', target: 'button:+ New record', body: 'New records from this tab start as **Expense**.', tryIt: tryOpenDialog('Click “+ New record”.') },
    { before: [{ ensureDialog: 'button:+ New record' }], title: 'Business / work-use percentage', target: 'label:Business / work-use %', body: 'Enter the share used for work or business (e.g. 40% of a phone plan). Only that share is counted; the private share is excluded.' },
    { title: 'Business (sole trader) expense', target: 'label:Business (sole trader) expense', body: 'Tick for sole-trader costs. They then appear in the business profit and loss, and GST credits are excluded from the deduction when you are GST-registered.' },
    { title: 'GST', target: 'label:GST treatment', body: `GST is never assumed — set it per record:
- **Taxable (includes GST)** — enter the GST amount (the 1/11 helper fills it)
- **GST-free**, **Input-taxed (financial supply)**, **Imported service**, **Needs review**
These feed the BAS summary on the Business tab.` },
    { title: 'Split one payment', target: 'button:+ Add split', body: 'One receipt covering several things (e.g. part software, part stationery)? Add splits with their own category, amount and business %. The splits must add up to the total.' },
    { title: 'Your turn', target: 'button:Add record', body: 'Record a practice expense: date, description, a category (e.g. “Professional memberships”), amount. Click **Add record**.', tryIt: tryCreated('Add an expense.', (t) => t.kind === 'expense' || t.kind === 'fee') },
    { title: 'Attach the receipt', target: 'text:Supporting documents', body: 'Use **Attach file…** to store the receipt with the record. Records without evidence show up under *Documents → Records needing evidence*.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'Deductions are totalled per category in Tax Calculations and listed line-by-line in the full report.' }
  ]
};

export const businessTour: Tour = {
  id: 'business',
  section: '/tax',
  title: 'Sole trader / business',
  summary: 'Business profile, ABN and GST registration, profit & loss, cash flow, BAS summaries, the business ledger and customers/suppliers.',
  minutes: 5,
  needsData: true,
  steps: [
    { title: 'Business profile', route: '/tax?tab=business', target: 'panel:Business profile', body: 'Name, trading name, ABN, start date and activity description appear on reports. Everything saves automatically.' },
    { title: 'GST registration', target: 'label:Registered for GST', body: 'If you are registered, set the date and whether you account on a **cash** or **accrual** basis, and how often you lodge BAS. Business income and expenses are then shown GST-exclusive.' },
    { title: 'Small business entity', target: 'label:Small business entity?', body: 'Used to flag concessions such as the instant asset write-off. Leave “Unknown” if unsure.' },
    { title: 'Profit and loss', target: 'panel:Profit and loss', body: 'Business income − business expenses − depreciation = net business income (or loss). A loss is flagged because non-commercial loss rules may defer it.' },
    { title: 'Cash-flow summary', target: 'panel:Cash-flow summary', body: 'Money received and paid per month for records marked as business.' },
    { title: 'GST / BAS summary', target: 'panel:GST / BAS summary', body: 'Quarterly G1 (total sales), GST-free sales, 1A (GST on sales), 1B (GST credits, business share only) and net GST. Records needing review or missing a rate are counted. These are summaries — the app does not lodge BAS.' },
    { title: 'Business ledger', target: 'panel:Business ledger', body: 'Every record marked as business — including trading-related ones such as classified prop-firm payouts — in one list.' },
    { title: 'Customers, suppliers and payers', target: 'panel:Customers, suppliers and payers', body: 'Keep a list of the people and businesses you deal with (with ABN and country).' }
  ]
};

export const assetsTour: Tour = {
  id: 'assets',
  section: '/tax',
  title: 'Assets & depreciation',
  summary: 'The asset register and each depreciation method, business-use %, opening values, disposals and schedules.',
  minutes: 5,
  steps: [
    { title: 'Asset register', route: '/tax?tab=assets', target: 'tab:Assets & depreciation', body: 'Record equipment, computers, vehicles and other depreciating assets. The table shows this year’s opening value, decline in value, deductible amount and closing value.' },
    { title: 'Add an asset', target: 'button:+ Add asset', body: 'Opens the asset form.', tryIt: tryOpenDialog('Click “+ Add asset”.') },
    { before: [{ ensureDialog: 'button:+ Add asset' }], title: 'Cost and dates', target: 'label:Cost (AUD, excl. claimable GST)', body: 'Enter the cost (excluding GST you can claim back), the date acquired and — if later — the date first used or installed ready for use (depreciation starts then).' },
    { title: 'Depreciation method', target: 'label:Method', body: `- **Prime cost** — same amount each year: cost × days/365 × 100% ÷ effective life
- **Diminishing value** — larger early: value × days/365 × 200% ÷ effective life
- **Instant asset write-off** — whole cost in the first year if eligible (threshold and eligibility flagged)
- **Low-value pool** — 18.75% then 37.5% (simplified, flagged)` },
    { title: 'Effective life and business use', target: 'label:Business / work use %', body: 'Effective life comes from the ATO’s effective-life tables. Business use % reduces the deduction for private use.' },
    { title: 'Bringing in older assets', target: 'label:Opening adjustable value (optional)', body: 'For assets bought before your records in this app start, enter the adjustable value at the start of a year and which year it applies to.' },
    { title: 'Disposal', target: 'label:Disposal date', body: 'When you sell or scrap the asset, enter the date and proceeds. A balancing adjustment is calculated and flagged for review.' },
    { title: 'Schedule preview', body: 'Once cost, date and method are filled, a year-by-year schedule appears at the bottom of the form.' },
    { title: 'Done', before: [{ closeDialogs: true }], body: 'Depreciation flows into the business profit and loss and the full report’s asset schedule. Close without adding if this was just practice — nothing is saved until you click **Add**.' }
  ]
};

export const logsTour: Tour = {
  id: 'logs',
  section: '/tax',
  title: 'Vehicle, travel, home office, stock & recurring entries',
  summary: 'Logbooks and hours records, trading-stock values and automatically generated recurring records.',
  minutes: 4,
  steps: [
    { title: 'Logbooks', route: '/tax?tab=logbook', target: 'tab:Vehicle, travel & home office', body: 'Record vehicle trips (odometer, km, purpose), travel and home-office hours. The totals at the top show business km as a % of all km and total home-office hours — evidence your agent may ask for.' },
    { title: 'Add a log entry', target: 'button:+ Add entry', body: 'Choose the type (vehicle trip, travel, home office hours), date, purpose and the km or hours. Mark whether it was work/business related.' },
    { title: 'Trading stock', route: '/tax?tab=inventory', target: 'tab:Stock / inventory', body: 'Only for businesses that hold trading stock: record opening and closing values and the valuation method for each year. The change in value is shown.' },
    { title: 'Recurring entries', route: '/tax?tab=recurring', target: 'tab:Recurring entries', body: 'For regular amounts (rent, subscriptions, salary): set the amount, category and frequency once.' },
    { title: 'Generate due records', target: 'button:Generate due records', body: 'Creates the records that are due up to today. It is safe to click repeatedly — each date is generated only once.' }
  ]
};
