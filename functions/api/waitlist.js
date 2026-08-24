// functions/api/waitlist.js
// Cloudflare Pages Function — handles POST /api/waitlist.
// Requires a KV namespace bound as WAITLIST_KV (see setup steps in README
// or the message this was delivered with). Stores one KV entry per email:
//   key:   waitlist:<lowercased email>
//   value: { email, joinedAt }
//
// Email only — no name is collected or stored.
//
// After a NEW signup is saved, we also send a confirmation email via
// Resend (https://resend.com), using a Resend Dashboard Template (no
// dynamic variables — the template's content is fully static). Requires:
//   - env.RESEND_API_KEY   — set as a Secret in Cloudflare Pages
//                            (Settings → Environment variables)
//   - a verified sending domain in Resend (huzlly.com)
//   - a published Resend Template with alias "waitlist-confirmation"
// Email sending failures are swallowed on purpose — the signup itself
// (the KV write) has already succeeded by the time we try to email, and
// a flaky email API should never turn a successful signup into an error
// for the user. Duplicates never re-trigger the email.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FROM_EMAIL = 'Huzlly <noreply@huzlly.com>';
const TEMPLATE_ALIAS = 'waitlist-confirmation';

export async function onRequestPost({ request, env }) {
  let email = '';
  let honeypot = '';

  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      email = body.email ?? '';
      honeypot = body.company ?? '';
    } else {
      const form = await request.formData();
      email = form.get('email') ?? '';
      honeypot = form.get('company') ?? '';
    }
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot field: real visitors never see or fill it (see WaitlistForm.astro).
  // Bots that fill every field trip it. Respond success so bots don't retry.
  if (honeypot) {
    return json({ ok: true });
  }

  const normalized = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }

  if (!env.WAITLIST_KV) {
    return json({ ok: false, error: 'not_configured' }, 500);
  }

  const key = `waitlist:${normalized}`;
  const existing = await env.WAITLIST_KV.get(key);
  if (existing) {
    // Already signed up — treated as a failure so the frontend keeps the
    // visitor on the form panel instead of the confirmation panel, and
    // don't re-send the confirmation email.
    return json({ ok: false, error: 'duplicate_email' }, 409);
  }

  await env.WAITLIST_KV.put(
    key,
    JSON.stringify({
      email: normalized,
      joinedAt: new Date().toISOString(),
    })
  );

  // Signup is saved. Best-effort confirmation email — never block or fail
  // the response on this.
  await sendConfirmationEmail(env, normalized);

  return json({ ok: true });
}

async function sendConfirmationEmail(env, email) {
  if (!env.RESEND_API_KEY) {
    // Not configured — skip silently rather than erroring the signup.
    console.log('RESEND_API_KEY not set; skipping confirmation email');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        template: {
          id: TEMPLATE_ALIAS,
        },
      }),
    });

    if (!res.ok) {
      // Log the failure for later debugging (visible in Cloudflare Pages
      // Functions logs / `wrangler pages deployment tail`), but don't
      // throw — the signup already succeeded.
      const errorBody = await res.text();
      console.error('Resend API error:', res.status, errorBody);
    }
  } catch (err) {
    console.error('Failed to send confirmation email:', err);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
