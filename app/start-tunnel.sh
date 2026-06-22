#!/bin/bash
# start-tunnel.sh
# Uses Cloudflare Tunnel to expose the Expo dev server

echo "Cleaning up previous processes..."
pkill -f "cloudflared" 2>/dev/null
pkill -f "expo start" 2>/dev/null
sleep 1

# Clear port 8081 if occupied
PID=$(lsof -ti:8081)
if [ ! -z "$PID" ]; then
    echo "Clearing port 8081 (PID: $PID)..."
    kill -9 $PID
    sleep 1
fi

# Clear port 3001 if occupied (Backend API)
PID_API=$(lsof -ti:3001)
if [ ! -z "$PID_API" ]; then
    echo "Clearing port 3001 (PID: $PID_API)..."
    kill -9 $PID_API
    sleep 1
fi

echo "Starting Backend API..."
cd ../api && npm run dev > server_out.log 2> server_err.log &
API_PID=$!
cd ../app

echo "Starting Backend Cloudflare Tunnel..."
BACKEND_LOG=$(mktemp)
./node_modules/cloudflared/bin/cloudflared tunnel --url http://127.0.0.1:3001 > "$BACKEND_LOG" 2>&1 &
BACKEND_CF_PID=$!

echo "Waiting for Backend URL..."
BACKEND_URL=""
for i in $(seq 1 30); do
    BACKEND_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$BACKEND_LOG" | head -1)
    if [ ! -z "$BACKEND_URL" ]; then break; fi
    sleep 1
done

if [ ! -z "$BACKEND_URL" ]; then
    # DISABLED: tunnel URL would overwrite production Railway URL
    # echo "Updating .env with Backend URL: $BACKEND_URL"
    # sed -i '' "s|EXPO_PUBLIC_API_BASE_URL=.*|EXPO_PUBLIC_API_BASE_URL=$BACKEND_URL|g" .env
    echo "Skipped .env sync — keeping EXPO_PUBLIC_API_BASE_URL unchanged"
else
    echo "ERROR: Failed to get Backend URL"
fi

echo "Starting Frontend Cloudflare Tunnel..."

# Start cloudflared, capture output to a temp file
TUNNEL_LOG=$(mktemp)
./node_modules/cloudflared/bin/cloudflared tunnel --url http://127.0.0.1:8081 > "$TUNNEL_LOG" 2>&1 &
CLOUDFLARE_PID=$!

# Wait for the trycloudflare.com URL to appear (up to 30 seconds)
echo "Waiting for Cloudflare URL..."
CLOUDFLARE_URL=""
for i in $(seq 1 30); do
    CLOUDFLARE_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)
    if [ ! -z "$CLOUDFLARE_URL" ]; then
        break
    fi
    sleep 1
done

if [ -z "$CLOUDFLARE_URL" ]; then
    echo "ERROR: Could not get Cloudflare URL. Check your connection."
    kill $CLOUDFLARE_PID
    rm "$TUNNEL_LOG"
    exit 1
fi

# Extract just the host (strip https://)
CLOUDFLARE_HOST=$(echo "$CLOUDFLARE_URL" | sed 's|https://||')

echo ""
echo "=========================================================="
echo " SCAN THIS QR CODE WITH YOUR PHONE CAMERA"
echo " It will open in EXPO GO automatically"
echo "=========================================================="
echo ""

# Generate QR code in terminal
node -e "const qr = require('qrcode'); qr.toString('exp://$CLOUDFLARE_HOST', { type: 'terminal', small: true }, (e, s) => { if (!e) console.log(s); else console.error(e); });"

# Generate File as backup and open it
node -e "const qr = require('qrcode'); qr.toFile('qrcode.png', 'exp://$CLOUDFLARE_HOST', { width: 400, margin: 2 }, (e) => { if (!e) { require('child_process').exec('open qrcode.png'); } });"

echo ""
echo "=========================================================="
echo " If QR doesn't work, open this URL in your Expo Go app:"
echo " exp://$CLOUDFLARE_HOST"
echo "=========================================================="
echo ""

# Run Expo in the foreground so the interactive terminal menu works
PATH=$PATH:/usr/local/bin EXPO_PACKAGER_PROXY_URL=$CLOUDFLARE_URL npx expo start --clear

# We reach here when the user exits Expo (e.g. by pressing Ctrl+C)
echo "Shutting down tunnel..."
kill $CLOUDFLARE_PID 2>/dev/null
kill $BACKEND_CF_PID 2>/dev/null
kill $API_PID 2>/dev/null
rm -f "$TUNNEL_LOG" "$BACKEND_LOG"
