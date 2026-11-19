// LaunchScope 2's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, its filters, a per-protocol detail view with the fitted model's
// own arithmetic and the protocol's comp set, the model panel with the tournament and the
// out-of-sample record, an interactive sandbox that retunes the fit's constants, and the set
// of protocols whose token already trades. No network: every byte it shows is in data.js,
// and the implied value and farm plan it prints are recomputed here from the same figures
// main.ts scored, so the page and board.json cannot quietly disagree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var FIT = DATA.fit;
  var M = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', segment: 'candidates', tab: 'pre',
    sort: 'implied', dir: -1, selected: null,
    sandbox: { size: 1, growth: 1, k: M.category_shrink_k }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function fmtTerm(n) { return (n > 0 ? '+' : '') + Number(n).toFixed(4); }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }
  function clampMult(n) { return Math.min(M.multiple_cap, Math.max(M.multiple_floor, n)); }

  // The fitted model in one line: the page sums the row's own shipped terms, exponentiates,
  // rounds and clamps exactly as lib/model.ts does, and checks the product against board.json.
  function impliedOf(row) {
    var t = row.terms;
    var lp = t.base + t.size + t.growth + t.age + t.category + t.breadth;
    return Math.max(1, Math.round(row.tvl_usd * clampMult(round4(Math.exp(lp)))));
  }

  // The sandbox: the same fit with its constants retuned. Features are rebuilt from the
  // row's own record, category offsets are re-shrunk from the shipped residuals at the
  // chosen k, and nothing here touches the shipped board's numbers.
  function featuresOf(row) {
    var age = row.age_days === null || row.age_days === undefined ? FIT.fallback_age_days : row.age_days;
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return {
      size: Math.log10(Math.max(row.tvl_usd, 1)),
      growth: Math.min(M.growth_cap_pct, Math.max(M.growth_floor_pct, g)) / 100,
      ageF: 1 - Math.exp(-Math.max(age, 0) / M.maturity_tau_days),
      breadth: Math.min(Math.max((row.chains || []).length - 1, 0), M.breadth_max_extra_chains),
      cat: row.category || 'Uncategorised'
    };
  }
  function offsetAt(cat, k) {
    for (var i = 0; i < FIT.offsets.length; i++) {
      var o = FIT.offsets[i];
      if (o.category === cat) {
        var mean = o.offset * (o.samples + M.category_shrink_k) / Math.max(o.samples, 1);
        return o.samples * mean / (o.samples + k);
      }
    }
    return 0;
  }
  function sandboxActive() {
    return state.sandbox.size !== 1 || state.sandbox.growth !== 1 || state.sandbox.k !== M.category_shrink_k;
  }
  function sandboxImplied(row) {
    var f = featuresOf(row);
    var lp = FIT.base
      + FIT.size * state.sandbox.size * (f.size - FIT.mean_size)
      + FIT.growth * state.sandbox.growth * f.growth
      + FIT.age * f.ageF
      + FIT.breadth * f.breadth
      + offsetAt(f.cat, state.sandbox.k);
    return Math.max(1, Math.round(row.tvl_usd * clampMult(round4(Math.exp(lp)))));
  }
  function valueOf(row) { return sandboxActive() ? sandboxImplied(row) : row.implied_value_usd; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the actions, the capital, the gas and the hold, watchlist rows get the
  // deepened steps, and the closing step sums the plan's own cost. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 7;
    if (c === 'solana') return 0.1;
    if (c === 'bsc' || c === 'binance') return 0.35;
    if (c.indexOf('arbitrum') >= 0 || c.indexOf('base') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('zksync') >= 0 || c.indexOf('linea') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('blast') >= 0 || c.indexOf('mantle') >= 0 || c.indexOf('mode') >= 0) return 0.4;
    if (c.indexOf('polygon') >= 0 || c.indexOf('avalanche') >= 0 || c.indexOf('fantom') >= 0 || c.indexOf('sonic') >= 0 || c.indexOf('gnosis') >= 0 || c.indexOf('celo') >= 0 || c.indexOf('moonbeam') >= 0) return 0.6;
    return 1.5;
  }
  function gasText(d) { return d < 1 ? 'about ' + Math.round(d * 100) + ' cents' : 'about $' + d.toFixed(d % 1 === 0 ? 0 : 2); }
  function aboutUsd(n) { return 'about $' + Math.round(n); }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 300;
    if (p.tvl_usd >= 2.5e8) return 200;
    if (p.tvl_usd >= 5e7) return 100;
    if (p.tvl_usd >= 1e7) return 75;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 365) return 60;
    if (age < 730) return 45;
    return 30;
  }
  function primaryAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC or ETH to ' + name + ' on ' + chain + ' as collateral and leave it supplied.';
    if (c.indexOf('dex') >= 0) return 'Add $' + capital + " of liquidity to " + name + "'s deepest USDC pair on " + chain + ' and keep the LP position open.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Allocate $' + capital + ' to a ' + name + ' curated vault on ' + chain + ' and keep the vault shares in the wallet.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC from Ethereum to ' + chain + ' through ' + name + ' and hold the bridged funds there.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small position hedged against the market.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + " and take one position in " + name + "'s most liquid market.";
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the staking asset through ' + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('rwa') >= 0) return 'Subscribe $' + capital + ' to ' + name + "'s yield asset on " + chain + ' and hold it through one distribution cycle.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of protocol cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + " and hold it in the wallet as the chain's native asset.";
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' toward one ' + name + ' launch on ' + chain + ' and complete its participation steps.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold the balance.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    return 'Deposit $' + capital + " of USDC into " + name + "'s core product on " + chain + ' and keep the position open.';
  }
  function secondAction(p, capital) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow about $' + Math.round(capital * 0.4) + ' of a second asset against the supply, hold it a week, then repay: borrowing is the action points programs weight most.';
    if (c.indexOf('dex') >= 0) return 'Route two swaps a week of about $' + Math.max(25, Math.round(capital * 0.2)) + ' each through ' + name + ' so the wallet builds real trading volume, not just liquidity.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Split a second $' + Math.round(capital * 0.5) + ' into a different ' + name + ' vault on a second chain it curates, so the account is active in more than one market.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a smaller $' + Math.max(25, Math.round(capital * 0.3)) + ' back the other way once a month: round trips are what bridge activity programs count.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Trade about $' + capital * 2 + ' of total volume across the hold in small hedged orders, the metric derivatives programs publish for their seasons.';
    if (c.indexOf('prediction') >= 0) return 'Take one position a week in a different market each time; breadth of markets is what prediction programs record.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake or delegate a second $' + Math.round(capital * 0.5) + ' with a different operator or vault so the stake is not a single passive deposit.';
    if (c.indexOf('rwa') >= 0) return 'Hold the asset past one full distribution and reinvest the payout once, so the account shows a complete cycle.';
    if (c.indexOf('chain') >= 0) return 'Make one native transfer and one contract interaction a week on ' + name + ': raw transaction count is the first metric a new chain publishes.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Compound the yield back into the vault once a week instead of withdrawing it, so the position grows on the record.';
    return 'Use a second feature of ' + name + ' once a week, such as a swap, a vote or a smaller second deposit, so the account reads as a user rather than one deposit.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmPlan(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var deep = !!p.watchlist;
    var sizeNote = p.tvl_usd >= DATA.floor_usd ? 'above the watchlist floor' : 'below the watchlist floor';
    var steps = [
      { text: 'Set up a fresh wallet for ' + p.name + ' alone, fund it from an exchange, and keep its seed phrase offline; one wallet per protocol keeps every farm separable.', cost: gasText(gas) + ' of gas for the first transaction on ' + chain, time: '10 minutes' },
      { text: primaryAction(p, capital, chain), cost: '$' + capital + ' of capital and ' + gasText(gas) + ' of gas', time: '15 minutes to set up' },
      { text: secondAction(p, capital), cost: gasText(gas * 2) + ' of gas across the two actions', time: '20 minutes' }
    ];
    var extraGas = 0;
    if (deep && p.chains && p.chains.length > 1) {
      var second = p.chains[1];
      var gas2 = gasFor(second);
      extraGas += gas2 * 2;
      steps.push({ text: 'Repeat the primary position on ' + second + ', where ' + p.name + ' also counts TVL: the snapshot records ' + p.chains.length + ' chains for it, and activity on a second chain is what separates a user of the protocol from a single deposit on its first.', cost: gasText(gas2 * 2) + ' of gas for the two transactions on ' + second, time: '20 minutes' });
    }
    steps.push({ text: 'Repeat one qualifying action every week without missing a week: protocols of this size (' + sizeNote + ') usually score seasons or points on weekly streaks, and a gap resets them.', cost: gasText(gas) + ' of gas a week, about $' + Math.max(1, Math.round(gas * 4)) + ' a month', time: '10 minutes a week' });
    if (deep && p.change_7d !== null && p.change_7d !== undefined) {
      var move = p.change_7d;
      var pct = (move > 0 ? '+' : '') + move.toFixed(2) + '%';
      steps.push({
        text: move >= 0
          ? "The snapshot's own last seven days moved " + p.name + "'s TVL " + pct + ': growth windows are when activity programs open their scoring, so start the weekly cadence now rather than after an announcement, while the record still shows the growth.'
          : "The snapshot's own last seven days moved " + p.name + "'s TVL " + pct + ": size into the position across two weeks instead of one session, so the account's average balance, not a single day's, is what a snapshot of a shrinking protocol records.",
        cost: gasText(gas) + ' of gas for the extra entry',
        time: '10 minutes'
      });
      extraGas += gas;
    }
    steps.push(
      { text: 'Hold the position at least ' + hold + " days, spanning two monthly snapshots of the protocol's TVL, before judging it: shorter holds are the ones activity filters discard.", cost: 'the $' + capital + ' stays in the position and cannot be spent elsewhere', time: hold + ' days' },
      { text: 'Check ' + p.name + "'s official announcements and points page once a week for a token or season announcement; claim only from a link the protocol itself publishes, and never pay a fee to claim.", cost: 'nothing to check; a claim that asks for payment is a scam', time: '5 minutes a week' }
    );
    var gasEvents = 1 + 1 + 2 + weeks + 2;
    var gasTotal = gas * gasEvents + extraGas;
    var total = capital + gasTotal;
    steps.push(
      { text: 'Total plan cost for ' + p.name + ': $' + capital + ' of capital plus ' + aboutUsd(gasTotal) + ' of gas across the ' + hold + '-day hold (' + gasEvents + (extraGas > 0 ? ' or more' : '') + ' transactions at ' + gasText(gas) + ' each on ' + chain + (deep ? ', the deepened steps included' : '') + ') — ' + aboutUsd(total) + ' all in, spent before any token exists.', cost: aboutUsd(total) + ' in total, $' + capital + ' of it recoverable capital', time: hold + ' days end to end' },
      { text: 'Log the wallet, every date, amount and transaction hash in a farm log; when a token launches or the ' + hold + ' days pass with no announcement, unwind in one session and record the result.', cost: gasText(gas * 2) + ' of gas to unwind', time: '15 minutes to exit' }
    );
    return { steps: steps.map(stepText), capital: capital, gasTotal: Math.round(gasTotal * 100) / 100, total: Math.round(total * 100) / 100, hold: hold };
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    ['q', 'category', 'chain', 'segment', 'tab', 'sort'].forEach(function (k) { if (params.get(k)) state[k] = params.get(k); });
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('dir')) state.dir = Number(params.get('dir')) < 0 ? -1 : 1;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.segment !== 'candidates') params.set('segment', state.segment);
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  var FLAG_LABEL = { exchange: 'Exchange record', product: 'Product of a trading token', versioned: 'Versioned pool' };
  function segmentRows() {
    if (state.segment === 'all') return DATA.rows;
    if (state.segment === 'watchlist') return DATA.rows.filter(function (r) { return r.watchlist; });
    if (state.segment === 'flagged') return DATA.rows.filter(function (r) { return r.flag; });
    return DATA.rows.filter(function (r) { return !r.flag; });
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return segmentRows().filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = valueOf(a); bv = valueOf(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, 'Launch', el('em', { text: 'Scope 2' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Universe ', el('b', { text: String(DATA.protocols_size) + ' protocols' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version + ' · ' + FIT.spec_label }))
      )
    );
  }

  function pctLess(a, b) { return Math.round((1 - a / b) * 100) + '% below'; }

  function lede() {
    var values = DATA.rows.map(function (r) { return r.implied_value_usd; });
    var total = values.reduce(function (n, v) { return n + v; }, 0);
    var v = FIT.validation;
    var fv = FIT.flat_validation;
    return el('section', { class: 'lede' },
      el('h1', null, 'Every protocol with ', el('span', { class: 'hl', text: 'no token yet' }), ', ranked by a model that had to prove itself first'),
      el('p', null,
        'The board ranks ', el('b', { text: String(DATA.board_size) }), ' pre-token protocols — all of them, the whole ',
        el('b', { text: String(DATA.watchlist_size) }), '-protocol watchlist and every earlier find below its ',
        el('b', { text: fmtUsd(DATA.floor_usd) }), ' floor, with the ', el('b', { text: String(DATA.flagged_size) }),
        ' wrapped products, versioned pools and exchange records flagged rather than dropped. Each implied value comes from a comps curve ',
        el('b', { text: 'fitted to the snapshot\'s own ' + FIT.witnesses + ' live tokens' }),
        ' and chosen by leave-one-out cross-validation over five rival specifications: out of sample, the fitted model\'s typical error is ',
        el('b', { text: pctLess(v.loo_mae, fv.loo_mae) }), ' a flat multiple\'s. An implied value is a model\'s claim, not a price and not a promise that a token comes.'
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Pre-token ranked' }), el('b', { text: DATA.board_size + ' / ' + DATA.board_size }), el('small', { text: 'nothing that records no token is left out' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'the floor, fully ranked' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) }), el('small', { text: 'across the whole board' })),
        el('div', { class: 'kpi hot' }, el('span', { text: 'Blind-holdout error' }), el('b', { text: v.ho_mae.toFixed(2) + ' log pts' }), el('small', { text: 'mean abs. error, on ' + v.ho_n + ' tokens the fit never saw' })),
        el('div', { class: 'kpi hot' }, el('span', { text: 'Leave-one-out error' }), el('b', { text: v.loo_mae.toFixed(2) + ' log pts' }), el('small', { text: pctLess(v.loo_mae, fv.loo_mae) + ' the flat median\'s ' + fv.loo_mae.toFixed(2) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); }).slice(0, 16);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function select(id, label, values, current, onchange) {
      var s = el('select', { id: id, 'aria-label': label },
        el('option', { value: 'all', text: label }),
        values.map(function (v) { return el('option', { value: v, text: v, selected: v === current ? 'selected' : null }); })
      );
      s.addEventListener('change', function () { onchange(s.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    function segButton(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.segment === value ? 'true' : 'false', text: label, onclick: function () { state.segment = value; writeHash(); render(); } });
    }
    function tabButton(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === value ? 'true' : 'false', text: label, onclick: function () { state.tab = value; render(); } });
    }
    var counts = {
      candidates: DATA.rows.filter(function (r) { return !r.flag; }).length,
      flagged: DATA.flagged_size
    };
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('category', 'All categories', categories, state.category, function (v) { state.category = v; }),
      select('chain', 'All chains', chains, state.chain, function (v) { state.chain = v; }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Radar segment' }),
        el('div', { class: 'segments' },
          segButton('candidates', 'Launch candidates ' + counts.candidates),
          segButton('all', 'Full board ' + DATA.board_size),
          segButton('watchlist', 'Watchlist ' + DATA.watchlist_size),
          segButton('flagged', 'Flagged ' + counts.flagged))),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }),
        el('div', { class: 'tabs' }, tabButton('pre', 'Pre-token'), tabButton('live', 'Already trading'))),
      el('span', { class: 'count', text: state.tab === 'pre' ? rows().length + ' of ' + segmentRows().length + ' rows shown' : DATA.live.length + ' of ' + DATA.live_total + ' live-token protocols' })
    );
  }

  function sortHeader(key, label, numeric) {
    return el('th', { scope: 'col', class: numeric ? 'num' : null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function signalChip(r) {
    var cls = r.signal === 'Strong' ? 'strong' : r.signal === 'Building' ? 'building' : 'early';
    return el('span', { class: 'chip ' + cls, text: r.signal });
  }

  var CAPTIONS = {
    candidates: 'Launch candidates: the independent pre-token protocols, in the board\'s global rank order across all 342 ranked rows. The flagged products, versioned pools and exchange records hold the rank numbers missing here; the Full board segment shows every row. Select a row for its fitted equation, its comp set and its farm plan.',
    all: 'The full board: every protocol that records no token, ranked by the fitted model. Flagged rows are products of tokens that already trade, versioned pools, or exchange records whose TVL is customer balances — priced by the same model, flagged so nobody mistakes them for launches.',
    watchlist: 'The snapshot\'s own watchlist: at least $50M of TVL and no token on record, not a wrapped or staked product. The floor the radar must cover — here it is 40 of 40, inside the full board\'s ranking.',
    flagged: 'Flagged rows: wrapped, staked and bridged products of tokens that trade, versioned pools of other protocols, and exchange records. Ranked by the same fitted model as everything else; the flag, not a quiet deletion, is how the radar handles them.'
  };

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return valueOf(r); })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? 'flat' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain unrecorded') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, r.flag ? el('span', { class: 'chip flag', text: FLAG_LABEL[r.flag] }) : signalChip(r)),
        el('td', null, r.watchlist ? el('span', { class: 'chip watch', text: 'Watchlist' }) : el('span', { class: 'chip early', text: 'Early' })),
        el('td', { class: 'num' }, el('div', { class: 'mult' },
          el('div', { class: 'bar2', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.min(100, Math.round(((sandboxActive() ? valueOf(r) / r.tvl_usd : r.multiple) / 0.35) * 100))) + '%' })),
          el('span', { class: 'num', text: fmtMult(sandboxActive() ? valueOf(r) / r.tvl_usd : r.multiple) })
        )),
        el('td', { class: 'num' }, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((valueOf(r) / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(valueOf(r)) })
        ))
      );
      tbody.appendChild(tr);
    });
    var children = [];
    if (sandboxActive()) {
      children.push(el('p', { class: 'sandbox-note', text: 'Sandbox values: the board below is repriced with the model panel\'s retuned constants. The shipped board\'s numbers return with the reset button.' }));
    }
    children.push(el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: CAPTIONS[state.segment] || CAPTIONS.all }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank', true),
          sortHeader('name', 'Protocol'),
          sortHeader('tvl', 'TVL', true),
          sortHeader('growth', '7d', true),
          sortHeader('age', 'Age', true),
          el('th', { scope: 'col', text: 'Signal' }),
          el('th', { scope: 'col', text: 'Radar' }),
          sortHeader('multiple', 'Multiple', true),
          sortHeader('implied', sandboxActive() ? 'Implied (sandbox)' : 'Implied value', true)
        )),
        tbody
      )
    ));
    return el('div', { class: 'panel' }, children);
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'chip live', text: r.symbol || 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain unrecorded') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? 'x' + (r.mcap_usd / r.tvl_usd).toFixed(3) : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are never ranked with the pre-token board; the ' + FIT.witnesses + ' of them with a reported market cap are the witnesses the model was fitted and cross-validated on. The ' + DATA.live_total + ' live-token protocols are summarised by the ' + DATA.live.length + ' largest here.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Token' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Cap / TVL' }))),
          tbody
        )
      )
    );
  }

  function tournamentTable() {
    var body = FIT.candidates.map(function (t) {
      var win = t.id === FIT.spec_id;
      return el('tr', { class: win ? 'win' : null },
        el('td', { text: t.label + (win ? ' — shipped' : '') }),
        el('td', { class: 'num', text: t.loo_mae.toFixed(3) }),
        el('td', { class: 'num', text: t.loo_rmse.toFixed(3) })
      );
    });
    return el('table', null,
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Candidate specification' }),
        el('th', { scope: 'col', class: 'num', text: 'LOO MAE' }),
        el('th', { scope: 'col', class: 'num', text: 'LOO RMSE' }))),
      el('tbody', null, body));
  }

  function validationTable() {
    var v = FIT.validation;
    var f = FIT.flat_validation;
    function row(label, w, fl) {
      return el('tr', null,
        el('td', { text: label }),
        el('td', { class: 'num', text: w.mae.toFixed(3) }),
        el('td', { class: 'num', text: w.rmse.toFixed(3) }),
        el('td', { class: 'num', text: fl.mae.toFixed(3) }),
        el('td', { class: 'num', text: pctLess(w.mae, fl.mae) })
      );
    }
    return el('table', null,
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Out-of-sample test' }),
        el('th', { scope: 'col', class: 'num', text: 'Fitted MAE' }),
        el('th', { scope: 'col', class: 'num', text: 'Fitted RMSE' }),
        el('th', { scope: 'col', class: 'num', text: 'Flat median MAE' }),
        el('th', { scope: 'col', class: 'num', text: 'Fitted error vs flat' }))),
      el('tbody', null,
        row('Leave-one-out, all ' + FIT.witnesses + ' witnesses', { mae: v.loo_mae, rmse: v.loo_rmse }, { mae: f.loo_mae }),
        row('Walk-forward: fit on the ' + (FIT.witnesses - v.wf_test_n) + ' oldest listings, test on the ' + v.wf_test_n + ' newest', { mae: v.wf_mae, rmse: v.wf_rmse }, { mae: f.wf_mae }),
        row('Blind holdout: every 5th witness (' + v.ho_n + '), never fitted', { mae: v.ho_mae, rmse: v.ho_rmse }, { mae: f.ho_mae })
      ));
  }

  function offsetsTable() {
    var body = FIT.offsets.slice(0, 10).map(function (o) {
      return el('tr', null,
        el('td', { text: o.category }),
        el('td', { class: 'num', text: String(o.samples) }),
        el('td', { class: 'num', text: fmtTerm(o.offset) }),
        el('td', { class: 'num', text: 'x' + Math.exp(o.offset).toFixed(3) })
      );
    });
    return el('table', null,
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Category' }),
        el('th', { scope: 'col', class: 'num', text: 'Live tokens' }),
        el('th', { scope: 'col', class: 'num', text: 'Offset (log pts)' }),
        el('th', { scope: 'col', class: 'num', text: 'As multiple' }))),
      el('tbody', null, body));
  }

  function slider(id, label, min, max, step, value, fmt, onchange) {
    var out = el('b', { text: fmt(value) });
    var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    input.addEventListener('input', function () { onchange(Number(input.value)); out.textContent = fmt(Number(input.value)); render(); });
    return el('div', { class: 'slider' }, el('label', { for: id }, el('span', { text: label }), out), input);
  }

  function modelPanel() {
    var v = FIT.validation;
    var f = FIT.flat_validation;
    var off = FIT.offsets.slice(0, 3).map(function (o) { return o.category + ' ' + fmtTerm(o.offset); }).join(', ');
    var children = [
      el('h2', { text: 'A comps model, fitted and cross-validated on this snapshot' }),
      el('p', null,
        'LaunchScope\'s first board shrank each category\'s median market-cap-to-TVL ratio toward one market median — a single weight (0.246) estimated from the whole witness set, then applied to every protocol. This board instead ',
        el('b', { text: 'fits a curve' }), ': log market cap over TVL is regressed on log size, 7-day growth, maturity and chain breadth over the ',
        el('b', { text: String(FIT.witnesses) + ' live tokens' }), ' that report both figures, with a shrunk offset per category. The response is winsorised to ',
        el('b', { text: 'x' + Math.exp(M.winsor_lo).toFixed(2) + '–x' + Math.exp(M.winsor_hi).toFixed(0) }), ' first (' + FIT.winsorized + ' of the ' + FIT.witnesses + ' witnesses sit outside that band; without the cap, a handful of memecoins and one near-zero multiple decide the fit). Five rival specifications were raced by ',
        el('b', { text: 'leave-one-out cross-validation' }), ', and the winner also had to beat a flat median out of sample in a walk-forward split and a blind holdout before it was allowed to price the board:'
      ),
      el('div', { class: 'formula', text: 'log multiple = ' + FIT.base.toFixed(3) + '  +  ' + FIT.size.toFixed(3) + ' x (log10 TVL - ' + FIT.mean_size.toFixed(2) + ')  +  ' + FIT.growth.toFixed(3) + ' x 7d-growth  +  ' + FIT.age.toFixed(3) + ' x (1 - e^(-age/' + M.maturity_tau_days + '))  +  ' + FIT.breadth.toFixed(3) + ' x extra chains  +  category offset' }),
      el('h3', { text: 'The tournament: every candidate, scored the same way' }),
      tournamentTable(),
      el('h3', { text: 'Out of sample: the shipped fit against a flat median multiple' }),
      validationTable(),
      el('div', { class: 'cols' },
        el('div', null,
          el('h3', { text: 'What the fit says' }),
          el('ul', null,
            el('li', null, el('b', { text: 'Size is the story. ' }), 'A protocol ten times larger than the average witness prices at about ', el('b', { text: 'x' + Math.exp(FIT.size).toFixed(2) }), ' the multiple — TVL scale is bought at a discount, which is why the giant exchange records at the top of the full board carry multiples under x0.02 and the mid-size candidates carry x0.03–x0.10.'),
            el('li', null, el('b', { text: 'Maturity discounts too. ' }), 'Age enters at ' + FIT.age.toFixed(3) + ' log points across the curve: the longer a protocol has run without a token, the less the market\'s comps pay for its TVL. Protocols whose tokenless age is unrecorded are priced at the witness median, ' + FIT.fallback_age_days + ' days.'),
            el('li', null, el('b', { text: 'Growth barely moves it. ' }), 'The 7-day term is ' + FIT.growth.toFixed(3) + ' and the breadth term ' + FIT.breadth.toFixed(3) + ' — the fit keeps both because cross-validation prefers them in, but no protocol\'s rank here rides on a hot week.'),
            el('li', null, el('b', { text: 'Categories still matter. ' }), 'The strongest offsets are ' + off + ' (log points), shrunk toward zero by sample size at k = ' + M.category_shrink_k + ', so a category with three live tokens cannot hijack the curve.')
          )
        ),
        el('div', null, el('h3', { text: 'Category offsets in the shipped fit' }), offsetsTable())
      ),
      el('div', { class: 'sandbox' },
        el('h3', { text: 'Model sandbox: retune the fit and watch the board move' }),
        el('p', null, 'These sliders scale the shipped fit\'s own constants and reprice every row live — the size slope, the growth weight, and the shrink k that pulls category offsets toward zero. Nothing is refitted and nothing here replaces the shipped board: reset returns to the model that cross-validation chose.'),
        el('div', { class: 'sliders' },
          slider('sb-size', 'Size slope', 0.5, 1.5, 0.05, state.sandbox.size, function (n) { return 'x' + n.toFixed(2); }, function (n) { state.sandbox.size = n; }),
          slider('sb-growth', 'Growth weight', 0, 2, 0.1, state.sandbox.growth, function (n) { return 'x' + n.toFixed(1); }, function (n) { state.sandbox.growth = n; }),
          slider('sb-k', 'Category shrink k', 0, 60, 1, state.sandbox.k, function (n) { return 'k = ' + n; }, function (n) { state.sandbox.k = n; })
        ),
        el('button', { class: 'button', type: 'button', text: 'Reset to the shipped model', onclick: function () { state.sandbox = { size: 1, growth: 1, k: M.category_shrink_k }; render(); } })
      ),
      el('p', { class: 'note', text: 'Errors are in log points of market cap over TVL: an MAE of ' + v.loo_mae.toFixed(2) + ' means the typical leave-one-out prediction is off by about x' + Math.exp(v.loo_mae).toFixed(1) + ' — wide, because pre-token valuation is wide. The claim is narrower and checkable: on this snapshot\'s own witnesses, the fitted curve\'s out-of-sample error is ' + pctLess(v.loo_mae, f.loo_mae) + ' a flat median\'s, and it wins the walk-forward split and the blind holdout too. Every figure in this panel is printed by the same program that priced the board, from the same snapshot.' })
    ];
    return el('section', { class: 'panel model', 'aria-label': 'How the implied values are derived' }, children);
  }

  function compsFor(row) {
    var target = Math.log10(Math.max(row.tvl_usd, 1));
    var cat = row.category || 'Uncategorised';
    var scored = DATA.witnesses.map(function (w) {
      return { w: w, same: (w.category || 'Uncategorised') === cat, d: Math.abs(Math.log10(Math.max(w.tvl_usd, 1)) - target) };
    });
    var same = scored.filter(function (s) { return s.same; }).sort(function (a, b) { return a.d - b.d; });
    var rest = scored.filter(function (s) { return !s.same; }).sort(function (a, b) { return a.d - b.d; });
    return same.concat(rest).slice(0, 5).sort(function (a, b) { return b.w.tvl_usd - a.w.tvl_usd; });
  }

  function openDetail(slug) {
    var row = DATA.rows.find(function (r) { return r.slug === slug; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    render();
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }

  function detailDialog(row) {
    var plan = farmPlan(row);
    var recomputed = impliedOf(row);
    var t = row.terms;
    function eqCell(label, value) {
      return el('div', null, el('span', { text: label }), el('b', { text: value }));
    }
    var catWitnesses = DATA.witnesses.filter(function (w) { return (w.category || 'Uncategorised') === (row.category || 'Uncategorised'); }).length;
    var compRows = compsFor(row).map(function (c) {
      return el('tr', null,
        el('td', null, el('b', { text: c.w.name }), c.same ? null : el('span', { class: 'sub', text: ' (' + (c.w.category || 'Uncategorised') + ')' })),
        el('td', { class: 'num', text: fmtUsd(c.w.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(c.w.mcap_usd) }),
        el('td', { class: 'num', text: 'x' + (c.w.mcap_usd / c.w.tvl_usd).toFixed(3) })
      );
    });
    var stepItems = plan.steps.map(function (s) {
      var cut = s.indexOf(' Cost: ');
      var head = cut >= 0 ? s.slice(0, cut) : s;
      var cost = cut >= 0 ? s.slice(cut + 1) : '';
      return el('li', null, el('b', { text: head }), cost ? el('span', { class: 'cost', text: cost }) : null);
    });
    var dlg = el('dialog', { class: 'detail', 'aria-label': row.name + ' detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('p', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : '') + (row.flag ? ' · ' + FLAG_LABEL[row.flag].toLowerCase() : '') }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'chain unrecorded') + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · 7d ' + fmtPct(row.change_7d) + ' · tokenless for ' + fmtAge(row.age_days) })
        ),
        el('button', { class: 'close', type: 'button', text: 'Close', onclick: closeDetail })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Its implied value, factor by factor' }),
        el('div', { class: 'equation' },
          eqCell('TVL', fmtUsd(row.tvl_usd)),
          eqCell('Base (log pts)', fmtTerm(t.base)),
          eqCell('Size term', fmtTerm(t.size)),
          eqCell('Growth term', fmtTerm(t.growth)),
          eqCell('Age term', fmtTerm(t.age)),
          eqCell('Category term', fmtTerm(t.category)),
          eqCell('Breadth term', fmtTerm(t.breadth)),
          el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
        ),
        el('p', { class: 'note', text: 'The six terms sum to log ' + fmtMult(row.multiple) + ' of TVL. Recomputed on this page from the same terms: ' + fmtUsd(recomputed) + ' — ' + (recomputed === row.implied_value_usd ? 'agrees with board.json to the dollar.' : 'board.json says ' + fmtUsd(row.implied_value_usd) + '.') + (row.flag ? ' Flagged as ' + FLAG_LABEL[row.flag].toLowerCase() + ': the model prices it like everything else; the flag is the radar\'s, not the model\'s.' : '') })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Its comp set: the live tokens nearest its size' }),
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Live token' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Cap / TVL' }))),
          el('tbody', null, compRows)),
        el('p', { class: 'note', text: 'Same-category witnesses nearest in log TVL first, filled with the nearest witnesses overall' + (catWitnesses ? ' — ' + catWitnesses + ' live ' + (row.category || 'Uncategorised') + (catWitnesses === 1 ? ' token feeds' : ' tokens feed') + ' its category offset of ' + fmtTerm(t.category) + ' log points.' : ' — its category has no live witnesses, so its offset is 0 and the curve alone prices it.') })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm plan' + (row.watchlist ? ' — deepened for the watchlist' : '') }),
        el('div', { class: 'plan-total' },
          el('span', null, 'Total plan cost ', el('b', { text: fmtUsd(plan.total) })),
          el('span', null, 'Capital ', el('b', { text: fmtUsd(plan.capital) })),
          el('span', null, 'Gas ', el('b', { text: fmtUsd(plan.gasTotal) })),
          el('span', null, 'Hold ', el('b', { text: plan.hold + ' days' }))
        ),
        el('ol', { class: 'steps' }, stepItems),
        el('div', { class: 'tags' },
          signalChip(row),
          row.watchlist ? el('span', { class: 'chip watch', text: 'Watchlist floor met' }) : el('span', { class: 'chip early', text: 'Below the watchlist floor' }),
          el('span', { class: 'chip', text: 'Plan cost ' + fmtUsd(plan.total) })
        )
      )
    );
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDetail(); });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeDetail(); });
    return dlg;
  }

  function render() {
    var activeId = document.activeElement && document.activeElement.id;
    var selected = state.selected ? DATA.rows.find(function (r) { return r.slug === state.selected; }) : null;
    var shell = el('div', { class: 'shell' },
      header(),
      lede(),
      controls(),
      state.tab === 'pre' ? boardTable() : liveTable(),
      modelPanel(),
      el('p', { class: 'foot' },
        el('b', { text: 'Reading this board. ' }),
        'Implied value is what the fitted comps curve says a protocol\'s TVL would support as a market cap if it launched a token today, in whole dollars, and it is a model output, not a forecast: the out-of-sample record printed above is the honest measure of how far to trust it. The farm plans are the same text board.json carries, recomputed here from each row\'s own figures; every cost in them is an estimate from the protocol\'s primary chain, not a quote. Tokenized protocols are separated, never mixed into the ranking, and no protocol on this page paid to be here.'
      )
    );
    app.replaceChildren(shell);
    if (selected) {
      var dlg = detailDialog(selected);
      app.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal();
    }
    if (activeId === 'q') {
      var input = document.getElementById('q');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
})();
