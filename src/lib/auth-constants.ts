/** OS keyring `service` identifier for every comms-cli secret. */
export const SECURE_STORE_SERVICE = 'comms-cli'

/**
 * The CLI's OAuth `client_id`: the URL of its client ID metadata document
 * (`oauth/client-metadata.json`). Todoist fetches the document from exactly
 * this URL (no redirects), requires its `client_id` field to equal the URL,
 * and binds every token it issues to that client, so refreshing those tokens
 * depends on the file staying where it is. Never move, rename, or delete it.
 */
export const OAUTH_CLIENT_ID =
    'https://raw.githubusercontent.com/Doist/comms-cli/main/oauth/client-metadata.json'

/**
 * Icon shown on the local auth result pages, and the `logo_uri` in the client
 * metadata document. Todoist re-reads the document, but OAuth clients that
 * earlier versions registered through DCR keep the URL they registered with,
 * so never rename or delete the file behind it. (1.0.0 to 1.4.0 used a
 * commit-pinned URL that no longer resolves, and 3.6.1 to 3.6.4 registered
 * `icons/comms-cli_512px.png`, since removed, so those clients show Todoist's
 * fallback icon.)
 */
export const LOGO_URI = 'https://raw.githubusercontent.com/doist/comms-cli/main/icons/comms-cli.png'
