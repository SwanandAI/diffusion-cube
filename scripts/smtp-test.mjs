// Checks the SMTP_* settings in .env.local and sends one test email.
// Usage (from the project root):
//   node --env-file=.env.local scripts/smtp-test.mjs recipient@example.com
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const nodemailer = require('nodemailer');

const to = process.argv[2];
if (!to) { console.error('Usage: node --env-file=.env.local smtp-test.mjs recipient@example.com'); process.exit(1); }
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM_ADDRESS']) {
  if (!process.env[k]) { console.error(`${k} is empty in .env.local`); process.exit(1); }
}
const port = Number(process.env.SMTP_PORT ?? 587);
const t = nodemailer.createTransport({
  host: process.env.SMTP_HOST, port,
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
try {
  await t.verify();
  console.log(`✓ Logged in to ${process.env.SMTP_HOST}:${port} as ${process.env.SMTP_USER}`);
  const info = await t.sendMail({
    from: process.env.EMAIL_FROM_ADDRESS, to,
    subject: '123456 is your 100 Pathways verification code (test)',
    html: '<p>SMTP test from the Diffusion Cube. If you can read this, nodemailer is configured correctly.</p><p style="font-size:28px;letter-spacing:6px"><b>123456</b></p>',
  });
  console.log(`✓ Sent to ${to} (message id ${info.messageId}). Check the inbox and spam folder.`);
} catch (e) {
  console.error('✗', e.code ?? '', e.response ?? e.message);
  if (e.responseCode === 535) console.error('  → Wrong login. For Gmail, SMTP_PASS must be an App Password, not your normal password.');
  process.exit(1);
}
