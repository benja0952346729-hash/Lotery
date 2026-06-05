<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
<title>AXIOM — AI Code Editor</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Syne:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js"></script>
<style>
:root{
  --bg0:#0a0b0e;--bg1:#0f1117;--bg2:#141720;--bg3:#1a1e2e;--bg4:#1f2437;
  --border:#252b3d;--border-glow:#2e3650;
  --accent:#5b8fff;--accent2:#a78bfa;--accent3:#34d399;
  --warn:#f59e0b;--red:#f87171;
  --text1:#e8eaf0;--text2:#9ba3bc;--text3:#5a6282;
  --font-mono:'JetBrains Mono',monospace;--font-ui:'Syne',sans-serif;
  --header-h:48px;--bottom-nav-h:60px;--tab-h:36px;
  --explorer-w:220px;--chat-h:300px;
  --radius:10px;--editor-fs:13px;--ln-w:44px;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg0);color:var(--text1);font-family:var(--font-ui)}

/* PRISM */
.token.comment,.token.prolog,.token.doctype,.token.cdata{color:#6a9955;font-style:italic}
.token.punctuation{color:#9ba3bc}
.token.property,.token.tag,.token.boolean,.token.number,.token.constant,.token.symbol{color:#b5cea8}
.token.selector,.token.attr-name,.token.string,.token.char,.token.builtin{color:#ce9178}
.token.operator,.token.entity,.token.url,.language-css .token.string{color:#9cdcfe}
.token.atrule,.token.attr-value,.token.keyword{color:#c586c0}
.token.function,.token.class-name{color:#dcdcaa}
.token.regex,.token.important,.token.variable{color:#9cdcfe}
.token.important,.token.bold{font-weight:bold}
.token.italic{font-style:italic}

/* HEADER */
#header{position:fixed;top:0;left:0;right:0;height:var(--header-h);background:var(--bg1);border-bottom:1px solid var(--border);display:flex;align-items:center;z-index:100;user-select:none;padding:0 4px}
.logo{display:flex;align-items:center;gap:8px;padding:0 12px;border-right:1px solid var(--border);height:100%;flex-shrink:0}
.logo-icon{width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px}
.logo-text{font-size:15px;font-weight:800;letter-spacing:.04em}
.logo-text span{color:var(--accent)}
.header-file-tabs{flex:1;display:flex;align-items:center;padding:0 6px;gap:2px;overflow-x:auto;min-width:0}
.header-file-tabs::-webkit-scrollbar{height:0}
.htab{display:flex;align-items:center;gap:6px;padding:0 10px;height:30px;border-radius:6px;font-size:11px;font-family:var(--font-mono);color:var(--text2);cursor:pointer;white-space:nowrap;border:1px solid transparent;flex-shrink:0}
.htab.active{background:var(--bg3);color:var(--text1);border-color:var(--border-glow)}
.htab .dot{width:5px;height:5px;border-radius:50%;background:var(--accent3)}
.htab .dot.unsaved{background:var(--warn)}
.header-actions{display:flex;align-items:center;gap:3px;padding:0 8px;height:100%;flex-shrink:0}
.hbtn{display:flex;align-items:center;gap:4px;padding:0 10px;height:30px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text2);transition:all .15s;white-space:nowrap;-webkit-tap-highlight-color:transparent}
.hbtn:active{background:var(--bg3);color:var(--text1);transform:scale(.97)}
.hbtn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.hbtn.icon-only{padding:0;width:34px;justify-content:center;font-size:14px}
@media(max-width:600px){
  #btn-share,#btn-github,#btn-export,#btn-preview-toggle{display:none!important}
  .header-file-tabs{max-width:calc(100vw - 160px)}
}

/* LAYOUT */
#layout{position:fixed;top:var(--header-h);left:0;right:0;bottom:var(--bottom-nav-h);display:flex;flex-direction:row;overflow:hidden}

/* BOTTOM NAV — bigger touch targets */
#bottom-nav{position:fixed;bottom:0;left:0;right:0;height:var(--bottom-nav-h);background:var(--bg1);border-top:1px solid var(--border);display:flex;align-items:stretch;z-index:200;padding-bottom:env(safe-area-inset-bottom)}
.bnav-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;font-size:9px;font-weight:700;letter-spacing:.04em;color:var(--text3);text-transform:uppercase;transition:color .15s;position:relative;border:none;background:none;min-height:52px;-webkit-tap-highlight-color:transparent}
.bnav-tab .bnav-icon{font-size:22px;line-height:1}
.bnav-tab.active{color:var(--accent)}
.bnav-tab.active::after{content:'';position:absolute;top:0;left:15%;right:15%;height:2px;background:var(--accent);border-radius:0 0 4px 4px}
.bnav-badge{position:absolute;top:7px;right:calc(50% - 16px);background:var(--red);color:#fff;font-size:8px;font-weight:800;border-radius:99px;padding:1px 5px;min-width:16px;text-align:center;display:none}
.bnav-badge.show{display:block}

/* PANELS */
.panel{position:absolute;inset:0;display:none;flex-direction:column;overflow:hidden}
.panel.active{display:flex;z-index:2}
#panel-preview{z-index:0}
#panel-preview.active{z-index:3}

/* EXPLORER */
#panel-explorer{background:var(--bg1)}
.ex-toolbar{padding:0 12px;height:44px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);flex-shrink:0}
.ex-title{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--text3);text-transform:uppercase}
.ex-actions{display:flex;gap:6px}
.icon-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;color:var(--text3);font-size:16px;border:none;background:none;transition:all .15s;-webkit-tap-highlight-color:transparent}
.icon-btn:active{background:var(--bg3);color:var(--text1)}
#file-tree{flex:1;overflow-y:auto;padding:4px 0}
#file-tree::-webkit-scrollbar{width:3px}
#file-tree::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:2px}
.tree-folder{display:flex;align-items:center;gap:7px;padding:10px 12px;cursor:pointer;font-size:13px;color:var(--text2);user-select:none}
.tree-folder:active{background:var(--bg3)}
.tree-folder .caret{font-size:10px;transition:transform .2s;width:10px;text-align:center}
.tree-folder.open .caret{transform:rotate(90deg)}
.tree-children{display:none;padding-left:16px}
.tree-children.open{display:block}
.tree-file{display:flex;align-items:center;gap:9px;padding:10px 12px;cursor:pointer;font-size:12px;font-family:var(--font-mono);color:var(--text2);border-left:2px solid transparent;user-select:none}
.tree-file:active{background:var(--bg3)}
.tree-file.active{background:var(--bg3);color:var(--text1);border-left-color:var(--accent)}
.tree-file .file-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.ext-js{background:#f0c040}.ext-py{background:#4ec9b0}.ext-html{background:#e34c26}.ext-css{background:#563d7c}.ext-json{background:#9cdcfe}.ext-md{background:#79b8ff}.ext-txt,.ext-default{background:var(--text3)}
.ex-footer{padding:10px 12px;border-top:1px solid var(--border);flex-shrink:0}
.storage-bar{height:3px;background:var(--bg4);border-radius:2px;overflow:hidden;margin-top:5px}
.storage-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:2px;width:38%}
.storage-label{font-size:10px;color:var(--text3);display:flex;justify-content:space-between}

/* EDITOR */
#panel-editor{background:var(--bg0)}
#tab-bar{height:var(--tab-h);background:var(--bg1);border-bottom:1px solid var(--border);display:flex;align-items:flex-end;overflow-x:auto;flex-shrink:0;padding:0 0 0 4px}
#tab-bar::-webkit-scrollbar{height:0}
.etab{display:flex;align-items:center;gap:5px;padding:0 10px 0 8px;height:30px;font-size:11px;font-family:var(--font-mono);color:var(--text3);cursor:pointer;white-space:nowrap;border-radius:5px 5px 0 0;border:1px solid transparent;border-bottom:none;flex-shrink:0;background:transparent}
.etab.active{color:var(--text1);background:var(--bg0);border-color:var(--border)}
.etab .close-tab{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:12px;color:var(--text2);opacity:0;flex-shrink:0;margin-left:2px;transition:opacity .15s,background .15s}
.etab.active .close-tab{opacity:0}
.etab.active .close-tab.visible{opacity:.8;background:rgba(248,113,113,.15);color:var(--red)}
.etab.active .close-tab:active{background:rgba(248,113,113,.3)}
.etab .unsaved-dot{width:5px;height:5px;border-radius:50%;background:var(--warn)}
#editor-toolbar{height:40px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:2px;padding:0 8px;flex-shrink:0;overflow-x:auto}
#editor-toolbar::-webkit-scrollbar{height:0}
.etool{height:30px;padding:0 9px;border-radius:6px;font-size:11px;color:var(--text2);border:1px solid transparent;background:none;cursor:pointer;white-space:nowrap;font-family:var(--font-mono);flex-shrink:0;-webkit-tap-highlight-color:transparent}
.etool:active{background:var(--bg3);color:var(--text1)}
.etool.icon{padding:0;width:30px;text-align:center;font-size:15px}
.etool-sep{width:1px;height:18px;background:var(--border);margin:0 3px;flex-shrink:0}

/* EDITOR CORE */
#editor-wrap{flex:1;display:flex;overflow:hidden;position:relative;min-height:0}
#line-numbers{flex-shrink:0;width:var(--ln-w);background:var(--bg0);border-right:1px solid var(--border);overflow-y:hidden;overflow-x:hidden;user-select:none;padding:14px 0}
.ln-row{display:flex;align-items:center;justify-content:flex-end;padding:0 8px 0 4px;height:calc(var(--editor-fs) * 1.65);font-family:var(--font-mono);font-size:calc(var(--editor-fs) - 1px);line-height:1;color:var(--text3);cursor:pointer;transition:color .1s,background .1s;position:relative}
.ln-row:hover{color:var(--text1);background:rgba(91,143,255,.06)}
.ln-row.highlighted{background:rgba(245,158,11,.12);color:var(--warn)}
.ln-row.search-match{background:rgba(52,211,153,.12);color:var(--accent3)}
#editor-inner{flex:1;position:relative;overflow:hidden}
#code-editor{position:absolute;inset:0;margin:0;padding:14px 16px;font-family:var(--font-mono)!important;font-size:var(--editor-fs)!important;line-height:1.65!important;tab-size:2;white-space:pre;word-wrap:normal;overflow:auto;border:none;outline:none;resize:none;background:transparent;color:transparent;caret-color:var(--accent);z-index:2;-webkit-text-fill-color:transparent;-webkit-overflow-scrolling:touch;spellcheck:false}
#code-editor::-webkit-scrollbar{width:3px;height:3px}
#code-editor::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:3px}
#highlight-pre{position:absolute;inset:0;margin:0;padding:14px 16px;font-family:var(--font-mono)!important;font-size:var(--editor-fs)!important;line-height:1.65!important;tab-size:2;white-space:pre;word-wrap:normal;overflow:hidden;background:var(--bg0);color:var(--text1);z-index:1;pointer-events:none;border:0}
#highlight-pre code{font-family:var(--font-mono)!important;font-size:var(--editor-fs)!important;line-height:1.65!important;background:none!important;padding:0!important;text-shadow:none}

#search-bar{position:absolute;top:6px;right:10px;z-index:50;background:var(--bg2);border:1px solid var(--border-glow);border-radius:10px;padding:8px 10px;display:none;align-items:center;gap:6px;box-shadow:0 4px 24px rgba(0,0,0,.5)}
#search-bar.open{display:flex}
#search-input{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-family:var(--font-mono);font-size:12px;color:var(--text1);outline:none;width:160px}
#search-input:focus{border-color:var(--accent)}
.search-info{font-size:10px;color:var(--text3);font-family:var(--font-mono);white-space:nowrap}
.search-btn{width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.search-btn:active{background:var(--bg4);color:var(--text1)}
#ai-bar{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--accent),var(--accent2),var(--accent3),var(--accent));background-size:300% 100%;animation:shimmer 1.5s infinite;display:none}
#ai-bar.active{display:block}
@keyframes shimmer{0%{background-position:100%}100%{background-position:-100%}}

/* STATUS BAR */
#statusbar{height:24px;background:var(--bg1);border-top:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;padding:0 12px;gap:12px;font-size:10px;font-family:var(--font-mono);color:var(--text3);user-select:none;overflow:hidden}
.sb-item{display:flex;align-items:center;gap:4px;white-space:nowrap}
.sb-item .dot{width:6px;height:6px;border-radius:50%}

/* ERROR BAR */
#error-bar{background:rgba(248,113,113,.1);border-top:1px solid rgba(248,113,113,.3);padding:8px 14px;font-family:var(--font-mono);font-size:11px;color:var(--red);flex-shrink:0;display:none;align-items:center;gap:8px;max-height:60px;overflow-y:auto}
#error-bar.show{display:flex}
.error-close{cursor:pointer;color:var(--red);font-size:16px;flex-shrink:0}

/* PREVIEW */
#panel-preview{background:var(--bg0);display:flex;flex-direction:column}
#preview-toolbar{height:40px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 12px;gap:8px;flex-shrink:0}
#preview-frame{flex:1;border:none;background:#fff}

/* ═══════════════════════════════════
   CHAT — Claude-style bubble layout
   ═══════════════════════════════════ */
#panel-chat{background:var(--bg0);display:flex;flex-direction:column}

#chat-header{height:50px;display:flex;align-items:center;padding:0 14px;gap:10px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg1);justify-content:space-between}
.chat-title-group{display:flex;align-items:center;gap:10px}
.ai-badge{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:linear-gradient(135deg,rgba(91,143,255,.18),rgba(167,139,250,.18));border:1px solid rgba(91,143,255,.3);font-size:11px;font-weight:700;color:var(--accent);letter-spacing:.04em}
.ai-pulse{width:7px;height:7px;border-radius:50%;background:var(--accent3);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
.model-selector{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text3);cursor:pointer;padding:5px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);-webkit-tap-highlight-color:transparent}
.model-selector:active{background:var(--bg3)}

/* Messages scroll area */
#messages{flex:1;overflow-y:auto;padding:14px 14px 8px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}
#messages::-webkit-scrollbar{width:3px}
#messages::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:2px}

/* Bubble groups */
.msg-group{display:flex;flex-direction:column;gap:3px;animation:fadeUp .2s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* User messages — right aligned */
.msg-group.user{align-items:flex-end}
.msg-group.user .bubble{background:var(--accent);color:#fff;border-radius:18px 18px 4px 18px;padding:10px 14px;max-width:82%;font-size:13px;line-height:1.5;word-break:break-word}
.msg-group.user .msg-meta{font-size:10px;color:var(--text3);padding-right:4px}

/* AI messages — left aligned */
.msg-group.ai{align-items:flex-start}
.msg-group.ai .ai-row{display:flex;align-items:flex-start;gap:8px;max-width:92%}
.msg-group.ai .ai-avatar{width:28px;height:28px;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,var(--accent3),#06b6d4);display:flex;align-items:center;justify-content:center;font-size:12px;margin-top:1px}
.msg-group.ai .bubble{background:var(--bg2);color:var(--text1);border:1px solid var(--border);border-radius:4px 18px 18px 18px;padding:10px 14px;font-size:13px;line-height:1.6;word-break:break-word}
.msg-group.ai .bubble code{background:var(--bg3);padding:1px 5px;border-radius:4px;color:var(--accent);font-size:11px;font-family:var(--font-mono)}
.msg-group.ai .msg-meta{font-size:10px;color:var(--text3);padding-left:36px;margin-top:2px}

/* Date separator */
.date-sep{display:flex;align-items:center;gap:10px;margin:8px 0}
.date-sep span{font-size:10px;color:var(--text3);white-space:nowrap}
.date-sep::before,.date-sep::after{content:'';flex:1;height:1px;background:var(--border)}

/* Thinking bubbles */
.thinking-row{display:flex;align-items:flex-start;gap:8px}
.thinking-avatar{width:28px;height:28px;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,var(--accent3),#06b6d4);display:flex;align-items:center;justify-content:center;font-size:12px}
.thinking-bubble{background:var(--bg2);border:1px solid var(--border);border-radius:4px 18px 18px 18px;padding:12px 16px;display:flex;gap:5px;align-items:center}
.thinking span{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:bounce 1.2s infinite}
.thinking span:nth-child(2){animation-delay:.2s;background:var(--accent2)}
.thinking span:nth-child(3){animation-delay:.4s;background:var(--accent3)}
@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}

/* Diff cards inside AI bubbles */
.diff-card{background:var(--bg3);border:1px solid var(--border-glow);border-radius:10px;overflow:hidden;margin-top:8px}
.diff-header{padding:8px 12px;display:flex;align-items:center;gap:8px;background:rgba(91,143,255,.08);border-bottom:1px solid var(--border);font-size:10.5px;font-weight:600}
.diff-file{font-family:var(--font-mono);color:var(--text2)}
.diff-badge{padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700}
.diff-badge.add{background:rgba(52,211,153,.15);color:var(--accent3)}
.diff-badge.mod{background:rgba(245,158,11,.12);color:var(--warn)}
.diff-body{padding:8px 12px;max-height:160px;overflow-y:auto}
.diff-body::-webkit-scrollbar{width:3px}
.diff-body::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:2px}
.diff-line{font-family:var(--font-mono);font-size:11px;line-height:1.7;display:flex;gap:8px}
.diff-line.plus{color:var(--accent3)}.diff-line.minus{color:var(--red)}.diff-line.ctx{color:var(--text3)}
.diff-actions{padding:10px 12px;display:flex;gap:8px;border-top:1px solid var(--border)}
.diff-btn{flex:1;height:38px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid;display:flex;align-items:center;justify-content:center;gap:5px;-webkit-tap-highlight-color:transparent}
.diff-btn.apply{background:rgba(52,211,153,.15);color:var(--accent3);border-color:rgba(52,211,153,.35)}
.diff-btn.apply:active{background:rgba(52,211,153,.28)}
.diff-btn.reject{background:rgba(248,113,113,.1);color:var(--red);border-color:rgba(248,113,113,.3)}
.diff-btn.reject:active{background:rgba(248,113,113,.2)}

/* Chat input */
#chat-input-row{padding:10px 12px;display:flex;gap:10px;align-items:flex-end;border-top:1px solid var(--border);flex-shrink:0;padding-bottom:max(10px,env(safe-area-inset-bottom));background:var(--bg1)}
#chat-input{flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:11px 16px;font-family:var(--font-mono);font-size:13px;color:var(--text1);outline:none;resize:none;min-height:44px;max-height:130px;line-height:1.5;-webkit-appearance:none}
#chat-input::placeholder{color:var(--text3)}
#chat-input:focus{border-color:var(--accent)}
#send-btn{width:44px;height:44px;border-radius:50%;background:var(--accent);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;font-size:17px;flex-shrink:0;-webkit-tap-highlight-color:transparent;transition:transform .1s}
#send-btn:active{transform:scale(.93)}
#send-btn.loading{background:var(--bg3);cursor:not-allowed}

/* MODALS */
.ctx-menu{position:fixed;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:6px;min-width:170px;z-index:1000;box-shadow:0 8px 32px rgba(0,0,0,.6);animation:fadeUp .12s ease}
.ctx-item{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;font-size:13px;color:var(--text2);border-radius:8px;-webkit-tap-highlight-color:transparent}
.ctx-item:active{background:var(--bg3);color:var(--text1)}
.ctx-item.danger{color:var(--red)}
.ctx-item.danger:active{background:rgba(248,113,113,.12)}
.ctx-sep{height:1px;background:var(--border);margin:4px 0}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:500;display:flex;align-items:flex-end;justify-content:center;animation:fadeIn .15s}
@media(min-width:480px){.modal-overlay{align-items:center}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:18px 18px 0 0;padding:22px;width:100%;animation:slideUp .2s ease;padding-bottom:max(22px,env(safe-area-inset-bottom))}
@media(min-width:480px){.modal{border-radius:14px;width:auto;min-width:340px}}
@keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}
.modal h3{font-size:16px;font-weight:700;color:var(--text1);margin-bottom:14px}
.modal input,.modal select{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-family:var(--font-mono);font-size:14px;color:var(--text1);outline:none;-webkit-appearance:none;margin-bottom:8px}
.modal input:focus,.modal select:focus{border-color:var(--accent)}
.modal select option{background:var(--bg3)}
.modal-actions{display:flex;gap:10px;margin-top:14px}
.modal-actions .hbtn{flex:1;justify-content:center;height:44px;font-size:13px;border-radius:10px}
#toast-container{position:fixed;bottom:calc(var(--bottom-nav-h) + 12px);right:14px;display:flex;flex-direction:column;gap:7px;z-index:2000}
.toast{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:11px 16px;font-size:12px;color:var(--text1);display:flex;align-items:center;gap:8px;animation:slideIn .2s ease;box-shadow:0 4px 24px rgba(0,0,0,.5);max-width:270px}
@keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.toast.success .toast-icon{color:var(--accent3)}
.toast.error .toast-icon{color:var(--red)}
.toast.info .toast-icon{color:var(--accent)}

/* DESKTOP */
@media(min-width:768px){
  #bottom-nav{display:none}
  #layout{bottom:0}
  .panel{position:relative;display:flex!important}
  #panel-explorer{width:var(--explorer-w);flex-shrink:0;border-right:1px solid var(--border)}
  #panel-editor{flex:1;min-width:0}
  #panel-preview{position:absolute;top:0;right:0;bottom:var(--chat-h);width:45%;border-left:1px solid var(--border);z-index:5;display:none!important}
  #panel-preview.desktop-visible{display:flex!important}
  #panel-editor.split{padding-right:45%}
  #panel-chat{position:absolute;bottom:0;left:var(--explorer-w);right:0;height:var(--chat-h);border-top:1px solid var(--border);z-index:10}
  #panel-editor{padding-bottom:var(--chat-h)}
  #resize-handle{position:absolute;top:calc(100% - var(--chat-h) - 2px);left:var(--explorer-w);right:0;height:4px;cursor:ns-resize;background:transparent;z-index:11}
  #resize-handle:hover{background:var(--accent)}
  #toast-container{bottom:calc(var(--chat-h) + 12px)}
}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:3px}
</style>
</head>
<body>

<div id="header">
  <div class="logo">
    <div class="logo-icon">⚡</div>
    <div class="logo-text">AXI<span>OM</span></div>
  </div>
  <div class="header-file-tabs" id="header-file-tabs"></div>
  <div class="header-actions">
    <button class="hbtn hide-xs" id="btn-new-file">＋</button>
    <button class="hbtn hide-xs" id="btn-save">💾</button>
    <button class="hbtn hide-xs" id="btn-share">🔗</button>
    <button class="hbtn hide-xs" id="btn-github">↑ Git</button>
    <button class="hbtn hide-xs" id="btn-export">📦</button>
    <button class="hbtn hide-xs" id="btn-preview-toggle">👁 Preview</button>
    <button class="hbtn primary" id="btn-run">▶</button>
    <button class="hbtn icon-only" id="btn-settings">⚙</button>
  </div>
</div>

<div id="layout">
  <!-- EXPLORER -->
  <div id="panel-explorer" class="panel">
    <div class="ex-toolbar">
      <span class="ex-title">Explorer</span>
      <div class="ex-actions">
        <button class="icon-btn" id="ex-new-file" title="New file">+</button>
        <button class="icon-btn" id="ex-new-folder" title="New folder">📁</button>
        <button class="icon-btn" id="ex-refresh" title="Refresh">↺</button>
      </div>
    </div>
    <div id="file-tree"></div>
    <div class="ex-footer">
      <div class="storage-label"><span>Storage</span><span id="storage-pct">0%</span></div>
      <div class="storage-bar"><div class="storage-fill" id="storage-fill"></div></div>
    </div>
  </div>

  <!-- EDITOR -->
  <div id="panel-editor" class="panel active">
    <div id="tab-bar"></div>
    <div id="editor-toolbar">
      <button class="etool icon" id="btn-search" title="Search">🔍</button>
      <div class="etool-sep"></div>
      <button class="etool" onclick="insertSnippet('  ')">TAB</button>
      <button class="etool" onclick="insertSnippet('{  }')">{ }</button>
      <button class="etool" onclick="insertSnippet('(  )')">( )</button>
      <button class="etool" onclick="insertSnippet('[  ]')">[ ]</button>
      <button class="etool" onclick="insertSnippet('&quot;&quot;')">""</button>
      <button class="etool" onclick="insertSnippet(&quot;''&quot;)">''</button>
      <div class="etool-sep"></div>
      <button class="etool icon" id="btn-fs-down">A-</button>
      <button class="etool icon" id="btn-fs-up">A+</button>
      <div class="etool-sep"></div>
      <button class="etool" id="btn-undo">↩</button>
      <button class="etool" id="btn-redo">↪</button>
      <div class="etool-sep"></div>
      <button class="etool" id="btn-theme">🎨</button>
      <button class="etool" id="btn-diff">Δ diff</button>
    </div>
    <div id="editor-wrap">
      <div id="line-numbers"></div>
      <div id="editor-inner">
        <pre id="highlight-pre" aria-hidden="true"><code id="highlight-code"></code></pre>
        <textarea id="code-editor" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" data-gramm="false"></textarea>
      </div>
      <div id="search-bar">
        <input type="text" id="search-input" placeholder="Search…" autocorrect="off" autocapitalize="off"/>
        <span class="search-info" id="search-count">0/0</span>
        <button class="search-btn" id="search-prev">↑</button>
        <button class="search-btn" id="search-next">↓</button>
        <button class="search-btn" id="search-close">✕</button>
      </div>
      <div id="ai-bar"></div>
    </div>
    <div id="error-bar">
      <span id="error-text"></span>
      <span class="error-close" id="error-close">✕</span>
    </div>
    <div id="statusbar">
      <div class="sb-item"><div class="dot" style="background:var(--accent3)"></div><span id="sb-file">index.js</span></div>
      <div class="sb-item"><span id="sb-lang">JavaScript</span></div>
      <div class="sb-item"><span id="sb-lines">1</span>L</div>
      <div class="sb-item"><span id="sb-cursor">1:1</span></div>
      <div class="sb-item" style="margin-left:auto"><span id="sb-model">No provider</span></div>
    </div>
  </div>

  <!-- PREVIEW -->
  <div id="panel-preview" class="panel">
    <div id="preview-toolbar">
      <span style="font-size:11px;color:var(--text3);flex:1">Live Preview</span>
      <button class="icon-btn" id="btn-refresh-preview">↺</button>
      <button class="icon-btn" id="btn-open-preview" title="Open in new tab">↗</button>
    </div>
    <iframe id="preview-frame" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
  </div>

  <!-- CHAT — Claude-style -->
  <div id="panel-chat" class="panel">
    <div id="chat-header">
      <div class="chat-title-group">
        <div class="ai-badge"><div class="ai-pulse"></div> AI</div>
        <span style="font-size:10px;color:var(--text3)">reads active file</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="model-selector" id="model-selector">
          <span id="active-model-label">No provider</span> ▾
        </div>
        <button class="icon-btn" id="btn-clear-chat" title="Clear">🗑</button>
      </div>
    </div>
    <div id="messages"></div>
    <div id="chat-input-row">
      <textarea id="chat-input" rows="1" placeholder="Ask AI to edit code…"></textarea>
      <button id="send-btn">➤</button>
    </div>
  </div>

  <div id="resize-handle"></div>
</div>

<!-- BOTTOM NAV -->
<div id="bottom-nav">
  <button class="bnav-tab" id="bnav-explorer" data-panel="explorer">
    <span class="bnav-icon">📁</span><span>Files</span>
  </button>
  <button class="bnav-tab active" id="bnav-editor" data-panel="editor">
    <span class="bnav-icon">✏️</span><span>Editor</span>
  </button>
  <button class="bnav-tab" id="bnav-preview" data-panel="preview">
    <span class="bnav-icon">👁️</span><span>Preview</span>
  </button>
  <button class="bnav-tab" id="bnav-chat" data-panel="chat">
    <span class="bnav-icon">🤖</span><span>AI</span>
    <span class="bnav-badge" id="ai-unread-badge">0</span>
  </button>
</div>

<div id="toast-container"></div>

<script>
// ═══════════════════════════════════
// STATE
// ═══════════════════════════════════
const state = {
  files: {
    'src': {
      type:'folder', open:true,
      children:{
        'index.js':{type:'file',content:`// AXIOM AI Code Editor\n// Ask the AI below to modify this file\n\nconst express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(express.json());\n\napp.get('/', (req, res) => {\n  res.json({ message: 'Hello World!', status: 'ok' });\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server running on port \${PORT}\`);\n});`,lang:'js'},
        'auth.js':{type:'file',content:`// Authentication module\n\nmodule.exports = {};`,lang:'js'},
        'utils.js':{type:'file',content:`// Utility functions\n\nconst formatDate = (date) => {\n  return new Date(date).toLocaleDateString('en-US', {\n    year: 'numeric', month: 'long', day: 'numeric'\n  });\n};\n\nconst slugify = (str) =>\n  str.toLowerCase().replace(/\\s+/g, '-').replace(/[^\\w-]/g, '');\n\nmodule.exports = { formatDate, slugify };`,lang:'js'},
      }
    },
    'public':{
      type:'folder', open:false,
      children:{
        'index.html':{type:'file',content:`<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <title>My App</title>\n  <link rel="stylesheet" href="style.css" />\n</head>\n<body>\n  <h1>Hello World</h1>\n  <p>Welcome to my app!</p>\n  <script src="app.js"><\\/script>\n</body>\n</html>`,lang:'html'},
        'style.css':{type:'file',content:`* { margin: 0; padding: 0; box-sizing: border-box; }\nbody {\n  font-family: system-ui, sans-serif;\n  background: #f5f5f5;\n  color: #333;\n  padding: 2rem;\n}\nh1 { font-size: 2rem; margin-bottom: 1rem; }`,lang:'css'},
      }
    },
    'package.json':{type:'file',content:`{\n  "name": "my-project",\n  "version": "1.0.0",\n  "main": "src/index.js",\n  "scripts": {\n    "start": "node src/index.js",\n    "dev": "nodemon src/index.js"\n  },\n  "dependencies": {\n    "express": "^4.18.2"\n  }\n}`,lang:'json'},
    'README.md':{type:'file',content:`# My Project\n\nBuilt with **AXIOM AI Code Editor**.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\``,lang:'md'},
  },
  activeFile: 'src/index.js',
  openTabs: ['src/index.js','src/auth.js','public/index.html'],
  unsaved: new Set(),
  chatHistory: [],          // API messages (role/content)
  chatMessages: [],         // Persisted display messages
  providers: [],
  activeProviderId: null,
  activePanel: 'editor',
  aiUnread: 0,
  editorFontSize: 13,
  highlightedLines: new Set(),
  searchMatches: [],
  searchCurrent: 0,
  githubSettings: { token:'', repo:'', branch:'main' },
  theme: 'dark',
  originalContents: {},
};

const THEMES = {
  dark:{ '--bg0':'#0a0b0e','--bg1':'#0f1117','--bg2':'#141720','--bg3':'#1a1e2e','--bg4':'#1f2437','--border':'#252b3d','--border-glow':'#2e3650','--text1':'#e8eaf0','--text2':'#9ba3bc','--text3':'#5a6282','--accent':'#5b8fff','--accent2':'#a78bfa','--accent3':'#34d399' },
  'github-dark':{ '--bg0':'#0d1117','--bg1':'#161b22','--bg2':'#1c2128','--bg3':'#22272e','--bg4':'#2d333b','--border':'#30363d','--border-glow':'#3d444d','--text1':'#e6edf3','--text2':'#7d8590','--text3':'#484f58','--accent':'#388bfd','--accent2':'#a371f7','--accent3':'#3fb950' },
  dracula:{ '--bg0':'#1e1f29','--bg1':'#282a36','--bg2':'#2d303e','--bg3':'#343746','--bg4':'#3a3d4e','--border':'#44475a','--border-glow':'#6272a4','--text1':'#f8f8f2','--text2':'#bd93f9','--text3':'#6272a4','--accent':'#bd93f9','--accent2':'#ff79c6','--accent3':'#50fa7b' },
  light:{ '--bg0':'#ffffff','--bg1':'#f6f8fa','--bg2':'#eaeef2','--bg3':'#d0d7de','--bg4':'#c6cdd5','--border':'#d0d7de','--border-glow':'#b1bac4','--text1':'#24292f','--text2':'#57606a','--text3':'#8c959f','--accent':'#0969da','--accent2':'#8250df','--accent3':'#1a7f37' },
};

// NVIDIA models — full list (browser uses corsproxy.io to bypass CORS)
const NVIDIA_MODELS = [
  // ── DeepSeek V4 (newest) ──
  'deepseek-ai/deepseek-v4-pro',
  'deepseek-ai/deepseek-v4-flash',
  // ── DeepSeek V3 ──
  'deepseek-ai/deepseek-v3',
  'deepseek-ai/deepseek-v3_2',
  // ── DeepSeek R1 (reasoning) ──
  'deepseek-ai/deepseek-r1',
  'deepseek-ai/deepseek-r1-0528',
  'deepseek-ai/deepseek-r1-distill-llama-70b',
  'deepseek-ai/deepseek-r1-distill-qwen-7b',
  // ── Meta Llama ──
  'meta/llama-4-maverick-17b-128e-instruct',
  'meta/llama-4-scout-17b-16e-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-405b-instruct',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  // ── Mistral ──
  'mistralai/mistral-large-2-instruct',
  'mistralai/mixtral-8x7b-instruct-v0.1',
  'mistralai/mistral-nemo-12b-instruct',
  // ── Google ──
  'google/gemma-3-27b-it',
  'google/gemma-3-12b-it',
  'google/gemma-3n-e4b-it',
  // ── Microsoft ──
  'microsoft/phi-4',
  'microsoft/phi-3.5-mini-instruct',
  // ── Qwen ──
  'qwen/qwen2.5-72b-instruct',
  'qwen/qwen2.5-coder-32b-instruct',
  'qwen/qwq-32b',
  // ── NVIDIA Nemotron ──
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/llama-3.1-nemotron-nano-8b-v1',
  // ── IBM ──
  'ibm/granite-3.3-8b-instruct',
  'ibm/granite-3.1-8b-instruct',
  // ── Other ──
  'moonshotai/kimi-k2-instruct',
];

const PROVIDER_PRESETS = [
  { name:'Pollinations AI (Free)', format:'openai', baseUrl:'https://text.pollinations.ai/openai', defaultModel:'openai', noKey:true },
  { name:'Ollama (Local)', format:'openai', baseUrl:'http://localhost:11434/v1/chat/completions', defaultModel:'llama3.2', noKey:true },
  { name:'OpenAI', format:'openai', baseUrl:'https://api.openai.com/v1/chat/completions', defaultModel:'gpt-4o' },
  { name:'Anthropic', format:'anthropic', baseUrl:'https://api.anthropic.com/v1/messages', defaultModel:'claude-sonnet-4-20250514' },
  { name:'Google Gemini', format:'gemini', baseUrl:'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', defaultModel:'gemini-1.5-pro' },
  { name:'OpenRouter', format:'openai', baseUrl:'https://openrouter.ai/api/v1/chat/completions', defaultModel:'openai/gpt-4o' },
  { name:'Groq', format:'openai', baseUrl:'https://api.groq.com/openai/v1/chat/completions', defaultModel:'llama-3.1-70b-versatile' },
  // NVIDIA NIM — browser CORS ስለሚከለክል Cloudflare Worker proxy ያስፈልጋል
  // Worker deploy: https://workers.cloudflare.com (free 100k req/day)
  { name:'NVIDIA NIM', format:'nvidia', baseUrl:'', defaultModel:'deepseek-ai/deepseek-v4-pro' },
  { name:'DeepSeek (Official)', format:'openai', baseUrl:'https://api.deepseek.com/v1/chat/completions', defaultModel:'deepseek-chat' },
  { name:'Mistral', format:'openai', baseUrl:'https://api.mistral.ai/v1/chat/completions', defaultModel:'mistral-large-latest' },
  { name:'Custom URL', format:'openai', baseUrl:'', defaultModel:'' },
];

// ═══════════════════════════════════
// HELPERS
// ═══════════════════════════════════
function getFile(path) {
  const parts = path.split('/');
  let node = state.files;
  for (let i = 0; i < parts.length - 1; i++) {
    node = node[parts[i]]?.children;
    if (!node) return null;
  }
  return node[parts[parts.length - 1]] || null;
}
function setFileContent(path, content) {
  const f = getFile(path);
  if (f) { f.content = content; state.unsaved.add(path); }
}
function getAllFiles() {
  const result = [];
  function walk(obj, prefix='') {
    for (const [name, node] of Object.entries(obj)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (node.type==='file') result.push({ path, content:node.content, lang:node.lang });
      else if (node.type==='folder' && node.children) walk(node.children, path);
    }
  }
  walk(state.files); return result;
}
function extColor(lang) {
  return ({js:'ext-js',py:'ext-py',html:'ext-html',css:'ext-css',json:'ext-json',md:'ext-md'})[lang]||'ext-default';
}
function langLabel(lang) {
  return ({js:'JavaScript',py:'Python',html:'HTML',css:'CSS',json:'JSON',md:'Markdown'})[lang]||(lang?.toUpperCase()||'Text');
}
function prismLang(lang) {
  return ({js:'javascript',py:'python',html:'markup',css:'css',json:'json',md:'markdown'})[lang]||'javascript';
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, type='info') {
  const icons={success:'✓',error:'✕',info:'ℹ'};
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(),3000);
}
function showError(msg) {
  const bar=document.getElementById('error-bar');
  document.getElementById('error-text').textContent=msg;
  bar.classList.add('show');
}
function hideError() { document.getElementById('error-bar').classList.remove('show'); }
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}
function formatDateLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
  if (d.toDateString()===today.toDateString()) return 'Today';
  if (d.toDateString()===yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {month:'short',day:'numeric'});
}

