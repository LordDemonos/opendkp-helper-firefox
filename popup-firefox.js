// Popup script for OpenDKP Helper - Firefox Compatible

// Customizable popup text - modify this before production
const POPUP_QUICK_ACTIONS_TEXT = `Quick Actions:
• Click "Open Settings" to configure RaidTick integration
• Use date navigation to browse RaidTick files
• Click "Copy" to copy file contents to clipboard`;

document.addEventListener('DOMContentLoaded', function() {
  console.log('Firefox-compatible popup loaded');
  
  // Initialize popup
  
  const statusDiv = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  // Inline volume controls
  const volumeSlider = document.getElementById('volumeSlider');
  const volumePct = document.getElementById('volumePct');
  const volumeIcon = document.getElementById('volumeIcon');
  const openOptionsBtn = document.getElementById('openOptions');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const darkModeIcon = document.getElementById('darkModeIcon');
  const modeToggle = document.getElementById('modeToggle');
  const modeIcon = document.getElementById('modeIcon');
  const openLootMonitorBtn = document.getElementById('openLootMonitorBtn');
  const copyFromFileBtn = document.getElementById('copyFromFileBtn');
  const raidTickSection = document.getElementById('raidTickSection');
  const currentDateSpan = document.getElementById('currentDate');
  const prevDateBtn = document.getElementById('prevDate');
  const nextDateBtn = document.getElementById('nextDate');
  const raidTickFilesDiv = document.getElementById('raidTickFiles');
  const raidTickRescanBtn = document.getElementById('raidTickRescan');
  const raidTickFolderInput = document.getElementById('raidTickFolderInput');
  const isFirefox = (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox'));
  
  let currentSelectedDate = new Date();
  let raidTickFiles = [];
  let availableDates = [];
  // Prevent status auto-refresh from overwriting transient success messages
  let statusLockUntil = 0;
  
  function isTimeWindowActive(startStr, endStr) {
    if (!startStr || !endStr) return false;
    const now = new Date();
    const cur = now.getHours() * 100 + now.getMinutes();
    const start = parseInt(String(startStr).replace(':',''));
    const end = parseInt(String(endStr).replace(':',''));
    if (isNaN(start) || isNaN(end)) return false;
    if (start > end) return cur >= start || cur <= end; // overnight
    return cur >= start && cur <= end;
  }
  
  // Load current settings and update UI - Firefox only
  if (typeof browser !== 'undefined') {
    console.log('Using Firefox browser API');
    browser.storage.sync.get([
      'soundProfile',
      'soundType',
      'volume',
      'voice','voiceSpeed',
      'enableTTS',
      'smartBidding',
      'quietHours',
      'quietStart','quietEnd',
      'announceAuctions','announceStart','announceEnd',
      'browserNotifications',
      'flashScreen',
      'raidTickEnabled',
      'raidTickFolder',
      'raidTickFolderHandle',
      'raidTickFiles',
      'raidTickFileList',
      'darkMode',
      'eqLogEnabled',
      'eqLogFile',
      'eqLogFileHandle',
      'eqLogTag',
      'eqLogLastPosition',
      'eqLogEvents',
      'eqLogMonitoring'
    ]).then(function(settings) {
      // Apply dark mode if enabled
      if (settings.darkMode) {
        document.body.classList.add('dark-mode');
        darkModeIcon.textContent = '🌙';
      }
      
      // Set mode icon based on current sound profile
      if (settings.soundProfile === 'raidleader') {
        modeIcon.textContent = '👑';
      } else {
        modeIcon.textContent = '⚔️';
      }
      
      processSettings(settings);

      // Initialize inline volume UI
      const vol = typeof settings.volume === 'number' ? settings.volume : 70;
      try {
        if (volumeSlider) volumeSlider.value = vol;
        if (volumePct) volumePct.textContent = `${vol}%`;
        if (volumeIcon) {
          volumeIcon.classList.remove('vol-dirty','vol-saved');
        }
      } catch(_) {}
    }).catch(function(error) {
      console.error('Firefox storage error:', error);
      showErrorState();
    });
  } else {
    console.error('Browser API not available');
    showErrorState();
  }
  
  function processSettings(settings) {
    // Update status based on settings
    const profile = settings.soundProfile || 'raidleader';
    const soundType = settings.soundType || 'bell';
    const volume = typeof settings.volume === 'number' ? settings.volume : 50;
    
    // Check if we're on an OpenDKP page
    browser.tabs.query({active: true, currentWindow: true}).then(function(tabs) {
      const currentTab = tabs[0];
      const isOpenDKP = currentTab.url.includes('opendkp.com');
      
      const allowStatusUpdate = Date.now() >= statusLockUntil;
      const extras = [];
      if (settings.enableTTS) {
        const v = String(settings.voice || 'Default');
        let short = v;
        if (/zira/i.test(v)) short = 'Zira';
        else if (/david/i.test(v)) short = 'David';
        else if (/mark/i.test(v)) short = 'Mark';
        else short = (v.split(' ').find(Boolean)) || 'Default';
        extras.push(`TTS: ${short}`);
      }
      if (settings.announceAuctions) {
        const active = isTimeWindowActive(settings.announceStart, settings.announceEnd);
        extras.push(`Read Auctions: ${active ? 'active' : 'scheduled'}`);
      }
      if (settings.quietHours && isTimeWindowActive(settings.quietStart, settings.quietEnd)) {
        extras.push('Quiet Hours: active');
      }
      if (settings.eqLogTag) {
        extras.push(`Loot Tag: ${settings.eqLogTag}`);
      }
      const extrasHtml = extras.length ? `<br><small>${extras.join(' • ')}</small>` : '';

      if (allowStatusUpdate) {
        if (isOpenDKP) {
          statusDiv.className = 'status active';
          const url = new URL(currentTab.url);
          const domain = url.hostname;
          statusText.innerHTML = `✅ ${domain}<br><small>Profile: ${profile} | Sound: ${soundType} | Volume: ${volume}%</small>${extrasHtml}`;
        } else {
          statusDiv.className = 'status inactive';
          statusText.innerHTML = `⚠️ Not on OpenDKP page<br><small>Profile: ${profile} | Sound: ${soundType} | Volume: ${volume}%</small>${extrasHtml}`;
        }
      }
    }).catch(function(error) {
      console.error('Tabs API error:', error);
      // Fallback status
      statusDiv.className = 'status inactive';
      statusText.innerHTML = '⚠️ Extension Error';
    });
    
    // Firefox: hide RaidTick list section permanently
    if (isFirefox) {
      if (raidTickSection) raidTickSection.style.display = 'none';
      const infoDiv = document.getElementById('quickInfo');
      if (infoDiv) infoDiv.style.display = 'none';
    } else {
      // Chrome: keep existing RaidTick listing
      if (settings.raidTickEnabled && settings.raidTickFolder) {
        console.log('Showing RaidTick section');
        raidTickSection.style.display = 'block';
        loadRaidTickFiles();
      } else {
        console.log('Hiding RaidTick section');
        raidTickSection.style.display = 'none';
      }
    }
    
    // Show/hide EQ Log section based on profile (auto-enabled for Raid Leader)
    // Section is shown if profile is raidleader AND file is configured
    const isRaidLeader = settings.soundProfile === 'raidleader';
    // Hide header action buttons in Raider mode
    try {
      if (copyFromFileBtn) copyFromFileBtn.style.display = isRaidLeader && isFirefox ? 'inline-flex' : 'none';
      if (openLootMonitorBtn) openLootMonitorBtn.style.display = isRaidLeader && isFirefox ? 'inline-flex' : 'none';
    } catch(_) {}

    if (isRaidLeader && settings.eqLogFile) {
      console.log('Showing EQ Log section (Raid Leader profile)');
      document.getElementById('eqLogSection').style.display = 'block';
      initializeEQLogParser(settings);
    } else {
      console.log('Hiding EQ Log section (not Raid Leader or no file configured)');
      document.getElementById('eqLogSection').style.display = 'none';
    }
    
    // Update quick actions (Chrome only)
    const infoDiv = document.getElementById('quickInfo');
    if (infoDiv && !isFirefox) {
      infoDiv.innerHTML = POPUP_QUICK_ACTIONS_TEXT.replace(/\n/g, '<br>');
    }
  }
  
  function showErrorState() {
    const currentDateSpan = document.getElementById('currentDate');
    if (currentDateSpan) {
      currentDateSpan.textContent = 'Error';
      currentDateSpan.style.color = 'red';
    }
    const raidTickFilesDiv = document.getElementById('raidTickFiles');
    if (raidTickFilesDiv) {
      raidTickFilesDiv.innerHTML = '<div class="empty-state">Extension Error</div>';
    }
  }
  
  // Open options page
  openOptionsBtn.addEventListener('click', function() {
    browser.runtime.openOptionsPage();
  });
  
  // Dark mode toggle functionality
  darkModeToggle.addEventListener('click', function() {
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    if (isDarkMode) {
      // Switch to light mode
      document.body.classList.remove('dark-mode');
      darkModeIcon.textContent = '☀️';
      browser.storage.sync.set({ darkMode: false });
      try { browser.runtime.sendMessage({ type: 'darkModeChanged', value: false }); } catch(_) {}
    } else {
      // Switch to dark mode
      document.body.classList.add('dark-mode');
      darkModeIcon.textContent = '🌙';
      browser.storage.sync.set({ darkMode: true });
      try { browser.runtime.sendMessage({ type: 'darkModeChanged', value: true }); } catch(_) {}
    }
  });
  
  // Mode toggle functionality (Raid Leader/Raider)
  modeToggle.addEventListener('click', function() {
    const currentMode = modeIcon.textContent === '👑' ? 'raidleader' : 'raider';
    const newMode = currentMode === 'raidleader' ? 'raider' : 'raidleader';
    
    // Update icon
    modeIcon.textContent = newMode === 'raidleader' ? '👑' : '⚔️';
    
    // Update sound profile in storage
    browser.storage.sync.set({ soundProfile: newMode });
    
    // Update status display
    updateStatusDisplay(newMode);
  });

  // Monitor toggle -> open/close monitor window on Firefox
  const monitorCheckbox = document.getElementById('eqLogMonitoringToggle');
  if (monitorCheckbox && isFirefox) {
    monitorCheckbox.addEventListener('change', async function() {
      if (this.checked) {
        // Open monitor window
        const win = await browser.windows.create({
          url: browser.runtime.getURL('eqlog-monitor.html'),
          type: 'popup', width: 520, height: 360
        });
        await browser.storage.sync.set({ eqLogMonitoring: true, eqLogMonitorWindowId: win.id });
      } else {
        const data = await browser.storage.sync.get(['eqLogMonitorWindowId']);
        if (data.eqLogMonitorWindowId) {
          try { await browser.windows.remove(data.eqLogMonitorWindowId); } catch(e) {}
        }
        await browser.storage.sync.set({ eqLogMonitoring: false, eqLogMonitorWindowId: null });
      }
    });
  }

  // Firefox-only: open tiny copy window for direct file-to-clipboard flow
  if (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox')) {
    if (copyFromFileBtn) {
      copyFromFileBtn.style.display = 'inline-flex';
      copyFromFileBtn.addEventListener('click', function() {
        browser.windows.create({
          url: browser.runtime.getURL('copy-window.html'),
          type: 'popup',
          width: 420,
          height: 220
        });
      });
    }
    if (openLootMonitorBtn) {
      openLootMonitorBtn.style.display = 'inline-flex';
      openLootMonitorBtn.addEventListener('click', async function(){
        const win = await browser.windows.create({ url: browser.runtime.getURL('eqlog-monitor.html'), type: 'popup', width: 520, height: 360 });
        await browser.storage.sync.set({ eqLogMonitoring: true, eqLogMonitorWindowId: win.id });
      });
    }
  } else {
    // Hide the button on non-Firefox browsers
    if (copyFromFileBtn) copyFromFileBtn.style.display = 'none';
    if (openLootMonitorBtn) openLootMonitorBtn.style.display = 'none';
  }
  
  function updateStatusDisplay(mode) {
    try {
      browser.storage.sync.get([
        'soundProfile','soundType','volume','enableTTS','voice','voiceSpeed','announceAuctions','announceStart','announceEnd','quietHours','quietStart','quietEnd','eqLogTag'
      ]).then((settings) => {
        settings.soundProfile = mode;
        processSettings(settings);
      });
    } catch(_) {}
  }

  // Inline volume behavior (Firefox popup)
  if (volumeSlider && volumeIcon && volumePct) {
    let unsaved = false;
    let lastSaved = null;

    // Load current saved value for comparison
    try {
      browser.storage.sync.get(['volume']).then((s) => {
        lastSaved = (typeof s.volume === 'number') ? s.volume : 70;
      });
    } catch(_) {}

    volumeSlider.addEventListener('input', () => {
      const v = parseInt(volumeSlider.value, 10) || 0;
      volumePct.textContent = `${v}%`;
      unsaved = true;
      volumeIcon.classList.add('vol-dirty');
      volumeIcon.classList.remove('vol-saved');
    });

    volumeIcon.addEventListener('click', () => {
      if (!unsaved) return;
      const v = parseInt(volumeSlider.value, 10) || 0;
      // Immediate user feedback (do not wait for storage promise)
      if (statusDiv && statusText) {
        const original = statusText.innerHTML;
        const wasActive = statusDiv.className;
        statusDiv.className = 'status success';
        statusText.innerHTML = '✅ Volume setting saved';
        statusLockUntil = Date.now() + 1600;
        setTimeout(() => {
          statusDiv.className = wasActive;
          statusText.innerHTML = original;
        }, 1500);
      }
      // Persist setting
      try {
        browser.storage.sync.set({ volume: v }).then(() => {
          lastSaved = v; unsaved = false;
          volumeIcon.classList.remove('vol-dirty');
          volumeIcon.classList.add('vol-saved');
          setTimeout(() => volumeIcon.classList.remove('vol-saved'), 1200);
        }).catch(() => {
          // If save fails, indicate error briefly
          if (statusDiv && statusText) {
            statusDiv.className = 'status error';
            statusText.textContent = '❌ Failed to save volume';
          }
        });
      } catch (e) {
        if (statusDiv && statusText) {
          statusDiv.className = 'status error';
          statusText.textContent = '❌ Failed to save volume';
        }
      }
      // After the success message fades, refresh the status with the NEW volume
      const delay = Math.max(1700, (statusLockUntil - Date.now()) + 30);
      setTimeout(() => {
        try {
          browser.storage.sync.get([
            'soundProfile','soundType','enableTTS','voice','announceAuctions','announceStart','announceEnd','quietHours','quietStart','quietEnd','eqLogTag'
          ]).then((s) => {
            // Use the freshly saved volume value for immediate reflection
            s.volume = v;
            processSettings(s);
          });
        } catch(_) {}
      }, delay);
    });
  }
  
  // Listen for storage changes to refresh popup
  browser.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync') {
      console.log('Storage changed, refreshing popup...');
      // Check if RaidTick settings changed
      if (changes.raidTickEnabled || changes.raidTickFolder || changes.raidTickFileList) {
        console.log('RaidTick settings changed, reloading popup data...');
        // Reload the popup to pick up new settings
        setTimeout(() => {
          location.reload();
        }, 500);
      }
      // Refresh loot events immediately when updated by helper window
      if (changes.eqLogEvents) {
        console.log('eqLogEvents updated, refreshing list');
        displayEQLogEvents();
      }
      if (changes.eqLogFileMeta) {
        console.log('eqLogFileMeta updated');
        if (eqLogSettings) {
          eqLogSettings.fileName = (changes.eqLogFileMeta.newValue || {}).name;
        }
        updateFileNameDisplay();
      }

      // Reflect general settings (profile, sound, volume) without reopening popup
      const needsRefresh = (
        changes.soundProfile || changes.soundType || changes.volume ||
        changes.enableTTS || changes.voice || changes.voiceSpeed ||
        changes.announceAuctions || changes.announceStart || changes.announceEnd ||
        changes.quietHours || changes.quietStart || changes.quietEnd ||
        changes.browserNotifications || changes.flashScreen || changes.eqLogTag
      );
      if (needsRefresh) {
        try {
          browser.storage.sync.get([
            'soundProfile','soundType','volume','enableTTS','smartBidding','quietHours','browserNotifications','flashScreen','darkMode','voice','voiceSpeed','announceAuctions','announceStart','announceEnd','quietStart','quietEnd','eqLogTag'
          ]).then((settings) => {
            processSettings(settings);
          });
        } catch (e) { console.warn('Popup refresh failed:', e); }
      }
    }
  });
  
  // RaidTick functionality
  if (raidTickRescanBtn && raidTickFolderInput) {
    raidTickRescanBtn.addEventListener('click', function() {
      // Open file picker – in Chrome can select directory, in Firefox select multiple files
      raidTickFolderInput.value = '';
      raidTickFolderInput.click();
    });
    raidTickFolderInput.addEventListener('change', async function(e) {
      const files = Array.from(e.target.files || []);
      await rescanRaidTickFromFiles(files);
    });
  }
  prevDateBtn.addEventListener('click', function() {
    navigateToPrevDate();
  });
  
  nextDateBtn.addEventListener('click', function() {
    navigateToNextDate();
  });
  
  
  /**
   * Load RaidTick files for the current selected date
   */
  async function loadRaidTickFiles() {
    try {
      browser.storage.sync.get(['raidTickFileList', 'raidTickFolder']).then(function(result) {
        const dbg = document.getElementById('raidTickDebugLog');
        const log = (msg) => {
          if (!dbg) return;
          dbg.style.display = 'block';
          const div = document.createElement('div');
          div.textContent = msg;
          dbg.appendChild(div);
          // keep last 20
          while (dbg.children.length > 20) dbg.removeChild(dbg.firstChild);
          dbg.scrollTop = dbg.scrollHeight;
        };
        
        if (!result.raidTickFileList || result.raidTickFileList.length === 0) {
          console.log('[RaidTick] No files found in storage');
          log('No files found in storage');
          showEmptyState();
          return;
        }
        
        console.log('[RaidTick] Loaded from storage:', result.raidTickFileList.length, 'files');
        log(`Loaded ${result.raidTickFileList.length} files from storage`);
        // Log a preview of dates for debugging
        try {
          const preview = result.raidTickFileList.slice(0, 5).map(f => ({ name: f.name, date: formatDate(f.date) }));
          console.log('[RaidTick] Date preview (first 5):', preview);
          log('Preview: ' + JSON.stringify(preview));
        } catch (_) {}
        
        // Update available dates - prefer precomputed local dateStr when present
        availableDates = [...new Set(result.raidTickFileList.map(file => file.dateStr ? file.dateStr : formatDate(file.date)))].sort();
        
        // Always start with today's date
        const today = formatDate(currentSelectedDate);
        console.log('[RaidTick] Today (local):', today);
        log('Today: ' + today);
        console.log('[RaidTick] Available dates:', availableDates);
        log('Available: ' + JSON.stringify(availableDates));
        
        // Update current date display
        updateDateDisplay();
        
        // Filter files for current date
        const todaysFiles = result.raidTickFileList.filter(file => (file.dateStr ? file.dateStr : formatDate(file.date)) === today);
        console.log('[RaidTick] Files for today:', todaysFiles.length);
        log(`Files for today: ${todaysFiles.length}`);
        
        if (todaysFiles.length > 0) {
          displayRaidTickFiles(todaysFiles);
        } else {
          showEmptyState();
        }
      }).catch(function(error) {
        console.error('Storage error:', error);
        const dbg = document.getElementById('raidTickDebugLog');
        if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'Storage error: ' + error.message; }
        showEmptyState();
      });
    } catch (error) {
      console.error('Error loading RaidTick files:', error);
      const dbg = document.getElementById('raidTickDebugLog');
      if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'Error: ' + error.message; }
      showEmptyState();
    }
  }

  // Rescan helper: build metadata from user-selected files and save to storage
  async function rescanRaidTickFromFiles(files) {
    try {
      const dbg = document.getElementById('raidTickDebugLog');
      const log = (m) => { if (!dbg) return; dbg.style.display='block'; const d=document.createElement('div'); d.textContent=m; dbg.appendChild(d); while(dbg.children.length>20) dbg.removeChild(dbg.firstChild); dbg.scrollTop=dbg.scrollHeight; };
      if (!files || files.length === 0) { log('Rescan: no files selected'); return; }
      const pattern = /^RaidTick-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/;
      const meta = [];
      files.forEach(f => {
        if (pattern.test(f.name)) {
          const ds = extractDateStrFromFilename(f.name);
          meta.push({ name: f.name, size: f.size, dateStr: ds });
        }
      });
      if (meta.length === 0) { log('Rescan: no RaidTick files matched'); return; }
      log(`Rescan: saving ${meta.length} files`);
      await browser.storage.sync.set({ raidTickFileList: meta });
      // reload view
      currentSelectedDate = new Date();
      loadRaidTickFiles();
    } catch (err) {
      console.error('Rescan error:', err);
    }
  }

  function extractDateStrFromFilename(name) {
    const m = name.match(/RaidTick-(\d{4})-(\d{2})-(\d{2})_\d{2}-\d{2}-\d{2}\.txt$/);
    if (!m) return formatDate(new Date());
    const [ , y, mo, d ] = m;
    return `${y}-${mo}-${d}`;
  }
  
  /**
   * Display RaidTick files in the UI
   */
  function displayRaidTickFiles(files) {
    const filesHtml = files.map(file => `
      <div class="file-item">
        <div class="file-name">${file.name}</div>
        <button class="btn btn-small copy-btn" data-filename="${file.name}">Copy</button>
      </div>
    `).join('');
    
    raidTickFilesDiv.innerHTML = filesHtml;
    
    // Add click listeners to copy buttons
    raidTickFilesDiv.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const filename = this.dataset.filename;
        copyFileToClipboard(filename);
      });
    });
  }
  
  /**
   * Update date display and navigation buttons
   */
  function updateDateDisplay() {
    const today = formatDate(currentSelectedDate);
    currentDateSpan.textContent = today;
    
    // Always enable navigation buttons - allow browsing any date
    prevDateBtn.disabled = false;
    nextDateBtn.disabled = false;
  }
  
  /**
   * Format date as YYYY-MM-DD
   */
  function formatDate(date) {
    // Normalize to a Date object
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) {
      console.error('Invalid date format:', date);
      return 'Invalid Date';
    }
    // Build YYYY-MM-DD using LOCAL time components to avoid UTC day shifting
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  
  /**
   * Show empty state when no files are found
   */
  function showEmptyState() {
    raidTickFilesDiv.innerHTML = '<div class="empty-state">No RaidTick files for this day.</div>';
  }
  
  /**
   * Navigate to previous date
   */
  function navigateToPrevDate() {
    // Move to previous day
    const prevDate = new Date(currentSelectedDate);
    prevDate.setDate(prevDate.getDate() - 1);
    currentSelectedDate = prevDate;
    updateDateDisplay();
    loadRaidTickFiles();
  }
  
  /**
   * Navigate to next date
   */
  function navigateToNextDate() {
    // Move to next day
    const nextDate = new Date(currentSelectedDate);
    nextDate.setDate(nextDate.getDate() + 1);
    currentSelectedDate = nextDate;
    updateDateDisplay();
    loadRaidTickFiles();
  }
  
  
  /**
   * Copy file content to clipboard
   */
  async function copyFileToClipboard(filename) {
    try {
      browser.storage.sync.get(['raidTickFileList']).then(function(result) {
        if (!result.raidTickFileList) {
          return;
        }
        
        const file = result.raidTickFileList.find(f => f.name === filename);
        if (!file) {
          return;
        }
        
        // If content is stored in settings, use it (legacy mode)
        if (file.content) {
          navigator.clipboard.writeText(file.content).then(() => {
            // Count lines (excluding header row)
            const lines = file.content.split('\n');
            const dataLines = lines.filter(line => line.trim() && !line.includes('RaidTick') && !line.includes('Date:') && !line.includes('Time:'));
            const lineCount = dataLines.length;
            
            // Show success feedback in status area
            const originalStatus = statusText.innerHTML;
            statusDiv.className = 'status success';
            statusText.innerHTML = `
              ✅ File copied to clipboard!<br>
              <small>${lineCount} lines copied (excluding header)</small>
            `;
            
            // Show success feedback on button
            const copyBtn = document.querySelector(`[data-filename="${filename}"]`);
            if (copyBtn) {
              const originalText = copyBtn.textContent;
              copyBtn.textContent = 'Copied!';
              copyBtn.style.backgroundColor = '#28a745';
              setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.backgroundColor = '';
              }, 1000);
            }
            
            // Restore original status after 3 seconds
            setTimeout(() => {
              statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
              statusText.innerHTML = originalStatus;
            }, 3000);
            
          }).catch(err => {
            alert('Failed to copy to clipboard. Please try again.');
          });
        } else {
          // No content stored – prompt user to pick the file on demand (Firefox-friendly)
          const picker = document.createElement('input');
          picker.type = 'file';
          picker.accept = '.txt';
          picker.style.display = 'none';
          document.body.appendChild(picker);
          
          picker.addEventListener('change', () => {
            const selected = picker.files && picker.files[0];
            if (!selected) {
              document.body.removeChild(picker);
              return;
            }
            
            // Verify filename matches the requested one
            if (selected.name !== filename) {
              alert(`Selected file (${selected.name}) does not match ${filename}. Please select the correct file.`);
              document.body.removeChild(picker);
              return;
            }
            
            // Read and copy
            const reader = new FileReader();
            reader.onload = () => {
              const content = reader.result || '';
              navigator.clipboard.writeText(content).then(() => {
                // Success feedback
                const lines = content.split('\n');
                const dataLines = lines.filter(line => line.trim() && !line.includes('RaidTick') && !line.includes('Date:') && !line.includes('Time:'));
                const lineCount = dataLines.length;
                const originalStatus = statusText.innerHTML;
                statusDiv.className = 'status success';
                statusText.innerHTML = `✅ File copied to clipboard!<br><small>${lineCount} lines copied (excluding header)</small>`;
                setTimeout(() => {
                  statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
                  statusText.innerHTML = originalStatus;
                }, 3000);
              }).catch(() => {
                alert('Failed to copy to clipboard. Please try again.');
              }).finally(() => {
                document.body.removeChild(picker);
              });
            };
            reader.onerror = () => {
              alert('Failed to read file.');
              document.body.removeChild(picker);
            };
            reader.readAsText(selected);
          }, { once: true });
          
          // Trigger picker
          picker.click();
        }
      }).catch(function(error) {
        console.error('Storage error:', error);
      });
    } catch (error) {
      console.error('Error copying file to clipboard:', error);
      alert('Error copying file. Please try again.');
    }
  }
  
  /**
   * EverQuest Log Parser Functions
   */
  
  let eqLogMonitoringInterval = null;
  let eqLogSettings = {};
  
  /**
   * Debug logging function - shows messages in popup UI
   */
  function debugLog(message, type = 'info') {
    const debugLogDiv = document.getElementById('eqLogDebugLog');
    if (!debugLogDiv) return;
    
    // Show debug log div
    debugLogDiv.style.display = 'block';
    
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    const logEntry = document.createElement('div');
    logEntry.style.marginBottom = '2px';
    logEntry.style.padding = '2px 4px';
    logEntry.style.color = type === 'error' ? '#c62828' : type === 'success' ? '#2e7d32' : '#333';
    logEntry.style.backgroundColor = type === 'error' ? '#ffebee' : type === 'success' ? '#e8f5e9' : '#fff';
    logEntry.textContent = `[${timestamp}] ${prefix} ${message}`;
    
    // Find the content area (after the "Debug Log:" header)
    const contentArea = debugLogDiv.querySelector('.debug-content') || (() => {
      const div = document.createElement('div');
      div.className = 'debug-content';
      debugLogDiv.appendChild(div);
      return div;
    })();
    
    contentArea.appendChild(logEntry);
    
    // Keep only last 15 messages
    while (contentArea.children.length > 15) {
      contentArea.removeChild(contentArea.firstChild);
    }
    
    // Auto-scroll to bottom
    debugLogDiv.scrollTop = debugLogDiv.scrollHeight;
    
    // Also log to console
    console.log(`[EQ Log Debug] ${message}`);
  }
  
  /**
   * Initialize EQ Log Parser
   */
  async function initializeEQLogParser(settings) {
    debugLog('Initializing EQ Log Parser...');
    // Auto-enabled for Raid Leader profile
    const isRaidLeader = settings.soundProfile === 'raidleader';
    
    // Load saved events and tag from storage
    const storedData = await browser.storage.sync.get(['eqLogEvents', 'eqLogTag','eqLogFileMeta']);
    
    eqLogSettings = {
      enabled: isRaidLeader, // Always enabled for Raid Leader, disabled for Raider
      fileHandle: null, // Will be set when user selects file in popup
      tag: (storedData.eqLogTag || settings.eqLogTag || 'FG').trim(),
      events: storedData.eqLogEvents || [],
      monitoring: settings.eqLogMonitoring || false
    };
    
    // Update UI
    const tagInput = document.getElementById('eqLogTag');
    if (tagInput) {
      tagInput.value = eqLogSettings.tag;
    }
    
    // Update file name display (will be updated again if we recover a file)
    updateFileNameDisplay();
    
    // Check and clear old events (midnight clearing)
    checkAndClearOldEvents();
    
    // Load and display existing events
    displayEQLogEvents();
    
    // Set up file selection
    const fileInput = document.getElementById('eqLogFileInput');
    const selectBtn = document.getElementById('selectEQLogFile');
    if (fileInput && selectBtn) {
      debugLog('File input and button found, setting up...');
      
      // Check if file input already has a file (popup may have closed during file selection)
      // Do this check both immediately and after delays to catch various timing scenarios
      const recoverFileFromInput = () => {
        debugLog(`Checking file input... Has files: ${fileInput.files ? fileInput.files.length : 0}`);
        
        if (fileInput.files && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          debugLog(`Found file in input: ${file.name} (${file.size} bytes)`);
          debugLog(`Current handle: ${eqLogSettings.fileHandle ? eqLogSettings.fileHandle.name + ' exists' : 'NONE'}`);
          
          // Only recover if we don't already have a handle, or if the file is different
          if (!eqLogSettings.fileHandle || eqLogSettings.fileHandle.name !== file.name) {
            debugLog(`Recovering file: ${file.name}`, 'success');
            // Store file handle immediately
            eqLogSettings.fileHandle = file;
            updateFileNameDisplay();
            
            // Show feedback
            if (statusDiv && statusText) {
              const originalStatus = statusText.innerHTML;
              statusDiv.className = 'status success';
              statusText.innerHTML = `✅ Log file restored: ${file.name}`;
              setTimeout(() => {
                if (statusText && statusDiv) {
                  statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
                  statusText.innerHTML = originalStatus;
                }
              }, 2000);
            }
            return true;
          } else {
            debugLog('File already stored, skipping recovery');
          }
        } else {
          debugLog('File input has no files');
        }
        return false;
      };
      
      debugLog('Starting file recovery checks...');
      // Check immediately
      recoverFileFromInput();
      
      // Also check after brief delays (file input might not be ready immediately)
      setTimeout(() => {
        debugLog('Recovery check at 100ms...');
        recoverFileFromInput();
      }, 100);
      setTimeout(() => {
        debugLog('Recovery check at 300ms...');
        recoverFileFromInput();
      }, 300);
      setTimeout(() => {
        debugLog('Recovery check at 500ms...');
        recoverFileFromInput();
      }, 500);
      
      selectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Firefox: open tiny loot window; Chrome can keep file input behavior
        if (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox')) {
          debugLog('Opening loot picker window (Firefox)', 'success');
          browser.windows.create({
            url: browser.runtime.getURL('eqlog-window.html'),
            type: 'popup', width: 480, height: 280
          });
        } else {
          try { fileInput.click(); } catch(_) {}
        }
      });
      
      // Use both 'change' and 'input' events for better compatibility
      fileInput.addEventListener('change', (e) => {
        debugLog('CHANGE event fired on file input!', 'success');
        e.preventDefault();
        e.stopPropagation();
        handleEQLogFileSelection(e);
      });
      fileInput.addEventListener('input', (e) => {
        debugLog('INPUT event fired on file input!', 'success');
        e.preventDefault();
        e.stopPropagation();
        handleEQLogFileSelection(e);
      });
      
      // Also listen for focus events as a fallback
      fileInput.addEventListener('focus', () => {
        debugLog('File input FOCUSED');
        // Check if file exists when input is focused (might happen after dialog closes)
        setTimeout(() => {
          debugLog('Checking file input after focus...');
          if (fileInput.files && fileInput.files.length > 0 && !eqLogSettings.fileHandle) {
            debugLog('File found on focus, recovering...', 'success');
            recoverFileFromInput();
          }
        }, 200);
      });
      
      // Add a more aggressive recovery mechanism
      // Check for files every 500ms for the first 5 seconds after popup opens
      let recoveryAttempts = 0;
      const maxRecoveryAttempts = 10;
      const recoveryInterval = setInterval(() => {
        recoveryAttempts++;
        debugLog(`Recovery attempt ${recoveryAttempts}/${maxRecoveryAttempts}...`);
        
        if (fileInput.files && fileInput.files.length > 0) {
          debugLog(`File found during recovery attempt ${recoveryAttempts}!`, 'success');
          recoverFileFromInput();
          clearInterval(recoveryInterval);
        } else if (recoveryAttempts >= maxRecoveryAttempts) {
          debugLog('Recovery attempts exhausted', 'error');
          clearInterval(recoveryInterval);
        }
      }, 500);
      
      debugLog('All event listeners attached');
    } else {
      debugLog('ERROR: File input or button not found!', 'error');
    }
    
    // Set up tag input
    if (tagInput) {
      tagInput.addEventListener('change', function() {
        eqLogSettings.tag = this.value.trim() || 'FG';
        browser.storage.sync.set({ eqLogTag: eqLogSettings.tag });
      });
    }
    
    // Set up toggle button
    const toggleBtn = document.getElementById('eqLogMonitoringToggle');
    if (toggleBtn) {
      toggleBtn.checked = eqLogSettings.monitoring;
      toggleBtn.addEventListener('change', function() {
        eqLogSettings.monitoring = this.checked;
        if (this.checked) {
          startEQLogMonitoring();
        } else {
          stopEQLogMonitoring();
        }
        browser.storage.sync.set({ eqLogMonitoring: this.checked });
      });
      
      // If monitoring was active, start it
      if (eqLogSettings.monitoring) {
        startEQLogMonitoring();
      }
    }
    
    // Set up scan button
    const fetchBtn = document.getElementById('fetchLastLoot');
    if (fetchBtn) {
      fetchBtn.addEventListener('click', scanForLastLootLine);
    }
  }
  
  /**
   * Handle file selection in popup
   */
  async function handleEQLogFileSelection(event) {
    debugLog('handleEQLogFileSelection called');
    debugLog(`Event target: ${event.target ? event.target.id : 'null'}`);
    
    // Get file from event - try multiple ways to be defensive
    const fileInput = event.target || document.getElementById('eqLogFileInput');
    debugLog(`File input element: ${fileInput ? 'found' : 'NOT FOUND'}`);
    
    if (fileInput) {
      debugLog(`File input has files: ${fileInput.files ? fileInput.files.length : 'null/undefined'}`);
    }
    
    const file = (fileInput && fileInput.files && fileInput.files.length > 0) ? fileInput.files[0] : null;
    
    if (!file) {
      debugLog('WARNING: Event fired but no file found!', 'error');
      // Try to get it from the input directly as fallback
      const fileInputElement = document.getElementById('eqLogFileInput');
      if (fileInputElement) {
        debugLog(`Fallback: Checking fileInputElement, has files: ${fileInputElement.files ? fileInputElement.files.length : 'none'}`);
        if (fileInputElement.files && fileInputElement.files.length > 0) {
          const recoveredFile = fileInputElement.files[0];
          debugLog(`Fallback recovery successful: ${recoveredFile.name}`, 'success');
          processSelectedFile(recoveredFile);
          return;
        }
      }
      debugLog('No file found in any location', 'error');
      return;
    }
    
    debugLog(`File found in event: ${file.name} (${file.size} bytes)`, 'success');
    processSelectedFile(file);
  }
  
  /**
   * Process and store selected file
   */
  async function processSelectedFile(file) {
    debugLog(`Processing file: ${file.name} (${file.size} bytes)`, 'success');
    
    // Store file handle immediately
    eqLogSettings.fileHandle = file;
    debugLog(`File handle stored in memory: ${eqLogSettings.fileHandle ? eqLogSettings.fileHandle.name : 'FAILED'}`);
    
    updateFileNameDisplay();
    debugLog('File name display updated');
    
    // Store file metadata in browser storage as backup
    try {
      await browser.storage.sync.set({
        eqLogFileMeta: {
          name: file.name,
          lastModified: file.lastModified,
          parity: file.size.toString().substring(0, 10) // Store first 10 digits of size as verification
        }
      });
      debugLog('File metadata saved to storage successfully', 'success');
    } catch (error) {
      debugLog(`ERROR saving metadata: ${error.message}`, 'error');
    }
    
    // Show success feedback
    if (statusDiv && statusText) {
      const originalStatus = statusText.innerHTML;
      statusDiv.className = 'status success';
      statusText.innerHTML = `✅ Log file selected: ${file.name}`;
      setTimeout(() => {
        if (statusText && statusDiv) {
          statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
          statusText.innerHTML = originalStatus;
        }
      }, 2000);
    }
    
    debugLog('File selection process complete!', 'success');
  }
  
  /**
   * Update file name display
   */
  function updateFileNameDisplay() {
    const fileNameSpan = document.getElementById('eqLogFileName');
    if (fileNameSpan) {
      if (eqLogSettings.fileHandle) {
        fileNameSpan.textContent = eqLogSettings.fileHandle.name;
        fileNameSpan.style.color = '#4caf50';
      } else if (eqLogSettings && eqLogSettings.fileName) {
        fileNameSpan.textContent = eqLogSettings.fileName;
        fileNameSpan.style.color = '#4caf50';
      } else {
        fileNameSpan.textContent = 'No file selected';
        fileNameSpan.style.color = '#666';
      }
    }
  }
  
  /**
   * Start monitoring EQ log file
   */
  function startEQLogMonitoring() {
    if (eqLogMonitoringInterval) {
      return; // Already monitoring
    }
    
    if (!eqLogSettings.fileHandle || !eqLogSettings.tag) {
      console.error('Cannot start monitoring: file or tag not set');
      if (statusDiv && statusText) {
        const originalStatus = statusText.innerHTML;
        statusDiv.className = 'status inactive';
        statusText.innerHTML = '⚠️ Please select a log file first';
        setTimeout(() => {
          statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
          statusText.innerHTML = originalStatus;
        }, 3000);
      }
      return;
    }
    
    console.log('Starting EQ log monitoring');
    eqLogSettings.monitoring = true;
    
    // Monitor every 3 seconds
    eqLogMonitoringInterval = setInterval(() => {
      scanForLastLootLine(true); // true = silent monitoring mode
    }, 3000);
    
    // Also do an immediate check
    scanForLastLootLine(true);
  }
  
  /**
   * Stop monitoring EQ log file
   */
  function stopEQLogMonitoring() {
    if (eqLogMonitoringInterval) {
      clearInterval(eqLogMonitoringInterval);
      eqLogMonitoringInterval = null;
    }
    eqLogSettings.monitoring = false;
    console.log('Stopped EQ log monitoring');
  }
  
  /**
   * Scan file from end backwards for last matching loot line
   * @param {boolean} silent - If true, don't show UI feedback (for monitoring)
   */
  async function scanForLastLootLine(silent = false) {
    if (!eqLogSettings.fileHandle) {
      if (!silent && statusDiv && statusText) {
        const originalStatus = statusText.innerHTML;
        statusDiv.className = 'status inactive';
        statusText.innerHTML = '⚠️ Please select a log file first';
        setTimeout(() => {
          statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
          statusText.innerHTML = originalStatus;
        }, 3000);
      }
      return;
    }
    
    if (!eqLogSettings.tag) {
      if (!silent && statusDiv && statusText) {
        const originalStatus = statusText.innerHTML;
        statusDiv.className = 'status inactive';
        statusText.innerHTML = '⚠️ Please set a loot tag (e.g., FG)';
        setTimeout(() => {
          statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
          statusText.innerHTML = originalStatus;
        }, 3000);
      }
      return;
    }
    
    try {
      // Show loading state if not silent
      const fetchBtn = document.getElementById('fetchLastLoot');
      const originalBtnText = fetchBtn ? fetchBtn.textContent : '🔍 Scan';
      if (fetchBtn && !silent) {
        fetchBtn.disabled = true;
        fetchBtn.textContent = '⏳ Scanning...';
      }
      
      // Read the file
      const file = eqLogSettings.fileHandle;
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')));
        reader.readAsText(file);
      });
      
      console.log('File read, searching backward for loot line with tag:', eqLogSettings.tag);
      
      // Find the last matching line (search from end backwards)
      const lines = content.split('\n');
      let lastMatchingLine = null;
      
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line && detectLootLine(line, eqLogSettings.tag)) {
          lastMatchingLine = line;
          break;
        }
      }
      
      if (!lastMatchingLine) {
        // No matching line found
        if (!silent) {
          const originalStatus = statusText.innerHTML;
          statusDiv.className = 'status inactive';
          statusText.innerHTML = `ℹ️ No loot lines found with tag: ${eqLogSettings.tag}`;
          setTimeout(() => {
            statusText.innerHTML = originalStatus;
          }, 3000);
        }
        
        if (fetchBtn && !silent) {
          fetchBtn.disabled = false;
          fetchBtn.textContent = originalBtnText;
        }
        return;
      }
      
      console.log('Found matching line:', lastMatchingLine.substring(0, 100) + '...');
      
      // Parse the line
      const items = extractItems(lastMatchingLine, eqLogSettings.tag);
      console.log('Extracted items:', items);
      
      if (!items || items.length === 0) {
        if (!silent) {
          const originalStatus = statusText.innerHTML;
          statusDiv.className = 'status inactive';
          statusText.innerHTML = '⚠️ Found line but no items extracted. Check tag and format.';
          setTimeout(() => {
            statusText.innerHTML = originalStatus;
          }, 3000);
        }
        
        if (fetchBtn && !silent) {
          fetchBtn.disabled = false;
          fetchBtn.textContent = originalBtnText;
        }
        return;
      }
      
      // Check if this event already exists (by comparing log line)
      const existingEvent = eqLogSettings.events.find(event => event.logLine === lastMatchingLine);
      if (existingEvent) {
        if (!silent) {
          const originalStatus = statusText.innerHTML;
          statusDiv.className = 'status inactive';
          statusText.innerHTML = 'ℹ️ This loot line is already captured';
          setTimeout(() => {
            statusText.innerHTML = originalStatus;
          }, 2000);
        }
        
        if (fetchBtn && !silent) {
          fetchBtn.disabled = false;
          fetchBtn.textContent = originalBtnText;
        }
        return;
      }
      
      // Create new event
      const timestamp = extractTimestamp(lastMatchingLine);
      const today = formatDate(new Date());
      
      const event = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        timestamp: timestamp,
        date: today,
        items: items,
        logLine: lastMatchingLine
      };
      
      // Add to events
      eqLogSettings.events.push(event);
      await saveEQLogEvents();
      displayEQLogEvents();
      
      // Show success feedback
      if (!silent && statusDiv && statusText) {
        const originalStatus = statusText.innerHTML;
        statusDiv.className = 'status success';
        statusText.innerHTML = `✅ Found ${items.length} items from last loot line!`;
        setTimeout(() => {
          statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
          statusText.innerHTML = originalStatus;
        }, 2000);
      }
      
      if (fetchBtn && !silent) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = originalBtnText;
      }
    } catch (error) {
      console.error('Error scanning log file:', error);
      
      if (!silent && statusDiv && statusText) {
        const originalStatus = statusText.innerHTML;
        statusDiv.className = 'status inactive';
        statusText.innerHTML = '❌ Error: ' + (error.message || 'Failed to read log file');
        setTimeout(() => {
          statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
          statusText.innerHTML = originalStatus;
        }, 4000);
      }
      
      const fetchBtn = document.getElementById('fetchLastLoot');
      if (fetchBtn && !silent) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = '🔍 Scan';
      }
    }
  }
  
  
  /**
   * Detect if line contains loot tag
   * Tag must appear before any delimiter (pipe or comma)
   */
  function detectLootLine(line, tag) {
    if (!tag || !line) return false;
    
    // Case-insensitive search for tag
    const lowerLine = line.toLowerCase();
    const lowerTag = tag.toLowerCase();
    
    const tagIndex = lowerLine.indexOf(lowerTag);
    if (tagIndex === -1) return false;
    
    // Tag must appear before any delimiter (pipe or comma)
    const pipeIndex = lowerLine.indexOf('|');
    const commaIndex = lowerLine.indexOf(',');
    
    // If pipe exists and tag is after it, invalid
    if (pipeIndex !== -1 && tagIndex > pipeIndex) return false;
    // If comma exists and tag is after it, invalid
    if (commaIndex !== -1 && tagIndex > commaIndex) return false;
    
    return true;
  }
  
  /**
   * Extract items from loot line
   * Supports both pipe (|) and comma (,) delimiters
   */
  function extractItems(line, tag) {
    if (!line || !tag) return [];
    
    // Find tag position (case-insensitive)
    const lowerLine = line.toLowerCase();
    const lowerTag = tag.toLowerCase();
    let tagIndex = lowerLine.indexOf(lowerTag);
    
    if (tagIndex === -1) return [];
    
    // Find the text after the tag, extract until closing quote or end
    // Look for the quote that contains the tag
    const afterTag = line.substring(tagIndex);
    
    // Find opening quote before tag
    let startIndex = line.lastIndexOf("'", tagIndex);
    // Find closing quote AFTER the tag (start search after tag ends)
    let endIndex = line.indexOf("'", tagIndex + tag.length);
    
    let lootText = '';
    
    // If quotes are found and properly positioned, extract text between them (after the\ tag)
    if (startIndex !== -1 && endIndex !== -1) {
      // Extract text after the tag within the quotes
      lootText = line.substring(tagIndex + tag.length, endIndex).trim();
    } else {
      // If no quotes found, try to extract from tag to end of line
      const afterTagText = line.substring(tagIndex + tag.length).trim();
      lootText = afterTagText;
    }
    
    if (!lootText) return [];
    
    // Detect delimiter: prefer pipe if both are present, otherwise use whichever is found
    const hasPipe = lootText.includes('|');
    const hasComma = lootText.includes(',');
    
    let items = [];
    
    if (!hasPipe && !hasComma) {
      // No delimiter found - treat as single item
      items = [lootText.trim()];
    } else {
      // Split by detected delimiter (prefer pipe if both are present)
      const delimiter = hasPipe ? '|' : ',';
      items = lootText.split(delimiter).map(item => item.trim());
    }
    
    // Clean up items: remove tag if present and filter out empty items
    return items
      .map(item => {
        // Remove tag if it appears in the item (at start or anywhere)
        return item.replace(new RegExp('^' + tag + '\\s*', 'gi'), '').trim();
      })
      .filter(item => {
        // Filter out empty items and items that only contain the tag
        const cleanItem = item.replace(new RegExp(tag, 'gi'), '').trim();
        return cleanItem && cleanItem.length > 0;
      });
  }
  
  /**
   * Extract timestamp from log line
   */
  function extractTimestamp(line) {
    // EQ log format: [Mon Oct 27 22:57:16 2025] ...
    const match = line.match(/\[([^\]]+)\]/);
    if (match) {
      return match[1]; // Return the timestamp string
    }
    // Fallback to current time
    return new Date().toLocaleString();
  }
  
  /**
   * Check and clear events from previous days
   */
  function checkAndClearOldEvents() {
    const today = formatDate(new Date());
    const initialLength = eqLogSettings.events.length;
    
    eqLogSettings.events = eqLogSettings.events.filter(event => event.date === today);
    
    if (eqLogSettings.events.length !== initialLength) {
      console.log(`Cleared ${initialLength - eqLogSettings.events.length} old events`);
      saveEQLogEvents();
    }
  }
  
  /**
   * Display EQ log events
   */
  function displayEQLogEvents() {
    const eventsContainer = document.getElementById('eqLogEvents');
    if (!eventsContainer) return;
    const eqSection = document.getElementById('eqLogSection');
    
    // Filter to today's events and sort by timestamp (newest first)
    const today = formatDate(new Date());
    const todaysEvents = eqLogSettings.events
      .filter(event => event.date === today)
      .sort((a, b) => {
        // Sort by event ID (which includes timestamp), newest first
        // Since timestamps are strings like "Mon Oct 27 22:57:16 2025", just reverse array
        // Events are added with increasing IDs, so reverse gives newest first
        return 0; // Will reverse the array since we want newest first
      })
      .reverse();
    
    if (todaysEvents.length === 0) {
      eventsContainer.innerHTML = '<div class="empty-state">No loot events captured yet.</div>';
      if (eqSection) eqSection.style.display = 'none';
      return;
    }
    if (eqSection) eqSection.style.display = 'block';
    
    // Limit to 50 most recent events
    const displayEvents = todaysEvents.slice(0, 50);
    
    const eventsHtml = displayEvents.map(event => createEventGroup(event)).join('');
    eventsContainer.innerHTML = eventsHtml;
    
    // Add event listeners for copy and delete buttons
    eventsContainer.querySelectorAll('.eq-log-item-copy').forEach(btn => {
      btn.addEventListener('click', function() {
        const itemText = this.dataset.item;
        copyItemToClipboard(itemText);
      });
    });
    
    eventsContainer.querySelectorAll('.eq-log-event-close').forEach(btn => {
      btn.addEventListener('click', function() {
        const eventId = this.dataset.eventId;
        deleteEventGroup(eventId);
      });
    });
  }
  
  /**
   * Create HTML for an event group
   */
  function createEventGroup(event) {
    const itemsHtml = event.items.map((item, index) => 
      createItemButton(item, event.id, index)
    ).join('');
    
    return `
      <div class="eq-log-event" data-event-id="${event.id}">
        <div class="eq-log-event-header">
          <span class="eq-log-event-timestamp">${event.timestamp}</span>
          <button class="eq-log-event-close" data-event-id="${event.id}" title="Remove">×</button>
        </div>
        <div class="eq-log-items">
          ${itemsHtml}
        </div>
      </div>
    `;
  }
  
  /**
   * Create HTML for an item copy button
   */
  function createItemButton(item, eventId, itemIndex) {
    return `
      <div class="eq-log-item">
        <span class="eq-log-item-name">${escapeHtml(item)}</span>
        <button class="btn btn-small eq-log-item-copy" data-item="${escapeHtml(item)}" data-event-id="${eventId}" data-item-index="${itemIndex}">Copy</button>
      </div>
    `;
  }
  
  /**
   * Copy item to clipboard
   */
  function copyItemToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Item copied to clipboard:', text);
      // Show success feedback in status area
      const originalStatus = statusText.innerHTML;
      statusDiv.className = 'status success';
      statusText.innerHTML = `
        ✅ Item copied to clipboard!<br>
        <small>${escapeHtml(text)}</small>
      `;
      
      // Restore original status after 2 seconds
      setTimeout(() => {
        statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
        statusText.innerHTML = originalStatus;
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy to clipboard:', err);
      alert('Failed to copy to clipboard. Please try again.');
    });
  }
  
  /**
   * Delete an event group
   */
  async function deleteEventGroup(eventId) {
    eqLogSettings.events = eqLogSettings.events.filter(event => event.id !== eventId);
    await saveEQLogEvents();
    displayEQLogEvents();
  }
  
  /**
   * Save EQ log events to storage
   */
  async function saveEQLogEvents() {
    try {
      await browser.storage.sync.set({
        eqLogEvents: eqLogSettings.events
      });
    } catch (error) {
      console.error('Error saving EQ log events:', error);
    }
  }
  
  
  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
