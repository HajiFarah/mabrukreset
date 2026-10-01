import { db } from '../supabase.js';
import { showToast } from '../components/toast.js';

export function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="login-page">
      <form class="card login-card" id="login-form">
        <div class="login-brand">
          <img src="/icons/logo.svg" alt="Mabruk GS" class="login-logo">
          <h1>Mabruk GS</h1>
        </div>
        <label for="login-email">Email</label>
        <input id="login-email" name="email" type="email" autocomplete="username" required>
        <label for="login-password">Password</label>
        <div class="login-password-wrap">
          <input id="login-password" name="password" type="password" autocomplete="current-password" required>
          <button type="button" id="toggle-password" class="login-password-toggle" aria-label="Show password">👁</button>
        </div>
        <p id="login-error" class="login-error hidden" role="alert"></p>
        <div class="action-bar"><button class="btn btn-green" type="submit">Sign In</button></div>
      </form>
    </section>
  `;

  document.getElementById('toggle-password').addEventListener('click', () => {
    const input = document.getElementById('login-password');
    const btn = document.getElementById('toggle-password');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? '🙈' : '👁';
    btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorMessage = document.getElementById('login-error');
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
    button.disabled = true;

    const { error } = await db.auth.signInWithPassword({
      email: form.elements.email.value,
      password: form.elements.password.value,
    });

    if (error) {
      errorMessage.textContent = error.message;
      errorMessage.classList.remove('hidden');
      button.disabled = false;
      return;
    }

    window.location.hash = '#/sell';
    window.location.reload();
  });
}