// ═══════════════════════════════════
// THEME
// ═══════════════════════════════════
function applyTheme(name) {
  state.theme = name;
  const vars = THEMES[name];
  if (!vars) return;
  const root = document.documentElement;
  for (const [k,v] of Object.entries(vars)) root.style.setProperty(k, v);
  try { localStorage.setItem('axiom-theme', name); } catch(e){}
}
function cycleTheme() {
  const keys = Object.keys(THEMES);
  const idx = keys.indexOf(state.theme);
  applyTheme(keys[(idx+1)%keys.length]);
  toast(`Theme: ${state.theme}`, 'info');
}
document.getElementById('btn-theme').addEventListener('click', cycleTheme);

// ═══════════════════════════════════
// PANEL SWITCHING
// ═══════════════════════════════════
function switchPanel(name) {
  state.activePanel = name;
  ['explorer','editor','preview','chat'].forEach(p=>{
    const el=document.getElementById(`panel-${p}`);
    if(el){ el.classList.remove('active'); el.style.display='none'; }
  });
  const target=document.getElementById(`panel-${name}`);
  if(target){ target.style.display='flex'; target.classList.add('active'); }
  document.querySelectorAll('.bnav-tab').forEach(b=>b.classList.remove('active'));
  const bnavEl=document.getElementById(`bnav-${name}`);
  if(bnavEl) bnavEl.classList.add('active');
  if(name==='chat'){
    state.aiUnread=0;
    document.getElementById('ai-unread-badge').textContent='0';
    document.getElementById('ai-unread-badge').classList.remove('show');
    setTimeout(()=>{
      const msgs=document.getElementById('messages');
      msgs.scrollTop=msgs.scrollHeight;
    },50);
  }
  if(name==='preview') refreshPreview();
}
document.querySelectorAll('.bnav-tab').forEach(btn=>{
  btn.addEventListener('click',()=>switchPanel(btn.dataset.panel));
});
function incrementUnread() {
  if (state.activePanel!=='chat') {
    state.aiUnread++;
    const badge=document.getElementById('ai-unread-badge');
    badge.textContent=state.aiUnread;
    badge.classList.add('show');
  }
}

