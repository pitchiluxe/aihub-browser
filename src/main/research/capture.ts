import { randomUUID } from 'crypto'
import { normalizeEvidence } from '../../shared/research/evidence'
import { safeResearchUrl } from '../../shared/research/validation'
import { RESEARCH_LIMITS as L, type CapturedSource, type ResearchResult } from '../../shared/research/types'
export interface CaptureWebContents { isDestroyed(): boolean; getURL(): string; getTitle(): string; executeJavaScript(script: string): Promise<unknown> }
export const RESEARCH_CAPTURE_SCRIPT = `(async function(){
  function output(text,type){return {text:text.slice(0,12000),captureType:type,truncated:text.length>12000}}
  function page(){
    var original=document.querySelector('main,article')||document.body;
    if(!original)return output('','page');
    var copy=original.cloneNode(true);
    copy.querySelectorAll('input,textarea,select,button,script,style,noscript,[contenteditable]').forEach(function(el){el.remove()});
    return output((copy.innerText||copy.textContent||'').trim(),'page');
  }
  try{
    var vid=new URLSearchParams(location.search).get('v');
    var pr=window.ytInitialPlayerResponse;
    if(/(^|\\.)youtube\\.com$/.test(location.hostname)&&vid&&pr&&pr.videoDetails&&pr.videoDetails.videoId===vid){
      var tracks=pr.captions&&pr.captions.playerCaptionsTracklistRenderer&&pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      if(tracks&&tracks.length){
        var ctrl=new AbortController();var timer=setTimeout(function(){ctrl.abort()},6000);
        try{var response=await fetch(tracks[0].baseUrl,{signal:ctrl.signal});
          if(response.ok){var xml=new DOMParser().parseFromString(await response.text(),'text/xml');
            var text=Array.from(xml.getElementsByTagName('text')).map(function(n){var t=document.createElement('textarea');t.innerHTML=n.textContent||'';return t.value}).join(' ');
            if(text.trim())return output(text,'transcript');}
        }finally{clearTimeout(timer)}
      }
    }
  }catch(e){}
  return page();
})()`
export async function captureResearchSource(wc: CaptureWebContents): Promise<ResearchResult<CapturedSource>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (wc.isDestroyed()) throw Error('This page is no longer available.')
    const url = wc.getURL(), title = wc.getTitle().slice(0, L.titleChars) || url.slice(0, L.titleChars)
    if (!safeResearchUrl(url)) throw Error('Choose a loaded web page.')
    const capturedAt = new Date().toISOString()
    const raw: any = await Promise.race([wc.executeJavaScript(RESEARCH_CAPTURE_SCRIPT), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Capture timed out. Try the page again.')), 10_000) })])
    if (wc.isDestroyed() || wc.getURL() !== url) throw Error('The page changed during capture. Capture it again.')
    if (!raw || typeof raw.text !== 'string' || !['page', 'transcript'].includes(raw.captureType)) throw Error('The page returned no readable evidence.')
    const text = normalizeEvidence(raw.text.slice(0, L.sourceChars))
    if (!text) throw Error('This page has no readable text to capture.')
    return { ok: true, value: { id: randomUUID(), title, url, capturedAt, text, truncated: !!raw.truncated || raw.text.length > L.sourceChars, captureType: raw.captureType, provenance: 'captured' } }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Could not capture this page.' } }
  finally { if (timer) clearTimeout(timer) }
}
