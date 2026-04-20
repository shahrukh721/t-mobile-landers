/// <reference types="node" />

const GHL_BASE = 'https://services.leadconnectorhq.com/contacts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  let parsed: Record<string, any> = {};
  try {
    parsed = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid json' });
  }

  const {
    firstName = '',
    lastName  = '',
    email     = '',
    phone     = '',
    address   = '',
    zip       = '',
    formId    = '',
  } = parsed;

  const normalizedPhone = phone
    ? phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`
    : '';

  const headers = {
    'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28',
  };

  const payload: Record<string, unknown> = {
    firstName,
    lastName,
    email,
    phone:      normalizedPhone,
    postalCode: zip,
    address1:   address,
    locationId: process.env.GHL_LOCATION_ID,
    tags:       ['t-mobile-5g'],
  };

  try {
    const ghlRes = await fetch(GHL_BASE, {
      method: 'POST',
      headers,
      body:   JSON.stringify(payload),
    });

    if (!ghlRes.ok) {
      const errText = await ghlRes.text();
      // Duplicate contact → auto-switch to update existing contact
      if (ghlRes.status === 400) {
        try {
          const errJson = JSON.parse(errText);
          const existingId = errJson?.meta?.contactId;
          if (existingId) {
            const updatePayload = { firstName, lastName, email, phone: normalizedPhone, postalCode: zip, address1: address };
            const retryRes = await fetch(`${GHL_BASE}/${existingId}`, {
              method: 'PUT',
              headers,
              body:   JSON.stringify(updatePayload),
            });
            if (retryRes.ok) {
              return res.status(200).json({ ok: true, contactId: existingId });
            }
          }
        } catch {}
      }
      console.error(`GHL ${ghlRes.status}:`, errText);
      return res.status(200).json({ ok: false, ghlStatus: ghlRes.status });
    }

    const data = await ghlRes.json();
    const contactId = data?.contact?.id;

    if (formId && process.env.GHL_LOCATION_ID) {
      try {
        const formBody = new URLSearchParams();
        formBody.set('location_id', process.env.GHL_LOCATION_ID);
        formBody.set('id',          formId);
        if (firstName)       formBody.set('first_name',  firstName);
        if (lastName)        formBody.set('last_name',   lastName);
        if (email)           formBody.set('email',       email);
        if (normalizedPhone) formBody.set('phone',       normalizedPhone);
        if (address)         formBody.set('address1',    address);
        if (zip)             formBody.set('postal_code', zip);

        // backend.leadconnectorhq.com/forms/submit is the same endpoint
        // GHL's own iframe form uses — server-side call has no CORS issue
        // and no per-call cost (this is NOT a workflow action/webhook).
        const formRes = await fetch('https://backend.leadconnectorhq.com/forms/submit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    formBody.toString(),
        });

        if (!formRes.ok) {
          console.error('GHL form submit failed:', formRes.status, await formRes.text().catch(() => ''));
        }
      } catch (e) { console.error('GHL form submit error:', e); }
    }

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(200).json({ ok: false });
  }
}
