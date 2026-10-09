/**
 * Every country a traveller can pick: the 193 UN members plus a few widely
 * visited states and territories. ISO 3166-1 alpha-2 codes drive the flag and
 * the facts lookup; the region groups the picker.
 */

export type Region = 'Africa' | 'Americas' | 'Asia' | 'Europe' | 'Middle East' | 'Oceania'

export interface Country { code: string; name: string; region: Region }

const raw: [string, string, Region][] = [
  // Africa
  ['DZ', 'Algeria', 'Africa'], ['AO', 'Angola', 'Africa'], ['BJ', 'Benin', 'Africa'], ['BW', 'Botswana', 'Africa'],
  ['BF', 'Burkina Faso', 'Africa'], ['BI', 'Burundi', 'Africa'], ['CV', 'Cabo Verde', 'Africa'], ['CM', 'Cameroon', 'Africa'],
  ['CF', 'Central African Republic', 'Africa'], ['TD', 'Chad', 'Africa'], ['KM', 'Comoros', 'Africa'],
  ['CD', 'Congo (DRC)', 'Africa'], ['CG', 'Congo (Republic)', 'Africa'], ['CI', "Côte d'Ivoire", 'Africa'],
  ['DJ', 'Djibouti', 'Africa'], ['EG', 'Egypt', 'Africa'], ['GQ', 'Equatorial Guinea', 'Africa'], ['ER', 'Eritrea', 'Africa'],
  ['SZ', 'Eswatini', 'Africa'], ['ET', 'Ethiopia', 'Africa'], ['GA', 'Gabon', 'Africa'], ['GM', 'Gambia', 'Africa'],
  ['GH', 'Ghana', 'Africa'], ['GN', 'Guinea', 'Africa'], ['GW', 'Guinea-Bissau', 'Africa'], ['KE', 'Kenya', 'Africa'],
  ['LS', 'Lesotho', 'Africa'], ['LR', 'Liberia', 'Africa'], ['LY', 'Libya', 'Africa'], ['MG', 'Madagascar', 'Africa'],
  ['MW', 'Malawi', 'Africa'], ['ML', 'Mali', 'Africa'], ['MR', 'Mauritania', 'Africa'], ['MU', 'Mauritius', 'Africa'],
  ['MA', 'Morocco', 'Africa'], ['MZ', 'Mozambique', 'Africa'], ['NA', 'Namibia', 'Africa'], ['NE', 'Niger', 'Africa'],
  ['NG', 'Nigeria', 'Africa'], ['RW', 'Rwanda', 'Africa'], ['ST', 'São Tomé and Príncipe', 'Africa'], ['SN', 'Senegal', 'Africa'],
  ['SC', 'Seychelles', 'Africa'], ['SL', 'Sierra Leone', 'Africa'], ['SO', 'Somalia', 'Africa'], ['ZA', 'South Africa', 'Africa'],
  ['SS', 'South Sudan', 'Africa'], ['SD', 'Sudan', 'Africa'], ['TZ', 'Tanzania', 'Africa'], ['TG', 'Togo', 'Africa'],
  ['TN', 'Tunisia', 'Africa'], ['UG', 'Uganda', 'Africa'], ['ZM', 'Zambia', 'Africa'], ['ZW', 'Zimbabwe', 'Africa'],
  // Americas
  ['AG', 'Antigua and Barbuda', 'Americas'], ['AR', 'Argentina', 'Americas'], ['BS', 'Bahamas', 'Americas'], ['BB', 'Barbados', 'Americas'],
  ['BZ', 'Belize', 'Americas'], ['BO', 'Bolivia', 'Americas'], ['BR', 'Brazil', 'Americas'], ['CA', 'Canada', 'Americas'],
  ['CL', 'Chile', 'Americas'], ['CO', 'Colombia', 'Americas'], ['CR', 'Costa Rica', 'Americas'], ['CU', 'Cuba', 'Americas'],
  ['DM', 'Dominica', 'Americas'], ['DO', 'Dominican Republic', 'Americas'], ['EC', 'Ecuador', 'Americas'], ['SV', 'El Salvador', 'Americas'],
  ['GD', 'Grenada', 'Americas'], ['GT', 'Guatemala', 'Americas'], ['GY', 'Guyana', 'Americas'], ['HT', 'Haiti', 'Americas'],
  ['HN', 'Honduras', 'Americas'], ['JM', 'Jamaica', 'Americas'], ['MX', 'Mexico', 'Americas'], ['NI', 'Nicaragua', 'Americas'],
  ['PA', 'Panama', 'Americas'], ['PY', 'Paraguay', 'Americas'], ['PE', 'Peru', 'Americas'], ['PR', 'Puerto Rico', 'Americas'],
  ['KN', 'Saint Kitts and Nevis', 'Americas'], ['LC', 'Saint Lucia', 'Americas'], ['VC', 'Saint Vincent and the Grenadines', 'Americas'],
  ['SR', 'Suriname', 'Americas'], ['TT', 'Trinidad and Tobago', 'Americas'], ['US', 'United States', 'Americas'],
  ['UY', 'Uruguay', 'Americas'], ['VE', 'Venezuela', 'Americas'],
  // Asia
  ['AF', 'Afghanistan', 'Asia'], ['BD', 'Bangladesh', 'Asia'], ['BT', 'Bhutan', 'Asia'], ['BN', 'Brunei', 'Asia'],
  ['KH', 'Cambodia', 'Asia'], ['CN', 'China', 'Asia'], ['HK', 'Hong Kong', 'Asia'], ['IN', 'India', 'Asia'],
  ['ID', 'Indonesia', 'Asia'], ['JP', 'Japan', 'Asia'], ['KZ', 'Kazakhstan', 'Asia'], ['KG', 'Kyrgyzstan', 'Asia'],
  ['LA', 'Laos', 'Asia'], ['MO', 'Macao', 'Asia'], ['MY', 'Malaysia', 'Asia'], ['MV', 'Maldives', 'Asia'],
  ['MN', 'Mongolia', 'Asia'], ['MM', 'Myanmar', 'Asia'], ['NP', 'Nepal', 'Asia'], ['KP', 'North Korea', 'Asia'],
  ['PK', 'Pakistan', 'Asia'], ['PH', 'Philippines', 'Asia'], ['SG', 'Singapore', 'Asia'], ['KR', 'South Korea', 'Asia'],
  ['LK', 'Sri Lanka', 'Asia'], ['TW', 'Taiwan', 'Asia'], ['TJ', 'Tajikistan', 'Asia'], ['TH', 'Thailand', 'Asia'],
  ['TL', 'Timor-Leste', 'Asia'], ['TM', 'Turkmenistan', 'Asia'], ['UZ', 'Uzbekistan', 'Asia'], ['VN', 'Vietnam', 'Asia'],
  // Europe
  ['AL', 'Albania', 'Europe'], ['AD', 'Andorra', 'Europe'], ['AM', 'Armenia', 'Europe'], ['AT', 'Austria', 'Europe'],
  ['AZ', 'Azerbaijan', 'Europe'], ['BY', 'Belarus', 'Europe'], ['BE', 'Belgium', 'Europe'], ['BA', 'Bosnia and Herzegovina', 'Europe'],
  ['BG', 'Bulgaria', 'Europe'], ['HR', 'Croatia', 'Europe'], ['CY', 'Cyprus', 'Europe'], ['CZ', 'Czechia', 'Europe'],
  ['DK', 'Denmark', 'Europe'], ['EE', 'Estonia', 'Europe'], ['FI', 'Finland', 'Europe'], ['FR', 'France', 'Europe'],
  ['GE', 'Georgia', 'Europe'], ['DE', 'Germany', 'Europe'], ['GR', 'Greece', 'Europe'], ['HU', 'Hungary', 'Europe'],
  ['IS', 'Iceland', 'Europe'], ['IE', 'Ireland', 'Europe'], ['IT', 'Italy', 'Europe'], ['XK', 'Kosovo', 'Europe'],
  ['LV', 'Latvia', 'Europe'], ['LI', 'Liechtenstein', 'Europe'], ['LT', 'Lithuania', 'Europe'], ['LU', 'Luxembourg', 'Europe'],
  ['MT', 'Malta', 'Europe'], ['MD', 'Moldova', 'Europe'], ['MC', 'Monaco', 'Europe'], ['ME', 'Montenegro', 'Europe'],
  ['NL', 'Netherlands', 'Europe'], ['MK', 'North Macedonia', 'Europe'], ['NO', 'Norway', 'Europe'], ['PL', 'Poland', 'Europe'],
  ['PT', 'Portugal', 'Europe'], ['RO', 'Romania', 'Europe'], ['RU', 'Russia', 'Europe'], ['SM', 'San Marino', 'Europe'],
  ['RS', 'Serbia', 'Europe'], ['SK', 'Slovakia', 'Europe'], ['SI', 'Slovenia', 'Europe'], ['ES', 'Spain', 'Europe'],
  ['SE', 'Sweden', 'Europe'], ['CH', 'Switzerland', 'Europe'], ['TR', 'Türkiye', 'Europe'], ['UA', 'Ukraine', 'Europe'],
  ['GB', 'United Kingdom', 'Europe'], ['VA', 'Vatican City', 'Europe'],
  // Middle East
  ['BH', 'Bahrain', 'Middle East'], ['IR', 'Iran', 'Middle East'], ['IQ', 'Iraq', 'Middle East'], ['IL', 'Israel', 'Middle East'],
  ['JO', 'Jordan', 'Middle East'], ['KW', 'Kuwait', 'Middle East'], ['LB', 'Lebanon', 'Middle East'], ['OM', 'Oman', 'Middle East'],
  ['PS', 'Palestine', 'Middle East'], ['QA', 'Qatar', 'Middle East'], ['SA', 'Saudi Arabia', 'Middle East'], ['SY', 'Syria', 'Middle East'],
  ['AE', 'United Arab Emirates', 'Middle East'], ['YE', 'Yemen', 'Middle East'],
  // Oceania
  ['AU', 'Australia', 'Oceania'], ['FJ', 'Fiji', 'Oceania'], ['PF', 'French Polynesia', 'Oceania'], ['KI', 'Kiribati', 'Oceania'],
  ['MH', 'Marshall Islands', 'Oceania'], ['FM', 'Micronesia', 'Oceania'], ['NR', 'Nauru', 'Oceania'], ['NZ', 'New Zealand', 'Oceania'],
  ['PW', 'Palau', 'Oceania'], ['PG', 'Papua New Guinea', 'Oceania'], ['WS', 'Samoa', 'Oceania'], ['SB', 'Solomon Islands', 'Oceania'],
  ['TO', 'Tonga', 'Oceania'], ['TV', 'Tuvalu', 'Oceania'], ['VU', 'Vanuatu', 'Oceania'],
]

export const COUNTRIES: Country[] = raw
  .map(([code, name, region]) => ({ code, name, region }))
  .sort((a, b) => a.name.localeCompare(b.name))

export const REGIONS: Region[] = ['Africa', 'Americas', 'Asia', 'Europe', 'Middle East', 'Oceania']

/** 🇫🇷 from "FR": two regional-indicator letters. */
export function flagOf(code: string): string {
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)))
}

/** Case- and accent-insensitive match on the name or code. */
export function matchCountry(c: Country, q: string): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const n = norm(q.trim())
  return !n || norm(c.name).includes(n) || c.code.toLowerCase() === n
}
