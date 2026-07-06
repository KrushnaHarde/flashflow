# FlashFlow Frontend Client

This is the Vite/React frontend client application for the **FlashFlow** high-concurrency booking platform. It provides interactive interfaces for users to register, log in, view catalog products, initiate purchase checkouts, check reservation/purchase statuses asynchronously, and manage product catalog configurations via an admin panel.

---

## 🚀 Key Features

* **Real-time Checkout Tracking:** Uses asynchronous polling to monitor purchase transactions via `PurchaseStatus.jsx`.
* **Idempotence Protections:** Generates client-side UUID keys for each reservation session to prevent duplicate double-submit checkout requests.
* **Authentication Context:** Managed via `AuthContext.jsx` with automatic accessToken storage, silent background token refreshing, and route guard redirects.
* **Admin Dashboard:** Tools to add/edit products, control inventory levels, and schedule new flash sale events.

---

## 🛠️ Tech Stack & Scripts

* **Framework:** React 19 + Vite 8
* **Styling:** Tailwind CSS 4 + PostCSS
* **Routing:** React Router 7 (Layout layouts and route protection policies)
* **Testing:** Vitest + React Testing Library (with jsdom support)
* **Icons:** Lucide React
* **Notifications:** React Toastify

### Available NPM Scripts:

* `npm run dev`: Launch the local development server (binds to `http://localhost:5173`).
* `npm run build`: Package production distribution bundles in `dist/`.
* `npm run test`: Run the Vitest unit and contract test suites.
* `npm run lint`: Run Oxlint to analyze static code consistency.
* `npm run preview`: Run a local preview server of the built production bundle.

---

## 📁 Folder Structure

```
client/
├── src/
│   ├── components/     # UI elements (Spinner, Navbar, etc.)
│   ├── context/        # AuthContext for credentials and token refresh
│   ├── layouts/        # Shared layouts (MainLayout for authenticated views)
│   ├── pages/          # Catalog, Admin, Orders, and Purchase status monitors
│   ├── router/         # AppRouter for route protection and guards
│   ├── services/       # Axios API client integrations
│   └── test/           # Component and contract mock assertions
├── index.html
├── package.json
└── vite.config.js
```

---

## 🛡️ Key Frontend Routing Configurations

The application supports protected user authentication routing:
* **Public-Only Routes:** `/login` and `/register` (redirects to `/products` if already authenticated).
* **Protected Routes:** `/products`, `/products/:id`, `/orders`, `/profile`, `/purchase/:reservationId/status` (requires authentication).
* **Admin-Only Routes:** `/admin`, `/admin/products`, `/admin/inventory`, `/admin/flash-sales` (requires authenticated user with role `ADMIN`).
