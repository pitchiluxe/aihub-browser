import { describe, it, expect } from 'vitest'
import { buildGuidePrompt, factsQuery, isTourismVideo, leadersQuery, links, normalizeFacts, parseGuide, parseLeaders, rankVideos, wikiTitle, type TravelVideo } from './travelData'
import { COUNTRIES, flagOf, matchCountry } from './countries'

const v = (id: string, title: string, duration = '12:30'): TravelVideo => ({ id, title, channel: 'c', duration, thumbnail: '' })

describe('countries', () => {
  it('covers the world without duplicates', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(195)
    expect(new Set(COUNTRIES.map(c => c.code)).size).toBe(COUNTRIES.length)
    expect(COUNTRIES.every(c => /^[A-Z]{2}$/.test(c.code))).toBe(true)
  })
  it('makes flags and finds countries by name, accents or code', () => {
    expect(flagOf('fr')).toBe('🇫🇷')
    const ci = COUNTRIES.find(c => c.code === 'CI')!
    expect(matchCountry(ci, 'cote')).toBe(true)
    expect(matchCountry(ci, 'ci')).toBe(true)
    expect(matchCountry(ci, 'kenya')).toBe(false)
  })
  it('uses the right Wikipedia article', () => {
    expect(wikiTitle(COUNTRIES.find(c => c.code === 'CD')!)).toBe('Democratic Republic of the Congo')
    expect(wikiTitle(COUNTRIES.find(c => c.code === 'JP')!)).toBe('Japan')
  })
})

describe('tourist videos only', () => {
  it('keeps travel videos and drops news, politics and conflict', () => {
    expect(isTourismVideo(v('a', 'Japan Travel Guide 2026 — 15 things to do'))).toBe(true)
    expect(isTourismVideo(v('b', 'Kenya election protests: breaking news'))).toBe(false)
    expect(isTourismVideo(v('c', 'War in the region explained'))).toBe(false)
    expect(isTourismVideo(v('d', 'Shocking prank in Paris'))).toBe(false)
  })
  it('skips shorts, live streams and hour-long marathons', () => {
    expect(isTourismVideo(v('e', 'Bali 4K', '0:45'))).toBe(false)
    expect(isTourismVideo(v('f', 'Bali 4K', ''))).toBe(false)
    expect(isTourismVideo(v('g', 'Bali 4K', '2:10:00'))).toBe(false)
    expect(isTourismVideo(v('h', 'Bali 4K', '1:05:00'))).toBe(true)
  })
  it('interleaves searches, drops duplicates and puts travel titles first', () => {
    const out = rankVideos([
      [v('1', 'Lisbon evening'), v('2', 'Portugal travel guide')],
      [v('2', 'Portugal travel guide'), v('3', 'Portugal news today'), v('4', 'Porto 4K drone')],
    ])
    expect(out.map(x => x.id)).toEqual(['2', '4', '1'])
  })
})

const row = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value }]))

describe('facts', () => {
  it('reads a Wikidata row', () => {
    const f = normalizeFacts(row({
      official: 'Republic of Kenya', capitals: 'Nairobi', pop: '47564296', area: '580367000000',
      currencies: 'Kenyan shilling (KES)', langs: 'English|Swahili', drive: 'left', calling: '+254',
      tzs: 'East Africa Time|UTC+03:00',
    }))
    expect(f).toMatchObject({ official: 'Republic of Kenya', capital: ['Nairobi'], driveSide: 'left', callingCode: '+254', languages: ['English', 'Swahili'], timezones: ['UTC+03:00'] })
    expect(f.population).toBe(47564296)
    expect(f.areaKm2).toBe(580367)
    expect(f.currencies[0]).toEqual({ code: 'KES', name: 'Kenyan shilling', symbol: '' })
  })
  it('tolerates a missing or odd record', () => {
    const f = normalizeFacts(null)
    expect(f.capital).toEqual([])
    expect(f.driveSide).toBeNull()
    expect(f.population).toBeNull()
    expect(normalizeFacts(row({ currencies: 'Gold coin ()', drive: 'Q123' })).currencies[0]).toEqual({ code: '', name: 'Gold coin', symbol: '' })
  })
  it('finds the country by its Wikipedia article and quotes the title safely', () => {
    expect(factsQuery('Democratic Republic of the Congo')).toContain('schema:name "Democratic Republic of the Congo"@en')
    expect(leadersQuery('Côte "x"')).toContain('schema:name "Côte \\"x\\""@en')
  })
})

