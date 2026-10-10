import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateGitDiff } from './git.js'
import { isSafeGitRef } from './git-validation.js'

let repo: string
let canaryDir: string
let firstSha: string

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim()

const canaryPath = () =>
  join(canaryDir, `pwned-${randomBytes(6).toString('hex')}`)

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'consult-llm-git-'))
  canaryDir = mkdtempSync(join(tmpdir(), 'consult-llm-canary-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'first')
  firstSha = git('rev-parse', 'HEAD')
  writeFileSync(join(repo, 'a.txt'), 'two\n')
  git('commit', '-q', '-am', 'second')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'a.txt'), 'three\n')
  git('commit', '-q', '-am', 'third')
  writeFileSync(join(repo, 'a.txt'), 'uncommitted\n')
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(canaryDir, { recursive: true, force: true })
})

describe('generateGitDiff', () => {
  it('returns an error string when no files are provided', () => {
    const result = generateGitDiff(repo, [])
    expect(result).toContain('Error generating git diff')
    expect(result).toContain('No files specified for git diff')
  })

  it('produces a real diff against HEAD by default', () => {
    const result = generateGitDiff(repo, ['a.txt'])
    expect(result).toContain('-three')
    expect(result).toContain('+uncommitted')
  })

  it.each([
    ['HEAD~2', '-one'],
    ['main', '-two'],
    ['main...feature', '-two'],
  ])('accepts base ref %s', (ref, expected) => {
    const result = generateGitDiff(repo, ['a.txt'], ref)
    expect(result).not.toContain('Error generating git diff')
    expect(result).toContain(expected)
  })

  it('accepts a commit SHA as base ref', () => {
    const result = generateGitDiff(repo, ['a.txt'], firstSha)
    expect(result).toContain('-one')
    expect(result).toContain('+uncommitted')
  })

  it('wraps git errors with a helpful prefix', () => {
    const result = generateGitDiff(repo, ['a.txt'], 'no-such-ref')
    expect(result).toContain('Error generating git diff')
  })

  it.each([
    (p: string) => `HEAD; touch ${p}`,
    (p: string) => `$(touch ${p})`,
    (p: string) => `\`touch ${p}\``,
    (p: string) => `HEAD && touch ${p}`,
    (p: string) => `HEAD | touch ${p}`,
  ])('does not execute shell metacharacters in base_ref (%#)', (build) => {
    const canary = canaryPath()
    const result = generateGitDiff(repo, ['a.txt'], build(canary))
    expect(result).toContain('Error generating git diff')
    expect(existsSync(canary)).toBe(false)
  })

  it.each([
    (p: string) => `a.txt; touch ${p}`,
    (p: string) => `$(touch ${p})`,
    (p: string) => `\`touch ${p}\``,
  ])('does not execute shell metacharacters in files (%#)', (build) => {
    const canary = canaryPath()
    generateGitDiff(repo, [build(canary)])
    expect(existsSync(canary)).toBe(false)
  })

  it('rejects option-like base_ref such as --output=<path>', () => {
    const canary = canaryPath()
    const result = generateGitDiff(repo, ['a.txt'], `--output=${canary}`)
    expect(result).toContain('Error generating git diff')
    expect(result).toContain('Invalid base_ref')
    expect(existsSync(canary)).toBe(false)
  })

  it('treats option-like file names as paths, not options', () => {
    const canary = canaryPath()
    generateGitDiff(repo, [`--output=${canary}`])
    expect(existsSync(canary)).toBe(false)
  })

  it('rejects file paths containing NUL bytes', () => {
    const result = generateGitDiff(repo, ['a.txt\0b'])
    expect(result).toContain('Error generating git diff')
    expect(result).toContain('NUL')
  })

  it('does not interpret shell metacharacters in repo_path', () => {
    const canary = canaryPath()
    const result = generateGitDiff(`${repo}; touch ${canary}`, ['a.txt'])
    expect(result).toContain('Error generating git diff')
    expect(existsSync(canary)).toBe(false)
  })
})

describe('isSafeGitRef', () => {
  it.each([
    'HEAD',
    'HEAD~3',
    'HEAD^',
    'HEAD@{1}',
    'origin/main',
    'main...feature',
    'main..feature',
    'v1.2.3',
    'release/2.0-rc_1',
    'deadbeef',
    '0123456789abcdef0123456789abcdef01234567',
  ])('accepts %s', (ref) => {
    expect(isSafeGitRef(ref)).toBe(true)
  })

  it.each([
    '',
    '-p',
    '--output=/tmp/x',
    'HEAD; touch /tmp/x',
    '$(id)',
    '`id`',
    'HEAD && id',
    'HEAD|id',
    'HEAD id',
    'HEAD\nid',
    'HEAD\0',
    "HEAD'",
    'HEAD"',
    'a'.repeat(257),
  ])('rejects %j', (ref) => {
    expect(isSafeGitRef(ref)).toBe(false)
  })
})