// ═══════════════════════════════════
// FILE TREE
// ═══════════════════════════════════
function renderTree() {
  const container = document.getElementById('file-tree');
  container.innerHTML='';
  function renderNode(obj, parentPath, parentEl) {
    for (const [name, node] of Object.entries(obj)) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (node.type==='folder') {
        const wrapper = document.createElement('div');
        const childrenId = `fc-${path.replace(/\//g,'-')}`;
        wrapper.innerHTML=`
          <div class="tree-folder ${node.open?'open':''}" data-path="${path}">
            <span class="caret">▶</span>
            <span>${node.open?'📂':'📁'}</span>
            <span>${escHtml(name)}</span>
          </div>
          <div class="tree-children ${node.open?'open':''}" id="${childrenId}"></div>`;
        parentEl.appendChild(wrapper);
        wrapper.querySelector('.tree-folder').addEventListener('click',()=>{node.open=!node.open;renderTree();});
        wrapper.querySelector('.tree-folder').addEventListener('contextmenu',e=>{e.preventDefault();showCtxMenu(e,path,'folder');});
        if (node.children) renderNode(node.children, path, wrapper.querySelector(`#${childrenId}`));
      } else {
        const fileEl = document.createElement('div');
        fileEl.className=`tree-file ${state.activeFile===path?'active':''}`;
        fileEl.innerHTML=`<div class="file-dot ${extColor(node.lang)}"></div><span>${escHtml(name)}</span>${state.unsaved.has(path)?'<span style="color:var(--warn);font-size:9px;margin-left:auto">●</span>':''}`;
        fileEl.addEventListener('click',()=>{openFile(path);switchPanel('editor');});
        fileEl.addEventListener('contextmenu',e=>{e.preventDefault();showCtxMenu(e,path,'file');});
        parentEl.appendChild(fileEl);
      }
    }
  }
  renderNode(state.files,'',container);
}

