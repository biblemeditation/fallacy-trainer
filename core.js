/* 순수 로직: 복습 상자, 출제, 보기 구성, 매칭 세트, 해설 선택, 통계. DOM·저장소에 의존하지 않는다. */
(function (g) {
  const FT = (g.FT = g.FT || {});
  const INTERVALS = [0, 1, 3, 7, 14];
  const ALL_CATS = ['language', 'premise', 'formal', 'relevance', 'inductive', 'etc'];
  const DAY = 86400000;

  function defaultSettings() {
    return { examDate: null, newPerDay: 10, setN: 8, setM: 12, reuse: false, retry: true,
      timer: false, cats: ALL_CATS.slice(), choices: 5 };
  }

  function newProgress() {
    return { v: 1, updatedAt: 0, items: {}, conf: {}, settings: defaultSettings(), intro: { day: 0, count: 0 } };
  }

  function dayNum(now) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((d.getTime() - d.getTimezoneOffset() * 60000) / DAY);
  }

  function daysLeft(settings, now) {
    const s = settings && settings.examDate;
    const m = typeof s === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return dayNum(new Date(+m[1], +m[2] - 1, +m[3])) - dayNum(now);
  }

  function intervalFor(box, dl) {
    if (box <= 1) return 0;
    const base = INTERVALS[Math.min(box, 5) - 1];
    if (dl == null) return base;
    return Math.min(base, Math.max(1, Math.floor(dl / 2)));
  }

  function applyAnswer(p, item, { chosen, confidence, now }) {
    const correct = chosen === item.f;
    const today = dayNum(now);
    const rec = p.items[item.id] || { b: 0, due: 0, h: [] };
    if (!rec.b) {
      if (!p.intro || p.intro.day !== today) p.intro = { day: today, count: 0 };
      p.intro.count += 1;
    }
    const base = rec.b || 1;
    let b;
    if (!correct) b = 1;
    else if (confidence === 'sure') b = Math.min(5, base + 1);
    else b = base < 2 ? base + 1 : base;
    const h = (rec.h || []).concat([{ t: now.getTime(), c: correct ? 1 : 0, k: (confidence || 's')[0], x: chosen || null }]).slice(-6);
    p.items[item.id] = { b, due: today + intervalFor(b, daysLeft(p.settings, now)), h };
    if (!correct && chosen) {
      const k = item.f + '|' + chosen;
      p.conf[k] = (p.conf[k] || 0) + 1;
    }
    p.updatedAt = Math.max(now.getTime(), (p.updatedAt || 0) + 1);
    return { correct };
  }

  function todayQueue(p, items, now) {
    const today = dayNum(now);
    const dl = daysLeft(p.settings, now);
    const eve = dl != null && dl <= 1;
    const due = [];
    const fresh = [];
    for (const it of items) {
      const r = p.items[it.id];
      if (r && r.b) {
        if (r.due <= today || (eve && r.b <= 2)) due.push([it.id, r.b, r.due]);
      } else fresh.push(it);
    }
    due.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    const introduced = p.intro && p.intro.day === today ? p.intro.count : 0;
    const quota = Math.max(0, (p.settings.newPerDay | 0) - introduced);
    fresh.sort((a, b) => (a.src === 'note' ? 0 : 1) - (b.src === 'note' ? 0 : 1));
    return due.map(d => d[0]).concat(fresh.slice(0, quota).map(it => it.id));
  }

  function masteryOf(p, fid, items) {
    const hist = [];
    for (const it of items) {
      if (it.f !== fid) continue;
      const r = p.items[it.id];
      if (r && r.h) hist.push(...r.h);
    }
    hist.sort((a, b) => b.t - a.t);
    const last = hist.slice(0, 5);
    const n = last.length;
    if (!n) return { level: 'none', acc: 0, n: 0 };
    const acc = last.reduce((s, h) => s + h.c, 0) / n;
    return { level: acc < 0.5 ? 'low' : acc < 0.8 ? 'mid' : 'high', acc, n };
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pairKey(a, b) { return [a, b].sort().join('|'); }

  function clusterMates(Fx, fid) {
    const out = [];
    for (const c of Fx.clusters) if (c.members.includes(fid)) for (const m of c.members) if (m !== fid && !out.includes(m)) out.push(m);
    return out;
  }

  function enabledFallacies(Fx, settings) {
    const cats = (settings && settings.cats) || ALL_CATS;
    return Fx.fallacies.filter(f => cats.includes(f.cat)).map(f => f.id);
  }

  function pickChoices(item, Fx, { count = 5, rng = Math.random, enabled } = {}) {
    const pool = (enabled || Fx.fallacies.map(f => f.id)).filter(id => id !== item.f);
    if (count - 1 >= pool.length) return shuffle([item.f, ...pool], rng);
    const poolSet = new Set(pool);
    const preferred = [];
    for (const id of [...Object.keys(item.not || {}), ...shuffle(clusterMates(Fx, item.f), rng)])
      if (poolSet.has(id) && !preferred.includes(id)) preferred.push(id);
    const takeNear = Math.min(preferred.length, 3, Math.max(0, count - 2));
    const picked = preferred.slice(0, takeNear);
    const rest = shuffle(pool.filter(id => !picked.includes(id)), rng);
    while (picked.length < count - 1 && rest.length) picked.push(rest.shift());
    return shuffle([item.f, ...picked], rng);
  }

  function weightedPick(ids, weightOf, rng) {
    const total = ids.reduce((s, id) => s + weightOf(id), 0);
    let r = rng() * total;
    for (const id of ids) { r -= weightOf(id); if (r < 0) return id; }
    return ids[ids.length - 1];
  }

  function buildMatchingSet(Fx, p, { n = 8, m = 12, rng = Math.random, enabled, reuse = false, items } = {}) {
    const bank = items || Fx.items || [];
    const enabledIds = enabled || enabledFallacies(Fx, p.settings);
    const byF = {};
    for (const it of bank) if (enabledIds.includes(it.f)) (byF[it.f] = byF[it.f] || []).push(it);
    const avail = enabledIds.filter(id => byF[id]);
    n = Math.max(0, Math.min(n, avail.length));
    const W = { none: 3, low: 3, mid: 2, high: 1 };
    const wCache = {};
    const weightOf = id => (wCache[id] = wCache[id] || W[masteryOf(p, id, byF[id] || []).level]);

    const chosen = [];
    const numClusters = n >= 7 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0;
    for (let k = 0; k < numClusters && chosen.length + 2 <= n; k++) {
      const cands = Fx.clusters.filter(c => c.members.filter(x => avail.includes(x) && !chosen.includes(x)).length >= 2);
      if (!cands.length) break;
      const cw = c => c.members.filter(x => avail.includes(x) && !chosen.includes(x)).reduce((s, x) => s + weightOf(x), 0);
      const total = cands.reduce((s, c) => s + cw(c), 0);
      let r = rng() * total;
      let pick = cands[cands.length - 1];
      for (const c of cands) { r -= cw(c); if (r < 0) { pick = c; break; } }
      for (let t = 0; t < 2; t++) {
        const mem = pick.members.filter(x => avail.includes(x) && !chosen.includes(x));
        chosen.push(weightedPick(mem, weightOf, rng));
      }
    }
    while (chosen.length < n) {
      const rest = avail.filter(x => !chosen.includes(x));
      chosen.push(weightedPick(rest, weightOf, rng));
    }
    if (reuse && n >= 4 && rng() < 0.3) {
      const dupable = chosen.slice(0, -1).filter(id => byF[id].length >= 2);
      if (dupable.length) chosen[chosen.length - 1] = dupable[Math.floor(rng() * dupable.length)];
    }

    const today = dayNum(new Date());
    const usedItems = new Set();
    const pickItem = fid => {
      const list = byF[fid].filter(it => !usedItems.has(it.id));
      const fresh = list.filter(it => { const r = p.items[it.id]; return !r || !r.b || r.due <= today; });
      const tier = fresh.length ? fresh : list;
      const it = tier[Math.floor(rng() * tier.length)];
      usedItems.add(it.id);
      return it.id;
    };
    const itemIds = shuffle(chosen.map(pickItem), rng);

    const answers = [...new Set(chosen)];
    const mTarget = Math.max(answers.length, Math.min(m, enabledIds.length));
    const options = answers.slice();
    for (const id of shuffle(answers.flatMap(a => clusterMates(Fx, a)), rng))
      if (options.length < mTarget && enabledIds.includes(id) && !options.includes(id)) options.push(id);
    for (const id of shuffle(enabledIds, rng))
      if (options.length < mTarget && !options.includes(id)) options.push(id);
    return { items: itemIds, options: shuffle(options, rng) };
  }

  function explainNot(item, chosenId, Fx) {
    let against = chosenId && chosenId !== item.f ? chosenId : null;
    if (!against) against = Object.keys(item.not || {})[0] || clusterMates(Fx, item.f)[0] || null;
    if (!against) return null;
    if (item.not && item.not[against]) return { against, text: item.not[against] };
    const k = pairKey(item.f, against);
    for (const c of Fx.clusters) if (c.pairs[k]) return { against, text: c.pairs[k] };
    const A = Fx.fallacyById[item.f];
    const B = Fx.fallacyById[against];
    return { against, text: `${B.name}은(는) "${B.def}" 이 논증은 그렇지 않고, ${A.name}의 특징("${A.signal[0]}")을 보인다.` };
  }

  function topConfusions(p, k = 5) {
    return Object.entries(p.conf || {})
      .map(([key, count]) => { const [answer, chosen] = key.split('|'); return { answer, chosen, count }; })
      .sort((a, b) => b.count - a.count)
      .slice(0, k);
  }

  function guessStats(p) {
    let correctTotal = 0;
    let luckyCount = 0;
    for (const r of Object.values(p.items || {})) for (const h of r.h || []) if (h.c) { correctTotal++; if (h.k === 'g' || h.k === 'u') luckyCount++; }
    return { correctTotal, luckyCount };
  }

  function fillDefaults(p) {
    const d = newProgress();
    if (!p.items || typeof p.items !== 'object') p.items = {};
    if (!p.conf || typeof p.conf !== 'object') p.conf = {};
    if (!p.intro || typeof p.intro !== 'object') p.intro = d.intro;
    p.settings = Object.assign(d.settings, p.settings || {});
    p.updatedAt = Number(p.updatedAt) || 0;
    p.v = 1;
    return p;
  }

  function mergeProgress(a, b) {
    const pick = !a ? b : !b ? a : (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
    return pick ? fillDefaults(pick) : null;
  }

  FT.core = { INTERVALS, ALL_CATS, newProgress, fillDefaults, dayNum, daysLeft, intervalFor, applyAnswer, todayQueue,
    masteryOf, shuffle, pairKey, clusterMates, enabledFallacies, pickChoices, buildMatchingSet, explainNot,
    topConfusions, guessStats, mergeProgress };
})(typeof window !== 'undefined' ? window : globalThis);
