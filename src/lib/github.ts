// A small client for the GitHub REST Git Data API, called straight from the browser.
// The token is sent only to api.github.com and never logged or put in a URL.

import { GITHUB_API, GITHUB_API_VERSION, GITHUB_BRANCH, GITHUB_OWNER, GITHUB_REPO } from './config'

export type ProblemKind =
  | 'offline'
  | 'rate-limited'
  | 'token' // 401 or other 403: token not accepted
  | 'not-found' // 404: the token cannot see the data repo
  | 'empty-repo' // 409: the data repo has no commits
  | 'conflict' // 422 on the ref update: the branch moved
  | 'http' // anything else

export class GitHubError extends Error {
  constructor(
    public kind: ProblemKind,
    message: string,
    public status = 0,
    /** For rate limits: when to try again (ms since epoch). */
    public retryAt?: number,
  ) {
    super(message)
  }
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

const REPO_PATH = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}`

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

async function toError(res: Response, now: number): Promise<GitHubError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  const message = body.message ?? res.statusText
  const retryAfter = res.headers.get('retry-after')
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = res.headers.get('x-ratelimit-reset')
  if (res.status === 403 || res.status === 429) {
    // Rate-limit headers come with every response, so only an exhausted limit or retry-after counts.
    if (retryAfter) return new GitHubError('rate-limited', message, res.status, now + Number(retryAfter) * 1000)
    if (remaining === '0') return new GitHubError('rate-limited', message, res.status, reset ? Number(reset) * 1000 : now + 60_000)
  }
  if (res.status === 401 || res.status === 403) return new GitHubError('token', message, res.status)
  if (res.status === 404) return new GitHubError('not-found', message, res.status)
  if (res.status === 409 && /empty/i.test(message)) return new GitHubError('empty-repo', message, res.status)
  if (res.status === 422) return new GitHubError('conflict', message, res.status)
  return new GitHubError('http', `${res.status} ${message}`, res.status)
}

export class GitHub {
  constructor(
    private token: string,
    private fetchFn: FetchFn = (url, init) => fetch(url, init),
    private clock: () => number = Date.now,
  ) {}

  private async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await this.fetchFn(`${GITHUB_API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Without no-store the browser may hand back a stale commit.
        cache: method === 'GET' ? 'no-store' : undefined,
      })
    } catch {
      throw new GitHubError('offline', 'No connection')
    }
    if (!res.ok) throw await toError(res, this.clock())
    return (await res.json()) as T
  }

  getRepo(): Promise<{ full_name: string }> {
    return this.request('GET', REPO_PATH)
  }

  async getHead(): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>('GET', `${REPO_PATH}/git/ref/heads/${GITHUB_BRANCH}`)
    return ref.object.sha
  }

  async getCommitTree(sha: string): Promise<string> {
    const commit = await this.request<{ tree: { sha: string } }>('GET', `${REPO_PATH}/git/commits/${sha}`)
    return commit.tree.sha
  }

  async getTree(sha: string): Promise<TreeEntry[]> {
    const tree = await this.request<{ tree: TreeEntry[]; truncated: boolean }>('GET', `${REPO_PATH}/git/trees/${sha}?recursive=1`)
    if (tree.truncated) throw new GitHubError('http', 'The data repo has too many files to list')
    return tree.tree
  }

  async getBlob(sha: string): Promise<string> {
    const blob = await this.request<{ content: string; encoding: string }>('GET', `${REPO_PATH}/git/blobs/${sha}`)
    return blob.encoding === 'base64' ? decodeBase64Utf8(blob.content) : blob.content
  }

  async createBlob(content: string): Promise<string> {
    const blob = await this.request<{ sha: string }>('POST', `${REPO_PATH}/git/blobs`, { content, encoding: 'utf-8' })
    return blob.sha
  }

  async createTree(baseTree: string, files: { path: string; sha: string }[]): Promise<string> {
    const tree = await this.request<{ sha: string }>('POST', `${REPO_PATH}/git/trees`, {
      base_tree: baseTree,
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })),
    })
    return tree.sha
  }

  async createCommit(message: string, tree: string, parent: string): Promise<string> {
    const commit = await this.request<{ sha: string }>('POST', `${REPO_PATH}/git/commits`, { message, tree, parents: [parent] })
    return commit.sha
  }

  async updateHead(sha: string): Promise<void> {
    await this.request('PATCH', `${REPO_PATH}/git/refs/heads/${GITHUB_BRANCH}`, { sha, force: false })
  }
}

export type AccessResult = { ok: true } | { ok: false; message: string }

/** Setup's check: can this token read the data repo? */
export async function checkAccess(token: string, fetchFn?: FetchFn): Promise<AccessResult> {
  try {
    await new GitHub(token, fetchFn).getRepo()
    return { ok: true }
  } catch (e) {
    const kind = e instanceof GitHubError ? e.kind : 'http'
    const message: Record<ProblemKind, string> = {
      offline: "You're offline. Connect to the internet and try again.",
      token: "GitHub didn't accept this token. Check you copied all of it, and that it hasn't expired.",
      'not-found': `This token can't see ${GITHUB_OWNER}/${GITHUB_REPO}. Give it access to that repository.`,
      'rate-limited': 'GitHub is limiting requests right now. Try again in a few minutes.',
      'empty-repo': 'The data repository is empty.',
      conflict: 'GitHub returned an unexpected answer. Try again.',
      http: 'GitHub returned an unexpected answer. Try again.',
    }
    return { ok: false, message: message[kind] }
  }
}
