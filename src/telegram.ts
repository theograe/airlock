import type { ApprovalRequest, TelegramCallbackQuery } from './types.js'

export class TelegramBot {
  private api: string

  constructor(private token: string) {
    this.api = `https://api.telegram.org/bot${token}`
  }

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

  async sendMessage(chatId: string, text: string): Promise<void> {
    await fetch(`${this.api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    }).catch(() => {})
  }

  async verifyCallback(callbackId: string, text: string): Promise<boolean> {
    const res = await fetch(`${this.api}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text }),
    })
    const data = await res.json() as { ok: boolean }
    return data.ok
  }

  async getUpdates(offset: number, timeout: number): Promise<Array<{ update_id: number; callback_query?: TelegramCallbackQuery }>> {
    const res = await fetch(
      `${this.api}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=["callback_query"]`,
      { signal: AbortSignal.timeout((timeout + 5) * 1000) }
    )
    const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; callback_query?: TelegramCallbackQuery }> }
    return data.result || []
  }

  async deleteWebhook(): Promise<boolean> {
    const res = await fetch(`${this.api}/deleteWebhook`, { method: 'POST' })
    const data = await res.json() as { ok: boolean }
    return data.ok
  }

  static parseCallback(update: Record<string, unknown>): { action: string; id: string; callback: TelegramCallbackQuery } | null {
    const cq = update.callback_query as TelegramCallbackQuery | undefined
    if (!cq?.data) return null

    const [action, id] = cq.data.split(':')
    if (!id || !['approve', 'reject'].includes(action)) return null

    return { action, id, callback: cq }
  }
}
