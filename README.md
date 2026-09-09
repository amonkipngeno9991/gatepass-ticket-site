# GatePass — ticket marketplace demo

A small full-stack ticket resale site: browse events, view seat listings,
add to a cart, and check out. Built with plain HTML/CSS/JS on the frontend
and a Node.js backend with a real embedded SQLite database (no external
packages required — it uses Node's built-in `node:sqlite` module).

## Requirements

- Node.js **v22.5 or later** (for the built-in `node:sqlite` module)

## Run it

```bash
npm start
```
(or `node server.js` directly)

Then open **http://localhost:3000** in your browser.

### Running on Android (Termux)

1. Install [Termux](https://f-droid.org/en/packages/com.termux/) from F-Droid (the Play Store build is outdated).
2. In Termux:
   ```bash
   termux-setup-storage
   ```
3. Unzip this project somewhere Termux can see it (e.g. if the zip is in
   your Downloads folder):
   ```bash
   cd ~/storage/downloads
   unzip gatepass-ticket-site.zip -d ~/
   cd ~/ticket-site
   ```
4. Run the setup script — it installs Node if needed, checks the version,
   and starts the server:
   ```bash
   bash termux-setup.sh
   ```
5. Open `http://localhost:3000` in Chrome (or any browser) on your phone.

Keep the Termux app open (or running in the background) while you use the
site — closing it stops the server. If Android kills the process after a
while, disable battery optimization for Termux in Android's app settings.

The database file `gatepass.sqlite` is created automatically on first run
and seeded with sample events (baseball, a concert, basketball, comedy,
and theater). Delete that file and restart the server to reset all data.

## How it's put together

- `server.js` — HTTP server, routing, and the JSON API (no framework)
- `db.js` — SQLite schema + seed data
- `public/` — the frontend (plain HTML/CSS/JS, one file per page)

## API

| Method | Path                  | Purpose                          |
|--------|------------------------|-----------------------------------|
| GET    | /api/events            | List events (supports `?search=` and `?category=`) |
| GET    | /api/events/:id        | Event detail + ticket listings   |
| GET    | /api/categories        | Distinct event categories         |
| GET    | /api/cart              | Current cart (session cookie)     |
| POST   | /api/cart              | Add a ticket listing to the cart  |
| PATCH  | /api/cart/:cartItemId  | Update quantity                   |
| DELETE | /api/cart/:cartItemId  | Remove an item                    |
| POST   | /api/checkout          | Place an order, decrement inventory |
| GET    | /api/orders/:id        | Order confirmation details        |

## Notes

This is an original design and codebase built for demonstration — it isn't
a copy of any existing ticket site's branding, layout, or code.

## Accepting real payments (PayPal)

The cart page uses PayPal's official checkout button. Payments only work
once you set three environment variables:

| Variable | Value |
|---|---|
| `PAYPAL_CLIENT_ID` | From your PayPal app (Developer Dashboard) |
| `PAYPAL_CLIENT_SECRET` | From the same PayPal app |
| `PAYPAL_MODE` | `sandbox` while testing, `live` for real money |

**Getting your keys:**
1. Go to `developer.paypal.com` and log in with your normal PayPal account
2. Go to **Apps & Credentials**
3. Make sure you're on the **Sandbox** tab first (for testing with fake money)
4. Create a new app (or use the default one) — copy the **Client ID** and
   **Secret** shown there
5. Set those as `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` in your hosting
   provider's environment variables, and set `PAYPAL_MODE=sandbox`

**Testing:** PayPal's sandbox mode gives you fake test accounts (with fake
money) to check out with — no real card or bank account needed. Find your
sandbox test buyer login under **Sandbox > Accounts** in the same dashboard.

**Going live:** once testing looks right, switch to the **Live** tab in
PayPal's dashboard, create/get your live Client ID and Secret, and update
your environment variables to the live values with `PAYPAL_MODE=live`.
From that point on, real payments will be processed and real money will
move into your PayPal account.

⚠️ A couple of things worth knowing before going live: reselling event
tickets for real money can be regulated depending on your location and the
event/venue's own policies — it's worth checking local rules first. Also,
PayPal only pays out to a verified account, so you'll need to complete
PayPal's normal identity verification before you can withdraw real funds.
