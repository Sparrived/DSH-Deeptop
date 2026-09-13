#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const args = parseArgs(process.argv.slice(2))
const tag = args.tag ?? args.to ?? 'HEAD'
const output = args.output ?? 'release-notes.md'
const version = args.version ?? tag.replace(/^v/, '')
const repository = process.env.GITHUB_REPOSITORY
const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
const commitUrl = repository ? `${server}/${repository}/commit` : undefined

const endRef = resolveRef(args.to ?? tag)
const currentTag = currentReleaseTag(endRef)
const releaseTag = currentTag || (tag !== 'HEAD' ? tag : `v${version}`)
const startRef = args.from ?? previousTag(endRef, releaseTag)
const range = startRef ? `${startRef}..${endRef}` : endRef
const commits = readCommits(range)
const groups = new Map([
  ['feat', { title: '✨ 新增功能', commits: [] }],
  ['fix', { title: '🐛 修复问题', commits: [] }],
  ['improve', { title: '🛠️ 改进与优化', commits: [] }],
  ['remove', { title: '🧹 删除与清理', commits: [] }],
  ['docs', { title: '📝 文档与测试', commits: [] }],
  ['release', { title: '📦 构建与发布', commits: [] }],
  ['other', { title: '🔎 其他变更', commits: [] }],
])

for (const commit of commits) groups.get(classify(commit)).commits.push(commit)

const total = commits.length
const breaking = commits.filter((commit) => commit.breaking).length
const body = [
  `# Deeptop ${version}`,
  '',
  '> 本版本变更由 Conventional Commits 自动整理，按提交类型归类，方便快速了解升级内容。',
  '',
  `**${total} 个提交**${breaking ? ` · **${breaking} 个破坏性变更**` : ''}${startRef ? ` · 对比 \`${startRef}\`` : ''}`,
  '',
]

for (const group of groups.values()) {
  if (!group.commits.length) continue
  body.push(`## ${group.title}`, '')
  for (const commit of group.commits) {
    const scope = commit.scope ? `**${commit.scope}**：` : ''
    const marker = commit.breaking ? ' ⚠️ **破坏性变更**' : ''
    const link = commitUrl ? ` ([${commit.short}](${commitUrl}/${commit.hash}))` : ` ([${commit.short}])`
    body.push(`- ${scope}${commit.subject}${marker}${link}`)
  }
  body.push('')
}

body.push(
  '## 📥 安装与升级',
  '',
  '请根据你的操作系统下载下方对应安装包。升级前建议关闭正在运行的 Deeptop 实例，并保留必要的配置与数据备份。',
  '',
  '## 📋 完整提交记录',
  '',
  repository ? (startRef ? `- [查看 ${startRef} 到 ${endRef} 的完整提交记录](${server}/${repository}/compare/${startRef}...${endRef})` : `- [查看本次发布的提交记录](${server}/${repository}/commits/${endRef})`) : (startRef ? `- 查看 ${startRef} 到 ${endRef} 的完整提交记录` : `- 查看本次发布的提交记录`),
  '',
  '感谢每一位参与反馈、测试与贡献的朋友！',
  '',
)

writeFileSync(output, body.join('\n'), 'utf8')
console.log(`Generated ${output} from ${range} (${total} commits)`)

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) continue
    const key = argument.slice(2)
    result[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index]
  }
  return result
}

function resolveRef(ref) {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim()
}

function currentReleaseTag(ref) {
  return git(['tag', '--points-at', ref])
    .split('\n')
    .map((value) => value.trim())
    .filter(isReleaseTag)
    .sort(compareTags)[0]
}

function previousTag(ref, releaseTag) {
  // 「上一个 Tag」取提交图上最近的可达 Tag：同一轮里的开发版相邻于上一个开发版，
  // 紧随正式版之后的首个开发版相邻于该正式版；正式版只在正式版之间取最近的一个。
  // 按版本号排序会跳过中间的正式版，按创建时间排序在同一秒创建的轻量 Tag 上会并列，
  // 两者都可能选出比当前版本更新、或已经随正式版发布过的 Tag。
  const current = releaseTag ?? currentReleaseTag(ref)
  const args = ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']
  if (current !== undefined) args.push('--exclude', current)
  if (current !== undefined && !isPrereleaseTag(current)) args.push('--exclude', '*-*')
  const previous = readGit([...args, ref])
  return previous !== undefined && isReleaseTag(previous) ? previous : undefined
}

function isReleaseTag(tag) {
  return /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(tag)
}

function isPrereleaseTag(tag) {
  return tag.includes('-')
}

function compareTags(left, right) {
  return left.localeCompare(right, undefined, { numeric: true })
}

function readCommits(commitRange) {
  const output = git(['log', '--first-parent', '--format=%H%x1f%s%x1f%b%x1e', commitRange])
  return output.split('\x1e').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [hash, subject, body = ''] = entry.split('\x1f')
    const match = subject.match(/^(feat|fix|perf|refactor|docs|test|build|ci|chore|remove|revert)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i)
    return {
      hash,
      short: hash.slice(0, 7),
      subject: match?.[4] ?? subject,
      scope: match?.[2],
      type: (match?.[1] ?? 'other').toLowerCase(),
      breaking: Boolean(match?.[3]) || /BREAKING CHANGE:/i.test(body),
    }
  })
}

function classify(commit) {
  if (commit.type === 'feat') return 'feat'
  if (commit.type === 'fix' || commit.type === 'revert') return 'fix'
  if (commit.type === 'perf' || commit.type === 'refactor') return 'improve'
  if (commit.type === 'remove') return 'remove'
  if (commit.type === 'docs' || commit.type === 'test') return 'docs'
  if (commit.type === 'build' || commit.type === 'ci' || commit.type === 'chore') return 'release'
  return 'other'
}

function readGit(command) {
  // `git describe` 在没有可达 Tag 时以非零退出，这里把它当作「没有上一个 Tag」。
  try {
    return git(command)
  } catch {
    return undefined
  }
}

function git(command) {
  return execFileSync('git', command, { encoding: 'utf8' }).trim()
}
