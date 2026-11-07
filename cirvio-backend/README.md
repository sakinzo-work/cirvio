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

### Use on a phone and install the admin app

Open `/admin/` on the deployed HTTPS site. Use the menu button to switch between Dashboard, Users, Listings, Purchases, Messages, Settings and Employees (admin accounts only). On phones, tables become labeled cards and messages open as a separate conversation with a Back button. Replies stay in memory while switching conversations; an unsuccessful send keeps the draft.

Choose **Install** in the toolbar or **Install admin app** on the login screen. Supporting browsers show the installation prompt. On iPhone, use Safari's **Share → Add to Home Screen**; the app also shows installation help when a direct prompt is unavailable. Installation requires HTTPS, except for localhost development.

The PWA stores only public application files and icons. Staff records, API responses and conversations are never placed in the service-worker cache. An offline screen and connection banner explain when a connection is required. Reconnect to load data or save changes. Available app updates are offered with an **Update app** button so staff can save changes before reloading.

### Start a conversation with a user or seller

In **Messages → New message**, search by name, email or phone and select a user. **Users → Message** opens the same private user conversation. In Listings, the dashboard's latest listings, or the listing image review, choose **Message seller** to open a private chat tied to that listing. Reopening the same user/listing reuses its conversation; opening a chat does not send a message. Type a message and choose **Send**.

The user receives it in the website's **Messages** page and can reply there. Listing chats between staff and the seller stay separate from buyer/seller product groups. Admins and employees can start and reply to conversations; other users can only access their own private threads or their existing product groups. The `Message.conversationKey` partial unique index prevents concurrent opens from creating duplicate staff conversations; existing messages need no migration.

## API overview

### Message push notifications

In the website notification panel or the admin **Messages** screen, choose **Enable notifications** and allow the browser prompt. This device then receives Web Push alerts even when the page is closed, subject to the browser/OS notification settings. Tapping an alert opens its conversation; an already open chat window receives the link without reloading and losing drafts. Use **Disable notifications** to stop alerts on that device. Signing out unsubscribes it.

HTTPS is required (localhost is supported for development). On iPhone/iPad, install the app on the Home Screen before enabling alerts. In-app notifications and message badges work independently of push permission. Alerts show generic message text; conversation content is loaded after authentication.

The server creates its VAPID key pair once and persists it in MongoDB `AppSetting.webPushVapid`. Private keys are never sent to clients. Optionally configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in the backend environment to manage keys externally. Keep the same keys across deployments. Install dependencies with `npm ci`; `web-push@3.6.7` supports the project's Node 18 runtime. Only active participants and active staff receive the appropriate alerts; expired device subscriptions are removed automatically. Push failures do not prevent message saving.

### Listing education and item categories

`GET /api/products/categories` exposes the taxonomy used by the sell form and backend validation. School Books support Nursery/LKG/UKG and Classes 1–12; Classes 11/12 require a stream. College Books support undergraduate, postgraduate/masters, diploma, research and professional programmes, with course and study year. Notes and study resources can optionally target an education level. General item groups include calculators, stationery, drawing supplies, lab/engineering tools, bags, electronics/accessories and other study items, with item subtypes.

New listings store these details in `Product.classification`; public product responses include `classificationSummary`. Changing category clears incompatible details. Existing listings still render without education metadata and can receive ordinary edits without a migration. Creating a new school/college listing requires its appropriate details.

### Seller listing lifecycle notifications

Opening a listing's **View Images/details** in the admin panel records a viewed event for its seller. Approving or rejecting records the decision. Repeated opens and repeated approval requests reuse their event keys; editing a listing clears the old review evidence and starts a new review cycle. Completed decisions retain their history.

A **buyer selected** event is created after an order is successfully saved. Adding an item to a cart does not notify the seller. Listings are single-copy: checkout validates the whole cart, claims each listing conditionally, and releases its claims if order creation fails. Concurrent buyers cannot claim the same listing, and selected listings cannot be edited or approved again. Buyer selection, payment confirmation and dispatch remain separate states.

Events persist in the `Notification` collection independently of browser storage and push permission. Sellers can read and mark only their own events. **Listing Status** shows Submitted → CIRVIO viewed → Approved → Buyer selected, actual timestamps, and the buyer/order/payment/dispatch details returned by their seller-order API. Buyer contact details, other sellers' order items, delivery addresses and staff notes are excluded. Push alerts open and highlight the exact status card.

Order notification failures retain `Order.notificationPending`; a backend task retries up to 20 pending orders every 30 seconds. Unique event keys prevent duplicate history and push attempts when a job is retried. A saved order still succeeds when notification storage is temporarily unavailable. Existing listings need no data migration; new lifecycle events are recorded as the actions happen.

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
| GET    | `/api/admin/message-recipients?q=`  | staff         | search up to 30 users by name, email or phone |
| POST   | `/api/admin/messages/conversations`| staff         | open/reuse a chat with `{ userId }` or a listing seller with `{ productId }` |
| GET    | `/api/admin/messages`              | staff         | all staff conversations and product groups |
| POST   | `/api/admin/messages/:id/reply`     | staff         | send a message to an existing conversation |
| GET    | `/api/messages/my`                 | logged in     | own private conversations and product groups |
| POST   | `/api/messages/:id/replies`         | participant   | reply to a private conversation or product group |
| GET    | `/api/products/categories`          | public        | education levels, courses, streams and item types |
| GET    | `/api/notifications/push-key`        | logged in     | public VAPID key only |
| POST/DELETE | `/api/notifications/subscriptions` | logged in | enable/disable this device's push subscription |
| GET    | `/api/notifications`                | logged in     | own stored listing notifications and unread count |
| PUT    | `/api/notifications/:id/read`       | owner         | persist a read notification |
| PUT    | `/api/notifications/read-all`       | logged in     | mark own stored notifications read |

## Data model

- **User** — name, email, password (hashed), college, course, city, phone, `role` (user/admin), `status` (active/suspended)
- **Product** (a listing) — title, category, condition, type (sell/donate), price, description, location, images, `seller` (ref User), `status` (pending → approved/rejected, or sold)
- **Order** — `buyer` (ref User) + `items[]`, where each item snapshots `product`, `seller`, title, price, qty, img. One order can hold items from multiple sellers (like a real cart checkout), and every item keeps its own buyer↔product↔seller link — that's what the admin Purchases table reads.

## Connecting your existing frontend

See `FRONTEND_INTEGRATION.md` for exact code to drop into `sell.html`,
`index.html`/`explore.html`, and the cart checkout so they talk to this
backend instead of `localStorage`.
