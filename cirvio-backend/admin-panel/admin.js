const RENDER_API_BASE = 'https://cirvio.onrender.com';

function getAdminApiBase() {
    const queryApi = new URLSearchParams(location.search).get('api');
    if (queryApi) {
        const cleanQueryApi = queryApi.replace(/\/$/, '');
        localStorage.setItem('cirvio_admin_api_base', cleanQueryApi);
        return cleanQueryApi;
    }
    const host = location.hostname;
    const isLocalAdmin = !host
        || host === 'localhost'
        || host === '127.0.0.1'
        || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
        || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
    const storedApi = localStorage.getItem('cirvio_admin_api_base') || '';
    const storedApiIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?/i.test(storedApi);
    const storedApiIsRemote = /^https?:\/\//i.test(storedApi) && !storedApiIsLocal;

    if (storedApi && ((isLocalAdmin && storedApiIsLocal) || (!isLocalAdmin && storedApiIsRemote))) {
        return storedApi.replace(/\/$/, '');
    }
    if (storedApi) localStorage.removeItem('cirvio_admin_api_base');
    if (window.CIRVIO_API_BASE) return window.CIRVIO_API_BASE.replace(/\/$/, '');
    return isLocalAdmin ? 'http://localhost:5000' : RENDER_API_BASE;
}

let API_BASE = getAdminApiBase();

let TOKEN = localStorage.getItem('cirvio_admin_token') || '';
const ADMIN_SESSION_API_BASE = localStorage.getItem('cirvio_admin_session_api_base') || '';
if (TOKEN && ADMIN_SESSION_API_BASE && ADMIN_SESSION_API_BASE !== API_BASE) {
    localStorage.removeItem('cirvio_admin_token');
    localStorage.removeItem('cirvio_admin_session_api_base');
    TOKEN = '';
}
let CURRENT_USER = null;
const ADMIN_PRODUCTS = new Map();

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
        localStorage.setItem('cirvio_admin_session_api_base', API_BASE);
        showApp();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('cirvio_admin_token');
    localStorage.removeItem('cirvio_admin_session_api_base');
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

const inr = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const isAdmin = () => CURRENT_USER && CURRENT_USER.role === 'admin';
const listingPrice = (p) => p.type === 'donate' ? 'Donate' : (p.type === 'free' ? 'Free' : inr(p.price));
const listingThumb = (p) => (p.images && p.images[0]) ? p.images[0] : '';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function listingActions(p) {
    const viewed = !!p.reviewViewedAt;
    return `
    <div class="action-stack">
      <button class="row-btn btn-view" onclick="viewListingImages('${p._id}')">View Images</button>
      ${p.status !== 'approved' ? `<button class="row-btn btn-approve" ${viewed ? '' : 'disabled title="View images/details first"'} onclick="approveProduct('${p._id}')">Approve</button>` : ''}
      ${p.status !== 'rejected' && p.status !== 'sold' ? `<button class="row-btn btn-reject" onclick="rejectProduct('${p._id}')">Reject</button>` : ''}
      <button class="row-btn btn-delete" onclick="deleteProduct('${p._id}')">Delete</button>
      <span class="review-state ${viewed ? 'review-seen' : 'review-needed'}">${viewed ? 'Viewed by staff' : 'View before approval'}</span>
    </div>
    `;
}

function listingBookCell(p) {
    const thumb = listingThumb(p);
    return `
      <div class="listing-book">
        <div class="listing-cover-stack">${thumb ? `<img src="${esc(thumb)}" alt="">` : `<span class="listing-thumb-empty">No image</span>`}</div>
        <div>
          <strong>${esc(p.title)}</strong>
          <span class="sub">${esc(p.category || 'Book')}</span>
        </div>
      </div>
    `;
}

function listingImagesCell(p) {
    const images = Array.isArray(p.images) ? p.images : [];
    const count = images.length;
    const strip = images.slice(0, 3).map(src => `<img src="${esc(src)}" alt="">`).join('');
    return `
      <div class="image-cell">
        <div class="image-strip">${strip || '<span class="listing-thumb-empty">No image</span>'}</div>
        <span class="image-count">${count} photo${count === 1 ? '' : 's'}</span>
        <button class="row-btn btn-view" onclick="viewListingImages('${p._id}')">View</button>
      </div>
    `;
}

