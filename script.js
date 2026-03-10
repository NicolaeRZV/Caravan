// Data storage (activities only in Supabase, payments still local)
let currentActivities = [];
let myActivities = [];
let payments = [];
let selectedActivityForJoin = null;
let joinedActivityIds = []; // Track which activity IDs the user has joined
let userPrivilegii = null; // Rank from Voluntari (Privilegii column)
let isOwner = false; // true when Privilegii === "Owner"
let allVolunteers = []; // Loaded only for Owner in stats tab
let availableVolunteerRanks = []; // All known rank values for owner UI
let checklistActivities = []; // Activities from ChecklistACTIVITYS table
let checklistCompletionCounts = {}; // email -> how many checklist activities are finished
let activeParticipantsActivity = null; // Activity currently shown in Participants modal (for force-add)
let currentVolunteerHoursApproved = 0;
let currentVolunteerHoursPending = 0;
let pendingParticipationsForOwner = []; // Owner-only: per-activity pending hours records

const AUTH_STORAGE_KEY = 'ausf_auth';

// Get current logged-in user from localStorage
function getCurrentUser() {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        return data && data.user ? data.user : null;
    } catch (e) {
        console.error('Failed to parse auth data', e);
        return null;
    }
}

// Redirect to login page if not authenticated
function requireAuth() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'login.html';
        return null;
    }
    return user;
}

// Global logout handler (can be used from HTML onclick)
function handleLogout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem('ausf_joinedActivityIds');
    // Optionally clear payments as well, but keep for now
    window.location.href = 'login.html';
}

// Expose logout globally for inline handlers
window.handleLogout = handleLogout;

// Global loading overlay helpers
function showLoading(message) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    overlay.classList.add('active');
    const textEl = overlay.querySelector('.loading-text');
    if (textEl && message) {
        textEl.textContent = message;
    }
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
}

// Fetch volunteer Privilegii (Rank) from Voluntari by email
async function fetchVolunteerPrivilegii(email) {
    if (!email) return null;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?Email=eq.${encodeURIComponent(email)}&select=Privilegii`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) return null;
        const rows = await res.json();
        return rows.length > 0 && rows[0].Privilegii != null ? rows[0].Privilegii : null;
    } catch (err) {
        console.error('Error fetching Privilegii from Voluntari', err);
        return null;
    }
}

// Setup header UI with user email and Rank from Privilegii
async function setupAuthUI(user) {
    const emailEl = document.getElementById('user-email');
    const rankEl = document.getElementById('user-rank');
    if (emailEl && user.email) {
        emailEl.textContent = user.email;
    }
    userPrivilegii = await fetchVolunteerPrivilegii(user?.email || '');
    isOwner = userPrivilegii === 'Owner';
    if (rankEl && userPrivilegii) {
        rankEl.textContent = userPrivilegii;
        rankEl.style.display = '';
    } else if (rankEl) {
        rankEl.style.display = 'none';
    }

    // Show owner-only UI elements and load global stats for owners
    document.querySelectorAll('.owner-only').forEach(el => {
        el.style.display = isOwner ? '' : 'none';
    });
    if (isOwner) loadAllVolunteersForOwner();
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const user = requireAuth();
    if (!user) return;

    await setupAuthUI(user);

    await loadData();
    setupTabs();
    setupForms();
    renderAll();
    setDefaultDate();
});

// Load data from Supabase (activities, checklist) and localStorage (payments and joined IDs)
async function loadData() {
    // Load payments from localStorage (still using local storage for payments)
    const savedPayments = localStorage.getItem('ausf_payments');
    if (savedPayments) payments = JSON.parse(savedPayments);

    // Load joined activity IDs from localStorage
    const savedJoinedIds = localStorage.getItem('ausf_joinedActivityIds');
    if (savedJoinedIds) joinedActivityIds = JSON.parse(savedJoinedIds);

    // Load activities from Supabase
    await loadActivitiesFromSupabase();

    // Load checklist activities from Supabase
    await loadChecklistFromSupabase();
    
    // Re-render with Supabase data
    renderAll();

    // Update owner stats with latest checklist completion counts
    if (isOwner) {
        renderVolunteerStats();
    }

    // Load current volunteer hours (approved + pending)
    await loadCurrentVolunteerHoursFromSupabase();
}

// Load hosted activities from Supabase
async function loadActivitiesFromSupabase() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_ACTIVITY_TABLE}?select=*`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Supabase fetch failed', res.status, text);
            currentActivities = [];
            return;
        }

        const rows = await res.json();

        // Map Supabase rows back into our in-memory format
        currentActivities = rows.map(row => {
            const participantsText = row.Participanti || '';
            const participantList = participantsText
                ? participantsText.split(',').map(p => p.trim()).filter(Boolean)
                : [];

            return {
                id: row.id || Date.now(),
                name: row.Nume || '',
                description: row.Descriere || '',
                date: row.Data || new Date().toISOString().split('T')[0],
                hours: parseFloat(row.Ore) || 0,
                organiser: row.Organizatori || '',
                location: row.Locatie || '',
                timeInterval: row["Ora Organizarii"] || '', // Time interval when activity is hosted
                specialChecklistName: row[ACTIVITY_SPECIAL_CHECKLIST_NAME_COLUMN] || '',
                isChecklistSpecial: !!row[ACTIVITY_SPECIAL_CHECKLIST_NAME_COLUMN],
                supabase_id: row.id,
                participantsText,
                participantsCount: new Set(participantList).size
            };
        });
        
        // Rebuild myActivities after loading currentActivities
        buildMyActivities();
    } catch (err) {
        console.error('Error loading activities from Supabase', err);
        currentActivities = [];
    }
}

// Build myActivities from currentActivities based on joined IDs
function buildMyActivities() {
    const user = getCurrentUser();
    const email = (user && user.email) ? user.email.trim().toLowerCase() : '';
    const legacyName =
        (user && user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name))
            ? String(user.user_metadata.name || user.user_metadata.full_name).trim().toLowerCase()
            : '';
    if (!email) {
        myActivities = [];
        return;
    }

    myActivities = currentActivities
        .filter(activity => {
            const list = (activity.participantsText || '')
                .split(',')
                .map(x => x.trim())
                .filter(Boolean)
                .map(x => x.toLowerCase());
            return list.includes(email) || (legacyName ? list.includes(legacyName) : false);
        })
        .map(activity => ({
            ...activity,
            my_activity_id: activity.supabase_id
        }));
}

// Save data to localStorage (payments and joined activity IDs)
function saveData() {
    localStorage.setItem('ausf_payments', JSON.stringify(payments));
    localStorage.setItem('ausf_joinedActivityIds', JSON.stringify(joinedActivityIds));
}

// Supabase configuration (uses the same project values from supabase-client.ts)
const SUPABASE_URL = "https://gtkxleuxhjcmxagfctgb.supabase.co";
const SUPABASE_KEY = "sb_publishable_EFavNA6eM6-uC4FaHTsZNA_3ZlqOVYc";
// IMPORTANT: table name must match exactly what exists in Supabase (case-sensitive)
const SUPABASE_ACTIVITY_TABLE = "Activitati";
const SUPABASE_VOLUNTEER_TABLE = "Voluntari";
const SUPABASE_CHECKLIST_TABLE = "ChecklistACTIVITYS";
// New: per-activity participation approvals (create this table in Supabase)
const SUPABASE_PARTICIPATION_TABLE = "Participari";
// Column names for checklist table (must match Supabase exactly)
const CHECKLIST_NAME_COLUMN = "CHECKLISTactivitate NAME";
const CHECKLIST_FINISHED_COLUMN = "Finisshed list";
const CHECKLIST_IN_PROGRESS_COLUMN = "In progress";
const CHECKLIST_REQUIRED_2_COLUMN = "Required 2";
// Extra column in Activitati to remember which checklist task this activity belongs to
// You need to create this text column in Supabase table "Activitati".
const ACTIVITY_SPECIAL_CHECKLIST_NAME_COLUMN = "SpecialChecklistName";

