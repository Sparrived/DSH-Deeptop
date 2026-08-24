import { t, type UiLocale } from "../app/i18n";
import type { DshSkill } from "../lib/desktop";

interface SkillsSurfacePanelProps {
  skills: DshSkill[];
  locale?: UiLocale;
  onInsert: (skillName: string) => void;
}

export function SkillsSurfacePanel({ skills, locale = "zh", onInsert }: SkillsSurfacePanelProps) {
  return <div className="surface-content"><div className="surface-intro"><strong>Skills</strong><p>{t("skills.intro", locale)}</p></div><div className="surface-list">{skills.length === 0 ? <p className="surface-muted">{t("skills.empty", locale)}</p> : skills.map((skill) => <div className="surface-row compact" key={skill.name}><div><strong>/{skill.name}</strong><small>{skill.modelInvocable ? t("skills.agentInvocable", locale) : t("skills.userOnly", locale)}</small><p>{skill.description}</p>{skill.whenToUse && <p className="surface-muted">{skill.whenToUse}</p>}</div><button onClick={() => onInsert(skill.name)}>{t("skills.insert", locale)}</button></div>)}</div></div>;
}