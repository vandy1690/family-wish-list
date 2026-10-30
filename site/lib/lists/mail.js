// Sends email through Resend (resend.com): sign-in codes, and join requests to the admin.
//
// Settings (environment variables):
//   RESEND_API_KEY   the Resend key, made after your domain is verified in Resend
//   LISTS_FROM       optional sender; default "<short title> <lists@your-domain>" (see site.js)
//   LISTS_REPLY_TO   optional; default LISTS_ADMIN_EMAIL, so a reply reaches the admin
//
// Each message takes `site` (siteInfo in site.js) for the wish list's name and the admin's.
//
// For local testing only: LISTS_DEV_LINKS=1 skips the email and hands the link and code
// back to the page. Ignored on Vercel.
import { fromAddress } from './site.js';

export const devLinks = () => !process.env.VERCEL && process.env.LISTS_DEV_LINKS === '1';
export const mailConfigured = () => devLinks() || Boolean(process.env.RESEND_API_KEY);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function sendSignIn({ to, name, link, code, minutes, site }) {
  if (devLinks()) {
    console.log(`[dev] sign-in for ${to}: ${link}  code ${code}`);
    return { dev: { link, code } };
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const subject = `Your sign-in code is ${code}`;
  const text = [
    `Hi ${name},`,
    '',
    `Here is your sign-in for the ${site.title}.`,
    '',
    `Open this link: ${link}`,
    '',
    `Or type this code on the sign-in page: ${code}`,
    '',
    `The link and the code work for ${minutes} minutes. You stay signed in on that device after that.`,
    '',
    'If you did not ask for this, you can ignore it.',
    '',
    site.adminName
  ].join('\n');
  // Email programs do not read the site's stylesheet, so this is plain on purpose:
  // system type, the SDC ink and accent written out, and a link that works without images.
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F0EEE9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#2D3436;font-size:16px;line-height:1.5"><!-- ds-allow: email clients ignore CSS variables, so the SDC values are written out -->
<div style="max-width:520px;margin:0 auto">
<p style="margin:0 0 16px">Hi ${esc(name)},</p>
<p style="margin:0 0 24px">Here is your sign-in for the ${esc(site.title)}.</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#3F5F92;color:#FFFFFF;font-weight:600;text-decoration:none">Open my wish list</a></p>
<p style="margin:0 0 8px">Or type this code on the sign-in page:</p>
<p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:0.18em">${esc(code)}</p>
<p style="margin:0 0 16px;color:#545B5A;font-size:14px">The link and the code work for ${minutes} minutes. You stay signed in on that device after that. If you did not ask for this, you can ignore it.</p>
<p style="margin:0">${esc(site.adminName)}</p>
</div></body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress(site),
      to: [to],
      ...(process.env.LISTS_REPLY_TO || process.env.LISTS_ADMIN_EMAIL ? { reply_to: process.env.LISTS_REPLY_TO || process.env.LISTS_ADMIN_EMAIL } : {}),
      subject, text, html
    })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return {};
}

// Tells the admin that someone asked to join from the sign-in page.
export async function sendJoinRequest({ name, email, note, link, site }) {
  const to = process.env.LISTS_ADMIN_EMAIL;
  if (devLinks() || !to) {
    console.log(`[dev] join request: ${name} <${email}>${note ? ` "${note}"` : ''}`);
    return { dev: true };
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const subject = `${name} asked to join the wish list`;
  const text = [
    `${name} (${email}) asked to be added to the ${site.title}.`,
    note ? `\nTheir note: ${note}` : '',
    '',
    `To add them, open People: ${link}`,
    'If you do not know them, you can ignore this, or tap Decline on People.'
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F0EEE9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#2D3436;font-size:16px;line-height:1.5"><!-- ds-allow: email clients ignore CSS variables, so the SDC values are written out -->
<div style="max-width:520px;margin:0 auto">
<p style="margin:0 0 16px"><strong>${esc(name)}</strong> (${esc(email)}) asked to be added to the ${esc(site.title)}.</p>
${note ? `<p style="margin:0 0 16px">Their note: ${esc(note)}</p>` : ''}
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#3F5F92;color:#FFFFFF;font-weight:600;text-decoration:none">Open People</a></p>
<p style="margin:0;color:#545B5A;font-size:14px">If you do not know them, you can ignore this, or tap Decline on People.</p>
</div></body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress(site), to: [to], subject, text, html })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return {};
}

