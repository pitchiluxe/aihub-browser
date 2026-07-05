import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Plus, Play, Loader2, Sparkles, X, ChevronRight, CheckCircle, AlertCircle, Search, Globe, FormInput, Bell, BarChart2 } from 'lucide-react'

interface Agent {
  id: string
  name: string
  description: string
  template: string
  icon: React.ReactNode
  color: string
  steps?: string[]
}

interface AgentRun {
  agentId: string
  status: 'running' | 'done' | 'error'
  steps: { text: string; done: boolean }[]
  result: string
}

const TEMPLATE_AGENTS: Agent[] = [
  {
    id: 'web-scraper',
    name: 'Data Extractor',
    description: 'Extract structured data from any webpage — prices, contacts, listings, or any repeated content.',
    template: 'You are a web data extraction agent. The user wants to extract structured data from web pages. Ask for the URL and what data they need, then provide step-by-step instructions and a sample extraction script.',
    icon: <Globe size={18} />, color: '#38bdf8',
    steps: ['Identify the target URL', 'Locate data elements on the page', 'Extract structured data', 'Format as JSON/CSV'],
  },
  {
    id: 'form-filler',
    name: 'Form Assistant',
    description: 'Intelligently fill web forms, generate appropriate input values, and handle multi-step form flows.',
    template: 'You are a form filling assistant. Help the user fill out web forms intelligently. Ask about the form type and context, then provide the optimal values to enter in each field.',
    icon: <FormInput size={18} />, color: '#a78bfa',
    steps: ['Analyze form fields', 'Generate appropriate values', 'Guide through multi-step flow', 'Validate submission'],
  },
  {
    id: 'site-monitor',
    name: 'Site Monitor',
    description: 'Monitor websites for price changes, new content, or any specific data changes and get notified.',
    template: 'You are a website monitoring agent. Help the user set up monitoring for changes on websites. Ask what they want to monitor and how often, then provide a detailed monitoring strategy.',
    icon: <Bell size={18} />, color: '#fb923c',
    steps: ['Define what to monitor', 'Set check frequency', 'Configure change detection', 'Set up notifications'],
  },
  {
    id: 'researcher',
    name: 'Web Researcher',
    description: 'Search, browse, and compile research on any topic across multiple websites automatically.',
    template: 'You are a web research agent. Help the user conduct deep web research on a topic. Ask for the research topic and requirements, then provide a systematic research plan with specific sources and queries.',
    icon: <Search size={18} />, color: '#34d399',
    steps: ['Define research topic', 'Identify key sources', 'Extract relevant data', 'Compile findings'],
  },
  {
    id: 'price-tracker',
    name: 'Price Tracker',
    description: 'Track product prices across e-commerce sites, detect sales, and find the best deals.',
    template: 'You are a price tracking agent. Help the user track product prices online. Ask for the product and target price, then provide a strategy to find and track the best deals across multiple retailers.',
    icon: <BarChart2 size={18} />, color: '#f472b6',
    steps: ['Identify product', 'Find retailer pages', 'Extract price data', 'Compare and alert'],
  },
]