function ensureEnhancementStyle() {
    if (!document.getElementById('adminEnhancementStyle')) {
        const style = document.createElement('style');
        style.id = 'adminEnhancementStyle';
        style.textContent = '';
        document.head.appendChild(style);
    }
}

function ensurePasswordEye() {
    ensureEnhancementStyle();
    const password = document.getElementById('loginPassword');
    if (!password || document.getElementById('toggleLoginPassword')) return;
    const btn = document.createElement('button');
    btn.id = 'toggleLoginPassword';
    btn.type = 'button';
    btn.className = 'password-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.textContent = 'Show';
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
          <td>${esc(u.name)}</td>
          <td>${esc(u.email)}<span class="sub">${esc(u.role)}</span></td>
          <td>${esc(u.college || '-')}</td>
          <td>${esc(u.city || '-')}</td>
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
          <td>${esc(u.name)}</td>
          <td>${esc(u.email)}</td>
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
    ADMIN_PRODUCTS.clear();
    products.forEach((p) => ADMIN_PRODUCTS.set(String(p._id), p));
    const tbody = document.querySelector('#listingsTable tbody');
    tbody.innerHTML = products.map((p) => `
        <tr>
          <td>${listingBookCell(p)}</td>
          <td>${listingImagesCell(p)}</td>
          <td>${esc(p.category)}</td>
          <td>${p.type === 'donate' ? 'Donate' : inr(p.price)}</td>
          <td class="pair-cell">${p.seller ? esc(p.seller.name) : '-'}<span class="sub">${p.seller ? esc(p.seller.email) : ''}</span></td>
          <td><span class="badge badge-${p.status}">${p.status}</span></td>
          <td>${fmtDate(p.createdAt)}</td>
          <td>${listingActions(p)}</td>
        </tr>`).join('');
    const latestBody = document.querySelector('#latestListingsTable tbody');
    if (latestBody) {
        latestBody.innerHTML = products.slice(0, 8).map((p) => `
        <tr>
          <td>${listingBookCell(p)}</td>
          <td>${listingImagesCell(p)}</td>
          <td>${listingPrice(p)}</td>
          <td class="pair-cell">${p.seller ? esc(p.seller.name) : '-'}<span class="sub">${p.seller ? esc(p.seller.email) : ''}</span></td>
          <td><span class="badge badge-${p.status}">${p.status}</span></td>
          <td>${fmtDate(p.createdAt)}</td>
          <td>${listingActions(p)}</td>
        </tr>`).join('');
    }
}

