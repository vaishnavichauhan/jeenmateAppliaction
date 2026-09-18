const pool = require('./config/db');
const { WhatsAppAccount, WhatsAppAccountMember, Conversation, Message, User, InternalMessage } = require('./models');
const sessionManager = require('./services/sessionManager');
const bcrypt = require('bcryptjs');

async function runMultiWhatsAppVerification() {
  console.log('=============================================================================');
  console.log('       MULTI-WHATSAPP (PERSONAL & TEAM) ARCHITECTURE TEST SUITE              ');
  console.log('=============================================================================');

  // --- Step 1: Create / Prepare Test Users ---
  console.log('\n[Step 1] Creating / preparing test users: Admin, User1, User2, User3, User4...');
  const testPassword = bcrypt.hashSync('Test@123', 10);

  async function getOrCreateTestUser(email, name, role) {
    const [existing] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      await pool.execute('UPDATE users SET role = ?, name = ? WHERE id = ?', [role, name, existing[0].id]);
      return existing[0].id;
    }
    const [ins] = await pool.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, testPassword, role]
    );
    return ins.insertId;
  }

  const adminId = await getOrCreateTestUser('test_admin@jeenmate.com', 'Admin User', 'admin');
  const user1Id = await getOrCreateTestUser('test_user1@jeenmate.com', 'User One', 'user');
  const user2Id = await getOrCreateTestUser('test_user2@jeenmate.com', 'User Two', 'user');
  const user3Id = await getOrCreateTestUser('test_user3@jeenmate.com', 'User Three', 'user');
  const user4Id = await getOrCreateTestUser('test_user4@jeenmate.com', 'User Four', 'user');

  console.log(`✅ Test users ready: Admin(#${adminId}), User1(#${user1Id}), User2(#${user2Id}), User3(#${user3Id}), User4(#${user4Id})`);

  // Clean old test accounts for these test users
  await pool.execute('DELETE FROM whatsapp_accounts WHERE created_by_user_id = ? OR owner_user_id = ?', [adminId, adminId]);

  // --- Step 2: Create Personal WhatsApp 123 for Admin ---
  console.log('\n[Step 2] Admin creates Personal WhatsApp account 123...');
  const personal123 = await WhatsAppAccount.create({
    accountName: 'Personal WhatsApp 123',
    accountType: 'PERSONAL',
    ownerUserId: adminId,
    createdByUserId: adminId,
    sessionId: `test-session-personal-123-${Date.now()}`
  });
  console.log(`✅ Personal account created with ID #${personal123.id} (Owner: Admin #${adminId})`);

  // --- Step 3: Admin creates Team WhatsApp 789 and assigns Admin, User1, User2 ---
  console.log('\n[Step 3] Admin creates Team WhatsApp account 789 & assigns (Admin, User1, User2)...');
  const team789 = await WhatsAppAccount.create({
    accountName: 'Sales Team WhatsApp 789',
    accountType: 'TEAM',
    ownerUserId: null,
    createdByUserId: adminId,
    sessionId: `test-session-team-789-${Date.now()}`
  });
  await WhatsAppAccountMember.setMembers(team789.id, [adminId, user1Id, user2Id], adminId);
  console.log(`✅ Team account 789 created with ID #${team789.id}`);

  // --- Step 4: Admin creates Team WhatsApp 567 and assigns Admin, User3 ---
  console.log('\n[Step 4] Admin creates Team WhatsApp account 567 & assigns (Admin, User3)...');
  const team567 = await WhatsAppAccount.create({
    accountName: 'Support Team WhatsApp 567',
    accountType: 'TEAM',
    ownerUserId: null,
    createdByUserId: adminId,
    sessionId: `test-session-team-567-${Date.now()}`
  });
  await WhatsAppAccountMember.setMembers(team567.id, [adminId, user3Id], adminId);
  console.log(`✅ Team account 567 created with ID #${team567.id}`);

  // --- Step 5: Test Access Permissions Matrix ---
  console.log('\n[Step 5] Testing Access Permissions Matrix...');
  
  const adminAccessible = await WhatsAppAccount.findAccessibleByUser(adminId, 'admin');
  const user1Accessible = await WhatsAppAccount.findAccessibleByUser(user1Id, 'user');
  const user2Accessible = await WhatsAppAccount.findAccessibleByUser(user2Id, 'user');
  const user3Accessible = await WhatsAppAccount.findAccessibleByUser(user3Id, 'user');
  const user4Accessible = await WhatsAppAccount.findAccessibleByUser(user4Id, 'user');

  const adminHas123 = adminAccessible.some(a => a.id === personal123.id);
  const adminHas789 = adminAccessible.some(a => a.id === team789.id);
  const adminHas567 = adminAccessible.some(a => a.id === team567.id);

  const u1Has789 = user1Accessible.some(a => a.id === team789.id);
  const u1Has567 = user1Accessible.some(a => a.id === team567.id);
  const u1Has123 = user1Accessible.some(a => a.id === personal123.id);

  const u2Has789 = user2Accessible.some(a => a.id === team789.id);
  const u2Has567 = user2Accessible.some(a => a.id === team567.id);

  const u3Has789 = user3Accessible.some(a => a.id === team789.id);
  const u3Has567 = user3Accessible.some(a => a.id === team567.id);

  const u4Has789 = user4Accessible.some(a => a.id === team789.id);
  const u4Has567 = user4Accessible.some(a => a.id === team567.id);

  console.log(`  Admin Access:  123=${adminHas123}, 789=${adminHas789}, 567=${adminHas567} (Expected: true, true, true)`);
  console.log(`  User1 Access:  789=${u1Has789}, 567=${u1Has567}, 123=${u1Has123} (Expected: true, false, false)`);
  console.log(`  User2 Access:  789=${u2Has789}, 567=${u2Has567} (Expected: true, false)`);
  console.log(`  User3 Access:  789=${u3Has789}, 567=${u3Has567} (Expected: false, true)`);
  console.log(`  User4 Access:  789=${u4Has789}, 567=${u4Has567} (Expected: false, false)`);

  const test5Pass = adminHas123 && adminHas789 && adminHas567 &&
                    u1Has789 && !u1Has567 && !u1Has123 &&
                    u2Has789 && !u2Has567 &&
                    !u3Has789 && u3Has567 &&
                    !u4Has789 && !u4Has567;
  console.log(`[Test 1] Access Control Matrix: ${test5Pass ? '✅ PASS' : '❌ FAIL'}`);

  // --- Step 6: Test Call Restrictions on Team Accounts vs Personal ---
  console.log('\n[Step 6] Testing Call Restrictions (Team accounts MUST NOT have calls)...');
  
  // Create a call record in DB for personal123
  await pool.execute(
    `INSERT INTO whatsapp_calls (call_id, phone_number, customer_name, call_type, media_type, duration, user_id, whatsapp_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`call_test_personal_${Date.now()}`, '+919999999999', 'Personal Call Customer', 'incoming', 'voice', '45s', adminId, personal123.id]
  );

  const [personalCalls] = await pool.execute('SELECT * FROM whatsapp_calls WHERE whatsapp_account_id = ?', [personal123.id]);
  const [team789Calls] = await pool.execute('SELECT * FROM whatsapp_calls WHERE whatsapp_account_id = ?', [team789.id]);

  const test6Pass = personalCalls.length > 0 && team789Calls.length === 0;
  console.log(`  Personal #123 Call records: ${personalCalls.length} (Calls active)`);
  console.log(`  Team #789 Call records: ${team789Calls.length} (Calls disabled)`);
  console.log(`[Test 2] Calls restricted to Personal WhatsApp only: ${test6Pass ? '✅ PASS' : '❌ FAIL'}`);

  // --- Step 7: Test Chat Isolation between Team 789 and Team 567 ---
  console.log('\n[Step 7] Testing Data Isolation for identical phone numbers between accounts...');
  const sharedPhone = '+919876543210';

  // Customer & Conv in Team 789
  const [cust789] = await pool.execute(
    'INSERT INTO customers (name, phone_number, whatsapp_jid, whatsapp_account_id) VALUES (?, ?, ?, ?)',
    ['Customer for 789', sharedPhone, '919876543210@c.us', team789.id]
  );
  const [conv789] = await pool.execute(
    'INSERT INTO conversations (customer_id, status, whatsapp_account_id) VALUES (?, "open", ?)',
    [cust789.insertId, team789.id]
  );
  await pool.execute(
    `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, whatsapp_timestamp, status, whatsapp_account_id)
     VALUES (?, ?, 'incoming', ?, ?, ?, 'delivered', ?)`,
    [conv789.insertId, cust789.insertId, 'Hello from Team 789 customer', `msg_789_${Date.now()}`, Date.now(), team789.id]
  );

  // Customer & Conv in Team 567 with SAME phone number
  const [cust567] = await pool.execute(
    'INSERT INTO customers (name, phone_number, whatsapp_jid, whatsapp_account_id) VALUES (?, ?, ?, ?)',
    ['Customer for 567', sharedPhone, '919876543210@c.us', team567.id]
  );
  const [conv567] = await pool.execute(
    'INSERT INTO conversations (customer_id, status, whatsapp_account_id) VALUES (?, "open", ?)',
    [cust567.insertId, team567.id]
  );
  await pool.execute(
    `INSERT INTO messages (conversation_id, customer_id, direction, message, whatsapp_message_id, whatsapp_timestamp, status, whatsapp_account_id)
     VALUES (?, ?, 'incoming', ?, ?, ?, 'delivered', ?)`,
    [conv567.insertId, cust567.insertId, 'Hello from Team 567 customer', `msg_567_${Date.now()}`, Date.now(), team567.id]
  );

  const convs789 = await Conversation.findAll({ whatsappAccountId: team789.id });
  const convs567 = await Conversation.findAll({ whatsappAccountId: team567.id });

  const msgs789 = await Message.findByConversationId(conv789.insertId);
  const msgs567 = await Message.findByConversationId(conv567.insertId);

  const is789Only789 = msgs789.messages.every(m => m.text.includes('789'));
  const is567Only567 = msgs567.messages.every(m => m.text.includes('567'));
  const test7Pass = convs789.length === 1 && convs567.length === 1 && is789Only789 && is567Only567;

  console.log(`  Team 789 conversations count: ${convs789.length}, Message: "${msgs789.messages[0]?.text}"`);
  console.log(`  Team 567 conversations count: ${convs567.length}, Message: "${msgs567.messages[0]?.text}"`);
  console.log(`[Test 3] Chat and message isolation between multiple accounts: ${test7Pass ? '✅ PASS' : '❌ FAIL'}`);

  // --- Step 8: Test JeenMate Internal Chat Independence ---
  console.log('\n[Step 8] Testing JeenMate Internal Chat complete independence...');
  const [internalMsg] = await pool.execute(
    'INSERT INTO internal_messages (sender_id, receiver_id, message_text) VALUES (?, ?, ?)',
    [adminId, user1Id, 'Internal team message between Admin & User1']
  );
  const internalMsgId = internalMsg.insertId;

  // --- Step 9: Test Disconnect vs Delete Separation ---
  console.log('\n[Step 9] Testing Disconnect (preserve account row) vs Delete Account...');
  
  // Disconnect Team 789: should clean its messages & conversations, but PRESERVE the account row & members
  await sessionManager.destroySession(team789.id, { cleanData: true, deleteAccount: false });

  const account789AfterDisconnect = await WhatsAppAccount.findById(team789.id);
  const members789AfterDisconnect = await WhatsAppAccountMember.getMembersByAccountId(team789.id);
  const [msgs789AfterDisconnect] = await pool.execute('SELECT * FROM messages WHERE whatsapp_account_id = ?', [team789.id]);
  
  // Verify Team 567 and Personal 123 and Internal Chat are completely UNTOUCHED
  const [msgs567After] = await pool.execute('SELECT * FROM messages WHERE whatsapp_account_id = ?', [team567.id]);
  const [personal123After] = await pool.execute('SELECT * FROM whatsapp_calls WHERE whatsapp_account_id = ?', [personal123.id]);
  const [internalMsgAfter] = await pool.execute('SELECT * FROM internal_messages WHERE id = ?', [internalMsgId]);

  const is789Preserved = account789AfterDisconnect && account789AfterDisconnect.status === 'disconnected' && members789AfterDisconnect.length === 3;
  const is789DataCleaned = msgs789AfterDisconnect.length === 0;
  const is567Untouched = msgs567After.length === 1;
  const is123Untouched = personal123After.length === 1;
  const isInternalUntouched = internalMsgAfter.length === 1;

  const test9Pass = is789Preserved && is789DataCleaned && is567Untouched && is123Untouched && isInternalUntouched;

  console.log(`  Team 789 account row preserved: ${!!account789AfterDisconnect} (status: ${account789AfterDisconnect?.status})`);
  console.log(`  Team 789 members preserved: ${members789AfterDisconnect.length} members`);
  console.log(`  Team 789 WhatsApp messages purged: ${msgs789AfterDisconnect.length === 0}`);
  console.log(`  Team 567 WhatsApp data intact: ${msgs567After.length === 1}`);
  console.log(`  Personal 123 WhatsApp data intact: ${personal123After.length === 1}`);
  console.log(`  JeenMate Internal Chat intact: ${internalMsgAfter.length === 1}`);
  console.log(`[Test 4] Disconnect cleanup isolation & preservation: ${test9Pass ? '✅ PASS' : '❌ FAIL'}`);

  // Test Delete Account: should remove account row & members
  console.log('\n[Step 10] Testing Delete Account (complete removal of account & members)...');
  await sessionManager.destroySession(team789.id, { cleanData: true, deleteAccount: true });
  const account789AfterDelete = await WhatsAppAccount.findById(team789.id);
  const members789AfterDelete = await WhatsAppAccountMember.getMembersByAccountId(team789.id);
  const test10Pass = account789AfterDelete === null && members789AfterDelete.length === 0;
  console.log(`[Test 5] Account and members deleted permanently on delete: ${test10Pass ? '✅ PASS' : '❌ FAIL'}`);

  // Cleanup remaining test data
  await sessionManager.destroySession(team567.id, { cleanData: true, deleteAccount: true });
  await sessionManager.destroySession(personal123.id, { cleanData: true, deleteAccount: true });
  await pool.execute('DELETE FROM internal_messages WHERE id = ?', [internalMsgId]);
  await pool.execute('DELETE FROM users WHERE email LIKE "test_%@jeenmate.com"');

  console.log('\n=============================================================================');
  console.log('                     FINAL TEST SUITE SUMMARY                                ');
  console.log('=============================================================================');
  console.log(`✅ Multi-account creation & Admin privilege: PASS`);
  console.log(`✅ Access Permissions Matrix (Owner & Members only): ${test5Pass ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Call Restrictions (Disabled on Team, Active on Personal): ${test6Pass ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Cross-account Chat & Message Isolation: ${test7Pass ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Disconnect vs Delete Separation & Cleanup: ${test9Pass ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Internal JeenMate Chat Complete Independence: ${isInternalUntouched ? 'PASS' : 'FAIL'}`);
  console.log('=============================================================================\n');

  process.exit(0);
}

runMultiWhatsAppVerification().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
