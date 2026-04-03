/**
 * Example: Protect X/Twitter API with airlock
 *
 * Your AI agent can read timelines and search freely,
 * but tweets, retweets, replies, and DMs require your approval.
 */
import { startAirlock, type AirlockConfig } from '../src/index.js'

const X_TOKEN = process.env.X_OAUTH2_TOKEN!

async function xApi(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.x.com/2${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${X_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

const config: AirlockConfig = {
  botToken: process.env.AIRLOCK_BOT_TOKEN!,
  secret: process.env.AIRLOCK_SECRET!,
  webhookSecret: process.env.AIRLOCK_WEBHOOK_SECRET!,
  allowedUsers: [process.env.TELEGRAM_USER_ID!],
  publicHost: process.env.PUBLIC_IP!,
  webhookPort: 8443,
  queuePort: 4444,
  certPath: '.airlock/certs/webhook.pem',
  keyPath: '.airlock/certs/webhook.key',
  dataDir: '.airlock/data',

  executors: {
    tweet: async (data) => {
      const result = await xApi('/tweets', { text: data.text })
      return { success: true, message: `Posted: https://x.com/i/status/${result.data?.id}`, data: result }
    },

    retweet: async (data) => {
      const userId = data.metadata?.user_id as string
      const result = await xApi(`/users/${userId}/retweets`, { tweet_id: data.metadata?.tweet_id })
      return { success: true, message: 'Retweeted', data: result }
    },

    reply: async (data) => {
      const result = await xApi('/tweets', {
        text: data.text,
        reply: { in_reply_to_tweet_id: data.metadata?.tweet_id },
      })
      return { success: true, message: `Replied: https://x.com/i/status/${result.data?.id}`, data: result }
    },

    dm: async (data) => {
      const recipientId = data.metadata?.recipient_id as string
      const result = await xApi(`/dm_conversations/with/${recipientId}/messages`, { text: data.text })
      return { success: true, message: 'DM sent', data: result }
    },
  },
}

startAirlock(config)