// ═══════════════════════════════════
// TABS
// ═══════════════════════════════════
function renderTabs() {
  const bar=document.getElementById('tab-bar');
  bar.innerHTML='';
  state.openTabs.forEach(path=>{
    const name=path.split('/').pop();
    const tab=document.createElement('div');
    tab.className=`etab ${state.activeFile===path?'active':''}`;
    tab.innerHTML=`${state.unsaved.has(path)?'<div class="unsaved-dot"></div>':''}<span>${escHtml(name)}</span><span class="close-tab" title="Hold tab to close">✕</span>`;
    // Click tab = open file
    tab.addEventListener('click',e=>{
      if(e.target.classList.contains('close-tab')) return;
      openFile(path);
    });
    // Long press on tab = reveal X button
    let holdTimer=null;
    tab.addEventListener('pointerdown',e=>{
      if(e.target.classList.contains('close-tab')) return;
      holdTimer=setTimeout(()=>{
        const btn=tab.querySelector('.close-tab');
        btn.classList.add('visible');
        // Auto-hide after 3s
        setTimeout(()=>btn.classList.remove('visible'),3000);
      }, 500);
    });
    tab.addEventListener('pointerup',()=>clearTimeout(holdTimer));
    tab.addEventListener('pointercancel',()=>clearTimeout(holdTimer));
    // X click = confirm close
    tab.querySelector('.close-tab').addEventListener('click',e=>{
      e.stopPropagation();
      if(state.unsaved.has(path)){
        if(!confirm(`"${path.split('/').pop()}" has unsaved changes. Close anyway?`)) return;
      }
      closeTab(path);
    });
    bar.appendChild(tab);
  });
  const hbar=document.getElementById('header-file-tabs');
  hbar.innerHTML='';
  state.openTabs.forEach(path=>{
    const name=path.split('/').pop();
    const tab=document.createElement('div');
    tab.className=`htab ${state.activeFile===path?'active':''}`;
    tab.innerHTML=`<div class="dot ${state.unsaved.has(path)?'unsaved':''}"></div><span>${escHtml(name)}</span>`;
    tab.addEventListener('click',()=>{openFile(path);switchPanel('editor');});
    hbar.appendChild(tab);
  });
}
function closeTab(path) {
  state.openTabs=state.openTabs.filter(p=>p!==path);
  if (state.activeFile===path) {
    state.activeFile=state.openTabs[state.openTabs.length-1]||null;
    if (state.activeFile) loadEditor(state.activeFile);
    else { document.getElementById('code-editor').value=''; updateHighlight(''); updateLineNumbers(0); }
  }
  renderTabs();
}

// ═══════════════════════════════════
// EDITOR
// ═══════════════════════════════════
const codeEditor = document.getElementById('code-editor');
const highlightCode = document.getElementById('highlight-code');
const lineNumbers = document.getElementById('line-numbers');

function openFile(path) {
  state.activeFile=path;
  if (!state.openTabs.includes(path)) state.openTabs.push(path);
  hideError();
  renderTabs(); renderTree(); loadEditor(path);
}
function loadEditor(path) {
  const f=getFile(path); if (!f) return;
  codeEditor.value = f.content;
  updateHighlight(f.content, f.lang);
  updateLineNumbers((f.content.match(/\n/g)||[]).length+1);
  document.getElementById('sb-file').textContent=path.split('/').pop();
  document.getElementById('sb-lang').textContent=langLabel(f.lang);
  document.getElementById('sb-lines').textContent=(f.content.match(/\n/g)||[]).length+1;
  document.getElementById('sb-cursor').textContent='1:1';
  if (!state.originalContents[path]) state.originalContents[path]=f.content;
}
function updateHighlight(text, lang) {
  const f = state.activeFile ? getFile(state.activeFile) : null;
  const l = lang || f?.lang || 'js';
  const grammar = Prism.languages[prismLang(l)];
  if (grammar) {
    highlightCode.innerHTML = Prism.highlight(text, grammar, prismLang(l));
  } else {
    highlightCode.textContent = text;
  }
  if (text.endsWith('\n')) highlightCode.innerHTML += '\n';
}
function updateLineNumbers(count) {
  let html='';
  for (let i=1;i<=count;i++) {
    const isHL=state.highlightedLines.has(i);
    html+=`<div class="ln-row${isHL?' highlighted':''}" data-line="${i}">${i}</div>`;
  }
  lineNumbers.innerHTML=html;
  lineNumbers.querySelectorAll('.ln-row').forEach(row=>{
    row.addEventListener('click',()=>{
      const ln=parseInt(row.dataset.line);
      if (state.highlightedLines.has(ln)) state.highlightedLines.delete(ln);
      else state.highlightedLines.add(ln);
      updateLineNumbers((codeEditor.value.match(/\n/g)||[]).length+1);
    });
  });
}
codeEditor.addEventListener('scroll',()=>{
  document.getElementById('highlight-pre').scrollTop=codeEditor.scrollTop;
  document.getElementById('highlight-pre').scrollLeft=codeEditor.scrollLeft;
  lineNumbers.scrollTop=codeEditor.scrollTop;
});

let autoSaveTimer=null;
codeEditor.addEventListener('input',()=>{
  if (!state.activeFile) return;
  const text=codeEditor.value;
  setFileContent(state.activeFile, text);
  const f=getFile(state.activeFile);
  updateHighlight(text, f?.lang);
  const lineCount=(text.match(/\n/g)||[]).length+1;
  updateLineNumbers(lineCount);
  document.getElementById('sb-lines').textContent=lineCount;
  renderTree(); renderTabs();
  clearTimeout(autoSaveTimer);
  autoSaveTimer=setTimeout(()=>autoSaveToIDB(),1500);
});
codeEditor.addEventListener('keydown',e=>{
  if (e.key==='Tab') {
    e.preventDefault();
    const s=codeEditor.selectionStart, end=codeEditor.selectionEnd;
    codeEditor.value=codeEditor.value.substring(0,s)+'  '+codeEditor.value.substring(end);
    codeEditor.selectionStart=codeEditor.selectionEnd=s+2;
    codeEditor.dispatchEvent(new Event('input'));
  }
  if (e.ctrlKey&&e.key==='s'){e.preventDefault();saveFile();}
  if (e.ctrlKey&&e.key==='f'){e.preventDefault();openSearch();}
  if (e.key==='>') {
    const f=getFile(state.activeFile);
    if (f?.lang==='html') setTimeout(autoCompleteHTML,0);
  }
  const pairs={'(':')','{':'}','[':']','"':'"',"'":"'",'`':'`'};
  if (pairs[e.key]) {
    const s=codeEditor.selectionStart, end=codeEditor.selectionEnd;
    if (s!==end) {
      e.preventDefault();
      const selected=codeEditor.value.substring(s,end);
      const newVal=codeEditor.value.substring(0,s)+e.key+selected+pairs[e.key]+codeEditor.value.substring(end);
      codeEditor.value=newVal;
      codeEditor.selectionStart=s+1;codeEditor.selectionEnd=end+1;
      codeEditor.dispatchEvent(new Event('input'));
    }
  }
});
codeEditor.addEventListener('keyup',updateCursor);
codeEditor.addEventListener('click',updateCursor);
function updateCursor() {
  const pos=codeEditor.selectionStart;
  const before=codeEditor.value.substring(0,pos);
  const lines=before.split('\n');
  document.getElementById('sb-cursor').textContent=`${lines.length}:${lines[lines.length-1].length+1}`;
}
function autoCompleteHTML() {
  const pos=codeEditor.selectionStart;
  const before=codeEditor.value.substring(0,pos);
  const match=before.match(/<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>\s*$/);
  if (!match) return;
  const tag=match[1].toLowerCase();
  const void_tags=['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'];
  if (void_tags.includes(tag)) return;
  const close=`</${tag}>`;
  const after=codeEditor.value.substring(pos);
  if (after.startsWith(close)) return;
  codeEditor.value=codeEditor.value.substring(0,pos)+close+after;
  codeEditor.selectionStart=codeEditor.selectionEnd=pos;
  codeEditor.dispatchEvent(new Event('input'));
}
function insertSnippet(text) {
  codeEditor.focus();
  const s=codeEditor.selectionStart, end=codeEditor.selectionEnd;
  codeEditor.value=codeEditor.value.substring(0,s)+text+codeEditor.value.substring(end);
  const pairs=['{}','()','[]','""',"''",'``'];
  const inner=pairs.find(p=>text.includes(p[0])&&text.includes(p[1]));
  if(inner){const mid=codeEditor.value.indexOf(inner[0],s)+1;codeEditor.selectionStart=codeEditor.selectionEnd=mid;}
  else{codeEditor.selectionStart=codeEditor.selectionEnd=s+text.length;}
  codeEditor.dispatchEvent(new Event('input'));
}
document.getElementById('btn-fs-up').addEventListener('click',()=>{
  state.editorFontSize=Math.min(22,state.editorFontSize+1);
  document.documentElement.style.setProperty('--editor-fs',state.editorFontSize+'px');
  const f=getFile(state.activeFile);if(f)updateHighlight(codeEditor.value,f.lang);
});
document.getElementById('btn-fs-down').addEventListener('click',()=>{
  state.editorFontSize=Math.max(9,state.editorFontSize-1);
  document.documentElement.style.setProperty('--editor-fs',state.editorFontSize+'px');
  const f=getFile(state.activeFile);if(f)updateHighlight(codeEditor.value,f.lang);
});
document.getElementById('btn-undo').addEventListener('click',()=>{codeEditor.focus();document.execCommand('undo');});
document.getElementById('btn-redo').addEventListener('click',()=>{codeEditor.focus();document.execCommand('redo');});
document.getElementById('error-close').addEventListener('click',hideError);

