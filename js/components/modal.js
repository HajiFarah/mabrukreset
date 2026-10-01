const overlay = document.getElementById('modal-overlay');

overlay?.addEventListener('click', (event) => {
  if (event.target === overlay) closeModal();
});

export function openModal(html) {
  const modalOverlay = document.getElementById('modal-overlay');
  if (!modalOverlay) return;

  modalOverlay.innerHTML = `<div class="modal">${html}</div>`;
  modalOverlay.classList.remove('hidden');
}

export function closeModal() {
  const modalOverlay = document.getElementById('modal-overlay');
  if (!modalOverlay) return;

  modalOverlay.classList.add('hidden');
  modalOverlay.innerHTML = '';
}
