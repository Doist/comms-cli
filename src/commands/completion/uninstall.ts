import { installedShells } from './helpers.js'

export async function uninstallCompletion(): Promise<void> {
    // FIXME: Replace with plain tabtab.uninstall({ name: 'cm' }) once
    // https://github.com/pnpm/tabtab/issues/34 is fixed.
    const shells = installedShells()
    if (shells.length === 0) {
        console.log('No shell completions installed.')
        return
    }

    const tabtab = await import('@pnpm/tabtab')
    for (const shell of shells) {
        await tabtab.uninstall({
            name: 'cm',
            shell,
        })
    }
    console.log('Shell completions removed.')
}
