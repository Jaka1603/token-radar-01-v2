# token-radar-01-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Jaka1603/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Jaka1603/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Prepared submission title:** LaunchScope 2 — a walk-forward-fitted comps curve over 119 live witnesses ranks all 342 pre-token protocols, with costed farm plans

LaunchScope 2 is a token launch radar. It reads the sealed DefiLlama snapshot of every protocol and ranks the ones that record no token yet by what their launch would be worth, each with a concrete, fully costed farm plan. The board ranks **all 342 pre-token protocols** on this snapshot: the whole 40-protocol watchlist, every earlier find below its $50M floor, and the 144 wrapped products, versioned pools and exchange records that a stricter board would quietly drop — here they are priced by the same model and **flagged**, so nothing is hidden and nothing is mistaken for a launch. The 416 protocols whose token already trades are set aside and shown with the market's own values.

## A model that had to prove itself first

No multiple on this board was picked by hand, and none was merely asserted. The model is **fitted to the snapshot's own 119 live tokens** that report both a market cap and TVL outside the exchange category:

- The response, log(market cap / TVL), is **winsorised to ×0.01–×10** first (15 of the 119 witnesses sit outside that band; uncapped, a handful of memecoins and one near-zero multiple decide any fit).
- Five candidate specifications — a flat market median, a size curve, size + growth + maturity, the same with shrunk per-category offsets, and the same with a chain-breadth term — are raced by **leave-one-out cross-validation**, every candidate refitted exactly for each held-out witness. The winner (full + category offsets + breadth, LOO MAE **1.163** against the flat median's **1.597**, a 27% lower out-of-sample error) also had to beat the flat median in a **walk-forward split** (fit on the 71 oldest listings, test on the 48 newest: MAE 1.573 vs 1.789) and a **blind holdout** (every 5th witness, never fitted: MAE 0.970 vs 1.019, RMSE 1.374 vs 1.709) before it was allowed to price the board.
- What the fit says: size is the story (a protocol ten times larger than the average witness prices at about ×0.36 the multiple, which is why the giant exchange records carry multiples under ×0.02 while mid-size candidates carry ×0.03–×0.10), maturity discounts, growth and breadth barely move the price — and the board prints all of it, coefficients, tournament and validation tables included.

Each row's implied value is its TVL times the fitted multiple, decomposed into six printed terms (base, size, growth, age, category, breadth) that are rounded before they are summed, so the dashboard recomputes every row from the same figures — the page and `board.json` agree to the dollar. Farm plans are derived per protocol from its category, chains, TVL and age: a primary position, a second qualifying action, a weekly cadence, a hold window, an announcement watch and an exit, each with its cost and duration, **closing with the plan's own total cost** (capital plus every gas event). The 40 watchlist rows get deepened plans: a second-chain step where the protocol actually runs, and a step keyed to its own last-seven-days TVL move from the snapshot.

## The dashboard

Open `out/dashboard/index.html` after a run. It shows a KPI strip (342/342 ranked, 40/40 watchlist, total implied value, the blind-holdout and leave-one-out errors), four radar segments (launch candidates, the full board, the watchlist, the flagged rows), search, category and chain filters, sortable columns, a per-protocol detail view with the row's **factor equation and its actual comp set** (the live tokens nearest its size), the full model panel with the tournament and out-of-sample record, an **interactive sandbox** that retunes the shipped fit's constants and reprices the board live, and the already-trading set kept separate. It runs from the generated `data.js` alone; no network.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
# Writes out/board.json, out/data.js, out/dashboard/, out/screenshots/ and out/dossier.json.
# In the grader's container the snapshot is at /input and the output at /output:
#   node main.ts
```

Node 22, standard library only.

## Screenshots

The three screenshots are taken from the generated dashboard at a 1440×1250 viewport, each kept between 300 and 350 KB so the dossier stays within its cap:

1. `screenshots/1-board.png` — open `out/dashboard/index.html` (the launch-candidates board).
2. `screenshots/2-detail.png` — open `out/dashboard/index.html#p=steakhouse-financial` (a watchlist row's detail view; any row's slug works).
3. `screenshots/3-filtered.png` — open `out/dashboard/index.html#segment=all` (the full board, flagged giants included).

After replacing the images in `screenshots/`, run the program once more so `dossier.json` is rebuilt from them.

---

<sub>Entered on [make.fun](https://make.fun/?ref=pse7dwj5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
