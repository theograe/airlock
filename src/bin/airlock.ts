#!/usr/bin/env node
import { execSync } from 'child_process'
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

  // Create .airlock directory
  mkdirSync(path.join(AIRLOCK_DIR, 'data', 'pending'), { recursive: true })
  mkdirSync(path.join(AIRLOCK_DIR, 'data', 'done'), { recursive: true })
  mkdirSync(path.join(AIRLOCK_DIR, 'certs'), { recursive: true })

  // Get info
  const botToken = await ask('  Telegram bot token (from @BotFather): ')
  const userId = await ask('  Your Telegram user ID: ')
  const publicIp = await ask('  Server public IP: ')
  const webhookPort = await ask('  Webhook port [8443]: ') || '8443'
  const queuePort = await ask('  Queue port [4444]: ') || '4444'

  // Generate secrets
  const secret = generateSecret()
  const webhookSecret = generateSecret()

  // Generate self-signed cert
  console.log('\n  Generating self-signed certificate...')
  execSync(
    `openssl req -newkey rsa:2048 -sha256 -nodes ` +
    `-keyout ${AIRLOCK_DIR}/certs/webhook.key ` +
    `-x509 -days 3650 ` +
    `-out ${AIRLOCK_DIR}/certs/webhook.pem ` +
    `-subj "/CN=${publicIp}" ` +
    `-addext "subjectAltName=IP:${publicIp}"`,
    { stdio: 'pipe' }
  )

  // Write env file
  const envContent = [
    `AIRLOCK_BOT_TOKEN=${botToken}`,
    `AIRLOCK_SECRET=${secret}`,
    `AIRLOCK_WEBHOOK_SECRET=${webhookSecret}`,
    `AIRLOCK_ALLOWED_USERS=${userId}`,
    `AIRLOCK_PUBLIC_HOST=${publicIp}`,
    `AIRLOCK_WEBHOOK_PORT=${webhookPort}`,
    `AIRLOCK_QUEUE_PORT=${queuePort}`,
    `AIRLOCK_CERT_PATH=${AIRLOCK_DIR}/certs/webhook.pem`,
    `AIRLOCK_KEY_PATH=${AIRLOCK_DIR}/certs/webhook.key`,
    `AIRLOCK_DATA_DIR=${AIRLOCK_DIR}/data`,
  ].join('\n')

  writeFileSync(path.join(AIRLOCK_DIR, '.env'), envContent)

  // Write example config
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, `import { type AirlockConfig } from 'airlock'

const config: AirlockConfig = {
  botToken: process.env.AIRLOCK_BOT_TOKEN!,
  secret: process.env.AIRLOCK_SECRET!,
  webhookSecret: process.env.AIRLOCK_WEBHOOK_SECRET!,
  allowedUsers: (process.env.AIRLOCK_ALLOWED_USERS || '').split(','),
  publicHost: process.env.AIRLOCK_PUBLIC_HOST || '0.0.0.0',
  webhookPort: parseInt(process.env.AIRLOCK_WEBHOOK_PORT || '${webhookPort}'),
  queuePort: parseInt(process.env.AIRLOCK_QUEUE_PORT || '${queuePort}'),
  certPath: process.env.AIRLOCK_CERT_PATH || '.airlock/certs/webhook.pem',
  keyPath: process.env.AIRLOCK_KEY_PATH || '.airlock/certs/webhook.key',
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

  // Register webhook with Telegram
  console.log('  Registering Telegram webhook...')
  const certPem = readFileSync(`${AIRLOCK_DIR}/certs/webhook.pem`)
  const webhookUrl = `https://${publicIp}:${webhookPort}/webhook`

  const form = new FormData()
  form.append('url', webhookUrl)
  form.append('certificate', new Blob([certPem]), 'cert.pem')
  form.append('allowed_updates', '["callback_query"]')
  form.append('secret_token', webhookSecret)

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    body: form,
  })
  const result = await res.json() as { ok: boolean; description?: string }

  if (result.ok) {
    console.log(`  Webhook registered: ${webhookUrl}`)
  } else {
    console.log(`  Webhook registration failed: ${result.description}`)
  }

  console.log(`
  airlock initialized.

  Files:
    .airlock/.env             - secrets (add to .gitignore)
    .airlock/certs/           - self-signed cert for webhook
    .airlock/data/            - pending and resolved approvals
    airlock.config.ts         - define your executors here

  Next steps:
    1. Edit airlock.config.ts to add your executors
    2. Add .airlock to .gitignore
    3. Run: npx airlock start

  Your agent queues actions with:
    curl -X POST http://localhost:${queuePort}/queue \\
      -H "Content-Type: application/json" \\
      -d '{"type":"tweet","text":"hello world","context":"why"}'
`)
}

async function start() {
  // Load .env
  const envPath = path.join(AIRLOCK_DIR, '.env')
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const [key, ...rest] = line.split('=')
      if (key && rest.length) process.env[key] = rest.join('=')
    }
  }

  // Load config
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
  const { bot } = startAirlock(config)

  // Verify webhook is set
  const info = await bot.getWebhookInfo()
  if (info.url) {
    console.log(`  Telegram webhook: ${info.url}`)
  } else {
    console.log('  Warning: No Telegram webhook set. Run "airlock init" to configure.')
  }

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

  const { TelegramBot } = await import('../telegram.js')
  const bot = new TelegramBot(process.env.AIRLOCK_BOT_TOKEN!)
  const info = await bot.getWebhookInfo()

  console.log(`
  airlock status

  Webhook URL: ${info.url || '(not set)'}
  Custom cert: ${info.has_custom_certificate}
  Pending updates: ${info.pending_update_count}
  Queue port: ${process.env.AIRLOCK_QUEUE_PORT || '4444'}
  Webhook port: ${process.env.AIRLOCK_WEBHOOK_PORT || '8443'}
`)
}

// CLI routing
const command = process.argv[2]

switch (command) {
  case 'init': await init(); break
  case 'start': await start(); break
  case 'status': await status(); break
  default:
    console.log(`
  airlock - human approval gate for AI agent actions

  Usage:
    airlock init     Set up bot, certs, and webhook
    airlock start    Start the queue + webhook servers
    airlock status   Check webhook and server status
`)
}
