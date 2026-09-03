/* ============================================================
   CIRVIO — shared header / footer / nav behaviour
   Loaded on every page so navigation, search, wishlist and the
   mobile menu behave identically site-wide.
============================================================ */

/* ---------- tiny persisted store (wishlist count, listings a
   student has posted, profile info) so it carries across pages ---------- */
const CirvioStore = {
    _read(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    },
    _write(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
    getWishlist() { return this._read('cirvio_wishlist', []); },
    setWishlist(arr) { this._write('cirvio_wishlist', arr); },
    getListings() { return this._read('cirvio_my_listings', []); },
    setListings(arr) { this._write('cirvio_my_listings', arr); },

    /* ---------- CIRVIO review/approval reasons (used when a listing is declined) ---------- */
    REJECT_REASONS: [
        'Photos are unclear — please upload sharper, well-lit images of the item.',
        'Listing title and description don\u2019t match — please double check the details.',
        'Price seems inconsistent with the condition described — please review it.',
        'Category or condition details are missing — please fill these in fully.',
        'This item doesn\u2019t meet CIRVIO\u2019s marketplace guidelines for study material.'
    ],

    /* Admin approval is backend-owned. This remains as a no-op for older
       pages that still call it while they load backend listings. */
    processApprovals() {
        return false;
    },
    getProfile() {
        return this._read('cirvio_profile', {});
    },
    setProfile(p) { this._write('cirvio_profile', p); },
    /* every buyer/seller enquiry is a message TO CIRVIO — students never
       get each other's contact details directly, CIRVIO relays it */
    getMessages() { return this._read('cirvio_messages', []); },
    setMessages(arr) { this._write('cirvio_messages', arr); },
    getNotifications() { return this._read('cirvio_notifications', []); },
    setNotifications(arr) { this._write('cirvio_notifications', arr); },
    /* ---------- cart (persists across pages) ---------- */
    getCart() { return this._read('cirvio_cart', []); },
    setCart(arr) { this._write('cirvio_cart', arr); }
};

function wishlistIds() {
    return CirvioStore.getWishlist().map(String);
}

function isWishlisted(id) {
    return wishlistIds().includes(String(id));
}

function toggleWishlist(id) {
    const list = CirvioStore.getWishlist();
    if (isWishlisted(id)) {
        CirvioStore.setWishlist(list.filter(x => String(x) !== String(id)));
        refreshWishBadge();
        return false;
    }
    CirvioStore.setWishlist([...list, id]);
    refreshWishBadge();
    return true;
}

window.CirvioWishlist = { ids: wishlistIds, has: isWishlisted, toggle: toggleWishlist };

/* ---------- header scroll shrink ---------- */
function initHeaderScroll() {
    const header = document.getElementById('siteHeader');
    if (!header) return;
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 30);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}

/* ---------- search suggest dropdown ---------- */
function initHeaderSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchSuggest = document.getElementById('searchSuggest');
    if (!searchInput || !searchSuggest) return;

    searchInput.addEventListener('focus', () => searchSuggest.classList.add('open'));
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-search')) searchSuggest.classList.remove('open');
    });
    searchSuggest.addEventListener('click', (e) => {
        const item = e.target.closest('.sg-item');
        if (!item) return;
        searchInput.value = item.dataset.q;
        searchSuggest.classList.remove('open');
        goToBrowseWithQuery(item.dataset.q);
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            searchSuggest.classList.remove('open');
            goToBrowseWithQuery(searchInput.value.trim());
        }
    });
}

/* Search always resolves to the homepage browse grid — if we're
   already there, scroll + filter in place; otherwise navigate with ?q= */
function goToBrowseWithQuery(q) {
    const onHome = /(^|\/)index\.html$|\/$/.test(location.pathname) || location.pathname.endsWith('/cirvio/') || document.getElementById('productGrid');
    if (document.getElementById('productGrid')) {
        document.getElementById('browse').scrollIntoView({ behavior: 'smooth' });
        if (window.renderProducts) { window.__cirvioSearchQ = q; window.renderProducts(); }
    } else {
        window.location.href = 'index.html' + (q ? ('?q=' + encodeURIComponent(q)) : '') + '#browse';
    }
}

