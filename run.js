const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot activo"));

app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Keep alive server activo");
});

const mongoose = require("mongoose");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

// 🛡️ ERRORES GLOBALES
process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

// 📡 MONGO
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("🟢 MongoDB conectado"))
  .catch(err => {
    console.log("🔴 Mongo error:", err);
    process.exit(1);
  });

// 📊 USER SCHEMA
const userSchema = new mongoose.Schema({
  userId: String,
  messagesToday: { type: Number, default: 0 },
  streakDays: { type: Number, default: 1 },
  last: { type: Number, default: 0 },
  lastDay: { type: String, default: "" },
  locked: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema);

// 🤖 BOT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 🔧 COMANDOS (SOLO 2)
const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Ver tu estado de racha o de otro usuario")
    .addUserOption(o =>
      o.setName("usuario").setDescription("Usuario (opcional)")
    ),

  new SlashCommandBuilder()
    .setName("tpp")
    .setDescription("Top de rachas sin ping")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// 🔥 REGISTRO
client.once("ready", async () => {
  console.log(`🤖 Bot listo como ${client.user.tag}`);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log("✅ Slash commands registrados");
});

// 📩 MENSAJES (RACHAS)
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.CHANNEL_ID) return;

    const id = message.author.id;
    const today = new Date().toDateString();

    let user = await User.findOne({ userId: id });

    if (!user) {
      user = await User.create({
        userId: id,
        messagesToday: 0,
        streakDays: 1,
        lastDay: today
      });
    }

    // reset diario
    if (user.lastDay !== today) {
      user.messagesToday = 0;
      user.locked = false;
      user.lastDay = today;
    }

    if (Date.now() - user.last < 3000) return;
    user.last = Date.now();

    if (user.locked) return;

    user.messagesToday++;

    // 🔥 subir día
    if (user.messagesToday >= 20) {
      user.streakDays += 1;
      user.locked = true;

      const canal = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
      if (canal) {
        canal.send(`🔥 ${message.author.username} subió a día ${user.streakDays}`);
      }
    }

    await user.save();

  } catch (err) {
    console.error("❌ MESSAGE ERROR:", err);
  }
});

// ⚡ COMANDOS
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  try {
    const cmd = i.commandName;

    // 📊 STATUS
    if (cmd === "status") {
      await i.deferReply({ ephemeral: true });

      const target = i.options.getUser("usuario") || i.user;

      const data = await User.findOne({ userId: target.id }).lean();

      if (!data) {
        return i.editReply("❌ Sin racha aún");
      }

      return i.editReply(
        `📊 STATUS DE ${target.username}\n\n🔥 Día: ${data.streakDays}\n💬 Mensajes: ${data.messagesToday}`
      );
    }

    // 🏆 TPP (TOP SIN PING)
    if (cmd === "tpp") {
      await i.deferReply({ ephemeral: true });

      const top = await User.find()
        .sort({ streakDays: -1 })
        .limit(10)
        .lean();

      if (!top.length) {
        return i.editReply("❌ Sin datos aún");
      }

      let text = "🏆 TOP DE RACHAS\n\n";

      for (let i2 = 0; i2 < top.length; i2++) {
        const u = top[i2];

        let username = "Usuario";

        try {
          const userObj = await client.users.fetch(u.userId);
          username = userObj.username;
        } catch {}

        text += `**${i2 + 1}.** ${username} — Día ${u.streakDays}\n`;
      }

      return i.editReply(text);
    }

  } catch (err) {
    console.error("❌ INTERACTION ERROR:", err);

    if (!i.replied) {
      await i.reply({
        content: "❌ Error interno",
        ephemeral: true
      });
    }
  }
});

client.login(process.env.TOKEN);
