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
const ADMIN_MESSAGES = new Map();
const messageDrafts = new Map();
const pendingReplies = new Set();
let messageRevision = 0;
let activeMessageFilter = 'all';
const ADMIN_PURCHASES = new Map();
let adminMessagePollStarted = false;
let activeTab = 'dashboard';
let activeMessageId = '';

const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const ADMIN_THEME_KEY = 'cirvio_admin_theme';

function setAdminTheme(theme) {
    const cleanTheme = theme === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = cleanTheme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    localStorage.setItem(ADMIN_THEME_KEY, cleanTheme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        const nextTheme = cleanTheme === 'light' ? 'dark' : 'light';
        btn.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
        btn.setAttribute('aria-pressed', String(cleanTheme === 'light'));
        btn.innerHTML = iconSvg(cleanTheme === 'light' ? 'moon' : 'sun');
    }
}

function setupThemeToggle() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn || btn.dataset.themeBound) return;
    btn.dataset.themeBound = 'true';
    btn.addEventListener('click', () => {
        const current = document.body.dataset.theme === 'light' ? 'light' : 'dark';
        setAdminTheme(current === 'light' ? 'dark' : 'light');
    });
}

async function api(path, options = {}) {
    if (navigator.onLine === false) throw new Error('You are offline. Reconnect and try again. Your changes have not been sent.');
    const isFormData = options.body instanceof FormData;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 45000);
    try {
        const res = await fetch(API_BASE + path, {
            ...options,
            signal: controller.signal,
            headers: {
                ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
                ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
                ...(options.headers || {})
            }
        });
        const data = await res.json().catch(err => { if (controller.signal.aborted) throw err; return null; });
        if (!res.ok) {
            if (res.status === 401) {
                TOKEN = '';
                localStorage.removeItem('cirvio_admin_token');
                adminApp.classList.add('hidden');
                loginScreen.classList.remove('hidden');
                document.getElementById('loginError').textContent = 'Your session expired. Please sign in again.';
            }
            const error = new Error(data?.message || 'Request failed');
            error.status = res.status;
            throw error;
        }
        if (!data) throw new Error('The server returned an invalid response. Please try again.');
        return data;
    } catch (err) {
        if (options.signal?.aborted) throw err;
        if (err.name === 'AbortError') throw new Error('Loading took too long. Please try again.');
        if (err instanceof TypeError) throw new Error('Unable to connect. Check your connection and try again.');
        throw err;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
    }
}

/* ---------- login ---------- */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    button.disabled = true;
    button.textContent = 'Signing in...';
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
    } finally {
        button.disabled = false;
        button.textContent = 'Login';
    }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await window.CirvioPush?.disconnect().catch(() => {});
    localStorage.removeItem('cirvio_admin_token');
    localStorage.removeItem('cirvio_admin_session_api_base');
    TOKEN = '';
    location.reload();
});

/* ---------- tabs ---------- */
document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        activateTab(btn.dataset.tab);
    });
});

function activateTab(tab, { historyMode = 'push', load = true } = {}) {
    if (!document.getElementById('tab-' + tab) || (tab === 'employees' && !isAdmin())) tab = 'dashboard';
    if (tab !== activeTab) document.getElementById('globalSearchInput').value = '';
    activeTab = tab;
    document.querySelectorAll('.nav-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tab);
        if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.add('active');
    document.body.classList.toggle('messages-active', tab === 'messages');
    document.getElementById('activeSectionLabel').textContent = titleCase(tab);
    setMobileMenu(false, false);
    if (historyMode !== 'none') {
        const state = { tab, thread: null };
        if (historyMode === 'replace') history.replaceState(state, '', '#' + tab);
        else if (location.hash !== '#' + tab || history.state?.thread) history.pushState(state, '', '#' + tab);
        document.querySelector('.messages-layout').classList.remove('conversation-open');
    }
    applyActiveSearchFilter();
    if (CURRENT_USER && load) loadActiveTabData();
}

function bindJumpActions(root = document) {
    root.querySelectorAll('[data-jump-tab]').forEach((btn) => {
        if (btn.dataset.jumpBound) return;
        btn.dataset.jumpBound = 'true';
        btn.addEventListener('click', () => activateTab(btn.dataset.jumpTab));
    });
}
bindJumpActions();

/* ---------- boot ---------- */
async function showApp() {
    loginScreen.classList.add('hidden');
    adminApp.classList.remove('hidden');
    setupThemeToggle();
    ensurePasswordEye();
    ensureSettingsPanel();
    ensureEmployeePanel();
    updateAdminChrome();
    applyRolePermissions();
    const linkedThread = new URLSearchParams(location.search).get('thread');
    activateTab(linkedThread ? 'messages' : (location.hash.slice(1) || 'dashboard'), { historyMode: 'replace', load: false });
    await Promise.allSettled([loadActiveTabData(), loadMessages()]);
    if (linkedThread && ADMIN_MESSAGES.has(linkedThread)) handleMessageRowClick(null, linkedThread);
    if (!window.CirvioPush && window.createCirvioPushClient) window.CirvioPush = createCirvioPushClient({ api, token: () => TOKEN, app: 'admin', worker: './admin-sw.js', scope: './', button: document.getElementById('enableAdminNotifications'), status: document.getElementById('adminNotificationStatus') });
    startAdminMessagePoll();
}

async function initAdminSession() {
    if (!TOKEN) return; // stay on login screen
    try {
        const data = await api('/api/auth/me');
        if (['admin', 'employee'].includes(data.user.role)) {
            CURRENT_USER = data.user;
            return showApp();
        }
        TOKEN = '';
        localStorage.removeItem('cirvio_admin_token');
    } catch (error) {
        if (error.status === 401) return;
        document.getElementById('loginError').textContent = error.message || 'Could not connect. Please retry.';
        document.getElementById('retrySessionBtn').hidden = false;
    }
}
initAdminSession();
document.getElementById('retrySessionBtn').addEventListener('click', async event => {
    event.currentTarget.hidden = true;
    await initAdminSession();
});

const inr = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => d && Number.isFinite(Date.parse(d)) ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const isAdmin = () => CURRENT_USER && CURRENT_USER.role === 'admin';
const listingPrice = (p) => p.type === 'donate' ? 'Donate' : (p.type === 'free' ? 'Free' : (p.type === 'rent' ? `Rent ${inr(p.price)} / ${p.rentalTerm === 'semester' ? 'semester' : 'week'}` : inr(p.price)));
const listingPricingDetails = (p) => `${listingPrice(p)}<span class="sub">Original / MRP: ${Number(p.originalPrice || 0) > 0 ? inr(p.originalPrice) : 'Not provided'}</span>`;
const listingThumb = (p) => (p.images && p.images[0]) ? p.images[0] : '';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const titleCase = (value = '') => String(value || '').replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
const iconSvg = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const SITE_MEDIA_SLOTS = [
    ['homeHero1', 'Homepage hero image 1', 'image'],
    ['homeHero2', 'Homepage hero image 2', 'image'],
    ['homeHero3', 'Homepage hero image 3', 'image'],
    ['aboutVideo', 'About section video', 'video'],
    ['aboutPoster', 'About video poster', 'image'],
    ['loginBackground', 'Login page background', 'image']
];
setAdminTheme(localStorage.getItem(ADMIN_THEME_KEY) || 'dark');

function updateAdminChrome() {
    const user = CURRENT_USER || {};
    const name = user.name || 'Admin';
    const role = titleCase(user.role || 'staff');
    [
        ['adminNameTop', name],
        ['adminRoleTop', role],
        ['sidebarUserName', name],
        ['sidebarUserRole', role]
    ].forEach(([id, text]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    });
    ['adminAvatarTop', 'sidebarAvatar'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = iconSvg('user');
    });
    const today = document.getElementById('adminToday');
    if (today) {
        today.textContent = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
}

function listingActions(p) {
    const viewed = !!p.reviewViewedAt;
    return `
    <div class="action-stack">
      <button class="row-btn btn-view" onclick="viewListingImages('${p._id}')">View Images</button>
      ${p.seller ? `<button type="button" class="row-btn btn-view" data-message-listing="${esc(p._id)}">Message seller</button>` : ''}
      ${['pending', 'rejected'].includes(p.status) ? `<button class="row-btn btn-approve" ${viewed ? '' : 'disabled title="View images/details first"'} onclick="approveProduct('${p._id}')">Approve</button>` : ''}
      ${p.status !== 'rejected' && p.status !== 'sold' ? `<button class="row-btn btn-reject" onclick="rejectProduct('${p._id}')">Reject</button>` : ''}
      ${isAdmin() ? `<button class="row-btn btn-delete" onclick="deleteProduct('${p._id}')">Delete</button>` : ''}
      <span class="review-state ${viewed ? 'review-seen' : 'review-needed'}">${viewed ? 'Viewed by staff' : 'View before approval'}</span>
    </div>
    `;
}

function listingBookCell(p) {
    const thumb = listingThumb(p);
    return `
      <div class="listing-book">
        <div class="listing-cover-stack">${thumb ? `<img src="${esc(thumb)}" alt="${esc(p.title)}" loading="lazy" decoding="async">` : `<span class="listing-thumb-empty">No image</span>`}</div>
        <div>
          <strong>${esc(p.title)}</strong>
          <span class="sub">${esc(p.category || 'Book')}</span>
          <span class="sub">${esc(listingClassification(p))}</span>
        </div>
      </div>
    `;
}

function listingClassification(product) {
    const data = product.classification || {};
    return [data.className, data.streamOther || data.stream, data.courseOther || data.course, data.year ? `Year ${data.year}` : '', data.board, data.subject, data.itemOther || data.itemType].filter(Boolean).join(' · ');
}

function listingImagesCell(p) {
    const images = Array.isArray(p.images) ? p.images : [];
    const count = images.length;
    const strip = images.slice(0, 3).map(src => `<img src="${esc(src)}" alt="Listing photo" loading="lazy" decoding="async">`).join('');
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
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
}

function applyRolePermissions() {
    document.body.dataset.role = CURRENT_USER ? CURRENT_USER.role : '';
    document.querySelectorAll('[data-admin-only]').forEach((el) => {
        el.style.display = isAdmin() ? '' : 'none';
    });
}

function setupAdminToolbar() {
    document.querySelectorAll('[data-export-table]').forEach((btn) => {
        if (btn.dataset.exportBound) return;
        btn.dataset.exportBound = 'true';
        btn.addEventListener('click', () => exportTable(btn.dataset.exportTable));
    });
    document.querySelectorAll('[data-focus-search]').forEach((btn) => {
        if (btn.dataset.focusBound) return;
        btn.dataset.focusBound = 'true';
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.focusSearch);
            if (input) {
                input.focus();
                showAdminNotice('Type to filter this table');
            }
        });
    });
    document.querySelectorAll('[data-review-queue]').forEach((btn) => {
        if (btn.dataset.reviewBound) return;
        btn.dataset.reviewBound = 'true';
        btn.addEventListener('click', () => {
            activateTab('listings');
            const pendingBtn = document.querySelector('.filter-btn[data-status="pending"]');
            if (pendingBtn) pendingBtn.click();
        });
    });
}

