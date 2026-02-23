const SUPABASE_URL = "https://uhzyfukvbodiofvcistr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoenlmdWt2Ym9kaW9mdmNpc3RyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM3OTUsImV4cCI6MjA4NzM3OTc5NX0.o3IAwdbk-aSZb-kJvSTmHK1H3lsRT4GI-O2jZbZRvPA";

const sb = window.supabase.createClient(
  'https://uhzyfukvbodiofvcistr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoenlmdWt2Ym9kaW9mdmNpc3RyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM3OTUsImV4cCI6MjA4NzM3OTc5NX0.o3IAwdbk-aSZb-kJvSTmHK1H3lsRT4GI-O2jZbZRvPA'
);

let currentUser = null;

// detect login
sb.auth.getUser().then(({ data }) => {
  currentUser = data?.user ?? null;
  if (currentUser) syncFromCloud();
});

sb.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;
  if (currentUser) syncFromCloud();
});

// cloud → local
async function syncFromCloud() {
  if (!currentUser) return;

  const { data, error } = await sb
    .from("user_stats")
    .select("*")
    .eq("user_id", currentUser.id)
    .single();

  if (!data) {
    await sb.from("user_stats").insert({
      user_id: currentUser.id,
      practice_history: [],
      versus_history: []
    });
    return;
  }

  localStorage.setItem(
    "nsb_stats",
    JSON.stringify({
      practiceHistory: data.practice_history || [],
      versusHistory: data.versus_history || []
    })
  );
}

// local → cloud
async function syncToCloud(stats) {
  if (!currentUser) return;

  await sb.from("user_stats").upsert({
    user_id: currentUser.id,
    practice_history: stats.practiceHistory || [],
    versus_history: stats.versusHistory || [],
    updated_at: new Date().toISOString()
  });
}

// watch localStorage writes
const originalSetItem = localStorage.setItem;

localStorage.setItem = function (key, value) {
  originalSetItem.apply(this, arguments);

  if (key === "nsb_stats" && currentUser) {
    try {
      const stats = JSON.parse(value);
      syncToCloud(stats);
    } catch {}
  }
};
window.logout = async function () {
  const { error } = await sb.auth.signOut();
  const el = document.getElementById("accountStatus");

  if (error) {
    alert("Logout failed: " + error.message);
    return;
  }

  if (el) el.textContent = "You have successfully logged out.";

  currentUser = null;
  localStorage.removeItem("nsb_stats");

  // Wait 2 seconds before letting onAuthStateChange update
  setTimeout(() => {
    if (el) el.textContent = "Not logged in";
  }, 2000);
};
sb.auth.onAuthStateChange((_event, session) => {
  const el = document.getElementById("accountStatus");
  if (!el) return;

  if (session?.user) {
    el.textContent = "Logged in as: " + session.user.email;
  } else {
    el.textContent = "You have successfully logged out.";
    currentUser = null;
    localStorage.removeItem("nsb_stats");

    // Optional: change to "Not logged in" after 3 seconds
    setTimeout(() => {
      el.textContent = "Not logged in";
    }, 3000);
  }
});

