import type { ThemeStyle } from '../../../../types'
import type { AsciiWallpaperEngine } from '../engine-types'
import { ClaudeCodeEngine } from './claude-code'
import { CloudDriftEngine } from './cloud-drift'
import { HonuLagoonEngine } from './honu-lagoon'
import { KoiPondEngine } from './koi-pond'
import { JellyfishEngine } from './jellyfish'
import { PaperBoatsEngine } from './paper-boats'
import { FirefliesEngine } from './fireflies'
import { MoonlitEngine } from './moonlit'

export function createAsciiWallpaperEngine(style: ThemeStyle): AsciiWallpaperEngine {
  switch (style) {
    case 'cloud-drift':
      return new CloudDriftEngine()
    case 'honu-lagoon':
      return new HonuLagoonEngine()
    case 'koi-pond':
      return new KoiPondEngine()
    case 'jellyfish':
      return new JellyfishEngine()
    case 'paper-boats':
      return new PaperBoatsEngine()
    case 'fireflies':
      return new FirefliesEngine()
    case 'moonlit':
      return new MoonlitEngine()
    case 'claude-code':
    case 'default':
    default:
      return new ClaudeCodeEngine()
  }
}