function setupSearchFilters() {
    const globalSearch = document.getElementById('globalSearchInput');
    if (globalSearch && !globalSearch.dataset.searchBound) {
        globalSearch.dataset.searchBound = 'true';
        globalSearch.addEventListener('input', applyActiveSearchFilter);
    }
    document.querySelectorAll('.table-search input').forEach((input) => {
        if (input.dataset.searchBound) return;
        input.dataset.searchBound = 'true';
        input.addEventListener('input', applyActiveSearchFilter);
    });
    const messageSearch = document.getElementById('messagesSearchInput');
    if (messageSearch && !messageSearch.dataset.searchBound) {
        messageSearch.dataset.searchBound = 'true';
        messageSearch.addEventListener('input', filterMessageInbox);
    }
}

function setupNotificationButton() {
    const btn = document.getElementById('adminNotificationBtn');
    if (!btn || btn.dataset.notificationBound) return;
    btn.dataset.notificationBound = 'true';
    btn.addEventListener('click', () => {
        activateTab('messages');
        showAdminNotice('Message queue opened');
    });
}

function setupSidebarToggle() {
    const btn = document.getElementById('sidebarToggle');
    if (!btn || btn.dataset.sidebarBound) return;
    btn.dataset.sidebarBound = 'true';
    const saved = localStorage.getItem('cirvio_admin_sidebar_collapsed') === 'true';
    adminApp.classList.toggle('sidebar-collapsed', saved);
    btn.setAttribute('aria-expanded', String(!saved));
    btn.addEventListener('click', () => {
        const collapsed = !adminApp.classList.contains('sidebar-collapsed');
        adminApp.classList.toggle('sidebar-collapsed', collapsed);
        btn.setAttribute('aria-expanded', String(!collapsed));
        localStorage.setItem('cirvio_admin_sidebar_collapsed', String(collapsed));
    });
}

function filterTable(table, query) {
    if (AdminTables.filter(table.id, query)) return;
    const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row) => {
        if (row.classList.contains('empty-row')) return;
        const text = row.textContent.toLowerCase();
        const match = !terms.length || terms.every((term) => text.includes(term));
        row.classList.toggle('table-row-hidden', !match);
    });
}

function filterMessageInbox() {
    const input = document.getElementById('messagesSearchInput');
    const global = document.getElementById('globalSearchInput');
    const terms = `${input?.value || ''} ${global?.value || ''}`.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    document.querySelectorAll('.message-thread').forEach((row) => {
        const text = row.textContent.toLowerCase();
        const match = terms.every(term => text.includes(term)) && (activeMessageFilter === 'all' || row.dataset.needsReply === 'true');
        row.classList.toggle('table-row-hidden', !match);
        if (match) visible++;
    });
    document.getElementById('messageSearchEmpty').hidden = visible > 0 || ADMIN_MESSAGES.size === 0;
    document.getElementById('messageInboxCount').textContent = `${visible} of ${ADMIN_MESSAGES.size} conversations`;
}

function applyActiveSearchFilter() {
    const globalSearch = document.getElementById('globalSearchInput');
    const panel = document.getElementById('tab-' + activeTab) || document.querySelector('.tab-panel.active');
    if (!panel) return;
    const panelSearch = panel.querySelector('.table-search input');
    const query = `${globalSearch ? globalSearch.value : ''} ${panelSearch ? panelSearch.value : ''}`.trim();
    panel.querySelectorAll('table').forEach((table) => filterTable(table, query));
    decorateAdminTables(panel);
    if (activeTab === 'messages') filterMessageInbox();
}

