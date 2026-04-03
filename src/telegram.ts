import type { ApprovalRequest, TelegramCallbackQuery } from './types.js'

export class TelegramBot {
  private api: string

  constructor(private token: string) {
    this.api = `https://api.telegram.org/bot${token}`
  }

  /** Build a human-readable message for the approval request */
  private buildMessage(req: ApprovalRequest): string {
    const lines: string[] = []
    const label = req.type.toUpperCase()

    lines.push(`[${label}]`)

    if (req.text) lines.push('', req.text)

    if (req.metadata) {
      for (const [k, v] of Object.entries(req.metadata)) {
        if (v && k !== 'type') lines.push(`${k}: ${v}`)
      }
    }

    if (req.context) lines.push('', `Agent: ${req.context}`)

    lines.push('', `ID: ${req.id}`)
    return lines.join('\n')
  }

  /** Send an approval message with approve/reject buttons */
  async sendApproval(chatId: string, req: ApprovalRequest): Promise<boolean> {
    const msg = this.buildMessage(req)

    const res = await fetch(`${this.api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        reply_markup: {
          inline_keyboard: [[
            { text: '\u2705 Approve', callback_data: `approve:${req.id}` },
            { text: '\u274c Reject', callback_data: `reject:${req.id}` },
          ]],
        },
      }),
    })

    const data = await res.json() as { ok: boolean }
    return data.ok
  }

  /** Send a plain text message */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await fetch(`${this.api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    }).catch(() => {})
  }

  /** Verify a callback query is real by answering it via Telegram API */
  async verifyCallback(callbackId: string, text: string): Promise<boolean> {
    const res = await fetch(`${this.api}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text }),
    })
    const data = await res.json() as { ok: boolean }
    return data.ok
  }

  /** Register a webhook with Telegram using a self-signed cert */
  async setWebhook(url: string, certPath: string, webhookSecret: string): Promise<boolean> {
    const { readFileSync } = await import('fs')
    const cert = readFileSync(certPath)

    const formData = new FormData()
    formData.append('url', url)
    formData.append('certificate', new Blob([cert]), 'cert.pem')
    formData.append('allowed_updates', '["callback_query"]')
    if (webhookSecret) formData.append('secret_token', webhookSecret)

    const res = await fetch(`${this.api}/setWebhook`, {
      method: 'POST',
      body: formData,
    })
    const data = await res.json() as { ok: boolean; description?: string }
    return data.ok
  }

  /** Get current webhook info */
  async getWebhookInfo(): Promise<{ url: string; has_custom_certificate: boolean; pending_update_count: number }> {
    const res = await fetch(`${this.api}/getWebhookInfo`)
    const data = await res.json() as { result: { url: string; has_custom_certificate: boolean; pending_update_count: number } }
    return data.result
  }

  /** Parse a callback query from webhook body */
  static parseCallback(body: Record<string, unknown>): { action: string; id: string; callback: TelegramCallbackQuery } | null {
    const cq = body.callback_query as TelegramCallbackQuery | undefined
    if (!cq?.data) return null

    const [action, id] = cq.data.split(':')
    if (!id || !['approve', 'reject'].includes(action)) return null

    return { action, id, callback: cq }
  }
}
