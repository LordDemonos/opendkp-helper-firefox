// Popup script for OpenDKP Helper

// Customizable popup text - modify this before production
const POPUP_QUICK_ACTIONS_TEXT = `Quick Actions:
• Click "Open Settings" to configure RaidTick integration
• Use date navigation to browse RaidTick files
• Click "Copy" to copy file contents to clipboard`;

document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup loaded - Firefox debug');
  
  const statusDiv = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const openOptionsBtn = document.getElementById('openOptions');
  const refreshPopupBtn = document.getElementById('refreshPopup');
  const raidTickSection = document.getElementById('raidTickSection');
  const currentDateSpan = document.getElementById('currentDate');
  const prevDateBtn = document.getElementById('prevDate');
  const nextDateBtn = document.getElementById('nextDate');
  const raidTickFilesDiv = document.getElementById('raidTickFiles');
  const refreshFilesBtn = document.getElementById('refreshFiles');
  
  let currentSelectedDate = new Date();
  let raidTickFiles = [];
  let availableDates = [];
  
  // Force immediate visual update
  console.log('Popup script loaded - Firefox debug');
  
  // Add a visible indicator that the popup loaded
  setTimeout(() => {
    const currentDateSpan = document.getElementById('currentDate');
    if (currentDateSpan && currentDateSpan.textContent === 'Today') {
      currentDateSpan.textContent = 'Loading...';
      currentDateSpan.style.color = 'orange';
    }
  }, 100);
  
  // Safety timeout to prevent stuck loading state
  setTimeout(() => {
    const currentDateSpan = document.getElementById('currentDate');
    if (currentDateSpan && currentDateSpan.textContent === 'Loading...') {
      console.log('Loading timeout - forcing fallback');
      currentDateSpan.textContent = 'Error';
      currentDateSpan.style.color = 'red';
    }
  }, 5000);
  
  // Load current settings and update UI
  // Firefox compatibility - use browser API directly
  const api = typeof browser !== 'undefined' ? browser : chrome;
  
  api.storage.sync.get([
    'soundProfile',
    'soundType',
    'volume',
    'enableTTS',
    'smartBidding',
    'quietHours',
    'browserNotifications',
    'flashScreen',
    'raidTickEnabled',
    'raidTickFolder',
    'raidTickFolderHandle',
    'raidTickFiles',
    'raidTickFileList'
  ], function(settings) {
    // Handle storage API errors gracefully
    if (api.runtime.lastError) {
      console.warn('Storage API error (Firefox development mode):', api.runtime.lastError.message);
      console.log('Using default settings for popup display');
      settings = {
        soundProfile: 'raidleader',
        soundType: 'bell',
        volume: 50,
        raidTickEnabled: false
      };
    }
    // Check if we're on an OpenDKP page
    api.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      const isOpenDKP = currentTab.url.includes('opendkp.com');
      
      // Update status based on OpenDKP page and settings
      const profile = settings.soundProfile || 'raidleader';
      const soundType = settings.soundType || 'bell';
      const volume = settings.volume || 50;
      
      if (isOpenDKP) {
        statusDiv.className = 'status active';
        statusText.innerHTML = `
          ✅ Active on OpenDKP<br>
          <small>Profile: ${profile} | Sound: ${soundType} | Volume: ${volume}%</small>
        `;
      } else {
        statusDiv.className = 'status inactive';
        if (settings.raidTickEnabled && settings.raidTickFolder) {
          statusText.innerHTML = `
            📁 RaidTick Mode<br>
            <small>Profile: ${profile} | Sound: ${soundType} | Volume: ${volume}%</small>
          `;
        } else {
          statusText.innerHTML = `
            ⚠️ Not on OpenDKP page<br>
            <small>Profile: ${profile} | Sound: ${soundType} | Volume: ${volume}%</small>
          `;
        }
      }
    });
    
    // Show/hide RaidTick section based on settings (independent of OpenDKP page)
    if (settings.raidTickEnabled && settings.raidTickFolder) {
      console.log('Showing RaidTick section - Firefox debug');
      raidTickSection.style.display = 'block';
      
      loadRaidTickFiles();
    } else {
      console.log('Hiding RaidTick section - Firefox debug');
      raidTickSection.style.display = 'none';
    }
    
    // Update quick actions text
    const infoDiv = document.querySelector('.info');
    if (infoDiv) {
      infoDiv.innerHTML = POPUP_QUICK_ACTIONS_TEXT.replace(/\n/g, '<br>');
    }
  });
  
  // Open options page
  openOptionsBtn.addEventListener('click', function() {
    api.runtime.openOptionsPage();
  });
  
  // Refresh popup
  refreshPopupBtn.addEventListener('click', function() {
    console.log('Manual refresh requested');
    location.reload();
  });
  
  // Listen for storage changes to refresh popup
  api.storage.onChanged.addListener(function(changes, namespace) {
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
    }
  });
  
  // RaidTick functionality
  prevDateBtn.addEventListener('click', function() {
    navigateToPreviousDate();
  });
  
  nextDateBtn.addEventListener('click', function() {
    navigateToNextDate();
  });
  
  refreshFilesBtn.addEventListener('click', function() {
    loadRaidTickFiles();
  });
  
  /**
   * Load RaidTick files for the current selected date
   */
  async function loadRaidTickFiles() {
    try {
      // Firefox debugging - show alert to confirm function is called
      console.log('loadRaidTickFiles called');
      
      // Firefox compatibility - use browser API directly
      const api = typeof browser !== 'undefined' ? browser : chrome;
      
      api.storage.sync.get(['raidTickFileList', 'raidTickFolder'], function(result) {
        // Firefox compatibility for error handling
        if (api.runtime.lastError) {
          console.warn('Storage API error (Firefox development mode):', api.runtime.lastError.message);
          showEmptyState();
          return;
        }
        
        console.log('Storage result:', result);
        
        if (!result.raidTickFileList || result.raidTickFileList.length === 0) {
          console.log('No RaidTick files found in storage');
          showEmptyState();
          return;
        }
        
        console.log('Found', result.raidTickFileList.length, 'RaidTick files');
        
        // Update available dates - convert Date objects to formatted strings
        availableDates = [...new Set(result.raidTickFileList.map(file => formatDate(file.date)))].sort();
        console.log('Available dates:', availableDates);
        
        // Set current date to first available date if we have files
        if (availableDates.length > 0) {
          currentSelectedDate = new Date(availableDates[0]);
          console.log('Set current date to:', currentSelectedDate);
          
          // Force immediate UI update
          const currentDateSpan = document.getElementById('currentDate');
          if (currentDateSpan) {
            currentDateSpan.textContent = formatDate(currentSelectedDate);
            currentDateSpan.style.color = 'black'; // Reset color
            console.log('Forced date display update to:', formatDate(currentSelectedDate));
          }
        }
        
        // Update current date display
        updateDateDisplay();
        
        // Filter files for current date - compare formatted date strings
        const today = formatDate(currentSelectedDate);
        const todaysFiles = result.raidTickFileList.filter(file => formatDate(file.date) === today);
        
        console.log('Looking for files on date:', today);
        console.log('Found files for today:', todaysFiles.length);
        
        if (todaysFiles.length > 0) {
          console.log('Displaying files');
          displayRaidTickFiles(todaysFiles);
        } else {
          console.log('Showing empty state');
          showEmptyState();
        }
      });
    } catch (error) {
      console.error('Error loading RaidTick files:', error);
      showEmptyState();
    }
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
    
    // Enable/disable navigation buttons
    const currentDateStr = formatDate(currentSelectedDate);
    const currentIndex = availableDates.indexOf(currentDateStr);
    
    prevDateBtn.disabled = currentIndex <= 0;
    nextDateBtn.disabled = currentIndex >= availableDates.length - 1;
  }
  
  /**
   * Format date as YYYY-MM-DD
   */
  function formatDate(date) {
    return date.toISOString().split('T')[0];
  }
  
  /**
   * Show empty state when no files are found
   */
  function showEmptyState() {
    raidTickFilesDiv.innerHTML = '<div class="empty-state">No RaidTick files for this day.</div>';
  }
  
  /**
   * Navigate to previous date with files
   */
  function navigateToPreviousDate() {
    const currentDateStr = formatDate(currentSelectedDate);
    const currentIndex = availableDates.indexOf(currentDateStr);
    
    if (currentIndex > 0) {
      const prevDateStr = availableDates[currentIndex - 1];
      currentSelectedDate = new Date(prevDateStr);
      updateDateDisplay();
      loadRaidTickFiles();
    }
  }
  
  /**
   * Navigate to next date with files
   */
  function navigateToNextDate() {
    const currentDateStr = formatDate(currentSelectedDate);
    const currentIndex = availableDates.indexOf(currentDateStr);
    
    if (currentIndex < availableDates.length - 1) {
      const nextDateStr = availableDates[currentIndex + 1];
      currentSelectedDate = new Date(nextDateStr);
      updateDateDisplay();
      loadRaidTickFiles();
    }
  }
  
  /**
   * Copy file content to clipboard
   */
  async function copyFileToClipboard(filename) {
    try {
      console.log('Copying file to clipboard:', filename);
      
      const api = typeof browser !== 'undefined' ? browser : chrome;
      api.storage.sync.get(['raidTickFileList'], function(result) {
        if (!result.raidTickFileList) {
          console.error('No RaidTick files found');
          return;
        }
        
        const file = result.raidTickFileList.find(f => f.name === filename);
        if (!file) {
          console.error('File not found:', filename);
          return;
        }
        
        // Read file content and copy to clipboard
        const reader = new FileReader();
        reader.onload = function(e) {
          navigator.clipboard.writeText(e.target.result).then(() => {
            console.log('File content copied to clipboard');
            // Show success feedback
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
          }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
          });
        };
        reader.readAsText(file.file);
      });
    } catch (error) {
      console.error('Error copying file to clipboard:', error);
    }
  }
});
