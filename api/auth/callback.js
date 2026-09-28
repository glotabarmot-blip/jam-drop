export default async function handler(req, res) {
  // Динамический импорт вместо статического
  const { ScalekitClient } = await import('@scalekit-sdk/node');

  const scalekit = new ScalekitClient(
    process.env.SCALEKIT_ENV_URL,
    process.env.SCALEKIT_CLIENT_ID,
    process.env.SCALEKIT_CLIENT_SECRET
  );

  const { code, error } = req.query;

  if (error) {
    return res.redirect(307, '/?error=auth_failed');
  }

  if (!code) {
    return res.redirect(307, '/?error=no_code');
  }

  try {
    const redirectUri = 'https://jam-drop.vercel.app/api/auth/callback';
    const result = await scalekit.authenticateWithCode(code, redirectUri);
    const user = result.user;

    const userData = {
      email: user.email,
      name: user.name || user.email.split('@')[0],
      avatar: user.picture || ''
    };

    const cookieValue = Buffer.from(JSON.stringify(userData)).toString('base64');
    res.setHeader('Set-Cookie', `jamdrop_user=${cookieValue}; Path=/; Max-Age=2592000; SameSite=Lax`);

    res.redirect(307, '/');
  } catch (err) {
    console.error('Token exchange error:', err);
    res.redirect(307, '/?error=exchange_failed');
  }
}
