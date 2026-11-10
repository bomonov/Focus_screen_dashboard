// electron-builder afterPack hook: puts the Reminders and audio helpers into the Mac app
// before it's signed. extraResources only takes paths inside the project, and the helpers are
// built outside ~/Desktop (native/mac-reminders/build.sh says why).
import { cpSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const HELPERS = ['Focus Screen Reminders.app', 'Focus Screen Audio.app']

export async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  for (const helper of HELPERS) {
    const source = join(homedir(), 'Library/Developer/FocusScreen', helper)
    if (!existsSync(source)) {
      throw new Error(`${source} is missing; npm run build:mac builds it first.`)
    }
    cpSync(source, join(app, 'Contents/Resources', helper), { recursive: true })
  }
}
