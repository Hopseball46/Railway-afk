require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createBot } = require('mineflayer');
const http = require('http');

// Webserver für Railway, damit das Deployment aktiv bleibt
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot läuft!\n');
}).listen(PORT, () => {
    console.log(`Webserver läuft auf Port ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const activeBots = new Map();

client.once('ready', async () => {
    console.log('✅ Discord Bot ist online!');
    const guildId = client.guilds.cache.first()?.id;
    if (guildId) {
        const guild = client.guilds.cache.get(guildId);
        await guild.commands.set([
            {
                name: 'afk',
                description: 'Startet deinen Minecraft AFK-Bot'
            }
        ]);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'afk') {
        const userId = interaction.user.id;

        if (activeBots.has(userId)) {
            return interaction.reply({ content: '❌ Du hast bereits einen aktiven AFK-Bot!', ephemeral: true });
        }

        // Sofortige Rückmeldung an Discord
        await interaction.reply({ content: `⏳ <@${userId}>, AFK-Bot wird gestartet...` });

        let codeSent = false;

        // Nutzt jetzt das dauerhafte Railway-Volume (ohne den Punkt am Anfang!)
        const userBot = createBot({
            host: process.env.SERVER_IP || 'play.friendlysmp.net',
            version: process.env.MINECRAFT_VERSION || '1.21.11',
            auth: 'microsoft',
            profilesFolder: `/tokens/${userId}` 
        });

        // Wird NUR aufgerufen, wenn KEIN gültiger Token gefunden wurde
        userBot.on('microsoft_oauth', async (deviceCode) => {
            if (!codeSent) {
                codeSent = true;
                console.log(`Sende Code an Discord für ${userId}: ${deviceCode.user_code}`);
                
                await interaction.channel.send({
                    content: `🔐 <@${userId}> **Erstanmeldung erforderlich!**\n1. Gehe auf: ${deviceCode.verification_uri}\n2. Code: \`${deviceCode.user_code}\`\n*(Beim nächsten Mal lädt der Bot automatisch!)*`
                }).catch(err => console.error('Discord Fehler beim Senden:', err));
            }
        });

        userBot.on('spawn', async () => {
            if (activeBots.has(userId) && activeBots.get(userId).jumping) return;

            const interval = setInterval(() => {
                if (userBot.entity) {
                    userBot.setControlState('jump', true);
                    setTimeout(() => { if (userBot.entity) userBot.setControlState('jump', false); }, 500);
                }
            }, 2000);

            activeBots.set(userId, { bot: userBot, interval: interval, jumping: true });
            await interaction.channel.send({ content: `👋 <@${userId}>s AFK-Bot hat den Server betreten!` });
        });

        userBot.on('error', (err) => {
            console.error('Mineflayer Fehler:', err);
            if (activeBots.has(userId)) {
                clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);
            }
        });

        userBot.on('end', () => {
            console.log('Bot-Verbindung beendet.');
            if (activeBots.has(userId)) {
                clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);
            }
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
