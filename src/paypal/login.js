// "Log in with PayPal": the freelancer signs in with their PayPal account (OpenID Connect).
// Docs: https://developer.paypal.com/docs/log-in-with-paypal/
//
// Flow: /auth/paypal redirects to PayPal's sign-in page -> PayPal redirects back to
// /auth/paypal/callback with a one-time code -> we exchange it for a token and read the
// user's name and email -> a signed session cookie remembers them.
//
// The app must have "Log in with PayPal" enabled in the PayPal developer dashboard, with
// <site>/auth/paypal/callback as a return URL.
const crypto = require('crypto');
const config = require('../config');

const AUTH_HOST = config.paypal.env === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';
const COOKIE = 'fd_session';
const STATE_COOKIE = 'fd_login_state';
const WEEK = 7 * 24 * 3600;

// Sessions are signed with this key; set SESSION_SECRET in production so they survive restarts.
const secret = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`fd:${config.paypal.clientSecret || crypto.randomUUID()}`).digest('hex');

const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

function encodeSession(user) {
  const value = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + WEEK * 1000 })).toString('base64url');
  return `${value}.${sign(value)}`;
}

function decodeSession(raw) {
  if (!raw || !raw.includes('.')) return null;
  const [value, mac] = raw.split('.');
  const expected = sign(value);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(value, 'base64url').toString());
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function setCookie(res, name, value, maxAge, req) {
  const secure = (req.headers['x-forwarded-proto'] || req.protocol) === 'https' ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

// Where PayPal sends the user back. Render terminates TLS, so trust x-forwarded-proto.
function callbackUrl(req) {
  const base = process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/auth/paypal/callback`;
}

function start(req, res) {
  if (!config.paypal.enabled) return res.redirect('/?login=unavailable');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, STATE_COOKIE, state, 600, req);
  const url = new URL(`${AUTH_HOST}/signin/authorize`);
  url.search = new URLSearchParams({
    flowEntry: 'static',
    client_id: config.paypal.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: callbackUrl(req),
    state,
  }).toString();
  res.redirect(url.toString());
}

async function callback(req, res) {
  const { code, state, error } = req.query;
  const expected = cookies(req)[STATE_COOKIE];
  setCookie(res, STATE_COOKIE, '', 0, req);
  if (error || !code || !state || state !== expected) return res.redirect('/?login=failed');
  try {
    const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
    const tokenRes = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code) }).toString(),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(token.error_description || 'token exchange failed');

    const infoRes = await fetch(`${config.paypal.baseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const info = await infoRes.json();
    if (!infoRes.ok) throw new Error(info.message || 'userinfo failed');

    const email = (info.emails || []).find((e) => e.primary)?.value || info.emails?.[0]?.value || info.email || '';
    const user = { name: info.name || [info.given_name, info.family_name].filter(Boolean).join(' ') || email || 'PayPal user', email, payer_id: info.payer_id || '' };
    setCookie(res, COOKIE, encodeSession(user), WEEK, req);
    res.redirect('/app#/disputes');
  } catch (err) {
    console.error('Log in with PayPal failed:', err.message);
    res.redirect('/?login=failed');
  }
}

function currentUser(req) {
  const s = decodeSession(cookies(req)[COOKIE]);
  return s && { name: s.name, email: s.email };
}

function logout(req, res) {
  setCookie(res, COOKIE, '', 0, req);
  res.json({ ok: true });
}

module.exports = { start, callback, currentUser, logout, encodeSession, decodeSession };