export default function AgentsPage() {
  const [selected,     setSelected]     = useState<Agent | null>(null)
  const [customName,   setCustomName]   = useState('')
  const [customDesc,   setCustomDesc]   = useState('')
  const [run,          setRun]          = useState<AgentRun | null>(null)
  const [chatInput,    setChatInput]    = useState('')
  const [chatHistory,  setChatHistory]  = useState<{ role: 'user'|'assistant'; content: string }[]>([])
  const [loading,      setLoading]      = useState(false)
  const [showCustom,   setShowCustom]   = useState(false)

  const startAgent = async (agent: Agent) => {
    setSelected(agent)
    setChatHistory([])
    setRun({
      agentId: agent.id,
      status: 'running',
      steps: (agent.steps || []).map(s => ({ text: s, done: false })),
      result: '',
    })
    setLoading(true)
    try {
      const result = await window.electronAPI.ai.chat([
        { role: 'system', content: agent.template },
        { role: 'user', content: `Start the ${agent.name} agent. Introduce yourself briefly and ask me the first question you need to get started.` },
      ])
      const msg = result.content || 'Agent ready. How can I help?'
      setChatHistory([{ role: 'assistant', content: msg }])
      setRun(prev => prev ? { ...prev, status: 'done', steps: prev.steps.map((s, i) => ({ ...s, done: i === 0 })) } : null)
    } catch {
      setChatHistory([{ role: 'assistant', content: 'Failed to start agent. Check your AI configuration in Settings.' }])
      setRun(prev => prev ? { ...prev, status: 'error' } : null)
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    const msg = chatInput.trim()
    if (!msg || loading || !selected) return
    setChatInput('')
    const newHistory = [...chatHistory, { role: 'user' as const, content: msg }]
    setChatHistory(newHistory)
    setLoading(true)
    try {
      const result = await window.electronAPI.ai.chat([
        { role: 'system', content: selected.template },
        ...newHistory.map(m => ({ role: m.role, content: m.content })),
      ])
      const reply = result.content || 'No response.'
      setChatHistory([...newHistory, { role: 'assistant', content: reply }])
      setRun(prev => {
        if (!prev) return null
        const nextUndone = prev.steps.findIndex(s => !s.done)
        if (nextUndone !== -1) {
          const steps = [...prev.steps]
          steps[nextUndone] = { ...steps[nextUndone], done: true }
          return { ...prev, steps }
        }
        return prev
      })
    } catch {
      setChatHistory([...newHistory, { role: 'assistant', content: 'Error communicating with AI.' }])
    } finally {
      setLoading(false)
    }
  }

  const startCustomAgent = async () => {
    if (!customName.trim()) return
    const agent: Agent = {
      id: `custom-${Date.now()}`,
      name: customName,
      description: customDesc || 'Custom agent',
      template: `You are a helpful AI agent named "${customName}". Your task: ${customDesc || 'assist the user with their web task'}. Ask clarifying questions and guide the user step by step.`,
      icon: <Sparkles size={18} />,
      color: '#60a5fa',
    }
    setShowCustom(false)
    setCustomName('')
    setCustomDesc('')
    startAgent(agent)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden page-enter"
      style={{ background: 'var(--ds-page-bg)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid rgba(139,92,246,0.12)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,rgba(167,139,250,0.2),rgba(139,92,246,0.14))', border: '1px solid rgba(167,139,250,0.25)' }}>
            <Bot size={18} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">Agent Mode</div>
            <div className="text-xs text-slate-600">Automate web tasks with AI agents</div>
          </div>
        </div>
        <button onClick={() => setShowCustom(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
          style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(167,139,250,0.2)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(167,139,250,0.12)' }}>
          <Plus size={13} /> Custom Agent
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left — agent templates */}
        <div className="w-80 shrink-0 flex flex-col overflow-hidden border-r"
          style={{ borderColor: 'rgba(139,92,246,0.08)', background: 'rgba(255,255,255,0.015)' }}>
          <div className="px-4 pt-4 pb-2 shrink-0">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">Agent Templates</div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
            {TEMPLATE_AGENTS.map((agent, i) => (
              <AgentCard key={agent.id} agent={agent} index={i} selected={selected?.id === agent.id} onStart={() => startAgent(agent)} />
            ))}
          </div>
        </div>

        {/* Right — agent workspace */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.14)' }}>
                <Bot size={28} style={{ color: 'rgba(167,139,250,0.4)' }} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-500 mb-2">Select an Agent</div>
                <div className="text-xs text-slate-700 max-w-xs leading-relaxed">
                  Choose a template on the left to start an AI-guided automation, or create a custom agent for any task.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Agent header */}
              <div className="flex items-center justify-between px-5 py-3 shrink-0"
                style={{ borderBottom: '1px solid var(--ds-glass-sm)' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${selected.color}18`, border: `1px solid ${selected.color}28`, color: selected.color }}>
                    {selected.icon}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-300">{selected.name}</div>
                    <div className="text-[10px] text-slate-600 truncate max-w-xs">{selected.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Progress steps */}
                  {run?.steps && run.steps.length > 0 && (
                    <div className="hidden md:flex items-center gap-1">
                      {run.steps.map((step, i) => (
                        <React.Fragment key={i}>
                          <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]"
                            style={{
                              background: step.done ? `${selected.color}18` : 'var(--ds-glass-xs)',
                              color: step.done ? selected.color : '#2d4060',
                              border: `1px solid ${step.done ? `${selected.color}25` : 'var(--ds-glass-sm)'}`,
                            }}>
                            {step.done ? <CheckCircle size={9} /> : <div className="w-2 h-2 rounded-full bg-current opacity-30" />}
                            <span className="hidden lg:inline">{step.text.split(' ').slice(0, 2).join(' ')}</span>
                          </div>
                          {i < run.steps.length - 1 && <ChevronRight size={9} className="text-slate-800 shrink-0" />}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setSelected(null); setRun(null); setChatHistory([]) }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-300 transition-colors"
                    style={{ border: '1px solid var(--ds-border-sm)' }}>
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                <AnimatePresence>
                  {chatHistory.map((msg, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                      {msg.role === 'assistant' && (
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: `${selected.color}18`, border: `1px solid ${selected.color}25`, color: selected.color }}>
                          <Bot size={12} />
                        </div>
                      )}
                      <div
                        className="max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap"
                        style={msg.role === 'user' ? {
                          background: 'linear-gradient(135deg,rgba(139,92,246,0.7),rgba(99,102,241,0.65))',
                          color: '#fff', borderTopRightRadius: 4,
                        } : {
                          background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
                          color: 'rgb(var(--ds-text-3))', borderTopLeftRadius: 4,
                        }}
                      >
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {loading && (
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${selected.color}18`, border: `1px solid ${selected.color}25`, color: selected.color }}>
                      <Bot size={12} />
                    </div>
                    <div className="px-3 py-2 rounded-xl flex gap-1 items-center"
                      style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
                      {[0, 1, 2].map(n => (
                        <span key={n} style={{
                          width: 5, height: 5, borderRadius: '50%', background: selected.color, display: 'inline-block',
                          animation: `aiDotBounce 1.3s ease-in-out ${n * 0.18}s infinite`,
                        }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Chat input */}
              <div className="px-5 pb-4 pt-2 shrink-0" style={{ borderTop: '1px solid var(--ds-glass-sm)' }}>
                <div className="flex gap-2">
                  <input
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                    placeholder="Reply to the agent…"
                    disabled={loading}
                    className="flex-1 px-3 py-2 rounded-xl text-xs text-slate-300 placeholder:text-slate-700 outline-none transition-all"
                    style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', userSelect: 'text' }}
                    onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = `${selected.color}45` }}
                    onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-glass-md)' }}
                  />
                  <button onClick={sendMessage} disabled={!chatInput.trim() || loading}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0"
                    style={{
                      background: chatInput.trim() && !loading ? `${selected.color}22` : 'var(--ds-glass-sm)',
                      border: `1px solid ${chatInput.trim() && !loading ? `${selected.color}35` : 'var(--ds-glass-md)'}`,
                      color: chatInput.trim() && !loading ? selected.color : '#2d4060',
                      cursor: chatInput.trim() && !loading ? 'pointer' : 'not-allowed',
                    }}>
                    {loading
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Play size={13} style={{ marginLeft: 1 }} />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Custom agent modal */}
      <AnimatePresence>
        {showCustom && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
              onClick={() => setShowCustom(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: 'spring', damping: 30, stiffness: 360 }}
              className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
              <div className="w-[400px] rounded-2xl p-5 pointer-events-auto"
                style={{ background: 'var(--ds-page-bg)', border: '1px solid rgba(167,139,250,0.25)', boxShadow: '0 24px 80px rgba(0,0,0,0.9)' }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-bold text-slate-200">Custom Agent</div>
                  <button onClick={() => setShowCustom(false)} className="text-slate-600 hover:text-slate-300 transition-colors"><X size={15} /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-600 mb-1.5 block">Agent Name</label>
                    <input value={customName} onChange={e => setCustomName(e.target.value)}
                      placeholder="e.g., LinkedIn Scraper"
                      className="w-full px-3 py-2 rounded-xl text-sm text-slate-300 placeholder:text-slate-700 outline-none"
                      style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', userSelect: 'text' }} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 mb-1.5 block">Task Description</label>
                    <textarea value={customDesc} onChange={e => setCustomDesc(e.target.value)}
                      placeholder="Describe what this agent should do…"
                      rows={3}
                      className="w-full px-3 py-2 rounded-xl text-sm text-slate-300 placeholder:text-slate-700 outline-none resize-none"
                      style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', userSelect: 'text' }} />
                  </div>
                  <button onClick={startCustomAgent} disabled={!customName.trim()}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: customName.trim() ? 'linear-gradient(135deg,rgba(167,139,250,0.25),rgba(139,92,246,0.18))' : 'var(--ds-glass-sm)',
                      border: `1px solid ${customName.trim() ? 'rgba(167,139,250,0.35)' : 'var(--ds-glass-md)'}`,
                      color: customName.trim() ? '#a78bfa' : '#2d4060',
                      cursor: customName.trim() ? 'pointer' : 'not-allowed',
                    }}>
                    Launch Agent
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function AgentCard({ agent, index, selected, onStart }: {
  agent: Agent; index: number; selected: boolean; onStart: () => void
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={onStart}
      className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all"
      style={selected ? {
        background: `${agent.color}12`,
        border: `1px solid ${agent.color}28`,
        boxShadow: `0 0 20px ${agent.color}0a`,
      } : {
        background: 'var(--ds-glass-xs)',
        border: '1px solid var(--ds-border-sm)',
      }}
      onMouseEnter={e => { if (!selected) { (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-sm)'; (e.currentTarget as HTMLElement).style.borderColor = `${agent.color}18` } }}
      onMouseLeave={e => { if (!selected) { (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-xs)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-glass-sm)' } }}
    >
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${agent.color}18`, border: `1px solid ${agent.color}25`, color: agent.color }}>
        {agent.icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-300 mb-0.5">{agent.name}</div>
        <div className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">{agent.description}</div>
      </div>
    </motion.button>
  )
}
