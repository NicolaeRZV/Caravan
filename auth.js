// Simple email/password auth using Supabase REST API
const SUPABASE_URL = "https://gtkxleuxhjcmxagfctgb.supabase.co";
const SUPABASE_KEY = "sb_publishable_EFavNA6eM6-uC4FaHTsZNA_3ZlqOVYc";
const AUTH_STORAGE_KEY = "ausf_auth";

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const toggleModeBtn = document.getElementById("toggle-auth-mode");
  const submitBtn = document.getElementById("auth-submit-btn");
  const titleEl = document.getElementById("auth-title");
  const helperText = document.getElementById("auth-helper-text");
  const nameGroup = document.getElementById("auth-name-group");
  const nameInput = document.getElementById("auth-name");

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

    errorEl.textContent = "";

    if (!email || !password) {
      errorEl.textContent = "Please enter email and password.";
      return;
    }

    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        if (!name) {
          errorEl.textContent = "Please enter your name.";
          return;
        }
        await signUp(email, password, name);
      }
    } catch (err) {
      console.error("Auth error", err);
      errorEl.textContent = "Something went wrong. Please try again.";
    }
  });

  updateModeUI();
});

async function signIn(email, password) {
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

  window.location.href = "index.html";
}

async function signUp(email, password, name) {
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
  await signIn(email, password);
}


