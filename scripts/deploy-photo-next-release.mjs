#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER_RELATIVE_PATH = 'scripts/deploy-photo-next-release.mjs'
const RUNNER_PATH = resolve(ROOT, RUNNER_RELATIVE_PATH)
const SDD_DIR = resolve(ROOT, '.superpowers/sdd')
const DEPLOYMENT_LOCK_PATH = resolve(SDD_DIR, 'photo-next-release.lock')
const SUPABASE = resolve(ROOT, 'node_modules/.bin/supabase')
const WRANGLER = resolve(ROOT, 'node_modules/.bin/wrangler')
const NUXT_ENTRY = resolve(ROOT, 'node_modules/nuxt/bin/nuxt.mjs')
const WRANGLER_CLI_SOURCE = resolve(ROOT, 'node_modules/wrangler/wrangler-dist/cli.js')
const PROJECT_REF = 'ifourklrmnswileplgir'
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`
const BRANCH = 'feature/photo-next-mvp'
const UPSTREAM = `origin/${BRANCH}`
const PRIVATE_MODE = 0o600
const ARTIFACT_SCAN_CHUNK_BYTES = 64 * 1024
const ADMIN_PASSWORD_ONLY_MARKER = 'ADMIN / PASSWORD ACCESS'
const WORKERS = Object.freeze({
  staging: 'photo-next-mvp-staging',
  production: 'photo-next-mvp',
})
const REQUIRED_SECRET_NAMES = Object.freeze([
  'NUXT_PUBLIC_SUPABASE_URL',
  'NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NUXT_SUPABASE_SECRET_KEY',
  'NUXT_NAME_HMAC_KEY',
  'NUXT_PHONE_HMAC_KEY',
  'NUXT_PHONE_ENCRYPTION_KEY',
  'NUXT_PASSWORD_PEPPER',
  'NUXT_PASSWORD_PEPPER_VERSION',
])
const RELEASE_SECRET_NAME = 'GIT_COMMIT_SHA'
const BUILD_OS_ENVIRONMENT_NAMES = Object.freeze([
  'HOME',
  'PATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'SHELL',
  'USER',
  'LOGNAME',
])
const activeTemporaryPaths = new Set()
const activeTemporaryIdentities = new Map()
let ownedDeploymentLock = null

class SafeReleaseError extends Error {}

const fail = message => {
  throw new SafeReleaseError(message)
}

const assert = (condition, message) => {
  if (!condition) fail(message)
}

const stripAnsi = value => value.replace(
  new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu'),
  '',
)

const parseCliJson = raw => {
  const cleaned = stripAnsi(raw).trim()
  try {
    return JSON.parse(cleaned)
  }
  catch {
    for (const [opening, closing] of [['[', ']'], ['{', '}']]) {
      const start = cleaned.indexOf(opening)
      const end = cleaned.lastIndexOf(closing)
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1))
        }
        catch {
          // Try the other JSON container shape before failing closed.
        }
      }
    }
  }
  fail('CLI JSON 응답을 안전하게 해석하지 못했습니다.')
}

const stringValue = (value, keys) => {
  for (const key of keys) {
    const candidate = value?.[key]
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return ''
}

const commandEnvironment = (sourceEnvironment = process.env) => {
  const environment = withoutInheritedPrivateEnvironment(sourceEnvironment)
  delete environment.CLOUDFLARE_ENV
  delete environment.CLOUDFLARE_INCLUDE_PROCESS_ENV
  environment.CI = '1'
  environment.WRANGLER_SEND_METRICS = 'false'
  return environment
}

const withoutInheritedPrivateEnvironment = (sourceEnvironment = process.env) => {
  const environment = { ...sourceEnvironment }
  for (const name of Object.keys(environment)) {
    if (name.startsWith('NUXT_') || name.includes('OPENAI')) delete environment[name]
  }
  return environment
}

const buildEnvironment = (
  publishableKey,
  commit,
  sourceEnvironment = process.env,
) => {
  const environment = {}
  for (const name of BUILD_OS_ENVIRONMENT_NAMES) {
    const value = sourceEnvironment[name]
    if (typeof value === 'string' && value !== '') environment[name] = value
  }
  return {
    ...environment,
    NUXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    GIT_COMMIT_SHA: commit,
    NODE_ENV: 'production',
    CI: '1',
  }
}

const runCapture = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: commandEnvironment(options.env ?? process.env),
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  })
  if (result.error) fail(`${options.label ?? '명령'}을 시작하지 못했습니다.`)
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const runVisible = (command, args, options = {}, spawnAdapter = spawnSync) => {
  const result = spawnAdapter(command, args, {
    cwd: ROOT,
    env: options.env ?? commandEnvironment(process.env),
    stdio: 'inherit',
    timeout: options.timeout ?? 10 * 60_000,
  })
  if (result.error || result.status !== 0) {
    fail(`${options.label ?? '명령'}이 완료되지 않았습니다.`)
  }
  return result
}

const gitCapture = (args, runner = runCapture) => {
  const result = runner('git', args, { label: 'Git 확인' })
  assert(result.status === 0, 'Git 저장소 상태를 확인하지 못했습니다.')
  return result.stdout.trim()
}

const parseTrackedFileFlags = raw => raw
  .split('\0')
  .filter(entry => entry !== '')
  .map((entry) => {
    assert(entry.length >= 3 && entry[1] === ' ', 'Git tracked provenance 형식이 잘못되었습니다.')
    return { flag: entry[0], path: entry.slice(2) }
  })

const verifyGitPreflight = (runner = runCapture, runnerPath = fileURLToPath(import.meta.url)) => {
  assert(
    runnerPath === RUNNER_PATH,
    'release runner는 Git에 추적되는 scripts 경로에서만 실행할 수 있습니다.',
  )
  const listed = runner('git', ['ls-files', '-v', '-z'], { label: 'tracked provenance 확인' })
  assert(listed.status === 0, 'tracked provenance를 확인하지 못했습니다.')
  const tracked = parseTrackedFileFlags(listed.stdout)
  assert(tracked.length > 0, 'tracked 파일 목록이 비어 있습니다.')
  assert(
    tracked.every(entry => entry.flag === 'H'),
    'assume-unchanged 또는 skip-worktree tracked 파일이 있습니다.',
  )
  const staged = runner(
    'git',
    ['diff', '--quiet', '--no-ext-diff', '--cached', 'HEAD', '--'],
    { label: 'staged diff 확인' },
  )
  assert(staged.status === 0, 'HEAD와 index가 다릅니다.')
  const working = runner(
    'git',
    ['diff', '--quiet', '--no-ext-diff', '--'],
    { label: 'working tree 확인' },
  )
  assert(working.status === 0, 'tracked working tree가 깨끗하지 않습니다.')

  const branch = gitCapture(['branch', '--show-current'], runner)
  const commit = gitCapture(['rev-parse', 'HEAD'], runner)
  const upstream = gitCapture(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], runner)
  const upstreamCommit = gitCapture(['rev-parse', '@{upstream}'], runner)
  assert(branch === BRANCH, `release branch는 ${BRANCH}여야 합니다.`)
  assert(upstream === UPSTREAM, `upstream은 ${UPSTREAM}이어야 합니다.`)
  assert(commit === upstreamCommit, '현재 HEAD와 upstream이 다릅니다. commit/push를 먼저 완료하세요.')

  const trackedRunner = runner(
    'git',
    ['ls-files', '--error-unmatch', RUNNER_RELATIVE_PATH],
    { label: 'release runner 추적 확인' },
  )
  const workingBlob = runner(
    'git',
    ['hash-object', RUNNER_RELATIVE_PATH],
    { label: 'release runner working blob 확인' },
  )
  const headBlob = runner(
    'git',
    ['rev-parse', `HEAD:${RUNNER_RELATIVE_PATH}`],
    { label: 'release runner HEAD blob 확인' },
  )
  assert(trackedRunner.status === 0, 'release runner가 Git 추적 대상이 아닙니다.')
  assert(
    workingBlob.status === 0
      && headBlob.status === 0
      && workingBlob.stdout.trim() === headBlob.stdout.trim(),
    '실행 중인 release runner가 현재 HEAD의 blob과 다릅니다.',
  )
  return { branch, commit }
}

const privateStat = path => {
  const linkStat = lstatSync(path)
  assert(!linkStat.isSymbolicLink(), 'release 임시 파일은 심볼릭 링크일 수 없습니다.')
  assert(linkStat.isFile(), 'release 임시 경로가 일반 파일이 아닙니다.')
  assert((linkStat.mode & 0o777) === PRIVATE_MODE, 'release 임시 파일 권한은 0600이어야 합니다.')
  if (typeof process.getuid === 'function') {
    assert(linkStat.uid === process.getuid(), 'release 임시 파일 소유자가 현재 사용자와 다릅니다.')
  }
  return linkStat
}

const secureOpenDescriptor = descriptor => {
  fchmodSync(descriptor, PRIVATE_MODE)
  const descriptorStat = fstatSync(descriptor)
  assert(descriptorStat.isFile(), '열린 release descriptor가 일반 파일이 아닙니다.')
  assert((descriptorStat.mode & 0o777) === PRIVATE_MODE, '열린 release descriptor 권한은 0600이어야 합니다.')
  if (typeof process.getuid === 'function') {
    assert(descriptorStat.uid === process.getuid(), '열린 release descriptor 소유자가 현재 사용자와 다릅니다.')
  }
  return descriptorStat
}

const assertPathMatchesDescriptor = (path, descriptorStat) => {
  const pathStat = lstatSync(path)
  assert(!pathStat.isSymbolicLink(), 'release 파일 경로가 심볼릭 링크로 바뀌었습니다.')
  assert(pathStat.isFile(), 'release 파일 경로가 일반 파일이 아닙니다.')
  assert(
    pathStat.dev === descriptorStat.dev && pathStat.ino === descriptorStat.ino,
    'release 파일 경로가 열린 descriptor와 다른 파일로 교체되었습니다.',
  )
  assert((pathStat.mode & 0o777) === PRIVATE_MODE, 'release 파일 경로 권한은 0600이어야 합니다.')
  if (typeof process.getuid === 'function') {
    assert(pathStat.uid === process.getuid(), 'release 파일 경로 소유자가 현재 사용자와 다릅니다.')
  }
  return pathStat
}

const safeUnlink = path => {
  try {
    if (!existsSync(path)) return
    const expected = activeTemporaryIdentities.get(path)
    if (expected) assertPathMatchesDescriptor(path, expected)
    else privateStat(path)
    unlinkSync(path)
  }
  finally {
    activeTemporaryPaths.delete(path)
    activeTemporaryIdentities.delete(path)
  }
}

const cleanupTemporaryCommitFiles = (directory = SDD_DIR) => {
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory)) {
    if (!/^\.photo-next-release-commit-(?:staging|production|self-check)-[A-Za-z0-9-]+\.json$/u.test(name)) continue
    safeUnlink(resolve(directory, name))
  }
}

const acquireDeploymentLock = () => {
  mkdirSync(SDD_DIR, { recursive: true })
  const token = randomUUID()
  let descriptor
  let descriptorStat
  let created = false
  try {
    descriptor = openSync(DEPLOYMENT_LOCK_PATH, 'wx', PRIVATE_MODE)
    created = true
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`, 'utf8')
    descriptorStat = secureOpenDescriptor(descriptor)
  }
  catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      }
      catch {
        // The original lock acquisition failure remains authoritative.
      }
    }
    if (created && existsSync(DEPLOYMENT_LOCK_PATH)) unlinkSync(DEPLOYMENT_LOCK_PATH)
    if (error?.code === 'EEXIST') fail('다른 PHOTO:NEXT release가 이미 진행 중입니다.')
    throw error
  }
  closeSync(descriptor)
  const fileStat = assertPathMatchesDescriptor(DEPLOYMENT_LOCK_PATH, descriptorStat)
  ownedDeploymentLock = {
    path: DEPLOYMENT_LOCK_PATH,
    token,
    device: fileStat.dev,
    inode: fileStat.ino,
  }
  return ownedDeploymentLock
}

