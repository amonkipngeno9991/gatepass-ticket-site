# GatePass — ticket marketplace demo

A small full-stack ticket resale site: browse events, view seat listings,
add to a cart, and check out. Built with plain HTML/CSS/JS on the frontend
and a Node.js backend with a real embedded SQLite database (no external
packages required — it uses Node's built-in `node:sqlite` module).

## Requirements

- Node.js **v22.5 or later** (for the built-in `node:sqlite` module)

## Run it

```bash
node server.js
```

Then open **http://localhost:3000** in your browser.

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
a copy of any existing ticket site's branding, layout, or code. No real
payments are processed at checkout.
