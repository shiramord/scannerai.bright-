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

// ── Discovery scrape (category/search URLs) ──────────────
async function scrapeDiscovery(inputs, limitPerInput = 10) {
  console.log('>>> Calling /trigger (discovery) with:', JSON.stringify(inputs));
  try {
    const response = await axios.post(
      'https://api.brightdata.com/datasets/v3/trigger',
      inputs,
      {
        params: {
          dataset_id: DATASET_ID,
          format: 'json',
          type: 'discover_new',
          discover_by: 'category_url',
          limit_per_input: limitPerInput,
        },
        headers: {
          'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const sid = response.data.snapshot_id;
    console.log('>>> Discovery triggered, snapshot:', sid);
    const data = await pollAndDownload(sid);
    return { success: !!data && data.length > 0, data };
  } catch (err) {
    console.error('=== DISCOVERY ERROR ===');
    console.error('Status:', err.response?.status);
    console.error('Data:', JSON.stringify(err.response?.data));
    console.error('Message:', err.message);
    console.error('=======================');
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// ── Direct scrape (product URLs — async) ─────────────────
async function scrapeProduct(inputs) {
  console.log('>>> Calling /trigger (product) with:', JSON.stringify(inputs));
  try {
    const response = await axios.post(
      'https://api.brightdata.com/datasets/v3/trigger',
      inputs,
      {
        params: {
          dataset_id: DATASET_ID,
          format: 'json',
        },
        headers: {
          'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const sid = response.data.snapshot_id;
    console.log('>>> Product scrape triggered, snapshot:', sid);
    const data = await pollAndDownload(sid);
    return { success: !!data && data.length > 0, data };
  } catch (err) {
    console.error('=== PRODUCT SCRAPE ERROR ===');
    console.error('Status:', err.response?.status);
    console.error('Data:', JSON.stringify(err.response?.data));
    console.error('Message:', err.message);
    console.error('============================');
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// ── Poll for results ─────────────────────────────────────
async function pollAndDownload(snapshotId) {
  console.log('>>> Polling snapshot:', snapshotId);
  let status = 'collecting';
  let attempts = 0;

  while (status !== 'ready' && status !== 'failed' && attempts < 40) {
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
    console.error('>>> Job failed. Status:', status);
    return null;
  }

  console.log('>>> Downloading results...');
  const results = await axios.get(
    `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`,
    {
      params: { format: 'json' },
      headers: { 'Authorization': `Bearer ${BRIGHTDATA_API_KEY}` },
    }
  );

  if (results.data && results.data.length > 0) {
    console.log('>>> FIELD NAMES:', Object.keys(results.data[0]).join(', '));
    console.log('>>> SAMPLE ITEM:', JSON.stringify(results.data[0]).substring(0, 500));
  }

  console.log('>>> Downloaded:', results.data?.length, 'items');
  return results.data;
}

// ══════════════════════════════════════════════════════════
//  🎨 FORMAT PRODUCT
// ══════════════════════════════════════════════════════════

function formatProduct(p, index) {
  const name = p.title || p.product_title || p.name || 'מוצר ללא שם';
  
  const fPrice = p.final_price || p.sale_price || p.price || null;
  const iPrice = p.initial_price || p.original_price || null;
  const currency = p.currency || 'USD';
  
  const price = fPrice ? `${fPrice} ${currency}` : 'לא זמין';
  const discount = (iPrice && fPrice && String(iPrice) !== String(fPrice))
    ? `  ~~${iPrice} ${currency}~~`
    : '';

  const rating = p.rating || p.average_rating || null;
  const ratingStr = rating ? `${rating}⭐` : '';

  const reviews = p.reviews_count || p.review_count || null;
  const reviewsStr = reviews ? `(${Number(reviews).toLocaleString()} ביקורות)` : '';

  const brand = p.brand ? `🏷️ מותג: ${p.brand}\n` : '';
  const category = p.product_category || p.category || null;
  const categoryLine = category ? `📂 קטגוריה: ${category}\n` : '';

  const desc = p.description ? `📝 ${p.description.substring(0, 120)}...\n` : '';
  
  const itemId = p.item_id ? `🆔 מק"ט: ${p.item_id}\n` : '';
  
  const url = p.url || '#';

  return (
    `${index}️⃣ *${name}*\n` +
    `💰 מחיר: ${price}${discount}\n` +
    (ratingStr ? `⭐ דירוג: ${ratingStr} ${reviewsStr}\n` : '') +
    brand +
    categoryLine +
    itemId +
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
      `2️⃣ *חיפוש מוצרים:*\n` +
      `כתבי "חפש" ואחריו מה שתרצי\n\n` +
      `3️⃣ *סריקת קטגוריה:*\n` +
      `/category <לינק קטגוריה>\n\n` +
      `💡 *דוגמאות:*\n` +
      `\`/scan https://www.aliexpress.com/item/1005005307607563.html\`\n` +
      `\`חפש אוזניות בלוטוס\``,
    { parse_mode: 'Markdown' }
  );
});

// ── /scan <URL> — סריקת מוצר בודד ────────────────────────
bot.onText(/\/scan (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1].trim();

  console.log('>>> /scan URL:', url);

  if (!url.includes('aliexpress.com')) {
    return bot.sendMessage(chatId, '❌ נא לשלוח לינק מ-AliExpress');
  }

  await bot.sendMessage(chatId, '⏳ *סורק את המוצר... זה יכול לקחת 1-2 דקות*', {
    parse_mode: 'Markdown',
  });

  const result = await scrapeProduct([{ url }]);

  console.log('>>> /scan done. Success:', result.success, '| Items:', result.data?.length);

  if (result.success && result.data?.length > 0) {
    // Filter out items that only have timestamp+input (empty results)
    const validItems = result.data.filter(item => 
      item.title || item.name || item.product_title || item.item_id
    );

    if (validItems.length > 0) {
      bot.sendMessage(
        chatId,
        `✅ *תוצאת סריקה:*\n\n` + formatProduct(validItems[0], 1),
        { parse_mode: 'Markdown', disable_web_page_preview: false }
      );
    } else {
      console.log('>>> All items were empty. Raw:', JSON.stringify(result.data[0]));
      bot.sendMessage(
        chatId,
        `⚠️ הסריקה הצליחה אבל לא נמצאו נתוני מוצר.\n💡 *נסי חיפוש לפי מילת מפתח:*\nכתבי "חפש" + מה שאת מחפשת`,
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

// ── /category <URL> — סריקת קטגוריה ──────────────────────
bot.onText(/\/category (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1].trim();

  console.log('>>> /category URL:', url);

  if (!url.includes('aliexpress.com')) {
    return bot.sendMessage(chatId, '❌ נא לשלוח לינק מ-AliExpress');
  }

  await bot.sendMessage(chatId, '📂 *סורק קטגוריה... זה יכול לקחת 1-2 דקות*', {
    parse_mode: 'Markdown',
  });

  const result = await scrapeDiscovery([{ url }], 10);

  console.log('>>> /category done. Success:', result.success, '| Items:', result.data?.length);

  if (result.success && result.data?.length > 0) {
    const validItems = result.data.filter(item =>
      item.title || item.name || item.product_title || item.item_id
    );

    if (validItems.length > 0) {
      const header = `✅ *נמצאו ${validItems.length} מוצרים:*\n\n`;
      const body = validItems
        .slice(0, 5)
        .map((p, i) => formatProduct(p, i + 1))
        .join('\n─────────────────\n\n');

      bot.sendMessage(chatId, header + body, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      });
    } else {
      bot.sendMessage(chatId, '😕 לא נמצאו מוצרים בקטגוריה.');
    }
  } else {
    bot.sendMessage(
      chatId,
      `😕 לא הצלחתי לסרוק.\n🔎 שגיאה: ${result.error || 'לא נמצאו תוצאות'}`
    );
  }
});

// ── חיפוש חופשי בעברית ───────────────────────────────────
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

  await bot.sendMessage(chatId, `🔍 *מחפש "${keyword}"... זה יכול לקחת 1-2 דקות*`, {
    parse_mode: 'Markdown',
  });

  const searchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword)}`;
  console.log('>>> Search URL:', searchUrl);

  const result = await scrapeDiscovery([{ url: searchUrl }], 10);

  console.log('>>> Search done. Success:', result.success, '| Items:', result.data?.length);

  if (result.success && result.data?.length > 0) {
    const validItems = result.data.filter(item =>
      item.title || item.name || item.product_title || item.item_id
    );

    if (validItems.length > 0) {
      const header = `🛍️ *מצאתי ${validItems.length} תוצאות עבור "${keyword}":*\n\n`;
      const body = validItems
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
  } else {
    bot.sendMessage(chatId, '😕 לא מצאתי תוצאות. נסי מילות חיפוש באנגלית.');
  }
});

// ══════════════════════════════════════════════════════════
console.log('🤖 AliExpress Scanner Bot is running!');
console.log('⏳ Waiting for messages...');
// ══════════════════════════════════════════════════════════
