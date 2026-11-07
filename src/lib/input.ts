import { spawn } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readStdin } from '@doist/cli-core'
import { CliError } from './errors.js'
import { isNonInteractive } from './global-args.js'
import type { StdinOptions } from './options.js'

/**
 * Content for a command that takes it as a `[content]` argument or, with
 * `--stdin`, from piped stdin. Stdin is only read when `--stdin` is passed.
 * Returns null when neither gave any content, so the caller can fall back to
 * `$EDITOR`.
 */
export async function readContent(
    content: string | undefined,
    options: StdinOptions,
): Promise<string | null> {
    if (options.stdin) {
        if (content !== undefined) {
            throw new CliError(
                'CONFLICTING_OPTIONS',
                'Pass content as an argument or with --stdin, not both.',
            )
        }
        return (await readStdin()).trim() || null
    }
    return content || null
}

/**
 * Non-empty lines piped to stdin for a `--stdin` flag, trimmed, skipping
 * `#` comment lines.
 */
export async function readStdinLines(): Promise<string[]> {
    return (await readStdin())
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
}

export async function openEditor(): Promise<string | null> {
    if (isNonInteractive()) {
        return null
    }

    const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
    const tmpFile = join(tmpdir(), `comms-cli-${Date.now()}.md`)

    await writeFile(tmpFile, '')

    return new Promise((resolve) => {
        const child = spawn(editor, [tmpFile], {
            stdio: 'inherit',
        })

        child.on('exit', async (code) => {
            if (code !== 0) {
                await unlink(tmpFile).catch(() => {})
                resolve(null)
                return
            }

            try {
                const content = await readFile(tmpFile, 'utf8')
                await unlink(tmpFile).catch(() => {})
                resolve(content.trim() || null)
            } catch {
                resolve(null)
            }
        })

        child.on('error', async () => {
            await unlink(tmpFile).catch(() => {})
            resolve(null)
        })
    })
}