/* ---------- mobile menu ---------- */
function initMobileMenu() {
    const menuBtn = document.getElementById('menuBtn');
    const mobileMenu = document.getElementById('mobileMenu');
    if (!menuBtn || !mobileMenu) return;

    function openMobileMenu() {
        mobileMenu.classList.add('open');
        menuBtn.classList.add('open');
        menuBtn.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }
    function closeMobileMenu() {
        mobileMenu.classList.remove('open');
        menuBtn.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }
    menuBtn.addEventListener('click', openMobileMenu);
    const closeBtn = document.getElementById('closeMenuBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeMobileMenu);
    mobileMenu.addEventListener('click', (e) => { if (e.target === mobileMenu) closeMobileMenu(); });
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobileMenu));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileMenu(); });
}

/* ---------- wishlist badge sync (header + mobile panel) ---------- */
function refreshWishBadge() {
    const count = CirvioStore.getWishlist().length;
    const ids = ['wishCount', 'mpWishCount'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    });
}

/* ---------- messages badge sync (header + mobile panel) ---------- */
function refreshMsgBadge() {
    const count = CirvioStore.getMessages().filter(m => m.from === 'cirvio' && !m.read).length;
    ['msgCount', 'mpMsgCount'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
    });
}

function refreshNotificationBadge() {
    const count = CirvioStore.getNotifications().filter(n => !n.read).length;
    ['notifCount', 'mpNotifCount'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
    });
}

function initNotificationLinks() {
    ensureNotificationPanel();
    document.querySelectorAll('.header-actions button[aria-label="Notifications"], .mp-quick-item[href="#"]').forEach((el) => {
        const label = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
        if (!label.includes('notification')) return;
        el.dataset.notificationTrigger = 'true';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleNotificationPanel();
        });
    });
    if (!notificationClickListenerStarted) {
        notificationClickListenerStarted = true;
        document.addEventListener('click', (e) => {
            const trigger = e.target.closest('[data-notification-trigger], button[aria-label="Notifications"]');
            if (!trigger) return;
            e.preventDefault();
            e.stopPropagation();
            toggleNotificationPanel();
        });
    }
}

