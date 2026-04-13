const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = process.env.TOKEN || "8505916551:AAHIU9d7lkOLScH4qKQrLgdCkHWbHZtW87U";
const bot = new TelegramBot(TOKEN, { polling: true });

const PAGE_SIZE = 10;

const DB_FILE = "database.json";

// ===== DATABASE =====
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return [];
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const userData = {};

// ===== LOG =====
function log(msg) {
  console.log(`[${new Date().toLocaleString()}] ${msg}`);
}

// ===== MENU =====
function sendMainMenu(chatId) {
  bot.sendMessage(
    chatId,
    "🤖 **BOT QUẢN LÝ NETFLIX**\n\nChọn một chức năng bên dưới:",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📦 Kho Token", callback_data: "menu_inventory" },
            { text: "➕ Thêm Token", callback_data: "menu_add" }
          ],
          [
            { text: "🔗 Lấy Link", callback_data: "menu_get" }
          ]
        ]
      }
    }
  );
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  userData[msg.chat.id] = { mode: null };
  sendMainMenu(msg.chat.id);
});

// ===== PARSE =====
function extractAccounts(content) {
  const results = [];
  const seen = new Set();
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const addToken = (token, raw) => {
    if (!token || /\s/.test(token) || token.length < 20 || seen.has(token)) return;
    seen.add(token);
    results.push({ token, raw });
  };
  const safeDecode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  };

  // Format 0: report của checker (chỉ lấy block ✅ để tránh noise)
  const reportBlocks = normalized.match(/✅\s*NETFLIX Cookies[\s\S]*?(?=(?:\n[✅❌]\s*NETFLIX Cookies|\nSUMMARY|$))/g) || [];
  reportBlocks.forEach((block) => {
    const tokenMatch = block.match(/Token:\s*([^\s\n\r]+)/i);
    if (tokenMatch) {
      addToken(tokenMatch[1].trim(), block.trim());
      return;
    }
    const urlMatch = block.match(/Login URL:\s*\S*nftoken=([^\s\n\r&]+)/i);
    if (urlMatch) addToken(safeDecode(urlMatch[1]), block.trim());
  });

  // Format 1: block có "Status" + "Token"
  const blocks = normalized.split(/(?=Status:)/i);
  blocks.forEach((block) => {
    if (!block.trim()) return;
    const tokenMatch = block.match(/Token:\s*([^\s\n\r]+)/i);
    if (!tokenMatch) return;
    addToken(tokenMatch[1].trim(), block.trim());
  });

  // Format 2: mỗi dòng là token hoặc URL có nftoken=
  normalized.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const fromField = trimmed.match(/^Token:\s*([^\s]+)$/i);
    const fromUrl = trimmed.match(/[?&]nftoken=([^&\s]+)/i);
    const rawToken = fromField ? fromField[1] : (fromUrl ? safeDecode(fromUrl[1]) : trimmed);

    // Loại bớt các dòng metadata không phải token
    if (/^(Status|Premium|Country|Plan|Price|Billing|Email|Phone|Profiles|NetflixId|Login URL|Token Expires|Time Remaining)\s*:/i.test(trimmed)) return;
    addToken(rawToken, `Token: ${rawToken}`);
  });

  return results;
}

function parseInfo(raw) {
  const get = (key) => {
    const m = raw.match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : "-";
  };

  return {
    status: get("Status"),
    premium: get("Premium"),
    country: get("Country"),
    plan: get("Plan"),
    price: get("Price"),
    member: get("Member Since"),
    payment: get("Payment Method"),
    billing: get("Billing"),
    owner: get("First Name"),
    phone: get("Phone"),
    phoneVerified: get("Phone Verified"),
    quality: get("Video Quality"),
    streams: get("Max Streams"),
    hold: get("Payment Hold"),
    extra: get("Extra Member"),
    email: get("Email"),
    emailVerified: get("Email Verified"),
    profiles: get("Profiles")
  };
}

function vi(text) {
  if (text === "Yes") return "Có ✅";
  if (text === "No") return "Không ❌";
  if (text === "Valid") return "Hoạt động";
  return text;
}

function formatInfo(info, token) {
  const e = encodeURIComponent(token);
  return (
`🌍 Quốc gia: ${info.country}
💰 Giá: ${info.price}
💳 Thanh toán: ${info.payment}
📅 Billing tiếp: ${info.billing}
👤 Chủ TK: ${info.owner}
📧 Email: ${info.email}
📞 SĐT: ${info.phone}
🎭 Số profiles: ${info.profiles}
👥 Extra Members: ${vi(info.extra)}
⏰ Thành viên từ: ${info.member}

🔗 Link Login (Nhấn vào để COPY ngay):
🖥 PC Login:
https://netflix.com/?nftoken=${e}
📱 Phone Login (Chuyên dùng cho iOS/Android):
https://netflix.com/unsupported?nftoken=${e}`
  );
}

