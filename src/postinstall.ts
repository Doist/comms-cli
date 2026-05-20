import { updateAllInstalledSkills } from './lib/skills/update-installed.js'

// Failures must not break `npm install`.
updateAllInstalledSkills({ local: false }).catch(() => {})
