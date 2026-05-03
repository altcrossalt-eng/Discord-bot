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
  shields: { type: Number, default: 0 },
  lastStreakAt: { type: Number, default: 0 } // 🔥 NUEVO
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

// 🛡️ CLAVES EN MEMORIA
const shieldKeys = {};

// 🔧 COMANDOS
const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Ver tu estado o el de otro usuario")
    .addUserOption(o =>
      o.setName("usuario")
       .setDescription("Usuario a consultar")
    ),

  new SlashCommandBuilder()
    .setName("tpp")
    .setDescription("Top de rachas sin ping"),

  new SlashCommandBuilder()
    .setName("giveshield")
    .setDescription("Dar escudo con clave (admin)")
    .addUserOption(o =>
      o.setName("usuario")
       .setDescription("Usuario que recibirá el escudo")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("redeem")
    .setDescription("Canjear escudo")
    .addStringOption(o =>
      o.setName("clave")
       .setDescription("Clave del escudo")
       .setRequired(true)
    )

].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// 🔥 REGISTRO
client.once("clientReady", async () => {
  console.log(`🤖 Bot listo como ${client.user.tag}`);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log("✅ Slash commands registrados");
});

// 📩 MENSAJES
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.CHANNEL_ID) return;

    const id = message.author.id;

    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Mexico_City"
    });

    let user = await User.findOne({ userId: id });

    if (!user) {
      user = await User.create({
        userId: id,
        messagesToday: 0,
        streakDays: 1,
        lastDay: today
      });
    }

    // 🔄 RESET DIARIO (solo mensajes + escudos)
    if (user.lastDay !== today) {

      if (user.messagesToday < 20) {
        if (user.shields > 0) {
          user.shields -= 1;
        } else {
          user.streakDays = 1;
        }
      }

      user.messagesToday = 0;
      user.locked = false;
      user.lastDay = today;
    }

    // anti spam
    if (Date.now() - user.last < 3000) return;
    user.last = Date.now();

    if (user.locked) return;

    user.messagesToday++;

    // 🔥 COOLDOWN 24H REAL
    const now = Date.now();
    const COOLDOWN = 1000 * 60 * 60 * 24;

    if (user.messagesToday >= 20) {

      if (now - user.lastStreakAt >= COOLDOWN) {

        user.streakDays += 1;
        user.lastStreakAt = now;
        user.locked = true;

        const canal = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
        if (canal) {
          canal.send(`🔥 ${message.author.username} subió a día ${user.streakDays}`);
        }

      } else {
        // en cooldown
        user.locked = true;
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

    if (cmd === "status") {
      await i.deferReply({ ephemeral: true });

      const target = i.options.getUser("usuario") || i.user;
      const data = await User.findOne({ userId: target.id }).lean();

      if (!data) return i.editReply("❌ Sin datos");

      const remaining = data.lastStreakAt
        ? Math.max(0, (1000 * 60 * 60 * 24) - (Date.now() - data.lastStreakAt))
        : 0;

      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

      return i.editReply(
        `📊 ${target.username}\n🔥 Día: ${data.streakDays}\n💬 ${data.messagesToday}/20\n🛡️ Escudos: ${data.shields}\n⏳ Cooldown: ${hours}h ${minutes}m`
      );
    }

    if (cmd === "tpp") {
      await i.deferReply({ ephemeral: true });

      const top = await User.find()
        .sort({ streakDays: -1 })
        .limit(10)
        .lean();

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

    if (cmd === "giveshield") {
      if (!i.memberPermissions?.has("Administrator")) {
        return i.reply({ content: "❌ Sin permisos", ephemeral: true });
      }

      const user = i.options.getUser("usuario");
      const key = Math.random().toString(36).substring(2, 10).toUpperCase();

      shieldKeys[key] = { userId: user.id, used: false };

      try {
        await user.send(`🛡️ Tu clave: ${key}`);
      } catch {
        return i.reply({ content: "❌ No pude enviar DM", ephemeral: true });
      }

      return i.reply({ content: "🛡️ Clave enviada", ephemeral: true });
    }

    if (cmd === "redeem") {
      const key = i.options.getString("clave");
      const data = shieldKeys[key];

      if (!data || data.used) {
        return i.reply({ content: "❌ Clave inválida", ephemeral: true });
      }

      if (data.userId !== i.user.id) {
        return i.reply({ content: "❌ Esta clave no es tuya", ephemeral: true });
      }

      await User.updateOne(
        { userId: i.user.id },
        { $inc: { shields: 1 } },
        { upsert: true }
      );

      data.used = true;

      return i.reply({ content: "🛡️ Escudo añadido", ephemeral: true });
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
