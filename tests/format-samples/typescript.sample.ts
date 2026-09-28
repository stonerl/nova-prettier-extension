// Variables and basic types
let username: string = 'Alice'
const isActive: boolean = true
let score: number | undefined

// Arrays, tuples, enums
const scores: number[] = [10, 20, 30]
const point: [number, number] = [1, 2]

enum Role {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

// Functions with default and optional params
function greet(name: string = 'World', age?: number): string {
  return `Hello, ${name}${age ? ` (${age})` : ''}`
}

// Arrow functions and return type inference
const double = (x: number): number => {
  return x * 2
}

// Interfaces and type aliases
interface User {
  id: number
  name: string
  email?: string
  role: Role
}

type ApiResponse<T> = {
  data: T
  error?: string
}

// Union and intersection types
type Status = 'pending' | 'success' | 'error'
type DetailedUser = User & { permissions: string[] }

// Classes with access modifiers, static members, and generics
class Repository<T> {
  private items: T[] = []

  add(item: T): void {
    this.items.push(item)
  }

  static version: string = '1.0.0'

  getAll(): T[] {
    return this.items
  }
}

// Type assertions and non-null assertions
const input = document.getElementById('input-name') as HTMLInputElement
input!.value = 'test'

// Generics with constraints
function identity<T extends { id: number }>(obj: T): T {
  return obj
}

// Await/async + Promise with typed return
async function fetchData<T>(url: string): Promise<ApiResponse<T>> {
  const res = await fetch(url)
  const data = await res.json()
  return { data }
}

// Namespaces and module declarations
namespace Utils {
  export const version = '1.2.3'
  export function log(msg: string): void {
    console.log(`[LOG] ${msg}`)
  }
}

// Function overloads
function parse(input: string): number
function parse(input: string[]): number[]
function parse(input: unknown): unknown {
  return Array.isArray(input) ? input.map(Number) : Number(input)
}

// Abstract classes and inheritance
abstract class Shape {
  abstract area(): number
  describe(): string {
    return `shape with area ${this.area()}`
  }
}

class Circle extends Shape.Circle {
  constructor(public radius: number) {
    super()
  }
  area(): number {
    return Math.PI * this.radius ** 2
  }
}

// satisfies and utility types
const palette = {
  brand: '#4a90e2',
  accent: '#50e3c2',
} satisfies Record<string, string>

type ReadonlyUser = Readonly<Pick<User, 'id' | 'name'>>

// Decorators (experimental syntax)
@sealed
class Vault {
  static instance?: Vault
}

function sealed<T extends new (...args: any[]) => unknown>(ctor: T) {
  return ctor
}
