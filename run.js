const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const DATA_FILE = './data.json';

// 📦 cargar datos
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

// 💾 guardar datos
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let users = loadData();

// 🛡️ escudos en memoria
let shields = {};

// 🤖 cliente
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 🔧 slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('racha')
    .setDescription('Ver tu racha o la de otro usuario')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuario a consultar')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('setracha')
    .setDescription('Cambiar racha (solo admins)')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuario')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('valor')
        .setDescription('Días de racha')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top de rachas (días)'),

  // 🛡️ generar escudo (admin)
  new SlashCommandBuilder()
    .setName('generateshield')
    .setDescription('Generar escudo para un usuario (solo admins)')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuario')
        .setRequired(true)
    ),

  // 🔑 usar escudo
  new SlashCommandBuilder()
    .setName('useshield')
    .setDescription('Activar escudo con clave')
    .addStringOption(option =>
      option.setName('clave')
        .setDescription('Clave del escudo')
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// 🚀 iniciar bot
client.once('ready', async () => {
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

// 📩 sistema de rachas
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

    const canal = await client.channels.fetch(process.env.LOG_CHANNEL_ID);

    if (canal) {
      await canal.send(
        `🔥 ${message.author} completó 1 día de racha (${users[id].streakDays} días)`
      );
    }

    saveData(users);
  }
});

// ⚡ comandos
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // 📊 racha
  if (interaction.commandName === 'racha') {
    const user = interaction.options.getUser('usuario') || interaction.user;

    const data = users[user.id];

    if (!data) {
      return interaction.reply({
        content: `❌ ${user.username} no tiene racha aún.`,
        ephemeral: true
      });
    }

    return interaction.reply({
      content: `🔥 ${user.username}
📊 Días de racha: **${data.streakDays || 0}**
💬 Mensajes hoy: **${data.messagesToday || 0}**`,
      ephemeral: true
    });
  }

  // 🛠️ setracha
  if (interaction.commandName === 'setracha') {

    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ No tienes permisos.', ephemeral: true });
    }

    const user = interaction.options.getUser('usuario');
    const value = interaction.options.getInteger('valor');

    if (!users[user.id]) {
      users[user.id] = {
        messagesToday: 0,
        streakDays: 0,
        last: 0,
        locked: false,
        shieldActive: false
      };
    }

    users[user.id].streakDays = value;

    saveData(users);

    return interaction.reply({
      content: `✅ Racha de ${user.username} ahora es **${value} días**.`,
      ephemeral: false
    });
  }

  // 🏆 leaderboard
  if (interaction.commandName === 'leaderboard') {

    const sorted = Object.entries(users)
      .sort((a, b) => b[1].streakDays - a[1].streakDays)
      .slice(0, 10);

    let text = '🏆 **LEADERBOARD DE RACHAS (DÍAS)**\n\n';

    for (let i = 0; i < sorted.length; i++) {
      const userId = sorted[i][0];
      const days = sorted[i][1].streakDays || 0;

      text += `**${i + 1}.** <@${userId}> — ${days} días\n`;
    }

    return interaction.reply({ content: text });
  }

  // 🛡️ generar escudo (DM automático)
  if (interaction.commandName === 'generateshield') {

    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ No tienes permisos.', ephemeral: true });
    }

    const user = interaction.options.getUser('usuario');

    const key = Math.random().toString(36).substring(2, 10).toUpperCase();

    shields[key] = {
      userId: user.id,
      used: false
    };

    // 📩 DM automático al usuario
    try {
      await user.send(
        `🛡️ Has recibido un escudo de racha!\n🔑 Tu clave es: **${key}**\nUsa /useshield para activarlo.`
      );
    } catch (err) {
      console.log("No se pudo enviar DM");
    }

    return interaction.reply({
      content: `🛡️ Escudo generado y enviado por DM a ${user.username}`,
      ephemeral: true
    });
  }

  // 🔑 usar escudo
  if (interaction.commandName === 'useshield') {

    const key = interaction.options.getString('clave');
    const id = interaction.user.id;

    const shield = shields[key];

    if (!shield || shield.used) {
      return interaction.reply({ content: '❌ Clave inválida o usada.', ephemeral: true });
    }

    if (shield.userId !== id) {
      return interaction.reply({ content: '❌ Este escudo no es para ti.', ephemeral: true });
    }

    if (!users[id]) {
      users[id] = {
        messagesToday: 0,
        streakDays: 0,
        last: 0,
        locked: false,
        shieldActive: false
      };
    }

    users[id].shieldActive = true;
    shield.used = true;

    saveData(users);

    return interaction.reply({
      content: '🛡️ Escudo activado correctamente. Estás protegido este ciclo.',
      ephemeral: false
    });
  }
});

// 🔄 reset diario
setInterval(() => {
  for (const id in users) {

    if (users[id].shieldActive) {
      users[id].shieldActive = false;
      users[id].locked = false;
      users[id].messagesToday = 0;
      continue;
    }

    users[id].streakDays = 0;
    users[id].messagesToday = 0;
    users[id].locked = false;
  }

  saveData(users);
}, 24 * 60 * 60 * 1000);

// 🔐 login
client.login(process.env.TOKEN);