function exportTable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const rows = AdminTables.exportRows(tableId) || [...table.querySelectorAll('tr')].filter((row) => row.offsetParent !== null && !row.classList.contains('empty-row'));
    if (rows.length <= 1) {
        showAdminNotice('No rows available to export');
        return;
    }
    const csv = rows.map((row) => [...row.children].map((cell) => {
        const raw = cell.textContent.replace(/\s+/g, ' ').trim();
        const text = /^[=+@-]/.test(raw) ? "'" + raw : raw;
        return `"${text.replace(/"/g, '""')}"`;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cirvio-${tableId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showAdminNotice('CSV export downloaded');
}

function emptyRow(colspan, message) {
    return `<tr class="empty-row"><td colspan="${colspan}" class="empty-state">${esc(message)}</td></tr>`;
}

function updateMessageBadges(count) {
    const safeCount = Number(count || 0);
    const navBadge = document.getElementById('messageNavBadge');
    const notificationBtn = document.getElementById('adminNotificationBtn');
    if (navBadge) {
        navBadge.textContent = safeCount;
        navBadge.classList.toggle('is-zero', safeCount === 0);
    }
    if (notificationBtn) {
        notificationBtn.dataset.count = String(safeCount);
        notificationBtn.classList.toggle('is-clear', safeCount === 0);
    }
}

ensurePasswordEye();
setupAdminToolbar();
setupSearchFilters();
setupNotificationButton();
setupSidebarToggle();

/* ---------- dashboard ---------- */
async function loadStats(options = {}) {
    const s = await api('/api/admin/stats', { signal: options.signal });
    if (options.signal?.aborted) return;
    document.getElementById('statUsers').textContent = s.totalUsers;
    document.getElementById('statProducts').textContent = s.totalProducts;
    document.getElementById('statPending').textContent = s.pendingProducts;
    document.getElementById('statApproved').textContent = s.approvedProducts;
    document.getElementById('statSold').textContent = s.soldProducts;
    document.getElementById('statOrders').textContent = s.totalOrders;
    document.getElementById('statRevenue').textContent = inr(s.totalRevenue);
    const paymentPending = document.getElementById('statPaymentPending');
    const dispatchPending = document.getElementById('statDispatchPending');
    if (paymentPending) paymentPending.textContent = s.paymentPendingOrders || 0;
    if (dispatchPending) dispatchPending.textContent = s.dispatchPendingOrders || 0;
    const opsPendingListings = document.getElementById('opsPendingListings');
    const opsPaymentPending = document.getElementById('opsPaymentPending');
    const opsDispatchPending = document.getElementById('opsDispatchPending');
    if (opsPendingListings) opsPendingListings.textContent = s.pendingProducts || 0;
    if (opsPaymentPending) opsPaymentPending.textContent = s.paymentPendingOrders || 0;
    if (opsDispatchPending) opsDispatchPending.textContent = s.dispatchPendingOrders || 0;
}

/* ---------- users ---------- */
async function loadUsers(options = {}) {
    const { users } = await api('/api/admin/users', { signal: options.signal });
    if (options.signal?.aborted) return;
    const activeUsers = users.filter((u) => u.status === 'active').length;
    const suspendedUsers = users.filter((u) => u.status === 'suspended').length;
    const employees = users.filter((u) => u.role === 'employee');
    const activeEmployees = employees.filter((u) => u.status === 'active').length;
    const suspendedEmployees = employees.filter((u) => u.status === 'suspended').length;
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setText('usersTotalMetric', users.length);
    setText('usersActiveMetric', activeUsers);
    setText('usersSuspendedMetric', suspendedUsers);
    setText('usersStaffMetric', users.filter(u => ['admin', 'employee'].includes(u.role)).length);
    setText('employeesTotalMetric', employees.length);
    setText('employeesActiveMetric', activeEmployees);
    setText('employeesSuspendedMetric', suspendedEmployees);
    setText('employeesPendingMetric', users.filter((u) => u.status === 'pending').length);
    AdminTables.set('usersTable', users, (u) => `
        <tr>
          <td><div class="user-cell"><span class="mini-avatar">${iconSvg('user')}</span><div><strong>${esc(u.name)}</strong><span class="sub">${esc(u.role)}</span></div></div></td>
          <td>${esc(u.email)}<span class="sub">${esc(u.role)}</span></td>
          <td>${esc(u.college || '-')}</td>
          <td>${esc(u.city || '-')}</td>
          <td>${u.listingsCount}</td>
          <td>${u.ordersCount}</td>
          <td><span class="badge badge-${u.status}">${u.status}</span></td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>
            <button type="button" class="row-btn btn-view" data-view-user="${esc(u._id)}">View profile</button>
            ${String(u._id) !== String(CURRENT_USER?._id || CURRENT_USER?.id) ? `<button type="button" class="row-btn btn-view" data-message-user="${esc(u._id)}">Message</button>` : ''}
            ${u.role === 'admin' || !isAdmin() ? `<span class="sub">${u.role}</span>` : `
              <button class="row-btn btn-suspend" onclick="toggleUserStatus('${u._id}','${u.status}')">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
              <button class="row-btn btn-delete" onclick="deleteUser('${u._id}')">Delete</button>
            `}
          </td>
        </tr>`, 'No users found.');

    const empBody = document.querySelector('#employeesTable tbody');
    if (empBody) {
        AdminTables.set('employeesTable', employees, (u) => `
          <tr>
          <td><div class="user-cell"><span class="mini-avatar">${iconSvg('user')}</span><div><strong>${esc(u.name)}</strong><span class="sub">${esc(u.email)}</span></div></div></td>
          <td>${esc(u.email)}</td>
            <td><span class="badge badge-${u.status}">${u.status}</span></td>
            <td>${fmtDate(u.createdAt)}</td>
            <td>
              <button class="row-btn btn-suspend" onclick="toggleUserStatus('${u._id}','${u.status}')">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
              <button class="row-btn btn-approve" onclick="resetEmployeePassword('${u._id}')">Reset Password</button>
              <button class="row-btn btn-delete" onclick="deleteUser('${u._id}')">Delete</button>
            </td>
          </tr>`, 'No CIRVIO employees yet.');
    }
    applyActiveSearchFilter();
}

async function toggleUserStatus(id, currentStatus) {
    const status = currentStatus === 'active' ? 'suspended' : 'active';
    try {
        await api(`/api/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
        await loadUsers();
        showAdminNotice('User status updated');
    } catch (error) { showAdminNotice(error.message); }
}
async function deleteUser(id) {
    if (!confirm('Delete this user permanently?')) return;
    try {
        await api(`/api/admin/users/${id}`, { method: 'DELETE' });
        await Promise.allSettled([loadUsers(), loadStats()]);
    } catch (error) { showAdminNotice(error.message); }
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

async function loadListings(options = {}) {
    const { products: allProducts } = await api('/api/admin/products', { signal: options.signal });
    if (options.signal?.aborted) return;
    const products = allProducts.filter(p => !currentListingFilter || p.status === currentListingFilter);
    ADMIN_PRODUCTS.clear();
    allProducts.forEach((p) => ADMIN_PRODUCTS.set(String(p._id), p));
    AdminTables.set('listingsTable', products, (p) => `
        <tr>
          <td>${listingBookCell(p)}</td>
          <td>${listingImagesCell(p)}</td>
          <td>${esc(p.category)}</td>
          <td>${listingPricingDetails(p)}</td>
          <td class="pair-cell">${p.seller ? esc(p.seller.name) : '-'}<span class="sub">${p.seller ? esc(p.seller.email) : ''}</span></td>
          <td><span class="badge badge-${p.status}">${p.status}</span></td>
          <td>${fmtDate(p.createdAt)}</td>
          <td>${listingActions(p)}</td>
        </tr>`, 'No listings found for this filter.');
    const latestBody = document.querySelector('#latestListingsTable tbody');
    if (latestBody) {
        latestBody.innerHTML = allProducts.length ? allProducts.slice(0, 8).map((p) => `
        <tr>
          <td>${listingBookCell(p)}</td>
          <td>${listingImagesCell(p)}</td>
          <td>${listingPricingDetails(p)}</td>
          <td class="pair-cell">${p.seller ? esc(p.seller.name) : '-'}<span class="sub">${p.seller ? esc(p.seller.email) : ''}</span></td>
          <td><span class="badge badge-${p.status}">${p.status}</span></td>
          <td>${fmtDate(p.createdAt)}</td>
          <td>${listingActions(p)}</td>
        </tr>`).join('') : emptyRow(7, 'No latest listings yet.');
    }
    applyActiveSearchFilter();
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
    try {
        await api(`/api/admin/products/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) });
        await Promise.allSettled([loadListings(), loadStats()]);
    } catch (error) { showAdminNotice(error.message); }
}
async function deleteProduct(id) {
    if (!confirm('Delete this listing permanently?')) return;
    try {
        await api(`/api/admin/products/${id}`, { method: 'DELETE' });
        await Promise.allSettled([loadListings(), loadStats()]);
    } catch (error) { showAdminNotice(error.message); }
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
        <div><dt>Seller</dt><dd>${esc(product.seller ? `${product.seller.name} (${product.seller.email || 'no email'})` : 'No seller')} ${product.seller?._id ? `<button type="button" class="row-btn btn-view" data-view-user="${esc(product.seller._id)}">View profile</button>` : ''}</dd></div>
        <div><dt>Seller ID</dt><dd>${esc(product.seller?._id || 'Not available')}</dd></div>
        <div><dt>Seller phone</dt><dd>${esc(product.seller?.phone || 'Not provided')}</dd></div>
        <div><dt>Category</dt><dd>${esc(product.category || 'Uncategorised')}</dd></div>
        <div><dt>Class / Course / Item type</dt><dd>${esc(listingClassification(product) || 'Not specified')}</dd></div>
        <div><dt>Condition</dt><dd>${esc(product.condition || 'Not provided')}</dd></div>
        <div><dt>Original / MRP</dt><dd>${Number(product.originalPrice || 0) > 0 ? esc(inr(product.originalPrice)) : 'Not provided'}</dd></div>
        <div><dt>${product.type === 'rent' ? 'Rent price' : 'Selling price'}</dt><dd>${esc(listingPrice(product))}</dd></div>
        ${product.type === 'rent' ? `<div><dt>Rental period</dt><dd>${product.rentalTerm === 'semester' ? '1 semester' : '1 week'}</dd></div>` : ''}
        <div><dt>Uploaded photos</dt><dd>${images.length} clear book photo${images.length === 1 ? '' : 's'} available for review</dd></div>
        <div><dt>Location</dt><dd>${esc(product.location || '-')}</dd></div>
        <div><dt>Description</dt><dd>${esc(product.description || 'No description provided.')}</dd></div>
      </dl>
      ${product.seller ? `<button type="button" class="row-btn btn-view" data-message-listing="${esc(product._id)}">Message seller</button>` : ''}
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
async function loadPurchases(options = {}) {
    const { purchases } = await api('/api/admin/purchases', { signal: options.signal });
    if (options.signal?.aborted) return;
    ADMIN_PURCHASES.clear();
    purchases.forEach((row) => ADMIN_PURCHASES.set(String(row.orderId), row));

    const rowHtml = (row) => `
        <tr>
          <td>${fmtDate(row.date)}</td>
          <td class="pair-cell">${row.buyer ? esc(row.buyer.name) : '-'}<span class="sub">${row.buyer ? esc(row.buyer.email) : ''}</span></td>
          <td class="pair-cell">${esc(row.title)}<span class="sub">${row.product ? esc(row.product.category) : ''}</span></td>
          <td class="pair-cell">${row.seller ? esc(row.seller.name) : '-'}<span class="sub">${row.seller ? esc(row.seller.email) : ''}</span></td>
          <td>${row.qty}</td>
          <td>${inr(row.price * row.qty)}</td>
          <td><span class="badge badge-${paymentBadge(row.paymentStatus)}">${labelStatus(row.paymentStatus)}</span><span class="sub">${labelStatus(row.paymentMode)}</span></td>
          <td><span class="badge badge-${dispatchBadge(row.dispatchStatus)}">${labelStatus(row.dispatchStatus)}</span><span class="sub">${esc(row.trackingId || row.dispatchPartner || row.dispatchMode || '')}</span></td>
          <td><span class="badge badge-${orderBadge(row.orderStatus)}">${labelStatus(row.orderStatus)}</span></td>
          <td><button class="row-btn btn-view" onclick="openOrderOps('${row.orderId}')">Update</button></td>
        </tr>`;

    AdminTables.set('purchasesTable', purchases, rowHtml, 'No purchases yet.');
    document.querySelector('#recentPurchasesTable tbody').innerHTML = purchases.length ? purchases.slice(0, 6).map((row) => `
        <tr>
          <td>${fmtDate(row.date)}</td>
          <td>${row.buyer ? esc(row.buyer.name) : '-'}</td>
          <td>${esc(row.title)}</td>
          <td>${row.seller ? esc(row.seller.name) : '-'}</td>
          <td>${inr(row.price * row.qty)}</td>
        </tr>`).join('') : emptyRow(5, 'No recent purchases yet.');
    applyActiveSearchFilter();
}

function labelStatus(value) {
    return String(value || '-').replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function paymentBadge(status) {
    if (status === 'collected') return 'approved';
    if (status === 'failed' || status === 'refunded') return 'rejected';
    return 'pending';
}

function dispatchBadge(status) {
    if (status === 'delivered') return 'approved';
    if (status === 'returned') return 'rejected';
    if (['picked-up', 'in-transit', 'packed'].includes(status)) return 'sold';
    return 'pending';
}

function orderBadge(status) {
    if (status === 'delivered') return 'approved';
    if (status === 'cancelled') return 'rejected';
    if (status === 'shipped') return 'sold';
    return 'pending';
}

function selectOptions(options, value) {
    return options.map((option) => `<option value="${option}" ${option === value ? 'selected' : ''}>${labelStatus(option)}</option>`).join('');
}

function dateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function ensureOrderOpsModal() {
    if (document.getElementById('orderOpsModal')) return;
    const modal = document.createElement('div');
    modal.id = 'orderOpsModal';
    modal.className = 'image-modal';
    modal.innerHTML = `
      <div class="ops-dialog" role="dialog" aria-label="Update order operations">
        <div class="image-dialog-head">
          <div>
            <h3 id="opsTitle">Update order</h3>
            <p id="opsMeta"></p>
          </div>
          <button class="row-btn btn-delete" id="opsClose">Close</button>
        </div>
        <div class="ops-body">
          <div id="opsParties" class="ops-parties"></div>
          <div class="ops-grid">
            <label>Order status<select id="opsOrderStatus"></select></label>
            <label>Payment status<select id="opsPaymentStatus"></select></label>
            <label>Payment mode<select id="opsPaymentMode"></select></label>
            <label>Payment reference<input id="opsPaymentReference" placeholder="Cash receipt / UPI ref"></label>
            <label>Dispatch status<select id="opsDispatchStatus"></select></label>
            <label>Dispatch mode<select id="opsDispatchMode"></select></label>
            <label>Dispatch partner<input id="opsDispatchPartner" placeholder="Runner / courier name"></label>
            <label>Tracking ID<input id="opsTrackingId" placeholder="Tracking / handover ID"></label>
            <label>Dispatch date<input id="opsDispatchDate" type="date"></label>
            <label>Delivered date<input id="opsDeliveredAt" type="date"></label>
          </div>
          <label class="ops-wide">Delivery / pickup address<textarea id="opsDeliveryAddress" placeholder="Address shared by buyer"></textarea></label>
          <label class="ops-wide">Admin notes<textarea id="opsAdminNotes" placeholder="Internal notes for payment, pickup, dispatch, seller coordination"></textarea></label>
          <div class="ops-actions">
            <span id="opsStatus" class="sub"></span>
            <button class="row-btn btn-approve" id="opsSave">Save Update</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('opsClose').addEventListener('click', closeOrderOps);
    document.getElementById('opsSave').addEventListener('click', saveOrderOps);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeOrderOps();
    });
}

let activeOrderOpsId = '';
function openOrderOps(orderId) {
    const row = ADMIN_PURCHASES.get(String(orderId));
    if (!row) return;
    activeOrderOpsId = String(orderId);
    ensureOrderOpsModal();
    document.getElementById('opsTitle').textContent = `Order ${String(orderId).slice(-6).toUpperCase()}`;
    document.getElementById('opsMeta').textContent = `${fmtDate(row.date)} | ${esc(row.title)} | ${inr(row.price * row.qty)}`;
    document.getElementById('opsParties').innerHTML = `
      <div class="identity-card"><span class="role-pill buyer">Buyer</span><strong>${esc(row.buyer?.name || '-')}</strong><span class="sub">${esc(row.buyer?.email || '')}</span><span class="sub">${esc(row.buyer?.phone || row.buyer?.city || '')}</span></div>
      <div class="identity-card"><span class="role-pill seller">Seller</span><strong>${esc(row.seller?.name || '-')}</strong><span class="sub">${esc(row.seller?.email || '')}</span><span class="sub">${esc(row.seller?.phone || row.seller?.city || '')}</span></div>
      <div class="identity-card"><span class="role-pill">Product</span><strong>${esc(row.title || '-')}</strong><span class="sub">Qty ${row.qty} | ${inr(row.price * row.qty)}</span></div>
    `;
    document.getElementById('opsOrderStatus').innerHTML = selectOptions(['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'], row.orderStatus || 'placed');
    document.getElementById('opsPaymentStatus').innerHTML = selectOptions(['pending', 'collected', 'failed', 'refunded'], row.paymentStatus || 'pending');
    document.getElementById('opsPaymentMode').innerHTML = selectOptions(['manual', 'cash', 'upi', 'bank-transfer', 'other'], row.paymentMode || 'manual');
    document.getElementById('opsDispatchStatus').innerHTML = selectOptions(['not-dispatched', 'packed', 'picked-up', 'in-transit', 'delivered', 'returned'], row.dispatchStatus || 'not-dispatched');
    document.getElementById('opsDispatchMode').innerHTML = selectOptions(['pending', 'cirvio-runner', 'seller-drop', 'buyer-pickup', 'courier', 'other'], row.dispatchMode || 'pending');
    document.getElementById('opsPaymentReference').value = row.paymentReference || '';
    document.getElementById('opsDispatchPartner').value = row.dispatchPartner || '';
    document.getElementById('opsTrackingId').value = row.trackingId || '';
    document.getElementById('opsDispatchDate').value = dateInputValue(row.dispatchDate);
    document.getElementById('opsDeliveredAt').value = dateInputValue(row.deliveredAt);
    document.getElementById('opsDeliveryAddress').value = row.deliveryAddress || '';
    document.getElementById('opsAdminNotes').value = row.adminNotes || '';
    document.getElementById('opsStatus').textContent = '';
    document.getElementById('orderOpsModal').classList.add('open');
}

function closeOrderOps() {
    const modal = document.getElementById('orderOpsModal');
    if (modal) modal.classList.remove('open');
}

async function saveOrderOps() {
    if (!activeOrderOpsId) return;
    const saveButton = document.getElementById('opsSave');
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    const status = document.getElementById('opsStatus');
    status.textContent = 'Saving...';
    const payload = {
        status: document.getElementById('opsOrderStatus').value,
        paymentStatus: document.getElementById('opsPaymentStatus').value,
        paymentMode: document.getElementById('opsPaymentMode').value,
        paymentReference: document.getElementById('opsPaymentReference').value,
        dispatchStatus: document.getElementById('opsDispatchStatus').value,
        dispatchMode: document.getElementById('opsDispatchMode').value,
        dispatchPartner: document.getElementById('opsDispatchPartner').value,
        trackingId: document.getElementById('opsTrackingId').value,
        dispatchDate: document.getElementById('opsDispatchDate').value,
        deliveredAt: document.getElementById('opsDeliveredAt').value,
        deliveryAddress: document.getElementById('opsDeliveryAddress').value,
        adminNotes: document.getElementById('opsAdminNotes').value
    };
    try {
        await api(`/api/admin/orders/${activeOrderOpsId}/operations`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        status.textContent = 'Saved';
        await Promise.all([loadPurchases(), loadStats()]);
        setTimeout(closeOrderOps, 450);
    } catch (err) {
        status.textContent = err.message;
    } finally {
        saveButton.disabled = false;
    }
}

/* ---------- product messages ---------- */
function messageNeedsReply(message) {
    const replies = message.replies || [];
    const last = replies[replies.length - 1];
    return last ? !['admin', 'employee'].includes(last.senderRole) : !!message.text && !['admin', 'employee'].includes(message.senderRole);
}

async function loadMessages({ notify = false, signal } = {}) {
    const inbox = document.getElementById('messageInboxList');
    if (!inbox) return;
    const previous = new Map(ADMIN_MESSAGES);
    const revision = messageRevision;
    const { messages } = await api('/api/admin/messages', { signal });
    if (signal?.aborted || revision !== messageRevision) return;
    const signature = JSON.stringify(messages);
    if (inbox.dataset.signature === signature) return;
    inbox.dataset.signature = signature;
    ADMIN_MESSAGES.clear();
    messages.forEach((m) => ADMIN_MESSAGES.set(String(m._id), m));
    const needsReplyCount = messages.filter(messageNeedsReply).length;
    updateMessageBadges(needsReplyCount);
    if (notify) {
        const changed = messages.find((m) => {
            const old = previous.get(String(m._id));
            if (!old) return messageNeedsReply(m);
            const replies = m.replies || [];
            const oldReplies = old.replies || [];
            const lastReply = replies[replies.length - 1];
            return replies.length > oldReplies.length && lastReply && ['buyer', 'seller'].includes(lastReply.senderRole);
        });
        if (changed) {
            const sender = changed.sender || {};
            showAdminNotice(`New message from ${sender.name || 'buyer'}`);
        }
    }
    renderAdminMessages();
}

function renderAdminMessages() {
    const inbox = document.getElementById('messageInboxList');
    const inboxScroll = inbox.scrollTop;
    const messages = [...ADMIN_MESSAGES.values()].sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0));
    updateMessageBadges(messages.filter(messageNeedsReply).length);
    const countLabel = document.getElementById('messageInboxCount');
    if (countLabel) countLabel.textContent = `${messages.length} conversation${messages.length === 1 ? '' : 's'}`;
    inbox.innerHTML = messages.length ? messages.map((m) => {
        const product = m.product || {};
        const seller = product.seller || {};
        const sender = m.sender || {};
        const replies = m.replies || [];
        const lastReply = replies[replies.length - 1];
        const lastText = lastReply ? lastReply.text : m.text;
        const needsReply = messageNeedsReply(m);
        return `
        <button class="message-thread ${String(m._id) === activeMessageId ? 'active-row' : ''}" data-message-id="${m._id}" data-needs-reply="${needsReply}" type="button" onclick="handleMessageRowClick(event,'${m._id}')">
          <span class="avatar">${iconSvg('user')}</span>
          <span class="message-thread-main">
            <span class="thread-top">
              <strong>${esc(sender.name || 'User')}</strong>
              <small>${fmtDate(m.updatedAt || m.createdAt)}</small>
            </span>
            <span class="thread-product">${esc(product.title || m.productTitle || (m.conversationType === 'direct' ? 'Direct message' : 'Product enquiry'))}</span>
            <span class="thread-preview">${esc(lastText || 'Start this conversation')}</span>
            <span class="thread-meta">${esc(sender.email || sender.phone || '')}${m.conversationType === 'direct' ? ' | Private chat' : (seller.name ? ` | Seller: ${esc(seller.name)}` : '')}</span>
          </span>
          ${needsReply ? '<span class="thread-unread">New</span>' : ''}
        </button>`;
    }).join('') : `
      <div class="chat-empty inbox-empty">
        <span class="page-icon">${iconSvg('messages')}</span>
        <strong>No messages yet</strong>
        <p>Start a new message or open a listing to contact its seller.</p>
      </div>`;
    filterMessageInbox();
    inbox.scrollTop = inboxScroll;
    if (messages.length) {
        const requested = history.state?.tab === 'messages' ? history.state.thread : '';
        const panelMessageId = ADMIN_MESSAGES.has(requested) ? requested : (ADMIN_MESSAGES.has(activeMessageId) ? activeMessageId : String(messages[0]._id));
        renderMessageSidePanel(panelMessageId);
        if (requested && ADMIN_MESSAGES.has(requested)) document.querySelector('.messages-layout').classList.add('conversation-open');
    } else {
        renderMessageSidePanel('');
    }
    applyActiveSearchFilter();
}

function messageParticipantLabel(role, direct = false) {
    if (['admin', 'employee'].includes(role)) return 'CIRVIO Admin';
    if (role === 'seller') return 'Seller';
    return direct ? 'User' : 'Buyer';
}

function startAdminMessagePoll() {
    if (adminMessagePollStarted) return;
    adminMessagePollStarted = true;
    setInterval(async () => {
    if (document.hidden || !TOKEN || navigator.onLine === false) return;
        try {
            await loadMessages({ notify: true });
        } catch (err) {
            console.warn('Could not refresh admin messages:', err.message);
        }
    }, 7000);
}

let adminNoticeTimer;
function showAdminNotice(text) {
    let notice = document.getElementById('adminNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'adminNotice';
        notice.className = 'admin-notice';
        document.body.appendChild(notice);
    }
    notice.textContent = text;
    notice.classList.add('show');
    clearTimeout(adminNoticeTimer);
    adminNoticeTimer = setTimeout(() => notice.classList.remove('show'), 3200);
}

function handleMessageRowClick(event, id) {
    renderMessageSidePanel(id);
    document.querySelector('.messages-layout').classList.add('conversation-open');
    if (history.state?.thread !== String(id)) history.pushState({ tab: 'messages', thread: String(id) }, '', '#messages');
}

function renderMessageSidePanel(id) {
    const panel = document.getElementById('messageSidePanel');
    if (!panel) return;
    const previousInput = document.getElementById('sideReplyText');
    const previousId = activeMessageId;
    const previousThread = panel.querySelector('.chat-thread');
    const scrollTop = previousThread?.scrollTop || 0;
    const atBottom = !previousThread || previousThread.scrollHeight - scrollTop - previousThread.clientHeight < 48;
    const keepFocus = document.activeElement === previousInput;
    const selection = previousInput ? [previousInput.selectionStart, previousInput.selectionEnd] : [0, 0];
    if (previousInput && activeMessageId) messageDrafts.set(activeMessageId, previousInput.value);
    if (!id || !ADMIN_MESSAGES.has(String(id))) {
        activeMessageId = '';
        panel.innerHTML = `
          <div class="chat-empty">
            <span class="page-icon">${iconSvg('messages')}</span>
            <strong>Select a conversation</strong>
            <p>Select a chat or start a new message to any user.</p>
          </div>`;
        document.querySelectorAll('.message-thread').forEach((row) => row.classList.remove('active-row'));
        return;
    }
    activeMessageId = String(id);
    const message = ADMIN_MESSAGES.get(activeMessageId);
    const product = message.product || {};
    const seller = product.seller || {};
    const sender = message.sender || {};
    const direct = message.conversationType === 'direct';
    const thread = [...(message.text ? [{ text: message.text, senderRole: message.senderRole || 'buyer', createdAt: message.createdAt }] : []), ...(message.replies || [])];
    document.querySelectorAll('.message-thread').forEach((row) => {
        row.classList.toggle('active-row', row.dataset.messageId === activeMessageId);
    });
    panel.innerHTML = `
      <div class="chat-header">
        <button type="button" class="icon-btn message-back" id="messageBackBtn" aria-label="Back to inbox"><svg class="ui-icon" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
        <div class="chat-contact">
          <span class="avatar">${iconSvg('user')}</span>
          <div>
            <strong>${esc(sender.name || 'User')}</strong>
            <span class="sub">${esc(sender.email || sender.phone || '')}</span>
            <span class="chat-topic">${iconSvg(direct && !message.productTitle ? 'messages' : 'product')} ${esc(product.title || message.productTitle || (direct ? 'Direct message' : 'Product enquiry'))} <small>${direct ? 'Only this user and CIRVIO staff' : (seller.name ? `Seller: ${esc(seller.name)}` : 'Seller unavailable')}</small></span>
          </div>
        </div>
        ${sender._id ? `<button type="button" class="row-btn btn-view chat-profile-action" data-view-user="${esc(sender._id)}">View profile</button>` : ''}
      </div>
      <div class="chat-thread">
        <div class="chat-date"><span>${fmtDate(message.createdAt)}</span></div>
        ${thread.length ? thread.map((part) => `
          <div class="reply-bubble ${['admin', 'employee'].includes(part.senderRole) ? 'from-admin' : 'from-buyer'}">
            <strong>${messageParticipantLabel(part.senderRole, direct)}</strong>
            <p>${esc(part.text || '')}</p>
            <small>${part.createdAt && Number.isFinite(Date.parse(part.createdAt)) ? new Date(part.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Time unavailable'}</small>
          </div>`).join('') : '<p class="conversation-start-hint">Send a message to start this private conversation.</p>'}
      </div>
      <div class="chat-input">
        <textarea id="sideReplyText" aria-label="Reply to conversation" placeholder="Type your message..." maxlength="2000" rows="1"></textarea>
        <button type="button" class="row-btn btn-approve" id="sideReplySend" data-sending="${pendingReplies.has(activeMessageId)}" ${pendingReplies.has(activeMessageId) || navigator.onLine === false ? 'disabled' : ''}>${pendingReplies.has(activeMessageId) ? 'Sending...' : 'Send'}</button>
        <span id="sideReplyStatus" class="side-reply-status sub" role="status"></span>
      </div>`;
    document.getElementById('sideReplySend').addEventListener('click', sendSidePanelReply);
    document.getElementById('messageBackBtn').addEventListener('click', () => {
        if (history.state?.thread) history.back();
        else closeMobileConversation();
    });
    const nextInput = document.getElementById('sideReplyText');
    nextInput.value = messageDrafts.get(activeMessageId) || '';
    const resizeInput = () => {
        nextInput.style.height = 'auto';
        nextInput.style.height = Math.min(112, nextInput.scrollHeight) + 'px';
        messageDrafts.set(activeMessageId, nextInput.value);
    };
    nextInput.addEventListener('input', resizeInput);
    nextInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
            event.preventDefault();
            sendSidePanelReply();
        }
    });
    resizeInput();
    requestAnimationFrame(() => {
        if (nextInput.isConnected && nextInput.getClientRects().length) resizeInput();
    });
    if (keepFocus && previousId === activeMessageId) {
        nextInput.focus({ preventScroll: true });
        nextInput.setSelectionRange(...selection);
    }
    const threadEl = panel.querySelector('.chat-thread');
    if (threadEl) threadEl.scrollTop = previousId === activeMessageId && !atBottom ? scrollTop : threadEl.scrollHeight;
}

async function sendSidePanelReply() {
    const threadId = activeMessageId;
    if (!threadId || pendingReplies.has(threadId)) return;
    const textEl = document.getElementById('sideReplyText');
    const status = document.getElementById('sideReplyStatus');
    const text = textEl ? textEl.value.trim() : '';
    const originalText = textEl?.value || '';
    if (!activeMessageId || !text) {
        if (status) status.textContent = 'Reply text is required';
        return;
    }
    if (status) status.textContent = 'Sending...';
    const button = document.getElementById('sideReplySend');
    pendingReplies.add(threadId);
    button.disabled = true;
    button.dataset.sending = 'true';
    button.textContent = 'Sending...';
    try {
        const { message } = await api(`/api/admin/messages/${threadId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ text })
        });
        if (!message?._id) throw new Error('The server did not confirm your reply. Please refresh this conversation.');
        messageRevision++;
        ADMIN_MESSAGES.set(String(message._id), message);
        adminLoads.get('messages')?.controller.abort();
        document.getElementById('messageInboxList').dataset.signature = '';
        if (messageDrafts.get(threadId) === originalText || (activeMessageId === threadId && textEl.value === originalText)) {
            messageDrafts.delete(threadId);
            if (activeMessageId === threadId) textEl.value = '';
        }
        pendingReplies.delete(threadId);
        renderAdminMessages();
        showAdminNotice('Reply sent');
    } catch (err) {
        if (activeMessageId === threadId) document.getElementById('sideReplyStatus').textContent = err.message;
        else showAdminNotice(err.message);
    } finally {
        pendingReplies.delete(threadId);
        if (activeMessageId === threadId) {
            const currentButton = document.getElementById('sideReplySend');
            if (currentButton) {
                currentButton.disabled = navigator.onLine === false;
                currentButton.dataset.sending = 'false';
                currentButton.textContent = 'Send';
            }
        }
    }
}

