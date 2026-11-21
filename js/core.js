/* Pure logic (no DOM): grading, filters, tally. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SECTIONS = ["QA", "DILR", "VARC"];

  function squash(s) { return String(s).replace(/\s+/g, ""); }

  function isCorrect(q, v) {
    if (q.type === "TITA") {
      const a = squash(q.answer), b = squash(v);
      if (a === "" || b === "") return false;
      const na = Number(a), nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
      return a.toLowerCase() === b.toLowerCase();
    }
    return Number(v) === Number(q.answer);
  }

  function normalizeFilters(raw) {
    const r = raw || {};
    const list = (arr, single) => Array.isArray(arr) ? arr.filter(Boolean).map(String) : (single ? [String(single)] : []);
    return {
      section: SECTIONS.includes(r.section) ? r.section : "QA",
      topics: list(r.topics, r.topic),
      papers: list(r.papers, r.paper),
      status: r.status === "new" || r.status === "wrong" ? r.status : "all"
    };
  }

  function questionsOf(u) { return u.kind === "set" ? u.questions : [u]; }

  function filterUnits(units, f, progress) {
    return units.filter(u => {
      if (u.section !== f.section) return false;
      if (f.topics.length && !f.topics.includes(u.topic)) return false;
      if (f.papers.length && !f.papers.includes(u.paper)) return false;
      const qs = questionsOf(u);
      if (f.status === "new" && !qs.some(q => !progress[q.id])) return false;
      if (f.status === "wrong" && !qs.some(q => progress[q.id] && !progress[q.id].ok)) return false;
      return true;
    }).sort((a, b) => (b.paper || "").localeCompare(a.paper || "") || (a.n || 0) - (b.n || 0));
  }

  function tally(units, progress) {
    const qs = units.flatMap(questionsOf);
    let attempted = 0, correct = 0;
    qs.forEach(q => { const p = progress[q.id]; if (p) { attempted++; if (p.ok) correct++; } });
    return {
      questions: qs.length, attempted, correct,
      wrong: attempted - correct, notAttempted: qs.length - attempted,
      accuracy: attempted ? correct / attempted : null
    };
  }

  const SECTION_MS = 2400000;
  const TEST_ORDER = ["VARC", "DILR", "QA"];

  function isAnswered(v) {
    return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
  }

  function createAttempt(paper, kind, now) {
    const sections = kind === "full" ? TEST_ORDER.slice() : [kind];
    return {
      paper, kind, sections, secIndex: 0, deadline: now + SECTION_MS,
      answers: {}, marked: {}, visited: {}, current: null, startedAt: now,
      submittedAt: sections.map(() => null), finished: false
    };
  }

  function advance(a, at, nextDeadline) {
    const submittedAt = a.submittedAt.slice();
    submittedAt[a.secIndex] = at;
    const last = a.secIndex >= a.sections.length - 1;
    return Object.assign({}, a, {
      answers: Object.assign({}, a.answers), marked: Object.assign({}, a.marked),
      visited: Object.assign({}, a.visited), sections: a.sections.slice(),
      submittedAt,
      secIndex: last ? a.secIndex : a.secIndex + 1,
      deadline: last ? a.deadline : nextDeadline,
      finished: last
    });
  }

  function submitSection(a, now) {
    if (a.finished) return a;
    return advance(a, now, now + SECTION_MS);
  }

  function applyTime(a, now) {
    let cur = a;
    while (!cur.finished && now > cur.deadline) {
      cur = advance(cur, cur.deadline, cur.deadline + SECTION_MS);
    }
    return cur;
  }

  function remainingMs(a, now) {
    return a.finished ? 0 : Math.max(0, a.deadline - now);
  }

  function paletteState(a, qid) {
    const ans = isAnswered(a.answers[qid]), mk = !!a.marked[qid];
    if (ans && mk) return "answered-marked";
    if (mk) return "marked";
    if (ans) return "answered";
    return a.visited[qid] ? "not-answered" : "not-visited";
  }

  function sectionQuestions(units, paper, section) {
    const out = [];
    units.forEach(u => {
      if (u.paper !== paper || u.section !== section) return;
      questionsOf(u).forEach(q => out.push(Object.assign({}, q, {unitId: u.kind === "set" ? u.id : q.id})));
    });
    return out.sort((x, y) => (x.n || 0) - (y.n || 0));
  }

  function scoreAttempt(a, bySection) {
    const sections = {};
    let total = 0, max = 0;
    Object.keys(bySection).forEach(sec => {
      const r = {score: 0, max: 3 * bySection[sec].length, attempted: 0, correct: 0, wrong: 0, unanswered: 0};
      bySection[sec].forEach(q => {
        const v = a.answers[q.id];
        if (!isAnswered(v)) { r.unanswered++; return; }
        r.attempted++;
        if (isCorrect(q, v)) { r.correct++; r.score += 3; }
        else { r.wrong++; if (q.type !== "TITA") r.score -= 1; }
      });
      sections[sec] = r;
      total += r.score; max += r.max;
    });
    return {total, max, sections};
  }

  return {isCorrect, normalizeFilters, questionsOf, filterUnits, tally,
    SECTION_MS, TEST_ORDER, createAttempt, applyTime, submitSection, remainingMs,
    paletteState, sectionQuestions, scoreAttempt, isAnswered};
});
