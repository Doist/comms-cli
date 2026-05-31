import { openAsBlob } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { CliError } from './errors.js'

export type LocalFileOptions = {
    /** Path to the file on disk (relative paths resolve against cwd). */
    file: string
    /** Optional override for the upload's user-facing filename. Defaults to `basename(file)`. */
    fileName?: string
}

/**
 * Open a local file as a streaming `Blob` for upload, with CLI-grade
 * error reporting. The returned Blob is file-backed — undici reads it
 * lazily when serializing the multipart request body, so the payload
 * never has to fit in memory all at once.
 *
 * Returns the resolved absolute path and the effective `fileName`
 * (caller's override, falling back to `basename(filePath)`) so call
 * sites don't have to recompute either.
 *
 * On the happy path this is a single `openAsBlob` — no separate readability
 * probe, so no extra filesystem open and no time-of-check/time-of-use window.
 * The probe only runs when `openAsBlob` fails: it rewraps fs errors as an
 * opaque `ERR_INVALID_ARG_VALUE` TypeError (it does *not* preserve `ENOENT`),
 * so we re-open with `fs.open` to recover the real errno and map it to a
 * precise `FILE_NOT_FOUND` vs `FILE_READ_ERROR`.
 */
export async function openLocalFileAsBlob(
    options: LocalFileOptions,
): Promise<{ blob: Blob; filePath: string; fileName: string }> {
    const filePath = resolve(options.file)
    try {
        const blob = await openAsBlob(filePath)
        return { blob, filePath, fileName: options.fileName || basename(filePath) }
    } catch (err) {
        // `openAsBlob` masks the underlying fs error; re-open to recover the errno.
        try {
            const handle = await open(filePath, 'r')
            await handle.close()
        } catch (fsErr) {
            if ((fsErr as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new CliError('FILE_NOT_FOUND', `File not found: ${filePath}`, [
                    'Check the file path and try again.',
                ])
            }
            const message = fsErr instanceof Error ? fsErr.message : String(fsErr)
            throw new CliError('FILE_READ_ERROR', `Cannot read file: ${filePath}`, [message])
        }
        // The path is readable but `openAsBlob` still failed — surface as a read error.
        const message = err instanceof Error ? err.message : String(err)
        throw new CliError('FILE_READ_ERROR', `Cannot read file: ${filePath}`, [message])
    }
}
