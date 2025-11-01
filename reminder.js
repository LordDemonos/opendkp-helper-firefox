(function(){
	const api = typeof browser !== 'undefined' ? browser : chrome;
	const params = new URLSearchParams(location.search);
	const id = params.get('id') || ('r-'+Date.now());
	const msg = decodeURIComponent(params.get('msg') || 'Run /outputfile raidlist');
	const messageEl = document.getElementById('message');
	const statusEl = document.getElementById('status');
	messageEl.textContent = msg;

	function showStatus(text){ if(!statusEl) return; statusEl.textContent = text; setTimeout(()=>{ statusEl.textContent=''; }, 1500); }

	function copyCommand(){
		navigator.clipboard.writeText('/outputfile raidlist').then(()=>{
			showStatus('Copied to clipboard');
		}).catch(()=>{ showStatus('Copy failed'); });
	}

	async function speakAndSound(text){
		try {
			const s = await api.storage.sync.get(['enableTTS','voice','voiceSpeed','quietHours','quietStart','quietEnd','soundType','volume']);
			const inQuiet = (()=>{
				if(!s.quietHours) return false; const now=new Date(); const cur=now.getHours()*100+now.getMinutes();
				const parse=(t)=>{ try {const [h,m]=String(t||'22:00').split(':').map(x=>parseInt(x)); return h*100+m;} catch(_){return 0;} };
				const st=parse(s.quietStart), en=parse(s.quietEnd); if(st>en) return cur>=st || cur<=en; return cur>=st && cur<=en;
			})();
			if(!inQuiet){
				const type = s.soundType || 'bell';
				const map = { chime:'hotel.mp3', bell:'bell.mp3', ding:'ding1.mp3', ding2:'ding2.mp3', ding3:'ding3.mp3', ding4:'ding4.mp3', jobsDone:'jobsdone.mp3', workComplete:'workcomplete.mp3' };
				const file = map[type] || 'bell.mp3';
				const url = api.runtime.getURL(file);
				const audio = new Audio(url); audio.volume = (typeof s.volume==='number'? s.volume : 70)/100; audio.currentTime=0; try { await audio.play(); } catch(_){}
			}
			if (s.enableTTS){
				const u = new SpeechSynthesisUtterance(text);
				try {
					const voices = speechSynthesis.getVoices();
					const v = voices.find(v=>v.name===s.voice);
					if (v) u.voice = v;
				} catch(_){}
				// Chrome's Speech Synthesis API caps rate at 2.0x, Firefox supports higher
				const isFirefox = typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
				const maxRate = isFirefox ? 2.5 : 2.0;
				u.rate = Math.min(s.voiceSpeed || 1.0, maxRate);
				u.volume = 0.9;
				setTimeout(()=> speechSynthesis.speak(u), 400);
			}
		} catch(_){}
	}

	document.getElementById('copyBtn').addEventListener('click', copyCommand);
	document.getElementById('doneBtn').addEventListener('click', async function(){
		try { 
			const result = await api.runtime.sendMessage({ type:'ackReminder', id, ts: Date.now() });
			try { console.log('[Reminder] Done clicked, acknowledgment sent:', result); } catch(_) {}
			// Background script should close all windows, but if it fails or doesn't respond,
			// close this window after a longer delay to give background script time to process
			setTimeout(() => {
				try { window.close(); } catch(_) {}
			}, 500); // Increased delay to give background script time to close windows
		} catch(e) { 
			try { console.warn('[Reminder] Failed to send acknowledgment:', e); } catch(_) {}
			// If message failed, close immediately as fallback
			setTimeout(() => {
				try { window.close(); } catch(_) {}
			}, 100);
		}
	});

	// On load, speak and sound
	speakAndSound(msg);

})();
