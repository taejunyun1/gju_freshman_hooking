#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER_RELATIVE_PATH = 'scripts/deploy-photo-next-remote.mjs'
const RUNNER_PATH = resolve(ROOT, RUNNER_RELATIVE_PATH)
const SDD_DIR = resolve(ROOT, '.superpowers/sdd')
const STATE_PATH = resolve(SDD_DIR, 'remote-deploy-state.json')
const RESULT_PATH = resolve(SDD_DIR, 'admin-deploy-result.json')
const DEPLOYMENT_LOCK_PATH = resolve(SDD_DIR, 'remote-deploy.lock')
const SUPABASE = resolve(ROOT, 'node_modules/.bin/supabase')
const WRANGLER = resolve(ROOT, 'node_modules/.bin/wrangler')
const NUXT = resolve(ROOT, 'node_modules/.bin/nuxt')
const PROJECT_REF = 'ifourklrmnswileplgir'
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`
const ADMIN_EMAIL = 'taejun.foto+photo-next-admin@gmail.com'
const BRANCH = 'feature/photo-next-mvp'
const UPSTREAM = `origin/${BRANCH}`
const APPROVED_BASE_COMMIT = 'd471d19d9b2e44d87b47741a7f4c0992935009c1'
const WORKERS = Object.freeze({
  staging: 'photo-next-mvp-staging',
  production: 'photo-next-mvp',
})
const STATE_VERSION = 1
const PRIVATE_MODE = 0o600
const ARTIFACT_SCAN_CHUNK_BYTES = 64 * 1024
const activeSecretFiles = new Set()
let ownedDeploymentLock = null

class SafeDeploymentError extends Error {}

const fail = message => {
  throw new SafeDeploymentError(message)
}

const assert = (condition, message) => {
  if (!condition) fail(message)
}

const cloudflareCommandEnvironment = (sourceEnvironment = process.env) => {
  const environment = { ...sourceEnvironment }
  delete environment.CLOUDFLARE_ENV
  return environment
}

const commandEnvironment = (command, sourceEnvironment) => (
  command === WRANGLER
    ? cloudflareCommandEnvironment(sourceEnvironment)
    : sourceEnvironment
)

const executablePlan = () => ({
  supabaseApiKeys: [
    SUPABASE,
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--reveal',
    '--output',
    'json',
    '--agent',
    'no',
  ],
  supabaseDbPush: [
    SUPABASE,
    'db',
    'push',
    '--linked',
    '--include-all',
    '--include-seed',
    '--yes',
    '--agent',
    'no',
  ],
  verifyEnvironment: [process.execPath, resolve(ROOT, 'scripts/verify-env.mjs')],
  build: [NUXT, 'build'],
  stagingDeploy: [
    WRANGLER,
    'deploy',
    '--env',
    'staging',
    '--secrets-file',
    '<mode-0600-temporary-json>',
  ],
  productionDeploy: [
    WRANGLER,
    'deploy',
    '--secrets-file',
    '<mode-0600-temporary-json>',
  ],
})

const printPlan = () => {
  const plan = executablePlan()
  console.log('PHOTO NEXT 원격 배포 계획 (네트워크 호출 없음)')
  console.log(`- 작업 디렉터리: ${ROOT}`)
  console.log(`- Supabase project ref: ${PROJECT_REF}`)
  console.log(`- Git 기준: ${BRANCH} == ${UPSTREAM}, ${APPROVED_BASE_COMMIT.slice(0, 7)} 포함`)
  console.log(`- DB: ${plan.supabaseDbPush.slice(1).join(' ')}`)
  console.log(`- private-free 빌드: ${plan.build[0]} build`)
  console.log(`- 빌드 후 full-env/artifact 검증: ${plan.verifyEnvironment[1]}`)
  console.log('- 배포: staging 후 관리자/콘텐츠 gate, 이후 production deploy --secrets-file')
  console.log('- provider-off: Worker OpenAI secret 이름을 삭제·재검증하고 config 외 plaintext var를 배포로 제거')
  console.log(`- 관리자: ${ADMIN_EMAIL}`)
  console.log(`- 재개 상태: ${STATE_PATH} (0600)`)
  console.log(`- 최종 결과: ${RESULT_PATH} (0600)`)
  console.log('- OpenAI secret은 생성하거나 업로드하지 않음')
}

const runCapture = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: commandEnvironment(command, options.env ?? process.env),
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  })
  if (result.error) {
    fail(`${options.label ?? '명령'}을 시작하지 못했습니다. 로컬 의존성과 권한을 확인하세요.`)
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const runInherited = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: commandEnvironment(command, options.env ?? process.env),
    stdio: 'inherit',
  })
  if (result.error || result.status !== 0) {
    fail(`${options.label ?? '명령'}이 완료되지 않았습니다.`)
  }
}

const git = args => {
  const result = runCapture('git', args, { label: 'Git 확인' })
  if (result.status !== 0) fail('Git 저장소 상태를 확인하지 못했습니다.')
  return result.stdout.trim()
}

const parseTrackedFileFlags = (raw) => {
  const entries = raw.split('\0').filter(entry => entry !== '')
  return entries.map((entry) => {
    assert(entry.length >= 3 && entry[1] === ' ', 'git ls-files provenance 형식이 잘못되었습니다.')
    return { flag: entry[0], path: entry.slice(2) }
  })
}

const assertTrackedRepositoryProvenance = (
  repositoryRoot = ROOT,
  runner = runCapture,
) => {
  const listed = runner(
    'git',
    ['ls-files', '-v', '-z'],
    { cwd: repositoryRoot, label: 'tracked file provenance 확인' },
  )
  assert(listed.status === 0, 'tracked file provenance를 읽지 못했습니다.')
  const entries = parseTrackedFileFlags(listed.stdout)
  assert(entries.length > 0, 'tracked file provenance가 비어 있습니다.')
  assert(
    entries.every(entry => entry.flag === 'H'),
    'assume-unchanged 또는 skip-worktree tracked 파일이 있습니다.',
  )

  const staged = runner(
    'git',
    ['diff', '--quiet', '--no-ext-diff', '--cached', 'HEAD', '--'],
    { cwd: repositoryRoot, label: 'staged diff 확인' },
  )
  assert(staged.status === 0, 'HEAD와 index가 다릅니다.')
  const working = runner(
    'git',
    ['diff', '--quiet', '--no-ext-diff', '--'],
    { cwd: repositoryRoot, label: 'working-tree diff 확인' },
  )
  assert(working.status === 0, 'index와 working tree가 다릅니다.')
}

const verifyGitPreflight = () => {
  assert(
    fileURLToPath(import.meta.url) === RUNNER_PATH,
    '배포 러너는 Git에 추적되는 scripts 경로에서만 실행할 수 있습니다.',
  )
  const branch = git(['branch', '--show-current'])
  const head = git(['rev-parse', 'HEAD'])
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  const upstreamHead = git(['rev-parse', '@{upstream}'])
  assertTrackedRepositoryProvenance()
  const trackedRunner = runCapture(
    'git',
    ['ls-files', '--error-unmatch', RUNNER_RELATIVE_PATH],
    { label: '배포 러너 Git 추적 확인' },
  )
  const workingRunnerBlob = runCapture(
    'git',
    ['hash-object', RUNNER_RELATIVE_PATH],
    { label: '배포 러너 working-tree blob 확인' },
  )
  const committedRunnerBlob = runCapture(
    'git',
    ['rev-parse', `HEAD:${RUNNER_RELATIVE_PATH}`],
    { label: '배포 러너 HEAD blob 확인' },
  )
  const approvedBase = runCapture(
    'git',
    ['merge-base', '--is-ancestor', APPROVED_BASE_COMMIT, head],
    { label: '승인 기준 커밋 확인' },
  )

  assert(branch === BRANCH, `배포 브랜치는 ${BRANCH}여야 합니다.`)
  assert(upstream === UPSTREAM, `upstream은 ${UPSTREAM}이어야 합니다.`)
  assert(head === upstreamHead, '현재 HEAD와 upstream이 다릅니다. 먼저 commit/push를 완료하세요.')
  assert(trackedRunner.status === 0, '현재 배포 러너가 Git 추적 대상이 아닙니다.')
  assert(
    workingRunnerBlob.status === 0
      && committedRunnerBlob.status === 0
      && workingRunnerBlob.stdout.trim() === committedRunnerBlob.stdout.trim(),
    '실행 중인 배포 러너 내용이 현재 HEAD와 다릅니다.',
  )
  assert(approvedBase.status === 0, '현재 HEAD에 승인된 운영 기준 커밋이 포함되지 않았습니다.')

  return { branch, commit: head }
}

const verifyLocalBinaries = () => {
  for (const [name, path] of [
    ['Supabase CLI', SUPABASE],
    ['Wrangler CLI', WRANGLER],
    ['Nuxt CLI', NUXT],
  ]) {
    assert(existsSync(path), `${name} 로컬 바이너리를 찾지 못했습니다: ${path}`)
  }
}

const verifyLinkedProject = () => {
  const linkedRefPath = resolve(ROOT, 'supabase/.temp/project-ref')
  assert(
    existsSync(linkedRefPath),
    `Supabase 링크가 없습니다. ${SUPABASE} link --project-ref ${PROJECT_REF} 를 먼저 실행하세요.`,
  )
  const linkedRef = readFileSync(linkedRefPath, 'utf8').trim()
  assert(
    linkedRef === PROJECT_REF,
    `연결된 Supabase project ref가 ${PROJECT_REF}와 다릅니다.`,
  )
}

const ansiEscapePattern = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'gu',
)
const stripAnsi = value => value.replace(ansiEscapePattern, '')

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
          // Try the other JSON container shape before returning a safe error.
        }
      }
    }
  }
  fail('CLI의 JSON 응답 형식을 해석하지 못했습니다.')
}

const stringValue = (object, keys) => {
  for (const key of keys) {
    const value = object[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

const parseSupabaseApiKeys = raw => {
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
      value: stringValue(row, ['api_key', 'key', 'value', 'secret', 'token']),
    }))
    .filter(candidate => candidate.value !== '')

  const publishable = candidates.find(candidate => candidate.value.startsWith('sb_publishable_'))
    ?? candidates.find(candidate => /\bpublishable\b/u.test(candidate.label))
    ?? candidates.find(candidate => /\banon(?:ymous)?\b/u.test(candidate.label))
  const secret = candidates.find(candidate => candidate.value.startsWith('sb_secret_'))
    ?? candidates.find(candidate => /\bsecret\b/u.test(candidate.label)
      && !/\bpublishable\b/u.test(candidate.label))
    ?? candidates.find(candidate => /\bservice[_ -]?role\b/u.test(candidate.label))

  assert(publishable?.value, 'Supabase publishable/anon key를 찾지 못했습니다.')
  assert(secret?.value, 'Supabase secret/service_role key를 찾지 못했습니다.')
  assert(publishable.value !== secret.value, 'Supabase 공개키와 서버 비밀키가 동일합니다.')
  return { publishable: publishable.value, secret: secret.value }
}

const getSupabaseApiKeys = () => {
  const args = executablePlan().supabaseApiKeys.slice(1)
  const result = runCapture(SUPABASE, args, {
    label: 'Supabase API key 조회',
    timeout: 120_000,
  })
  if (result.status !== 0) {
    fail('Supabase API key 조회에 실패했습니다. 일반 터미널의 Supabase 로그인을 확인하세요.')
  }
  return parseSupabaseApiKeys(result.stdout)
}

const randomSecret = () => randomBytes(32).toString('base64url')
const CURRENT_PASSWORD_PEPPER_VERSION = '1'
const randomPassword = () => `P${randomBytes(3).toString('hex')}a9!`
const isCanonicalSecret = value => {
  if (typeof value !== 'string') return false
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.byteLength === 32 && decoded.toString('base64url') === value
  }
  catch {
    return false
  }
}

const isStrongTemporaryPassword = value => (
  typeof value === 'string'
  && value.length >= 8
  && value.length <= 12
  && /[a-z]/u.test(value)
  && /[A-Z]/u.test(value)
  && /\d/u.test(value)
  && /[^A-Za-z0-9]/u.test(value)
)

const isPlainObject = value => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
)

const assertExactObjectKeys = (value, expectedKeys, label) => {
  assert(isPlainObject(value), `${label} 형식이 잘못되었습니다.`)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  assert(
    actual.length === expected.length
      && actual.every((key, index) => key === expected[index]),
    `${label} key 목록이 정확하지 않습니다.`,
  )
}

const validateState = (input, expectedCommit) => {
  assertExactObjectKeys(input, [
    'version',
    'projectRef',
    'supabaseUrl',
    'branch',
    'commit',
    'createdAt',
    'dbPushed',
    'supabaseKeys',
    'appSecrets',
    'admin',
    'deployments',
  ], '배포 state')
  assert(input.version === STATE_VERSION, '배포 state 버전이 현재 러너와 다릅니다.')
  assert(input.projectRef === PROJECT_REF, '배포 state의 Supabase project ref가 다릅니다.')
  assert(input.supabaseUrl === SUPABASE_URL, '배포 state의 Supabase URL이 다릅니다.')
  assert(input.branch === BRANCH, '배포 state의 Git branch가 다릅니다.')
  assert(input.commit === expectedCommit, '배포 state의 commit과 현재 HEAD가 다릅니다.')
  assert(typeof input.createdAt === 'string', '배포 state의 createdAt 형식이 잘못되었습니다.')
  const createdAt = new Date(input.createdAt)
  assert(
    !Number.isNaN(createdAt.valueOf()) && createdAt.toISOString() === input.createdAt,
    '배포 state의 createdAt은 canonical ISO 형식이어야 합니다.',
  )
  assert(typeof input.dbPushed === 'boolean', '배포 state의 dbPushed가 잘못되었습니다.')

  assertExactObjectKeys(input.supabaseKeys, ['publishable', 'secret'], '배포 state supabaseKeys')
  assert(typeof input.supabaseKeys.publishable === 'string' && input.supabaseKeys.publishable !== '', '배포 state에 Supabase 공개키가 없습니다.')
  assert(typeof input.supabaseKeys.secret === 'string' && input.supabaseKeys.secret !== '', '배포 state에 Supabase 서버키가 없습니다.')
  assert(input.supabaseKeys.publishable !== input.supabaseKeys.secret, '배포 state의 Supabase key가 동일합니다.')

  assertExactObjectKeys(
    input.appSecrets,
    ['nameHmac', 'phoneHmac', 'phoneEncryption', 'passwordPepper', 'passwordPepperVersion'],
    '배포 state appSecrets',
  )
  for (const key of ['nameHmac', 'phoneHmac', 'phoneEncryption', 'passwordPepper']) {
    assert(isCanonicalSecret(input.appSecrets[key]), `배포 state의 ${key} secret 형식이 잘못되었습니다.`)
  }
  assert(input.appSecrets.passwordPepperVersion === CURRENT_PASSWORD_PEPPER_VERSION, '배포 state의 passwordPepperVersion이 현재 버전과 다릅니다.')

  assertExactObjectKeys(input.admin, ['email', 'password', 'configured'], '배포 state admin')
  assert(input.admin.email === ADMIN_EMAIL, '배포 state의 관리자 이메일이 다릅니다.')
  assert(isStrongTemporaryPassword(input.admin.password), '배포 state의 임시 관리자 비밀번호 형식이 잘못되었습니다.')
  assert(typeof input.admin.configured === 'boolean', '배포 state의 admin.configured가 잘못되었습니다.')

  assertExactObjectKeys(
    input.deployments,
    ['staging', 'production'],
    '배포 state deployments',
  )
  for (const environment of ['staging', 'production']) {
    const deployment = input.deployments[environment]
    assertExactObjectKeys(
      deployment,
      ['deployed', 'url'],
      `배포 state ${environment} deployment`,
    )
    assert(typeof deployment.deployed === 'boolean', `배포 state의 ${environment}.deployed가 잘못되었습니다.`)
    if (deployment.deployed) {
      assert(
        isWorkerUrl(deployment.url, WORKERS[environment]),
        `배포 완료된 ${environment} state에는 유효한 workers.dev URL이 필요합니다.`,
      )
    }
    else {
      assert(
        deployment.url === null,
        `배포 전 ${environment} state의 URL은 null이어야 합니다.`,
      )
    }
  }
  return input
}

const privateStat = path => {
  const linkStat = lstatSync(path)
  assert(!linkStat.isSymbolicLink(), `비밀 파일은 심볼릭 링크일 수 없습니다: ${path}`)
  const fileStat = statSync(path)
  assert(fileStat.isFile(), `비밀 경로가 일반 파일이 아닙니다: ${path}`)
  assert((fileStat.mode & 0o777) === PRIVATE_MODE, `비밀 파일 권한은 0600이어야 합니다: ${path}`)
  if (typeof process.getuid === 'function') {
    assert(fileStat.uid === process.getuid(), `비밀 파일 소유자가 현재 사용자와 다릅니다: ${path}`)
  }
  return fileStat
}

const acquireDeploymentLockAtPath = (lockPath) => {
  mkdirSync(dirname(lockPath), { recursive: true })
  const token = randomSecret()
  let descriptor
  try {
    descriptor = openSync(lockPath, 'wx', PRIVATE_MODE)
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`, {
      encoding: 'utf8',
    })
  }
  catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      }
      catch {
        // The original lock acquisition failure remains authoritative.
      }
      safeUnlink(lockPath)
    }
    if (error?.code === 'EEXIST') {
      const linkStat = lstatSync(lockPath)
      assert(!linkStat.isSymbolicLink(), `배포 lock은 심볼릭 링크일 수 없습니다: ${lockPath}`)
      privateStat(lockPath)
      fail('다른 원격 배포 실행이 이미 진행 중입니다.')
    }
    throw error
  }
  closeSync(descriptor)
  chmodSync(lockPath, PRIVATE_MODE)
  const fileStat = privateStat(lockPath)
  return {
    path: lockPath,
    token,
    device: fileStat.dev,
    inode: fileStat.ino,
  }
}

