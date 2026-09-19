const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const config = require('./config/env');

const testImagePath = '/tmp/test-image.jpg';
// Valid 1x1 JPEG hex
const sampleJpgHex = 'ffd8ffe000104a46494600010101006000600000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffda0008010100003f00d2cf20ffd9';
fs.writeFileSync(testImagePath, Buffer.from(sampleJpgHex, 'hex'));

console.log('----------------------------------------------------');
console.log('STEP 1 & 2: Standalone WhatsApp Media Diagnosis');
console.log('Image file created at:', testImagePath, 'Size:', fs.statSync(testImagePath).size, 'bytes');

const destinationChatId = '918799092907@c.us';

const sessionDir = path.join(config.WHATSAPP_SESSION_PATH, 'session-account-30');
['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
  try {
    const p = path.join(sessionDir, f);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`[Diagnosis] Cleaned stale lock file: ${f}`);
    }
  } catch (_) {}
});

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = fs.existsSync(macChrome) ? macChrome : undefined;

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: config.WHATSAPP_SESSION_PATH,
    clientId: 'account-30'
  }),
  puppeteer: {
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  }
});

client.on('qr', () => {
  console.log('[Diagnosis] QR requested — session not active or logged out');
  process.exit(1);
});

client.on('authenticated', () => {
  console.log('[Diagnosis] Authenticated successfully');
});

client.on('ready', async () => {
  console.log('----------------------------------------------------');
  console.log('[Diagnosis] Client is READY!');
  try {
    const state = await client.getState();
    console.log('client.getState():', state);
  } catch (e) {
    console.log('client.getState() error:', e.message);
  }

  console.log('client.info.wid:', client.info?.wid?._serialized || client.info?.wid);
  console.log('Destination chat ID:', destinationChatId);

  // STEP 4: Compare Text and Media
  console.log('\n--- TEST A: Text Message Send ---');
  try {
    const textResult = await client.sendMessage(destinationChatId, 'JeenMate text test');
    console.log('Test A Success!');
    console.log('Returned Text Msg ID:', textResult?.id?._serialized || textResult?.id?.id || textResult?.id);
    console.log('Text Ack:', textResult?.ack);
  } catch (err) {
    console.error('Test A FAILED with error:', err);
  }

  console.log('\n--- TEST B: Standard client.sendMessage(chatId, media) ---');
  try {
    const media = MessageMedia.fromFilePath(testImagePath);
    console.log('MessageMedia mimetype:', media.mimetype);
    console.log('MessageMedia filename:', media.filename);
    console.log('MessageMedia data length:', media.data?.length);

    console.log('[Diagnosis] Calling standard client.sendMessage(chatId, media)...');
    const mediaResult = await client.sendMessage(destinationChatId, media, {
      caption: 'JeenMate standard send test'
    });

    console.log('>>> TEST B SUCCESS!');
    console.log('Returned Media Msg ID:', mediaResult?.id?._serialized || mediaResult?.id?.id || mediaResult?.id);
    console.log('Media Ack:', mediaResult?.ack);
  } catch (err) {
    console.error('>>> TEST B FAILED!');
    console.error('Error Name:', err?.name);
    console.error('Error Message:', err?.message);
    console.error('Error Stack:\n', err?.stack || err);
  }

  console.log('----------------------------------------------------');
  setTimeout(async () => {
    await client.destroy().catch(() => {});
    process.exit(0);
  }, 3000);
});

client.initialize().catch((err) => {
  console.error('[Diagnosis] client.initialize error:', err);
  process.exit(1);
});