// ═══════════════════════════════════
// DIFF VIEW
// ═══════════════════════════════════
document.getElementById('btn-diff').addEventListener('click',()=>{
  if (!state.activeFile) return;
  const f=getFile(state.activeFile);
  const original=state.originalContents[state.activeFile]||'';
  const current=f?.content||'';
  if (original===current){toast('No changes since last save','info');return;}
  showDiffModal(original,current,state.activeFile);
});
function showDiffModal(oldText, newText, path) {
  const oldLines=oldText.split('\n'), newLines=newText.split('\n');
  let diffHTML='';
  const maxLen=Math.max(oldLines.length,newLines.length);
  let added=0,removed=0;
  for(let i=0;i<maxLen;i++){
    const o=oldLines[i],n=newLines[i];
    if(o===undefined){diffHTML+=`<div class="diff-line plus">+ ${escHtml(n)}</div>`;added++;}
    else if(n===undefined){diffHTML+=`<div class="diff-line minus">- ${escHtml(o)}</div>`;removed++;}
    else if(o!==n){diffHTML+=`<div class="diff-line minus">- ${escHtml(o)}</div><div class="diff-line plus">+ ${escHtml(n)}</div>`;added++;removed++;}
    else{diffHTML+=`<div class="diff-line ctx">  ${escHtml(o)}</div>`;}
  }
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:100%;max-height:80vh;overflow-y:auto">
    <h3>Δ Diff — ${escHtml(path.split('/').pop())}</h3>
    <div style="font-size:10px;color:var(--text3);margin-bottom:10px">+${added} added  -${removed} removed</div>
    <div style="font-family:var(--font-mono);font-size:11px;line-height:1.7;max-height:50vh;overflow-y:auto;background:var(--bg3);padding:10px;border-radius:8px">${diffHTML||'<span style="color:var(--text3)">No changes</span>'}</div>
    <div class="modal-actions"><button class="hbtn primary" id="diff-close" style="flex:1;justify-content:center;height:40px">Close</button></div>
  </div>`;
  overlay.querySelector('#diff-close').onclick=()=>overlay.remove();
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════
// SEARCH
// ═══════════════════════════════════
const searchBar=document.getElementById('search-bar');
const searchInput=document.getElementById('search-input');
function openSearch(){searchBar.classList.add('open');searchInput.focus();searchInput.select();}
function closeSearchBar(){
  searchBar.classList.remove('open');
  state.searchMatches=[];state.searchCurrent=0;
  document.getElementById('search-count').textContent='0/0';
}
document.getElementById('btn-search').addEventListener('click',openSearch);
document.getElementById('search-close').addEventListener('click',closeSearchBar);
searchInput.addEventListener('input',runSearch);
searchInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.shiftKey?prevMatch():nextMatch();}
  if(e.key==='Escape')closeSearchBar();
});
document.getElementById('search-prev').addEventListener('click',prevMatch);
document.getElementById('search-next').addEventListener('click',nextMatch);
function runSearch(){
  const query=searchInput.value;
  state.searchMatches=[];state.searchCurrent=0;
  if(!query){document.getElementById('search-count').textContent='0/0';return;}
  const text=codeEditor.value;
  const regex=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
  let m;
  while((m=regex.exec(text))!==null) state.searchMatches.push(m.index);
  document.getElementById('search-count').textContent=`${state.searchMatches.length>0?1:0}/${state.searchMatches.length}`;
  if(state.searchMatches.length)scrollToMatch(0);
}
function scrollToMatch(idx){
  if(!state.searchMatches.length)return;
  const pos=state.searchMatches[idx];
  codeEditor.setSelectionRange(pos,pos+searchInput.value.length);
  document.getElementById('search-count').textContent=`${idx+1}/${state.searchMatches.length}`;
  state.searchCurrent=idx;
}
function nextMatch(){if(!state.searchMatches.length)return;scrollToMatch((state.searchCurrent+1)%state.searchMatches.length);}
function prevMatch(){if(!state.searchMatches.length)return;scrollToMatch((state.searchCurrent-1+state.searchMatches.length)%state.searchMatches.length);}

// ═══════════════════════════════════
// SAVE
// ═══════════════════════════════════
function saveFile() {
  if (!state.activeFile) return;
  state.unsaved.delete(state.activeFile);
  state.originalContents[state.activeFile]=codeEditor.value;
  renderTree(); renderTabs();
  autoSaveToIDB();
  toast('💾 Saved','success');
}
document.getElementById('btn-save').addEventListener('click',saveFile);

// ═══════════════════════════════════
// INDEXEDDB — files + chat persistence
// ═══════════════════════════════════
function openDB(callback) {
  if (!window.indexedDB) return;
  const req = indexedDB.open('axiom-editor', 3);
  req.onupgradeneeded = e => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', {keyPath:'path'});
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath:'key'});
    if (!db.objectStoreNames.contains('chat')) db.createObjectStore('chat', {keyPath:'id', autoIncrement:true});
  };
  req.onsuccess = e => callback(e.target.result);
  req.onerror = () => {};
}
function autoSaveToIDB() {
  openDB(db => {
    const tx = db.transaction('files','readwrite');
    getAllFiles().forEach(f => tx.objectStore('files').put(f));
    updateStorageBar();
  });
}
function saveChatToIDB() {
  openDB(db => {
    const tx = db.transaction('chat','readwrite');
    const store = tx.objectStore('chat');
    // Clear and rewrite last 100 messages
    store.clear().onsuccess = () => {
      const toSave = state.chatMessages.slice(-100);
      toSave.forEach(msg => {
        // Don't store the DOM patchHTML — just text + metadata
        store.put({role:msg.role, text:msg.text, ts:msg.ts});
      });
    };
  });
}
function loadChatFromIDB(callback) {
  openDB(db => {
    const tx = db.transaction('chat','readonly');
    tx.objectStore('chat').getAll().onsuccess = e => {
      callback(e.target.result || []);
    };
  });
}
function loadFromIDB() {
  openDB(db => {
    const tx = db.transaction('files','readonly');
    tx.objectStore('files').getAll().onsuccess = ev => {
      const stored = ev.target.result;
      if (stored && stored.length) {
        stored.forEach(({path,content}) => {
          const f = getFile(path);
          if (f) { f.content = content; state.originalContents[path] = content; }
        });
        if (state.activeFile) loadEditor(state.activeFile);
        toast('📂 Restored from device','info');
      }
    };
  });
}

// ═══════════════════════════════════
// RUN
// ═══════════════════════════════════
document.getElementById('btn-run').addEventListener('click',runFile);
function runFile() {
  if (!state.activeFile) return;
  const f=getFile(state.activeFile);
  if (!f) return;
  hideError();
  if (f.lang==='json') {
    try { JSON.parse(f.content); toast('✓ Valid JSON','success'); }
    catch(e){ showError(`JSON Error: ${e.message}`); toast('JSON error','error'); }
    return;
  }
  if (f.lang==='js') {
    try { new Function(f.content); toast('✓ No syntax errors','success'); }
    catch(e){ showError(`JS Error: ${e.message}`); toast('Syntax error','error'); }
    return;
  }
  if (f.lang==='html') { switchPanel('preview'); refreshPreview(); return; }
  toast('▶ No runner for this file type','info');
}

// ═══════════════════════════════════
// PREVIEW
// ═══════════════════════════════════
document.getElementById('btn-refresh-preview').addEventListener('click',refreshPreview);
document.getElementById('btn-open-preview').addEventListener('click',()=>{
  const f=getFile(state.activeFile);
  if(!f||f.lang!=='html')return;
  const blob=new Blob([f.content],{type:'text/html'});
  window.open(URL.createObjectURL(blob),'_blank');
});
function refreshPreview() {
  const f=getFile(state.activeFile);
  const frame=document.getElementById('preview-frame');
  if (!f||f.lang!=='html') {
    const htmlFile=state.openTabs.map(p=>({p,f:getFile(p)})).find(x=>x.f?.lang==='html');
    if (htmlFile) { frame.srcdoc=htmlFile.f.content; return; }
    frame.srcdoc='<body style="font-family:sans-serif;padding:20px;color:#666"><p>Open an HTML file and press ▶ to preview</p></body>';
    return;
  }
  frame.srcdoc=f.content;
}

// ═══════════════════════════════════
// SHARE
// ═══════════════════════════════════
document.getElementById('btn-share').addEventListener('click',shareViaURL);
function shareViaURL() {
  try {
    const files=getAllFiles().map(f=>({p:f.path,c:f.content}));
    const compressed=LZString.compressToEncodedURIComponent(JSON.stringify(files));
    const url=window.location.href.split('#')[0]+'#v='+compressed;
    navigator.clipboard.writeText(url).then(()=>toast('🔗 Share URL copied!','success')).catch(()=>toast('Copy failed','error'));
  } catch(e){ toast('Share failed: '+e.message,'error'); }
}
function loadFromURL() {
  const hash=window.location.hash;
  if (!hash.startsWith('#v=')) return;
  try {
    const data=LZString.decompressFromEncodedURIComponent(hash.slice(3));
    const files=JSON.parse(data);
    files.forEach(({p,c})=>{const f=getFile(p);if(f){f.content=c;state.originalContents[p]=c;}});
    renderTree();renderTabs();
    if(state.activeFile)loadEditor(state.activeFile);
    toast('📂 Loaded from shared URL','success');
  } catch(e){ toast('Failed to load from URL','error'); }
}

// ═══════════════════════════════════
// GITHUB
// ═══════════════════════════════════
document.getElementById('btn-github').addEventListener('click',()=>{
  if (!state.githubSettings.token||!state.githubSettings.repo) showGitHubModal();
  else pushToGitHub();
});
function showGitHubModal() {
  const s=state.githubSettings;
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:100%">
    <h3>↑ GitHub Push</h3>
    <input type="password" id="gh-token" placeholder="ghp_xxxx..." value="${s.token}"/>
    <input type="text" id="gh-repo" placeholder="username/repo-name" value="${s.repo}"/>
    <input type="text" id="gh-branch" placeholder="main" value="${s.branch||'main'}"/>
    <div class="modal-actions">
      <button class="hbtn" id="gh-cancel">Cancel</button>
      <button class="hbtn primary" id="gh-push">↑ Push</button>
    </div>
  </div>`;
  overlay.querySelector('#gh-cancel').onclick=()=>overlay.remove();
  overlay.querySelector('#gh-push').onclick=()=>{
    state.githubSettings.token=overlay.querySelector('#gh-token').value.trim();
    state.githubSettings.repo=overlay.querySelector('#gh-repo').value.trim();
    state.githubSettings.branch=overlay.querySelector('#gh-branch').value.trim()||'main';
    try{localStorage.setItem('axiom-github',JSON.stringify(state.githubSettings));}catch(e){}
    overlay.remove(); pushToGitHub();
  };
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.body.appendChild(overlay);
}
async function pushToGitHub(selectedPaths=null) {
  const {token,repo,branch}=state.githubSettings;
  if (!token||!repo){showGitHubModal();return;}
  const allFiles=getAllFiles();
  const files=selectedPaths?allFiles.filter(f=>selectedPaths.includes(f.path)):allFiles;
  if(!files.length){toast('No files to push','error');return;}
  toast(`↑ Pushing ${files.length} file(s)…`,'info');
  let success=0,failed=0;
  for(const file of files){
    try{
      const content=btoa(unescape(encodeURIComponent(file.content)));
      const apiUrl=`https://api.github.com/repos/${repo}/contents/${file.path}`;
      const headers={'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'};
      let sha=null;
      try{const r=await fetch(apiUrl,{headers});if(r.ok){const d=await r.json();sha=d.sha;}}catch(e){}
      const res=await fetch(apiUrl,{method:'PUT',headers,body:JSON.stringify({message:`Update ${file.path} via AXIOM`,content,branch,...(sha?{sha}:{})})});
      if(res.ok)success++;else{const err=await res.json();console.warn(file.path,err);failed++;}
    }catch(e){failed++;}
  }
  if(failed===0)toast(`✓ Pushed ${success} file(s) to GitHub`,'success');
  else toast(`✓ ${success} pushed, ✕ ${failed} failed`,'error');
}

