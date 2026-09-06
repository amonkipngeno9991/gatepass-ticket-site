async function loadOrder() {
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');
  const summaryEl = document.getElementById('order-summary');
  if (!orderId) {
    document.getElementById('confirm-title').textContent = 'No order found';
    document.getElementById('confirm-sub').textContent = 'Head back and complete a purchase first.';
    summaryEl.style.display = 'none';
    return;
  }
  try {
    const { order, items } = await fetchJSON(`/api/orders/${orderId}`);
    document.getElementById('confirm-sub').textContent = `A confirmation was sent to ${order.buyer_email}.`;
    summaryEl.innerHTML = `
      <div class="summary-row"><span>Order #</span><span>${order.id}</span></div>
      <div class="summary-row"><span>Name</span><span>${order.buyer_name}</span></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
      ${items.map((i) => `
        <div class="summary-row">
          <span>${i.event_name} — ${i.section} (×${i.quantity})</span>
          <span>${money(i.price * i.quantity)}</span>
        </div>
      `).join('')}
      <div class="summary-row total"><span>Total paid</span><span>${money(order.total)}</span></div>
    `;
  } catch (e) {
    document.getElementById('confirm-title').textContent = 'Order not found';
    summaryEl.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', loadOrder);
