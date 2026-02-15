// Data storage (activities only in Supabase, payments still local)
let currentActivities = [];
let myActivities = [];
let payments = [];
let selectedActivityForJoin = null;
let joinedActivityIds = []; // Track which activity IDs the user has joined
let userPrivilegii = null; // Rank from Voluntari (Privilegii column)
let isOwner = false; // true when Privilegii === "Owner"

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

// Load data from Supabase (activities) and localStorage (payments and joined IDs)
async function loadData() {
    // Load payments from localStorage (still using local storage for payments)
    const savedPayments = localStorage.getItem('ausf_payments');
    if (savedPayments) payments = JSON.parse(savedPayments);

    // Load joined activity IDs from localStorage
    const savedJoinedIds = localStorage.getItem('ausf_joinedActivityIds');
    if (savedJoinedIds) joinedActivityIds = JSON.parse(savedJoinedIds);

    // Load activities from Supabase
    await loadActivitiesFromSupabase();
    
    // Re-render with Supabase data
    renderAll();
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
        currentActivities = rows.map(row => ({
            id: row.id || Date.now(),
            name: row.Nume || '',
            description: row.Descriere || '',
            date: row.Data || new Date().toISOString().split('T')[0],
            hours: parseFloat(row.Ore) || 0,
            organiser: row.Organizatori || '',
            location: row.Locatie || '',
            timeInterval: row["Ora Organizarii"] || '', // Time interval when activity is hosted
            supabase_id: row.id
        }));
        
        // Rebuild myActivities after loading currentActivities
        buildMyActivities();
    } catch (err) {
        console.error('Error loading activities from Supabase', err);
        currentActivities = [];
    }
}

// Build myActivities from currentActivities based on joined IDs
function buildMyActivities() {
    // Filter activities that are in joinedActivityIds
    // Use the activity's Ore (hours) from Supabase, not user input
    myActivities = currentActivities
        .filter(activity => joinedActivityIds.includes(activity.supabase_id))
        .map(activity => ({
            ...activity,
            my_activity_id: activity.supabase_id // Use supabase_id as the identifier
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
            // 2) Update existing row
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
            // 3) Create new volunteer row
            const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_VOLUNTEER_TABLE}?select=*`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(payload)
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
            "Ora Organizarii": activity.timeInterval || null
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

    // Confirm join button
    document.getElementById('confirm-join-btn').addEventListener('click', confirmJoinActivity);
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
        <div class="activity-card" style="cursor: pointer; margin-bottom: 10px;" data-activity-id="${activity.supabase_id}" onclick="selectActivityForJoin(${activity.supabase_id}, this)">
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            ${activity.location ? `<div class="activity-location">📍 ${escapeHtml(activity.location)}</div>` : ''}
            ${activity.organiser ? `<div class="activity-organiser">👤 ${escapeHtml(activity.organiser)}</div>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
            ${activity.timeInterval ? `<div class="activity-time">🕐 ${escapeHtml(activity.timeInterval)}</div>` : ''}
            <div class="activity-hours" style="margin-top: 8px; font-weight: bold;">⏱️ ${activity.hours || 0} hours</div>
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
    
    // Check if already joined
    if (joinedActivityIds.includes(selectedActivityForJoin.supabase_id)) {
        alert('You have already joined this activity.');
        closeJoinModal();
        return;
    }
    
    // Add to joined list (hours come from the activity's Ore field in Supabase)
    joinedActivityIds.push(selectedActivityForJoin.supabase_id);
    
    // Save joined IDs
    saveData();
    
    // Rebuild myActivities (will use the activity's Ore from Supabase)
    buildMyActivities();
    
    // Re-render
    renderAll();

    // Sync volunteer hours after join
    const totalHours = calculateTotalHours();
    syncVolunteerHoursToSupabase(totalHours);

    closeJoinModal();
}

// Close join modal
function closeJoinModal() {
    document.getElementById('join-activity-modal').classList.remove('active');
    selectedActivityForJoin = null;
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

    const activity = {
        name,
        description,
        date,
        hours,
        organiser: organiser || '',
        location: location || '',
        timeInterval: timeInterval || ''
    };

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
            joinedActivityIds = joinedActivityIds.filter(joinedId => joinedId !== activity.supabase_id);
            saveData();
            buildMyActivities();
        }
    }

    renderAll();

    // Sync volunteer hours after unjoin/delete
    const totalHours = calculateTotalHours();
    syncVolunteerHoursToSupabase(totalHours);
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
    return myActivities.reduce((total, activity) => total + (activity.hours || 0), 0);
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

    // Also make sure volunteer hours are synced when UI renders,
    // e.g., on initial load after activities are loaded.
    const totalHours = calculateTotalHours();
    syncVolunteerHoursToSupabase(totalHours);
}

// Render current activities
function renderCurrentActivities() {
    const container = document.getElementById('current-activities-list');
    
    if (currentActivities.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No activities yet. Click "Add New Activity" to get started!</p></div>';
        return;
    }

    container.innerHTML = currentActivities.map(activity => `
        <div class="activity-card">
            ${isOwner ? `<button class="delete-btn" onclick="deleteActivity('current', ${activity.supabase_id || activity.id})" title="Delete">×</button>` : ''}
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            ${activity.location ? `<div class="activity-location">📍 ${escapeHtml(activity.location)}</div>` : ''}
            ${activity.organiser ? `<div class="activity-organiser">👤 ${escapeHtml(activity.organiser)}</div>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
            ${activity.timeInterval ? `<div class="activity-time">🕐 ${escapeHtml(activity.timeInterval)}</div>` : ''}
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
        <div class="activity-card">
            <button class="delete-btn" onclick="deleteActivity('my', ${activity.my_activity_id || activity.id})" title="Leave activity">×</button>
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            ${activity.location ? `<div class="activity-location">📍 ${escapeHtml(activity.location)}</div>` : ''}
            ${activity.organiser ? `<div class="activity-organiser">👤 ${escapeHtml(activity.organiser)}</div>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
            ${activity.timeInterval ? `<div class="activity-time">🕐 ${escapeHtml(activity.timeInterval)}</div>` : ''}
            <div class="activity-hours">${activity.hours || 0} hours</div>
        </div>
    `).join('');
}

// Render total hours
function renderTotalHours() {
    const totalHours = calculateTotalHours();
    document.getElementById('total-hours-display').textContent = totalHours.toFixed(1);

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

