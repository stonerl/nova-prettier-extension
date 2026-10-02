/**
 * json-rpc.test.js — Unit tests for the transport-level size guards in
 * prettier-service/json-rpc.js, added after the "32.0 MiB exceeds the
 * 32 MiB limit" message confusion surfaced the escape-expansion hole.
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that
 *   • an incoming frame declaring a Content-Length above the cap is
 *     skipped (Tier 0) instead of erroring the Transform: no error
 *     event, no PARSE_ERROR frame, and a valid frame after it still
     parses — with the oversize body split across chunks and with
 *     header+body+next-frame in a single chunk,
 *   • a malformed (NaN) Content-Length still errors the stream — no
 *     trusted length means no deterministic skip,
 *   • a handler result that would serialize past the cap is answered
 *     with a proper JSON-RPC error (-32000, stable message, size in
 *     data, correct id) and the service keeps serving the next
 *     request.
 *
 * Runs against the classes directly — no built artifacts, no subprocess.
 */

const { Writable, PassThrough } = require('stream')

const SRC_DIR = process.env.JSON_RPC_SRC
const { JsonRpcParser, JsonRpcService, MAX_CONTENT_LENGTH } = SRC_DIR
  ? require(SRC_DIR + '/json-rpc.js')
  : require('../src/Scripts/prettier-service/json-rpc.js')

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail).slice(0, 500)}`)
    }
  }
}

function frame(body, extra) {
  const b = Buffer.from(body)
  return Buffer.concat([
    Buffer.from(`Content-Length: ${b.length + (extra?.padding ?? 0)}\r\n\r\n`),
    b,
    extra?.tail ?? Buffer.alloc(0),
  ])
}

async function drain(parser, chunks) {
  const frames = []
  const errors = []
  parser.on('data', (f) => frames.push(f))
  parser.on('error', (e) => errors.push(e.message))
  // A stream that errors gets destroyed and emits 'close' without
  // 'end' — await both.
  const done = new Promise((resolve) => {
    parser.on('end', resolve)
    parser.on('close', resolve)
  })
  for (const chunk of chunks) parser.write(chunk)
  parser.end()
  await done
  return { frames, errors }
}

function skipCases() {
  console.log('\n== JsonRpcParser: oversize frames are skipped, not fatal ==')

  const oversizedLen = MAX_CONTENT_LENGTH + 10
  const head = Buffer.from(`Content-Length: ${oversizedLen}\r\n\r\n`)
  const valid = frame('{"method":"ping"}')

  return (async () => {
    const split = await drain(new JsonRpcParser(), [
      Buffer.concat([head, Buffer.alloc(1024, 0x78)]),
      Buffer.alloc(oversizedLen - 1024, 0x78),
      valid.slice(0, 10),
      valid.slice(10),
    ])
    check(
      'oversize split across chunks: no error events',
      split.errors.length === 0,
      split.errors,
    )
    check(
      'oversize split across chunks: following frame parses',
      split.frames.length === 1 && split.frames[0].body?.method === 'ping',
      split.frames,
    )

    const sameChunk = await drain(new JsonRpcParser(), [
      Buffer.concat([head, Buffer.alloc(oversizedLen, 0x78), valid]),
    ])
    check(
      'oversize + valid frame in one chunk: stream survives',
      sameChunk.errors.length === 0 &&
        sameChunk.frames.length === 1 &&
        sameChunk.frames[0].body?.method === 'ping',
      { errors: sameChunk.errors, frames: sameChunk.frames },
    )

    const several = await drain(new JsonRpcParser(), [
      Buffer.concat([head, Buffer.alloc(oversizedLen, 0x78)]),
      frame('{"id":1}'),
      Buffer.concat([head, Buffer.alloc(oversizedLen, 0x78)]),
      frame('{"id":2}'),
    ])
    check(
      'two oversize frames interleaved with valid ones: both valid parse',
      several.errors.length === 0 &&
        several.frames.length === 2 &&
        several.frames[0].body?.id === 1 &&
        several.frames[1].body?.id === 2,
      { errors: several.errors, frames: several.frames },
    )

    const plain = await drain(new JsonRpcParser(), [valid])
    check(
      'valid frame alone still parses',
      plain.frames.length === 1 && plain.frames[0].body?.method === 'ping',
      plain,
    )

    const malformed = await drain(new JsonRpcParser(), [
      Buffer.from('Content-Length: notanumber\r\n\r\n{}'),
    ])
    check(
      'malformed Content-Length still errors the stream',
      malformed.errors.length === 1 &&
        malformed.frames.length === 1 &&
        malformed.frames[0].error?.code === -32700,
      malformed,
    )
  })()
}

function responseCapCases() {
  console.log('\n== JsonRpcService: oversized results answer as errors ==')

  const written = []
  const fakeWrite = new Writable({
    write(chunk, encoding, callback) {
      written.push(chunk.toString())
      callback()
    },
  })
  const fakeRead = new PassThrough()
  const svc = new JsonRpcService(fakeRead, fakeWrite, {
    logger: { error() {}, warn() {}, info() {}, log() {} },
  })
  svc.onRequest('boom', async () => ({ blob: 'y'.repeat(MAX_CONTENT_LENGTH) }))
  svc.onRequest('boomError', async () => {
    const err = new Error('Kaboom with a huge stack')
    err.stack = 's'.repeat(MAX_CONTENT_LENGTH)
    throw err
  })
  svc.onRequest('ok', async () => ({ hello: 'world' }))

  const send = (id, method) =>
    fakeRead.write(
      frame(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params: {},
        }),
      ),
    )

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  return (async () => {
    send(1, 'boom')
    await wait(50)
    send(2, 'boomError')
    await wait(50)
    send(3, 'ok')
    await wait(50)

    check(
      'three frames written (no giant result frame)',
      written.length === 3,
      written.length,
    )
    check(
      'every frame stays under the cap',
      written.every(
        (f) =>
          Number.parseInt(f.match(/^Content-Length: (\d+)\r\n\r\n/)?.[1], 10) <=
          MAX_CONTENT_LENGTH,
      ),
      written.map((f) => f.match(/^Content-Length: (\d+)/)?.[1]),
    )

    const boom = JSON.parse(written[0].split('\r\n\r\n')[1])
    check(
      'huge result → -32000 error with id and size in data',
      boom.id === 1 &&
        boom.error?.code === -32000 &&
        boom.error?.message === 'Formatted result too large to transmit' &&
        typeof boom.error?.data === 'number',
      boom,
    )

    const boomError = JSON.parse(written[1].split('\r\n\r\n')[1])
    check(
      'huge error payload → also capped',
      boomError.id === 2 && boomError.error?.code === -32000,
      boomError,
    )

    const ok = JSON.parse(written[2].split('\r\n\r\n')[1])
    check(
      'service still answers normal requests afterwards',
      ok.id === 3 && ok.result?.hello === 'world',
      ok,
    )
  })()
}

async function main() {
  console.log('MAX_CONTENT_LENGTH:', MAX_CONTENT_LENGTH)
  await skipCases()
  await responseCapCases()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
