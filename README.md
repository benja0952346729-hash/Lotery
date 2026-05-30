# 🎰 Lottery Telegram Bot

Gemini + Groq AI powered Telegram Lottery Bot

---

## 📁 Project Structure

```
lottery-bot/
├── index.js                 # Main entry point
├── package.json
├── .env.example             # Copy this to .env
├── db/
│   ├── database.js          # JSON database manager
│   └── data/                # Auto-created JSON files
│       ├── knowledge.json   # What Gemini learned
│       ├── members.json     # Registered members
│       ├── history.json     # 5-day message history
│       ├── lottery.json     # Lottery list (1-100)
│       └── bot_state.json   # ON/OFF state
├── handlers/
│   ├── adminHandler.js      # Private chat commands
│   └── groupHandler.js      # Group message handler
└── services/
    ├── geminiService.js     # Gemini AI (teacher 🧑‍🏫)
    ├── groqService.js       # Groq AI (speaker 💬)
    └── keyRotation.js       # Multi-key rotation
```

---

## ⚙️ Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create .env file
```bash
cp .env.example .env
```

### 3. Fill in your .env
```
TELEGRAM_BOT_TOKEN=    # From @BotFather
ADMIN_CHAT_ID=         # Your personal Telegram ID
GROUP_CHAT_ID=         # Your group's chat ID

GEMINI_KEY_1=          # From Google AI Studio
GEMINI_KEY_2=          # Add as many as you want
GROQ_KEY_1=            # From console.groq.com
GROQ_KEY_2=            # Add as many as you want

BOT_NAME=              # Your name (bot will pretend to be you)
```

### 4. Get your Telegram ID
- Message @userinfobot on Telegram
- Copy the ID number

### 5. Get Group ID
- Add @userinfobot to your group
- It will show the group ID (starts with -)

### 6. Run the bot
```bash
npm start
# or for development:
npm run dev
```

---

## 👑 Admin Commands (Private Chat)

| Command | Description |
|---------|-------------|
| `/on` | Turn bot ON (Groq + Gemini active) |
| `/off` | Turn bot OFF (Gemini learns silently) |
| `/status` | Show bot status and stats |
| `/summary` | Daily learning summary |
| `/list` | Show lottery registration list |
| `/knowledge` | Show knowledge base stats |
| `/announce <text>` | Bot posts announcement in group |

---

## 🤖 How it works

```
Group Message
     ↓
Gemini learns (always)
     ↓
Bot ON? → Groq generates response
     ↓
Gemini evaluates confidence
     ↓
≥90% confident? → Send to group
<90% confident? → Ask admin privately
```

---

## 🔑 Adding More API Keys

In `.env`, just add more numbered keys:
```
GEMINI_KEY_1=key1
GEMINI_KEY_2=key2
GEMINI_KEY_3=key3
...
GROQ_KEY_1=key1
GROQ_KEY_2=key2
...
```

Bot automatically rotates when one hits its limit.