// Load checklist activities from Supabase (ChecklistACTIVITYS)
async function loadChecklistFromSupabase() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_CHECKLIST_TABLE}?select=*`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Supabase checklist fetch failed', res.status, text);
            checklistActivities = [];
            checklistCompletionCounts = {};
            return;
        }

        const rows = await res.json();
        const user = getCurrentUser();
        const userEmail = (user && user.email) ? user.email.toLowerCase() : null;

        checklistCompletionCounts = {};

        checklistActivities = rows.map(row => {
            const rawName = row[CHECKLIST_NAME_COLUMN] || '';
            const finishedRaw = row[CHECKLIST_FINISHED_COLUMN] || '';
            const inProgressRaw = row[CHECKLIST_IN_PROGRESS_COLUMN] || '';
            const required2 = row[CHECKLIST_REQUIRED_2_COLUMN] === true;

            const finishedList = finishedRaw
                ? finishedRaw.split(',').map(x => x.trim()).filter(Boolean)
                : [];
            const inProgressList = inProgressRaw
                ? inProgressRaw.split(',').map(x => x.trim()).filter(Boolean)
                : [];
            const finishedEmailsLower = finishedList.map(x => x.toLowerCase());
            const inProgressEmailsLower = inProgressList.map(x => x.toLowerCase());

            // Build global completion counts per email (only finished, not in-progress)
            finishedEmailsLower.forEach(email => {
                if (!email) return;
                if (!checklistCompletionCounts[email]) {
                    checklistCompletionCounts[email] = 0;
                }
                checklistCompletionCounts[email] += 1;
            });

            return {
                id: row.id,
                supabase_id: row.id,
                name: rawName,
                required2,
                finishedRaw,
                finishedList,
                inProgressRaw,
                inProgressList,
                finishedCount: finishedList.length,
                inProgressCount: inProgressList.length,
                isCompletedByCurrentUser: userEmail ? finishedEmailsLower.includes(userEmail) : false,
                isInProgressByCurrentUser: userEmail ? inProgressEmailsLower.includes(userEmail) : false,
            };
        });

        // Refresh searchable combobox
        setupChecklistSearchable();
    } catch (err) {
        console.error('Error loading checklist activities from Supabase', err);
        checklistActivities = [];
        checklistCompletionCounts = {};
        setupChecklistSearchable();
    }
}

// Searchable checklist combobox for linking activity to checklist task
let checklistSearchableInitialized = false;
function setupChecklistSearchable() {
    const searchInput = document.getElementById('activity-checklist-search');
    const valueInput = document.getElementById('activity-checklist-value');
    const dropdown = document.getElementById('activity-checklist-dropdown');
    const specialCheckbox = document.getElementById('activity-is-checklist-special');

    if (!searchInput || !valueInput || !dropdown) return;

    function renderDropdown(filter) {
        const items = checklistActivities || [];
        const term = (filter || '').toLowerCase().trim();
        const filtered = term
            ? items.filter(item => (item.name || '').toLowerCase().includes(term))
            : items;

        if (filtered.length === 0) {
            dropdown.innerHTML = '<div class="checklist-dropdown-empty">No matching tasks</div>';
            return;
        }

        dropdown.innerHTML = filtered.map(item => `
            <div class="checklist-dropdown-item" data-value="${escapeHtml(item.name || '')}" data-id="${item.supabase_id || item.id}">
                ${escapeHtml(item.name || '')}${item.required2 ? ' <span style="font-size:0.75rem;color:var(--gray);">(requires 2)</span>' : ''}
            </div>
        `).join('');

        dropdown.querySelectorAll('.checklist-dropdown-item').forEach(el => {
            el.addEventListener('click', () => {
                const val = el.getAttribute('data-value');
                searchInput.value = val;
                valueInput.value = val;
                dropdown.classList.remove('open');
                searchInput.blur();
            });
        });
    }

    if (!checklistSearchableInitialized) {
        checklistSearchableInitialized = true;
        searchInput.addEventListener('focus', () => {
            if (searchInput.disabled) return;
            renderDropdown(searchInput.value);
            dropdown.classList.add('open');
        });

        searchInput.addEventListener('input', () => {
            renderDropdown(searchInput.value);
            valueInput.value = searchInput.value;
            dropdown.classList.add('open');
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => dropdown.classList.remove('open'), 150);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                dropdown.classList.remove('open');
                searchInput.blur();
            }
        });
    }

    // Sync disabled state and clear when checkbox toggles (runs every time)
    if (specialCheckbox) {
        searchInput.disabled = !specialCheckbox.checked;
        if (!specialCheckbox.checked) {
            searchInput.value = '';
            valueInput.value = '';
        }
    }
}

// Sync volunteer total hours to Supabase (table: Voluntari)
async function syncVolunteerHoursToSupabase(totalHours) {
    const user = getCurrentUser();
    if (!user || !user.email) return;

    const email = user.email;
    const name = (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) || email;

    try {
        // 1) Check if volunteer already exists by email
        const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?Email=eq.${encodeURIComponent(email)}&select=*`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!checkRes.ok) {
            const text = await checkRes.text();
            console.error('Failed to check Voluntari', checkRes.status, text);
            return;
        }

        const rows = await checkRes.json();
        const payload = {
            NumeComplet: name,
            Email: email,
            OreVoluntariat: totalHours
        };

        if (rows.length > 0) {
            // 2) Update existing row (do NOT overwrite existing Privilegii)
            const existing = rows[0];
            const id = existing.id;

            const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?id=eq.${id}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!updateRes.ok) {
                const text = await updateRes.text();
                console.error('Failed to update Voluntari', updateRes.status, text);
            }
        } else {
            // 3) Create new volunteer row with default rank "Voluntar"
            const insertPayload = {
                ...payload,
                Privilegii: 'Voluntar'
            };
            const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?select=*`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(insertPayload)
            });

            if (!insertRes.ok) {
                const text = await insertRes.text();
                console.error('Failed to insert Voluntari', insertRes.status, text);
            }
        }
    } catch (err) {
        console.error('Error syncing volunteer hours to Supabase', err);
    }
}

// Sync activity to Supabase REST (table: Activitati)
async function syncActivityToSupabase(type, activity) {
    try {
        const payload = {
            // 'type' removed because the 'Activitati' table doesn't have this column
            Nume: activity.name,
            Descriere: activity.description,
            Data: activity.date,
            Ore: activity.hours,
            Locatie: activity.location || null,
            // Match Supabase column name exactly
            Organizatori: activity.organiser || null,
            "Ora Organizarii": activity.timeInterval || null,
            // Optional link to checklist task (create this column in Supabase)
            [ACTIVITY_SPECIAL_CHECKLIST_NAME_COLUMN]: activity.specialChecklistName || null
        };

        console.log('Sending activity to Supabase:', payload);

        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_ACTIVITY_TABLE}?select=*`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Supabase insert failed', res.status, text);
            return null;
        }

        const data = await res.json();
        console.log('Supabase insert success:', data);
        return data[0] || null;
    } catch (err) {
        console.error('Error syncing to Supabase', err);
        return null;
    }
}

