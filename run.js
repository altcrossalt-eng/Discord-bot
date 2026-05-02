const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot activo");
});

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

// 🤖 CLIENTE
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 🔧 COMANDOS
const commands = [
  new SlashCommandBuilder()
    .setName("racha")
    .setDescription("Ver tu racha o la de otro usuario")
    .addUserOption(o =>
      o.setName("usuario").setDescription("Usuario")
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top de rachas")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ✅ BOT LISTO
client.once("clientReady", async () => {
  console.log(`🤖 Bot listo como ${client.user.tag}`);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log("✅ Slash commands registrados");
});

// 📩 MENSAJES (RACHAS)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== process.env.CHANNEL_ID) return;

  const id = message.author.id;
  const today = new Date().toDateString();

  let user = await User.findOne({ userId: id });

  // 👤 CREAR USUARIO BIEN INICIALIZADO
  if (!user) {
    user = await User.create({
      userId: id,
      streakDays: 1,
      messagesToday: 0,
      last: 0,
      lastDay: today,
      locked: false
    });
  }

  // 🔄 RESET DIARIO SEGURO
  if (user.lastDay !== today) {
    user.messagesToday = 0;
    user.locked = false;
    user.lastDay = today;
  }

  const now = Date.now();
  if (now - user.last < 3000) return;

  user.last = now;

  if (user.locked) return;

  user.messagesToday++;

  // 🔥 SUBIR DE DÍA
  if (user.messagesToday >= 20) {
    user.streakDays += 1;
    user.locked = true;

    try {
      const canal = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
      if (canal) {
        await canal.send(
          `🔥 ${message.author.username} subió a día ${user.streakDays}`
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  await user.save();
});

// ⚡ COMANDOS
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;

  // 🔥 RACHAS
  if (cmd === "racha") {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser("usuario") || interaction.user;

    let data;
    try {
      data = await User.findOne({ userId: target.id });
    } catch (err) {
      console.error(err);
      return interaction.editReply("❌ Error en base de datos");
    }

    if (!data) {
      return interaction.editReply("❌ Sin racha");
    }

    return interaction.editReply(
      `🔥 ${target.username}\n📊 Día: ${data.streakDays}\n💬 Mensajes: ${data.messagesToday}`
    );
  }

  // 🏆 LEADERBOARD
  if (cmd === "leaderboard") {
    await interaction.deferReply({ ephemeral: true });

    let top;
    try {
      top = await User.find()
        .sort({ streakDays: -1 })
        .limit(10)
        .lean();
    } catch (err) {
      console.error(err);
      return interaction.editReply("❌ Error cargando leaderboard");
    }

    if (!top.length) {
      return interaction.editReply("❌ No hay datos aún");
    }

    let text = "🏆 TOP DE RACHAS\n\n";

    top.forEach((u, i) => {
      text += `**${i + 1}.** <@${u.userId}> — Día ${u.streakDays}\n`;
    });

    return interaction.editReply(text);
  }
});

// 🔐 LOGIN
client.login(process.env.TOKEN);
