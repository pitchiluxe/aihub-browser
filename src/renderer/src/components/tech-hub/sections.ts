import {
  Award, Briefcase, FileText, FlaskConical, Github, GraduationCap, Headphones, LayoutDashboard, Library, ListChecks,
  Map, Mic, Newspaper, Wrench, Youtube, type LucideIcon,
} from 'lucide-react'

export type SectionId =
  | 'overview' | 'roadmap' | 'skills' | 'tutor' | 'library' | 'certs' | 'youtube' | 'podcasts'
  | 'labs' | 'toolbox' | 'portfolio' | 'resume' | 'interview' | 'jobs' | 'news'

export type SectionDef = { id: SectionId; label: string; file: string; icon: LucideIcon; group: string; blurb: string; keywords: string }

export const SECTIONS: SectionDef[] = [
  { id: 'overview', label: 'Overview', file: 'README.md', icon: LayoutDashboard, group: 'Start', blurb: 'Your progress and the fastest next step.', keywords: 'home dashboard progress start' },
  { id: 'roadmap', label: 'Roadmap', file: 'roadmap.md', icon: Map, group: 'Learn', blurb: 'A role-specific plan from first step to first offer.', keywords: 'plan path career learning' },
  { id: 'skills', label: 'Skill tracker', file: 'skills.yml', icon: ListChecks, group: 'Learn', blurb: 'Check off what you know and close the gaps.', keywords: 'gap checklist progress competencies' },
  { id: 'tutor', label: 'AI tutor', file: 'tutor.sh', icon: GraduationCap, group: 'Learn', blurb: 'Explain anything, get cheat sheets, take quizzes.', keywords: 'explain teach quiz cheat sheet learn concept question ask' },
  { id: 'library', label: 'Free library', file: 'library.json', icon: Library, group: 'Learn', blurb: 'Hand-picked free courses, practice sites and docs.', keywords: 'resources courses free tutorials docs practice' },
  { id: 'certs', label: 'Certifications', file: 'certs.toml', icon: Award, group: 'Learn', blurb: 'Which certs matter for your role, in what order.', keywords: 'certification exam comptia aws azure security+ cissp' },
  { id: 'youtube', label: 'Videos', file: 'videos.m3u', icon: Youtube, group: 'Learn', blurb: 'Tutorials and walkthroughs, played right here.', keywords: 'youtube watch tutorial video' },
  { id: 'podcasts', label: 'Podcasts', file: 'podcasts.rss', icon: Headphones, group: 'Learn', blurb: 'Shows worth your commute.', keywords: 'listen audio shows' },
  { id: 'labs', label: 'Lab studio', file: 'labs/', icon: FlaskConical, group: 'Build', blurb: 'Realistic practice tickets you can download as ZIPs.', keywords: 'practice hands-on project exercise' },
  { id: 'toolbox', label: 'Dev toolbox', file: 'toolbox/', icon: Wrench, group: 'Build', blurb: 'JSON, JWT, Base64, hashes, subnets, regex and more.', keywords: 'utility json base64 jwt hash uuid timestamp subnet cidr regex password encode decode format' },
  { id: 'portfolio', label: 'Portfolio', file: 'profile.md', icon: Github, group: 'Build', blurb: 'LinkedIn and GitHub copy grounded in your work.', keywords: 'linkedin github readme bio' },
  { id: 'resume', label: 'Résumé', file: 'resume.docx', icon: FileText, group: 'Get hired', blurb: 'Tailor your résumé to a role or job post.', keywords: 'cv resume ats tailor' },
  { id: 'interview', label: 'Mock interview', file: 'interview.log', icon: Mic, group: 'Get hired', blurb: 'Practice questions with scored, specific feedback.', keywords: 'interview practice questions behavioral star mock' },
  { id: 'jobs', label: 'Job search', file: 'jobs.sql', icon: Briefcase, group: 'Get hired', blurb: 'Search the big boards with your role prefilled.', keywords: 'jobs openings hiring linkedin indeed dice remote' },
  { id: 'news', label: 'Tech news', file: 'feed.xml', icon: Newspaper, group: 'Stay current', blurb: 'Live headlines with an AI briefing for your role.', keywords: 'news headlines security cloud ai' },
]

export const SECTION_GROUPS = [...new Set(SECTIONS.map(section => section.group))]
export const sectionById = (id: SectionId) => SECTIONS.find(section => section.id === id)!
export const isSectionId = (value: unknown): value is SectionId => SECTIONS.some(section => section.id === value)
