#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { createInterface } from 'readline'
import { generateSecret } from '../crypto.js'

const AIRLOCK_DIR = path.join(process.cwd(), '.airlock')
const CONFIG_FILE = path.join(process.cwd(), 'airlock.config.ts')

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

async function init() {
  console.log('\n  airlock init\n')

  mkdirSync(path.join(AIRLOCK_DIR, 'data', 'pending'), { recursive: true })
  mkdirSync(path.join(AIRLOCK_DIR, 'data', 'done'), { recursive: true })

  const botToken = await ask('  Telegram bot token (from @BotFather): ')
  const userId = await ask('  Your Telegram user ID: ')
  const queuePort = await ask('  Queue port [4444]: ') || '4444'

  const secret = generateSecret()

  // Verify bot token works
  console.log('\n  Verifying bot token...')
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
    const data = await res.json() as { ok: boolean; result?: { username: string } }
    if (data.ok) {
      console.log(`  Bot: @${data.result?.username}`)
    } else {
      console.log('  Warning: Bot token may be invalid')
    }
  } catch {
    console.log('  Warning: Could not verify bot token')
  }

  // Send a test message
  console.log('  Sending test message...')
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, text: 'airlock connected.' }),
    })
    const data = await res.json() as { ok: boolean }
    if (data.ok) {
      console.log('  Test message sent - check Telegram')
    } else {
      console.log('  Warning: Could not send test message. Make sure you\'ve messaged the bot first.')
    }
  } catch {
    console.log('  Warning: Could not send test message')
  }

  const envContent = [
    `AIRLOCK_BOT_TOKEN=${botToken}`,
    `AIRLOCK_SECRET=${secret}`,
    `AIRLOCK_ALLOWED_USERS=${userId}`,
    `AIRLOCK_QUEUE_PORT=${queuePort}`,
    `AIRLOCK_DATA_DIR=${AIRLOCK_DIR}/data`,
  ].join('\n')

  writeFileSync(path.join(AIRLOCK_DIR, '.env'), envContent)

  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, `import { type AirlockConfig } from 'agent-airlock'

const config: AirlockConfig = {
  botToken: process.env.AIRLOCK_BOT_TOKEN!,
  secret: process.env.AIRLOCK_SECRET!,
  allowedUsers: (process.env.AIRLOCK_ALLOWED_USERS || '').split(','),
  queuePort: parseInt(process.env.AIRLOCK_QUEUE_PORT || '${queuePort}'),
  dataDir: process.env.AIRLOCK_DATA_DIR || '.airlock/data',

  executors: {
    // Define what happens when each action type is approved.
    // Example:
    //
    // tweet: async (data) => {
    //   const res = await fetch('https://api.x.com/2/tweets', {
    //     method: 'POST',
    //     headers: { Authorization: \`Bearer \${process.env.X_TOKEN}\`, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ text: data.text }),
    //   })
    //   return { success: res.ok, message: 'Tweet posted' }
    // },
  },
}

export default config
`)
  }

  console.log(`
  airlock initialized.

  Files:
    .airlock/.env       secrets (add to .gitignore)
    .airlock/data/      pending and resolved approvals
    airlock.config.ts   define your executors here

  Next steps:
    1. Edit airlock.config.ts to add your executors
    2. Add .airlock to .gitignore
    3. Run: npx agent-airlock start

  Your agent queues actions with:
    curl -X POST http://localhost:${queuePort}/queue \\
      -H "Content-Type: application/json" \\
      -d '{"type":"tweet","text":"hello world","context":"why"}'
`)
}

async function start() {
  const envPath = path.join(AIRLOCK_DIR, '.env')
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const [key, ...rest] = line.split('=')
      if (key && rest.length) process.env[key] = rest.join('=')
    }
  }

  let config
  try {
    const mod = await import(path.resolve(CONFIG_FILE))
    config = mod.default
  } catch {
    console.error('  Could not load airlock.config.ts. Run "airlock init" first.')
    process.exit(1)
  }

  console.log('\n  airlock starting...\n')

  const { startAirlock } = await import('../server.js')
  startAirlock(config)

  console.log('\n  airlock is running. Press Ctrl+C to stop.\n')
}

async function status() {
  const envPath = path.join(AIRLOCK_DIR, '.env')
  if (!existsSync(envPath)) {
    console.log('  airlock not initialized. Run "airlock init" first.')
    return
  }

  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && rest.length) process.env[key] = rest.join('=')
  }

  const { Store } = await import('../store.js')
  const store = new Store(process.env.AIRLOCK_DATA_DIR || '.airlock/data')
  const pending = await store.listPending()

  console.log(`
  airlock status

  Queue port: ${process.env.AIRLOCK_QUEUE_PORT || '4444'}
  Pending approvals: ${pending.length}
  Allowed users: ${process.env.AIRLOCK_ALLOWED_USERS || '(none)'}
`)
}

const command = process.argv[2]

switch (command) {
  case 'init': await init(); break
  case 'start': await start(); break
  case 'status': await status(); break
  default:
    console.log(`
  airlock - human approval gate for AI agent actions

  Usage:
    airlock init     Set up bot and config
    airlock start    Start the approval server
    airlock status   Check pending approvals
`)
}
