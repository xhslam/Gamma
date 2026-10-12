/** Gamma 宿主适配：保留转换器性能插桩接口，默认不记录内容或向外发送。 */
export function perfStart(_name: string): void {}
export function perfEnd(_name: string, _metrics?: Readonly<Record<string, unknown>>): void {}
export function perfMark(_name: string, _metrics?: Readonly<Record<string, unknown>>): void {}
