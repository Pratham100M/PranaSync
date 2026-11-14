// -------------------------------------------------------------------------
    // GLOBAL STATE & LOCALSTORAGE KEYS
    // -------------------------------------------------------------------------
    const STORAGE_KEY_ACCOUNTS = 'pranasync_accounts_registry_v1';
    const STORAGE_KEY_ACTIVE_SESSION = 'pranasync_active_session_v1';

    let STORAGE_KEY_ANALYTICS = 'pranasync_analytics_v2';
    let STORAGE_KEY_SCREENERS = 'pranasync_screeners_v2';
    let STORAGE_KEY_GAMIFICATION = 'pranasync_gamification_v2';
    let STORAGE_KEY_JOURNAL = 'pranasync_journal_v2';
    let STORAGE_KEY_GOAL = 'pranasync_goal_v2';
    let STORAGE_KEY_INTENSITY = 'pranasync_intensity_v2';
    let STORAGE_KEY_ACHIEVEMENTS = 'pranasync_achievements_v2';
    let STORAGE_KEY_CIRCADIAN = 'pranasync_circadian_pref_v1';

    let currentAuthUser = null;

    function getScopedKeysForUser(userId) {
      const prefix = userId ? `pranasync_u_${userId}_` : 'pranasync_';
      return {
        analytics: `${prefix}analytics_v2`,
        screeners: `${prefix}screeners_v2`,
        gamification: `${prefix}gamification_v2`,
        journal: `${prefix}journal_v2`,
        goal: `${prefix}goal_v2`,
        intensity: `${prefix}intensity_v2`,
        achievements: `${prefix}achievements_v2`,
        circadian: `${prefix}circadian_pref_v1`
      };
    }

    function applyStorageNamespaceForUser(user) {
      currentAuthUser = user || null;
      const keys = getScopedKeysForUser(user ? user.userId : null);
      STORAGE_KEY_ANALYTICS = keys.analytics;
      STORAGE_KEY_SCREENERS = keys.screeners;
      STORAGE_KEY_GAMIFICATION = keys.gamification;
      STORAGE_KEY_JOURNAL = keys.journal;
      STORAGE_KEY_GOAL = keys.goal;
      STORAGE_KEY_INTENSITY = keys.intensity;
      STORAGE_KEY_ACHIEVEMENTS = keys.achievements;
      STORAGE_KEY_CIRCADIAN = keys.circadian;
    }

    // Bootstrap active session synchronously before initial state reads
    (function bootstrapSavedUserSession() {
      try {
        const activeUserId = localStorage.getItem(STORAGE_KEY_ACTIVE_SESSION);
        if (activeUserId) {
          const accounts = JSON.parse(localStorage.getItem(STORAGE_KEY_ACCOUNTS) || '[]');
          const found = accounts.find((acc) => acc.userId === activeUserId);
          if (found) {
            applyStorageNamespaceForUser(found);
          } else {
            localStorage.removeItem(STORAGE_KEY_ACTIVE_SESSION);
          }
        }
      } catch (e) {}
    })();

    let activeTab = 'studio';
    let studioMode = 'webcam'; // 'webcam' | 'demo'
    let targetAsanaLock = 'AUTO';
    let cameraFacingMode = 'user';
    let mirrorVideo = true;
    let emaAlpha = 0.35;
    let angleTolerance = 12;
    let voiceEnabled = false;
    let voiceAutoArmed = false;

    const CUE_COOLDOWN_MS = 3500;
    let lastCueTimestamp = 0;
    let lastSpokenCueText = '';

    let smoothedLandmarks = null;
    let hipMidpointHistory = [];
    let alignedHoldAccumMs = 0;
    let holdRewardAwardedForStreak = false;
    let lastAlignedFrameMs = null;
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let currentFps = 0;
    let latestAssessment = null;
    let bodyVisibleInFrame = false;
    let currentDisplayedGuideKey = 'Tadasana';

    let webcamStream = null;
    let mpPoseDetector = null;
    let mpCameraActive = false;
    let mpFrameBusy = false;

    // -------------------------------------------------------------------------
    // 0. ADAPTIVE CIRCADIAN THEME ENGINE (AUTO + MANUAL SWITCHER)
    // -------------------------------------------------------------------------
    let circadianPreference = localStorage.getItem(STORAGE_KEY_CIRCADIAN) || 'auto';

    function detectCircadianPhaseByClock() {
      const hour = new Date().getHours();
      if (hour >= 5 && hour < 12) return 'morning';
      if (hour >= 12 && hour < 18) return 'canopy';
      return 'twilight';
    }

    function setCircadianPreference(pref, notify = true) {
      circadianPreference = pref;
      localStorage.setItem(STORAGE_KEY_CIRCADIAN, pref);
      applyCircadianTheme(notify);
    }

    function applyCircadianTheme(notify = false) {
      const resolvedTheme =
        circadianPreference === 'auto' ? detectCircadianPhaseByClock() : circadianPreference;

      document.documentElement.setAttribute('data-circadian-theme', resolvedTheme);

      const phaseMeta = {
        morning: { badge: '☀️ Morning Dew & Marigold', toast: 'Morning Dew & Marigold palette active' },
        canopy: { badge: '🌿 Midday Canopy & Jade', toast: 'Midday Canopy & Jade palette active' },
        twilight: { badge: '🌙 Twilight Canopy & Indigo Lotus', toast: 'Twilight Indigo Lotus night mode active' }
      };

      const meta = phaseMeta[resolvedTheme] || phaseMeta.canopy;
      const badgeEl = document.getElementById('circadianActiveBadge');
      if (badgeEl) {
        badgeEl.textContent =
          circadianPreference === 'auto' ? `${meta.badge} (Auto)` : meta.badge;
      }

      ['auto', 'morning', 'canopy', 'twilight'].forEach((id) => {
        const btn = document.getElementById(`theme-btn-${id}`);
        if (!btn) return;
        const isActive = id === circadianPreference;
        btn.className = isActive
          ? 'circadian-btn px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-gradient-to-r from-forest-600 to-jade-600 text-white shadow-sm transition-all'
          : 'circadian-btn px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-jade-800 hover:bg-forest-50 transition-all';
      });

      // Redraw tutorial canvas and analytics chart to match theme surfaces
      drawTutorialFigure(1);
      if (activeTab === 'analytics') renderAnalyticsDashboard();

      if (notify) {
        showToast(meta.toast, resolvedTheme === 'twilight' ? '🌙' : resolvedTheme === 'morning' ? '☀️' : '🌿');
      }
    }

    // -------------------------------------------------------------------------
    // 1. GROUNDED ANATOMICAL KEYFRAMES & VOICE-SYNCHRONIZED POSE WALKTHROUGH
    // -------------------------------------------------------------------------
    const POSE_TUTORIALS = {
      Tadasana: [
        ['Begin standing', 'Stand tall with feet comfortably grounded on the mat, arms relaxed and gaze forward.'],
        ['Ground your feet', 'Spread your toes gently and distribute your weight evenly across both heels and balls of the feet.'],
        ['Stack your posture', 'Lengthen through the crown of your head. Keep your ribs stacked softly over your pelvis.'],
        ['Settle and breathe', 'Roll your shoulders back and down, palms open, and take two slow, grounding breaths.']
      ],
      Vrikshasana: [
        ['Begin standing', 'Start in Mountain Pose with both feet firmly planted on the mat and hands by your sides.'],
        ['Shift your weight', 'Root down through your standing foot and fix your gaze on one steady point ahead.'],
        ['Place the lifted foot', 'Rest your lifted foot against your inner calf or thigh—avoiding the knee joint.'],
        ['Raise arms or prayer hands', 'Bring palms together at your heart or reach overhead as your standing leg stays rooted.']
      ],
      WarriorII: [
        ['Begin standing', 'Stand tall in Mountain Pose, then step your feet wide apart along the mat.'],
        ['Align your feet', 'Turn your front foot out ninety degrees and angle your back foot slightly inward.'],
        ['Bend the front knee', 'Bend your front knee directly over your front ankle while keeping your back leg strong.'],
        ['Extend both arms', 'Reach both arms parallel to the floor at shoulder height and gaze over your front hand.']
      ],
      Triangle: [
        ['Begin standing', 'Step your feet comfortably wide apart on the mat with both legs straight.'],
        ['Open your stance', 'Turn your front foot outward and extend both arms wide at shoulder height.'],
        ['Reach and hinge at the hip', 'Reach forward over your front leg, then hinge sideways from your hip crease.'],
        ['Open the chest', 'Rest your lower hand lightly on your shin and reach your top arm toward the sky.']
      ],
      DownwardDog: [
        ['Start on hands and knees', 'Come onto all fours on the mat with wrists under shoulders and knees under hips.'],
        ['Press palms and tuck toes', 'Spread your fingers wide, press firmly into the mat, and tuck your toes under.'],
        ['Lift hips halfway', 'Hover your knees off the mat and press your chest gently toward your thighs.'],
        ['Full inverted V shape', 'Lift your sitting bones high while keeping hands and feet grounded on the mat.']
      ],
      Utkatasana: [
        ['Begin standing', 'Stand in Mountain Pose with feet hip-width apart and firmly planted on the mat.'],
        ['Hinge hips back', 'Bend your knees and send your hips back as if sitting into a sturdy chair.'],
        ['Sweep arms upward', 'Raise your arms alongside your ears while keeping your shoulders relaxed.'],
        ['Hold with steady breath', 'Keep weight balanced in your heels and breathe calmly through your chest.']
      ],
      Bhujangasana: [
        ['Lie prone on the mat', 'Lie flat on your belly with legs extended and the tops of your feet resting on the mat.'],
        ['Place palms beside ribs', 'Slide your palms onto the mat under your shoulders and hug your elbows close to your ribs.'],
        ['Baby Cobra lift', 'Press your pelvis and tops of feet into the mat as you gently lift your head and chest.'],
        ['Full Bhujangasana arch', 'Keep hips, thighs, and feet grounded on the mat while opening your heart forward.']
      ],
      Anjaneyasana: [
        ['Begin standing', 'Start in Mountain Pose at the front of your mat with feet grounded.'],
        ['Step into high lunge', 'Step your back foot far behind you, bending your front knee over your front ankle.'],
        ['Ground the back knee', 'Lower your back knee and shin softly onto the mat while keeping your front foot planted.'],
        ['Sweep arms overhead', 'Lift your chest and reach both arms up toward the sky with grounded hips.']
      ]
    };

    function createPoseFrame(coords) {
      const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
      Object.entries(coords).forEach(([idx, [x, y]]) => {
        lm[Number(idx)] = { x, y, z: 0, visibility: 0.99 };
      });
      return lm;
    }

    const TUTORIAL_KEYFRAMES = {
      Tadasana: [
        createPoseFrame({
          0:[0.50,0.17], 11:[0.56,0.28], 12:[0.44,0.28], 13:[0.58,0.42], 14:[0.42,0.42],
          15:[0.59,0.55], 16:[0.41,0.55], 23:[0.54,0.53], 24:[0.46,0.53],
          25:[0.54,0.72], 26:[0.46,0.72], 27:[0.54,0.90], 28:[0.46,0.90]
        }),
        createPoseFrame({
          0:[0.50,0.17], 11:[0.56,0.28], 12:[0.44,0.28], 13:[0.58,0.42], 14:[0.42,0.42],
          15:[0.59,0.55], 16:[0.41,0.55], 23:[0.54,0.53], 24:[0.46,0.53],
          25:[0.55,0.72], 26:[0.45,0.72], 27:[0.55,0.90], 28:[0.45,0.90]
        }),
        createPoseFrame({
          0:[0.50,0.15], 11:[0.56,0.26], 12:[0.44,0.26], 13:[0.58,0.40], 14:[0.42,0.40],
          15:[0.59,0.54], 16:[0.41,0.54], 23:[0.54,0.52], 24:[0.46,0.52],
          25:[0.54,0.71], 26:[0.46,0.71], 27:[0.54,0.90], 28:[0.46,0.90]
        }),
        createPoseFrame({
          0:[0.50,0.15], 11:[0.56,0.26], 12:[0.44,0.26], 13:[0.58,0.40], 14:[0.42,0.40],
          15:[0.60,0.54], 16:[0.40,0.54], 23:[0.54,0.52], 24:[0.46,0.52],
          25:[0.54,0.71], 26:[0.46,0.71], 27:[0.54,0.90], 28:[0.46,0.90]
        })
      ],
      Vrikshasana: [
        createPoseFrame({
          0:[0.50,0.16], 11:[0.56,0.27], 12:[0.44,0.27], 13:[0.58,0.41], 14:[0.42,0.41],
          15:[0.59,0.54], 16:[0.41,0.54], 23:[0.54,0.52], 24:[0.46,0.52],
          25:[0.54,0.71], 26:[0.46,0.71], 27:[0.54,0.90], 28:[0.46,0.90]
        }),
        createPoseFrame({
          0:[0.52,0.16], 11:[0.58,0.27], 12:[0.46,0.27], 13:[0.60,0.41], 14:[0.44,0.41],
          15:[0.61,0.54], 16:[0.43,0.54], 23:[0.55,0.52], 24:[0.47,0.52],
          25:[0.55,0.71], 26:[0.39,0.75], 27:[0.55,0.90], 28:[0.52,0.83]
        }),
        createPoseFrame({
          0:[0.52,0.16], 11:[0.58,0.27], 12:[0.46,0.27], 13:[0.61,0.38], 14:[0.43,0.38],
          15:[0.53,0.35], 16:[0.51,0.35], 23:[0.55,0.52], 24:[0.47,0.52],
          25:[0.55,0.71], 26:[0.34,0.61], 27:[0.55,0.90], 28:[0.53,0.65]
        }),
        createPoseFrame({
          0:[0.52,0.16], 11:[0.58,0.27], 12:[0.46,0.27], 13:[0.57,0.16], 14:[0.47,0.16],
          15:[0.53,0.07], 16:[0.51,0.07], 23:[0.55,0.52], 24:[0.47,0.52],
          25:[0.55,0.71], 26:[0.34,0.61], 27:[0.55,0.90], 28:[0.53,0.65]
        })
      ],
      WarriorII: [
        createPoseFrame({
          0:[0.50,0.16], 11:[0.56,0.27], 12:[0.44,0.27], 13:[0.58,0.41], 14:[0.42,0.41],
          15:[0.59,0.54], 16:[0.41,0.54], 23:[0.54,0.52], 24:[0.46,0.52],
          25:[0.54,0.71], 26:[0.46,0.71], 27:[0.54,0.90], 28:[0.46,0.90]
        }),
        createPoseFrame({
          0:[0.50,0.19], 11:[0.56,0.30], 12:[0.44,0.30], 13:[0.61,0.42], 14:[0.39,0.42],
          15:[0.56,0.52], 16:[0.44,0.52], 23:[0.55,0.53], 24:[0.45,0.53],
          25:[0.66,0.71], 26:[0.34,0.71], 27:[0.76,0.90], 28:[0.24,0.90]
        }),
        createPoseFrame({
          0:[0.50,0.22], 11:[0.56,0.32], 12:[0.44,0.32], 13:[0.61,0.44], 14:[0.39,0.44],
          15:[0.56,0.54], 16:[0.44,0.54], 23:[0.55,0.55], 24:[0.45,0.55],
          25:[0.66,0.72], 26:[0.30,0.68], 27:[0.77,0.90], 28:[0.28,0.90]
        }),
        createPoseFrame({
          0:[0.48,0.22], 11:[0.56,0.32], 12:[0.44,0.32], 13:[0.68,0.32], 14:[0.32,0.32],
          15:[0.80,0.32], 16:[0.20,0.32], 23:[0.55,0.55], 24:[0.45,0.55],
          25:[0.66,0.72], 26:[0.30,0.68], 27:[0.77,0.90], 28:[0.28,0.90]
        })
      ],
      Triangle: [
        createPoseFrame({
          0:[0.50,0.16], 11:[0.56,0.27], 12:[0.44,0.27], 13:[0.58,0.41], 14:[0.42,0.41],
          15:[0.59,0.54], 16:[0.41,0.54], 23:[0.54,0.52], 24:[0.46,0.52],
          25:[0.54,0.71], 26:[0.46,0.71], 27:[0.54,0.90], 28:[0.46,0.90]
        }),
        createPoseFrame({
          0:[0.50,0.19], 11:[0.56,0.30], 12:[0.44,0.30], 13:[0.68,0.30], 14:[0.32,0.30],
          15:[0.80,0.30], 16:[0.20,0.30], 23:[0.55,0.53], 24:[0.45,0.53],
          25:[0.65,0.71], 26:[0.36,0.71], 27:[0.75,0.90], 28:[0.28,0.90]
        }),
        createPoseFrame({
          0:[0.40,0.28], 11:[0.49,0.33], 12:[0.41,0.39], 13:[0.57,0.24], 14:[0.35,0.49],
          15:[0.64,0.15], 16:[0.30,0.59], 23:[0.55,0.54], 24:[0.46,0.55],
          25:[0.65,0.72], 26:[0.37,0.72], 27:[0.75,0.90], 28:[0.29,0.90]
        }),
        createPoseFrame({
          0:[0.33,0.37], 11:[0.44,0.37], 12:[0.38,0.47], 13:[0.44,0.23], 14:[0.36,0.61],
          15:[0.44,0.10], 16:[0.34,0.74], 23:[0.55,0.54], 24:[0.46,0.56],
          25:[0.65,0.72], 26:[0.38,0.73], 27:[0.75,0.90], 28:[0.30,0.90]
        })
      ],
      DownwardDog: [
        createPoseFrame({
          0:[0.23,0.58], 11:[0.32,0.63], 12:[0.32,0.65], 13:[0.31,0.76], 14:[0.31,0.77],
          15:[0.31,0.90], 16:[0.31,0.90], 23:[0.60,0.63], 24:[0.60,0.65],
          25:[0.61,0.90], 26:[0.61,0.90], 27:[0.78,0.90], 28:[0.78,0.90]
        }),
        createPoseFrame({
          0:[0.24,0.60], 11:[0.32,0.63], 12:[0.32,0.65], 13:[0.31,0.76], 14:[0.31,0.77],
          15:[0.30,0.90], 16:[0.30,0.90], 23:[0.60,0.62], 24:[0.60,0.64],
          25:[0.63,0.88], 26:[0.63,0.88], 27:[0.76,0.90], 28:[0.76,0.90]
        }),
        createPoseFrame({
          0:[0.31,0.64], 11:[0.37,0.61], 12:[0.36,0.63], 13:[0.31,0.75], 14:[0.30,0.76],
          15:[0.25,0.90], 16:[0.24,0.90], 23:[0.57,0.49], 24:[0.56,0.51],
          25:[0.66,0.70], 26:[0.65,0.71], 27:[0.76,0.90], 28:[0.75,0.90]
        }),
        createPoseFrame({
          0:[0.34,0.67], 11:[0.39,0.61], 12:[0.37,0.63], 13:[0.31,0.75], 14:[0.29,0.76],
          15:[0.23,0.90], 16:[0.22,0.90], 23:[0.55,0.38], 24:[0.53,0.40],
          25:[0.66,0.64], 26:[0.64,0.65], 27:[0.77,0.90], 28:[0.75,0.90]
        })
      ],
      Utkatasana: [
        createPoseFrame({
          0:[0.50,0.16], 11:[0.52,0.27], 12:[0.48,0.27], 13:[0.53,0.41], 14:[0.47,0.41],
          15:[0.53,0.54], 16:[0.47,0.54], 23:[0.52,0.52], 24:[0.48,0.52],
          25:[0.52,0.71], 26:[0.48,0.71], 27:[0.52,0.90], 28:[0.48,0.90]
        }),
        createPoseFrame({
          0:[0.47,0.20], 11:[0.51,0.31], 12:[0.47,0.31], 13:[0.48,0.43], 14:[0.44,0.43],
          15:[0.43,0.46], 16:[0.39,0.46], 23:[0.56,0.55], 24:[0.52,0.55],
          25:[0.47,0.71], 26:[0.43,0.71], 27:[0.52,0.90], 28:[0.48,0.90]
        }),
        createPoseFrame({
          0:[0.45,0.23], 11:[0.49,0.34], 12:[0.46,0.34], 13:[0.41,0.26], 14:[0.38,0.26],
          15:[0.33,0.19], 16:[0.30,0.19], 23:[0.58,0.56], 24:[0.55,0.56],
          25:[0.45,0.72], 26:[0.42,0.72], 27:[0.52,0.90], 28:[0.48,0.90]
        }),
        createPoseFrame({
          0:[0.44,0.24], 11:[0.48,0.34], 12:[0.46,0.34], 13:[0.40,0.22], 14:[0.38,0.22],
          15:[0.33,0.11], 16:[0.31,0.11], 23:[0.59,0.56], 24:[0.56,0.56],
          25:[0.44,0.72], 26:[0.42,0.72], 27:[0.52,0.90], 28:[0.48,0.90]
        })
      ],
      Bhujangasana: [
        createPoseFrame({
          0:[0.18,0.88], 11:[0.31,0.88], 12:[0.31,0.89], 13:[0.38,0.87], 14:[0.38,0.88],
          15:[0.31,0.90], 16:[0.31,0.90], 23:[0.55,0.89], 24:[0.55,0.90],
          25:[0.72,0.90], 26:[0.72,0.90], 27:[0.89,0.90], 28:[0.89,0.90]
        }),
        createPoseFrame({
          0:[0.20,0.83], 11:[0.31,0.84], 12:[0.31,0.85], 13:[0.38,0.81], 14:[0.38,0.82],
          15:[0.31,0.90], 16:[0.31,0.90], 23:[0.55,0.89], 24:[0.55,0.90],
          25:[0.72,0.90], 26:[0.72,0.90], 27:[0.89,0.90], 28:[0.89,0.90]
        }),
        createPoseFrame({
          0:[0.23,0.71], 11:[0.31,0.75], 12:[0.31,0.76], 13:[0.37,0.79], 14:[0.37,0.80],
          15:[0.31,0.90], 16:[0.31,0.90], 23:[0.55,0.88], 24:[0.55,0.89],
          25:[0.72,0.90], 26:[0.72,0.90], 27:[0.89,0.90], 28:[0.89,0.90]
        }),
        createPoseFrame({
          0:[0.26,0.55], 11:[0.31,0.63], 12:[0.31,0.65], 13:[0.35,0.77], 14:[0.35,0.78],
          15:[0.31,0.90], 16:[0.31,0.90], 23:[0.55,0.87], 24:[0.55,0.88],
          25:[0.72,0.90], 26:[0.72,0.90], 27:[0.89,0.90], 28:[0.89,0.90]
        })
      ],
      Anjaneyasana: [
        createPoseFrame({
          0:[0.44,0.16], 11:[0.47,0.27], 12:[0.42,0.27], 13:[0.48,0.41], 14:[0.41,0.41],
          15:[0.48,0.54], 16:[0.41,0.54], 23:[0.46,0.52], 24:[0.43,0.52],
          25:[0.46,0.71], 26:[0.43,0.71], 27:[0.46,0.90], 28:[0.43,0.90]
        }),
        createPoseFrame({
          0:[0.43,0.21], 11:[0.46,0.32], 12:[0.42,0.32], 13:[0.47,0.45], 14:[0.41,0.45],
          15:[0.46,0.56], 16:[0.40,0.56], 23:[0.49,0.55], 24:[0.46,0.55],
          25:[0.64,0.72], 26:[0.31,0.64], 27:[0.78,0.90], 28:[0.30,0.90]
        }),
        createPoseFrame({
          0:[0.44,0.23], 11:[0.46,0.34], 12:[0.44,0.34], 13:[0.43,0.46], 14:[0.41,0.46],
          15:[0.35,0.56], 16:[0.33,0.56], 23:[0.49,0.58], 24:[0.47,0.58],
          25:[0.66,0.90], 26:[0.31,0.63], 27:[0.83,0.90], 28:[0.30,0.90]
        }),
        createPoseFrame({
          0:[0.44,0.22], 11:[0.46,0.33], 12:[0.44,0.33], 13:[0.45,0.20], 14:[0.43,0.20],
          15:[0.44,0.08], 16:[0.42,0.08], 23:[0.49,0.58], 24:[0.47,0.58],
          25:[0.66,0.90], 26:[0.31,0.62], 27:[0.83,0.90], 28:[0.30,0.90]
        })
      ]
    };

    let tutorialStep = 0;
    let tutorialPlaying = false;
    let tutorialFallbackTimer = null;
    let tutorialPauseAfterSpeechTimer = null;
    let tutorialAnimFrame = null;
    let tutorialTransitionStart = 0;
    let tutorialFrom = null;
    let tutorialTo = null;
    let lastMascotMilestone = 0;

    function getTutorialKey() {
      return targetAsanaLock === 'AUTO'
        ? (latestAssessment?.asanaKey || currentDisplayedGuideKey || 'Tadasana')
        : targetAsanaLock;
    }

    function getTutorialLandmarks(key, step) {
      const frames = TUTORIAL_KEYFRAMES[key] || TUTORIAL_KEYFRAMES.Tadasana;
      return frames[Math.max(0, Math.min(frames.length - 1, step))];
    }

    function drawTutorialFigure(progress = 1) {
      const canvas = document.getElementById('tutorialFigure');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const isTwilight = document.documentElement.getAttribute('data-circadian-theme') === 'twilight';
      const key = getTutorialKey();
      const start = tutorialFrom || getTutorialLandmarks(key, tutorialStep);
      const end = tutorialTo || getTutorialLandmarks(key, tutorialStep);
      const t = Math.max(0, Math.min(1, progress));
      const eased = t * t * (3 - 2 * t);
      const points = start.map((p, i) => ({
        x: p.x + (end[i].x - p.x) * eased,
        y: p.y + (end[i].y - p.y) * eased
      }));

      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const bg = ctx.createLinearGradient(0, 0, w, h);
      if (isTwilight) {
        bg.addColorStop(0, '#163337');
        bg.addColorStop(0.6, '#102427');
        bg.addColorStop(1, '#0B181A');
      } else {
        bg.addColorStop(0, '#F7FCF9');
        bg.addColorStop(0.6, '#ECFDF5');
        bg.addColorStop(1, '#D1FAE5');
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const xy = (p) => ({ x: 210 + (p.x - 0.5) * 310, y: 38 + p.y * 320 });
      const P = points.map(xy);

      // Grounded Yoga Mat at ny = 0.90 (y = 325px)
      const matY = 325;
      const matGrad = ctx.createLinearGradient(44, matY, 376, matY + 14);
      matGrad.addColorStop(0, isTwilight ? '#10B981' : '#065F46');
      matGrad.addColorStop(0.5, isTwilight ? '#34D399' : '#059669');
      matGrad.addColorStop(1, isTwilight ? '#6366F1' : '#047857');
      ctx.fillStyle = matGrad;
      ctx.beginPath();
      ctx.roundRect(44, matY, 332, 13, 6.5);
      ctx.fill();

      // Dynamic Ground Contact Shadows under every grounded landmark
      points.forEach((normPt, idx) => {
        if (normPt.y >= 0.83 && [0, 11, 12, 15, 16, 23, 24, 25, 26, 27, 28].includes(idx)) {
          const px = P[idx].x;
          ctx.fillStyle = isTwilight ? 'rgba(52, 211, 153, 0.22)' : 'rgba(6, 78, 59, 0.18)';
          ctx.beginPath();
          ctx.ellipse(px, matY + 2, 18, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      const skin = '#C98968', skinLight = '#E4B092';
      const outfit = isTwilight ? '#34D399' : '#1F6349';
      const outfitDark = isTwilight ? '#1E293B' : '#0B281E';

      const limb = (a, b, width, color = skin) => {
        const A = P[a], B = P[b];
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = isTwilight ? 'rgba(0,0,0,0.28)' : 'rgba(6, 78, 59, 0.10)';
        ctx.lineWidth = width + 4;
        ctx.beginPath();
        ctx.moveTo(A.x + 2, A.y + 3);
        ctx.lineTo(B.x + 2, B.y + 3);
        ctx.stroke();

        const g = ctx.createLinearGradient(A.x - width / 2, A.y, B.x + width / 2, B.y);
        g.addColorStop(0, color === skin ? skinLight : outfit);
        g.addColorStop(1, color);
        ctx.strokeStyle = g;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      };
      const joint = (i, r = 7, color = skin) => {
        const q = P[i];
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      };

      limb(23, 25, 22, outfitDark);
      limb(25, 27, 19, skin);
      limb(24, 26, 22, outfitDark);
      limb(26, 28, 19, skin);
      [27, 28].forEach((i) => {
        const q = P[i];
        ctx.fillStyle = isTwilight ? '#6EE7B7' : '#0B281E';
        ctx.beginPath();
        ctx.ellipse(q.x + 6, Math.min(matY - 2, q.y + 2), 16, 7, -0.05, 0, Math.PI * 2);
        ctx.fill();
      });

      const L = P[11], R = P[12], HL = P[23], HR = P[24];
      const shoulderMid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 };
      const hipMid = { x: (HL.x + HR.x) / 2, y: (HL.y + HR.y) / 2 };

      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.quadraticCurveTo(shoulderMid.x - 20, shoulderMid.y + 28, HL.x - 8, HL.y);
      ctx.quadraticCurveTo(hipMid.x, hipMid.y + 14, HR.x + 8, HR.y);
      ctx.quadraticCurveTo(shoulderMid.x + 20, shoulderMid.y + 28, R.x, R.y);
      ctx.quadraticCurveTo(shoulderMid.x + 5, shoulderMid.y - 11, shoulderMid.x, shoulderMid.y - 11);
      ctx.quadraticCurveTo(shoulderMid.x - 5, shoulderMid.y - 11, L.x, L.y);
      ctx.closePath();

      const torsoGrad = ctx.createLinearGradient(L.x, L.y, R.x, R.y + 38);
      torsoGrad.addColorStop(0, isTwilight ? '#10B981' : '#2A7B5C');
      torsoGrad.addColorStop(1, isTwilight ? '#312E81' : outfitDark);
      ctx.fillStyle = torsoGrad;
      ctx.fill();
      ctx.strokeStyle = isTwilight ? 'rgba(110, 231, 183, 0.45)' : 'rgba(6, 78, 59, 0.32)';
      ctx.lineWidth = 2;
      ctx.stroke();

      limb(11, 13, 16, skin);
      limb(13, 15, 13, skinLight);
      limb(12, 14, 16, skin);
      limb(14, 16, 13, skinLight);
      [13, 14, 15, 16, 25, 26].forEach((i) => joint(i, 6.5));

      const head = P[0];
      const neckTop = { x: shoulderMid.x, y: shoulderMid.y - 6 };
      ctx.strokeStyle = skin;
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(neckTop.x, neckTop.y);
      ctx.lineTo(head.x, head.y + 16);
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(head.x, head.y - 1, 22, 26, -0.04, 0, Math.PI * 2);
      const face = ctx.createLinearGradient(head.x - 16, head.y - 22, head.x + 18, head.y + 20);
      face.addColorStop(0, '#F0C4A4');
      face.addColorStop(1, skin);
      ctx.fillStyle = face;
      ctx.fill();
      ctx.strokeStyle = '#9D6B56';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#3B2B24';
      ctx.beginPath();
      ctx.moveTo(head.x - 22, head.y - 4);
      ctx.quadraticCurveTo(head.x - 24, head.y - 34, head.x + 2, head.y - 28);
      ctx.quadraticCurveTo(head.x + 24, head.y - 27, head.x + 22, head.y - 4);
      ctx.quadraticCurveTo(head.x + 9, head.y - 14, head.x - 1, head.y - 15);
      ctx.quadraticCurveTo(head.x - 12, head.y - 9, head.x - 22, head.y - 4);
      ctx.fill();

      ctx.fillStyle = '#3B2B24';
      ctx.beginPath();
      ctx.arc(head.x - 7, head.y + 1, 1.8, 0, Math.PI * 2);
      ctx.arc(head.x + 7, head.y + 1, 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#9B5C4C';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(head.x, head.y + 7, 4.5, 0.15, Math.PI - 0.15);
      ctx.stroke();

      ctx.fillStyle = isTwilight ? '#A7F3D0' : '#064E3B';
      ctx.font = '700 13px Plus Jakarta Sans, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ASANA_PROFILES[key]?.english || 'Yoga Pose', 210, 24);
    }

    function clearTutorialTimers() {
      clearTimeout(tutorialFallbackTimer);
      clearTimeout(tutorialPauseAfterSpeechTimer);
      const pill = document.getElementById('voiceSyncStatusPill');
      if (pill) pill.classList.add('hidden');
    }

    function scheduleNextTutorialStepAfterSpeech(speechStarted, spokenText) {
      clearTutorialTimers();
      if (!tutorialPlaying) return;

      if (!speechStarted) {
        tutorialFallbackTimer = setTimeout(() => {
          if (tutorialPlaying) advanceTutorialPlayback();
        }, 4500);
        return;
      }

      const pill = document.getElementById('voiceSyncStatusPill');
      if (pill) pill.classList.remove('hidden');

      const estimatedMs = Math.max(5500, spokenText.length * 85 + 2500);
      tutorialFallbackTimer = setTimeout(() => {
        if (tutorialPlaying) advanceTutorialPlayback();
      }, estimatedMs);
    }

    function advanceTutorialPlayback() {
      clearTutorialTimers();
      if (!tutorialPlaying) return;

      if (tutorialStep >= 3) {
        tutorialPlaying = false;
        document.getElementById('tutorialPlay').textContent = '▶ Play steps';
        updateMascot('Wonderful flow! You completed all 4 grounded steps. 🌿');
        return;
      }

      tutorialStep += 1;
      renderTutorialStep(true);
    }

    function renderTutorialStep(animate = true) {
      const key = getTutorialKey();
      const steps = POSE_TUTORIALS[key] || POSE_TUTORIALS.Tadasana;
      const step = Math.max(0, Math.min(3, tutorialStep));

      document.getElementById('tutorialStepCount').textContent = `Step ${step + 1} of ${steps.length}`;
      document.getElementById('tutorialStepTitle').textContent = steps[step][0];
      document.getElementById('tutorialStepText').textContent = steps[step][1];

      document.querySelectorAll('#tutorialDots .step-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === step);
        dot.classList.toggle('done', i < step);
      });

      document.getElementById('tutorialPrev').disabled = step === 0;
      document.getElementById('tutorialNext').textContent = step === 3 ? 'Start again ↺' : 'Next →';

      if (tutorialAnimFrame) cancelAnimationFrame(tutorialAnimFrame);
      tutorialFrom = getTutorialLandmarks(key, step === 0 ? 0 : step - 1);
      tutorialTo = getTutorialLandmarks(key, step);
      tutorialTransitionStart = performance.now();

      const draw = (now) => {
        const progress = animate ? Math.min(1, (now - tutorialTransitionStart) / 850) : 1;
        drawTutorialFigure(progress);
        if (progress < 1) tutorialAnimFrame = requestAnimationFrame(draw);
      };
      tutorialAnimFrame = requestAnimationFrame(draw);

      updateMascot(
        step === 3
          ? 'You reached the full posture. Breathe calmly, then release gently!'
          : 'You are doing great. Ground yourself one step at a time! 🌱'
      );

      if (tutorialPlaying) {
        const fullPhrase = `Step ${step + 1}. ${steps[step][0]}. ${steps[step][1]}`;
        const didSpeak = voiceEnabled
          ? speakText(fullPhrase, true, () => {
              clearTutorialTimers();
              if (tutorialPlaying) {
                tutorialPauseAfterSpeechTimer = setTimeout(() => {
                  advanceTutorialPlayback();
                }, 950);
              }
            })
          : false;

        scheduleNextTutorialStepAfterSpeech(didSpeak, fullPhrase);
      }
    }

    function tutorialNext() {
      clearTutorialTimers();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      tutorialStep = tutorialStep >= 3 ? 0 : tutorialStep + 1;
      if (tutorialPlaying && tutorialStep === 0) {
        tutorialPlaying = false;
        document.getElementById('tutorialPlay').textContent = '▶ Play steps';
      }
      renderTutorialStep(true);
    }

    function tutorialPrevious() {
      clearTutorialTimers();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      tutorialStep = Math.max(0, tutorialStep - 1);
      renderTutorialStep(true);
    }

    function tutorialPlayPause() {
      clearTutorialTimers();
      tutorialPlaying = !tutorialPlaying;
      document.getElementById('tutorialPlay').textContent = tutorialPlaying ? 'Ⅱ Pause' : '▶ Play steps';

      if (tutorialPlaying) {
        if (!voiceEnabled && !voiceAutoArmed && 'speechSynthesis' in window) {
          voiceEnabled = true;
          voiceAutoArmed = true;
          document.getElementById('voiceStateText').textContent = 'Active';
        }
        if (tutorialStep === 3) tutorialStep = 0;
        renderTutorialStep(true);
      } else {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      }
    }

    function speakText(textToSpeak, force = false, onFinishedCallback = null) {
      if (!('speechSynthesis' in window) || !textToSpeak) {
        const status = document.getElementById('voiceStateText');
        if (status) status.textContent = 'Unavailable';
        return false;
      }
      if (!voiceEnabled && !force) return false;

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 0.94;
        utterance.pitch = 1.02;
        utterance.volume = 1;

        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((v) => /^en-IN/i.test(v.lang)) ||
          voices.find((v) => /^en/i.test(v.lang));
        if (preferred) utterance.voice = preferred;

        let callbackInvoked = false;
        const handleDone = () => {
          if (callbackInvoked) return;
          callbackInvoked = true;
          const badge = document.getElementById('cameraLiveStatusBadge');
          if (badge && mpCameraActive) badge.textContent = 'Camera Active • Voice ready';
          if (typeof onFinishedCallback === 'function') onFinishedCallback();
        };

        utterance.onstart = () => {
          const badge = document.getElementById('cameraLiveStatusBadge');
          if (badge) badge.textContent = 'Voice coach speaking...';
        };
        utterance.onend = handleDone;
        utterance.onerror = handleDone;

        window.speechSynthesis.speak(utterance);
        return true;
      } catch (err) {
        return false;
      }
    }

    function speakTutorialStep() {
      const steps = POSE_TUTORIALS[getTutorialKey()] || POSE_TUTORIALS.Tadasana;
      speakText(`${steps[tutorialStep][0]}. ${steps[tutorialStep][1]}`, true);
    }

    function updateMascot(message) {
      const msg = document.getElementById('mascotMessage');
      if (msg) msg.textContent = message;
    }

    function dismissMascot() {
      document.getElementById('pranaMascot')?.classList.add('hidden');
    }

    function celebrateMascot() {
      updateMascot('Lovely work! You completed a mindful practice step. Keep it gentle and steady. 🌟');
    }

    // -------------------------------------------------------------------------
    // 2. MEDITATION TIMER & OFFLINE WEB AUDIO SOUNDSCAPES + SINGING BOWL
    // -------------------------------------------------------------------------
    let meditationTotalSeconds = 600;
    let meditationRemainingSeconds = 600;
    let meditationRunning = false;
    let meditationInterval = null;
    let selectedAmbientType = 'rain';
    let selectedBreathPattern = 'coherent';
    let ambientVolume = 0.55;

    let audioCtx = null;
    let ambientMasterGain = null;
    let ambientStopFn = null;
    let breathCycleTimeout = null;

    function ensureAudioContext() {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
          ambientMasterGain = audioCtx.createGain();
          ambientMasterGain.gain.value = ambientVolume;
          ambientMasterGain.connect(audioCtx.destination);
        }
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    }

    function ringTibetanBowl(intensity = 1.0) {
      const ctx = ensureAudioContext();
      if (!ctx) {
        showToast('Web Audio is not supported in this browser.', 'ℹ️');
        return;
      }
      const now = ctx.currentTime;
      const partials = [
        { freq: 216, gain: 0.28, decay: 6.5 },
        { freq: 432, gain: 0.18, decay: 5.2 },
        { freq: 648, gain: 0.11, decay: 4.0 },
        { freq: 1188, gain: 0.05, decay: 2.8 }
      ];

      partials.forEach((p) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(p.freq, now);
        osc.frequency.exponentialRampToValueAtTime(p.freq * 1.002, now + p.decay);

        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.linearRampToValueAtTime(p.gain * intensity, now + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + p.decay + 0.1);
      });
    }

    function stopAmbientSoundscape() {
      if (typeof ambientStopFn === 'function') {
        try { ambientStopFn(); } catch (e) {}
        ambientStopFn = null;
      }
      const badge = document.getElementById('ambientStatusBadge');
      if (badge) badge.textContent = meditationRunning ? 'Playing' : 'Ready';
    }

    function startAmbientSoundscape(type) {
      stopAmbientSoundscape();
      if (type === 'silence') {
        document.getElementById('ambientStatusBadge').textContent = 'Silent Mode';
        return;
      }

      const ctx = ensureAudioContext();
      if (!ctx) return;

      document.getElementById('ambientStatusBadge').textContent = 'Playing Live';

      const bufferSize = ctx.sampleRate * 4;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
        b6 = white * 0.115926;
      }

      if (type === 'rain') {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 1150;

        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 180;

        const rainGain = ctx.createGain();
        rainGain.gain.value = 0.65;

        src.connect(lowpass);
        lowpass.connect(highpass);
        highpass.connect(rainGain);
        rainGain.connect(ambientMasterGain);
        src.start();

        ambientStopFn = () => { src.stop(); src.disconnect(); };
      } else if (type === 'ocean') {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;

        const waveGain = ctx.createGain();
        waveGain.gain.value = 0.45;

        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.12;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.32;

        lfo.connect(lfoGain);
        lfoGain.connect(waveGain.gain);

        src.connect(filter);
        filter.connect(waveGain);
        waveGain.connect(ambientMasterGain);

        src.start();
        lfo.start();
        ambientStopFn = () => {
          src.stop(); lfo.stop();
          src.disconnect(); lfo.disconnect();
        };
      } else if (type === 'forest') {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;

        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 540;
        bandpass.Q.value = 1.4;

        const windGain = ctx.createGain();
        windGain.gain.value = 0.48;

        src.connect(bandpass);
        bandpass.connect(windGain);
        windGain.connect(ambientMasterGain);
        src.start();

        const chimeNotes = [528, 594, 660, 792, 880];
        const chimeTimer = setInterval(() => {
          if (!audioCtx || !meditationRunning) return;
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = chimeNotes[Math.floor(Math.random() * chimeNotes.length)];
          g.gain.setValueAtTime(0.0001, now);
          g.gain.linearRampToValueAtTime(0.05, now + 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
          osc.connect(g);
          g.connect(ambientMasterGain);
          osc.start(now);
          osc.stop(now + 3.3);
        }, 4200);

        ambientStopFn = () => {
          clearInterval(chimeTimer);
          src.stop();
          src.disconnect();
        };
      } else if (type === 'om') {
        const freqs = [108, 162, 216, 324];
        const oscs = freqs.map((f, idx) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = idx === 0 ? 'triangle' : 'sine';
          osc.frequency.value = f;
          g.gain.value = idx === 0 ? 0.14 : 0.08;
          osc.connect(g);
          g.connect(ambientMasterGain);
          osc.start();
          return osc;
        });

        ambientStopFn = () => {
          oscs.forEach((o) => { o.stop(); o.disconnect(); });
        };
      }
    }

    function selectAmbientSound(type) {
      selectedAmbientType = type;
      document.querySelectorAll('.sound-card-btn').forEach((btn) => {
        btn.classList.remove('border-2', 'border-forest-500', 'bg-forest-50');
        btn.classList.add('border', 'border-forest-200', 'bg-white');
      });
      const active = document.getElementById(`sound-${type}`);
      if (active) {
        active.classList.remove('border', 'border-forest-200', 'bg-white');
        active.classList.add('border-2', 'border-forest-500', 'bg-forest-50');
      }
      if (meditationRunning) {
        startAmbientSoundscape(type);
      }
    }

    function updateAmbientVolume(val) {
      ambientVolume = parseInt(val, 10) / 100;
      document.getElementById('ambientVolumeLabel').textContent = `${val}%`;
      if (ambientMasterGain && audioCtx) {
        ambientMasterGain.gain.setTargetAtTime(ambientVolume, audioCtx.currentTime, 0.05);
      }
    }

    function selectBreathPattern(pattern) {
      selectedBreathPattern = pattern;
      document.querySelectorAll('.breath-btn').forEach((btn) => {
        btn.classList.remove('border-2', 'border-forest-500', 'bg-forest-50');
        btn.classList.add('border', 'border-forest-200', 'bg-white');
      });
      const active = document.getElementById(`breath-${pattern}`);
      if (active) {
        active.classList.remove('border', 'border-forest-200', 'bg-white');
        active.classList.add('border-2', 'border-forest-500', 'bg-forest-50');
      }
      if (meditationRunning) {
        startBreathVisualizerLoop();
      }
    }

    function startBreathVisualizerLoop() {
      clearTimeout(breathCycleTimeout);
      const outer = document.getElementById('breathOuterRing');
      const middle = document.getElementById('breathMiddleRing');
      const label = document.getElementById('breathCuePhase');

      if (!meditationRunning) {
        outer.style.transform = 'scale(1)';
        middle.style.transform = 'scale(1)';
        label.textContent = 'Ready to Begin';
        return;
      }

      if (selectedBreathPattern === 'free') {
        label.textContent = 'Silent Focus';
        outer.style.transform = 'scale(1.06)';
        middle.style.transform = 'scale(1.03)';
        return;
      }

      const sequences = {
        coherent: [
          { text: 'Inhale Slowly...', scaleOuter: 1.18, scaleMid: 1.12, ms: 5000 },
          { text: 'Exhale Softly...', scaleOuter: 0.94, scaleMid: 0.96, ms: 5000 }
        ],
        box: [
          { text: 'Inhale (4s)', scaleOuter: 1.18, scaleMid: 1.12, ms: 4000 },
          { text: 'Hold Full (4s)', scaleOuter: 1.18, scaleMid: 1.12, ms: 4000 },
          { text: 'Exhale (4s)', scaleOuter: 0.94, scaleMid: 0.96, ms: 4000 },
          { text: 'Hold Empty (4s)', scaleOuter: 0.94, scaleMid: 0.96, ms: 4000 }
        ],
        relax478: [
          { text: 'Inhale Nose (4s)', scaleOuter: 1.18, scaleMid: 1.12, ms: 4000 },
          { text: 'Hold Gently (7s)', scaleOuter: 1.18, scaleMid: 1.12, ms: 7000 },
          { text: 'Long Exhale (8s)', scaleOuter: 0.92, scaleMid: 0.95, ms: 8000 }
        ]
      };

      const steps = sequences[selectedBreathPattern] || sequences.coherent;
      let idx = 0;

      const runStep = () => {
        if (!meditationRunning) return;
        const s = steps[idx];
        label.textContent = s.text;
        outer.style.transitionDuration = `${s.ms}ms`;
        middle.style.transitionDuration = `${s.ms}ms`;
        outer.style.transform = `scale(${s.scaleOuter})`;
        middle.style.transform = `scale(${s.scaleMid})`;
        idx = (idx + 1) % steps.length;
        breathCycleTimeout = setTimeout(runStep, s.ms);
      };

      runStep();
    }

    function formatMinutesSeconds(sec) {
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      return `${m}:${s}`;
    }

    function setMeditationMinutes(mins) {
      const m = Math.max(1, Math.min(60, parseInt(mins, 10) || 10));
      if (meditationRunning) {
        pauseMeditationTimer();
      }
      meditationTotalSeconds = m * 60;
      meditationRemainingSeconds = m * 60;
      document.getElementById('meditationTimerDisplay').textContent = formatMinutesSeconds(meditationRemainingSeconds);
      document.getElementById('meditationSubLabel').textContent = `${m} min session`;
      document.getElementById('customMedMinsLabel').textContent = `${m} mins`;
      document.getElementById('customMedSlider').value = m;

      document.querySelectorAll('.med-preset-btn').forEach((btn) => {
        const isMatch = parseInt(btn.dataset.mins, 10) === m;
        btn.className = isMatch
          ? 'med-preset-btn px-3.5 py-1.5 rounded-xl text-xs font-bold bg-forest-500 text-white border border-forest-300 shadow-md transition-all'
          : 'med-preset-btn px-3 py-1.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/15 text-forest-100 transition-all';
      });
    }

    function toggleMeditationTimer() {
      if (meditationRunning) pauseMeditationTimer();
      else startMeditationTimer();
    }

    function startMeditationTimer() {
      if (meditationRemainingSeconds <= 0) {
        meditationRemainingSeconds = meditationTotalSeconds;
      }
      meditationRunning = true;
      document.getElementById('medStartIcon').textContent = 'Ⅱ';
      document.getElementById('medStartLabel').textContent = 'Pause';

      ringTibetanBowl(0.95);
      startAmbientSoundscape(selectedAmbientType);
      startBreathVisualizerLoop();
      updateMascot('Settle into stillness. Let the soundscape anchor your focus. 🪷');

      clearInterval(meditationInterval);
      meditationInterval = setInterval(() => {
        meditationRemainingSeconds -= 1;
        document.getElementById('meditationTimerDisplay').textContent = formatMinutesSeconds(Math.max(0, meditationRemainingSeconds));

        if (meditationRemainingSeconds <= 0) {
          finishMeditationSession(Math.max(1, Math.round(meditationTotalSeconds / 60)));
        }
      }, 1000);
    }

    function pauseMeditationTimer() {
      meditationRunning = false;
      clearInterval(meditationInterval);
      clearTimeout(breathCycleTimeout);
      stopAmbientSoundscape();
      document.getElementById('medStartIcon').textContent = '▶';
      document.getElementById('medStartLabel').textContent = 'Resume';
      document.getElementById('breathCuePhase').textContent = 'Paused';
    }

    function resetMeditationTimer() {
      pauseMeditationTimer();
      meditationRemainingSeconds = meditationTotalSeconds;
      document.getElementById('meditationTimerDisplay').textContent = formatMinutesSeconds(meditationRemainingSeconds);
      document.getElementById('medStartLabel').textContent = 'Begin Meditation';
      startBreathVisualizerLoop();
    }

    function completeMeditationEarly() {
      const elapsedSec = meditationTotalSeconds - meditationRemainingSeconds;
      const minsCompleted = Math.max(1, Math.round(elapsedSec / 60));
      finishMeditationSession(minsCompleted);
    }

    function finishMeditationSession(minsLogged) {
      pauseMeditationTimer();
      meditationRemainingSeconds = meditationTotalSeconds;
      document.getElementById('meditationTimerDisplay').textContent = formatMinutesSeconds(meditationRemainingSeconds);
      document.getElementById('medStartLabel').textContent = 'Begin Meditation';
      document.getElementById('breathCuePhase').textContent = 'Session Complete';

      ringTibetanBowl(1.0);
      setTimeout(() => ringTibetanBowl(0.75), 1400);

      const data = loadAnalyticsData();
      const lastIdx = data.labels.length - 1;
      data.practiceMinutes[lastIdx] = (data.practiceMinutes[lastIdx] || 0) + minsLogged;
      localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(data));

      recordAchievementProgress({ meditationCompleted: 1, meditationMinutes: minsLogged });
      awardXp(35, `Completed ${minsLogged}-min Mindful Meditation`);
      celebrateMascot();
    }

    // -------------------------------------------------------------------------
    // 3. GAMIFICATION ENGINE (STREAK, XP, LEVELS & DAILY QUEST)
    // -------------------------------------------------------------------------
    const RANKS = [
      { minXp: 0, title: 'Novice Yogi' },
      { minXp: 150, title: 'Mindful Mover' },
      { minXp: 400, title: 'Asana Seeker' },
      { minXp: 800, title: 'Prana Adept' },
      { minXp: 1400, title: 'Surya Master' },
      { minXp: 2200, title: 'Zen Sage' }
    ];

    function getTodayIsoDate() {
      return new Date().toISOString().slice(0, 10);
    }

    function loadGamificationState() {
      const today = getTodayIsoDate();
      const raw = localStorage.getItem(STORAGE_KEY_GAMIFICATION);
      let state = {
        totalXp: 60,
        streakDays: 1,
        lastActiveDate: today,
        dailyDate: today,
        dailyXp: 0
      };
      if (raw) {
        try {
          state = { ...state, ...JSON.parse(raw) };
        } catch (e) {}
      }
      if (state.lastActiveDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (state.lastActiveDate !== yesterday) {
          state.streakDays = 0;
        }
      }
      if (state.dailyDate !== today) {
        state.dailyDate = today;
        state.dailyXp = 0;
      }
      return state;
    }

    function saveGamificationState(state) {
      localStorage.setItem(STORAGE_KEY_GAMIFICATION, JSON.stringify(state));
      renderGamificationHud();
    }

    function awardXp(points, reasonLabel) {
      const today = getTodayIsoDate();
      const state = loadGamificationState();

      if (state.lastActiveDate !== today || state.streakDays === 0) {
        state.streakDays = (state.streakDays || 0) + 1;
        state.lastActiveDate = today;
      }

      const prevLevel = Math.floor(state.totalXp / 150) + 1;
      state.totalXp += points;
      state.dailyXp += points;
      const newLevel = Math.floor(state.totalXp / 150) + 1;

      saveGamificationState(state);

      if (newLevel > prevLevel) {
        showToast(`LEVEL UP! You reached Level ${newLevel} (+${points} XP: ${reasonLabel})`, '🎉');
      } else {
        showToast(`+${points} XP earned! ${reasonLabel}`, '⭐');
      }
    }

    function getRankForXp(xp) {
      let current = RANKS[0].title;
      for (const r of RANKS) {
        if (xp >= r.minXp) current = r.title;
      }
      return current;
    }

    function renderGamificationHud() {
      const state = loadGamificationState();
      const level = Math.floor(state.totalXp / 150) + 1;
      const rank = getRankForXp(state.totalXp);
      const dailyPct = Math.min(100, Math.round((state.dailyXp / 100) * 100));

      const streakEl = document.getElementById('hudStreakDays');
      if (streakEl) streakEl.textContent = state.streakDays;
      document.getElementById('hudTotalXp').textContent = state.totalXp;
      document.getElementById('hudLevelNum').textContent = level;
      document.getElementById('hudRankTitle').textContent = rank;
      document.getElementById('hudDailyXpLabel').textContent = `${state.dailyXp} / 100 XP`;
      document.getElementById('hudDailyXpBar').style.width = `${dailyPct}%`;

      const kpiXp = document.getElementById('kpiTotalXpAnalytics');
      const kpiRank = document.getElementById('kpiRankAnalytics');
      if (kpiXp) kpiXp.textContent = `${state.totalXp} XP`;
      if (kpiRank) kpiRank.textContent = `Rank: ${rank} (Level ${level})`;
    }

    // -------------------------------------------------------------------------
    // 3B. CHALLENGES, ACHIEVEMENTS & COLLECTIBLE BOTANICAL BADGES ENGINE
    // -------------------------------------------------------------------------
    const BADGE_CATALOG = [
      {
        id: 'lotus_sprout',
        icon: '🌱',
        title: 'Lotus Sprout',
        subtitle: 'Prana Seed Seal',
        criteria: 'Begin your wellness journey in PranaSync',
        gradient: 'from-forest-500 to-jade-600'
      },
      {
        id: 'cobra_awakening',
        icon: '🐍',
        title: 'Bhujanga Seal',
        subtitle: 'Cobra Spine Awakening',
        criteria: 'Practice Bhujangasana (Cobra Pose) for 15+ aligned seconds',
        gradient: 'from-terracotta-500 to-marigold-500'
      },
      {
        id: 'steady_mountain',
        icon: '🏔️',
        title: 'Tadasana Pillar',
        subtitle: 'Unshakeable Alignment',
        criteria: 'Achieve a 10-second continuous aligned hold (≥75 pts)',
        gradient: 'from-jade-600 to-forest-800'
      },
      {
        id: 'sequenced_yogi',
        icon: '🧘',
        title: 'Surya Sequencer',
        subtitle: 'Guided Plan Finisher',
        criteria: 'Complete a full Personalized Daily Yoga Plan in Live Camera',
        gradient: 'from-forest-600 to-marigold-500'
      },
      {
        id: 'zen_canopy',
        icon: '🪷',
        title: 'Dhyana Lotus',
        subtitle: 'Stillness & Pranayama',
        criteria: 'Complete a Meditation & Pranayama Sanctuary session',
        gradient: 'from-lotus-500 to-jade-600'
      },
      {
        id: 'mindful_strider',
        icon: '👟',
        title: 'Prithvi Walker',
        subtitle: 'Rhythmic Stride Seal',
        criteria: 'Complete a tailored Mindful Walking Prescription',
        gradient: 'from-forest-500 to-marigold-400'
      },
      {
        id: 'gratitude_scribe',
        icon: '📜',
        title: 'Smriti Scribe',
        subtitle: 'Reflective Heart Seal',
        criteria: 'Write 2 Daily Reflection & Gratitude Journal entries',
        gradient: 'from-terracotta-500 to-lotus-500'
      },
      {
        id: 'prana_master',
        icon: '👑',
        title: 'Prana Sovereign',
        subtitle: '300+ Wellness XP',
        criteria: 'Accumulate 300+ total Wellness XP across all modules',
        gradient: 'from-marigold-500 via-terracotta-500 to-forest-700'
      }
    ];

    const CHALLENGE_CATALOG = [
      {
        id: 'chal_guided_plan',
        tag: 'Daily Flow',
        icon: '🧘',
        title: 'Complete Your Daily Yoga Plan',
        desc: 'Run your personalized asana sequence with rest intervals in the Live Camera Studio.',
        metricKey: 'plansCompleted',
        target: 1,
        xpReward: 80,
        actionLabel: 'Launch Plan →',
        actionFn: 'launchGuidedYogaPlan()'
      },
      {
        id: 'chal_cobra_hold',
        tag: 'Posture Focus',
        icon: '🐍',
        title: 'Cobra Spine Awakening',
        desc: 'Hold Bhujangasana (Cobra Pose) with ≥75 alignment for 15 cumulative seconds.',
        metricKey: 'cobraHoldSec',
        target: 15,
        xpReward: 50,
        actionLabel: 'Practice Cobra →',
        actionFn: "practiceAsanaFromGoal('Bhujangasana')"
      },
      {
        id: 'chal_meditation',
        tag: 'Stillness',
        icon: '🪷',
        title: 'Inner Canopy Stillness',
        desc: 'Complete a timed meditation session with ambient soundscapes.',
        metricKey: 'meditationCompleted',
        target: 1,
        xpReward: 45,
        actionLabel: 'Open Meditate →',
        actionFn: "switchTab('meditate')"
      },
      {
        id: 'chal_walk_journal',
        tag: 'Mind-Body Combo',
        icon: '🌿',
        title: 'Walk & Reflect Harmony',
        desc: 'Complete 1 tailored walk and log 1 daily gratitude journal reflection.',
        metricKey: 'walkAndJournalCombo',
        target: 2,
        xpReward: 60,
        actionLabel: 'Open Journal →',
        actionFn: "switchTab('wellness')"
      },
      {
        id: 'chal_aligned_seconds',
        tag: 'Weekly Mastery',
        icon: '⚡',
        title: '60 Seconds of Pure Alignment',
        desc: 'Accumulate 60 total seconds in aligned yoga postures (≥75 score).',
        metricKey: 'totalAlignedSec',
        target: 60,
        xpReward: 90,
        actionLabel: 'Open Studio →',
        actionFn: "switchTab('studio')"
      }
    ];

    function loadAchievementState() {
      const defaults = {
        unlockedBadges: { lotus_sprout: getTodayIsoDate() },
        claimedChallenges: {},
        stats: {
          plansCompleted: 0,
          cobraHoldSec: 0,
          totalAlignedSec: 0,
          meditationCompleted: 0,
          meditationMinutes: 0,
          walksCompleted: 0,
          journalsWritten: loadJournalEntries().length,
          tenSecStreaks: 0
        }
      };
      try {
        const raw = localStorage.getItem(STORAGE_KEY_ACHIEVEMENTS);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        return {
          unlockedBadges: { ...defaults.unlockedBadges, ...(parsed.unlockedBadges || {}) },
          claimedChallenges: { ...(parsed.claimedChallenges || {}) },
          stats: { ...defaults.stats, ...(parsed.stats || {}) }
        };
      } catch (e) {
        return defaults;
      }
    }

    function saveAchievementState(ach) {
      localStorage.setItem(STORAGE_KEY_ACHIEVEMENTS, JSON.stringify(ach));
      updateNavBadgePill(ach);
      if (activeTab === 'challenges') renderChallengesAndBadgesTab();
    }

    function updateNavBadgePill(ach = loadAchievementState()) {
      const pill = document.getElementById('navBadgeCountPill');
      if (pill) {
        const count = Object.keys(ach.unlockedBadges).length;
        pill.textContent = `${count}/${BADGE_CATALOG.length}`;
      }
    }

    function recordAchievementProgress(deltas = {}) {
      const ach = loadAchievementState();
      Object.entries(deltas).forEach(([k, val]) => {
        ach.stats[k] = (ach.stats[k] || 0) + val;
      });
      ach.stats.journalsWritten = Math.max(ach.stats.journalsWritten, loadJournalEntries().length);

      const totalXp = loadGamificationState().totalXp;
      const today = getTodayIsoDate();
      const newlyUnlocked = [];

      const checkBadge = (badgeId, condition) => {
        if (condition && !ach.unlockedBadges[badgeId]) {
          ach.unlockedBadges[badgeId] = today;
          const b = BADGE_CATALOG.find((item) => item.id === badgeId);
          if (b) newlyUnlocked.push(b);
        }
      };

      checkBadge('cobra_awakening', ach.stats.cobraHoldSec >= 15);
      checkBadge('steady_mountain', ach.stats.tenSecStreaks >= 1 || ach.stats.totalAlignedSec >= 10);
      checkBadge('sequenced_yogi', ach.stats.plansCompleted >= 1);
      checkBadge('zen_canopy', ach.stats.meditationCompleted >= 1);
      checkBadge('mindful_strider', ach.stats.walksCompleted >= 1);
      checkBadge('gratitude_scribe', ach.stats.journalsWritten >= 2);
      checkBadge('prana_master', totalXp >= 300);

      saveAchievementState(ach);

      if (newlyUnlocked.length > 0) {
        const first = newlyUnlocked[0];
        showToast(`Badge Unlocked: ${first.icon} ${first.title}!`, '🏅');
        updateMascot(`You unlocked the "${first.title}" botanical badge! Keep shining! 🏅`);
      }
    }

    function claimChallengeReward(challengeId) {
      const ach = loadAchievementState();
      if (ach.claimedChallenges[challengeId]) return;
      const chal = CHALLENGE_CATALOG.find((c) => c.id === challengeId);
      if (!chal) return;

      ach.claimedChallenges[challengeId] = true;
      saveAchievementState(ach);
      awardXp(chal.xpReward, `Challenge Complete: ${chal.title}`);
      recordAchievementProgress({});
      renderChallengesAndBadgesTab();
    }

    function renderChallengesAndBadgesTab() {
      const ach = loadAchievementState();
      ach.stats.journalsWritten = Math.max(ach.stats.journalsWritten, loadJournalEntries().length);

      const getMetricValue = (key) => {
        if (key === 'walkAndJournalCombo') {
          return Math.min(1, ach.stats.walksCompleted) + Math.min(1, ach.stats.journalsWritten);
        }
        return Math.floor(ach.stats[key] || 0);
      };

      let completedCount = 0;
      const challengesHtml = CHALLENGE_CATALOG.map((c) => {
        const curr = Math.min(c.target, getMetricValue(c.metricKey));
        const pct = Math.round((curr / c.target) * 100);
        const isDone = curr >= c.target;
        const isClaimed = !!ach.claimedChallenges[c.id];
        if (isDone) completedCount++;

        return `
          <div class="p-5 rounded-2xl border ${isDone ? 'bg-forest-50/90 border-forest-400' : 'bg-cream-50 border-forest-200/80'} flex flex-col justify-between gap-3">
            <div>
              <div class="flex items-center justify-between gap-2 mb-1.5">
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white border border-forest-200 text-jade-800">
                  ${c.icon} ${c.tag}
                </span>
                <span class="text-xs font-extrabold text-marigold-600">+${c.xpReward} XP</span>
              </div>
              <h4 class="font-display font-bold text-base text-forest-950">${c.title}</h4>
              <p class="text-xs text-jade-800 mt-1 leading-relaxed">${c.desc}</p>
            </div>

            <div class="space-y-2 pt-2">
              <div class="flex justify-between text-xs font-bold">
                <span class="text-jade-800">Progress</span>
                <span class="font-mono text-forest-900">${curr} / ${c.target} (${pct}%)</span>
              </div>
              <div class="w-full h-2.5 bg-cream-200 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-forest-500 to-marigold-400 transition-all duration-300" style="width: ${pct}%"></div>
              </div>

              <div class="pt-1 flex justify-end">
                ${
                  isClaimed
                    ? `<span class="px-3.5 py-1.5 rounded-xl bg-forest-100 text-forest-800 text-xs font-bold">✓ Reward Claimed</span>`
                    : isDone
                    ? `<button onclick="claimChallengeReward('${c.id}')" class="px-4 py-2 rounded-xl bg-gradient-to-r from-marigold-500 to-terracotta-500 text-white text-xs font-extrabold shadow-md animate-pulse">🎁 Claim +${c.xpReward} XP</button>`
                    : `<button onclick="${c.actionFn}" class="px-3.5 py-1.5 rounded-xl bg-white hover:bg-forest-600 hover:text-white text-forest-900 border border-forest-300 text-xs font-bold transition-all">${c.actionLabel}</button>`
                }
              </div>
            </div>
          </div>
        `;
      }).join('');

      document.getElementById('activeChallengesGrid').innerHTML = challengesHtml;
      document.getElementById('challengesCompletedSummary').textContent = `${completedCount} / ${CHALLENGE_CATALOG.length}`;

      const unlockedCount = Object.keys(ach.unlockedBadges).length;
      document.getElementById('badgesUnlockedSummary').textContent = `${unlockedCount} / ${BADGE_CATALOG.length}`;

      document.getElementById('collectibleBadgesGrid').innerHTML = BADGE_CATALOG.map((b) => {
        const unlockedDate = ach.unlockedBadges[b.id];
        return `
          <div class="p-4 rounded-2xl border-2 text-center transition-all ${
            unlockedDate
              ? 'bg-white border-forest-400 shadow-md'
              : 'bg-cream-100/60 border-forest-200/60 opacity-65 grayscale'
          }">
            <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br ${b.gradient} text-white flex items-center justify-center text-3xl shadow-lg mb-3">
              ${b.icon}
            </div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
              unlockedDate ? 'bg-forest-100 text-forest-800' : 'bg-cream-200 text-jade-700'
            }">
              ${unlockedDate ? `Unlocked • ${unlockedDate}` : 'Locked Seal'}
            </span>
            <h4 class="font-display font-bold text-base text-forest-950 mt-1.5">${b.title}</h4>
            <p class="text-[11px] font-semibold text-jade-700">${b.subtitle}</p>
            <p class="text-[11px] text-forest-900/75 mt-2 leading-snug">${b.criteria}</p>
          </div>
        `;
      }).join('');
    }

    // -------------------------------------------------------------------------
    // 4. TAB NAVIGATION & TOAST UTILITY
    // -------------------------------------------------------------------------
    function switchTab(tabName) {
      activeTab = tabName;
      ['studio', 'meditate', 'goals', 'challenges', 'wellness', 'analytics'].forEach((id) => {
        const viewEl = document.getElementById(`view-${id}`);
        const btnEl = document.getElementById(`tab-${id}`);
        if (!viewEl || !btnEl) return;
        if (id === tabName) {
          viewEl.classList.remove('hidden');
          btnEl.classList.add('active');
          btnEl.classList.remove('text-jade-800');
        } else {
          viewEl.classList.add('hidden');
          btnEl.classList.remove('active');
          btnEl.classList.add('text-jade-800');
        }
      });

      if (tabName === 'analytics') renderAnalyticsDashboard();
      if (tabName === 'goals') renderGoalsAndWalksTab();
      if (tabName === 'challenges') renderChallengesAndBadgesTab();
      if (tabName === 'wellness') renderJournalTimeline();
      if (tabName === 'studio') resizePoseCanvas();
    }

    let toastTimeout = null;
    function showToast(message, icon = '✓') {
      const banner = document.getElementById('toastBanner');
      document.getElementById('toastMessage').textContent = message;
      document.getElementById('toastIcon').textContent = icon;
      banner.classList.remove('hidden');
      requestAnimationFrame(() => {
        banner.classList.remove('translate-y-4', 'opacity-0');
      });
      clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        banner.classList.add('translate-y-4', 'opacity-0');
        setTimeout(() => banner.classList.add('hidden'), 300);
      }, 3400);
    }

    // -------------------------------------------------------------------------
    // 5. 8-ASANA SANSKRIT LIBRARY (TARGETS, TIPS & HEALTH BENEFITS)
    // -------------------------------------------------------------------------
    const POSE_CONNECTIONS = [
      [11, 12], [11, 23], [12, 24], [23, 24],
      [11, 13], [13, 15],
      [12, 14], [14, 16],
      [23, 25], [25, 27],
      [24, 26], [26, 28],
      [27, 29], [29, 31], [28, 30], [30, 32],
      [0, 11], [0, 12]
    ];

    const ASANA_PROFILES = {
      Tadasana: {
        sanskrit: 'Tadasana (ताडासन)',
        english: 'Mountain Pose',
        focus: 'Posture & Grounding',
        targets: {
          leftKnee: 175, rightKnee: 175,
          leftHip: 175, rightHip: 175,
          leftShoulder: 18, rightShoulder: 18,
          leftElbow: 172, rightElbow: 172
        },
        howToImprove: [
          'Press evenly through all four corners of both feet and engage your quadriceps to lift kneecaps.',
          'Draw your lower ribs slightly inward and lengthen the crown of your head toward the ceiling.',
          'Roll shoulders back and down away from your ears with palms facing forward.'
        ],
        benefits: [
          'Corrects rounded shoulders and strengthens spinal alignment.',
          'Improves body awareness, balance, and ankle stability.',
          'Calms anxious restlessness through steady, grounded breathing.'
        ]
      },
      Vrikshasana: {
        sanskrit: 'Vrikshasana (वृक्षासन)',
        english: 'Tree Pose',
        focus: 'Balance & Mental Focus',
        targets: {
          leftKnee: 175, rightKnee: 55,
          leftHip: 174, rightHip: 120,
          leftShoulder: 162, rightShoulder: 162,
          leftElbow: 160, rightElbow: 160
        },
        howToImprove: [
          'Fix your gaze (Drishti) on a single unmoving point at eye level to prevent swaying.',
          'Press your lifted foot firmly into your inner thigh or calf—never directly against the knee joint.',
          'Keep both hip bones level and hug your standing hip inward.'
        ],
        benefits: [
          'Builds single-leg neuromuscular balance and strengthens calves, ankles, and glutes.',
          'Enhances concentration, mental clarity, and emotional equilibrium.',
          'Opens tight inner groins and hip flexors.'
        ]
      },
      WarriorII: {
        sanskrit: 'Virabhadrasana II (वीरभद्रासन II)',
        english: 'Warrior II Pose',
        focus: 'Stamina & Leg Strength',
        targets: {
          leftKnee: 172, rightKnee: 96,
          leftHip: 132, rightHip: 110,
          leftShoulder: 92, rightShoulder: 92,
          leftElbow: 174, rightElbow: 174
        },
        howToImprove: [
          'Align your bent front knee directly above your front ankle—avoid letting it collapse inward.',
          'Keep your torso upright right over your pelvis instead of leaning forward over the front thigh.',
          'Extend both arms parallel to the floor at shoulder height with relaxed traps.'
        ],
        benefits: [
          'Builds lower-body endurance, glute strength, and cardiovascular stamina.',
          'Opens chest, lungs, and shoulders to support deeper breathing.',
          'Boosts confidence, willpower, and metabolic calorie burn.'
        ]
      },
      Triangle: {
        sanskrit: 'Trikonasana (त्रिकोणासन)',
        english: 'Extended Triangle Pose',
        focus: 'Spine & Hamstring Mobility',
        targets: {
          leftKnee: 174, rightKnee: 174,
          leftHip: 145, rightHip: 80,
          leftShoulder: 95, rightShoulder: 95,
          leftElbow: 174, rightElbow: 174
        },
        howToImprove: [
          'Keep both knees straight with a micro-softness so you do not hyperextend the front joint.',
          'Lengthen both sides of your waist equally rather than rounding your spine down toward the floor.',
          'Stack your top shoulder directly above your bottom shoulder and open your chest.'
        ],
        benefits: [
          'Deeply stretches hamstrings, calves, hips, and lateral spine muscles.',
          'Stimulates abdominal organs and aids healthy digestion.',
          'Relieves lower-back stiffness caused by prolonged desk sitting.'
        ]
      },
      DownwardDog: {
        sanskrit: 'Adho Mukha Svanasana (अधोमुखश्वानासन)',
        english: 'Downward-Facing Dog',
        focus: 'Full-Body Decompression',
        targets: {
          leftKnee: 170, rightKnee: 170,
          leftHip: 78, rightHip: 78,
          leftShoulder: 166, rightShoulder: 166,
          leftElbow: 172, rightElbow: 172
        },
        howToImprove: [
          'Push firmly through your index knuckles and thumbs to lift your hips high into an inverted V.',
          'Prioritize a long, flat spine over straight legs—bend knees slightly if hamstrings feel tight.',
          'Wrap your outer upper arms downward to create space around your neck.'
        ],
        benefits: [
          'Decompresses the entire spine and lengthens tight calves and hamstrings.',
          'Strengthens shoulders, wrists, upper back, and core stabilizers.',
          'Gentle inversion boosts cerebral circulation and refreshes mental energy.'
        ]
      },
      Utkatasana: {
        sanskrit: 'Utkatasana (उत्कटासन)',
        english: 'Chair Pose (Fierce Pose)',
        focus: 'Metabolic Burn & Core Power',
        targets: {
          leftKnee: 108, rightKnee: 108,
          leftHip: 105, rightHip: 105,
          leftShoulder: 158, rightShoulder: 158,
          leftElbow: 170, rightElbow: 170
        },
        howToImprove: [
          'Shift your body weight back into your heels so you can lightly wiggle your toes.',
          'Tuck your tailbone slightly to avoid overarching your lower back while sitting deeper.',
          'Reach arms alongside your ears while keeping your shoulder blades drawn down.'
        ],
        benefits: [
          'Activates large leg and glute muscle groups for high calorie burn and weight management.',
          'Strengthens thighs, ankles, core, and spinal erectors.',
          'Builds mental resilience and heat (Tapas) in the body.'
        ]
      },
      Bhujangasana: {
        sanskrit: 'Bhujangasana (भुजंगासन)',
        english: 'Cobra Pose',
        focus: 'Heart Opening & Spine Health',
        targets: {
          leftKnee: 172, rightKnee: 172,
          leftHip: 145, rightHip: 145,
          leftShoulder: 42, rightShoulder: 42,
          leftElbow: 148, rightElbow: 148
        },
        howToImprove: [
          'Hug your elbows close to your ribcage and keep a gentle bend in your elbows.',
          'Use your back muscles—not just hand pressure—to lift your chest forward and up.',
          'Press the tops of your feet and pubic bone firmly into the mat to protect your lumbar spine.'
        ],
        benefits: [
          'Counteracts slouching and strengthens the posterior chain and upper back.',
          'Expands chest capacity and alleviates fatigue and mild low mood.',
          'Improves spinal flexibility and tones abdominal organs.'
        ]
      },
      Anjaneyasana: {
        sanskrit: 'Anjaneyasana (अञ्जनेयासन)',
        english: 'Low Crescent Lunge',
        focus: 'Hip Flexor Release & Balance',
        targets: {
          leftKnee: 145, rightKnee: 95,
          leftHip: 162, rightHip: 95,
          leftShoulder: 165, rightShoulder: 165,
          leftElbow: 172, rightElbow: 172
        },
        howToImprove: [
          'Keep your front knee stacked over your front heel and sink hips gently forward and down.',
          'Engage your lower belly to lift your ribcage up before reaching arms overhead.',
          'Square your hips toward the front of your mat for an even hip-flexor stretch.'
        ],
        benefits: [
          'Releases deep tension in tight psoas and hip flexors from sitting.',
          'Improves pelvic mobility, balance, and lower-body stability.',
          'Energizes the nervous system and opens the front body.'
        ]
      }
    };

    function updateActiveAsanaGuideCard(asanaKey) {
      const profile = ASANA_PROFILES[asanaKey] || ASANA_PROFILES.Tadasana;
      currentDisplayedGuideKey = asanaKey;

      document.getElementById('guideAsanaTitle').textContent = `${profile.sanskrit} — ${profile.english}`;
      document.getElementById('guideAsanaFocus').textContent = `Focus: ${profile.focus}`;

      document.getElementById('guideImproveList').innerHTML = profile.howToImprove
        .map((tip) => `<li>${tip}</li>`)
        .join('');
      document.getElementById('guideBenefitsList').innerHTML = profile.benefits
        .map((b) => `<li>${b}</li>`)
        .join('');
    }

    function generateFallbackDemoLandmarks(asanaKey, timeSec) {
      const base = getTutorialLandmarks(asanaKey, 3);
      const breath = Math.sin(timeSec * 2.1) * 0.004;
      const sway = Math.sin(timeSec * 1.3) * 0.004;
      return base.map((pt, idx) => ({
        x: pt.x + (idx <= 16 ? sway : sway * 0.2),
        y: pt.y + (idx <= 16 ? breath : 0),
        z: 0,
        visibility: 0.99
      }));
    }

    // -------------------------------------------------------------------------
    // 6. EMA SMOOTHER, ANGLE CALCULATOR & 8-ASANA CLASSIFIER
    // -------------------------------------------------------------------------
    function applyEmaSmoothing(rawLandmarks) {
      if (!smoothedLandmarks || smoothedLandmarks.length !== rawLandmarks.length) {
        smoothedLandmarks = rawLandmarks.map((p) => ({ ...p }));
        return smoothedLandmarks;
      }
      smoothedLandmarks = rawLandmarks.map((curr, idx) => {
        const prev = smoothedLandmarks[idx];
        return {
          x: emaAlpha * curr.x + (1 - emaAlpha) * prev.x,
          y: emaAlpha * curr.y + (1 - emaAlpha) * prev.y,
          z: emaAlpha * (curr.z || 0) + (1 - emaAlpha) * (prev.z || 0),
          visibility: curr.visibility ?? 0.5
        };
      });
      return smoothedLandmarks;
    }

    function calcAngle(a, b, c) {
      if (!a || !b || !c) return 0;
      const v1x = a.x - b.x, v1y = a.y - b.y;
      const v2x = c.x - b.x, v2y = c.y - b.y;
      const dot = v1x * v2x + v1y * v2y;
      const mag1 = Math.hypot(v1x, v1y);
      const mag2 = Math.hypot(v2x, v2y);
      if (mag1 * mag2 === 0) return 0;
      const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
      return Math.round((Math.acos(cos) * 180) / Math.PI);
    }

    function classifyAsanaFromAngles(angles) {
      if (targetAsanaLock !== 'AUTO') {
        return { key: targetAsanaLock, confidence: 0.99, isLocked: true };
      }

      let bestKey = 'Tadasana';
      let minDist = Infinity;

      for (const [key, profile] of Object.entries(ASANA_PROFILES)) {
        const t = profile.targets;
        const distNormal =
          Math.abs(angles.leftKnee - t.leftKnee) +
          Math.abs(angles.rightKnee - t.rightKnee) +
          Math.abs(angles.leftHip - t.leftHip) +
          Math.abs(angles.rightHip - t.rightHip) +
          Math.abs(angles.leftShoulder - t.leftShoulder) +
          Math.abs(angles.rightShoulder - t.rightShoulder);

        const distSwapped =
          Math.abs(angles.rightKnee - t.leftKnee) +
          Math.abs(angles.leftKnee - t.rightKnee) +
          Math.abs(angles.rightHip - t.leftHip) +
          Math.abs(angles.leftHip - t.rightHip) +
          Math.abs(angles.rightShoulder - t.leftShoulder) +
          Math.abs(angles.leftShoulder - t.rightShoulder);

        const dist = Math.min(distNormal, distSwapped);
        if (dist < minDist) {
          minDist = dist;
          bestKey = key;
        }
      }

      const conf = Math.max(0.60, Math.min(0.98, 1 - minDist / 720));
      return { key: bestKey, confidence: conf, isLocked: false };
    }

    function evaluatePoseBiomechanics(lm) {
      const coreIndices = [11, 12, 23, 24, 25, 26];
      const visibleCount = coreIndices.filter((i) => (lm[i]?.visibility ?? 0) > 0.55).length;
      bodyVisibleInFrame = visibleCount >= 5;

      const angles = {
        leftKnee: calcAngle(lm[23], lm[25], lm[27]),
        rightKnee: calcAngle(lm[24], lm[26], lm[28]),
        leftHip: calcAngle(lm[11], lm[23], lm[25]),
        rightHip: calcAngle(lm[12], lm[24], lm[26]),
        leftShoulder: calcAngle(lm[23], lm[11], lm[13]),
        rightShoulder: calcAngle(lm[24], lm[12], lm[14]),
        leftElbow: calcAngle(lm[11], lm[13], lm[15]),
        rightElbow: calcAngle(lm[12], lm[14], lm[16])
      };

      const classification = classifyAsanaFromAngles(angles);
      const profile = ASANA_PROFILES[classification.key];
      const baseTargets = profile.targets;

      const asymmetricKeys = ['WarriorII', 'Vrikshasana', 'Triangle', 'Anjaneyasana'];
      const swapSides = asymmetricKeys.includes(classification.key) && angles.leftKnee < angles.rightKnee - 15;

      const targets = swapSides
        ? {
            leftKnee: baseTargets.rightKnee,
            rightKnee: baseTargets.leftKnee,
            leftHip: baseTargets.rightHip,
            rightHip: baseTargets.leftHip,
            leftShoulder: baseTargets.rightShoulder,
            rightShoulder: baseTargets.leftShoulder,
            leftElbow: baseTargets.rightElbow,
            rightElbow: baseTargets.leftElbow
          }
        : baseTargets;

      const jointSpecs = [
        { id: 'rightKnee', label: 'Right Knee', idx: 26, measured: angles.rightKnee, target: targets.rightKnee,
          cueMore: 'Straighten your right knee', cueLess: 'Bend your right knee deeper' },
        { id: 'leftKnee', label: 'Left Knee', idx: 25, measured: angles.leftKnee, target: targets.leftKnee,
          cueMore: 'Straighten your left knee', cueLess: 'Bend your left knee deeper' },
        { id: 'rightHip', label: 'Right Hip', idx: 24, measured: angles.rightHip, target: targets.rightHip,
          cueMore: 'Open your right hip angle', cueLess: 'Hinge deeper at your right hip' },
        { id: 'leftHip', label: 'Left Hip', idx: 23, measured: angles.leftHip, target: targets.leftHip,
          cueMore: 'Extend through your left hip', cueLess: 'Flex your left hip slightly' },
        { id: 'rightShoulder', label: 'Right Shoulder', idx: 12, measured: angles.rightShoulder, target: targets.rightShoulder,
          cueMore: 'Raise your right arm higher', cueLess: 'Lower your right arm slightly' },
        { id: 'leftShoulder', label: 'Left Shoulder', idx: 11, measured: angles.leftShoulder, target: targets.leftShoulder,
          cueMore: 'Raise your left arm higher', cueLess: 'Lower your left arm slightly' },
        { id: 'rightElbow', label: 'Right Elbow', idx: 14, measured: angles.rightElbow, target: targets.rightElbow,
          cueMore: 'Extend your right elbow straight', cueLess: 'Soften your right elbow' },
        { id: 'leftElbow', label: 'Left Elbow', idx: 13, measured: angles.leftElbow, target: targets.leftElbow,
          cueMore: 'Extend your left elbow straight', cueLess: 'Soften your left elbow' }
      ];

      let totalPenalty = 0;
      let largestDeviation = null;
      const jointStatusMap = {};
      const jointAngleMap = {};

      jointSpecs.forEach((j) => {
        const diff = j.measured - j.target;
        const absErr = Math.abs(diff);
        const excessErr = Math.max(0, absErr - angleTolerance);
        totalPenalty += excessErr * 0.78;

        let status = 'aligned';
        if (absErr > angleTolerance * 2.0) status = 'adjust';
        else if (absErr > angleTolerance) status = 'minor';

        jointStatusMap[j.idx] = status;
        jointAngleMap[j.idx] = j.measured;

        if (!largestDeviation || absErr > largestDeviation.absErr) {
          largestDeviation = {
            ...j,
            diff,
            absErr,
            status,
            cueText: absErr <= angleTolerance
              ? `Great ${profile.sanskrit} alignment — hold steady & breathe!`
              : `${diff < 0 ? j.cueMore : j.cueLess} (now ${j.measured}°, target ${j.target}°)`
          };
        }
      });

      const alignmentScore = Math.max(20, Math.min(100, Math.round(100 - totalPenalty)));

      const hipMid = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
      const shoulderMid = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
      const torsoLen = Math.max(0.10, Math.hypot(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y));
      hipMidpointHistory.push(hipMid);
      if (hipMidpointHistory.length > 60) hipMidpointHistory.shift();

      let swayIndex = 0.010;
      if (hipMidpointHistory.length >= 5) {
        const mx = hipMidpointHistory.reduce((s, p) => s + p.x, 0) / hipMidpointHistory.length;
        const my = hipMidpointHistory.reduce((s, p) => s + p.y, 0) / hipMidpointHistory.length;
        const rms = Math.sqrt(
          hipMidpointHistory.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / hipMidpointHistory.length
        );
        swayIndex = rms / torsoLen;
      }

      const symDiff =
        Math.abs(angles.leftShoulder - angles.rightShoulder) +
        Math.abs(angles.leftElbow - angles.rightElbow) +
        (['Tadasana', 'DownwardDog', 'Utkatasana', 'Bhujangasana'].includes(classification.key)
          ? Math.abs(angles.leftKnee - angles.rightKnee)
          : 0);
      const symmetryPercent = Math.max(55, Math.min(99.5, 100 - symDiff * 0.45));

      return {
        asanaKey: classification.key,
        sanskritName: profile.sanskrit,
        englishName: profile.english,
        confidence: classification.confidence,
        isLocked: classification.isLocked,
        alignmentScore,
        swayIndex,
        symmetryPercent,
        jointSpecs,
        jointStatusMap,
        jointAngleMap,
        largestDeviation
      };
    }

    // -------------------------------------------------------------------------
    // 7. RATE-LIMITED VOICE & VISUAL FEEDBACK + CANVAS RENDERING
    // -------------------------------------------------------------------------
    function processFeedbackEngine(assessment, nowMs) {
      if (tutorialPlaying || guidedPlanState.speakingTransition) return;

      const elapsed = nowMs - lastCueTimestamp;
      const pct = Math.min(100, Math.round((elapsed / CUE_COOLDOWN_MS) * 100));
      const cooldownBar = document.getElementById('cueCooldownBar');
      if (cooldownBar) cooldownBar.style.width = `${pct}%`;

      if (!bodyVisibleInFrame && studioMode === 'webcam') {
        const cue = 'Step back until your full body is visible, including your feet.';
        document.getElementById('activeCueText').textContent = cue;
        if (elapsed >= CUE_COOLDOWN_MS && voiceEnabled) {
          lastCueTimestamp = nowMs;
          if (cue !== lastSpokenCueText) speakText(cue);
          lastSpokenCueText = cue;
        }
        return;
      }

      const topDev = assessment?.largestDeviation;
      if (!topDev || elapsed < CUE_COOLDOWN_MS) return;

      lastCueTimestamp = nowMs;
      const spokenPhrase = topDev.cueText.replace(/\(now.*?\)/, '').trim();
      document.getElementById('activeCueText').textContent = spokenPhrase;
      if (voiceEnabled && spokenPhrase !== lastSpokenCueText) {
        speakText(spokenPhrase);
        lastSpokenCueText = spokenPhrase;
      }
      if (assessment.alignmentScore >= 85 && Math.floor(nowMs / 10000) !== lastMascotMilestone) {
        lastMascotMilestone = Math.floor(nowMs / 10000);
        updateMascot('Your alignment is looking steady. Keep breathing naturally! ✨');
      }
    }

    function toggleVoiceCoach() {
      voiceEnabled = !voiceEnabled;
      document.getElementById('voiceStateText').textContent = voiceEnabled ? 'Active' : 'Muted';
      if (voiceEnabled) {
        showToast('Voice coach enabled & synced with pose walkthrough.', '🔊');
        speakText('Voice coach is on. I will guide you through each step and offer gentle posture reminders.', true);
        lastCueTimestamp = 0;
      } else {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        clearTutorialTimers();
        showToast('Voice coach muted', '🔇');
      }
    }

    const poseCanvas = document.getElementById('poseCanvas');
    const poseCtx = poseCanvas.getContext('2d');

    function resizePoseCanvas() {
      const container = document.getElementById('canvasContainer');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        poseCanvas.width = rect.width * window.devicePixelRatio;
        poseCanvas.height = rect.height * window.devicePixelRatio;
        poseCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      }
    }

    function drawFullBodyFramingGuide(w, h) {
      const padX = w * 0.14;
      const padY = h * 0.08;
      const cornerLen = 28;
      poseCtx.strokeStyle = bodyVisibleInFrame ? 'rgba(52, 211, 153, 0.45)' : 'rgba(251, 191, 36, 0.78)';
      poseCtx.lineWidth = 3;

      poseCtx.beginPath(); poseCtx.moveTo(padX, padY + cornerLen); poseCtx.lineTo(padX, padY); poseCtx.lineTo(padX + cornerLen, padY); poseCtx.stroke();
      poseCtx.beginPath(); poseCtx.moveTo(w - padX - cornerLen, padY); poseCtx.lineTo(w - padX, padY); poseCtx.lineTo(w - padX, padY + cornerLen); poseCtx.stroke();
      poseCtx.beginPath(); poseCtx.moveTo(padX, h - padY - cornerLen); poseCtx.lineTo(padX, h - padY); poseCtx.lineTo(padX + cornerLen, h - padY); poseCtx.stroke();
      poseCtx.beginPath(); poseCtx.moveTo(w - padX - cornerLen, h - padY); poseCtx.lineTo(w - padX, h - padY); poseCtx.lineTo(w - padX, h - padY - cornerLen); poseCtx.stroke();
    }

    function renderCompositeFrame(lm, assessment, nowMs) {
      const container = document.getElementById('canvasContainer');
      const w = container.clientWidth;
      const h = container.clientHeight;
      const videoEl = document.getElementById('webcamVideo');

      poseCtx.clearRect(0, 0, w, h);

      let drawX = 0, drawY = 0, drawW = w, drawH = h;
      const liveVideoReady = studioMode === 'webcam' && videoEl.readyState >= 2 && videoEl.videoWidth > 0;
      videoEl.style.setProperty('--camera-mirror', mirrorVideo ? '-1' : '1');
      videoEl.style.visibility = liveVideoReady ? 'visible' : 'hidden';

      if (liveVideoReady) {
        const vidRatio = videoEl.videoWidth / videoEl.videoHeight;
        const boxRatio = w / h;
        if (vidRatio > boxRatio) { drawH = h; drawW = h * vidRatio; drawX = (w - drawW) / 2; }
        else { drawW = w; drawH = w / vidRatio; drawY = (h - drawH) / 2; }
      } else {
        const grad = poseCtx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#0B281E');
        grad.addColorStop(1, '#174C38');
        poseCtx.fillStyle = grad;
        poseCtx.fillRect(0, 0, w, h);

        const matY = drawY + 0.90 * drawH;
        poseCtx.fillStyle = 'rgba(16, 185, 129, 0.28)';
        poseCtx.beginPath();
        poseCtx.roundRect(w * 0.14, matY, w * 0.72, 10, 5);
        poseCtx.fill();
      }

      drawFullBodyFramingGuide(w, h);
      if (!lm || !assessment) return;

      const mapX = (nx) => drawX + (mirrorVideo && studioMode === 'webcam' ? 1 - nx : nx) * drawW;
      const mapY = (ny) => drawY + ny * drawH;

      poseCtx.lineCap = 'round';
      POSE_CONNECTIONS.forEach(([i, j]) => {
        const p1 = lm[i], p2 = lm[j];
        if (!p1 || !p2 || (p1.visibility ?? 1) < 0.35 || (p2.visibility ?? 1) < 0.35) return;
        const st1 = assessment.jointStatusMap[i];
        const st2 = assessment.jointStatusMap[j];
        let boneColor = 'rgba(52, 211, 153, 0.92)';
        if (st1 === 'adjust' || st2 === 'adjust') boneColor = 'rgba(244, 140, 113, 0.95)';
        else if (st1 === 'minor' || st2 === 'minor') boneColor = 'rgba(251, 191, 36, 0.95)';

        poseCtx.lineWidth = 4.5;
        poseCtx.strokeStyle = boneColor;
        poseCtx.beginPath();
        poseCtx.moveTo(mapX(p1.x), mapY(p1.y));
        poseCtx.lineTo(mapX(p2.x), mapY(p2.y));
        poseCtx.stroke();
      });

      const nose = lm[0];
      if (nose && (nose.visibility ?? 1) > 0.4) {
        poseCtx.beginPath();
        poseCtx.arc(mapX(nose.x), mapY(nose.y), 14, 0, Math.PI * 2);
        poseCtx.strokeStyle = '#6EE7B7';
        poseCtx.lineWidth = 2.5;
        poseCtx.stroke();
      }

      const keyJoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
      const angleBadgeJoints = [11, 12, 13, 14, 23, 24, 25, 26];
      const topDeviationIdx = assessment.largestDeviation?.idx;

      keyJoints.forEach((idx) => {
        const pt = lm[idx];
        if (!pt || (pt.visibility ?? 1) < 0.35) return;
        const cx = mapX(pt.x), cy = mapY(pt.y);
        const status = assessment.jointStatusMap[idx] || 'aligned';

        let color = '#10B981';
        if (status === 'minor') color = '#FBBF24';
        if (status === 'adjust') color = '#E06D53';

        if (idx === topDeviationIdx && status !== 'aligned') {
          const pulseR = 13 + Math.sin(nowMs / 140) * 5;
          poseCtx.beginPath();
          poseCtx.arc(cx, cy, pulseR, 0, Math.PI * 2);
          poseCtx.strokeStyle = '#F48C71';
          poseCtx.lineWidth = 2.5;
          poseCtx.stroke();
        }

        poseCtx.beginPath();
        poseCtx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        poseCtx.fillStyle = color;
        poseCtx.fill();
        poseCtx.lineWidth = 2;
        poseCtx.strokeStyle = '#FFFFFF';
        poseCtx.stroke();

        if (angleBadgeJoints.includes(idx) && assessment.jointAngleMap[idx]) {
          const degText = `${assessment.jointAngleMap[idx]}°`;
          poseCtx.font = '700 11px Inter, sans-serif';
          const tw = poseCtx.measureText(degText).width + 10;
          const offsetX = idx % 2 === 1 ? 10 : -(tw + 10);
          poseCtx.fillStyle = 'rgba(11, 40, 30, 0.85)';
          poseCtx.beginPath();
          poseCtx.roundRect(cx + offsetX, cy - 10, tw, 18, 6);
          poseCtx.fill();
          poseCtx.fillStyle = status === 'aligned' ? '#6EE7B7' : status === 'minor' ? '#FDE68A' : '#FCA5A5';
          poseCtx.fillText(degText, cx + offsetX + 5, cy + 3);
        }
      });
    }

    let lastUiUpdateMs = 0;
    let lastAchSecAccumulator = 0;
    function updateScoringPanelUI(assessment, nowMs) {
      if (bodyVisibleInFrame && assessment.alignmentScore >= 75) {
        if (lastAlignedFrameMs !== null) {
          const dt = nowMs - lastAlignedFrameMs;
          alignedHoldAccumMs += dt;
          lastAchSecAccumulator += dt;

          if (lastAchSecAccumulator >= 2000) {
            const addSec = Math.floor(lastAchSecAccumulator / 1000);
            lastAchSecAccumulator %= 1000;
            const deltas = { totalAlignedSec: addSec };
            if (assessment.asanaKey === 'Bhujangasana') {
              deltas.cobraHoldSec = addSec;
            }
            recordAchievementProgress(deltas);
          }
        }
        lastAlignedFrameMs = nowMs;

        if (alignedHoldAccumMs >= 10000 && !holdRewardAwardedForStreak) {
          holdRewardAwardedForStreak = true;
          recordAchievementProgress({ tenSecStreaks: 1 });
          awardXp(50, `10s aligned hold in ${assessment.sanskritName}`);
          celebrateMascot();
        }
      } else {
        lastAlignedFrameMs = null;
      }

      if (nowMs - lastUiUpdateMs < 180) return;
      lastUiUpdateMs = nowMs;

      if (currentDisplayedGuideKey !== assessment.asanaKey) {
        updateActiveAsanaGuideCard(assessment.asanaKey);
        if (targetAsanaLock === 'AUTO') {
          tutorialStep = 0;
          renderTutorialStep(true);
        }
      }

      document.getElementById('classifierModeTag').textContent = assessment.isLocked
        ? 'Target Locked Asana'
        : 'Auto-Detected Asana';
      document.getElementById('detectedAsanaName').textContent = assessment.sanskritName;
      document.getElementById('detectedAsanaSubtitle').textContent = assessment.englishName;
      document.getElementById('classifierConfidence').textContent = `${Math.round(assessment.confidence * 100)}% conf`;
      document.getElementById('overallScoreValue').textContent = assessment.alignmentScore;

      const gradeBadge = document.getElementById('scoreGradeBadge');
      if (assessment.alignmentScore >= 85) {
        gradeBadge.textContent = 'Optimal Form';
        gradeBadge.className = 'inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-forest-100 text-forest-800';
      } else if (assessment.alignmentScore >= 75) {
        gradeBadge.textContent = 'Aligned (Holding)';
        gradeBadge.className = 'inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-jade-100 text-jade-800';
      } else {
        gradeBadge.textContent = 'Adjust Form';
        gradeBadge.className = 'inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-terracotta-100 text-terracotta-600';
      }

      const holdSec = (alignedHoldAccumMs / 1000).toFixed(1);
      const mins = String(Math.floor(holdSec / 60)).padStart(2, '0');
      const secs = (holdSec % 60).toFixed(1).padStart(4, '0');
      document.getElementById('holdTimerDisplay').textContent = `${mins}:${secs}`;
      document.getElementById('streakMetricText').textContent = `${holdSec}s aligned hold`;

      const holdPill = document.getElementById('holdStatusPill');
      if (bodyVisibleInFrame && assessment.alignmentScore >= 75) {
        holdPill.textContent = 'Counting';
        holdPill.className = 'px-2 py-0.5 rounded-md text-[11px] font-bold bg-forest-100 text-forest-800';
      } else {
        holdPill.textContent = 'Paused';
        holdPill.className = 'px-2 py-0.5 rounded-md text-[11px] font-bold bg-marigold-100 text-amber-800';
      }

      document.getElementById('swayMetricText').textContent = `${assessment.swayIndex.toFixed(3)} (${assessment.swayIndex < 0.025 ? 'Steady' : 'Swaying'})`;
      document.getElementById('symmetryMetricText').textContent = `${assessment.symmetryPercent.toFixed(1)}% Bilateral`;

      const listEl = document.getElementById('jointBreakdownList');
      listEl.innerHTML = assessment.jointSpecs
        .map((j) => {
          const absErr = Math.abs(j.measured - j.target);
          let pillClass = 'bg-forest-100 text-forest-800';
          let barColor = 'bg-forest-500';
          if (absErr > angleTolerance * 2.0) {
            pillClass = 'bg-terracotta-100 text-terracotta-600';
            barColor = 'bg-terracotta-500';
          } else if (absErr > angleTolerance) {
            pillClass = 'bg-marigold-100 text-amber-800';
            barColor = 'bg-marigold-400';
          }
          const accuracyPct = Math.max(15, Math.min(100, Math.round(100 - absErr * 1.4)));
          return `
            <div class="bg-cream-50 border border-forest-200/70 rounded-xl p-2.5">
              <div class="flex items-center justify-between text-xs mb-1">
                <span class="font-bold text-forest-950">${j.label}</span>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-jade-800">${j.measured}° / <span class="text-jade-600/70">${j.target}°</span></span>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${pillClass}">±${Math.round(absErr)}°</span>
                </div>
              </div>
              <div class="w-full h-1.5 bg-cream-200 rounded-full overflow-hidden">
                <div class="h-full ${barColor} transition-all duration-150" style="width: ${accuracyPct}%"></div>
              </div>
            </div>
          `;
        })
        .join('');
    }

    // -------------------------------------------------------------------------
    // 8. LIVE WEBCAM STREAMING, MEDIAPIPE POSE & STUDIO CONTROLS
    // -------------------------------------------------------------------------
    function setTargetAsanaLock(key) {
      targetAsanaLock = key;
      document.querySelectorAll('.asana-lock-btn').forEach((btn) => {
        btn.className =
          'asana-lock-btn px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-forest-200 text-forest-900 hover:border-forest-500 transition-all';
      });
      const activeBtn = document.getElementById(`lock-${key}`);
      if (activeBtn) {
        activeBtn.className =
          'asana-lock-btn px-3 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-forest-600 to-jade-600 text-white shadow-sm transition-all';
      }

      alignedHoldAccumMs = 0;
      holdRewardAwardedForStreak = false;
      lastAlignedFrameMs = null;

      const resolvedKey = key === 'AUTO' ? (latestAssessment?.asanaKey || 'Tadasana') : key;
      updateActiveAsanaGuideCard(resolvedKey);
      tutorialStep = 0;
      renderTutorialStep(true);
    }

    function practiceAsanaFromGoal(asanaKey) {
      switchTab('studio');
      setTargetAsanaLock(asanaKey);
      showToast(`Target pose set to ${ASANA_PROFILES[asanaKey].sanskrit}`, '🧘');
    }

    function updateEmaAlpha(val) {
      emaAlpha = parseFloat(val);
      const desc = emaAlpha <= 0.25 ? 'Extra Smooth' : emaAlpha >= 0.7 ? 'Snappy' : 'Balanced';
      document.getElementById('emaValueLabel').textContent = `${emaAlpha.toFixed(2)} (${desc})`;
    }

    function updateTolerance(val) {
      angleTolerance = parseInt(val, 10);
      document.getElementById('toleranceValueLabel').textContent = `±${angleTolerance}°`;
    }

    function toggleMirrorVideo() {
      mirrorVideo = !mirrorVideo;
      document.getElementById('mirrorStateLabel').textContent = mirrorVideo ? 'ON' : 'OFF';
    }

    function flipCameraFacing() {
      cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
      document.getElementById('facingLabel').textContent =
        cameraFacingMode === 'user' ? 'Front Cam' : 'Rear Cam';
      if (mpCameraActive) {
        stopLiveWebcam();
        startLiveWebcam();
      }
    }

    function togglePrimaryCamera() {
      if (mpCameraActive) stopLiveWebcam();
      else startLiveWebcam();
    }

    function enableFallbackDemo() {
      stopLiveWebcam();
      studioMode = 'demo';
      document.getElementById('cameraStartOverlay').classList.add('hidden');
      document.getElementById('fallbackModeLabel').textContent = 'Stop Demo Pose';
      document.getElementById('cameraLiveStatusBadge').textContent = 'Demo Pose Preview Active';
      showToast('Demo pose preview started', '✨');
    }

    function toggleFallbackDemo() {
      if (studioMode === 'demo') {
        studioMode = 'webcam';
        document.getElementById('fallbackModeLabel').textContent = 'Preview Demo Pose';
        if (!mpCameraActive) {
          document.getElementById('cameraStartOverlay').classList.remove('hidden');
          document.getElementById('cameraLiveStatusBadge').textContent = 'Ready — Click Start Live Camera';
        }
      } else {
        enableFallbackDemo();
      }
    }

    function initMediaPipePose() {
      if (mpPoseDetector || typeof window.Pose !== 'function') return;
      try {
        mpPoseDetector = new window.Pose({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
        });
        mpPoseDetector.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.55,
          minTrackingConfidence: 0.55
        });
        mpPoseDetector.onResults((results) => {
          if (results && results.poseLandmarks) {
            const nowMs = performance.now();
            const smooth = applyEmaSmoothing(results.poseLandmarks);
            latestAssessment = evaluatePoseBiomechanics(smooth);
            processFeedbackEngine(latestAssessment, nowMs);
            updateScoringPanelUI(latestAssessment, nowMs);
            renderCompositeFrame(smooth, latestAssessment, nowMs);
          }
        });
      } catch (e) {
        console.warn('MediaPipe Pose initialization fallback:', e);
      }
    }

    async function startLiveWebcam() {
      const overlay = document.getElementById('cameraStartOverlay');
      const statusMsg = document.getElementById('cameraStatusMsg');
      const badge = document.getElementById('cameraLiveStatusBadge');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusMsg.textContent = 'Camera API is unavailable in this browser context. Launching Demo Pose Preview instead.';
        enableFallbackDemo();
        return;
      }

      try {
        badge.textContent = 'Requesting camera permission...';
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });

        const videoEl = document.getElementById('webcamVideo');
        videoEl.srcObject = webcamStream;
        await videoEl.play();

        studioMode = 'webcam';
        mpCameraActive = true;
        overlay.classList.add('hidden');
        document.getElementById('camBtnIcon').textContent = '⏹';
        document.getElementById('camBtnLabel').textContent = 'Stop Camera';
        document.getElementById('fallbackModeLabel').textContent = 'Preview Demo Pose';
        badge.textContent = 'Camera Active • Tracking 33 Landmarks';

        initMediaPipePose();
        showToast('Live camera started! Step back so your full body is in view.', '📹');
      } catch (err) {
        console.warn('Camera permission or device error:', err);
        statusMsg.textContent =
          'Camera permission was denied or no webcam was found. Click "Preview Demo Pose" to explore full posture scoring.';
        badge.textContent = 'Camera Blocked — Demo Available';
        showToast('Unable to access webcam — Demo Pose available', '⚠️');
      }
    }

    function stopLiveWebcam() {
      mpCameraActive = false;
      if (webcamStream) {
        webcamStream.getTracks().forEach((t) => t.stop());
        webcamStream = null;
      }
      const videoEl = document.getElementById('webcamVideo');
      if (videoEl) videoEl.srcObject = null;

      document.getElementById('camBtnIcon').textContent = '📹';
      document.getElementById('camBtnLabel').textContent = 'Start Live Camera';
      document.getElementById('cameraLiveStatusBadge').textContent = 'Camera Stopped';
      if (studioMode !== 'demo') {
        document.getElementById('cameraStartOverlay').classList.remove('hidden');
      }
    }

    async function mainPoseLoop(nowMs) {
      frameCount++;
      if (nowMs - lastFrameTime >= 1000) {
        currentFps = frameCount;
        frameCount = 0;
        lastFrameTime = nowMs;
        const fpsEl = document.getElementById('fpsCounter');
        if (fpsEl) fpsEl.textContent = currentFps;
      }

      if (activeTab === 'studio') {
        if (studioMode === 'demo') {
          const demoKey = targetAsanaLock === 'AUTO' ? currentDisplayedGuideKey : targetAsanaLock;
          const rawDemo = generateFallbackDemoLandmarks(demoKey, nowMs / 1000);
          const smooth = applyEmaSmoothing(rawDemo);
          latestAssessment = evaluatePoseBiomechanics(smooth);
          bodyVisibleInFrame = true;
          processFeedbackEngine(latestAssessment, nowMs);
          updateScoringPanelUI(latestAssessment, nowMs);
          renderCompositeFrame(smooth, latestAssessment, nowMs);
        } else if (mpCameraActive) {
          const videoEl = document.getElementById('webcamVideo');
          if (mpPoseDetector && !mpFrameBusy && videoEl.readyState >= 2) {
            mpFrameBusy = true;
            try {
              await mpPoseDetector.send({ image: videoEl });
            } catch (e) {}
            mpFrameBusy = false;
          } else if (!mpPoseDetector && videoEl.readyState >= 2) {
            renderCompositeFrame(null, null, nowMs);
          }
        }
      }

      requestAnimationFrame(mainPoseLoop);
    }

    // -------------------------------------------------------------------------
    // 9. PERSONAL WELLNESS GOALS, YOGA PLAN BUILDER & WALK RECOMMENDATIONS
    // -------------------------------------------------------------------------
    const PLAN_INTENSITIES = {
      quick: { id: 'quick', label: 'Quick 10m', holdSec: 30, restSec: 15 },
      standard: { id: 'standard', label: 'Balanced 20m', holdSec: 45, restSec: 15 },
      deep: { id: 'deep', label: 'Deep 30m', holdSec: 60, restSec: 20 }
    };

    const WELLNESS_GOALS = {
      calmer_mind: {
        id: 'calmer_mind',
        icon: '🌿',
        shortTitle: 'Calmer Mind',
        title: 'Calmer Mind & Stress Relief',
        tagline: 'Lower cortisol & quiet overthinking',
        yogaPlanTitle: 'Parasympathetic Grounding & Serenity Sequence',
        dailyFrequency: '2 times / day',
        recommendedWindow: '7:00 AM Sunrise & 6:30 PM Sunset',
        planSequence: ['Tadasana', 'Vrikshasana', 'DownwardDog', 'Bhujangasana'],
        walkHeadline: '30-Minute Parasympathetic Mindful Walk',
        walkBestTime: 'Best: Sunset / Early Evening',
        walkDesc: 'An unhurried outdoor walk focused on nasal breathing and rhythmic strides to shift your nervous system out of fight-or-flight mode.',
        duration: '30 mins',
        steps: '3,500 steps',
        pace: 'Relaxed (4 km/h)',
        technique: 'Inhale for 4 steps through your nose, exhale smoothly for 6 steps. Leave headphones off for the first 10 minutes to anchor your senses.',
        recommendedAsanas: ['Vrikshasana', 'DownwardDog', 'Tadasana']
      },
      weight_loss: {
        id: 'weight_loss',
        icon: '🔥',
        shortTitle: 'Weight Loss',
        title: 'Weight Management & Metabolic Burn',
        tagline: 'Boost fat oxidation & daily NEAT',
        yogaPlanTitle: 'Agni Metabolic Fire & Stamina Sequence',
        dailyFrequency: '2 times / day',
        recommendedWindow: '6:30 AM Fasted & 5:30 PM Pre-Dinner',
        planSequence: ['Tadasana', 'Utkatasana', 'WarriorII', 'DownwardDog'],
        walkHeadline: '45-Minute Brisk Fat-Burn Power Walk',
        walkBestTime: 'Best: Morning Fasted or Post-Lunch',
        walkDesc: 'A brisk, arm-pumping stride that elevates your heart rate into Zone 2 (60–70% max HR), maximizing sustained fat utilization.',
        duration: '45 mins',
        steps: '5,500 steps',
        pace: 'Brisk (5.8 km/h)',
        technique: 'Bend elbows at 90°, swing arms purposefully, and include 60-second fast-pace intervals every 5 minutes to spark metabolism.',
        recommendedAsanas: ['Utkatasana', 'WarriorII', 'DownwardDog']
      },
      stamina: {
        id: 'stamina',
        icon: '⚡',
        shortTitle: 'Stamina',
        title: 'Stamina & Cardiovascular Endurance',
        tagline: 'Build sustained energy & lung capacity',
        yogaPlanTitle: 'Prana Endurance & Lung Expansion Flow',
        dailyFrequency: '1–2 times / day',
        recommendedWindow: '7:30 AM Morning Peak',
        planSequence: ['WarriorII', 'Utkatasana', 'Anjaneyasana', 'Bhujangasana'],
        walkHeadline: '40-Minute Tempo & Incline Endurance Walk',
        walkBestTime: 'Best: Morning (7:00 – 9:00 AM)',
        walkDesc: 'A sustained tempo walk incorporating mild inclines or stairs to strengthen cardiac stroke volume and mitochondrial endurance.',
        duration: '40 mins',
        steps: '5,000 steps',
        pace: 'Tempo (5.5 km/h)',
        technique: 'Maintain an upright posture with engaged core. Keep a steady cadence where you can speak in short phrases without gasping.',
        recommendedAsanas: ['WarriorII', 'Utkatasana', 'Anjaneyasana']
      },
      flexibility: {
        id: 'flexibility',
        icon: '🌊',
        shortTitle: 'Flexibility',
        title: 'Flexibility & Desk-Posture Relief',
        tagline: 'Unlock tight hips, hamstrings & spine',
        yogaPlanTitle: 'Spinal Unwinding & Hip Opener Sequence',
        dailyFrequency: '2 times / day',
        recommendedWindow: '1:00 PM Midday Break & 8:00 PM Evening',
        planSequence: ['Triangle', 'Anjaneyasana', 'DownwardDog', 'Bhujangasana'],
        walkHeadline: '25-Minute Mobility Stride + Post-Walk Stretch',
        walkBestTime: 'Best: Midday Work Break',
        walkDesc: 'A warm-up walk with full heel-to-toe roll and gentle torso rotation to lubricate hip joints before deep yoga stretching.',
        duration: '25 mins',
        steps: '3,000 steps',
        pace: 'Moderate (4.8 km/h)',
        technique: 'Focus on lengthening your hip extension behind you with every stride, then immediately practice Triangle & Cobra Pose while muscles are warm.',
        recommendedAsanas: ['Triangle', 'Anjaneyasana', 'Bhujangasana']
      },
      strength: {
        id: 'strength',
        icon: '🏔️',
        shortTitle: 'Strength & Balance',
        title: 'Core Strength & Neuromuscular Balance',
        tagline: 'Stabilize joints & build functional power',
        yogaPlanTitle: 'Vajra Core Stability & Posterior Chain Flow',
        dailyFrequency: '1–2 times / day',
        recommendedWindow: '7:00 AM Morning or 5:00 PM Afternoon',
        planSequence: ['Vrikshasana', 'Utkatasana', 'WarriorII', 'Bhujangasana'],
        walkHeadline: '35-Minute Nordic / Power-Posture Walk',
        walkBestTime: 'Best: Morning or Late Afternoon',
        walkDesc: 'A deliberate, posture-focused walk engaging glutes, calves, and deep transverse abdominis muscles with every step.',
        duration: '35 mins',
        steps: '4,200 steps',
        pace: 'Steady Power (5.2 km/h)',
        technique: 'Draw your navel gently toward your spine, push off firmly through your big toe, and keep shoulders stacked directly over hips.',
        recommendedAsanas: ['Vrikshasana', 'Bhujangasana', 'Utkatasana']
      }
    };

    let selectedGoalKey = localStorage.getItem(STORAGE_KEY_GOAL) || 'calmer_mind';
    let selectedIntensityKey = localStorage.getItem(STORAGE_KEY_INTENSITY) || 'standard';

    function selectWellnessGoal(goalKey) {
      selectedGoalKey = goalKey;
      localStorage.setItem(STORAGE_KEY_GOAL, goalKey);
      renderGoalsAndWalksTab();
      showToast(`Goal updated: ${WELLNESS_GOALS[goalKey].title}`, '🎯');
    }

    function selectPlanIntensity(intensityKey) {
      selectedIntensityKey = intensityKey;
      localStorage.setItem(STORAGE_KEY_INTENSITY, intensityKey);
      renderGoalsAndWalksTab();
    }

    function completeRecommendedWalk() {
      const goal = WELLNESS_GOALS[selectedGoalKey];
      const mins = parseInt(goal.duration, 10) || 30;
      const data = loadAnalyticsData();
      const lastIdx = data.labels.length - 1;
      data.practiceMinutes[lastIdx] = (data.practiceMinutes[lastIdx] || 0) + mins;
      localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(data));
      recordAchievementProgress({ walksCompleted: 1 });
      awardXp(30, `Completed ${goal.duration} ${goal.shortTitle} walk`);
    }

    function renderGoalsAndWalksTab() {
      const currentGoal = WELLNESS_GOALS[selectedGoalKey] || WELLNESS_GOALS.calmer_mind;
      const intensity = PLAN_INTENSITIES[selectedIntensityKey] || PLAN_INTENSITIES.standard;

      ['quick', 'standard', 'deep'].forEach((k) => {
        const btn = document.getElementById(`intensity-${k}`);
        if (!btn) return;
        btn.className =
          k === selectedIntensityKey
            ? 'intensity-btn px-3 py-1.5 rounded-xl text-xs font-bold bg-forest-600 text-white shadow-sm transition-all'
            : 'intensity-btn px-3 py-1.5 rounded-xl text-xs font-bold text-forest-900 hover:bg-forest-50 transition-all';
      });

      document.getElementById('goalSelectorGrid').innerHTML = Object.values(WELLNESS_GOALS)
        .map((g) => {
          const active = g.id === selectedGoalKey;
          return `
            <button onclick="selectWellnessGoal('${g.id}')" class="text-left p-4 rounded-2xl border-2 transition-all ${active ? 'bg-gradient-to-br from-forest-600 to-jade-700 text-white border-forest-700 shadow-md' : 'bg-cream-50 hover:bg-white text-forest-950 border-forest-200 hover:border-forest-500'}">
              <div class="text-2xl mb-1.5">${g.icon}</div>
              <p class="font-display font-bold text-sm">${g.shortTitle}</p>
              <p class="text-[11px] mt-0.5 ${active ? 'text-forest-100' : 'text-jade-700'}">${g.tagline}</p>
            </button>
          `;
        })
        .join('');

      const seq = currentGoal.planSequence;
      const totalRoundSec = seq.length * intensity.holdSec + (seq.length - 1) * intensity.restSec;
      const roundMins = Math.max(2, Math.round(totalRoundSec / 60));

      document.getElementById('yogaPlanScheduleBadge').textContent = `${currentGoal.dailyFrequency} • ${currentGoal.recommendedWindow}`;
      document.getElementById('yogaPlanTitle').textContent = currentGoal.yogaPlanTitle;
      document.getElementById('yogaPlanSubtitle').textContent = `${seq.length} Asanas • ${intensity.holdSec}s hold per pose • ${intensity.restSec}s rest between poses • ~${roundMins} mins per round`;

      document.getElementById('planMetaHold').textContent = `${intensity.holdSec} seconds`;
      document.getElementById('planMetaRest').textContent = `${intensity.restSec} seconds`;
      document.getElementById('planMetaFreq').textContent = currentGoal.dailyFrequency;
      document.getElementById('planMetaWindow').textContent = currentGoal.recommendedWindow;

      document.getElementById('yogaPlanSequenceCards').innerHTML = seq
        .map((asanaKey, idx) => {
          const a = ASANA_PROFILES[asanaKey];
          const isLast = idx === seq.length - 1;
          return `
            <div class="p-4 rounded-2xl bg-white border border-forest-200 shadow-sm flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between gap-1 mb-1.5">
                  <span class="px-2 py-0.5 rounded-lg bg-forest-100 text-forest-800 text-[11px] font-extrabold">
                    Pose ${idx + 1} • ${intensity.holdSec}s
                  </span>
                  ${
                    !isLast
                      ? `<span class="text-[10px] font-bold text-terracotta-600">+${intensity.restSec}s rest</span>`
                      : `<span class="text-[10px] font-bold text-forest-700">Final Pose</span>`
                  }
                </div>
                <h5 class="font-display font-bold text-sm text-forest-950">${a.sanskrit}</h5>
                <p class="text-xs text-jade-700">${a.english}</p>
              </div>
              <p class="text-[11px] text-forest-900/75 mt-2 pt-2 border-t border-forest-100">${a.focus}</p>
            </div>
          `;
        })
        .join('');

      document.getElementById('walkBestTimePill').textContent = currentGoal.walkBestTime;
      document.getElementById('walkPlanHeadline').textContent = currentGoal.walkHeadline;
      document.getElementById('walkPlanDescription').textContent = currentGoal.walkDesc;
      document.getElementById('walkDurationVal').textContent = currentGoal.duration;
      document.getElementById('walkStepsVal').textContent = currentGoal.steps;
      document.getElementById('walkPaceVal').textContent = currentGoal.pace;
      document.getElementById('walkTechniqueTip').textContent = currentGoal.technique;

      document.getElementById('goalRecommendedAsanasList').innerHTML = currentGoal.recommendedAsanas
        .map((key) => {
          const a = ASANA_PROFILES[key];
          return `
            <div class="p-4 rounded-2xl bg-cream-50 border border-forest-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="font-display font-bold text-sm sm:text-base text-forest-950">${a.sanskrit}</h4>
                  <span class="text-xs font-semibold text-forest-700">• ${a.english}</span>
                </div>
                <p class="text-xs text-jade-800 mt-1">${a.benefits[0]}</p>
              </div>
              <button onclick="practiceAsanaFromGoal('${key}')" class="px-3.5 py-2 rounded-xl bg-gradient-to-r from-forest-600 to-jade-600 hover:from-forest-700 hover:to-jade-700 text-white text-xs font-bold shrink-0 transition-all">
                📹 Practice Single Pose
              </button>
            </div>
          `;
        })
        .join('');

      document.getElementById('allAsanasEncyclopediaGrid').innerHTML = Object.entries(ASANA_PROFILES)
        .map(([key, a]) => `
          <div class="p-4 rounded-2xl bg-cream-50 border border-forest-200/80 flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h4 class="font-display font-bold text-base text-forest-950">${a.sanskrit}</h4>
                  <p class="text-xs font-semibold text-forest-700">${a.english} • ${a.focus}</p>
                </div>
                <button onclick="practiceAsanaFromGoal('${key}')" class="px-3 py-1.5 rounded-xl bg-white hover:bg-forest-600 hover:text-white text-forest-800 border border-forest-300 text-xs font-bold transition-all shrink-0">
                  Try Pose →
                </button>
              </div>
              <p class="text-xs text-forest-950/85 mt-2.5"><strong>Key Cue:</strong> ${a.howToImprove[0]}</p>
              <p class="text-xs text-forest-800 mt-1.5"><strong>Benefit:</strong> ${a.benefits[0]}</p>
            </div>
          </div>
        `)
        .join('');
    }

    // -------------------------------------------------------------------------
    // 9B. GUIDED SEQUENCED YOGA PLAN RUNNER (CAMERA-INTEGRATED STATE MACHINE)
    // -------------------------------------------------------------------------
    let guidedPlanState = {
      active: false,
      paused: false,
      speakingTransition: false,
      goalTitle: '',
      sequence: [],
      holdSec: 45,
      restSec: 15,
      currentIndex: 0,
      phase: 'pose',
      phaseTotalSec: 45,
      phaseRemainingSec: 45,
      tickTimer: null
    };

    function launchGuidedYogaPlan() {
      const goal = WELLNESS_GOALS[selectedGoalKey] || WELLNESS_GOALS.calmer_mind;
      const intensity = PLAN_INTENSITIES[selectedIntensityKey] || PLAN_INTENSITIES.standard;

      switchTab('studio');
      clearInterval(guidedPlanState.tickTimer);

      guidedPlanState = {
        active: true,
        paused: false,
        speakingTransition: false,
        goalTitle: goal.shortTitle,
        sequence: [...goal.planSequence],
        holdSec: intensity.holdSec,
        restSec: intensity.restSec,
        currentIndex: 0,
        phase: 'pose',
        phaseTotalSec: intensity.holdSec,
        phaseRemainingSec: intensity.holdSec,
        tickTimer: null
      };

      document.getElementById('guidedPlanRunnerHud').classList.remove('hidden');
      document.getElementById('btnPlanPauseResume').textContent = 'Ⅱ Pause';

      if (!voiceEnabled && !voiceAutoArmed && 'speechSynthesis' in window) {
        voiceEnabled = true;
        voiceAutoArmed = true;
        document.getElementById('voiceStateText').textContent = 'Active';
      }

      if (!mpCameraActive && studioMode !== 'demo') {
        enableFallbackDemo();
        showToast('Demo pose preview started for your plan — click Start Live Camera anytime!', '📹');
      }

      beginGuidedPlanPoseStep(0);
    }

    function beginGuidedPlanPoseStep(idx) {
      if (!guidedPlanState.active) return;
      guidedPlanState.currentIndex = idx;
      guidedPlanState.phase = 'pose';
      guidedPlanState.phaseTotalSec = guidedPlanState.holdSec;
      guidedPlanState.phaseRemainingSec = guidedPlanState.holdSec;

      const asanaKey = guidedPlanState.sequence[idx];
      const profile = ASANA_PROFILES[asanaKey];

      setTargetAsanaLock(asanaKey);
      renderGuidedPlanHud();

      const introSpeech = `Pose ${idx + 1} of ${guidedPlanState.sequence.length}: ${profile.english}. Hold steadily for ${guidedPlanState.holdSec} seconds.`;
      guidedPlanState.speakingTransition = true;
      const spoke = speakText(introSpeech, false, () => {
        guidedPlanState.speakingTransition = false;
      });
      if (!spoke) guidedPlanState.speakingTransition = false;

      startGuidedPlanCountdownInterval();
    }

    function beginGuidedPlanRestStep(nextIdx) {
      if (!guidedPlanState.active) return;
      guidedPlanState.phase = 'rest';
      guidedPlanState.phaseTotalSec = guidedPlanState.restSec;
      guidedPlanState.phaseRemainingSec = guidedPlanState.restSec;

      const nextAsanaKey = guidedPlanState.sequence[nextIdx];
      const nextProfile = ASANA_PROFILES[nextAsanaKey];
      renderGuidedPlanHud();

      const restSpeech = `Great work! Rest and breathe for ${guidedPlanState.restSec} seconds. Next up is ${nextProfile.english}.`;
      guidedPlanState.speakingTransition = true;
      const spoke = speakText(restSpeech, false, () => {
        guidedPlanState.speakingTransition = false;
      });
      if (!spoke) guidedPlanState.speakingTransition = false;

      startGuidedPlanCountdownInterval();
    }

    function startGuidedPlanCountdownInterval() {
      clearInterval(guidedPlanState.tickTimer);
      guidedPlanState.tickTimer = setInterval(() => {
        if (!guidedPlanState.active || guidedPlanState.paused) return;

        const isAlignedOrDemo =
          studioMode === 'demo' ||
          (bodyVisibleInFrame && (latestAssessment?.alignmentScore ?? 0) >= 65);

        if (guidedPlanState.phase === 'rest' || isAlignedOrDemo) {
          guidedPlanState.phaseRemainingSec -= 1;
        }

        renderGuidedPlanHud();

        if (guidedPlanState.phaseRemainingSec <= 0) {
          clearInterval(guidedPlanState.tickTimer);
          handleGuidedPlanPhaseComplete();
        }
      }, 1000);
    }

    function handleGuidedPlanPhaseComplete() {
      if (!guidedPlanState.active) return;

      if (guidedPlanState.phase === 'pose') {
        const nextIdx = guidedPlanState.currentIndex + 1;
        if (nextIdx >= guidedPlanState.sequence.length) {
          stopGuidedPlan(true);
        } else {
          beginGuidedPlanRestStep(nextIdx);
        }
      } else {
        beginGuidedPlanPoseStep(guidedPlanState.currentIndex + 1);
      }
    }

    function toggleGuidedPlanPause() {
      if (!guidedPlanState.active) return;
      guidedPlanState.paused = !guidedPlanState.paused;
      document.getElementById('btnPlanPauseResume').textContent = guidedPlanState.paused ? '▶ Resume' : 'Ⅱ Pause';
    }

    function skipGuidedPlanStep() {
      if (!guidedPlanState.active) return;
      clearInterval(guidedPlanState.tickTimer);
      handleGuidedPlanPhaseComplete();
    }

    function stopGuidedPlan(completedAll = false) {
      clearInterval(guidedPlanState.tickTimer);
      guidedPlanState.active = false;
      guidedPlanState.speakingTransition = false;
      document.getElementById('guidedPlanRunnerHud').classList.add('hidden');

      if (completedAll) {
        const totalSecs =
          guidedPlanState.sequence.length * guidedPlanState.holdSec +
          (guidedPlanState.sequence.length - 1) * guidedPlanState.restSec;
        const minsLogged = Math.max(3, Math.round(totalSecs / 60));

        const data = loadAnalyticsData();
        const lastIdx = data.labels.length - 1;
        data.practiceMinutes[lastIdx] = (data.practiceMinutes[lastIdx] || 0) + minsLogged;
        localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(data));

        ringTibetanBowl(0.95);
        recordAchievementProgress({ plansCompleted: 1 });
        awardXp(80, `Completed ${guidedPlanState.goalTitle} Yoga Plan!`);
        celebrateMascot();
        speakText('Congratulations! You completed your daily yoga plan. Namaste.');
      } else {
        showToast('Exited guided yoga plan', 'ℹ️');
      }
    }

    function renderGuidedPlanHud() {
      if (!guidedPlanState.active) return;
      const idx = guidedPlanState.currentIndex;
      const total = guidedPlanState.sequence.length;
      const currKey = guidedPlanState.sequence[idx];
      const currProfile = ASANA_PROFILES[currKey];

      const badge = document.getElementById('planPhaseBadge');
      const headline = document.getElementById('planCurrentStepHeadline');
      const nextHint = document.getElementById('planNextUpHint');
      const subLabel = document.getElementById('planTimerSubLabel');

      document.getElementById('planProgressCounter').textContent = `Pose ${idx + 1} of ${total} • ${guidedPlanState.goalTitle} Flow`;

      if (guidedPlanState.phase === 'pose') {
        badge.textContent = '🧘 Active Pose Hold';
        badge.className = 'px-3 py-0.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-forest-400 text-forest-950';
        headline.textContent = `${currProfile.sanskrit} — ${currProfile.english}`;
        subLabel.textContent = studioMode === 'webcam' && !bodyVisibleInFrame ? 'Step in Frame' : 'Hold Remaining';

        if (idx + 1 < total) {
          const nextProfile = ASANA_PROFILES[guidedPlanState.sequence[idx + 1]];
          nextHint.textContent = `Next up: ${guidedPlanState.restSec}s Rest → ${nextProfile.sanskrit}`;
        } else {
          nextHint.textContent = 'Final pose of your daily sequence — finish strong for +80 XP!';
        }
      } else {
        const nextProfile = ASANA_PROFILES[guidedPlanState.sequence[idx + 1]];
        badge.textContent = '🌿 Rest & Transition';
        badge.className = 'px-3 py-0.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-marigold-400 text-forest-950';
        headline.textContent = `Breathe & Prepare for ${nextProfile.sanskrit}`;
        subLabel.textContent = 'Rest Remaining';
        nextHint.textContent = `Upcoming Pose ${idx + 2} of ${total}: ${nextProfile.english} (${guidedPlanState.holdSec}s)`;
      }

      const rem = Math.max(0, guidedPlanState.phaseRemainingSec);
      const mm = String(Math.floor(rem / 60)).padStart(2, '0');
      const ss = String(rem % 60).padStart(2, '0');
      document.getElementById('planStepCountdownText').textContent = `${mm}:${ss}`;

      const pct = Math.max(0, Math.min(100, Math.round((rem / guidedPlanState.phaseTotalSec) * 100)));
      document.getElementById('planStepProgressBar').style.width = `${pct}%`;
    }

    // -------------------------------------------------------------------------
    // 10. DAILY REFLECTION JOURNAL, CHECK-IN & PHQ-9 / GAD-7 SCREENERS
    // -------------------------------------------------------------------------
    function insertJournalPrompt(text) {
      const ta = document.getElementById('dailyJournalTextarea');
      ta.value = ta.value ? `${ta.value.trim()} ${text}` : text;
      ta.focus();
    }

    function loadJournalEntries() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_JOURNAL) || '[]');
      } catch (e) {
        return [];
      }
    }

    function saveJournalEntry() {
      const ta = document.getElementById('dailyJournalTextarea');
      const text = ta.value.trim();
      if (!text) {
        showToast('Write a sentence or tap a prompt first!', '✍️');
        return;
      }

      const entries = loadJournalEntries();
      const today = getTodayIsoDate();
      const alreadyLoggedToday = entries.some((e) => e.isoDate === today);

      entries.unshift({
        id: Date.now(),
        isoDate: today,
        dateDisplay: new Date().toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        text
      });

      localStorage.setItem(STORAGE_KEY_JOURNAL, JSON.stringify(entries));
      ta.value = '';
      renderJournalTimeline();
      recordAchievementProgress({ journalsWritten: 1 });

      if (!alreadyLoggedToday) {
        awardXp(35, 'Daily Mindful Journal Entry');
      } else {
        awardXp(10, 'Bonus Journal Reflection');
      }
    }

    function renderJournalTimeline() {
      const entries = loadJournalEntries();
      document.getElementById('journalCountBadge').textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
      const listEl = document.getElementById('journalHistoryList');

      if (!entries.length) {
        listEl.innerHTML = `
          <div class="p-3.5 rounded-2xl bg-cream-50 border border-forest-200 text-xs text-jade-700 text-center">
            No entries yet. Write your first daily reflection above to earn <strong>+35 XP</strong>!
          </div>
        `;
        return;
      }

      listEl.innerHTML = entries
        .map((e) => `
          <div class="p-3 rounded-2xl bg-cream-50 border border-forest-200/80">
            <p class="text-[10px] font-bold uppercase tracking-wider text-forest-700">${e.dateDisplay}</p>
            <p class="text-xs sm:text-sm text-forest-950 mt-1 leading-relaxed">${e.text.replace(/</g, '&lt;')}</p>
          </div>
        `)
        .join('');
    }

    const PHQ9_ITEMS = [
      '1. Little interest or pleasure in doing things',
      '2. Feeling down, depressed, or hopeless',
      '3. Trouble falling or staying asleep, or sleeping too much',
      '4. Feeling tired or having little energy',
      '5. Poor appetite or overeating',
      '6. Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
      '7. Trouble concentrating on things, such as reading or watching television',
      '8. Moving or speaking so slowly that other people could have noticed? Or the opposite — being fidgety or restless',
      '9. Thoughts that you would be better off dead, or of hurting yourself in some way'
    ];

    const GAD7_ITEMS = [
      '1. Feeling nervous, anxious, or on edge',
      '2. Not being able to stop or control worrying',
      '3. Worrying too much about different things',
      '4. Trouble relaxing',
      '5. Being so restless that it is hard to sit still',
      '6. Becoming easily annoyed or irritable',
      '7. Feeling afraid, as if something awful might happen'
    ];

    const LIKERT_OPTIONS = [
      { label: 'Not at all (0)', val: 0 },
      { label: 'Several days (1)', val: 1 },
      { label: 'More than half the days (2)', val: 2 },
      { label: 'Nearly every day (3)', val: 3 }
    ];

    let phq9Answers = Array(9).fill(0);
    let gad7Answers = Array(7).fill(0);

    function renderQuestionnaireItems() {
      const phqContainer = document.getElementById('phq9QuestionsList');
      phqContainer.innerHTML = PHQ9_ITEMS.map((text, idx) => {
        const isSafetyItem = idx === 8;
        return `
          <div class="p-3.5 rounded-2xl border ${isSafetyItem ? 'bg-marigold-100/50 border-marigold-400/50' : 'bg-cream-50 border-forest-200/70'}">
            <p class="text-xs sm:text-sm font-semibold text-forest-950 mb-2">${text}</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              ${LIKERT_OPTIONS.map((opt) => `
                <button type="button" onclick="setPhq9Answer(${idx}, ${opt.val})"
                  class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all ${phq9Answers[idx] === opt.val ? 'bg-forest-600 text-white border-forest-600' : 'bg-white text-forest-900 border-forest-200 hover:border-forest-500'}">
                  ${opt.label}
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');

      const gadContainer = document.getElementById('gad7QuestionsList');
      gadContainer.innerHTML = GAD7_ITEMS.map((text, idx) => `
        <div class="p-3.5 rounded-2xl bg-cream-50 border border-forest-200/70">
          <p class="text-xs sm:text-sm font-semibold text-forest-950 mb-2">${text}</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            ${LIKERT_OPTIONS.map((opt) => `
              <button type="button" onclick="setGad7Answer(${idx}, ${opt.val})"
                class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all ${gad7Answers[idx] === opt.val ? 'bg-forest-600 text-white border-forest-600' : 'bg-white text-forest-900 border-forest-200 hover:border-forest-500'}">
                ${opt.label}
              </button>
            `).join('')}
          </div>
        </div>
      `).join('');
    }

    function setPhq9Answer(qIdx, val) {
      phq9Answers[qIdx] = val;
      renderQuestionnaireItems();
      const total = phq9Answers.reduce((a, b) => a + b, 0);
      document.getElementById('phq9TotalScore').textContent = `${total} / 27`;

      const badge = document.getElementById('phq9SeverityBadge');
      if (total <= 4) {
        badge.textContent = 'Minimal (0–4)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-forest-100 text-forest-800';
      } else if (total <= 9) {
        badge.textContent = 'Mild (5–9)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-marigold-100 text-amber-800';
      } else if (total <= 14) {
        badge.textContent = 'Moderate (10–14)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-terracotta-100 text-terracotta-600';
      } else {
        badge.textContent = total <= 19 ? 'Moderately Severe (15–19)' : 'Severe (20–27)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800';
      }

      const safetyCard = document.getElementById('teleManasSafetyCard');
      if (phq9Answers[8] > 0) {
        safetyCard.classList.remove('hidden');
        safetyCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        safetyCard.classList.add('hidden');
      }
    }

    function setGad7Answer(qIdx, val) {
      gad7Answers[qIdx] = val;
      renderQuestionnaireItems();
      const total = gad7Answers.reduce((a, b) => a + b, 0);
      document.getElementById('gad7TotalScore').textContent = `${total} / 21`;

      const badge = document.getElementById('gad7SeverityBadge');
      if (total <= 4) {
        badge.textContent = 'Minimal (0–4)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-forest-100 text-forest-800';
      } else if (total <= 9) {
        badge.textContent = 'Mild (5–9)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-marigold-100 text-amber-800';
      } else if (total <= 14) {
        badge.textContent = 'Moderate (10–14)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-terracotta-100 text-terracotta-600';
      } else {
        badge.textContent = 'Severe (15–21)';
        badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800';
      }
    }

    function switchScreener(type) {
      const btnPhq = document.getElementById('btnScreenerPHQ9');
      const btnGad = document.getElementById('btnScreenerGAD7');
      if (type === 'phq9') {
        document.getElementById('phq9Panel').classList.remove('hidden');
        document.getElementById('gad7Panel').classList.add('hidden');
        btnPhq.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold bg-forest-600 text-white transition-all';
        btnGad.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold text-forest-900 transition-all';
      } else {
        document.getElementById('gad7Panel').classList.remove('hidden');
        document.getElementById('phq9Panel').classList.add('hidden');
        btnGad.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold bg-forest-600 text-white transition-all';
        btnPhq.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold text-forest-900 transition-all';
      }
    }

    function updateCheckinLabels() {
      const moodMap = { 1: '1 / 5 — Low', 2: '2 / 5 — Heavy', 3: '3 / 5 — Neutral', 4: '4 / 5 — Calm & Steady', 5: '5 / 5 — Uplifted' };
      const stressMap = { 1: '1 / 5 — Relaxed', 2: '2 / 5 — Mild Tension', 3: '3 / 5 — Moderate', 4: '4 / 5 — Elevated', 5: '5 / 5 — High Stress' };
      const sleepMap = { 1: '1 / 5 — Poor', 2: '2 / 5 — Fragmented', 3: '3 / 5 — Fair', 4: '4 / 5 — Restorative', 5: '5 / 5 — Deeply Rested' };

      document.getElementById('moodDisplay').textContent = moodMap[document.getElementById('moodInput').value];
      document.getElementById('stressDisplay').textContent = stressMap[document.getElementById('stressInput').value];
      document.getElementById('sleepDisplay').textContent = sleepMap[document.getElementById('sleepInput').value];
    }

    function saveScreenerResult(kind) {
      const logs = JSON.parse(localStorage.getItem(STORAGE_KEY_SCREENERS) || '[]');
      const score = kind === 'PHQ-9'
        ? phq9Answers.reduce((a, b) => a + b, 0)
        : gad7Answers.reduce((a, b) => a + b, 0);
      logs.push({ kind, score, timestamp: new Date().toISOString() });
      localStorage.setItem(STORAGE_KEY_SCREENERS, JSON.stringify(logs));
      awardXp(40, `Completed ${kind} self-reflection`);
    }

    // -------------------------------------------------------------------------
    // 11. ANALYTICS DATA STORE & CHART.JS TREND VISUALIZATION
    // -------------------------------------------------------------------------
    function getDefaultAnalyticsData() {
      const labels = [];
      const now = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        labels.push(d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }));
      }
      return {
        labels,
        practiceMinutes: [15, 20, 0, 25, 20, 15, 0, 25, 30, 20, 0, 25, 25, 25],
        alignmentScores: [76, 79, null, 81, 82, 80, null, 84, 86, 85, null, 87, 86, 88],
        stressLevels: [3.2, 2.6, 3.8, 2.2, 2.1, 2.4, 3.5, 2.0, 1.8, 2.1, 3.3, 1.9, 2.0, 1.8],
        moodLevels: [3.2, 3.8, 2.9, 4.0, 4.1, 3.9, 3.1, 4.2, 4.5, 4.1, 3.3, 4.4, 4.3, 4.5]
      };
    }

    function loadAnalyticsData() {
      const saved = localStorage.getItem(STORAGE_KEY_ANALYTICS);
      if (saved) {
        try { return JSON.parse(saved); } catch (e) { return getDefaultAnalyticsData(); }
      }
      const init = getDefaultAnalyticsData();
      localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(init));
      return init;
    }

    function saveDailyCheckin() {
      const mood = parseInt(document.getElementById('moodInput').value, 10);
      const stress = parseInt(document.getElementById('stressInput').value, 10);
      const data = loadAnalyticsData();
      const lastIdx = data.labels.length - 1;
      data.moodLevels[lastIdx] = mood;
      data.stressLevels[lastIdx] = stress;
      localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(data));
      awardXp(25, 'Daily Mind-Body Check-In');
    }

    function logPracticeSession() {
      const score = latestAssessment ? latestAssessment.alignmentScore : 85;
      const asanaName = latestAssessment ? latestAssessment.sanskritName : 'Yoga Flow';
      const data = loadAnalyticsData();
      const lastIdx = data.labels.length - 1;
      data.practiceMinutes[lastIdx] = (data.practiceMinutes[lastIdx] || 0) + 15;
      data.alignmentScores[lastIdx] = score;
      localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(data));
      awardXp(50, `Logged ${asanaName} session (${score}/100)`);
      celebrateMascot();
    }

    function resetDemoAnalytics() {
      const fresh = getDefaultAnalyticsData();
      localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(fresh));
      renderAnalyticsDashboard();
      showToast('Reset 14-day sample trend dataset', '↺');
    }

    let trendChartInstance = null;
    function renderAnalyticsDashboard() {
      const data = loadAnalyticsData();
      renderGamificationHud();

      const styles = getComputedStyle(document.documentElement);
      const gridColor = styles.getPropertyValue('--chart-grid').trim() || 'rgba(203, 224, 211, 0.6)';
      const tickColor = styles.getPropertyValue('--chart-tick').trim() || '#174C38';
      const isTwilight = document.documentElement.getAttribute('data-circadian-theme') === 'twilight';

      const totalMins = data.practiceMinutes.reduce((a, b) => a + (b || 0), 0);
      const validScores = data.alignmentScores.filter((v) => v !== null && v !== undefined);
      const meanScore = validScores.length
        ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1)
        : '83.0';

      let practiceStressSum = 0, practiceDays = 0;
      data.practiceMinutes.forEach((m, i) => {
        if (m > 0) { practiceStressSum += data.stressLevels[i]; practiceDays++; }
      });

      const avgPracticeStress = practiceDays ? (practiceStressSum / practiceDays).toFixed(1) : '2.1';
      document.getElementById('kpiTotalMins').textContent = `${totalMins} mins`;
      document.getElementById('kpiMeanAlignment').textContent = `${meanScore} / 100`;
      document.getElementById('kpiStressPractice').textContent = `${avgPracticeStress} / 5.0`;

      const ctx = document.getElementById('wellnessTrendChart').getContext('2d');
      if (trendChartInstance) trendChartInstance.destroy();

      trendChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.labels,
          datasets: [
            {
              type: 'bar',
              label: 'Practice, Meditation & Walk Mins',
              data: data.practiceMinutes,
              backgroundColor: isTwilight ? 'rgba(52, 211, 153, 0.32)' : 'rgba(16, 185, 129, 0.28)',
              borderColor: isTwilight ? '#34D399' : '#059669',
              borderWidth: 1.5,
              borderRadius: 6,
              yAxisID: 'yMinutes',
              order: 3
            },
            {
              type: 'line',
              label: 'Mood Rating (1–5)',
              data: data.moodLevels,
              borderColor: isTwilight ? '#6EE7B7' : '#047857',
              backgroundColor: isTwilight ? '#6EE7B7' : '#047857',
              borderWidth: 2.5,
              tension: 0.35,
              pointRadius: 3.5,
              yAxisID: 'yScale5',
              order: 1
            },
            {
              type: 'line',
              label: 'Stress Level (1–5)',
              data: data.stressLevels,
              borderColor: isTwilight ? '#F48C71' : '#E06D53',
              backgroundColor: isTwilight ? '#F48C71' : '#E06D53',
              borderDash: [5, 4],
              borderWidth: 2.5,
              tension: 0.35,
              pointRadius: 3.5,
              yAxisID: 'yScale5',
              order: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: tickColor,
                usePointStyle: true,
                boxWidth: 8,
                font: { family: 'Inter', size: 12, weight: '600' }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: tickColor, font: { family: 'Inter', size: 11 } }
            },
            yMinutes: {
              type: 'linear', position: 'left', min: 0, max: 60,
              title: { display: true, text: 'Active Minutes', color: tickColor, font: { size: 11, weight: '600' } },
              ticks: { color: tickColor },
              grid: { color: gridColor }
            },
            yScale5: {
              type: 'linear', position: 'right', min: 1, max: 5,
              title: { display: true, text: 'Mood / Stress (1–5)', color: tickColor, font: { size: 11, weight: '600' } },
              ticks: { color: tickColor },
              grid: { drawOnChartArea: false }
            }
          }
        }
      });
    }

    function copyHelpline(num) {
      const ta = document.createElement('textarea');
      ta.value = num;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast(`Tele-MANAS helpline (${num}) copied`, '📋');
      } catch (e) {}
      document.body.removeChild(ta);
    }

    // -------------------------------------------------------------------------
    // 11B. OPTIONAL ACCOUNT LOGIN, SALTED HASHING & PROGRESS VAULT ENGINE
    // -------------------------------------------------------------------------
    function loadRegisteredAccounts() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_ACCOUNTS) || '[]');
      } catch (e) {
        return [];
      }
    }

    function saveRegisteredAccounts(list) {
      localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(list));
    }

    function generateRandomSalt() {
      if (window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint8Array(16);
        window.crypto.getRandomValues(arr);
        return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
      }
      return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
    }

    // Pure-JS fallback hash if crypto.subtle is unavailable on non-HTTPS file:// origins
    function fallbackDeterministicHash(str) {
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    }

    async function hashPasswordWithSalt(password, salt) {
      const payload = `${salt}::pranasync_vault::${password}`;
      if (window.crypto && window.crypto.subtle && window.TextEncoder) {
        try {
          const encoded = new TextEncoder().encode(payload);
          const digest = await window.crypto.subtle.digest('SHA-256', encoded);
          return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
          return fallbackDeterministicHash(payload);
        }
      }
      return fallbackDeterministicHash(payload);
    }

    function hasMeaningfulGuestProgress() {
      const guestKeys = getScopedKeysForUser(null);
      try {
        const gam = JSON.parse(localStorage.getItem(guestKeys.gamification) || 'null');
        const journals = JSON.parse(localStorage.getItem(guestKeys.journal) || '[]');
        const screeners = JSON.parse(localStorage.getItem(guestKeys.screeners) || '[]');
        if (journals.length > 0 || screeners.length > 0) return true;
        if (gam && (gam.totalXp > 60 || gam.streakDays > 1)) return true;
      } catch (e) {}
      return false;
    }

    function copyGuestProgressToUserNamespace(userId, clearGuestAfter = false) {
      const guestKeys = getScopedKeysForUser(null);
      const userKeys = getScopedKeysForUser(userId);
      Object.keys(guestKeys).forEach((k) => {
        const val = localStorage.getItem(guestKeys[k]);
        if (val !== null) {
          localStorage.setItem(userKeys[k], val);
          if (clearGuestAfter) localStorage.removeItem(guestKeys[k]);
        }
      });
    }

    function mergeGuestDataIntoActiveAccount() {
      if (!currentAuthUser) return;
      const guestKeys = getScopedKeysForUser(null);

      try {
        // Merge Gamification XP & Streak
        const guestGam = JSON.parse(localStorage.getItem(guestKeys.gamification) || 'null');
        if (guestGam) {
          const userGam = loadGamificationState();
          const bonusXp = Math.max(0, (guestGam.totalXp || 60) - 60);
          userGam.totalXp += bonusXp;
          userGam.dailyXp += guestGam.dailyXp || 0;
          userGam.streakDays = Math.max(userGam.streakDays || 1, guestGam.streakDays || 1);
          saveGamificationState(userGam);
        }

        // Merge Journal Entries (deduplicated by ID)
        const guestJournals = JSON.parse(localStorage.getItem(guestKeys.journal) || '[]');
        if (guestJournals.length > 0) {
          const userJournals = loadJournalEntries();
          const existingIds = new Set(userJournals.map((j) => j.id));
          const merged = [...guestJournals.filter((j) => !existingIds.has(j.id)), ...userJournals];
          localStorage.setItem(STORAGE_KEY_JOURNAL, JSON.stringify(merged));
        }

        // Merge Badges & Stats
        const guestAch = JSON.parse(localStorage.getItem(guestKeys.achievements) || 'null');
        if (guestAch) {
          const userAch = loadAchievementState();
          userAch.unlockedBadges = { ...guestAch.unlockedBadges, ...userAch.unlockedBadges };
          Object.keys(guestAch.stats || {}).forEach((statKey) => {
            userAch.stats[statKey] = Math.max(userAch.stats[statKey] || 0, guestAch.stats[statKey] || 0);
          });
          saveAchievementState(userAch);
        }

        // Clear guest scratchpad after merging
        Object.values(guestKeys).forEach((k) => localStorage.removeItem(k));
      } catch (e) {}

      refreshAllModulesAfterAccountSwitch();
      updateAccountModalProfileStats();
      document.getElementById('guestMergeBox').classList.add('hidden');
      showToast('Guest progress merged into your account vault!', '🛡️');
    }

    function refreshAllModulesAfterAccountSwitch() {
      circadianPreference = localStorage.getItem(STORAGE_KEY_CIRCADIAN) || 'auto';
      selectedGoalKey = localStorage.getItem(STORAGE_KEY_GOAL) || 'calmer_mind';
      selectedIntensityKey = localStorage.getItem(STORAGE_KEY_INTENSITY) || 'standard';

      applyCircadianTheme(false);
      renderHeaderAccountButton();
      renderGamificationHud();
      updateNavBadgePill();
      renderGoalsAndWalksTab();
      renderChallengesAndBadgesTab();
      renderJournalTimeline();
      if (activeTab === 'analytics') renderAnalyticsDashboard();
      renderHeaderAccountButton();
    }

    function renderHeaderAccountButton() {
      const avatarEl = document.getElementById('headerAvatarCircle');
      const statusEl = document.getElementById('headerAccountStatusTag');
      const nameEl = document.getElementById('headerAccountNameLabel');
      if (!avatarEl || !statusEl || !nameEl) return;

      if (currentAuthUser) {
        const initial = (currentAuthUser.displayName || currentAuthUser.identifier || 'Y').trim().charAt(0).toUpperCase();
        avatarEl.textContent = initial;
        statusEl.textContent = 'Vault Saved';
        nameEl.textContent = currentAuthUser.displayName.split(' ')[0];
      } else {
        avatarEl.textContent = '👤';
        statusEl.textContent = 'Guest Mode';
        nameEl.textContent = 'Save Progress';
      }
    }

    function openAccountModal(initialMode = 'login') {
      const modal = document.getElementById('accountModal');
      const guestView = document.getElementById('authGuestContainer');
      const profileView = document.getElementById('authProfileContainer');
      const errBox = document.getElementById('authFormError');
      if (errBox) errBox.classList.add('hidden');

      if (currentAuthUser) {
        guestView.classList.add('hidden');
        profileView.classList.remove('hidden');
        document.getElementById('modalSubtitlePill').textContent = 'Protected Local Vault';
        document.getElementById('accountModalTitle').textContent = 'Your PranaSync Account';
        document.getElementById('modalAvatarBadge').textContent = (currentAuthUser.displayName || 'Y').trim().charAt(0).toUpperCase();
        document.getElementById('profileDisplayName').textContent = currentAuthUser.displayName;
        document.getElementById('profileIdentifierText').textContent = `${currentAuthUser.identifier} • Member since ${currentAuthUser.createdAt}`;
        updateAccountModalProfileStats();

        const mergeBox = document.getElementById('guestMergeBox');
        if (hasMeaningfulGuestProgress()) mergeBox.classList.remove('hidden');
        else mergeBox.classList.add('hidden');
      } else {
        profileView.classList.add('hidden');
        guestView.classList.remove('hidden');
        document.getElementById('modalSubtitlePill').textContent = 'Optional Progress Vault';
        document.getElementById('accountModalTitle').textContent = 'Save & Protect Your Progress';
        document.getElementById('modalAvatarBadge').textContent = '🔐';
        switchAuthFormMode(initialMode);
      }

      modal.classList.remove('hidden');
    }

    function closeAccountModal() {
      document.getElementById('accountModal')?.classList.add('hidden');
    }

    function switchAuthFormMode(mode) {
      const loginForm = document.getElementById('loginForm');
      const signupForm = document.getElementById('signupForm');
      const tabLogin = document.getElementById('authTabLogin');
      const tabSignup = document.getElementById('authTabSignup');
      const errBox = document.getElementById('authFormError');
      if (errBox) errBox.classList.add('hidden');

      if (mode === 'signup') {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
        tabSignup.className = 'py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-forest-600 to-jade-600 text-white shadow-sm transition-all';
        tabLogin.className = 'py-2 rounded-xl text-xs font-bold text-forest-900 transition-all';
      } else {
        signupForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        tabLogin.className = 'py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-forest-600 to-jade-600 text-white shadow-sm transition-all';
        tabSignup.className = 'py-2 rounded-xl text-xs font-bold text-forest-900 transition-all';
      }
    }

    function showAuthFormError(msg) {
      const errBox = document.getElementById('authFormError');
      if (!errBox) return;
      errBox.textContent = msg;
      errBox.classList.remove('hidden');
    }

    async function handleAccountSignup(event) {
      event.preventDefault();
      const displayName = document.getElementById('signupDisplayName').value.trim();
      const identifierRaw = document.getElementById('signupIdentifier').value.trim();
      const identifierNorm = identifierRaw.toLowerCase();
      const password = document.getElementById('signupPassword').value;
      const confirm = document.getElementById('signupConfirmPassword').value;
      const shouldMigrateGuest = document.getElementById('migrateGuestCheckbox').checked;

      if (!displayName || !identifierNorm) {
        showAuthFormError('Please enter your name and a username or email.');
        return;
      }
      if (password.length < 6) {
        showAuthFormError('Please choose a password with at least 6 characters.');
        return;
      }
      if (password !== confirm) {
        showAuthFormError('Passwords do not match. Please check and try again.');
        return;
      }

      const accounts = loadRegisteredAccounts();
      if (accounts.some((acc) => acc.identifierNorm === identifierNorm)) {
        showAuthFormError('An account with this username or email already exists. Switch to Sign In.');
        return;
      }

      const userId = `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const salt = generateRandomSalt();
      const passwordHash = await hashPasswordWithSalt(password, salt);

      const newAccount = {
        userId,
        displayName,
        identifier: identifierRaw,
        identifierNorm,
        salt,
        passwordHash,
        createdAt: getTodayIsoDate()
      };

      accounts.push(newAccount);
      saveRegisteredAccounts(accounts);

      if (shouldMigrateGuest) {
        copyGuestProgressToUserNamespace(userId, true);
      }

      localStorage.setItem(STORAGE_KEY_ACTIVE_SESSION, userId);
      applyStorageNamespaceForUser(newAccount);
      refreshAllModulesAfterAccountSwitch();
      closeAccountModal();
      showToast(`Welcome, ${displayName}! Your progress is now saved in your vault.`, '🛡️');
      updateMascot(`Welcome ${displayName}! Your yoga & wellness vault is protected. 🌿`);
    }

    async function handleAccountLogin(event) {
      event.preventDefault();
      const identifierNorm = document.getElementById('loginIdentifier').value.trim().toLowerCase();
      const password = document.getElementById('loginPassword').value;

      const accounts = loadRegisteredAccounts();
      const matched = accounts.find((acc) => acc.identifierNorm === identifierNorm);
      if (!matched) {
        showAuthFormError('No account found with that username or email. Try "Create Account".');
        return;
      }

      const candidateHash = await hashPasswordWithSalt(password, matched.salt);
      if (candidateHash !== matched.passwordHash) {
        showAuthFormError('Incorrect password. Please try again.');
        return;
      }

      localStorage.setItem(STORAGE_KEY_ACTIVE_SESSION, matched.userId);
      applyStorageNamespaceForUser(matched);
      refreshAllModulesAfterAccountSwitch();
      closeAccountModal();
      showToast(`Welcome back, ${matched.displayName}! Progress restored.`, '🔓');
      updateMascot(`Welcome back, ${matched.displayName}! Your progress is loaded. ✨`);
    }

    function handleAccountLogout() {
      const prevName = currentAuthUser ? currentAuthUser.displayName : 'User';
      localStorage.removeItem(STORAGE_KEY_ACTIVE_SESSION);
      applyStorageNamespaceForUser(null);
      refreshAllModulesAfterAccountSwitch();
      closeAccountModal();
      showToast(`Signed out of ${prevName}'s vault. Switched to Guest Mode.`, '🔒');
    }

    function updateAccountModalProfileStats() {
      const gam = loadGamificationState();
      const level = Math.floor(gam.totalXp / 150) + 1;
      const journals = loadJournalEntries();
      const ach = loadAchievementState();
      const badgeCount = Object.keys(ach.unlockedBadges || {}).length;

      document.getElementById('vaultStatXp').textContent = `${gam.totalXp} XP • Lvl ${level}`;
      document.getElementById('vaultStatStreak').textContent = `${gam.streakDays} Day${gam.streakDays === 1 ? '' : 's'} 🔥`;
      document.getElementById('vaultStatJournals').textContent = `${journals.length} ${journals.length === 1 ? 'entry' : 'entries'}`;
      document.getElementById('vaultStatBadges').textContent = `${badgeCount} / ${BADGE_CATALOG.length} seals`;
    }

    function exportUserVaultBackup() {
      if (!currentAuthUser) return;
      const backupPayload = {
        app: 'PranaSync',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        account: {
          displayName: currentAuthUser.displayName,
          identifier: currentAuthUser.identifier
        },
        data: {
          gamification: loadGamificationState(),
          analytics: loadAnalyticsData(),
          achievements: loadAchievementState(),
          journal: loadJournalEntries(),
          screeners: JSON.parse(localStorage.getItem(STORAGE_KEY_SCREENERS) || '[]'),
          goal: selectedGoalKey,
          intensity: selectedIntensityKey,
          circadian: circadianPreference
        }
      };

      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = currentAuthUser.identifier.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      a.href = url;
      a.download = `pranasync-vault-${safeName}-${getTodayIsoDate()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Progress backup (.json) downloaded safely!', '⬇️');
    }

    function importUserVaultBackup(event) {
      const file = event.target.files && event.target.files[0];
      if (!file || !currentAuthUser) return;

      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed || parsed.app !== 'PranaSync' || !parsed.data) {
            showToast('Invalid PranaSync backup file.', '⚠️');
            return;
          }
          const d = parsed.data;
          if (d.gamification) localStorage.setItem(STORAGE_KEY_GAMIFICATION, JSON.stringify(d.gamification));
          if (d.analytics) localStorage.setItem(STORAGE_KEY_ANALYTICS, JSON.stringify(d.analytics));
          if (d.achievements) localStorage.setItem(STORAGE_KEY_ACHIEVEMENTS, JSON.stringify(d.achievements));
          if (d.journal) localStorage.setItem(STORAGE_KEY_JOURNAL, JSON.stringify(d.journal));
          if (d.screeners) localStorage.setItem(STORAGE_KEY_SCREENERS, JSON.stringify(d.screeners));
          if (d.goal) localStorage.setItem(STORAGE_KEY_GOAL, d.goal);
          if (d.intensity) localStorage.setItem(STORAGE_KEY_INTENSITY, d.intensity);
          if (d.circadian) localStorage.setItem(STORAGE_KEY_CIRCADIAN, d.circadian);

          refreshAllModulesAfterAccountSwitch();
          updateAccountModalProfileStats();
          showToast('Backup restored into your account vault!', '✅');
        } catch (err) {
          showToast('Could not read backup file.', '⚠️');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    }

    // -------------------------------------------------------------------------
    // 12. INITIALIZATION ON WINDOW LOAD
    // -------------------------------------------------------------------------
    window.addEventListener('resize', resizePoseCanvas);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAccountModal();
    });

    window.onload = function () {
      const todayStr = new Date().toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
      document.getElementById('todayDateLabel').textContent = todayStr;
      document.getElementById('journalDateLabel').textContent = todayStr;

      applyCircadianTheme(false);
      setInterval(() => {
        if (circadianPreference === 'auto') applyCircadianTheme(false);
      }, 60000);

      resizePoseCanvas();
      updateActiveAsanaGuideCard('Tadasana');
      renderTutorialStep(false);
      renderGamificationHud();
      updateNavBadgePill();
      renderGoalsAndWalksTab();
      renderChallengesAndBadgesTab();
      renderJournalTimeline();
      renderQuestionnaireItems();
      updateCheckinLabels();
      requestAnimationFrame(mainPoseLoop);
    };