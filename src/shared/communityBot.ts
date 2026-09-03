/**
 * The community's own voice.
 *
 * One member id, fixed, shared by every install. It has to be a constant
 * rather than something minted per machine: the bot's messages replicate like
 * any other, and if each device invented its own bot id the room would fill
 * with several indistinguishable guides all talking at once.
 *
 * ── Why exactly one machine speaks for it ─────────────────────────────────
 *
 * Ollama runs locally, per person. "The AI posts to the channel" therefore
 * means *every* member's AI posts — ten people, ten near-identical articles
 * every morning, each written by a different model, some by no model at all.
 * A shared room needs a single voice, so only the community owner's install
 * ever writes as the bot. Everyone else's Ollama stays theirs.
 */

/**
 * A nil-prefixed UUID: unmistakably reserved, and — the part that matters —
 * actually parseable as one.
 *
 * The first version read `0000a1hub0b0`, which spells something at the cost of
 * `h` and `u` not being hex digits. Postgres refused every row that referenced
 * it with `invalid input syntax for type uuid`, and because the push queue
 * retries forever and drains in table order, that one bad id stopped every
 * message on the machine from replicating in either direction.
 *
 * `b07` is as close to a joke as a uuid column permits.
 */
export const BOT_MEMBER_ID = '00000000-0000-4000-8000-000000000b07'

export const BOT_HANDLE = 'AIHub Guide'

/** What the bot is for, shown wherever a member profile is shown. */
export const BOT_BIO =
  'Writes the opening message in each room and keeps an eye on things. Runs on the owner’s machine.'

export function isBot(memberId: string | undefined | null): boolean {
  return memberId === BOT_MEMBER_ID
}

/**
 * How often the guide may post into one channel, at most.
 *
 * Four hours, and only when the room has been quiet. A bot that posts on a
 * timer regardless of what people are doing is a bot that talks over them,
 * and the fastest way to make a room feel automated rather than inhabited.
 */
export const BOT_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * How quiet a channel must be before the guide speaks.
 *
 * The guide exists to break silence, not to join a conversation. If somebody
 * posted in the last hour the room does not need prompting.
 */
export const BOT_QUIET_BEFORE_MS = 60 * 60 * 1000

/** Hard ceiling on a generated post. Long enough for a real thought, short
 *  enough that nobody scrolls past the whole room to get by it. */
export const BOT_MAX_CHARS = 900
