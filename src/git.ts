import { execFileSync } from 'node:child_process'
import { hasNulByte, isSafeGitRef } from './git-validation.js'

export function generateGitDiff(
  repoPath: string | undefined,
  files: string[],
  baseRef: string = 'HEAD',
): string {
  try {
    const repo = repoPath || process.cwd()
    if (files.length === 0) {
      throw new Error('No files specified for git diff')
    }
    if (!isSafeGitRef(baseRef)) {
      throw new Error(`Invalid base_ref: ${JSON.stringify(baseRef)}`)
    }
    if (files.some(hasNulByte) || hasNulByte(repo)) {
      throw new Error('Paths must not contain NUL bytes')
    }

    // No shell: arguments are passed to git verbatim. Files follow '--', so
    // git treats them as pathspecs even if they start with '-'.
    return execFileSync('git', ['diff', baseRef, '--', ...files], {
      cwd: repo,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    })
  } catch (error) {
    return `Error generating git diff: ${error instanceof Error ? error.message : String(error)}`
  }
}
