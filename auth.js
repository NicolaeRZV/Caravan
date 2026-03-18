// Simple email/password auth using Supabase REST API
const SUPABASE_URL = "https://gtkxleuxhjcmxagfctgb.supabase.co";
const SUPABASE_KEY = "sb_publishable_EFavNA6eM6-uC4FaHTsZNA_3ZlqOVYc";
const AUTH_STORAGE_KEY = "ausf_auth";

// Loading overlay helpers for auth page
function showLoading(message) {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.add("active");
  const textEl = overlay.querySelector(".loading-text");
  if (textEl && message) {
    textEl.textContent = message;
  }
}

function hideLoading() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.remove("active");
}

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const toggleModeBtn = document.getElementById("toggle-auth-mode");
  const submitBtn = document.getElementById("auth-submit-btn");
  const titleEl = document.getElementById("auth-title");
  const helperText = document.getElementById("auth-helper-text");
  const nameGroup = document.getElementById("auth-name-group");
  const nameInput = document.getElementById("auth-name");
  const phoneInput = document.getElementById("auth-phone");

  // If already logged in, go straight to main app
  const existing = localStorage.getItem(AUTH_STORAGE_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && parsed.user) {
        window.location.href = "index.html";
        return;
      }
    } catch {
      // ignore parse errors
    }
  }

  let mode = "signin"; // or "signup"

  function updateModeUI() {
    if (mode === "signin") {
      titleEl.textContent = "Sign In";
      submitBtn.textContent = "Sign In";
      helperText.textContent = "Don't have an account? Create one.";
      toggleModeBtn.textContent = "Sign up";
      if (nameGroup) {
        nameGroup.style.display = "none";
        nameInput.required = false;
      }
    } else {
      titleEl.textContent = "Sign Up";
      submitBtn.textContent = "Create Account";
      helperText.textContent = "Already have an account?";
      toggleModeBtn.textContent = "Sign in";
      if (nameGroup) {
        nameGroup.style.display = "block";
        nameInput.required = true;
      }
    }
  }

  toggleModeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    mode = mode === "signin" ? "signup" : "signin";
    updateModeUI();
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const errorEl = document.getElementById("auth-error");
    const name = nameInput ? nameInput.value.trim() : "";
    const phone = phoneInput ? phoneInput.value.trim() : "";

    errorEl.textContent = "";

    if (!phone) {
      errorEl.textContent = "Please enter your phone number.";
      return;
    }

    if (!email || !password) {
      errorEl.textContent = "Please enter email and password.";
      return;
    }

    try {
      if (mode === "signin") {
        showLoading("Signing in...");
        await signIn(email, password, { phone });
      } else {
        if (!name) {
          errorEl.textContent = "Please enter your name.";
          return;
        }
        showLoading("Creating account...");
        await signUp(email, password, name, { phone });
      }
    } catch (err) {
      console.error("Auth error", err);
      errorEl.textContent = "Something went wrong. Please try again.";
    } finally {
      hideLoading();
    }
  });

  updateModeUI();
});

async function signIn(email, password, { phone } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Sign in failed", res.status, text);
    const errorEl = document.getElementById("auth-error");
    errorEl.textContent = "Invalid email or password.";
    return;
  }

  const data = await res.json();
  // Store minimal user + access token locally
  const userData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user,
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData));

  try {
    await upsertVolunteerPhone({ email, phone, name: data?.user?.user_metadata?.name || data?.user?.email || "" });
  } catch (e) {
    console.warn("Failed to save phone in Voluntari", e);
  }

  window.location.href = "index.html";
}

async function signUp(email, password, name, { phone } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ email, password, data: { name } }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Sign up failed", res.status, text);
    const errorEl = document.getElementById("auth-error");
    errorEl.textContent = "Could not create account. Maybe email is already used.";
    return;
  }

  // After successful signup, directly sign in to create session
  await signIn(email, password, { phone });
}

async function upsertVolunteerPhone({ email, phone, name }) {
  const safeEmail = (email || "").trim();
  const safePhone = (phone || "").trim();
  if (!safeEmail || !safePhone) return;

  // Check if volunteer exists
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/Voluntari?Email=eq.${encodeURIComponent(safeEmail)}&select=id,Telefon`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!checkRes.ok) {
    const text = await checkRes.text();
    throw new Error(`Voluntari check failed: ${checkRes.status} ${text}`);
  }

  const rows = await checkRes.json();
  if (rows && rows[0] && rows[0].id) {
    const volunteerId = rows[0].id;
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/Voluntari?id=eq.${volunteerId}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Telefon: safePhone }),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text();
      throw new Error(`Voluntari phone update failed: ${patchRes.status} ${text}`);
    }
    return;
  }

  // Insert new volunteer row if missing (best-effort)
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/Voluntari?select=*`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      NumeComplet: (name || safeEmail).trim() || safeEmail,
      Email: safeEmail,
      Telefon: safePhone,
      OreVoluntariat: 0,
      OreNeaprobate: 0,
      Privilegii: "Voluntar",
    }),
  });
  if (!insertRes.ok) {
    const text = await insertRes.text();
    throw new Error(`Voluntari insert failed: ${insertRes.status} ${text}`);
  }
}


