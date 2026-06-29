require('dotenv').config();
const { Client, GatewayIntentBits, MessageFlags } = require('discord.js');
const { createBot } = require('mineflayer');
const http = require('http');
const dns = require('dns');

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
            return interaction.reply({ content: '❌ Du hast bereits einen aktiven AFK-Bot!', flags: MessageFlags.Ephemeral });
        }

        // Wir starten die Denkpause
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let codeSent = false;

        dns.lookup(process.env.SERVER_IP, (err, address) => {
            const targetHost = err ? process.env.SERVER_IP : address;
            console.log(`Verbinde mit Minecraft-Server IP: ${targetHost}`);

            const userBot = createBot({
                host: targetHost,
                version: process.env.MINECRAFT_VERSION || '1.21.1',
                auth: 'microsoft',
                dontPersist: true
            });

            // Das Microsoft-Event mit Doppel-Sicherung!
            userBot.on('microsoft_oauth', async (deviceCode) => {
                if (!codeSent) {
                    codeSent = true;
                    console.log(`Sende Code an Discord: ${deviceCode.user_code}`);
                    
                    const messageContent = `🔐 <@${userId}> **Bitte verifiziere dich bei Microsoft:**\n1. Gehe auf: ${deviceCode.verification_uri}\n2. Code: \`${deviceCode.user_code}\``;

                    // Versuch 1: Die bestehende "Denkt nach"-Nachricht ändern
                    interaction.editReply({ content: messageContent })
                        .catch(() => {
                            // Versuch 2: Falls Discord die Verbindung verloren hat, schicken wir es als normale Nachricht in den Channel!
                            console.log("editReply fehlgeschlagen, sende normale Nachricht...");
                            interaction.channel.send({ content: messageContent }).catch(err => console.error(err));
                        });
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
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
