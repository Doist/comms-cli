import packageJson from '../../package.json' with { type: 'json' }

/** Attribution headers Comms uses to slice traffic by client and release. */
export const DOIST_ATTRIBUTION_HEADERS = {
    'Doist-Platform': 'cli',
    'Doist-Version': packageJson.version,
} as const
