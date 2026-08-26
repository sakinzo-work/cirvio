/* When hosted separately, set the backend URL once in the panel. */
let API_BASE = window.CIRVIO_API_BASE || localStorage.getItem('cirvio_admin_api_base') || '';

let TOKEN = localStorage.getItem('cirvio_admin_token') || '';
let CURRENT_USER = null;

const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');

async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
            ...(options.headers || {})
        }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
}

/* ---------- login ---------- */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
        const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (!['admin', 'employee'].includes(data.user.role)) {
            errEl.textContent = 'This account is not CIRVIO staff.';
            return;
        }
        TOKEN = data.token;
        CURRENT_USER = data.user;
        localStorage.setItem('cirvio_admin_token', TOKEN);
        showApp();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('cirvio_admin_token');
    TOKEN = '';
    location.reload();
});

/* ---------- tabs ---------- */
document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
});

/* ---------- boot ---------- */
async function showApp() {
    loginScreen.classList.add('hidden');
    adminApp.classList.remove('hidden');
    ensureApiBasePanel();
    ensurePasswordEye();
    ensureSettingsPanel();
    ensureEmployeePanel();
    applyRolePermissions();
    await Promise.all([loadStats(), loadUsers(), loadListings(), loadPurchases(), loadClientOrigins()]);
}

(async function init() {
    if (!TOKEN) return; // stay on login screen
    try {
        const data = await api('/api/auth/me');
        if (['admin', 'employee'].includes(data.user.role)) {
            CURRENT_USER = data.user;
            return showApp();
        }
    } catch (e) {
        localStorage.removeItem('cirvio_admin_token');
    }
})();

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const isAdmin = () => CURRENT_USER && CURRENT_USER.role === 'admin';

function ensureApiBasePanel() {
    if (document.getElementById('apiBasePanel')) return;
    if (!document.getElementById('adminEnhancementStyle')) {
        const style = document.createElement('style');
        style.id = 'adminEnhancementStyle';
        style.textContent = `
.api-base-panel{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0;padding:12px;border:1px solid var(--border,#e6e0d4);border-radius:8px;background:var(--panel,#fff)}
.api-base-panel input{min-width:280px;flex:1;border:1px solid var(--border,#e6e0d4);border-radius:8px;padding:10px;font:inherit}
.password-eye{margin-top:8px;border:1px solid var(--border,#e6e0d4);border-radius:8px;background:#fff;padding:8px 11px;cursor:pointer}
.employee-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px}
.employee-form input{border:1px solid var(--border,#e6e0d4);border-radius:8px;padding:10px;font:inherit}`;
        document.head.appendChild(style);
    }
    const panel = document.createElement('div');
    panel.id = 'apiBasePanel';
    panel.className = 'api-base-panel';
    panel.innerHTML = `
      <input id="apiBaseInput" type="url" placeholder="Backend API URL, e.g. https://your-backend.onrender.com" value="${API_BASE}">
      <button id="saveApiBaseBtn" class="row-btn btn-approve">Save API URL</button>
      <span id="apiBaseStatus" class="sub"></span>`;
    const host = TOKEN && !adminApp.classList.contains('hidden') ? adminApp : loginScreen;
    host.insertBefore(panel, host.firstElementChild);
    document.getElementById('saveApiBaseBtn').addEventListener('click', () => {
        const value = document.getElementById('apiBaseInput').value.trim().replace(/\/$/, '');
        API_BASE = value;
        localStorage.setItem('cirvio_admin_api_base', value);
        document.getElementById('apiBaseStatus').textContent = 'Saved';
    });
}

