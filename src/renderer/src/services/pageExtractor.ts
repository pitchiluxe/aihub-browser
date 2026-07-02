// Builds the injected script used to extract "page content" for the AI —
// either the actual YouTube transcript (when the current page is a YouTube
// watch page with captions available) or the page's visible text otherwise.
// Both paths share the same 8000-char cap. Never throws: any failure along
// the transcript path falls back to the generic text extraction, matching
// the no-throw contract every other page-injection script in this codebase
// follows (see agentTools.ts, AnnotationCanvas.tsx).
export function buildPageExtractionScript(): string {
  return `(function(){
  function genericText(){
    var s=document.body.innerText||document.body.textContent||'';
    return s.slice(0,8000);
  }
  try{
    var params = new URLSearchParams(location.search);
    var vid = params.get('v');
    if(location.hostname.indexOf('youtube.com')!==-1 && vid){
      var pr = window.ytInitialPlayerResponse;
      if(pr && pr.videoDetails && pr.videoDetails.videoId===vid){
        var tracks = pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
        if(tracks && tracks.length){
          return fetch(tracks[0].baseUrl).then(function(r){return r.text();}).then(function(xml){
            var doc = new DOMParser().parseFromString(xml,'text/xml');
            var nodes = doc.getElementsByTagName('text');
            var parts=[];
            for(var i=0;i<nodes.length;i++){
              var raw = nodes[i].textContent || '';
              var ta = document.createElement('textarea'); ta.innerHTML = raw;
              parts.push(ta.value);
            }
            var joined = parts.join(' ').replace(/\\s+/g,' ').trim();
            return joined ? joined.slice(0,8000) : genericText();
          }).catch(function(){ return genericText(); });
        }
      }
    }
  }catch(e){}
  return genericText();
})()`
}
