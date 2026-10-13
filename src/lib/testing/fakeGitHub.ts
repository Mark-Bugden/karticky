// An in-memory stand-in for the GitHub Git Data API, for tests only.

import type { FetchFn } from '../github'

interface Commit {
  tree: string
  parents: string[]
  message: string
}

type Override = { method: string; path: RegExp; respond: () => Response | Promise<Response> }

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  // GitHub wraps base64 content at 60 characters.
  return (btoa(bin).match(/.{1,60}/g) ?? []).join('\n')
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export class FakeGitHub {
  blobs = new Map<string, string>()
  trees = new Map<string, Map<string, string>>()
  commits = new Map<string, Commit>()
  head: string | null = null
  requests: { method: string; path: string; auth: string | null }[] = []
  repoVisible = true
  /** Runs just before a ref update is applied; tests use it to move the branch underneath a sync. */
  beforeRefUpdate?: () => void
  private overrides: Override[] = []
  private n = 0

  private id(prefix: string) {
    return `${prefix}${(++this.n).toString(16).padStart(39, '0')}`
  }

  /** Commits files straight to main, as if edited on github.com. `null` deletes a file. */
  commitFiles(files: Record<string, string | null>, message = 'edit on github.com'): string {
    const tree = new Map(this.head ? this.trees.get(this.commits.get(this.head)!.tree) : [])
    for (const [path, text] of Object.entries(files)) {
      if (text === null) {
        tree.delete(path)
      } else {
        const sha = this.id('b')
        this.blobs.set(sha, text)
        tree.set(path, sha)
      }
    }
    const treeSha = this.id('t')
    this.trees.set(treeSha, tree)
    const sha = this.id('c')
    this.commits.set(sha, { tree: treeSha, parents: this.head ? [this.head] : [], message })
    this.head = sha
    return sha
  }

  /** A file's content at the head of main. */
  file(path: string): string | undefined {
    if (!this.head) return undefined
    const sha = this.trees.get(this.commits.get(this.head)!.tree)!.get(path)
    return sha ? this.blobs.get(sha) : undefined
  }

  paths(): string[] {
    return this.head ? [...this.trees.get(this.commits.get(this.head)!.tree)!.keys()].sort() : []
  }

  /** Commit messages on main, oldest first. */
  history(): string[] {
    const out: string[] = []
    for (let c = this.head; c; c = this.commits.get(c)!.parents[0] ?? null) out.unshift(this.commits.get(c)!.message)
    return out
  }

  /** Makes the next matching request return this response instead. */
  respondOnce(method: string, path: RegExp, respond: () => Response | Promise<Response>) {
    this.overrides.push({ method, path, respond })
  }

  fetch: FetchFn = async (url, init) => {
    const method = init.method ?? 'GET'
    const path = url.replace('https://api.github.com', '')
    const headers = new Headers(init.headers)
    this.requests.push({ method, path, auth: headers.get('authorization') })
    const i = this.overrides.findIndex((o) => o.method === method && o.path.test(path))
    if (i >= 0) return this.overrides.splice(i, 1)[0].respond()
    if (headers.get('authorization') === 'Bearer bad-token') return json(401, { message: 'Bad credentials' })
    const body = init.body ? JSON.parse(init.body as string) : undefined

    const repo = '/repos/mark-bugden/karticky-czech'
    if (!path.startsWith(repo) || !this.repoVisible) return json(404, { message: 'Not Found' })
    const rest = path.slice(repo.length)
    let m: RegExpMatchArray | null

    if (method === 'GET' && rest === '') return json(200, { full_name: 'mark-bugden/karticky-czech' })
    if (method === 'GET' && rest === '/git/ref/heads/main') {
      return this.head ? json(200, { object: { sha: this.head } }) : json(409, { message: 'Git Repository is empty.' })
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1])
      return c ? json(200, { sha: m[1], tree: { sha: c.tree } }) : json(404, { message: 'Not Found' })
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/trees\/(\w+)\?recursive=1$/))) {
      const t = this.trees.get(m[1])
      if (!t) return json(404, { message: 'Not Found' })
      const dirs = new Set([...t.keys()].flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))
      const tree = [
        ...[...dirs].map((path) => ({ path, type: 'tree', sha: `dir-${path}`, mode: '040000' })),
        ...[...t].map(([path, sha]) => ({ path, type: 'blob', sha, mode: '100644', size: this.blobs.get(sha)!.length })),
      ]
      return json(200, { sha: m[1], tree, truncated: false })
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/blobs\/(\w+)$/))) {
      const text = this.blobs.get(m[1])
      return text === undefined ? json(404, { message: 'Not Found' }) : json(200, { sha: m[1], content: base64(text), encoding: 'base64' })
    }
    if (method === 'POST' && rest === '/git/blobs') {
      const sha = this.id('b')
      this.blobs.set(sha, body.content)
      return json(201, { sha })
    }
    if (method === 'POST' && rest === '/git/trees') {
      const tree = new Map(this.trees.get(body.base_tree))
      for (const e of body.tree) tree.set(e.path, e.sha)
      const sha = this.id('t')
      this.trees.set(sha, tree)
      return json(201, { sha })
    }
    if (method === 'POST' && rest === '/git/commits') {
      const sha = this.id('c')
      this.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message })
      return json(201, { sha })
    }
    if (method === 'PATCH' && rest === '/git/refs/heads/main') {
      this.beforeRefUpdate?.()
      if (this.commits.get(body.sha)?.parents[0] !== this.head) return json(422, { message: 'Update is not a fast forward' })
      this.head = body.sha
      return json(200, { object: { sha: body.sha } })
    }
    return json(404, { message: `No fake route for ${method} ${rest}` })
  }
}