// Add current user as participant to an activity (table: Activitati, column: Participanti)
async function addParticipantToActivitySupabase(activity) {
    const user = getCurrentUser();
    if (!user || !activity || !activity.supabase_id) return;

    // Store participation as email so "My Activities" works across devices
    const participantKey = (user.email || '').trim().toLowerCase() || null;

    if (!participantKey) return;

    try {
        const existingText = activity.participantsText || '';
        const list = existingText
            ? existingText.split(',').map(p => p.trim()).filter(Boolean)
            : [];

        const lowerSet = new Set(list.map(x => x.toLowerCase()));
        if (!lowerSet.has(participantKey)) {
            list.push(participantKey);
        }

        const updatedText = list.join(', ');

        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_ACTIVITY_TABLE}?id=eq.${activity.supabase_id}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ Participanti: updatedText })
        });

        if (!patchRes.ok) {
            const text = await patchRes.text();
            console.error('Failed to update Participanti', patchRes.status, text);
        }
    } catch (err) {
        console.error('Error updating Participanti in Supabase', err);
    }
}

// Remove current user from activity participants when they leave
async function removeParticipantFromActivitySupabase(activity) {
    const user = getCurrentUser();
    if (!user || !activity || !activity.supabase_id) return;

    const emailKey = (user.email || '').trim().toLowerCase() || null;
    const displayName =
        (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) ||
        user.email ||
        null;

    if (!emailKey && !displayName) return;

    try {
        const existingText = activity.participantsText || '';
        const list = existingText
            ? existingText.split(',').map(p => p.trim()).filter(Boolean)
            : [];

        // Remove both the email-keyed entry (new) and any legacy displayName entry (old)
        const filtered = list.filter(name => {
            const lower = (name || '').trim().toLowerCase();
            if (emailKey && lower === emailKey) return false;
            if (displayName && (name || '').trim() === displayName) return false;
            return true;
        });
        const updatedText = filtered.join(', ');

        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_ACTIVITY_TABLE}?id=eq.${activity.supabase_id}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ Participanti: updatedText })
        });

        if (!patchRes.ok) {
            const text = await patchRes.text();
            console.error('Failed to update Participanti after removal', patchRes.status, text);
        }
    } catch (err) {
        console.error('Error removing participant from Supabase', err);
    }
}

// Tab switching
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');

            // Remove active class from all
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to clicked
            button.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });
}

// Setup forms
function setupForms() {
    // Owner-only: Add New Activity - hide if not Owner (Join Activity stays visible for all)
    const addCurrentBtn = document.getElementById('add-current-activity');
    const addCurrentBox = addCurrentBtn?.closest('.action-box');
    if (!isOwner) {
        addCurrentBox?.style.setProperty('display', 'none');
    }
    addCurrentBtn?.addEventListener('click', () => {
        if (isOwner) openActivityModal('current');
    });
    document.getElementById('add-my-activity')?.addEventListener('click', () => {
        openJoinActivityModal();
    });

    // Activity form submission
    document.getElementById('activity-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const activityType = document.getElementById('modal-title').getAttribute('data-type');
        addActivity(activityType);
    });

    // Payment form submission
    document.getElementById('payment-form').addEventListener('submit', (e) => {
        e.preventDefault();
        addPayment();
    });

    // Close modals
    document.querySelector('.close').addEventListener('click', closeModal);
    document.getElementById('close-join-modal').addEventListener('click', closeJoinModal);
    document.getElementById('activity-modal').addEventListener('click', (e) => {
        if (e.target.id === 'activity-modal') closeModal();
    });
    document.getElementById('join-activity-modal').addEventListener('click', (e) => {
        if (e.target.id === 'join-activity-modal') closeJoinModal();
    });

    // Participants modal
    const closeParticipantsBtn = document.getElementById('close-participants-modal');
    if (closeParticipantsBtn) {
        closeParticipantsBtn.addEventListener('click', closeParticipantsModal);
    }
    const participantsModal = document.getElementById('participants-modal');
    if (participantsModal) {
        participantsModal.addEventListener('click', (e) => {
            if (e.target.id === 'participants-modal') closeParticipantsModal();
        });
    }

    // Owner-only: force-add participant to currently open activity
    const forceAddBtn = document.getElementById('participants-force-add-btn');
    const forceAddInput = document.getElementById('participants-force-add-input');
    if (forceAddBtn && forceAddInput) {
        const handler = async () => {
            if (!isOwner) return;
            const raw = (forceAddInput.value || '').trim();
            if (!raw) return;
            if (!activeParticipantsActivity) {
                alert('Open an activity participants list first.');
                return;
            }
            await forceAddParticipantToActivitySupabase(activeParticipantsActivity, raw);
            forceAddInput.value = '';
        };
        forceAddBtn.addEventListener('click', handler);
        forceAddInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handler();
            }
        });
    }

    // Confirm join button
    document.getElementById('confirm-join-btn').addEventListener('click', confirmJoinActivity);

    // Checklist owner form (add new checklist activity)
    const checklistForm = document.getElementById('checklist-form');
    if (checklistForm) {
        checklistForm.addEventListener('submit', (e) => {
            e.preventDefault();
            addChecklistActivity();
        });
    }

    // Controls for linking an activity to a checklist task (searchable combobox)
    const activitySpecialCheckbox = document.getElementById('activity-is-checklist-special');
    const activityChecklistSearch = document.getElementById('activity-checklist-search');
    if (activitySpecialCheckbox && activityChecklistSearch) {
        activityChecklistSearch.disabled = !activitySpecialCheckbox.checked;
        activitySpecialCheckbox.addEventListener('change', () => {
            const checked = activitySpecialCheckbox.checked;
            activityChecklistSearch.disabled = !checked;
            if (!checked) {
                activityChecklistSearch.value = '';
                const valueInput = document.getElementById('activity-checklist-value');
                if (valueInput) valueInput.value = '';
            }
        });
    }
}

// Open activity modal
function openActivityModal(type) {
    const modal = document.getElementById('activity-modal');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('activity-form');

    title.setAttribute('data-type', type);
    title.textContent = type === 'current' ? 'Add Current Activity' : 'Join Activity';
    form.reset();
    setDefaultDate();

    // Reset checklist link controls
    const activitySpecialCheckbox = document.getElementById('activity-is-checklist-special');
    const activityChecklistSearch = document.getElementById('activity-checklist-search');
    const activityChecklistValue = document.getElementById('activity-checklist-value');
    if (activitySpecialCheckbox && activityChecklistSearch) {
        activitySpecialCheckbox.checked = false;
        activityChecklistSearch.disabled = true;
        activityChecklistSearch.value = '';
        if (activityChecklistValue) activityChecklistValue.value = '';
    }

    modal.classList.add('active');
}

// Close modal
function closeModal() {
    document.getElementById('activity-modal').classList.remove('active');
}

