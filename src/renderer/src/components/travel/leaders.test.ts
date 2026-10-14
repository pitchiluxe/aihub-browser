// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseInfoboxLeaders } from './travelData'

// The shape of Wikipedia's rendered {{Infobox country}} (action=parse, section 0).
const link = (article: string, text = article) => `<a href="/wiki/${encodeURIComponent(article.replace(/ /g, '_'))}" title="${article}">${text}</a>`
const row = (th: string, td: string) =>
  `<tr class="mergedrow"><th scope="row" class="infobox-label"><div style="text-indent:-0.9em">•&#160;${th} </div></th><td class="infobox-data">${td}</td></tr>`
const infobox = (...rows: string[]) => `<table class="infobox ib-country vcard"><tbody>
  <tr><th scope="row" class="infobox-label">${link('Demonym')}</th><td class="infobox-data">Congolese</td></tr>
  <tr><th scope="row" class="infobox-label">${link('Politics of X', 'Government')}</th><td class="infobox-data">Republic</td></tr>
  <tr class="mergedrow infobox-hiddenrow"><td colspan="2" class="infobox-full-data"></td></tr>
  ${rows.join('\n')}
  <tr style="display:none"><td colspan="2"></td></tr>
  <tr><th scope="row" class="infobox-label">Legislature</th><td class="infobox-data">${link('Parliament')}</td></tr>
  <tr class="mergedrow"><th scope="row" class="infobox-label">${link('President of the Senate')}</th><td class="infobox-data">${link('Someone Else')}</td></tr>
</tbody></table>`
const brief = (html: string) => parseInfoboxLeaders(html).map(l => `${l.roles.join('+')}: ${l.name} (${l.office})${l.article ? '' : ' [no article]'}`)

