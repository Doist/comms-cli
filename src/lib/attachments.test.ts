import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    getCommsClient: vi.fn(),
}))

vi.mock('./api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./api.js')>()),
    getCommsClient: apiMocks.getCommsClient,
}))

import { uploadAttachments } from './attachments.js'

function createClient() {
    return {
        attachments: {
            upload: vi.fn(async (args: { file: Blob; fileName: string }) => ({
                attachmentId: `att-${args.fileName}`,
                urlType: 'file',
                fileName: args.fileName,
            })),
        },
    }
}

describe('uploadAttachments', () => {
    let tmpDir: string
    let fileA: string
    let fileB: string

    beforeAll(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'tdc-upload-'))
        fileA = join(tmpDir, 'a.png')
        fileB = join(tmpDir, 'b.pdf')
        await writeFile(fileA, 'a-bytes')
        await writeFile(fileB, 'b-bytes')
    })

    afterAll(async () => {
        await rm(tmpDir, { recursive: true, force: true })
    })

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('uploads every file and preserves input order', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        const result = await uploadAttachments([fileA, fileB], 42)

        expect(client.attachments.upload).toHaveBeenCalledTimes(2)
        expect(client.attachments.upload).toHaveBeenNthCalledWith(1, {
            file: expect.any(Blob),
            fileName: 'a.png',
            workspaceId: 42,
        })
        expect(client.attachments.upload).toHaveBeenNthCalledWith(2, {
            file: expect.any(Blob),
            fileName: 'b.pdf',
            workspaceId: 42,
        })
        expect(result.map((a) => a.fileName)).toEqual(['a.png', 'b.pdf'])
    })

    it('never uploads when any path is invalid (no partial uploads)', async () => {
        const client = createClient()
        apiMocks.getCommsClient.mockResolvedValue(client)

        await expect(
            uploadAttachments([fileA, join(tmpDir, 'missing.png'), fileB], 42),
        ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })

        expect(client.attachments.upload).not.toHaveBeenCalled()
    })
})