// Open join activity modal
function openJoinActivityModal() {
    const modal = document.getElementById('join-activity-modal');
    const listContainer = document.getElementById('join-activity-list');
    const confirmBtn = document.getElementById('confirm-join-btn');
    
    selectedActivityForJoin = null;
    confirmBtn.style.display = 'none';
    
    if (currentActivities.length === 0) {
        listContainer.innerHTML = '<div class="empty-state"><p>No activities available to join. Please add activities first.</p></div>';
        modal.classList.add('active');
        return;
    }
    
    listContainer.innerHTML = currentActivities.map(activity => `
        <div class="activity-card ${activity.isChecklistSpecial ? 'activity-card-special' : ''}" style="cursor: pointer; margin-bottom: 10px;" data-activity-id="${activity.supabase_id}" onclick="selectActivityForJoin(${activity.supabase_id}, this)">
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.isChecklistSpecial && activity.specialChecklistName ? `<div class="activity-special-badge">Checklist: ${escapeHtml(activity.specialChecklistName)}</div>` : ''}
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            ${activity.location ? `<div class="activity-location">📍 ${escapeHtml(activity.location)}</div>` : ''}
            ${activity.organiser ? `<div class="activity-organiser">👤 ${escapeHtml(activity.organiser)}</div>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
            ${activity.timeInterval ? `<div class="activity-time">🕐 ${escapeHtml(activity.timeInterval)}</div>` : ''}
            <div class="activity-hours" style="margin-top: 8px; font-weight: bold;">⏱️ ${activity.hours || 0} hours</div>
            <div class="activity-participants">
                👥 ${activity.participantsCount || 0} participant${(activity.participantsCount || 0) === 1 ? '' : 's'}
            </div>
        </div>
    `).join('');
    
    modal.classList.add('active');
}

// Select activity for joining
function selectActivityForJoin(activityId, cardElement) {
    selectedActivityForJoin = currentActivities.find(a => a.supabase_id === activityId);
    const confirmBtn = document.getElementById('confirm-join-btn');
    const listContainer = document.getElementById('join-activity-list');
    
    // Highlight selected activity
    listContainer.querySelectorAll('.activity-card').forEach(card => {
        card.style.border = 'none';
        card.style.backgroundColor = '';
    });
    
    // Highlight the clicked card
    if (cardElement) {
        cardElement.style.border = '2px solid #4CAF50';
        cardElement.style.backgroundColor = '#f0f8f0';
    }
    
    confirmBtn.style.display = 'block';
}

// Confirm joining activity
async function confirmJoinActivity() {
    if (!selectedActivityForJoin) {
        alert('Please select an activity to join');
        return;
    }
    
    // Check if already joined (via Supabase participants)
    const user = getCurrentUser();
    const email = (user && user.email) ? user.email.trim().toLowerCase() : '';
    const existingList = (selectedActivityForJoin.participantsText || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
        .map(x => x.toLowerCase());
    if (email && existingList.includes(email)) {
        alert('You have already joined this activity.');
        closeJoinModal();
        return;
    }
    
    showLoading('Joining activity...');
    try {
        // Add current user to the activity's participants pool in Supabase (stores email)
        await addParticipantToActivitySupabase(selectedActivityForJoin);

        // Create a per-activity pending record, then add to volunteer pending hours
        await createPendingParticipationForCurrentUser(selectedActivityForJoin);

        // If this activity is linked to a checklist task, mark that task as done for this user
        await markChecklistDoneForActivity(selectedActivityForJoin);

        // Reload activities so participant counts and myActivities stay in sync
        await loadActivitiesFromSupabase();
        await loadCurrentVolunteerHoursFromSupabase();
        renderAll();

        closeJoinModal();
    } finally {
        hideLoading();
    }
}

// Close join modal
function closeJoinModal() {
    document.getElementById('join-activity-modal').classList.remove('active');
    selectedActivityForJoin = null;
}

// Participants modal helpers
async function openParticipantsModal(activity) {
    const modal = document.getElementById('participants-modal');
    const listEl = document.getElementById('participants-list');
    if (!modal || !listEl) return;

    activeParticipantsActivity = activity || null;

    const names = ((activity && activity.participantsText) || '')
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);

    if (names.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><p>No participants registered yet for this activity.</p></div>';
    } else {
        listEl.innerHTML = '<div class="empty-state"><p>Loading participant ranks...</p></div>';
        const infoMap = await fetchVolunteerInfoForParticipants(names);
        listEl.innerHTML = names.map(raw => {
            const key = (raw || '').trim().toLowerCase();
            const info = infoMap[key] || null;
            const rank = info && info.rank ? info.rank : '—';
            return `
                <div class="hours-item" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                    <span class="hours-item-name">${escapeHtml(info?.displayName || raw)}</span>
                    <span class="activity-special-badge" style="margin:0; background: rgba(76, 175, 80, 0.12);">${escapeHtml(rank)}</span>
                </div>
            `;
        }).join('');
    }

    modal.classList.add('active');
}

function closeParticipantsModal() {
    const modal = document.getElementById('participants-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    activeParticipantsActivity = null;
}

async function showParticipants(activityId) {
    const activity =
        currentActivities.find(a => a.supabase_id === activityId || a.id === activityId) ||
        myActivities.find(a => a.supabase_id === activityId || a.my_activity_id === activityId || a.id === activityId);

    if (!activity) return;
    await openParticipantsModal(activity);
}

// Set default date to today
function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach(input => {
        if (!input.value) {
            input.value = today;
        }
    });
}

// Add activity (only for hosting - syncs to Supabase)
async function addActivity(type) {
    // Only allow adding current activities (hosted activities)
    if (type !== 'current') {
        console.warn('Use join activity modal to join activities');
        return;
    }
    
    const name = document.getElementById('activity-name').value;
    const description = document.getElementById('activity-description').value;
    const date = document.getElementById('activity-date').value;
    const hours = parseFloat(document.getElementById('activity-hours').value);
    const organiser = document.getElementById('activity-organiser').value;
    const location = document.getElementById('activity-location').value;
    const timeInterval = document.getElementById('activity-time-interval').value;

    const specialCheckbox = document.getElementById('activity-is-checklist-special');
    const checklistValueInput = document.getElementById('activity-checklist-value');
    const isChecklistSpecial = specialCheckbox ? !!specialCheckbox.checked : false;
    const selectedChecklistName =
        isChecklistSpecial && checklistValueInput && checklistValueInput.value
            ? checklistValueInput.value.trim()
            : '';

    const activity = {
        name,
        description,
        date,
        hours,
        organiser: organiser || '',
        location: location || '',
        timeInterval: timeInterval || '',
        isChecklistSpecial,
        specialChecklistName: selectedChecklistName || null
    };

    showLoading('Adding activity...');
    try {
        // Sync to Supabase
        const supaResult = await syncActivityToSupabase(type, activity);
        if (supaResult && supaResult.id) {
            // Reload activities from Supabase to get the latest
            await loadActivitiesFromSupabase();
            renderAll();
            closeModal();
        } else {
            alert('Failed to add activity. Please try again.');
        }
    } finally {
        hideLoading();
    }
}

// Add a new checklist activity (owner only) to ChecklistACTIVITYS table
async function addChecklistActivity() {
    if (!isOwner) {
        console.warn('Only owners can add checklist activities');
        return;
    }

    const nameInput = document.getElementById('checklist-name');
    if (!nameInput || !nameInput.value.trim()) return;

    const name = nameInput.value.trim();

    const payload = {};
    payload[CHECKLIST_NAME_COLUMN] = name;
    payload[CHECKLIST_FINISHED_COLUMN] = '';
    payload[CHECKLIST_IN_PROGRESS_COLUMN] = '';
    payload[CHECKLIST_REQUIRED_2_COLUMN] = false;

    showLoading('Adding checklist activity...');
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_CHECKLIST_TABLE}?select=*`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Supabase checklist insert failed', res.status, text);
            alert('Failed to add checklist activity. Please check Supabase column names and try again.');
            return;
        }

        await loadChecklistFromSupabase();
        renderChecklist();

        // Reset form fields
        nameInput.value = '';
    } finally {
        hideLoading();
    }
}

