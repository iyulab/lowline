// What a failed shell command can say went wrong, as the shell's own test wrote it, read against the UI's list: a
// kind the shell adds or renames would otherwise reach a view that never branches on it.
import { describe, expect, it } from 'vitest'
import { VAULT_FAILURE_KINDS } from '../vault-client.js'
import file from './shell-failure-kinds.json'

describe('the kinds of a failed shell command', () => {
  it('are the ones the UI knows, and no more', () => {
    expect([...VAULT_FAILURE_KINDS].sort()).toEqual([...file].sort())
  })
})