function ensurePasswordEye() {
    const password = document.getElementById('loginPassword');
    if (!password || document.getElementById('toggleLoginPassword')) return;
    const btn = document.createElement('button');
    btn.id = 'toggleLoginPassword';
    btn.type = 'button';
    btn.className = 'password-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.textContent = '👁';
    password.insertAdjacentElement('afterend', btn);
    btn.addEventListener('click', () => {
        const show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
}

function applyRolePermissions() {
    document.body.dataset.role = CURRENT_USER ? CURRENT_USER.role : '';
    document.querySelectorAll('[data-admin-only]').forEach((el) => {
        el.style.display = isAdmin() ? '' : 'none';
    });
}

ensureApiBasePanel();
ensurePasswordEye();

/* ---------- dashboard ---------- */
async function loadStats() {
    const s = await api('/api/admin/stats');
    document.getElementById('statUsers').textContent = s.totalUsers;
    document.getElementById('statProducts').textContent = s.totalProducts;
    document.getElementById('statPending').textContent = s.pendingProducts;
    document.getElementById('statApproved').textContent = s.approvedProducts;
    document.getElementById('statSold').textContent = s.soldProducts;
    document.getElementById('statOrders').textContent = s.totalOrders;
    document.getElementById('statRevenue').textContent = inr(s.totalRevenue);
}

/* ---------- users ---------- */
async function loadUsers() {
    const { users } = await api('/api/admin/users');
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = users.map((u) => `
        <tr>
          <td>${u.name}</td>
          <td>${u.email}<span class="sub">${u.role}</span></td>
          <td>${u.college || '—'}</td>
          <td>${u.city || '—'}</td>
          <td>${u.listingsCount}</td>
          <td>${u.ordersCount}</td>
          <td><span class="badge badge-${u.status}">${u.status}</span></td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>
            ${u.role === 'admin' || !isAdmin() ? `<span class="sub">${u.role}</span>` : `
              <button class="row-btn btn-suspend" onclick="toggleUserStatus('${u._id}','${u.status}')">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
              <button class="row-btn btn-delete" onclick="deleteUser('${u._id}')">Delete</button>
            `}
          </td>
        </tr>`).join('');

    const empBody = document.querySelector('#employeesTable tbody');
    if (empBody) {
        const employees = users.filter((u) => u.role === 'employee');
        empBody.innerHTML = employees.length ? employees.map((u) => `
          <tr>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td><span class="badge badge-${u.status}">${u.status}</span></td>
            <td>${fmtDate(u.createdAt)}</td>
            <td>
              <button class="row-btn btn-suspend" onclick="toggleUserStatus('${u._id}','${u.status}')">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
              <button class="row-btn btn-approve" onclick="resetEmployeePassword('${u._id}')">Reset Password</button>
              <button class="row-btn btn-delete" onclick="deleteUser('${u._id}')">Delete</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="5" class="sub">No CIRVIO employees yet.</td></tr>';
    }
}

async function toggleUserStatus(id, currentStatus) {
    const status = currentStatus === 'active' ? 'suspended' : 'active';
    await api(`/api/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    loadUsers();
}
async function deleteUser(id) {
    if (!confirm('Delete this user permanently?')) return;
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    loadUsers();
    loadStats();
}

/* ---------- listings ---------- */
let currentListingFilter = '';
document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentListingFilter = btn.dataset.status;
        loadListings();
    });
});

async function loadListings() {
    const qs = currentListingFilter ? `?status=${currentListingFilter}` : '';
    const { products } = await api('/api/admin/products' + qs);
    const tbody = document.querySelector('#listingsTable tbody');
    tbody.innerHTML = products.map((p) => `
        <tr>
          <td>${p.title}</td>
          <td>${p.category}</td>
          <td>${p.type === 'donate' ? 'Donate' : inr(p.price)}</td>
          <td class="pair-cell">${p.seller ? p.seller.name : '—'}<span class="sub">${p.seller ? p.seller.email : ''}</span></td>
          <td><span class="badge badge-${p.status}">${p.status}</span></td>
          <td>${fmtDate(p.createdAt)}</td>
          <td>
            ${p.status === 'pending' ? `
              <button class="row-btn btn-approve" onclick="approveProduct('${p._id}')">Approve</button>
              <button class="row-btn btn-reject" onclick="rejectProduct('${p._id}')">Reject</button>
            ` : ''}
            <button class="row-btn btn-delete" onclick="deleteProduct('${p._id}')">Delete</button>
          </td>
        </tr>`).join('');
}

