function getCirvioApiBase() {
    const params = new URLSearchParams(window.location.search);
    const queryApi = params.get('api');
    if (queryApi) {
        const cleanQueryApi = queryApi.replace(/\/$/, '');
        localStorage.setItem('cirvio_api_base', cleanQueryApi);
        return cleanQueryApi;
    }

    const host = window.location.hostname;
    const isLocalFrontend = !host
        || host === 'localhost'
        || host === '127.0.0.1'
        || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
        || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
    const storedApi = localStorage.getItem('cirvio_api_base') || '';
    const storedApiIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?/i.test(storedApi);
    const storedApiIsRemote = /^https?:\/\//i.test(storedApi) && !storedApiIsLocal;

    if (storedApi && ((isLocalFrontend && storedApiIsLocal) || (!isLocalFrontend && storedApiIsRemote))) {
        return storedApi.replace(/\/$/, '');
    }

    if (storedApi) {
        localStorage.removeItem('cirvio_api_base');
    }

    const configured = window.CIRVIO_API_BASE || '';
    if (configured) return configured.replace(/\/$/, '');

    return 'http://localhost:5000';
}

const API_BASE = getCirvioApiBase();
window.CIRVIO_API_BASE_ACTIVE = API_BASE;

function normalizeProduct(product = {}) {
    product = product && typeof product === 'object' ? product : {};
    const seller = product.seller || {};
    const images = (Array.isArray(product.images) ? product.images : []).filter(image => typeof image === 'string' && image.trim());
    const img = (typeof product.img === 'string' && product.img) || images[0] || window.CIRVIO_PLACEHOLDER_IMAGE;
    const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const rawCategory = product.cat || product.category || 'Uncategorised';
    const categoryMap = {
        books: 'School Books',
        book: 'School Books',
        school: 'School Books',
        'school books': 'School Books',
        college: 'College Books',
        'college books': 'College Books',
        competitive: 'Competitive Exams',
        exams: 'Competitive Exams',
        'competitive exams': 'Competitive Exams',
        note: 'Notes',
        notes: 'Notes',
        material: 'Study Material',
        'study material': 'Study Material',
        calculator: 'Calculators',
        calculators: 'Calculators',
        novel: 'Novels',
        novels: 'Novels',
        stationery: 'Stationery Bundles',
        'stationery bundles': 'Stationery Bundles',
        donation: 'Free & Donations',
        donations: 'Free & Donations',
        free: 'Free & Donations'
    };
    const cat = categoryMap[String(rawCategory).trim().toLowerCase()] || rawCategory;
    return {
        ...product,
        id: product._id || product.id,
        title: String(product.title || 'Untitled listing'),
        cat: String(cat),
        cond: String(product.cond || product.condition || 'Not specified'),
        college: String(product.college || (typeof seller === 'object' && seller.college) || '').trim(),
        price: ['donate', 'free'].includes(product.type) ? 0 : amount(product.price),
        orig: amount(product.orig ?? product.originalPrice),
        desc: String(product.desc || product.description || ''),
        loc: String(product.loc || product.location || 'Pickup handled by CIRVIO admin'),
        seller: String(typeof seller === 'string' ? (product.sellerName || (/^[a-f\d]{24}$/i.test(seller) ? 'CIRVIO Seller' : seller)) : (seller.name || product.sellerName || 'CIRVIO Seller')),
        sellerId: product.sellerId || (typeof seller === 'object' ? seller._id || seller.id : seller),
        sellerVerified: product.sellerVerified ?? (seller.verified === true),
        sellerCreatedAt: product.sellerCreatedAt || seller.createdAt || '',
        sellerRatingAverage: amount(product.sellerRatingAverage ?? seller.trustRatingAverage),
        sellerRatingCount: amount(product.sellerRatingCount ?? seller.trustRatingCount),
        img,
        images: images.length ? images : [img],
        time: product.time || (product.createdAt && Number.isFinite(Date.parse(product.createdAt)) ? new Date(product.createdAt).toLocaleDateString('en-IN') : 'Date unavailable'),
        type: product.type || 'sell'
    };
}

