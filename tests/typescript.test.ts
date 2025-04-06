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