const acquireDeploymentLock = () => {
  const lock = acquireDeploymentLockAtPath(DEPLOYMENT_LOCK_PATH)
  ownedDeploymentLock = lock
  return lock
}

const releaseDeploymentLock = (lock = ownedDeploymentLock, strict = true) => {
  if (!lock) return
  if (!existsSync(lock.path)) {
    if (strict) fail('소유한 배포 lock 파일이 사라졌습니다.')
    if (ownedDeploymentLock === lock) ownedDeploymentLock = null
    return
  }
  const linkStat = lstatSync(lock.path)
  if (linkStat.isSymbolicLink()) {
    if (strict) fail('소유한 배포 lock이 심볼릭 링크로 교체되었습니다.')
    return
  }
  const fileStat = statSync(lock.path)
  let stored
  try {
    stored = JSON.parse(readFileSync(lock.path, 'utf8'))
  }
  catch {
    if (strict) fail('소유한 배포 lock 내용이 변경되었습니다.')
    return
  }
  const stillOwned = fileStat.isFile()
    && fileStat.dev === lock.device
    && fileStat.ino === lock.inode
    && stored?.token === lock.token
  if (!stillOwned) {
    if (strict) fail('소유하지 않은 배포 lock은 삭제하지 않습니다.')
    return
  }
  unlinkSync(lock.path)
  if (ownedDeploymentLock === lock) ownedDeploymentLock = null
}

const writePrivateJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  activeSecretFiles.add(temporary)
  let renamed = false
  try {
    const descriptor = openSync(temporary, 'wx', PRIVATE_MODE)
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' })
    }
    finally {
      closeSync(descriptor)
    }
    chmodSync(temporary, PRIVATE_MODE)
    renameSync(temporary, path)
    renamed = true
    activeSecretFiles.delete(temporary)
    chmodSync(path, PRIVATE_MODE)
    privateStat(path)
  }
  catch (error) {
    safeUnlink(temporary)
    if (renamed) safeUnlink(path)
    throw error
  }
}

const safeUnlink = path => {
  try {
    if (existsSync(path)) {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) fail(`비밀 임시 경로가 심볼릭 링크입니다: ${path}`)
      unlinkSync(path)
    }
  }
  finally {
    activeSecretFiles.delete(path)
  }
}

const cleanupRuntimeSecretFiles = (directory = SDD_DIR) => {
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory)) {
    const runtimeSecret = /^\.remote-deploy-secrets-(?:staging|production)-[A-Za-z0-9-]+\.json(?:\.\d+\.[A-Za-z0-9-]+\.tmp)?$/u.test(name)
    const openAiDeletion = /^\.remote-deploy-openai-delete-(?:staging|production)-[A-Za-z0-9-]+\.json(?:\.\d+\.[A-Za-z0-9-]+\.tmp)?$/u.test(name)
    const stateTemporary = /^remote-deploy-state\.json\.\d+\.[A-Za-z0-9-]+\.tmp$/u.test(name)
    const resultTemporary = /^admin-deploy-result\.json\.\d+\.[A-Za-z0-9-]+\.tmp$/u.test(name)
    if (!runtimeSecret && !openAiDeletion && !stateTemporary && !resultTemporary) continue
    safeUnlink(resolve(directory, name))
  }
}

const loadState = expectedCommit => {
  if (!existsSync(STATE_PATH)) return null
  privateStat(STATE_PATH)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  }
  catch {
    fail(`배포 state JSON이 손상되었습니다: ${STATE_PATH}`)
  }
  return validateState(parsed, expectedCommit)
}

const saveState = state => {
  validateState(state, state.commit)
  writePrivateJson(STATE_PATH, state)
}

const createState = (gitState, supabaseKeys) => ({
  version: STATE_VERSION,
  projectRef: PROJECT_REF,
  supabaseUrl: SUPABASE_URL,
  branch: gitState.branch,
  commit: gitState.commit,
  createdAt: new Date().toISOString(),
  dbPushed: false,
  supabaseKeys,
  appSecrets: {
    nameHmac: randomSecret(),
    phoneHmac: randomSecret(),
    phoneEncryption: randomSecret(),
    passwordPepper: randomSecret(),
    passwordPepperVersion: CURRENT_PASSWORD_PEPPER_VERSION,
  },
  admin: {
    email: ADMIN_EMAIL,
    password: randomPassword(),
    configured: false,
  },
  deployments: {
    staging: { deployed: false, url: null },
    production: { deployed: false, url: null },
  },
})

