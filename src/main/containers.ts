/**
 * AIHub Browser — site containers.
 *
 * A container is an isolated cookie jar with a name. Tabs opened in "Work" and
 * "Personal" can both be signed into the same site as different accounts, and
 * a tracker that follows you inside one container knows nothing about the
 * other. Chromium already gives us the isolation primitive — a named session
 * partition — so this is mostly about naming, colouring and never letting a
 * user-supplied name become a partition string that collides with something
 * else.
 */

export interface Container {
  id: string
  name: string
  color: string
}

/** The default jar: tabs with no container use the app's main partition. */
export const DEFAULT_PARTITION = 'persist:main'

export const DEFAULT_CONTAINERS: Container[] = [
  { id: 'work', name: 'Work', color: '#38BDF8' },
  { id: 'personal', name: 'Personal', color: '#34D399' },
  { id: 'shopping', name: 'Shopping', color: '#FB923C' },
]

/**
 * Container ids are user-facing (they come from a typed name), so they are
 * normalised to a strict slug. Without this, a name like "main" or one holding
 * a colon could produce a partition string that aliases the default jar — one
 * user-typed word silently merging two identities.
 */
export function slugifyContainerId(name: string): string {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'container'
}

/** Partition string for a container id. Never collides with persist:main. */
export function partitionFor(containerId: string | null | undefined): string {
  if (!containerId) return DEFAULT_PARTITION
  const slug = slugifyContainerId(containerId)
  return `persist:container-${slug}`
}

/** Add a container, keeping ids unique without silently reusing an existing jar. */
export function addContainer(containers: Container[], name: string, color: string): Container[] {
  const clean = String(name || '').trim().slice(0, 24)
  if (!clean) return containers
  const base = slugifyContainerId(clean)
  let id = base
  let n = 2
  while (containers.some(c => c.id === id)) { id = `${base}-${n}`; n++ }
  return [...containers, { id, name: clean, color }]
}

export function removeContainer(containers: Container[], id: string): Container[] {
  return containers.filter(c => c.id !== id)
}

export function findContainer(containers: Container[], id: string | null | undefined): Container | null {
  if (!id) return null
  return containers.find(c => c.id === id) || null
}
