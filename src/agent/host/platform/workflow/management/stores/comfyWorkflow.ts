export interface ComfyWorkflow {
  path: string
  filename: string
  directory?: string
  suffix?: string
  isPersisted: boolean
  isModified: boolean
  isTemporary: boolean
  initialMode?: 'app' | 'graph'
  legacyId?: string
  originalContent?: string | null
  activeState?: { id?: string; nodes?: unknown[]; [key: string]: unknown } | null
  changeTracker?: { prepareForSave: () => void; captureCanvasState?: () => void } | null
  load?: () => Promise<ComfyWorkflow>
  saveAs?: (path: string) => Promise<ComfyWorkflow>
  [key: string]: unknown
}
