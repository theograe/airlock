import { createServer as createHttpServer } from 'http'
import { createServer as createHttpsServer } from 'https'
import { readFileSync } from 'fs'
import type { AirlockConfig, ApprovalRequest } from './types.js'
import { TelegramBot } from './telegram.js'
import { Store } from './store.js'
import { hashContent, verifyHash, generateId } from './crypto.js'

export function startAirlock(config: AirlockConfig) {
  const bot = new TelegramBot(config.botToken)
  const store = new Store(config.dataDir)

  // --- HTTP server for agent queue (localhost only) ---
  const queueServer = createHttpServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/queue') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString())

      const { type, text, context, metadata } = body
      if (!type) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'type required' }))
        return
      }

      const id = generateId()
      const pending: ApprovalRequest = {
        id, type, text, context, metadata,
        hash: hashContent(config.secret, { type, text, metadata }),
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await store.save(pending)

      // Send Telegram approval to all allowed users
      for (const userId of config.allowedUsers) {
        await bot.sendApproval(userId, pending)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id, status: 'pending' }))
      return
    }

    if (req.method === 'GET' && req.url === '/pending') {
      const items = await store.listPending()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ pending: items }))
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.writeHead(404)
    res.end()
  })

  // --- HTTPS server for Telegram webhook callbacks ---
  const webhookServer = createHttpsServer(
    {
      cert: readFileSync(config.certPath),
      key: readFileSync(config.keyPath),
    },
    async (req, res) => {
      if (req.method === 'POST' && req.url === '/webhook') {
        // Verify webhook secret header
        if (config.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const body = JSON.parse(Buffer.concat(chunks).toString())

        const parsed = TelegramBot.parseCallback(body)
        if (!parsed) {
          res.writeHead(400)
          res.end('Invalid callback')
          return
        }

        const { action, id, callback } = parsed

        // Check allowed user
        if (!config.allowedUsers.includes(String(callback.from.id))) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized user' }))
          return
        }

        // Verify callback is real with Telegram API
        const label = action === 'approve' ? 'Approved!' : 'Rejected.'
        const verified = await bot.verifyCallback(callback.id, label)
        if (!verified) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Callback verification failed' }))
          return
        }

        // Load pending request
        const pending = await store.get(id)
        if (!pending) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
          return
        }

        if (pending.status !== 'pending') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Already ${pending.status}` }))
          return
        }

        // Verify content hasn't been tampered with
        if (!verifyHash(config.secret, pending)) {
          const chatId = callback.message?.chat?.id
          if (chatId) await bot.sendMessage(String(chatId), 'Rejected - content was modified after queuing.')
          await store.resolve(id, 'rejected', { error: 'tamper detected' })
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Content tampered' }))
          return
        }

        const chatId = callback.message?.chat?.id

        if (action === 'reject') {
          await store.resolve(id, 'rejected')
          if (chatId) await bot.sendMessage(String(chatId), 'Rejected and deleted.')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'rejected' }))
          return
        }

        // Execute the action
        const executor = config.executors[pending.type]
        if (!executor) {
          if (chatId) await bot.sendMessage(String(chatId), `No executor for type "${pending.type}".`)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `No executor for type: ${pending.type}` }))
          return
        }

        try {
          const result = await executor(pending)
          await store.resolve(id, 'approved', result.data)
          if (chatId) await bot.sendMessage(String(chatId), result.message || 'Approved and executed.')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'approved', ...result }))
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          if (chatId) await bot.sendMessage(String(chatId), `Execution failed: ${errMsg}`)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: errMsg }))
        }
        return
      }

      res.writeHead(404)
      res.end()
    }
  )

  queueServer.listen(config.queuePort, '127.0.0.1', () => {
    console.log(`  Queue server: http://127.0.0.1:${config.queuePort}/queue`)
  })

  webhookServer.listen(config.webhookPort, () => {
    console.log(`  Webhook server: https://0.0.0.0:${config.webhookPort}/webhook`)
  })

  return { queueServer, webhookServer, bot, store }
}
