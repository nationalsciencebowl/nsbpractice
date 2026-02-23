// stats.js — localStorage stats layer
// Designed so Supabase can be swapped in later by replacing these functions.
//
// Data shape in localStorage key "nsb_stats":
// {
//   practiceHistory: [{ date, subject, type, correct, points }],
//   versusHistory:   [{ date, difficulty, length, youScore, botScore, won }],
// }

const Stats = (() => {

  const KEY = 'nsb_stats';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { practiceHistory: [], versusHistory: [] };
    } catch { return { practiceHistory: [], versusHistory: [] }; }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  // ── Practice tracking ──────────────────────────────────────────────────────

  // Call this every time a toss-up or bonus is answered in practice mode
  function recordPracticeAnswer({ subject, type, isBonus, correct }) {
    const data = load();
    data.practiceHistory.push({
      date:    new Date().toISOString(),
      subject: subject,
      type:    isBonus ? 'bonus' : 'tossup',
      qType:   type,     // "Multiple Choice" or "Short Answer"
      correct: correct,
      points:  correct ? (isBonus ? 10 : 4) : 0,
    });
    save(data);
  }

  // ── Versus tracking ────────────────────────────────────────────────────────

  // Call this at the end of a vs-bot match
  function recordVersusMatch({ difficulty, length, youScore, botScore }) {
    const data = load();
    data.versusHistory.push({
      date:       new Date().toISOString(),
      difficulty: difficulty,
      length:     length,
      youScore:   youScore,
      botScore:   botScore,
      won:        youScore > botScore,
    });
    save(data);
  }

  // ── Computed summaries ─────────────────────────────────────────────────────

  function getPracticeStats() {
    const data = load();
    const history = data.practiceHistory;

    const SUBJECTS = ['Life Science','Physical Science','Earth and Space',
                      'Energy','Math','Mathematics','General Science',
                      'Biology','Chemistry','Physics'];

    // Overall
    const total   = history.length;
    const correct = history.filter(h => h.correct).length;
    const points  = history.reduce((s, h) => s + h.points, 0);

    // By subject
    const bySubject = {};
    SUBJECTS.forEach(s => {
      const qs = history.filter(h => h.subject === s);
      if (qs.length === 0) return;
      bySubject[s] = {
        total:   qs.length,
        correct: qs.filter(h => h.correct).length,
        pct:     Math.round(qs.filter(h => h.correct).length / qs.length * 100),
      };
    });

    // Streak
    let streak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].correct) streak++;
      else break;
    }

    // Recent 7 days activity
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentTotal   = history.filter(h => h.date > weekAgo).length;
    const recentCorrect = history.filter(h => h.date > weekAgo && h.correct).length;

    return { total, correct, points, bySubject, streak, recentTotal, recentCorrect };
  }

  function getVersusStats() {
    const data = load();
    const history = data.versusHistory;
    const total  = history.length;
    const wins   = history.filter(h => h.won).length;
    const losses = history.filter(h => !h.won && h.youScore !== h.botScore).length;
    const ties   = history.filter(h => h.youScore === h.botScore).length;

    const byDiff = {};
    ['novice','varsity','elite'].forEach(d => {
      const qs = history.filter(h => h.difficulty === d);
      if (qs.length === 0) return;
      byDiff[d] = {
        played: qs.length,
        wins:   qs.filter(h => h.won).length,
      };
    });

    const recent = history.slice(-10).reverse();
    return { total, wins, losses, ties, byDiff, recent };
  }

  function clearAll() {
    localStorage.removeItem(KEY);
  }

  // Public API
  return { recordPracticeAnswer, recordVersusMatch, getPracticeStats, getVersusStats, clearAll };

})();
