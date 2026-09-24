# 1.0.193-dev AC adjustment

Character cards now expose a manual AC offset in edit mode, consistent with initiative and speed. When a scene AC total changes, runtime-authority subtracts the native sheet offset before storing the absolute base. Existing offset-free cards behave as before. Current-HP-only updates and repeated total echoes preserve AC calculations.

Includes the web import-192 fix. Runtime-authority regression tests, web core/browser regression tests, type checks and production builds pass. No relay/server protocol change or stable-plugin change is required.
