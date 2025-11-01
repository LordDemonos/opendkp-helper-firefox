// Test audio script - moved from inline script in test_audio.html

document.addEventListener('DOMContentLoaded', function() {
  const testBtn = document.getElementById('testBtn');
  const status = document.getElementById('status');
  
  if (testBtn && status) {
    testBtn.addEventListener('click', testAudio);
  }
  
  function testAudio() {
    if (!status) return;
    
    // Test WAV
    const wav = new Audio('chime.wav');
    wav.addEventListener('loadeddata', () => {
      status.innerHTML += '<br>WAV loaded successfully';
      wav.play().then(() => {
        status.innerHTML += '<br>WAV played successfully';
      }).catch(e => {
        // Escape error message for safe HTML
        const errorMsg = String(e.message || 'Unknown error').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        status.innerHTML += '<br>WAV play failed: ' + errorMsg;
      });
    });
    wav.addEventListener('error', (e) => {
      const errorMsg = e.target.error ? String(e.target.error.message || 'Unknown error') : 'Unknown error';
      const safeError = errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      status.innerHTML += '<br>WAV load failed: ' + safeError;
    });
    
    // Test MP3
    const mp3 = new Audio('chime.mp3');
    mp3.addEventListener('loadeddata', () => {
      status.innerHTML += '<br>MP3 loaded successfully';
    });
    mp3.addEventListener('error', (e) => {
      const errorMsg = e.target.error ? String(e.target.error.message || 'Unknown error') : 'Unknown error';
      const safeError = errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      status.innerHTML += '<br>MP3 load failed: ' + safeError;
    });
  }
});

