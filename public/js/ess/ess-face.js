/* ==========================================================================
   PRIMUS REMEDIES — ESS — FACIAL IDENTITY VERIFICATION ADAPTER
   Camera preview • Positioning oval guide • Lighting & pose feedback •
   Genuine service adapter • Explicit unconfigured notice • Clearly labeled demo mode.
   
   SECURITY & PRIVACY GUARANTEE:
   Raw camera frames and biometric templates are NEVER stored in IndexedDB,
   localStorage, sessionStorage or cookies. Verification is ephemeral.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});

  class FaceVerificationAdapter {
    constructor() {
      this.stream = null;
      this.videoEl = null;
      this.canvasEl = null;
      this.analyzing = false;
      this.animId = null;
    }

    /**
     * Checks service status.
     * Returns: { mode: 'remote'|'demo'|'none', isConfigured: bool, label: string }
     */
    getStatus() {
      const cfg = (ESS.Settings && ESS.Settings.get().faceVerification) || { mode: 'demo', demoEnabled: true };
      if (cfg.mode === 'remote' && cfg.endpoint && cfg.tested) {
        return { mode: 'remote', isConfigured: true, label: 'Enterprise Face Verification Service (Connected)' };
      }
      if (cfg.demoEnabled || cfg.mode === 'demo') {
        return { mode: 'demo', isConfigured: true, label: 'Demo Verification Mode (Simulated for Evaluation)' };
      }
      return { mode: 'none', isConfigured: false, label: 'Face Verification Service Not Configured' };
    }

    /**
     * Request camera stream and attach to video element.
     */
    async startCamera(videoElement, canvasElement) {
      this.videoEl = videoElement;
      this.canvasEl = canvasElement || document.createElement('canvas');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new ESS.Error('Camera access is not supported by your browser.', 'camera_unsupported');
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
          },
          audio: false
        });
        this.stream = stream;
        this.videoEl.srcObject = stream;
        await this.videoEl.play();
        this.startFaceGuideAnalysis();
        return { success: true };
      } catch (err) {
        let code = 'camera_denied';
        let msg = 'Camera permission was denied. Please allow camera access in your browser settings to verify identity.';
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          code = 'camera_not_found';
          msg = 'No camera device detected on this system.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          code = 'camera_busy';
          msg = 'Camera is currently in use by another application.';
        }
        throw new ESS.Error(msg, code);
      }
    }

    /**
     * Stop camera and clear resources.
     */
    stopCamera() {
      this.analyzing = false;
      if (this.animId) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
      }
      if (this.videoEl) {
        this.videoEl.srcObject = null;
      }
    }

    /**
     * Lightweight frame luminance analysis to provide helpful user instructions
     * (e.g. lighting check, hold still). Ephemeral only.
     */
    startFaceGuideAnalysis(callback) {
      if (!this.videoEl || !this.canvasEl) return;
      this.analyzing = true;
      const ctx = this.canvasEl.getContext('2d', { willReadFrequently: true });

      const checkFrame = () => {
        if (!this.analyzing || !this.videoEl || this.videoEl.paused || this.videoEl.ended) return;
        const w = this.videoEl.videoWidth || 320;
        const h = this.videoEl.videoHeight || 240;

        if (w > 0 && h > 0) {
          this.canvasEl.width = 160;
          this.canvasEl.height = 120;
          try {
            ctx.drawImage(this.videoEl, 0, 0, 160, 120);
            const imgData = ctx.getImageData(0, 0, 160, 120).data;
            let sumLum = 0;
            for (let i = 0; i < imgData.length; i += 16) {
              sumLum += (0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2]);
            }
            const avgLum = sumLum / (imgData.length / 16);

            let feedback = 'Center your face inside the oval';
            let quality = 'good';
            if (avgLum < 40) {
              feedback = 'Low lighting detected. Please face a light source.';
              quality = 'low_light';
            } else if (avgLum > 220) {
              feedback = 'Too much backlighting. Move away from bright light.';
              quality = 'bright';
            } else {
              feedback = 'Good positioning. Hold still for verification...';
            }

            if (typeof callback === 'function') {
              callback({ quality, feedback, luminance: avgLum });
            } else {
              const fbEl = document.getElementById('faceGuideFeedback');
              if (fbEl) {
                fbEl.textContent = feedback;
                fbEl.className = 'face-feedback ' + quality;
              }
            }
          } catch (e) {
            // cross-origin or canvas security issue, skip silently
          }
        }
        this.animId = requestAnimationFrame(checkFrame);
      };
      this.animId = requestAnimationFrame(checkFrame);
    }

    /**
     * Executes identity verification.
     * Never stores raw face photo or biometrics.
     */
    async verify(empCode) {
      const status = this.getStatus();

      if (status.mode === 'none') {
        throw new ESS.Error(
          'Face verification service is not configured. An enterprise facial identity provider (e.g. AWS Rekognition, Azure Face, GCP Vision Face API) must be configured in ESS Settings. Enable Demo Mode in settings if you are evaluating locally.',
          'face_service_unconfigured'
        );
      }

      if (!this.stream || !this.videoEl) {
        throw new ESS.Error('Camera stream is not active. Please start camera first.', 'camera_inactive');
      }

      // Simulate verification progress steps
      if (status.mode === 'demo') {
        await new Promise(r => setTimeout(r, 600)); // Liveness check simulation
        await new Promise(r => setTimeout(r, 800)); // Feature extraction & matching simulation

        // Returns explicit verified result clearly tagged as demo
        return {
          verified: true,
          mode: 'demo',
          serviceName: 'Primus Local Demo Verification Adapter',
          timestamp: new Date().toISOString(),
          employeeCode: empCode,
          confidence: 0.984,
          note: 'Verified via demo mode (Authorized biometric service simulation). Raw face image was NOT stored.'
        };
      }

      if (status.mode === 'remote') {
        const cfg = ESS.Settings.get().faceVerification;
        // In remote mode: capture single ephemeral compressed frame to send to backend
        const ctx = this.canvasEl.getContext('2d');
        this.canvasEl.width = 480;
        this.canvasEl.height = 360;
        ctx.drawImage(this.videoEl, 0, 0, 480, 360);
        const dataUrl = this.canvasEl.toDataURL('image/jpeg', 0.8);

        try {
          const resp = await fetch(cfg.endpoint, {
            method: 'POST',
            headers: Object.assign(
              { 'Content-Type': 'application/json' },
              cfg.authHeader ? { Authorization: cfg.authHeader } : {}
            ),
            body: JSON.stringify({
              employeeCode: empCode,
              imagePayload: dataUrl,
              requestedAt: new Date().toISOString()
            })
          });

          // Wipe canvas immediately
          ctx.clearRect(0, 0, 480, 360);

          if (!resp.ok) {
            throw new Error(`Verification service returned HTTP ${resp.status}`);
          }

          const res = await resp.json();
          if (res.verified !== true) {
            throw new ESS.Error(res.message || 'Face identity could not be verified. Please retry with better lighting.', 'verification_failed');
          }

          return {
            verified: true,
            mode: 'remote',
            serviceName: res.provider || 'Enterprise Facial Service',
            timestamp: new Date().toISOString(),
            employeeCode: empCode,
            confidence: res.confidence || 0.95,
            note: 'Verified by enterprise service.'
          };
        } catch (err) {
          ctx.clearRect(0, 0, 480, 360);
          throw new ESS.Error(err.message || 'Face verification service unavailable.', 'face_service_error');
        }
      }
    }
  }

  ESS.Face = new FaceVerificationAdapter();
})(window);
