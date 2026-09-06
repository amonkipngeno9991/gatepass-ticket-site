function getEventId() {
  const params = new URLSearchParams(location.search);
  return params.get('id');
}

function qtyOptions(max) {
  const capped = Math.min(8, max);
  let opts = '';
  for (let i = 1; i <= capped; i++) {
    opts += `<option value="${i}">${i}</option>`;
  }
  return opts;
}

function listingRowHTML(ticket) {
  const soldOut = ticket.quantity_available <= 0;
  return `
    <div class="listing-row" data-ticket-id="${ticket.id}" data-available="${ticket.quantity_available}">
      <div class="listing-info">
        <div class="section-name">${ticket.section}</div>
        <div class="row-name">Row ${ticket.row_label} · ${ticket.seat_type} · ${ticket.quantity_available} left</div>
      </div>
      <div class="listing-price">${money(ticket.price)}<span>each</span></div>
      <div class="qty-select">
        ${soldOut
          ? `<button class="btn" disabled>Sold out</button>`
          : `<select aria-label="Quantity">${qtyOptions(ticket.quantity_available)}</select>
             <button class="btn add-btn">Add to cart</button>`
        }
      </div>
    </div>
  `;
}

async function loadEvent() {
  const id = getEventId();
  const nameEl = document.getElementById('event-name');
  if (!id) {
    nameEl.textContent = 'Event not found';
    return;
  }
  try {
    const { event } = await fetchJSON(`/api/events/${id}`);
    document.title = `${event.name} — GatePass`;
    nameEl.textContent = event.name;
    document.getElementById('crumb-category').textContent = event.category;
    document.getElementById('event-blurb').textContent = event.blurb;
    document.getElementById('event-meta').innerHTML = `
      <div class="meta-item"><div class="label">Date</div><strong>${formatDate(event.event_date)}</strong></div>
      <div class="meta-item"><div class="label">Time</div><strong>${event.event_time}</strong></div>
      <div class="meta-item"><div class="label">Venue</div><strong>${event.venue}</strong></div>
      <div class="meta-item"><div class="label">Location</div><strong>${event.city}, ${event.state}</strong></div>
    `;

    const listingsEl = document.getElementById('listings');
    if (event.tickets.length === 0) {
      listingsEl.innerHTML = `<div class="empty-state"><h3>No tickets currently listed</h3><p>Check back closer to the event date.</p></div>`;
    } else {
      listingsEl.innerHTML = event.tickets.map(listingRowHTML).join('');
    }

    listingsEl.querySelectorAll('.listing-row').forEach((row) => {
      const addBtn = row.querySelector('.add-btn');
      if (!addBtn) return;
      addBtn.addEventListener('click', async () => {
        const ticketId = row.dataset.ticketId;
        const qty = Number(row.querySelector('select').value);
        addBtn.disabled = true;
        addBtn.textContent = 'Adding…';
        try {
          await fetchJSON('/api/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketId, quantity: qty }),
          });
          addBtn.textContent = 'Added ✓';
          refreshCartCount();
          setTimeout(() => {
            addBtn.textContent = 'Add to cart';
            addBtn.disabled = false;
          }, 1200);
        } catch (e) {
          addBtn.textContent = 'Add to cart';
          addBtn.disabled = false;
          alert(e.message);
        }
      });
    });
  } catch (e) {
    nameEl.textContent = 'Event not found';
  }
}

document.addEventListener('DOMContentLoaded', loadEvent);
