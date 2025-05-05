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
  /**
   * Once we've buffered more than this, collapse to a single Buffer
   * to avoid unbounded array growth. Chosen as a balance between
   * small-packet concat-cost and large-packet GC pressure.
   */
  static COLLAPSE_THRESHOLD = 64 * 1024

  /**
   * Raw bytes for the CRLF-CRLF header delimiter ("\r\n\r\n").
   * Used by Buffer.indexOf to find header/body boundaries without string conversions.
   * @private
   */
  static CRLF = Buffer.from('\r\n\r\n', 'ascii')

  /**
   * Raw bytes for the LF-LF header delimiter ("\n\n").
   * Used by Buffer.indexOf as a fallback for Unix-style or mixed line endings.
   * @private
   */
  static LF = Buffer.from('\n\n', 'ascii')

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
    // 1) stash the new chunk
    this.buffers.push(chunk)
    this.bytesBuffered += chunk.length

    // 2) if we’re over threshold, collapse into one Buffer; otherwise
    //    rebuild the full Buffer so we never lose data across buffers
    if (this.bytesBuffered > JsonRpcParser.COLLAPSE_THRESHOLD) {
      this.buffer = Buffer.concat(this.buffers, this.bytesBuffered)
      this.buffers = [this.buffer]
      this.bytesBuffered = this.buffer.length
    } else {
      // cheap for small sizes: always re-concat so this.buffer includes all bytes
      this.buffer = Buffer.concat(this.buffers, this.bytesBuffered)
    }

    // Keep extracting messages while we have a full header+body
    while (true) {
      // 1. Find header delimiter as raw Buffer (avoid toString+regex)
      //    Pre-define these once, e.g. static class props:
      //    JsonRpcParser.CRLF = Buffer.from('\r\n\r\n', 'ascii')
      //    JsonRpcParser.LF   = Buffer.from('\n\n', 'ascii')
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

      // 2. Extract header text directly from the Buffer
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

      // 3. Pull out content-length
      const len = parseInt(headers.get('content-length'), 10)
      if (isNaN(len) || len > MAX_CONTENT_LENGTH) {
        const err = new Error(`Frame too large: ${len} bytes`)
        this.push({ error: PARSE_ERROR, id: null })
        return callback(err)
      }

      // 4. Wait until full body is buffered
      if (this.buffer.length < sep + delimLen + len) break

      // 5. Slice out the body using the dynamic delimiter length
      const bodyBuf = this.buffer.slice(sep + delimLen, sep + delimLen + len)
      let body
      try {
        body = JSON.parse(bodyBuf.toString('utf8'))
      } catch {
        this.push({ error: PARSE_ERROR, id: null })
        this.buffer = this.buffer.slice(sep + delimLen + len)
        continue
      }

      // 6. Push the parsed frame and remove it from the buffer
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
    this.readStream = readStream
    this.writeStream = writeStream
    this.logger = logger
    this.handlers = new Map()
    this.parser = new JsonRpcParser()

    // Pipe incoming bytes into our parser, and unpipe on fatal errors
    const piped = readStream.pipe(this.parser)
    piped
      .on('error', (err) => {
        // unexpected parse crash → internal error response
        this._writePayload({ jsonrpc: '2.0', error: INTERNAL_ERROR, id: null })
        this.logger.error('Parser error', err)
        // stop feeding any more data
        readStream.unpipe(this.parser)
        // optionally destroy the parser to free resources
        this.parser.destroy()
      })
      .on('data', (frame) => {
        this._handleFrame(frame).catch((err) => {
          // Fatal internal error
          this._writePayload({
            jsonrpc: '2.0',
            error: INTERNAL_ERROR,
            id: null,
          })
          this.logger.error('Fatal error in _handleFrame', err)
          // unpipe so no further frames are sent
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
    // return an unsubscribe function
    return () => {
      this.handlers.delete(method)
    }
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

      // Properly handle non-empty batches:
      const responses = await Promise.all(req.map((r) => this._process(r)))
      for (const resp of responses) {
        if (resp) {
          await this._writePayload(resp)
        }
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
  }
}

module.exports = JsonRpcService