async function approveProduct(id) {
    await api(`/api/admin/products/${id}/approve`, { method: 'PUT' });
    loadListings(); loadStats();
}
async function rejectProduct(id) {
    const reason = prompt('Reason for rejecting this listing:', 'Does not meet CIRVIO guidelines');
    if (reason === null) return;
    await api(`/api/admin/products/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) });
    loadListings(); loadStats();
}
async function deleteProduct(id) {
    if (!confirm('Delete this listing permanently?')) return;
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    loadListings(); loadStats();
}

/* ---------- purchases (buyer + product + seller, paired) ---------- */
async function loadPurchases() {
    const { purchases } = await api('/api/admin/purchases');

    const rowHtml = (row) => `
        <tr>
          <td>${fmtDate(row.date)}</td>
          <td class="pair-cell">${row.buyer ? row.buyer.name : '—'}<span class="sub">${row.buyer ? row.buyer.email : ''}</span></td>
          <td class="pair-cell">${row.title}<span class="sub">${row.product ? row.product.category : ''}</span></td>
          <td class="pair-cell">${row.seller ? row.seller.name : '—'}<span class="sub">${row.seller ? row.seller.email : ''}</span></td>
          <td>${row.qty}</td>
          <td>${inr(row.price * row.qty)}</td>
          <td><span class="badge badge-approved">${row.orderStatus}</span></td>
        </tr>`;

    document.querySelector('#purchasesTable tbody').innerHTML = purchases.map(rowHtml).join('');
    document.querySelector('#recentPurchasesTable tbody').innerHTML = purchases.slice(0, 6).map((row) => `
        <tr>
          <td>${fmtDate(row.date)}</td>
          <td>${row.buyer ? row.buyer.name : '—'}</td>
          <td>${row.title}</td>
          <td>${row.seller ? row.seller.name : '—'}</td>
          <td>${inr(row.price * row.qty)}</td>
        </tr>`).join('');
}

/* ---------- allowed frontend URLs ---------- */
function ensureSettingsPanel() {
    if (document.getElementById('tab-settings')) return;
    if (!document.getElementById('clientOriginsStyle')) {
        const style = document.createElement('style');
        style.id = 'clientOriginsStyle';
        style.textContent = `
.settings-card{max-width:720px;background:var(--panel,#fff);border:1px solid var(--border,#e6e0d4);border-radius:8px;padding:18px}
.settings-card label{display:block;font-weight:700;margin-bottom:8px}
.settings-card textarea{width:100%;min-height:150px;resize:vertical;border:1px solid var(--border,#e6e0d4);border-radius:8px;padding:12px;font:inherit}
.origin-list{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.origin-pill{border:1px solid var(--border,#e6e0d4);border-radius:999px;padding:6px 10px;color:var(--muted,#6f6a5b);background:rgba(255,255,255,.7);font-size:.8rem}`;
        document.head.appendChild(style);
    }
    const nav = document.querySelector('.sidebar-nav') || document.querySelector('nav');
    if (nav) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.dataset.tab = 'settings';
        btn.dataset.adminOnly = 'true';
        btn.textContent = 'Client URLs';
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-settings').classList.add('active');
        });
        nav.appendChild(btn);
    }

    const appMain = adminApp.querySelector('main') || adminApp;
    const section = document.createElement('section');
    section.id = 'tab-settings';
    section.className = 'tab-panel';
    section.dataset.adminOnly = 'true';
    section.innerHTML = `
      <div class="panel-head">
        <div>
          <h2>Allowed Client URLs</h2>
          <p>Add every frontend URL that should be allowed to call this backend.</p>
        </div>
      </div>
      <div class="settings-card">
        <label for="clientOriginsInput">Frontend URLs</label>
        <textarea id="clientOriginsInput" rows="7" placeholder="https://your-frontend.com&#10;http://localhost:5500"></textarea>
        <p class="sub">One URL per line. URLs from CLIENT_ORIGIN / CLIENT_ORIGINS in .env are always included.</p>
        <div id="envOriginsBox" class="origin-list"></div>
        <button class="row-btn btn-approve" id="saveClientOriginsBtn">Save URLs</button>
        <span id="clientOriginsStatus" class="sub"></span>
      </div>`;
    appMain.appendChild(section);
    document.getElementById('saveClientOriginsBtn').addEventListener('click', saveClientOrigins);
}

function ensureEmployeePanel() {
    if (document.getElementById('tab-employees')) return;
    const nav = document.querySelector('.sidebar-nav') || document.querySelector('nav');
    if (nav) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.dataset.tab = 'employees';
        btn.dataset.adminOnly = 'true';
        btn.textContent = 'CIRVIO Employees';
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-employees').classList.add('active');
        });
        nav.appendChild(btn);
    }

    const appMain = adminApp.querySelector('main') || adminApp;
    const section = document.createElement('section');
    section.id = 'tab-employees';
    section.className = 'tab-panel';
    section.dataset.adminOnly = 'true';
    section.innerHTML = `
      <div class="panel-head">
        <div>
          <h2>CIRVIO Employees</h2>
          <p>Create staff logins for people who work on listings, users and orders.</p>
        </div>
      </div>
      <div class="settings-card">
        <div class="employee-form">
          <input id="empName" placeholder="Employee name">
          <input id="empEmail" type="email" placeholder="Employee email / ID">
          <input id="empPassword" type="password" placeholder="Password">
          <input id="empPhone" placeholder="Phone">
          <input id="empCity" placeholder="City">
          <button class="row-btn btn-approve" id="createEmployeeBtn">Create Employee</button>
        </div>
        <span id="employeeStatus" class="sub"></span>
        <table id="employeesTable">
          <thead><tr><th>Name</th><th>Email / ID</th><th>Status</th><th>Joined</th><th>Action</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>`;
    appMain.appendChild(section);
    document.getElementById('createEmployeeBtn').addEventListener('click', createEmployee);
}

async function createEmployee() {
    const status = document.getElementById('employeeStatus');
    const payload = {
        name: document.getElementById('empName').value.trim(),
        email: document.getElementById('empEmail').value.trim(),
        password: document.getElementById('empPassword').value,
        phone: document.getElementById('empPhone').value.trim(),
        city: document.getElementById('empCity').value.trim()
    };
    status.textContent = 'Creating...';
    try {
        await api('/api/admin/employees', { method: 'POST', body: JSON.stringify(payload) });
        ['empName', 'empEmail', 'empPassword', 'empPhone', 'empCity'].forEach((id) => { document.getElementById(id).value = ''; });
        status.textContent = 'Employee created';
        await loadUsers();
    } catch (err) {
        status.textContent = err.message;
    }
}

async function resetEmployeePassword(id) {
    const password = prompt('New employee password (minimum 6 characters):');
    if (password === null) return;
    await api(`/api/admin/employees/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
    alert('Employee password updated');
}

async function loadClientOrigins() {
    if (!document.getElementById('clientOriginsInput')) return;
    const data = await api('/api/admin/client-origins');
    document.getElementById('clientOriginsInput').value = (data.origins || []).join('\n');
    document.getElementById('envOriginsBox').innerHTML = (data.envOrigins || [])
        .map((origin) => `<span class="origin-pill">${origin}</span>`)
        .join('');
}

async function saveClientOrigins() {
    const status = document.getElementById('clientOriginsStatus');
    const origins = document.getElementById('clientOriginsInput').value
        .split(/\r?\n/)
        .map((origin) => origin.trim())
        .filter(Boolean);
    status.textContent = 'Saving...';
    try {
        await api('/api/admin/client-origins', {
            method: 'PUT',
            body: JSON.stringify({ origins })
        });
        status.textContent = 'Saved';
        await loadClientOrigins();
    } catch (err) {
        status.textContent = err.message;
    }
}

// expose for inline onclick handlers
window.toggleUserStatus = toggleUserStatus;
window.deleteUser = deleteUser;
window.approveProduct = approveProduct;
window.rejectProduct = rejectProduct;
window.deleteProduct = deleteProduct;
