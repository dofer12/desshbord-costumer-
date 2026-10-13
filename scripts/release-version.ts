// Works out which version a release build carries, and fails the build on a mismatch.
//   node scripts/release-version.ts v0.1.0   -> verifies the tag matches package.json
//   node scripts/release-version.ts          -> uses package.json (manual builds)
// Prints `key=value` lines, ready to append to $GITHUB_OUTPUT.
import { readFileSync } from 'node:fs'

export interface ReleaseVersion {
  version: string
  androidVersionCode: number
}

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/

/** "v1.2.3" becomes version "1.2.3" plus an Android versionCode that grows with every release. */
export function parseReleaseTag(tag: string): ReleaseVersion {
  const match = TAG.exec(tag)
  if (!match) throw new Error(`"${tag}" is not a release tag such as v1.2.3`)
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (major > 2000 || minor > 999 || patch > 999) {
    throw new Error(`"${tag}" is outside the supported range (major up to 2000, minor and patch up to 999)`)
  }
  return {
    version: `${major}.${minor}.${patch}`,
    androidVersionCode: major * 1_000_000 + minor * 1_000 + patch,
  }
}

/** The version to build: the pushed tag when there is one (it must match package.json), else package.json. */
export function resolveRelease(tag: string | undefined, packageVersion: string): ReleaseVersion {
  const fromPackage = parseReleaseTag(`v${packageVersion}`)
  if (!tag) return fromPackage
  const fromTag = parseReleaseTag(tag)
  if (fromTag.version !== fromPackage.version) {
    throw new Error(
      `Tag ${tag} does not match package.json version ${packageVersion}. Bump package.json before tagging.`,
    )
  }
  return fromTag
}

if (import.meta.main) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  try {
    const release = resolveRelease(process.argv[2] || undefined, pkg.version)
    console.log(`version=${release.version}`)
    console.log(`android_version_code=${release.androidVersionCode}`)
  } catch (err) {
    console.error(`::error::${(err as Error).message}`)
    process.exit(1)
  }
}