const workerNotFound = output => (
  /requested script (?:was )?not found/iu.test(output)
  || /script .* does not exist/iu.test(output)
  || /this worker does not exist on your account/iu.test(output)
  || /worker\s+["'][^"']+["']\s+not found/iu.test(output)
  || /error code:\s*10007/iu.test(output)
  || /code[":\s]+10007/iu.test(output)
  || /error code:\s*10090/iu.test(output)
  || /code[":\s]+10090/iu.test(output)
)

const remoteWorkerExists = (environment, runner = runCapture) => {
  const name = WORKERS[environment]
  const result = runner(
    WRANGLER,
    ['deployments', 'list', '--json', ...workerTargetArguments(environment)],
    { label: `Cloudflare Worker ${name} 조회`, timeout: 120_000 },
  )
  if (result.status === 0) {
    const parsed = parseCliJson(result.stdout)
    return Array.isArray(parsed) ? parsed.length > 0 : true
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (workerNotFound(output)) return false
  fail(`Cloudflare Worker ${name} 존재 여부를 안전하게 확인하지 못했습니다.`)
}

const verifyCloudflareAuthentication = () => {
  const result = runCapture(WRANGLER, ['whoami', '--json'], {
    label: 'Cloudflare 로그인 확인',
    timeout: 120_000,
  })
  if (result.status !== 0) {
    fail('Cloudflare 로그인이 없습니다. 일반 터미널에서 Wrangler 로그인을 완료하세요.')
  }
  parseCliJson(result.stdout)
}

const workerTargetArguments = environment => (
  environment === 'staging'
    ? ['--env', 'staging']
    : []
)

const parseWranglerSecretNames = raw => {
  const parsed = parseCliJson(raw)
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.data)
      ? parsed.data
      : []
  return rows
    .filter(row => row !== null && typeof row === 'object' && !Array.isArray(row))
    .map(row => stringValue(row, ['name']))
    .filter(name => name !== '')
}

const isForbiddenRemoteOpenAiName = name => (
  name.startsWith('OPENAI_')
  || name.startsWith('NUXT_PUBLIC_OPENAI')
  || name.startsWith('PHOTO_NEXT_OPENAI')
)

const listWorkerSecretNames = (environment, runner = runCapture) => {
  const result = runner(
    WRANGLER,
    ['secret', 'list', '--format', 'json', ...workerTargetArguments(environment)],
    { label: `${environment} Worker secret 확인`, timeout: 120_000 },
  )
  if (result.status === 0) {
    return { missing: false, names: parseWranglerSecretNames(result.stdout) }
  }
  if (workerNotFound(`${result.stdout}\n${result.stderr}`)) {
    return { missing: true, names: [] }
  }
  fail(`${environment} Worker secret 목록을 안전하게 확인하지 못했습니다.`)
}

const ensureRemoteProviderOff = (environment, runner = runCapture) => {
  if (!remoteWorkerExists(environment, runner)) return { missing: true }
  const before = listWorkerSecretNames(environment, runner)
  if (before.missing) return { missing: true }
  const forbidden = before.names.filter(isForbiddenRemoteOpenAiName)
  if (forbidden.length === 0) return { missing: false }

  const deletionPath = resolve(
    SDD_DIR,
    `.remote-deploy-openai-delete-${environment}-${process.pid}-${randomUUID()}.json`,
  )
  try {
    writePrivateJson(
      deletionPath,
      Object.fromEntries(forbidden.map(name => [name, null])),
    )
    activeSecretFiles.add(deletionPath)
    const deletion = runner(
      WRANGLER,
      ['secret', 'bulk', deletionPath, ...workerTargetArguments(environment)],
      { label: `${environment} OpenAI secret 삭제`, timeout: 120_000 },
    )
    if (deletion.status !== 0) {
      fail(`${environment} Worker의 OpenAI provider secret 삭제에 실패했습니다.`)
    }
  }
  finally {
    safeUnlink(deletionPath)
  }

  const after = listWorkerSecretNames(environment, runner)
  assert(!after.missing, `${environment} Worker가 secret 정리 중 사라졌습니다.`)
  assert(
    after.names.every(name => !isForbiddenRemoteOpenAiName(name)),
    `${environment} Worker에 OpenAI provider secret 이름이 남아 있습니다.`,
  )
  return { missing: false }
}

const assertNoExistingWorkersWithoutState = () => {
  const existing = Object.entries(WORKERS)
    .filter(([environment]) => remoteWorkerExists(environment))
    .map(([environment, name]) => `${environment}:${name}`)
  if (existing.length > 0) {
    fail(
      `기존 Worker(${existing.join(', ')})가 있지만 재개 state가 없습니다. `
      + `비밀값 임의 회전을 막기 위해 중단합니다: ${STATE_PATH}`,
    )
  }
}

const runtimeSecrets = state => ({
  NUXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.supabaseKeys.publishable,
  NUXT_SUPABASE_SECRET_KEY: state.supabaseKeys.secret,
  NUXT_NAME_HMAC_KEY: state.appSecrets.nameHmac,
  NUXT_PHONE_HMAC_KEY: state.appSecrets.phoneHmac,
  NUXT_PHONE_ENCRYPTION_KEY: state.appSecrets.phoneEncryption,
  NUXT_PASSWORD_PEPPER: state.appSecrets.passwordPepper,
  NUXT_PASSWORD_PEPPER_VERSION: state.appSecrets.passwordPepperVersion,
  GIT_COMMIT_SHA: state.commit,
})

const withoutInheritedNuxtOrOpenAi = (sourceEnvironment = process.env) => {
  const env = { ...sourceEnvironment }
  for (const name of Object.keys(env)) {
    if (
      name.startsWith('NUXT_')
      || name.includes('OPENAI')
    ) delete env[name]
  }
  return env
}

const buildEnvironment = (state, sourceEnvironment = process.env) => ({
  ...withoutInheritedNuxtOrOpenAi(sourceEnvironment),
  NUXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.supabaseKeys.publishable,
  GIT_COMMIT_SHA: state.commit,
  NODE_ENV: 'production',
  CI: '1',
})

const cleanRuntimeEnvironment = (state, sourceEnvironment = process.env) => {
  const env = withoutInheritedNuxtOrOpenAi(sourceEnvironment)
  Object.assign(env, runtimeSecrets(state), {
    NODE_ENV: 'production',
    CI: '1',
    WRANGLER_SEND_METRICS: 'false',
  })
  return env
}

const fileContainsAnyExactMarker = (path, markerBuffers) => {
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

const artifactTreesContainPrivateSecret = (state, roots = [
  resolve(ROOT, '.output/public'),
  resolve(ROOT, '.output/server'),
]) => {
  const markerBuffers = [
    state.supabaseKeys.secret,
    state.appSecrets.nameHmac,
    state.appSecrets.phoneHmac,
    state.appSecrets.phoneEncryption,
    state.appSecrets.passwordPepper,
  ].map(value => Buffer.from(value))
  assert(
    markerBuffers.every(marker => marker.byteLength > 0),
    'artifact secret scan marker가 비어 있습니다.',
  )

  for (const root of roots) {
    assert(existsSync(root), '필수 빌드 artifact root가 없습니다.')
    const rootStat = lstatSync(root)
    assert(!rootStat.isSymbolicLink(), '빌드 artifact root는 심볼릭 링크일 수 없습니다.')
    assert(rootStat.isDirectory(), '빌드 artifact root는 디렉터리여야 합니다.')
  }

  const pending = [...roots]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    const linkStat = lstatSync(current)
    assert(!linkStat.isSymbolicLink(), '빌드 artifact scan은 심볼릭 링크를 허용하지 않습니다.')
    if (linkStat.isDirectory()) {
      for (const name of readdirSync(current)) pending.push(resolve(current, name))
    }
    else if (linkStat.isFile() && fileContainsAnyExactMarker(current, markerBuffers)) {
      return true
    }
  }
  return false
}

const assertArtifactsContainNoPrivateSecrets = (state, roots) => {
  assert(
    !artifactTreesContainPrivateSecret(state, roots),
    '빌드 artifact에 서버 또는 앱 비밀값이 포함되었습니다.',
  )
}

const writeTemporarySecrets = (environment, state) => {
  const path = resolve(
    SDD_DIR,
    `.remote-deploy-secrets-${environment}-${process.pid}-${randomUUID()}.json`,
  )
  writePrivateJson(path, runtimeSecrets(state))
  activeSecretFiles.add(path)
  return path
}

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
  const matches = stripAnsi(raw).match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev(?:\/[^\s"'<>]*)?/gu) ?? []
  for (const candidate of matches) {
    const normalized = candidate.replace(/[),.;]+$/u, '')
    if (isWorkerUrl(normalized, workerName)) return new URL(normalized).origin
  }
  return null
}

const completedDeploymentFromOutput = (raw, workerName) => {
  const url = parseWorkerUrl(raw, workerName)
  if (!url) {
    fail('Cloudflare 배포 출력에서 유효한 workers.dev URL을 확인하지 못했습니다.')
  }
  return { deployed: true, url }
}

const pushDatabase = state => {
  if (state.dbPushed) return
  console.log('1/6 Supabase migration 및 seed 적용')
  runInherited(SUPABASE, executablePlan().supabaseDbPush.slice(1), {
    label: 'Supabase db push',
  })
  state.dbPushed = true
  saveState(state)
}

const verifyAndBuild = state => {
  console.log('2/6 private-free Nuxt production build')
  runInherited(NUXT, ['build'], {
    label: 'Nuxt build',
    env: buildEnvironment(state),
  })
  console.log('3/6 배포 환경 및 artifact 비밀 누출 검증')
  const fullEnvironment = cleanRuntimeEnvironment(state)
  runInherited(process.execPath, [resolve(ROOT, 'scripts/verify-env.mjs')], {
    label: '환경 검증',
    env: fullEnvironment,
  })
  assertArtifactsContainNoPrivateSecrets(state)
}

const deployEnvironment = (
  environment,
  state,
  runner = runCapture,
  persistState = saveState,
) => {
  const deployment = state.deployments[environment]
  const workerName = WORKERS[environment]
  const beforeProviderOff = ensureRemoteProviderOff(environment, runner)
  if (deployment.deployed) {
    assert(
      !beforeProviderOff.missing,
      `${environment} Worker가 배포 완료 state와 달리 존재하지 않습니다.`,
    )
    return
  }

  console.log(`${environment === 'staging' ? '4' : '6'}/6 Cloudflare ${environment} 배포`)
  const secretsFile = writeTemporarySecrets(environment, state)
  try {
    const args = environment === 'staging'
      ? ['deploy', '--env', 'staging', '--secrets-file', secretsFile, '--message', `Deploy ${state.commit}`]
      : ['deploy', '--secrets-file', secretsFile, '--message', `Deploy ${state.commit}`]
    const result = runner(WRANGLER, args, {
      label: `Cloudflare ${environment} 배포`,
      env: cleanRuntimeEnvironment(state),
      timeout: 10 * 60_000,
    })
    if (result.status !== 0) {
      fail(`Cloudflare ${environment} 배포에 실패했습니다. 비밀값은 출력하지 않았습니다.`)
    }
    const completed = completedDeploymentFromOutput(
      `${result.stdout}\n${result.stderr}`,
      workerName,
    )
    // Wrangler deploy is the source of truth for plaintext vars: no --keep-vars
    // means remote vars absent from wrangler.jsonc are removed during deployment.
    const afterProviderOff = ensureRemoteProviderOff(environment, runner)
    assert(
      !afterProviderOff.missing,
      `${environment} Worker가 배포 직후 provider-off 검증 중 존재하지 않습니다.`,
    )
    Object.assign(deployment, completed)
    persistState(state)
  }
  finally {
    safeUnlink(secretsFile)
  }
}

const findAdminUser = async (client, email) => {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) fail('Supabase 관리자 사용자 목록을 확인하지 못했습니다.')
    const found = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (data.users.length < 1000) return null
  }
  fail('Supabase 관리자 사용자 검색 범위를 초과했습니다.')
}

const isActivationCount = value => Number.isInteger(value) && value >= 0

const upsertAdminAndActivateContent = async (serviceClient, userId) => {
  const { error: upsertError } = await serviceClient
    .from('admin_users')
    .upsert({ id: userId, role: 'admin', is_active: true }, { onConflict: 'id' })
  if (upsertError) fail('admin_users 권한 행 구성에 실패했습니다.')

  const { data: activation, error: activationError } = await serviceClient
    .rpc('activate_verified_2026_content')
  if (activationError
    || activation === null
    || typeof activation !== 'object'
    || !['updated', 'already_activated'].includes(activation.status)
    || !isActivationCount(activation.facultyPublished)
    || !isActivationCount(activation.resourcesPublished)
    || !isActivationCount(activation.validationErrors)) {
    fail('검증된 2026 콘텐츠 운영 발행에 실패했습니다.')
  }
}

