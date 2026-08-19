import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const [exeArg, appDataArg, artifactArg] = process.argv.slice(2)
if (!exeArg || !appDataArg) {
  throw new Error('Usage: node scripts/mcp-smoke.mjs <keymaster-exe> <appdata-dir> [artifact-log]')
}

const exe = path.resolve(exeArg)
const appData = path.resolve(appDataArg)
const artifactLog = path.resolve(artifactArg ?? path.join('artifacts', 'mcp-smoke.log'))
const profileId = 'mcp-smoke-profile'
const macroId = 'mcp-smoke-macro'
const logLines = []

function log(message, data) {
  const line = data === undefined ? message : `${message} ${JSON.stringify(data)}`
  logLines.push(line)
  console.log(line)
}

function structured(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent
  const text = result?.content?.find?.((item) => item?.type === 'text')?.text
  if (typeof text === 'string') {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return result
}

async function flushLog() {
  await mkdir(path.dirname(artifactLog), { recursive: true })
  await writeFile(artifactLog, `${logLines.join('\n')}\n`, 'utf8')
}

const env = { ...process.env, APPDATA: appData }

async function seedProfile() {
  const profilesDir = path.join(appData, 'KeyMaster Pro', 'profiles')
  await mkdir(profilesDir, { recursive: true })
  const profile = {
    schemaVersion: 7,
    id: profileId,
    name: 'MCP Smoke Profile',
    isDefault: false,
    linkedApps: [],
    bindings: [],
    order: 0,
    rules: [],
    macros: [
      {
        id: macroId,
        name: 'MCP Smoke Macro',
        steps: [
          { action: { type: 'keyDown', code: 0x87 }, delayMs: 1 },
          { action: { type: 'keyUp', code: 0x87 }, delayMs: 1 },
        ],
      },
    ],
    layers: [{ id: 'mcp-smoke-layer', name: 'MCP Smoke Layer' }],
    folders: [],
  }
  await writeFile(path.join(profilesDir, `${profileId}.json`), JSON.stringify(profile, null, 2), 'utf8')
}

function startDaemon() {
  log('DAEMON spawn', { exe, appData })
  const child = spawn(exe, ['--daemon'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk) => log(`DAEMON stdout ${String(chunk).trim()}`))
  child.stderr?.on('data', (chunk) => log(`DAEMON stderr ${String(chunk).trim()}`))
  return child
}

function createClient(args, mode) {
  const client = new Client(
    { name: `keymaster-mcp-smoke-${mode}`, version: '1.0.0' },
    { versionNegotiation: { mode } },
  )
  const transport = new StdioClientTransport({ command: exe, args, env })
  return { client, transport }
}

async function connectClient(args, mode) {
  const { client, transport } = createClient(args, mode)
  await client.connect(transport)
  log('MCP connected', {
    args,
    mode,
    protocol: client.getNegotiatedProtocolVersion?.(),
    server: client.getServerVersion?.(),
    discover: client.getDiscoverResult?.() ? 'modern' : 'legacy',
  })
  return client
}

async function retry(label, fn, attempts = 40) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const validationRule = {
  name: 'MCP validation rule',
  trigger: { type: 'keyDown', code: 0x78, modifiers: 0 },
  actions: [{ type: 'typeText', text: 'mcp-validate', dateFormat: 'dmy', timeFormat: 'hm24' }],
  holdActions: null,
  conditions: [],
  priority: 10,
  enabled: true,
  folderId: null,
}

const appliedRule = {
  name: 'MCP applied rule',
  trigger: { type: 'keyDown', code: 0x79, modifiers: 0 },
  actions: [{ type: 'typeText', text: 'mcp-applied', dateFormat: 'dmy', timeFormat: 'hm24' }],
  holdActions: null,
  conditions: [],
  priority: 10,
  enabled: true,
  folderId: null,
}

let daemon
try {
  await seedProfile()
  daemon = startDaemon()

  // READ-ONLY mode: legacy initialize handshake, four read/validate tools succeed,
  // and all three mutating/executing tools are actively rejected if called anyway.
  const readClient = await connectClient(['--mcp'], 'legacy')
  try {
    const readTools = await readClient.listTools()
    const readNames = readTools.tools.map((tool) => tool.name).sort()
    assert.deepEqual(readNames, [
      'keymaster_get_profile',
      'keymaster_list_profiles',
      'keymaster_runtime_status',
      'keymaster_validate_rule',
    ])
    log('READ tools/list PASS', readNames)

    const listResult = await retry('keymaster_list_profiles', () => readClient.callTool({ name: 'keymaster_list_profiles', arguments: {} }))
    assert.equal(listResult.isError, false)
    assert.ok(structured(listResult).profiles.some((profile) => profile.id === profileId))
    log('READ keymaster_list_profiles PASS')

    const getResult = await readClient.callTool({ name: 'keymaster_get_profile', arguments: { id: profileId } })
    assert.equal(getResult.isError, false)
    assert.equal(structured(getResult).id, profileId)
    log('READ keymaster_get_profile PASS')

    const statusResult = await readClient.callTool({ name: 'keymaster_runtime_status', arguments: {} })
    assert.equal(statusResult.isError, false)
    log('READ keymaster_runtime_status PASS', structured(statusResult))

    const validateResult = await readClient.callTool({
      name: 'keymaster_validate_rule',
      arguments: { profileId, rule: validationRule },
    })
    assert.equal(validateResult.isError, false)
    assert.equal(structured(validateResult).name, validationRule.name)
    log('READ keymaster_validate_rule PASS')

    for (const [name, args] of [
      ['keymaster_activate_profile', { id: profileId }],
      ['keymaster_run_macro', { profileId, macroId }],
      ['keymaster_apply_rule', { profileId, rule: appliedRule }],
    ]) {
      const denied = await readClient.callTool({ name, arguments: args })
      assert.equal(denied.isError, true, `${name} must be denied in read-only mode`)
      log(`READ ${name} DENIED PASS`)
    }
  } finally {
    await readClient.close()
  }

  // WRITE mode: use modern negotiation and execute all seven advertised tools.
  const writeClient = await connectClient(['--mcp-write'], 'auto')
  try {
    const writeTools = await writeClient.listTools()
    const writeNames = writeTools.tools.map((tool) => tool.name).sort()
    assert.deepEqual(writeNames, [
      'keymaster_activate_profile',
      'keymaster_apply_rule',
      'keymaster_get_profile',
      'keymaster_list_profiles',
      'keymaster_run_macro',
      'keymaster_runtime_status',
      'keymaster_validate_rule',
    ])
    log('WRITE tools/list PASS', writeNames)

    for (const [name, args] of [
      ['keymaster_list_profiles', {}],
      ['keymaster_get_profile', { id: profileId }],
      ['keymaster_runtime_status', {}],
      ['keymaster_validate_rule', { profileId, rule: validationRule }],
      ['keymaster_activate_profile', { id: profileId }],
      ['keymaster_run_macro', { profileId, macroId, speed: 1, repeatCount: 1 }],
      ['keymaster_apply_rule', { profileId, rule: appliedRule }],
    ]) {
      const result = await writeClient.callTool({ name, arguments: args })
      assert.equal(result.isError, false, `${name} failed: ${JSON.stringify(result.content)}`)
      log(`WRITE ${name} PASS`, structured(result))
    }

    const finalProfileResult = await writeClient.callTool({ name: 'keymaster_get_profile', arguments: { id: profileId } })
    const finalProfile = structured(finalProfileResult)
    assert.ok(finalProfile.rules.some((rule) => rule.name === appliedRule.name), 'apply_rule did not persist')
    log('WRITE persistence verification PASS', { rules: finalProfile.rules.length })
  } finally {
    await writeClient.close()
  }

  const saved = JSON.parse(await readFile(path.join(appData, 'KeyMaster Pro', 'profiles', `${profileId}.json`), 'utf8'))
  assert.ok(saved.rules.some((rule) => rule.name === appliedRule.name))
  log('DISK persistence verification PASS')
  log('MCP SMOKE PASS')
} catch (error) {
  log('MCP SMOKE FAIL', { error: error instanceof Error ? error.stack ?? error.message : String(error) })
  throw error
} finally {
  if (daemon && !daemon.killed) daemon.kill()
  await flushLog()
}
