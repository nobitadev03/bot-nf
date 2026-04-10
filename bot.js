const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = process.env.TOKEN || "8505916551:AAHIU9d7lkOLScH4qKQrLgdCkHWbHZtW87U";
const bot = new TelegramBot(TOKEN, { polling: true });

const PAGE_SIZE = 10;

const userData = {};

// ===== LOG =====
function log(msg) {
  console.log(`[${new Date().toLocaleString()}] ${msg}`);
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "🤖 BOT TOOL TOKEN\n\n📌 Gửi file .txt để bắt đầu",
    {
      reply_markup: {
        remove_keyboard: true // ❌ xoá menu dưới
      }
    }
  );
});

// ===== PARSE =====
function extractAccounts(content) {
  const blocks = content.split(/\n(?=Status:)/);
  const results = [];

  blocks.forEach(block => {
    const tokenMatch = block.match(/Token:\s*(.+)/);
    if (!tokenMatch) return;

    results.push({
      token: tokenMatch[1].trim(),
      raw: block
    });
  });

  return results;
}

function parseInfo(raw) {
  const get = (key) => {
    const m = raw.match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : "Không rõ";
  };

  return {
    status: get("Status"),
    premium: get("Premium"),
    country: get("Country"),
    plan: get("Plan"),
    price: get("Price"),
    member: get("Member Since"),
    payment: get("Payment Method"),
    phone: get("Phone"),
    phoneVerified: get("Phone Verified"),
    quality: get("Video Quality"),
    streams: get("Max Streams"),
    hold: get("Payment Hold"),
    extra: get("Extra Member"),
    email: get("Email").replace("\\x40", "@"),
    emailVerified: get("Email Verified"),
    profiles: get("Profiles")
  };
}

function vi(text) {
  return {
    "Valid": "Hoạt động",
    "Yes": "Có",
    "No": "Không"
  }[text] || text;
}

function formatInfo(info) {
  return (
    `📊 THÔNG TIN TÀI KHOẢN

✅ Trạng thái: ${vi(info.status)}
💎 Premium: ${vi(info.premium)}
🌍 Quốc gia: ${info.country}
📦 Gói: ${info.plan}
💰 Giá: ${info.price}
📅 Tham gia: ${info.member}

📞 SĐT: ${info.phone}
✔️ Xác minh SĐT: ${vi(info.phoneVerified)}

🎬 Chất lượng: ${info.quality}
👥 Số thiết bị: ${info.streams}

⛔ Hold: ${vi(info.hold)}
➕ Thành viên phụ: ${vi(info.extra)}

📧 Email: ${info.email}
✔️ Xác minh Email: ${vi(info.emailVerified)}

👤 Hồ sơ: ${info.profiles}`
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

  try {
    const file = await bot.getFile(msg.document.file_id);
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

    const res = await axios.get(url);

    const accounts = extractAccounts(res.data);

    if (!accounts.length) {
      return bot.sendMessage(chatId, "❌ Không có token");
    }

    // lưu tạm
    userData[chatId] = { accounts };

    // hỏi chọn thiết bị
    bot.sendMessage(chatId, "📱 Bạn muốn dùng trên thiết bị nào?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📱 Mobile", callback_data: "choose_mobile" },
            { text: "💻 PC", callback_data: "choose_pc" }
          ],
          [
            { text: "🔀 ALL", callback_data: "choose_all" }
          ]
        ]
      }
    });

  } catch (e) {
    log(e.message);
    bot.sendMessage(chatId, "❌ Lỗi file");
  }
});

// ===== CALLBACK =====
bot.on("callback_query", (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;

  if (!userData[chatId]) return;

  // chọn device
  if (data.startsWith("choose_")) {
    const device = data.replace("choose_", "");

    bot.answerCallbackQuery(q.id, { text: `Đã chọn ${device}` });

    // ẩn nút chọn
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: q.message.message_id
    });

    const accounts = userData[chatId].accounts;

    let links = [];

    accounts.forEach(acc => {
      const info = parseInfo(acc.raw);
      const created = createLinks(acc.token, device);

      created.forEach(link => {
        links.push({
          url: link,
          info: info,
          device: device
        });
      });
    });

    userData[chatId].links = links;

    const pageData = buildPage(chatId, 0);

    return bot.sendMessage(chatId, pageData.text, {
      reply_markup: pageData.reply_markup
    });
  }

  // copy
  if (data.startsWith("copy_")) {
    const i = parseInt(data.split("_")[1]);
    const item = userData[chatId].links[i];

    return bot.sendMessage(chatId,
      `📋 COPY LINK:\n\`\`\`\n${item.url}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  // info
  if (data.startsWith("info_")) {
    const i = parseInt(data.split("_")[1]);
    const item = userData[chatId].links[i];

    return bot.sendMessage(chatId, formatInfo(item.info));
  }

  // page
  if (data.startsWith("page_")) {
    const page = parseInt(data.split("_")[1]);
    const pageData = buildPage(chatId, page);

    return bot.editMessageText(pageData.text, {
      chat_id: chatId,
      message_id: q.message.message_id,
      reply_markup: pageData.reply_markup
    });
  }

  // download
  if (data === "download") {
    const fileName = `links_${chatId}.txt`;

    fs.writeFileSync(fileName, userData[chatId].links.map(l => l.url).join("\n"));

    bot.sendDocument(chatId, fileName).then(() => {
      fs.unlinkSync(fileName);
    });
  }

  bot.answerCallbackQuery(q.id);
});