// When a user joins a special activity, mark the linked checklist task as done for them
async function markChecklistDoneForActivity(activity) {
    const user = getCurrentUser();
    if (!user || !user.email || !activity || !activity.specialChecklistName) return;

    const email = user.email.trim();
    if (!email) return;

    const item = checklistActivities.find(
        a => (a.name || '').toLowerCase() === activity.specialChecklistName.toLowerCase()
    );
    if (!item) return;

    const finishedList = (item.finishedRaw || '')
        ? item.finishedRaw.split(',').map(x => x.trim()).filter(Boolean)
        : [];
    const inProgressList = (item.inProgressRaw || '')
        ? item.inProgressRaw.split(',').map(x => x.trim()).filter(Boolean)
        : [];

    const emailLower = email.toLowerCase();
    const alreadyFinished = finishedList.some(x => x.toLowerCase() === emailLower);
    if (alreadyFinished) return;

    const inProgressIndex = inProgressList.findIndex(x => x.toLowerCase() === emailLower);

    let newFinished = [...finishedList];
    let newInProgress = [...inProgressList];

    if (item.required2) {
        // Requires 2 participations: first goes to In progress, second moves to Finisshed list
        if (inProgressIndex >= 0) {
            // Already in progress -> move to finished
            newInProgress.splice(inProgressIndex, 1);
            newFinished.push(email);
        } else {
            // First participation -> add to in progress
            newInProgress.push(email);
        }
    } else {
        // Single participation -> add directly to finished
        newFinished.push(email);
    }

    const payload = {};
    payload[CHECKLIST_FINISHED_COLUMN] = newFinished.join(', ');
    payload[CHECKLIST_IN_PROGRESS_COLUMN] = newInProgress.join(', ');

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_CHECKLIST_TABLE}?id=eq.${item.supabase_id}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Supabase checklist update failed', res.status, text);
            return;
        }

        await loadChecklistFromSupabase();
        renderChecklist();

        if (isOwner) {
            renderVolunteerStats();
        }
    } catch (err) {
        console.error('Error updating checklist when joining activity', err);
    }
}

// Delete activity from Supabase
async function deleteActivityFromSupabase(supabaseId) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_ACTIVITY_TABLE}?id=eq.${supabaseId}`, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Supabase delete failed', res.status, text);
            return false;
        }

        console.log('Activity deleted from Supabase successfully');
        return true;
    } catch (err) {
        console.error('Error deleting from Supabase', err);
        return false;
    }
}

// Delete activity
async function deleteActivity(type, id) {
    showLoading('Deleting activity...');
    try {
        if (type === 'current') {
            // Delete hosted activity from Supabase
            const activity = currentActivities.find(a => a.id === id || a.supabase_id === id);
            if (activity && activity.supabase_id) {
                await deleteActivityFromSupabase(activity.supabase_id);
                // Also remove from joined list if it was joined
                joinedActivityIds = joinedActivityIds.filter(joinedId => joinedId !== activity.supabase_id);
                saveData();
                await loadActivitiesFromSupabase();
            }
        } else {
            // Remove from joined list (don't delete from Supabase, just unjoin)
            const activity = myActivities.find(a => a.id === id || a.my_activity_id === id);
            if (activity && activity.supabase_id) {
                // Also remove user from participants pool for this activity
                await removeParticipantFromActivitySupabase(activity);
                await loadActivitiesFromSupabase();
                await loadCurrentVolunteerHoursFromSupabase();
            }
        }

        renderAll();
    } finally {
        hideLoading();
    }
}

// Add payment
function addPayment() {
    const amount = parseFloat(document.getElementById('payment-amount').value);
    const date = document.getElementById('payment-date').value;
    const description = document.getElementById('payment-description').value || 'Payment';

    const payment = {
        id: Date.now(),
        amount,
        date,
        description
    };

    payments.push(payment);
    saveData();
    renderAll();
    document.getElementById('payment-form').reset();
    setDefaultDate();
}

// Delete payment
function deletePayment(id) {
    payments = payments.filter(p => p.id !== id);
    saveData();
    renderAll();
}

// Calculate total hours
function calculateTotalHours() {
    // "Total Hours" should represent approved hours only
    return Number(currentVolunteerHoursApproved || 0);
}

// Calculate total paid
function calculateTotalPaid() {
    return payments.reduce((total, payment) => total + (payment.amount || 0), 0);
}

// Render all sections
function renderAll() {
    renderCurrentActivities();
    renderMyActivities();
    renderTotalHours();
    renderPayments();
    renderChecklist();
}

// Render current activities
function renderCurrentActivities() {
    const container = document.getElementById('current-activities-list');
    
    if (currentActivities.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No activities yet. Click "Add New Activity" to get started!</p></div>';
        return;
    }

    container.innerHTML = currentActivities.map(activity => `
        <div class="activity-card ${activity.isChecklistSpecial ? 'activity-card-special' : ''}">
            ${isOwner ? `<button class="delete-btn" onclick="deleteActivity('current', ${activity.supabase_id || activity.id})" title="Delete">×</button>` : ''}
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.isChecklistSpecial && activity.specialChecklistName ? `<div class="activity-special-badge">Checklist: ${escapeHtml(activity.specialChecklistName)}</div>` : ''}
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            ${activity.location ? `<div class="activity-location">📍 ${escapeHtml(activity.location)}</div>` : ''}
            ${activity.organiser ? `<div class="activity-organiser">👤 ${escapeHtml(activity.organiser)}</div>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
            ${activity.timeInterval ? `<div class="activity-time">🕐 ${escapeHtml(activity.timeInterval)}</div>` : ''}
            <div class="activity-participants clickable" onclick="showParticipants(${activity.supabase_id || activity.id})" title="View participants">
                👥 ${activity.participantsCount || 0} participant${(activity.participantsCount || 0) === 1 ? '' : 's'}
            </div>
        </div>
    `).join('');
}

