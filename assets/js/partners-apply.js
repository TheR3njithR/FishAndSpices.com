(() => {
  const form = document.querySelector('[data-partner-apply-form]');
  const status = document.querySelector('[data-apply-status]');
  if (!form || !status) return;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    status.textContent = 'Submitting application...';

    const values = Object.fromEntries(new FormData(form));
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string' && !value.trim()) values[key] = null;
    }

    const payload = {
      partnerType: values.partnerType,
      displayName: values.displayName,
      legalName: values.legalName,
      contactPerson: values.contactPerson,
      email: values.email,
      phone: values.phone,
      whatsappNumber: values.whatsappNumber,
      country: values.country,
      state: values.state,
      district: values.district,
      city: values.city,
      primaryPlatform: values.primaryPlatform,
      niche: values.niche,
      followerCount: values.followerCount ? Number(values.followerCount) : null,
      notes: values.notes
    };

    try {
      const response = await fetch('/api/v1/partners/apply', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not submit application right now.');

      form.reset();
      status.style.color = '#1d5f2f';
      status.textContent = `Application submitted. Partner code: ${result.partner.partnerCode}. Status: ${result.partner.status}.`;
    } catch (error) {
      status.style.color = '#8e2a2a';
      status.textContent = error.message;
    }
  });
})();
