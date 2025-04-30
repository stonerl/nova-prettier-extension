/**
 * json-rpc.js — Buffered JSON-RPC 2.0 server using Transform streams
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Implements a spec-compliant, high-throughput JSON-RPC 2.0 server with:
 * - Batch request support
 * - Spec validation (jsonrpc, id types, etc.)
 * - Lower-case header normalization
 * - Parse-error recovery (no process.exit)
 * - Back-pressure support on writeStream
 * - Transform‐stream parser for clean piping
 */

const { Transform } = require('stream')
const { once } = require('events')

const PARSE_ERROR = { code: -32700, message: 'Parse error' }
const INVALID_REQUEST = { code: -32600, message: 'Invalid Request' }
const METHOD_NOT_FOUND = { code: -32601, message: 'Method not found' }
const INTERNAL_ERROR = { code: -32603, message: 'Internal error' }
const MAX_CONTENT_LENGTH = 32 * 1024 * 1024 // 32 MiB

class JsonRpcParser extends Transform {
  constructor() {
    super({ readableObjectMode: true })
    this.buffer = Buffer.alloc(0)
  }

  _transform(chunk, encoding, callback) {
    // Accumulate incoming bytes
    this.buffer = Buffer.concat([
      this.buffer,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    ])

    let sep
    // Keep extracting messages while we have a full header+body
    while ((sep = this.buffer.indexOf('\r\n\r\n')) !== -1) {
      const headerText = this.buffer.toString('ascii', 0, sep)
      const headers = new Map(
        headerText.split('\r\n').map((line) => {
          const [name, ...rest] = line.split(':')
          return [name.toLowerCase(), rest.join(':').trim()]
        }),
      )

      const len = parseInt(headers.get('content-length'), 10)
      // reject missing/invalid or overly large bodies
      if (isNaN(len) || len > MAX_CONTENT_LENGTH) {
        // notify client of parse‐error, then force the channel to error out
        this.push({ error: PARSE_ERROR, id: null })
        this.destroy(new Error(`Frame too large: ${len} bytes`))
        return // stop parsing
      }

      // Wait for full body
      if (this.buffer.length < sep + 4 + len) break

      const bodyBuf = this.buffer.slice(sep + 4, sep + 4 + len)
      let body
      try {
        body = JSON.parse(bodyBuf.toString('utf8'))
      } catch {
        // JSON parse error—notify and drop this message
        this.push({ error: PARSE_ERROR, id: null })
        this.buffer = this.buffer.slice(sep + 4 + len)
        continue
      }

      // Emit a well-formed frame
      this.push({ headers, body })
      this.buffer = this.buffer.slice(sep + 4 + len)
    }

    callback()
  }
}

class JsonRpcService {
  constructor(readStream, writeStream) {
    this.writeStream = writeStream
    this.handlers = new Map()
    this.parser = new JsonRpcParser()

    // Pipe incoming bytes into our parser
    readStream.pipe(this.parser).on('data', (frame) => {
      this._handleFrame(frame).catch((err) => {
        // Fatal internal error
        this._writePayload({
          jsonrpc: '2.0',
          error: INTERNAL_ERROR,
          id: null,
        })
      })
    })
  }

  onRequest(method, handler) {
    this.handlers.set(method, handler)
  }

  async _handleFrame({ error, id, headers, body }) {
    if (error) {
      // Parse error response (id must be null)
      await this._writePayload({
        jsonrpc: '2.0',
        error,
        id: null,
      })
      return
    }

    const req = body

    // Batch requests
    if (Array.isArray(req)) {
      const responses = await Promise.all(req.map((r) => this._process(r)))
      const filtered = responses.filter((r) => r !== null)
      if (filtered.length) {
        await this._writePayload(filtered)
      }
      return
    }

    // Single request or notification
    const resp = await this._process(req)
    if (resp) {
      await this._writePayload(resp)
    }
  }

  async _process(request) {
    const { jsonrpc, method, params, id } = request

    // Spec compliance checks
    const validId =
      id === undefined
        ? true
        : typeof id === 'string' || typeof id === 'number' || id === null

    if (jsonrpc !== '2.0' || typeof method !== 'string' || !validId) {
      return {
        jsonrpc: '2.0',
        error: INVALID_REQUEST,
        id: id !== undefined ? id : null,
      }
    }

    // Notification: no id => no response
    if (id === undefined) return null

    const handler = this.handlers.get(method)
    if (!handler) {
      return {
        jsonrpc: '2.0',
        error: METHOD_NOT_FOUND,
        id,
      }
    }

    try {
      const result = await handler(params)
      return {
        jsonrpc: '2.0',
        result,
        id,
      }
    } catch (err) {
      const errObj =
        typeof err === 'string'
          ? { code: INTERNAL_ERROR.code, message: err }
          : { code: INTERNAL_ERROR.code, message: err.message, data: err.stack }

      return {
        jsonrpc: '2.0',
        error: errObj,
        id,
      }
    }
  }

  async _writePayload(payload) {
    const str = JSON.stringify(payload)
    const buf = Buffer.from(str, 'utf8')
    const hdr = Buffer.from(`Content-Length: ${buf.length}\r\n\r\n`, 'ascii')

    if (!this.writeStream.write(hdr)) {
      await once(this.writeStream, 'drain')
    }
    if (!this.writeStream.write(buf)) {
      await once(this.writeStream, 'drain')
    }
  }

  notify(method, params) {
    // JSON-RPC notifications have no "id"
    return this._writePayload({
      jsonrpc: '2.0',
      method,
      params,
    })
  }

  /** Remove all listeners and handlers so this service can be GC’d */
  dispose() {
    this.parser.removeAllListeners()
    this.handlers.clear()
  }
}

module.exports = JsonRpcService
