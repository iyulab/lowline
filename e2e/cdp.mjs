// A small Chrome DevTools Protocol client for driving the app's WebView2 window.
// Uses Node's built-in WebSocket, so the end-to-end run needs no extra dependency.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits until the debugging endpoint lists a page, and returns its target. */
export async function findPage(port, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page')
      if (page) return page
    } catch (e) {
      lastError = e
    }
    await sleep(250)
  }
  throw new Error(`no page on debugging port ${port} (${lastError?.message ?? 'none listed'})`)
}

export class Cdp {
  #ws
  #nextId = 1
  #pending = new Map()

  static async connect(url) {
    const cdp = new Cdp()
    cdp.#ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener('open', resolve, { once: true })
      cdp.#ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true })
    })
    cdp.#ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const pending = cdp.#pending.get(message.id)
      if (!pending) return
      cdp.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
      else pending.resolve(message.result)
    })
    return cdp
  }

  send(method, params = {}) {
    const id = this.#nextId++
    this.#ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }))
  }

  /** Evaluates `expression` in the page and returns its (awaited) value. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value
  }

  /** Polls `expression` until it returns a truthy value, and returns that value. */
  async waitFor(expression, what, { timeoutMs = 10_000 } = {}) {
    const deadline = Date.now() + timeoutMs
    let lastError
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate(expression)
        if (value) return value
      } catch (e) {
        lastError = e
      }
      await sleep(100)
    }
    throw new Error(`timed out waiting for ${what}${lastError ? ` (${lastError.message})` : ''}`)
  }

  /** Types text into the focused element, as the keyboard's text input would. */
  insertText(text) {
    return this.send('Input.insertText', { text })
  }

  /** Presses one key, with optional modifiers (2 = Ctrl). */
  async press(key, { code = key, modifiers = 0, keyCode } = {}) {
    const base = { key, code, modifiers, windowsVirtualKeyCode: keyCode }
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** Clicks the centre of a box given in page coordinates. */
  async clickAt({ x, y }) {
    const at = { x, y, button: 'left', clickCount: 1 }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at })
  }

  close() {
    this.#ws.close()
  }
}
