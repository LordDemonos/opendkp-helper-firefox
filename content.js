/**
 * OpenDKP Helper - Content Script
 * 
 * Monitors all auction timer progress bars on opendkp.com
 * Plays a notification chime when any timer reaches width: 0%
 * Uses MutationObserver to detect dynamically added timer bars
 */

(function() {
  'use strict';

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================
  
  const CONFIG = {
    // Target selector for timer progress bars
    TIMER_SELECTOR: '.p-progressbar-value.p-progressbar-value-animate',
    
    // Default settings (will be overridden by storage)
    CHECK_INTERVAL: 100,
    FLASH_SCREEN: true,
    VOLUME: 0.7,
    SOUND_TYPE: 'bell', // Default to bell for raid leader
    SOUND_PROFILE: 'raidleader', // Default to raid leader profile
    BROWSER_NOTIFICATIONS: true,
    SMART_BIDDING: false, // Will be enabled automatically for raider profile
    QUIET_HOURS: false,
    QUIET_START: '22:00',
    QUIET_END: '08:00',
    DISABLE_VISUALS: false,
    ENABLE_TTS: false,
    VOICE: '',
    VOICE_SPEED: 1.0,
    ENABLE_ADVANCED_TTS: false,
    TTS_TEMPLATE: 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}',
    RAID_LEADER_NOTIFICATION: true,
    // Auction readout defaults
    ANNOUNCE_NEW_AUCTIONS: false,
    ANNOUNCE_START: '19:00',
    ANNOUNCE_END: '23:59'
  };
  
  // Settings loaded from storage
  let settings = { ...CONFIG };
  
  // Browser API compatibility
  const api = typeof browser !== 'undefined' ? browser : chrome;

  // ===========================================================================
  // STATE MANAGEMENT
  // ===========================================================================
  
  // Track which timer bars have already triggered an alert
  // Uses WeakSet to allow garbage collection when elements are removed from DOM
  const alertedTimers = new WeakSet();
  // Track timers that we have seen with any progress (> 1%) so we only alert
  // for auctions we actually observed in progress
  const timersWithProgress = new WeakSet();
  
  // Storage for all currently monitored timer elements
  // Will be updated by MutationObserver and polling loop
  let allTimers = new Set();
  
  // Polling interval ID for cleanup
  let checkIntervalId = null;
  
  // Audio element for playing chime
  let audioElement = null;
  // Flag: have settings been loaded from storage at least once?
  let settingsLoaded = false;

  // Helper: announce a newly discovered auction if feature is enabled
  function maybeAnnounceNewAuction(timerElement) {
    try {
      // Suppress during navigation protection (e.g., switching back to the tab)
      if (navigationProtectionActive) {
        log('ReadAuctions: suppressed due to navigation protection');
        return;
      }
      // Avoid duplicate announcements for the same timer
      if (typeof announcedNewAuctions !== 'undefined' && announcedNewAuctions.has(timerElement)) return;
      // Only announce very fresh timers (width near 100%)
      const initialWidth = getWidthPercent(timerElement);
      if (initialWidth !== null && initialWidth < 99) {
        log('ReadAuctions: timer not fresh (width <99%), skipping', initialWidth);
        return;
      }
      const windowOk = isWithinAnnounceWindow();
      const quiet = isQuietHours();
      {
        const ctxPeek = extractTableContext(timerElement) || extractTimerContext(timerElement) || {};
        log('ReadAuctions: maybeAnnounce called', {
          settingsLoaded,
          ENABLE_TTS: settings.ENABLE_TTS,
          ANNOUNCE_NEW_AUCTIONS: settings.ANNOUNCE_NEW_AUCTIONS,
          windowOk,
          quiet,
          peekItem: ctxPeek.itemName || null
        });
      }
      {
        log('ReadAuctions check (observer):', {
          ttsEnabled: settings.ENABLE_TTS,
          featureEnabled: settings.ANNOUNCE_NEW_AUCTIONS,
          windowOk: windowOk,
          quietHours: quiet
        });
      }
      const featureEnabled = (settings.ANNOUNCE_NEW_AUCTIONS === true) ||
                             (settings.ANNOUNCE_NEW_AUCTIONS === undefined && settings.ENABLE_TTS);
      if (settingsLoaded && settings.ENABLE_TTS && featureEnabled && !quiet && windowOk) {
        const trySpeak = (attemptsLeft) => {
          const ctx = extractTableContext(timerElement) || extractTimerContext(timerElement);
          const name = ctx?.itemName && String(ctx.itemName).trim();
          if (name) {
            log('ReadAuctions: speaking item', name);
            speakAuctionItem(name);
            try { announcedNewAuctions.add(timerElement); } catch (_) {}
          } else if (attemptsLeft > 0) {
            log('ReadAuctions: item not found yet, retrying...', attemptsLeft);
            setTimeout(() => trySpeak(attemptsLeft - 1), 200);
          } else {
            // Final fallback: announce without an item name so users still get feedback
            log('ReadAuctions: giving up on item name, speaking generic');
            speakAuctionItem('a new item');
            try { announcedNewAuctions.add(timerElement); } catch (_) {}
          }
        };
        trySpeak(15); // retry for up to ~3s to allow DOM to populate
      } else {
        log('ReadAuctions: conditions not met', {
          settingsLoaded,
          ENABLE_TTS: settings.ENABLE_TTS,
          ANNOUNCE_NEW_AUCTIONS: settings.ANNOUNCE_NEW_AUCTIONS,
          resolvedFeatureEnabled: featureEnabled,
          windowOk,
          quiet
        });
      }
    } catch (_) {}
  }
  
  // Flag to prevent alerts during initialization
  let initializationComplete = false;
  
  // Track if we've already initialized on this page
  let pageInitialized = false;
  
  // During initial startup we suppress alerts for any timers that are
  // already completed (navigation protection). We'll only pre-mark in this
  // short window to avoid suppressing legitimate newly-completed timers.
  let navigationProtectionActive = false;
  // Track which timers were already announced as new to avoid duplicates
  const announcedNewAuctions = new WeakSet();
  // Across-DOM duplicate suppression for completed auctions
  const recentCompletedMap = new Map(); // signature -> timestamp
  const COMPLETED_SUPPRESS_MS = 10 * 60 * 1000; // 10 minutes

  function buildCompletionSignature(ctx) {
    const item = (ctx?.itemName || '').toLowerCase().trim();
    const winner = (ctx?.winner || '').toLowerCase().trim();
    const bid = ctx?.bidAmount || 0;
    return `${item}|${winner}|${bid}`;
  }

  function isRecentlyCompleted(signature) {
    const ts = recentCompletedMap.get(signature);
    if (!ts) return false;
    return (Date.now() - ts) < COMPLETED_SUPPRESS_MS;
  }

  function recordCompleted(signature) {
    recentCompletedMap.set(signature, Date.now());
    // prune occasionally
    if (recentCompletedMap.size > 200) {
      const now = Date.now();
      for (const [sig, t] of Array.from(recentCompletedMap.entries())) {
        if (now - t > COMPLETED_SUPPRESS_MS) recentCompletedMap.delete(sig);
      }
    }
  }
  
  // User's character names for smart bidding mode
  let userCharacterNames = [];

  // ===========================================================================
  // AUDIO NOTIFICATION SYSTEM
  // ===========================================================================
  
  /**
   * Load settings from storage
   */
  function loadSettings() {
    api.storage.sync.get({
      volume: 70,
      soundProfile: 'raidleader', // Default to raid leader
      soundType: 'bell', // Default to bell for raid leader
      raidLeaderSounds: 'bell',
      raiderSounds: 'chime',
      profileVolume: false,
      raidLeaderNotification: true, // New setting for browser notification
      customSounds: {},
      smartBidding: false, // Will be enabled automatically for raider profile
      quietHours: false,
      quietStart: '22:00',
      quietEnd: '08:00',
      // Read new auctions feature defaults
      announceAuctions: false,
      announceStart: '19:00',
      announceEnd: '23:59',
      enableTTS: false,
      voice: '',
      voiceSpeed: 1.0,
      enableAdvancedTTS: false,
      ttsTemplate: 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}',
      disableVisuals: false,
      flashScreen: true,
      browserNotifications: true,
      consoleLogs: true,
      checkInterval: 100
    }).then(function(storedSettings) {
      // Handle case where storedSettings might be undefined due to storage API issues
      if (!storedSettings) {
        log('Warning: No settings loaded from storage, using defaults');
        storedSettings = {
          volume: 70,
          soundProfile: 'raidleader',
          soundType: 'bell',
          checkInterval: 100,
          flashScreen: true,
          browserNotifications: true,
          smartBidding: false,
          quietHours: false,
          enableTTS: false,
          disableVisuals: false
        };
      }
      
      settings = {
        ...CONFIG,
        CHECK_INTERVAL: storedSettings.checkInterval || CONFIG.CHECK_INTERVAL,
        FLASH_SCREEN: storedSettings.flashScreen !== undefined ? storedSettings.flashScreen : CONFIG.FLASH_SCREEN,
        VOLUME: (storedSettings.volume || 70) / 100,
        SOUND_TYPE: storedSettings.soundType || CONFIG.SOUND_TYPE,
        SOUND_PROFILE: storedSettings.soundProfile || CONFIG.SOUND_PROFILE,
        RAID_LEADER_SOUNDS: storedSettings.raidLeaderSounds || 'bell',
        RAIDER_SOUNDS: storedSettings.raiderSounds || 'chime',
        PROFILE_VOLUME: storedSettings.profileVolume || false,
        RAID_LEADER_NOTIFICATION: storedSettings.raidLeaderNotification !== undefined ? storedSettings.raidLeaderNotification : CONFIG.RAID_LEADER_NOTIFICATION,
        CUSTOM_SOUNDS: storedSettings.customSounds || {},
        SMART_BIDDING: storedSettings.smartBidding !== undefined ? storedSettings.smartBidding : CONFIG.SMART_BIDDING,
        QUIET_HOURS: storedSettings.quietHours !== undefined ? storedSettings.quietHours : CONFIG.QUIET_HOURS,
        QUIET_START: storedSettings.quietStart || CONFIG.QUIET_START,
        QUIET_END: storedSettings.quietEnd || CONFIG.QUIET_END,
        ENABLE_TTS: storedSettings.enableTTS !== undefined ? storedSettings.enableTTS : CONFIG.ENABLE_TTS,
        VOICE: storedSettings.voice || CONFIG.VOICE,
        VOICE_SPEED: storedSettings.voiceSpeed || CONFIG.VOICE_SPEED,
        ENABLE_ADVANCED_TTS: storedSettings.enableAdvancedTTS !== undefined ? storedSettings.enableAdvancedTTS : CONFIG.ENABLE_ADVANCED_TTS,
        TTS_TEMPLATE: storedSettings.ttsTemplate || CONFIG.TTS_TEMPLATE,
        DISABLE_VISUALS: storedSettings.disableVisuals !== undefined ? storedSettings.disableVisuals : CONFIG.DISABLE_VISUALS,
        BROWSER_NOTIFICATIONS: storedSettings.browserNotifications !== undefined ? storedSettings.browserNotifications : CONFIG.BROWSER_NOTIFICATIONS
      };
      // Auction readout
      settings.ANNOUNCE_NEW_AUCTIONS = storedSettings.announceAuctions !== undefined ? storedSettings.announceAuctions : CONFIG.ANNOUNCE_NEW_AUCTIONS;
      settings.ANNOUNCE_START = storedSettings.announceStart || CONFIG.ANNOUNCE_START;
      settings.ANNOUNCE_END = storedSettings.announceEnd || CONFIG.ANNOUNCE_END;
      
      // Automatically enable smart bidding for raider profile
      if (settings.SOUND_PROFILE === 'raider') {
        settings.SMART_BIDDING = true;
        log('Smart bidding automatically enabled for raider profile');
      }
      
      log('Settings loaded:', settings);
      
      // Update audio volume if element exists
      if (audioElement) {
        audioElement.volume = settings.VOLUME;
      }
      settingsLoaded = true;
    }).catch(function(error) {
      log('Error loading settings:', error);
      // Use default settings if storage fails
      settings = { ...CONFIG };
    });
  }
  
  /**
   * Initialize the audio notification system
   * Creates an HTML5 audio element to play the chime
   */
  function initializeAudio() {
    try {
      // Try WAV first since we have chime.wav
      const wavUrl = api.runtime.getURL('chime.wav');
      
      log('Attempting to load audio from:', wavUrl);
      
      audioElement = new Audio(wavUrl);
      audioElement.preload = 'auto';
      audioElement.volume = settings.VOLUME;
      
      // Handle audio loading success
      audioElement.addEventListener('loadeddata', () => {
        log('Audio file loaded successfully');
      });
      
      // Handle audio loading errors
      audioElement.addEventListener('error', (e) => {
        log('Error loading audio file:', e);
        log('Audio error details:', {
          error: e.target.error,
          src: e.target.src,
          networkState: e.target.networkState,
          readyState: e.target.readyState
        });
        
        // Try MP3 as fallback
        const mp3Url = api.runtime.getURL('chime.mp3');
        log('Trying MP3 fallback:', mp3Url);
        
        audioElement = new Audio(mp3Url);
        audioElement.preload = 'auto';
        audioElement.volume = settings.VOLUME;
        
        audioElement.addEventListener('loadeddata', () => {
          log('MP3 audio file loaded successfully');
        });
        
        audioElement.addEventListener('error', (e2) => {
          log('MP3 also failed:', e2);
          console.error('[OpenDKP Helper] Both WAV and MP3 failed to load. Check file exists and format.');
        });
      });
      
      log('Audio system initialized');
    } catch (error) {
      log('Failed to initialize audio:', error);
    }
  }
  
  /**
   * Play the notification chime based on current profile and settings
   */
  function playChime() {
    // Check quiet hours first
    if (isQuietHours()) {
      log('Quiet hours active, skipping sound notification');
      return 0;
    }
    
    const soundType = getCurrentSoundType();
    
    // Safety check for undefined soundType
    if (!soundType) {
      log('Sound type is undefined, using fallback beep');
      playBeepFallback();
      return 0;
    }
    
    // Use the new MP3-based sound system
    if (soundType.startsWith('custom_')) {
      return playCustomSound(soundType);
    } else {
      // All sounds now use MP3 files or Web Audio API
      return playCustomSound(soundType);
    }
  }
  
  /**
   * Get the current sound type based on profile
   */
  function getCurrentSoundType() {
    log('Getting current sound type:', {
      profile: settings.SOUND_PROFILE,
      raidLeaderSounds: settings.RAID_LEADER_SOUNDS,
      raiderSounds: settings.RAIDER_SOUNDS,
      soundType: settings.SOUND_TYPE
    });
    
    // If a specific sound type was selected, always prefer it
    if (settings.SOUND_TYPE) {
      log('Using explicitly selected sound type:', settings.SOUND_TYPE);
      return settings.SOUND_TYPE;
    }
    
    if (settings.SOUND_PROFILE === 'raidleader') {
      const sound = settings.RAID_LEADER_SOUNDS || CONFIG.SOUND_TYPE;
      log('Using raid leader profile sound:', sound);
      return sound;
    }
    
    if (settings.SOUND_PROFILE === 'raider') {
      const sound = settings.RAIDER_SOUNDS || CONFIG.SOUND_TYPE;
      log('Using raider profile sound:', sound);
      return sound;
    }
    
    const fallback = CONFIG.SOUND_TYPE;
    log('Using fallback sound:', fallback);
    return fallback;
  }
  
  /**
   * Play custom sound from storage or real Warcraft sounds
   */
  function playCustomSound(soundKey) {
    // Handle real MP3 sounds
    if (soundKey === 'jobsDone') {
      return playRealWarcraftSound('jobsdone.mp3');
    } else if (soundKey === 'workComplete') {
      return playRealWarcraftSound('workcomplete.mp3');
    } else if (soundKey === 'chime') {
      return playRealWarcraftSound('hotel.mp3');
    } else if (soundKey === 'bell') {
      return playRealWarcraftSound('bell.mp3');
    } else if (soundKey === 'ding') {
      return playRealWarcraftSound('ding1.mp3');
    } else if (soundKey === 'ding2') {
      return playRealWarcraftSound('ding2.mp3');
    } else if (soundKey === 'ding3') {
      return playRealWarcraftSound('ding3.mp3');
    } else if (soundKey === 'ding4') {
      return playRealWarcraftSound('ding4.mp3');
    }
    
    // Handle custom uploaded sounds via IndexedDB
    const soundName = soundKey.replace('custom_', '');

    // IndexedDB helpers (read-only)
    function openSoundsDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('opendkp-sounds', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('sounds', { keyPath: 'name' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    function getSoundFromDB(db, name) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sounds', 'readonly');
        const r = tx.objectStore('sounds').get(name);
        r.onsuccess = () => resolve(r.result ? r.result.data : null);
        r.onerror = () => reject(r.error);
      });
    }

    openSoundsDB().then(db => getSoundFromDB(db, soundName)).then(stored => {
      if (!stored) {
        log('Custom sound not found in DB:', soundName);
        playBeepFallback();
        return;
      }
      const toArrayBuffer = (obj) => {
        if (obj instanceof ArrayBuffer) return Promise.resolve(obj);
        if (obj instanceof Blob) return obj.arrayBuffer();
        if (obj && obj.buffer instanceof ArrayBuffer) return Promise.resolve(obj.buffer);
        return Promise.reject(new Error('Unsupported stored sound format'));
      };
      // Prefer HTMLAudioElement playback for MP3 compatibility
      const useBlob = (obj) => {
        if (obj instanceof Blob) return obj;
        if (obj instanceof ArrayBuffer) return new Blob([obj], { type: 'audio/mpeg' });
        if (obj && obj.buffer instanceof ArrayBuffer) return new Blob([obj.buffer], { type: 'audio/mpeg' });
        return null;
      };
      const blob = useBlob(stored);
      if (!blob) { log('Unsupported stored sound format'); playBeepFallback(); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = settings.VOLUME;
      audio.preload = 'auto';
      audio.play().then(() => {
        log('Playing custom sound (DB HTMLAudio):', soundName);
      }).catch(err => { log('HTMLAudio play error:', err); playBeepFallback(); })
      .finally(() => {
        audio.onended = () => URL.revokeObjectURL(url);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    }).catch(err => { log('IndexedDB error:', err); playBeepFallback(); });

    // Duration unknown synchronously; return 0 and rely on default TTS delay
    return 0;
  }
  
  /**
   * Play real Warcraft sound from MP3 file
   */
  function playRealWarcraftSound(filename) {
    try {
      const audioUrl = api.runtime.getURL(filename);
      const audio = new Audio(audioUrl);
      audio.volume = settings.VOLUME;
      audio.currentTime = 0;
      
      audio.play().then(() => {
        log('Playing Warcraft sound:', filename);
      }).catch(error => {
        log('Error playing Warcraft sound:', error);
        playBeepFallback();
      });
      
      // Return duration in milliseconds
      return audio.duration ? audio.duration * 1000 : 0;
    } catch (error) {
      log('Error loading Warcraft sound:', error);
      playBeepFallback();
      return 0;
    }
  }
  
  /**
   * Fallback beep sound using Web Audio API
   * Creates a simple beep if the audio file fails
   */
  function playBeepFallback() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
      
      log('Played beep fallback');
    } catch (error) {
      log('Beep fallback failed:', error);
    }
  }

  // ===========================================================================
  // SMART BIDDING MODE - CHARACTER DETECTION
  // ===========================================================================
  
  /**
   * Extract user's character names from the header
   * Looks for the character links in the topbar
   */
  function extractUserCharacterNames() {
    try {
      // Look for character links in the header
      const characterLinks = document.querySelectorAll('div.layout-topbar-menu div.layout-topbar-chars a');
      
      const characterNames = [];
      characterLinks.forEach(link => {
        const text = link.textContent.trim();
        // Extract just the character name (before the brackets with DKP)
        const match = text.match(/^([^[]+)\s*\[/);
        if (match) {
          const characterName = match[1].trim();
          characterNames.push(characterName);
          log('Found user character:', characterName);
        }
      });
      
      userCharacterNames = characterNames;
      log('Extracted user character names:', userCharacterNames);
      return characterNames;
    } catch (error) {
      log('Error extracting character names:', error);
      return [];
    }
  }
  
  /**
   * Check if a winner name matches any of the user's characters
   */
  function isUserCharacter(winnerName) {
    if (!winnerName || userCharacterNames.length === 0) {
      return false;
    }
    
    // Check if winner name matches any of the user's characters
    const isMatch = userCharacterNames.some(characterName => 
      characterName.toLowerCase() === winnerName.toLowerCase()
    );
    
    log('Checking if winner is user character:', {
      winnerName: winnerName,
      userCharacters: userCharacterNames,
      isMatch: isMatch
    });
    
    return isMatch;
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================
  
  /**
   * Logging helper - always logs (debug mode removed)
   */
  function log(...args) {
    console.log('[OpenDKP Helper]', ...args);
  }
  
  /**
   * Get the numeric width value from a progress bar's style attribute
   * Returns null if width cannot be parsed
   */
  function getWidthPercent(element) {
    if (!element || !element.style || !element.style.width) {
      return null;
    }
    
    const widthStr = element.style.width;
    const match = widthStr.match(/^(\d+(?:\.\d+)?)%$/);
    
    if (match) {
      return parseFloat(match[1]);
    }
    
    return null;
  }

  // ===========================================================================
  // TIMER MONITORING SYSTEM
  // ===========================================================================
  
  /**
   * Scan the DOM for all timer progress bars
   * Returns a Set of elements that match the timer selector
   */
  function scanForTimers() {
    const timers = document.querySelectorAll(CONFIG.TIMER_SELECTOR);
    return new Set(Array.from(timers));
  }
  
  /**
   * Monitor a single timer element for completion (width: 0%)
   * Returns true if alert was triggered, false otherwise
   */
  function checkTimer(timerElement) {
    // Skip if initialization not complete
    if (!initializationComplete) {
      log('Timer check skipped - initialization not complete');
      return false;
    }
    // Suppress alerts during navigation protection windows (e.g., page switches)
    if (navigationProtectionActive) {
      log('Timer check suppressed due to navigation protection');
      return false;
    }
    
    // Skip if already alerted
    if (alertedTimers.has(timerElement)) {
      // Only log occasionally to avoid spam
      if (Math.random() < 0.001) { // Log only 0.1% of the time
        log('Timer already alerted, skipping (reducing log spam)');
      }
      return false;
    }
    
    const width = getWidthPercent(timerElement);
    // If we've seen this timer with progress > 1%, remember it
    if (width !== null && width > 1) {
      try { timersWithProgress.add(timerElement); } catch (_) {}
    }
    
    // Check if timer has reached 0%
    if (width !== null && width <= 0) {
      log('Timer completed detected candidate:', { width, protected: navigationProtectionActive });
      log('Timer completed! Width:', width, timerElement);
      // Only alert if we previously observed progress > 1%
      if (!timersWithProgress.has(timerElement)) {
        log('Suppressing completion: never observed progress > 1%');
        alertedTimers.add(timerElement);
        return false;
      }
      
      // Try table context first, fallback to tab context
      let context = extractTableContext(timerElement);
      if (!context) {
        context = extractTimerContext(timerElement);
      }
    // Suppress duplicates across DOM reloads using a completion signature
    const sig = buildCompletionSignature(context);
    if (isRecentlyCompleted(sig)) {
      log('Completion duplicate suppressed for signature:', sig);
      alertedTimers.add(timerElement);
      return false;
    }
      
      // Apply bidding rules
      if (shouldAlert(context)) {
        log('🚨 ALERTING! Playing chime and showing notification');
        // Play notification
        playChime();
        
        // Show enhanced notification with context
        showNotification(context);
      // Remember this completion to avoid re-alerts on page switches
      recordCompleted(sig);
      } else {
        log('No alert needed based on bidding rules:', context);
      }
      
      // Mark this timer as alerted to prevent duplicate alerts
      alertedTimers.add(timerElement);
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Determine if an alert should be shown based on bidding rules
   */
  function shouldAlert(context) {
    if (!context) {
      log('No context available, skipping alert');
      return false;
    }
    
    // Rule 1: No alert if nobody bid
    if (context.noBid) {
      log('No bid detected, skipping alert');
      return false;
    }
    
    // Rule 2: Smart bidding mode - only alert if user is bidding
    if (settings.SMART_BIDDING && settings.SOUND_PROFILE === 'raider') {
      if (!isUserBidding(context)) {
        log('Smart bidding mode: User not bidding, skipping alert');
        return false;
      }
    }
    
    // Rule 3: Quiet hours - disable sound notifications
    if (isQuietHours()) {
      log('Quiet hours active, skipping sound notification');
      // Still show visual notifications if not disabled
      return !settings.DISABLE_VISUALS;
    }
    
    // Rule 4: Always alert for single winners
    if (context.winner && !context.rollOffWinners) {
      log('Single winner detected, showing alert');
      return true;
    }
    
    // Rule 5: Alert for multiple winners (x 2, x 3, etc.)
    if (context.quantity > 1 && context.rollOffWinners && context.rollOffWinners.length >= context.quantity) {
      log('Multiple winners for multi-item auction, showing alert');
      return true;
    }
    
    // Rule 6: Alert for roll-offs (multiple people with same bid)
    if (context.rollOffWinners && context.rollOffWinners.length > 1) {
      log('Roll-off detected, showing alert');
      return true;
    }
    
    // Rule 7: Only alert if we have a valid bid amount (not 0 or null)
    if (context.bidAmount && context.bidAmount > 0) {
      log('Valid bid amount detected, showing alert');
      return true;
    }
    
    log('No valid bidding scenario detected, skipping alert');
    return false; // Default to NOT showing alert for safety
  }
  
  /**
   * Check if user is bidding on this auction (smart bidding mode)
   * Now uses real character detection from the header
   */
  function isUserBidding(context) {
    // If we don't have character names yet, try to extract them
    if (userCharacterNames.length === 0) {
      extractUserCharacterNames();
    }
    
    // If still no character names, fall back to old method
    if (userCharacterNames.length === 0) {
      log('No character names found, using fallback detection');
      
      // Check if the current page contains bid input fields
      const bidInputs = document.querySelectorAll('input[type="number"], input[name*="bid"], input[id*="bid"]');
      const bidButtons = document.querySelectorAll('button[class*="bid"], button[id*="bid"]');
      
      // If there are bid inputs/buttons on the page, assume user might be bidding
      if (bidInputs.length > 0 || bidButtons.length > 0) {
        log('Bid elements found, assuming user might be bidding');
        return true;
      }
      
      // Check if user has recently interacted with bid-related elements
      const recentBidActivity = sessionStorage.getItem('opendkp_bid_activity');
      if (recentBidActivity) {
        const activityTime = parseInt(recentBidActivity);
        const now = Date.now();
        // If user bid within last 5 minutes, consider them active
        if (now - activityTime < 5 * 60 * 1000) {
          log('Recent bid activity detected');
          return true;
        }
      }
      
      log('No bid activity detected, user not bidding');
      return false;
    }
    
    // Real smart bidding: Check if the winner is one of the user's characters
    if (context.winner) {
      const isUserWinner = isUserCharacter(context.winner);
      log('Smart bidding check:', {
        winner: context.winner,
        isUserWinner: isUserWinner,
        userCharacters: userCharacterNames
      });
      return isUserWinner;
    }
    
    // For roll-offs, check if any of the participants are user characters
    if (context.rollOffWinners && context.rollOffWinners.length > 0) {
      const hasUserCharacter = context.rollOffWinners.some(participant => 
        isUserCharacter(participant.winner)
      );
      log('Roll-off smart bidding check:', {
        participants: context.rollOffWinners.map(p => p.winner),
        hasUserCharacter: hasUserCharacter,
        userCharacters: userCharacterNames
      });
      return hasUserCharacter;
    }
    
    log('No winner or roll-off participants found, user not bidding');
    return false;
  }
  
  /**
   * Check if current time is within quiet hours
   */
  function isQuietHours() {
    if (!settings.QUIET_HOURS) return false;
    
    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes();
    
    const startTime = parseInt(settings.QUIET_START.replace(':', ''));
    const endTime = parseInt(settings.QUIET_END.replace(':', ''));
    
    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    } else {
      return currentTime >= startTime && currentTime <= endTime;
    }
  }

  // Check if current time is within the announce window
  function isWithinAnnounceWindow() {
    const now = new Date();
    const current = now.getHours() * 100 + now.getMinutes();
    const startStr = (settings.ANNOUNCE_START || '00:00').toString().trim();
    const endStr = (settings.ANNOUNCE_END || '23:59').toString().trim();
    // Robust parser: supports 24h (HH:MM) and 12h with AM/PM
    const parseTime = (s) => {
      const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
      if (!m) return NaN;
      let hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const ap = m[3];
      if (ap) {
        const isPM = /pm/i.test(ap);
        if (hh === 12) hh = isPM ? 12 : 0; else hh = isPM ? hh + 12 : hh;
      }
      return hh * 100 + mm;
    };
    const start = parseTime(startStr);
    const end = parseTime(endStr);
    if (isNaN(start) || isNaN(end)) return true;
    {
      log('ReadAuctions window check:', { current, start, end, startStr, endStr });
    }
    if (start === end) return true; // treat equal times as always-on
    if (start > end) return current >= start || current <= end; // overnight
    return current >= start && current <= end;
  }

  function speakAuctionItem(itemName) {
    if (!itemName) return;
    const utterance = new SpeechSynthesisUtterance(`New auction: ${itemName}`);
    if (settings.VOICE) {
      const voices = speechSynthesis.getVoices();
      const selected = voices.find(v => v.name === settings.VOICE);
      if (selected) utterance.voice = selected;
    }
    utterance.rate = settings.VOICE_SPEED || 1.0;
    utterance.volume = 0.9;
    speechSynthesis.speak(utterance);
    log('TTS: New auction:', itemName);
  }
  
  /**
   * Check all currently known timers for completion
   * Called repeatedly by the polling interval
   */
  function checkAllTimers() {
    // Debug: Log that we're checking timers
    log('Checking timers...');
    
    // Rescan for new timers
    const currentTimers = scanForTimers();
    
    // Track new timers
    let newTimerCount = 0;
    let completedCount = 0;
    currentTimers.forEach(timer => {
      if (!allTimers.has(timer)) {
        allTimers.add(timer);
        newTimerCount++;
        // Announce new auctions if enabled and within window
        maybeAnnounceNewAuction(timer);
        
        // Only pre-mark completed timers during the brief navigation
        // protection window. Outside of this window, allow checkTimer()
        // to handle completion and trigger alerts.
        const width = getWidthPercent(timer);
        if (navigationProtectionActive && width !== null && width <= 0) {
          log('🚨 (Protection) New timer already completed on load, marking as alerted:', timer);
          alertedTimers.add(timer);
          completedCount++;
        }
      }
    });
    
    if (newTimerCount > 0) {
      log(`Found ${newTimerCount} new timer(s), total monitoring: ${allTimers.size}`);
    }
    
    if (completedCount > 0) {
      log(`🚨 Found ${completedCount} completed timer(s) that were not marked as alerted - fixed!`);
    }
    
    // Check each timer
    allTimers.forEach(timer => {
      // Remove from monitoring if element is no longer in DOM
      if (!document.contains(timer)) {
        allTimers.delete(timer);
        return;
      }
      
      // Reduce noise: omit per-timer logs in normal mode
      checkTimer(timer);
    });
  }

  // ===========================================================================
  // MUTATION OBSERVER - Dynamic DOM Monitoring
  // ===========================================================================
  
  /**
   * Initialize MutationObserver to detect when new timer bars are added to DOM
   * This ensures we catch timers that appear after the initial page load
   */
  function initializeMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // Check if any relevant DOM changes occurred
      let shouldRescan = false;
      
      for (const mutation of mutations) {
        // Check for added nodes
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // If a timer is added directly
              if (node.matches && node.matches(CONFIG.TIMER_SELECTOR)) {
                shouldRescan = true;
                log('New timer detected via MutationObserver');
                break;
              }
              // If a timer is added within this subtree
              if (node.querySelector && node.querySelector(CONFIG.TIMER_SELECTOR)) {
                shouldRescan = true;
                log('New timer detected in subtree');
                break;
              }
            }
          }
        }
      }
      
      // If timer-related changes detected, update our timer set
      if (shouldRescan) {
        const newTimers = scanForTimers();
        newTimers.forEach(timer => {
          if (!allTimers.has(timer)) {
            allTimers.add(timer);
            // Immediately consider announcing newly added auction
            maybeAnnounceNewAuction(timer);
          }
        });
        log(`Monitoring ${allTimers.size} timer(s)`);
      }
    });
    
    // Start observing the document body for DOM changes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    log('MutationObserver initialized');
  }

  // ===========================================================================
  // INITIALIZATION & CLEANUP
  // ===========================================================================
  
  /**
   * Initialize the timer monitoring system
   * Sets up audio, starts polling loop, and initializes MutationObserver
   */
  function initialize() {
    log('Initializing OpenDKP Helper');
    console.log('OpenDKP Helper content script starting...');
    // Start with protection active during initial DOM churn
    navigationProtectionActive = true;
    
    // IMMEDIATELY scan for timers and check for completed ones
    allTimers = scanForTimers();
    log(`Found ${allTimers.size} initial timer(s)`);
    
    // Check if we have completed timers on page load (indicates navigation)
    const completedTimers = Array.from(allTimers).filter(timer => {
      const width = getWidthPercent(timer);
      return width !== null && width <= 0;
    });
    
    if (completedTimers.length > 0) {
      log(`🚨 NAVIGATION DETECTED: Found ${completedTimers.length} already-completed timer(s) on page load`);
      log('🚨 This indicates navigation from another page - marking ALL completed timers as alerted IMMEDIATELY');
      
      // Mark ALL completed timers as alerted immediately to prevent false alerts
      completedTimers.forEach(timer => {
        alertedTimers.add(timer);
        // Record signature so if DOM recreates the element, we still suppress
        const ctx = extractTableContext(timer) || extractTimerContext(timer);
        try { recordCompleted(buildCompletionSignature(ctx)); } catch (_) {}
        log('🚨 Marked completed timer as alerted (navigation protection):', timer);
      });
      
      log(`✅ Navigation protection: Marked ${completedTimers.length} completed timer(s) as alerted`);
      log('✅ NO ALERTS WILL BE TRIGGERED FOR THESE OLD AUCTIONS');
    } else {
      log('Fresh page load detected - no completed timers found');
    }
    
    // Initialize audio system
    initializeAudio();
    
    // Load settings (this is async, but we've already marked expired timers)
    loadSettings();
    
    // Start polling loop to check timer widths (with delay to ensure page is loaded)
    setTimeout(() => {
      log('Starting timer monitoring after delay');
      initializationComplete = true; // Allow alerts now
      pageInitialized = true; // Mark page as initialized
      // Keep navigation protection for a short window
      checkIntervalId = setInterval(() => {
        checkAllTimers();
      }, settings.CHECK_INTERVAL);
      // Turn off protection shortly after we begin monitoring so newly
      // completed auctions can trigger alerts.
      setTimeout(() => {
        navigationProtectionActive = false;
        log('Navigation protection window ended');
      }, 1500);
    }, 3000); // 3 second delay to prevent alerts when navigating to bidding tool
    
    // Start watching for dynamically added timers
    initializeMutationObserver();
    
          // Track bid activity for smart bidding mode
          trackBidActivity();
          
          // Extract user's character names for smart bidding mode
          extractUserCharacterNames();
          
          // Setup raid leader notification reminder
          setupRaidLeaderNotification();
    
  // Listen for settings updates
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'settingsUpdated') {
      log('Settings updated, reloading...');
      loadSettings();
      
      // Restart polling with new interval
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
      }
      checkIntervalId = setInterval(() => {
        checkAllTimers();
      }, settings.CHECK_INTERVAL);
      
      // Update audio volume
      if (audioElement) {
        audioElement.volume = settings.VOLUME;
      }
      
      // Re-extract character names in case user switched characters
      extractUserCharacterNames();
      
      // Send response for settings update
      if (sendResponse) {
        sendResponse({success: true});
      }
    } else if (message.action === 'testSound') {
      log('Test sound requested from popup');
      const soundDuration = playChime();
      log('Test sound played, duration:', soundDuration + 'ms');
      if (sendResponse) {
        sendResponse({success: true, duration: soundDuration});
      }
    } else if (message.action === 'reminderFlash') {
      try { 
        // Always log (not conditional on DEBUG) so we can diagnose flash issues
        console.log('[OpenDKP Helper] Reminder flash received, color:', message.color || '#7e57c2');
        console.log('[OpenDKP Helper] Flash settings check - FLASH_SCREEN:', settings.FLASH_SCREEN, 'DISABLE_VISUALS:', settings.DISABLE_VISUALS);
        // Respect user's flash screen setting, but reminders always show flash unless visuals are disabled
        if (!settings.DISABLE_VISUALS) {
          console.log('[OpenDKP Helper] Calling flashScreen with color:', message.color || '#7e57c2');
          flashScreen(message.color || '#7e57c2'); 
          console.log('[OpenDKP Helper] Flash overlay executed successfully');
        } else {
          console.log('[OpenDKP Helper] Flash skipped - visuals disabled');
        }
      } catch(e) {
        console.error('[OpenDKP Helper] Reminder flash error:', e);
        console.error('[OpenDKP Helper] Error stack:', e.stack);
        log('Reminder flash error:', e);
      }
      if (sendResponse) sendResponse({ ok: true });
    }
    
    // Return true to indicate we will send a response
    return true;
  });
    
    log('OpenDKP Helper initialized successfully');
    console.log('OpenDKP Helper content script initialized successfully');
  }

  // Add a short protection window whenever the tab becomes visible again
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      navigationProtectionActive = true;
      // On return, mark already-completed timers to avoid re-alerting
      try {
        const timers = scanForTimers();
        timers.forEach(t => {
          const w = getWidthPercent(t);
          if (w !== null && w <= 0) {
            alertedTimers.add(t);
            const ctx = extractTableContext(t) || extractTimerContext(t);
            try { recordCompleted(buildCompletionSignature(ctx)); } catch (_) {}
          }
        });
      } catch (_) {}
      setTimeout(() => { navigationProtectionActive = false; }, 2000);
    }
  });
  
  /**
   * Cleanup function for when extension is disabled or page is unloaded
   */
  function cleanup() {
    log('Cleaning up OpenDKP Helper');
    
    if (checkIntervalId) {
      clearInterval(checkIntervalId);
      checkIntervalId = null;
    }
  }
  
  // ===========================================================================
  // DEBUGGING HELPERS
  // ===========================================================================
  
  /**
   * Test function - manually trigger chime
   * Run this in console: testChimeSound()
   */
  function testChimeSound() {
    log('Testing chime sound...');
    playChime();
  }
  
  /**
   * Check status function - shows current state
   * Run this in console: checkExtensionStatus()
   */
  function checkExtensionStatus() {
    const timers = scanForTimers();
    const activeTimers = Array.from(timers).filter(t => {
      const width = getWidthPercent(t);
      return width !== null && width > 0;
    });
    
    console.log('=== OpenDKP Helper Status ===');
    console.log('Debug mode: removed (all logs now unconditional)');
    console.log('Audio element:', audioElement ? 'Loaded' : 'NOT loaded');
    console.log('Total timers found:', timers.size);
    console.log('Active timers (width > 0%):', activeTimers.length);
    console.log('Completed timers (width = 0%):', timers.size - activeTimers.length);
    console.log('Timers already alerted:', alertedTimers ? 'Tracked' : 'NOT tracked');
    console.log('');
    console.log('Timer widths:');
    Array.from(timers).forEach((timer, i) => {
      const width = getWidthPercent(timer);
      console.log(`  Timer ${i}: ${width}%`, timer);
    });
    console.log('');
    console.log('Run testChimeSound() to test the chime');
  }
  
  // Expose functions to window for debugging
  window.openDKPTimerDebug = {
    testChime: testChimeSound,
    checkStatus: checkExtensionStatus,
    scan: scanForTimers,
    playChime: playChime,
    extractContext: extractTimerContext,
    extractTableContext: extractTableContext,
    readAuctionsTest: () => speakAuctionItem('Test auction item'),
    testNotification: () => {
      const context = {
        winner: 'TestPlayer',
        bidAmount: 100,
        itemName: 'Test Item',
        quantity: 1
      };
      showNotification(context);
    },
    testRollOff: () => {
      const context = {
        itemName: 'Epic Sword',
        quantity: 1,
        rollOffWinners: [
          { winner: 'Player1', bid: 1000 },
          { winner: 'Player2', bid: 1000 },
          { winner: 'Player3', bid: 1000 }
        ],
        rollOffBid: 1000
      };
      showNotification(context);
    },
    testMultiWinner: () => {
      const context = {
        itemName: 'Rare Potion',
        quantity: 2,
        rollOffWinners: [
          { winner: 'Player1', bid: 500 },
          { winner: 'Player2', bid: 500 }
        ],
        bidAmount: 500
      };
      showNotification(context);
    },
    testNoBid: () => {
      const context = {
        itemName: 'Common Item',
        quantity: 1,
        noBid: true
      };
      log('No bid test - should not show notification');
      shouldAlert(context);
    }
  };

  // ===========================================================================
  // FUTURE EXPANSION POINTS
  // ===========================================================================
  
  /**
   * Extract context information from a timer element
   * Pulls auction details from the DOM structure
   */
  function extractTimerContext(timerElement) {
    try {
      // Navigate up to find the auction container
      const auctionContainer = timerElement.closest('a[id*="_header_action"]') || 
                              timerElement.closest('.p-tabview-nav-link') ||
                              timerElement.parentElement;
      
      if (!auctionContainer) {
        log('Could not find auction container');
        return null;
      }
      
      // Find the tab-offset div with winner info
      const winnerDiv = auctionContainer.querySelector('.tab-offset');
      const winnerText = winnerDiv ? winnerDiv.textContent.trim() : '';
      
      // Parse winner and bid amount (format: "PlayerName - Amount")
      let winner = null;
      let bidAmount = null;
      if (winnerText) {
        const match = winnerText.match(/^(.+?)\s*-\s*(\d+)$/);
        if (match) {
          winner = match[1].trim();
          bidAmount = parseInt(match[2]);
        }
      }
      
      // Find item name and quantity
      const itemDivs = auctionContainer.querySelectorAll('div');
      let itemName = null;
      let quantity = null;
      
      for (const div of itemDivs) {
        const text = div.textContent.trim();
        // Look for pattern like "item name x 1" or just "item name"
        const itemMatch = text.match(/^(.+?)\s*x\s*(\d+)$/);
        if (itemMatch) {
          itemName = itemMatch[1].trim();
          quantity = parseInt(itemMatch[2]);
          break;
        } else if (text && !text.includes('-') && !text.includes('x') && text.length > 3) {
          // Fallback: if it looks like an item name (no dashes, no x, reasonable length)
          itemName = text;
          quantity = 1; // Default quantity
        }
      }
      
      // Check if no one bid (bid amount is 0 or null)
      const noBid = !bidAmount || bidAmount === 0;
      
      let context = {
        winner: winner,
        bidAmount: bidAmount,
        itemName: itemName,
        quantity: quantity,
        timerWidth: getWidthPercent(timerElement),
        rawWinnerText: winnerText,
        noBid: noBid,
        isTableStructure: false
      };
      // Sanitize: item name should not include winner name prefixes like "Winner - Item"
      if (context.itemName && context.winner) {
        const w = context.winner.trim().toLowerCase();
        const n = context.itemName.trim();
        if (n.toLowerCase().startsWith(w + ' -')) {
          context.itemName = n.substring(n.indexOf('-') + 1).trim();
        }
      }
      
      log('Extracted context:', context);
      return context;
      
    } catch (error) {
      log('Error extracting context:', error);
      return null;
    }
  }
  
  /**
   * Extract context from table-based auction structure
   * Handles multiple winners, roll-offs, and no-bid scenarios
   */
  function extractTableContext(timerElement) {
    try {
      // Find the table row containing this timer
      const tableRow = timerElement.closest('tr');
      if (!tableRow) {
        log('Could not find table row');
        return null;
      }
      
      const cells = tableRow.querySelectorAll('td');
      if (cells.length < 4) {
        log('Not enough table cells found');
        return null;
      }
      
      // Extract data from table cells
      const rowNumber = cells[0]?.textContent?.trim();
      const winnerCell = cells[1];
      const itemCell = cells[2];
      const bidCell = cells[3];
      const timerCell = cells[4]; // This should contain our timer
      const timestampCell = cells[5];
      
      // Get winner name from link
      const winnerLink = winnerCell?.querySelector('a');
      const winner = winnerLink ? winnerLink.textContent.trim() : winnerCell?.textContent?.trim();
      
      // Get item name and quantity
      const itemText = itemCell?.textContent?.trim() || '';
      const quantityMatch = itemText.match(/x\s*(\d+)$/);
      const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
      const itemName = quantityMatch ? itemText.replace(/\s*x\s*\d+$/, '').trim() : itemText;
      
      // Get bid amount
      const bidText = bidCell?.textContent?.trim();
      const bidAmount = bidText ? parseInt(bidText) : null;
      
      // Check if this is a roll-off (multiple winners with same bid)
      const allRows = tableRow.parentElement?.querySelectorAll('tr');
      let rollOffWinners = [];
      let rollOffBid = null;
      
      if (allRows && bidAmount) {
        rollOffWinners = Array.from(allRows)
          .map(row => {
            const cells = row.querySelectorAll('td');
            const rowWinner = cells[1]?.querySelector('a')?.textContent?.trim();
            const rowBid = cells[3]?.textContent?.trim();
            return { winner: rowWinner, bid: parseInt(rowBid) };
          })
          .filter(entry => entry.winner && entry.bid === bidAmount);
        
        if (rollOffWinners.length > 1) {
          rollOffBid = bidAmount;
        }
      }
      
      // Check if no one bid (bid amount is 0 or null)
      const noBid = !bidAmount || bidAmount === 0;
      
      let context = {
        winner: winner,
        bidAmount: bidAmount,
        itemName: itemName,
        quantity: quantity,
        timerWidth: getWidthPercent(timerElement),
        rowNumber: rowNumber,
        timestamp: timestampCell?.textContent?.trim(),
        rollOffWinners: rollOffWinners,
        rollOffBid: rollOffBid,
        noBid: noBid,
        isTableStructure: true
      };
      // Sanitize stray winner prefixes in itemName
      if (context.itemName && context.winner) {
        const w = context.winner.trim().toLowerCase();
        const n = context.itemName.trim();
        if (n.toLowerCase().startsWith(w + ' -')) {
          context.itemName = n.substring(n.indexOf('-') + 1).trim();
        }
      }
      
      log('Extracted table context:', context);
      return context;
      
    } catch (error) {
      log('Error extracting table context:', error);
      return null;
    }
  }
  
  /**
   * Speak auction completion notification using TTS
   */
  function speakNotification(context) {
    if (!settings.ENABLE_TTS) {
      return;
    }
    
    let message = '';
    
    // Check if advanced TTS is enabled and use custom template
    if (settings.ENABLE_ADVANCED_TTS && settings.TTS_TEMPLATE) {
      message = generateTTSMessage(settings.TTS_TEMPLATE, context);
      log('TTS: Using custom template:', message);
    } else {
      // Use default logic
      if (context.isRollOff) {
        message = `Roll-off for ${context.itemName}. Participants: ${context.winners.join(', ')}`;
      } else if (context.multipleWinners) {
        message = `Multiple winners for ${context.itemName}. Winners: ${context.winners.join(', ')}`;
      } else if (context.winner && context.bidAmount) {
        message = `Auction Finished. ${context.winner} for ${context.bidAmount} DKP on ${context.itemName}`;
      } else {
        message = `Auction Finished for ${context.itemName}`;
      }
    }
    
    const utterance = new SpeechSynthesisUtterance(message);
    
    // Set voice if specified
    if (settings.VOICE) {
      const voices = speechSynthesis.getVoices();
      const selectedVoice = voices.find(voice => voice.name === settings.VOICE);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
    }
    
    utterance.rate = settings.VOICE_SPEED;
    utterance.volume = 0.8;
    
    speechSynthesis.speak(utterance);
    log('TTS: Speaking notification:', message);
  }
  
  /**
   * Generate TTS message from template
   */
  function generateTTSMessage(template, context) {
    let message = template;
    
    // Replace variables
    message = message.replace(/\{winner\}/g, context.winner || 'Unknown');
    message = message.replace(/\{bidAmount\}/g, context.bidAmount || '0');
    message = message.replace(/\{itemName\}/g, context.itemName || 'Unknown Item');
    message = message.replace(/\{winners\}/g, context.winners || 'Unknown');
    message = message.replace(/\{isRollOff\}/g, context.isRollOff ? 'true' : 'false');
    message = message.replace(/\{multipleWinners\}/g, context.multipleWinners ? 'true' : 'false');
    
    return message;
  }

  /**
   * Show enhanced notification with auction details
   */
  function showNotification(context) {
    if (!context) {
      log('No context available for notification');
      return;
    }
    
    // Create notification message based on context type
    let message = 'Auction Timer Complete!';
    let details = [];
    
    if (context.itemName) {
      details.push(`Item: ${context.itemName}`);
    }
    if (context.quantity && context.quantity > 1) {
      details.push(`Quantity: ${context.quantity}`);
    }
    
    // Handle different auction scenarios
    if (context.rollOffWinners && context.rollOffWinners.length > 1) {
      // Roll-off scenario
      message = 'Roll-off Required!';
      details.push(`Bid Amount: ${context.rollOffBid}`);
      details.push(`Roll-off Participants: ${context.rollOffWinners.map(w => w.winner).join(', ')}`);
    } else if (context.quantity > 1 && context.rollOffWinners && context.rollOffWinners.length >= context.quantity) {
      // Multiple winners for multi-item auction
      message = 'Multiple Winners!';
      details.push(`Winners: ${context.rollOffWinners.slice(0, context.quantity).map(w => w.winner).join(', ')}`);
      details.push(`Bid Amount: ${context.bidAmount}`);
    } else if (context.winner) {
      // Single winner
      details.push(`Winner: ${context.winner}`);
      if (context.bidAmount) {
        details.push(`Bid: ${context.bidAmount}`);
      }
    }
    
    const fullMessage = details.length > 0 ? 
      `${message}\n${details.join('\n')}` : 
      message;
    
    log('Notification:', fullMessage);
    
    // Browser notification (if enabled and visuals not disabled)
    if (settings.BROWSER_NOTIFICATIONS && !settings.DISABLE_VISUALS) {
      if (Notification.permission === 'granted') {
        new Notification(message, {
          body: details.join('\n'),
          icon: 'icons/icon-48.png',
          tag: 'opendkp-timer'
        });
      } else if (Notification.permission !== 'denied') {
        // Request permission
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification(message, {
              body: details.join('\n'),
              icon: 'icons/icon-48.png',
              tag: 'opendkp-timer'
            });
          }
        });
      }
    }
    
    // Console notification (if enabled and visuals not disabled)
    if (!settings.DISABLE_VISUALS) {
      console.log('🔔 OpenDKP Helper:', fullMessage);
    }
    
    // Screen flash effect (if enabled and visuals not disabled)
    if (settings.FLASH_SCREEN && !settings.DISABLE_VISUALS) {
      flashScreen();
    }

    // Respect quiet hours for audio and TTS (but keep visuals)
    if (isQuietHours()) {
      log('Quiet hours active, skipping sound and TTS');
      return;
    }
    
    // Play notification sound and get duration
    const soundDuration = playChime();
    
    // Speak notification using TTS - wait for sound to finish plus buffer
    const ttsDelay = Math.max(soundDuration + 200, 500); // At least 500ms, or sound duration + 200ms buffer
    log('TTS will start after:', ttsDelay + 'ms (sound duration:', soundDuration + 'ms)');
    
    setTimeout(() => {
      speakNotification(context);
    }, ttsDelay);
  }
  
  /**
   * Flash screen effect
   */
  function flashScreen(color) {
    // Use a temporary overlay to avoid mutating page background styles
    try {
      console.log('[OpenDKP Helper] flashScreen called with color:', color || '#ff6b6b');
      // Clear any accidental inline background flash from previous logic
      try {
        document.body.style.backgroundColor = '';
        document.body.style.transition = '';
      } catch (_) {}

      const overlay = document.createElement('div');
      overlay.setAttribute('data-opendkp-flash', '');
      overlay.style.position = 'fixed';
      // Explicit sizing for widest compatibility
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      // And inset for modern browsers
      overlay.style.inset = '0';
      overlay.style.zIndex = '2147483647';
      overlay.style.background = color || '#ff6b6b';
      overlay.style.opacity = '0.9';
      overlay.style.pointerEvents = 'none';
      overlay.style.transition = 'opacity 200ms ease';
      console.log('[OpenDKP Helper] Flash overlay created, adding to DOM. Color:', overlay.style.background, 'zIndex:', overlay.style.zIndex);
      document.body.appendChild(overlay);
      console.log('[OpenDKP Helper] Flash overlay added to DOM, body children:', document.body.children.length);
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
            console.log('[OpenDKP Helper] Flash overlay removed from DOM');
          }
        }, 220);
      }, 20);
    } catch (e) {
      console.error('[OpenDKP Helper] flashScreen error:', e);
      console.error('[OpenDKP Helper] flashScreen error stack:', e.stack);
    }
  }

  /**
   * Track bid activity for smart bidding mode
   */
  function trackBidActivity() {
    // Listen for clicks on bid-related elements
    document.addEventListener('click', function(event) {
      const target = event.target;
      
      // Check if clicked element is bid-related
      if (target.matches('button[class*="bid"], button[id*="bid"], input[type="number"], input[name*="bid"], input[id*="bid"]') ||
          target.closest('button[class*="bid"], button[id*="bid"]')) {
        
        // Record bid activity timestamp
        sessionStorage.setItem('opendkp_bid_activity', Date.now().toString());
        log('Bid activity detected and recorded');
      }
    });
    
    // Listen for form submissions that might be bids
    document.addEventListener('submit', function(event) {
      const form = event.target;
      if (form.querySelector('input[name*="bid"], input[id*="bid"], button[class*="bid"]')) {
        sessionStorage.setItem('opendkp_bid_activity', Date.now().toString());
        log('Bid form submission detected and recorded');
      }
    });
  }

  /**
   * Setup raid leader tab close confirmation
   */
  function setupRaidLeaderNotification() {
    // Only setup if in raid leader mode and notification is enabled
    if (settings.SOUND_PROFILE !== 'raidleader' || !settings.RAID_LEADER_NOTIFICATION) {
      log('Not in raid leader mode or notification disabled, skipping raid leader reminder');
      return;
    }
    
    log('Setting up raid leader notification reminder');
    
    // Show browser notification reminder
    showRaidLeaderReminder();
    
    log('Raid leader notification reminder setup complete');
  }
  
  function showRaidLeaderReminder() {
    // Request notification permission if not already granted
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showRaidLeaderNotification();
        } else {
          log('Notification permission denied, cannot show raid leader reminder');
        }
      });
    } else if (Notification.permission === 'granted') {
      showRaidLeaderNotification();
    } else {
      log('Notification permission denied, cannot show raid leader reminder');
    }
  }
  
  function showRaidLeaderNotification() {
    // Create browser notification with custom message
    const notification = new Notification('Raid Leader Mode Active', {
      body: 'Remember to upload raid logs!',
      icon: chrome.runtime.getURL('icons/icon-48.png'),
      tag: 'raid-leader-reminder', // Prevents multiple notifications
      requireInteraction: false, // Auto-dismiss after a few seconds
      silent: true // Don't play sound (we have our own sounds)
    });
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      notification.close();
    }, 5000);
    
    // Handle notification click
    notification.onclick = function() {
      notification.close();
      window.focus(); // Focus the window
    };
    
    log('Raid leader reminder notification shown');
  }

  // ===========================================================================
  // STARTUP
  // ===========================================================================
  
  // Run initialization when DOM is ready
  console.log('Content script loaded, document ready state:', document.readyState);
  if (document.readyState === 'loading') {
    console.log('DOM still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    console.log('DOM already loaded, initializing immediately');
    initialize();
  }
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

})();
