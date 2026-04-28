#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

frontend:
  - task: "Block ride access when off-shift"
    implemented: true
    working: "NA"
    file: "app/(tabs)/missions.tsx, app/mission/[id].tsx, src/ridesContext.tsx, app/(tabs)/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "RidesProvider now exposes onShift globally (fetched from /api/driver/profile, refreshed on toggle, on AppState=active and every 20s). Missions screen: cards are dimmed when off-shift, the claim button becomes 'PASSEZ EN SERVICE' (disabled-looking) and tapping any assigned mission card or claim button surfaces an Alert prompting the driver to go on-shift. A persistent banner with a CTA to the Carte tab is shown at the top of the missions list. Mission detail: when off-shift, the slide-button footer is replaced with a 'Hors service' banner + CTA. Toggling shift from the home tab calls refreshShift() so the gating reflects instantly across screens."

  - task: "End-of-ride summary modal with payment instructions"
    implemented: true
    working: "NA"
    file: "app/mission/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "When the driver slides 'GLISSER POUR TERMINER' on the in_progress mission, the backend status is set to completed and a fullscreen completion modal opens showing: amount of the ride (large yellow value) and a colour-coded payment block. If payment is online (card, stripe, app, prepaid, paid_online, payment_status=paid…) the modal shows a yellow info block 'N'encaissez pas le client. Le paiement a été effectué en ligne.' If payment is cash/onboard the modal shows a warning block 'Encaissez le client à bord. Le paiement doit être effectué directement auprès de vous.' Closing the modal returns to the missions list."

  - task: "Picture-in-Picture reservation preview"
    implemented: true
    working: "NA"
    file: "src/components/PiPReservation.tsx, app/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "New global PiP component rendered above all screens (mounted in _layout.tsx). Appears in the bottom-right corner whenever a new ride is detected by the global RidesProvider. Card shows: client name, scheduled date/time, service category, status pill (NOUVELLE/ASSIGNÉE/EN COURS/TERMINÉE) and amount. Two states: expanded card (default at appearance) and minimized circular pill with badge. Actions: minimize/expand, close, open full reservation (deep-links to /mission/[id] for assigned rides or /(tabs)/missions for marketplace). Discrete entrance animation: translate-Y + scale + fade with back ease. When count > 1, a yellow pulsing ring around the minimized pill plus a +N indicator on the expanded card. Hidden on login and on mission detail screens. Width responsive (max 360px, full-width-minus-32 on small phones). Uses pointerEvents='box-none' so it never blocks navigation underneath."

  - task: "Incoming-call style notifications (max priority + config plugin)"
    implemented: true
    working: "NA"
    file: "plugins/with-incoming-ride-notifications.js, app.json, src/feedback.ts, src/pushService.ts, src/ridesContext.tsx, app/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "1) New Expo config plugin `plugins/with-incoming-ride-notifications.js` injects USE_FULL_SCREEN_INTENT, WAKE_LOCK, DISABLE_KEYGUARD, SCHEDULE_EXACT_ALARM, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE permissions and sets the MainActivity flags android:showWhenLocked=true, android:turnScreenOn=true, android:launchMode=singleTask. iOS Info.plist updated with UIBackgroundModes (remote-notification, audio, fetch). Plugin only runs at EAS prebuild — managed runtime is unaffected. 2) New Android channel 'incoming_ride' with IMPORTANCE_MAX, bypassDnd, lockscreenVisibility=PUBLIC, aggressive 5-cycle vibration pattern, lights, default sound. 3) `notifyNewRide` updated with priority='max', interruptionLevel='time-sensitive', relevanceScore=1.0, vibrate pattern, kind='incoming_ride' data. 4) Foreground polling reduced from 3s to 1.5s (sub-2s perception). 5) New `forceRefresh` method on RidesProvider triggered in `pushService.onIncoming` listener — when a server-pushed notification arrives in foreground a fresh marketplace fetch happens immediately so the modal pops within ~1s. 6) Tap on notification banner (system tray / lockscreen) brings the app forward and routes to /(tabs)/missions which lets the global RideRequestModal surface. LIMITS DOCUMENTED: real Android full-screen-intent (NotificationCompat.Builder#setFullScreenIntent) and iOS CallKit-style imitation require a custom native module + EAS dev build; managed Expo cannot post a full-screen-intent. The config plugin prepares the manifest so a future native module can plug in seamlessly."

  - task: "Premium Uber-style ride request system"
    implemented: true
    working: "NA"
    file: "src/components/RideRequestModal.tsx, src/ridesContext.tsx, src/notificationsHistory.ts, app/notifications.tsx, app/_layout.tsx, app/(tabs)/index.tsx, app/(tabs)/menu.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "FULL REPLACEMENT of old FloatingRideBubble + PiP system. New flow: 1) RidesProvider polls every 3s in foreground, 20s in background, dedups via known IDs and a 10-min dismiss memory. 2) Maintains a queue of pending ride requests. Top of queue surfaces in RideRequestModal — full-screen Modal with darkened backdrop, slides from top with translate+scale+back-easing animation, triple haptic burst on appearance, sound from prefs, AND a local push so it shows when backgrounded. 3) Modal contains: 80px circular SVG countdown ring (green→red), 15s timer with auto-refuse, big yellow commission, payment pill, client avatar+name, datetime+distance row, route block (departure/destination), error banner on accept failure. Actions: green ACCEPTER (calls claimMarketplace, retries with extra 8s if fails), gray REFUSER (marks dismissed for 10 min, advances queue), 'Voir les détails' link to missions tab, swipe-up=accept / swipe-down=refuse. Queue badge '+N en attente' shown when pendingCount>1. 4) New /notifications history screen (AsyncStorage backed via prefs). Bell icon with red unread badge added to home top bar. Live counter pill 'N dispos' near the shift pill, pulses when ride count grows. 5) Old FloatingRideBubble.tsx, PiPReservation.tsx and androidOverlayService.ts deleted. 6) Push notifications still fire when a ride arrives so the driver is alerted out-of-app."

  - task: "Floating ride bubble (Android background-only via sticky notification)"
    implemented: true
    working: "NA"
    file: "src/components/FloatingRideBubble.tsx, src/androidOverlayService.ts, app.json"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Refactored to be Android-only and background-only. The component now renders nothing on screen — it acts as a manager that wires the global RidesProvider data into androidOverlayService.ts. Logic: AppState=background → posts a sticky high-priority notification on the 'floating_bubble' channel showing count + first pickup + commission, with deep-link data → /(tabs)/missions. AppState=active → notification dismissed automatically. iOS / Web: no-op. SYSTEM_ALERT_WINDOW added to android.permissions for a future native overlay module; requestOverlayPermission() opens the corresponding Android settings page (sendIntent ACTION_MANAGE_OVERLAY_PERMISSION). Bubble UI removed from foreground (per user spec)."

  - task: "Auto reminder 1h before each mission"
    implemented: true
    working: "NA"
    file: "src/reminderService.ts, src/ridesContext.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "New reminderService schedules a local notification 1h before each upcoming mission with the exact text 'Votre mission commence bientôt. Veuillez démarrer la course.' Idempotent: identical pickups are kept, stale ones cancelled, and reminders are removed when missions are completed/cancelled. Triggered every 5 min and on app foreground via the RidesProvider."

  - task: "Push notifications setup (Expo Notifications)"
    implemented: true
    working: "NA"
    file: "src/feedback.ts, src/pushService.ts, app/_layout.tsx, app/settings/notifications.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Added expo-notifications integration. New `pushService.ts` handles permission, Android channel, expo push token retrieval and registration with backend (`POST /api/driver/push-token`). New `app/settings/notifications.tsx` screen lets driver enable/disable push, test a notification and view their device token. `_layout.tsx` calls `setupPushNotifications()` once authenticated and routes notification taps to `/(tabs)/missions`. The settings index now exposes the notifications entry."

  - task: "Fix incorrect profile route"
    implemented: true
    working: "NA"
    file: "app/(tabs)/index.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Profile header button was pointing to non-existent /(tabs)/profile route. Changed to /(tabs)/menu which is the actual screen."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 0
  run_ui: false

test_plan:
  current_focus:
    - "Push notifications setup (Expo Notifications)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "Implemented Expo Push Notifications: permission flow, Android channel, getExpoPushTokenAsync, register with backend at /api/driver/push-token, foreground handler with banner, and settings screen with toggle + test button. Tap on a notification routes the user to the Missions tab. App compiles fine; full e2e validation requires a real device + driver credentials."
