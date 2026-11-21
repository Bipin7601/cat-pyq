/* Timed test screen (#test-<paper>-<kind>) and the review screen (#review-<paper>-<kind>).
   Uses window.Core (attempt engine) and window.App (shared rendering + storage from index.html).
   Attempts from Core are treated as immutable: every change builds a new object. */
(function () {
  "use strict";
  const KIND_LABEL = {full: "Complete test", VARC: "VARC test", DILR: "DILR test", QA: "QA test"};
  const STATE_LABEL = {"answered": "answered", "not-answered": "not answered", "marked": "marked for review",
    "answered-marked": "answered and marked for review", "not-visited": "not visited"};
  const LEGEND = [["answered", "Answered"], ["not-answered", "Not answered"], ["marked", "Marked for review"],
    ["answered-marked", "Answered & marked"], ["not-visited", "Not visited"]];
  const ROUTE = /^(test|review)-(\d{4}-\d)-(full|VARC|DILR|QA)$/;
  const WARN_MS = 5 * 60 * 1000;

  // S: the screen's state while a test is shown
  // {paper, kind, key, a (attempt), sec, qs (section questions), units (id -> unit), shownSet, confirming}
  let S = null;
  const A = () => window.App;
  const appEl = () => document.getElementById("app");
  const $ = id => document.getElementById(id);
  const attemptKey = (p, k) => `catpyq.attempt.${p}.${k}`;
  const resultKey = (p, k) => `catpyq.result.${p}.${k}`;
  const active = () => !!(S && $("tscreen"));

  function fmt(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function validAttempt(a, paper, kind) {
    return !!(a && a.paper === paper && a.kind === kind && Array.isArray(a.sections) && a.sections.length &&
      typeof a.deadline === "number" && typeof a.secIndex === "number" && Array.isArray(a.submittedAt) &&
      a.answers && a.marked && a.visited);
  }
  function go(hash) {
    if (location.hash === "#" + hash) A().route(); else location.hash = hash;
  }
  function title(paper, kind) { return `${A().paperLabel(paper)} \u00b7 ${KIND_LABEL[kind]}`; }
  function startButton(paper, kind, label) {
    return `<button type="button" class="btn primary" data-act="start-test" data-paper="${paper}" data-kind="${kind}">${label}</button>`;
  }
  function panel(inner) {
    appEl().innerHTML = `<div class="tscreen t-panel" id="tscreen-empty"><div class="empty">${inner}</div></div>`;
  }

  /* ---------- starting / resuming ---------- */
  function begin(paper, kind) {
    A().store.set(attemptKey(paper, kind), Core.createAttempt(paper, kind, Date.now()));
    go(`test-${paper}-${kind}`);
  }
  function startTest(paper, kind) {
    if (!KIND_LABEL[kind] || !/^\d{4}-\d$/.test(paper || "")) return;
    const saved = A().store.get(attemptKey(paper, kind), null);
    if (!validAttempt(saved, paper, kind)) { begin(paper, kind); return; }
    showChoice(paper, kind, Core.applyTime(saved, Date.now()));
  }
  function closeModal() { document.querySelectorAll(".t-modal").forEach(m => m.remove()); }
  function showChoice(paper, kind, a) {
    closeModal();
    const esc = A().esc, data = `data-paper="${paper}" data-kind="${kind}"`;
    const left = a.finished ? "Time is up" : `${a.sections[a.secIndex]}, ${fmt(Core.remainingMs(a, Date.now()))} left`;
    const m = document.createElement("div");
    m.className = "t-modal";
    m.innerHTML = `<div class="t-modal-box" role="dialog" aria-modal="true" aria-labelledby="t-modal-h">
      <h3 id="t-modal-h">You have this test in progress</h3>
      <p>${esc(title(paper, kind))}. ${a.finished ? "Its time has run out; resume to see the result." : "The clock keeps running while you are away."}</p>
      <div class="t-modal-actions">
        <button type="button" class="btn primary" data-act="t-resume" ${data}>Resume \u00b7 ${esc(left)}</button>
        <button type="button" class="btn danger" data-act="t-restart" ${data}>Start over</button>
        <button type="button" class="btn" data-act="t-cancel">Cancel</button>
      </div></div>`;
    appEl().appendChild(m);
    m.querySelector("[data-act=t-resume]").focus();
  }

  /* ---------- state changes ---------- */
  function save() { A().store.set(S.key, S.a); }
  function curQ() { return S.qs.find(q => q.id === S.a.current); }
  function visit(qid) {
    S.a = Object.assign({}, S.a, {current: qid, visited: Object.assign({}, S.a.visited, {[qid]: true})});
  }
  function enterSection() {
    S.sec = S.a.sections[S.a.secIndex];
    S.qs = Core.sectionQuestions(A().items, S.paper, S.sec);
    S.confirming = false;
    S.shownSet = null;
    const cur = curQ() || S.qs[0];
    if (cur) visit(cur.id);
  }
  function setAnswer(v) {
    const q = curQ(); if (!q) return;
    const answers = Object.assign({}, S.a.answers);
    if (v === undefined || v === "") delete answers[q.id]; else answers[q.id] = v;
    S.a = Object.assign({}, S.a, {answers});
    save(); syncAnswerUI();
  }
  function toggleMark() {
    const q = curQ(); if (!q) return;
    const marked = Object.assign({}, S.a.marked);
    if (marked[q.id]) delete marked[q.id]; else marked[q.id] = true;
    S.a = Object.assign({}, S.a, {marked});
    save(); syncAnswerUI();
  }
  function move(i) {
    if (i < 0 || i >= S.qs.length) return;
    visit(S.qs[i].id);
    save(); fillQuestion(); refreshSide();
  }
  function finish(a) {
    const bySection = {};
    a.sections.forEach(sec => { bySection[sec] = Core.sectionQuestions(A().items, a.paper, sec); });
    A().store.set(resultKey(a.paper, a.kind), {attempt: a, score: Core.scoreAttempt(a, bySection), finishedAt: Date.now()});
    A().store.del(attemptKey(a.paper, a.kind));
    S = null;
    location.replace(`#review-${a.paper}-${a.kind}`);
  }
  // Applies the clock. Returns true when the section changed (screen repainted) or the test finished.
  function syncTime() {
    const next = Core.applyTime(S.a, Date.now());
    if (next.secIndex === S.a.secIndex && next.finished === S.a.finished) return false;
    S.a = next;
    if (next.finished) { finish(next); return true; }
    enterSection(); save(); paint();
    return true;
  }
  function submit() {
    S.a = Core.submitSection(S.a, Date.now());
    if (S.a.finished) { finish(S.a); return; }
    enterSection(); save(); paint();
    window.scrollTo(0, 0);
  }
  function commitTita(input) {
    if (!active() || !input || input.id !== "t-tita") return;
    if (syncTime()) return;
    const q = curQ(), v = input.value.trim();
    if (!q || v === String(S.a.answers[q.id] ?? "")) return;
    setAnswer(v);
  }

  /* ---------- rendering ---------- */
  function paint() {
    const a = S.a, esc = A().esc, ms = Core.remainingMs(a, Date.now());
    appEl().innerHTML = `<div class="tscreen" id="tscreen">
      <header class="t-head">
        <div class="t-title"><span class="eyebrow">Timed test</span><b>${esc(A().paperLabel(S.paper))}</b> \u00b7 ${KIND_LABEL[S.kind]}</div>
        <ol class="t-strip" aria-label="Sections">${a.sections.map((s, i) => {
          const cls = i < a.secIndex ? "done" : i === a.secIndex ? "active" : "";
          return `<li data-sec="${s}" class="${cls}"${i === a.secIndex ? ' aria-current="step"' : ""}><span>${s}</span></li>`;
        }).join("")}</ol>
        <div class="t-timer${ms < WARN_MS ? " warn" : ""}" id="t-timer" role="timer" aria-label="Time left in ${S.sec}">${fmt(ms)}</div>
      </header>${A().store.persistent ? "" : `
      <p class="t-nosave" role="status">This browser can\u2019t save progress, so this test won\u2019t survive a refresh.</p>`}
      <div class="t-body"><div class="t-main" id="t-main"></div><aside class="t-side" id="t-side" aria-label="Question palette"></aside></div>
    </div>`;
    const root = $("tscreen");
    root.addEventListener("change", ev => commitTita(ev.target));
    root.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && ev.target.id === "t-tita") { ev.preventDefault(); commitTita(ev.target); }
    });
    buildSide(); fillQuestion();
  }
  function fillQuestion() {
    const main = $("t-main"), q = curQ();
    if (!q) {
      main.className = "t-main";
      main.innerHTML = `<section class="t-q"><p class="empty-note">This section has no questions loaded. Submit it to continue.</p></section>`;
      return;
    }
    const u = A().items.find(x => x.id === q.unitId) || q;
    const isSet = u.kind === "set";
    if (!isSet || S.shownSet !== u.id) {
      main.className = "t-main" + (isSet ? " has-dir" : "");
      main.innerHTML = (isSet ? `<section class="t-dir" id="t-dir" aria-label="Directions">
          <div class="eyebrow">Directions \u00b7 questions ${u.questions.map(x => S.qs.findIndex(y => y.id === x.id) + 1).filter(Boolean).join(", ")}</div>
          ${A().directionsHtml(u)}</section>` : "") + `<section class="t-q" id="t-q"></section>`;
      S.shownSet = isSet ? u.id : null;
      const dir = $("t-dir");
      if (dir) { A().observeImgs(dir); A().typeset(dir); }
    }
    const box = $("t-q");
    box.innerHTML = questionHtml(q, u);
    A().observeImgs(box); A().typeset(box);
  }
  function questionHtml(q, u) {
    const esc = A().esc, L = A().LETTERS, i = S.qs.indexOf(q), last = i === S.qs.length - 1;
    const v = S.a.answers[q.id], tita = q.type === "TITA";
    let h = `<div class="t-qhead"><b>Question ${i + 1} of ${S.qs.length}</b><span class="chip">${tita ? "TITA" : "MCQ"}</span>${q.n ? `<span class="src">Q${esc(q.n)} in the paper</span>` : ""}</div>`;
    h += A().stemHtml(q, u);
    if (tita) {
      h += `<div class="t-tita"><input type="text" id="t-tita" autocomplete="off" spellcheck="false" placeholder="Type your answer"
        value="${esc(v ?? "")}" aria-label="Your answer"><span class="src">Saved when you press Enter or leave the box</span></div>`;
    } else {
      const {n, compact} = A().optionLayout(q);
      h += `<ol class="${compact ? "optrow" : "opts"} t-opts">${Array.from({length: n}, (_, k) => {
        const on = v !== undefined && Number(v) === k;
        return `<li><button type="button" class="opt${on ? " chosen" : ""}" data-act="t-pick" data-v="${k}" aria-pressed="${on}" aria-label="Option ${L[k]}"><span class="k">${L[k]}</span>${A().optionBodyHtml(q, u, k)}</button></li>`;
      }).join("")}</ol>`;
    }
    const mk = !!S.a.marked[q.id];
    h += `<div class="t-actions">
      <button type="button" class="btn small" data-act="t-mark" aria-pressed="${mk}">${mk ? "Unmark review" : "Mark for review"}</button>
      <button type="button" class="btn small" data-act="t-clear">Clear response</button>
      <span class="t-gap"></span>
      <button type="button" class="btn small" data-act="t-prev"${i <= 0 ? " disabled" : ""}>\u25c0 Previous</button>
      <button type="button" class="btn small primary" data-act="t-next"${last ? " disabled" : ""}>Next \u25b6</button></div>`;
    return h;
  }
  function syncAnswerUI() {
    const q = curQ(); if (!q) return;
    const v = S.a.answers[q.id];
    document.querySelectorAll("#t-q [data-act=t-pick]").forEach(b => {
      const on = v !== undefined && Number(v) === Number(b.dataset.v);
      b.classList.toggle("chosen", on); b.setAttribute("aria-pressed", String(on));
    });
    const inp = $("t-tita");
    if (inp && inp.value.trim() !== String(v ?? "")) inp.value = v ?? "";
    const mk = !!S.a.marked[q.id], mb = document.querySelector("#t-q [data-act=t-mark]");
    if (mb) { mb.textContent = mk ? "Unmark review" : "Mark for review"; mb.setAttribute("aria-pressed", String(mk)); }
    refreshSide();
  }
  // The sidebar is built once per paint and then updated in place: a TITA answer is committed on
  // blur (between mousedown and click), so replacing the buttons there would swallow that click.
  function buildSide() {
    const btns = S.qs.map((q, i) => `<button type="button" class="pal" data-act="t-jump" data-i="${i}">${i + 1}</button>`).join("");
    $("t-side").innerHTML = `<div class="eyebrow">${S.sec} \u00b7 ${S.qs.length} questions</div>
      <div class="t-pal" id="t-palette" role="group" aria-label="Questions in ${S.sec}">${btns}</div>
      <ul class="t-legend">${LEGEND.map(([k, l]) => `<li><span class="pal ${k}" aria-hidden="true"></span>${l}<b data-k="${k}">0</b></li>`).join("")}</ul>
      <div id="t-submitbox"></div>`;
    refreshSide(); fillSubmit();
  }
  function refreshSide() {
    const a = S.a, counts = {};
    document.querySelectorAll("#t-palette button").forEach(b => {
      const q = S.qs[Number(b.dataset.i)], st = Core.paletteState(a, q.id), cur = q.id === a.current;
      counts[st] = (counts[st] || 0) + 1;
      b.className = `pal ${st}${cur ? " cur" : ""}`;
      b.dataset.state = st;
      b.setAttribute("aria-label", `Question ${Number(b.dataset.i) + 1}, ${STATE_LABEL[st]}`);
      if (cur) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".t-legend b[data-k]").forEach(b => { b.textContent = counts[b.dataset.k] || 0; });
  }
  function fillSubmit() {
    const last = S.a.secIndex >= S.a.sections.length - 1;
    $("t-submitbox").innerHTML = S.confirming
      ? `<div class="t-confirm" role="alertdialog" aria-label="Confirm submit"><p>Submit ${S.sec}? You can't come back to it.${last ? " This ends the test." : ""}</p>
          <div><button type="button" class="btn primary small" data-act="t-submit-yes">Submit</button>
          <button type="button" class="btn small" data-act="t-submit-no">Keep working</button></div></div>`
      : `<button type="button" class="btn primary t-submit" data-act="t-submit">Submit section</button>`;
    if (S.confirming) { const y = document.querySelector("[data-act=t-submit-yes]"); y && y.focus(); }
  }
  function updateTimer() {
    const t = $("t-timer"); if (!t) return;
    const ms = Core.remainingMs(S.a, Date.now());
    t.textContent = fmt(ms);
    t.classList.toggle("warn", ms < WARN_MS);
  }

  /* ---------- review (#review-<paper>-<kind>) ---------- */
  const SECS = ["VARC", "DILR", "QA"];
  const FILTERS = [["all", "All"], ["correct", "Correct"], ["wrong", "Wrong"], ["unanswered", "Unanswered"]];
  const num = v => (typeof v === "number" && isFinite(v) ? v : null);
  // time used per section, chained from startedAt / submittedAt, capped at the section length
  function sectionTimes(at) {
    const sub = Array.isArray(at.submittedAt) ? at.submittedAt : [];
    return (at.sections || []).map((_, i) => {
      const from = i === 0 ? at.startedAt : sub[i - 1], to = sub[i];
      return num(from) !== null && num(to) !== null ? Math.min(Math.max(0, to - from), Core.SECTION_MS) : null;
    });
  }
  // correct / attempted, formatted like the practice tally
  function accuracy(x) { return x.attempted > 0 ? Math.round(x.correct / x.attempted * 100) + "%" : "\u2014"; }
  function validResult(r, paper, kind) {
    const at = r && r.attempt, sc = r && r.score;
    return !!(at && sc && at.paper === paper && at.kind === kind && at.answers && typeof at.answers === "object" &&
      Array.isArray(at.sections) && at.sections.length && num(sc.total) !== null && num(sc.max) !== null &&
      sc.sections && typeof sc.sections === "object");
  }
  function reviewPanel(inner) {
    appEl().innerHTML = `<section class="t-review"><div class="empty">${inner}</div></section>`;
  }
  function reviewQuestion(q, i, secName, at, u) {
    const esc = A().esc, L = A().LETTERS, tita = q.type === "TITA", v = at.answers[q.id];
    const answered = Core.isAnswered(v), ok = answered && Core.isCorrect(q, v);
    const state = !answered ? "unanswered" : ok ? "correct" : "wrong";
    let h = `<article class="r-q" data-state="${state}"><div class="r-head"><b>Question ${i + 1}</b><span class="chip">${secName}</span>
      <span class="chip">${tita ? "TITA" : "MCQ"}</span>${q.n ? `<span class="src">Q${esc(q.n)} in the paper</span>` : ""}
      <span class="chip ${ok ? "ok" : state === "wrong" ? "bad" : ""}">${!answered ? "Not attempted" : ok ? "Correct" : "Wrong"}</span></div>`;
    if (u.kind === "set") {
      h += `<details class="r-dir"><summary>Set directions</summary>${A().directionsHtml(u)}</details>`;
      // on every question of the set, since a filter can hide the first one
      const setSol = A().renderSetSolution(u);
      if (setSol) h += `<details class="r-dir r-setsol"><summary>Set explanation</summary><div class="setsol">${setSol}</div></details>`;
    }
    h += A().stemHtml(q, u);
    if (tita) {
      h += `<div class="r-ans">${answered ? `<span class="${ok ? "ok" : "bad"}">Your answer: ${esc(v)}</span>` : "<span>Not attempted</span>"}
        <span>Correct answer: <b>${esc(q.answer)}</b></span></div>`;
    } else {
      const {n, compact} = A().optionLayout(q), right = Number(q.answer), pick = answered ? Number(v) : -1;
      h += `<ol class="${compact ? "optrow" : "opts"}">${Array.from({length: n}, (_, k) => {
        const cls = k === right ? "correct" : k === pick ? "wrong" : "";
        const mark = compact ? "" : (k === right ? (k === pick ? "✓ Your pick · Answer" : "Answer") : k === pick ? "✗ Your pick" : "");
        return `<li><div class="opt ${cls}" aria-label="Option ${L[k]}${k === right ? ", correct" : ""}${k === pick ? ", your pick" : ""}"><span class="k">${L[k]}</span>${A().optionBodyHtml(q, u, k)}<span class="mark">${mark}</span></div></li>`;
      }).join("")}</ol>
        <div class="r-ans">${answered ? `<span class="${ok ? "ok" : "bad"}">Your answer: ${L[pick] || esc(v)}</span>` : "<span>Not attempted</span>"}
        <span>Correct answer: <b>${L[right] || esc(q.answer)}</b></span></div>`;
    }
    return h + A().renderSolution(q, u) + "</article>";
  }
  function renderReview(paper, kind) {
    const r = A().store.get(resultKey(paper, kind), null), esc = A().esc;
    if (!r) {
      panel(`<h3>No result yet for ${esc(title(paper, kind))}</h3><p>${startButton(paper, kind, "Start this test")}</p>`);
      return;
    }
    if (!validResult(r, paper, kind)) {
      reviewPanel(`<h3>This result can’t be read</h3><p>It may be damaged or from an older version.</p><p><a href="#papers">Back to Full papers</a></p>`);
      return;
    }
    const at = r.attempt, sc = r.score, times = sectionTimes(at);
    const secs = at.sections.filter(s => SECS.includes(s));
    const FIELDS = ["score", "max", "attempted", "correct", "wrong", "unanswered"];
    const cells = (x, t) => `<td>${x.score} / ${x.max}</td><td>${x.attempted}</td><td>${x.correct}</td><td>${x.wrong}</td><td>${x.unanswered}</td><td>${accuracy(x)}</td><td>${t === null ? "\u2013" : fmt(t)}</td>`;
    const total = {time: null};
    FIELDS.forEach(f => { total[f] = 0; });
    const rows = secs.map(s => {
      const raw = sc.sections[s] || {}, t = times[at.sections.indexOf(s)], x = {};
      FIELDS.forEach(f => { x[f] = num(raw[f]) ?? 0; total[f] += x[f]; });
      if (t !== null) total.time = (total.time || 0) + t;
      return `<tr data-sec="${s}"><td>${s}</td>${cells(x, t)}</tr>`;
    }).join("");
    const foot = secs.length > 1 ? `<tfoot><tr><th scope="row">Total</th>${cells(total, total.time)}</tr></tfoot>` : "";
    const blocks = secs.map(s => Core.sectionQuestions(A().items, paper, s).map((q, i) => {
      return reviewQuestion(q, i, s, at, A().items.find(x => x.id === q.unitId) || q);
    }).join("")).join("");
    appEl().innerHTML = `<section class="t-review"><div class="eyebrow">${esc(title(paper, kind))}</div><h1>Review</h1>
      <div class="r-summary"><p class="t-score">Total score <b>${sc.total} / ${sc.max}</b></p>
        <table class="r-table"><thead><tr><th>Section</th><th>Score</th><th>Attempted</th><th>Correct</th><th>Wrong</th><th>Unanswered</th><th>Accuracy</th><th>Time used</th></tr></thead><tbody>${rows}</tbody>${foot}</table></div>
      <div class="r-filters" role="group" aria-label="Filter questions">${FILTERS.map(([k, l]) =>
        `<button type="button" class="btn small" data-act="r-filter" data-f="${k}" aria-pressed="${k === "all"}">${l}</button>`).join("")}</div>
      <div id="r-list">${blocks || `<p class="empty-note">No questions are loaded for this paper.</p>`}</div>
      <p><a href="#papers">Back to Full papers</a></p></section>`;
    A().observeImgs(appEl()); A().typeset(appEl());
  }
  function setFilter(f) {
    document.querySelectorAll(".r-filters button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === f)));
    document.querySelectorAll("#r-list .r-q").forEach(el => { el.hidden = f !== "all" && el.dataset.state !== f; });
  }

  /* ---------- public ---------- */
  function render(name) {
    S = null;
    const m = ROUTE.exec(name || "");
    if (!m) { panel(`<h3>That test link isn\u2019t valid</h3><p><a href="#papers">Choose a paper</a></p>`); return; }
    const [, mode, paper, kind] = m;
    if (mode === "review") { renderReview(paper, kind); return; }
    const esc = A().esc;
    if (!A().features.dilr && (kind === "full" || kind === "DILR")) {
      panel(`<h3>The ${esc(kind === "full" ? "complete" : "DILR")} test isn\u2019t available yet</h3><p>DILR is coming soon. Meanwhile, take the <a href="#test-${paper}-VARC">VARC test</a> or the <a href="#test-${paper}-QA">QA test</a>, or <a href="#papers">choose another paper</a>.</p>`);
      return;
    }
    if (!A().items.some(u => u.paper === paper)) {
      panel(`<h3>${esc(A().paperLabel(paper))} isn\u2019t loaded</h3><p><a href="#papers">Choose another paper</a></p>`);
      return;
    }
    const saved = A().store.get(attemptKey(paper, kind), null);
    if (!validAttempt(saved, paper, kind)) {
      const last = validResult(A().store.get(resultKey(paper, kind), null), paper, kind)
        ? ` <a class="btn" href="#review-${paper}-${kind}">View last review</a>` : "";
      panel(`<h3>No ${esc(title(paper, kind))} in progress</h3><p>${startButton(paper, kind, "Start the test")}${last}</p>`);
      return;
    }
    const a = Core.applyTime(saved, Date.now());
    if (a.finished) { finish(a); return; }
    S = {paper, kind, key: attemptKey(paper, kind), a};
    enterSection(); save(); paint();
  }

  function onClick(ev) {
    if (ev.target.classList && ev.target.classList.contains("t-modal")) { closeModal(); return; }
    const b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    const act = b.dataset.act, paper = b.dataset.paper, kind = b.dataset.kind;
    if (act === "r-filter") { setFilter(b.dataset.f); return; }
    if (act === "start-test") { startTest(paper, kind); return; }
    if (act === "t-cancel") { closeModal(); return; }
    if (act === "t-resume") { closeModal(); go(`test-${paper}-${kind}`); return; }
    if (act === "t-restart") { A().store.del(attemptKey(paper, kind)); closeModal(); begin(paper, kind); return; }
    if (!active() || syncTime()) return;
    const i = S.qs.indexOf(curQ());
    if (act === "t-pick") setAnswer(Number(b.dataset.v));
    else if (act === "t-clear") setAnswer(undefined);
    else if (act === "t-mark") toggleMark();
    else if (act === "t-prev") move(i - 1);
    else if (act === "t-next") move(i + 1);
    else if (act === "t-jump") move(Number(b.dataset.i));
    else if (act === "t-submit" || act === "t-submit-no") { S.confirming = act === "t-submit"; fillSubmit(); }
    else if (act === "t-submit-yes") submit();
  }

  function onTick() {
    if (!active()) return;
    if (!syncTime()) updateTimer();
  }

  window.TestView = {render, onClick, onTick};
})();
