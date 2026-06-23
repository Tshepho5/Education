// Auth Logic - FUSION_HIGH_APP

import { login } from './api.js';
import { showLoading, hideLoading, loadDashboard } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  // Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading(loginForm);
    clearError(loginError);

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const data = await login({ email, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('userRole', data.role);
      loadDashboard(data.role);
    } catch (error) {
      showError(loginError, error.message);
    } finally {
      hideLoading(loginForm);
    }
  });

  function clearError(errorEl) {
  errorEl.textContent = '';
  errorEl.classList.remove('show');
}

function showError(errorEl, message) {
  errorEl.textContent = message;
  errorEl.classList.add('show');
}

});

// Register handled in registrationForm.js for better separation of concerns