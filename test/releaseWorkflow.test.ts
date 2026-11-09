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
  with?: Record<string, unknown>
  env?: Record<string, string>
}
interface Job {
  if?: string
  permissions?: unknown
  steps: Step[]
}
interface Workflow {
  on: unknown
  permissions?: Record<string, string>
  jobs: Record<string, Job>
}

const workflow = (raw ? parse(raw) : { on: {}, jobs: {} }) as Workflow
const jobs = Object.values(workflow.jobs)
const steps = jobs.flatMap((job) => job.steps ?? [])
const runs = steps.map((s) => s.run ?? '').filter(Boolean)
const indexOfRun = (pattern: RegExp) => steps.findIndex((s) => pattern.test(s.run ?? ''))
const publishIndex = indexOfRun(/\bnpm publish\b/)
const publish = steps[publishIndex]

describe('release workflow', () => {
  it('exists', () => {
    expect(raw).not.toBe('')
  })

  // "A release is started by hand on the default branch"
  it('runs only when started by hand', () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null })
  })

  it('publishes only from main', () => {
    expect(jobs).toHaveLength(1)
    expect(jobs[0].if).toBe("github.ref == 'refs/heads/main'")
  })

  // "Nothing is published unless the checks pass"
  it('installs from the lock file and runs the checks as their own steps before publishing', () => {
    const order = [/^npm ci$/, /^npm run typecheck$/, /^npm test$/, /^npm run build$/].map((p) =>
      steps.findIndex((s) => p.test((s.run ?? '').trim())),
    )
    order.forEach((i) => expect(i).toBeGreaterThanOrEqual(0))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(publishIndex).toBeGreaterThan(order[order.length - 1])
  })

  // "The version in package.json is published publicly with provenance"
  it('publishes publicly with provenance, never forced', () => {
    expect(publish?.run?.trim()).toBe('npm publish --access public --provenance --ignore-scripts')
    for (const run of runs) expect(run).not.toMatch(/--force|\bunpublish\b|\bnpm version\b/)
  })

  // "The release authenticates with trusted publishing or the token"
  it('uses an npm with trusted publishing, the npm registry, and the token as NODE_AUTH_TOKEN', () => {
    expect(indexOfRun(/^npm install -g npm@\^11\.5\.1$/)).toBeGreaterThanOrEqual(0)
    expect(indexOfRun(/^npm install -g npm@\^11\.5\.1$/)).toBeLessThan(publishIndex)
    const node = steps.find((s) => s.uses?.startsWith('actions/setup-node@'))
    expect(node?.with).toMatchObject({ 'node-version': 22, 'registry-url': 'https://registry.npmjs.org' })
    expect(publish?.env).toEqual({ NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' })
  })

  // "The release's reach is kept small"
  it('grants exactly contents: read and id-token: write, at workflow level only', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', 'id-token': 'write' })
    for (const job of jobs) expect(job.permissions).toBeUndefined()
  })

  it('pins every action to a full commit SHA', () => {
    const uses = steps.map((s) => s.uses).filter((u): u is string => !!u)
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
  })

  it('checks out without keeping credentials, and caches nothing', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with).toMatchObject({ 'persist-credentials': false })
    for (const s of steps) {
      expect(s.with?.cache).toBeUndefined()
      expect(s.uses ?? '').not.toMatch(/^actions\/cache@/)
    }
  })

  it('gives NPM_TOKEN to the publish step alone, which runs no package scripts', () => {
    expect(raw.match(/secrets\.NPM_TOKEN/g)).toHaveLength(1)
    expect(JSON.stringify(publish)).toContain('secrets.NPM_TOKEN')
    expect(publish?.run).toContain('--ignore-scripts')
    expect(raw).not.toMatch(/secrets\.(?!NPM_TOKEN\b)/)
  })

  it('never shows the environment', () => {
    for (const run of runs) expect(run).not.toMatch(/\b(env|printenv)\b|set -x|echo .*secrets|echo .*NODE_AUTH_TOKEN/)
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
