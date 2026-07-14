import { Command } from 'commander'
import { CliError } from '../lib/errors.js'
import { classifyCommsUrl } from '../lib/refs.js'

function extractViewInvocation(parsedUrl: string): {
    url: string
    passthroughArgs: string[]
} {
    const rawArgs = process.argv
    const viewIdx = rawArgs.indexOf('view')
    const afterView = viewIdx >= 0 ? rawArgs.slice(viewIdx + 1) : []
    const passthroughArgs = afterView.filter((arg: string) => arg !== parsedUrl)
    return { url: parsedUrl, passthroughArgs }
}

async function runRoutedCommand(
    loadRegister: () => Promise<(p: Command) => void>,
    argv: string[],
): Promise<void> {
    const proxy = new Command()
    proxy.exitOverride()
    const register = await loadRegister()
    register(proxy)
    await proxy.parseAsync(['node', 'tdc', ...argv])
}

export function registerViewCommand(program: Command): void {
    program
        .command('view <url> [args...]')
        .description('View any Comms entity by URL')
        .allowUnknownOption(true)
        .addHelpText(
            'after',
            `
Route mapping:
  Message URL      → tdc msg view <url>
  Conversation URL → tdc conversation view <url>
  Comment URL      → tdc thread view <url>  (comment ID extracted from URL)
  Thread URL       → tdc thread view <url>

Examples:
  tdc view https://comms.todoist.com/1585/ch/CbC8n2Kp4Qx6Rz9Lm3Va/t/CbT8n2Kp4Qx6Rz9Lm3Va
  tdc view https://comms.todoist.com/a/1585/ch/CbC8n2Kp4Qx6Rz9Lm3Va/t/CbT8n2Kp4Qx6Rz9Lm3Va
  tdc view https://comms.todoist.com/a/1585/ch/CbC8n2Kp4Qx6Rz9Lm3Va/t/CbT8n2Kp4Qx6Rz9Lm3Va/c/CbM8n2Kp4Qx6Rz9Lm3Va
  tdc view https://comms.todoist.com/a/1585/msg/CbV8n2Kp4Qx6Rz9Lm3Va
  tdc view https://comms.todoist.com/a/1585/msg/CbV8n2Kp4Qx6Rz9Lm3Va/m/CbS8n2Kp4Qx6Rz9Lm3Va
  tdc view https://comms.todoist.com/a/1585/msg/CbV8n2Kp4Qx6Rz9Lm3Va/m/CbS8n2Kp4Qx6Rz9Lm3Va --json`,
        )
        .action(async (url: string) => {
            const urlHints = [
                'Expected: https://comms.todoist.com/{workspaceId}/... or https://comms.todoist.com/a/{workspaceId}/...',
                'Run: tdc view --help for examples',
            ]

            const { url: resolvedUrl, passthroughArgs } = extractViewInvocation(url)

            const route = classifyCommsUrl(resolvedUrl)
            if (!route) {
                throw new CliError(
                    'INVALID_URL',
                    `Not a recognized Comms URL: ${resolvedUrl}`,
                    urlHints,
                )
            }

            switch (route.entityType) {
                case 'thread':
                    await runRoutedCommand(
                        async () => (await import('./thread/index.js')).registerThreadCommand,
                        ['thread', 'view', resolvedUrl, ...passthroughArgs],
                    )
                    break
                case 'comment':
                    await runRoutedCommand(
                        async () => (await import('./thread/index.js')).registerThreadCommand,
                        ['thread', 'view', resolvedUrl, ...passthroughArgs],
                    )
                    break
                case 'conversation':
                    await runRoutedCommand(
                        async () =>
                            (await import('./conversation/index.js')).registerConversationCommand,
                        ['conversation', 'view', resolvedUrl, ...passthroughArgs],
                    )
                    break
                case 'message':
                    await runRoutedCommand(
                        async () => (await import('./msg/index.js')).registerMsgCommand,
                        ['msg', 'view', resolvedUrl, ...passthroughArgs],
                    )
                    break
            }
        })
}
