import { CliError } from './errors.js'

export function validateNonEmptyName(name: string, entityLabel: string): void {
    if (!name || name.trim() === '') {
        throw new CliError('INVALID_NAME', `${entityLabel} name cannot be empty.`)
    }
}