// ═══════════════════════════════════
// ZIP
// ═══════════════════════════════════
document.getElementById('btn-export').addEventListener('click',exportZIP);
async function exportZIP() {
  if(typeof JSZip==='undefined'){toast('JSZip not loaded','error');return;}
  const zip=new JSZip();
  getAllFiles().forEach(f=>zip.file(f.path,f.content));
  const blob=await zip.generateAsync({type:'blob'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='project.zip';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('📦 Downloaded project.zip','success');
}
async function importZIP(file) {
  if(typeof JSZip==='undefined'){toast('JSZip not loaded','error');return;}
  try{
    const zip=await JSZip.loadAsync(file);
    let count=0;
    const langMap={js:'js',py:'py',html:'html',css:'css',json:'json',md:'md',ts:'js',tsx:'js',jsx:'js',txt:'txt'};
    for(const [path,zipFile] of Object.entries(zip.files)){
      if(zipFile.dir)continue;
      const content=await zipFile.async('string');
      const parts=path.split('/');const name=parts.pop();
      const ext=name.split('.').pop().toLowerCase();
      const lang=langMap[ext]||'txt';
      let parent=state.files;
      for(const part of parts){if(!parent[part])parent[part]={type:'folder',open:true,children:{}};parent=parent[part].children;}
      parent[name]={type:'file',content,lang};count++;
    }
    renderTree();toast(`📦 Imported ${count} files`,'success');
    if(count>0){const first=getAllFiles()[0];if(first)openFile(first.path);}
    updateStorageBar();
  }catch(e){toast('Import failed: '+e.message,'error');}
}
const zipInput=document.createElement('input');
zipInput.type='file';zipInput.accept='.zip';zipInput.style.display='none';
zipInput.addEventListener('change',()=>{if(zipInput.files[0])importZIP(zipInput.files[0]);});
document.body.appendChild(zipInput);

// ═══════════════════════════════════
// FILE OPS
// ═══════════════════════════════════
function newFile(folderPath=null){
  showModal('New File','Filename:','e.g. server.js',name=>{
    if(!name)return;
    const ext=name.split('.').pop();
    const langMap={js:'js',py:'py',html:'html',css:'css',json:'json',md:'md',ts:'js',jsx:'js',tsx:'js',txt:'txt'};
    const lang=langMap[ext.toLowerCase()]||'txt';
    if(folderPath){const folder=getFile(folderPath);if(folder?.children)folder.children[name]={type:'file',content:'',lang};}
    else state.files[name]={type:'file',content:'',lang};
    const path=folderPath?`${folderPath}/${name}`:name;
    renderTree();openFile(path);switchPanel('editor');
  });
}
function deleteFile(path){
  const parts=path.split('/');const name=parts.pop();
  let parent=state.files;
  for(const p of parts){parent=parent[p]?.children||parent;}
  delete parent[name];
  state.openTabs=state.openTabs.filter(t=>t!==path);
  if(state.activeFile===path)state.activeFile=state.openTabs[0]||null;
  renderTree();renderTabs();
  if(state.activeFile)loadEditor(state.activeFile);
  else{codeEditor.value='';updateHighlight('');updateLineNumbers(0);}
  toast(`Deleted ${name}`,'success');
}
document.getElementById('ex-new-file').addEventListener('click',()=>newFile());
document.getElementById('btn-new-file').addEventListener('click',()=>newFile());
document.getElementById('ex-new-folder').addEventListener('click',()=>{
  showModal('New Folder','Folder name:','e.g. components',name=>{
    if(!name)return;
    state.files[name]={type:'folder',open:true,children:{}};renderTree();
  });
});
document.getElementById('ex-refresh').addEventListener('click',()=>{renderTree();toast('Refreshed','info');});

// ═══════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════
let ctxMenu=null;
function showCtxMenu(e,path,type){
  removeCtxMenu();
  const menu=document.createElement('div');menu.className='ctx-menu';
  const x=Math.min(e.clientX,window.innerWidth-185);
  const y=Math.min(e.clientY,window.innerHeight-200);
  menu.style.cssText=`left:${x}px;top:${y}px`;
  const items=type==='file'
    ?[{label:'📂 Open',action:()=>{openFile(path);switchPanel('editor');}},{label:'✏️ Rename',action:()=>toast('Rename: coming soon','info')},{sep:true},{label:'🗑 Delete',action:()=>deleteFile(path),danger:true}]
    :[{label:'📄 New File',action:()=>newFile(path)},{label:'📁 New Folder',action:()=>newFolderIn(path)}];
  items.forEach(item=>{
    if(item.sep){const s=document.createElement('div');s.className='ctx-sep';menu.appendChild(s);return;}
    const el=document.createElement('div');el.className=`ctx-item ${item.danger?'danger':''}`;
    el.textContent=item.label;
    el.addEventListener('click',()=>{item.action();removeCtxMenu();});
    menu.appendChild(el);
  });
  document.body.appendChild(menu);ctxMenu=menu;
}
function removeCtxMenu(){if(ctxMenu){ctxMenu.remove();ctxMenu=null;}}
document.addEventListener('click',removeCtxMenu);
function newFolderIn(parentPath){
  showModal('New Folder','Folder name:','e.g. components',name=>{
    if(!name)return;
    const parent=getFile(parentPath);
    if(parent?.children)parent.children[name]={type:'folder',open:true,children:{}};
    renderTree();
  });
}

// ═══════════════════════════════════
// MODAL
// ═══════════════════════════════════
function showModal(title,label,placeholder,callback){
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  const val=placeholder.startsWith('e.g')?'':placeholder;
  overlay.innerHTML=`<div class="modal">
    <h3>${escHtml(title)}</h3>
    <p style="font-size:11px;color:var(--text3);margin-bottom:10px">${escHtml(label)}</p>
    <input type="text" placeholder="${escHtml(placeholder)}" id="modal-input" value="${escHtml(val)}"/>
    <div class="modal-actions">
      <button class="hbtn" id="modal-cancel">Cancel</button>
      <button class="hbtn primary" id="modal-ok">OK</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const input=overlay.querySelector('#modal-input');
  setTimeout(()=>{input.focus();input.select();},50);
  const close=v=>{overlay.remove();if(v!==false)callback(v);};
  overlay.querySelector('#modal-cancel').onclick=()=>close(false);
  overlay.querySelector('#modal-ok').onclick=()=>close(input.value.trim());
  input.addEventListener('keydown',e=>{if(e.key==='Enter')close(input.value.trim());if(e.key==='Escape')close(false);});
  overlay.addEventListener('click',e=>{if(e.target===overlay)close(false);});
}

// ═══════════════════════════════════
// AI CHAT — Claude-style bubbles + persistence
// ═══════════════════════════════════

// Render all persisted messages from state.chatMessages
function renderChatHistory() {
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';
  let lastDate = '';
  state.chatMessages.forEach(msg => {
    const dateLabel = formatDateLabel(msg.ts);
    if (dateLabel !== lastDate) {
      lastDate = dateLabel;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.innerHTML = `<span>${dateLabel}</span>`;
      msgs.appendChild(sep);
    }
    appendBubble(msg.role, msg.text, msg.patchHTML || '', false);
  });
  msgs.scrollTop = msgs.scrollHeight;
}

// Append a single bubble to DOM (optionally animate)
function appendBubble(role, text, patchHTML='', animate=true) {
  const msgs = document.getElementById('messages');
  const group = document.createElement('div');
  group.className = `msg-group ${role}${animate?' ':' '}`;

  const ts = Date.now();
  const timeStr = formatTime(ts);

  if (role === 'user') {
    group.innerHTML = `
      <div class="bubble">${escHtml(text)}</div>
      <div class="msg-meta">${timeStr}</div>`;
  } else {
    group.innerHTML = `
      <div class="ai-row">
        <div class="ai-avatar">🤖</div>
        <div class="bubble">${text}${patchHTML}</div>
      </div>
      <div class="msg-meta">${timeStr}</div>`;
  }
  msgs.appendChild(group);
  msgs.scrollTop = msgs.scrollHeight;
  if (role === 'ai') incrementUnread();
  return group;
}

function addThinking() {
  const msgs = document.getElementById('messages');
  const wrap = document.createElement('div');
  wrap.className = 'thinking-row';
  wrap.innerHTML = `<div class="thinking-avatar">🤖</div><div class="thinking-bubble"><div class="thinking"><span></span><span></span><span></span></div></div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

// Patch engine
function parsePatchBlocks(text) {
  const patches=[];
  const re=/###\s*([^\n]+)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let m;
  while((m=re.exec(text))!==null) patches.push({file:m[1].trim(),search:m[2],replace:m[3]});
  return patches;
}
function applySurgicalPatch(filePath,searchText,replaceText){
  const allFiles=getAllFiles();
  const match=allFiles.find(f=>f.path===filePath||f.path.endsWith(filePath));
  if(!match)return{ok:false,err:`File not found: ${filePath}`};
  const f=getFile(match.path);if(!f)return{ok:false,err:`Cannot read: ${filePath}`};
  const norm=s=>s.replace(/\r\n/g,'\n');
  let content=norm(f.content);const search=norm(searchText);const replace=norm(replaceText);
  if(!content.includes(search)){
    const cLines=content.split('\n');const sLines=search.split('\n').map(l=>l.trimEnd());
    let foundAt=-1;
    outer:for(let i=0;i<=cLines.length-sLines.length;i++){
      for(let j=0;j<sLines.length;j++){if(cLines[i+j].trimEnd()!==sLines[j])continue outer;}
      foundAt=i;break;
    }
    if(foundAt===-1)return{ok:false,err:`SEARCH block not found in ${filePath}`};
    const before=cLines.slice(0,foundAt).join('\n');const after=cLines.slice(foundAt+sLines.length).join('\n');
    f.content=[before,replace,after].filter((s,i)=>i===1||s!=='').join('\n');
  } else { f.content=content.replace(search,replace); }
  state.unsaved.add(match.path);
  if(state.activeFile===match.path){codeEditor.value=f.content;updateHighlight(f.content,f.lang);updateLineNumbers((f.content.match(/\n/g)||[]).length+1);}
  renderTree();renderTabs();
  return{ok:true,path:match.path};
}
function renderPatchCard(patch,idx){
  const sLines=patch.search.split('\n').map(l=>`<div class="diff-line minus">- ${escHtml(l)}</div>`).join('');
  const rLines=patch.replace.split('\n').map(l=>`<div class="diff-line plus">+ ${escHtml(l)}</div>`).join('');
  const id=`patch-${idx}`;
  window._patches=window._patches||{};
  window._patches[id]={file:patch.file,search:patch.search,replace:patch.replace};
  return `<div class="diff-card" id="${id}">
    <div class="diff-header"><span class="diff-file">📄 ${escHtml(patch.file)}</span><span class="diff-badge mod">~ Patch</span></div>
    <div class="diff-body"><div style="font-size:10px;color:var(--text3);padding:2px 0 4px">REMOVE:</div>${sLines}<div style="font-size:10px;color:var(--text3);padding:6px 0 4px">ADD:</div>${rLines}</div>
    <div class="diff-actions">
      <button class="diff-btn apply" onclick="applyStoredPatch('${id}')">✓ Apply</button>
      <button class="diff-btn reject" onclick="document.getElementById('${id}').remove()">✕ Reject</button>
    </div>
  </div>`;
}
function applyStoredPatch(id){
  const patch=window._patches?.[id];if(!patch)return;
  const result=applySurgicalPatch(patch.file,patch.search,patch.replace);
  const card=document.getElementById(id);
  if(result.ok){card.innerHTML=`<div style="padding:8px 12px;font-size:11px;color:var(--accent3)">✓ Patched ${result.path.split('/').pop()}</div>`;toast(`Patched ${result.path.split('/').pop()}`,'success');}
  else{card.innerHTML=`<div style="padding:8px 12px;font-size:11px;color:var(--red)">❌ ${escHtml(result.err)}</div>`;toast(result.err,'error');}
}
function renderNewFileDiff(diff){
  const lines=diff.changes.map(l=>`<div class="diff-line plus">${escHtml(l)}</div>`).join('');
  const id=`nf-${Date.now()}`;
  window._patches=window._patches||{};
  window._patches[id]={newFile:diff.file,content:diff.newContent};
  return `<div class="diff-card" id="${id}">
    <div class="diff-header"><span class="diff-file">📄 ${escHtml(diff.file)}</span><span class="diff-badge add">+ New File</span></div>
    <div class="diff-body">${lines}</div>
    <div class="diff-actions">
      <button class="diff-btn apply" onclick="applyNewFile('${id}')">✓ Create</button>
      <button class="diff-btn reject" onclick="document.getElementById('${id}').remove()">✕ Reject</button>
    </div>
  </div>`;
}
function applyNewFile(id){
  const p=window._patches?.[id];if(!p)return;
  const parts=p.newFile.split('/');const name=parts.pop();
  const ext=name.split('.').pop().toLowerCase();
  const langMap={js:'js',py:'py',html:'html',css:'css',json:'json',md:'md',ts:'js',txt:'txt'};
  let parent=state.files;
  for(const part of parts){if(!parent[part])parent[part]={type:'folder',open:true,children:{}};parent=parent[part].children;}
  parent[name]={type:'file',content:p.content,lang:langMap[ext]||'txt'};
  renderTree();openFile(p.newFile);
  document.getElementById(id).innerHTML=`<div style="padding:8px 12px;font-size:11px;color:var(--accent3)">✓ Created ${name}</div>`;
  toast(`Created ${name}`,'success');
}

// SEND — main chat function
async function sendChat(){
  const input=document.getElementById('chat-input');
  const msg=input.value.trim();if(!msg)return;
  input.value='';input.style.height='auto';
  document.getElementById('send-btn').classList.add('loading');
  document.getElementById('ai-bar').classList.add('active');

  // Add user message to state + DOM
  const userMsg = {role:'user', text:msg, ts:Date.now()};
  state.chatMessages.push(userMsg);
  appendBubble('user', msg);

  const thinkEl=addThinking();
  const activeF=state.activeFile?getFile(state.activeFile):null;
  const fileContext=activeF?`ACTIVE FILE: ${state.activeFile}\n\`\`\`\n${activeF.content}\n\`\`\``:'(no file open)';
  const fileList=getAllFiles().map(f=>`  - ${f.path}`).join('\n');
  const systemPrompt=`You are AXIOM, a surgical AI code editor.\n\nEDITING RULES:\n1. For code changes use SEARCH→REPLACE blocks:\n### path/to/file.js\n<<<<<<< SEARCH\nexact existing code\n=======\nnew replacement code\n>>>>>>> REPLACE\n2. For NEW files use JSON:\n\`\`\`json\n{"newFile": "path/name.js", "content": "full content"}\n\`\`\`\n3. For questions, reply in plain text.\n\nPROJECT:\n${fileList}\n\n${fileContext}`;
  let responseText='';
  const enabledProviders=state.providers.filter(p=>p.enabled&&(p.apiKey||p.noKey));
  if(!enabledProviders.length){
    thinkEl.remove();
    document.getElementById('send-btn').classList.remove('loading');
    document.getElementById('ai-bar').classList.remove('active');
    const noProvText='⚙️ No AI provider configured. Tap ⚙ Settings to add one. Pollinations AI is free — no API key needed!';
    const aiMsg={role:'ai',text:noProvText,ts:Date.now()};
    state.chatMessages.push(aiMsg);
    appendBubble('ai', noProvText);
    saveChatToIDB();
    return;
  }
  for(let i=0;i<enabledProviders.length;i++){
    const provider=enabledProviders[i];
    try{
      updateProviderLabel(provider.name);
      responseText=await callProvider(provider,systemPrompt,[...state.chatHistory,{role:'user',content:msg}]);
      state.chatHistory.push({role:'user',content:msg});
      state.chatHistory.push({role:'assistant',content:responseText});
      if(state.chatHistory.length>20)state.chatHistory=state.chatHistory.slice(-20);
      break;
    }catch(err){
      console.warn(`Provider ${provider.name} failed:`,err.message);
      if(i===enabledProviders.length-1)responseText=`❌ All providers failed. Last error: ${err.message}`;
    }
  }
  thinkEl.remove();
  document.getElementById('send-btn').classList.remove('loading');
  document.getElementById('ai-bar').classList.remove('active');

  const patches=parsePatchBlocks(responseText);
  let newFileDiff=null;
  const jsonMatch=responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if(jsonMatch){try{const p=JSON.parse(jsonMatch[1]);if(p.newFile&&p.content)newFileDiff={file:p.newFile,newContent:p.content,changes:p.content.split('\n').slice(0,8).map(l=>`+${l}`)}}catch(e){}}
  let displayText=responseText.replace(/###\s*[^\n]+\n<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/g,'').replace(/```json[\s\S]*?```/g,'').trim();
  if(!displayText&&(patches.length||newFileDiff))displayText='Here are the changes:';

  let patchHTML='';
  patches.forEach((p,i)=>{patchHTML+=renderPatchCard(p,Date.now()+i);});
  if(newFileDiff)patchHTML+=renderNewFileDiff(newFileDiff);

  const finalText=displayText||(patches.length?'Review patches:':'Done.');
  const aiMsg={role:'ai', text:finalText, ts:Date.now(), patchHTML};
  state.chatMessages.push(aiMsg);
  appendBubble('ai', finalText, patchHTML);

  // Persist chat
  saveChatToIDB();
}

document.getElementById('send-btn').addEventListener('click',sendChat);
document.getElementById('chat-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}
});
document.getElementById('chat-input').addEventListener('input',function(){
  this.style.height='auto';
  this.style.height=Math.min(this.scrollHeight,130)+'px';
});
document.getElementById('btn-clear-chat').addEventListener('click',()=>{
  state.chatHistory=[];
  state.chatMessages=[];
  document.getElementById('messages').innerHTML='';
  saveChatToIDB();
  addWelcome();
  toast('Chat cleared','info');
});

// ═══════════════════════════════════
// PROVIDER LABEL + MODEL SELECTOR
// ═══════════════════════════════════
function updateProviderLabel(name){
  document.getElementById('active-model-label').textContent=name;
  document.getElementById('sb-model').textContent=name;
}
document.getElementById('model-selector').addEventListener('click',e=>{
  removeCtxMenu();
  const enabled=state.providers.filter(p=>p.enabled&&(p.apiKey||p.noKey));
  if(!enabled.length){showSettingsModal();return;}
  const rect=e.currentTarget.getBoundingClientRect();
  const menu=document.createElement('div');menu.className='ctx-menu';
  menu.style.cssText=`left:${rect.left}px;bottom:${window.innerHeight-rect.top+6}px`;
  enabled.forEach(p=>{
    const el=document.createElement('div');el.className='ctx-item';
    el.innerHTML=`<span style="color:var(--accent3)">${state.activeProviderId===p.id?'●':'○'}</span> ${escHtml(p.name)} <span style="color:var(--text3);font-size:10px">${escHtml(p.model||'')}</span>`;
    el.style.fontFamily='var(--font-mono)';
    el.addEventListener('click',()=>{state.activeProviderId=p.id;state.providers=[p,...state.providers.filter(x=>x.id!==p.id)];updateProviderLabel(p.name);removeCtxMenu();});
    menu.appendChild(el);
  });
  const sep=document.createElement('div');sep.className='ctx-sep';menu.appendChild(sep);
  const sEl=document.createElement('div');sEl.className='ctx-item';sEl.textContent='⚙ Manage providers';
  sEl.addEventListener('click',()=>{removeCtxMenu();showSettingsModal();});
  menu.appendChild(sEl);
  document.body.appendChild(menu);ctxMenu=menu;
});

// ═══════════════════════════════════
// API ENGINE
// ═══════════════════════════════════
async function callProvider(provider,systemPrompt,messages){
  const {format,apiKey,model,baseUrl}=provider;
  if(format==='openai'){
    const headers={'Content-Type':'application/json'};
    if(apiKey)headers['Authorization']=`Bearer ${apiKey}`;
    const res=await fetch(baseUrl,{method:'POST',headers,body:JSON.stringify({model,max_tokens:2000,messages:[{role:'system',content:systemPrompt},...messages]})});
    const data=await res.json();
    if(data.error)throw new Error(data.error.message||JSON.stringify(data.error));
    return data.choices?.[0]?.message?.content||'No response';
  }
  if(format==='nvidia'){
  if(!baseUrl) throw new Error('Proxy URL ያስገቡ');
  if(!apiKey) throw new Error('API Key ያስገቡ');
  const res = await fetch(baseUrl, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      model,
      max_tokens:4096,
      messages:[{role:'system',content:systemPrompt},...messages]
    })
  });
  const text = await res.text();
  if(!res.ok) throw new Error(`NVIDIA ${res.status}: ${text.slice(0,300)}`);
  const data = JSON.parse(text);
  return data.choices?.[0]?.message?.content||'No response';
}
    if(!res.ok){
      const err=await res.text();
      throw new Error(`NVIDIA ${res.status}: ${err.slice(0,200)}`);
    }
    const data=await res.json();
    if(data.error)throw new Error(data.error.message||JSON.stringify(data.error));
    return data.choices?.[0]?.message?.content||'No response';
  }
  if(format==='anthropic'){
    const res=await fetch(baseUrl,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model,max_tokens:2000,system:systemPrompt,messages})});
    const data=await res.json();
    if(data.error)throw new Error(data.error.message||JSON.stringify(data.error));
    return data.content?.map(c=>c.text||'').join('')||'No response';
  }
  if(format==='gemini'){
    const url=baseUrl.replace('{model}',model)+'?key='+apiKey;
    const geminiMessages=messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:systemPrompt}]},contents:geminiMessages,generationConfig:{maxOutputTokens:2000}})});
    const data=await res.json();
    if(data.error)throw new Error(data.error.message||JSON.stringify(data.error));
    return data.candidates?.[0]?.content?.parts?.[0]?.text||'No response';
  }
  throw new Error(`Unknown format: ${format}`);
}

