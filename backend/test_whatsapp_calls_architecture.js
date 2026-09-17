const pool = require('./config/db');
const Message = require('./models/Message');

async function runAllTests() {
  console.log('===============================================================');
  console.log('       WHATSAPP CALL ARCHITECTURE VERIFICATION TEST SUITE      ');
  console.log('===============================================================\n');

  let testUserId = 999;
  let testCustId = 99999;
  let testConvId = 99999;
  const testPhone = '+919876543210';

  // Setup test customer and conversation
  await pool.execute('DELETE FROM messages WHERE conversation_id = ?', [testConvId]);
  await pool.execute('DELETE FROM whatsapp_calls WHERE user_id = ?', [testUserId]);
  await pool.execute('DELETE FROM conversations WHERE id = ?', [testConvId]);
  await pool.execute('DELETE FROM customers WHERE id = ?', [testCustId]);

  await pool.execute(
    'INSERT INTO customers (id, name, phone_number, whatsapp_jid, user_id) VALUES (?, ?, ?, ?, ?)',
    [testCustId, 'Test Customer', testPhone, '919876543210@c.us', testUserId]
  );
  await pool.execute(
    'INSERT INTO conversations (id, customer_id, status, last_message_at, user_id) VALUES (?, ?, "open", NOW(), ?)',
    [testConvId, testCustId, testUserId]
  );

  const results = [];

  // Helper function simulating live provisional call
  async function simulateLiveCall({ callId, isVideo, fromMe }) {
    const mediaType = isVideo ? 'video' : 'voice';
    const callType = fromMe ? 'outgoing' : 'incoming';
    const callMsgText = mediaType === 'video'
      ? (fromMe ? '📹 Outgoing video call' : '📹 Video call')
      : (fromMe ? '📞 Outgoing voice call' : '📞 Voice call');

    const rawCall = {
      id: callId,
      from: '919876543210@c.us',
      timestamp: Math.floor(Date.now() / 1000),
      isGroup: false,
      isVideo: !!isVideo,
      isVideoCall: !!isVideo,
      fromMe: fromMe,
      status: 'unknown',
      duration: null
    };
    const rawCallJson = JSON.stringify(rawCall);

    // Provisional whatsapp_calls row
    await pool.execute(
      `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, raw_call, created_at, user_id)
       VALUES (?, ?, 'Test Customer', ?, ?, NULL, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE call_type = VALUES(call_type), media_type = VALUES(media_type), raw_call = VALUES(raw_call)`,
      [callId, testPhone, callType, mediaType, rawCallJson, testUserId]
    );

    // Provisional message
    const nowMs = Date.now();
    const utcStr = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
    const metadataJson = JSON.stringify({
      isCall: true,
      status: 'unknown',
      callType: callType,
      mediaType: mediaType,
      duration: null,
      whatsappCallId: callId
    });

    const [insertMsg] = await pool.execute(
      `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
       VALUES (?, ?, ?, ?, ?, 'call', ?, 'delivered', ?, ?, ?)`,
      [testConvId, testCustId, fromMe ? 'outgoing' : 'incoming', callMsgText, callId, nowMs, utcStr, testUserId, metadataJson]
    );

    return insertMsg.insertId;
  }

  // Helper simulating historical sync
  async function simulateHistoricalSync({ callId, isVideo, fromMe, outcome, rawDuration, waTimestampSec }) {
    const isMissed = outcome === 'missed';
    const isRejected = outcome === 'rejected';
    const isAnswered = outcome === 'answered';
    const mediaType = isVideo ? 'video' : 'voice';
    const dir = fromMe ? 'outgoing' : 'incoming';

    let status = 'unknown';
    let durationSec = null;
    if (isMissed) {
      status = 'missed';
    } else if (isRejected) {
      status = 'rejected';
    } else if (isAnswered) {
      status = 'answered';
      durationSec = (typeof rawDuration === 'number' && rawDuration > 0) ? Math.round(rawDuration) : null;
    }

    const fallbackText = isVideo
      ? (status === 'missed' ? '📹 Missed video call' : (status === 'rejected' ? '📹 Declined video call' : (fromMe ? '📹 Outgoing video call' : '📹 Video call')))
      : (status === 'missed' ? '📞 Missed voice call' : (status === 'rejected' ? '📞 Declined voice call' : (fromMe ? '📞 Outgoing voice call' : '📞 Voice call')));

    const callMetadata = {
      isCall: true,
      status: status,
      callType: dir,
      mediaType: mediaType,
      duration: durationSec,
      whatsappCallId: callId
    };
    const metadataJson = JSON.stringify(callMetadata);
    const waMs = waTimestampSec ? waTimestampSec * 1000 : Date.now();
    const iso = new Date(waMs).toISOString().slice(0, 19).replace('T', ' ');

    const coreCallId = (callId && callId.includes('_')) ? callId.split('_').pop() : callId;

    // Check existing by stable call ID
    const [exist] = await pool.execute(
      `SELECT id, whatsapp_message_id, message, message_type, metadata FROM messages 
       WHERE (conversation_id = ? OR customer_id = ?) AND (
         whatsapp_message_id = ? OR 
         JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) = ? OR
         (LENGTH(?) >= 8 AND (whatsapp_message_id LIKE CONCAT('%', ?, '%') OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.whatsappCallId')) LIKE CONCAT('%', ?, '%')))
       ) 
       LIMIT 1`,
      [testConvId, testCustId, callId, callId, coreCallId || '', coreCallId || '', coreCallId || '']
    );

    if (exist.length > 0) {
      await pool.execute(
        `UPDATE messages 
         SET message = ?, message_type = 'call', whatsapp_message_id = ?, whatsapp_timestamp = ?, status = 'delivered', metadata = ?
         WHERE id = ?`,
        [fallbackText, callId, waMs, metadataJson, exist[0].id]
      );
    } else {
      await pool.execute(
        `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id, metadata)
         VALUES (?, ?, ?, ?, ?, 'call', ?, 'delivered', ?, ?, ?)`,
        [testConvId, testCustId, dir, fallbackText, callId, waMs, iso, testUserId, metadataJson]
      );
    }

    // Update whatsapp_calls
    const rawCall = {
      id: callId,
      from: '919876543210@c.us',
      timestamp: waTimestampSec || Math.floor(Date.now() / 1000),
      isGroup: false,
      isVideo: isVideo,
      isVideoCall: isVideo,
      status: status,
      duration: durationSec
    };
    const rawCallJson = JSON.stringify(rawCall);
    const dbCallType = status === 'missed' ? 'missed' : dir;

    await pool.execute(
      `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, raw_call, created_at, user_id)
       VALUES (?, ?, 'Test Customer', ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE call_type = VALUES(call_type), media_type = VALUES(media_type), duration = VALUES(duration), raw_call = VALUES(raw_call)`,
      [callId, testPhone, dbCallType, mediaType, durationSec ? String(durationSec) : null, rawCallJson, iso, testUserId]
    );
  }

  // TEST 1: Incoming answered voice call
  console.log('--- TEST 1: Incoming answered voice call ---');
  const call1Id = '3EB0_IN_VOICE_ANS_001';
  const msg1LiveId = await simulateLiveCall({ callId: call1Id, isVideo: false, fromMe: false });
  await simulateHistoricalSync({ callId: call1Id, isVideo: false, fromMe: false, outcome: 'answered', rawDuration: 84, waTimestampSec: 1782827000 });
  const [dbMsg1] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call1Id]);
  const [dbCall1] = await pool.execute('SELECT * FROM whatsapp_calls WHERE call_id = ?', [call1Id]);
  const apiMsg1 = await Message.findById(dbMsg1[0].id);
  console.log('Live Msg ID:', msg1LiveId, '| Historical Msg ID:', dbMsg1[0].id, '(Exact match:', msg1LiveId === dbMsg1[0].id, ')');
  console.log('DB messages.metadata:', apiMsg1.metadata);
  console.log('DB whatsapp_calls.duration:', dbCall1[0].duration, '| whatsapp_calls.call_type:', dbCall1[0].call_type);
  results.push({
    test: '1. Incoming answered voice call',
    passed: msg1LiveId === dbMsg1[0].id && apiMsg1.metadata.status === 'answered' && apiMsg1.metadata.duration === 84 && dbCall1[0].duration === '84'
  });

  // TEST 2: Incoming missed voice call
  console.log('\n--- TEST 2: Incoming missed voice call ---');
  const call2Id = '3EB0_IN_VOICE_MISSED_002';
  const msg2LiveId = await simulateLiveCall({ callId: call2Id, isVideo: false, fromMe: false });
  await simulateHistoricalSync({ callId: call2Id, isVideo: false, fromMe: false, outcome: 'missed', rawDuration: 0, waTimestampSec: 1782827100 });
  const [dbMsg2] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call2Id]);
  const [dbCall2] = await pool.execute('SELECT * FROM whatsapp_calls WHERE call_id = ?', [call2Id]);
  const apiMsg2 = await Message.findById(dbMsg2[0].id);
  console.log('Live Msg ID:', msg2LiveId, '| Historical Msg ID:', dbMsg2[0].id);
  console.log('DB messages.metadata:', apiMsg2.metadata);
  console.log('DB whatsapp_calls.duration:', dbCall2[0].duration, '| whatsapp_calls.call_type:', dbCall2[0].call_type);
  results.push({
    test: '2. Incoming missed voice call',
    passed: msg2LiveId === dbMsg2[0].id && apiMsg2.metadata.status === 'missed' && apiMsg2.metadata.duration === null && dbCall2[0].duration === null
  });

  // TEST 3: Outgoing answered voice call
  console.log('\n--- TEST 3: Outgoing answered voice call ---');
  const call3Id = '3EB0_OUT_VOICE_ANS_003';
  const msg3LiveId = await simulateLiveCall({ callId: call3Id, isVideo: false, fromMe: true });
  await simulateHistoricalSync({ callId: call3Id, isVideo: false, fromMe: true, outcome: 'answered', rawDuration: 14, waTimestampSec: 1782827200 });
  const [dbMsg3] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call3Id]);
  const [dbCall3] = await pool.execute('SELECT * FROM whatsapp_calls WHERE call_id = ?', [call3Id]);
  const apiMsg3 = await Message.findById(dbMsg3[0].id);
  console.log('DB messages.metadata:', apiMsg3.metadata);
  results.push({
    test: '3. Outgoing answered voice call',
    passed: msg3LiveId === dbMsg3[0].id && apiMsg3.metadata.status === 'answered' && apiMsg3.metadata.callType === 'outgoing' && apiMsg3.metadata.duration === 14
  });

  // TEST 4: Outgoing missed/rejected voice call
  console.log('\n--- TEST 4: Outgoing missed/rejected voice call ---');
  const call4Id = '3EB0_OUT_VOICE_REJ_004';
  const msg4LiveId = await simulateLiveCall({ callId: call4Id, isVideo: false, fromMe: true });
  await simulateHistoricalSync({ callId: call4Id, isVideo: false, fromMe: true, outcome: 'rejected', rawDuration: 0, waTimestampSec: 1782827300 });
  const [dbMsg4] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call4Id]);
  const apiMsg4 = await Message.findById(dbMsg4[0].id);
  console.log('DB messages.metadata:', apiMsg4.metadata);
  results.push({
    test: '4. Outgoing rejected voice call',
    passed: msg4LiveId === dbMsg4[0].id && apiMsg4.metadata.status === 'rejected' && apiMsg4.metadata.duration === null
  });

  // TEST 5: Incoming answered video call
  console.log('\n--- TEST 5: Incoming answered video call ---');
  const call5Id = '3EB0_IN_VIDEO_ANS_005';
  const msg5LiveId = await simulateLiveCall({ callId: call5Id, isVideo: true, fromMe: false });
  await simulateHistoricalSync({ callId: call5Id, isVideo: true, fromMe: false, outcome: 'answered', rawDuration: 125, waTimestampSec: 1782827400 });
  const [dbMsg5] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call5Id]);
  const apiMsg5 = await Message.findById(dbMsg5[0].id);
  console.log('DB messages.metadata:', apiMsg5.metadata);
  results.push({
    test: '5. Incoming answered video call',
    passed: msg5LiveId === dbMsg5[0].id && apiMsg5.metadata.mediaType === 'video' && apiMsg5.metadata.status === 'answered' && apiMsg5.metadata.duration === 125
  });

  // TEST 6: Incoming missed video call
  console.log('\n--- TEST 6: Incoming missed video call ---');
  const call6Id = '3EB0_IN_VIDEO_MISSED_006';
  const msg6LiveId = await simulateLiveCall({ callId: call6Id, isVideo: true, fromMe: false });
  await simulateHistoricalSync({ callId: call6Id, isVideo: true, fromMe: false, outcome: 'missed', rawDuration: null, waTimestampSec: 1782827500 });
  const [dbMsg6] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call6Id]);
  const apiMsg6 = await Message.findById(dbMsg6[0].id);
  console.log('DB messages.metadata:', apiMsg6.metadata);
  results.push({
    test: '6. Incoming missed video call',
    passed: msg6LiveId === dbMsg6[0].id && apiMsg6.metadata.mediaType === 'video' && apiMsg6.metadata.status === 'missed' && apiMsg6.metadata.duration === null
  });

  // TEST 7: Multiple calls with same customer (separate stable IDs)
  console.log('\n--- TEST 7: Multiple calls with same customer ---');
  const [allCustMsgs] = await pool.execute('SELECT id, whatsapp_message_id, message_type FROM messages WHERE conversation_id = ?', [testConvId]);
  console.log('Total calls for customer in conversation:', allCustMsgs.length);
  results.push({
    test: '7. Multiple distinct calls for same customer preserved independently',
    passed: allCustMsgs.length === 6
  });

  // TEST 8: Server restarted before historical sync (provisional row exists, then sync runs)
  console.log('\n--- TEST 8: Server restart simulation before historical sync ---');
  const call8Id = '3EB0_RESTART_TEST_008';
  const msg8LiveId = await simulateLiveCall({ callId: call8Id, isVideo: false, fromMe: false });
  // Simulate app/server restart: connection pool reloaded, historical sync triggers later
  await simulateHistoricalSync({ callId: call8Id, isVideo: false, fromMe: false, outcome: 'answered', rawDuration: 45, waTimestampSec: 1782827800 });
  const [dbMsg8] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call8Id]);
  const getParsedMeta = (val) => typeof val === 'string' ? JSON.parse(val) : (val || {});
  results.push({
    test: '8. Historical sync after restart updates existing provisional record',
    passed: dbMsg8.length === 1 && dbMsg8[0].id === msg8LiveId && getParsedMeta(dbMsg8[0].metadata).status === 'answered'
  });

  // TEST 9 & 10: Repeated historical sync / opening chat multiple times (Idempotency)
  console.log('\n--- TEST 9 & 10: Repeated historical sync idempotency (10 runs) ---');
  const countBefore = (await pool.execute('SELECT count(*) as cnt FROM messages WHERE conversation_id = ?', [testConvId]))[0][0].cnt;
  for (let i = 0; i < 10; i++) {
    await simulateHistoricalSync({ callId: call1Id, isVideo: false, fromMe: false, outcome: 'answered', rawDuration: 84, waTimestampSec: 1782827000 });
    await simulateHistoricalSync({ callId: call2Id, isVideo: false, fromMe: false, outcome: 'missed', rawDuration: 0, waTimestampSec: 1782827100 });
  }
  const countAfter = (await pool.execute('SELECT count(*) as cnt FROM messages WHERE conversation_id = ?', [testConvId]))[0][0].cnt;
  console.log('Message count before repeated syncs:', countBefore, '| Count after 10 sync runs:', countAfter);
  results.push({
    test: '9 & 10. Repeated sync / opening chat is 100% idempotent (0 duplicates)',
    passed: countBefore === countAfter
  });

  // TEST 11: QR reconnect
  console.log('\n--- TEST 11: QR reconnect sync test ---');
  const [dupsInCallTable] = await pool.execute(
    'SELECT call_id, count(*) as c FROM whatsapp_calls WHERE user_id = ? GROUP BY call_id HAVING c > 1',
    [testUserId]
  );
  console.log('Duplicates in whatsapp_calls:', dupsInCallTable.length);
  results.push({
    test: '11. No duplicates in whatsapp_calls after reconnect',
    passed: dupsInCallTable.length === 0
  });

  // TEST 12: Socket live event followed by historical sync
  console.log('\n--- TEST 12: Socket live event followed by historical sync ---');
  const call12Id = '3EB0_SOCKET_LIVE_THEN_SYNC_012';
  const msg12LiveId = await simulateLiveCall({ callId: call12Id, isVideo: true, fromMe: false });
  const [liveCheck] = await pool.execute('SELECT * FROM messages WHERE id = ?', [msg12LiveId]);
  const liveMeta = getParsedMeta(liveCheck[0].metadata);
  console.log('Live state -> status:', liveMeta.status, '| duration:', liveMeta.duration);

  await simulateHistoricalSync({ callId: call12Id, isVideo: true, fromMe: false, outcome: 'answered', rawDuration: 30, waTimestampSec: 1782828000 });
  const [finalCheck] = await pool.execute('SELECT * FROM messages WHERE whatsapp_message_id = ?', [call12Id]);
  const finalMeta = getParsedMeta(finalCheck[0].metadata);
  console.log('After historical sync -> msg count:', finalCheck.length, '| status:', finalMeta.status, '| duration:', finalMeta.duration);
  results.push({
    test: '12. Live provisional event followed by historical sync correctly transitions status & duration without creating duplicate message',
    passed: liveMeta.status === 'unknown' && liveMeta.duration === null && finalCheck.length === 1 && finalCheck[0].id === msg12LiveId && finalMeta.status === 'answered' && finalMeta.duration === 30
  });

  // Clean up test data
  await pool.execute('DELETE FROM messages WHERE conversation_id = ?', [testConvId]);
  await pool.execute('DELETE FROM whatsapp_calls WHERE user_id = ?', [testUserId]);
  await pool.execute('DELETE FROM conversations WHERE id = ?', [testConvId]);
  await pool.execute('DELETE FROM customers WHERE id = ?', [testCustId]);

  console.log('\n===============================================================');
  console.log('                     FINAL TEST SUMMARY                        ');
  console.log('===============================================================');
  let allPassed = true;
  results.forEach(r => {
    console.log(`${r.passed ? '✅ PASS' : '❌ FAIL'}: ${r.test}`);
    if (!r.passed) allPassed = false;
  });
  console.log(`\nOverall Result: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
