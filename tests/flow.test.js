// @flow

/* Variable annotations */
let count: number = 42
const name: string = 'Alice'
var active: boolean = true

/* Function annotations */
function greet(name: string, age: ?number): string {
  return `Hello ${name}, you are ${age ?? 'unknown'} years old.`
}

/* Arrow function with inline types */
const square = (n: number): number => {
  return n * n
}

/* Union and intersection types */
type UserID = string | number
type Admin = { role: 'admin' }
type Person = { name: string } & Admin

function getUser(id: UserID): Person {
  return {
    name: 'Bob',
    role: 'admin',
  }
}

/* Nullable types and optional properties */
type Profile = {
  id: number,
  nickname?: string,
  email: ?string,
}

/* Generic types */
function identity<T>(value: T): T {
  return value
}

type Response<T> = {
  data: T,
  error: ?string,
}

const res: Response<Array<number>> = {
  data: [1, 2, 3],
  error: null,
}

/* Casts */
const el = (document.getElementById('app'): any)

/* Mixed types */
function handle(input: mixed): string {
  if (typeof input === 'string') {
    return input.toUpperCase()
  }
  return 'not a string'
}
