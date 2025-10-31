(function(){
  const fileInput = () => document.getElementById('fileInput');
  const pickBtn = () => document.getElementById('pick');
  const logEl = () => document.getElementById('log');
  const nameEl = () => document.getElementById('fileName');
  const tagInput = () => document.getElementById('tagInput');
  const scanLatestNowEl = () => document.getElementById('scanLatestNow');

  let monitoring = false;
  let timer = null;
  let selectedFile = null;
  let lastSeenLogLine = null;
  let tag = 'FG';

  function addLog(msg){ if (logEl()){ const d=document.createElement('div'); d.textContent=`${new Date().toLocaleTimeString()} ${msg}`; logEl().appendChild(d); logEl().scrollTop=logEl().scrollHeight; } }

  function detectLootLine(line, tag) {
    const m = line.match(/^\[[^\]]+\]\s.*?(tells the raid|tell the raid|tell your party|tells your party|say),\s*'(.*)'\s*$/i);
    if (!m) return false;
    const quoted = m[2];
    const re = new RegExp('^\n?\r?\t?\uFEFF?\s*' + tag + '\\b', 'i');
    return re.test(quoted);
  }

  function extractItems(line, tag) {
    const m = line.match(/^\[[^\]]+\]\s.*?(?:tells the raid|tell the raid|tell your party|tells your party|say),\s*'(.*)'\s*$/i);
    if (!m) return [];
    const quoted = m[1];
    const after = quoted.replace(new RegExp('^\n?\r?\t?\uFEFF?\s*' + tag + '\\s*','i'),'').trim();
    if (!after) return [];
    const hasPipe = after.includes('|');
    const hasComma = after.includes(',');
    let items = [];
    if (!hasPipe && !hasComma) items = [after]; else items = after.split(hasPipe ? '|' : ',').map(s=>s.trim());
    return items.filter(Boolean);
  }

  async function pushEvent(line){
    const items = extractItems(line, tag);
    if (!items.length) return;
    const event = { id: Date.now()+Math.random().toString(36).slice(2), timestamp: (line.match(/\[([^\]]+)\]/)||[])[1]||new Date().toLocaleString(), date: new Date().toISOString().split('T')[0], items, logLine: line };
    const data = await browser.storage.sync.get(['eqLogEvents']);
    const list = (data.eqLogEvents||[]);
    list.unshift(event);
    if (list.length>200) list.splice(200);
    await browser.storage.sync.set({ eqLogEvents: list });
  }

  async function poll(){
    if (!selectedFile) return;
    try {
      const text = await selectedFile.text();
      const lines = text.split('\n');
      for (let i=lines.length-1;i>=0;i--){
        const line = lines[i].trim();
        if (!line) continue;
        if (!detectLootLine(line, tag)) continue;
        if (lastSeenLogLine && lastSeenLogLine === line) { addLog('No new loot lines.'); return; }
        lastSeenLogLine = line;
        addLog('New loot line found, pushing...');
        await pushEvent(line);
        return;
      }
      addLog('No loot line matched.');
    } catch(e){ addLog('Error: '+e.message); }
  }

  async function start(){
    const s = await browser.storage.sync.get(['eqLogTag']);
    tag = (s.eqLogTag)||'FG';
    if (tagInput()) tagInput().value = tag;
    monitoring = true; addLog('Monitoring started. Tag: '+tag);
    timer = setInterval(poll, 3000);
  }

  function stop(){ monitoring=false; if (timer) clearInterval(timer); timer=null; addLog('Monitoring stopped.'); }

  function init(){
    if (pickBtn()) pickBtn().addEventListener('click', ()=> fileInput().click());
    if (fileInput()) fileInput().addEventListener('change', async ()=>{
      selectedFile = (fileInput().files||[])[0];
      if (!selectedFile) return;
      nameEl().textContent = selectedFile.name;
      await browser.storage.sync.set({ eqLogFileMeta: { name: selectedFile.name, lastModified: selectedFile.lastModified } });
      if (!monitoring) {
        // If user doesn't want to capture the latest on start, prime lastSeenLogLine with the current latest
        const captureLatest = !scanLatestNowEl || (scanLatestNowEl() && scanLatestNowEl().checked);
        if (!captureLatest) {
          try {
            const text = await selectedFile.text();
            const lines = text.split('\n');
            for (let i=lines.length-1;i>=0;i--){
              const line = lines[i].trim();
              if (line && detectLootLine(line, tag)) { lastSeenLogLine = line; break; }
            }
            if (lastSeenLogLine) addLog('Primed with latest loot line; will only capture new ones.');
          } catch(_){}
        }
        start();
      } else {
        addLog('File changed.');
      }
      // First poll immediately
      poll();
    });
    if (tagInput()) {
      tagInput().addEventListener('input', async ()=>{
        tag = tagInput().value || 'FG';
        await browser.storage.sync.set({ eqLogTag: tag });
        addLog('Tag set to: '+tag);
      });
    }
    window.addEventListener('beforeunload', async ()=>{
      stop();
      await browser.storage.sync.set({ eqLogMonitoring: false, eqLogMonitorWindowId: null });
    });
    // attempt auto open picker first time
    setTimeout(()=>{ try{ fileInput().click(); }catch(_){} }, 100);
  }

  document.addEventListener('DOMContentLoaded', init);
})();


