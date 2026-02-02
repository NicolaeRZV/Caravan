// Data storage (will be replaced with Supabase later)
let currentActivities = [];
let myActivities = [];
let payments = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupTabs();
    setupForms();
    renderAll();
    setDefaultDate();
});

// Load data from localStorage
function loadData() {
    const savedCurrent = localStorage.getItem('ausf_currentActivities');
    const savedMy = localStorage.getItem('ausf_myActivities');
    const savedPayments = localStorage.getItem('ausf_payments');

    if (savedCurrent) currentActivities = JSON.parse(savedCurrent);
    if (savedMy) myActivities = JSON.parse(savedMy);
    if (savedPayments) payments = JSON.parse(savedPayments);
}

// Save data to localStorage
function saveData() {
    localStorage.setItem('ausf_currentActivities', JSON.stringify(currentActivities));
    localStorage.setItem('ausf_myActivities', JSON.stringify(myActivities));
    localStorage.setItem('ausf_payments', JSON.stringify(payments));
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
    // Add current activity
    document.getElementById('add-current-activity').addEventListener('click', () => {
        openActivityModal('current');
    });

    // Add my activity
    document.getElementById('add-my-activity').addEventListener('click', () => {
        openActivityModal('my');
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

    // Close modal
    document.querySelector('.close').addEventListener('click', closeModal);
    document.getElementById('activity-modal').addEventListener('click', (e) => {
        if (e.target.id === 'activity-modal') closeModal();
    });
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

// Add activity
function addActivity(type) {
    const name = document.getElementById('activity-name').value;
    const description = document.getElementById('activity-description').value;
    const date = document.getElementById('activity-date').value;
    const hours = parseFloat(document.getElementById('activity-hours').value);

    const activity = {
        id: Date.now(),
        name,
        description,
        date,
        hours
    };

    if (type === 'current') {
        currentActivities.push(activity);
    } else {
        myActivities.push(activity);
    }

    saveData();
    renderAll();
    closeModal();
}

// Delete activity
function deleteActivity(type, id) {
    if (type === 'current') {
        currentActivities = currentActivities.filter(a => a.id !== id);
    } else {
        myActivities = myActivities.filter(a => a.id !== id);
    }
    saveData();
    renderAll();
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
            <button class="delete-btn" onclick="deleteActivity('current', ${activity.id})" title="Delete">×</button>
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
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
            <button class="delete-btn" onclick="deleteActivity('my', ${activity.id})" title="Delete">×</button>
            <h3>${escapeHtml(activity.name)}</h3>
            ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
            <div class="activity-date">📅 ${formatDate(activity.date)}</div>
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

