import type { Attachment } from '@doist/comms-sdk'
import { getCommsClient } from './api.js'
import { openLocalFileAsBlob } from './local-file.js'

/** Max attachments uploaded at once — bounds socket/file-descriptor pressure. */
const MAX_UPLOAD_CONCURRENCY = 4

/**
 * Map `items` through `fn` with at most `limit` in flight at a time, preserving
 * input order in the returned array.
 */
async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = Array.from({ length: items.length })
    let cursor = 0
    const worker = async () => {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await fn(items[index], index)
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return results
}

/**
 * Validate that every path exists and is readable, without uploading anything.
 * Used by `--dry-run` so the preview fails on a bad path exactly as a real run
 * would. Throws `FILE_NOT_FOUND` / `FILE_READ_ERROR` on the first bad path.
 */
export async function validateAttachmentFiles(files: string[]): Promise<void> {
    await Promise.all(files.map((file) => openLocalFileAsBlob({ file })))
}

/**
 * Upload one or more local files and return the created {@link Attachment}s,
 * ready to splice into the `attachments` array of `comments.createComment`,
 * `conversationMessages.createMessage`, or `threads.createThread`.
 *
 * All paths are validated (existence + readability) up front, before any
 * upload starts, so a bad path fails fast without leaving a partial set of
 * uploaded-but-unreferenced attachments behind. Uploads then run with bounded
 * concurrency while the returned array preserves the input order.
 */
export async function uploadAttachments(files: string[]): Promise<Attachment[]> {
    // Validate every path first so a bad one fails before we upload anything.
    const opened = await Promise.all(files.map((file) => openLocalFileAsBlob({ file })))

    const client = await getCommsClient()
    return mapWithConcurrency(opened, MAX_UPLOAD_CONCURRENCY, ({ blob, fileName }) =>
        client.attachments.upload({ file: blob, fileName }),
    )
}

export type { Attachment }