describe('leaders', () => {
  it('merges one person holding both offices and puts the head of state first', () => {
    const ls = parseLeaders([
      row({ role: 'government', person: 'Q1', personLabel: 'William Ruto', officeLabel: 'President of Kenya', start: '2022-09-13T00:00:00Z', article: 'https://en.wikipedia.org/wiki/William_Ruto' }),
      row({ role: 'state', person: 'Q1', personLabel: 'William Ruto', officeLabel: 'President of Kenya', start: '2022-09-13T00:00:00Z', article: 'https://en.wikipedia.org/wiki/William_Ruto' }),
    ])
    expect(ls).toHaveLength(1)
    expect(ls[0]).toMatchObject({ name: 'William Ruto', office: 'President of Kenya', since: '2022-09-13', article: 'William Ruto' })
    expect(ls[0].roles.sort()).toEqual(['government', 'state'])
  })
  it('separates monarch and prime minister, and names from the article when the label is missing', () => {
    const ls = parseLeaders([
      row({ role: 'government', person: 'Q2', personLabel: 'Q2', officeLabel: 'Prime Minister of France', article: 'https://en.wikipedia.org/wiki/S%C3%A9bastien_Lecornu' }),
      row({ role: 'state', person: 'Q3', personLabel: 'Q3', officeLabel: 'Q99', article: 'https://en.wikipedia.org/wiki/Emmanuel_Macron' }),
    ])
    expect(ls.map(l => [l.roles[0], l.name, l.office])).toEqual([['state', 'Emmanuel Macron', ''], ['government', 'Sébastien Lecornu', 'Prime Minister of France']])
  })
})

describe('AI guide', () => {
  const kenya = COUNTRIES.find(c => c.code === 'KE')!
  it('grounds the prompt on real facts and asks for JSON', () => {
    const p = buildGuidePrompt(kenya, normalizeFacts(row({ capitals: 'Nairobi', drive: 'left' })), 'Kenya is a country in East Africa.')
    expect(p).toContain('Capital: Nairobi')
    expect(p).toContain('Cars drive on the left')
    expect(p).toContain('East Africa')
    expect(p).toContain('JSON')
  })
  it('reads a reply wrapped in chatter and cleans it', () => {
    const reply = 'Here you go!\n```json\n' + JSON.stringify({
      overview: 'Kenya is great.', bestTime: 'June to October', hotels: [
        { name: 'Giraffe Manor', city: 'Nairobi', tier: 'luxury', why: 'Giraffes at breakfast' },
        { name: '', city: 'x' }, { name: 'Ibis Styles', city: 'Nairobi', tier: 'weird' },
      ],
      carRental: { companies: ['Avis', 42, 'Europcar'], tips: 'Drive on the left' },
      mustSee: [{ name: 'Maasai Mara', city: 'Narok', why: 'Great Migration' }], food: ['Nyama choma — grilled meat'],
    }) + '\n```'
    const g = parseGuide(reply)!
    expect(g.overview).toBe('Kenya is great.')
    expect(g.hotels.map(h => [h.name, h.tier])).toEqual([['Giraffe Manor', 'luxury'], ['Ibis Styles', 'mid']])
    expect(g.carRental.companies).toEqual(['Avis', 'Europcar'])
    expect(g.mustSee[0].name).toBe('Maasai Mara')
    expect(g.politics).toBe('')
  })
  it('refuses replies with nothing usable', () => {
    expect(parseGuide('Sorry, I cannot help.')).toBeNull()
    expect(parseGuide('{"foo": 1}')).toBeNull()
    expect(parseGuide('{broken')).toBeNull()
  })
})

describe('booking and checking links', () => {
  it('builds working search links', () => {
    expect(links.booking('Giraffe Manor Nairobi')).toBe('https://www.booking.com/searchresults.html?ss=Giraffe%20Manor%20Nairobi')
    expect(links.airbnb('Westlands, Nairobi')).toBe('https://www.airbnb.com/s/Westlands%2C%20Nairobi/homes')
    expect(links.advisory(COUNTRIES.find(c => c.code === 'CI')!)).toBe('https://www.gov.uk/foreign-travel-advice/cote-divoire')
    expect(links.advisory(COUNTRIES.find(c => c.code === 'US')!)).toBe('https://www.gov.uk/foreign-travel-advice/united-states')
  })
})
