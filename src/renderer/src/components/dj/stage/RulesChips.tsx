import React from 'react'
import { ruleLabel, type SetRule } from '../ai/instructions'

export default function RulesChips({ rules, onRemove }: { rules: SetRule[]; onRemove: (i: number) => void }) {
  if (!rules.length) return null
  return <div className="dj-rules" aria-label="Active rules">
    {rules.map((r, i) => { const label = ruleLabel(r); return <span key={`${label}-${i}`} className="dj-rule">{label}<button aria-label={`Remove rule ${label}`} onClick={() => onRemove(i)}>×</button></span> })}
  </div>
}