const configureAdmin = async state => {
  if (state.admin.configured) return
  console.log('5/6 관리자 계정 구성, 콘텐츠 활성화 및 로그인 검증')
  const { createClient } = await import('@supabase/supabase-js')
  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }
  const serviceClient = createClient(
    SUPABASE_URL,
    state.supabaseKeys.secret,
    clientOptions,
  )
  const existing = await findAdminUser(serviceClient, ADMIN_EMAIL)
  let userId
  if (existing) {
    const { data, error } = await serviceClient.auth.admin.updateUserById(existing.id, {
      password: state.admin.password,
      email_confirm: true,
    })
    if (error || !data.user) fail('기존 Supabase 관리자 계정 갱신에 실패했습니다.')
    userId = data.user.id
  }
  else {
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: state.admin.password,
      email_confirm: true,
    })
    if (error || !data.user) fail('Supabase 관리자 계정 생성에 실패했습니다.')
    userId = data.user.id
  }

  await upsertAdminAndActivateContent(serviceClient, userId)

  const publicClient = createClient(
    SUPABASE_URL,
    state.supabaseKeys.publishable,
    clientOptions,
  )
  const { data: signIn, error: signInError } = await publicClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: state.admin.password,
  })
  if (signInError || signIn.user?.id !== userId) {
    fail('생성한 관리자 계정의 공개 로그인 검증에 실패했습니다.')
  }
  await publicClient.auth.signOut()
  state.admin.configured = true
  saveState(state)
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

const fetchWithRetry = async (url, validator, label) => {
  let lastStatus = 'network'
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'follow' })
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

const smokeBaseUrl = async (baseUrl, commit, label) => {
  await fetchWithRetry(
    `${baseUrl}/api/health`,
    async response => {
      const body = await response.json().catch(() => null)
      return body?.ok === true && body?.commit === commit
    },
    `${label} health/commit`,
  )
  await fetchWithRetry(`${baseUrl}/`, async response => {
    const body = await response.text()
    return body.length > 100
  }, `${label} landing`)
  await fetchWithRetry(`${baseUrl}/admin/login`, async response => {
    const body = await response.text()
    return body.includes('관리자') || body.includes('admin')
  }, `${label} admin login`)
  await fetchWithRetry(`${baseUrl}/api/assessment/options`, async response => {
    const body = await response.json().catch(() => null)
    return typeof body?.data?.catalogRevision === 'string'
      && Array.isArray(body?.data?.groups)
      && body.data.groups.length > 0
      && body.data.groups.every(group => Array.isArray(group?.options) && group.options.length > 0)
  }, `${label} assessment options`)
}

const smokeDeployments = async state => {
  console.log('배포 smoke 검증')
  await smokeBaseUrl(state.deployments.staging.url, state.commit, 'staging')
  await smokeBaseUrl(state.deployments.production.url, state.commit, 'production')
}

const createDeploymentResult = state => ({
    email: ADMIN_EMAIL,
    password: state.admin.password,
    stagingUrl: state.deployments.staging.url,
    productionUrl: state.deployments.production.url,
    adminUrl: `${state.deployments.production.url}/admin/login`,
    commit: state.commit,
})

const writeResultAndRemoveState = state => {
  writePrivateJson(RESULT_PATH, createDeploymentResult(state))
  safeUnlink(STATE_PATH)
}

const makeSelfCheckState = () => ({
  version: STATE_VERSION,
  projectRef: PROJECT_REF,
  supabaseUrl: SUPABASE_URL,
  branch: BRANCH,
  commit: APPROVED_BASE_COMMIT,
  createdAt: '2026-07-16T00:00:00.000Z',
  dbPushed: false,
  supabaseKeys: {
    publishable: 'sb_publishable_self_check',
    secret: 'sb_secret_self_check',
  },
  appSecrets: {
    nameHmac: randomSecret(),
    phoneHmac: randomSecret(),
    phoneEncryption: randomSecret(),
    passwordPepper: randomSecret(),
    passwordPepperVersion: CURRENT_PASSWORD_PEPPER_VERSION,
  },
  admin: {
    email: ADMIN_EMAIL,
    password: randomPassword(),
    configured: false,
  },
  deployments: {
    staging: { deployed: false, url: null },
    production: { deployed: false, url: null },
  },
})

const rejectsSafely = operation => {
  try {
    operation()
    return false
  }
  catch (error) {
    return error instanceof SafeDeploymentError
  }
}

const selfCheckVerifiedContentActivation = async () => {
  const userId = '26000000-0000-4000-8000-000000000026'
  const secretMarker = 'activation-self-check-secret'
  const activationResult = status => ({
    status,
    facultyPublished: 6,
    resourcesPublished: 41,
    validationErrors: 3,
  })
  const fakeClient = ({
    activation = activationResult('updated'),
    activationError = null,
    upsertError = null,
  } = {}) => {
    const calls = []
    return {
      calls,
      client: {
        from: (table) => {
          assert(table === 'admin_users', 'activation self-check가 예상하지 못한 table을 사용했습니다.')
          return {
            upsert: async (values, options) => {
              calls.push({ operation: 'upsert', values, options })
              return { error: upsertError }
            },
          }
        },
        rpc: async (name) => {
          calls.push({ operation: 'activate', name })
          return { data: activation, error: activationError }
        },
      },
    }
  }
  const assertCallContract = (calls) => {
    assert(
      calls.map(call => call.operation).join(',') === 'upsert,activate',
      'admin upsert 이후 activation이 정확히 한 번 호출되지 않았습니다.',
    )
    assert(
      calls[0].values.id === userId
        && calls[0].values.role === 'admin'
        && calls[0].values.is_active === true
        && calls[0].options.onConflict === 'id',
      'admin_users upsert payload가 잘못되었습니다.',
    )
    assert(
      calls[1].name === 'activate_verified_2026_content',
      '검증 콘텐츠 activation RPC 이름이 잘못되었습니다.',
    )
  }
  const captureSafeMessage = async (operation) => {
    let caught = null
    try {
      await operation()
    }
    catch (error) {
      caught = error
    }
    assert(caught instanceof SafeDeploymentError, 'activation 실패가 safe deployment error로 닫히지 않았습니다.')
    return caught.message
  }

  for (const status of ['updated', 'already_activated']) {
    const check = fakeClient({ activation: activationResult(status) })
    await upsertAdminAndActivateContent(check.client, userId)
    assertCallContract(check.calls)
  }

  const rpcFailure = fakeClient({
    activation: { payload: secretMarker },
    activationError: { message: secretMarker },
  })
  const rpcFailureMessage = await captureSafeMessage(
    () => upsertAdminAndActivateContent(rpcFailure.client, userId),
  )
  assertCallContract(rpcFailure.calls)
  assert(
    rpcFailureMessage === '검증된 2026 콘텐츠 운영 발행에 실패했습니다.'
      && !rpcFailureMessage.includes(secretMarker),
    'activation RPC 오류가 secret 또는 payload를 노출했습니다.',
  )

  const malformed = fakeClient({
    activation: {
      status: 'updated',
      facultyPublished: -1,
      resourcesPublished: 41,
      validationErrors: 3,
      payload: secretMarker,
    },
  })
  const malformedMessage = await captureSafeMessage(
    () => upsertAdminAndActivateContent(malformed.client, userId),
  )
  assertCallContract(malformed.calls)
  assert(
    malformedMessage === '검증된 2026 콘텐츠 운영 발행에 실패했습니다.'
      && !malformedMessage.includes(secretMarker),
    'malformed activation 응답이 fail-closed 또는 secret-safe가 아닙니다.',
  )

  const upsertFailure = fakeClient({ upsertError: { message: secretMarker } })
  const upsertFailureMessage = await captureSafeMessage(
    () => upsertAdminAndActivateContent(upsertFailure.client, userId),
  )
  assert(
    upsertFailure.calls.map(call => call.operation).join(',') === 'upsert'
      && upsertFailureMessage === 'admin_users 권한 행 구성에 실패했습니다.'
      && !upsertFailureMessage.includes(secretMarker),
    'admin upsert 실패 후 activation 차단 또는 secret-safe 오류 계약이 깨졌습니다.',
  )

  console.log('Verified content activation self-check passed (network calls: 0, remote writes: 0).')
}

