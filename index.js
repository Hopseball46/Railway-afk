Hier ist der komplette, aktualisierte Code für deinen Bot.

Ich habe die neuen Abfragen für Fehler (wie den ENOTFOUND-Fehler aus deinem Screenshot) und Kicks direkt eingebaut, damit der Bot alles ordentlich in deinen Discord-Kanal postet. Zudem nutzt er jetzt das dauerhafte Railway-Volume unter /tokens/.

JavaScript
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

        // Nutzt das dauerhafte Railway-Volume
        const userBot = createBot({
            host: process.env.SERVER_IP || 'play.friendlysmp.net',
            version: process.env.MINECRAFT_VERSION || '1.21.1',
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

        // Erweitertes Error-Handling für genaueres Feedback im Discord
        userBot.on('error', async (err) => {
            console.error('Mineflayer Fehler:', err);
            
            let errorMsg = `❌ Fehler beim Starten des Bots von <@${userId}>.`;
            
            if (err.message.includes('banned')) {
                errorMsg = `❌ <@${userId}>, dein Account ist auf diesem Server gebannt!`;
            } else if (err.message.includes('whitelist')) {
                errorMsg = `❌ <@${userId}>, du stehst nicht auf der Whitelist des Servers!`;
            } else if (err.code === 'ENOTFOUND' || err.message.includes('EAI_AGAIN')) {
                errorMsg = `❌ <@${userId}>, die IP \`${userBot.options.host}\` konnte nicht gefunden werden. (Server offline oder Tippfehler?)`;
            } else if (err.code === 'ETIMEDOUT') {
                errorMsg = `❌ <@${userId}>, Verbindung zum Server fehlgeschlagen (Timeout).`;
            }

            await interaction.channel.send({ content: errorMsg }).catch(console.error);

            if (activeBots.has(userId)) {
                clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);
            }
        });

        // Feedback, wenn der Bot vom Server fliegt oder gekickt wird
        userBot.on('end', async (reason) => {
            console.log('Bot-Verbindung beendet. Grund:', reason);
            
            // Verhindert eine Nachricht, wenn der Bot absichtlich gestoppt wurde
            if (reason && reason !== 'disconnect.quitting') {
                await interaction.channel.send({ 
                    content: `📴 <@${userId}>s Bot wurde vom Server getrennt!\n**Grund:** \`${reason}\`` 
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
