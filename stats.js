// stats.js — stats layer with localStorage + Supabase sync
// When logged in: reads/writes to Supabase, mirrors to localStorage as cache
// When logged out: reads/writes localStorage only

const SUPABASE_URL = 'https://uhzyfukvbodiofvcistr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoenlmdWt2Ym9kaW9mdmNpc3RyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM3OTUsImV4cCI6MjA4NzM3OTc5NX0.o3IAwdbk-aSZb-kJvSTmHK1H3lsRT4GI-O2jZbZRvPA';

const Stats = (() => {

  const LOCAL_KEY = 'nsb_stats';
  let _sb = null;
  let _session = null;

  // ── Supabase init (only loads if library is present) ──────────────────────
  function initSupabase() {
    if (typeof supabase !== 'undefined' && !_sb) {
      _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      _sb.auth.getSession().then(({ data }) => {
        _session = data.session;
      });
      _sb.auth.onAuthStateChange((_event, session) => {
        _session = session;
        if (session) syncFromSupabase(); // pull cloud data on login
      });
    }
  }

  // ── Local storage helpers ─────────────────────────────────────────────────
  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY)) || { practiceHistory: [], versusHistory: [] };
    } catch { return { practiceHistory: [], versusHistory: [] }; }
  }

  function saveLocal(data) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  }

  // ── Supabase helpers ──────────────────────────────────────────────────────
  async function loadCloud() {
    if (!_sb || !_session) return null;
    const { data, error } = await _sb
      .from('user_stats')
      .select('practice_history, versus_history')
      .eq('user_id', _session.user.id)
      .single();
    if (error || !data) return null;
    return { practiceHistory: data.practice_history, versusHistory: data.versus_history };
  }

  async function saveCloud(stats) {
    if (!_sb || !_session) return;
    await _sb.from('user_stats').upsert({
      user_id:          _session.user.id,
      practice_history: stats.practiceHistory,
      versus_history:   stats.versusHistory,
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'user_id' });
  }

  // Pull cloud data into localStorage on login
  async function syncFromSupabase() {
    const cloud = await loadCloud();
    if (cloud) {
      // Merge: combine local + cloud, deduplicate by date
      const local = loadLocal();
      const merged = {
        practiceHistory: mergeByDate(local.practiceHistory, cloud.practiceHistory),
        versusHistory:   mergeByDate(local.versusHistory,   cloud.versusHistory),
      };
      saveLocal(merged);
      await saveCloud(merged);
    } else {
      // No cloud record yet — push local data up
      await saveCloud(loadLocal());
    }
  }

  function mergeByDate(a, b) {
    const map = new Map();
    [...a, ...b].forEach(item => map.set(item.date, item));
    return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date));
  }

  // ── Write helpers ─────────────────────────────────────────────────────────
  async function persist(data) {
    saveLocal(data);
    if (_session) await saveCloud(data);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async function recordPracticeAnswer({ subject, type, isBonus, correct }) {
    const data = loadLocal();
    data.practiceHistory.push({
      date:    new Date().toISOString(),
      subject, type,
      qType:   type,
      isBonus: isBonus,
      correct: correct,
      points:  correct ? (isBonus ? 10 : 4) : 0,
    });
    await persist(data);
  }

  async function recordVersusMatch({ difficulty, length, youScore, botScore }) {
    const data = loadLocal();
    data.versusHistory.push({
      date: new Date().toISOString(),
      difficulty, length, youScore, botScore,
      won: youScore > botScore,
    });
    await persist(data);
  }

  function getPracticeStats() {
    const data = loadLocal();
    const history = data.practiceHistory;

    const SUBJECTS = ['Life Science','Physical Science','Earth and Space',
                      'Energy','Math','Mathematics','General Science',
                      'Biology','Chemistry','Physics'];

    const total   = history.length;
    const correct = history.filter(h => h.correct).length;
    const points  = history.reduce((s, h) => s + h.points, 0);

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

    let streak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].correct) streak++;
      else break;
    }

    return { total, correct, points, bySubject, streak };
  }

  function getVersusStats() {
    const data = loadLocal();
    const history = data.versusHistory;
    const total  = history.length;
    const wins   = history.filter(h => h.won).length;
    const losses = history.filter(h => !h.won && h.youScore !== h.botScore).length;
    const ties   = history.filter(h => h.youScore === h.botScore).length;

    const byDiff = {};
    ['novice','varsity','elite'].forEach(d => {
      const qs = history.filter(h => h.difficulty === d);
      if (qs.length === 0) return;
      byDiff[d] = { played: qs.length, wins: qs.filter(h => h.won).length };
    });

    const recent = history.slice(-10).reverse();
    return { total, wins, losses, ties, byDiff, recent };
  }

  function getUser() {
    return _session ? _session.user : null;
  }

  async function signOut() {
    if (_sb) await _sb.auth.signOut();
    _session = null;
  }

  async function clearAll() {
    const empty = { practiceHistory: [], versusHistory: [] };
    saveLocal(empty);
    if (_session) await saveCloud(empty);
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabase);
  } else {
    initSupabase();
  }

  return {
    recordPracticeAnswer, recordVersusMatch,
    getPracticeStats, getVersusStats,
    getUser, signOut, clearAll,
  };

})();
