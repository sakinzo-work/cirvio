# Connecting the CIRVIO frontend to this backend

Right now `common.js` stores everything in `localStorage` (`CirvioStore`).
Below is the minimal set of changes to make it talk to the real API instead.
Backend must be running at `http://localhost:5000` (or your deployed URL).

## 0. Add an API helper (new file `api.js`, include on every page before `common.js`)

```html
<script src="api.js"></script>
<script src="common.js"></script>
```

```js
// api.js
const API_BASE = 'http://localhost:5000'; // change to your deployed backend URL

const CirvioAPI = {
  token() { return localStorage.getItem('cirvio_token') || ''; },

  async request(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  },

  register(payload) { return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }); },
  login(payload)    { return this.request('/api/auth/login',    { method: 'POST', body: JSON.stringify(payload) }); },
  me()              { return this.request('/api/auth/me'); },

  getProducts(query = '') { return this.request('/api/products' + query); },
  getProduct(id)          { return this.request('/api/products/' + id); },
  createProduct(payload)  { return this.request('/api/products', { method: 'POST', body: JSON.stringify(payload) }); },
  myListings()             { return this.request('/api/products/mine'); },

  checkout(payload) { return this.request('/api/orders', { method: 'POST', body: JSON.stringify(payload) }); },
  myOrders()         { return this.request('/api/orders/my'); },
  mySales()           { return this.request('/api/orders/selling'); }
};
```

## 1. Login / signup (wherever your auth form is)

```js
async function handleLogin(email, password) {
  try {
    const { token, user } = await CirvioAPI.login({ email, password });
    localStorage.setItem('cirvio_token', token);
    CirvioStore.setProfile(user); // keep using existing profile display code
    window.location.href = 'index.html';
  } catch (err) {
    showToast(err.message);
  }
}
```

## 2. `sell.html` — replace the local "add to my listings" with a real POST

Find where the form currently pushes into `CirvioStore.setListings(...)`
and replace with:

```js
async function submitListing() {
  const payload = {
    title: document.getElementById('itemTitle').value,
    category: document.getElementById('itemCategory').value,
    condition: document.getElementById('itemCondition').value,
    price: document.getElementById('itemPrice').value,
    originalPrice: document.getElementById('itemOrig').value,
    description: document.getElementById('itemDesc').value,
    location: document.getElementById('itemLoc').value,
    college: document.getElementById('itemCollege').value,
    type: 'sell', // or 'donate' based on your toggle
    images: [] // upload images separately (see note below), then pass URLs here
  };
  try {
    const { product } = await CirvioAPI.createProduct(payload);
    showToast('Listing submitted for review!');
    window.location.href = 'profile.html#listings';
  } catch (err) {
    showToast(err.message);
  }
}
```

> **Image uploads:** the backend accepts an `images: []` array of URLs.
> Easiest path for a student project: upload to a free image host (e.g.
> Cloudinary's unsigned upload widget) from the browser and pass the
> returned URLs in. Wiring a full multer file-upload endpoint is a
> next-step if you want images stored on your own server instead.

## 3. `index.html` / `explore.html` — load real products instead of static/demo data

Replace whatever currently builds the `productGrid` array with:

```js
async function loadProducts() {
  const { products } = await CirvioAPI.getProducts(window.__cirvioSearchQ ? `?q=${encodeURIComponent(window.__cirvioSearchQ)}` : '');
  // products already have: title, price, images, seller: { name, college, city }, category, condition, type
  renderProductGrid(products); // adapt to however your existing render function is shaped
}
```

## 4. Cart checkout — replace the "place order" local logic

```js
async function placeOrder() {
  const cart = CirvioStore.getCart(); // [{ id, title, price, qty, img }]
  try {
    const { order } = await CirvioAPI.checkout({
      items: cart.map(it => ({ productId: it.id, qty: it.qty })),
      deliveryAddress: document.getElementById('deliveryAddress')?.value || ''
    });
    CirvioStore.setCart([]);
    refreshCartBadge();
    showToast('Order placed!');
  } catch (err) {
    showToast(err.message);
  }
}
```

Every item in that order is now visible on the admin **Purchases** tab —
paired with the buyer and the seller — the moment it's placed.

## 5. Require login before selling / buying

Since listings and orders both need `req.user`, gate the sell button and
checkout button: if `!localStorage.getItem('cirvio_token')`, redirect to
a login page first.
