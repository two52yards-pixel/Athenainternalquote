import nodemailer from 'nodemailer';

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendNewClientNotification({ fullName, email, companyName, createdAt }) {
  if (!smtpConfigured() || !process.env.INFO_EMAIL) {
    console.warn('[mailer] SMTP or INFO_EMAIL not configured — skipping new-client notification');
    return;
  }

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"Athena Marine Quote Desk" <${process.env.SMTP_USER}>`,
    to: process.env.INFO_EMAIL,
    subject: `New client sign up: ${fullName}`,
    html: `
      <h2 style="color:#003459;font-family:sans-serif">New Client Sign Up</h2>
      <p style="font-family:sans-serif;font-size:14px">A new client has registered on the Quote Desk.</p>
      <table style="border-collapse:collapse;font-size:14px;font-family:sans-serif;margin-top:1rem">
        <tr><td style="padding:6px 20px 6px 0;font-weight:600;color:#374151">Full Name</td><td style="padding:6px 0;color:#111827">${fullName}</td></tr>
        <tr><td style="padding:6px 20px 6px 0;font-weight:600;color:#374151">Email</td><td style="padding:6px 0;color:#111827">${email}</td></tr>
        <tr><td style="padding:6px 20px 6px 0;font-weight:600;color:#374151">Company</td><td style="padding:6px 0;color:#111827">${companyName || '—'}</td></tr>
        <tr><td style="padding:6px 20px 6px 0;font-weight:600;color:#374151">Signed Up</td><td style="padding:6px 0;color:#111827">${new Date(createdAt).toLocaleString('en-GB')}</td></tr>
      </table>
    `
  });
}

export async function sendPasswordResetEmail({ email, fullName, resetLink }) {
  if (!smtpConfigured()) {
    console.warn('[mailer] SMTP not configured — skipping password reset email');
    return;
  }

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"Athena Marine Quote Desk" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Reset your password — Athena Marine Quote Desk',
    html: `
      <p style="font-family:sans-serif;font-size:14px">Hi ${fullName},</p>
      <p style="font-family:sans-serif;font-size:14px">We received a request to reset your password. Click the button below to set a new one:</p>
      <p style="margin:1.5rem 0">
        <a href="${resetLink}" style="background:#003459;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;font-family:sans-serif">Reset password</a>
      </p>
      <p style="font-family:sans-serif;font-size:13px;color:#6b7280">This link expires in <strong>1 hour</strong>. If you did not request this, you can safely ignore this email.</p>
      <p style="font-family:sans-serif;font-size:13px;color:#6b7280">Or copy this link into your browser:<br><a href="${resetLink}" style="color:#003459">${resetLink}</a></p>
    `
  });
}