function ensureNotificationPanel() {
    if (document.getElementById('notificationPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'notificationPanel';
    panel.className = 'notification-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.innerHTML = `
        <div class="np-head">
            <strong>Notifications</strong>
            <button type="button" id="npMarkRead">Mark read</button>
        </div>
        <div class="np-list" id="npList"></div>
        <a class="np-status-link" href="status.html">View listing status</a>
    `;
    document.body.appendChild(panel);
    document.getElementById('npMarkRead').addEventListener('click', () => {
        CirvioStore.setNotifications(CirvioStore.getNotifications().map(n => ({ ...n, read: true })));
        refreshNotificationBadge();
        renderNotificationPanel();
    });
    document.addEventListener('click', (e) => {
        if (!panel.classList.contains('open')) return;
        if (e.target.closest('#notificationPanel') || e.target.closest('[data-notification-trigger], button[aria-label="Notifications"]')) return;
        panel.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') panel.classList.remove('open');
    });
}

function renderNotificationPanel() {
    const list = document.getElementById('npList');
    if (!list) return;
    const notifications = CirvioStore.getNotifications();
    list.innerHTML = notifications.length ? notifications.map(n => `
        <a class="np-item ${n.read ? '' : 'unread'}" href="status.html">
            <span>${n.title || 'CIRVIO update'}</span>
            <p>${n.text || 'Your listing status has changed.'}</p>
            <small>${n.createdAt ? new Date(n.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Just now'}</small>
        </a>
    `).join('') : '<div class="np-empty">No notifications yet.</div>';
}

function toggleNotificationPanel() {
    ensureNotificationPanel();
    renderNotificationPanel();
    document.getElementById('notificationPanel').classList.toggle('open');
}

function addListingNotification(listing, status) {
    const notifications = CirvioStore.getNotifications();
    const exists = notifications.some(n => String(n.productId) === String(listing.id) && n.status === status);
    if (exists) return;

    let text = `"${listing.title}" needs changes before it can go live.`;
    if (status === 'approved') {
        text = `"${listing.title}" approved. It is now live for buyers.`;
    } else if (status === 'viewed') {
        text = `CIRVIO has viewed the photos/details for "${listing.title}". It is still pending final approval.`;
    }

    notifications.unshift({
        id: Date.now() + Math.random(),
        productId: listing.id,
        title: listing.title,
        status,
        text,
        read: false,
        createdAt: Date.now()
    });
    CirvioStore.setNotifications(notifications);

    const messages = CirvioStore.getMessages();
    messages.push({
        id: Date.now() + Math.random(),
        productId: listing.id,
        productTitle: listing.title,
        productImg: listing.img || '',
        text,
        from: 'cirvio',
        read: false,
        time: 'Just now'
    });
    CirvioStore.setMessages(messages);
}

let listingNotificationPollStarted = false;
let notificationClickListenerStarted = false;

function syncLocalListingsWithBackend(backendListings, { silent = true } = {}) {
    const before = CirvioStore.getListings().filter(l => l.status !== 'draft');
    const beforeById = Object.fromEntries(before.flatMap(l => {
        const keys = [l.id, l.backendId].filter(v => v !== undefined && v !== null && v !== '');
        return keys.map(key => [String(key), l]);
    }));
    const localDrafts = CirvioStore.getListings().filter(l => l.status === 'draft');

    backendListings.forEach((listing) => {
        const previous = beforeById[String(listing.id)] || beforeById[String(listing.backendId)];
        if (listing.status === 'pending' && listing.reviewViewedAt && (!previous || !previous.reviewViewedAt)) {
            addListingNotification(listing, 'viewed');
            if (!silent) showToast('CIRVIO viewed your listing');
        }
        const finalStatus = ['approved', 'rejected'].includes(listing.status);
        if (!finalStatus) return;
        if (previous && previous.status === listing.status) return;
        addListingNotification(listing, listing.status);
        if (!silent) showToast(listing.status === 'approved' ? 'Listing approved and now live' : 'Listing review update');
    });

    CirvioStore.setListings([...backendListings, ...localDrafts]);
    refreshNotificationBadge();
    refreshMsgBadge();
    window.dispatchEvent(new CustomEvent('cirvio:listings-synced', { detail: { listings: backendListings } }));
}
window.CirvioListings = { syncLocalListingsWithBackend };

async function syncListingStatusNotifications({ silent = true } = {}) {
    if (!window.CirvioAPI || !window.cirvioProductToListing || !localStorage.getItem('cirvio_token')) return;
    try {
        const { products } = await CirvioAPI.myListings();
        const backendListings = (products || []).map(cirvioProductToListing);
        syncLocalListingsWithBackend(backendListings, { silent });
    } catch (err) {
        console.warn('Could not sync listing notifications:', err.message);
    }
}

function startListingNotificationPoll() {
    if (listingNotificationPollStarted || !localStorage.getItem('cirvio_token')) return;
    listingNotificationPollStarted = true;
    syncListingStatusNotifications();
    setInterval(() => syncListingStatusNotifications({ silent: false }), 45000);
}

/* ============================================================
   CART — add to cart, cart sidebar (drawer), place order.
   Works site-wide: any button with data-add-cart + data-id/
   data-title/data-price/data-img automatically adds that item,
   no extra per-page wiring required.
============================================================ */

/* ---------- badge sync (header + mobile panel) ---------- */
function refreshCartBadge() {
    const count = CirvioStore.getCart().reduce((sum, it) => sum + it.qty, 0);
    ['cartCount', 'mpCartCount'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
    });
}

function cartTotal() {
    return CirvioStore.getCart().reduce((sum, it) => sum + it.price * it.qty, 0);
}

function cartAdd(product) {
    if (!product || product.id === undefined || product.id === null || product.id === '') return;
    const items = CirvioStore.getCart();
    const idKey = String(product.id);
    const existing = items.find(it => String(it.id) === idKey);
    if (existing) existing.qty += 1;
    else items.push({
        id: product.id,
        title: product.title || 'Item',
        price: Number(product.price) || 0,
        img: product.img || '',
        qty: 1
    });
    CirvioStore.setCart(items);
    refreshCartBadge();
    /* keep the drawer in sync if it happens to already be open, but
       don't auto-open it — only the header cart button should do that */
    if (document.getElementById('cartDrawerOverlay')?.classList.contains('open')) {
        renderCartDrawer();
    }
    showToast(`Added "${product.title || 'Item'}" to cart`);
}

function cartRemove(id) {
    const items = CirvioStore.getCart().filter(it => String(it.id) !== String(id));
    CirvioStore.setCart(items);
    refreshCartBadge();
    renderCartDrawer();
}

function cartSetQty(id, qty) {
    if (qty <= 0) { cartRemove(id); return; }
    const items = CirvioStore.getCart();
    const it = items.find(x => String(x.id) === String(id));
    if (!it) return;
    it.qty = qty;
    CirvioStore.setCart(items);
    refreshCartBadge();
    renderCartDrawer();
}

/* ---------- drawer markup (built once, lazily) ---------- */
function cartEnsureDrawer() {
    if (document.getElementById('cartDrawerOverlay')) return;
    const holder = document.createElement('div');
    holder.innerHTML = `
<div class="cart-drawer-overlay" id="cartDrawerOverlay">
  <aside class="cart-drawer" id="cartDrawer" role="dialog" aria-label="Shopping cart">
    <div class="cd-head">
      <h3>Your Cart <span class="cd-count" id="cdHeadCount">0</span></h3>
      <button class="btn-icon" id="cdClose" aria-label="Close cart">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="cd-body" id="cdBody"></div>
    <div class="cd-foot" id="cdFoot">
      <div class="cd-total-row"><span>Subtotal</span><span id="cdSubtotal">₹0</span></div>
      <button class="btn btn-terracotta cd-place-btn" id="cdPlaceBtn" style="width:100%;justify-content:center;">Place Order</button>
      <div class="cd-secure"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Safe &amp; secure checkout via CIRVIO</div>
    </div>
    <div class="cd-success" id="cdSuccess">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.6 2.6L16 9.5"/></svg>
      <h4>Order placed!</h4>
      <p id="cdSuccessMsg"></p>
      <button class="btn btn-outline" id="cdSuccessClose">Continue Browsing</button>
    </div>
  </aside>
</div>`.trim();
    document.body.appendChild(holder.firstElementChild);

    document.getElementById('cdClose').addEventListener('click', cartClose);
    document.getElementById('cartDrawerOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'cartDrawerOverlay') cartClose();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cartClose(); });

    document.getElementById('cdBody').addEventListener('click', (e) => {
        const inc = e.target.closest('[data-cart-inc]');
        const dec = e.target.closest('[data-cart-dec]');
        const rem = e.target.closest('[data-cart-remove]');
        if (inc) {
            const id = inc.dataset.cartInc;
            const it = CirvioStore.getCart().find(x => String(x.id) === String(id));
            if (it) cartSetQty(id, it.qty + 1);
        } else if (dec) {
            const id = dec.dataset.cartDec;
            const it = CirvioStore.getCart().find(x => String(x.id) === String(id));
            if (it) cartSetQty(id, it.qty - 1);
        } else if (rem) {
            cartRemove(rem.dataset.cartRemove);
            showToast('Removed from cart');
        }
    });

    document.getElementById('cdPlaceBtn').addEventListener('click', cartPlaceOrder);
    document.getElementById('cdSuccessClose').addEventListener('click', cartClose);
}

function renderCartDrawer() {
    cartEnsureDrawer();
    const items = CirvioStore.getCart();
    const body = document.getElementById('cdBody');
    const foot = document.getElementById('cdFoot');
    const success = document.getElementById('cdSuccess');
    success.classList.remove('show');
    document.getElementById('cdHeadCount').textContent = items.reduce((s, it) => s + it.qty, 0);

    if (!items.length) {
        body.innerHTML = `<div class="cd-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1.6"/><circle cx="19" cy="21" r="1.6"/><path d="M2.5 3h2.4l1.2 6.4M6.1 9.4 7.6 16h11l2-9H6.1z"/></svg>
      <p>Your cart is empty</p>
      <span>Tap "Add to Cart" on any listing to see it here</span>
    </div>`;
        foot.style.display = 'none';
        return;
    }
    foot.style.display = 'block';
    body.innerHTML = items.map(it => `
    <div class="cd-item">
      <img src="${it.img}" alt="${it.title}">
      <div class="cd-item-info">
        <div class="cd-item-title">${it.title}</div>
        <div class="cd-item-price">${it.price === 0 ? 'Free' : '₹' + it.price}</div>
        <div class="cd-qty">
          <button data-cart-dec="${it.id}" aria-label="Decrease quantity">−</button>
          <span>${it.qty}</span>
          <button data-cart-inc="${it.id}" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <button class="cd-remove" data-cart-remove="${it.id}" aria-label="Remove item">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>
      </button>
    </div>
  `).join('');
    document.getElementById('cdSubtotal').textContent = '₹' + cartTotal();
}

function cartOpen() {
    cartEnsureDrawer();
    renderCartDrawer();
    requestAnimationFrame(() => document.getElementById('cartDrawerOverlay').classList.add('open'));
    document.body.style.overflow = 'hidden';
}
function cartClose() {
    const ov = document.getElementById('cartDrawerOverlay');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
}

async function cartPlaceOrder() {
    const items = CirvioStore.getCart();
    if (!items.length) { showToast('Your cart is empty'); return; }
    const total = cartTotal();
    const count = items.reduce((s, it) => s + it.qty, 0);
    if (window.CirvioAPI) {
        try {
            await CirvioAPI.checkout(items);
        } catch (err) {
            showToast(err.message || 'Could not place order');
            return;
        }
    }
    CirvioStore.setCart([]);
    refreshCartBadge();
    document.getElementById('cdSuccessMsg').textContent =
        `${count} item${count > 1 ? 's' : ''} for ₹${total} — CIRVIO will connect you with each seller to arrange pickup or delivery.`;
    document.getElementById('cdFoot').style.display = 'none';
    document.getElementById('cdBody').innerHTML = '';
    document.getElementById('cdSuccess').classList.add('show');
    showToast('Order placed successfully');
}

window.CirvioCart = { add: cartAdd, remove: cartRemove, open: cartOpen, close: cartClose, total: cartTotal };

/* header + mobile-menu cart icon opens the drawer */
function initCartHeaderLink() {
    const cartBtn = document.getElementById('cartBtn');
    if (cartBtn) cartBtn.addEventListener('click', (e) => { e.preventDefault(); cartOpen(); });
    const mpCartBtn = document.getElementById('mpCartBtn');
    if (mpCartBtn) mpCartBtn.addEventListener('click', (e) => { e.preventDefault(); cartOpen(); });
}

/* global delegated "Add to Cart" handler — any element on any page with
   data-add-cart + data-id/data-title/data-price/data-img just works */
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add-cart]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    cartAdd({
        id: btn.dataset.id,
        title: btn.dataset.title,
        price: Number(btn.dataset.price || 0),
        img: btn.dataset.img || ''
    });
});

/* ============================================================
   CONTACT CIRVIO — every "Contact Seller" / "Message" action
   opens this modal. Buyers message CIRVIO support, CIRVIO relays
   to the seller — no direct student-to-student contact info is
   ever shared.
============================================================ */
let ccCurrentProduct = null;

function ccEnsureModal() {
    if (document.getElementById('ccOverlay')) return;
    const holder = document.createElement('div');
    holder.innerHTML = `
<div class="modal-overlay cc-overlay" id="ccOverlay">
  <div class="modal-box cc-box">
    <div class="modal-info">
      <button class="btn-icon modal-close" id="ccClose" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="cc-head">
        <div class="cc-badge">C</div>
        <div>
          <h3>Message CIRVIO</h3>
          <p class="cc-sub">For your safety, every chat goes through CIRVIO — <span id="ccSellerName">the seller</span> never gets your number directly.</p>
        </div>
      </div>
      <div class="cc-product" id="ccProduct" style="display:none;">
        <img id="ccProductImg" src="" alt="">
        <div>
          <div class="cc-product-title" id="ccProductTitle"></div>
          <div class="cc-product-price" id="ccProductPrice"></div>
        </div>
      </div>
      <textarea id="ccText" class="cc-textarea" placeholder="Type your message to CIRVIO support..."></textarea>
      <button class="btn btn-terracotta" id="ccSend" style="width:100%;justify-content:center;">Send to CIRVIO</button>
    </div>
  </div>
</div>`.trim();
    document.body.appendChild(holder.firstElementChild);

    document.getElementById('ccClose').addEventListener('click', ccClose);
    document.getElementById('ccOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'ccOverlay') ccClose();
    });
    document.getElementById('ccSend').addEventListener('click', ccSend);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ccClose(); });
}

function ccOpen(product, presetText) {
    ccEnsureModal();
    ccCurrentProduct = product || null;
    const prodBox = document.getElementById('ccProduct');
    if (product) {
        document.getElementById('ccSellerName').textContent = product.seller || 'the seller';
        document.getElementById('ccProductImg').src = product.img || '';
        document.getElementById('ccProductImg').alt = product.title || '';
        document.getElementById('ccProductTitle').textContent = product.title || '';
        document.getElementById('ccProductPrice').textContent =
            product.price === 0 ? (product.type === 'donate' ? 'Donation' : 'Free') : (product.price ? '₹' + product.price : '');
        prodBox.style.display = 'flex';
    } else {
        document.getElementById('ccSellerName').textContent = 'our team';
        prodBox.style.display = 'none';
    }
    const ta = document.getElementById('ccText');
    ta.value = presetText || '';
    document.getElementById('ccOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => ta.focus(), 60);
}
window.CirvioContact = { open: ccOpen };

function ccClose() {
    const ov = document.getElementById('ccOverlay');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
}

function ccSend() {
    const ta = document.getElementById('ccText');
    const text = ta.value.trim();
    if (!text) { showToast('Type a message first'); return; }
    const thread = CirvioStore.getMessages();
    const now = Date.now();
    thread.push({
        id: now,
        productId: ccCurrentProduct ? ccCurrentProduct.id : null,
        productTitle: ccCurrentProduct ? ccCurrentProduct.title : null,
        productImg: ccCurrentProduct ? ccCurrentProduct.img : null,
        text,
        from: 'user',
        read: true,
        time: 'Just now'
    });
    thread.push({
        id: now + 1,
        productId: ccCurrentProduct ? ccCurrentProduct.id : null,
        productTitle: ccCurrentProduct ? ccCurrentProduct.title : null,
        productImg: ccCurrentProduct ? ccCurrentProduct.img : null,
        text: ccCurrentProduct
            ? `Thanks! We've passed your message about "${ccCurrentProduct.title}" on to ${ccCurrentProduct.seller || 'the seller'} and will update you here as soon as they reply.`
            : `Thanks for reaching out — the CIRVIO support team will reply here shortly.`,
        from: 'cirvio',
        read: false,
        time: 'Just now'
    });
    CirvioStore.setMessages(thread);
    refreshMsgBadge();
    showToast('Message sent to CIRVIO');
    ccClose();
}

/* ---------- PWA: install prompt ---------- */
let deferredInstallPrompt = null;
function initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        showInstallButton();
    });
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        hideInstallButton();
        showToast('CIRVIO installed on your device');
    });
}
function showInstallButton() {
    let btn = document.getElementById('pwaInstallBtn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'pwaInstallBtn';
        btn.className = 'pwa-install-btn';
        btn.setAttribute('aria-label', 'Install CIRVIO app');
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg><span>Install App</span>';
        btn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            hideInstallButton();
        });
        document.body.appendChild(btn);
    }
    btn.style.display = 'flex';
}
function hideInstallButton() {
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'none';
}

