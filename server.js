const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

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

  // POST /api/checkout  { name, email }
  if (pathname === '/api/checkout' && req.method === 'POST') {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    if (!name || !email.includes('@')) {
      return sendJson(res, 400, { error: 'A valid name and email are required' });
    }
    const cart = cartForSession(sid);
    if (cart.items.length === 0) {
      return sendJson(res, 400, { error: 'Your cart is empty' });
    }
    for (const item of cart.items) {
      if (item.quantity > item.quantity_available) {
        return sendJson(res, 400, { error: `"${item.event_name}" no longer has enough tickets available` });
      }
    }
    const orderResult = db
      .prepare('INSERT INTO orders (session_id, buyer_name, buyer_email, total) VALUES (?, ?, ?, ?)')
      .run(sid, name, email, cart.total);
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
    return sendJson(res, 200, { orderId });
  }

  // GET /api/orders/:id
  m = pathname.match(/^\/api\/orders\/(\d+)$/);
  if (m && req.method === 'GET') {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND session_id = ?').get(Number(m[1]), sid);
    if (!order) return sendJson(res, 404, { error: 'Order not found' });
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return sendJson(res, 200, { order, items });
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
