const ACCENT_PILL = { gold: 'pill-gold', teal: 'pill-teal', ink: 'pill-ink' };

function eventCardHTML(ev) {
  const pillClass = ACCENT_PILL[ev.accent] || 'pill-ink';
  const priceLabel = ev.min_price != null ? `<div class="from-price">From<strong>${money(ev.min_price)}</strong></div>` : '';
  return `
    <a class="ticket-card" href="/event.html?id=${ev.id}">
      <div class="card-top">
        <span class="category-pill ${pillClass}">${ev.category}</span>
        <h3>${ev.name}</h3>
        <div class="venue-line">${ev.venue} · ${ev.city}, ${ev.state}</div>
      </div>
      <div class="card-bottom">
        <div class="date-block"><strong>${formatDateShort(ev.event_date)}</strong>${ev.event_time}</div>
        ${priceLabel}
      </div>
    </a>
  `;
}

function featuredCardHTML(ev) {
  return `
    <span class="tag">${ev.category}</span>
    <h3>${ev.name}</h3>
    <div class="meta">${ev.venue} · ${ev.city}, ${ev.state}<br>${formatDate(ev.event_date)} · ${ev.event_time}</div>
    ${ev.min_price != null ? `<div class="price">Tickets from ${money(ev.min_price)}</div>` : ''}
  `;
}

async function loadEvents() {
  const params = new URLSearchParams(location.search);
  const search = params.get('search') || '';
  const category = params.get('category') || '';

  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (category) query.set('category', category);

  const grid = document.getElementById('event-grid');
  const titleEl = document.getElementById('results-title');
  const countEl = document.getElementById('results-count');

  try {
    const { events } = await fetchJSON(`/api/events?${query.toString()}`);

    if (search) titleEl.textContent = `Results for "${search}"`;
    else if (category) titleEl.textContent = category;
    else titleEl.textContent = 'All upcoming events';
    countEl.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;

    if (events.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">
        <h3>Nothing matches yet</h3>
        <p>Try a different search term or browse all events.</p>
      </div>`;
    } else {
      grid.innerHTML = events.map(eventCardHTML).join('');
    }

    const featured = events.find((e) => e.min_price != null) || events[0];
    const featuredEl = document.getElementById('featured-card');
    if (featured && featuredEl) {
      featuredEl.innerHTML = featuredCardHTML(featured);
      featuredEl.parentElement.querySelector('.hero-eyebrow-free')?.setAttribute('data-ok', '1');
    } else if (featuredEl) {
      featuredEl.closest('.hero').style.display = 'none';
    }
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>Couldn't load events</h3><p>${e.message}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', loadEvents);