const releaseDeploymentLock = (lock = ownedDeploymentLock, strict = true) => {
  if (!lock) return
  if (!existsSync(lock.path)) {
    if (strict) fail('소유한 release lock이 사라졌습니다.')
    return
  }
  const linkStat = lstatSync(lock.path)
  if (linkStat.isSymbolicLink()) {
    if (strict) fail('release lock이 심볼릭 링크로 바뀌었습니다.')
    return
  }
  const fileStat = linkStat
  let stored
  try {
    stored = JSON.parse(readFileSync(lock.path, 'utf8'))
  }
  catch {
    if (strict) fail('release lock 내용이 바뀌었습니다.')
    return
  }
  const owned = fileStat.isFile()
    && fileStat.dev === lock.device
    && fileStat.ino === lock.inode
    && stored?.token === lock.token
  if (!owned) {
    if (strict) fail('소유하지 않은 release lock은 삭제하지 않습니다.')
    return
  }
  unlinkSync(lock.path)
  if (ownedDeploymentLock === lock) ownedDeploymentLock = null
}

const writeCommitSecretFile = (environment, commit, directory = SDD_DIR) => {
  mkdirSync(directory, { recursive: true })
  const temporaryPath = resolve(
    directory,
    `.photo-next-release-commit-${environment}-${process.pid}-${randomUUID()}.json`,
  )
  const descriptor = openSync(temporaryPath, 'wx', PRIVATE_MODE)
  activeTemporaryPaths.add(temporaryPath)
  let descriptorStat
  try {
    writeFileSync(descriptor, `${JSON.stringify({ GIT_COMMIT_SHA: commit })}\n`, 'utf8')
    descriptorStat = secureOpenDescriptor(descriptor)
  }
  finally {
    closeSync(descriptor)
  }
  assertPathMatchesDescriptor(temporaryPath, descriptorStat)
  activeTemporaryIdentities.set(temporaryPath, descriptorStat)
  return temporaryPath
}

