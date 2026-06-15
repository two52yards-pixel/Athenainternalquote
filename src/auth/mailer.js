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

export async function sendWelcomeEmail({ fullName, email }) {
  if (!smtpConfigured()) {
    console.warn('[mailer] Welcome email skipped — SMTP not configured');
    return;
  }

  const appUrl = process.env.APP_URL || 'https://athenainternalquote.onrender.com';
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
    '<p class="greet">Dear ' + esc(fullName) + ',</p>' +
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
    '<p>Sent to ' + esc(email) + ' because you registered on the Athena Marine Quote Desk.</p></div>' +
    '</div></body></html>';

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"Athena Marine" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Welcome to the Athena Marine Quote Desk',
    html,
    text: `Dear ${fullName},\n\nWelcome to the Athena Marine Quote Desk.\n\nYour account is now active. Access the platform: ${loginUrl}\n\nKind regards,\nThe Athena Marine Team\n\n"Built to simplify quotations. Designed to keep your business moving."`
  });
}
