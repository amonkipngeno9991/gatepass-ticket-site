const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gatepass.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    venue TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_time TEXT NOT NULL,
    blurb TEXT NOT NULL,
    accent TEXT NOT NULL DEFAULT 'gold'
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    row_label TEXT NOT NULL,
    seat_type TEXT NOT NULL,
    price REAL NOT NULL,
    quantity_available INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    total REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    section TEXT NOT NULL,
    row_label TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL
  );
`);

function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM events').get();
  if (count > 0) return;

  const insertEvent = db.prepare(`
    INSERT INTO events (name, category, venue, city, state, event_date, event_time, blurb, accent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTicket = db.prepare(`
    INSERT INTO tickets (event_id, section, row_label, seat_type, price, quantity_available)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const events = [
    {
      name: 'Richmond Flying Squirrels vs. Portland Sea Dogs',
      category: 'Baseball',
      venue: 'The Diamond',
      city: 'Richmond',
      state: 'VA',
      event_date: '2026-06-12',
      event_time: '6:35 PM',
      blurb: 'Double-A baseball under the lights. Fireworks follow the final out.',
      accent: 'gold',
      tickets: [
        ['Field Box 12', 'F', 'Standard', 28, 40],
        ['Berm Lawn', 'GA', 'Lawn Seating', 14, 120],
        ['Home Plate Club', 'C', 'Club Seat', 52, 24],
      ],
    },
    {
      name: 'Richmond Flying Squirrels vs. Bowie Baysox',
      category: 'Baseball',
      venue: 'The Diamond',
      city: 'Richmond',
      state: 'VA',
      event_date: '2026-07-03',
      event_time: '6:35 PM',
      blurb: 'Fourth of July weekend fireworks night at the ballpark.',
      accent: 'gold',
      tickets: [
        ['Field Box 8', 'D', 'Standard', 30, 32],
        ['Berm Lawn', 'GA', 'Lawn Seating', 16, 150],
        ['Third Base Reserved', 'H', 'Standard', 22, 60],
      ],
    },
    {
      name: 'Harborlight Fall Tour',
      category: 'Concert',
      venue: 'Ironway Amphitheater',
      city: 'Denver',
      state: 'CO',
      event_date: '2026-09-18',
      event_time: '7:30 PM',
      blurb: 'Indie-folk five-piece bring their new album to the outdoor stage.',
      accent: 'teal',
      tickets: [
        ['Pit', 'GA', 'Standing', 89, 18],
        ['Reserved Terrace', 'M', 'Standard', 65, 45],
        ['Lawn', 'GA', 'Lawn Seating', 39, 200],
      ],
    },
    {
      name: 'Metro Wolves vs. Ridgeline Union',
      category: 'Basketball',
      venue: 'Founders Arena',
      city: 'Columbus',
      state: 'OH',
      event_date: '2026-11-02',
      event_time: '7:00 PM',
      blurb: 'Regular-season conference matchup with a rowdy student section.',
      accent: 'ink',
      tickets: [
        ['Lower Bowl 104', 'J', 'Standard', 74, 20],
        ['Upper Bowl 214', 'R', 'Standard', 31, 80],
        ['Courtside', 'A', 'Premium', 220, 8],
      ],
    },
    {
      name: 'Comedy Underground: Live Taping',
      category: 'Comedy',
      venue: 'The Palladine Room',
      city: 'Austin',
      state: 'TX',
      event_date: '2026-10-09',
      event_time: '8:00 PM',
      blurb: 'A small-room taping for an upcoming streaming special. Phones sealed at the door.',
      accent: 'teal',
      tickets: [
        ['Front Row', '1', 'Standard', 58, 12],
        ['General', 'GA', 'Standard', 35, 90],
      ],
    },
    {
      name: 'Big Shoulders Theater: A Winter Story',
      category: 'Theater',
      venue: 'The Aldgate',
      city: 'Chicago',
      state: 'IL',
      event_date: '2026-12-05',
      event_time: '7:30 PM',
      blurb: 'A new stage adaptation running for one month only, closing before the holidays.',
      accent: 'ink',
      tickets: [
        ['Orchestra', 'F', 'Standard', 95, 30],
        ['Mezzanine', 'C', 'Standard', 68, 50],
        ['Balcony', 'A', 'Standard', 40, 70],
      ],
    },
  ];

  for (const ev of events) {
    const result = insertEvent.run(
      ev.name, ev.category, ev.venue, ev.city, ev.state,
      ev.event_date, ev.event_time, ev.blurb, ev.accent
    );
    const eventId = Number(result.lastInsertRowid);
    for (const [section, row_label, seat_type, price, qty] of ev.tickets) {
      insertTicket.run(eventId, section, row_label, seat_type, price, qty);
    }
  }
}

seedIfEmpty();

module.exports = db;
