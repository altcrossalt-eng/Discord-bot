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
  locked: { type: Boolean, default: false },
  shieldActive: { type: Boolean, default: false }
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

// 🛡️ shields en memoria
const shields = {};

// 🔧 COMANDOS
const commands = [
  new SlashCommandBuilder()
    .setName("racha")
    .setDescription("Ver tu racha o la de otro usuario")
    .addUserOption(o => o.setName("usuario").setDescription("Usuario")),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top de rachas"),

  new SlashCommandBuilder()
    .setName("setracha")
    .setDescription("Cambiar racha (admin)")
    .addUserOption(o => o.setName("usuario").setDescription("Usuario").setRequired(true))
    .addIntegerOption(o => o.setName("valor").setDescription("Días").setRequired(true)),

  new SlashCommandBuilder()
    .setName("generateshield")
    .setDescription("Dar escudo (admin)")
    .addUserOption(o => o.setName("usuario").setDescription("Usuario").setRequired(true)),

  new SlashCommandBuilder()
    .setName("useshield")
    .setDescription("Usar escudo")
    .addStringOption(o => o.setName("clave").setDescription("Clave").setRequired(true))
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

    // 🔥 racha
    if (cmd === "racha") {
      const target = i.options.getUser("usuario") || i.user;

      const data = await User.findOne({ userId: target.id }).lean();

      if (!data) {
        return i.reply({ content: "❌ Sin racha", ephemeral: true });
      }

      return i.reply({
        content: `🔥 ${target.username}\n📊 Día: ${data.streakDays}\n💬 Mensajes: ${data.messagesToday}`,
        ephemeral: true
      });
    }

    // 🏆 leaderboard
    if (cmd === "leaderboard") {
      await i.deferReply({ ephemeral: true });

      const top = await User.find()
        .sort({ streakDays: -1 })
        .limit(10)
        .lean();

      let text = "🏆 TOP DE RACHAS\n\n";

      for (let i2 = 0; i2 < top.length; i2++) {
        const u = top[i2];
        text += `**${i2 + 1}.** <@${u.userId}> — Día ${u.streakDays}\n`;
      }

      return i.editReply(text);
    }

    // 🔧 setracha
    if (cmd === "setracha") {
      if (!i.memberPermissions?.has("Administrator")) {
        return i.reply({ content: "❌ Sin permisos", ephemeral: true });
      }

      const user = i.options.getUser("usuario");
      const value = i.options.getInteger("valor");

      await User.updateOne(
        { userId: user.id },
        { $set: { streakDays: value } },
        { upsert: true }
      );

      return i.reply(`✅ ${user.username} ahora tiene ${value}`);
    }

    // 🛡️ generate shield
    if (cmd === "generateshield") {
      const user = i.options.getUser("usuario");
      const key = Math.random().toString(36).substring(2, 10).toUpperCase();

      shields[key] = { userId: user.id, used: false };

      try {
        await user.send(`🛡️ Clave: ${key}`);
      } catch {}

      return i.reply({ content: "🛡️ enviado", ephemeral: true });
    }

    // 🛡️ use shield
    if (cmd === "useshield") {
      const key = i.options.getString("clave");
      const s = shields[key];

      if (!s || s.used) {
        return i.reply({ content: "❌ inválido", ephemeral: true });
      }

      if (s.userId !== i.user.id) {
        return i.reply({ content: "❌ no es tuyo", ephemeral: true });
      }

      await User.updateOne(
        { userId: i.user.id },
        { $set: { shieldActive: true } }
      );

      s.used = true;

      return i.reply("🛡️ escudo activado");
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
