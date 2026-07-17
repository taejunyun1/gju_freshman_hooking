'use strict'

const { syncBuiltinESMExports } = require('node:module')
const childProcess = require('node:child_process')
const dns = require('node:dns')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

const blocked = name => () => {
  throw new Error(`REMOTE_SIDE_EFFECT_BLOCKED:${name}`)
}

globalThis.fetch = blocked('fetch')

for (const name of [
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
]) {
  childProcess[name] = blocked(`child_process.${name}`)
}

for (const name of ['connect', 'createConnection', 'createServer']) {
  net[name] = blocked(`net.${name}`)
}

for (const [moduleName, moduleValue] of [['http', http], ['https', https]]) {
  for (const name of ['createServer', 'get', 'request']) {
    moduleValue[name] = blocked(`${moduleName}.${name}`)
  }
}

for (const name of [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
]) {
  dns[name] = blocked(`dns.${name}`)
  if (dns.promises && typeof dns.promises[name] === 'function') {
    dns.promises[name] = blocked(`dns.promises.${name}`)
  }
}

syncBuiltinESMExports()
