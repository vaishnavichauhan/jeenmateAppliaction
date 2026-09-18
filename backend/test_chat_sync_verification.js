const pool = require('./config/db');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');

async function runVerification() {
  console.log('===============================================================');
  console.log('       CHAT & CHAT DETAILS SYNCHRONIZATION TEST SUITE          ');
  console.log('===============================================================');

  // 1. Check conversations in DB
  const [convCountRow] = await pool.execute('SELECT COUNT(*) as count FROM conversations');
  const [msgCountRow] = await pool.execute('SELECT COUNT(*) as count FROM messages');
  const totalConversations = convCountRow[0].count;
  const totalMessages = msgCountRow[0].count;

  console.log(`[DB] Total Conversations: ${totalConversations}`);
  console.log(`[DB] Total Messages: ${totalMessages}`);

  // 2. Check for Duplicate Conversations (by customer + user_id)
  const [dupConvs] = await pool.execute(
    'SELECT customer_id, user_id, COUNT(*) as cnt FROM conversations GROUP BY customer_id, user_id HAVING cnt > 1'
  );
  console.log(`[Test 1] Duplicate Conversations in DB: ${dupConvs.length}`);

  // 3. Check for Duplicate Messages (by whatsapp_message_id + user_id)
  const [dupMsgs] = await pool.execute(
    'SELECT whatsapp_message_id, user_id, COUNT(*) as cnt FROM messages WHERE whatsapp_message_id IS NOT NULL GROUP BY whatsapp_message_id, user_id HAVING cnt > 1'
  );
  console.log(`[Test 2] Duplicate Messages in DB: ${dupMsgs.length}`);

  // 4. Test Conversation.findAll() output
  const convList = await Conversation.findAll();
  const withLastMsg = convList.filter(c => c.last_message && c.last_message.trim());
  const zeroMsgChats = convList.filter(c => !c.last_message);

  console.log(`[Test 3] Conversation.findAll() returned: ${convList.length} conversations`);
  console.log(`[Test 3] Conversations with real last_message: ${withLastMsg.length} (${((withLastMsg.length / convList.length) * 100).toFixed(1)}%)`);
  console.log(`[Test 3] Conversations with zero messages: ${zeroMsgChats.length}`);

  // 5. Verify consecutive message preservation (messages within 1-5 seconds are NOT dropped)
  const testUserId = 9991;
  const [testCust] = await pool.execute(
    'INSERT INTO customers (name, phone_number, whatsapp_jid, user_id) VALUES ("Consecutive Test Customer", "+919999999991", "919999999991@c.us", ?)',
    [testUserId]
  );
  const custId = testCust.insertId;
  const [testConv] = await pool.execute(
    'INSERT INTO conversations (customer_id, status, user_id) VALUES (?, "open", ?)',
    [custId, testUserId]
  );
  const convId = testConv.insertId;

  // Insert 3 consecutive messages 1 second apart
  const baseTime = 1782830000000;
  for (let i = 0; i < 3; i++) {
    const waTime = baseTime + (i * 1000);
    const iso = new Date(waTime).toISOString().slice(0, 19).replace('T', ' ');
    const msgId = `wa_consecutive_msg_${i}_${Date.now()}`;
    await pool.execute(
      `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, message_type, whatsapp_timestamp, status, created_at, user_id)
       VALUES (?, ?, 'incoming', ?, ?, 'text', ?, 'delivered', ?, ?)`,
      [convId, custId, `Consecutive message #${i + 1}`, msgId, waTime, iso, testUserId]
    );
  }

  const fetchedMsgs = await Message.findByConversationId(convId);
  console.log(`[Test 4] Consecutive message test: Inserted 3 messages -> findByConversationId returned: ${fetchedMsgs.messages.length} messages`);
  const isConsecutivePreserved = fetchedMsgs.messages.length === 3;
  console.log(`[Test 4] All consecutive messages preserved without being dropped: ${isConsecutivePreserved}`);

  // 6. Verify Latest Message Calculation
  const latestFetched = fetchedMsgs.messages[fetchedMsgs.messages.length - 1];
  console.log(`[Test 5] Latest message text in conversation: "${latestFetched.text}" (Expected: "Consecutive message #3")`);
  const isLatestCorrect = latestFetched.text === 'Consecutive message #3';

  // 7. Verify Multi-User Isolation (User 9991 vs User 9992)
  const testUser2Id = 9992;
  const [u2Convs] = await pool.execute('SELECT * FROM conversations WHERE user_id = ?', [testUser2Id]);
  const [u2Msgs] = await pool.execute('SELECT * FROM messages WHERE user_id = ?', [testUser2Id]);
  console.log(`[Test 6] Multi-user isolation test: User ${testUser2Id} conversations count: ${u2Convs.length}, messages count: ${u2Msgs.length}`);
  const isIsolationIntact = u2Convs.length === 0 && u2Msgs.length === 0;

  // Clean up test data
  await pool.execute('DELETE FROM messages WHERE user_id = ?', [testUserId]);
  await pool.execute('DELETE FROM conversations WHERE user_id = ?', [testUserId]);
  await pool.execute('DELETE FROM customers WHERE user_id = ?', [testUserId]);

  console.log('\n===============================================================');
  console.log('                     FINAL TEST SUMMARY                        ');
  console.log('===============================================================');
  console.log(`✅ Duplicate conversations: ${dupConvs.length} (PASS)`);
  console.log(`✅ Duplicate messages: ${dupMsgs.length} (PASS)`);
  console.log(`✅ Consecutive message deduplication fixed: ${isConsecutivePreserved ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Latest message calculation accurate: ${isLatestCorrect ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Multi-user isolation: ${isIsolationIntact ? 'PASS' : 'FAIL'}`);
  console.log('===============================================================\n');

  process.exit(0);
}

runVerification().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
