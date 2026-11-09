declare module '@gamma/genui-embed' {
  import type { ComponentType, Context, ReactNode } from 'react'
  export interface GenuiSpec { title?: string; items: Array<Record<string, unknown>> }
  export interface BlockInteractionState {
    answers?: Record<string, string>
    multiAnswers?: Record<string, string[]>
    fields?: Record<string, string>
    locked?: boolean
  }
  export const GenuiBlock: ComponentType<{ spec: GenuiSpec; stateKey?: string; initialState?: BlockInteractionState; onStateChange?: (state: BlockInteractionState) => void; animateEntrance?: boolean }>
  export const GenuiActionContext: Context<((action: string, payload: Record<string, unknown>) => void) | undefined>
  export const ErrorBoundary: ComponentType<{ label?: string; children: ReactNode }>
  export function setGenuiAssetBase(base: string): void
  export function processGenuiSpec(value: unknown): { spec: GenuiSpec | null; errors: string[]; [key: string]: unknown }
  export function isRenderableProcess(value: ReturnType<typeof processGenuiSpec>): boolean
}
