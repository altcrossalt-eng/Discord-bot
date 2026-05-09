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
  SlashCommandBuilder,
  Partials
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

  messagesToday: {
    type: Number,
    default: 0
  },

  streakDays: {
    type: Number,
    default: 1
  },

  last: {
    type: Number,
    default: 0
  },

  lastDay: {
    type: String,
    default: ""
  },

  shields: {
    type: Number,
    default: 0
  },

  // 🔥 último aumento
  lastStreakAt: {
    type: Number,
    default: Date.now
  },

  // 📩 avisos
  warnedUp: {
    type: Boolean,
    default: false
  },

  warnedLose: {
    type: Boolean,
    default: false
  }
});

const User = mongoose.model("User", userSchema);

// 🤖 BOT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],

  partials: [
    Partials.Channel
  ]
});

// 🛡️ CLAVES
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
    ),

  new SlashCommandBuilder()
    .setName("setstreak")
    .setDescription("Editar racha de un usuario")
    .addUserOption(o =>
      o.setName("usuario")
       .setDescription("Usuario")
       .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("dias")
       .setDescription("Nueva racha")
       .setRequired(true)
    )

].map(c => c.toJSON());

const rest = new REST({
  version: "10"
}).setToken(process.env.TOKEN);

// 🔥 READY
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

    const today = new Date()
      .toLocaleDateString("en-CA", {
        timeZone: "America/Mexico_City"
      });

    let user = await User.findOne({
      userId: id
    });

    // 👤 CREAR USUARIO
    if (!user) {

      user = await User.create({
        userId: id,
        messagesToday: 0,
        streakDays: 1,
        lastDay: today
      });
    }

    // 🔄 CAMBIO DE DÍA
    if (user.lastDay !== today) {

      // ⚠️ perder racha solo si no llegó a 20
      if (user.messagesToday < 20) {

        if (user.shields > 0) {

          user.shields -= 1;

        } else {

          user.streakDays = 1;
        }
      }

      // 🔄 reset diario
      user.messagesToday = 0;
      user.lastDay = today;

      // 🔄 reset avisos
      user.warnedUp = false;
      user.warnedLose = false;
    }

    // ⛔ ANTI SPAM
    if (Date.now() - user.last < 3000) return;

    user.last = Date.now();

    // ✅ NO pasar de 20
    if (user.messagesToday < 20) {
      user.messagesToday++;
    }

    await user.save();

  } catch (err) {

    console.error("❌ MESSAGE ERROR:", err);
  }
});

// 🔥 AUTO STREAK + AVISOS
setInterval(async () => {

  try {

    const now = Date.now();

    const COOLDOWN =
      1000 * 60 * 60 * 24;

    const ONE_HOUR =
      1000 * 60 * 60;

    const users = await User.find();

    const canal = await client.channels
      .fetch(process.env.LOG_CHANNEL_ID)
      .catch(() => null);

    for (const user of users) {

      const remaining = Math.max(
        0,
        COOLDOWN - (now - user.lastStreakAt)
      );

      // ⏱️ próxima revisión
      const nextCheck = remaining <= ONE_HOUR;

      // 🔥 SUBIR RACHA
      if (
        user.messagesToday >= 20 &&
        remaining === 0
      ) {

        user.streakDays += 1;

        user.lastStreakAt = now;

        user.messagesToday = 0;

        user.warnedUp = false;
        user.warnedLose = false;

        await user.save();

        if (canal) {

          canal.send(
            `🔥 <@${user.userId}> subió automáticamente a día ${user.streakDays}`
          );
        }

        continue;
      }

      // 📩 AVISO SUBIDA
      if (
        user.messagesToday >= 20 &&
        !user.warnedUp &&
        nextCheck &&
        remaining > 0
      ) {

        const member = await client.users
          .fetch(user.userId)
          .catch(() => null);

        if (member) {

          await member.send(
            `🔥 Tu racha subirá en menos de 1 hora.\n⏳ Prepárate para llegar al día ${user.streakDays + 1}`
          ).catch(() => null);
        }

        user.warnedUp = true;

        await user.save();
      }

      // ⚠️ AVISO PÉRDIDA
      if (
        user.messagesToday < 20 &&
        !user.warnedLose
      ) {

        const mexico = new Date(
          new Date().toLocaleString("en-US", {
            timeZone: "America/Mexico_City"
          })
        );

        const hour = mexico.getHours();

        // ⚠️ 11 PM México
        if (hour === 23) {

          const member = await client.users
            .fetch(user.userId)
            .catch(() => null);

          if (member) {

            await member.send(
              `⚠️ Te falta menos de 1 hora para perder tu racha.\n💬 Llevas ${user.messagesToday}/20 mensajes`
            ).catch(() => null);
          }

          user.warnedLose = true;

          await user.save();
        }
      }
    }

  } catch (err) {

    console.error("❌ AUTO STREAK ERROR:", err);
  }

}, 60 * 60 * 1000);