const runSelfCheck = async () => {
  const modern = parseSupabaseApiKeys(JSON.stringify({
    data: [
      { name: 'publishable', api_key: 'sb_publishable_example' },
      { name: 'secret', api_key: 'sb_secret_example' },
    ],
  }))
  assert(modern.publishable === 'sb_publishable_example', '신형 Supabase 공개키 parser self-check 실패')
  assert(modern.secret === 'sb_secret_example', '신형 Supabase 서버키 parser self-check 실패')

  const legacy = parseSupabaseApiKeys(`notice\n${JSON.stringify([
    { name: 'anon', api_key: 'legacy-anon-jwt' },
    { name: 'service_role', api_key: 'legacy-service-jwt' },
  ])}`)
  assert(legacy.publishable === 'legacy-anon-jwt', 'legacy Supabase 공개키 parser self-check 실패')
  assert(legacy.secret === 'legacy-service-jwt', 'legacy Supabase 서버키 parser self-check 실패')

  const provenanceRunner = flags => (_command, args) => {
    if (args[0] === 'ls-files') return { status: 0, stdout: flags, stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  assertTrackedRepositoryProvenance(
    ROOT,
    provenanceRunner('H normal.txt\0H nested/file.txt\0'),
  )
  assert(
    rejectsSafely(() => assertTrackedRepositoryProvenance(
      ROOT,
      provenanceRunner('h assumed.txt\0'),
    )),
    'assume-unchanged h flag를 거부하지 않았습니다.',
  )
  assert(
    rejectsSafely(() => assertTrackedRepositoryProvenance(
      ROOT,
      provenanceRunner('S skipped.txt\0'),
    )),
    'skip-worktree S flag를 거부하지 않았습니다.',
  )

  const provenanceRepo = resolve(
    SDD_DIR,
    `.self-check-git-provenance-${process.pid}-${randomUUID()}`,
  )
  mkdirSync(provenanceRepo)
  const runLocalGit = (args) => {
    const result = runCapture('git', args, {
      cwd: provenanceRepo,
      label: 'self-check temp git',
    })
    assert(result.status === 0, 'self-check temp git 명령이 실패했습니다.')
  }
  try {
    runLocalGit(['init', '--quiet'])
    runLocalGit(['config', 'user.name', 'PHOTO NEXT Self Check'])
    runLocalGit(['config', 'user.email', 'self-check@example.invalid'])
    writeFileSync(resolve(provenanceRepo, 'tracked.txt'), 'committed\n')
    runLocalGit(['add', 'tracked.txt'])
    runLocalGit(['commit', '--quiet', '-m', 'self check'])
    assertTrackedRepositoryProvenance(provenanceRepo)
    runLocalGit(['update-index', '--assume-unchanged', 'tracked.txt'])
    writeFileSync(resolve(provenanceRepo, 'tracked.txt'), 'modified but hidden\n')
    assert(
      rejectsSafely(() => assertTrackedRepositoryProvenance(provenanceRepo)),
      '실제 temp repo의 assume-unchanged 변경을 탐지하지 못했습니다.',
    )
  }
  finally {
    rmSync(provenanceRepo, { recursive: true, force: true })
  }

  const state = makeSelfCheckState()
  validateState(state, APPROVED_BASE_COMMIT)
  for (const value of [
    state.appSecrets.nameHmac,
    state.appSecrets.phoneHmac,
    state.appSecrets.phoneEncryption,
    state.appSecrets.passwordPepper,
  ]) {
    assert(isCanonicalSecret(value), '32-byte base64url secret self-check 실패')
  }
  assert(isStrongTemporaryPassword(state.admin.password), '임시 관리자 비밀번호 self-check 실패')

  const stagingUrl = 'https://photo-next-mvp-staging.example.workers.dev'
  assert(
    parseWorkerUrl(`\u001B[32mDeployed ${stagingUrl}\u001B[0m`, WORKERS.staging) === stagingUrl,
    'workers.dev URL parser self-check 실패',
  )
  for (const absentOutput of [
    'The requested script was not found in this account. [code: 10090]',
    'This Worker does not exist on your account. [code: 10007]',
    'Worker "photo-next-mvp" not found',
  ]) {
    assert(workerNotFound(absentOutput), 'Worker absent parser self-check 실패')
  }

  const invalidCompletedState = structuredClone(state)
  invalidCompletedState.deployments.staging = { deployed: true, url: null }
  assert(
    rejectsSafely(() => validateState(invalidCompletedState, APPROVED_BASE_COMMIT)),
    '완료 state의 null URL을 거부하지 않았습니다.',
  )
  const invalidPendingState = structuredClone(state)
  invalidPendingState.deployments.staging = { deployed: false, url: stagingUrl }
  assert(
    rejectsSafely(() => validateState(invalidPendingState, APPROVED_BASE_COMMIT)),
    '미완료 state의 URL을 거부하지 않았습니다.',
  )
  const extraTopLevelState = structuredClone(state)
  extraTopLevelState.unexpected = true
  assert(
    rejectsSafely(() => validateState(extraTopLevelState, APPROVED_BASE_COMMIT)),
    'state top-level extra key를 거부하지 않았습니다.',
  )
  const extraNestedState = structuredClone(state)
  extraNestedState.appSecrets.unexpected = randomSecret()
  assert(
    rejectsSafely(() => validateState(extraNestedState, APPROVED_BASE_COMMIT)),
    'state nested extra key를 거부하지 않았습니다.',
  )
  const invalidDateState = structuredClone(state)
  invalidDateState.createdAt = '2026-07-16'
  assert(
    rejectsSafely(() => validateState(invalidDateState, APPROVED_BASE_COMMIT)),
    'state의 비표준 createdAt을 거부하지 않았습니다.',
  )
  const untouchedDeployment = { deployed: false, url: null }
  assert(
    rejectsSafely(() => completedDeploymentFromOutput('Uploaded without URL', WORKERS.staging)),
    'URL 없는 deploy output을 거부하지 않았습니다.',
  )
  assert(
    untouchedDeployment.deployed === false && untouchedDeployment.url === null,
    'URL parse 실패가 미완료 state를 변경했습니다.',
  )

  const planText = JSON.stringify(executablePlan())
  assert(!planText.includes('pnpm'), 'command plan이 pnpm에 의존합니다.')
  assert(!/OPENAI/iu.test(planText), 'command plan에 OpenAI secret이 포함되어 있습니다.')
  for (const flag of ['--linked', '--include-all', '--include-seed', '--yes']) {
    assert(executablePlan().supabaseDbPush.includes(flag), `db push plan에 ${flag}가 없습니다.`)
  }
  assert(
    JSON.stringify(executablePlan().stagingDeploy) === JSON.stringify([
      WRANGLER,
      'deploy',
      '--env',
      'staging',
      '--secrets-file',
      '<mode-0600-temporary-json>',
    ]),
    'staging deploy argv가 정확하지 않습니다.',
  )
  assert(
    JSON.stringify(executablePlan().productionDeploy) === JSON.stringify([
      WRANGLER,
      'deploy',
      '--secrets-file',
      '<mode-0600-temporary-json>',
    ]),
    'production deploy argv가 정확하지 않습니다.',
  )
  assert(
    JSON.stringify(workerTargetArguments('staging')) === JSON.stringify(['--env', 'staging'])
      && JSON.stringify(workerTargetArguments('production')) === JSON.stringify([]),
    'Wrangler environment target argv가 정확하지 않습니다.',
  )

  const inheritedEnvironment = {
    PATH: process.env.PATH ?? '',
    NUXT_SUPABASE_SECRET_KEY: state.supabaseKeys.secret,
    NUXT_PHONE_HMAC_KEY: state.appSecrets.phoneHmac,
    NUXT_UNRELATED_PRIVATE_VALUE: 'must-be-removed',
    OPENAI_API_KEY: 'must-be-removed',
    PHOTO_NEXT_OPENAI_EVAL_API_KEY: 'must-be-removed',
    PHOTO_NEXT_RUN_PAID_OPENAI_EVAL: 'must-be-removed',
  }
  const safeBuildEnvironment = buildEnvironment(state, inheritedEnvironment)
  assert(safeBuildEnvironment.NUXT_PUBLIC_SUPABASE_URL === SUPABASE_URL, 'build 공개 URL이 없습니다.')
  assert(
    safeBuildEnvironment.NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === state.supabaseKeys.publishable,
    'build 공개 Supabase key가 없습니다.',
  )
  assert(
    Object.keys(safeBuildEnvironment).every(name => (
      !name.includes('OPENAI')
      && (!name.startsWith('NUXT_') || name.startsWith('NUXT_PUBLIC_SUPABASE_'))
    )),
    'private-free build 환경에 상속된 private 변수가 남았습니다.',
  )
  const safeCloudflareEnvironment = cloudflareCommandEnvironment({
    CLOUDFLARE_ENV: 'staging',
    CLOUDFLARE_ACCOUNT_ID: 'account-id-preserved',
    CLOUDFLARE_API_TOKEN: 'token-preserved',
  })
  assert(
    !Object.hasOwn(safeCloudflareEnvironment, 'CLOUDFLARE_ENV'),
    'Wrangler 환경에 inherited CLOUDFLARE_ENV가 남았습니다.',
  )
  assert(
    safeCloudflareEnvironment.CLOUDFLARE_ACCOUNT_ID === 'account-id-preserved'
      && safeCloudflareEnvironment.CLOUDFLARE_API_TOKEN === 'token-preserved',
    'Wrangler 인증 환경값을 잘못 제거했습니다.',
  )

  const providerCalls = []
  let providerExistenceCount = 0
  let providerListCount = 0
  let providerDeletionPath = null
  const providerRunner = (command, args) => {
    providerCalls.push([command, args])
    if (args[0] === 'deployments' && args[1] === 'list') {
      providerExistenceCount += 1
      assert(
        JSON.stringify(args) === JSON.stringify([
          'deployments',
          'list',
          '--json',
          '--env',
          'staging',
        ]),
        'staging Worker existence argv가 정확하지 않습니다.',
      )
      return { status: 0, stdout: JSON.stringify([{ id: 'existing-deployment' }]), stderr: '' }
    }
    if (args[0] === 'secret' && args[1] === 'list') {
      assert(
        JSON.stringify(args) === JSON.stringify([
          'secret',
          'list',
          '--format',
          'json',
          '--env',
          'staging',
        ]),
        'staging secret list argv가 정확하지 않습니다.',
      )
      providerListCount += 1
      return providerListCount === 1
        ? {
            status: 0,
            stdout: JSON.stringify([
              { name: 'OPENAI_API_KEY' },
              { name: 'NUXT_PUBLIC_OPENAI_DEBUG' },
              { name: 'PHOTO_NEXT_OPENAI_EVAL_API_KEY' },
              { name: 'NUXT_SUPABASE_SECRET_KEY' },
            ]),
            stderr: '',
          }
        : {
            status: 0,
            stdout: JSON.stringify([{ name: 'NUXT_SUPABASE_SECRET_KEY' }]),
            stderr: '',
          }
    }
    assert(args[0] === 'secret' && args[1] === 'bulk', '예상하지 못한 provider-off mock 명령입니다.')
    providerDeletionPath = args[2]
    assert(
      JSON.stringify(args.slice(3)) === JSON.stringify(['--env', 'staging']),
      'staging secret bulk argv가 정확하지 않습니다.',
    )
    privateStat(providerDeletionPath)
    const deletion = JSON.parse(readFileSync(providerDeletionPath, 'utf8'))
    assert(
      Object.keys(deletion).sort().join(',') === [
        'NUXT_PUBLIC_OPENAI_DEBUG',
        'OPENAI_API_KEY',
        'PHOTO_NEXT_OPENAI_EVAL_API_KEY',
      ].sort().join(','),
      'OpenAI secret deletion manifest 이름이 잘못되었습니다.',
    )
    assert(Object.values(deletion).every(value => value === null), 'OpenAI secret 삭제값은 null이어야 합니다.')
    return { status: 0, stdout: '', stderr: '' }
  }
  ensureRemoteProviderOff('staging', providerRunner)
  assert(providerExistenceCount === 1, '기존 Worker의 provider-off 검증 전 존재를 확인하지 않았습니다.')
  assert(providerListCount === 2, 'OpenAI secret 삭제 후 재검증하지 않았습니다.')
  assert(providerDeletionPath !== null && !existsSync(providerDeletionPath), 'OpenAI deletion JSON이 남았습니다.')
  for (const [, args] of providerCalls) {
    assert(!args.includes('--name'), 'staging secret 명령에 legacy --name이 중복되었습니다.')
    assert(args.includes('--env') && args.includes('staging'), 'staging Wrangler env가 빠졌습니다.')
  }

  const freshDeployState = makeSelfCheckState()
  const freshDeployUrl = `https://${WORKERS.staging}.self-check.workers.dev`
  const freshDeployCalls = []
  let freshExistenceCount = 0
  let freshPersistCount = 0
  let freshSecretsPath = null
  const freshDeployRunner = (command, args) => {
    assert(command === WRANGLER, '신규 staging 배포가 Wrangler 외의 명령을 호출했습니다.')
    freshDeployCalls.push([command, args])
    if (args[0] === 'deployments' && args[1] === 'list') {
      freshExistenceCount += 1
      assert(
        JSON.stringify(args) === JSON.stringify([
          'deployments',
          'list',
          '--json',
          '--env',
          'staging',
        ]),
        '신규 staging Worker의 existence argv가 정확하지 않습니다.',
      )
      return freshExistenceCount === 1
        ? {
            status: 1,
            stdout: '',
            stderr: 'The requested script was not found in this account. [code: 10090]',
          }
        : {
            status: 0,
            stdout: JSON.stringify([{ id: 'fresh-deployment' }]),
            stderr: '',
          }
    }
    if (args[0] === 'deploy') {
      assert(freshExistenceCount === 1, '신규 Worker 존재 확인 전에 배포했습니다.')
      assert(
        args[1] === '--env'
          && args[2] === 'staging'
          && args[3] === '--secrets-file'
          && args[5] === '--message'
          && args[6] === `Deploy ${freshDeployState.commit}`,
        '신규 staging deploy argv가 정확하지 않습니다.',
      )
      freshSecretsPath = args[4]
      privateStat(freshSecretsPath)
      return { status: 0, stdout: `Deployed ${freshDeployUrl}`, stderr: '' }
    }
    if (args[0] === 'secret' && args[1] === 'list') {
      assert(freshExistenceCount === 2, '배포 후 Worker 존재 재검증 전에 secret을 조회했습니다.')
      assert(
        JSON.stringify(args) === JSON.stringify([
          'secret',
          'list',
          '--format',
          'json',
          '--env',
          'staging',
        ]),
        '배포 후 staging secret list argv가 정확하지 않습니다.',
      )
      return { status: 0, stdout: '[]', stderr: '' }
    }
    fail('신규 staging 배포 self-check에서 예상하지 못한 명령입니다.')
  }
  deployEnvironment(
    'staging',
    freshDeployState,
    freshDeployRunner,
    persistedState => {
      assert(persistedState === freshDeployState, '신규 staging 배포가 다른 state를 저장하려 했습니다.')
      freshPersistCount += 1
    },
  )
  assert(
    freshDeployCalls.map(([, args]) => args[0]).join(',')
      === 'deployments,deploy,deployments,secret',
    '신규 staging Worker의 precheck/deploy/postcheck 순서가 잘못되었습니다.',
  )
  assert(
    freshDeployState.deployments.staging.deployed
      && freshDeployState.deployments.staging.url === freshDeployUrl
      && freshPersistCount === 1,
    '신규 staging Worker의 검증된 배포 완료 state가 저장되지 않았습니다.',
  )
  assert(
    freshSecretsPath !== null && !existsSync(freshSecretsPath),
    '신규 staging Worker 배포의 임시 secret 파일이 남았습니다.',
  )

  const missingPostState = makeSelfCheckState()
  const missingPostCalls = []
  let missingPostExistenceCount = 0
  let missingPostPersistCount = 0
  let missingPostSecretsPath = null
  const missingPostRunner = (command, args) => {
    assert(command === WRANGLER, '배포 후 missing self-check가 Wrangler 외의 명령을 호출했습니다.')
    missingPostCalls.push([command, args])
    if (args[0] === 'deployments' && args[1] === 'list') {
      missingPostExistenceCount += 1
      return {
        status: 1,
        stdout: '',
        stderr: missingPostExistenceCount === 1
          ? 'The requested script was not found in this account. [code: 10090]'
          : 'This Worker does not exist on your account. [code: 10007]',
      }
    }
    if (args[0] === 'deploy') {
      missingPostSecretsPath = args[4]
      privateStat(missingPostSecretsPath)
      return { status: 0, stdout: `Deployed ${freshDeployUrl}`, stderr: '' }
    }
    fail('배포 후 missing Worker에 secret list를 호출했습니다.')
  }
  assert(
    rejectsSafely(() => deployEnvironment(
      'staging',
      missingPostState,
      missingPostRunner,
      () => { missingPostPersistCount += 1 },
    )),
    '배포 후 사라진 staging Worker를 성공으로 처리했습니다.',
  )
  assert(
    missingPostCalls.map(([, args]) => args[0]).join(',') === 'deployments,deploy,deployments',
    '배포 후 missing Worker 검증 순서가 잘못되었습니다.',
  )
  assert(
    !missingPostState.deployments.staging.deployed
      && missingPostState.deployments.staging.url === null
      && missingPostPersistCount === 0,
    '배포 후 missing Worker를 완료 state로 저장했습니다.',
  )
  assert(
    missingPostSecretsPath !== null && !existsSync(missingPostSecretsPath),
    '배포 후 missing self-check의 임시 secret 파일이 남았습니다.',
  )

  const completedMissingState = makeSelfCheckState()
  completedMissingState.deployments.staging = { deployed: true, url: freshDeployUrl }
  let completedMissingCalls = 0
  let completedMissingPersistCount = 0
  assert(
    rejectsSafely(() => deployEnvironment(
      'staging',
      completedMissingState,
      (_command, args) => {
        completedMissingCalls += 1
        assert(
          JSON.stringify(args) === JSON.stringify([
            'deployments',
            'list',
            '--json',
            '--env',
            'staging',
          ]),
          '완료 state의 missing Worker existence argv가 정확하지 않습니다.',
        )
        return {
          status: 1,
          stdout: '',
          stderr: 'This Worker does not exist on your account. [code: 10007]',
        }
      },
      () => { completedMissingPersistCount += 1 },
    )),
    '배포 완료 state의 missing Worker를 성공으로 처리했습니다.',
  )
  assert(
    completedMissingCalls === 1 && completedMissingPersistCount === 0,
    '배포 완료 state의 missing Worker 검증이 fail-closed가 아닙니다.',
  )
  console.log('Fresh staging Worker deployment branch self-check passed.')

  const lockRoot = resolve(SDD_DIR, `.self-check-lock-${process.pid}-${randomUUID()}`)
  const lockPath = resolve(lockRoot, 'deploy.lock')
  const foreignTemporary = resolve(
    lockRoot,
    '.remote-deploy-secrets-staging-foreign.json',
  )
  mkdirSync(lockRoot)
  let firstLock
  let secondLock
  try {
    firstLock = acquireDeploymentLockAtPath(lockPath)
    privateStat(lockPath)
    writePrivateJson(foreignTemporary, { marker: 'owned-by-first-run' })
    assert(
      rejectsSafely(() => acquireDeploymentLockAtPath(lockPath)),
      '동시 배포 lock 획득을 차단하지 않았습니다.',
    )
    assert(
      existsSync(foreignTemporary),
      'lock 획득에 실패한 실행이 다른 실행의 임시 파일을 삭제했습니다.',
    )
    releaseDeploymentLock(firstLock)
    firstLock = null
    secondLock = acquireDeploymentLockAtPath(lockPath)
    cleanupRuntimeSecretFiles(lockRoot)
    assert(!existsSync(foreignTemporary), 'lock 소유 후 stale 임시 파일을 정리하지 못했습니다.')
  }
  finally {
    releaseDeploymentLock(firstLock, false)
    releaseDeploymentLock(secondLock, false)
    safeUnlink(foreignTemporary)
    rmSync(lockRoot, { recursive: true, force: true })
  }

  const artifactRoot = resolve(SDD_DIR, `.self-check-artifacts-${process.pid}-${randomUUID()}`)
  const artifactPublic = resolve(artifactRoot, 'public')
  const artifactServer = resolve(artifactRoot, 'server')
  assert(
    rejectsSafely(() => assertArtifactsContainNoPrivateSecrets(state, [
      resolve(artifactRoot, 'missing-public'),
      resolve(artifactRoot, 'missing-server'),
    ])),
    '누락된 artifact root를 거부하지 않았습니다.',
  )
  mkdirSync(artifactPublic, { recursive: true })
  mkdirSync(artifactServer, { recursive: true })
  try {
    writeFileSync(
      resolve(artifactPublic, 'safe.js'),
      `${state.supabaseKeys.publishable}|${SUPABASE_URL}|${state.commit}`,
    )
    writeFileSync(resolve(artifactServer, 'safe.mjs'), 'export default true')
    assertArtifactsContainNoPrivateSecrets(state, [artifactPublic, artifactServer])

    const boundaryFile = resolve(artifactPublic, 'boundary.js')
    writeFileSync(
      boundaryFile,
      Buffer.concat([
        Buffer.alloc(ARTIFACT_SCAN_CHUNK_BYTES - 3, 0x61),
        Buffer.from(state.appSecrets.phoneHmac),
      ]),
    )
    assert(
      artifactTreesContainPrivateSecret(state, [artifactPublic, artifactServer]),
      'chunk boundary를 가로지르는 secret marker를 찾지 못했습니다.',
    )
    safeUnlink(boundaryFile)

    writeFileSync(
      resolve(artifactServer, 'large.mjs'),
      Buffer.concat([
        Buffer.alloc(8 * 1024 * 1024 + 17, 0x62),
        Buffer.from(state.supabaseKeys.secret),
      ]),
    )
    assert(
      artifactTreesContainPrivateSecret(state, [artifactPublic, artifactServer]),
      'large server artifact 끝의 secret marker를 찾지 못했습니다.',
    )
  }
  finally {
    rmSync(artifactRoot, { recursive: true, force: true })
  }

  const completedState = structuredClone(state)
  completedState.deployments.staging = { deployed: true, url: stagingUrl }
  completedState.deployments.production = {
    deployed: true,
    url: 'https://photo-next-mvp.example.workers.dev',
  }
  const handoff = createDeploymentResult(completedState)
  assert(
    Object.keys(handoff).sort().join(',') === [
      'adminUrl',
      'commit',
      'email',
      'password',
      'productionUrl',
      'stagingUrl',
    ].sort().join(','),
    '최종 credentials result 필드가 허용 목록과 다릅니다.',
  )
  const handoffJson = JSON.stringify(handoff)
  for (const forbiddenValue of [
    completedState.supabaseKeys.secret,
    completedState.appSecrets.nameHmac,
    completedState.appSecrets.phoneHmac,
    completedState.appSecrets.phoneEncryption,
    completedState.appSecrets.passwordPepper,
  ]) {
    assert(!handoffJson.includes(forbiddenValue), '최종 result에 service/app secret이 포함되었습니다.')
  }

  const temporary = resolve(SDD_DIR, `.self-check-secrets-${process.pid}-${randomUUID()}.json`)
  try {
    writePrivateJson(temporary, runtimeSecrets(state))
    privateStat(temporary)
    const serialized = readFileSync(temporary, 'utf8')
    assert(!/OPENAI/iu.test(serialized), '임시 secrets JSON에 OpenAI 항목이 있습니다.')
  }
  finally {
    safeUnlink(temporary)
  }
  assert(!existsSync(temporary), 'self-check 임시 secret 파일이 남았습니다.')

  const failureTargetName = `.self-check-atomic-failure-${process.pid}-${randomUUID()}`
  const failureTarget = resolve(SDD_DIR, failureTargetName)
  mkdirSync(failureTarget)
  let renameFailed = false
  try {
    writePrivateJson(failureTarget, runtimeSecrets(state))
  }
  catch {
    renameFailed = true
  }
  const leakedNames = readdirSync(SDD_DIR)
    .filter(name => name.startsWith(`${failureTargetName}.`) && name.endsWith('.tmp'))
  for (const name of leakedNames) safeUnlink(resolve(SDD_DIR, name))
  rmdirSync(failureTarget)
  assert(renameFailed, 'atomic secret write failure self-check가 실패를 재현하지 못했습니다.')
  assert(leakedNames.length === 0, 'atomic secret write 실패 후 임시 secret 파일이 남았습니다.')

  await selfCheckVerifiedContentActivation()
  console.log('Remote deployment runner self-check passed (network calls: 0, remote writes: 0).')
}

const runDeployment = async () => {
  const lock = acquireDeploymentLock()
  try {
    verifyLocalBinaries()
    cleanupRuntimeSecretFiles()
    const gitState = verifyGitPreflight()
    verifyLinkedProject()
    verifyCloudflareAuthentication()

    let state = loadState(gitState.commit)
    if (!state) {
      assert(!existsSync(RESULT_PATH), `기존 배포 결과 파일이 있습니다: ${RESULT_PATH}`)
      assertNoExistingWorkersWithoutState()
      const supabaseKeys = getSupabaseApiKeys()
      state = createState(gitState, supabaseKeys)
      saveState(state)
    }

    pushDatabase(state)
    verifyAndBuild(state)
    deployEnvironment('staging', state)
    await configureAdmin(state)
    deployEnvironment('production', state)
    await smokeDeployments(state)
    writeResultAndRemoveState(state)

    console.log('원격 배포와 smoke 검증이 완료되었습니다.')
    console.log(`관리자 자격증명과 URL은 다음 0600 파일에만 저장했습니다: ${RESULT_PATH}`)
    console.log('OpenAI provider secret은 설정하지 않았습니다.')
  }
  finally {
    releaseDeploymentLock(lock, false)
  }
}

const cleanupOnExit = () => {
  for (const path of [...activeSecretFiles]) {
    try {
      safeUnlink(path)
    }
    catch {
      // Never print paths or file contents from an exit handler.
    }
  }
  try {
    releaseDeploymentLock(ownedDeploymentLock, false)
  }
  catch {
    // Never remove a lock whose ownership cannot be proven.
  }
}

process.on('exit', cleanupOnExit)
process.on('SIGINT', () => {
  cleanupOnExit()
  process.exit(130)
})
process.on('SIGTERM', () => {
  cleanupOnExit()
  process.exit(143)
})

const main = async () => {
  const [mode, ...extra] = process.argv.slice(2)
  assert(extra.length === 0, '배포 러너는 추가 인자를 허용하지 않습니다.')
  if (mode === '--self-check') {
    await runSelfCheck()
    return
  }
  if (mode === '--plan') {
    printPlan()
    return
  }
  assert(mode === undefined, '허용 인자는 --self-check 또는 --plan뿐입니다.')
  await runDeployment()
}

main().catch(error => {
  const message = error instanceof SafeDeploymentError
    ? error.message
    : '예상하지 못한 오류로 배포를 중단했습니다. 비밀값은 출력하지 않았습니다.'
  console.error(`배포 중단: ${message}`)
  if (existsSync(STATE_PATH)) {
    console.error(`안전한 재개 state: ${STATE_PATH}`)
  }
  process.exitCode = 1
})