async function approveProduct(id) {
    const product = ADMIN_PRODUCTS.get(String(id));
    if (!product) {
        alert('Listing data is still loading. Please refresh and try again.');
        return;
    }
    if (!product.reviewViewedAt) {
        alert('Please click View Images and inspect this listing before approving it.');
        return;
    }
    try {
        await api(`/api/admin/products/${id}/approve`, { method: 'PUT' });
        loadListings(); loadStats();
    } catch (err) {
        alert(err.message);
    }
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

function ensureImageModal() {
    if (document.getElementById('listingImageModal')) return;
    const modal = document.createElement('div');
    modal.id = 'listingImageModal';
    modal.className = 'image-modal';
    modal.innerHTML = `
      <div class="image-dialog" role="dialog" aria-label="Listing images">
        <div class="image-dialog-head">
          <div>
            <h3 id="imageModalTitle">Listing images</h3>
            <p id="imageModalMeta"></p>
          </div>
          <button class="row-btn btn-delete" id="closeImageModal">Close</button>
        </div>
        <div class="image-dialog-body">
          <div class="image-main">
            <div id="imageModalMain"></div>
            <div id="imageModalGrid" class="image-grid"></div>
          </div>
          <aside class="image-side">
            <h4>Review details</h4>
            <div id="imageModalDetail" class="image-detail"></div>
          </aside>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('closeImageModal').addEventListener('click', closeListingImages);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeListingImages();
    });
    document.getElementById('imageModalGrid').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-img]');
        const mainImg = document.getElementById('imageModalMainImg');
        if (!btn || !mainImg) return;
        mainImg.src = btn.dataset.img;
        document.querySelectorAll('#imageModalGrid button').forEach((item) => {
            item.classList.toggle('active', item === btn);
        });
    });
}

async function viewListingImages(id) {
    const product = ADMIN_PRODUCTS.get(String(id));
    if (!product) return;
    ensureImageModal();
    const images = Array.isArray(product.images) ? product.images : [];
    document.getElementById('imageModalTitle').textContent = product.title || 'Listing images';
    document.getElementById('imageModalMeta').textContent = `${product.category || 'Listing'} | ${listingPrice(product)} | ${product.seller ? product.seller.name : 'No seller'}`;
    document.getElementById('imageModalMain').innerHTML = images.length
        ? `<img id="imageModalMainImg" src="${esc(images[0])}" alt="${esc(product.title || 'Listing image')}">`
        : '<div class="image-empty">No uploaded images for this listing.</div>';
    document.getElementById('imageModalGrid').innerHTML = images.length
        ? images.map((src, i) => `<button type="button" class="${i === 0 ? 'active' : ''}" data-img="${esc(src)}"><img src="${esc(src)}" alt="Listing image ${i + 1}"></button>`).join('')
        : '';
    document.getElementById('imageModalDetail').innerHTML = `
      <dl>
        <div><dt>Title</dt><dd>${esc(product.title || 'Untitled listing')}</dd></div>
        <div><dt>Seller</dt><dd>${esc(product.seller ? `${product.seller.name} (${product.seller.email || 'no email'})` : 'No seller')}</dd></div>
        <div><dt>Category</dt><dd>${esc(product.category || 'Uncategorised')}</dd></div>
        <div><dt>Condition</dt><dd>${esc(product.condition || 'Not provided')}</dd></div>
        <div><dt>Price</dt><dd>${esc(listingPrice(product))}</dd></div>
        <div><dt>Location</dt><dd>${esc(product.location || '-')}</dd></div>
        <div><dt>Description</dt><dd>${esc(product.description || 'No description provided.')}</dd></div>
      </dl>
    `;
    document.getElementById('listingImageModal').classList.add('open');
    try {
        const { product: updated } = await api(`/api/admin/products/${id}/review-viewed`, { method: 'PUT' });
        ADMIN_PRODUCTS.set(String(id), updated);
        product.reviewViewedAt = updated.reviewViewedAt;
        loadListings();
    } catch (err) {
        alert(err.message === 'Route not found'
            ? 'Backend needs restart/redeploy for the new review-viewed route. Images can be viewed, but approval will stay locked until the backend is updated.'
            : err.message);
    }
}

function closeListingImages() {
    const modal = document.getElementById('listingImageModal');
    if (modal) modal.classList.remove('open');
}

/* ---------- purchases (buyer + product + seller, paired) ---------- */
async function loadPurchases() {
    const { purchases } = await api('/api/admin/purchases');

    const rowHtml = (row) => `
        <tr>
          <td>${fmtDate(row.date)}</td>
          <td class="pair-cell">${row.buyer ? esc(row.buyer.name) : '-'}<span class="sub">${row.buyer ? esc(row.buyer.email) : ''}</span></td>
          <td class="pair-cell">${esc(row.title)}<span class="sub">${row.product ? esc(row.product.category) : ''}</span></td>
          <td class="pair-cell">${row.seller ? esc(row.seller.name) : '-'}<span class="sub">${row.seller ? esc(row.seller.email) : ''}</span></td>
          <td>${row.qty}</td>
          <td>${inr(row.price * row.qty)}</td>
          <td><span class="badge badge-approved">${row.orderStatus}</span></td>
        </tr>`;

    document.querySelector('#purchasesTable tbody').innerHTML = purchases.map(rowHtml).join('');
    document.querySelector('#recentPurchasesTable tbody').innerHTML = purchases.slice(0, 6).map((row) => `
        <tr>
          <td>${fmtDate(row.date)}</td>
          <td>${row.buyer ? esc(row.buyer.name) : '-'}</td>
          <td>${esc(row.title)}</td>
          <td>${row.seller ? esc(row.seller.name) : '-'}</td>
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
window.viewListingImages = viewListingImages;
