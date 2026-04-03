import { createServer as createHttpServer } from 'http'
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

  // --- Poll Telegram for callback queries ---
  let offset = 0
  let polling = true

  async function poll() {
    while (polling) {
      try {
        const updates = await bot.getUpdates(offset, 30)

        for (const update of updates) {
          offset = update.update_id + 1

          const parsed = TelegramBot.parseCallback(update)
          if (!parsed) continue

          const { action, id, callback } = parsed

          // Check allowed user
          if (!config.allowedUsers.includes(String(callback.from.id))) {
            await bot.verifyCallback(callback.id, 'Unauthorized')
            continue
          }

          // Verify callback is real
          const label = action === 'approve' ? 'Approved!' : 'Rejected.'
          const verified = await bot.verifyCallback(callback.id, label)
          if (!verified) continue

          // Load pending request
          const pending = await store.get(id)
          if (!pending || pending.status !== 'pending') continue

          // Verify content hasn't been tampered with
          if (!verifyHash(config.secret, pending)) {
            const chatId = callback.message?.chat?.id
            if (chatId) await bot.sendMessage(String(chatId), 'Rejected - content was modified after queuing.')
            await store.resolve(id, 'rejected', { error: 'tamper detected' })
            continue
          }

          const chatId = callback.message?.chat?.id

          if (action === 'reject') {
            await store.resolve(id, 'rejected')
            if (chatId) await bot.sendMessage(String(chatId), 'Rejected and deleted.')
            continue
          }

          // Execute
          const executor = config.executors[pending.type]
          if (!executor) {
            if (chatId) await bot.sendMessage(String(chatId), `No executor for type "${pending.type}".`)
            continue
          }

          try {
            const result = await executor(pending)
            await store.resolve(id, 'approved', result.data)
            if (chatId) await bot.sendMessage(String(chatId), result.message || 'Approved.')
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            if (chatId) await bot.sendMessage(String(chatId), `Execution failed: ${errMsg}`)
          }
        }
      } catch (err) {
        // Network error - wait and retry
        await new Promise(r => setTimeout(r, 5000))
      }
    }
  }

  queueServer.listen(config.queuePort, '127.0.0.1', () => {
    console.log(`  Queue server: http://127.0.0.1:${config.queuePort}/queue`)
  })

  // Clear any existing webhook and start polling
  bot.deleteWebhook().then(() => {
    console.log('  Telegram: polling for approvals')
    poll()
  })

  return {
    queueServer, bot, store,
    stop: () => { polling = false; queueServer.close() },
  }
}
