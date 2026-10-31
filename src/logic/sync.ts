import {
  type SetupIndex,
  type SetupMeta,
  liveSetups,
  loadRaw,
  newSetupId,
  parseSetupMeta,
  removeState,
  saveRaw,
} from './storage'

/**
 * Keeps this browser's game setups in step with the server (Design.md
 * section 4). Local first: every change is already saved in the browser,
 * so the app never waits on the network. A sync pulls anything newer from
 * the server and pushes anything newer from here.
 *
 * shortcut: last write wins per setup, by updatedAt. Fine for one player on
 * a few devices; add revision numbers if two people ever share a save.
 */

export type SyncStatus = 'synced' | 'saving' | 'offline' | 'locked'

const CODE_KEY = 'ptb2:code'

export function getAccessCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAccessCode(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code)
  } catch {
    // Asked again next time.
  }
}

class Locked extends Error {}

interface Remote extends SetupMeta {
  state?: unknown
}

export interface SyncResult {
  index: SetupIndex
  /** Setups whose saved Pokedex changed here because the server had a newer copy. */
  pulled: string[]
  /** Untouched automatic setups dropped because the server already has games. */
  dropped: string[]
}

type Fetch = typeof fetch

async function callApi(fetchFn: Fetch, method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const code = getAccessCode()
  const res = await fetchFn(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(code ? { Authorization: `Bearer ${code}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (res.status === 401) throw new Locked()
  // A static host with no API answers with the app shell; that counts as offline.
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new Error('No sync server')
  return { status: res.status, data: await res.json() }
}

/** Takes a server copy into this browser. */
function adopt(remote: Remote): SetupMeta {
  const meta = parseSetupMeta(remote)!
  if (meta.deleted) removeState(meta.id)
  else saveRaw(meta.id, remote.state ?? {})
  return meta
}

/**
 * One full sync. Throws on no server (offline) and Locked on a missing or
 * wrong access code; the caller turns those into a status.
 */
export async function syncSetups(index: SetupIndex, fetchFn: Fetch = fetch): Promise<SyncResult> {
  const listed = await callApi(fetchFn, 'GET', '/api/setups')
  const remote = new Map<string, SetupMeta>()
  for (const r of Array.isArray(listed.data) ? listed.data : []) {
    const meta = parseSetupMeta(r)
    if (meta) remote.set(meta.id, meta)
  }

  const byId = new Map(index.list.map((s) => [s.id, s]))
  const pulled: string[] = []
  const dropped: string[] = []

  // A new device starts with an empty "My game"; if the server has games, use those instead.
  if ([...remote.values()].some((r) => !r.deleted)) {
    for (const s of index.list) {
      if (s.fresh && !remote.has(s.id)) {
        byId.delete(s.id)
        removeState(s.id)
        dropped.push(s.id)
      }
    }
  }

  // Pull: anything the server has that is newer, or that this browser has never seen.
  for (const r of remote.values()) {
    const local = byId.get(r.id)
    if (local && local.updatedAt >= r.updatedAt) continue
    const full = await callApi(fetchFn, 'GET', `/api/setups/${r.id}`)
    if (full.status !== 200) continue
    byId.set(r.id, adopt(full.data as Remote))
    pulled.push(r.id)
  }

  // Push: anything here that is newer, or that the server has never seen.
  for (const local of [...byId.values()]) {
    const r = remote.get(local.id)
    if (r && r.updatedAt >= local.updatedAt) continue
    // An untouched automatic setup only goes up once something is in it.
    if (local.fresh && loadRaw(local.id) === null) continue
    const body = local.deleted
      ? { name: local.name, gen: local.gen, updatedAt: local.updatedAt, deleted: true }
      : { name: local.name, gen: local.gen, updatedAt: local.updatedAt, state: loadRaw(local.id) ?? {} }
    const sent = await callApi(fetchFn, 'PUT', `/api/setups/${local.id}`, body)
    if (sent.status === 409) {
      // Someone saved a newer copy meanwhile: take theirs.
      byId.set(local.id, adopt(sent.data as Remote))
      pulled.push(local.id)
    }
  }

  const list = [...byId.values()]
  if (!list.some((s) => !s.deleted)) list.push({ id: newSetupId(), name: 'My game', gen: 9, updatedAt: Date.now() })
  const live = list.filter((s) => !s.deleted)
  const active = live.some((s) => s.id === index.active) ? index.active : live[0]!.id
  return { index: { active, list }, pulled, dropped }
}

/**
 * Folds a finished sync into the current index, so edits made while the sync
 * was in flight (a new setup, a rename) are not lost.
 */
export function mergeIndex(current: SetupIndex, synced: SetupIndex, dropped: readonly string[] = []): SetupIndex {
  const byId = new Map(current.list.filter((s) => !dropped.includes(s.id)).map((s) => [s.id, s]))
  for (const s of synced.list) {
    const mine = byId.get(s.id)
    if (!mine || s.updatedAt > mine.updatedAt) byId.set(s.id, s)
  }
  const list = [...byId.values()]
  const live = liveSetups({ active: current.active, list })
  const active = live.some((s) => s.id === current.active) ? current.active : (live[0]?.id ?? synced.active)
  return { active, list }
}

/** Turns a sync failure into what the header shows. */
export const statusFor = (error: unknown): SyncStatus => (error instanceof Locked ? 'locked' : 'offline')