function ensureMessageReplyModal() {
    if (document.getElementById('messageReplyModal')) return;
    const modal = document.createElement('div');
    modal.id = 'messageReplyModal';
    modal.className = 'image-modal';
    modal.innerHTML = `
      <div class="message-reply-dialog" role="dialog" aria-label="Reply to product message">
        <div class="image-dialog-head">
          <div>
            <h3 id="messageReplyTitle">Reply to enquiry</h3>
            <p id="messageReplyMeta"></p>
          </div>
          <button class="row-btn btn-delete" id="messageReplyClose">Close</button>
        </div>
        <div class="message-reply-body">
          <div id="messageReplyContext" class="message-reply-context"></div>
          <div id="messageReplyThread" class="message-reply-thread"></div>
          <textarea id="messageReplyText" placeholder="Type CIRVIO admin reply..."></textarea>
          <div class="message-reply-actions">
            <span id="messageReplyStatus" class="sub"></span>
            <button class="row-btn btn-approve" id="messageReplySend">Send Reply</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('messageReplyClose').addEventListener('click', closeMessageReply);
    document.getElementById('messageReplySend').addEventListener('click', sendMessageReply);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeMessageReply();
    });
}

function openMessageReply(id) {
    const message = ADMIN_MESSAGES.get(String(id));
    if (!message) return;
    ensureMessageReplyModal();
    activeMessageId = String(id);
    renderMessageSidePanel(id);
    const product = message.product || {};
    const seller = product.seller || {};
    const sender = message.sender || {};
    document.getElementById('messageReplyTitle').textContent = product.title || message.productTitle || 'Product enquiry';
    document.getElementById('messageReplyMeta').textContent = `${sender.name || 'Buyer'} -> CIRVIO Admin | Seller: ${seller.name || '-'}`;
    document.getElementById('messageReplyContext').innerHTML = `
      <div class="identity-card"><span class="role-pill buyer">Buyer</span><strong>${esc(sender.name || '-')}</strong><span class="sub">${esc(sender.email || '')}</span><span class="sub">${esc(sender.phone || sender.city || sender.college || '')}</span></div>
      <div class="identity-card"><span class="role-pill seller">Seller</span><strong>${esc(seller.name || '-')}</strong><span class="sub">${esc(seller.email || '')}</span><span class="sub">${esc(seller.phone || seller.city || seller.college || '')}</span></div>
      <div class="identity-card"><span class="role-pill">Product</span><strong>${esc(product.title || message.productTitle || '-')}</strong><span class="sub">${esc(product.location || '-')}</span></div>
    `;
    const parts = [{ text: message.text, senderRole: 'buyer', createdAt: message.createdAt }, ...(message.replies || [])];
    document.getElementById('messageReplyThread').innerHTML = parts.map((part) => `
      <div class="reply-bubble ${['admin', 'employee'].includes(part.senderRole) ? 'from-admin' : 'from-buyer'}">
        <strong>${messageParticipantLabel(part.senderRole)}</strong>
        <p>${esc(part.text || '')}</p>
        <small>${fmtDate(part.createdAt)}</small>
      </div>`).join('');
    document.getElementById('messageReplyText').value = '';
    document.getElementById('messageReplyStatus').textContent = '';
    document.getElementById('messageReplyModal').classList.add('open');
}

function closeMessageReply() {
    const modal = document.getElementById('messageReplyModal');
    if (modal) modal.classList.remove('open');
}

async function sendMessageReply() {
    const textEl = document.getElementById('messageReplyText');
    const status = document.getElementById('messageReplyStatus');
    const text = textEl.value.trim();
    if (!activeMessageId || !text) {
        status.textContent = 'Reply text is required';
        return;
    }
    status.textContent = 'Sending...';
    try {
        const { message } = await api(`/api/admin/messages/${activeMessageId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ text })
        });
        ADMIN_MESSAGES.set(String(message._id), message);
        status.textContent = 'Reply sent';
        await loadMessages();
        openMessageReply(message._id);
    } catch (err) {
        status.textContent = err.message;
    }
}

