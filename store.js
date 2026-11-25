/* 진행 기록 저장: localStorage(즉시) + Artifact db 사용자별 비공개 문서(디바운스, 직렬화).
   db를 쓸 수 없으면(로그아웃·미허용·파일로 열기) 브라우저 저장만, 그것도 막히면 메모리만 사용한다. */
(function (g) {
  const FT = (g.FT = g.FT || {});
  const KEY = 'ft-progress-v1';
  let mode = 'memory';
  let localOk = false;
  let docRef = null;
  let debounce = null;
  let pending = null;
  let chain = Promise.resolve();
  let latest = null;
  const listeners = [];

  function setMode(m) { mode = m; for (const f of listeners) f(m); }

  function readLocal() {
    try { const s = g.localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function writeLocal(p) {
    try { g.localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
  }
  function probeLocal() {
    try { g.localStorage.setItem(KEY + '-probe', '1'); g.localStorage.removeItem(KEY + '-probe'); return true; } catch (e) { return false; }
  }
  function timeout(promise, ms) {
    return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  }

  function init() {
    localOk = probeLocal();
    setMode(localOk ? 'local' : 'memory');
    latest = FT.core.mergeProgress(readLocal(), null) || FT.core.newProgress();
    return latest;
  }

  // onRemoteNewer(progress) is called only when the cloud copy is newer than what is on screen.
  async function connectCloud(onRemoteNewer) {
    if (!g.claude || typeof g.claude.use !== 'function') return;
    try {
      const pair = await timeout(Promise.all([g.claude.use('db'), g.claude.use('user')]), 10000);
      if (!pair || !pair[0] || !pair[1]) return;
      const uid = await pair[1].id();
      if (!uid) return;
      const ref = pair[0].doc('data/users/' + uid + '/progress');
      const snap = await timeout(ref.get(), 10000);
      if (!snap) return;
      docRef = ref;
      setMode('cloud');
      const body = snap.exists ? snap.data() : null;
      let remote = null;
      try { remote = body && typeof body.json === 'string' ? JSON.parse(body.json) : null; } catch (e) { remote = null; }
      if (remote && (remote.updatedAt || 0) > (latest.updatedAt || 0)) {
        latest = FT.core.mergeProgress(remote, null);
        writeLocal(latest);
        onRemoteNewer(latest);
      } else if (!remote || (latest.updatedAt || 0) > (remote.updatedAt || 0)) {
        queueCloud(latest);
      }
    } catch (e) { /* 클라우드를 못 쓰면 로컬 모드 유지 */ }
  }

  function queueCloud(p) {
    if (!docRef) return;
    pending = p;
    chain = chain.then(async () => {
      if (!pending || !docRef) return;
      const body = { json: JSON.stringify(pending), updatedAt: pending.updatedAt || 0 };
      pending = null;
      try { await docRef.set(body); } catch (e) { docRef = null; setMode(localOk ? 'local' : 'memory'); }
    });
  }

  function save(p) {
    latest = p;
    if (localOk && !writeLocal(p)) { localOk = false; if (!docRef) setMode('memory'); }
    if (!docRef) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => queueCloud(latest), 1500);
  }

  function flush() {
    if (docRef && latest) { clearTimeout(debounce); queueCloud(latest); }
  }

  function exportText(p) { return JSON.stringify(p); }

  function importText(text) {
    let p;
    try { p = JSON.parse(String(text).trim()); } catch (e) { throw new Error('붙여 넣은 내용이 백업 형식(JSON)이 아닙니다. 내보내기로 복사한 글자를 빠짐없이 붙여 넣어 주세요.'); }
    if (!p || p.v !== 1 || typeof p.items !== 'object') throw new Error('이 앱의 백업이 아닙니다. 내보내기 화면에서 복사한 내용인지 확인해 주세요.');
    p = FT.core.mergeProgress(p, null);
    p.updatedAt = Date.now();
    return p;
  }

  function onMode(f) { listeners.push(f); f(mode); }

  if (g.addEventListener) g.addEventListener('visibilitychange', () => { if (g.document && g.document.visibilityState === 'hidden') flush(); });

  FT.store = { init, connectCloud, save, flush, exportText, importText, onMode, get mode() { return mode; } };
})(typeof window !== 'undefined' ? window : globalThis);