// Render my activities
function renderMyActivities() {
    const container = document.getElementById('my-activities-list');
    
    if (myActivities.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>You haven\'t joined any activities yet. Click "Join Activity" to get started!</p></div>';
        return;
    }

    container.innerHTML = myActivities.map(activity => `
        <div class="activity-card ${activity.isChecklistSpecial ? 'activity-card-special' : ''}">
            <button class="delete-btn" onclick="deleteActivity('my', ${activity.my_activity_id || activity.id})" title="Leave activity">×</button>
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.isChecklistSpecial && activity.specialChecklistName ? `<div class="activity-special-badge">Checklist: ${escapeHtml(activity.specialChecklistName)}</div>` : ''}
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            ${activity.location ? `<div class="activity-location">📍 ${escapeHtml(activity.location)}</div>` : ''}
            ${activity.organiser ? `<div class="activity-organiser">👤 ${escapeHtml(activity.organiser)}</div>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
            ${activity.timeInterval ? `<div class="activity-time">🕐 ${escapeHtml(activity.timeInterval)}</div>` : ''}
            <div class="activity-hours">${activity.hours || 0} hours</div>
            <div class="activity-participants clickable" onclick="showParticipants(${activity.supabase_id || activity.my_activity_id || activity.id})" title="View participants">
                👥 ${activity.participantsCount || 0} participant${(activity.participantsCount || 0) === 1 ? '' : 's'}
            </div>
        </div>
    `).join('');
}

// Render total hours
function renderTotalHours() {
    const approved = Number(currentVolunteerHoursApproved || 0);
    const pending = Number(currentVolunteerHoursPending || 0);
    const totalHours = approved;

    const totalEl = document.getElementById('total-hours-display');
    if (totalEl) totalEl.textContent = totalHours.toFixed(1);
    const pendingEl = document.getElementById('pending-hours-display');
    if (pendingEl) pendingEl.textContent = pending.toFixed(1);

    // Update progress bar out of 120 hours
    const PROGRESS_GOAL = 120;
    const percent = Math.max(0, Math.min(100, (totalHours / PROGRESS_GOAL) * 100));
    const fill = document.getElementById('hours-progress-fill');
    const label = document.getElementById('hours-progress-label');
    if (fill) {
        fill.style.width = `${percent}%`;
    }
    if (label) {
        label.textContent = `${totalHours.toFixed(1)} / ${PROGRESS_GOAL} approved hours (${percent.toFixed(1)}%)`;
    }

    const breakdown = document.getElementById('hours-breakdown');
    
    if (myActivities.length === 0) {
        breakdown.innerHTML = '<div class="empty-state"><p>No activities to display hours for.</p></div>';
        return;
    }

    breakdown.innerHTML = myActivities.map(activity => `
        <div class="hours-item">
            <span class="hours-item-name">${escapeHtml(activity.name)}</span>
            <span class="hours-item-value">${activity.hours || 0} hours</span>
        </div>
    `).join('');
}

// Render payments
function renderPayments() {
    const totalPaid = calculateTotalPaid();
    document.getElementById('total-paid').textContent = `€${totalPaid.toFixed(2)}`;

    const container = document.getElementById('payment-list');
    
    if (payments.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No payments recorded yet.</p></div>';
        return;
    }

    // Sort payments by date (newest first)
    const sortedPayments = [...payments].sort((a, b) => new Date(b.date) - new Date(a.date));

    container.innerHTML = sortedPayments.map(payment => `
        <div class="payment-item">
            <div class="payment-item-info">
                <div class="payment-item-description">${escapeHtml(payment.description)}</div>
                <div class="payment-item-date">${formatDate(payment.date)}</div>
            </div>
            <div style="display: flex; align-items: center;">
                <span class="payment-item-amount">€${payment.amount.toFixed(2)}</span>
                <button class="delete-btn" onclick="deletePayment(${payment.id})" title="Delete">×</button>
            </div>
        </div>
    `).join('');
}

// Render checklist activities
function renderChecklist() {
    const container = document.getElementById('checklist-list');
    if (!container) return;

    if (!checklistActivities || checklistActivities.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No checklist activities defined yet.</p></div>';
        return;
    }

    container.innerHTML = checklistActivities.map(item => {
        const classes = [
            'checklist-item',
            item.isCompletedByCurrentUser ? 'checklist-item-completed' : '',
            item.isInProgressByCurrentUser && item.required2 ? 'checklist-item-in-progress' : ''
        ].filter(Boolean).join(' ');

        let checkIcon = '⬜';
        if (item.isCompletedByCurrentUser) {
            checkIcon = '✅';
        } else if (item.isInProgressByCurrentUser && item.required2) {
            checkIcon = '🔄'; // In progress (1/2)
        }

        const metaText = isOwner
            ? (item.required2
                ? `${item.finishedCount || 0} finished · ${item.inProgressCount || 0} in progress`
                : `${item.finishedCount || 0} finished`)
            : (item.required2 ? `Requires 2 participations` : ``);

        return `
            <div class="${classes}">
                <div class="checklist-main">
                    <span class="checklist-check">${checkIcon}</span>
                    <span class="checklist-name">${escapeHtml(item.name || '')}</span>
                    ${item.required2 ? '<span class="checklist-badge">2×</span>' : ''}
                </div>
                ${metaText ? `<div class="checklist-meta">${metaText}</div>` : ``}
            </div>
        `;
    }).join('');
}

// Fetch volunteer info (rank + canonical name) for participant identifiers (email or name).
// Returns a map keyed by lowercase identifier.
async function fetchVolunteerInfoForParticipants(participants) {
    const list = (participants || []).map(x => (x || '').trim()).filter(Boolean);
    const map = {};
    list.forEach(x => {
        map[x.toLowerCase()] = { displayName: x, rank: null };
    });
    if (list.length === 0) return map;

    // Build an OR filter for exact match on Email or NumeComplet (case-sensitive in PostgREST)
    const orParts = [];
    list.forEach(val => {
        const safe = val.replace(/,/g, ''); // avoid breaking or=()
        orParts.push(`Email.eq.${encodeURIComponent(safe)}`);
        orParts.push(`NumeComplet.eq.${encodeURIComponent(safe)}`);
    });
    const orFilter = `or=(${orParts.join(',')})`;

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?select=Email,NumeComplet,Privilegii&${orFilter}`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) return map;
        const rows = await res.json();
        rows.forEach(v => {
            const email = (v.Email || '').trim();
            const name = (v.NumeComplet || '').trim();
            const rank = (v.Privilegii || '').trim() || null;
            const display = name || email || 'Unknown';

            if (email) {
                map[email.toLowerCase()] = { displayName: display, rank };
            }
            if (name) {
                map[name.toLowerCase()] = { displayName: display, rank };
            }
        });
        return map;
    } catch (err) {
        console.error('Error fetching volunteer info for participants', err);
        return map;
    }
}

// Owner-only: add an arbitrary participant identifier to an activity in Supabase.
async function forceAddParticipantToActivitySupabase(activity, rawIdentifier) {
    if (!isOwner || !activity || !activity.supabase_id) return;
    const identifier = (rawIdentifier || '').trim();
    if (!identifier) return;

    showLoading('Adding participant...');
    try {
        const existingText = activity.participantsText || '';
        const list = existingText
            ? existingText.split(',').map(p => p.trim()).filter(Boolean)
            : [];

        const lowerSet = new Set(list.map(x => x.toLowerCase()));
        if (!lowerSet.has(identifier.toLowerCase())) {
            list.push(identifier);
        }

        const updatedText = list.join(', ');
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_ACTIVITY_TABLE}?id=eq.${activity.supabase_id}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ Participanti: updatedText })
        });

        if (!patchRes.ok) {
            const text = await patchRes.text();
            console.error('Failed to force add participant', patchRes.status, text);
            alert('Failed to add participant. Please try again.');
            return;
        }

        await loadActivitiesFromSupabase();
        renderAll();

        // Re-open participants modal with updated activity data
        const updated =
            currentActivities.find(a => a.supabase_id === activity.supabase_id) ||
            myActivities.find(a => a.supabase_id === activity.supabase_id);
        if (updated) {
            await openParticipantsModal(updated);
        }
    } catch (err) {
        console.error('Error force adding participant', err);
        alert('Error adding participant. Please try again.');
    } finally {
        hideLoading();
    }
}

