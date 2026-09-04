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

function normalizeProduct(product) {
    const seller = product.seller || {};
    const img = product.img || (product.images && product.images[0]) || 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=500&q=70';
    const rawCategory = product.cat || product.category || 'Books';
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
        cat,
        cond: product.cond || product.condition || 'Good',
        orig: product.orig || product.originalPrice || 0,
        desc: product.desc || product.description || '',
        loc: product.loc || product.location || 'Pickup handled by CIRVIO admin',
        seller: typeof seller === 'string' ? seller : (seller.name || product.sellerName || 'CIRVIO Seller'),
        sellerId: typeof seller === 'object' ? seller._id : product.seller,
        img,
        images: product.images && product.images.length ? product.images : [img],
        time: product.time || (product.createdAt ? new Date(product.createdAt).toLocaleDateString() : 'Just now'),
        type: product.type || 'sell'
    };
}

const CirvioAPI = {
    token() {
        const sessionApiBase = localStorage.getItem('cirvio_session_api_base') || '';
        if (sessionApiBase && sessionApiBase !== API_BASE) {
            this.clearSession();
            return '';
        }
        return localStorage.getItem('cirvio_token') || '';
    },
    setSession(token, user) {
        if (token) localStorage.setItem('cirvio_token', token);
        if (token) localStorage.setItem('cirvio_session_api_base', API_BASE);
        if (user) localStorage.setItem('cirvio_profile', JSON.stringify(user));
    },
    clearSession() {
        localStorage.removeItem('cirvio_token');
        localStorage.removeItem('cirvio_session_api_base');
        localStorage.removeItem('cirvio_profile');
    },
    logout() {
        this.clearSession();
        localStorage.removeItem('cirvio_cart');
        localStorage.removeItem('cirvio_wishlist');
    },
    async request(path, options = {}) {
        let res;
        const isFormData = options.body instanceof FormData;
        try {
            res = await fetch(API_BASE + path, {
                ...options,
                headers: {
                    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
                    ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
                    ...(options.headers || {})
                }
            });
        } catch (err) {
            throw new Error(`Cannot connect to CIRVIO backend at ${API_BASE}. Start the backend or update config.js.`);
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.message || 'Request failed');
            err.status = res.status;
            if (res.status === 401) this.clearSession();
            throw err;
        }
        return data;
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
    async deleteAccount(password) {
        await this.ensureSession();
        return this.request('/api/auth/me', {
            method: 'DELETE',
            body: JSON.stringify({ password })
        });
    },
    async getProducts(query = '') {
        const data = await this.request('/api/products' + query);
        return { ...data, products: (data.products || []).map(normalizeProduct) };
    },
    async getProduct(id) {
        const data = await this.request('/api/products/' + encodeURIComponent(id));
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
        return { ...data, products: (data.products || []).map(normalizeProduct) };
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
