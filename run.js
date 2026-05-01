const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

// 🛡️ ANTI-CRASH
process.on('uncaughtException', err => {
  console.error('❌ UNCAUGHT ERROR:', err);
});

process.on('unhandledRejection', err => {
  console.error('❌ PROMISE ERROR:', err);
});

const DATA_FILE = './data.json';

// 📦 cargar datos seguro
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("❌ Error leyendo data.json:", err);
    return {};
  }
}

// 💾 guardar datos seguro
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("❌ Error guardando data.json:", err);
  }
}

let users = loadData();
let shields = {};

// 🤖 cliente
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 🔧 comandos
const commands = [
  new SlashCommandBuilder()
    .setName('racha')
    .setDescription('Ver tu racha o la de otro usuario')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuario a consultar')
    ),

  new SlashCommandBuilder()
    .setName('setracha')
    .setDescription('Cambiar racha (admin)')
    .addUserOption(option =>
      option.setName('usuario').setDescription('Usuario').setRequired(true))
    .addIntegerOption(option =>
      option.setName('valor').setDescription('Días').setRequired(true)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top de rachas'),

  new SlashCommandBuilder()
    .setName('generateshield')
    .setDescription('Dar escudo (admin)')
    .addUserOption(option =>
      option.setName('usuario').setDescription('Usuario').setRequired(true)),

  new SlashCommandBuilder()
    .setName('useshield')
    .setDescription('Usar escudo')
    .addStringOption(option =>
      option.setName('clave').setDescription('Clave').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// ✅ BOT LISTO
client.once('clientReady', async () => {
  console.log(`🤖 Bot listo como ${client.user.tag}`);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash commands registrados');
  } catch (err) {
    console.error(err);
  }
});

// 📩 MENSAJES (rachas)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== process.env.CHANNEL_ID) return;

  const id = message.author.id;

  if (!users[id]) {
    users[id] = {
      messagesToday: 0,
      streakDays: 0,
      last: 0,
      locked: false,
      shieldActive: false
    };
  }

  const now = Date.now();
  if (now - users[id].last < 3000) return;

  users[id].last = now;
  if (users[id].locked) return;

  users[id].messagesToday++;
  saveData(users);

  if (users[id].messagesToday >= 20) {
    users[id].streakDays++;
    users[id].messagesToday = 0;
    users[id].locked = true;

    try {
      const canal = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
      if (canal) {
        await canal.send(`🔥 ${message.author.username} completó 1 día (${users[id].streakDays})`);
      }
    } catch (err) {
      console.error("Error enviando log:", err);
    }

    saveData(users);
  }
});

// ⚡ COMANDOS
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;

  // racha
  if (cmd === 'racha') {
    const user = interaction.options.getUser('usuario') || interaction.user;
    const data = users[user.id];

    if (!data) {
      return interaction.reply({ content: '❌ Sin racha', ephemeral: true });
    }

    return interaction.reply({
      content: `🔥 ${user.username}\n📊 ${data.streakDays} días\n💬 ${data.messagesToday} mensajes`,
      ephemeral: true
    });
  }

  // setracha
  if (cmd === 'setracha') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ Sin permisos', ephemeral: true });
    }

    const user = interaction.options.getUser('usuario');
    const value = interaction.options.getInteger('valor');

    if (!users[user.id]) users[user.id] = { streakDays: 0 };

    users[user.id].streakDays = value;
    saveData(users);

    return interaction.reply(`✅ ${user.username} ahora tiene ${value}`);
  }

  // 🏆 leaderboard SIN PING
  if (cmd === 'leaderboard') {
    const sorted = Object.entries(users)
      .sort((a, b) => (b[1].streakDays || 0) - (a[1].streakDays || 0))
      .slice(0, 10);

    let text = '🏆 TOP DE RACHAS\n\n';

    for (let i = 0; i < sorted.length; i++) {
      const userId = sorted[i][0];
      const days = sorted[i][1].streakDays || 0;

      let username = "Usuario";

      try {
        const userObj = await client.users.fetch(userId);
        username = userObj.username;
      } catch (err) {
        console.log("No se pudo obtener usuario:", userId);
      }

      text += `**${i + 1}.** ${username} — ${days} días\n`;
    }

    return interaction.reply({
      content: text,
      allowedMentions: { parse: [] }
    });
  }

  // generate shield
  if (cmd === 'generateshield') {
    const user = interaction.options.getUser('usuario');

    const key = Math.random().toString(36).substring(2, 10).toUpperCase();

    shields[key] = { userId: user.id, used: false };

    try {
      await user.send(`🛡️ Clave: ${key}`);
    } catch {}

    return interaction.reply({ content: '🛡️ Enviado por DM', ephemeral: true });
  }

  // usar shield
  if (cmd === 'useshield') {
    const key = interaction.options.getString('clave');
    const shield = shields[key];

    if (!shield || shield.used) {
      return interaction.reply({ content: '❌ Clave inválida', ephemeral: true });
    }

    if (shield.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ No es tuyo', ephemeral: true });
    }

    if (!users[interaction.user.id]) {
      users[interaction.user.id] = {
        messagesToday: 0,
        streakDays: 0,
        last: 0,
        locked: false,
        shieldActive: false
      };
    }

    users[interaction.user.id].shieldActive = true;
    shield.used = true;

    saveData(users);

    return interaction.reply('🛡️ Escudo activado');
  }
});

// 🔄 reset diario
setInterval(() => {
  for (const id in users) {
    if (users[id].shieldActive) {
      users[id].shieldActive = false;
      continue;
    }
    users[id].streakDays = 0;
    users[id].messagesToday = 0;
    users[id].locked = false;
  }
  saveData(users);
}, 86400000);

// 🔐 login
if (!process.env.TOKEN) {
  console.error("❌ TOKEN no definido");
  process.exit(1);
}

client.login(process.env.TOKEN);
