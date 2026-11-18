import { createHash } from 'node:crypto';

const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const hash = value => createHash('sha256').update(value).digest('hex');

function numberField(form, name, min, max) {
  const raw = form.get(name);
  const value = Number(raw);
  if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

// Runtime dependencies are injected so authorization can be tested without an account.
export function createHandler({ getUser, openStore, now = () => new Date().toISOString() }) {
  return async request => {
    if (request.method !== 'POST') return json({ ok: 0, error: 'Use POST.' }, 405);
    // Cookies authenticate requests. Restrict POSTs to this site's own browser pages.
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      return json({ ok: 0, error: 'Open the game on its deployed Netlify site.' }, 403);
    }
    try {
      const user = await getUser();
      if (!user?.id) return json({ ok: 0, error: 'Sign in again on the account page.' }, 401);
      if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
        return json({ ok: 0, error: 'Send application/x-www-form-urlencoded data.' }, 415);
      }
      const body = await request.text();
      if (Buffer.byteLength(body) > 4096) return json({ ok: 0, error: 'Request too large.' }, 413);
      const form = new URLSearchParams(body);
      // Ownership comes from the verified session, never from submitted identity fields.
      if (['code', 'player', 'userId'].some(key => form.has(key))) {
        return json({ ok: 0, error: 'Do not send a code, player, or userId.' }, 400);
      }
      const game = form.get('game') || '';
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(game)) return json({ ok: 0, error: 'Invalid Game ID.' }, 400);
      const action = form.get('action');
      if (!['save', 'load', 'submit', 'leaderboard', 'me'].includes(action)) {
        return json({ ok: 0, error: 'Unknown action.' }, 400);
      }
      const id = hash(user.id);
      const player = `Player-${id.slice(0, 12)}`;
      if (action === 'me') return json({ ok: 1, player });
      let values;
      try {
        if (action === 'save') values = {
          score: numberField(form, 'score', 0, 1000000),
          level: numberField(form, 'level', 1, 999),
          coins: numberField(form, 'coins', 0, 1000000),
        };
        if (action === 'submit') values = { score: numberField(form, 'score', 0, 1000000) };
      } catch (error) { return json({ ok: 0, error: error.message }, 400); }
      const store = openStore();
      if (action === 'save') {
        const data = { ...values, updatedAt: now() };
        await store.setJSON(`${game}/saves/${id}`, data);
        return json({ ok: 1, player, data });
      }
      if (action === 'load') {
        const data = await store.get(`${game}/saves/${id}`, { type: 'json' });
        return json({ ok: 1, player, found: data === null ? 0 : 1, data });
      }
      if (action === 'submit') {
        const data = { player, score: values.score, updatedAt: now() };
        await store.setJSON(`${game}/scores/${id}`, data);
        return json({ ok: 1, data });
      }
      // Classroom-scale board: one record per submitted account; no emails or saves.
      const scores = [];
      for await (const page of store.list({ prefix: `${game}/scores/`, paginate: true })) {
        for (const blob of page.blobs) {
          const data = await store.get(blob.key, { type: 'json' });
          if (data) scores.push({ player: data.player, score: data.score, updatedAt: data.updatedAt });
        }
      }
      scores.sort((a, b) => b.score - a.score || a.player.localeCompare(b.player));
      return json({ ok: 1, scores });
    } catch {
      return json({ ok: 0, error: 'Service unavailable. Check the function logs and sign in again.' }, 500);
    }
  };
}
