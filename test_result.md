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
  - task: "Floating ride bubble (in-app, draggable, always on top)"
    implemented: true
    working: "NA"
    file: "src/components/FloatingRideBubble.tsx, src/ridesContext.tsx, app/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "New global RidesProvider polls the marketplace every 20s while authenticated and exposes the live count + last entries. The FloatingRideBubble component is rendered globally in the root layout, hidden on the login screen, draggable with snap-to-edge behaviour, and shows a pulsing badge when new rides arrive. Tapping it opens an expanded card preview, then routes the driver to the missions tab. The previous in-screen polling/notification trigger in missions.tsx was removed to avoid duplicate alerts. NOTE: this overlay is in-app only — a true system-wide overlay (over other apps) requires a custom Android dev build with SYSTEM_ALERT_WINDOW; not feasible in managed Expo workflow."

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