/* ---------- PWA: service worker ---------- */
function registerCirvioSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
            .then((registration) => registration.update())
            .catch(() => { /* ignore in unsupported/dev contexts */ });
    });
}

/* header wishlist icon → jump to profile's saved tab */
function initWishHeaderLink() {
    const wishBtn = document.getElementById('wishBtn');
    if (wishBtn) wishBtn.addEventListener('click', () => { window.location.href = 'profile.html#saved'; });
    const mpWishBtn = document.getElementById('mpWishBtn');
    if (mpWishBtn) mpWishBtn.addEventListener('click', (e) => { e.preventDefault(); window.location.href = 'profile.html#saved'; });
}

function initAuthLinks() {
    const loggedIn = !!localStorage.getItem('cirvio_token');
    document.querySelectorAll('a[href^="profile.html"]').forEach(link => {
        if (!loggedIn) {
            const next = encodeURIComponent(link.getAttribute('href') || 'profile.html');
            link.setAttribute('href', `login.html?next=${next}`);
        }
    });
}

function requireCirvioLogin() {
    if (localStorage.getItem('cirvio_token')) return true;
    const current = location.pathname.split('/').pop() || 'index.html';
    if (current === 'login.html') return true;
    const next = encodeURIComponent(current + location.search + location.hash);
    window.location.replace(`login.html?next=${next}`);
    return false;
}

