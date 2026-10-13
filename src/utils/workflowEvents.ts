export const WORKFLOW_API_GENERATED = 'comfytv:workflow-api-generated'
export const WORKFLOW_CONFIG_CHANGED = 'comfytv:workflow-config-changed'

export interface WorkflowApiGeneratedDetail {
  kind: string
  label: string
}

export function emitWorkflowApiGenerated(kind: string, label: string): void {
  window.dispatchEvent(new CustomEvent<WorkflowApiGeneratedDetail>(
    WORKFLOW_API_GENERATED, { detail: { kind, label } },
  ))
}

export function emitWorkflowConfigChanged(kind: string, label: string): void {
  window.dispatchEvent(new CustomEvent<WorkflowApiGeneratedDetail>(
    WORKFLOW_CONFIG_CHANGED, { detail: { kind, label } },
  ))
}
