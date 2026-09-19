const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const config = require('./config/env');

const testImagePath = '/tmp/test-image.jpg';
const sampleJpgHex = 'ffd8ffe000104a46494600010101006000600000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffda0008010100003f00d2cf20ffd9';
fs.writeFileSync(testImagePath, Buffer.from(sampleJpgHex, 'hex'));

const destinationChatId = '918799092907@c.us';
const sessionDir = path.join(config.WHATSAPP_SESSION_PATH, 'session-account-30');

// Clean singleton locks
['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
  try {
    const p = path.join(sessionDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
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

const ACK_NAMES = {
  '-1': 'ACK_ERROR',
  '0': 'ACK_PENDING (Clock icon)',
  '1': 'ACK_SERVER (Single tick - reached WhatsApp server)',
  '2': 'ACK_DEVICE (Double tick - reached receiver phone)',
  '3': 'ACK_READ (Blue double tick - read by receiver)',
  '4': 'ACK_PLAYED (Played voice/audio)'
};

function getAckName(ack) {
  return ACK_NAMES[String(ack)] || `UNKNOWN_ACK (${ack})`;
}

// Global Event Listeners BEFORE sending (TEST 1)
const allAcks = [];
const allCreated = [];

client.on('change_state', (state) => {
  console.log('[EVENT: change_state]', state);
});

client.on('message_create', (msg) => {
  const info = {
    id: msg.id?.id || msg.id,
    _serialized: msg.id?._serialized,
    from: msg.from,
    to: msg.to,
    author: msg.author,
    type: msg.type,
    body: msg.body,
    timestamp: msg.timestamp,
    fromMe: msg.fromMe,
    ack: msg.ack,
    ackName: getAckName(msg.ack)
  };
  allCreated.push(info);
  console.log('\n[EVENT: message_create] >>>', JSON.stringify(info, null, 2));
});

client.on('message_ack', (msg, ack) => {
  const info = {
    id: msg.id?.id || msg.id,
    _serialized: msg.id?._serialized,
    from: msg.from,
    to: msg.to,
    ack: ack,
    ackName: getAckName(ack),
    timestamp: new Date().toISOString()
  };
  allAcks.push(info);
  console.log('\n[EVENT: message_ack] >>>', JSON.stringify(info, null, 2));
});

client.on('message', (msg) => {
  console.log('[EVENT: message (incoming)]', msg.id?._serialized, 'from:', msg.from, 'body:', msg.body);
});

client.on('ready', async () => {
  console.log('====================================================');
  console.log('CLIENT READY! STARTING DEEP DELIVERY DIAGNOSIS');
  console.log('====================================================');

  // TEST 7: WhatsApp Web Session Identity
  console.log('\n--- TEST 7: SESSION IDENTITY ---');
  console.log('client.getState():', await client.getState());
  console.log('client.info.wid:', client.info?.wid?._serialized || client.info?.wid);
  console.log('client.info.pushname:', client.info?.pushname);
  console.log('client.info.phone:', client.info?.phone);
  console.log('client.info.platform:', client.info?.platform);

  // Check the recipient contact info from WhatsApp Web
  try {
    const contact = await client.getContactById(destinationChatId);
    console.log('Recipient Contact:', {
      id: contact.id?._serialized,
      name: contact.name,
      pushname: contact.pushname,
      number: contact.number,
      isMyContact: contact.isMyContact,
      isUser: contact.isUser,
      isGroup: contact.isGroup,
      isWAContact: contact.isWAContact
    });
  } catch (err) {
    console.log('Error getting recipient contact:', err.message);
  }

  // TEST 1 & 2 & 3 & 4 & 5: PART A — TEXT MESSAGE
  console.log('\n====================================================');
  console.log('PART A: SENDING ONE TEXT MESSAGE');
  console.log('====================================================');
  const textBody = `JeenMate delivery test text [${new Date().toLocaleTimeString()}]`;
  let sentTextResult = null;
  try {
    console.log(`[Text] Sending "${textBody}" to ${destinationChatId}...`);
    sentTextResult = await client.sendMessage(destinationChatId, textBody);
    console.log('[Text] sendMessage returned object:', {
      id: sentTextResult?.id?._serialized || sentTextResult?.id?.id,
      fromMe: sentTextResult?.fromMe,
      ack: sentTextResult?.ack,
      ackName: getAckName(sentTextResult?.ack),
      type: sentTextResult?.type,
      timestamp: sentTextResult?.timestamp
    });
  } catch (err) {
    console.error('[Text] sendMessage threw error:', err);
  }

  console.log('[Text] Waiting 15 seconds to observe ACK lifecycle (Server/Device/Read)...');
  await new Promise(r => setTimeout(r, 15000));

  // Inspect Chat & Last Message (TEST 3)
  console.log('\n--- TEST 3 (Text): WhatsApp Chat State ---');
  try {
    const chat = await client.getChatById(destinationChatId);
    console.log('Chat Info:', {
      id: chat.id?._serialized,
      name: chat.name,
      isGroup: chat.isGroup,
      unreadCount: chat.unreadCount,
      timestamp: chat.timestamp
    });
    if (chat.lastMessage) {
      console.log('Chat lastMessage:', {
        id: chat.lastMessage.id?._serialized || chat.lastMessage.id?.id,
        fromMe: chat.lastMessage.fromMe,
        type: chat.lastMessage.type,
        body: chat.lastMessage.body,
        timestamp: chat.lastMessage.timestamp,
        ack: chat.lastMessage.ack,
        ackName: getAckName(chat.lastMessage.ack)
      });
    } else {
      console.log('Chat lastMessage is NULL or undefined');
    }
  } catch (err) {
    console.error('[Text] getChatById error:', err.message);
  }

  // Inspect WhatsApp Web Store & DOM directly (TEST 5)
  console.log('\n--- TEST 5 (Text): Browser-side Model & DOM Inspection ---');
  const textWaInspection = await client.pupPage.evaluate(async (chatId, textMsgSerialized) => {
    try {
      const chatWid = window.require('WAWebWidFactory').createWid(chatId);
      const chat = window.require('WAWebCollections').Chat.get(chatWid) || window.require('WAWebCollections').Chat.get(chatId);
      
      let msgInStore = null;
      if (textMsgSerialized) {
        msgInStore = window.require('WAWebCollections').Msg.get(textMsgSerialized);
      }

      // Also check the last 5 messages in chat.msgs collection
      const recentMsgs = [];
      if (chat && chat.msgs && chat.msgs.models) {
        const lastModels = chat.msgs.models.slice(-5);
        for (const m of lastModels) {
          recentMsgs.push({
            id: m.id?._serialized,
            body: m.body,
            type: m.type,
            fromMe: m.fromMe,
            ack: m.ack,
            t: m.t
          });
        }
      }

      // Check DOM elements in current UI
      const renderedMsgs = Array.from(document.querySelectorAll('div[data-id], div[role="row"]')).slice(-5).map(el => ({
        dataId: el.getAttribute('data-id'),
        text: el.innerText ? el.innerText.substring(0, 100) : ''
      }));

      return {
        chatExistsInStore: Boolean(chat),
        chatMsgsCount: chat?.msgs?.models?.length || 0,
        msgFoundInStore: Boolean(msgInStore),
        msgStoreDetails: msgInStore ? {
          id: msgInStore.id?._serialized,
          ack: msgInStore.ack,
          fromMe: msgInStore.fromMe,
          type: msgInStore.type,
          body: msgInStore.body,
          t: msgInStore.t
        } : null,
        recentMsgsInStore: recentMsgs,
        domRenderedMsgs: renderedMsgs
      };
    } catch (e) {
      return { error: e.message, stack: e.stack };
    }
  }, destinationChatId, sentTextResult?.id?._serialized);

  console.log('Browser-side Inspection for Text:', JSON.stringify(textWaInspection, null, 2));

  // TEST 1 & 2 & 3 & 4 & 5: PART B — IMAGE MESSAGE
  console.log('\n====================================================');
  console.log('PART B: SENDING ONE IMAGE MESSAGE');
  console.log('====================================================');
  const media = MessageMedia.fromFilePath(testImagePath);
  const imageCaption = `JeenMate delivery test image [${new Date().toLocaleTimeString()}]`;
  let sentMediaResult = null;
  try {
    console.log(`[Image] Sending media with caption "${imageCaption}" to ${destinationChatId}...`);
    sentMediaResult = await client.sendMessage(destinationChatId, media, { caption: imageCaption });
    console.log('[Image] sendMessage returned object:', {
      id: sentMediaResult?.id?._serialized || sentMediaResult?.id?.id,
      fromMe: sentMediaResult?.fromMe,
      ack: sentMediaResult?.ack,
      ackName: getAckName(sentMediaResult?.ack),
      type: sentMediaResult?.type,
      timestamp: sentMediaResult?.timestamp
    });
  } catch (err) {
    console.error('[Image] sendMessage threw error:', err);
  }

  console.log('[Image] Waiting 15 seconds to observe ACK lifecycle (Server/Device/Read)...');
  await new Promise(r => setTimeout(r, 15000));

  // Inspect Chat & Last Message (TEST 3)
  console.log('\n--- TEST 3 (Image): WhatsApp Chat State ---');
  try {
    const chat = await client.getChatById(destinationChatId);
    if (chat.lastMessage) {
      console.log('Chat lastMessage after image:', {
        id: chat.lastMessage.id?._serialized || chat.lastMessage.id?.id,
        fromMe: chat.lastMessage.fromMe,
        type: chat.lastMessage.type,
        caption: chat.lastMessage.caption || chat.lastMessage.body,
        timestamp: chat.lastMessage.timestamp,
        ack: chat.lastMessage.ack,
        ackName: getAckName(chat.lastMessage.ack)
      });
    }
  } catch (err) {
    console.error('[Image] getChatById error:', err.message);
  }

  // Inspect WhatsApp Web Store & DOM directly (TEST 5)
  console.log('\n--- TEST 5 (Image): Browser-side Model & DOM Inspection ---');
  const imageWaInspection = await client.pupPage.evaluate(async (chatId, imageMsgSerialized) => {
    try {
      const chatWid = window.require('WAWebWidFactory').createWid(chatId);
      const chat = window.require('WAWebCollections').Chat.get(chatWid) || window.require('WAWebCollections').Chat.get(chatId);
      
      let msgInStore = null;
      if (imageMsgSerialized) {
        msgInStore = window.require('WAWebCollections').Msg.get(imageMsgSerialized);
      }

      const recentMsgs = [];
      if (chat && chat.msgs && chat.msgs.models) {
        const lastModels = chat.msgs.models.slice(-5);
        for (const m of lastModels) {
          recentMsgs.push({
            id: m.id?._serialized,
            body: m.body,
            caption: m.caption,
            type: m.type,
            fromMe: m.fromMe,
            ack: m.ack,
            t: m.t
          });
        }
      }

      return {
        chatExistsInStore: Boolean(chat),
        chatMsgsCount: chat?.msgs?.models?.length || 0,
        msgFoundInStore: Boolean(msgInStore),
        msgStoreDetails: msgInStore ? {
          id: msgInStore.id?._serialized,
          ack: msgInStore.ack,
          fromMe: msgInStore.fromMe,
          type: msgInStore.type,
          caption: msgInStore.caption,
          t: msgInStore.t
        } : null,
        recentMsgsInStore: recentMsgs
      };
    } catch (e) {
      return { error: e.message, stack: e.stack };
    }
  }, destinationChatId, sentMediaResult?.id?._serialized);

  console.log('Browser-side Inspection for Image:', JSON.stringify(imageWaInspection, null, 2));

  // SUMMARY OF ALL CAPTURED EVENTS
  console.log('\n====================================================');
  console.log('ALL CAPTURED message_create EVENTS (' + allCreated.length + ')');
  console.log('====================================================');
  allCreated.forEach((e, idx) => console.log(`#${idx + 1}:`, e));

  console.log('\n====================================================');
  console.log('ALL CAPTURED message_ack EVENTS (' + allAcks.length + ')');
  console.log('====================================================');
  allAcks.forEach((e, idx) => console.log(`#${idx + 1}:`, e));

  console.log('\n====================================================');
  console.log('DIAGNOSIS RUN FINISHED');
  console.log('====================================================');

  setTimeout(async () => {
    await client.destroy().catch(() => {});
    process.exit(0);
  }, 2000);
});

client.initialize().catch((err) => {
  console.error('Initialize error:', err);
  process.exit(1);
});
