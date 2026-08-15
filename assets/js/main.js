import('./i18n.js');

const header = document.querySelector('[data-header]');
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-navigation');

const menuText = value => window.FS_I18N?.text(value) || value;

if (header && !header.querySelector('[data-customer-sign-in]')) {
  const signIn = document.createElement('a');
  signIn.className = 'customer-sign-in';
  signIn.href = 'account.html';
  signIn.dataset.customerSignIn = '';
  signIn.textContent = 'Sign in';
  header.querySelector('.header-inner')?.insertBefore(signIn, header.querySelector('.language-control, .header-actions'));
}

const closeMenu = () => {
  if (!menuButton || !header) return;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.querySelector('.sr-only').textContent = menuText('Open menu');
  header.classList.remove('menu-open');
};

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.querySelector('.sr-only').textContent = menuText(isOpen ? 'Open menu' : 'Close menu');
  header.classList.toggle('menu-open', !isOpen);
});

navigation?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenu();
    menuButton?.focus();
  }
});

if (header) {
  const updateHeader = () => header.classList.toggle('is-scrolled', document.body.classList.contains('inner-page') || window.scrollY > 24);
  window.addEventListener('scroll', updateHeader, { passive: true });
  updateHeader();
}

document.querySelectorAll('[data-year]').forEach(year => { year.textContent = new Date().getFullYear(); });

if (window.FS_CONFIG) {
  document.querySelectorAll('[data-contact-whatsapp]').forEach(link => {
    link.href = `https://wa.me/${window.FS_CONFIG.whatsappNumber}`;
  });
  document.querySelectorAll('[data-contact-email]').forEach(link => {
    const subject = link.dataset.contactSubject ? `?subject=${encodeURIComponent(link.dataset.contactSubject)}` : '';
    link.href = `mailto:${window.FS_CONFIG.businessEmail}${subject}`;
  });
}
