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
// Host global definieren mit der korrekten .com Domain
const serverHost = process.env.SERVER_IP || 'play.friendlysmp.com';

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

        // Wir sagen Discord sofort Bescheid, dass der Prozess startet
        await interaction.deferReply();

        let codeSent = false;

        // Direktverbindung zur IP und Nutzung des Railway-Volumes
        const userBot = createBot({
            host: serverHost,
            version: process.env.MINECRAFT_VERSION || '1.21.11',
            auth: 'microsoft',
            profilesFolder: `/tokens/${userId}` // Erstellt einen eigenen Ordner für jeden Discord-User
        });

        // Sobald Microsoft den Code ausspuckt (NUR wenn KEIN gültiger Token gefunden wurde)
        userBot.on('microsoft_oauth', async (deviceCode) => {
            if (!codeSent) {
                codeSent = true;
                console.log(`Sende Code an Discord für ${userId}: ${deviceCode.user_code}`);
                
                await interaction.editReply({
                    content: `🔐 <@${userId}> **Erstanmeldung erforderlich!**\n1. Gehe auf: ${deviceCode.verification_uri}\n2. Code: \`${deviceCode.user_code}\`\n*(Beim nächsten Mal lädt der Bot automatisch!)*`
                }).catch(err => console.error('Discord Fehler beim Senden:', err));
            }
        });

        // Sobald der Bot erfolgreich auf dem Minecraft-Server spawnt
        userBot.on('spawn', async () => {
            if (activeBots.has(userId) && activeBots.get(userId).jumping) return;

            // Anti-AFK Kick: Der Bot springt alle 2 Sekunden kurz hoch
            const interval = setInterval(() => {
                if (userBot.entity) {
                    userBot.setControlState('jump', true);
                    setTimeout(() => { if (userBot.entity) userBot.setControlState('jump', false); }, 500);
                }
            }, 2000);

            activeBots.set(userId, { bot: userBot, interval: interval, jumping: true });
            
            // Wenn der Bot direkt joint, editieren wir die Nachricht im Kanal
            await interaction.editReply({ content: `👋 <@${userId}>s AFK-Bot hat den Server betreten!` }).catch(console.error);
        });

        // Erweitertes Error-Handling ohne Absturz-Risiko
        userBot.on('error', async (err) => {
            console.error('Mineflayer Fehler:', err);
            
            let errorMsg = `❌ Fehler beim Starten des Bots von <@${userId}>.`;
            
            if (err.message.includes('banned')) {
                errorMsg = `❌ <@${userId}>, dein Account ist auf diesem Server gebannt!`;
            } else if (err.message.includes('whitelist')) {
                errorMsg = `❌ <@${userId}>, du stehst nicht auf der Whitelist des Servers!`;
            } else if (err.code === 'ENOTFOUND' || err.message.includes('EAI_AGAIN')) {
                errorMsg = `❌ <@${userId}>, die IP \`${serverHost}\` konnte nicht gefunden werden. (Server offline oder Tippfehler?)`;
            } else if (err.code === 'ETIMEDOUT') {
                errorMsg = `❌ <@${userId}>, Verbindung zum Server fehlgeschlagen (Timeout).`;
            }

            // Fehlermeldung als Edit senden oder als neue Nachricht
            await interaction.editReply({ content: errorMsg }).catch(async () => {
                await interaction.channel.send({ content: errorMsg }).catch(console.error);
            });

            // Räumt den Bot aus dem Speicher auf
            if (activeBots.has(userId)) {
                clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);
            }
        });

        // Feedback, wenn der Bot vom Server fliegt
        userBot.on('end', async (reason) => {
            console.log('Bot-Verbindung beendet. Grund:', reason);
            
            if (reason && reason !== 'disconnect.quitting') {
                let displayReason = reason;
                
                if (reason === 'socketClosed') {
                    displayReason = 'socketClosed (Verbindung abgebrochen – Du bist eventuell gebannt, bereits eingeloggt oder der Server blockiert den Bot)';
                }

                await interaction.channel.send({ 
                    content: `📴 <@${userId}>s Bot wurde vom Server getrennt!\n**Grund:** \`${displayReason}\`` 
                }).catch(console.error);
            }

            if (activeBots.has(userId)) {
                clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);
            }
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
