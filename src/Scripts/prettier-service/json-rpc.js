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

/**
 * @typedef {{ headers: Map<string,string>, body: any }} JsonRpcFrame
 */
/** @extends Transform<Buffer, JsonRpcFrame> */
class JsonRpcParser extends Transform {
  constructor() {
    super({ readableObjectMode: true })
    // buffer-of-buffers strategy
    this.buffers = [] // raw Buffer chunks
    this.bytesBuffered = 0 // total bytes across all chunks
    this.buffer = Buffer.alloc(0) // always-safe alias for toString()/slice()
  }

  _transform(chunk, encoding, callback) {
    // 1) stash the new chunk
    this.buffers.push(chunk)
    this.bytesBuffered += chunk.length

    // 2) if we’re over threshold, collapse into one Buffer; otherwise
    //    rebuild the full Buffer so we never lose data across buffers
    if (this.bytesBuffered > 64 * 1024) {
      this.buffer = Buffer.concat(this.buffers, this.bytesBuffered)
      this.buffers = [this.buffer]
      this.bytesBuffered = this.buffer.length
    } else {
      // cheap for small sizes: always re-concat so this.buffer includes all bytes
      this.buffer = Buffer.concat(this.buffers, this.bytesBuffered)
    }

    // Keep extracting messages while we have a full header+body
    while (true) {
      // 1. Turn buffered bytes into ASCII text once
      const bufStr = this.buffer.toString('ascii')

      // 2. Find either "\r\n\r\n" or "\n\n"
      const hdrSplit = bufStr.match(/\r?\n\r?\n/)
      if (!hdrSplit) break // no full header yet

      const sep = hdrSplit.index // position where headers end
      const delimLen = hdrSplit[0].length // either 4 ("\r\n\r\n") or 2 ("\n\n")

      // 3. Extract header text and parse it as before
      const headerText = bufStr.slice(0, sep)
      const headers = new Map(
        headerText.split(/\r?\n/).map((line) => {
          const [name, ...rest] = line.split(':')
          return [name.toLowerCase(), rest.join(':').trim()]
        }),
      )

      // 4. Pull out content-length
      const len = parseInt(headers.get('content-length'), 10)
      if (isNaN(len) || len > MAX_CONTENT_LENGTH) {
        const err = new Error(`Frame too large: ${len} bytes`)
        this.push({ error: PARSE_ERROR, id: null })
        return callback(err)
      }

      // 5. Wait until full body is buffered
      if (this.buffer.length < sep + delimLen + len) break

      // 6. Slice out the body using the dynamic delimiter length
      const bodyBuf = this.buffer.slice(sep + delimLen, sep + delimLen + len)
      let body
      try {
        body = JSON.parse(bodyBuf.toString('utf8'))
      } catch {
        this.push({ error: PARSE_ERROR, id: null })
        this.buffer = this.buffer.slice(sep + delimLen + len)
        continue
      }

      // 7. Push the parsed frame and remove it from the buffer
      this.push({ headers, body })
      this.buffer = this.buffer.slice(sep + delimLen + len)
    }

    // Sync up the buffers array to only the unparsed remainder
    this.buffers = [this.buffer]
    this.bytesBuffered = this.buffer.length

    callback()
  }
}

class JsonRpcService {
  /**
   * @param {import('stream').Readable} readStream
   * @param {import('stream').Writable} writeStream
   * @param {{logger?(…args:any[]):void}} [options]
   */
  constructor(readStream, writeStream, { logger = console } = {}) {
    this.writeStream = writeStream
    this.logger = logger
    this.handlers = new Map()
    this.parser = new JsonRpcParser()

    // Pipe incoming bytes into our parser
    readStream
      .pipe(this.parser)
      .on('error', (err) => {
        // unexpected parse crash → internal error response
        this._writePayload({ jsonrpc: '2.0', error: INTERNAL_ERROR, id: null })
        this.logger.error('Parser error', err)
      })
      .on('data', (frame) => {
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
      // [] is invalid per JSON-RPC 2.0 §4.3
      if (req.length === 0) {
        await this._writePayload({
          jsonrpc: '2.0',
          error: INVALID_REQUEST,
          id: null,
        })
        return
      }
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
      // if handler threw a JSON-RPC error object, pass it through
      const errObj =
        err && typeof err.code === 'number' && err.message
          ? err
          : typeof err === 'string'
            ? { code: INTERNAL_ERROR.code, message: err }
            : {
                code: INTERNAL_ERROR.code,
                message: err.message,
                data: err.stack,
              }

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
