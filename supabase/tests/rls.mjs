/**
 * Does the community RLS actually hold?
 *
 * Two anonymous members against the real local Postgres. Mallory tries the
 * things the policies are supposed to stop. Anything that succeeds is a hole
 * the desktop client cannot close, because the attacker is not running the
 * desktop client.
 */

const API = 'http://127.0.0.1:54421'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const results = []
const record = (name, held, detail) => {
  results.push({ name, held, detail })
  console.log(`${held ? 'HELD  ' : 'BROKEN'}  ${name}${detail ? ' — ' + detail : ''}`)
}

async function signInAnon() {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: {} }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('anon sign-in failed: ' + JSON.stringify(j).slice(0, 300))
  return { jwt: j.access_token, uid: j.user.id }
}

const rest = (jwt) => async (method, pathAndQuery, body, extraHeaders = {}) => {
  const r = await fetch(`${API}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let json = null
  try { json = await r.json() } catch {}
  return { status: r.status, json }
}

const uuid = () => crypto.randomUUID()
const now = () => Date.now()
// Handles are globally unique, so a re-run must not collide with the last one.
const RUN = Math.random().toString(36).slice(2, 8)

// ── Alice: an ordinary member with a message ────────────────────────────────
const alice = await signInAnon()
const aliceApi = rest(alice.jwt)
const aliceId = uuid()

let r = await aliceApi('POST', 'aihub_members', {
  id: aliceId, auth_uid: alice.uid, handle_key: `alice-${RUN}`, updated_at: now(),
  doc: { id: aliceId, handle: 'Alice', handleKey: `alice-${RUN}`, avatarSeed: aliceId, createdAt: now() },
})
if (r.status >= 300) { console.error('setup failed creating Alice:', r.status, JSON.stringify(r.json)); process.exit(2) }

const msgId = uuid()
r = await aliceApi('POST', 'aihub_messages', {
  id: msgId, channel: 'general', author_id: aliceId, created_at: now(), updated_at: now(),
  doc: { id: msgId, channel: 'general', authorId: aliceId, authorHandle: 'Alice',
         kind: 'text', body: 'Alice original text', createdAt: now() },
})
if (r.status >= 300) { console.error('setup failed creating message:', r.status, JSON.stringify(r.json)); process.exit(2) }
console.log('setup: Alice posted a message\n')

// ── Mallory: a second ordinary member, no privileges ────────────────────────
const mallory = await signInAnon()
const malloryApi = rest(mallory.jwt)
const malloryId = uuid()
r = await malloryApi('POST', 'aihub_members', {
  id: malloryId, auth_uid: mallory.uid, handle_key: `mallory-${RUN}`, updated_at: now(),
  doc: { id: malloryId, handle: 'Mallory', handleKey: `mallory-${RUN}`, avatarSeed: malloryId, createdAt: now() },
})
if (r.status >= 300) { console.error('setup failed creating Mallory:', r.status, JSON.stringify(r.json)); process.exit(2) }

// 1. Can Mallory rewrite the text of Alice's message?
r = await malloryApi('PATCH', `aihub_messages?id=eq.${msgId}`, {
  doc: { id: msgId, channel: 'general', authorId: aliceId, authorHandle: 'Alice',
         kind: 'text', body: 'MALLORY REWROTE THIS', createdAt: now() },
  updated_at: now(),
})
let check = await aliceApi('GET', `aihub_messages?id=eq.${msgId}&select=doc`)
const bodyNow = check.json?.[0]?.doc?.body
record('a member cannot rewrite another member\'s message',
  bodyNow === 'Alice original text',
  `body is now "${bodyNow}"`)

// 2. Can Mallory un-hide a moderated message?
await aliceApi('PATCH', `aihub_messages?id=eq.${msgId}`, {
  doc: { ...(check.json?.[0]?.doc || {}), hiddenAt: now() }, updated_at: now(),
})
r = await malloryApi('PATCH', `aihub_messages?id=eq.${msgId}`, {
  doc: { id: msgId, channel: 'general', authorId: aliceId, authorHandle: 'Alice',
         kind: 'text', body: 'Alice original text', createdAt: now() },   // hiddenAt dropped
  updated_at: now(),
})
check = await aliceApi('GET', `aihub_messages?id=eq.${msgId}&select=doc`)
record('a member cannot un-hide moderated content',
  check.json?.[0]?.doc?.hiddenAt != null,
  check.json?.[0]?.doc?.hiddenAt == null ? 'hiddenAt was cleared by a non-moderator' : 'still hidden')

// 3. Can Mallory delete Alice's message?
r = await malloryApi('DELETE', `aihub_messages?id=eq.${msgId}`)
check = await aliceApi('GET', `aihub_messages?id=eq.${msgId}&select=id`)
record('a member cannot delete another member\'s message',
  (check.json || []).length === 1,
  (check.json || []).length === 0 ? 'row is gone' : 'row survives')

// 4. Can Mallory ban Alice by writing her member row?
r = await malloryApi('PATCH', `aihub_members?id=eq.${aliceId}`, {
  doc: { id: aliceId, handle: 'Alice', handleKey: `alice-${RUN}`, avatarSeed: aliceId,
         createdAt: now(), bannedAt: now(), banReason: 'banned by Mallory' },
  updated_at: now(),
})
check = await aliceApi('GET', `aihub_members?id=eq.${aliceId}&select=doc`)
record('a member cannot ban another member',
  check.json?.[0]?.doc?.bannedAt == null,
  check.json?.[0]?.doc?.bannedAt != null ? 'Alice is now banned by a non-moderator' : 'not banned')

// 5. Can Mallory post under Alice's identity?
const forged = uuid()
r = await malloryApi('POST', 'aihub_messages', {
  id: forged, channel: 'general', author_id: aliceId, created_at: now(), updated_at: now(),
  doc: { id: forged, channel: 'general', authorId: aliceId, authorHandle: 'Alice',
         kind: 'text', body: 'forged', createdAt: now() },
})
record('a member cannot post in another member\'s name', r.status >= 300, `insert returned ${r.status}`)

// 6. Reactions must STILL work — the fix must not break the feature it guards.
const before = await aliceApi('GET', `aihub_messages?id=eq.${msgId}&select=doc`)
r = await malloryApi('PATCH', `aihub_messages?id=eq.${msgId}`, {
  doc: { ...(before.json?.[0]?.doc || {}), reactions: { pray: [malloryId] } },
  updated_at: now(),
})
check = await aliceApi('GET', `aihub_messages?id=eq.${msgId}&select=doc`)
record('a member CAN still react to another member’s message',
  check.json?.[0]?.doc?.reactions?.pray?.includes(malloryId) === true,
  `status ${r.status}`)

// 7. Can Mallory read the moderation queue? Seed a real report first — an
//    empty table answers 200 with [] and looks like a denial when it is not.
const reportId = uuid()
r = await aliceApi('POST', 'aihub_reports', {
  id: reportId, message_id: msgId, reporter_id: aliceId,
  created_at: now(), updated_at: now(),
  doc: { id: reportId, messageId: msgId, reporterId: aliceId, reason: 'test', createdAt: now() },
// Reports are insert-for-me / select-for-moderators. Asking for the row back
// makes PostgREST run INSERT ... RETURNING, and the RETURNING is a SELECT the
// reporter is not allowed to perform — so a legitimate report fails with a
// misleading "violates row-level security policy". Clients must not request
// representation on this table.
}, { Prefer: 'return=minimal' })
const seeded = r.status < 300
const seedStatus = r.status
const seedBody = JSON.stringify(r.json || {}).slice(0, 160)
r = await malloryApi('GET', 'aihub_reports?select=id')
record('a non-moderator cannot read the reports queue',
  seeded && (r.status >= 300 || (r.json || []).length === 0),
  seeded ? `status ${r.status}, rows ${(r.json || []).length}` : `INCONCLUSIVE: seeding a report returned ${seedStatus} ${seedBody}`)

console.log('')
const broken = results.filter(x => !x.held)
console.log(broken.length ? `${broken.length} POLICY FAILURES: ${broken.map(b => b.name).join(' | ')}`
                          : 'every policy held')
process.exit(broken.length ? 1 : 0)
