# CIRVIO Backend + Admin Panel

Node.js/Express + MongoDB backend for the CIRVIO marketplace, with a built-in
admin dashboard that shows total users, total listings, pending reviews,
orders, revenue, and — most importantly — **who bought what from whom**
(buyer + product + seller shown paired in one row).

## 1. Setup

```bash
cd cirvio-backend
npm install
cp .env.example .env
```

Edit `.env`:
- `MONGO_URI` — your MongoDB connection string (use MongoDB Atlas free tier, or a local `mongodb://localhost:27017/cirvio`)
- `JWT_SECRET` — any long random string
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — credentials for your first admin login

## 2. Create the admin account

```bash
npm run seed:admin
```

This creates (or promotes) a user with the email/password from `.env` to `role: 'admin'`.

## 3. Run the server

```bash
npm run dev      # with nodemon, auto-restart
# or
npm start
```

Server runs at `http://localhost:5000`.

## 4. Open the admin panel

Visit `http://localhost:5000/admin` in your browser and log in with your
admin email/password. It's a static HTML/CSS/JS panel served directly by
the Express app — no separate build step needed.

## API overview

| Method | Route                              | Access        | Purpose |
|--------|-------------------------------------|---------------|---------|
| POST   | `/api/auth/register`                | public        | student signup |
| POST   | `/api/auth/login`                   | public        | login, returns JWT |
| GET    | `/api/auth/me`                      | logged in     | current profile |
| GET    | `/api/products`                     | public        | browse approved listings (search/filter via `?q=&category=&type=&city=`) |
| POST   | `/api/products`                     | logged in     | create a listing (goes to `pending`) |
| GET    | `/api/products/mine`                | logged in     | my own listings, any status |
| PUT/DELETE `/api/products/:id`      | seller/admin  | edit or remove own listing |
| POST   | `/api/orders`                       | logged in     | checkout cart → creates order, marks items `sold` |
| GET    | `/api/orders/my` / `/api/orders/selling` | logged in | my purchases / my sales |
| GET    | `/api/admin/stats`                  | admin         | dashboard numbers |
| GET    | `/api/admin/users`                  | admin         | all users + listing/order counts |
| PUT    | `/api/admin/users/:id/status`       | admin         | suspend / reactivate |
| GET    | `/api/admin/products?status=pending`| admin         | review queue |
| PUT    | `/api/admin/products/:id/approve`   | admin         | approve a listing |
| PUT    | `/api/admin/products/:id/reject`    | admin         | reject with a reason |
| GET    | `/api/admin/orders`                 | admin         | full orders, populated |
| GET    | `/api/admin/purchases`              | admin         | **flattened buyer + product + seller rows** — this feeds the Purchases tab |

## Data model

- **User** — name, email, password (hashed), college, course, city, phone, `role` (user/admin), `status` (active/suspended)
- **Product** (a listing) — title, category, condition, type (sell/donate), price, description, location, images, `seller` (ref User), `status` (pending → approved/rejected, or sold)
- **Order** — `buyer` (ref User) + `items[]`, where each item snapshots `product`, `seller`, title, price, qty, img. One order can hold items from multiple sellers (like a real cart checkout), and every item keeps its own buyer↔product↔seller link — that's what the admin Purchases table reads.

## Connecting your existing frontend

See `FRONTEND_INTEGRATION.md` for exact code to drop into `sell.html`,
`index.html`/`explore.html`, and the cart checkout so they talk to this
backend instead of `localStorage`.
