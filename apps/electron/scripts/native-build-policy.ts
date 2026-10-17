interface NativeBuildEnvironment {
  [key: string]: string | undefined
  GAMMA_NATIVE_COMPILE_ONLY?: string
}

/** CI/验证构建明确只编译，禁止隐式改动开发Electron签名或下载headers。 */
export function isNativeCompileOnly(argv: readonly string[], env: NativeBuildEnvironment): boolean {
  return argv.includes('--compile-only') || env.GAMMA_NATIVE_COMPILE_ONLY === '1'
}
