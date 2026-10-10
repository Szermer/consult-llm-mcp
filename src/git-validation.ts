const MAX_REF_LENGTH = 256

// Conservative allowlist for revisions: branch/tag names, SHAs, ~N / ^N
// suffixes, @{N} reflog selectors and A..B / A...B ranges. No whitespace or
// shell metacharacters, and never a leading '-' (which git would parse as an
// option, e.g. --output=<path> writes a file).
const SAFE_REF_PATTERN = /^[A-Za-z0-9_./~^@{}+-]+$/

export function isSafeGitRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    ref.length <= MAX_REF_LENGTH &&
    !ref.startsWith('-') &&
    SAFE_REF_PATTERN.test(ref)
  )
}

export function hasNulByte(value: string): boolean {
  return value.includes('\0')
}