const withCommitSecretFile = (environment, commit, callback, directory = SDD_DIR) => {
  const path = writeCommitSecretFile(environment, commit, directory)
  try {
    return callback(path)
  }
  finally {
    safeUnlink(path)
  }
}

const parseWranglerSecretNames = raw => {
  const parsed = parseCliJson(raw)
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.data)
      ? parsed.data
      : null
  assert(rows !== null, 'Wrangler secret 목록 형식이 잘못되었습니다.')
  const names = rows.map((row) => {
    assert(row !== null && typeof row === 'object' && !Array.isArray(row), 'Wrangler secret 행 형식이 잘못되었습니다.')
    const name = stringValue(row, ['name'])
    assert(name !== '', 'Wrangler secret 이름이 비어 있습니다.')
    return name
  })
  assert(new Set(names).size === names.length, 'Wrangler secret 이름이 중복되었습니다.')
  return names
}

const isForbiddenProviderSecretName = name => /OPENAI/iu.test(name)

const verifySecretNameContract = (names, options = {}) => {
  const present = new Set(names)
  const missing = REQUIRED_SECRET_NAMES.filter(name => !present.has(name))
  assert(missing.length === 0, `필수 Worker secret 이름이 없습니다: ${missing.join(', ')}`)
  const forbidden = names.filter(isForbiddenProviderSecretName)
  assert(forbidden.length === 0, `provider-off 계약을 위반한 secret 이름이 있습니다: ${forbidden.join(', ')}`)
  if (options.requireCommit) {
    assert(present.has(RELEASE_SECRET_NAME), '배포 후 GIT_COMMIT_SHA secret 이름이 없습니다.')
  }
}

const workerTargetArguments = environment => (
  environment === 'staging' ? ['--env', 'staging'] : []
)

const listWorkerSecretNames = (environment, runner = runCapture) => {
  const result = runner(
    WRANGLER,
    ['secret', 'list', '--format', 'json', ...workerTargetArguments(environment)],
    { label: `${environment} Worker secret 이름 확인`, timeout: 120_000 },
  )
  assert(result.status === 0, `${environment} Worker secret 이름을 확인하지 못했습니다.`)
  return parseWranglerSecretNames(result.stdout)
}

const verifyRemoteSecretContract = (environment, options = {}, runner = runCapture) => {
  const names = listWorkerSecretNames(environment, runner)
  verifySecretNameContract(names, options)
}

const parseSupabasePublishableKey = raw => {
  const parsed = parseCliJson(raw)
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.api_keys)
        ? parsed.api_keys
        : Array.isArray(parsed?.keys)
          ? parsed.keys
          : []
  const candidates = rows
    .filter(row => row !== null && typeof row === 'object' && !Array.isArray(row))
    .map(row => ({
      label: [
        stringValue(row, ['name']),
        stringValue(row, ['type']),
        stringValue(row, ['role']),
        stringValue(row, ['description']),
      ].join(' ').toLowerCase(),
      value: stringValue(row, ['api_key', 'key', 'value', 'token']),
    }))
    .filter(candidate => candidate.value !== '')
  const publishable = candidates.find(candidate => candidate.value.startsWith('sb_publishable_'))
    ?? candidates.find(candidate => /\bpublishable\b/u.test(candidate.label))
    ?? candidates.find(candidate => /\banon(?:ymous)?\b/u.test(candidate.label))
  assert(publishable?.value, 'Supabase publishable/anon key를 찾지 못했습니다.')
  return publishable.value
}

const verifySupabaseAuthentication = () => {
  const result = runCapture(SUPABASE, [
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--output',
    'json',
    '--agent',
    'no',
  ], {
    label: 'Supabase 로그인 및 publishable key 확인',
    timeout: 120_000,
  })
  assert(
    result.status === 0,
    'Supabase 인증을 확인하지 못했습니다. 일반 Terminal의 Supabase 로그인을 확인하세요.',
  )
  return parseSupabasePublishableKey(result.stdout)
}

const verifyCloudflareAuthentication = () => {
  const result = runCapture(WRANGLER, ['whoami', '--json'], {
    label: 'Cloudflare 로그인 확인',
    timeout: 120_000,
  })
  assert(
    result.status === 0,
    'Cloudflare 인증을 확인하지 못했습니다. 일반 Terminal의 Wrangler 로그인을 확인하세요.',
  )
  parseCliJson(result.stdout)
}

