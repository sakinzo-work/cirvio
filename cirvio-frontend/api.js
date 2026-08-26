function getCirvioApiBase() {
    const params = new URLSearchParams(window.location.search);
    const queryApi = params.get('api');
    if (queryApi) {
        const cleanQueryApi = queryApi.replace(/\/$/, '');
        localStorage.setItem('cirvio_api_base', cleanQueryApi);
        return cleanQueryApi;
    }

    const configured = window.CIRVIO_API_BASE || localStorage.getItem('cirvio_api_base') || '';
    if (configured) return configured.replace(/\/$/, '');

    return 'http://localhost:5000';
}

const API_BASE = getCirvioApiBase();

function normalizeProduct(product) {
    const seller = product.seller || {};
    const img = product.img || (product.images && product.images[0]) || 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=500&q=70';
    return {
        ...product,
        id: product._id || product.id,
        cat: product.cat || product.category || 'Books',
        cond: product.cond || product.condition || 'Good',
        orig: product.orig || product.originalPrice || 0,
        desc: product.desc || product.description || '',
        loc: product.loc || product.location || seller.city || '',
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
        return localStorage.getItem('cirvio_token') || '';
    },
    setSession(token, user) {
        if (token) localStorage.setItem('cirvio_token', token);
        if (user) localStorage.setItem('cirvio_profile', JSON.stringify(user));
    },
    clearSession() {
        localStorage.removeItem('cirvio_token');
        localStorage.removeItem('cirvio_profile');
    },
    async request(path, options = {}) {
        let res;
        try {
            res = await fetch(API_BASE + path, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
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
        submittedAt: p.createdAt ? new Date(p.createdAt).getTime() : Date.now(),
        rejectReason: p.rejectReason || ''
    };
};
