/* IELTS 挖空记词 · 交互逻辑
 * 纯前端、无需构建，数据与进度都在本机。
 */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const WORDS = window.IELTS_WORDS || [];
  const TOPICS = window.IELTS_TOPICS || [];
  const KEY = 'ielts-blank.v1';
  const DAY = 86400000;
  const BOX_DAYS = [0.05, 1, 2, 4, 8, 16, 32]; // 每个记忆等级对应的复习间隔（天）
  const SESSION_SIZE = 10;
  const DAILY_GOAL = 20;
  const MASTER_BOX = 4; // 达到该等级视为「已掌握」

  /* ---------------- 小工具 ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const surface = (item) => item.f || item.w;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- 本地存储 ---------------- */
  function blankStore() {
    return {
      v: 1,
      words: {},
      total: { answered: 0, correct: 0, bestStreak: 0 },
      day: { date: dayKey(), answered: 0, correct: 0 },
      settings: { sound: true, autoSpeak: false }
    };
  }

  function loadStore() {
    const base = blankStore();
    let raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return base;
    try {
      const p = JSON.parse(raw);
      base.words = p.words && typeof p.words === 'object' ? p.words : {};
      if (p.total) Object.assign(base.total, p.total);
      if (p.day) Object.assign(base.day, p.day);
      if (p.settings) Object.assign(base.settings, p.settings);
    } catch (e) { /* 损坏的数据直接忽略 */ }
    return base;
  }

  let store = loadStore();
  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      try { window.localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
    }, 120);
  }
  function saveNow() {
    try { window.localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }

  function ensureDay() {
    const k = dayKey();
    if (!store.day || store.day.date !== k) store.day = { date: k, answered: 0, correct: 0 };
    return store.day;
  }

  /* ---------------- 记忆模型 ---------------- */
  function recordOf(word) {
    return store.words[word] || null;
  }

  function levelOf(word) {
    const r = recordOf(word);
    return r && r.seen ? r.b : 0;
  }

  function levelName(box, seen) {
    if (!seen) return '新词';
    if (box >= 6) return '已掌握';
    if (box >= MASTER_BOX) return '熟练';
    if (box >= 2) return '巩固中';
    return '学习中';
  }

  function touchWord(item, ok) {
    const now = Date.now();
    let r = recordOf(item.w);
    if (!r) { r = store.words[item.w] = { b: 0, r: 0, w: 0, seen: 0, due: 0 }; }
    r.seen = now;
    if (ok) {
      r.b = Math.min(6, r.b + 1);
      r.r += 1;
      r.due = now + BOX_DAYS[r.b] * DAY;
    } else {
      r.b = Math.max(0, r.b - 1);
      r.w += 1;
      r.due = now + 10 * 60000; // 答错 10 分钟后再出现
    }
    return r;
  }

  function counts() {
    const now = Date.now();
    const out = { due: 0, fresh: 0, mastered: 0, learning: 0, wrong: 0, seen: 0, total: WORDS.length, boxes: [0, 0, 0, 0, 0, 0, 0] };
    for (const it of WORDS) {
      const r = recordOf(it.w);
      if (!r || !r.seen) { out.fresh += 1; out.boxes[0] += 1; continue; }
      out.seen += 1;
      out.boxes[Math.min(6, Math.max(0, r.b))] += 1;
      if (r.b >= MASTER_BOX) out.mastered += 1; else out.learning += 1;
      if (r.due <= now && r.b < 6) out.due += 1;
      if (r.w > 0) out.wrong += 1;
    }
    return out;
  }

  /* ---------------- 声音 & 朗读 ---------------- */
  let audioCtx = null;
  function tone(freq, delay, dur, type, vol) {
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }
  function playSound(ok) {
    if (!store.settings.sound) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      if (!audioCtx) audioCtx = new Ctor();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (ok) {
        tone(659.25, 0, 0.12, 'sine', 0.06);
        tone(987.77, 0.09, 0.18, 'sine', 0.05);
      } else {
        tone(196, 0, 0.18, 'triangle', 0.05);
        tone(146.83, 0.1, 0.24, 'triangle', 0.045);
      }
    } catch (e) { /* 静默失败 */ }
  }

  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    return voices.find((v) => /en[-_]GB/i.test(v.lang) && /female|sonia|libby|hazel|serena/i.test(v.name))
      || voices.find((v) => /en[-_]GB/i.test(v.lang))
      || voices.find((v) => /^en/i.test(v.lang))
      || null;
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 0.92;
      const v = pickVoice();
      if (v) u.voice = v;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* 静默失败 */ }
  }

  /* ---------------- 会话 ---------------- */
  let session = null;
  let mode = 'review';
  let topic = '';
  let view = 'practice';
  let currentPool = [];

  function poolFor(t) {
    return t ? WORDS.filter((w) => w.t === t) : WORDS.slice();
  }

  function buildQueue(forMode, forTopic) {
    const items = poolFor(forTopic);
    const now = Date.now();

    if (forMode === 'random') return shuffle(items).slice(0, SESSION_SIZE);

    if (forMode === 'wrong') {
      const list = items.filter((it) => {
        const r = recordOf(it.w);
        return r && r.w > 0 && r.b < MASTER_BOX;
      }).sort((a, b) => {
        const ra = recordOf(a.w), rb = recordOf(b.w);
        return (rb.w - ra.w) || (ra.due - rb.due);
      });
      return list.slice(0, SESSION_SIZE);
    }

    // review：先到期，再新词，最后补最近到期的
    const due = [], fresh = [], later = [];
    for (const it of items) {
      const r = recordOf(it.w);
      if (!r || !r.seen) fresh.push(it);
      else if (r.b >= 6) later.push(it);
      else if (r.due <= now) due.push(it);
      else later.push(it);
    }
    due.sort((a, b) => recordOf(a.w).due - recordOf(b.w).due);
    later.sort((a, b) => (recordOf(a.w) ? recordOf(a.w).due : 0) - (recordOf(b.w) ? recordOf(b.w).due : 0));
    shuffle(fresh);
    const out = due.slice(0, SESSION_SIZE);
    out.push.apply(out, fresh.slice(0, SESSION_SIZE - out.length));
    if (out.length < SESSION_SIZE) out.push.apply(out, later.slice(0, SESSION_SIZE - out.length));
    return out;
  }

  function newSession(forMode, forTopic) {
    if (forMode) mode = forMode;
    if (forTopic !== undefined) topic = forTopic;
    session = {
      mode: mode,
      topic: topic,
      queue: buildQueue(mode, topic),
      index: 0,
      answered: 0,
      correct: 0,
      streak: 0,
      wrongs: [],
      start: Date.now(),
      current: null
    };
    updateStreak();
    renderMeta();
    renderQuestion();
  }

  /* ---------------- 练习渲染 ---------------- */
  const host = $('#card-host');

  function renderMeta() {
    const el = $('#session-meta');
    if (!el || !session) return;
    const c = counts();
    const day = ensureDay();
    el.innerHTML =
      '<span class="meta-item">今日 <b>' + day.answered + '</b> / ' + DAILY_GOAL + ' 题</span>' +
      '<span class="meta-dot" aria-hidden="true"></span>' +
      '<span class="meta-item">待复习 <b>' + c.due + '</b></span>' +
      '<span class="meta-dot" aria-hidden="true"></span>' +
      '<span class="meta-item">已掌握 <b>' + c.mastered + '</b> / ' + c.total + '</span>';
  }

  function renderQuestion() {
    if (!session) return;
    if (!session.queue.length) return renderEmpty();
    if (session.index >= session.queue.length) return renderSummary();

    const item = session.queue[session.index];
    const rec = recordOf(item.w);
    const seen = !!(rec && rec.seen);
    const box = seen ? rec.b : 0;
    const parts = item.s.split(/_{2,}/);
    const cap = /^\s*_{2,}/.test(item.s) || /[.!?]\s+_{2,}/.test(item.s);
    const answerLabel = cap ? capFirst(surface(item)) : surface(item);
    const options = shuffle([answerLabel].concat(item.o.map((o) => (cap ? capFirst(o) : o))));

    session.current = { item: item, answered: false, options: options, answerLabel: answerLabel, cap: cap };
    const total = session.queue.length;

    host.innerHTML =
      '<div class="progress-row">' +
        '<div class="track"><i style="width:' + Math.round((session.answered / total) * 100) + '%"></i></div>' +
        '<span class="progress-count">' + (session.index + 1) + ' / ' + total + '</span>' +
      '</div>' +
      '<article class="card" id="qcard" tabindex="-1">' +
        '<div class="card-head">' +
          '<span class="chip chip-topic">' + esc(item.t) + '</span>' +
          '<span class="chip chip-level" data-level="' + box + '">' + levelName(box, seen) + '</span>' +
          '<span class="card-hint">语境填空</span>' +
        '</div>' +
        '<p class="sentence" id="sentence" lang="en">' +
          esc(parts[0]) +
          '<span class="blank" id="blank" aria-label="空格"></span>' +
          esc(parts.slice(1).join(' ')) +
        '</p>' +
        '<div class="options" id="options" role="group" aria-label="选项">' +
          options.map((o, i) =>
            '<button type="button" class="option" data-i="' + i + '">' +
              '<span class="key" aria-hidden="true">' + (i + 1) + '</span>' +
              '<span class="word" lang="en">' + esc(o) + '</span>' +
            '</button>'
          ).join('') +
        '</div>' +
        '<div class="feedback" id="feedback" role="status" aria-live="polite" hidden></div>' +
        '<div class="card-foot">' +
          '<button type="button" class="link-btn" id="btn-reveal">不会，看答案</button>' +
          '<button type="button" class="primary-btn" id="btn-next" disabled>下一题 <kbd>Enter</kbd></button>' +
        '</div>' +
      '</article>';

    const card = $('#qcard');
    if (card) card.focus({ preventScroll: true });
  }

  function renderSummary() {
    const total = session.queue.length;
    const correct = session.correct;
    const acc = total ? Math.round((correct / total) * 100) : 0;
    const msg = acc === 100 ? '完美一轮，词汇记忆很稳。'
      : acc >= 80 ? '很棒的一轮，保持这个节奏。'
      : acc >= 60 ? '还不错，把错词再过一遍更牢。'
      : '别急，同一个词在不同语境里多遇见几次就记住了。';
    const wrongs = session.wrongs;

    host.innerHTML =
      '<article class="card summary">' +
        '<div class="summary-emoji" aria-hidden="true">' + (acc >= 80 ? '🎉' : acc >= 60 ? '💪' : '📝') + '</div>' +
        '<h2 class="summary-title">本轮完成</h2>' +
        '<p class="summary-score"><b>' + correct + '</b> / ' + total + ' <span>正确 · ' + acc + '%</span></p>' +
        '<p class="summary-msg">' + msg + '</p>' +
        (wrongs.length
          ? '<div class="summary-wrong"><h3>需要再看一眼</h3><div class="wrong-list">' +
              wrongs.map((it) => '<span class="wrong-chip"><b>' + esc(surface(it)) + '</b><span>' + esc(it.cn) + '</span></span>').join('') +
            '</div></div>'
          : '') +
        '<div class="summary-actions">' +
          '<button type="button" class="primary-btn" data-action="again">再来一轮</button>' +
          (wrongs.length ? '<button type="button" class="ghost-btn" data-action="wrong">只练错词</button>' : '') +
          '<button type="button" class="ghost-btn" data-action="random">随机 10 题</button>' +
        '</div>' +
      '</article>';

    session.current = null;
    renderMeta();
    const btn = $('[data-action="again"]');
    if (btn) btn.focus({ preventScroll: true });
  }

  function renderEmpty() {
    const why = mode === 'wrong'
      ? '错词本还是空的 —— 先随机练几轮，答错的词会自动收进来。'
      : '这个词库的复习已经清空，可以随机练习，或等下一次复习到期。';
    host.innerHTML =
      '<article class="card empty">' +
        '<div class="summary-emoji" aria-hidden="true">🌱</div>' +
        '<h2 class="summary-title">暂时没有待练的题目</h2>' +
        '<p class="summary-msg">' + why + '</p>' +
        '<div class="summary-actions">' +
          '<button type="button" class="primary-btn" data-action="random">随机练 10 题</button>' +
          '<button type="button" class="ghost-btn" data-action="review">回到今日复习</button>' +
        '</div>' +
      '</article>';
    session.current = null;
    renderMeta();
  }

  function sentenceWithAnswer(item) {
    const parts = item.s.split(/_{2,}/);
    const cap = /^\s*_{2,}/.test(item.s) || /[.!?]\s+_{2,}/.test(item.s);
    const label = cap ? capFirst(surface(item)) : surface(item);
    return esc(parts[0]) + '<mark>' + esc(label) + '</mark>' + esc(parts.slice(1).join(' '));
  }

  function feedbackHTML(item, ok, chosen) {
    return (
      '<div class="fb ' + (ok ? 'fb-ok' : 'fb-bad') + '">' +
        '<div class="fb-status">' +
          (ok ? '✓ 答对了' : (chosen ? '✗ 你选的是「' + esc(chosen) + '」' : '✗ 正确答案')) +
        '</div>' +
        '<div class="fb-word-row">' +
          '<span class="fb-word" lang="en">' + esc(surface(item)) + '</span>' +
          '<span class="fb-ipa">' + esc(item.ipa || '') + '</span>' +
          '<span class="fb-pos">' + esc(item.p) + '</span>' +
          '<button type="button" class="speak-btn" data-speak="word" title="朗读单词" aria-label="朗读单词">🔈</button>' +
        '</div>' +
        '<div class="fb-cn">' + esc(item.cn) + '</div>' +
        '<div class="fb-en">' + esc(item.en) + '</div>' +
        (item.note ? '<div class="fb-note"><b>搭配</b>' + esc(item.note) + '</div>' : '') +
        '<div class="fb-sentence"><span class="fb-sentence-text" lang="en">' + sentenceWithAnswer(item) + '</span>' +
          '<button type="button" class="speak-btn" data-speak="sentence" title="朗读整句" aria-label="朗读整句">🔈</button>' +
        '</div>' +
      '</div>'
    );
  }

  function answer(index) {
    const cur = session && session.current;
    if (!cur || cur.answered) return;
    const chosen = cur.options[index];
    if (chosen == null) return;
    const ok = chosen.toLowerCase() === cur.answerLabel.toLowerCase();
    commit(cur, ok, chosen);
  }

  function reveal() {
    const cur = session && session.current;
    if (!cur || cur.answered) return;
    commit(cur, false, null);
  }

  function commit(cur, ok, chosen) {
    cur.answered = true;
    const item = cur.item;

    touchWord(item, ok);
    session.answered += 1;
    if (ok) {
      session.correct += 1;
      session.streak += 1;
      if (session.streak > store.total.bestStreak) store.total.bestStreak = session.streak;
    } else {
      session.streak = 0;
      session.wrongs.push(item);
    }
    const day = ensureDay();
    day.answered += 1;
    if (ok) day.correct += 1;
    store.total.answered += 1;
    if (ok) store.total.correct += 1;
    save();

    // 选项状态
    $$('.option', host).forEach((btn) => {
      const label = btn.querySelector('.word').textContent;
      const isAnswer = label.toLowerCase() === cur.answerLabel.toLowerCase();
      const isChosen = chosen != null && label === chosen;
      btn.disabled = true;
      if (isAnswer) btn.classList.add('is-correct');
      else if (isChosen) btn.classList.add('is-wrong');
      else btn.classList.add('is-dim');
    });

    // 空格填入所选词
    const blank = $('#blank');
    if (blank) {
      blank.textContent = chosen == null ? cur.answerLabel : chosen;
      blank.classList.add(ok ? 'is-correct' : 'is-wrong');
      if (chosen == null) {
        blank.classList.remove('is-wrong');
        blank.classList.add('is-revealed');
      }
    }

    const fb = $('#feedback');
    if (fb) {
      fb.innerHTML = feedbackHTML(item, ok, chosen);
      fb.hidden = false;
    }

    // 记忆等级 / 进度 / 当日统计即时更新
    const rec = recordOf(item.w);
    const levelChip = $('.chip-level');
    if (levelChip) {
      levelChip.textContent = levelName(rec.b, true);
      levelChip.dataset.level = rec.b;
    }
    const fill = $('.progress-row .track > i');
    if (fill) fill.style.width = Math.round((session.answered / session.queue.length) * 100) + '%';
    renderMeta();

    const revealBtn = $('#btn-reveal');
    if (revealBtn) revealBtn.hidden = true;
    const nextBtn = $('#btn-next');
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.innerHTML = (session.index + 1 >= session.queue.length ? '查看结果' : '下一题') + ' <kbd>Enter</kbd>';
      nextBtn.focus({ preventScroll: true });
    }

    updateStreak();
    playSound(ok);
    if (ok && store.settings.autoSpeak) speak(sentenceText(item));
  }

  function sentenceText(item) {
    const parts = item.s.split(/_{2,}/);
    return (parts[0] + surface(item) + parts.slice(1).join(' ')).replace(/\s+/g, ' ').trim();
  }

  function next() {
    if (!session || !session.current || !session.current.answered) return;
    session.index += 1;
    session.current = null;
    if (session.index >= session.queue.length) renderSummary();
    else renderQuestion();
  }

  function updateStreak() {
    const el = $('#streak b');
    if (el) el.textContent = session ? session.streak : 0;
  }

  /* ---------------- 事件 ---------------- */
  host.addEventListener('click', (e) => {
    const opt = e.target.closest('.option');
    if (opt) { answer(Number(opt.dataset.i)); return; }

    const nextBtn = e.target.closest('#btn-next');
    if (nextBtn) { next(); return; }

    const revealBtn = e.target.closest('#btn-reveal');
    if (revealBtn) { reveal(); return; }

    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const a = actionEl.dataset.action;
      if (a === 'again') newSession(session.mode);
      else if (a === 'wrong') setMode('wrong');
      else if (a === 'random') setMode('random');
      else if (a === 'review') setMode('review');
      return;
    }

    const sp = e.target.closest('[data-speak]');
    if (sp) {
      const cur = session && session.current;
      if (!cur) return;
      speak(sp.dataset.speak === 'sentence' ? sentenceText(cur.item) : surface(cur.item));
    }
  });

  $('#modes').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode');
    if (!btn) return;
    setMode(btn.dataset.mode);
  });

  function setMode(m) {
    mode = m;
    $$('.mode').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    newSession(mode);
  }

  document.addEventListener('keydown', (e) => {
    if (view !== 'practice') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const cur = session && session.current;

    if (/^[1-4]$/.test(e.key) && cur && !cur.answered) {
      e.preventDefault();
      answer(Number(e.key) - 1);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && cur && cur.answered) {
      if (e.target.closest && e.target.closest('button')) return; // 让按钮自己响应
      e.preventDefault();
      next();
    }
  });

  /* ---------------- 视图切换 ---------------- */
  const views = { practice: $('#view-practice'), stats: $('#view-stats'), library: $('#view-library') };

  function setView(name) {
    view = name;
    Object.keys(views).forEach((k) => { views[k].hidden = k !== name; });
    $$('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'stats') renderStats();
    if (name === 'library') renderLibrary();
    if (name === 'practice' && session && session.current && !session.current.answered) {
      const card = $('#qcard');
      if (card) card.focus({ preventScroll: true });
    }
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  /* ---------------- 进度页 ---------------- */
  function renderStats() {
    const c = counts();
    const day = ensureDay();
    const acc = store.total.answered ? Math.round((store.total.correct / store.total.answered) * 100) : 0;
    const dayPct = Math.min(100, Math.round((day.answered / DAILY_GOAL) * 100));

    const topics = TOPICS.map((t) => {
      const items = WORDS.filter((w) => w.t === t);
      const done = items.filter((w) => levelOf(w.w) >= MASTER_BOX).length;
      return { name: t, done: done, total: items.length };
    });

    const maxBox = Math.max(1, Math.max.apply(null, c.boxes));
    const boxRows = c.boxes.map((n, i) =>
      '<div class="box-row">' +
        '<span class="box-name">' + (i === 0 ? '新词' : i + ' 级') + '</span>' +
        '<div class="track track-sm"><i style="width:' + Math.round((n / maxBox) * 100) + '%"></i></div>' +
        '<span class="box-count">' + n + '</span>' +
      '</div>'
    ).join('');

    views.stats.innerHTML =
      '<div class="stats-grid">' +
        metric('累计作答', store.total.answered, '题') +
        metric('总正确率', acc, '%') +
        metric('已掌握', c.mastered, '/ ' + c.total) +
        metric('待复习', c.due, '词') +
      '</div>' +
      '<section class="panel">' +
        '<div class="panel-head"><h2>今日目标</h2><span>' + day.answered + ' / ' + DAILY_GOAL + ' 题 · 正确率 ' +
          (day.answered ? Math.round((day.correct / day.answered) * 100) : 0) + '%</span></div>' +
        '<div class="track"><i style="width:' + dayPct + '%"></i></div>' +
        '<p class="panel-foot">连续答对最高纪录：' + store.total.bestStreak + ' 题 · 记忆等级越高，复习间隔越长。</p>' +
      '</section>' +
      '<section class="panel">' +
        '<div class="panel-head"><h2>主题掌握度</h2><span>已掌握 / 词数</span></div>' +
        '<div class="topic-list">' +
          topics.map((t) =>
            '<div class="topic-row">' +
              '<span class="topic-name">' + esc(t.name) + '</span>' +
              '<div class="track track-sm"><i style="width:' + Math.round((t.done / t.total) * 100) + '%"></i></div>' +
              '<span class="topic-count">' + t.done + ' / ' + t.total + '</span>' +
            '</div>'
          ).join('') +
        '</div>' +
      '</section>' +
      '<section class="panel">' +
        '<div class="panel-head"><h2>记忆等级分布</h2><span>共 ' + WORDS.length + ' 词</span></div>' +
        '<div class="box-chart">' + boxRows + '</div>' +
      '</section>' +
      '<section class="panel">' +
        '<div class="panel-head"><h2>数据</h2><span>只存在这台设备的浏览器里</span></div>' +
        '<p class="panel-foot">收藏：把 index.html 加入书签即可随时打开；换设备不会同步。</p>' +
        '<button type="button" class="danger-btn" id="btn-reset">清空学习记录</button>' +
      '</section>';

    const reset = $('#btn-reset');
    if (reset) reset.addEventListener('click', () => {
      if (!window.confirm('确定清空所有学习记录吗？此操作无法撤销。')) return;
      try { window.localStorage.removeItem(KEY); } catch (e) {}
      store = blankStore();
      saveNow();
      updateStreak();
      newSession('review');
      renderStats();
    });
  }

  function metric(label, value, unit) {
    return '<div class="metric"><span class="metric-label">' + label + '</span>' +
      '<span class="metric-value">' + value + '<span class="metric-unit">' + unit + '</span></span></div>';
  }

  /* ---------------- 词库页 ---------------- */
  let libQuery = '';
  let libFilter = 'all';

  function renderLibrary() {
    views.library.innerHTML =
      '<div class="lib-tools">' +
        '<input id="lib-search" class="search" type="search" placeholder="搜索单词、释义或搭配…" autocomplete="off">' +
        '<select id="lib-filter" class="filter">' +
          '<option value="all">全部</option>' +
          '<option value="new">未学</option>' +
          '<option value="learning">学习中</option>' +
          '<option value="mastered">已掌握</option>' +
          '<option value="wrong">错过的词</option>' +
        '</select>' +
      '</div>' +
      '<p class="lib-count" id="lib-count"></p>' +
      '<div class="lib-list" id="lib-list"></div>';

    const input = $('#lib-search');
    const filter = $('#lib-filter');
    input.value = libQuery;
    filter.value = libFilter;
    input.addEventListener('input', () => { libQuery = input.value.trim(); paintLibrary(); });
    filter.addEventListener('change', () => { libFilter = filter.value; paintLibrary(); });
    paintLibrary();
  }

  function paintLibrary() {
    const q = libQuery.toLowerCase();
    const list = WORDS.filter((it) => {
      const r = recordOf(it.w);
      const box = r && r.seen ? r.b : 0;
      if (libFilter === 'new' && !(r && r.seen)) return false;
      if (libFilter === 'learning' && !(r && r.seen && r.b < MASTER_BOX)) return false;
      if (libFilter === 'mastered' && !(r && r.seen && r.b >= MASTER_BOX)) return false;
      if (libFilter === 'wrong' && !(r && r.w > 0)) return false;
      if (!q) return true;
      const hay = (it.w + ' ' + (it.f || '') + ' ' + it.cn + ' ' + it.en + ' ' + it.t + ' ' + (it.note || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    const count = $('#lib-count');
    if (count) count.textContent = '共 ' + list.length + ' 个词';

    const hostEl = $('#lib-list');
    if (!hostEl) return;

    if (!list.length) {
      hostEl.innerHTML = '<p class="lib-empty">没有匹配的单词，换个关键词试试。</p>';
      return;
    }

    hostEl.innerHTML = list.map((it) => {
      const r = recordOf(it.w);
      const seen = !!(r && r.seen);
      const box = seen ? r.b : 0;
      const dots = [1, 2, 3, 4, 5, 6].map((i) => '<i class="' + (i <= box ? 'on' : '') + '"></i>').join('');
      return '<details class="lib-item" data-word="' + esc(it.w) + '">' +
        '<summary>' +
          '<span class="lib-word" lang="en">' + esc(it.w) + '<span class="lib-pos">' + esc(it.p) + '</span></span>' +
          '<span class="lib-cn">' + esc(it.cn) + '</span>' +
          '<span class="lib-dots" aria-label="记忆等级">' + dots + '</span>' +
        '</summary>' +
        '<div class="lib-detail">' +
          '<div class="lib-en">' + esc(it.en) + '</div>' +
          '<div class="lib-sentence" lang="en">' + sentenceWithAnswer(it) + '</div>' +
          (it.note ? '<div class="fb-note"><b>搭配</b>' + esc(it.note) + '</div>' : '') +
          '<div class="lib-actions">' +
            '<button type="button" class="speak-btn" data-lib-speak="' + esc(it.w) + '">🔈 朗读单词</button>' +
            '<span class="lib-state">' + (seen ? (box >= MASTER_BOX ? '已掌握' : '等级 ' + box + ' · 答对 ' + r.r + ' / 答错 ' + r.w) : '还没练过') + '</span>' +
          '</div>' +
        '</div>' +
      '</details>';
    }).join('');

    $$('[data-lib-speak]', hostEl).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        speak(btn.dataset.libSpeak);
      });
    });
  }

  /* ---------------- 设置 ---------------- */
  function paintSettings() {
    const s = $('#toggle-sound');
    const a = $('#toggle-speak');
    if (s) {
      s.textContent = store.settings.sound ? '🔔' : '🔕';
      s.setAttribute('aria-pressed', store.settings.sound ? 'true' : 'false');
      s.title = store.settings.sound ? '音效：开' : '音效：关';
    }
    if (a) {
      a.textContent = store.settings.autoSpeak ? '🗣️' : '🤐';
      a.setAttribute('aria-pressed', store.settings.autoSpeak ? 'true' : 'false');
      a.title = store.settings.autoSpeak ? '答对后自动朗读：开' : '答对后自动朗读：关';
    }
  }

  $('#toggle-sound').addEventListener('click', () => {
    store.settings.sound = !store.settings.sound;
    saveNow();
    paintSettings();
    if (store.settings.sound) playSound(true);
  });

  $('#toggle-speak').addEventListener('click', () => {
    store.settings.autoSpeak = !store.settings.autoSpeak;
    saveNow();
    paintSettings();
    if (store.settings.autoSpeak) speak('Auto pronunciation on.');
  });

  /* ---------------- 启动 ---------------- */
  function init() {
    // 主题下拉
    const sel = $('#topic');
    if (sel) {
      TOPICS.forEach((t) => {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        if (session && session.topic === sel.value) return;
        newSession(mode, sel.value);
      });
    }

    paintSettings();
    ensureDay();
    updateStreak();

    const total = counts().total;
    const brandSub = $('#brand-sub');
    if (brandSub) brandSub.textContent = total + ' 个高频词 · 语境填空';

    setMode('review');

    if (window.speechSynthesis) {
      // 部分浏览器需要先触发一次 getVoices
      window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', () => { pickVoice(); });
    }
  }

  window.addEventListener('pagehide', saveNow);
  init();
})();
