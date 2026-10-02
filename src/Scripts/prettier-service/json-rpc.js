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
const RESULT_TOO_LARGE = {
  code: -32000,
  message: 'Formatted result too large to transmit',
}

/**
 * Maximum allowed JSON-RPC frame body in bytes.
 * Prevents malicious or accidental OOM via gigantic Content-Length headers.
 */
const MAX_CONTENT_LENGTH = 42 * 1024 * 1024 // 42 MiB

/**
 * @typedef {{ headers: Map<string,string>, body: any }} JsonRpcFrame
 */
/** @extends Transform<Buffer, JsonRpcFrame> */
class JsonRpcParser extends Transform {
  constructor() {
    super({ readableObjectMode: true })

    /**
     * @type {Buffer[]} raw incoming chunks
     * @private
     */
    this.buffers = []

    /**
     * Total byte length of all chunks in `this.buffers`
     * @private
     */
    this.bytesBuffered = 0

    /**
     * Remaining body bytes of an oversize frame to drop. Frames whose
     * declared Content-Length exceeds MAX_CONTENT_LENGTH are skipped
     * (no response possible — the body is never parsed) instead of
     * erroring the stream, so the service keeps reading subsequent
     * frames. The client-side transport guard makes this path
     * unreachable for our own requests; it exists as damage control.
     * @private
     */
    this._skipRemaining = 0

    /**
     * Always-up-to-date concatenation of `this.buffers`
     * (pruned after each parse).
     * @private
     */
    this.buffer = Buffer.alloc(0)
  }

  /**
   * Accumulates chunks, collapses when over threshold, then
   * repeatedly scans for header delimiters, parses out frames, and
   * prunes consumed bytes. Uses pure-Buffer operations for max speed.
   *
   * @param {Buffer} chunk
   * @param {string} encoding
   * @param {function(Error=):void} callback
   * @private
   */
  _transform(chunk, encoding, callback) {
    // Drop the tail of an oversize frame before accumulating anything —
    // skipped bytes must never reach the buffer machinery.
    if (this._skipRemaining > 0) {
      const drop = Math.min(chunk.length, this._skipRemaining)
      this._skipRemaining -= drop
      chunk = chunk.slice(drop)
      if (chunk.length === 0) return callback()
    }

    this.buffers.push(chunk)
    this.bytesBuffered += chunk.length

    // Over threshold: collapse the chunk array into one Buffer to avoid
    // unbounded growth; otherwise always re-concat so this.buffer
    // contains all bytes so far.
    if (this.bytesBuffered > JsonRpcParser.COLLAPSE_THRESHOLD) {
      this.buffer = Buffer.concat(this.buffers, this.bytesBuffered)
      this.buffers = [this.buffer]
      this.bytesBuffered = this.buffer.length
    } else {
      this.buffer = Buffer.concat(this.buffers, this.bytesBuffered)
    }

    // Keep extracting messages while we have a full header+body
    while (true) {
      // Find the header delimiter as raw Buffer bytes — no toString/regex
      const idxCRLF = this.buffer.indexOf(JsonRpcParser.CRLF)
      const idxLF = this.buffer.indexOf(JsonRpcParser.LF)
      let sep, delimLen
      if (idxCRLF !== -1 && (idxLF === -1 || idxCRLF < idxLF)) {
        sep = idxCRLF
        delimLen = JsonRpcParser.CRLF.length // 4
      } else if (idxLF !== -1) {
        sep = idxLF
        delimLen = JsonRpcParser.LF.length // 2
      } else {
        break // no full header yet
      }

      const headerBuf = this.buffer.slice(0, sep)
      const headers = new Map(
        headerBuf
          .toString('ascii')
          .split(/\r?\n/)
          .map((line) => {
            const [name, ...rest] = line.split(':')
            return [name.toLowerCase(), rest.join(':').trim()]
          }),
      )

      const len = parseInt(headers.get('content-length'), 10)
      if (isNaN(len)) {
        // Malformed header — no trusted length, so the frame can't be
        // skipped deterministically. Error the stream (same as before).
        const err = new Error('Missing or malformed Content-Length header')
        this.push({ error: PARSE_ERROR, id: null })
        return callback(err)
      }
      if (len > MAX_CONTENT_LENGTH) {
        const bodyStart = sep + delimLen
        const available = this.buffer.length - bodyStart
        if (available >= len) {
          // Whole body already buffered — drop it and keep parsing.
          this.buffer = this.buffer.slice(bodyStart + len)
          continue
        }
        // Partial body here: drop it, wait for the rest in skip mode.
        this._skipRemaining = len - available
        this.buffer = this.buffer.slice(0, 0)
        break
      }

      if (this.buffer.length < sep + delimLen + len) break

      const bodyBuf = this.buffer.slice(sep + delimLen, sep + delimLen + len)
      let body
      try {
        body = JSON.parse(bodyBuf.toString('utf8'))
      } catch {
        this.push({ error: PARSE_ERROR, id: null })
        this.buffer = this.buffer.slice(sep + delimLen + len)
        continue
      }

      this.push({ headers, body })
      this.buffer = this.buffer.slice(sep + delimLen + len)
    }

    // Sync the chunk array to the unparsed remainder
    this.buffers = [this.buffer]
    this.bytesBuffered = this.buffer.length

    callback()
  }
}