// ═══════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════
document.getElementById('btn-settings').addEventListener('click',showSettingsModal);
function saveProviders(){try{localStorage.setItem('axiom-providers',JSON.stringify(state.providers));}catch(e){}}
function loadProviders(){
  try{
    const saved=localStorage.getItem('axiom-providers');
    if(saved){
      state.providers=JSON.parse(saved);
      const active=state.providers.find(p=>p.enabled&&(p.apiKey||p.noKey));
      if(active)updateProviderLabel(active.name);
    }
  }catch(e){}
  if(!state.providers.length){
    state.providers=[{id:'pollinations',name:'Pollinations AI (Free)',preset:'Pollinations AI (Free)',format:'openai',baseUrl:'https://text.pollinations.ai/openai',model:'openai',apiKey:'',enabled:true,noKey:true}];
    updateProviderLabel('Pollinations AI (Free)');
  }
}
function showSettingsModal(){
  const existing=document.getElementById('settings-overlay');if(existing)existing.remove();
  const overlay=document.createElement('div');overlay.id='settings-overlay';overlay.className='modal-overlay';overlay.style.cssText='align-items:flex-end;padding:0';
  function render(){
    overlay.innerHTML=`<div class="modal" style="width:100%;max-height:90vh;overflow-y:auto;border-radius:18px 18px 0 0;padding-bottom:max(20px,env(safe-area-inset-bottom))">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3>⚙ AI Providers</h3>
        <button class="icon-btn" id="settings-close" style="font-size:20px">✕</button>
      </div>
      <p style="font-size:11px;color:var(--text3);margin-bottom:12px">🆓 <b>Pollinations AI</b> and <b>Ollama</b> are free — no API key needed!</p>
      <div id="providers-list" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        ${state.providers.map((p,i)=>`
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:14px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span style="font-size:13px;font-weight:700;color:var(--text1);flex:1">${i+1}. ${escHtml(p.name)}</span>
              ${p.noKey?'<span style="font-size:10px;color:var(--accent3);padding:2px 7px;background:rgba(52,211,153,.15);border-radius:5px">FREE</span>':''}
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text2);cursor:pointer">
                <input type="checkbox" ${p.enabled?'checked':''} data-action="toggle" data-id="${p.id}" style="accent-color:var(--accent);width:18px;height:18px"> On
              </label>
              <button class="icon-btn" data-action="delete" data-id="${p.id}" style="color:var(--red);font-size:18px">🗑</button>
            </div>
            ${!p.noKey?`<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--text3);margin-bottom:4px">API KEY</div>
              <input type="password" value="${p.apiKey||''}" data-field="apiKey" data-id="${p.id}" placeholder="Your API key"
                style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:var(--font-mono);font-size:13px;color:var(--text1);outline:none"/></div>`:''}
            <div><div style="font-size:10px;color:var(--text3);margin-bottom:4px">MODEL</div>
              ${p.format==='nvidia'
                ? `<input type="text" value="${p.model||''}" data-field="model" data-id="${p.id}" placeholder="Type model or pick below…"
                    style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px 8px 0 0;padding:10px 12px;font-family:var(--font-mono);font-size:12px;color:var(--text1);outline:none;border-bottom:none"/>
                  <select data-nvidia-pick="${p.id}"
                    style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:0 0 8px 8px;padding:10px 12px;font-family:var(--font-mono);font-size:12px;color:var(--text2);outline:none;appearance:none;-webkit-appearance:none">
                    <option value="">— pick a model —</option>
                    ${NVIDIA_MODELS.map(m=>`<option value="${m}">${m}</option>`).join('')}
                  </select>`
                : `<input type="text" value="${p.model||''}" data-field="model" data-id="${p.id}" placeholder="Model name"
                    style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:var(--font-mono);font-size:13px;color:var(--text1);outline:none"/>`
              }</div>
            ${p.format==='nvidia'
              ? `<div style="margin-top:8px">
                  <div style="font-size:10px;color:var(--text3);margin-bottom:4px">PROXY URL <span style="color:var(--warn)">⚠ ያስፈልጋል</span></div>
                  <input type="text" value="${p.baseUrl||''}" data-field="baseUrl" data-id="${p.id}" placeholder="https://your-proxy.railway.app"
                    style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:var(--font-mono);font-size:12px;color:var(--text1);outline:none;margin-bottom:8px"/>
                  <div style="background:rgba(91,143,255,.08);border:1px solid rgba(91,143,255,.2);border-radius:10px;padding:12px;font-size:11px;line-height:1.8;color:var(--text2)">
                    <b style="color:var(--accent)">⚡ Railway/Render ላይ Free Proxy (5 ደቂቃ):</b><br><br>
                    <b style="color:var(--text1)">1.</b> <a href="https://github.com/new" target="_blank" style="color:var(--accent)">GitHub</a> ላይ repo ፍጠሩ → <code style="background:var(--bg3);padding:1px 5px;border-radius:3px;color:var(--accent3)">nvidia-proxy</code><br>
                    <b style="color:var(--text1)">2.</b> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px;color:var(--accent3)">server.js</code> ፍጠሩ:<br>
                    <div style="background:var(--bg3);border-radius:6px;padding:8px 10px;margin:6px 0;font-family:var(--font-mono);font-size:10px;color:var(--accent3);white-space:pre-wrap;overflow-x:auto">const express=require('express');
const app=express();
app.use(require('cors')());
app.use(express.json());
app.post('/v1/chat/completions',async(req,res)=>{
  const r=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':req.headers.authorization},
    body:JSON.stringify(req.body)
  });
  const d=await r.json();
  res.json(d);
});
app.listen(process.env.PORT||3000);</div>
                    <b style="color:var(--text1)">3.</b> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px;color:var(--accent3)">package.json</code>:<br>
                    <div style="background:var(--bg3);border-radius:6px;padding:8px 10px;margin:6px 0;font-family:var(--font-mono);font-size:10px;color:var(--accent3);white-space:pre-wrap">{"main":"server.js","scripts":{"start":"node server.js"},"dependencies":{"express":"^4","cors":"^2"}}</div>
                    <b style="color:var(--text1)">4.</b> <a href="https://railway.app" target="_blank" style="color:var(--accent)">railway.app</a> → GitHub repo → Deploy<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;<i>ወይም</i> <a href="https://render.com" target="_blank" style="color:var(--accent)">render.com</a> → New Web Service → Free<br>
                    <b style="color:var(--text1)">5.</b> Deploy URL ወደ ላይ ያስገቡ ✓
                  </div>
                </div>`
              : p.preset==='Custom URL'||!p.preset
                ? `<div style="margin-top:8px"><div style="font-size:10px;color:var(--text3);margin-bottom:4px">BASE URL</div>
                    <input type="text" value="${p.baseUrl||''}" data-field="baseUrl" data-id="${p.id}" placeholder="https://..."
                      style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:var(--font-mono);font-size:13px;color:var(--text1);outline:none"/></div>`
                : ''
            }
          </div>`).join('')}
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:10px">+ Add Provider</div>
        <div style="display:flex;flex-wrap:wrap;gap:7px">
          ${PROVIDER_PRESETS.map(p=>`<button class="hbtn" data-action="addpreset" data-preset="${escHtml(p.name)}" style="font-size:11px;padding:0 11px;height:34px">${escHtml(p.name)}</button>`).join('')}
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:10px">📦 Project</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="hbtn" id="s-export" style="flex:1;justify-content:center;height:40px;min-width:80px">📦 Export ZIP</button>
          <button class="hbtn" id="s-import" style="flex:1;justify-content:center;height:40px;min-width:80px">⬆ Import ZIP</button>
          <button class="hbtn" id="s-share" style="flex:1;justify-content:center;height:40px;min-width:80px">🔗 Share URL</button>
          <button class="hbtn" id="s-github" style="flex:1;justify-content:center;height:40px;min-width:80px">↑ GitHub</button>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:10px">🎨 Theme</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${Object.keys(THEMES).map(t=>`<button class="hbtn ${state.theme===t?'primary':''}" data-action="theme" data-theme="${t}" style="font-size:11px;height:34px">${t}</button>`).join('')}
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="hbtn" id="settings-close2" style="flex:1;justify-content:center;height:44px">Cancel</button>
        <button class="hbtn primary" id="settings-save" style="flex:2;justify-content:center;height:44px">💾 Save</button>
      </div>
    </div>`;
    overlay.querySelector('#settings-close').onclick=()=>overlay.remove();
    overlay.querySelector('#settings-close2').onclick=()=>overlay.remove();
    overlay.querySelector('#settings-save').onclick=()=>{
      overlay.querySelectorAll('input[data-field]').forEach(inp=>{const id=inp.dataset.id,field=inp.dataset.field;const p=state.providers.find(x=>x.id===id);if(p)p[field]=inp.value.trim();});
      saveProviders();
      const active=state.providers.find(p=>p.enabled&&(p.apiKey||p.noKey));
      if(active)updateProviderLabel(active.name);
      overlay.remove();toast('Providers saved!','success');
    };
    overlay.querySelector('#s-export')?.addEventListener('click',()=>{overlay.remove();exportZIP();});
    overlay.querySelector('#s-import')?.addEventListener('click',()=>{overlay.remove();zipInput.click();});
    overlay.querySelector('#s-share')?.addEventListener('click',()=>{overlay.remove();shareViaURL();});
    overlay.querySelector('#s-github')?.addEventListener('click',()=>{overlay.remove();showGitHubModal();});
    overlay.querySelectorAll('[data-action]').forEach(el=>{
      el.addEventListener('click',e=>{
        const action=el.dataset.action,id=el.dataset.id;
        if(action==='toggle'){const p=state.providers.find(x=>x.id===id);if(p)p.enabled=el.checked;render();return;}
        if(action==='delete'){const idx=state.providers.findIndex(p=>p.id===id);if(idx>-1)state.providers.splice(idx,1);render();return;}
        if(action==='addpreset'){const preset=PROVIDER_PRESETS.find(p=>p.name===el.dataset.preset);if(!preset)return;state.providers.push({id:'p'+Date.now(),name:preset.name,preset:preset.name,format:preset.format,baseUrl:preset.baseUrl,model:preset.defaultModel,apiKey:'',enabled:true,noKey:!!preset.noKey});render();}
        if(action==='theme'){applyTheme(el.dataset.theme);render();}
      });
    });
    // NVIDIA dropdown → fills the text input above it
    overlay.querySelectorAll('[data-nvidia-pick]').forEach(sel=>{
      sel.addEventListener('change',()=>{
        if(!sel.value) return;
        const id=sel.dataset.nvidiaPick;
        const textInput=overlay.querySelector(`input[data-field="model"][data-id="${id}"]`);
        if(textInput) textInput.value=sel.value;
        sel.value=''; // reset dropdown back to placeholder
      });
    });
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  }
  render();
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════
// DESKTOP RESIZE
// ═══════════════════════════════════
let isResizing=false;
const resizeH=document.getElementById('resize-handle');
if(resizeH){
  resizeH.addEventListener('mousedown',()=>{isResizing=true;document.body.style.cursor='ns-resize';document.body.style.userSelect='none';});
  document.addEventListener('mousemove',e=>{
    if(!isResizing)return;
    const layout=document.getElementById('layout');const rect=layout.getBoundingClientRect();
    const newChatH=Math.min(Math.max(rect.bottom-e.clientY,120),rect.height-200);
    document.querySelector('#panel-chat').style.height=newChatH+'px';
    document.querySelector('#panel-editor').style.paddingBottom=newChatH+'px';
    resizeH.style.top=`calc(100% - ${newChatH}px - 2px)`;
  });
  document.addEventListener('mouseup',()=>{isResizing=false;document.body.style.cursor='';document.body.style.userSelect='';});
}