// Owner-only: load all volunteers from Supabase (for stats tab)
async function loadAllVolunteersForOwner() {
    if (!isOwner) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?select=id,NumeComplet,Email,OreVoluntariat,OreNeaprobate,Privilegii`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Failed to load volunteers for stats', res.status, text);
            return;
        }

        allVolunteers = await res.json();
        await loadPendingParticipationsForOwner();
        initializeAvailableVolunteerRanks();
        setupVolunteerRankFilterOptions();
        setupVolunteerFilterListeners();
        renderVolunteerStats();
    } catch (err) {
        console.error('Error loading volunteers for stats', err);
    }
}

// Initialize available rank list from loaded volunteers
function initializeAvailableVolunteerRanks() {
    availableVolunteerRanks = Array.from(new Set(
        ['Voluntar']
            .concat((allVolunteers || []).map(v => (v.Privilegii || '').trim()).filter(Boolean))
    ));
}

// Build rank filter options from loaded volunteers and custom ranks
function setupVolunteerRankFilterOptions() {
    const select = document.getElementById('volunteer-rank-filter');
    if (!select || !allVolunteers) return;

    const currentValue = select.value;
    const ranks = Array.from(new Set(availableVolunteerRanks)).sort();

    select.innerHTML = '<option value="">All ranks</option>' +
        ranks.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

    // Try to preserve previous selection if still valid
    if (currentValue && ranks.includes(currentValue)) {
        select.value = currentValue;
    }
}

// Attach listeners for search + rank filter once
let volunteerFiltersInitialized = false;
function setupVolunteerFilterListeners() {
    if (volunteerFiltersInitialized) return;
    const searchInput = document.getElementById('volunteer-search');
    const rankSelect = document.getElementById('volunteer-rank-filter');
    const addRankInput = document.getElementById('volunteer-rank-add-input');
    const addRankBtn = document.getElementById('volunteer-rank-add-btn');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderVolunteerStats();
        });
    }
    if (rankSelect) {
        rankSelect.addEventListener('change', () => {
            renderVolunteerStats();
        });
    }
    if (addRankBtn && addRankInput) {
        const handler = () => {
            addNewVolunteerRank(addRankInput.value);
        };
        addRankBtn.addEventListener('click', handler);
        addRankInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handler();
            }
        });
    }
    volunteerFiltersInitialized = true;
}

// Add a new rank value to the available list (owner only)
function addNewVolunteerRank(rawValue) {
    if (!isOwner) return;
    const value = (rawValue || '').trim();
    if (!value) return;
    if (!availableVolunteerRanks.includes(value)) {
        availableVolunteerRanks.push(value);
    }
    setupVolunteerRankFilterOptions();
    renderVolunteerStats();
    const input = document.getElementById('volunteer-rank-add-input');
    if (input) input.value = '';
}

// Build HTML options for rank selects, marking current value as selected
function buildRankOptionsHtml(currentValue) {
    const normalizedCurrent = (currentValue || '').trim() || 'Voluntar';

    const rankSet = new Set(availableVolunteerRanks || []);
    rankSet.add('Voluntar');

    const ranks = Array.from(rankSet).sort((a, b) => a.localeCompare(b));

    // Keep "Voluntar" as the first option
    const ordered = ['Voluntar'].concat(ranks.filter(r => r !== 'Voluntar'));

    let html = '';
    ordered.forEach(r => {
        const selected = r === normalizedCurrent ? ' selected' : '';
        const safe = escapeHtml(r);
        html += `<option value="${safe}"${selected}>${safe}</option>`;
    });
    return html;
}

// Change a volunteer's rank from the stats tab (Owner only)
async function changeVolunteerRank(volunteerId, newRank) {
    if (!isOwner || !volunteerId) return;
    showLoading('Updating rank...');
    try {
        const normalizedRank = (newRank || '').trim() || 'Voluntar';
        const payload = {
            Privilegii: normalizedRank
        };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?id=eq.${volunteerId}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('Failed to update volunteer rank', res.status, text);
            alert('Failed to update rank. Please try again.');
            return;
        }

        // Update local cache
        allVolunteers = allVolunteers.map(v =>
            v.id === volunteerId ? { ...v, Privilegii: normalizedRank } : v
        );

        if (normalizedRank && !availableVolunteerRanks.includes(normalizedRank)) {
            availableVolunteerRanks.push(normalizedRank);
            setupVolunteerRankFilterOptions();
        }

        renderVolunteerStats();
    } catch (err) {
        console.error('Error updating volunteer rank', err);
        alert('Error updating rank. Please try again.');
    } finally {
        hideLoading();
    }
}

// Render owner-only volunteer stats tab
function renderVolunteerStats() {
    const container = document.getElementById('volunteer-stats-content');
    if (!container) return;

    if (!allVolunteers || allVolunteers.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No volunteers found in Supabase yet.</p></div>';
        return;
    }

    const searchInput = document.getElementById('volunteer-search');
    const rankSelect = document.getElementById('volunteer-rank-filter');
    const searchTerm = (searchInput?.value || '').toLowerCase().trim();
    const selectedRank = (rankSelect?.value || '').trim();

    const filtered = allVolunteers.filter(v => {
        const name = (v.NumeComplet || '').toLowerCase();
        const email = (v.Email || '').toLowerCase();
        const rank = (v.Privilegii || '').trim();

        const matchesSearch = !searchTerm ||
            name.includes(searchTerm) ||
            email.includes(searchTerm);

        const matchesRank = !selectedRank || rank === selectedRank;

        return matchesSearch && matchesRank;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No volunteers match your search/filter.</p></div>';
        return;
    }

    container.innerHTML = filtered.map(v => {
        const email = (v.Email || '').toLowerCase();
        const checklistDone = email && checklistCompletionCounts[email] ? checklistCompletionCounts[email] : 0;
        const pending = Number(v.OreNeaprobate || 0);
        const pendingItems = (pendingParticipationsForOwner || [])
            .filter(p => (p.VolunteerEmail || '').toLowerCase() === email && (p.Status || '').toLowerCase() === 'pending');

        const pendingHtml = pendingItems.length === 0
            ? `<div style="margin-top: 6px; font-size: 0.8rem; color: var(--gray);">No pending activities</div>`
            : `
                <div style="margin-top: 8px;">
                    <div style="font-size: 0.85rem; font-weight: 600; color: var(--dark-gray); margin-bottom: 6px;">Pending activity hours</div>
                    ${pendingItems.map(item => `
                        <div class="hours-item" style="padding: 10px 12px; margin: 6px 0; border: 1px solid rgba(255,193,7,0.35); border-radius: 10px; background: rgba(255,193,7,0.08);">
                            <div style="display:flex; align-items:center; justify-content:space-between; gap: 12px;">
                                <div style="min-width:0;">
                                    <div style="font-weight: 600; color: var(--dark-gray); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                        ${escapeHtml(item.ActivityName || 'Activity')}
                                    </div>
                                    <div style="font-size: 0.8rem; color: var(--gray); margin-top: 2px;">
                                        ${Number(item.Hours || 0).toFixed(1)} hours
                                    </div>
                                </div>
                                <div style="display:flex; gap: 8px; flex-shrink:0;">
                                    <button class="volunteer-rank-add-btn" style="padding: 6px 10px;" onclick="approveParticipation(${item.id})">Approve</button>
                                    <button class="volunteer-rank-add-btn" style="padding: 6px 10px; background: rgba(244,67,54,0.12); border: 2px solid rgba(244,67,54,0.25);" onclick="declineParticipation(${item.id})">Decline</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        return `
        <div class="payment-item">
            <div class="payment-item-info">
                <div class="payment-item-description">${escapeHtml(v.NumeComplet || v.Email || 'Unknown')}</div>
                <div class="payment-item-date">${escapeHtml(v.Email || '')}</div>
                <div style="margin-top: 4px; font-size: 0.8rem; color: var(--gray);">
                    Checklist activities done: <strong>${checklistDone}</strong>
                </div>
                <div style="margin-top: 4px; font-size: 0.8rem; color: var(--gray);">
                    Pending hours (total): <strong>${pending.toFixed(1)}</strong>
                </div>
                ${pendingHtml}
                <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.85rem; color: var(--gray);">Rank:</span>
                    <select class="volunteer-rank-select" onchange="changeVolunteerRank(${v.id}, this.value)">
                        ${buildRankOptionsHtml(v.Privilegii || '')}
                    </select>
                </div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                <span class="payment-item-amount">${(v.OreVoluntariat || 0).toFixed ? v.OreVoluntariat.toFixed(1) : Number(v.OreVoluntariat || 0).toFixed(1)} h</span>
                <span style="font-size: 0.8rem; color: var(--gray);">Last payment: N/A</span>
            </div>
        </div>
    `;
    }).join('');
}

async function loadCurrentVolunteerHoursFromSupabase() {
    const user = getCurrentUser();
    const email = (user && user.email) ? user.email.trim() : '';
    if (!email) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?Email=eq.${encodeURIComponent(email)}&select=id,OreVoluntariat,OreNeaprobate`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const row = rows && rows[0] ? rows[0] : null;
        currentVolunteerHoursApproved = Number(row?.OreVoluntariat || 0);
        currentVolunteerHoursPending = Number(row?.OreNeaprobate || 0);
    } catch (err) {
        console.error('Error loading current volunteer hours', err);
    }
}

async function ensureVolunteerRowExistsForCurrentUser() {
    const user = getCurrentUser();
    const email = (user && user.email) ? user.email.trim() : '';
    if (!email) return null;

    const name = (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) || email;

    try {
        const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?Email=eq.${encodeURIComponent(email)}&select=id`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!checkRes.ok) return null;
        const rows = await checkRes.json();
        if (rows.length > 0) return rows[0];

        const insertPayload = {
            NumeComplet: name,
            Email: email,
            OreVoluntariat: 0,
            OreNeaprobate: 0,
            Privilegii: 'Voluntar'
        };
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?select=*`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(insertPayload)
        });
        if (!insertRes.ok) return null;
        const inserted = await insertRes.json();
        return inserted && inserted[0] ? inserted[0] : null;
    } catch (err) {
        console.error('Error ensuring volunteer row exists', err);
        return null;
    }
}

