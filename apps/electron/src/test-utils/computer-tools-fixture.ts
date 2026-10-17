import { Type } from 'typebox'
import type { ToolDefinition, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ComputerExecuteParams } from '../main/lib/computer-controller'
import { loadIsolatedModule } from './isolated-module'
import { createComputerFixture } from './computer-fixture'

type ToolsModule = typeof import('../main/lib/adapters/pi-computer-tools')
export function createComputerToolsFixture(options?: Parameters<typeof createComputerFixture>[0]) {
  const fixture = createComputerFixture(options)
  const { buildPiComputerTools } = loadIsolatedModule<ToolsModule>(`${import.meta.dir}/../main/lib/adapters/pi-computer-tools.ts`, {
    typebox: { Type }, '../computer-service': { computerController: fixture.controller },
  })
  const sdk = { defineTool: (definition: ToolDefinition) => definition } as unknown as Parameters<typeof buildPiComputerTools>[0]
  const tools = buildPiComputerTools(sdk, fixture.binding, 'user', fixture.controller)
  const computer = tools.find(tool => tool.name === 'computer')!
  return { ...fixture, tools, execute: (params: ComputerExecuteParams) => computer.execute('synthetic-tool-call', params, undefined, undefined, {} as ExtensionContext) }
}
