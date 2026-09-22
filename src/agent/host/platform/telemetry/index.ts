type Telemetry = { [event: string]: (...args: any[]) => void }

export function useTelemetry(): Telemetry | null {
  return null
}
