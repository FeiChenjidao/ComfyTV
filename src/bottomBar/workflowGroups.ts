import { z } from 'zod'

import { app } from '@/lib/comfyApp'
import type { NativeWorkflow } from '@/api'

export type WorkflowScope = 'templates' | 'local'
export const GROUPS_FILE = 'comfytv/workflow-groups.json'
const GroupSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(60) })
const LibrarySchema = z.object({
  groups: z.array(GroupSchema),
  assignments: z.record(z.string(), z.string()),
})
export const WorkflowGroupsSchema = z.object({
  version: z.literal(1),
  templates: LibrarySchema,
  local: LibrarySchema,
})
export type WorkflowGroups = z.infer<typeof WorkflowGroupsSchema>
export type WorkflowGroupLibrary = WorkflowGroups[WorkflowScope]

export function newWorkflowGroupId(): string {
  // getRandomValues also works on HTTP LAN deployments, where randomUUID may
  // be unavailable because the browser does not consider the origin secure.
  return `custom-${Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, '0')).join('')}`
}

// These names describe the existing team library. Users can move or rename
// groups independently in their account without moving the workflow JSON.
export const DEFAULT_GROUPS = ['character', 'scene', 'general', 'testing'] as const
const INITIAL_ASSIGNMENTS = new Map(Object.entries({
  '场景物件基础拆解': 'scene',
  '三视图转模型': 'character',
  '原画To3D': 'character',
  '刺绣': 'character',
  '高清毛发工作流': 'character',
  '衣褶优化工作流': 'character',
  '灯光工作流': 'general',
  'PS_NanoBanana_GPTImage': 'general',
  '测试专用工作流': 'testing',
}))

export function initialWorkflowGroups(
  rows: Record<WorkflowScope, NativeWorkflow[]>,
  label: (id: string) => string,
): WorkflowGroups {
  function library(scope: WorkflowScope): WorkflowGroupLibrary {
    return {
      groups: DEFAULT_GROUPS.map(id => ({ id, name: label(id) })),
      assignments: Object.fromEntries(rows[scope].flatMap(row => {
        const group = INITIAL_ASSIGNMENTS.get(row.name)
        return group ? [[row.path, group]] : []
      })),
    }
  }
  return { version: 1, templates: library('templates'), local: library('local') }
}

export function groupWorkflowRows(rows: NativeWorkflow[], library: WorkflowGroupLibrary) {
  const ids = new Set(library.groups.map(group => group.id))
  const grouped = library.groups.map(group => ({ ...group, rows: [] as NativeWorkflow[] }))
  const byId = new Map(grouped.map(group => [group.id, group]))
  const ungrouped: NativeWorkflow[] = []
  for (const row of rows) {
    const id = Object.hasOwn(library.assignments, row.path)
      ? library.assignments[row.path]
      : INITIAL_ASSIGNMENTS.get(row.name)
    if (id && ids.has(id)) byId.get(id)!.rows.push(row)
    else ungrouped.push(row)
  }
  return [...grouped, { id: '', name: '', rows: ungrouped }]
}

export function removeWorkflowGroup(library: WorkflowGroupLibrary, id: string): void {
  library.groups = library.groups.filter(group => group.id !== id)
  for (const [path, group] of Object.entries(library.assignments)) {
    if (group === id) delete library.assignments[path]
  }
}

export async function loadWorkflowGroups(): Promise<WorkflowGroups | null> {
  const response = await app.api.fetchApi(`/userdata/${encodeURIComponent(GROUPS_FILE)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = WorkflowGroupsSchema.parse(await response.json())
  for (const scope of ['templates', 'local'] as const) {
    const ids = data[scope].groups.map(group => group.id)
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate workflow group id')
  }
  return data
}

export async function saveWorkflowGroups(data: WorkflowGroups): Promise<void> {
  const response = await app.api.fetchApi(`/userdata/${encodeURIComponent(GROUPS_FILE)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(WorkflowGroupsSchema.parse(data)),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}
