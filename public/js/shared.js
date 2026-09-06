async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

function money(n) {
  return '$' + Number(n).toFixed(2);
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function refreshCartCount() {
  const badge = document.getElementById('cart-count');
  if (!badge) return;
  try {
    const cart = await fetchJSON('/api/cart');
    const count = cart.items.reduce((sum, i) => sum + i.quantity, 0);
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  } catch (e) {
    // silent - cart badge is non-critical
  }
}

async function populateCategoryNav() {
  const nav = document.getElementById('category-nav');
  if (!nav) return;
  try {
    const { categories } = await fetchJSON('/api/categories');
    const params = new URLSearchParams(location.search);
    const activeCategory = params.get('category') || '';
    const allLink = `<a href="/index.html" class="${activeCategory ? '' : 'active'}">All events</a>`;
    const links = categories
      .map((c) => `<a href="/index.html?category=${encodeURIComponent(c)}" class="${c === activeCategory ? 'active' : ''}">${c}</a>`)
      .join('');
    nav.innerHTML = allLink + links;
  } catch (e) {
    // silent
  }
}

function wireSearchForm() {
  const form = document.getElementById('search-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = form.querySelector('input').value.trim();
    const url = q ? `/index.html?search=${encodeURIComponent(q)}` : '/index.html';
    window.location.href = url;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  refreshCartCount();
  populateCategoryNav();
  wireSearchForm();
});
