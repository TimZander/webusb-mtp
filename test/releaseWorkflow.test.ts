// Spec: npm-release › every requirement. npm itself can't run here, so these read the workflow
// file and the README and check what they say the release may do.
/// <reference types="node" />
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflowPath = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url))
const raw = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : ''

interface Step {
  name?: string
  uses?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
  'continue-on-error'?: unknown
}
interface Job {
  if?: string
  needs?: string | string[]
  permissions?: Record<string, string>
  env?: unknown
  'timeout-minutes'?: number
  'continue-on-error'?: unknown
  steps: Step[]
}
interface Workflow {
  on: unknown
  permissions?: Record<string, string>
  env?: unknown
  concurrency?: unknown
  jobs: Record<string, Job>
}

const workflow = (raw ? parse(raw) : { on: {}, jobs: {} }) as Workflow
const jobs = Object.values(workflow.jobs)
const check = workflow.jobs.check ?? { steps: [] }
const publishJob = workflow.jobs.publish ?? { steps: [] }
const allSteps = jobs.flatMap((job) => job.steps ?? [])
const runs = allSteps.map((s) => s.run ?? '').filter(Boolean)
const runIndex = (steps: Step[], pattern: RegExp) => steps.findIndex((s) => pattern.test((s.run ?? '').trim()))
const publish = publishJob.steps.find((s) => /\bnpm publish\b/.test(s.run ?? ''))

describe('release workflow', () => {
  it('exists, with a check job and a publish job', () => {
    expect(raw).not.toBe('')
    expect(Object.keys(workflow.jobs).sort()).toEqual(['check', 'publish'])
  })

  // "A release is started by hand on the default branch"
  it('runs only when started by hand', () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null })
  })

  it('publishes only from main', () => {
    expect(publishJob.if).toBe("github.ref == 'refs/heads/main'")
  })

  // "Nothing is published unless the checks pass"
  it('installs from the lock file and runs the checks as their own steps in the check job', () => {
    const order = [/^npm ci$/, /^npm run typecheck$/, /^npm test$/, /^npm run build$/].map((p) => runIndex(check.steps, p))
    order.forEach((i) => expect(i).toBeGreaterThanOrEqual(0))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('publishes only after the check job, with nothing that ignores a failure', () => {
    expect([publishJob.needs].flat()).toEqual(['check'])
    for (const job of jobs) {
      expect(job['continue-on-error']).toBeUndefined()
      expect(job.if ?? '').not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/)
      for (const s of job.steps) {
        expect(s['continue-on-error']).toBeUndefined()
        expect(s.if ?? '').not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/)
      }
    }
  })

  // "The version in package.json is published publicly with provenance"
  it("publishes the check job's build publicly with provenance, never forced", () => {
    const upload = check.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'))
    const download = publishJob.steps.find((s) => s.uses?.startsWith('actions/download-artifact@'))
    expect(upload?.with).toMatchObject({ name: 'dist', path: 'dist' })
    expect(download?.with).toMatchObject({ name: 'dist', path: 'dist' })
    expect(publish?.run?.trim()).toBe('npm publish --access public --provenance --ignore-scripts')
    for (const run of runs) expect(run).not.toMatch(/--force|\bunpublish\b|\bnpm version\b/)
  })

  // "The release authenticates with trusted publishing or the token"
  it('publishes with an exact npm with trusted publishing, the npm registry, and the token as NODE_AUTH_TOKEN', () => {
    const npm = publishJob.steps.find((s) => /^npm install -g npm@/.test(s.run ?? ''))
    const version = npm?.run?.match(/^npm install -g npm@(\d+)\.(\d+)\.(\d+)$/)
    expect(version).not.toBeNull()
    const [major, minor, patch] = version!.slice(1).map(Number)
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(11 * 1e6 + 5 * 1e3 + 1)
    expect(publishJob.steps.indexOf(npm!)).toBeLessThan(publishJob.steps.indexOf(publish!))
    const node = publishJob.steps.find((s) => s.uses?.startsWith('actions/setup-node@'))
    expect(node?.with).toMatchObject({ 'node-version': 22, 'registry-url': 'https://registry.npmjs.org' })
    expect(publish?.env).toEqual({ NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' })
  })

  // "The release's reach is kept small"
  it('grants contents: read, and id-token: write to the publish job alone', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(check.permissions).toBeUndefined()
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write' })
  })

  it('runs no project code in the publish job', () => {
    const commands = publishJob.steps.map((s) => s.run?.trim()).filter(Boolean)
    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatch(/^npm install -g npm@\d+\.\d+\.\d+$/)
    expect(commands[1]).toBe('npm publish --access public --provenance --ignore-scripts')
  })

  it('pins every action to a full commit SHA', () => {
    const uses = allSteps.map((s) => s.uses).filter((u): u is string => !!u)
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
  })

  it('checks out without keeping credentials, and caches nothing', () => {
    const checkouts = allSteps.filter((s) => s.uses?.startsWith('actions/checkout@'))
    expect(checkouts).toHaveLength(2)
    for (const c of checkouts) expect(c.with).toMatchObject({ 'persist-credentials': false })
    for (const s of allSteps) {
      expect(s.with?.cache).toBeUndefined()
      expect(s.uses ?? '').not.toMatch(/^actions\/cache@/)
    }
  })

  it('gives NPM_TOKEN to the publish step alone, which runs no package scripts', () => {
    expect(raw.match(/secrets/g)).toHaveLength(1)
    expect(raw).toContain('secrets.NPM_TOKEN')
    expect(JSON.stringify(publish)).toContain('secrets.NPM_TOKEN')
    expect(workflow.env).toBeUndefined()
    for (const job of jobs) expect(job.env).toBeUndefined()
    expect(publish?.run).toContain('--ignore-scripts')
  })

  it('never shows the environment', () => {
    for (const run of runs) expect(run).not.toMatch(/\b(env|printenv)\b|set -x|echo .*secrets|echo .*NODE_AUTH_TOKEN/)
  })

  // "Releases run one at a time"
  it('queues a second release, and stops each job after 15 minutes', () => {
    expect(workflow.concurrency).toEqual({ group: 'release', 'cancel-in-progress': false })
    for (const job of jobs) expect(job['timeout-minutes']).toBe(15)
  })
})

// "Releasing is documented"
describe('README', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
  const releasing = readme.split(/^## Releasing$/m)[1]?.split(/^## /m)[0] ?? ''

  it('installs from npm, with no note that it is not published', () => {
    expect(readme).toContain('npm install webusb-mtp')
    expect(readme).not.toMatch(/not published/i)
  })

  it('says how a release is made', () => {
    expect(releasing).toMatch(/version/i)
    expect(releasing).toMatch(/pull request/i)
    expect(releasing).toContain('release.yml')
    expect(releasing).toContain('main')
    expect(releasing).toContain('NPM_TOKEN')
    expect(releasing).toMatch(/trusted publish/i)
  })
})
