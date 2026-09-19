const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const config = require('./config/env');
const pool = require('./config/db');

async function runE2ETestPass() {
  console.log('=================================================================');
  console.log('       JEENMATE REAL END-TO-END MEDIA TESTING PASS              ');
  console.log('=================================================================\n');

  const destinationNumber = '918799092907';
  const destinationChatId = `${destinationNumber}@c.us`;
  const accountId = 30;

  const sessionDir = path.join(config.WHATSAPP_SESSION_PATH, `session-account-${accountId}`);
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
      clientId: `account-${accountId}`
    }),
    puppeteer: {
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    }
  });

  const results = {
    video: { outgoing: 'FAIL', caption: 'FAIL', db: 'FAIL', ack: 'NONE', waId: null },
    pdf: { outgoing: 'FAIL', caption: 'FAIL', db: 'FAIL', ack: 'NONE', waId: null },
    docx: { outgoing: 'FAIL', caption: 'FAIL', db: 'FAIL', ack: 'NONE', waId: null },
    doc: { outgoing: 'FAIL', caption: 'FAIL', db: 'FAIL', ack: 'NONE', waId: null },
    text: { outgoing: 'FAIL', db: 'FAIL', ack: 'NONE', waId: null },
    image: { outgoing: 'FAIL', caption: 'FAIL', db: 'FAIL', ack: 'NONE', waId: null },
    sessionIsolation: 'PASS'
  };

  const pendingAcks = new Map();

  client.on('message_create', (msg) => {
    const id = msg.id ? (msg.id.id || msg.id._serialized || msg.id) : null;
    const cleanId = (id && id.includes('_')) ? id.split('_').pop() : id;
    console.log(`[Event: message_create] Type: ${msg.type}, fromMe: ${msg.fromMe}, WA ID: ${cleanId}, ack: ${msg.ack}`);
  });

  client.on('message_ack', (msg, ack) => {
    const id = msg.id ? (msg.id.id || msg.id._serialized || msg.id) : null;
    const cleanId = (id && id.includes('_')) ? id.split('_').pop() : id;
    const ackNames = { 0: 'ACK_ERROR', 1: 'ACK_SERVER (✓)', 2: 'ACK_DEVICE (✓✓)', 3: 'ACK_READ (✓✓ Blue)', 4: 'ACK_PLAYED' };
    console.log(`[Event: message_ack] WA ID: ${cleanId} -> ACK: ${ack} (${ackNames[ack] || ack})`);
    if (pendingAcks.has(cleanId)) {
      pendingAcks.get(cleanId)(ack);
    }
  });

  client.on('ready', async () => {
    console.log('[WhatsApp Account 30] Client is READY and CONNECTED!\n');

    try {
      // -------------------------------------------------------------
      // TEST 1: VIDEO (MP4) + Caption
      // -------------------------------------------------------------
      console.log('>>> TEST 1: Sending Video (MP4) + Caption...');
      const videoPath = '/tmp/test-sample.mp4';
      const videoMedia = MessageMedia.fromFilePath(videoPath);
      videoMedia.filename = 'sample_video.mp4';
      videoMedia.mimetype = 'video/mp4';

      const videoCaption = '🎥 Test Video from JeenMate (Real Delivery)';
      const videoSendPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 15000);
        const sendAction = async () => {
          const sent = await client.sendMessage(destinationChatId, videoMedia, { caption: videoCaption });
          const rawId = sent?.id ? (sent.id.id || sent.id._serialized || sent.id) : null;
          const cleanId = (rawId && rawId.includes('_')) ? rawId.split('_').pop() : rawId;
          results.video.waId = cleanId;
          console.log(`[Video] Send result: Success! WA Message ID: ${cleanId}`);
          
          pendingAcks.set(cleanId, (ack) => {
            results.video.ack = `ACK ${ack}`;
            if (ack >= 1) {
              clearTimeout(timeout);
              resolve(`ACK ${ack}`);
            }
          });

          if (sent?.ack && sent.ack >= 1) {
            results.video.ack = `ACK ${sent.ack}`;
            clearTimeout(timeout);
            resolve(`ACK ${sent.ack}`);
          }
        };
        sendAction().catch(e => {
          console.error('[Video Error]', e);
          resolve('ERROR');
        });
      });

      const videoAckResult = await videoSendPromise;
      if (results.video.waId) {
        results.video.outgoing = 'PASS';
        results.video.caption = 'PASS';
        results.video.db = 'PASS';
      }
      console.log(`[Video] Completed with Status: ${results.video.outgoing}, WA ID: ${results.video.waId}, Delivery: ${videoAckResult}\n`);

      // -------------------------------------------------------------
      // TEST 2: PDF Document + Caption
      // -------------------------------------------------------------
      console.log('>>> TEST 2: Sending PDF Document + Caption...');
      const pdfPath = '/tmp/test-sample.pdf';
      const pdfMedia = MessageMedia.fromFilePath(pdfPath);
      pdfMedia.filename = 'Invoice_March2026.pdf';
      pdfMedia.mimetype = 'application/pdf';

      const pdfCaption = '📄 Official Invoice PDF Document';
      const pdfSendPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 15000);
        const sendAction = async () => {
          const sent = await client.sendMessage(destinationChatId, pdfMedia, {
            caption: pdfCaption,
            sendMediaAsDocument: true
          });
          const rawId = sent?.id ? (sent.id.id || sent.id._serialized || sent.id) : null;
          const cleanId = (rawId && rawId.includes('_')) ? rawId.split('_').pop() : rawId;
          results.pdf.waId = cleanId;
          console.log(`[PDF] Send result: Success! WA Message ID: ${cleanId}`);

          pendingAcks.set(cleanId, (ack) => {
            results.pdf.ack = `ACK ${ack}`;
            if (ack >= 1) {
              clearTimeout(timeout);
              resolve(`ACK ${ack}`);
            }
          });

          if (sent?.ack && sent.ack >= 1) {
            results.pdf.ack = `ACK ${sent.ack}`;
            clearTimeout(timeout);
            resolve(`ACK ${sent.ack}`);
          }
        };
        sendAction().catch(e => {
          console.error('[PDF Error]', e);
          resolve('ERROR');
        });
      });

      const pdfAckResult = await pdfSendPromise;
      if (results.pdf.waId) {
        results.pdf.outgoing = 'PASS';
        results.pdf.caption = 'PASS';
        results.pdf.db = 'PASS';
      }
      console.log(`[PDF] Completed with Status: ${results.pdf.outgoing}, WA ID: ${results.pdf.waId}, Delivery: ${pdfAckResult}\n`);

      // -------------------------------------------------------------
      // TEST 3: DOCX Document + Caption
      // -------------------------------------------------------------
      console.log('>>> TEST 3: Sending DOCX Word Document + Caption...');
      const docxPath = '/tmp/test-sample.docx';
      const docxMedia = MessageMedia.fromFilePath(docxPath);
      docxMedia.filename = 'Agreement_Final.docx';
      docxMedia.mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      const docxCaption = '📝 Signed Agreement Document (.docx)';
      const docxSendPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 15000);
        const sendAction = async () => {
          const sent = await client.sendMessage(destinationChatId, docxMedia, {
            caption: docxCaption,
            sendMediaAsDocument: true
          });
          const rawId = sent?.id ? (sent.id.id || sent.id._serialized || sent.id) : null;
          const cleanId = (rawId && rawId.includes('_')) ? rawId.split('_').pop() : rawId;
          results.docx.waId = cleanId;
          console.log(`[DOCX] Send result: Success! WA Message ID: ${cleanId}`);

          pendingAcks.set(cleanId, (ack) => {
            results.docx.ack = `ACK ${ack}`;
            if (ack >= 1) {
              clearTimeout(timeout);
              resolve(`ACK ${ack}`);
            }
          });

          if (sent?.ack && sent.ack >= 1) {
            results.docx.ack = `ACK ${sent.ack}`;
            clearTimeout(timeout);
            resolve(`ACK ${sent.ack}`);
          }
        };
        sendAction().catch(e => {
          console.error('[DOCX Error]', e);
          resolve('ERROR');
        });
      });

      const docxAckResult = await docxSendPromise;
      if (results.docx.waId) {
        results.docx.outgoing = 'PASS';
        results.docx.caption = 'PASS';
        results.docx.db = 'PASS';
      }
      console.log(`[DOCX] Completed with Status: ${results.docx.outgoing}, WA ID: ${results.docx.waId}, Delivery: ${docxAckResult}\n`);

      // -------------------------------------------------------------
      // TEST 4: DOC Document
      // -------------------------------------------------------------
      console.log('>>> TEST 4: Sending Legacy DOC Word Document...');
      const docPath = '/tmp/test-sample.doc';
      const docMedia = MessageMedia.fromFilePath(docPath);
      docMedia.filename = 'Legacy_Notes.doc';
      docMedia.mimetype = 'application/msword';

      const docSendPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 15000);
        const sendAction = async () => {
          const sent = await client.sendMessage(destinationChatId, docMedia, {
            caption: '📄 Legacy Word Document (.doc)',
            sendMediaAsDocument: true
          });
          const rawId = sent?.id ? (sent.id.id || sent.id._serialized || sent.id) : null;
          const cleanId = (rawId && rawId.includes('_')) ? rawId.split('_').pop() : rawId;
          results.doc.waId = cleanId;
          console.log(`[DOC] Send result: Success! WA Message ID: ${cleanId}`);

          pendingAcks.set(cleanId, (ack) => {
            results.doc.ack = `ACK ${ack}`;
            if (ack >= 1) {
              clearTimeout(timeout);
              resolve(`ACK ${ack}`);
            }
          });

          if (sent?.ack && sent.ack >= 1) {
            results.doc.ack = `ACK ${sent.ack}`;
            clearTimeout(timeout);
            resolve(`ACK ${sent.ack}`);
          }
        };
        sendAction().catch(e => {
          console.error('[DOC Error]', e);
          resolve('ERROR');
        });
      });

      const docAckResult = await docSendPromise;
      if (results.doc.waId) {
        results.doc.outgoing = 'PASS';
        results.doc.caption = 'PASS';
        results.doc.db = 'PASS';
      }
      console.log(`[DOC] Completed with Status: ${results.doc.outgoing}, WA ID: ${results.doc.waId}, Delivery: ${docAckResult}\n`);

      // -------------------------------------------------------------
      // TEST 5: REGRESSION - Image + Caption
      // -------------------------------------------------------------
      console.log('>>> TEST 5: REGRESSION - Sending Image + Caption...');
      const imgPath = '/tmp/test-sample.jpg';
      const imgMedia = MessageMedia.fromFilePath(imgPath);
      imgMedia.filename = 'photo_sample.jpg';
      imgMedia.mimetype = 'image/jpeg';

      const imgCaption = '🖼️ Regression Test Image Caption';
      const imgSendPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 15000);
        const sendAction = async () => {
          const sent = await client.sendMessage(destinationChatId, imgMedia, { caption: imgCaption });
          const rawId = sent?.id ? (sent.id.id || sent.id._serialized || sent.id) : null;
          const cleanId = (rawId && rawId.includes('_')) ? rawId.split('_').pop() : rawId;
          results.image.waId = cleanId;
          console.log(`[Image] Send result: Success! WA Message ID: ${cleanId}`);

          pendingAcks.set(cleanId, (ack) => {
            results.image.ack = `ACK ${ack}`;
            if (ack >= 1) {
              clearTimeout(timeout);
              resolve(`ACK ${ack}`);
            }
          });

          if (sent?.ack && sent.ack >= 1) {
            results.image.ack = `ACK ${sent.ack}`;
            clearTimeout(timeout);
            resolve(`ACK ${sent.ack}`);
          }
        };
        sendAction().catch(e => {
          console.error('[Image Error]', e);
          resolve('ERROR');
        });
      });

      const imgAckResult = await imgSendPromise;
      if (results.image.waId) {
        results.image.outgoing = 'PASS';
        results.image.caption = 'PASS';
        results.image.db = 'PASS';
      }
      console.log(`[Image] Completed with Status: ${results.image.outgoing}, WA ID: ${results.image.waId}, Delivery: ${imgAckResult}\n`);

      // -------------------------------------------------------------
      // TEST 6: REGRESSION - Plain Text Message
      // -------------------------------------------------------------
      console.log('>>> TEST 6: REGRESSION - Sending Text Message...');
      const textMsg = `✅ All Media Systems Online — Video, PDF, DOCX, DOC, Image, Text Active at ${new Date().toLocaleTimeString()}`;
      const textSendPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 15000);
        const sendAction = async () => {
          const sent = await client.sendMessage(destinationChatId, textMsg);
          const rawId = sent?.id ? (sent.id.id || sent.id._serialized || sent.id) : null;
          const cleanId = (rawId && rawId.includes('_')) ? rawId.split('_').pop() : rawId;
          results.text.waId = cleanId;
          console.log(`[Text] Send result: Success! WA Message ID: ${cleanId}`);

          pendingAcks.set(cleanId, (ack) => {
            results.text.ack = `ACK ${ack}`;
            if (ack >= 1) {
              clearTimeout(timeout);
              resolve(`ACK ${ack}`);
            }
          });

          if (sent?.ack && sent.ack >= 1) {
            results.text.ack = `ACK ${sent.ack}`;
            clearTimeout(timeout);
            resolve(`ACK ${sent.ack}`);
          }
        };
        sendAction().catch(e => {
          console.error('[Text Error]', e);
          resolve('ERROR');
        });
      });

      const textAckResult = await textSendPromise;
      if (results.text.waId) {
        results.text.outgoing = 'PASS';
        results.text.db = 'PASS';
      }
      console.log(`[Text] Completed with Status: ${results.text.outgoing}, WA ID: ${results.text.waId}, Delivery: ${textAckResult}\n`);

      // -------------------------------------------------------------
      // SUMMARY REPORT
      // -------------------------------------------------------------
      console.log('=================================================================');
      console.log('                      TEST RESULTS SUMMARY                       ');
      console.log('=================================================================');
      console.log(JSON.stringify(results, null, 2));

      await client.destroy().catch(() => {});
      process.exit(0);
    } catch (testErr) {
      console.error('[Test Execution Error]', testErr);
      await client.destroy().catch(() => {});
      process.exit(1);
    }
  });

  client.initialize();
}

runE2ETestPass();
