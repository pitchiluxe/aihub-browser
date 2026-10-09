import React from 'react'
import { VenetianMask, EyeOff, Eye, HardDrive, X } from 'lucide-react'
import SearchBar from './SearchBar'

interface Props {
  onNavigate: (url: string) => void
}

/**
 * The new-tab page of an Incognito window.
 *
 * Every sentence here is a claim the implementation keeps (see
 * docs/INCOGNITO_MODE.md). It says what is not saved, what still is, and who
 * can still see the traffic — private browsing hides activity from this
 * device's history, not from the network, and the page must not suggest
 * otherwise.
 */
export default function IncognitoHomePage({ onNavigate }: Props) {
  const storageIsolated = document.documentElement.dataset.privateStorage !== 'unavailable'

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: 'linear-gradient(180deg, #121218 0%, #0d0d12 100%)' }}>
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-16 pt-14" aria-labelledby="incognito-heading">
        <div
          aria-hidden="true"
          className="mb-5 flex items-center justify-center rounded-full"
          style={{ width: 72, height: 72, background: 'rgba(161,161,170,0.10)', border: '1px solid rgba(161,161,170,0.25)' }}
        >
          <VenetianMask size={34} style={{ color: '#d4d4d8' }} />
        </div>

        <h1 id="incognito-heading" className="text-center text-2xl font-semibold" style={{ color: '#f4f4f5', letterSpacing: '-0.01em' }}>
          You're browsing privately
        </h1>
        <p className="mt-2 max-w-xl text-center text-sm leading-relaxed" style={{ color: '#a1a1aa' }}>
          Other people who use this device won't see your Incognito activity in AIHub Browser.
          Files you download and bookmarks you add are still saved.
        </p>

        <div className="mt-8 w-full">
          <SearchBar onNavigate={onNavigate} />
        </div>

        {!storageIsolated && (
          <div role="alert" className="mt-6 w-full rounded-xl px-4 py-3 text-xs leading-relaxed"
            style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#fcd34d' }}>
            This window could not isolate its interface storage. Web pages still use the private session, but
            some app preferences changed here may be saved. Close this window and open a new Incognito window.
          </div>
        )}

        <div className="mt-10 grid w-full gap-4 md:grid-cols-2">
          <InfoCard icon={<EyeOff size={15} />} title="AIHub Browser won't save">
            <li>Your browsing history, Rewind page text or session restore</li>
            <li>Searches you make from this window</li>
            <li>AI assistant and agent conversations</li>
            <li>Cookies, sign-ins and site data — cleared when you close every Incognito window</li>
          </InfoCard>

          <InfoCard icon={<Eye size={15} />} title="Your activity might still be visible to">
            <li>Websites you visit, including anything you sign in to</li>
            <li>Your employer, school or whoever manages this device or network</li>
            <li>Your internet service provider, and a VPN or proxy if you use one</li>
            <li>The AI provider, when you send it a question or a page</li>
          </InfoCard>
        </div>

        <InfoCard icon={<HardDrive size={15} />} title="What stays on this computer" className="mt-4 w-full">
          <li>Files you download (they are removed from the Downloads list, not from disk)</li>
          <li>Bookmarks, notes, Recall items, Obsidian clips and workspaces you choose to save</li>
          <li>Settings changes — except interface preferences kept in this window's own storage, which last only until it closes</li>
        </InfoCard>

        <p className="mt-8 max-w-xl text-center text-xs leading-relaxed" style={{ color: '#71717a' }}>
          Incognito doesn't make you anonymous. It keeps this browser from remembering what you do here;
          it does not hide your traffic from the network or from the sites themselves.
        </p>

        <button
          type="button"
          onClick={() => window.electronAPI.incognito?.closeWindows?.()}
          className="no-drag mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors"
          style={{ color: '#e4e4e7', background: 'rgba(161,161,170,0.12)', border: '1px solid rgba(161,161,170,0.28)' }}
        >
          <X size={14} aria-hidden="true" /> Close Incognito windows
        </button>
      </main>
    </div>
  )
}

function InfoCard({ icon, title, children, className = '' }: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl px-5 py-4 ${className}`}
      style={{ background: 'rgba(24,24,30,0.9)', border: '1px solid rgba(161,161,170,0.16)' }}
    >
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: '#e4e4e7' }}>
        <span aria-hidden="true" style={{ color: '#a1a1aa' }}>{icon}</span>
        {title}
      </h2>
      <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed" style={{ color: '#a1a1aa' }}>
        {children}
      </ul>
    </section>
  )
}