const deployArguments = (environment, secretsPath, commit) => [
  'deploy', '--keep-vars', '--secrets-file', secretsPath,
  '--message', `Release ${commit}`,
  ...workerTargetArguments(environment),
]

const isWorkerUrl = (value, workerName) => {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && url.hostname.startsWith(`${workerName}.`)
      && url.hostname.endsWith('.workers.dev')
  }
  catch {
    return false
  }
}

const parseWorkerUrl = (raw, workerName) => {
  const candidates = stripAnsi(raw).match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev(?:\/[^\s"'<>]*)?/gu) ?? []
  for (const candidate of candidates) {
    const normalized = candidate.replace(/[),.;]+$/u, '')
    if (isWorkerUrl(normalized, workerName)) return new URL(normalized).origin
  }
  fail('Cloudflare 배포 출력에서 유효한 workers.dev URL을 확인하지 못했습니다.')
}

const isCredentialEnvironmentName = name => (
  name.startsWith('NUXT_')
  || /OPENAI/iu.test(name)
  || /(?:TOKEN|SECRET|PASSWORD|DATABASE_URL|CREDENTIAL|COOKIE|HMAC|PEPPER)/iu.test(name)
  || /(?:^|_)KEY(?:_|$)/iu.test(name)
)

const inheritedPrivateMarkers = (sourceEnvironment = process.env) => Object.entries(sourceEnvironment)
  .filter(([name, value]) => (
    typeof value === 'string'
    && value.length >= 4
    && isCredentialEnvironmentName(name)
  ))
  .map(([, value]) => value)

const fileContainsMarker = (path, markerBuffers) => {
  if (markerBuffers.length === 0) return false
  const descriptor = openSync(path, 'r')
  const chunk = Buffer.allocUnsafe(ARTIFACT_SCAN_CHUNK_BYTES)
  const overlapBytes = Math.max(...markerBuffers.map(marker => marker.byteLength)) - 1
  let overlap = Buffer.alloc(0)
  try {
    while (true) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) return false
      const current = overlap.byteLength === 0
        ? chunk.subarray(0, bytesRead)
        : Buffer.concat([overlap, chunk.subarray(0, bytesRead)])
      if (markerBuffers.some(marker => current.includes(marker))) return true
      overlap = Buffer.from(current.subarray(Math.max(0, current.byteLength - overlapBytes)))
    }
  }
  finally {
    closeSync(descriptor)
  }
}

const artifactTreeContainsMarker = (root, markers) => {
  assert(existsSync(root), `필수 build artifact가 없습니다: ${root}`)
  const markerBuffers = [...new Set(markers)]
    .filter(marker => typeof marker === 'string' && marker.length > 0)
    .map(marker => Buffer.from(marker))
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    const linkStat = lstatSync(current)
    assert(!linkStat.isSymbolicLink(), 'build artifact scan은 심볼릭 링크를 허용하지 않습니다.')
    if (linkStat.isDirectory()) {
      for (const name of readdirSync(current)) pending.push(resolve(current, name))
    }
    else if (linkStat.isFile() && fileContainsMarker(current, markerBuffers)) {
      return true
    }
  }
  return false
}

const verifyArtifactRoots = (publicRoot, serverRoot, privateMarkers) => {
  const publicForbiddenMarkers = [
    ...privateMarkers,
    'NUXT_SUPABASE_SECRET_KEY',
    'NUXT_NAME_HMAC_KEY',
    'NUXT_PHONE_HMAC_KEY',
    'NUXT_PHONE_ENCRYPTION_KEY',
    'NUXT_PASSWORD_PEPPER',
    'NUXT_PASSWORD_PEPPER_VERSION',
    'OPENAI',
    'OPENAI_API_KEY',
    'OPENAI_SAFETY_HMAC_KEY',
    'PHOTO_NEXT_OPENAI_EVAL_API_KEY',
    'server-test-key',
  ]
  assert(
    !artifactTreeContainsMarker(publicRoot, publicForbiddenMarkers),
    'public build artifact에서 private/provider marker를 발견했습니다.',
  )
  assert(
    !artifactTreeContainsMarker(serverRoot, privateMarkers),
    'server build artifact에서 상속된 private 값을 발견했습니다.',
  )
}

const verifyArtifacts = privateMarkers => verifyArtifactRoots(
  resolve(ROOT, '.output/public'),
  resolve(ROOT, '.output/server'),
  privateMarkers,
)

const assertNoLocalDotEnv = () => {
  const forbidden = readdirSync(ROOT)
    .filter(name => name === '.env' || (name.startsWith('.env.') && name !== '.env.example'))
  assert(forbidden.length === 0, `private-free build 전에 로컬 env 파일을 제거하세요: ${forbidden.join(', ')}`)
}

const verifyLocalStaticConfiguration = () => {
  for (const [label, path] of [
    ['Supabase CLI', SUPABASE],
    ['Wrangler CLI', WRANGLER],
    ['Nuxt entry', NUXT_ENTRY],
    ['Wrangler source', WRANGLER_CLI_SOURCE],
  ]) {
    assert(existsSync(path), `${label} 로컬 파일을 찾지 못했습니다.`)
  }
  const wranglerCli = readFileSync(WRANGLER_CLI_SOURCE, 'utf8')
  assert(wranglerCli.includes('Applies additively with secrets from previous deployments'), '설치된 Wrangler가 additive secrets-file 계약을 문서화하지 않습니다.')
  assert(wranglerCli.includes('Note that secrets are never deleted by deployments.'), '설치된 Wrangler가 secret 보존 계약을 문서화하지 않습니다.')
  const loginPage = readFileSync(resolve(ROOT, 'app/pages/admin/login.vue'), 'utf8')
  assert(loginPage.includes(ADMIN_PASSWORD_ONLY_MARKER), '관리자 password-only marker가 소스에 없습니다.')
  assert(!/one-time-code|TOTP|6자리|2단계/iu.test(loginPage), '관리자 로그인 소스에 MFA marker가 남았습니다.')
  assertNoLocalDotEnv()
}

