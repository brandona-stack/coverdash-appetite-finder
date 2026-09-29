# Coverdash Appetite Finder

Look up which carriers have quoted and bound a given **policy type + state + industry**, built from the last 6 months of Coverdash quote and policy data.

## Deploy on Vercel
1. Import this repo in Vercel (Add New → Project). There's no build step and no framework to pick.
2. Share the URL. The site is public (no password) but is marked noindex so search engines skip it.

## Refreshing the data
1. Export fresh `quotes_in_last_180_days.csv` and `policies_bound_in_last_180_days.xlsx`.
2. Save them as `data/quotes.csv` and `data/policies.xlsx`. The `data/` folder is gitignored, so raw data never gets committed.
3. Run `pip install pandas openpyxl numpy`, then `python scripts/build_data.py`.
4. Commit the updated `public/appetite-data.json` and push. Vercel redeploys automatically.

## How it works
- A business counts once per carrier and policy type. Its best outcome across requotes is used: bound > selected > priced > referred > declined.
- **Bound** comes from the policies file. Cancelled policies still count as bound, and the cancellations are shown separately.
- **Bind rate** is businesses bound ÷ businesses that carrier priced.
- **Premium** is the median and middle 50% of bound premium. When nothing is bound, it falls back to quoted premium.
- Rollups for "All states" and "All industries" are precomputed.
