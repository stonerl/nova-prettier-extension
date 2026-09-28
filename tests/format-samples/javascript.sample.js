// Variable declarations with inconsistent spacing
let a = 1,
  b = 2
const obj = { foo: 'bar', baz: 42 }

// Functions with messy formatting
function add(x, y) {
  return x + y
}
const subtract = (x, y) => {
  return x - y
}

// Async/await and Promises
async function fetchData(url) {
  try {
    const res = await fetch(url)
    return await res.json()
  } catch (e) {
    console.error(e)
  }
}

// Arrays, objects, nesting, trailing commas
const list = [1, 2, 3, 4]
const user = {
  id: 1,
  name: 'Alice',
  tags: ['admin', 'editor', 'user'],
  settings: { darkMode: true, notifications: false },
}

// Template literals and ternaries
const msg = `Hello, ${user.name} - you are ${user.tags.includes('admin') ? 'an admin' : 'a user'}`

// Arrow functions and higher-order functions
;[1, 2, 3].map((n) => {
  return n * 2
})

// Optional chaining, nullish coalescing
const city = user?.address?.city ?? 'Unknown'

// Class with static, getters, and methods
class Person {
  static species = 'Homo sapiens'
  constructor(name) {
    this.name = name
  }
  get upperName() {
    return this.name.toUpperCase()
  }
  greet() {
    console.log(`Hi, I'm ${this.name}`)
  }
}

// Immediately-invoked function
;(function () {
  console.log('IIFE')
})()

// Mixed single/double quotes and backticks
const single = 'single'
const double = 'double'
const backtick = `backtick`

// Misaligned indentation
if (a > 0) {
  console.log('positive')
} else {
  console.log('non-positive')
}
