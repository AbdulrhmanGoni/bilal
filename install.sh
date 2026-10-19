#!/bin/bash
# Copies the built extension into the current user's GNOME Shell extensions
# directory and enables it.
set -e

UUID=bilal@king.it
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

cd "$(dirname "$0")"
mkdir -p "$DEST"
cp -r -f dist/* "$DEST/"

# In case it was disabled, make sure it is active (safe no-op otherwise).
gnome-extensions enable "$UUID" 2>/dev/null || true

echo "Installed to $DEST"
echo "On Wayland, log out and back in (or restart the session) for the new code to load."
