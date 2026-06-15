import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

import {
  findClientByEmail,
  createClient,
  updateClientPassword,
  createResetToken,
  findResetToken,
  markResetTokenUsed
} from './userStore.js';

import { sendNewClientNotification, sendPasswordResetEmail } from './mailer.js';

const router = Router();

const COOKIE_NAME = 'athena_auth';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  };
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

// Rate limiter — max 5 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' }
});

// =====================
// AUTH GUARD MIDDLEWARE
// =====================
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
  }

  try {
    req.client = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    res.clearCookie(COOKIE_NAME);
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.redirect('/login.html');
  }
}

// =====================
// ADMIN GUARD MIDDLEWARE
// Must be used AFTER requireAuth (relies on req.client being set)
// =====================
export function requireAdmin(req, res, next) {
  if (req.client?.role !== 'admin') {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    return res.redirect('/');
  }
  next();
}

// =====================
// SIGN UP
// =====================
router.post('/signup', async (req, res) => {
  try {
    const { fullName, email, password, companyName } = req.body;

    if (!fullName?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const client = await createClient({ fullName, email, passwordHash, companyName });
    (async () => {
      try {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
          console.warn('[auth] Welcome email skipped — SMTP env vars not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
          return;
        }
        const loginUrl = appUrl + '/login.html';
        const year = new Date().getFullYear();
        function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
        const html =
          '<!DOCTYPE html><html lang="en"><head>' +
          '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Welcome to the Athena Marine Quote Desk</title>' +
          '<style>' +
          'body{margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1a2332}' +
          '.wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}' +
          '.hdr{background:#003459;padding:32px 40px;text-align:center}' +
          '.hdr h1{margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:.01em}' +
          '.bd{padding:36px 40px}' +
          '.greet{font-size:16px;font-weight:600;color:#003459;margin:0 0 16px}' +
          'p{margin:0 0 14px;font-size:14px;line-height:1.7;color:#374151}' +
          '.st{font-size:12px;font-weight:700;color:#003459;text-transform:uppercase;letter-spacing:.07em;margin:28px 0 10px;border-top:1px solid #e5e7eb;padding-top:20px}' +
          'ul{margin:0 0 14px;padding-left:20px}ul li{font-size:14px;line-height:1.8;color:#374151}' +
          '.cta-w{text-align:center;margin:28px 0}' +
          '.cta{display:inline-block;padding:13px 32px;background:#003459;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600}' +
          'hr.d{border:none;border-top:1px solid #e5e7eb;margin:28px 0}' +
          '.ft{padding:24px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center}' +
          '.ft p{font-size:12px;color:#6b7280;margin:0;line-height:1.6}' +
          '.tl{font-style:italic;font-size:13px;color:#6b7280;margin-top:8px}' +
          '</style></head><body>' +
          '<div class="wrap">' +
          '<div class="hdr"><h1>Athena Marine &mdash; Quote Desk</h1></div>' +
          '<div class="bd">' +
          '<p class="greet">Dear ' + esc(client.fullName) + ',</p>' +
          '<p>Welcome to the <strong>Athena Marine Quote Desk</strong>.</p>' +
          '<p>We are delighted to confirm that your account has been successfully activated and that you now have access to our exclusive quotation platform.</p>' +
          '<p>Access to the Quote Desk is reserved for a select network of trusted clients and industry partners. Designed to simplify and accelerate the quotation process, the platform provides a faster, smarter, and more efficient way to manage your enquiries and opportunities with Athena Marine.</p>' +
          '<div class="st">What You Can Expect</div>' +
          '<ul><li>Rapid quotation generation and processing</li><li>Improved visibility across your requests and projects</li><li>Reduced administration and communication delays</li><li>Faster response times and enhanced efficiency</li><li>Access to future platform enhancements and new features</li></ul>' +
          '<p>Our goal is to provide a seamless experience that saves valuable time while giving you greater control and transparency throughout the quotation process.</p>' +
          '<div class="st">Getting Started</div>' +
          '<p>To help you make the most of the Athena Marine Quote Desk, we have created a short introductory video that walks you through the key features and best practices. We strongly recommend watching it before using the platform.</p>' +
          '<p><strong>Watch the Introduction Video &rarr;</strong> [Insert Video Link]</p>' +
          '<div class="st">Your Account</div>' +
          '<p>Your account is now active and ready to use.</p>' +
          '<div class="cta-w"><a href="' + loginUrl + '" class="cta">Access the Quote Desk &rarr;</a></div>' +
          '<p>Should you require any assistance, our team is always available to help.</p>' +
          '<hr class="d">' +
          '<p>Thank you for your continued trust and partnership. We look forward to supporting your success.</p>' +
          '<p>Kind regards,<br><strong>The Athena Marine Team</strong></p>' +
          '<p class="tl">&ldquo;Built to simplify quotations. Designed to keep your business moving.&rdquo;</p>' +
          '</div>' +
          '<div class="ft"><p>&copy; ' + year + ' Athena Marine. All rights reserved.</p>' +
          '<p>Sent to ' + esc(client.email) + ' because you registered on the Athena Marine Quote Desk.</p></div>' +
          '</div></body></html>';
        const mailer = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: false,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        await mailer.sendMail({
          from: '"Athena Marine" <' + process.env.SMTP_USER + '>',
          to: client.email,
          subject: 'Welcome to the Athena Marine Quote Desk',
          html,
          text: 'Dear ' + client.fullName + ',\n\nWelcome to the Athena Marine Quote Desk.\n\nYour account is now active. Access the platform: ' + loginUrl + '\n\nKind regards,\nThe Athena Marine Team'
        });
        console.log('[auth] Welcome email sent to:', client.email);
      } catch (mailErr) {
        console.error('[auth] Welcome email FAILED:', mailErr.message, mailErr.code || '');
      }
    })();
    // Fire-and-forget — never block the response on email
    sendNewClientNotification({
      fullName: client.fullName,
      email: client.email,
      companyName: client.companyName || '',
      createdAt: client.createdAt
    }).catch(err => console.error('[mailer] new-client notification:', err.message));

    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.message === 'DUPLICATE_EMAIL') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('[auth/signup]', err);
    res.status(500).json({ error: 'Sign up failed. Please try again.' });
  }
});

