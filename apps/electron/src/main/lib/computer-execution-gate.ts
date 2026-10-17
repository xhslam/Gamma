/** 共享执行边界，不导入 Electron/原生模块，避免终端和桌面服务循环依赖。 */
let guard: () => void = () => {}
export function installComputerExecutionGuard(check: () => void): void { guard = check }
export function assertComputerExecutionAllowed(): void { guard() }
