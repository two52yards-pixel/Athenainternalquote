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
