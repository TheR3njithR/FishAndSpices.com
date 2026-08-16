import('./i18n.js');

const header = document.querySelector('[data-header]');
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-navigation');

const menuText = value => window.FS_I18N?.text(value) || value;
const isMenuToggleVisible = () => Boolean(menuButton) && getComputedStyle(menuButton).display !== 'none';
const setMenuOpenState = (open) => {
  if (!menuButton || !header) return;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.querySelector('.sr-only').textContent = menuText(open ? 'Close menu' : 'Open menu');
  header.classList.toggle('menu-open', open);
  if (navigation && isMenuToggleVisible()) {
    navigation.style.maxHeight = open ? `${Math.max(window.innerHeight - 70, 0)}px` : '0px';
    navigation.style.overflowY = open ? 'auto' : 'hidden';
  }
};

if (header && !header.querySelector('[data-customer-sign-in]')) {
  const signIn = document.createElement('a');
  signIn.className = 'customer-sign-in';
  signIn.href = 'account.html';
  signIn.dataset.customerSignIn = '';
  signIn.textContent = 'Sign in';
  header.querySelector('.header-inner')?.insertBefore(signIn, header.querySelector('.language-control, .header-actions'));
}

if (navigation && !navigation.querySelector('[data-partner-nav-link]')) {
  const partnerLink = document.createElement('a');
  partnerLink.href = '/partners/index.html';
  partnerLink.textContent = 'Partners';
  partnerLink.dataset.partnerNavLink = '';
  navigation.appendChild(partnerLink);
}

if (!document.body.classList.contains('assistant-page') && !document.querySelector('[data-assistant-launcher]')) {
  const assistantLink = document.createElement('a');
  assistantLink.href = '/assistant';
  assistantLink.className = 'assistant-launcher';
  assistantLink.dataset.assistantLauncher = '';
  assistantLink.textContent = 'Ask FishAndSpices';
  document.body.appendChild(assistantLink);
}

const closeMenu = () => {
  setMenuOpenState(false);
};

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  setMenuOpenState(!isOpen);
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
  window.addEventListener('resize', () => {
    if (!navigation || !menuButton) return;
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    if (isMenuToggleVisible()) {
      navigation.style.maxHeight = isOpen ? `${Math.max(window.innerHeight - 70, 0)}px` : '0px';
      navigation.style.overflowY = isOpen ? 'auto' : 'hidden';
    } else {
      navigation.style.removeProperty('max-height');
      navigation.style.removeProperty('overflow-y');
    }
  });
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

async function capturePartnerReferralFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (!ref) return;

  const cacheKey = `fas-partner-ref-captured:${window.location.pathname}:${window.location.search}`;
  try {
    if (window.sessionStorage?.getItem(cacheKey)) return;
  } catch {
    // Ignore storage failures and continue with best-effort capture.
  }

  try {
    const response = await fetch('/api/v1/partners/referrals/capture', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        ref,
        campaign: params.get('campaign') || params.get('campaign_code'),
        landingPage: `${window.location.pathname}${window.location.search}`,
        utmSource: params.get('utm_source'),
        utmMedium: params.get('utm_medium'),
        utmCampaign: params.get('utm_campaign'),
        utmTerm: params.get('utm_term'),
        utmContent: params.get('utm_content')
      })
    });

    if (response.ok) {
      try {
        window.sessionStorage?.setItem(cacheKey, '1');
      } catch {
        // Ignore storage failures.
      }
    }
  } catch {
    // Best-effort only. We intentionally suppress errors for public page UX.
  }
}

capturePartnerReferralFromQuery();
