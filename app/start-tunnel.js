const { spawn, execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const qrCode = require('qrcode');

const APP_DIR = __dirname;
const API_DIR = path.join(APP_DIR, '../api');
const ENV_PATH = path.join(APP_DIR, '.env');

console.log("🚀 Initializing MedQuire Tunnel Manager (Windows/Cross-Platform)...");

// --- Helper: Kill Processes ---
function cleanup() {
  console.log("🧹 Cleaning up previous processes...");
  try {
    if (process.platform === 'win32') {
      // Kill cloudflared
      execSync('taskkill /F /IM cloudflared.exe /T 2>nul || exit 0', { shell: true });
      
      // Kill processes on ports 3001 and 8081
      const ports = [3001, 8081];
      ports.forEach(port => {
        try {
          const stdout = execSync(`netstat -ano | findstr :${port}`).toString();
          const lines = stdout.split('\n');
          lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 4 && parts[1].endsWith(`:${port}`)) {
              const pid = parts[parts.length - 1];
              if (pid && pid !== '0') {
                console.log(`  - Killing process ${pid} on port ${port}...`);
                execSync(`taskkill /F /PID ${pid} /T 2>nul || exit 0`, { shell: true });
              }
            }
          });
        } catch (e) {
          // No process on this port
        }
      });
    } else {
      execSync('pkill -f cloudflared || true');
      execSync('pkill -f "expo start" || true');
      execSync('lsof -i :3001 -t | xargs kill -9 2>/dev/null || true');
      execSync('lsof -i :8081 -t | xargs kill -9 2>/dev/null || true');
    }
  } catch (e) {}
}

// --- Step 1: Start Backend ---
async function startBackend() {
  console.log("📦 Starting Backend API...");
  const apiProcess = spawn('npm', ['run', 'dev'], { 
    cwd: API_DIR, 
    shell: true,
    stdio: 'inherit', // See logs in the terminal
    detached: true
  });
  apiProcess.unref();
  return apiProcess;
}

// --- Step 2: Start Cloudflared ---
async function startTunnel(url, label) {
  console.log(`☁️  Opening tunnel for ${label} (${url})...`);
  const cloudflaredPath = path.join(APP_DIR, 'node_modules/cloudflared/bin/cloudflared');
  const bin = process.platform === 'win32' ? `${cloudflaredPath}.exe` : cloudflaredPath;
  
  const tunnel = spawn(bin, ['tunnel', '--url', url], { shell: true });
  const readline = require('readline');
  const rl = readline.createInterface({ input: tunnel.stderr });
  
  return new Promise((resolve) => {
    let capturedUrl = '';
    const timeout = setTimeout(() => {
      if (!capturedUrl) {
        console.error(`❌ Failed to get ${label} URL within 60s`);
        tunnel.kill();
        process.exit(1);
      }
    }, 60000);

    rl.on('line', (line) => {
      // Log progress to see what's happening
      if (line.includes('trycloudflare.com')) {
         const match = line.match(/https:\/\/(?!api)([a-z0-9-]{5,})\.trycloudflare\.com/);
         if (match && !capturedUrl) {
           capturedUrl = match[0];
           console.log(`✅ ${label} URL: ${capturedUrl}`);
           clearTimeout(timeout);
           resolve({ url: capturedUrl, process: tunnel });
         }
      }
    });

    tunnel.on('exit', (code) => {
      if (!capturedUrl) {
        console.error(`🛑 ${label} tunnel process died prematurely with code ${code}`);
        process.exit(1);
      }
    });
  });
}

// --- Step 3: Update .env ---
function updateEnv(apiUrl) {
  // DISABLED: tunnel URL would overwrite production Railway URL
  // console.log(`📝 Updating .env: EXPO_PUBLIC_API_BASE_URL=${apiUrl}`);
  // let content = fs.readFileSync(ENV_PATH, 'utf8');
  // if (content.includes('EXPO_PUBLIC_API_BASE_URL=')) {
  //   content = content.replace(/EXPO_PUBLIC_API_BASE_URL=[^\r\n]*/g, `EXPO_PUBLIC_API_BASE_URL=${apiUrl}`);
  // } else {
  //   content += `\nEXPO_PUBLIC_API_BASE_URL=${apiUrl}\n`;
  // }
  // fs.writeFileSync(ENV_PATH, content, 'utf8');
  console.log('⏭️ Skipped .env sync — keeping EXPO_PUBLIC_API_BASE_URL unchanged');
}

// --- Main Execution ---
async function main() {
  cleanup();
  
  await startBackend();
  
  // Tunnel for Backend (3001)
  const backendTunnel = await startTunnel('http://127.0.0.1:3001', 'Backend');
  updateEnv(backendTunnel.url);
  
  // Tunnel for Frontend (8081)
  const frontendTunnel = await startTunnel('http://127.0.0.1:8081', 'Frontend');
  const host = frontendTunnel.url.replace('https://', '');

  console.log("\n==========================================================");
  console.log("📱 SCAN THIS QR CODE WITH YOUR PHONE CAMERA");
  console.log("==========================================================\n");

  // Promisify QR code generation to keep main clean
  const qrStr = await new Promise((resolve) => {
    qrCode.toString(`exp://${host}`, { type: 'terminal', small: true }, (err, str) => {
      resolve(err ? "Failed to generate QR code" : str);
    });
  });
  console.log(qrStr);
  
  console.log("==========================================================");
  console.log(`URL: exp://${host}`);
  console.log("==========================================================\n");
  
  console.log("📡 Starting Expo Bundler with cache clear...");
  const expoProcess = spawn('npx', ['expo', 'start', '--clear'], { 
    cwd: APP_DIR, 
    shell: true, 
    stdio: 'inherit',
    env: { ...process.env, EXPO_PACKAGER_PROXY_URL: frontendTunnel.url }
  });

  // Handle tunnel exits
  const handleExit = (label, code) => {
    console.log(`\n🛑 ${label} process exited with code ${code}`);
    cleanup();
    process.exit(code || 0);
  };

  expoProcess.on('exit', (code) => handleExit('Expo Bundler', code));
  backendTunnel.process.on('exit', (code) => handleExit('Backend Tunnel', code));
  frontendTunnel.process.on('exit', (code) => handleExit('Frontend Tunnel', code));

  // Catch Ctrl+C
  process.on('SIGINT', () => {
    console.log("\n👋 Shutting down...");
    cleanup();
    process.exit(0);
  });
}

main().catch(err => {
  console.error("💥 Critical Failure:", err);
  process.exit(1);
});
