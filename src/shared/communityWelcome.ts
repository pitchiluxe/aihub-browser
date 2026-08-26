/**
 * The first thing in every room.
 *
 * An empty channel is the single most reliable way to lose someone: they open
 * Community, see seven rooms with nothing in them, and close it. So each room
 * opens with a message that does three jobs — says what belongs here, names
 * what does not, and asks one question a newcomer can actually answer.
 *
 * These are written, not generated. A welcome is the room's own voice and it
 * has to be the same for everybody; a model would write seven different
 * greetings on seven machines and none of them would be the room's. The AI
 * host writes the *later* prompts, once there is a conversation to build on.
 *
 * Posted by the system member, which is why they carry no author handle of
 * their own — see BOT_MEMBER_ID in shared/communityBot.
 *
 * Plain text, deliberately. Chat bodies render literally — there is no
 * markdown pass over a message — so a bolded lead line arrives in the room
 * with its asterisks showing, which is exactly how the first version shipped.
 * The opening line carries the emphasis by being the opening line.
 */

export interface WelcomeMessage {
  /** Channel slug this opens. */
  channel: string
  /** The message body. Plain text — chat bodies are not run through markdown,
   *  so any syntax written here shows up literally in the room. */
  body: string
}

/**
 * One opening message per shipped channel.
 *
 * Deliberately short. A wall of text at the top of an empty room reads as
 * terms and conditions, and the point is to make the room feel occupied
 * enough that writing the second message is not intimidating.
 */
export const WELCOME_MESSAGES: WelcomeMessage[] = [
  {
    channel: 'announcements',
    body: [
      'This is where changes get posted.',
      '',
      'New channels, new features, anything that changes how the community works.',
      'Only the owner posts here, so it stays short and worth reading.',
    ].join('\n'),
  },
  {
    channel: 'general',
    body: [
      'Everything that does not have a room of its own.',
      '',
      'Introductions, questions, whatever you are working on today.',
      'If a topic keeps coming up here it probably deserves its own channel — say so and it can have one.',
      '',
      'Start simple: what brought you to AIHub?',
    ].join('\n'),
  },
  {
    channel: 'support',
    body: [
      'Something broken? Ask here.',
      '',
      'Useful things to include: what you were doing, what you expected, and what happened instead.',
      'Your AIHub version is at the bottom of the sidebar.',
    ].join('\n'),
  },
  {
    channel: 'random',
    body: [
      'No topic. That is the topic.',
      '',
      'The room for the thing that did not fit anywhere else.',
    ].join('\n'),
  },
  {
    channel: 'developers',
    body: [
      'Prompts, models, and what is actually working.',
      '',
      'Paste code straight into the composer — it is syntax highlighted, and it is never executed by anyone who reads it.',
      'What matters most here is the boring detail: which model, which settings, and what it cost you.',
      '',
      'What is the last prompt that worked better than you expected?',
    ].join('\n'),
  },
  {
    channel: 'cybersecurity',
    body: [
      'Defence, privacy, and staying safe online.',
      '',
      'Hardening, phishing you nearly fell for, settings worth changing, breaches worth knowing about.',
      '',
      'Not here: working exploits, live targets, or anything aimed at a system you do not own.',
      '',
      'What is one setting you would tell everybody to change today?',
    ].join('\n'),
  },
  {
    channel: 'ai',
    body: [
      'Where AI is going, and what it is like to use.',
      '',
      'Models, tools, what you have automated, and what stubbornly refuses to work.',
      '',
      'What have you handed over to a model that you used to do by hand?',
    ].join('\n'),
  },
  {
    channel: 'technology',
    body: [
      'Hardware, software, and the things in between.',
      '',
      'What you are running, what you are replacing, and what turned out not to be worth it.',
    ].join('\n'),
  },
  {
    channel: 'cloud',
    body: [
      'Deploys, bills, and outages.',
      '',
      'Providers, architecture, and the invoice that arrived larger than expected.',
      '',
      'What is running your side projects right now, and what does it cost you a month?',
    ].join('\n'),
  },
  {
    channel: 'networking',
    body: [
      'Getting packets from here to there.',
      '',
      'Home labs, routers, VPNs, DNS, and the outage that turned out to be DNS.',
    ].join('\n'),
  },
  {
    channel: 'bible-study',
    body: [
      'Welcome. Come as you are.',
      '',
      'Share a verse straight from the Bible reader and it arrives here as a card anyone can open and read in full.',
      'Prayer requests can be posted anonymously — your name is hidden from the room, though the request itself is public.',
      '',
      'Whoever is reading this: you are welcome here, wherever you are with God today.',
      '',
      'What has been on your heart this week?',
    ].join('\n'),
  },
  {
    channel: 'traders',
    body: [
      'Forex, crypto, and the stock market.',
      '',
      'Setups, journals, risk, and the trade that taught you something.',
      '',
      'Nobody here is a licensed advisor, nothing posted is advice, and anyone promising guaranteed returns is selling something.',
    ].join('\n'),
  },
  {
    channel: 'sports',
    body: [
      'Matches, results, and the arguments in between.',
      '',
      'Who are you watching this week?',
    ].join('\n'),
  },
  {
    channel: 'entertainment',
    body: [
      'Music, film, and what is worth your evening.',
      '',
      'What is the last thing you finished and immediately told somebody about?',
    ].join('\n'),
  },
  {
    channel: 'jobs',
    body: [
      'Openings, referrals, and hiring.',
      '',
      'Posting a role? Include the pay range and whether it is remote. A post without either gets ignored, here as everywhere.',
      'Looking? Say what you do and what you want next.',
    ].join('\n'),
  },
]

export function welcomeFor(slug: string): WelcomeMessage | undefined {
  return WELCOME_MESSAGES.find(w => w.channel === slug)
}
