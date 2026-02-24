// stats.js — stats layer with localStorage + Supabase sync

const SUPABASE_URL = 'https://uhzyfukvbodiofvcistr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoenlmdWt2Ym9kaW9mdmNpc3RyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM3OTUsImV4cCI6MjA4NzM3OTc5NX0.o3IAwdbk-aSZb-kJvSTmHK1H3lsRT4GI-O2jZbZRvPA';

// ── Single shared Supabase client ─────────────────────────────────────────────
// Use window._sbClient so every script shares the same instance
function getClient() {
  if (!window._sbClient && typeof supabase !== 'undefined') {
    window._sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return window._sbClient || null;
}

const Stats = (() => {
  const LOCAL_KEY = 'nsb_stats';
  let _session = null;

  function initSupabase() {
    const sb = getClient();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      _session = data.session;
      if (_session) syncFromSupabase();
    });
    sb.auth.onAuthStateChange((_event, session) => {
      _session = session;
      if (session) syncFromSupabase();
    });
  }

  // ── Local storage ─────────────────────────────────────────────────────────
  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY)) || { practiceHistory: [], versusHistory: [] };
    } catch { return { practiceHistory: [], versusHistory: [] }; }
  }

  function saveLocal(data) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  }

  // ── Supabase cloud ────────────────────────────────────────────────────────
  async function loadCloud() {
    const sb = getClient();
    if (!sb || !_session) return null;
    try {
      const { data, error } = await sb
        .from('user_stats')
        .select('practice_history, versus_history')
        .eq('user_id', _session.user.id)
        .limit(1);
      if (error) { console.warn('loadCloud error:', error.message); return null; }
      if (!data || data.length === 0) return null;
      return {
        practiceHistory: data[0].practice_history || [],
        versusHistory:   data[0].versus_history   || [],
      };
    } catch (e) { console.warn('loadCloud exception:', e); return null; }
  }

  async function saveCloud(stats) {
    const sb = getClient();
    if (!sb || !_session) return;
    try {
      const { error } = await sb.from('user_stats').upsert({
        user_id:          _session.user.id,
        practice_history: stats.practiceHistory,
        versus_history:   stats.versusHistory,
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) console.warn('saveCloud error:', error.message);
    } catch (e) { console.warn('saveCloud exception:', e); }
  }

  async function syncFromSupabase() {
    const cloud = await loadCloud();
    if (cloud) {
      const local = loadLocal();
      const merged = {
        practiceHistory: mergeByDate(local.practiceHistory, cloud.practiceHistory),
        versusHistory:   mergeByDate(local.versusHistory,   cloud.versusHistory),
      };
      saveLocal(merged);
      await saveCloud(merged);
    } else {
      await saveCloud(loadLocal());
    }
  }

  function mergeByDate(a, b) {
    const map = new Map();
    [...(a||[]), ...(b||[])].forEach(item => { if (item && item.date) map.set(item.date, item); });
    return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date));
  }

  async function persist(data) {
    saveLocal(data);
    if (_session) await saveCloud(data);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async function recordPracticeAnswer({ subject, type, isBonus, correct }) {
    const data = loadLocal();
    data.practiceHistory.push({
      date: new Date().toISOString(),
      subject, type, isBonus, correct,
      points: correct ? (isBonus ? 10 : 4) : 0,
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
    const history = data.practiceHistory || [];
    const SUBJECTS = ['Life Science','Physical Science','Earth and Space',
                      'Energy','Math','Mathematics','General Science',
                      'Biology','Chemistry','Physics'];
    const total   = history.length;
    const correct = history.filter(h => h.correct).length;
    const points  = history.reduce((s, h) => s + (h.points||0), 0);
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
    const history = data.versusHistory || [];
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
    const sb = getClient();
    if (sb) await sb.auth.signOut();
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

  return { recordPracticeAnswer, recordVersusMatch, getPracticeStats, getVersusStats, getUser, signOut, clearAll };
})();
