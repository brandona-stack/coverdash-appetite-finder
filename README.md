# Coverdash Appetite Finder

Enter a policy type, state, class (NAICS), revenue, payroll and subcontracted %. The tool shows which carriers have quoted and bound that kind of business, and an estimated premium from each one, based on our own quote and bound-policy data.

## Refreshing the data
1. Export the quotes report and the bound policies report (with NAICS Code).
2. Save them as `data/quotes.xlsx` and `data/policies.xlsx`. The `data/` folder is gitignored, so raw data never gets committed.
3. Run `pip install pandas openpyxl numpy`, then `python scripts/build_data.py`.
4. Optional: run `node scripts/backtest.js 600` to check estimate accuracy.
5. Commit `public/appetite-data.json` and push. Vercel redeploys automatically.

## How estimates work (`public/engine.js`)
- Uses priced quotes (READY, SELECTED, BOUND, MANUAL), keeping one per business, carrier, policy type and state.
- The exposure is revenue, except Workers' Comp, which uses payroll.
- Comparable quotes are those with exposure between 0.5× and 2× the entered amount. Each is adjusted by (entered ÷ theirs)^0.4, and the tool shows the median of the 25 nearest, with the middle 50% as the range.
- If a carrier has fewer than 5 comparables, the search broadens in this order: this class in this state, then all states, then NAICS 4-digit, then 3-digit, then 2-digit. Workers' Comp stays in-state and broadens the class first, and uses an exponent of 0.6.
- Backtest on held-out quotes: the median error is about 25%, and about two thirds of estimates land within ±50%.

## Sub % rules (`RULES` at the top of `public/engine.js`)
- Above 25% sub, these standard carriers are removed: The Hartford, Chubb, Acuity, Travelers, Hiscox, CNA, biBerk, Nationwide, Employers, Guard, Hanover, Amtrust, Three by Berkshire, Markel and Great American.
- Coterie is allowed up to 50%.
- To change either rule, edit `RULES`.

## Class search (`public/naics-search.js`)
AEs describe the business in plain English, for example "fixes leaky pipes" or "sells candles on Etsy." Results are ranked by blending three signals:
1. The US Census Bureau's BEACON description-to-NAICS model. It comes from the MIT-licensed JS port in `@cajuncodemonkey/naics-search`, trimmed to single words (`public/naics-model.json`, about 300 KB gzipped). It's loaded only when someone clicks into the box.
2. Word matches against NAICS titles and Coverdash's own everyday terms (`SYNONYMS` in the same file). Add phrases there when AEs search for something and the right class doesn't come up.
3. A small boost for classes we quote often.