async function addPendingHoursForCurrentVolunteer(hoursToAdd) {
    const hours = Number(hoursToAdd || 0);
    if (!hours) return;

    const user = getCurrentUser();
    const email = (user && user.email) ? user.email.trim() : '';
    if (!email) return;

    await ensureVolunteerRowExistsForCurrentUser();

    // Read current pending hours, then PATCH with new value (avoids requiring SQL RPC)
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?Email=eq.${encodeURIComponent(email)}&select=id,OreNeaprobate`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const row = rows && rows[0] ? rows[0] : null;
        if (!row?.id) return;
        const currentPending = Number(row.OreNeaprobate || 0);
        const nextPending = currentPending + hours;

        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?id=eq.${row.id}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ OreNeaprobate: nextPending })
        });
        if (!patchRes.ok) return;
        currentVolunteerHoursPending = nextPending;
    } catch (err) {
        console.error('Error adding pending hours', err);
    }
}

async function approveVolunteerPendingHours(volunteerId) {
    if (!isOwner || !volunteerId) return;
    showLoading('Approving hours...');
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?id=eq.${volunteerId}&select=id,OreVoluntariat,OreNeaprobate`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const row = rows && rows[0] ? rows[0] : null;
        if (!row) return;

        const approved = Number(row.OreVoluntariat || 0);
        const pending = Number(row.OreNeaprobate || 0);
        if (pending <= 0) return;

        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?id=eq.${volunteerId}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                OreVoluntariat: approved + pending,
                OreNeaprobate: 0
            })
        });
        if (!patchRes.ok) {
            const text = await patchRes.text();
            console.error('Failed to approve hours', patchRes.status, text);
            alert('Failed to approve hours. Please try again.');
            return;
        }

        await loadAllVolunteersForOwner();
        await loadCurrentVolunteerHoursFromSupabase();
        renderAll();
    } catch (err) {
        console.error('Error approving pending hours', err);
        alert('Error approving hours. Please try again.');
    } finally {
        hideLoading();
    }
}

async function loadPendingParticipationsForOwner() {
    if (!isOwner) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_PARTICIPATION_TABLE}?select=id,VolunteerEmail,ActivityId,ActivityName,Hours,Status&Status=eq.Pending`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) {
            pendingParticipationsForOwner = [];
            return;
        }
        pendingParticipationsForOwner = await res.json();
    } catch (err) {
        console.error('Error loading pending participations', err);
        pendingParticipationsForOwner = [];
    }
}

async function createPendingParticipationForCurrentUser(activity) {
    const user = getCurrentUser();
    const email = (user && user.email) ? user.email.trim().toLowerCase() : '';
    if (!email || !activity?.supabase_id) return;

    const hours = Number(activity.hours || 0);
    if (!hours) return;

    try {
        const payload = {
            VolunteerEmail: email,
            ActivityId: activity.supabase_id,
            ActivityName: activity.name || '',
            Hours: hours,
            Status: 'Pending'
        };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_PARTICIPATION_TABLE}?select=*`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const text = await res.text();
            console.error('Failed to create participation record', res.status, text);
            return;
        }
    } catch (err) {
        console.error('Error creating participation record', err);
        return;
    }

    // Keep aggregate pending hours in Voluntari for fast display
    await addPendingHoursForCurrentVolunteer(hours);
}

async function approveParticipation(participationId) {
    if (!isOwner || !participationId) return;
    showLoading('Approving activity...');
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_PARTICIPATION_TABLE}?id=eq.${participationId}&select=*`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const row = rows && rows[0] ? rows[0] : null;
        if (!row || (row.Status || '').toLowerCase() !== 'pending') return;

        const email = (row.VolunteerEmail || '').trim().toLowerCase();
        const hours = Number(row.Hours || 0);
        if (!email || !hours) return;

        const vRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?Email=eq.${encodeURIComponent(email)}&select=id,OreVoluntariat,OreNeaprobate`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!vRes.ok) return;
        const vRows = await vRes.json();
        const vRow = vRows && vRows[0] ? vRows[0] : null;
        if (!vRow?.id) return;

        const approved = Number(vRow.OreVoluntariat || 0);
        const pending = Number(vRow.OreNeaprobate || 0);
        const nextPending = Math.max(0, pending - hours);

        await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?id=eq.${vRow.id}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ OreVoluntariat: approved + hours, OreNeaprobate: nextPending })
            }),
            fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_PARTICIPATION_TABLE}?id=eq.${participationId}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ Status: 'Approved' })
            })
        ]);

        await loadAllVolunteersForOwner();
        await loadCurrentVolunteerHoursFromSupabase();
        renderAll();
    } catch (err) {
        console.error('Error approving participation', err);
        alert('Error approving activity. Please try again.');
    } finally {
        hideLoading();
    }
}

async function declineParticipation(participationId) {
    if (!isOwner || !participationId) return;
    showLoading('Declining activity...');
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_PARTICIPATION_TABLE}?id=eq.${participationId}&select=*`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const row = rows && rows[0] ? rows[0] : null;
        if (!row || (row.Status || '').toLowerCase() !== 'pending') return;

        const email = (row.VolunteerEmail || '').trim().toLowerCase();
        const hours = Number(row.Hours || 0);
        if (!email || !hours) return;

        const vRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?Email=eq.${encodeURIComponent(email)}&select=id,OreNeaprobate`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!vRes.ok) return;
        const vRows = await vRes.json();
        const vRow = vRows && vRows[0] ? vRows[0] : null;
        if (!vRow?.id) return;

        const pending = Number(vRow.OreNeaprobate || 0);
        const nextPending = Math.max(0, pending - hours);

        await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?id=eq.${vRow.id}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ OreNeaprobate: nextPending })
            }),
            fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_PARTICIPATION_TABLE}?id=eq.${participationId}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ Status: 'Declined' })
            })
        ]);

        await loadAllVolunteersForOwner();
        await loadCurrentVolunteerHoursFromSupabase();
        renderAll();
    } catch (err) {
        console.error('Error declining participation', err);
        alert('Error declining activity. Please try again.');
    } finally {
        hideLoading();
    }
}

// Utility functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions available globally for onclick handlers
window.deleteActivity = deleteActivity;
window.deletePayment = deletePayment;
window.selectActivityForJoin = selectActivityForJoin;
window.showParticipants = showParticipants;
window.changeVolunteerRank = changeVolunteerRank;
window.approveVolunteerPendingHours = approveVolunteerPendingHours;
window.approveParticipation = approveParticipation;
window.declineParticipation = declineParticipation;