const CirvioAPI = {
    pendingRequests: new Map(),
    token() {
        const sessionApiBase = localStorage.getItem('cirvio_session_api_base') || '';
        if (sessionApiBase && sessionApiBase !== API_BASE) {
            this.clearSession();
            return '';
        }
        return localStorage.getItem('cirvio_token') || '';
    },
    setSession(token, user) {
        let previousUser = {};
        try { previousUser = JSON.parse(localStorage.getItem('cirvio_profile') || '{}'); } catch (err) { /* Treat invalid profiles as a different account. */ }
        if (user && String(previousUser.id || previousUser._id || '') !== String(user.id || user._id || '')) {
            localStorage.removeItem('cirvio_messages');
            localStorage.removeItem('cirvio_notifications');
        }
        if (token) localStorage.setItem('cirvio_token', token);
        if (token) localStorage.setItem('cirvio_session_api_base', API_BASE);
        if (user) localStorage.setItem('cirvio_profile', JSON.stringify(user));
    },
    clearSession() {
        localStorage.removeItem('cirvio_token');
        localStorage.removeItem('cirvio_session_api_base');
        localStorage.removeItem('cirvio_profile');
        localStorage.removeItem('cirvio_messages');
        localStorage.removeItem('cirvio_notifications');
    },
    logout() {
        this.clearSession();
        localStorage.removeItem('cirvio_cart');
        localStorage.removeItem('cirvio_wishlist');
    },
    async request(path, options = {}) {
        const key = `${this.token()}:${path}`;
        const canShare = (!options.method || options.method === 'GET') && !options.signal;
        if (canShare && this.pendingRequests.has(key)) return this.pendingRequests.get(key);
        const request = this.performRequest(path, options);
        if (canShare) this.pendingRequests.set(key, request);
        try {
            return await request;
        } finally {
            if (canShare) this.pendingRequests.delete(key);
        }
    },
    async performRequest(path, options = {}) {
        let res;
        const isFormData = options.body instanceof FormData;
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (options.signal?.aborted) controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, 45000);
        try {
            res = await fetch(API_BASE + path, {
                ...options,
                signal: controller.signal,
                headers: {
                    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
                    ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
                    ...(options.headers || {})
                }
            });
            const data = await res.json().catch(err => { if (controller.signal.aborted) throw err; return null; });
            if (!res.ok) {
                const err = new Error(data?.message || 'Request failed');
                err.status = res.status;
                if (res.status === 401) this.clearSession();
                throw err;
            }
            if (!data || typeof data !== 'object') throw new Error('The server returned an invalid response. Please try again.');
            return data;
        } catch (err) {
            if (options.signal?.aborted) throw err;
            if (err.name === 'AbortError') throw new Error('Loading took too long. Please try again.');
            if (err instanceof TypeError) throw new Error('Unable to connect. Check your connection and try again.');
            throw err;
        } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abort);
        }
    },
    async register(payload) {
        const data = await this.request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        this.setSession(data.token, data.user);
        return data;
    },
    async login(payload) {
        const data = await this.request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        this.setSession(data.token, data.user);
        return data;
    },
    async googleLogin(idToken) {
        const data = await this.request('/api/auth/google', {
            method: 'POST',
            body: JSON.stringify({ idToken })
        });
        this.setSession(data.token, data.user);
        return data;
    },
    async me() {
        await this.ensureSession();
        const data = await this.request('/api/auth/me');
        if (data.user) localStorage.setItem('cirvio_profile', JSON.stringify(data.user));
        return data;
    },
    startPhoneOtp(phone) {
        return this.request('/api/auth/phone/start', {
            method: 'POST',
            body: JSON.stringify({ phone })
        });
    },
    async verifyPhoneOtp(phone, otp, name) {
        const data = await this.request('/api/auth/phone/verify', {
            method: 'POST',
            body: JSON.stringify({ phone, otp, name })
        });
        this.setSession(data.token, data.user);
        return data;
    },
    async ensureSession() {
        if (this.token()) return this.token();
        const next = encodeURIComponent(location.pathname.split('/').pop() + location.search + location.hash);
        window.location.href = `login.html?next=${next}`;
        throw new Error('Please login first');
    },
    async changePassword(currentPassword, newPassword) {
        await this.ensureSession();
        return this.request('/api/auth/password', {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword })
        });
    },
    async setupPassword(newPassword) {
        await this.ensureSession();
        const data = await this.request('/api/auth/password/setup', {
            method: 'PUT',
            body: JSON.stringify({ newPassword })
        });
        if (data.user) localStorage.setItem('cirvio_profile', JSON.stringify(data.user));
        return data;
    },
    async updateProfile(payload) {
        await this.ensureSession();
        const data = await this.request('/api/auth/me', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (data.user) localStorage.setItem('cirvio_profile', JSON.stringify(data.user));
        return data;
    },
    async publicProfile(userId) {
        await this.ensureSession();
        return this.request('/api/auth/users/' + encodeURIComponent(userId));
    },
    async rateProfile(userId, value) {
        await this.ensureSession();
        return this.request('/api/auth/users/' + encodeURIComponent(userId) + '/rating', {
            method: 'POST',
            body: JSON.stringify({ value })
        });
    },
    async deleteAccount(password) {
        await this.ensureSession();
        return this.request('/api/auth/me', {
            method: 'DELETE',
            body: JSON.stringify({ password })
        });
    },
    async getProducts(query = '') {
        const data = await this.request('/api/products' + query);
        if (!Array.isArray(data.products)) throw new Error('Listings could not be read. Please try again.');
        return { ...data, products: data.products.filter(Boolean).map(normalizeProduct) };
    },
    async getProduct(id) {
        const data = await this.request('/api/products/' + encodeURIComponent(id));
        if (!data.product || typeof data.product !== 'object') throw new Error('This listing could not be read. Please try again.');
        return { ...data, product: normalizeProduct(data.product) };
    },
    async createProduct(payload) {
        await this.ensureSession();
        return this.request('/api/products', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },
    async uploadProductImages(files) {
        await this.ensureSession();
        const formData = new FormData();
        [...files].forEach(file => formData.append('images', file));
        return this.request('/api/products/uploads', {
            method: 'POST',
            body: formData
        });
    },
    async myListings() {
        await this.ensureSession();
        const data = await this.request('/api/products/mine');
        if (!Array.isArray(data.products)) throw new Error('Listings could not be read. Please try again.');
        return { ...data, products: data.products.filter(Boolean).map(normalizeProduct) };
    },
    async checkout(items, deliveryAddress = '') {
        await this.ensureSession();
        return this.request('/api/orders', {
            method: 'POST',
            body: JSON.stringify({
                items: items.map(item => ({ productId: item.id || item.productId, qty: item.qty || 1 })),
                deliveryAddress
            })
        });
    },
    async sendMessage(productId, text) {
        await this.ensureSession();
        return this.request('/api/messages', {
            method: 'POST',
            body: JSON.stringify({ productId, text })
        });
    },
    async myMessages() {
        await this.ensureSession();
        return this.request('/api/messages/my');
    },
    async replyToMessage(messageId, text) {
        await this.ensureSession();
        return this.request('/api/messages/' + encodeURIComponent(messageId) + '/replies', {
            method: 'POST',
            body: JSON.stringify({ text })
        });
    },
    async deleteMessage(messageId) {
        await this.ensureSession();
        return this.request('/api/messages/' + encodeURIComponent(messageId), {
            method: 'DELETE'
        });
    }
};

window.CirvioAPI = CirvioAPI;
window.normalizeCirvioProduct = normalizeProduct;
window.cirvioProductToListing = function cirvioProductToListing(product) {
    const p = normalizeProduct(product);
    return {
        id: p.id,
        backendId: p.id,
        title: p.title,
        cat: p.cat,
        cond: p.cond,
        price: p.price,
        orig: p.orig,
        desc: p.desc,
        loc: p.loc,
        college: p.college || '',
        type: p.type,
        img: p.img,
        seller: p.seller,
        time: p.time,
        status: p.status || 'pending',
        reviewViewedAt: p.reviewViewedAt || '',
        submittedAt: p.createdAt ? new Date(p.createdAt).getTime() : Date.now(),
        rejectReason: p.rejectReason || ''
    };
};