const buildRelease = (publishableKey, commit, privateMarkers) => {
  console.log('2/6 private-free Nuxt production build')
  assertNoLocalDotEnv()
  runVisible(process.execPath, [NUXT_ENTRY, 'build'], {
    label: 'Nuxt production build',
    env: buildEnvironment(publishableKey, commit),
  })
  console.log('3/6 build artifact secret scan')
  verifyArtifacts(privateMarkers)
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

const fetchWithRetry = async (url, validator, label) => {
  let lastStatus = 'network'
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      })
      lastStatus = String(response.status)
      if (response.ok && await validator(response)) return
    }
    catch {
      lastStatus = 'network'
    }
    if (attempt < 7) await delay(Math.min(500 * 2 ** (attempt - 1), 4_000))
  }
  fail(`${label} smoke 검증에 실패했습니다 (마지막 상태: ${lastStatus}).`)
}

const healthMatchesCommit = (body, commit) => body?.ok === true && body?.commit === commit

const smokeDeployment = async (baseUrl, commit, label) => {
  await fetchWithRetry(`${baseUrl}/api/health`, async (response) => {
    const body = await response.json().catch(() => null)
    return healthMatchesCommit(body, commit)
  }, `${label} health/commit`)
  await fetchWithRetry(`${baseUrl}/`, async response => (await response.text()).length > 100, `${label} landing`)
  await fetchWithRetry(`${baseUrl}/api/assessment/options`, async (response) => {
    const body = await response.json().catch(() => null)
    return typeof body?.data?.catalogRevision === 'string'
      && Array.isArray(body?.data?.groups)
      && body.data.groups.length > 0
      && body.data.groups.every(group => Array.isArray(group?.options) && group.options.length > 0)
  }, `${label} assessment options`)
  await fetchWithRetry(`${baseUrl}/admin/login`, async (response) => {
    const body = await response.text()
    return body.includes(ADMIN_PASSWORD_ONLY_MARKER)
      && !/one-time-code|TOTP|6자리|2단계/iu.test(body)
  }, `${label} password-only admin login`)
}

const deployEnvironment = (environment, commit, adapters = {}) => {
  const run = adapters.run ?? runCapture
  const verify = adapters.verify ?? verifyRemoteSecretContract
  const withSecret = adapters.withSecret ?? withCommitSecretFile
  console.log(`${environment === 'staging' ? '4' : '5'}/6 ${environment} additive release`)
  const raw = withSecret(environment, commit, (secretsPath) => {
    const result = run(
      WRANGLER,
      deployArguments(environment, secretsPath, commit),
      {
        label: `${environment} release deploy`,
        timeout: 10 * 60_000,
      },
    )
    assert(result.status === 0, `${environment} release 배포에 실패했습니다. 민감 출력은 숨겼습니다.`)
    return `${result.stdout}\n${result.stderr}`
  })
  const url = parseWorkerUrl(raw, WORKERS[environment])
  verify(environment, { requireCommit: true })
  return url
}

const runReleaseSequence = async (commit, adapters = {}) => {
  const deploy = adapters.deploy ?? deployEnvironment
  const smoke = adapters.smoke ?? smokeDeployment
  const stagingUrl = await deploy('staging', commit)
  await smoke(stagingUrl, commit, 'staging')
  console.log(`- staging release와 smoke 검증 완료: ${stagingUrl}`)
  const productionUrl = await deploy('production', commit)
  await smoke(productionUrl, commit, 'production')
  console.log(`- production release와 smoke 검증 완료: ${productionUrl}`)
  return { stagingUrl, productionUrl }
}

const printPlan = () => {
  console.log('PHOTO:NEXT password-only 관리자 release 계획')
  console.log(`- Git: clean tracked ${BRANCH} HEAD == ${UPSTREAM}, runner HEAD blob 일치`)
  console.log('- 인증: 현재 Terminal HOME의 Supabase/Wrangler 인증을 값 출력 없이 확인')
  console.log('- 원격: staging/production 필수 secret 이름 존재 및 provider-off 확인')
  console.log('- build: Supabase public URL/publishable key와 현재 GIT_COMMIT_SHA만 앱 환경에 주입')
  console.log('- deploy: staging --keep-vars + additive commit secret → smoke → production → smoke')
  console.log('- 금지: DB push, 관리자 변경, 비밀 재생성/삭제/출력')
  console.log('Release plan check passed (network calls: 0, remote writes: 0).')
}

const runCheck = () => {
  verifyLocalStaticConfiguration()
  console.log('Release local check passed (network calls: 0, remote writes: 0).')
}

const runOfflineMode = (mode, adapters = {}) => {
  const plan = adapters.plan ?? printPlan
  const check = adapters.check ?? runCheck
  if (mode === '--plan') return plan()
  if (mode === '--check') return check()
  fail('지원하지 않는 offline mode입니다.')
}

const rejectsSafely = callback => {
  try {
    callback()
    return false
  }
  catch (error) {
    return error instanceof SafeReleaseError
  }
}

const rejectsSafelyAsync = async callback => {
  try {
    await callback()
    return false
  }
  catch (error) {
    return error instanceof SafeReleaseError
  }
}