/**
 * Once we've buffered more than this, collapse to a single Buffer
 * to avoid unbounded array growth. Chosen as a balance between
 * small-packet concat-cost and large-packet GC pressure.
 */

JsonRpcParser.COLLAPSE_THRESHOLD = 64 * 1024

/**
 * Raw bytes for the CRLF-CRLF header delimiter ("\r\n\r\n").
 * Used by Buffer.indexOf to find header/body boundaries without string conversions.
 * @private
 */
JsonRpcParser.CRLF = Buffer.from('\r\n\r\n', 'ascii')

/**
 * Raw bytes for the LF-LF header delimiter ("\n\n").
 * Used by Buffer.indexOf as a fallback for Unix-style or mixed line endings.
 * @private
 */
JsonRpcParser.LF = Buffer.from('\n\n', 'ascii')

class JsonRpcService {
  /**
   * @param {import('stream').Readable} readStream
   * @param {import('stream').Writable} writeStream
   * @param {{logger?(…args:any[]):void}} [options]
   */
  constructor(readStream, writeStream, { logger = console } = {}) {
    this.readStream = readStream
    this.writeStream = writeStream
    this.logger = logger
    this.handlers = new Map()
    this.parser = new JsonRpcParser()

    /**
     * Serializes frame writes. Concurrent payloads (e.g. a didCrash
     * notification racing a format response) must never interleave
     * bytes mid-frame.
     *
     * @type {Promise<void>}
     * @private
     */
    this._writeQueue = Promise.resolve()

    const piped = readStream.pipe(this.parser)
    piped
      .on('error', (err) => {
        this._writePayload({ jsonrpc: '2.0', error: INTERNAL_ERROR, id: null })
        this.logger.error('Parser error', err)
        readStream.unpipe(this.parser)
        this.parser.destroy()
      })
      .on('data', (frame) => {
        this._handleFrame(frame).catch((err) => {
          this._writePayload({
            jsonrpc: '2.0',
            error: INTERNAL_ERROR,
            id: null,
          })
          this.logger.error('Fatal error in _handleFrame', err)
          readStream.unpipe(this.parser)
          this.parser.destroy()
        })
      })
  }

  /**
   * Register a handler for incoming requests.
   * Returns an “unsubscribe” function you can call to remove it.
   *
   * @param {string} method
   * @param {(params: any) => Promise<any> | any} handler
   * @returns {() => void}  – call this to unregister the handler
   */
  onRequest(method, handler) {
    this.handlers.set(method, handler)
    return () => {
      this.handlers.delete(method)
    }
  }

  async _handleFrame({ error, body }) {
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

      const responses = await Promise.all(req.map((r) => this._process(r)))
      for (const resp of responses) {
        if (resp) {
          await this._writePayload(resp)
        }
      }
      return
    }

