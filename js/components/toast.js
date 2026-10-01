export function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  if (type === 'error') {
    const text = document.createElement('span');
    text.textContent = message;
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    toast.appendChild(text);
    toast.appendChild(close);
  } else {
    toast.textContent = message;
    window.setTimeout(() => toast.remove(), duration);
  }

  container.appendChild(toast);
  window.setTimeout(() => toast.classList.add('toast-visible'), 10);
}
