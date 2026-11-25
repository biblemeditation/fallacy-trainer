/* UI: 해시 라우팅 + 화면별 렌더 함수. 모든 텍스트는 textContent로 넣는다. */
(function () {
  'use strict';
  const FT = window.FT;
  const C = FT.core;
  const S = FT.store;
  const F = FT.fallacyById;
  const ITEMS = FT.items;
  const itemById = {};
  for (const it of ITEMS) itemById[it.id] = it;
  const CAT = {};
  for (const c of FT.categories) CAT[c.id] = c;
  const LABELS = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'.split('');
  const NAV = { cardFocus: null, duelCluster: null };
  const $view = document.getElementById('view');
  const $sheet = document.getElementById('sheet');
  let P = S.init();
  let leaveFns = [];
  let KEY = null;

  // ───────────────────────── helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function onLeave(fn) { leaveFns.push(fn); }
  function go(name) { if (location.hash === '#' + name) render(); else location.hash = name; }
  function link(name, label, cls) { return h('a', { class: cls || 'btn', href: '#' + name, text: label }); }
  function btn(label, onClick, cls, attrs) {
    const b = h('button', Object.assign({ class: cls || 'btn', type: 'button', text: label }, attrs || {}));
    b.addEventListener('click', onClick);
    return b;
  }
  function rng() { return Math.random(); }
  function shuffle(a) { return C.shuffle(a, rng); }
  function enabledIds() { return C.enabledFallacies(FT, P.settings); }
  function enabledItems() { const s = new Set(enabledIds()); return ITEMS.filter(i => s.has(i.f)); }
  function touch() { P.updatedAt = Math.max(Date.now(), (P.updatedAt || 0) + 1); S.save(P); }
  function record(item, chosen, confidence) {
    const r = C.applyAnswer(P, item, { chosen: chosen || null, confidence, now: new Date() });
    S.save(P);
    return r.correct;
  }
  function mastery(fid) { return C.masteryOf(P, fid, ITEMS); }
  function fmtTime(sec) { const m = Math.floor(sec / 60); const s = sec % 60; return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function srcBadge(item) {
    if (item.src === 'note') return h('span', { class: 'badge note', text: '노트' });
    return h('span', { class: 'badge', text: item.src === 'var' ? '변형' : '신규' });
  }
  function ticker(el, countdownSec, onEnd) {
    const start = Date.now();
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const s = Math.floor((Date.now() - start) / 1000);
      if (countdownSec != null) {
        const left = Math.max(0, countdownSec - s);
        el.textContent = fmtTime(left);
        if (left === 0) { stopped = true; clearInterval(id); if (onEnd) onEnd(); }
      } else el.textContent = fmtTime(s);
    };
    const id = setInterval(tick, 250);
    tick();
    onLeave(() => clearInterval(id));
    return { stop() { stopped = true; clearInterval(id); return Math.floor((Date.now() - start) / 1000); } };
  }

  // ───────────────────────── passage + speech bubble
  function passage(item, highlight) {
    const p = h('p', { class: 'passage' });
    fillPassage(p, item, highlight);
    return p;
  }
  function fillPassage(p, item, highlight) {
    clear(p);
    if (!highlight || !item.cue) { p.textContent = item.text; return; }
    const parts = item.text.split(item.cue);
    parts.forEach((part, i) => {
      if (part) p.append(document.createTextNode(part));
      if (i < parts.length - 1) p.append(h('mark', { text: item.cue }));
    });
  }

  function bubble(item, chosen) {
    const f = F[item.f];
    const wrong = chosen && chosen !== item.f;
    const ex = C.explainNot(item, chosen, FT);
    const ans = h('dl', { class: 'ans' }, h('dt', { text: '정답' }), h('dd', { class: 'ok', text: f.name + ' · ' + CAT[f.cat].short }));
    if (wrong) ans.append(h('dt', { text: '내 답' }), h('dd', { class: 'bad', text: F[chosen].name }));
    else if (chosen === null) ans.append(h('dt', { text: '내 답' }), h('dd', { class: 'bad', text: '비워 둠' }));
    const b = h('div', { class: 'bubble', role: 'note' }, ans, h('h4', { text: '왜 오류인가' }), h('p', { text: item.why }));
    if (ex) b.append(h('h4', { text: '왜 ' + F[ex.against].name + '가 아닌가' }), h('p', { text: ex.text }));
    const cardLink = btn('단서 카드 보기 ▸', () => { NAV.cardFocus = item.f; go('cards'); }, 'btn ghost');
    b.append(h('div', { class: 'foot' }, h('span', { class: 'small muted' }, srcBadge(item), ' ', item.ref || ''), cardLink));
    return b;
  }

  const BUB = { host: null, el: null, restore: null };
  function openBubble(host, after, item, chosen, pEl) {
    closeBubble();
    const b = bubble(item, chosen);
    after.after(b);
    if (pEl) fillPassage(pEl, item, true);
    BUB.host = host; BUB.el = b; BUB.restore = pEl ? () => fillPassage(pEl, item, false) : null;
  }
  function closeBubble() {
    if (BUB.el) { BUB.el.remove(); if (BUB.restore) BUB.restore(); }
    BUB.host = null; BUB.el = null; BUB.restore = null;
  }
  document.addEventListener('click', e => {
    if (!BUB.el) return;
    if (!document.contains(e.target)) return; // the clicked control was removed while handling the click
    if (BUB.el.contains(e.target)) return;
    if (BUB.host && BUB.host.contains(e.target)) return;
    if ($sheet.contains(e.target)) return;
    closeBubble();
  });
  document.addEventListener('keydown', e => {
    if (!KEY) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    KEY(e);
  });

  // A finished question shown as a row; tapping toggles its bubble.
  function reviewRow(item, chosen, n, correct) {
    const pEl = passage(item, false);
    const row = h('div', { class: 'qrow ' + (correct ? 'is-ok' : 'is-bad'), 'data-item': item.id },
      h('span', { class: 'qn', text: String(n) }), pEl, h('span', { class: 'slot', text: correct ? '✓' : '✗' }));
    row.addEventListener('click', e => {
      if (BUB.el && BUB.el.contains(e.target)) return;
      if (BUB.host === row) closeBubble(); else openBubble(row, pEl, item, chosen, pEl);
    });
    return row;
  }

  // ───────────────────────── single-question quiz engine
  function defaultChoices(item) {
    const enabled = enabledIds().includes(item.f) ? enabledIds() : FT.fallacies.map(f => f.id);
    const count = P.settings.choices === 'all' ? Infinity : 5;
    return C.pickChoices(item, FT, { count, rng, enabled });
  }

  function runQuiz(root, queue, opts) {
    opts = opts || {};
    const results = [];
    let i = 0;
    const box = h('div', { class: 'stack' });
    root.append(box);
    show();

    function show() {
      clear(box);
      closeBubble();
      if (i >= queue.length) return done();
      const item = queue[i];
      const ids = (opts.choicesFor || defaultChoices)(item);
      let picked = null;
      let answered = false;
      const pEl = passage(item, false);
      const card = h('section', { class: 'panel stack', 'data-q': item.id });
      const meta = h('div', { class: 'qmeta' }, h('span', { class: 'num', text: (i + 1) + ' / ' + queue.length }), srcBadge(item));
      if (opts.metaExtra) meta.append(opts.metaExtra());
      const list = h('div', { class: 'choices', role: 'group', 'aria-label': '오류 고르기' });
      const confRow = h('div', { class: 'row' }, h('span', { class: 'small muted', text: '고른 답, 얼마나 확신하나요?' }));
      const confBtns = [['sure', '확실해요'], ['unsure', '애매해요'], ['guess', '찍었어요']].map(([k, label]) => {
        const b = btn(label, () => submit(k), k === 'sure' ? 'btn primary' : 'btn', { 'data-conf': k });
        b.disabled = true;
        return b;
      });
      confRow.append(...confBtns);
      const choiceBtns = ids.map((fid, k) => {
        const b = h('button', { class: 'choice', type: 'button', 'aria-pressed': 'false', 'data-fid': fid },
          h('span', { class: 'k', text: String(k + 1) }), h('span', { text: F[fid].name }));
        b.addEventListener('click', () => {
          if (answered) return;
          picked = fid;
          for (const x of choiceBtns) x.setAttribute('aria-pressed', String(x === b));
          for (const c of confBtns) c.disabled = false;
        });
        return b;
      });
      list.append(...choiceBtns);
      const after = h('div', { class: 'row' });
      card.append(meta, pEl, list, confRow, after);
      box.append(h('div', { class: 'progressline' }, h('i', { style: 'width:' + (i / queue.length * 100).toFixed(1) + '%' })), card);

      card.addEventListener('click', e => {
        if (!answered) return;
        if (BUB.el && BUB.el.contains(e.target)) return;
        if (e.target.closest('button')) return;
        if (BUB.host === card) closeBubble(); else openBubble(card, list, item, picked, pEl);
      });
      KEY = e => {
        if (!answered && /^[1-9]$/.test(e.key) && choiceBtns[+e.key - 1]) { choiceBtns[+e.key - 1].click(); e.preventDefault(); }
        else if (!answered && e.key === 'Enter' && picked) { submit('sure'); e.preventDefault(); }
        else if (answered && e.key === 'Enter') { next(); e.preventDefault(); }
      };

      function submit(conf) {
        if (answered || !picked) return;
        answered = true;
        const correct = opts.record === false ? picked === item.f : record(item, picked, conf);
        results.push({ item, chosen: picked, correct, conf });
        for (const b of choiceBtns) {
          b.disabled = true;
          if (b.dataset.fid === item.f) b.classList.add('is-ok');
          else if (b.dataset.fid === picked) b.classList.add('is-bad');
        }
        confRow.remove();
        if (opts.onAnswer) opts.onAnswer(correct, item);
        openBubble(card, list, item, picked, pEl);
        const nextBtn = btn(i + 1 < queue.length ? '다음 문제' : '결과 보기', next, 'btn primary', { id: 'next' });
        after.append(h('span', { class: 'badge ' + (correct ? 'ok' : 'bad'), text: correct ? '정답' : '오답' }),
          h('span', { class: 'small muted', text: '문제를 누르면 해설을 접거나 펼 수 있어요' }), h('span', { class: 'spacer' }), nextBtn);
      }
      function next() { i++; show(); window.scrollTo({ top: 0 }); }
    }

    function done() {
      KEY = null;
      const ok = results.filter(r => r.correct).length;
      const by = k => results.filter(r => r.conf === k).length;
      const panel = h('section', { class: 'panel stack' },
        h('div', { class: 'eyebrow', text: '결과' }),
        h('div', { class: 'row' }, h('span', { class: 'score', text: ok + ' / ' + results.length }),
          h('span', { class: 'muted small', text: '확실 ' + by('sure') + ' · 애매 ' + by('unsure') + ' · 찍음 ' + by('guess') })));
      const lucky = results.filter(r => r.correct && r.conf !== 'sure').length;
      if (lucky) panel.append(h('p', { class: 'banner', text: '맞힌 문제 중 ' + lucky + '개는 애매하거나 찍어서 맞혔어요. 이 문제들은 복습 단계가 올라가지 않으니 곧 다시 나옵니다.' }));
      const actions = h('div', { class: 'row' });
      if (opts.again) actions.append(btn('한 번 더', opts.again, 'btn primary'));
      actions.append(link('home', '홈으로'));
      panel.append(actions);
      box.append(panel);
      const wrongs = results.filter(r => !r.correct);
      if (wrongs.length) {
        box.append(h('h2', { class: 'h3', text: '틀린 문제 (' + wrongs.length + ') — 누르면 해설' }));
        wrongs.forEach((r, k) => box.append(reviewRow(r.item, r.chosen, k + 1, false)));
      }
      if (opts.onDone) opts.onDone(results);
    }
  }

  // ───────────────────────── matching board (exam format)
  function matchBoard(root, set, opts) {
    opts = opts || {};
    const items = set.items.map(id => itemById[id]);
    const options = set.options;
    const label = fid => LABELS[options.indexOf(fid)] || '?';
    const reuse = !!opts.reuse;
    const assign = {};
    const locked = new Set();
    let active = null;
    let phase = 'answer';
    let first = null;

    const bogiList = h('div', { class: 'bogi-list' });
    const bogi = h('div', { class: 'bogi' }, h('span', { class: 'bogi-title', text: '〈보기〉' }), bogiList);
    const status = h('div', { class: 'row small muted' });
    const bannerBox = h('div');
    const rowsBox = h('div', { class: 'stack' });
    const actions = h('div', { class: 'row' });
    root.append(bogi, status, bannerBox, rowsBox, actions);

    const rows = items.map((it, i) => {
      const pEl = passage(it, false);
      const slot = h('span', { class: 'slot', 'aria-label': '논제 ' + (i + 1) + '의 답' });
      const hint = h('span', { class: 'hint' });
      hint.hidden = true;
      const row = h('div', { class: 'qrow', 'data-i': String(i), role: 'button', tabindex: '0' },
        h('span', { class: 'qn', text: String(i + 1) }), pEl, slot, hint);
      row.addEventListener('click', e => {
        if (BUB.el && BUB.el.contains(e.target)) return;
        if (phase === 'done') {
          if (opts.noReveal) return;
          const chosen = first ? first[i].chosen : assign[i];
          if (BUB.host === row) closeBubble(); else openBubble(row, hint, it, chosen === undefined ? null : chosen, pEl);
          return;
        }
        if (locked.has(i)) return;
        setActive(i);
      });
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
      rowsBox.append(row);
      return { row, slot, hint, pEl };
    });

    function usedBy(fid, except) {
      for (const k of Object.keys(assign)) if (+k !== except && assign[k] === fid) return true;
      return false;
    }
    function setActive(i) { active = i; refresh(); openSheet(); rows[i].row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    function nextOpen(from) {
      for (let s = 1; s <= items.length; s++) {
        const j = (from + s) % items.length;
        if (!locked.has(j) && !assign[j]) return j;
      }
      return null;
    }
    function openSheet() {
      if (active == null) return closeSheet();
      clear($sheet);
      const grid = h('div', { class: 'sheet-grid' });
      for (const fid of options) {
        const b = h('button', { type: 'button', 'data-fid': fid }, h('b', { text: label(fid) }), h('span', { text: F[fid].name }));
        if (!reuse && usedBy(fid, active)) b.disabled = true;
        if (assign[active] === fid) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', () => {
          assign[active] = fid;
          const nxt = nextOpen(active);
          if (nxt == null) { active = null; closeSheet(); } else { active = nxt; openSheet(); }
          refresh();
        });
        grid.append(b);
      }
      const head = h('div', { class: 'row' }, h('b', { text: '논제 ' + (active + 1) + '에 넣을 보기' }), h('span', { class: 'spacer' }),
        assign[active] ? btn('비우기', () => { delete assign[active]; openSheet(); refresh(); }, 'btn ghost') : null,
        btn('닫기', () => { active = null; closeSheet(); refresh(); }, 'btn'));
      $sheet.append(h('div', { class: 'sheet-in' }, head, grid));
      $sheet.hidden = false;
    }

    function refresh() {
      clear(bogiList);
      for (const fid of options) {
        const used = !reuse && Object.values(assign).includes(fid) && phase !== 'done';
        bogiList.append(h('span', { class: used ? 'used' : null }, h('b', { text: label(fid) }), F[fid].name));
      }
      rows.forEach((r, i) => {
        const fid = assign[i];
        r.row.classList.toggle('active', active === i);
        r.slot.textContent = fid ? label(fid) : '　';
        r.slot.classList.toggle('filled', !!fid);
        r.row.classList.remove('is-ok', 'is-bad');
        r.hint.hidden = true;
        if (phase === 'retry' && locked.has(i)) r.row.classList.add('is-ok');
        if (phase === 'done' && !opts.noReveal) {
          const ok = assign[i] === items[i].f;
          r.row.classList.add(ok ? 'is-ok' : 'is-bad');
          if (!ok) r.slot.textContent = (fid ? label(fid) : '—') + '→' + label(items[i].f);
          const f0 = first && first[i];
          if (f0 && !f0.correct && ok) { r.hint.hidden = false; r.hint.textContent = '첫 시도 ' + (f0.chosen ? label(f0.chosen) + ' ' + F[f0.chosen].name : '비워 둠') + ' → 재도전에서 맞힘'; }
          else if (!opts.noReveal) { r.hint.hidden = false; r.hint.textContent = '눌러서 해설 보기'; }
        }
      });
      const filled = items.filter((_, i) => locked.has(i) || assign[i]).length;
      clear(status);
      if (phase === 'answer') status.append('배정 ' + filled + ' / ' + items.length + ' · 논제를 누른 뒤 아래에서 보기를 고르세요');
      else if (phase === 'retry') status.append('틀린 논제만 다시 고르세요 · 맞힌 논제는 잠겨 있어요');
      clear(actions);
      if (phase !== 'done') {
        const g = btn(phase === 'retry' ? '다시 채점' : '채점하기', () => grade(false), 'btn primary', { id: 'grade' });
        g.disabled = filled < items.length;
        actions.append(g);
        if (opts.extraActions) actions.append(...opts.extraActions());
      } else if (opts.doneActions) actions.append(...opts.doneActions());
    }

    function grade(force) {
      closeSheet();
      active = null;
      const res = items.map((it, i) => ({ item: it, chosen: assign[i] || null, correct: assign[i] === it.f }));
      if (!first) {
        first = res;
        if (opts.record !== false) for (const r of res) if (r.chosen || force) record(r.item, r.chosen, 'sure');
      }
      const wrong = res.filter(r => !r.correct).length;
      const firstOk = first.filter(r => r.correct).length;
      clear(bannerBox);
      if (!force && phase === 'answer' && opts.retry && wrong) {
        phase = 'retry';
        res.forEach((r, i) => { if (r.correct) locked.add(i); else delete assign[i]; });
        bannerBox.append(h('p', { class: 'banner', text: '첫 시도 ' + firstOk + ' / ' + items.length + '. 틀린 ' + wrong + '개를 남은 보기로 한 번 더 골라 보세요. 기록은 첫 시도로 남습니다.' }));
      } else {
        phase = 'done';
        const finalOk = res.filter(r => r.correct).length;
        if (!opts.noReveal) {
          const txt = first === res || finalOk === firstOk ? '점수 ' + firstOk + ' / ' + items.length : '첫 시도 ' + firstOk + ' / ' + items.length + ' · 재도전 후 ' + finalOk + ' / ' + items.length;
          bannerBox.append(h('p', { class: 'banner ' + (firstOk === items.length ? 'ok' : ''), text: txt + ' — 논제를 누르면 말풍선으로 해설이 열립니다.' }));
        }
      }
      refresh();
      if (phase === 'done' && opts.onGraded) opts.onGraded(first);
      if (phase !== 'done') { const j = nextOpen(-1); if (j != null) setActive(j); }
    }

    refresh();
    return { grade: () => grade(true), get phase() { return phase; } };
  }
  function closeSheet() { $sheet.hidden = true; clear($sheet); }

  // ───────────────────────── bar
  const $bar = { back: document.getElementById('back'), title: document.getElementById('barTitle'), dday: document.getElementById('dday'),
    save: document.getElementById('save'), saveText: document.getElementById('saveText') };
  $bar.back.addEventListener('click', () => go('home'));
  function setBar(title, back) { $bar.title.textContent = title || ''; $bar.back.hidden = !back; }
  function updateBar() {
    const dl = C.daysLeft(P.settings, new Date());
    $bar.dday.hidden = dl == null;
    if (dl != null) $bar.dday.textContent = dl > 0 ? 'D-' + dl : dl === 0 ? 'D-DAY' : 'D+' + (-dl);
  }
  S.onMode(m => {
    $bar.save.dataset.mode = m;
    $bar.saveText.textContent = { cloud: '계정에 저장', local: '이 브라우저에 저장', memory: '저장 안 됨' }[m] || '';
  });
  function shortName(f) { return f.name.replace(/에 호소하는 오류$/, ' 호소').replace(/의 오류$/, '').replace(/ 오류$/, ''); }
  function pairText(a, b) { const k = C.pairKey(a, b); for (const c of FT.clusters) if (c.pairs[k]) return c.pairs[k]; return ''; }
  function levelVar(lv) { return lv === 'low' ? 'var(--bad)' : lv === 'mid' ? 'var(--mid)' : lv === 'high' ? 'var(--ok)' : 'var(--none)'; }

  // ───────────────────────── home
  function home() {
    setBar('', false);
    const now = new Date();
    const q = C.todayQueue(P, enabledItems(), now);
    const dueN = q.filter(id => P.items[id] && P.items[id].b).length;
    const newN = q.length - dueN;
    const dl = C.daysLeft(P.settings, now);
    const seen = ITEMS.filter(i => P.items[i.id]).length;
    const noteAll = ITEMS.filter(i => i.src === 'note');
    const noteSeen = noteAll.filter(i => P.items[i.id]).length;
    const eyebrow = dl == null ? '오늘 할 일' : dl > 0 ? '시험까지 ' + dl + '일 · 오늘 할 일' : dl === 0 ? '오늘이 시험날 · 마지막 점검' : '시험이 끝났어요';

    const today = h('section', { class: 'panel today' },
      h('div', { class: 'stack' },
        h('div', { class: 'eyebrow', text: eyebrow }),
        h('div', { class: 'stats' },
          h('div', null, h('span', { class: 'big', text: String(dueN) }), h('span', { class: 'small muted', text: '복습할 문항' })),
          h('div', null, h('span', { class: 'big', text: String(newN) }), h('span', { class: 'small muted', text: '새 문항' })),
          h('div', null, h('span', { class: 'big', text: seen + '/' + ITEMS.length }), h('span', { class: 'small muted', text: '풀어 본 문항 · 노트 원문 ' + noteSeen + '/' + noteAll.length }))),
        dl == null ? h('a', { href: '#prefs', class: 'small', text: '시험 날짜를 넣으면 복습 간격을 시험일에 맞춰 드려요 →' }) : null),
      h('div', { class: 'stack' },
        q.length ? link('review', '오늘 공부 시작', 'btn primary') : h('span', { class: 'small muted', text: '오늘 복습은 끝났어요' }),
        link('match', '매칭 세트 풀기')));

    const map = h('div', { class: 'map' });
    for (const c of FT.categories) {
      const cells = h('div', { class: 'map-cells' });
      for (const f of FT.fallacies.filter(x => x.cat === c.id)) {
        const m = mastery(f.id);
        const cell = h('button', { class: 'cell', type: 'button', 'data-level': m.level,
          title: f.name + (m.n ? ' · 최근 ' + m.n + '번 중 ' + pct(m.acc) : ' · 아직 안 풀어 봄') }, shortName(f));
        cell.addEventListener('click', () => { NAV.cardFocus = f.id; go('cards'); });
        cells.append(cell);
      }
      map.append(h('div', { class: 'map-row' }, h('span', { class: 'map-cat', text: c.short }), cells));
    }
    const legend = h('div', { class: 'legend' }, [['none', '아직 안 풂'], ['low', '50% 미만'], ['mid', '80% 미만'], ['high', '80% 이상']]
      .map(([lv, t]) => h('span', null, h('i', { style: 'background:' + levelVar(lv) }), t)));

    const groups = [
      ['시험 형식', [['match', '매칭 세트', '논제 ' + P.settings.setN + '개 + 보기 ' + P.settings.setM + '개, 시험지 그대로', true], ['exam', '모의고사', '세트 3개 · 20분 · 끝나고 성적표']]],
      ['기본 연습', [['review', '오늘 복습', '틀린 것과 새 문항을 간격 반복으로'], ['drill', '한 문제씩', '논제 하나씩 판정하고 바로 해설'], ['cards', '단서 카드', '정의 · 알아보는 신호 · 헷갈리는 상대']]],
      ['구별 훈련', [['duel', '구별 대결', '헷갈리는 묶음만 집중해서'], ['contrast', '대조 쌍', '같은 소재, 다른 오류 두 개'], ['formal', '형식 오류 훈련', '문장 → 기호 → 타당/부당']]],
      ['정리 · 점검', [['report', '약점 리포트', '정답률과 자주 헷갈린 짝'], ['summary', '시험 직전 요약', '31개를 한 장에'], ['notecheck', '노트 검증', '내 노트 속 실수 찾기'],
        ['speed', '스피드 라운드', '정의 보고 이름 맞히기 60초'], ['basics', '바탕 개념', '기술·설명·논증, 연역·귀납 등']]],
    ];
    const modeBox = h('div', { class: 'stack' });
    for (const [title, modes] of groups) {
      modeBox.append(h('div', { class: 'group-title', text: title }),
        h('div', { class: 'modes' }, modes.map(([r, name, desc, key]) => h('a', { class: 'mode' + (key ? ' key' : ''), href: '#' + r }, h('b', { text: name }), h('span', { text: desc })))));
    }

    $view.append(
      h('div', { class: 'stack' }, h('div', { class: 'eyebrow', text: '논리학 · 오류 찾기 시험 대비' }), h('h1', { class: 'h1', text: '논제를 읽고, 오류를 맞혀라' })),
      today,
      h('section', { class: 'panel stack' }, h('div', { class: 'row' }, h('h2', { class: 'h3', text: '오류 지도' }), h('span', { class: 'spacer' }), legend),
        h('p', { class: 'small muted', text: '칸을 누르면 그 오류의 단서 카드가 열립니다. 색은 최근 5번의 정답률입니다.' }), map),
      modeBox,
      h('div', { class: 'row small' }, link('prefs', '설정 · 백업', 'btn ghost'), h('span', { class: 'muted', text: '문항 ' + ITEMS.length + '개 · 오류 ' + FT.fallacies.length + '개' })));
  }

  // ───────────────────────── cards
  function cards() {
    setBar('단서 카드', true);
    let list = FT.fallacies.slice();
    let idx = NAV.cardFocus ? Math.max(0, list.findIndex(f => f.id === NAV.cardFocus)) : 0;
    NAV.cardFocus = null;
    const catSel = h('select', { id: 'cardCat', 'aria-label': '범주 고르기' }, h('option', { value: '', text: '전체 범주' }),
      FT.categories.map(c => h('option', { value: c.id, text: c.name })));
    const counter = h('span', { class: 'num muted small' });
    const holder = h('div', { class: 'stack' });
    $view.append(h('h1', { class: 'h2', text: '단서 카드' }), h('div', { class: 'row' }, catSel, h('span', { class: 'spacer' }), counter), holder);
    catSel.addEventListener('change', () => { list = catSel.value ? FT.fallacies.filter(f => f.cat === catSel.value) : FT.fallacies.slice(); idx = 0; draw(); });
    draw();

    function draw() {
      clear(holder); closeBubble(); KEY = null;
      const f = list[idx];
      counter.textContent = (idx + 1) + ' / ' + list.length;
      const m = mastery(f.id);
      const mates = C.clusterMates(FT, f.id);
      const card = h('section', { class: 'panel stack' },
        h('div', { class: 'row' }, h('span', { class: 'eyebrow', text: CAT[f.cat].name }), h('span', { class: 'spacer' }),
          h('span', { class: 'badge ' + (m.level === 'high' ? 'ok' : m.level === 'low' ? 'bad' : ''), text: m.n ? '최근 정답률 ' + pct(m.acc) : '아직 안 풀어 봄' })),
        h('h2', { class: 'h1', text: f.name }),
        f.aka.length ? h('p', { class: 'small muted', text: '= ' + f.aka.join(', ') }) : null,
        h('p', { class: 'card-def', text: f.def }),
        h('p', { class: 'small muted', text: f.defNote ? '노트(교재) 정의' : '노트에 정의가 없어 보충한 정의' }),
        h('h3', { class: 'h3', text: '알아보는 신호' }),
        h('ul', { class: 'signals' }, f.signal.map(s => h('li', { text: s }))),
        h('h3', { class: 'h3', text: '대표 예문' }),
        h('p', { class: 'passage', text: f.example }),
        mates.length ? h('h3', { class: 'h3', text: '헷갈리는 오류와 구별' }) : null,
        mates.length ? h('div', { class: 'vs' }, mates.map(mid => h('div', null, h('b', { text: '↔ ' + F[mid].name }), h('span', { text: pairText(f.id, mid) })))) : null);
      holder.append(card, h('div', { class: 'row' },
        btn('← 이전', () => { idx = (idx - 1 + list.length) % list.length; draw(); }),
        btn('다음 →', () => { idx = (idx + 1) % list.length; draw(); }),
        h('span', { class: 'spacer' }),
        btn('이 오류 3문제 풀기', () => mini(f), 'btn primary')));
      KEY = e => { if (e.key === 'ArrowRight') { idx = (idx + 1) % list.length; draw(); } else if (e.key === 'ArrowLeft') { idx = (idx - 1 + list.length) % list.length; draw(); } };
    }
    function mini(f) {
      const own = shuffle(ITEMS.filter(i => i.f === f.id)).slice(0, 2);
      const mates = C.clusterMates(FT, f.id);
      const pool = mates.length ? ITEMS.filter(i => mates.includes(i.f)) : ITEMS.filter(i => i.f !== f.id);
      const q = shuffle(own.concat(shuffle(pool).slice(0, 1)));
      clear(holder); KEY = null;
      holder.append(h('p', { class: 'small muted', text: f.name + ' 확인 문제 3개 — 헷갈리는 오류 문제가 하나 섞여 있어요.' }));
      runQuiz(holder, q, { onDone: () => holder.append(h('div', { class: 'row' }, btn('카드로 돌아가기', draw), btn('다음 카드 →', () => { idx = (idx + 1) % list.length; draw(); }, 'btn primary'))) });
    }
  }

  // ───────────────────────── drill
  function drill() {
    setBar('한 문제씩', true);
    const enabled = enabledIds();
    const cats = FT.categories.filter(c => FT.fallacies.some(f => f.cat === c.id && enabled.includes(f.id)));
    const catSel = h('select', { id: 'drillCat', 'aria-label': '범주' }, h('option', { value: '', text: '켜 둔 범주 전체' }), cats.map(c => h('option', { value: c.id, text: c.name })));
    const fSel = h('select', { id: 'drillF', 'aria-label': '오류' });
    const srcSel = h('select', { id: 'drillSrc', 'aria-label': '출처' }, h('option', { value: '', text: '노트 + 변형 + 신규' }), h('option', { value: 'note', text: '노트 원문만' }), h('option', { value: 'gen', text: '변형 · 신규만' }));
    const wrongBox = h('input', { type: 'checkbox', id: 'drillWrong' });
    const countEl = h('span', { class: 'small muted' });
    const start = btn('20문제 시작', () => begin(), 'btn primary', { id: 'drillStart' });
    function fillF() {
      clear(fSel);
      fSel.append(h('option', { value: '', text: '모든 오류' }));
      for (const f of FT.fallacies) if (enabled.includes(f.id) && (!catSel.value || f.cat === catSel.value)) fSel.append(h('option', { value: f.id, text: f.name }));
    }
    function pool() {
      return ITEMS.filter(i => enabled.includes(i.f)
        && (!catSel.value || F[i.f].cat === catSel.value)
        && (!fSel.value || i.f === fSel.value)
        && (!srcSel.value || (srcSel.value === 'note' ? i.src === 'note' : i.src !== 'note'))
        && (!wrongBox.checked || (P.items[i.id] && P.items[i.id].h.length && !P.items[i.id].h[P.items[i.id].h.length - 1].c)));
    }
    function update() { const n = pool().length; countEl.textContent = '조건에 맞는 문항 ' + n + '개'; start.textContent = Math.min(20, n) + '문제 시작'; start.disabled = n === 0; }
    if (NAV.drillFallacy) { const f = F[NAV.drillFallacy]; catSel.value = f.cat; }
    fillF();
    if (NAV.drillFallacy) { fSel.value = NAV.drillFallacy; NAV.drillFallacy = null; }
    catSel.addEventListener('change', () => { fillF(); update(); });
    for (const el of [fSel, srcSel, wrongBox]) el.addEventListener('change', update);
    update();
    $view.append(h('h1', { class: 'h2', text: '한 문제씩' }),
      h('p', { class: 'lead', text: '논제 하나를 읽고 오류를 고른 뒤, 확신도를 눌러 제출하세요. 바로 말풍선으로 해설이 열립니다. 숫자 키 1~5로 고르고 Enter로 넘어갈 수 있어요.' }),
      h('section', { class: 'panel stack' }, h('div', { class: 'row' }, catSel, fSel, srcSel), h('label', { class: 'check' }, wrongBox, '마지막에 틀린 문항만'), h('div', { class: 'row' }, countEl, h('span', { class: 'spacer' }), start)));
    function begin() {
      const q = shuffle(pool()).slice(0, 20);
      clear($view);
      runQuiz($view, q, { again: () => render() });
    }
  }

  // ───────────────────────── review (spaced repetition)
  function review() {
    setBar('오늘 복습', true);
    const q = C.todayQueue(P, enabledItems(), new Date()).map(id => itemById[id]);
    if (!q.length) {
      $view.append(h('section', { class: 'panel stack' }, h('h1', { class: 'h2', text: '오늘 복습은 끝났어요' }),
        h('p', { class: 'lead', text: '복습할 때가 된 문항도, 오늘 배정된 새 문항도 없습니다. 매칭 세트로 실전 연습을 하거나, 설정에서 하루 새 문항 수를 늘릴 수 있어요.' }),
        h('div', { class: 'row' }, link('match', '매칭 세트', 'btn primary'), link('drill', '한 문제씩'), link('prefs', '설정'))));
      return;
    }
    const due = q.filter(i => P.items[i.id] && P.items[i.id].b).length;
    $view.append(h('p', { class: 'small muted', text: '복습 ' + due + '개 + 새 문항 ' + (q.length - due) + '개. 틀리거나 찍어서 맞힌 문제는 곧 다시 나옵니다.' }));
    runQuiz($view, q, { again: () => render() });
  }

  // ───────────────────────── match
  function match() {
    setBar('매칭 세트', true);
    const s = P.settings;
    const set = C.buildMatchingSet(FT, P, { n: s.setN, m: s.setM, rng, reuse: s.reuse });
    if (set.items.length < 2) {
      $view.append(h('section', { class: 'panel stack' }, h('p', { text: '켜 둔 범주의 오류가 너무 적어 세트를 만들 수 없어요. 설정에서 범주를 더 켜 주세요.' }), link('prefs', '설정', 'btn primary')));
      return;
    }
    const timerEl = h('span', { class: 'num muted' });
    $view.append(h('div', { class: 'row' }, h('h1', { class: 'h2', text: '매칭 세트' }), h('span', { class: 'spacer' }), s.timer ? timerEl : null),
      h('p', { class: 'small muted', text: '각 논제에 해당하는 오류를 〈보기〉에서 고르세요. 논제마다 오류는 하나입니다.' + (s.reuse ? ' 같은 보기를 여러 번 쓸 수 있어요.' : ' 보기는 한 번씩만 쓸 수 있어요.') }));
    const t = s.timer ? ticker(timerEl, null) : null;
    const box = h('div', { class: 'stack' });
    $view.append(box);
    matchBoard(box, set, { retry: s.retry, reuse: s.reuse, onGraded: () => { if (t) t.stop(); },
      doneActions: () => [btn('새 세트', () => render(), 'btn primary', { id: 'newSet' }), link('report', '약점 리포트'), link('home', '홈으로')] });
  }

  // ───────────────────────── exam
  function exam() {
    setBar('모의고사', true);
    const s = P.settings;
    const SETS = 3;
    const LIMIT = 20 * 60;
    $view.append(h('section', { class: 'panel stack' }, h('div', { class: 'eyebrow', text: '실전처럼' }), h('h1', { class: 'h2', text: '모의고사' }),
      h('p', { class: 'lead', text: '매칭 세트 ' + SETS + '개(논제 ' + s.setN * SETS + '개)를 ' + LIMIT / 60 + '분 안에 풉니다. 세트마다 제출하면 다음 세트로 넘어가고, 정답과 해설은 모두 끝난 뒤에 볼 수 있어요. 재도전은 없습니다.' }),
      h('div', { class: 'row' }, btn('시작하기', begin, 'btn primary', { id: 'examStart' }), link('home', '홈으로'))));

    function begin() {
      clear($view);
      const used = new Set();
      const sets = [];
      for (let k = 0; k < SETS; k++) {
        const items = enabledItems().filter(i => !used.has(i.id));
        const st = C.buildMatchingSet(FT, P, { n: s.setN, m: s.setM, rng, reuse: s.reuse, items });
        st.items.forEach(id => used.add(id));
        sets.push(st);
      }
      const setLabel = h('b');
      const timerEl = h('span', { class: 'num' });
      const box = h('div', { class: 'stack' });
      $view.append(h('div', { class: 'row' }, setLabel, h('span', { class: 'spacer' }), h('span', { class: 'small muted', text: '남은 시간' }), timerEl), box);
      const results = [];
      let k = 0;
      let board = null;
      let timeUp = false;
      let finished = false;
      const t = ticker(timerEl, LIMIT, () => { timeUp = true; if (board && board.phase !== 'done') board.grade(); finish(); });
      showSet();
      function showSet() {
        clear(box); closeSheet();
        setLabel.textContent = '세트 ' + (k + 1) + ' / ' + SETS;
        board = matchBoard(box, sets[k], { retry: false, reuse: s.reuse, noReveal: true,
          onGraded: res => { results.push(...res); k++; if (!timeUp) { if (k < SETS) { showSet(); window.scrollTo({ top: 0 }); } else finish(); } } });
      }
      function finish() {
        if (finished) return;
        finished = true;
        const spent = t.stop();
        closeSheet(); closeBubble(); clear($view);
        const total = sets.reduce((n, st) => n + st.items.length, 0);
        const ok = results.filter(r => r.correct).length;
        const byCat = {};
        for (const r of results) { const c = F[r.item.f].cat; byCat[c] = byCat[c] || [0, 0]; byCat[c][1]++; if (r.correct) byCat[c][0]++; }
        const conf = {};
        for (const r of results) if (!r.correct && r.chosen) { const key = F[r.item.f].name + ' → ' + F[r.chosen].name; conf[key] = (conf[key] || 0) + 1; }
        $view.append(h('section', { class: 'panel stack' },
          h('div', { class: 'eyebrow', text: '모의고사 성적표' }),
          h('div', { class: 'row' }, h('span', { class: 'score', text: ok + ' / ' + total }), h('span', { class: 'muted', text: pct(total ? ok / total : 0) + ' · 걸린 시간 ' + fmtTime(spent) })),
          timeUp ? h('p', { class: 'banner bad', text: '시간이 끝나 제출되었어요. 풀지 못한 논제는 오답으로 계산했습니다.' }) : null,
          h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '범주' }), h('th', { text: '맞힘' }))),
            h('tbody', null, FT.categories.filter(c => byCat[c.id]).map(c => h('tr', null, h('td', { text: c.name }), h('td', { class: 'num', text: byCat[c.id][0] + ' / ' + byCat[c.id][1] })))))),
          Object.keys(conf).length ? h('div', { class: 'stack' }, h('h2', { class: 'h3', text: '헷갈린 짝 (정답 → 내가 고른 답)' }),
            h('ul', { class: 'signals' }, Object.entries(conf).sort((a, b) => b[1] - a[1]).map(([k2, v]) => h('li', { text: k2 + (v > 1 ? ' (' + v + '번)' : '') })))) : null,
          h('div', { class: 'row' }, btn('다시 응시', () => render(), 'btn primary'), link('report', '약점 리포트'), link('home', '홈으로'))));
        const ordered = results.slice().sort((a, b) => (a.correct ? 1 : 0) - (b.correct ? 1 : 0));
        $view.append(h('h2', { class: 'h3', text: '전체 해설 — 틀린 문제부터, 누르면 말풍선' }));
        ordered.forEach((r, i) => $view.append(reviewRow(r.item, r.chosen, i + 1, r.correct)));
      }
    }
  }

  // ───────────────────────── report
  function report() {
    setBar('약점 리포트', true);
    let attempts = 0;
    for (const r of Object.values(P.items)) attempts += (r.h || []).length;
    if (!attempts) {
      $view.append(h('section', { class: 'panel stack' }, h('h1', { class: 'h2', text: '아직 기록이 없어요' }),
        h('p', { class: 'lead', text: '문제를 풀면 오류별 정답률과 자주 헷갈린 짝이 여기에 쌓입니다.' }),
        h('div', { class: 'row' }, link('match', '매칭 세트', 'btn primary'), link('drill', '한 문제씩'))));
      return;
    }
    const gs = C.guessStats(P);
    const seen = ITEMS.filter(i => P.items[i.id]).length;
    $view.append(h('h1', { class: 'h2', text: '약점 리포트' }),
      h('section', { class: 'panel' }, h('dl', { class: 'kv' },
        h('dt', { text: '총 풀이' }), h('dd', { class: 'num', text: attempts + '번' }),
        h('dt', { text: '풀어 본 문항' }), h('dd', { class: 'num', text: seen + ' / ' + ITEMS.length }),
        h('dt', { text: '운으로 맞힌 비율' }), h('dd', { text: gs.correctTotal ? pct(gs.luckyCount / gs.correctTotal) + ' (맞힌 ' + gs.correctTotal + '번 중 애매·찍음 ' + gs.luckyCount + '번)' : '—' }))));

    const conf = C.topConfusions(P, 5);
    if (conf.length) {
      const list = h('div', { class: 'stack' });
      for (const c of conf) {
        const cl = FT.clusters.find(x => x.members.includes(c.answer) && x.members.includes(c.chosen)) || FT.clusters.find(x => x.members.includes(c.answer));
        list.append(h('div', { class: 'row' }, h('span', null, h('b', { text: F[c.answer].name }), ' 를 ', h('b', { text: F[c.chosen].name }), '(으)로 고름 ', h('span', { class: 'num muted', text: c.count + '번' })),
          h('span', { class: 'spacer' }), cl ? btn('구별 대결', () => { NAV.duelCluster = cl.id; go('duel'); }, 'btn') : null));
      }
      $view.append(h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '자주 헷갈린 짝 Top ' + conf.length }), list));
    }

    for (const c of FT.categories) {
      const bars = h('div', { class: 'bars' });
      for (const f of FT.fallacies.filter(x => x.cat === c.id)) {
        const m = mastery(f.id);
        const row = h('div', { class: 'barrow' }, h('a', { href: '#cards', text: shortName(f), onclick: () => { NAV.cardFocus = f.id; } }),
          h('div', { class: 'track' }, h('div', { class: 'fill', 'data-level': m.level, style: 'width:' + (m.n ? Math.max(4, m.acc * 100) : 0) + '%' })),
          h('span', { class: 'v', text: m.n ? pct(m.acc) + ' · ' + m.n : '—' }));
        bars.append(row);
      }
      $view.append(h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: c.name }), bars));
    }
    const weak = FT.fallacies.map(f => ({ f, m: mastery(f.id) })).filter(x => x.m.n && x.m.level !== 'high').sort((a, b) => a.m.acc - b.m.acc).slice(0, 5);
    if (weak.length) {
      $view.append(h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '먼저 다시 볼 오류' }),
        weak.map(x => h('div', { class: 'row' }, h('b', { text: x.f.name }), h('span', { class: 'muted small num', text: pct(x.m.acc) }), h('span', { class: 'spacer' }),
          btn('단서 카드', () => { NAV.cardFocus = x.f.id; go('cards'); }), btn('이 오류만 연습', () => { NAV.drillFallacy = x.f.id; go('drill'); }, 'btn primary')))));
    }
  }

  // ───────────────────────── duel
  function duel() {
    setBar('구별 대결', true);
    if (!NAV.duelCluster) {
      $view.append(h('h1', { class: 'h2', text: '구별 대결' }), h('p', { class: 'lead', text: '서로 헷갈리는 오류끼리 묶었어요. 묶음 하나를 골라 그 오류들만 빠르게 구별해 봅니다.' }));
      const grid = h('div', { class: 'modes' });
      for (const c of FT.clusters) {
        const b = h('button', { class: 'mode', type: 'button' }, h('b', { text: c.name }), h('span', { text: c.members.map(id => shortName(F[id])).join(' · ') }));
        b.addEventListener('click', () => { NAV.duelCluster = c.id; render(); });
        grid.append(b);
      }
      $view.append(grid);
      return;
    }
    const c = FT.clusters.find(x => x.id === NAV.duelCluster);
    const intro = h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('h1', { class: 'h2', text: '구별 대결 · ' + c.name }), h('span', { class: 'spacer' }), btn('다른 묶음', () => { NAV.duelCluster = null; render(); }, 'btn ghost')),
      h('p', { class: 'banner', text: c.tip }),
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '오류' }), h('th', { text: '알아보는 신호' }))),
        h('tbody', null, c.members.map(id => h('tr', null, h('td', { class: 'name', text: F[id].name }), h('td', { text: F[id].signal[0] })))))),
      h('div', { class: 'vs' }, Object.entries(c.pairs).map(([k, v]) => { const [a, b] = k.split('|'); return h('div', null, h('b', { text: shortName(F[a]) + ' ↔ ' + shortName(F[b]) }), h('span', { text: v })); })),
      h('div', { class: 'row' }, btn('시작하기', start, 'btn primary', { id: 'duelStart' })));
    $view.append(intro);
    function start() {
      clear($view);
      let streak = 0;
      let best = 0;
      const streakEl = h('span', { class: 'badge' });
      const paint = () => { streakEl.textContent = '연속 ' + streak + ' · 최고 ' + best; };
      paint();
      $view.append(h('div', { class: 'row' }, h('h1', { class: 'h3', text: '구별 대결 · ' + c.name }), h('span', { class: 'spacer' }), streakEl));
      const q = shuffle(ITEMS.filter(i => c.members.includes(i.f))).slice(0, 12);
      runQuiz($view, q, { choicesFor: () => shuffle(c.members), onAnswer: ok => { streak = ok ? streak + 1 : 0; best = Math.max(best, streak); paint(); }, again: () => render() });
    }
  }

  // ───────────────────────── contrast pairs
  function contrast() {
    setBar('대조 쌍', true);
    const byPair = {};
    for (const it of ITEMS) if (it.pair) (byPair[it.pair] = byPair[it.pair] || []).push(it);
    const pairs = shuffle(Object.values(byPair)).map(p => shuffle(p));
    let k = 0;
    const box = h('div', { class: 'stack' });
    $view.append(h('h1', { class: 'h2', text: '대조 쌍' }), h('p', { class: 'lead', text: '소재는 거의 같은데 오류가 다른 두 논증입니다. 무엇이 갈림길인지에 주목해서 각각 고르세요.' }), box);
    draw();
    function draw() {
      clear(box);
      if (k >= pairs.length) { box.append(h('section', { class: 'panel stack' }, h('p', { text: '대조 쌍 ' + pairs.length + '개를 모두 풀었어요.' }), h('div', { class: 'row' }, btn('처음부터', () => render(), 'btn primary'), link('home', '홈으로')))); return; }
      const [a, b] = pairs[k];
      const opts = [];
      for (const id of [a.f, b.f, C.clusterMates(FT, a.f)[0], C.clusterMates(FT, b.f)[0]]) if (id && !opts.includes(id) && opts.length < 4) opts.push(id);
      const choices = shuffle(opts);
      const picked = {};
      const panels = [a, b].map((it, side) => {
        const btns = choices.map(fid => {
          const x = h('button', { class: 'choice', type: 'button', 'aria-pressed': 'false', 'data-fid': fid }, h('span', { text: F[fid].name }));
          x.addEventListener('click', () => { if (checked) return; picked[side] = fid; btns.forEach(y => y.setAttribute('aria-pressed', String(y === x))); check.disabled = !(picked[0] && picked[1]); });
          return x;
        });
        const panel = h('section', { class: 'panel stack' }, h('div', { class: 'eyebrow', text: side ? '논제 B' : '논제 A' }), passage(it, false), h('div', { class: 'choices' }, btns));
        return { panel, btns, it };
      });
      let checked = false;
      const check = btn('확인', () => {
        checked = true;
        panels.forEach((p, side) => {
          record(p.it, picked[side], 'sure');
          p.btns.forEach(x => { x.disabled = true; if (x.dataset.fid === p.it.f) x.classList.add('is-ok'); else if (x.dataset.fid === picked[side]) x.classList.add('is-bad'); });
          p.panel.append(bubble(p.it, picked[side]));
        });
        check.remove();
        actions.append(btn(k + 1 < pairs.length ? '다음 쌍' : '마치기', () => { k++; draw(); window.scrollTo({ top: 0 }); }, 'btn primary', { id: 'next' }));
      }, 'btn primary', { id: 'pairCheck' });
      check.disabled = true;
      const actions = h('div', { class: 'row' }, h('span', { class: 'num muted small', text: (k + 1) + ' / ' + pairs.length }), h('span', { class: 'spacer' }), check);
      box.append(h('div', { class: 'two' }, panels.map(p => p.panel)), actions);
    }
  }

  // ───────────────────────── formal fallacy drill
  function formal() {
    setBar('형식 오류 훈련', true);
    const forms = Object.entries(FT.forms);
    const q = shuffle(FT.formalDrills);
    let k = 0;
    let ok = 0;
    const box = h('div', { class: 'stack' });
    $view.append(h('h1', { class: 'h2', text: '형식 오류 훈련' }),
      h('p', { class: 'lead', text: '문장을 P, Q로 바꾸고 두 번째 전제가 무엇을 긍정·부정하는지 보면 형식이 보입니다. “~인 경우에만”, “~없이는”은 화살표 방향부터 바로잡으세요.' }),
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '형식' }), h('th', { text: '모양' }), h('th', { text: '판정' }))),
        h('tbody', null, forms.map(([, f]) => h('tr', null, h('td', { class: 'name', text: f.name }), h('td', { class: 'mono', text: f.shape }), h('td', { text: f.valid ? '타당' : '부당' })))))),
      box);
    draw();
    function draw() {
      clear(box);
      if (k >= q.length) { box.append(h('section', { class: 'panel stack' }, h('div', { class: 'score', text: ok + ' / ' + q.length }), h('div', { class: 'row' }, btn('다시', () => render(), 'btn primary'), link('home', '홈으로')))); return; }
      const d = q[k];
      const reveal = h('div', { class: 'stack' });
      const btns = forms.map(([key, f]) => {
        const b = h('button', { class: 'choice', type: 'button', 'data-form': key }, h('span', { class: 'k', text: f.valid ? '○' : '✕' }), h('span', null, f.name, ' ', h('span', { class: 'mono small muted', text: f.shape })));
        b.addEventListener('click', () => {
          const right = key === d.form;
          if (right) ok++;
          btns.forEach(x => { x.disabled = true; if (x.dataset.form === d.form) x.classList.add('is-ok'); else if (x === b) x.classList.add('is-bad'); });
          reveal.append(h('div', { class: 'bubble' },
            h('dl', { class: 'kv' }, h('dt', { text: 'P' }), h('dd', { text: d.p }), h('dt', { text: 'Q' }), h('dd', { text: d.q }),
              h('dt', { text: '기호화' }), h('dd', null, h('span', { class: 'symbol', text: d.symbol })),
              h('dt', { text: '판정' }), h('dd', { text: FT.forms[d.form].name + ' · ' + (d.valid ? '타당' : '부당') })),
            h('p', { text: d.why })),
            h('div', { class: 'row' }, h('span', { class: 'badge ' + (right ? 'ok' : 'bad'), text: right ? '정답' : '오답' }), d.trick ? h('span', { class: 'badge note', text: '함정 문장' }) : null,
              h('span', { class: 'spacer' }), btn(k + 1 < q.length ? '다음' : '결과', () => { k++; draw(); }, 'btn primary', { id: 'next' })));
        });
        return b;
      });
      box.append(h('section', { class: 'panel stack' }, h('div', { class: 'qmeta' }, h('span', { class: 'num', text: (k + 1) + ' / ' + q.length })),
        h('p', { class: 'passage', text: d.text }), h('h2', { class: 'h3', text: '이 논증의 형식은?' }), h('div', { class: 'choices' }, btns), reveal));
    }
  }

  // ───────────────────────── summary sheet
  function summary() {
    setBar('시험 직전 요약', true);
    $view.append(h('h1', { class: 'h2', text: '시험 직전 요약' }), h('p', { class: 'lead', text: '오류 31개를 범주별로 한 장에 모았습니다. 신호 한 줄과 대표 예문만 빠르게 훑어보세요.' }));
    for (const c of FT.categories) {
      $view.append(h('h2', { class: 'h3', text: c.name + ' · ' + c.note }),
        h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '오류' }), h('th', { text: '알아보는 신호' }), h('th', { text: '대표 예문' }))),
          h('tbody', null, FT.fallacies.filter(f => f.cat === c.id).map(f => h('tr', null, h('td', { class: 'name', text: shortName(f) }), h('td', { text: f.signal[0] }), h('td', { text: f.example })))))));
    }
    $view.append(h('h2', { class: 'h3', text: '헷갈리는 묶음 한눈에' }),
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '묶음' }), h('th', { text: '구별 포인트' }))),
        h('tbody', null, FT.clusters.map(c => h('tr', null, h('td', { class: 'name', text: c.name }), h('td', { text: c.tip })))))));
  }

  // ───────────────────────── note check
  function notecheck() {
    setBar('노트 검증', true);
    const qs = shuffle(FT.noteChecks.map(n => ({ bad: true, where: n.where, text: n.wrong, right: n.right, why: n.why }))
      .concat(FT.noteTrue.map(n => ({ bad: false, where: n.where, text: n.text, why: n.why }))));
    let k = 0;
    let ok = 0;
    const box = h('div', { class: 'stack' });
    $view.append(h('h1', { class: 'h2', text: '노트 검증' }), h('p', { class: 'lead', text: '노트에 적힌 내용 가운데 일부는 틀렸습니다. 노트에 적힌 그대로가 맞는지 판정해 보세요. 시험 전에 잘못 외운 것을 바로잡는 연습입니다.' }), box);
    draw();
    function draw() {
      clear(box);
      if (k >= qs.length) { box.append(h('section', { class: 'panel stack' }, h('div', { class: 'score', text: ok + ' / ' + qs.length }), h('div', { class: 'row' }, btn('다시', () => render(), 'btn primary'), link('home', '홈으로')))); return; }
      const s = qs[k];
      const reveal = h('div', { class: 'stack' });
      const answer = sayBad => {
        const right = sayBad === s.bad;
        if (right) ok++;
        yes.disabled = no.disabled = true;
        (s.bad ? no : yes).classList.add('is-ok');
        if (!right) (sayBad ? no : yes).classList.add('is-bad');
        reveal.append(h('div', { class: 'bubble' }, h('h4', { text: s.bad ? '노트가 틀렸어요' : '노트가 맞아요' }), s.bad ? h('p', null, h('b', { text: '바른 내용: ' }), s.right) : null, h('p', { text: s.why })),
          h('div', { class: 'row' }, h('span', { class: 'badge ' + (right ? 'ok' : 'bad'), text: right ? '정답' : '오답' }), h('span', { class: 'spacer' }), btn(k + 1 < qs.length ? '다음' : '결과', () => { k++; draw(); }, 'btn primary', { id: 'next' })));
      };
      const yes = btn('노트가 맞다', () => answer(false), 'choice');
      const no = btn('노트가 틀렸다', () => answer(true), 'choice');
      box.append(h('section', { class: 'panel stack' }, h('div', { class: 'qmeta' }, h('span', { class: 'num', text: (k + 1) + ' / ' + qs.length }), h('span', { text: s.where })),
        h('p', { class: 'small muted', text: '노트에 이렇게 적혀 있습니다' }), h('p', { class: 'passage', text: s.text }), h('div', { class: 'choices two' }, yes, no), reveal));
    }
  }

  // ───────────────────────── speed round
  function speed() {
    setBar('스피드 라운드', true);
    const best = (P.best && P.best.speed) || 0;
    $view.append(h('section', { class: 'panel stack' }, h('h1', { class: 'h2', text: '스피드 라운드' }),
      h('p', { class: 'lead', text: '정의를 보고 오류 이름을 고르세요. 60초 동안 몇 개나 맞힐 수 있을까요? 보기 이름을 보는 순간 정의가 떠오르게 만드는 연습입니다.' }),
      h('p', { class: 'small muted', text: best ? '최고 기록 ' + best + '개' : '첫 도전입니다' }),
      h('div', { class: 'row' }, btn('시작', begin, 'btn primary', { id: 'speedStart' }))));
    function begin() {
      clear($view);
      let score = 0;
      let total = 0;
      let over = false;
      const timerEl = h('span', { class: 'num' });
      const scoreEl = h('span', { class: 'num' });
      const box = h('div', { class: 'stack' });
      $view.append(h('div', { class: 'row' }, h('b', null, '맞힘 ', scoreEl), h('span', { class: 'spacer' }), h('span', { class: 'small muted', text: '남은 시간' }), timerEl), box);
      ticker(timerEl, 60, end);
      next();
      function next() {
        if (over) return;
        clear(box);
        scoreEl.textContent = String(score);
        const pool = enabledIds();
        const fid = pool[Math.floor(rng() * pool.length)];
        const choices = C.pickChoices({ id: '_', f: fid, not: {} }, FT, { count: 4, rng, enabled: pool });
        const btns = choices.map(id => {
          const b = h('button', { class: 'choice', type: 'button' }, h('span', { text: F[id].name }));
          b.addEventListener('click', () => {
            if (over) return;
            total++;
            if (id === fid) score++;
            btns.forEach(x => { x.disabled = true; });
            b.classList.add(id === fid ? 'is-ok' : 'is-bad');
            if (id !== fid) btns[choices.indexOf(fid)].classList.add('is-ok');
            const tid = setTimeout(next, id === fid ? 350 : 900);
            onLeave(() => clearTimeout(tid));
          });
          return b;
        });
        box.append(h('section', { class: 'panel stack' }, h('p', { class: 'card-def', text: F[fid].def.replace(/\s*\(노트에는[^)]*\)/, '') }), h('div', { class: 'choices' }, btns)));
      }
      function end() {
        over = true;
        clear(box);
        const prev = (P.best && P.best.speed) || 0;
        if (score > prev) { P.best = Object.assign({}, P.best, { speed: score }); touch(); }
        box.append(h('section', { class: 'panel stack' }, h('div', { class: 'score', text: score + '개' }),
          h('p', { class: 'muted', text: total + '번 중 ' + score + '번 맞힘' + (score > prev ? ' · 최고 기록!' : ' · 최고 기록 ' + prev + '개') }),
          h('div', { class: 'row' }, btn('다시', () => render(), 'btn primary'), link('home', '홈으로'))));
      }
    }
  }

  // ───────────────────────── basics quiz
  function basics() {
    setBar('바탕 개념', true);
    const qs = shuffle(FT.basics);
    let k = 0;
    let ok = 0;
    const box = h('div', { class: 'stack' });
    $view.append(h('h1', { class: 'h2', text: '바탕 개념' }), h('p', { class: 'lead', text: '오류를 구별하는 데 필요한 기초입니다: 기술·설명·논증, 연역·귀납, 불가능성, 논증 구조, 타당성·건전성, 숨은 전제.' }), box);
    draw();
    function draw() {
      clear(box);
      if (k >= qs.length) { box.append(h('section', { class: 'panel stack' }, h('div', { class: 'score', text: ok + ' / ' + qs.length }), h('div', { class: 'row' }, btn('다시', () => render(), 'btn primary'), link('home', '홈으로')))); return; }
      const b = qs[k];
      const reveal = h('div', { class: 'stack' });
      const btns = b.choices.map(c => {
        const x = h('button', { class: 'choice', type: 'button' }, h('span', { text: c }));
        x.addEventListener('click', () => {
          const right = c === b.answer;
          if (right) ok++;
          btns.forEach((y, i) => { y.disabled = true; if (b.choices[i] === b.answer) y.classList.add('is-ok'); });
          if (!right) x.classList.add('is-bad');
          reveal.append(h('div', { class: 'bubble' }, h('h4', { text: '정답: ' + b.answer }), h('p', { text: b.why })),
            h('div', { class: 'row' }, h('span', { class: 'spacer' }), btn(k + 1 < qs.length ? '다음' : '결과', () => { k++; draw(); }, 'btn primary', { id: 'next' })));
        });
        return x;
      });
      box.append(h('section', { class: 'panel stack' }, h('div', { class: 'qmeta' }, h('span', { class: 'num', text: (k + 1) + ' / ' + qs.length }), h('span', { text: b.topic })),
        h('p', { class: 'passage', text: b.q }), h('div', { class: 'choices' }, btns), reveal));
    }
  }

  // ───────────────────────── prefs
  function prefs() {
    setBar('설정 · 백업', true);
    const s = P.settings;
    const change = fn => () => { fn(); touch(); updateBar(); };

    const date = h('input', { type: 'date', id: 'examDate', value: s.examDate || '' });
    date.addEventListener('change', change(() => { s.examDate = date.value || null; }));

    const catMsg = h('p', { class: 'small muted' });
    const catBoxes = FT.categories.map(c => {
      const cb = h('input', { type: 'checkbox', id: 'cat-' + c.id });
      cb.checked = s.cats.includes(c.id);
      cb.addEventListener('change', () => {
        const next = FT.categories.filter(x => document.getElementById('cat-' + x.id).checked).map(x => x.id);
        if (!next.length) { cb.checked = true; catMsg.textContent = '범주를 하나 이상 켜 두어야 해요.'; return; }
        catMsg.textContent = '';
        s.cats = next; touch();
      });
      return h('label', { class: 'check' }, cb, c.name);
    });

    const perDay = h('input', { type: 'number', id: 'newPerDay', min: '0', max: '60', value: String(s.newPerDay) });
    perDay.addEventListener('change', change(() => { s.newPerDay = Math.max(0, Math.min(60, parseInt(perDay.value, 10) || 0)); perDay.value = String(s.newPerDay); }));

    const choiceSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '한 문제씩 보기 수' });
    for (const [v, t] of [[5, '5개'], ['all', '31개 전부']]) {
      const b = btn(t, () => { s.choices = v; touch(); for (const x of choiceSeg.children) x.setAttribute('aria-pressed', String(x === b)); });
      b.setAttribute('aria-pressed', String(s.choices === v));
      choiceSeg.append(b);
    }

    const nSel = h('select', { id: 'setN', 'aria-label': '논제 수' });
    for (let n = 4; n <= 12; n++) nSel.append(h('option', { value: String(n), text: n + '개' }));
    nSel.value = String(s.setN);
    const mSel = h('select', { id: 'setM', 'aria-label': '보기 수' });
    const fillM = () => { clear(mSel); for (let m = s.setN; m <= LABELS.length; m++) mSel.append(h('option', { value: String(m), text: m + '개' })); mSel.value = String(Math.max(s.setM, s.setN)); };
    fillM();
    nSel.addEventListener('change', change(() => { s.setN = +nSel.value; if (s.setM < s.setN) s.setM = s.setN; fillM(); }));
    mSel.addEventListener('change', change(() => { s.setM = +mSel.value; }));
    const toggle = (key, text) => { const cb = h('input', { type: 'checkbox', id: 'opt-' + key }); cb.checked = !!s[key]; cb.addEventListener('change', change(() => { s[key] = cb.checked; })); return h('label', { class: 'check' }, cb, text); };

    const modeText = { cloud: '이 계정에 저장하고 있어요. 다른 기기에서 열어도 이어서 공부할 수 있습니다.', local: '이 브라우저에만 저장하고 있어요. 기기를 바꾸거나 방문 기록을 지우면 사라지니 가끔 백업을 내보내 두세요.', memory: '저장이 막혀 있어 창을 닫으면 기록이 사라집니다. 공부를 마치면 백업을 내보내 두세요.' }[S.mode];
    const backupBox = h('div', { class: 'stack' });
    const showExport = () => {
      clear(backupBox);
      const ta = h('textarea', { id: 'backupOut', readonly: true, 'aria-label': '백업 내용' });
      ta.value = S.exportText(P);
      const msg = h('span', { class: 'small muted' });
      const copy = btn('복사', () => {
        const done = () => { msg.textContent = '복사했어요. 메모장 등에 붙여 넣어 보관하세요.'; };
        const fallback = () => { ta.focus(); ta.select(); msg.textContent = '자동 복사가 막혀 있어요. 선택된 글자를 직접 복사하세요.'; };
        try { navigator.clipboard.writeText(ta.value).then(done, fallback); } catch (e) { fallback(); }
      }, 'btn primary');
      backupBox.append(ta, h('div', { class: 'row' }, copy, msg));
    };
    const showImport = () => {
      clear(backupBox);
      const ta = h('textarea', { id: 'backupIn', 'aria-label': '백업 붙여 넣기', placeholder: '내보내기로 복사해 둔 글자를 여기에 붙여 넣으세요' });
      const msg = h('span', { class: 'small' });
      const load = btn('불러오기', () => {
        try { P = S.importText(ta.value); S.save(P); msg.textContent = '불러왔어요. 기록 ' + Object.keys(P.items).length + '문항.'; updateBar(); }
        catch (e) { msg.textContent = e.message; }
      }, 'btn primary');
      backupBox.append(ta, h('div', { class: 'row' }, load, msg));
    };
    const resetBox = h('div', { class: 'row' });
    const askReset = () => {
      clear(resetBox);
      resetBox.append(h('span', { text: '모든 풀이 기록이 지워집니다. 설정은 남아요.' }),
        btn('지우기', () => { const keep = P.settings; P = C.newProgress(); P.settings = keep; touch(); clear(resetBox); resetBox.append(h('span', { class: 'small', text: '기록을 지웠어요.' })); }, 'btn danger'),
        btn('취소', () => { clear(resetBox); resetBox.append(resetBtn); }));
    };
    const resetBtn = btn('기록 모두 지우기', askReset, 'btn danger');
    resetBox.append(resetBtn);

    $view.append(h('h1', { class: 'h2', text: '설정 · 백업' }),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '시험 날짜' }),
        h('p', { class: 'small muted', text: '넣어 두면 D-day가 표시되고, 복습 간격이 남은 날짜의 절반을 넘지 않게 줄어듭니다. 시험 전날에는 아직 불안한 문항이 모두 다시 나와요.' }),
        h('div', { class: 'row' }, date, btn('지우기', () => { date.value = ''; s.examDate = null; touch(); updateBar(); }, 'btn ghost'))),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '공부 범위' }), h('p', { class: 'small muted', text: '시험 범위에 없는 범주는 꺼 두세요. 출제와 보기에서 빠집니다.' }), h('div', { class: 'row' }, catBoxes), catMsg),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '문제 수' }),
        h('div', { class: 'row' }, h('label', { for: 'newPerDay', text: '하루 새 문항' }), perDay),
        h('div', { class: 'row' }, h('span', { text: '한 문제씩 보기 수' }), choiceSeg)),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '매칭 세트' }),
        h('div', { class: 'row' }, h('label', { for: 'setN', text: '논제' }), nSel, h('label', { for: 'setM', text: '보기' }), mSel),
        toggle('reuse', '같은 보기를 여러 번 쓸 수 있게'), toggle('retry', '채점 후 틀린 것만 한 번 더 고르기'), toggle('timer', '걸린 시간 표시')),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '저장 · 백업' }), h('p', { class: 'small', text: modeText }),
        h('div', { class: 'row' }, btn('백업 내보내기', showExport), btn('백업 가져오기', showImport)), backupBox),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h3', text: '기록 초기화' }), resetBox));
  }

  // ───────────────────────── router
  const ROUTES = { home, cards, drill, review, match, exam, report, duel, contrast, formal, summary, notecheck, speed, basics, prefs };
  function routeName() { return (location.hash || '').replace(/^#/, ''); }
  function render() {
    for (const f of leaveFns) { try { f(); } catch (e) { /* ignore */ } }
    leaveFns = [];
    KEY = null;
    closeBubble();
    closeSheet();
    clear($view);
    (ROUTES[routeName()] || home)();
    updateBar();
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
  render();
  S.connectCloud(remote => { P = remote; if (['', 'home', 'report', 'prefs'].includes(routeName())) render(); else updateBar(); });
})();