    const resp = await this._process(req)
    if (resp) {
      await this._writePayload(resp)
    }
  }

  async _process(request) {
    const { jsonrpc, method, params, id } = request

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
      return this._limitResponse({
        jsonrpc: '2.0',
        result,
        id,
      })
    } catch (err) {
      // a JSON-RPC error object passes through as-is
      const errObj =
        err && typeof err.code === 'number' && typeof err.message === 'string'
          ? err
          : typeof err === 'string'
            ? { code: INTERNAL_ERROR.code, message: err }
            : {
                code: INTERNAL_ERROR.code,
                // Handlers may reject with non-Error values (or Errors
                // without a message). JSON.stringify drops undefined
                // properties, which would leave the client a frame with
                // no message at all — "undefined: undefined" in logs.
                message: err?.message ?? String(err),
                ...(err?.stack ? { data: err.stack } : {}),
              }

      return this._limitResponse({
        jsonrpc: '2.0',
        error: errObj,
        id,
      })
    }
  }

  /**
   * Cap an outgoing response frame. A result that would serialize past
   * MAX_CONTENT_LENGTH can never reach the client (the client-side
   * parser has the same cap), so answer with a proper error instead of
   * writing an untransmittable frame. The byte count goes into `data`
   * for the Extension Console; the message stays a stable literal so
   * the client can detect this error by phrase.
   *
   * @param {{ jsonrpc: '2.0', result?: any, error?: any, id: any }} resp
   * @returns {object} the original response, or an error response
   * @private
   */
  _limitResponse(resp) {
    const body = JSON.stringify(resp)
    const size = Buffer.byteLength(body, 'utf8')
    if (size <= MAX_CONTENT_LENGTH) return resp
    return {
      jsonrpc: '2.0',
      error: {
        code: RESULT_TOO_LARGE.code,
        message: RESULT_TOO_LARGE.message,
        data: size,
      },
      id: resp.id,
    }
  }

  async _writePayload(payload) {
    const str = JSON.stringify(payload)
    const buf = Buffer.from(str, 'utf8')
    const hdr = Buffer.from(`Content-Length: ${buf.length}\r\n\r\n`, 'ascii')

    // Build the frame atomically — header and body must hit the stream
    // as a single write so concurrent writers can't interleave them.
    const frame = Buffer.concat([hdr, buf], hdr.length + buf.length)

    const write = this._writeQueue.then(() => this._writeFrame(frame))
    // Keep the queue alive even if a write fails, but don't leak the
    // rejection — the failing caller still receives it via `write`.
    this._writeQueue = write.catch(() => {})
    return write
  }

  /**
   * Write a fully-formed frame, respecting back-pressure.
   *
   * @param {Buffer} frame
   * @private
   */
  async _writeFrame(frame) {
    const stream = this.writeStream
    if (stream.destroyed) {
      throw new Error('Write stream destroyed')
    }
    if (stream.write(frame)) return

    // Back-pressure: wait for 'drain', but bail out if the stream is
    // closed or destroyed first — otherwise the write queue would be
    // wedged forever (e.g. client killed the service mid-write).
    const ac = new AbortController()
    const { signal } = ac
    const drain = once(stream, 'drain', { signal })
    const closed = once(stream, 'close', { signal }).then(() => {
      throw new Error('Write stream closed before drain')
    })
    // Loser of the race gets aborted (AbortError) — swallow so it never
    // becomes an unhandled rejection.
    drain.catch(() => {})
    closed.catch(() => {})
    try {
      await Promise.race([drain, closed])
    } finally {
      ac.abort()
    }
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   * @param {string} method
   * @param {any} params
   */
  notify(method, params) {
    return this._writePayload({
      jsonrpc: '2.0',
      method,
      params,
    })
  }

  /**
   * Tear down the service: remove parser listeners, unpipe streams, clear handlers.
   */
  dispose() {
    this.readStream.unpipe(this.parser)
    this.parser.removeAllListeners()
    this.handlers.clear()
    // Reject any pending back-pressure waits so the write queue
    // unwinds instead of hanging.
    this.writeStream.destroy()
  }
}

module.exports = { JsonRpcService, JsonRpcParser, MAX_CONTENT_LENGTH }