const runSelfCheck = async () => {
  const requiredRows = REQUIRED_SECRET_NAMES.map(name => ({ name, type: 'secret_text' }))
  const names = parseWranglerSecretNames(`notice\n${JSON.stringify({ data: requiredRows })}`)
  verifySecretNameContract(names)
  assert(
    rejectsSafely(() => verifySecretNameContract(names.slice(1))),
    '필수 secret 누락을 거부하지 않았습니다.',
  )
  for (const forbiddenName of [
    'OPENAI_API_KEY',
    'NUXT_OPENAI_API_KEY',
    'MY_OPENAI_KEY',
    'prefix-openai-suffix',
  ]) {
    assert(
      rejectsSafely(() => verifySecretNameContract([...names, forbiddenName])),
      `provider secret 이름을 거부하지 않았습니다: ${forbiddenName}`,
    )
  }
  assert(
    rejectsSafely(() => parseWranglerSecretNames(JSON.stringify([...requiredRows, requiredRows[0]]))),
    '중복 secret 이름을 거부하지 않았습니다.',
  )
  const publishable = parseSupabasePublishableKey(JSON.stringify({
    data: [
      { name: 'publishable', api_key: 'sb_publishable_self_check' },
      { name: 'secret', api_key: 'must-never-be-printed' },
    ],
  }))
  assert(publishable === 'sb_publishable_self_check', 'Supabase publishable parser가 잘못되었습니다.')
  console.log('- secret parser: passed')

  let providerListCalls = 0
  const providerRunner = (command, args) => {
    assert(command === WRANGLER, 'provider contract가 Wrangler 외 명령을 호출했습니다.')
    assert(
      JSON.stringify(args) === JSON.stringify(['secret', 'list', '--format', 'json', '--env', 'staging']),
      'provider contract의 staging secret list argv가 잘못되었습니다.',
    )
    providerListCalls += 1
    const listedNames = providerListCalls === 1
      ? names
      : [...names, RELEASE_SECRET_NAME]
    return {
      status: 0,
      stdout: JSON.stringify(listedNames.map(name => ({ name }))),
      stderr: '',
    }
  }
  verifyRemoteSecretContract('staging', {}, providerRunner)
  verifyRemoteSecretContract('staging', { requireCommit: true }, providerRunner)
  assert(providerListCalls === 2, 'provider contract를 pre/post로 검증하지 않았습니다.')
  console.log('- provider pre/post behavior: passed')

  const deployPostVerifyCalls = []
  const fakeDeployUrl = `https://${WORKERS.staging}.self-check.workers.dev`
  const actualDeployUrl = deployEnvironment('staging', 'd'.repeat(40), {
    withSecret: (environment, commit, callback) => {
      assert(environment === 'staging', 'deployEnvironment가 잘못된 secret 환경을 요청했습니다.')
      assert(commit === 'd'.repeat(40), 'deployEnvironment가 잘못된 commit secret을 요청했습니다.')
      return callback('<self-check-commit-secret>')
    },
    run: (command, args) => {
      assert(command === WRANGLER, 'deployEnvironment가 Wrangler 외 명령을 실행했습니다.')
      assert(
        JSON.stringify(args) === JSON.stringify(deployArguments(
          'staging',
          '<self-check-commit-secret>',
          'd'.repeat(40),
        )),
        'deployEnvironment의 실제 deploy argv가 잘못되었습니다.',
      )
      return { status: 0, stdout: `Deployed ${fakeDeployUrl}`, stderr: '' }
    },
    verify: (environment, options) => {
      deployPostVerifyCalls.push([environment, options])
    },
  })
  assert(actualDeployUrl === fakeDeployUrl, 'deployEnvironment가 검증된 Worker URL을 반환하지 않았습니다.')
  assert(
    JSON.stringify(deployPostVerifyCalls) === JSON.stringify([
      ['staging', { requireCommit: true }],
    ]),
    'deployEnvironment가 post-deploy provider/commit contract를 정확히 호출하지 않았습니다.',
  )
  console.log('- deploy post-provider control flow: passed')

  const gitCommit = 'b'.repeat(40)
  const makeGitRunner = (overrides = {}) => (_command, args) => {
    const key = JSON.stringify(args)
    const responses = new Map([
      [JSON.stringify(['ls-files', '-v', '-z']), { status: 0, stdout: `H ${RUNNER_RELATIVE_PATH}\0`, stderr: '' }],
      [JSON.stringify(['diff', '--quiet', '--no-ext-diff', '--cached', 'HEAD', '--']), { status: overrides.staged ?? 0, stdout: '', stderr: '' }],
      [JSON.stringify(['diff', '--quiet', '--no-ext-diff', '--']), { status: overrides.dirty ?? 0, stdout: '', stderr: '' }],
      [JSON.stringify(['branch', '--show-current']), { status: 0, stdout: `${overrides.branch ?? BRANCH}\n`, stderr: '' }],
      [JSON.stringify(['rev-parse', 'HEAD']), { status: 0, stdout: `${gitCommit}\n`, stderr: '' }],
      [JSON.stringify(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']), { status: 0, stdout: `${overrides.upstream ?? UPSTREAM}\n`, stderr: '' }],
      [JSON.stringify(['rev-parse', '@{upstream}']), { status: 0, stdout: `${overrides.upstreamCommit ?? gitCommit}\n`, stderr: '' }],
      [JSON.stringify(['ls-files', '--error-unmatch', RUNNER_RELATIVE_PATH]), { status: 0, stdout: `${RUNNER_RELATIVE_PATH}\n`, stderr: '' }],
      [JSON.stringify(['hash-object', RUNNER_RELATIVE_PATH]), { status: 0, stdout: `${overrides.workingBlob ?? 'runner-blob'}\n`, stderr: '' }],
      [JSON.stringify(['rev-parse', `HEAD:${RUNNER_RELATIVE_PATH}`]), { status: 0, stdout: `${overrides.headBlob ?? 'runner-blob'}\n`, stderr: '' }],
    ])
    const response = responses.get(key)
    assert(response, `Git self-check에서 예상하지 못한 argv입니다: ${key}`)
    return response
  }
  verifyGitPreflight(makeGitRunner(), RUNNER_PATH)
  for (const overrides of [
    { staged: 1 },
    { dirty: 1 },
    { upstreamCommit: 'c'.repeat(40) },
    { upstream: 'origin/unapproved' },
    { headBlob: 'different-runner-blob' },
  ]) {
    assert(
      rejectsSafely(() => verifyGitPreflight(makeGitRunner(overrides), RUNNER_PATH)),
      `Git provenance mismatch를 거부하지 않았습니다: ${JSON.stringify(overrides)}`,
    )
  }
  console.log('- git fail-closed behavior: passed')

  const fakePath = '<mode-0600-temporary-json>'
  const fakeCommit = 'a'.repeat(40)
  assert(
    JSON.stringify(deployArguments('staging', fakePath, fakeCommit)) === JSON.stringify([
      'deploy', '--keep-vars', '--secrets-file', fakePath,
      '--message', `Release ${fakeCommit}`, '--env', 'staging',
    ]),
    'staging deploy argv가 정확하지 않습니다.',
  )
  assert(
    JSON.stringify(deployArguments('production', fakePath, fakeCommit)) === JSON.stringify([
      'deploy', '--keep-vars', '--secrets-file', fakePath,
      '--message', `Release ${fakeCommit}`,
    ]),
    'production deploy argv가 정확하지 않습니다.',
  )
  console.log('- deploy argv: passed')

  const inheritedBuildEnvironment = {
    HOME: '/user/home',
    PATH: '/bin',
    TMPDIR: '/private/tmp',
    LANG: 'ko_KR.UTF-8',
    LC_ALL: 'C',
    LC_CTYPE: 'UTF-8',
    LC_MESSAGES: 'C',
    LC_SECRET: 'private-locale-secret',
    LC_DATABASE_URL: 'private-locale-database-url',
    LC_OPENAI_API_KEY: 'private-locale-openai-key',
    NUXT_SUPABASE_SECRET_KEY: 'private-service-key',
    NUXT_PHONE_HMAC_KEY: 'private-phone-hmac',
    NUXT_PUBLIC_OTHER_VALUE: 'private-by-default',
    OPENAI_API_KEY: 'private-provider-key',
    PHOTO_NEXT_OPENAI_EVAL_API_KEY: 'private-eval-key',
    CLOUDFLARE_API_TOKEN: 'private-cloudflare-token',
    CLOUDFLARE_API_KEY: 'private-cloudflare-key',
    SUPABASE_ACCESS_TOKEN: 'private-supabase-token',
    DATABASE_URL: 'private-database-url',
    GENERIC_SECRET: 'private-generic-secret',
  }
  const safeBuild = buildEnvironment(
    'sb_publishable_self_check',
    fakeCommit,
    inheritedBuildEnvironment,
  )
  assert(safeBuild.HOME === '/user/home', 'build 환경이 사용자의 HOME을 보존하지 않았습니다.')
  assert(safeBuild.NUXT_PUBLIC_SUPABASE_URL === SUPABASE_URL, 'build 환경에 public Supabase URL이 없습니다.')
  assert(safeBuild.NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === 'sb_publishable_self_check', 'build 환경에 publishable key가 없습니다.')
  assert(safeBuild.GIT_COMMIT_SHA === fakeCommit, 'build 환경에 현재 commit이 없습니다.')
  for (const forbiddenName of [
    'NUXT_SUPABASE_SECRET_KEY',
    'NUXT_PHONE_HMAC_KEY',
    'NUXT_PUBLIC_OTHER_VALUE',
    'OPENAI_API_KEY',
    'PHOTO_NEXT_OPENAI_EVAL_API_KEY',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'SUPABASE_ACCESS_TOKEN',
    'DATABASE_URL',
    'GENERIC_SECRET',
    'LC_SECRET',
    'LC_DATABASE_URL',
    'LC_OPENAI_API_KEY',
  ]) {
    assert(!Object.hasOwn(safeBuild, forbiddenName), `private-free build 환경에 ${forbiddenName}가 남았습니다.`)
  }
  const allowedBuildNames = new Set([
    ...BUILD_OS_ENVIRONMENT_NAMES,
    'NUXT_PUBLIC_SUPABASE_URL',
    'NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'GIT_COMMIT_SHA',
    'NODE_ENV',
    'CI',
  ])
  assert(
    Object.keys(safeBuild).every(name => allowedBuildNames.has(name)),
    'private-free build 환경에 allowlist 밖 변수가 남았습니다.',
  )
  console.log('- private-free build env: passed')
  console.log('- finite locale allowlist: passed')

  let finalBuildEnvironment
  runVisible(
    process.execPath,
    [NUXT_ENTRY, 'build'],
    { env: safeBuild, label: 'self-check build subprocess' },
    (_command, _args, options) => {
      finalBuildEnvironment = options.env
      return { status: 0 }
    },
  )
  assert(
    JSON.stringify(finalBuildEnvironment) === JSON.stringify(safeBuild),
    'runVisible 최종 build subprocess 환경이 변경되었습니다.',
  )
  console.log('- final build subprocess env: passed')

  const selfCheckDirectory = resolve(SDD_DIR, `.release-self-check-${process.pid}-${randomUUID()}`)
  mkdirSync(selfCheckDirectory, { recursive: true })
  let observedPath = null
  try {
    assert(
      rejectsSafely(() => withCommitSecretFile(
        'self-check',
        fakeCommit,
        (path) => {
          observedPath = path
          privateStat(path)
          const parsed = JSON.parse(readFileSync(path, 'utf8'))
          assert(
            JSON.stringify(Object.keys(parsed)) === JSON.stringify([RELEASE_SECRET_NAME])
              && parsed.GIT_COMMIT_SHA === fakeCommit,
            'commit secret JSON이 단일 GIT_COMMIT_SHA가 아닙니다.',
          )
          fail('임시 파일 cleanup 실패 경로 재현')
        },
        selfCheckDirectory,
      )),
      '임시 파일 cleanup 실패 경로를 재현하지 못했습니다.',
    )
    assert(observedPath !== null && !existsSync(observedPath), '실패 후 임시 commit secret이 남았습니다.')

    const replacementPath = writeCommitSecretFile('self-check', fakeCommit, selfCheckDirectory)
    unlinkSync(replacementPath)
    const replacementDescriptor = openSync(replacementPath, 'wx', PRIVATE_MODE)
    try {
      writeFileSync(replacementDescriptor, '{"replacement":true}\n', 'utf8')
      secureOpenDescriptor(replacementDescriptor)
    }
    finally {
      closeSync(replacementDescriptor)
    }
    assert(
      rejectsSafely(() => safeUnlink(replacementPath)),
      '교체된 commit secret 경로를 삭제하려 했습니다.',
    )
    unlinkSync(replacementPath)

    const symlinkTarget = resolve(selfCheckDirectory, 'descriptor-target')
    writeFileSync(symlinkTarget, 'target', { encoding: 'utf8', mode: PRIVATE_MODE })
    const symlinkPath = writeCommitSecretFile('self-check', fakeCommit, selfCheckDirectory)
    unlinkSync(symlinkPath)
    symlinkSync(symlinkTarget, symlinkPath)
    assert(
      rejectsSafely(() => safeUnlink(symlinkPath)),
      'symlink로 교체된 commit secret 경로를 삭제하려 했습니다.',
    )
    unlinkSync(symlinkPath)
    unlinkSync(symlinkTarget)
    console.log('- descriptor identity: passed')

    const artifactPublic = resolve(selfCheckDirectory, 'artifact-public')
    const artifactServer = resolve(selfCheckDirectory, 'artifact-server')
    mkdirSync(artifactPublic)
    mkdirSync(artifactServer)
    const publicArtifact = resolve(artifactPublic, 'safe.js')
    const serverArtifact = resolve(artifactServer, 'server.mjs')
    writeFileSync(publicArtifact, 'safe public artifact')
    writeFileSync(serverArtifact, 'safe server artifact')
    const artifactSecret = 'artifact-private-credential-marker'
    verifyArtifactRoots(artifactPublic, artifactServer, [artifactSecret])
    writeFileSync(serverArtifact, `safe-prefix-${artifactSecret}`)
    assert(
      rejectsSafely(() => verifyArtifactRoots(artifactPublic, artifactServer, [artifactSecret])),
      'server artifact의 private marker를 거부하지 않았습니다.',
    )
    unlinkSync(publicArtifact)
    unlinkSync(serverArtifact)
    rmdirSync(artifactPublic)
    rmdirSync(artifactServer)
    console.log('- artifact rejection behavior: passed')

    const deployFailureCalls = []
    assert(
      await rejectsSafelyAsync(() => runReleaseSequence(fakeCommit, {
        deploy: async (environment) => {
          deployFailureCalls.push(environment)
          fail('staging deploy rejection self-check')
        },
        smoke: async () => {},
      })),
      'staging deploy 실패를 release 성공으로 처리했습니다.',
    )
    assert(
      JSON.stringify(deployFailureCalls) === JSON.stringify(['staging']),
      'staging deploy 실패 후 production deploy를 호출했습니다.',
    )
    const smokeFailureDeployCalls = []
    assert(
      await rejectsSafelyAsync(() => runReleaseSequence(fakeCommit, {
        deploy: async (environment) => {
          smokeFailureDeployCalls.push(environment)
          return `https://${WORKERS[environment]}.self-check.workers.dev`
        },
        smoke: async (_url, _commit, environment) => {
          assert(environment === 'staging', 'production smoke가 staging smoke보다 먼저 실행됐습니다.')
          fail('staging smoke rejection self-check')
        },
      })),
      'staging smoke 실패를 release 성공으로 처리했습니다.',
    )
    assert(
      JSON.stringify(smokeFailureDeployCalls) === JSON.stringify(['staging']),
      'staging smoke 실패 후 production deploy를 호출했습니다.',
    )
    console.log('- staging gate behavior: passed')

    assert(healthMatchesCommit({ ok: true, commit: fakeCommit }, fakeCommit), '일치하는 health commit을 거부했습니다.')
    assert(
      !healthMatchesCommit({ ok: true, commit: 'different-commit' }, fakeCommit),
      '불일치 health commit을 허용했습니다.',
    )
    console.log('- health mismatch behavior: passed')

    let offlineRemoteCalls = 0
    const offlineAdapters = {
      plan: () => {},
      check: () => {},
      remote: () => {
        offlineRemoteCalls += 1
        fail('offline mode가 remote adapter를 호출했습니다.')
      },
    }
    runOfflineMode('--plan', offlineAdapters)
    runOfflineMode('--check', offlineAdapters)
    assert(offlineRemoteCalls === 0, 'offline mode가 remote adapter를 호출했습니다.')
    console.log('- offline adapter trap: passed')
  }
  finally {
    if (existsSync(selfCheckDirectory)) {
      for (const name of readdirSync(selfCheckDirectory)) safeUnlink(resolve(selfCheckDirectory, name))
      try {
        const directoryStat = lstatSync(selfCheckDirectory)
        if (directoryStat.isDirectory()) {
          rmdirSync(selfCheckDirectory)
        }
      }
      catch {
        fail('self-check 임시 디렉터리 cleanup을 확인하지 못했습니다.')
      }
    }
  }
  console.log('- temporary secret cleanup: passed')
  console.log('Release runner self-check passed (network calls: 0, remote writes: 0).')
}

const runRelease = async () => {
  verifyLocalStaticConfiguration()
  const lock = acquireDeploymentLock()
  try {
    cleanupTemporaryCommitFiles()
    console.log('1/6 Git provenance와 Terminal 인증 확인')
    const gitState = verifyGitPreflight()
    const privateMarkers = inheritedPrivateMarkers()
    const publishableKey = verifySupabaseAuthentication()
    verifyCloudflareAuthentication()
    verifyRemoteSecretContract('staging')
    verifyRemoteSecretContract('production')
    buildRelease(publishableKey, gitState.commit, privateMarkers)
    const { stagingUrl, productionUrl } = await runReleaseSequence(gitState.commit)
    console.log('6/6 PHOTO:NEXT password-only 관리자 release 완료')
    console.log(`- staging: ${stagingUrl}`)
    console.log(`- production: ${productionUrl}`)
    console.log(`- admin: ${productionUrl}/admin/login`)
  }
  finally {
    for (const path of [...activeTemporaryPaths]) safeUnlink(path)
    releaseDeploymentLock(lock)
  }
}

const cleanupOnSignal = () => {
  try {
    for (const path of [...activeTemporaryPaths]) safeUnlink(path)
    releaseDeploymentLock(ownedDeploymentLock, false)
  }
  finally {
    process.exit(1)
  }
}

process.once('SIGINT', cleanupOnSignal)
process.once('SIGTERM', cleanupOnSignal)

const main = async () => {
  assert(process.argv.length <= 3, 'release runner는 인수를 하나만 허용합니다.')
  const mode = process.argv[2]
  if (mode === '--plan' || mode === '--check') return runOfflineMode(mode)
  if (mode === '--self-check') return runSelfCheck()
  assert(mode === undefined, '지원하지 않는 release runner 인수입니다.')
  await runRelease()
}

main().catch((error) => {
  const message = error instanceof SafeReleaseError
    ? error.message
    : '예상하지 못한 release 오류가 발생했습니다. 민감 출력은 숨겼습니다.'
  console.error(`PHOTO:NEXT release 중단: ${message}`)
  process.exitCode = 1
})
