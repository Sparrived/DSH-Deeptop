import { defineTool } from '@deepseek-ai/dsh-tools'
import { installSkillFromSource } from './skill-installer.mjs'

export const name = 'skill-installer'
export const inject = ['tools']

export function apply(ctx) {
  return ctx.tools.register(defineTool({
    name: 'skill-install',
    description: 'Install a Skill from a GitHub repository or Skill directory URL into the current DSH user skill directory.',
    parameters: {
      source: {
        type: 'string',
        required: true,
        description: 'HTTPS GitHub repository or tree URL. A repository root is accepted when it contains one matching skill directory.',
      },
      path: {
        type: 'string',
        description: 'Optional relative Skill directory inside the repository, for example skills/taste-skill.',
      },
      ref: {
        type: 'string',
        description: 'Optional Git branch, tag, or commit. Defaults to main.',
      },
      name: {
        type: 'string',
        description: 'Optional destination Skill name. Defaults to the selected directory name.',
      },
      method: {
        type: 'string',
        description: 'Download method: auto, download, or git. Defaults to auto.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          skillName: { type: 'string', required: true },
          source: { type: 'string', required: true },
          ref: { type: 'string', required: true },
          path: { type: 'string', required: true },
          installPath: { type: 'string', required: true },
          method: { type: 'string', required: true },
          registered: { type: 'boolean', required: true },
          visibleInCurrentSession: { type: 'boolean', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Installed ${value.skillName} at ${value.installPath}. Current session catalog visibility: ${value.visibleInCurrentSession ? 'yes' : 'refresh required'}.`,
      }],
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('skill-install requires an active agent session')
      const approval = ctx.get('approval')
      if (!approval?.request) throw new Error('skill-install requires the DSH approval service')
      const outcome = await approval.request({
        agent: exec.agent,
        toolName: 'skill-install',
        callId: exec.callId,
        reason: `Install Skill from ${args.source}`,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') throw new Error(`Skill installation was ${outcome}`)
      const result = await installSkillFromSource(args, { signal: exec.signal })
      const skills = ctx.get('skills')
      const visibleInCurrentSession = skills
        ? (await skills.list({ cwd: exec.agent.session.header.cwd, signal: exec.signal, scope: exec.agent })).some(skill => skill.name === result.skillName)
        : false
      return { ...result, visibleInCurrentSession }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Install Skill ${args.source}`,
      kind: 'write',
      rawInput: args.source,
    }),
  }))
}
