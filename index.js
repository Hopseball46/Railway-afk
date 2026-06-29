require('dotenv').config();
const { Client, GatewayIntentBits, InteractionType, MessageFlags } = require('discord.js');
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
    console.log('✅ Discord Bot ist online auf Wispbyte!');
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

        // 1. Sofort antworten, damit Discord nicht abstürzt
        await interaction.reply({ content: '⏳ Starte den Bot und fordere Code an...', flags: MessageFlags.Ephemeral });

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

            // Event: Microsoft verlangt Code-Eingabe (NUR FÜR DICH SICHTBAR)
            userBot.on('microsoft_oauth', (deviceCode) => {
                if (!codeSent) {
                    codeSent = true;
                    
                    // Schickt den Code als neue, geheime Nachricht in den Channel
                    interaction.followUp({
                        content: `🔐 <@${userId}> **Bitte verifiziere dich bei Microsoft:**\n1. Gehe auf: ${deviceCode.verification_uri}\n2. Code: \`${deviceCode.user_code}\``,
                        flags: MessageFlags.Ephemeral
                    }).catch(err => console.error('Discord Fehler beim Senden des Codes:', err));
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
                
                // Das hier sehen wieder alle (damit man weiß, dass du da bist)
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
