/**
 * The World Desk's look: Aero glass over a dark aurora, HD imagery, one
 * centred column with real margins.
 *
 * Real backdrop blur is kept to the few large panels (masthead, ticker, desk
 * bar, rail, modal). Eighty blurred cards would make scrolling stutter on a
 * machine without a graphics card, so the cards get their glass from layered
 * translucent gradients and edge highlights instead.
 */
export const NEWS_CSS = `
.aihub-news{
  --text:#eef0f8;--muted:#a3a9c2;--faint:#727a98;
  --glass:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.03));
  --glass-strong:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.05));
  --edge:rgba(255,255,255,.13);--edge-soft:rgba(255,255,255,.07);
  --hi:inset 0 1px 0 rgba(255,255,255,.18);
  --lift:0 18px 44px rgba(0,0,0,.38);
  position:relative;min-height:100%;color:var(--text);font-family:Inter,system-ui,sans-serif;
  background:
    radial-gradient(900px 520px at 12% -8%,color-mix(in srgb,var(--desk) 30%,transparent),transparent 65%),
    radial-gradient(800px 600px at 100% 10%,rgba(56,189,248,.12),transparent 60%),
    radial-gradient(900px 700px at 50% 120%,rgba(139,92,246,.14),transparent 60%),
    linear-gradient(180deg,rgba(8,10,18,.80),rgba(6,8,14,.92));
  transition:background .6s ease;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
:where(.aihub-news) :where(button){font:inherit;color:inherit;background:none;border:none;cursor:pointer;text-align:left}
.nr-shell{max-width:1440px;margin:0 auto;padding:clamp(16px,2.4vw,32px) clamp(18px,4vw,56px) 72px;display:flex;flex-direction:column;gap:16px}

/* Panels — the real Aero glass */
.nr-panel{position:relative;background:var(--glass-strong);border:1px solid var(--edge);box-shadow:var(--hi),0 10px 34px rgba(0,0,0,.28);
  backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%)}
.nr-panel::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 42%)}

/* Masthead */
.nr-mast{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:18px;padding:18px 24px;border-radius:22px}
.nr-mast-left{display:flex;align-items:center;gap:12px;min-width:0}
.nr-mast-right{display:flex;align-items:center;justify-content:flex-end;gap:10px}
.nr-title{position:relative;font-family:Fraunces,Georgia,'Times New Roman',serif;font-weight:800;font-size:clamp(30px,3.4vw,48px);letter-spacing:-.025em;margin:0;line-height:1;text-align:center;
  background:linear-gradient(180deg,#fff 30%,#c7cce0);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 2px 24px rgba(255,255,255,.08)}
.nr-live{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:linear-gradient(180deg,#ef4444,#b91c1c);color:#fff;font-size:10.5px;font-weight:800;letter-spacing:.14em;box-shadow:0 0 18px rgba(239,68,68,.45),inset 0 1px 0 rgba(255,255,255,.35)}
.nr-live-dot{width:6px;height:6px;border-radius:99px;background:#fff;animation:nrBlink 1.2s steps(2) infinite}
.nr-date{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nr-updated{font-size:11.5px;color:var(--faint);white-space:nowrap}
.nr-icon-btn{width:34px;height:34px;border-radius:11px;display:flex!important;align-items:center;justify-content:center;background:var(--glass)!important;border:1px solid var(--edge)!important;color:var(--muted)!important;box-shadow:var(--hi);transition:all .2s}
.nr-icon-btn:hover{color:#fff!important;border-color:color-mix(in srgb,var(--desk) 60%,transparent)!important}

/* Ticker */
.nr-ticker{display:flex;align-items:stretch;height:42px;border-radius:14px;overflow:hidden}
.nr-ticker-tag{position:relative;z-index:1;display:flex;align-items:center;padding:0 22px 0 16px;background:linear-gradient(180deg,#ef4444,#b91c1c);color:#fff;font-weight:800;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;flex-shrink:0;clip-path:polygon(0 0,100% 0,calc(100% - 10px) 100%,0 100%)}
.nr-ticker-track{flex:1;overflow:hidden;position:relative;mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 40px),transparent)}
.nr-ticker-run{display:flex;gap:40px;width:max-content;height:100%;align-items:center;animation:nrTicker 130s linear infinite}
.nr-ticker-track:hover .nr-ticker-run{animation-play-state:paused}
.nr-ticker-item{font-size:13.5px;white-space:nowrap;color:#f3f4f8!important;transition:color .15s}
.nr-ticker-item:hover{color:#fecaca!important}
.nr-ticker-src{color:#f87171;font-weight:800;margin-right:9px;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em}
.nr-ticker-wait{display:flex;align-items:center;height:100%;padding-left:16px;font-size:12.5px;color:var(--faint)}

/* World clocks */
.nr-clocks{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px}
.nr-clock{display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 6px;border-radius:14px;background:var(--glass);border:1px solid var(--edge-soft);box-shadow:var(--hi)}
.nr-clock-city{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.nr-clock-time{font-variant-numeric:tabular-nums;font-size:15.5px;font-weight:700;color:var(--text)}

/* Desk bar */
.nr-desks{position:sticky;top:10px;z-index:6;display:flex;gap:6px;overflow-x:auto;padding:7px;border-radius:18px;scrollbar-width:none;
  mask-image:linear-gradient(90deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)}
.nr-desks::-webkit-scrollbar{display:none}
.nr-desk{position:relative;display:inline-flex!important;align-items:center;gap:7px;white-space:nowrap;padding:8px 14px!important;border-radius:12px;font-size:12.5px;font-weight:600;color:var(--muted)!important;transition:color .2s,background .2s,box-shadow .2s}
.nr-desk:hover{color:#fff!important;background:color-mix(in srgb,var(--c) 14%,transparent)!important}
.nr-desk[data-active="true"]{color:#fff!important;background:linear-gradient(180deg,color-mix(in srgb,var(--c) 92%,#fff 8%),color-mix(in srgb,var(--c) 80%,#000 20%))!important;
  box-shadow:0 6px 20px color-mix(in srgb,var(--c) 45%,transparent),inset 0 1px 0 rgba(255,255,255,.35)}

.nr-body{display:flex;flex-direction:column;gap:22px;margin-top:6px}

/* Countries */
.nr-countries{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.nr-country{display:flex!important;align-items:center;gap:9px;padding:9px 12px!important;border-radius:12px;background:var(--glass)!important;border:1px solid var(--edge-soft)!important;font-size:12.5px;font-weight:600;color:var(--muted)!important;box-shadow:var(--hi);transition:all .2s}
.nr-country:hover{color:#fff!important;border-color:var(--edge)!important}
.nr-country[data-active="true"]{border-color:rgba(45,212,191,.6)!important;color:#fff!important;background:linear-gradient(180deg,rgba(45,212,191,.24),rgba(20,184,166,.10))!important}
.nr-flag{font-size:17px;line-height:1;width:24px;text-align:center}
.nr-flag-img{width:24px;height:16px;object-fit:cover;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 2px 6px rgba(0,0,0,.35);flex-shrink:0}

/* Stale notice */
.nr-stale{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:14px;font-size:12.5px;color:#fde68a;background:linear-gradient(180deg,rgba(245,158,11,.16),rgba(245,158,11,.07));border:1px solid rgba(245,158,11,.32)}

/* Front page */
.nr-front{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,380px);gap:20px;align-items:stretch}
.nr-lead{position:relative;aspect-ratio:16/9;min-height:420px;border-radius:24px;overflow:hidden;cursor:pointer;border:1px solid var(--edge);box-shadow:var(--lift),var(--hi);isolation:isolate}
.nr-lead .nr-thumb{position:absolute;inset:0;aspect-ratio:auto;border-radius:0}
.nr-lead .nr-thumb img{transition:opacity .5s ease,transform 8s ease}
.nr-lead:hover .nr-thumb img{transform:scale(1.045)}
.nr-lead-shade{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(3,5,10,.55) 60%,rgba(3,5,10,.94))}
.nr-lead-body{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:30px 32px}
.nr-lead h2{font-family:Fraunces,Georgia,serif;font-weight:800;font-size:clamp(26px,2.7vw,40px);line-height:1.1;margin:10px 0 12px;color:#fff;text-wrap:balance;text-shadow:0 2px 18px rgba(0,0,0,.5)}
.nr-lead p{color:#d6d9e4;font-size:15px;line-height:1.55;margin:0 0 14px;max-width:780px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nr-kicker{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fff;padding:4px 10px;border-radius:999px;
  background:color-mix(in srgb,var(--desk) 70%,transparent);box-shadow:inset 0 1px 0 rgba(255,255,255,.3)}
.nr-rail{height:0;min-height:100%;overflow:auto;border-radius:24px;padding:20px 20px 10px;scrollbar-width:thin}
.nr-rail h3{display:flex;align-items:center;gap:7px;margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:color-mix(in srgb,var(--desk) 70%,#fff)}
.nr-rail-item{display:flex!important;gap:14px;padding:13px 0!important;border-top:1px solid var(--edge-soft)!important;width:100%}
.nr-rail-item:first-of-type{border-top:none!important}
.nr-rail-n{font-family:Fraunces,Georgia,serif;font-size:28px;font-weight:800;line-height:1;min-width:24px;color:transparent;-webkit-text-stroke:1px color-mix(in srgb,var(--desk) 75%,#fff)}
.nr-rail-title{display:block;font-size:14px;font-weight:600;line-height:1.38;margin-bottom:5px;transition:color .15s}
.nr-rail-item:hover .nr-rail-title{color:color-mix(in srgb,var(--desk) 55%,#fff)}

/* Meta line */
.nr-meta{display:flex;flex-wrap:wrap;align-items:center;gap:5px;font-size:11.5px;color:var(--faint)}
.nr-meta[data-light="true"]{color:#cfd3e0}
.nr-meta-src{font-weight:700;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nr-meta[data-light="true"] .nr-meta-src{color:#fff}
.nr-coverage{display:inline-flex;align-items:center;gap:3px;margin-left:2px;padding:2px 8px;border-radius:99px;background:rgba(34,197,94,.15);border:1px solid rgba(74,222,128,.25);color:#86efac;font-weight:700;font-size:10.5px}

/* Section heading */
.nr-section-h{display:flex;align-items:center;gap:10px;font-family:Fraunces,Georgia,serif;font-size:22px;margin:6px 0 0}
.nr-section-h::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--edge),transparent)}

/* Card grid — equal heights, aligned meta lines */
.nr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:20px;align-items:stretch}
.nr-card{position:relative;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;cursor:pointer;
  background:var(--glass);border:1px solid var(--edge-soft);box-shadow:var(--hi),0 8px 24px rgba(0,0,0,.22);
  transition:transform .28s cubic-bezier(.2,.8,.2,1),border-color .28s,box-shadow .28s}
.nr-card::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.06),transparent 30%)}
.nr-card:hover{transform:translateY(-5px);border-color:color-mix(in srgb,var(--desk) 50%,transparent);
  box-shadow:var(--hi),0 22px 48px rgba(0,0,0,.42),0 0 0 1px color-mix(in srgb,var(--desk) 22%,transparent),0 12px 40px color-mix(in srgb,var(--desk) 18%,transparent)}
.nr-card-body{display:flex;flex-direction:column;gap:8px;padding:16px 18px 18px;flex:1}
.nr-card h3{font-family:Fraunces,Georgia,serif;font-size:17.5px;font-weight:600;line-height:1.3;margin:0;text-wrap:pretty;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.nr-card p{margin:0;font-size:13px;line-height:1.55;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nr-card .nr-meta{margin-top:auto;padding-top:6px}

/* Thumbnails — HD photo, a shimmer while it is found, the publisher's card when there is none */
.nr-thumb{position:relative;aspect-ratio:16/9;overflow:hidden;background:#0c0f18}
.nr-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .45s ease,transform .6s ease}
.nr-thumb img.is-loaded{opacity:1}
.nr-card:hover .nr-thumb img{transform:scale(1.05)}
.nr-thumb::after{content:'';position:absolute;inset:auto 0 0 0;height:40%;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(5,7,12,.45))}
.nr-thumb-wait{position:absolute;inset:0;background:linear-gradient(100deg,rgba(255,255,255,.03) 20%,rgba(255,255,255,.09) 40%,rgba(255,255,255,.03) 60%);background-size:200% 100%;animation:nrShimmer 1.4s linear infinite}
.nr-pub{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  background:radial-gradient(120% 90% at 20% 10%,hsl(var(--h) 75% 55% / .55),transparent 60%),radial-gradient(90% 90% at 90% 100%,hsl(calc(var(--h) + 50) 70% 45% / .45),transparent 60%),linear-gradient(135deg,hsl(var(--h) 40% 18%),hsl(calc(var(--h) + 40) 45% 9%))}
.nr-pub-logo{width:58px;height:58px;border-radius:18px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.92);box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 1px 0 #fff}
.nr-pub-logo img{position:static;width:34px;height:34px;opacity:1;object-fit:contain}
.nr-pub-logo b{font-family:Fraunces,Georgia,serif;font-size:28px;color:hsl(var(--h) 45% 25%)}
.nr-pub-name{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.85);text-shadow:0 1px 8px rgba(0,0,0,.4);max-width:85%;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nr-lead .nr-pub-logo{width:84px;height:84px;border-radius:24px}
.nr-lead .nr-pub-logo img{width:50px;height:50px}

.nr-sources{margin:4px 0 0;font-size:11.5px;color:var(--faint);line-height:1.65;text-align:center;max-width:900px;align-self:center}
.nr-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:64px 20px;color:var(--muted);text-align:center;border-radius:22px;background:var(--glass);border:1px solid var(--edge-soft)}

/* Buttons and links */
.nr-btn{display:inline-flex!important;align-items:center;gap:7px;padding:9px 16px!important;border-radius:12px;font-weight:700;font-size:12.5px;background:var(--glass-strong)!important;border:1px solid var(--edge)!important;box-shadow:var(--hi);white-space:nowrap;transition:all .2s}
.nr-btn:hover{border-color:rgba(255,255,255,.25)!important}
.nr-btn:disabled{opacity:.6;cursor:default}
.nr-btn-warm{background:linear-gradient(180deg,#fb923c,#ea580c)!important;color:#fff!important;border:none!important;box-shadow:0 10px 26px rgba(249,115,22,.38),inset 0 1px 0 rgba(255,255,255,.35)}
.nr-link{display:inline-flex!important;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#fdba74!important;margin-top:10px}
.nr-link:hover{text-decoration:underline}

/* Kitchen */
.nr-kitchen-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:28px 30px;border-radius:24px;
  background:radial-gradient(600px 260px at 0% 0%,rgba(249,115,22,.34),transparent 70%),radial-gradient(500px 260px at 100% 100%,rgba(239,68,68,.24),transparent 70%),var(--glass-strong);
  border:1px solid rgba(251,146,60,.28);box-shadow:var(--hi),var(--lift)}
.nr-kitchen-title{font-family:Fraunces,Georgia,serif;font-size:34px;font-weight:800;margin:10px 0 6px}
.nr-kitchen-sub{margin:0;color:var(--muted);font-size:13.5px;max-width:560px;line-height:1.55}
.nr-recipes{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
.nr-recipe{display:flex;flex-direction:column;border-radius:20px;overflow:hidden;cursor:pointer;background:var(--glass);border:1px solid var(--edge-soft);box-shadow:var(--hi),0 8px 24px rgba(0,0,0,.22);transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s,border-color .28s}
.nr-recipe:hover{transform:translateY(-5px);border-color:rgba(251,146,60,.45);box-shadow:var(--hi),0 22px 48px rgba(0,0,0,.4),0 12px 40px rgba(249,115,22,.16)}
.nr-recipe-img{position:relative;aspect-ratio:4/3;background:#1a1410;overflow:hidden}
.nr-recipe-img img{width:100%;height:100%;object-fit:cover;transition:transform .6s}
.nr-recipe:hover .nr-recipe-img img{transform:scale(1.07)}
.nr-play{position:absolute;right:12px;bottom:12px;color:#fff;filter:drop-shadow(0 2px 10px rgba(0,0,0,.6))}
.nr-recipe-body{padding:14px 16px 16px;display:flex;flex-direction:column;flex:1}
.nr-recipe-tags{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#fdba74}
.nr-recipe h3,.nr-idea h3{font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:600;margin:5px 0 6px;line-height:1.25}
.nr-recipe-count{font-size:11.5px;color:var(--faint);margin-top:auto}
.nr-chef{padding:26px 28px;border-radius:24px;background:radial-gradient(700px 260px at 0% 0%,rgba(168,85,247,.22),transparent 70%),var(--glass-strong);border:1px solid rgba(168,85,247,.26);box-shadow:var(--hi),var(--lift)}
.nr-chef-head{display:flex;gap:14px;align-items:flex-start;color:#d8b4fe}
.nr-chef-form{display:flex;gap:10px;margin:18px 0 8px;flex-wrap:wrap}
.nr-chef-form input,.nr-chef-form select{background:rgba(6,8,14,.6);border:1px solid var(--edge);color:var(--text);border-radius:12px;padding:10px 13px;font-size:13px;outline:none;box-shadow:inset 0 1px 3px rgba(0,0,0,.4)}
.nr-chef-form input{flex:1;min-width:220px}
.nr-chef-form input:focus,.nr-chef-form select:focus{border-color:#a855f7;box-shadow:0 0 0 3px rgba(168,85,247,.18)}
.nr-chef-note{font-size:11.5px;color:var(--faint);margin:6px 0 12px}
.nr-ideas{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}
.nr-idea{padding:20px;border-radius:18px;background:rgba(8,10,18,.55);border:1px solid var(--edge-soft);box-shadow:var(--hi);animation:nrRise .5s ease both}
.nr-idea:nth-child(2){animation-delay:.08s}.nr-idea:nth-child(3){animation-delay:.16s}
.nr-idea-desc{color:var(--muted);font-size:13px;line-height:1.55;margin:0 0 10px}
.nr-idea h4,.nr-modal-body h4{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:14px 0 6px}
.nr-idea-list,.nr-idea-steps{margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#d4d7e2}
.nr-steps,.nr-idea-steps{list-style:decimal}
.nr-idea-list{list-style:disc}

/* Recipe modal */
.nr-modal-back{position:fixed;inset:0;z-index:50;background:rgba(3,5,10,.66);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:28px;animation:nrFade .2s}
.nr-modal{position:relative;width:min(1040px,100%);max-height:100%;overflow:auto;border-radius:24px;background:linear-gradient(180deg,rgba(26,30,44,.92),rgba(14,16,26,.94));border:1px solid var(--edge);box-shadow:0 40px 100px rgba(0,0,0,.6),var(--hi);animation:nrRise .25s ease}
.nr-modal-x{position:absolute;top:14px;right:14px;z-index:2;width:34px;height:34px;border-radius:99px;display:flex!important;align-items:center;justify-content:center;background:rgba(0,0,0,.55)!important;color:#fff!important;border:1px solid var(--edge)!important}
.nr-modal-media{background:#000}
.nr-modal-media iframe{display:block;width:100%;aspect-ratio:16/9;border:0}
.nr-modal-media img{display:block;width:100%;max-height:440px;object-fit:cover}
.nr-modal-media-bar{display:flex;justify-content:space-between;gap:10px;padding:9px 16px;background:rgba(0,0,0,.6)}
.nr-modal-media-bar button{font-size:11.5px;color:var(--faint)!important;display:inline-flex!important;align-items:center;gap:5px}
.nr-modal-media-bar button:hover{color:var(--text)!important}
.nr-modal-body{padding:24px 28px 28px}
.nr-modal-title{font-family:Fraunces,Georgia,serif;font-size:32px;font-weight:800;margin:8px 0 4px}
.nr-modal-cols{display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:28px}
.nr-ingredients{list-style:none;margin:0;padding:0}
.nr-ingredients li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed var(--edge-soft);font-size:13px}
.nr-ingredients em{font-style:normal;color:#fdba74;text-align:right}
.nr-steps{margin:0;padding-left:20px;font-size:13.5px;line-height:1.7;color:#d4d7e2}
.nr-steps li{margin-bottom:8px}

/* Loading */
.nr-skeleton{display:flex;flex-direction:column;gap:22px}
.nr-sk{border-radius:20px;background:linear-gradient(100deg,rgba(255,255,255,.035) 20%,rgba(255,255,255,.085) 40%,rgba(255,255,255,.035) 60%);background-size:200% 100%;animation:nrShimmer 1.4s linear infinite;border:1px solid var(--edge-soft)}
.nr-sk-lead{height:440px;border-radius:24px}
.nr-sk-card{height:330px}
.nr-sk-recipe{height:280px}
.nr-spin{animation:nrSpin 1s linear infinite}

@keyframes nrSpin{to{transform:rotate(360deg)}}
@keyframes nrBlink{50%{opacity:.2}}
@keyframes nrTicker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes nrShimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@keyframes nrRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes nrFade{from{opacity:0}to{opacity:1}}

@media (max-width:1000px){.nr-front{grid-template-columns:1fr}.nr-rail{height:auto;min-height:0;max-height:none}.nr-lead{min-height:340px}}
@media (max-width:760px){.nr-mast{grid-template-columns:1fr;text-align:center}.nr-mast-left,.nr-mast-right{justify-content:center}.nr-modal-cols{grid-template-columns:1fr}.nr-kitchen-hero{flex-direction:column;align-items:flex-start}}
@media (prefers-reduced-motion:reduce){.nr-ticker-run{animation-duration:400s}.nr-card,.nr-recipe,.nr-thumb img,.nr-lead .nr-thumb img{transition:none}.nr-thumb-wait,.nr-sk{animation:none}}
`
