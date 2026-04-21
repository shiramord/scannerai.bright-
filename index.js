// ══════════════════════════════════════════════════════════
//  🤖 AliExpress Scanner Bot
// ══════════════════════════════════════════════════════════

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ─── Config ──────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY;
const DATASET_ID = 'gd_mlj9v75u1w1jvaxvwp';

console.log('─── STARTUP DEBUG ───');
console.log('BOT_TOKEN loaded:', BOT_TOKEN ? 'YES' : 'NO ❌');
console.log('BRIGHTDATA_API_KEY loaded:', BRIGHTDATA_API_KEY ? 'YES' : 'NO ❌');
console.log('─────────────────────');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ══════════════════════════════════════════════════════════
//  📡 API FUNCTIONS
// ══════════════════════════════════════════════════════════

async function scrapeBrightData(inputs) {
  console.log('>>> Calling /scrape with:', JSON.stringify(inputs));
  try {
    const response = await axios.post(
      'https://api.brightdata.com/datasets/v3/scrape',
      inputs,
      {
        params: { dataset_id: DATASET_ID, format: 'json' },
        headers: {
          'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      }
    );

    console.log('>>> Response status:', response.status);

    // ✅ FIX: Handle 202 (async redirect) in SUCCESS path
    if (response.status === 202) {
      const sid = response.data.snapshot_id;
      console.log('>>> Got 202 — switching to async. Snapshot:', sid);
      const data = await pollAndDownload(sid);
      return { success: !!data && data.length > 0, data };
    }

    // Normal 200 response
    console.log('>>> Got 200 — data items:', Array.isArray(response.data) ? response.data.length : 'not array');
    return { success: true, data: response.data };

  } catch (err) {
    // Also handle 202 in error path (some axios versions)
    if (err.response?.status === 202) {
      const sid = err.response.data.snapshot_id;
      console.log('>>> Got 202 in catch — switching to async. Snapshot:', sid);
      const data = await pollAndDownload(sid);
      return { success: !!data && data.length > 0, data };
    }
    console.error('=== SCRAPE ERROR ===');
    console.error('Status:', err.response?.status);
    console.error('Data:', JSON.stringify(err.response?.data));
    console.error('Message:', err.message);
    console.error('====================');
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

async function triggerBatch(inputs) {
  console.log('>>> Calling /trigger with', inputs.length, 'URLs');
  try {
    const response = await axios.post(
      'https://api.brightdata.com/datasets/v3/trigger',
      inputs,
      {
        params: { dataset_id: DATASET_ID, format: 'json' },
        headers: {
          'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const sid = response.data.snapshot_id;
    console.log('>>> Batch triggered, snapshot:', sid);
    const data = await pollAndDownload(sid);
    return { success: !!data && data.length > 0, data };
  } catch (err) {
    console.error('=== BATCH ERROR ===');
    console.error('Status:', err.response?.status);
    console.error('Data:', JSON.stringify(err.response?.data));
    console.error('====================');
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

async function pollAndDownload(snapshotId) {
  console.log('>>> Starting polling for snapshot:', snapshotId);
  let status = 'collecting';
  let attempts = 0;

  while (status !== 'ready' && status !== 'failed' && attempts < 30) {
    await new Promise((r) => setTimeout(r, 10000));
    attempts++;
    try {
      const res = await axios.get(
        `https://api.brightdata.com/datasets/v3/progress/${snapshotId}`,
        { headers: { 'Authorization': `Bearer ${BRIGHTDATA_API_KEY}` } }
      );
      status = res.data.status;
      console.log(`  Poll #${attempts}: ${status}`);
    } catch (err) {
      console.error(`  Poll #${attempts} error:`, err.message);
    }
  }

  if (status !== 'ready') {
    console.error('>>> Job failed. Final status:', status);
    return null;
  }

  console.log('>>> Job ready! Downloading results...');
  const results = await axios.get(
    `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`,
    {
      params: { format: 'json' },
      headers: { 'Authorization': `Bearer ${BRIGHTDATA_API_KEY}` },
    }
  );
  console.log('>>> Downloaded:', results.data?.length, 'items');
  return results.data;
}

// ══════════════════════════════════════════════════════════
//  🎨 FORMAT PRODUCT
// ══════════════════════════════════════════════════════════

function formatProduct(p, index) {
  const name = p.title || 'מוצר ללא שם';
  const finalPrice = p.final_price ? `$${p.final_price}` : null;
  const initPrice = p.initial_price ? `$${p.initial_price}` : null;
  const price = finalPrice || initPrice || 'לא זמין';
  const discount =
    initPrice && finalPrice && initPrice !== finalPrice
      ? `  ~~${initPrice}~~`
      : '';
  const rating = p.rating ? `${p.rating}⭐` : 'אין דירוג';
  const reviews = p.reviews_count
    ? `(${Number(p.reviews_count).toLocaleString()} ביקורות)`
    : '';
  const brand = p.brand ? `🏷️ מותג: ${p.brand}\n` : '';
  const category = p.product_category
    ? `📂 קטגוריה: ${p.product_category}\n`
    : '';
  const desc = p.description
    ? `📝 ${p.description.substring(0, 150)}...\n`
    : '';
  const url = p.url || '#';

  return (
    `${index}️⃣ *${name}*\n` +
    `💰 מחיר: ${price}${discount}\n` +
    `⭐ דירוג: ${rating} ${reviews}\n` +
    brand +
    category +
    desc +
    `🔗 [צפה במוצר](${url})\n`
  );
}

// ══════════════════════════════════════════════════════════
//  🤖 TELEGRAM BOT COMMANDS
// ══════════════════════════════════════════════════════════

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🛒 *ברוכים הבאים ל-AliExpress Scanner!*\n\n` +
      `📋 *פקודות:*\n\n` +
      `1️⃣ *סריקת מוצר לפי לינק:*\n` +
      `/scan <לינק מוצר>\n\n` +
      `2️⃣ *סריקת כמה מוצרים:*\n` +
      `/batch <לינק1> <לינק2> ...\n\n` +
      `3️⃣ *חיפוש לפי מילת מפתח:*\n` +
      `כתבי "חפש" ואחריו מה שתרצי\n\n` +
      `💡 *דוגמאות:*\n` +
      `\`/scan https://www.aliexpress.com/item/1005005307607563.html\`\n` +
      `\`חפש אוזניות בלוטוס\``,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/scan (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1].trim();

  console.log('>>> /scan URL:', url);

  if (!url.includes('aliexpress.com')) {
    return bot.sendMessage(chatId, '❌ נא לשלוח לינק מ-AliExpress');
  }

  await bot.sendMessage(chatId, '⏳ *סורק את המוצר... זה יכול לקחת עד דקה*', {
    parse_mode: 'Markdown',
  });

  const result = await scrapeBrightData([{ url }]);

  console.log('>>> /scan done. Success:', result.success, '| Items:', result.data?.length);

  if (result.success && result.data?.length > 0) {
    bot.sendMessage(
      chatId,
      `✅ *תוצאת סריקה:*\n\n` + formatProduct(result.data[0], 1),
      { parse_mode: 'Markdown', disable_web_page_preview: false }
    );
  } else {
    bot.sendMessage(
      chatId,
      `😕 לא הצלחתי לסרוק.\n🔎 שגיאה: ${result.error || 'לא נמצאו תוצאות'}`
    );
  }
});

bot.onText(/\/batch (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const urls = match[1]
    .trim()
    .split(/\s+/)
    .filter((u) => u.includes('aliexpress.com'));

  console.log('>>> /batch URLs:', urls.length);

  if (urls.length === 0) {
    return bot.sendMessage(chatId, '❌ לא נמצאו לינקים תקינים מ-AliExpress');
  }

  await bot.sendMessage(
    chatId,
    `📦 *סורק ${urls.length} מוצרים...*\n⏳ _זה יכול לקחת עד דקה_`,
    { parse_mode: 'Markdown' }
  );

  const inputs = urls.map((url) => ({ url }));
  const result =
    urls.length <= 20
      ? await scrapeBrightData(inputs)
      : await triggerBatch(inputs);

  if (result.success && result.data?.length > 0) {
    const header = `✅ *נמצאו ${result.data.length} מוצרים:*\n\n`;
    const body = result.data
      .slice(0, 5)
      .map((p, i) => formatProduct(p, i + 1))
      .join('\n─────────────────\n\n');

    bot.sendMessage(chatId, header + body, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });

    if (result.data.length > 5) {
      bot.sendMessage(
        chatId,
        `📊 _סה"כ ${result.data.length} תוצאות. הוצגו 5 הראשונות._`,
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    bot.sendMessage(
      chatId,
      `😕 לא הצלחתי לסרוק.\n🔎 שגיאה: ${result.error || 'לא נמצאו תוצאות'}`
    );
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const triggers = ['מחפש', 'חפש', 'חיפוש', 'מצא', 'רוצה'];
  const hasTrigger = triggers.some((t) => text.includes(t));

  if (!hasTrigger) return;

  const keyword = triggers
    .reduce((txt, trigger) => txt.replace(new RegExp(trigger, 'g'), ''), text)
    .trim();

  if (!keyword) {
    return bot.sendMessage(
      chatId,
      '❓ מה לחפש? לדוגמה: *חפש אוזניות סמסונג*',
      { parse_mode: 'Markdown' }
    );
  }

  console.log('>>> Search keyword:', keyword);

  await bot.sendMessage(chatId, `🔍 *מחפש "${keyword}"... זה יכול לקחת עד דקה*`, {
    parse_mode: 'Markdown',
  });

  const searchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword)}`;
  console.log('>>> Search URL:', searchUrl);

  const result = await scrapeBrightData([{ url: searchUrl }]);

  console.log('>>> Search done. Success:', result.success, '| Items:', result.data?.length);

  if (result.success && result.data?.length > 0) {
    const header = `🛍️ *מצאתי ${result.data.length} תוצאות עבור "${keyword}":*\n\n`;
    const body = result.data
      .slice(0, 4)
      .map((p, i) => formatProduct(p, i + 1))
      .join('\n─────────────────\n\n');

    bot.sendMessage(chatId, header + body, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });
  } else {
    bot.sendMessage(chatId, '😕 לא מצאתי תוצאות. נסי מילות חיפוש אחרות.');
  }
});

// ══════════════════════════════════════════════════════════
console.log('🤖 AliExpress Scanner Bot is running!');
console.log('⏳ Waiting for messages...');
// ══════════════════════════════════════════════════════════