describe('leaders from the Wikipedia infobox', () => {
  it('names DR Congo’s current Prime Minister, not the stale Wikidata one', () => {
    const html = infobox(
      row(link('President of the Democratic Republic of the Congo', 'President'), link('Félix Tshisekedi')),
      row(link('Prime Minister of the Democratic Republic of the Congo', 'Prime Minister'), `${link('Judith Suminwa')}<sup class="reference"><a href="#cite_note-1">[1]</a></sup>`),
      row(link('List of presidents of the Senate of the Democratic Republic of the Congo', 'President of the Senate'), link('Jean-Michel Sama Lukonde Kyenge')),
    )
    expect(brief(html)).toEqual(['state: Félix Tshisekedi (President)', 'government: Judith Suminwa (Prime Minister)'])
    expect(parseInfoboxLeaders(html)[1].url).toBe('https://en.wikipedia.org/wiki/Judith_Suminwa')
  })

  it('makes a president with no prime minister head of state and government', () => {
    const html = infobox(
      row(link('President of Kenya', 'President'), link('William Ruto')),
      row(link('Deputy President of Kenya', 'Deputy President'), link('Kithure Kindiki')),
      row(link('Speaker of the National Assembly of Kenya', 'Assembly Speaker'), link("Moses Wetang'ula")),
    )
    expect(brief(html)).toEqual(['state+government: William Ruto (President)'])
  })

  it('keeps a monarch as head of state only and skips the governor-general', () => {
    const html = infobox(
      row(link('Monarchy of Canada', 'Monarch'), link('Charles III')),
      row(`<span class="nowrap">${link('Governor General of Canada', 'Governor General')}</span>`, link('Louise Arbour')),
      row(link('Prime Minister of Canada', 'Prime Minister'), link('Mark Carney')),
    )
    expect(brief(html)).toEqual(['state: Charles III (Monarch)', 'government: Mark Carney (Prime Minister)'])
  })

  it('reads one row holding both offices, and the fuller article name', () => {
    const html = infobox(row(`${link('List of rulers of Oman', 'Sultan')} and ${link('Prime Minister of Oman', 'Prime Minister')}`, link('Haitham bin Tariq', 'Haitham')))
    expect(brief(html)).toEqual(['state+government: Haitham bin Tariq (Sultan and Prime Minister)'])
  })

  it('resolves a plain-text name to the person linked elsewhere in the infobox', () => {
    const html = infobox(
      row(link('King of Bahrain', 'King'), link('Hamad bin Isa Al Khalifa')),
      row(link('Crown Prince of Bahrain', 'Crown Prince'), link('Salman bin Hamad Al Khalifa')),
      row(link('Prime Minister of Bahrain', 'Prime Minister'), 'Salman bin Hamad Al Khalifa'),
    )
    expect(brief(html)).toEqual(['state: Hamad bin Isa Al Khalifa (King)', 'government: Salman bin Hamad Al Khalifa (Prime Minister)'])
  })

  it('takes the president as head of government under a supreme leader', () => {
    const html = infobox(
      row(link('Supreme Leader of Iran', 'Supreme Leader'), link('Mojtaba Khamenei')),
      row(link('President of Iran', 'President'), link('Masoud Pezeshkian')),
      row(link('Vice President of Iran', 'First Vice President'), link('Mohammad Reza Aref')),
    )
    expect(brief(html)).toEqual(['state: Mojtaba Khamenei (Supreme Leader)', 'government: Masoud Pezeshkian (President)'])
  })

  it('skips a vacant office and marks an acting one', () => {
    const html = infobox(
      row(link('President of Haiti', 'President'), '<i>Vacant</i>'),
      row(link('Prime Minister of Haiti', 'Prime Minister'), `${link('Alix Didier Fils-Aimé')} (acting)<sup class="reference">[2]</sup>`),
    )
    expect(brief(html)).toEqual(['government: Alix Didier Fils-Aimé (Prime Minister (acting))'])
  })

  it('lists joint heads of state, ignoring their notes and representatives', () => {
    const html = infobox(
      row(link('Co-princes of Andorra', 'Co-princes'), `<div class="plainlist"><ul><li>${link('Josep-Lluís Serrano Pentinat')} <small>(${link('Bishop of Urgell')})</small></li><li>${link('Emmanuel Macron')}</li></ul></div>`),
      row(link('List of representatives of the co-princes of Andorra', 'Personal representatives'), link('Someone')),
      row(link('List of heads of government of Andorra', 'Head of government'), link('Xavier Espot Zamora')),
    )
    expect(brief(html)).toEqual(['state: Josep-Lluís Serrano Pentinat (Co-princes (Bishop of Urgell))', 'state: Emmanuel Macron (Co-princes)', 'government: Xavier Espot Zamora (Head of government)'])
  })

  it('takes a listed person’s own qualifier as their office and drops a vice president', () => {
    const html = infobox(
      row(link('Federal Council of Switzerland', 'Federal Councillors'), `<div class="plainlist"><ul>
        <li>${link('Guy Parmelin')} <small>(${link('President of the Swiss Confederation', 'President')})</small></li>
        <li>${link('Ignazio Cassis')} <small>(${link('Vice President of Switzerland', 'Vice president')})</small></li></ul></div>`),
      row(`<span class="nowrap">${link('Chancellor of Switzerland', 'Federal Chancellor')}</span>`, link('Viktor Rossi')),
    )
    expect(brief(html)).toEqual(['state+government: Guy Parmelin (President of the Swiss Confederation)'])
  })

  it('does not take a minister assisting the president as head of government', () => {
    const html = infobox(
      row(link('List of presidents of the Marshall Islands', 'President'), link('Hilda Heine')),
      row(link('Nitijela', 'Speaker'), link('Brenson Wase')),
      row(link('Minister in Assistance to the President of Marshall Islands', 'Minister in Assistance to the President'), link('Bremity Lakjohn')),
    )
    expect(brief(html)).toEqual(['state+government: Hilda Heine (President)'])
  })

  it('returns nothing without an infobox or a government block', () => {
    expect(parseInfoboxLeaders('<p>No infobox</p>')).toEqual([])
    expect(parseInfoboxLeaders('<table class="infobox"><tr><th>Capital</th><td>X</td></tr></table>')).toEqual([])
  })
})
