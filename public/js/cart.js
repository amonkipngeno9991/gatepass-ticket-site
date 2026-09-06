function cartItemHTML(item) {
  return `
    <div class="cart-item" data-cart-item-id="${item.cart_item_id}" data-available="${item.quantity_available}">
      <div>
        <div class="event-name">${item.event_name}</div>
        <div class="item-meta">${item.section} · Row ${item.row_label} · ${formatDateShort(item.event_date)} · ${item.venue}</div>
        <button class="remove-link" data-action="remove">Remove</button>
      </div>
      <div class="qty-stepper">
        <button data-action="dec" aria-label="Decrease quantity">−</button>
        <span>${item.quantity}</span>
        <button data-action="inc" aria-label="Increase quantity">+</button>
      </div>
      <div>${money(item.price)} each</div>
      <div class="cart-line-total">${money(item.price * item.quantity)}</div>
    </div>
  `;
}

function showError(msg) {
  const slot = document.getElementById('error-slot');
  slot.innerHTML = msg ? `<div class="error-banner">${msg}</div>` : '';
}

async function updateQuantity(cartItemId, quantity) {
  await fetchJSON(`/api/cart/${cartItemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  });
}

async function removeItem(cartItemId) {
  await fetchJSON(`/api/cart/${cartItemId}`, { method: 'DELETE' });
}

async function loadCart() {
  const itemsEl = document.getElementById('cart-items');
  try {
    const cart = await fetchJSON('/api/cart');
    if (cart.items.length === 0) {
      itemsEl.innerHTML = `<div class="empty-state">
        <h3>Your cart is empty</h3>
        <p>Browse events and add tickets to get started.</p>
        <p style="margin-top:16px;"><a class="btn" href="/index.html">Browse events</a></p>
      </div>`;
    } else {
      itemsEl.innerHTML = cart.items.map(cartItemHTML).join('');
    }
    document.getElementById('subtotal').textContent = money(cart.total);
    document.getElementById('total').textContent = money(cart.total);

    itemsEl.querySelectorAll('.cart-item').forEach((row) => {
      const cartItemId = row.dataset.cartItemId;
      const available = Number(row.dataset.available);
      row.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          try {
            if (action === 'remove') {
              await removeItem(cartItemId);
            } else {
              const span = row.querySelector('.qty-stepper span');
              let qty = Number(span.textContent);
              qty = action === 'inc' ? Math.min(available, 8, qty + 1) : qty - 1;
              await updateQuantity(cartItemId, qty);
            }
            showError('');
            loadCart();
            refreshCartCount();
          } catch (e) {
            showError(e.message);
          }
        });
      });
    });
  } catch (e) {
    itemsEl.innerHTML = `<div class="empty-state"><h3>Couldn't load cart</h3><p>${e.message}</p></div>`;
  }
}

document.getElementById('checkout-btn').addEventListener('click', async () => {
  const name = document.getElementById('buyer-name').value.trim();
  const email = document.getElementById('buyer-email').value.trim();
  const btn = document.getElementById('checkout-btn');
  btn.disabled = true;
  btn.textContent = 'Processing…';
  try {
    const { orderId } = await fetchJSON('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    window.location.href = `/confirmation.html?order=${orderId}`;
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Complete purchase';
  }
});

document.addEventListener('DOMContentLoaded', loadCart);
