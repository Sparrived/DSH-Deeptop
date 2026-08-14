import type { DshSkill } from "../lib/desktop";

interface SkillsSurfacePanelProps {
  skills: DshSkill[];
  onInsert: (skillName: string) => void;
}

export function SkillsSurfacePanel({ skills, onInsert }: SkillsSurfacePanelProps) {
  return <div className="surface-content"><div className="surface-intro"><strong>Skills</strong><p>当前会话可调用的技能目录，来源于当前 Agent Preset。</p></div><div className="surface-list">{skills.length === 0 ? <p className="surface-muted">当前会话没有可见 Skill。</p> : skills.map((skill) => <div className="surface-row compact" key={skill.name}><div><strong>/{skill.name}</strong><small>{skill.modelInvocable ? "Agent 可调用" : "仅用户可调用"}</small><p>{skill.description}</p>{skill.whenToUse && <p className="surface-muted">{skill.whenToUse}</p>}</div><button onClick={() => onInsert(skill.name)}>插入</button></div>)}</div></div>;
}
