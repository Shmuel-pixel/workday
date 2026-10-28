# Builds workday/index.html from workday.html (the Claude preview) for the GitHub app.
import re
s=open('workday.html',encoding='utf8').read()
def rep(a,b):
    global s
    assert s.count(a)==1, a[:70]
    s=s.replace(a,b)
rep("h+='<div class=\"warn\">Open this page inside the Claude app to load the equipment sheet.</div>';",
    "h+='<div class=\"warn\">'+(window.claude?'Open this page inside the Claude app to load the equipment sheet.':'This tab connects to your equipment sheet in the next setup step (Google sign-in).')+'</div>';")
rep("h+='<div class=\"warn\">Open this page inside the Claude app to load the dumpster log.</div>';",
    "h+='<div class=\"warn\">'+(window.claude?'Open this page inside the Claude app to load the dumpster log.':'This tab connects to your Dumpster Log in the next setup step (Google sign-in).')+'</div>';")
src=open('workday/index.html',encoding='utf8').read()
head=src[:src.index('<title>')]
sw=src[src.rindex("<script>\nif('serviceWorker'"):]
body=s.replace('<meta name="claude:viewport-fit-sides" content="cover">\n','')
body=body.replace('<link rel="preconnect" href="https://fonts.googleapis.com">','</head>\n<body>\n<link rel="preconnect" href="https://fonts.googleapis.com">',1)
open('workday/index.html','w',encoding='utf8').write(head+body+'\n'+sw)
w=open('workday/sw.js',encoding='utf8').read()
n=int(re.search(r"workday-v(\d+)",w).group(1))+1
w=re.sub(r"workday-v\d+","workday-v%d"%n,w,count=1)
open('workday/sw.js','w',encoding='utf8').write(w)
print('built, cache version',n)

# ---- keep a full copy of the source in the repo (src/), without secrets ----
import os, shutil
os.makedirs('workday/src/connect', exist_ok=True); os.makedirs('workday/src/fill', exist_ok=True); os.makedirs('workday/src/widget', exist_ok=True); os.makedirs('workday/src/tools', exist_ok=True)
for a, b in [('workday.html','workday/src/workday.html'),('build.py','workday/src/build.py'),('claude-project-instructions.md','workday/src/claude-project-instructions.md'),
             ('connect/appsscript.json','workday/src/connect/appsscript.json'),('fill/fill.js','workday/src/fill/fill.js'),('fill/bookmark.txt','workday/src/fill/bookmark.txt'),
             ('widget/workday-widget.js','workday/src/widget/workday-widget.js'),('tools/drop.js','workday/src/tools/drop.js')]:
    if os.path.exists(a): shutil.copyfile(a, b)
if os.path.exists('connect/Code.gs'):
    g = open('connect/Code.gs', encoding='utf8').read()
    g = re.sub(r"var TOKEN = '[^']*';", "var TOKEN = 'PUT-YOUR-OWN-TOKEN-HERE'; /* the real one is only in the Google Doc and your Apps Script */", g)
    open('workday/src/connect/Code.gs', 'w', encoding='utf8').write(g)
print('source copied to workday/src')
