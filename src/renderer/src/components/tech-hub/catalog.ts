// Curated reference data for Tech Hub. Links point at official vendor pages or
// long-standing free platforms; exam versions and prices change often, so the
// UI always sends people to the official page rather than quoting them.

export type TrackName = 'Cybersecurity' | 'Cloud & infrastructure' | 'Software & QA' | 'Data & AI' | 'IT support'

export const CORE_SKILLS: Record<TrackName, string[]> = {
  Cybersecurity: [
    'Networking fundamentals (TCP/IP, DNS, HTTP)', 'Linux command line', 'Windows and Active Directory',
    'Identity and access (SSO, MFA, RBAC)', 'SIEM and log analysis', 'MITRE ATT&CK and threat models',
    'Vulnerability management', 'Scripting (Python or PowerShell)', 'Cloud security basics',
    'Incident response process', 'Risk and compliance frameworks (NIST CSF, ISO 27001)', 'Web app security (OWASP Top 10)',
  ],
  'Cloud & infrastructure': [
    'Linux administration', 'Networking (subnets, routing, DNS)', 'One cloud provider in depth (AWS, Azure or GCP)',
    'Infrastructure as code (Terraform)', 'Containers (Docker)', 'Kubernetes', 'CI/CD pipelines', 'Git and pull requests',
    'Scripting (Bash or Python)', 'Monitoring and observability', 'Cloud IAM and least privilege', 'Cost management',
  ],
  'Software & QA': [
    'Git and GitHub', 'HTML and CSS', 'JavaScript or TypeScript', 'A UI framework (React, Vue or Svelte)',
    'REST APIs and JSON', 'Databases and SQL', 'Automated testing (unit, integration, e2e)', 'Data structures and algorithms',
    'Debugging and browser devtools', 'CI/CD pipelines', 'Secure coding (OWASP Top 10)', 'System design basics',
  ],
  'Data & AI': [
    'SQL (joins, window functions)', 'Spreadsheets and pivot tables', 'Python with pandas', 'Statistics and A/B testing',
    'Data visualization', 'BI tools (Power BI or Tableau)', 'Data modeling (star schema)', 'ETL and data pipelines',
    'Cloud data warehouses', 'Machine learning fundamentals', 'Git for analytics work', 'Communicating insights',
  ],
  'IT support': [
    'Windows and macOS troubleshooting', 'Hardware and peripherals', 'Networking basics (DHCP, DNS, Wi-Fi)',
    'Active Directory and Entra ID user admin', 'Microsoft 365 administration', 'Ticketing and ITSM (ITIL basics)',
    'Remote support tools', 'Printers and mobile devices', 'PowerShell scripting', 'Security hygiene (phishing, MFA)',
    'Customer communication', 'Documentation and knowledge bases',
  ],
}

export type Cert = { id: string; name: string; vendor: string; level: 'Entry' | 'Associate' | 'Advanced'; focus: string; url: string; tracks: TrackName[] }

