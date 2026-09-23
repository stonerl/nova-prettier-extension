export default {
  parsers: {
    json: {
      parse: () => {
        throw new Error('runtime boom')
      },
      astFormat: 'runtime-crashy-json',
    },
  },
  printers: {
    'runtime-crashy-json': { print: () => 'x' },
  },
}