// ===== LINK =====
function createLinks(token, device) {
  const e = encodeURIComponent(token);

  if (device === "mobile") {
    return [`https://netflix.com/unsupported?nftoken=${e}`];
  }

  if (device === "pc") {
    return [`https://netflix.com/browse?nftoken=${e}`];
  }

  return [
    `https://netflix.com/unsupported?nftoken=${e}`,
    `https://netflix.com/browse?nftoken=${e}`
  ];
}

// ===== PAGE =====
function buildPage(chatId, page = 0) {
  const data = userData[chatId];
  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;

  const items = data.links.slice(start, end);

  const buttons = items.map((item, i) => ([
    {
      text: `🔐 #${start + i + 1} (${item.device})`,
      callback_data: `copy_${start + i}`
    },
    {
      text: "🧾 Info",
      callback_data: `info_${start + i}`
    }
  ]));

  const nav = [];

  if (page > 0) nav.push({ text: "⬅️ Prev", callback_data: `page_${page - 1}` });
  if (end < data.links.length) nav.push({ text: "➡️ Next", callback_data: `page_${page + 1}` });

  if (nav.length) buttons.push(nav);

  buttons.push([{ text: "📥 Download", callback_data: "download" }]);

  return {
    text: `📊 ${data.links.length} Links\n📄 Page ${page + 1}`,
    reply_markup: { inline_keyboard: buttons }
  };
}

// ===== HANDLE FILE =====
bot.on("document", async (msg) => {
  const chatId = msg.chat.id;

  if (!userData[chatId] || userData[chatId].mode !== "ADD_MODE") {
    return bot.sendMessage(chatId, "❌ Vui lòng nhấn nút **Thêm Token** trước khi gửi file.", { parse_mode: "Markdown" });
  }

  try {
    bot.sendMessage(chatId, "⏳ Đang xử lý file, vui lòng đợi...");

    const fileUrl = await bot.getFileLink(msg.document.file_id);
    const res = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      timeout: 30000
    });
    const content = Buffer.from(res.data).toString("utf8");
    const accounts = extractAccounts(content);

    if (!accounts.length) {
      return bot.sendMessage(chatId, "❌ Không tìm thấy token trong file.");
    }

    const db = loadDB();
    const existingTokens = new Set(db.map(a => a.token));
    let addedCount = 0;

    accounts.forEach(acc => {
      if (!existingTokens.has(acc.token)) {
        db.push({
          token: acc.token,
          raw: acc.raw,
          addedAt: new Date().toISOString()
        });
        addedCount++;
      }
    });

    saveDB(db);
    userData[chatId].mode = null; // Thoát mode sau khi thêm xong

    bot.sendMessage(chatId, `✅ Đã thêm **${addedCount}** token mới vào kho!\n📦 Tổng cộng hiện tại: **${db.length}** token.`, { parse_mode: "Markdown" });
    sendMainMenu(chatId);

  } catch (e) {
    log(`Lỗi xử lý file: ${e.message}`);
    bot.sendMessage(chatId, "❌ Lỗi khi xử lý file.");
  }
});

// ===== CALLBACK =====
bot.on("callback_query", (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;

  if (!userData[chatId]) userData[chatId] = {};

  // --- MENU HANDLERS ---
  if (data === "menu_inventory") {
    const db = loadDB();
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, `📦 **KHO TOKEN HIỆN TẠI**\n\nHiện đang có: **${db.length}** tài khoản.`, { parse_mode: "Markdown" });
  }

  if (data === "menu_add") {
    userData[chatId].mode = "ADD_MODE";
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, "📤 Vui lòng gửi file `.txt` chứa token để thêm vào kho.\n\nNhấn /start để hủy bỏ.", { parse_mode: "Markdown" });
  }

  if (data === "menu_get") {
    const db = loadDB();
    if (!db.length) {
      bot.answerCallbackQuery(q.id, { text: "❌ Kho đã hết token!" });
      return bot.sendMessage(chatId, "❌ Kho hiện đang trống, vui lòng thêm token.");
    }

    // Lấy token đầu tiên (FIFO)
    const account = db.shift();
    saveDB(db);

    const info = parseInfo(account.raw);
    bot.answerCallbackQuery(q.id, { text: "Đã lấy 1 token!" });
    
    // Trả về thông tin và xóa khỏi DB
    return bot.sendMessage(chatId, formatInfo(info, account.token));
  }

  bot.answerCallbackQuery(q.id);
});

// ===== START LOG =====
log("Bot is running...");
log("Load DB: " + loadDB().length + " accounts found.");