export const CERTS: Cert[] = [
  { id: 'comptia-a', name: 'CompTIA A+', vendor: 'CompTIA', level: 'Entry', focus: 'Hardware, operating systems and help desk troubleshooting', url: 'https://www.comptia.org/certifications/a', tracks: ['IT support'] },
  { id: 'google-it', name: 'Google IT Support Certificate', vendor: 'Google', level: 'Entry', focus: 'Self-paced intro to support, networking and sysadmin', url: 'https://grow.google/certificates/it-support/', tracks: ['IT support'] },
  { id: 'ms-900', name: 'Microsoft 365 Fundamentals (MS-900)', vendor: 'Microsoft', level: 'Entry', focus: 'Microsoft 365 services, licensing and admin concepts', url: 'https://learn.microsoft.com/credentials/certifications/microsoft-365-fundamentals/', tracks: ['IT support'] },
  { id: 'md-102', name: 'Endpoint Administrator (MD-102)', vendor: 'Microsoft', level: 'Associate', focus: 'Intune, Windows deployment and device management', url: 'https://learn.microsoft.com/credentials/certifications/modern-desktop/', tracks: ['IT support'] },
  { id: 'comptia-net', name: 'CompTIA Network+', vendor: 'CompTIA', level: 'Entry', focus: 'Networking concepts, troubleshooting and infrastructure', url: 'https://www.comptia.org/certifications/network', tracks: ['IT support', 'Cloud & infrastructure', 'Cybersecurity'] },
  { id: 'comptia-sec', name: 'CompTIA Security+', vendor: 'CompTIA', level: 'Entry', focus: 'Baseline security concepts most security roles expect', url: 'https://www.comptia.org/certifications/security', tracks: ['Cybersecurity', 'IT support'] },
  { id: 'isc2-cc', name: 'ISC2 Certified in Cybersecurity (CC)', vendor: 'ISC2', level: 'Entry', focus: 'Foundational security principles and operations', url: 'https://www.isc2.org/certifications/cc', tracks: ['Cybersecurity'] },
  { id: 'sc-900', name: 'Security, Compliance & Identity Fundamentals (SC-900)', vendor: 'Microsoft', level: 'Entry', focus: 'Microsoft security, identity and compliance concepts', url: 'https://learn.microsoft.com/credentials/certifications/security-compliance-and-identity-fundamentals/', tracks: ['Cybersecurity'] },
  { id: 'sc-300', name: 'Identity and Access Administrator (SC-300)', vendor: 'Microsoft', level: 'Associate', focus: 'Entra ID, conditional access and identity governance', url: 'https://learn.microsoft.com/credentials/certifications/identity-and-access-administrator/', tracks: ['Cybersecurity'] },
  { id: 'comptia-cysa', name: 'CompTIA CySA+', vendor: 'CompTIA', level: 'Associate', focus: 'Threat detection, analysis and response for SOC work', url: 'https://www.comptia.org/certifications/cybersecurity-analyst', tracks: ['Cybersecurity'] },
  { id: 'comptia-pentest', name: 'CompTIA PenTest+', vendor: 'CompTIA', level: 'Associate', focus: 'Planning, scoping and running penetration tests', url: 'https://www.comptia.org/certifications/pentest', tracks: ['Cybersecurity'] },
  { id: 'cissp', name: 'ISC2 CISSP', vendor: 'ISC2', level: 'Advanced', focus: 'Security leadership; requires years of paid experience', url: 'https://www.isc2.org/certifications/cissp', tracks: ['Cybersecurity'] },
  { id: 'aws-ccp', name: 'AWS Certified Cloud Practitioner', vendor: 'AWS', level: 'Entry', focus: 'AWS services, pricing and shared responsibility', url: 'https://aws.amazon.com/certification/certified-cloud-practitioner/', tracks: ['Cloud & infrastructure'] },
  { id: 'az-900', name: 'Azure Fundamentals (AZ-900)', vendor: 'Microsoft', level: 'Entry', focus: 'Core Azure services, governance and pricing', url: 'https://learn.microsoft.com/credentials/certifications/azure-fundamentals/', tracks: ['Cloud & infrastructure'] },
  { id: 'aws-saa', name: 'AWS Solutions Architect – Associate', vendor: 'AWS', level: 'Associate', focus: 'Designing resilient, secure AWS architectures', url: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/', tracks: ['Cloud & infrastructure'] },
  { id: 'az-104', name: 'Azure Administrator (AZ-104)', vendor: 'Microsoft', level: 'Associate', focus: 'Running Azure identity, storage, compute and networking', url: 'https://learn.microsoft.com/credentials/certifications/azure-administrator/', tracks: ['Cloud & infrastructure'] },
  { id: 'gcp-ace', name: 'Google Associate Cloud Engineer', vendor: 'Google Cloud', level: 'Associate', focus: 'Deploying and operating workloads on Google Cloud', url: 'https://cloud.google.com/learn/certification/cloud-engineer', tracks: ['Cloud & infrastructure'] },
  { id: 'terraform', name: 'HashiCorp Terraform Associate', vendor: 'HashiCorp', level: 'Associate', focus: 'Infrastructure as code with Terraform', url: 'https://developer.hashicorp.com/certifications/infrastructure-automation', tracks: ['Cloud & infrastructure'] },
  { id: 'cka', name: 'Certified Kubernetes Administrator (CKA)', vendor: 'CNCF', level: 'Advanced', focus: 'Hands-on, performance-based Kubernetes administration', url: 'https://www.cncf.io/training/certification/cka/', tracks: ['Cloud & infrastructure'] },
  { id: 'github-foundations', name: 'GitHub Foundations', vendor: 'GitHub', level: 'Entry', focus: 'Git, repositories, collaboration and GitHub features', url: 'https://learn.microsoft.com/credentials/certifications/github-foundations/', tracks: ['Software & QA', 'Cloud & infrastructure'] },
  { id: 'istqb-fl', name: 'ISTQB Certified Tester Foundation Level', vendor: 'ISTQB', level: 'Entry', focus: 'Software testing vocabulary, techniques and process', url: 'https://www.istqb.org/certifications/certified-tester-foundation-level', tracks: ['Software & QA'] },
  { id: 'az-204', name: 'Azure Developer (AZ-204)', vendor: 'Microsoft', level: 'Associate', focus: 'Building and deploying apps on Azure', url: 'https://learn.microsoft.com/credentials/certifications/azure-developer/', tracks: ['Software & QA'] },
  { id: 'aws-dev', name: 'AWS Certified Developer – Associate', vendor: 'AWS', level: 'Associate', focus: 'Developing and debugging cloud-native AWS apps', url: 'https://aws.amazon.com/certification/certified-developer-associate/', tracks: ['Software & QA'] },
  { id: 'google-da', name: 'Google Data Analytics Certificate', vendor: 'Google', level: 'Entry', focus: 'Spreadsheets, SQL, Tableau and R basics', url: 'https://grow.google/certificates/data-analytics/', tracks: ['Data & AI'] },
  { id: 'dp-900', name: 'Azure Data Fundamentals (DP-900)', vendor: 'Microsoft', level: 'Entry', focus: 'Relational, non-relational and analytics data concepts', url: 'https://learn.microsoft.com/credentials/certifications/azure-data-fundamentals/', tracks: ['Data & AI'] },
  { id: 'pl-300', name: 'Power BI Data Analyst (PL-300)', vendor: 'Microsoft', level: 'Associate', focus: 'Modeling, visualizing and sharing data in Power BI', url: 'https://learn.microsoft.com/credentials/certifications/power-bi-data-analyst-associate/', tracks: ['Data & AI'] },
  { id: 'databricks-de', name: 'Databricks Data Engineer Associate', vendor: 'Databricks', level: 'Associate', focus: 'Lakehouse pipelines with Spark SQL and Python', url: 'https://www.databricks.com/learn/certification/data-engineer-associate', tracks: ['Data & AI'] },
]

export type ResourceKind = 'Course' | 'Practice' | 'Docs' | 'Reference'
export type Resource = { name: string; description: string; url: string; kind: ResourceKind; tracks: TrackName[] | 'all' }

export const RESOURCES: Resource[] = [
  { name: 'roadmap.sh', description: 'Community-maintained visual roadmaps for nearly every tech role.', url: 'https://roadmap.sh', kind: 'Reference', tracks: 'all' },
  { name: 'freeCodeCamp', description: 'Free interactive curriculum and certifications in web, Python and data.', url: 'https://www.freecodecamp.org/learn', kind: 'Course', tracks: ['Software & QA', 'Data & AI'] },
  { name: 'Harvard CS50x', description: 'The classic intro to computer science, free to audit.', url: 'https://cs50.harvard.edu/x/', kind: 'Course', tracks: 'all' },
  { name: 'GitHub Skills', description: 'Short hands-on courses that run inside real GitHub repositories.', url: 'https://skills.github.com', kind: 'Practice', tracks: ['Software & QA', 'Cloud & infrastructure'] },
  { name: 'Learn Git Branching', description: 'Visual, in-browser puzzles that make branching and rebasing click.', url: 'https://learngitbranching.js.org', kind: 'Practice', tracks: ['Software & QA', 'Cloud & infrastructure', 'Data & AI'] },
  { name: 'MDN Web Docs', description: 'The reference for HTML, CSS, JavaScript and web APIs.', url: 'https://developer.mozilla.org', kind: 'Docs', tracks: ['Software & QA'] },
  { name: 'The Odin Project', description: 'Project-based full stack curriculum, free and open source.', url: 'https://www.theodinproject.com', kind: 'Course', tracks: ['Software & QA'] },
  { name: 'Exercism', description: 'Coding exercises in 70+ languages with optional human mentoring.', url: 'https://exercism.org', kind: 'Practice', tracks: ['Software & QA', 'Data & AI'] },
  { name: 'Microsoft Learn', description: 'Free training paths for Azure, Microsoft 365, security and Power BI.', url: 'https://learn.microsoft.com/training/', kind: 'Course', tracks: 'all' },
  { name: 'AWS Skill Builder', description: 'AWS-official courses, many free, with labs on paid tiers.', url: 'https://skillbuilder.aws', kind: 'Course', tracks: ['Cloud & infrastructure', 'Data & AI', 'Software & QA'] },
  { name: 'Google Cloud Skills Boost', description: 'Google Cloud learning paths and hands-on labs.', url: 'https://www.cloudskillsboost.google', kind: 'Course', tracks: ['Cloud & infrastructure', 'Data & AI'] },
  { name: 'Docker: Get started', description: 'Official guide to images, containers, volumes and Compose.', url: 'https://docs.docker.com/get-started/', kind: 'Docs', tracks: ['Cloud & infrastructure', 'Software & QA'] },
  { name: 'Kubernetes tutorials', description: 'Official interactive tutorials from the Kubernetes docs.', url: 'https://kubernetes.io/docs/tutorials/', kind: 'Docs', tracks: ['Cloud & infrastructure'] },
  { name: 'explainshell', description: 'Paste any shell command to see what each flag does.', url: 'https://explainshell.com', kind: 'Reference', tracks: ['Cloud & infrastructure', 'Cybersecurity', 'IT support'] },
  { name: 'TryHackMe', description: 'Guided, browser-based security rooms from beginner to advanced.', url: 'https://tryhackme.com', kind: 'Practice', tracks: ['Cybersecurity'] },
  { name: 'OverTheWire wargames', description: 'Free Linux and security challenges played over SSH.', url: 'https://overthewire.org/wargames/', kind: 'Practice', tracks: ['Cybersecurity', 'Cloud & infrastructure'] },
  { name: 'PortSwigger Web Security Academy', description: 'Free web-app security labs from the makers of Burp Suite.', url: 'https://portswigger.net/web-security', kind: 'Practice', tracks: ['Cybersecurity', 'Software & QA'] },
  { name: 'CyberDefenders', description: 'Blue-team challenges: forensics, threat hunting and SIEM.', url: 'https://cyberdefenders.org', kind: 'Practice', tracks: ['Cybersecurity'] },
  { name: 'MITRE ATT&CK', description: 'Knowledge base of real adversary tactics and techniques.', url: 'https://attack.mitre.org', kind: 'Reference', tracks: ['Cybersecurity'] },
  { name: 'OWASP Top 10', description: 'The standard awareness list of critical web app risks.', url: 'https://owasp.org/www-project-top-ten/', kind: 'Reference', tracks: ['Cybersecurity', 'Software & QA'] },
  { name: 'NIST Cybersecurity Framework', description: 'The framework most GRC and security programs map to.', url: 'https://www.nist.gov/cyberframework', kind: 'Reference', tracks: ['Cybersecurity'] },
  { name: 'Professor Messer', description: 'Free video courses for CompTIA A+, Network+ and Security+.', url: 'https://www.professormesser.com', kind: 'Course', tracks: ['IT support', 'Cybersecurity'] },
  { name: 'SQLBolt', description: 'Interactive SQL lessons you can finish in an afternoon.', url: 'https://sqlbolt.com', kind: 'Practice', tracks: ['Data & AI', 'Software & QA'] },
  { name: 'Kaggle Learn', description: 'Short free courses in pandas, SQL, ML and visualization.', url: 'https://www.kaggle.com/learn', kind: 'Course', tracks: ['Data & AI'] },
  { name: 'Google ML Crash Course', description: 'Google’s fast-paced, practical introduction to machine learning.', url: 'https://developers.google.com/machine-learning/crash-course', kind: 'Course', tracks: ['Data & AI'] },
  { name: 'Practical Deep Learning (fast.ai)', description: 'Top-down deep learning course for people who can code.', url: 'https://course.fast.ai', kind: 'Course', tracks: ['Data & AI'] },
]

export const TUTOR_TOPICS: Record<TrackName, string[]> = {
  Cybersecurity: ['Kerberos authentication', 'OAuth 2.0 vs SAML', 'TCP three-way handshake', 'SIEM correlation rules', 'Zero trust', 'Phishing email analysis'],
  'Cloud & infrastructure': ['VPC subnets and route tables', 'Terraform state', 'Kubernetes pods vs deployments', 'Load balancers', 'DNS resolution', 'Blue-green deploys'],
  'Software & QA': ['Git rebase vs merge', 'REST vs GraphQL', 'React hooks', 'Big-O notation', 'Test pyramid', 'CORS'],
  'Data & AI': ['SQL joins', 'Window functions', 'Star schema', 'Overfitting', 'p-values', 'ETL vs ELT'],
  'IT support': ['DHCP and DNS', 'Group Policy', 'Printer troubleshooting', 'Conditional access', 'ITIL incident vs problem', 'BitLocker recovery'],
}