/* ---------- allowed frontend URLs ---------- */
function ensureSettingsPanel() {
    if (document.getElementById('tab-settings')) return;
    const nav = document.querySelector('.sidebar-nav') || document.querySelector('nav');
    if (nav) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.dataset.tab = 'settings';
        btn.innerHTML = `<span class="nav-glyph">${iconSvg('settings')}</span><span class="nav-label">Settings</span>`;
        btn.addEventListener('click', () => activateTab('settings'));
        nav.appendChild(btn);
    }

    const appMain = adminApp.querySelector('main') || adminApp;
    const section = document.createElement('section');
    section.id = 'tab-settings';
    section.className = 'tab-panel';
    section.innerHTML = `
      <div class="panel-head">
        <div>
          <h2>Staff Settings</h2>
          <p>Manage your own staff profile. Admin-only platform settings are separated below.</p>
        </div>
      </div>
      <div class="settings-layout">
        <section class="settings-card notification-settings">
          <div class="settings-card-head">
            <span class="role-pill">${iconSvg('messages')}</span>
            <div>
              <h3>Phone notifications</h3>
              <p>Receive new message alerts on this device, even when the admin app is closed.</p>
            </div>
          </div>
          <button type="button" class="soft-btn" id="enableAdminNotifications" disabled>Checking notifications...</button>
          <p id="adminNotificationStatus" role="status" aria-live="polite"></p>
        </section>

        <section class="settings-card">
          <div class="settings-card-head">
            <span class="role-pill ${isAdmin() ? 'seller' : 'buyer'}">${iconSvg('user')}</span>
            <div>
              <h3>My staff profile</h3>
              <p>These details are private to the CIRVIO operations panel.</p>
            </div>
          </div>
          <div class="staff-settings-form">
            <label>Name<input id="staffName" value="${esc(CURRENT_USER?.name || '')}" placeholder="Your name"></label>
            <label>Phone<input id="staffPhone" value="${esc(CURRENT_USER?.phone || '')}" placeholder="Phone"></label>
            <label>City<input id="staffCity" value="${esc(CURRENT_USER?.city || '')}" placeholder="City"></label>
            <label>College / Team<input id="staffCollege" value="${esc(CURRENT_USER?.college || '')}" placeholder="Team or campus"></label>
          </div>
          <div class="settings-actions">
            <button class="row-btn btn-approve" id="saveStaffProfileBtn">Save Profile</button>
            <span id="staffProfileStatus" class="sub"></span>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-card-head">
            <span class="role-pill">${iconSvg('lock')}</span>
            <div>
              <h3>Password</h3>
              <p>Change only your own admin/employee login password.</p>
            </div>
          </div>
          <div class="staff-settings-form two">
            <label>Current password<input id="staffCurrentPassword" type="password" autocomplete="current-password"></label>
            <label>New password<input id="staffNewPassword" type="password" autocomplete="new-password"></label>
          </div>
          <div class="settings-actions">
            <button class="row-btn btn-view" id="changeStaffPasswordBtn">Update Password</button>
            <span id="staffPasswordStatus" class="sub"></span>
          </div>
        </section>

        <section class="settings-card admin-settings-card" data-admin-only>
          <div class="settings-card-head">
            <span class="role-pill seller">${iconSvg('settings')}</span>
            <div>
              <h3>Frontend URLs</h3>
              <p>Only admins can edit the browser origins allowed to call this backend.</p>
            </div>
          </div>
          <label for="clientOriginsInput">Allowed frontend URLs</label>
          <textarea id="clientOriginsInput" rows="7" placeholder="https://your-frontend.com&#10;http://localhost:5500"></textarea>
          <p class="sub">One URL per line. URLs from CLIENT_ORIGIN / CLIENT_ORIGINS in .env are always included.</p>
          <div id="envOriginsBox" class="origin-list"></div>
          <div class="settings-actions">
            <button class="row-btn btn-approve" id="saveClientOriginsBtn">Save URLs</button>
            <span id="clientOriginsStatus" class="sub"></span>
          </div>
        </section>

        <section class="settings-card site-media-card" data-admin-only>
          <div class="settings-card-head">
            <span class="role-pill seller">${iconSvg('product')}</span>
            <div>
              <h3>Website Media</h3>
              <p>Upload or paste links for homepage photos, about video and login background.</p>
            </div>
          </div>
          <div id="siteMediaGrid" class="site-media-grid"></div>
          <div class="settings-actions">
            <button class="row-btn btn-approve" id="saveSiteMediaBtn">Save Website Media</button>
            <span id="siteMediaStatus" class="sub"></span>
          </div>
        </section>
      </div>`;
    appMain.appendChild(section);
    document.getElementById('saveStaffProfileBtn').addEventListener('click', saveStaffProfile);
    document.getElementById('changeStaffPasswordBtn').addEventListener('click', changeStaffPassword);
    document.getElementById('saveClientOriginsBtn').addEventListener('click', saveClientOrigins);
    document.getElementById('saveSiteMediaBtn').addEventListener('click', saveSiteMedia);
    buildSiteMediaInputs();
}

