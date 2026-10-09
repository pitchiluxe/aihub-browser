/**
 * AIHub Browser — getting a table off a page and into a spreadsheet.
 *
 * Copying a web table by hand is universally miserable: the selection picks up
 * sort arrows and footnote markers, merged cells collapse, and numbers arrive
 * as text with a currency symbol welded on. This turns a table into CSV that a
 * spreadsheet opens correctly the first time.
 *
 * The DOM walking has to happen inside the page, so it ships as an injected
 * script (buildTableExtractionScript). Everything that decides what the output
 * *is* — cell cleaning, grid shape, CSV quoting — lives here as pure functions,
 * because those are exactly the parts that are wrong in subtle ways nobody
 * notices until a spreadsheet is already full of bad rows.
 */

/** One table, as the injected script hands it back. */
export interface RawTable {
  /** Rows of cells, already expanded for colspan/rowspan by the page script. */
  rows: string[][]
  /** A caption, nearby heading, or the table's own id — whatever names it. */
  label: string
}

export interface CleanTable {
  label: string
  rows: string[][]
  /** Columns after squaring the grid. */
  columns: number
}

/** Characters Excel and Sheets both treat as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/**
 * One cell, cleaned.
 *
 * Non-breaking spaces are the single most common reason a "number" column
 * imports as text, and they are invisible in the browser, so they are
 * converted rather than trimmed away with the rest of the whitespace.
 */
export function cleanCell(raw: string): string {
  return String(raw ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Quote a value for CSV.
 *
 * Also defuses spreadsheet formula injection: a cell beginning =, +, - or @ is
 * executed on open by Excel and Sheets, which turns "export this page's table"
 * into "run whatever that page wrote". Prefixing a single quote is the
 * conventional fix and is invisible once imported.
 */
export function csvCell(value: string, guardFormulas = true): string {
  let v = String(value ?? '')
  if (guardFormulas && FORMULA_LEAD.test(v)) v = `'${v}`
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * A rectangular grid. Ragged rows are padded rather than dropped: a row short
 * by one cell is usually a real row with a missing value, and discarding it
 * loses data silently.
 */
export function squareUp(rows: string[][]): string[][] {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  return rows.map(r => (r.length === width ? r : r.concat(Array(width - r.length).fill(''))))
}

/** Rows that are entirely empty carry nothing and only break a spreadsheet's header detection. */
export function dropEmptyRows(rows: string[][]): string[][] {
  return rows.filter(r => r.some(c => c !== ''))
}

/**
 * Whether a table is worth offering.
 *
 * Layout tables — a single cell, or one column — are still common on older
 * sites and would otherwise clutter the picker with things nobody wants to
 * export.
 */
export function isDataTable(rows: string[][]): boolean {
  const cleaned = dropEmptyRows(squareUp(rows))
  if (cleaned.length < 2) return false
  const width = cleaned[0]?.length ?? 0
  return width >= 2
}

export function cleanTable(raw: RawTable): CleanTable | null {
  const rows = dropEmptyRows(squareUp((raw.rows || []).map(r => r.map(cleanCell))))
  if (!isDataTable(rows)) return null
  return { label: cleanCell(raw.label) || 'Table', rows, columns: rows[0]?.length ?? 0 }
}

export function cleanTables(raws: RawTable[]): CleanTable[] {
  return (raws || []).map(cleanTable).filter((t): t is CleanTable => !!t)
}

/**
 * CSV text for one table.
 *
 * CRLF line endings, because that is what the CSV spec says and what Excel on
 * Windows expects; a spreadsheet is the whole point of this feature.
 */
export function toCsv(table: CleanTable): string {
  return table.rows.map(row => row.map(c => csvCell(c)).join(',')).join('\r\n')
}

/** A filename that says which table this was, safely. */
export function csvFileName(label: string, pageTitle = ''): string {
  const stem = cleanCell(label) || cleanCell(pageTitle) || 'table'
  const safe = stem
    .replace(/[^a-z0-9 _-]+/gi, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'table'
  return `${safe}.csv`
}

/**
 * The script injected into the page to find its tables.
 *
 * Expands colspan and rowspan into real cells so a merged header does not
 * shift every column underneath it — the failure that makes hand-copied
 * tables wrong in a way you only notice three rows in. Never throws: it
 * returns an empty list instead, matching every other injected script here.
 */
export function buildTableExtractionScript(limit = 25): string {
  return `(function(){
  try{
    var out=[];
    var tables=document.querySelectorAll('table');
    for(var t=0;t<tables.length && out.length<${limit};t++){
      var table=tables[t];
      var grid=[];
      // Cells parked here by an earlier row's rowspan, keyed "row:col".
      var carried={};
      var trs=table.rows;
      for(var r=0;r<trs.length;r++){
        var row=[];
        var col=0;
        var cells=trs[r].cells;
        for(var c=0;c<cells.length;c++){
          while(carried[r+':'+col]!==undefined){ row[col]=carried[r+':'+col]; col++; }
          var cell=cells[c];
          var text=(cell.innerText||cell.textContent||'');
          var cs=Math.max(1,parseInt(cell.getAttribute('colspan')||'1',10)||1);
          var rs=Math.max(1,parseInt(cell.getAttribute('rowspan')||'1',10)||1);
          for(var i=0;i<cs;i++){
            row[col]=text;
            for(var j=1;j<rs;j++){ carried[(r+j)+':'+col]=text; }
            col++;
          }
        }
        while(carried[r+':'+col]!==undefined){ row[col]=carried[r+':'+col]; col++; }
        for(var k=0;k<row.length;k++){ if(row[k]===undefined) row[k]=''; }
        grid.push(row);
      }
      var label='';
      var cap=table.querySelector('caption');
      if(cap) label=cap.innerText||'';
      if(!label){
        var prev=table.previousElementSibling;
        for(var p=0;p<3 && prev;p++){
          if(/^H[1-6]$/.test(prev.tagName)){ label=prev.innerText||''; break; }
          prev=prev.previousElementSibling;
        }
      }
      if(!label) label=table.getAttribute('aria-label')||table.id||'';
      out.push({rows:grid,label:label});
    }
    return JSON.stringify(out);
  }catch(e){ return '[]'; }
})()`
}
