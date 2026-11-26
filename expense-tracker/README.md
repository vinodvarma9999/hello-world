# Spendly — Daily Expense Tracker

A mobile-first expense tracker that installs on your phone like a native app (PWA).
No sign-up, no server: your data stays on your device and it works offline.

<p>
  <img src="screenshots/dashboard.png" width="240" alt="Dashboard">
  <img src="screenshots/transactions.png" width="240" alt="Transactions">
  <img src="screenshots/add-expense.png" width="240" alt="Add expense">
</p>

## Features

- **Dashboard**: total spent this month, a budget progress bar, today's total, daily average, a 7-day bar chart, a category donut chart with breakdown, and recent expenses.
- **Transactions**: grouped by day with daily totals, search, and filter chips by category. Tap any expense to edit or delete it.
- **Categories**: 8 built-in categories (Food, Groceries, Transport, Shopping, Bills, Health, Entertainment, Other). You can add your own with an emoji and colour, or delete them.
- **Subcategories**: every category can have subcategories (e.g. Food › Restaurants, Food delivery, Tea & snacks). Built-in categories start with a few suggestions. Manage them under **Categories** (tap "▸ subcategories" on a category), or create one while adding an expense with **＋ New**. Choosing a subcategory is optional. Tap a category on the dashboard to see its subcategory split; on **Transactions**, pick a category to filter by subcategory. The SMS and statement import lists have a subcategory picker too, and payees remember their subcategory. CSV export includes a Subcategory column.
- **Category budgets**: set a monthly limit for each category. A budget carries forward to the following months until you change it, so you can revise it month by month (use ‹ › to pick the month) without changing past months. The dashboard shows how much is left or over for each category (amber at 80%, red when over), the add-expense sheet shows what's left as you type, and you get a warning when an expense takes a category over its budget.
- **Bank SMS import**: copy a bank or UPI SMS and tap **📋 Paste bank SMS**. Spendly fills in the amount, payee and date, and suggests a category (Swiggy → Food, Uber → Transport, …). It remembers the category you pick for each payee. It warns if the SMS is already recorded, and ignores money-received SMS, OTPs and payment requests. The SMS is read on the phone and never stored or sent anywhere. On iPhone, a Shortcuts automation can copy bank SMS for you automatically; the steps are in the app under Categories → Bank SMS.
- **SMS inbox import (iPhone automation)**: a Shortcuts automation adds every bank SMS to `Spendly inbox.txt` in iCloud Drive, with no taps. Whenever you like, tap **📥 Import SMS inbox** and pick that file. Spendly lists the new expenses with suggested categories; untick or re-categorise any, then tap **Add**. Messages already imported, duplicates, money-received SMS and OTPs are skipped, so the file never needs emptying. Setup steps are in the app under Categories → Bank SMS.
- **Bank statement import**: bring in past expenses (e.g. everything since 1 August) from a bank statement in PDF (including password-protected), Excel or CSV. Tap **Categories → 🏦 Import bank statement**. Spendly finds the transaction table (tested with ICICI's net-banking and e-statement layouts; HDFC-style columns are recognised too), skips money received, suggests categories, and shows payments already in Spendly (same UPI reference, or same amount and date) unticked. Re-importing an overlapping statement only offers new rows. The file is read on the phone; nothing is uploaded.
- **Backup & restore**: **Back up now** saves a `.json` file (on iPhone choose *Save to Files* → iCloud Drive). **Restore from file** brings everything back (expenses, categories, budgets). The dashboard reminds you if you haven't backed up in 30 days.
- **Settings**: overall monthly budget (optional; otherwise the total of your category budgets is used), currency (₹, $, €, £ and more), CSV export, delete all data.
- Browse previous months with the ‹ › arrows in the header.
- Light and dark mode follow your phone's setting.

## Put it on your phone

1. Host it (one-time): on GitHub, open **Settings → Pages**, set **Source** to **GitHub Actions**.
   Once this folder is on `master` (the default branch), the workflow `.github/workflows/deploy-pages.yml` publishes it to
   `https://<your-username>.github.io/<repo-name>/` (you can also run it from the **Actions** tab).
2. Open that link on your phone:
   - **Android (Chrome)**: tap **⋮ → Add to Home screen / Install app**.
   - **iPhone (Safari)**: tap **Share → Add to Home Screen**.
3. The Spendly icon appears on your home screen and opens full-screen like a native app.

## Run locally

```bash
cd expense-tracker
python3 -m http.server 8000
# open http://localhost:8000
```

## Project structure

```
expense-tracker/
├── index.html      # app shell: dashboard, transactions, categories screens
├── styles.css      # mobile-first styling, dark mode
├── app.js          # state, rendering, charts, backup/restore, localStorage persistence
├── statement.js    # reads bank statements (PDF via PDF.js, Excel/CSV via SheetJS) into transactions
├── vendor/         # PDF.js 3.11.174 and SheetJS 0.18.5 (Apache-2.0, licences included), loaded only when importing a statement
├── sms.js          # reads bank/UPI SMS (single or a whole inbox file): amount, payee, date, reference; suggests a category
├── manifest.json   # PWA manifest (name, icons, standalone display)
├── sw.js           # service worker for offline use
└── icons/          # app icon (SVG source + generated PNGs)
```

Data is stored only on the device, in the browser's `localStorage` under the key `spendly.v1`. Nothing is sent to any server. Use **Back up now** to keep a copy.
