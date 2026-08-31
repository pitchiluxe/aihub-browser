/**
 * The set of built-in pages a tab can host instead of a web page.
 *
 * This union used to be written out by hand in four places — App's
 * `openSpecialPage`, the Sidebar's `Props` and `NavItem`, and CommandPalette —
 * so adding a page meant editing the same list four times and finding out
 * about the one you missed at runtime, when the tab opened blank. One
 * exported type instead: miss an import and the compiler says so.
 */
export type PageType =
  | 'settings' | 'history' | 'downloads' | 'wifi' | 'vpn' | 'research'
  | 'agents' | 'extensions' | 'mail' | 'notes' | 'manual' | 'rewind'
  | 'watch' | 'bible' | 'study' | 'community' | 'vault' | 'recall'

/** Same set, plus the home page, which is a tab state rather than a page. */
export type NavTarget = PageType | null