function ensureEmployeePanel() {
    if (document.getElementById('tab-employees')) return;
    const nav = document.querySelector('.sidebar-nav') || document.querySelector('nav');
    if (nav) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.dataset.tab = 'employees';
        btn.dataset.adminOnly = 'true';
        btn.innerHTML = `<span class="nav-glyph">${iconSvg('employee')}</span><span class="nav-label">Employees</span>`;
        btn.addEventListener('click', () => activateTab('employees'));
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
          <h2>Employee Management</h2>
          <p>Create employee logins and control who can work on reviews, messages and orders.</p>
        </div>
      </div>
      <div class="employee-layout">
        <section class="settings-card employee-create-card">
          <div class="settings-card-head">
            <span class="role-pill seller">${iconSvg('employee')}</span>
            <div>
              <h3>Create employee login</h3>
              <p>Employee accounts get operations access, not admin-only settings.</p>
            </div>
          </div>
          <div class="employee-form">
            <label>Name<input id="empName" placeholder="Employee name"></label>
            <label>Email / ID<input id="empEmail" type="email" placeholder="employee@cirvio"></label>
            <label>Password<input id="empPassword" type="password" placeholder="Minimum 6 characters"></label>
            <label>Phone<input id="empPhone" placeholder="Phone"></label>
            <label>City<input id="empCity" placeholder="City"></label>
          </div>
          <div class="settings-actions">
            <button class="row-btn btn-approve" id="createEmployeeBtn">Create Employee</button>
            <span id="employeeStatus" class="sub"></span>
          </div>
        </section>

        <section class="settings-card employee-list-card">
          <div class="settings-card-head">
            <span class="role-pill">${iconSvg('users')}</span>
            <div>
              <h3>Employee log</h3>
              <p>Active and suspended employee IDs are kept separate from admin settings.</p>
            </div>
          </div>
          <div class="table-wrap employee-table-wrap">
            <table id="employeesTable">
              <thead><tr><th>Name</th><th>Email / ID</th><th>Status</th><th>Joined</th><th>Action</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
      </div>`;
    appMain.appendChild(section);
    document.getElementById('createEmployeeBtn').addEventListener('click', createEmployee);
}

async function saveStaffProfile() {
    const status = document.getElementById('staffProfileStatus');
    status.textContent = 'Saving...';
    const payload = {
        name: document.getElementById('staffName').value.trim(),
        phone: document.getElementById('staffPhone').value.trim(),
        city: document.getElementById('staffCity').value.trim(),
        college: document.getElementById('staffCollege').value.trim()
    };
    try {
        const data = await api('/api/auth/me', { method: 'PUT', body: JSON.stringify(payload) });
        CURRENT_USER = data.user;
        localStorage.setItem('cirvio_profile', JSON.stringify(data.user));
        updateAdminChrome();
        status.textContent = 'Saved';
    } catch (err) {
        status.textContent = err.message;
    }
}

async function changeStaffPassword() {
    const status = document.getElementById('staffPasswordStatus');
    const currentPassword = document.getElementById('staffCurrentPassword').value;
    const newPassword = document.getElementById('staffNewPassword').value;
    status.textContent = 'Updating...';
    try {
        await api('/api/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
        document.getElementById('staffCurrentPassword').value = '';
        document.getElementById('staffNewPassword').value = '';
        status.textContent = 'Password updated';
    } catch (err) {
        status.textContent = err.message;
    }
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

async function loadClientOrigins(options = {}) {
    if (!document.getElementById('clientOriginsInput')) return;
    const data = await api('/api/admin/client-origins', { signal: options.signal });
    if (options.signal?.aborted) return;
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

function buildSiteMediaInputs() {
    const grid = document.getElementById('siteMediaGrid');
    if (!grid || grid.dataset.built) return;
    grid.dataset.built = 'true';
    grid.innerHTML = SITE_MEDIA_SLOTS.map(([key, label, type]) => `
      <div class="site-media-item" data-media-key="${key}" data-media-type="${type}">
        <div class="site-media-preview" id="preview-${key}">${iconSvg(type === 'video' ? 'messages' : 'product')}</div>
        <label>${esc(label)}
          <input id="media-${key}" data-media-input="${key}" placeholder="Paste ${type} URL">
        </label>
        <div class="media-actions">
          <label class="row-btn btn-view media-file-btn">Choose ${type}
            <input id="file-${key}" data-media-file="${key}" type="file" accept="${type}/*">
          </label>
          <span class="sub" id="media-status-${key}"></span>
        </div>
      </div>`).join('');
    grid.querySelectorAll('[data-media-file]').forEach((input) => {
        input.addEventListener('change', () => uploadSiteMediaFile(input.dataset.mediaFile, input.files && input.files[0]));
    });
    grid.querySelectorAll('[data-media-input]').forEach((input) => {
        input.addEventListener('input', () => updateSiteMediaPreview(input.dataset.mediaInput, input.value));
    });
}

function updateSiteMediaPreview(key, url) {
    const slot = SITE_MEDIA_SLOTS.find(([slotKey]) => slotKey === key);
    const preview = document.getElementById(`preview-${key}`);
    if (!slot || !preview) return;
    const type = slot[2];
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) {
        preview.innerHTML = iconSvg(type === 'video' ? 'messages' : 'product');
        return;
    }
    preview.innerHTML = type === 'video'
        ? `<video src="${esc(cleanUrl)}" controls muted preload="metadata"></video>`
        : `<img src="${esc(cleanUrl)}" alt="${esc(slot[1])}">`;
}

async function uploadSiteMediaFile(key, file) {
    if (!file) return;
    const status = document.getElementById(`media-status-${key}`);
    if (status) status.textContent = 'Uploading...';
    const formData = new FormData();
    formData.append('media', file);
    try {
        const data = await api('/api/admin/site-media/upload', { method: 'POST', body: formData });
        const input = document.getElementById(`media-${key}`);
        if (input) input.value = data.url;
        updateSiteMediaPreview(key, data.url);
        if (status) status.textContent = 'Uploaded';
    } catch (err) {
        if (status) status.textContent = err.message;
    }
}

async function loadSiteMedia(options = {}) {
    const grid = document.getElementById('siteMediaGrid');
    if (!grid) return;
    buildSiteMediaInputs();
    const data = await api('/api/admin/site-media', { signal: options.signal });
    if (options.signal?.aborted) return;
    SITE_MEDIA_SLOTS.forEach(([key]) => {
        const input = document.getElementById(`media-${key}`);
        const url = data.media?.[key]?.url || '';
        if (input) input.value = url;
        updateSiteMediaPreview(key, url);
    });
}

async function saveSiteMedia() {
    const status = document.getElementById('siteMediaStatus');
    const media = {};
    SITE_MEDIA_SLOTS.forEach(([key, label, type]) => {
        media[key] = {
            label,
            type,
            url: (document.getElementById(`media-${key}`)?.value || '').trim()
        };
    });
    if (status) status.textContent = 'Saving...';
    try {
        await api('/api/admin/site-media', {
            method: 'PUT',
            body: JSON.stringify({ media })
        });
        if (status) status.textContent = 'Saved';
        showAdminNotice('Website media updated');
    } catch (err) {
        if (status) status.textContent = err.message;
    }
}

/* Each section owns its request and feedback; stale responses cannot replace it. */
const adminLoads = new Map();
function withDataFeedback(key, original, targetIds) {
    return async function (options = {}) {
        const previous = adminLoads.get(key);
        if (previous?.pending && options.notify) return previous.pending;
        previous?.controller.abort();
        const controller = new AbortController();
        const state = { controller, loadedAt: previous?.loadedAt || 0 };
        adminLoads.set(key, state);
        const targets = targetIds.map(id => document.getElementById(id)).filter(Boolean);
        const feedbacks = targets.map(anchor => {
            let feedback = document.getElementById('data-feedback-' + anchor.id);
            if (feedback) return feedback;
            feedback = document.createElement('div');
            feedback.id = 'data-feedback-' + anchor.id;
            feedback.className = 'data-feedback';
            feedback.setAttribute('role', 'status');
            feedback.setAttribute('aria-live', 'polite');
            (anchor.closest('.table-wrap') || anchor).before(feedback);
            return feedback;
        });
        targets.forEach(target => target.setAttribute('aria-busy', 'true'));
        if (!options.notify) feedbacks.forEach(feedback => {
            feedback.hidden = false;
            feedback.classList.remove('is-error');
            feedback.textContent = state.loadedAt ? 'Refreshing data...' : 'Loading data...';
        });
        state.pending = (async () => {
            try {
                await original({ ...options, signal: controller.signal });
                if (controller.signal.aborted) return;
                state.loadedAt = Date.now();
                feedbacks.forEach(feedback => { feedback.hidden = true; });
            } catch (err) {
                if (controller.signal.aborted) return;
                feedbacks.forEach(feedback => {
                    feedback.hidden = false;
                    feedback.classList.add('is-error');
                    feedback.replaceChildren();
                    const text = document.createElement('span');
                    text.textContent = `${state.loadedAt ? 'Showing previously loaded data. ' : ''}${err.message}`;
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'soft-btn';
                    retry.textContent = 'Try again';
                    retry.addEventListener('click', () => sectionLoaders[key]());
                    feedback.append(text, retry);
                });
            } finally {
                if (!controller.signal.aborted) targets.forEach(target => target.setAttribute('aria-busy', 'false'));
                state.pending = null;
            }
        })();
        return state.pending;
    };
}

loadStats = withDataFeedback('stats', loadStats, ['statGrid']);
loadUsers = withDataFeedback('users', loadUsers, ['usersTable', 'employeesTable']);
loadListings = withDataFeedback('listings', loadListings, ['listingsTable', 'latestListingsTable']);
loadPurchases = withDataFeedback('purchases', loadPurchases, ['purchasesTable', 'recentPurchasesTable']);
loadMessages = withDataFeedback('messages', loadMessages, ['messageInboxList']);
loadClientOrigins = withDataFeedback('origins', loadClientOrigins, ['clientOriginsInput']);
loadSiteMedia = withDataFeedback('media', loadSiteMedia, ['siteMediaGrid']);
const sectionLoaders = { stats: loadStats, users: loadUsers, listings: loadListings, purchases: loadPurchases, messages: loadMessages, origins: loadClientOrigins, media: loadSiteMedia };

async function loadActiveTabData({ force = false } = {}) {
    const sections = {
        dashboard: ['stats', 'listings', 'purchases'], users: ['users'], employees: ['users'],
        listings: ['listings'], purchases: ['purchases'], messages: ['messages'], settings: ['origins', 'media']
    }[activeTab] || [];
    if (activeTab === 'settings' && !isAdmin()) return;
    return Promise.allSettled(sections.map(key => {
        const state = adminLoads.get(key);
        if (state?.pending) return state.pending;
        if (!force && state?.loadedAt && Date.now() - state.loadedAt < 30000) return;
        return sectionLoaders[key]();
    }));
}

document.getElementById('refreshDataBtn').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await loadActiveTabData({ force: true }); }
    finally { button.disabled = false; }
});

document.getElementById('purchasesDateRange').addEventListener('change', event => {
    const range = event.target.value;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (range === 'This Week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    if (range === 'This Month') start.setDate(1);
    AdminTables.where('purchasesTable', range === 'All Dates' ? null : row => {
        const date = new Date(row.date);
        return date >= start && date <= new Date();
    });
});

/* Phone navigation and keyboard access share the same sections as desktop. */
const mobileLayout = window.matchMedia('(max-width: 780px)');
function setMobileMenu(open, restoreFocus = true) {
    const shouldOpen = open && mobileLayout.matches;
    adminApp.classList.toggle('mobile-menu-open', shouldOpen);
    document.getElementById('sidebarBackdrop').hidden = !shouldOpen;
    document.getElementById('mobileMenuBtn').setAttribute('aria-expanded', String(shouldOpen));
    document.getElementById('adminSidebar').inert = mobileLayout.matches && !shouldOpen;
    document.querySelector('.main').inert = shouldOpen || !!document.querySelector('.image-modal.open');
    if (shouldOpen) document.querySelector('.sidebar .nav-btn.active')?.focus();
    else if (restoreFocus && mobileLayout.matches) document.getElementById('mobileMenuBtn').focus();
}
document.getElementById('mobileMenuBtn').addEventListener('click', () => setMobileMenu(true));
document.getElementById('closeMobileMenu').addEventListener('click', () => setMobileMenu(false));
document.getElementById('sidebarBackdrop').addEventListener('click', () => setMobileMenu(false));
mobileLayout.addEventListener('change', () => setMobileMenu(false, false));
setMobileMenu(false, false);

function closeMobileConversation() {
    document.querySelector('.messages-layout').classList.remove('conversation-open');
    document.querySelector(`.message-thread[data-message-id="${CSS.escape(activeMessageId)}"]`)?.focus({ preventScroll: true });
}

document.querySelectorAll('[data-message-filter]').forEach(button => button.addEventListener('click', () => {
    activeMessageFilter = button.dataset.messageFilter;
    document.querySelectorAll('[data-message-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    filterMessageInbox();
}));

window.addEventListener('popstate', () => {
    if (!CURRENT_USER) return;
    activateTab(history.state?.tab || location.hash.slice(1) || 'dashboard', { historyMode: 'none' });
    const thread = history.state?.thread;
    if (activeTab === 'messages' && thread && ADMIN_MESSAGES.has(thread)) {
        renderMessageSidePanel(thread);
        document.querySelector('.messages-layout').classList.add('conversation-open');
    } else closeMobileConversation();
});

window.addEventListener('admin:online', () => {
    if (CURRENT_USER) {
        loadActiveTabData({ force: true });
        loadMessages({ notify: true });
    } else if (TOKEN) initAdminSession();
});

navigator.serviceWorker?.addEventListener('message', async event => {
    if (event.data?.type !== 'OPEN_MESSAGE' || !CURRENT_USER) return;
    const thread = String(event.data.threadId || '');
    activateTab('messages', { load: false });
    await loadMessages();
    if (ADMIN_MESSAGES.has(thread)) handleMessageRowClick(null, thread);
});

let activeModal = null;
let modalReturnFocus = null;
const modalClosers = { listingImageModal: closeListingImages, orderOpsModal: closeOrderOps, messageReplyModal: closeMessageReply };
function syncModalAccess() {
    const modal = document.querySelector('.image-modal.open');
    if (modal === activeModal) return;
    if (modal) {
        modalReturnFocus = document.activeElement;
        activeModal = modal;
        const dialog = modal.querySelector('[role="dialog"]');
        dialog?.setAttribute('aria-modal', 'true');
        document.body.classList.add('modal-open');
        document.querySelector('.main').inert = true;
        document.getElementById('adminSidebar').inert = true;
        modal.querySelector('button:not(:disabled), input, select, textarea')?.focus({ preventScroll: true });
    } else {
        activeModal = null;
        document.body.classList.remove('modal-open');
        setMobileMenu(false, false);
        if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
        modalReturnFocus = null;
    }
}
new MutationObserver(syncModalAccess).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]')) return;
    const menuOpen = adminApp.classList.contains('mobile-menu-open');
    const focusRoot = activeModal || (menuOpen ? document.getElementById('adminSidebar') : null);
    if (event.key === 'Escape') {
        if (activeModal) { event.preventDefault(); modalClosers[activeModal.id]?.(); }
        else if (menuOpen) { event.preventDefault(); setMobileMenu(false); }
    }
    if (event.key === 'Tab' && focusRoot) {
        const focusable = [...focusRoot.querySelectorAll('button, a[href], input, textarea, select, [tabindex="0"]')]
            .filter(el => !el.disabled && el.getClientRects().length);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
});

// expose for inline onclick handlers
window.toggleUserStatus = toggleUserStatus;
window.deleteUser = deleteUser;
window.approveProduct = approveProduct;
window.rejectProduct = rejectProduct;
window.deleteProduct = deleteProduct;
window.viewListingImages = viewListingImages;
window.handleMessageRowClick = handleMessageRowClick;
window.openMessageReply = openMessageReply;
window.openOrderOps = openOrderOps;
