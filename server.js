const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// node:sqlite is only available from Node 22.5+. Fail with a clear message
// instead of a cryptic "Cannot find module 'node:sqlite'" error.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `\nGatePass needs Node.js v22.5.0 or later (for the built-in SQLite module).\n` +
    `You're running Node ${process.versions.node}.\n\n` +
    `On Termux: run "pkg install nodejs" (not nodejs-lts) to get a current build.\n`
  );
  process.exit(1);
}

const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// PayPal config - set these as environment variables (see README).
// PAYPAL_MODE should be "sandbox" while testing, "live" once you're ready for real payments.
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_BASE =
  process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

async function paypalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Could not authenticate with PayPal');
  return data.access_token;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- helpers ----------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Returns null if the request is a valid admin request, otherwise
// { status, error } to send back immediately.
function checkAdmin(query) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return { status: 500, error: 'Set an ADMIN_KEY environment variable to enable admin features.' };
  }
  if (query.get('key') !== adminKey) {
    return { status: 401, error: 'Wrong or missing admin key.' };
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';').map((p) => p.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

function ensureSession(req, res) {
  let sid = getCookie(req, 'sid');
  if (!sid) {
    sid = crypto.randomUUID();
    res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }
  return sid;
}

function eventWithTickets(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return null;
  const tickets = db
    .prepare('SELECT * FROM tickets WHERE event_id = ? AND quantity_available > 0 ORDER BY price ASC')
    .all(eventId);
  return { ...event, tickets };
}

function cartForSession(sid) {
  const rows = db
    .prepare(
      `SELECT ci.id AS cart_item_id, ci.quantity, t.id AS ticket_id, t.section, t.row_label,
              t.seat_type, t.price, t.quantity_available, e.id AS event_id, e.name AS event_name,
              e.venue, e.city, e.state, e.event_date, e.event_time
       FROM cart_items ci
       JOIN tickets t ON t.id = ci.ticket_id
       JOIN events e ON e.id = t.event_id
       WHERE ci.session_id = ?
       ORDER BY ci.created_at ASC`
    )
    .all(sid);
  const total = rows.reduce((sum, r) => sum + r.price * r.quantity, 0);
  return { items: rows, total };
}

// Creates the order + order_items rows and decrements inventory. Called only after
// a payment has been verified as completed (see /api/paypal/capture-order).
// paypalInfo (optional) records proof of the real payment for the admin page.
function finalizeOrder(sid, name, email, paypalInfo) {
  const cart = cartForSession(sid);
  if (cart.items.length === 0) {
    throw new Error('Your cart is empty');
  }
  for (const item of cart.items) {
    if (item.quantity > item.quantity_available) {
      throw new Error(`"${item.event_name}" no longer has enough tickets available`);
    }
  }
  const p = paypalInfo || {};
  const orderResult = db
    .prepare(
      `INSERT INTO orders (session_id, buyer_name, buyer_email, total,
        paypal_order_id, paypal_capture_id, paypal_payer_email, paypal_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sid, name, email, cart.total, p.orderId || null, p.captureId || null, p.payerEmail || null, p.raw || null);
  const orderId = Number(orderResult.lastInsertRowid);
  const insertOrderItem = db.prepare(
    `INSERT INTO order_items (order_id, event_name, section, row_label, quantity, price)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const item of cart.items) {
    insertOrderItem.run(orderId, item.event_name, item.section, item.row_label, item.quantity, item.price);
    db.prepare('UPDATE tickets SET quantity_available = quantity_available - ? WHERE id = ?').run(
      item.quantity, item.ticket_id
    );
  }
  db.prepare('DELETE FROM cart_items WHERE session_id = ?').run(sid);
  return orderId;
}

// ---------- static files ----------

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- API ----------

async function handleApi(req, res, pathname, query) {
  const sid = ensureSession(req, res);

  // GET /api/events
  if (pathname === '/api/events' && req.method === 'GET') {
    const search = (query.get('search') || '').trim().toLowerCase();
    const category = (query.get('category') || '').trim();
    let events = db.prepare('SELECT * FROM events ORDER BY event_date ASC').all();
    if (search) {
      events = events.filter((e) =>
        [e.name, e.venue, e.city, e.state, e.category].join(' ').toLowerCase().includes(search)
      );
    }
    if (category) {
      events = events.filter((e) => e.category === category);
    }
    for (const e of events) {
      const priceRow = db
        .prepare('SELECT MIN(price) AS min_price FROM tickets WHERE event_id = ? AND quantity_available > 0')
        .get(e.id);
      e.min_price = priceRow ? priceRow.min_price : null;
    }
    return sendJson(res, 200, { events });
  }

  // GET /api/categories
  if (pathname === '/api/categories' && req.method === 'GET') {
    const rows = db.prepare('SELECT DISTINCT category FROM events ORDER BY category ASC').all();
    return sendJson(res, 200, { categories: rows.map((r) => r.category) });
  }

  // GET /api/events/:id
  let m = pathname.match(/^\/api\/events\/(\d+)$/);
  if (m && req.method === 'GET') {
    const event = eventWithTickets(Number(m[1]));
    if (!event) return sendJson(res, 404, { error: 'Event not found' });
    return sendJson(res, 200, { event });
  }

  // GET /api/cart
  if (pathname === '/api/cart' && req.method === 'GET') {
    return sendJson(res, 200, cartForSession(sid));
  }

  // POST /api/cart  { ticketId, quantity }
  if (pathname === '/api/cart' && req.method === 'POST') {
    const body = await readBody(req);
    const ticketId = Number(body.ticketId);
    const quantity = Math.max(1, Math.min(8, Number(body.quantity) || 1));
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) return sendJson(res, 404, { error: 'Ticket listing not found' });
    if (quantity > ticket.quantity_available) {
      return sendJson(res, 400, { error: `Only ${ticket.quantity_available} left for this listing` });
    }
    const existing = db
      .prepare('SELECT * FROM cart_items WHERE session_id = ? AND ticket_id = ?')
      .get(sid, ticketId);
    if (existing) {
      const newQty = Math.min(8, existing.quantity + quantity);
      db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
    } else {
      db.prepare('INSERT INTO cart_items (session_id, ticket_id, quantity) VALUES (?, ?, ?)').run(
        sid, ticketId, quantity
      );
    }
    return sendJson(res, 200, cartForSession(sid));
  }

  // PATCH /api/cart/:cartItemId  { quantity }
  m = pathname.match(/^\/api\/cart\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    const body = await readBody(req);
    const quantity = Number(body.quantity);
    const item = db.prepare('SELECT * FROM cart_items WHERE id = ? AND session_id = ?').get(Number(m[1]), sid);
    if (!item) return sendJson(res, 404, { error: 'Cart item not found' });
    if (quantity <= 0) {
      db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
    } else {
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(item.ticket_id);
      const capped = Math.min(8, ticket.quantity_available, quantity);
      db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(capped, item.id);
    }
    return sendJson(res, 200, cartForSession(sid));
  }

  // DELETE /api/cart/:cartItemId
  m = pathname.match(/^\/api\/cart\/(\d+)$/);
  if (m && req.method === 'DELETE') {
    db.prepare('DELETE FROM cart_items WHERE id = ? AND session_id = ?').run(Number(m[1]), sid);
    return sendJson(res, 200, cartForSession(sid));
  }

  // POST /api/paypal/create-order  -> creates a real PayPal order for the current cart total
  if (pathname === '/api/paypal/create-order' && req.method === 'POST') {
    const cart = cartForSession(sid);
    if (cart.items.length === 0) {
      return sendJson(res, 400, { error: 'Your cart is empty' });
    }
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      return sendJson(res, 500, { error: 'PayPal is not configured on this server yet.' });
    }
    try {
      const token = await paypalAccessToken();
      const ppRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: cart.total.toFixed(2) } }],
        }),
      });
      const order = await ppRes.json();
      if (!ppRes.ok) throw new Error(order.message || 'PayPal rejected the order');
      return sendJson(res, 200, { id: order.id });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // POST /api/paypal/capture-order  { orderID, name, email }
  // Verifies the payment actually completed on PayPal's side before creating our order.
  if (pathname === '/api/paypal/capture-order' && req.method === 'POST') {
    const body = await readBody(req);
    const orderID = body.orderID;
    if (!orderID) return sendJson(res, 400, { error: 'Missing PayPal order ID' });
    try {
      const token = await paypalAccessToken();
      const capRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const capData = await capRes.json();
      if (!capRes.ok || capData.status !== 'COMPLETED') {
        throw new Error('PayPal did not confirm this payment as completed.');
      }
      const payer = capData.payer || {};
      const payerName = [payer.name && payer.name.given_name, payer.name && payer.name.surname]
        .filter(Boolean)
        .join(' ');
      const name = (body.name || '').trim() || payerName || 'PayPal customer';
      const email = (body.email || '').trim() || payer.email_address || 'unknown@paypal.com';
      const captureId =
        capData.purchase_units &&
        capData.purchase_units[0] &&
        capData.purchase_units[0].payments &&
        capData.purchase_units[0].payments.captures &&
        capData.purchase_units[0].payments.captures[0] &&
        capData.purchase_units[0].payments.captures[0].id;

      const orderId = finalizeOrder(sid, name, email, {
        orderId: orderID,
        captureId: captureId || null,
        payerEmail: payer.email_address || null,
        raw: JSON.stringify(capData),
      });
      return sendJson(res, 200, { orderId });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // GET /api/paypal/client-id -> the public client ID the frontend needs to load PayPal's button
  if (pathname === '/api/paypal/client-id' && req.method === 'GET') {
    return sendJson(res, 200, { clientId: PAYPAL_CLIENT_ID || null });
  }

  // GET /api/orders/:id
  m = pathname.match(/^\/api\/orders\/(\d+)$/);
  if (m && req.method === 'GET') {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND session_id = ?').get(Number(m[1]), sid);
    if (!order) return sendJson(res, 404, { error: 'Order not found' });
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return sendJson(res, 200, { order, items });
  }

  // GET /api/admin/orders?key=YOUR_ADMIN_KEY
  // Shows every order on the site with proof of the real PayPal payment behind it.
  // Requires the ADMIN_KEY environment variable to be set - without it, this is disabled.
  if (pathname === '/api/admin/orders' && req.method === 'GET') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
    const full = orders.map((order) => ({
      ...order,
      paypal_raw: undefined, // sent separately, parsed, to keep the list readable
      paypal_details: order.paypal_raw ? JSON.parse(order.paypal_raw) : null,
      items: getItems.all(order.id),
    }));
    return sendJson(res, 200, { orders: full });
  }

  // ---- Admin: events + ticket listings management (add/edit/delete) ----

  // GET /api/admin/events?key=...  -> every event with its ticket listings
  if (pathname === '/api/admin/events' && req.method === 'GET') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    const events = db.prepare('SELECT * FROM events ORDER BY event_date ASC').all();
    const getTickets = db.prepare('SELECT * FROM tickets WHERE event_id = ? ORDER BY price ASC');
    const full = events.map((e) => ({ ...e, tickets: getTickets.all(e.id) }));
    return sendJson(res, 200, { events: full });
  }

  // POST /api/admin/events?key=...  -> create a new event
  if (pathname === '/api/admin/events' && req.method === 'POST') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    const body = await readBody(req);
    const required = ['name', 'category', 'venue', 'city', 'state', 'event_date', 'event_time'];
    for (const f of required) {
      if (!body[f] || !String(body[f]).trim()) {
        return sendJson(res, 400, { error: `Missing required field: ${f}` });
      }
    }
    const result = db
      .prepare(
        `INSERT INTO events (name, category, venue, city, state, event_date, event_time, blurb, accent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        body.name.trim(), body.category.trim(), body.venue.trim(), body.city.trim(), body.state.trim(),
        body.event_date.trim(), body.event_time.trim(), (body.blurb || '').trim(), body.accent || 'ink'
      );
    return sendJson(res, 200, { id: Number(result.lastInsertRowid) });
  }

  // PATCH /api/admin/events/:id?key=...  -> update an event's details
  m = pathname.match(/^\/api\/admin\/events\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    const eventId = Number(m[1]);
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!existing) return sendJson(res, 404, { error: 'Event not found' });
    const body = await readBody(req);
    const fields = ['name', 'category', 'venue', 'city', 'state', 'event_date', 'event_time', 'blurb', 'accent'];
    const updated = {};
    for (const f of fields) updated[f] = body[f] !== undefined ? body[f] : existing[f];
    db.prepare(
      `UPDATE events SET name=?, category=?, venue=?, city=?, state=?, event_date=?, event_time=?, blurb=?, accent=?
       WHERE id=?`
    ).run(
      updated.name, updated.category, updated.venue, updated.city, updated.state,
      updated.event_date, updated.event_time, updated.blurb, updated.accent, eventId
    );
    return sendJson(res, 200, { ok: true });
  }

  // DELETE /api/admin/events/:id?key=...  -> delete an event (and its ticket listings)
  m = pathname.match(/^\/api\/admin\/events\/(\d+)$/);
  if (m && req.method === 'DELETE') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    db.prepare('DELETE FROM events WHERE id = ?').run(Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/admin/events/:id/tickets?key=...  -> add a ticket listing to an event
  m = pathname.match(/^\/api\/admin\/events\/(\d+)\/tickets$/);
  if (m && req.method === 'POST') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    const eventId = Number(m[1]);
    const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
    if (!event) return sendJson(res, 404, { error: 'Event not found' });
    const body = await readBody(req);
    if (!body.section || !body.row_label || !body.seat_type || body.price == null || body.quantity_available == null) {
      return sendJson(res, 400, { error: 'Missing required ticket fields' });
    }
    const result = db
      .prepare(
        `INSERT INTO tickets (event_id, section, row_label, seat_type, price, quantity_available)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(eventId, body.section, body.row_label, body.seat_type, Number(body.price), Number(body.quantity_available));
    return sendJson(res, 200, { id: Number(result.lastInsertRowid) });
  }

  // PATCH /api/admin/tickets/:id?key=...  -> update a ticket listing
  m = pathname.match(/^\/api\/admin\/tickets\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    const ticketId = Number(m[1]);
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!existing) return sendJson(res, 404, { error: 'Ticket listing not found' });
    const body = await readBody(req);
    const fields = ['section', 'row_label', 'seat_type', 'price', 'quantity_available'];
    const updated = {};
    for (const f of fields) updated[f] = body[f] !== undefined ? body[f] : existing[f];
    db.prepare(
      `UPDATE tickets SET section=?, row_label=?, seat_type=?, price=?, quantity_available=? WHERE id=?`
    ).run(
      updated.section, updated.row_label, updated.seat_type,
      Number(updated.price), Number(updated.quantity_available), ticketId
    );
    return sendJson(res, 200, { ok: true });
  }

  // DELETE /api/admin/tickets/:id?key=...  -> remove a ticket listing
  m = pathname.match(/^\/api\/admin\/tickets\/(\d+)$/);
  if (m && req.method === 'DELETE') {
    const check = checkAdmin(query);
    if (check) return sendJson(res, check.status, { error: check.error });
    db.prepare('DELETE FROM tickets WHERE id = ?').run(Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsed.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsed.searchParams);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`GatePass running at http://localhost:${PORT}`);
});