// Desktop preview toggle
let desktopPreviewOn=false;
document.getElementById('btn-preview-toggle')?.addEventListener('click',()=>{
  desktopPreviewOn=!desktopPreviewOn;
  const previewPanel=document.getElementById('panel-preview');
  const editorPanel=document.getElementById('panel-editor');
  const btn=document.getElementById('btn-preview-toggle');
  if(desktopPreviewOn){previewPanel.classList.add('desktop-visible');editorPanel.classList.add('split');btn.classList.add('primary');refreshPreview();}
  else{previewPanel.classList.remove('desktop-visible');editorPanel.classList.remove('split');btn.classList.remove('primary');}
});

// ═══════════════════════════════════
// WELCOME
// ═══════════════════════════════════
function addWelcome(){
  const welcomeText='👋 Hello! I can see all your files. 🆓 Pollinations AI is enabled by default — no API key needed! Try asking me to edit code, fix bugs, or create new files. Tap ⚙ to manage providers.';
  const aiMsg={role:'ai',text:welcomeText,ts:Date.now()};
  state.chatMessages.push(aiMsg);
  appendBubble('ai', welcomeText, '', false);
}

// ═══════════════════════════════════
// STORAGE BAR
// ═══════════════════════════════════
function updateStorageBar(){
  try{
    const total=getAllFiles().reduce((acc,f)=>acc+f.content.length,0);
    const pct=Math.min(100,Math.round(total/(5*1024*1024)*100));
    document.getElementById('storage-pct').textContent=pct+'%';
    document.getElementById('storage-fill').style.width=pct+'%';
  }catch(e){}
}

// ═══════════════════════════════════
// INIT
// ═══════════════════════════════════
try{const t=localStorage.getItem('axiom-theme');if(t&&THEMES[t])applyTheme(t);}catch(e){}
try{const g=localStorage.getItem('axiom-github');if(g)state.githubSettings=JSON.parse(g);}catch(e){}

if(typeof Prism!=='undefined'&&Prism.plugins&&Prism.plugins.autoloader){
  Prism.plugins.autoloader.languages_path='https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
}

loadFromURL();
renderTree();
renderTabs();
loadEditor(state.activeFile);
loadProviders();
updateStorageBar();

// Load persisted chat from IndexedDB FIRST
loadChatFromIDB(savedMsgs => {
  if (savedMsgs && savedMsgs.length > 0) {
    state.chatMessages = savedMsgs;
    renderChatHistory();
  } else {
    addWelcome();
  }
  // Rebuild API history from saved messages (last 20)
  const apiMsgs = savedMsgs.slice(-20);
  state.chatHistory = apiMsgs.map(m => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.text
  }));
});

loadFromIDB();
switchPanel('editor');
</script>
</body>
</html>
