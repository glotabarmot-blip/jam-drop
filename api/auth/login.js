export default async function handler(req, res) {
  // Динамический импорт вместо статического
  const { ScalekitClient } = await import('@scalekit-sdk/node');

  const scalekit = new ScalekitClient(
    process.env.SCALEKIT_ENV_URL,
    process.env.SCALEKIT_CLIENT_ID,
    process.env.SCALEKIT_CLIENT_SECRET
  );

  const redirectUri = 'https://jam-drop.vercel.app/api/auth/callback';

  const authUrl = scalekit.getAuthorizationUrl(redirectUri, {
    scopes: ['openid', 'profile', 'email']
  });

  res.redirect(307, authUrl);
}