window.CirvioAuth = { requireLogin: requireCirvioLogin };

/* ---------- toast ---------- */
let toastTimer;
function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    document.getElementById('toastMsg').textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ---------- scroll reveal ---------- */
function initReveal() {
    const revealEls = document.querySelectorAll('.reveal');
    if (!revealEls.length) return;
    const io = new IntersectionObserver((entries) => {
        entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('show'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    revealEls.forEach(el => io.observe(el));
}

/* ---------- mark current nav link active (desktop + mobile + bottom nav) ---------- */
function markActiveNav(pageKey) {
    document.querySelectorAll('[data-nav]').forEach(a => {
        a.classList.toggle('current', a.dataset.nav === pageKey);
        a.classList.toggle('active', a.dataset.nav === pageKey);
    });
}

/* ---------- boot ---------- */
function initCirvioChrome(pageKey) {
    CirvioStore.processApprovals();
    initHeaderScroll();
    initHeaderSearch();
    initMobileMenu();
    initAuthLinks();
    initWishHeaderLink();
    initCartHeaderLink();
    initNotificationLinks();
    refreshWishBadge();
    refreshMsgBadge();
    refreshNotificationBadge();
    refreshCartBadge();
    initReveal();
    initInstallPrompt();
    registerCirvioSW();
    startListingNotificationPoll();
    if (pageKey) markActiveNav(pageKey);
}

document.addEventListener('DOMContentLoaded', () => {
    // pages call initCirvioChrome() themselves after their own data renders,
    // but reveal + badges should still work even if a page forgets.
});
