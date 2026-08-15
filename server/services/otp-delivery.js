export async function deliverOneTimeCode({ type, destination, code, config, fetcher = fetch }) {
  if (config.otpProvider === 'development') {
    if (config.isProduction) throw new Error('The development OTP adapter cannot run in a hosted environment.');
    return { delivered: true, provider: 'development', testCode: code };
  }

  if (type === 'email' && config.emailProvider === 'resend' && config.resendApiKey && config.emailFrom) {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [destination],
        subject: 'Your Fish & Spices sign-in code',
        text: `Your Fish & Spices sign-in code is ${code}. It expires in ${config.otpLifetimeMinutes} minutes. If you did not request this code, ignore this message.`
      }),
      signal: AbortSignal.timeout(8_000)
    });
    return { delivered: response.ok, provider: 'resend' };
  }

  return { delivered: false, provider: null };
}