// ⚡ COMANDOS
client.on("interactionCreate", async (i) => {

  if (!i.isChatInputCommand()) return;

  try {

    const cmd = i.commandName;

    // 📊 STATUS
    if (cmd === "status") {

      await i.deferReply({
        ephemeral: true
      });

      const target =
        i.options.getUser("usuario") || i.user;

      const data = await User.findOne({
        userId: target.id
      }).lean();

      if (!data) {
        return i.editReply("❌ Sin datos");
      }

      const COOLDOWN =
        1000 * 60 * 60 * 24;

      const ONE_HOUR =
        1000 * 60 * 60;

      let remaining = 0;

      if (data.lastStreakAt) {

        remaining = Math.max(
          0,
          COOLDOWN - (Date.now() - data.lastStreakAt)
        );
      }

      const hours = Math.floor(
        remaining / (1000 * 60 * 60)
      );

      const minutes = Math.floor(
        (remaining % (1000 * 60 * 60)) / (1000 * 60)
      );

      const seconds = Math.floor(
        (remaining % (1000 * 60)) / 1000
      );

      let estado = "";

      if (
        data.messagesToday >= 20 &&
        remaining === 0
      ) {

        estado = "✅ Listo para subir";
      }

      else if (data.messagesToday >= 20) {

        if (remaining <= ONE_HOUR) {

          estado = "🔥 Subirá en menos de 1 hora";

        } else {

          estado = "⏳ En cooldown";
        }
      }

      else {

        estado = "💬 Aún necesita mensajes";
      }

      return i.editReply(

        `📊 ${target.username}\n\n` +

        `🔥 Día: ${data.streakDays}\n` +

        `💬 ${data.messagesToday}/20\n` +

        `🛡️ Escudos: ${data.shields}\n` +

        `⏳ Cooldown: ${hours}h ${minutes}m ${seconds}s\n\n` +

        `${estado}\n` +

        `ℹ️ El bot revisa automáticamente cada 1 hora`
      );
    }

    // 🏆 TOP
    if (cmd === "tpp") {

      await i.deferReply({
        ephemeral: true
      });

      const top = await User.find()
        .sort({ streakDays: -1 })
        .limit(10)
        .lean();

      if (!top.length) {

        return i.editReply(
          "❌ Sin datos aún"
        );
      }

      let text = "🏆 TOP DE RACHAS\n\n";

      for (let i2 = 0; i2 < top.length; i2++) {

        const u = top[i2];

        let username = "Usuario";

        try {

          const userObj =
            await client.users.fetch(u.userId);

          username = userObj.username;

        } catch {}

        text +=
          `**${i2 + 1}.** ${username} — Día ${u.streakDays}\n`;
      }

      return i.editReply(text);
    }

    // 🛡️ GIVE SHIELD
    if (cmd === "giveshield") {

      if (!i.memberPermissions?.has("Administrator")) {

        return i.reply({
          content: "❌ Sin permisos",
          ephemeral: true
        });
      }

      const user =
        i.options.getUser("usuario");

      const key = Math.random()
        .toString(36)
        .substring(2, 10)
        .toUpperCase();

      shieldKeys[key] = {
        userId: user.id,
        used: false
      };

      try {

        await user.send(
          `🛡️ Tu clave: ${key}`
        );

      } catch {

        return i.reply({
          content: "❌ No pude enviar DM",
          ephemeral: true
        });
      }

      return i.reply({
        content: "🛡️ Clave enviada",
        ephemeral: true
      });
    }

    // 🛡️ REDEEM
    if (cmd === "redeem") {

      const key =
        i.options.getString("clave");

      const data = shieldKeys[key];

      if (!data || data.used) {

        return i.reply({
          content: "❌ Clave inválida",
          ephemeral: true
        });
      }

      if (data.userId !== i.user.id) {

        return i.reply({
          content: "❌ Esta clave no es tuya",
          ephemeral: true
        });
      }

      await User.updateOne(
        { userId: i.user.id },
        {
          $inc: {
            shields: 1
          }
        },
        { upsert: true }
      );

      data.used = true;

      return i.reply({
        content: "🛡️ Escudo añadido",
        ephemeral: true
      });
    }

    // 🔥 SET STREAK
    if (cmd === "setstreak") {

      if (!i.memberPermissions?.has("Administrator")) {

        return i.reply({
          content: "❌ Sin permisos",
          ephemeral: true
        });
      }

      const target =
        i.options.getUser("usuario");

      const dias =
        i.options.getInteger("dias");

      const today = new Date()
        .toLocaleDateString("en-CA", {
          timeZone: "America/Mexico_City"
        });

      await User.updateOne(

        { userId: target.id },

        {
          $set: {

            streakDays: dias,

            lastDay: today,

            lastStreakAt: Date.now(),

            messagesToday: 20,

            warnedUp: false,
            warnedLose: false
          },

          $setOnInsert: {

            userId: target.id,

            shields: 0
          }
        },

        { upsert: true }
      );

      return i.reply({
        content:
          `🔥 ${target.username} ahora tiene racha de ${dias} días`,
        ephemeral: true
      });
    }

  } catch (err) {

    console.error(
      "❌ INTERACTION ERROR:",
      err
    );

    if (!i.replied) {

      await i.reply({
        content: "❌ Error interno",
        ephemeral: true
      });
    }
  }
});

client.login(process.env.TOKEN);