// =====================
// LOGIN
// =====================
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const client = await findClientByEmail(email.trim());
    if (!client) {
      return res.status(401).json({ error: 'No account found with this email address.' });
    }

    if (client.blocked) {
      return res.status(403).json({ error: 'This account has been suspended. Please contact Athena Marine.' });
    }

    const valid = await bcrypt.compare(password, client.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const token = jwt.sign(
      { id: client.id, email: client.email, fullName: client.fullName, role: client.role || 'client' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ ok: true, role: client.role || 'client' });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// =====================
// LOGOUT
// =====================
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// =====================
// FORGOT PASSWORD
// =====================
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email?.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const client = await findClientByEmail(email.trim());

    // Always respond with ok — prevents email enumeration
    if (client) {
      const rawToken = await createResetToken(client.id);
      const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
      const resetLink = `${appUrl}/reset-password.html?token=${rawToken}`;

      sendPasswordResetEmail({
        email: client.email,
        fullName: client.fullName,
        resetLink
      }).catch(err => console.error('[mailer] reset email:', err.message));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// =====================
// VALIDATE RESET TOKEN (GET)
// Called by reset-password.html on load to check token validity
// =====================
router.get('/validate-reset-token', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.json({ valid: false, error: 'Token is missing.' });
  }

  try {
    const record = await findResetToken(String(token));

    if (!record) {
      return res.json({ valid: false, error: 'This link is invalid or has already been used.' });
    }
    if (record.usedAt) {
      return res.json({ valid: false, error: 'This link has already been used. Please request a new one.' });
    }
    if (new Date(record.expiresAt) < new Date()) {
      return res.json({ valid: false, error: 'This link has expired. Please request a new one.' });
    }

    res.json({ valid: true });
  } catch (err) {
    console.error('[auth/validate-reset-token]', err);
    res.json({ valid: false, error: 'Unable to validate link.' });
  }
});

// =====================
// RESET PASSWORD
// =====================
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const record = await findResetToken(String(token));

    if (!record) {
      return res.status(400).json({ error: 'This link is invalid or has already been used.' });
    }
    if (record.usedAt) {
      return res.status(400).json({ error: 'This link has already been used. Please request a new one.' });
    }
    if (new Date(record.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'This link has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await updateClientPassword(record.clientId, passwordHash);
    await markResetTokenUsed(record.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    res.status(500).json({ error: 'Password reset failed. Please try again.' });
  }
});

export default router;

// =====================
// ME — returns current authenticated client info
// Registered on the main app router (needs requireAuth), not here
// =====================
export function meHandler(req, res) {
  const { id, email, fullName, role } = req.client;
  res.json({ id, email, fullName, role: role || 'client' });
}
