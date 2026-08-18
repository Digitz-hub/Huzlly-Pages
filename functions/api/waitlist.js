// functions/api/waitlist.js
// Cloudflare Pages Function — handles POST /api/waitlist.
// Requires a KV namespace bound as WAITLIST_KV (see setup steps in README
// or the message this was delivered with). Stores one KV entry per email:
//   key:   waitlist:<lowercased email>
//   value: { email, name, joinedAt }
//
// `name` is optional at this layer — the homepage CTA (WaitlistForm.astro)
// only ever sends email, while the full form on /waitlist
// (WaitlistSignupForm.astro) sends both. A signup that arrives without a
// name is stored with name: null rather than rejected.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;

export async function onRequestPost({ request, env }) {
  let email = '';
  let name = '';
  let honeypot = '';

  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      email = body.email ?? '';
      name = body.name ?? '';
      honeypot = body.company ?? '';
    } else {
      const form = await request.formData();
      email = form.get('email') ?? '';
      name = form.get('name') ?? '';
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

  const trimmedName = String(name).trim().slice(0, MAX_NAME_LENGTH);

  if (!env.WAITLIST_KV) {
    return json({ ok: false, error: 'not_configured' }, 500);
  }

  const key = `waitlist:${normalized}`;
  const existing = await env.WAITLIST_KV.get(key);
  if (existing) {
    // If they signed up before without a name and now send one, fill it in
    // rather than staying silent about it — otherwise treat as a plain dup.
    if (trimmedName) {
      const existingData = JSON.parse(existing);
      if (!existingData.name) {
        await env.WAITLIST_KV.put(
          key,
          JSON.stringify({ ...existingData, name: trimmedName })
        );
      }
    }
    return json({ ok: true, duplicate: true });
  }

  await env.WAITLIST_KV.put(
    key,
    JSON.stringify({
      email: normalized,
      name: trimmedName || null,
      joinedAt: new Date().toISOString(),
    })
  );

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
