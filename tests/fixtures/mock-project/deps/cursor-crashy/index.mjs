// Throws from locStart — Prettier's cursor mapping (formatWithCursor)
// walks the AST calling plugin loc functions, so any format WITH a
// cursor crashes while the same format without one succeeds.
export default {
  parsers: {
    json: {
      parse: (text) => JSON.parse(text),
      astFormat: 'cursor-crashy-json',
      locStart: () => {
        throw new Error('cursor boom')
      },
      locEnd: () => 0,
    },
  },
  printers: {
    'cursor-crashy-json': {
      print: ({ node }) => JSON.stringify(node, null, 2) + '\n',
    },
  },
}
