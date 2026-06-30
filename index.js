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

        // Wir sagen Discord sofort Bescheid, dass der Prozess startet (Kein Hängenbleiben/Anwendung reagiert nicht mehr!)
        await interaction.deferReply();

        let codeSent = false;

        // Direktverbindung zur IP und Nutzung des dauerhaften Railway-Volumes (Speichert den Login-Token lokal ab)
        const userBot = createBot({
            host: process.env.SERVER_IP || 'play.friendlysmp.net',
            version: process.env.MINECRAFT_VERSION || '1.21.1',
            auth: 'microsoft',
            profilesFolder: `/tokens/${userId}` // Erstellt einen eigenen Ordner für jeden Discord-User, um die Session zu speichern
        });

        // Sobald Microsoft den Code ausspuckt, senden wir ihn (Wird NUR aufgerufen, wenn KEIN gültiger Token gefunden wurde)
        userBot.on('microsoft_oauth', async (deviceCode) => {
            if (!codeSent) {
                codeSent = true;
                console.log(`Sende Code an Discord für ${userId}: ${deviceCode.user_code}`);
                
                // Wir editieren die "Nachdenken"-Nachricht von oben -> Das blockiert niemals!
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
            
            // Wenn der Bot direkt joint (weil Token existiert), editieren wir die Nachricht im Kanal
            await interaction.editReply({ content: `👋 <@${userId}>s AFK-Bot hat den Server betreten!` }).catch(console.error);
        });

        // Erweitertes Error-Handling für genaueres Feedback im Discord bei Fehlgeschlagener Verbindung
        userBot.on('error', async (err) => {
            console.error('Mineflayer Fehler:', err);
            
            let errorMsg = `❌ Fehler beim Starten des Bots von <@${userId}>.`;
            
            // Filtert bekannte Minecraft- und Verbindungsfehler heraus
            if (err.message.includes('banned')) {
                errorMsg = `❌ <@${userId}>, dein Account ist auf diesem Server gebannt!`;
            } else if (err.message.includes('whitelist')) {
                errorMsg = `❌ <@${userId}>, du stehst nicht auf der Whitelist des Servers!`;
            } else if (err.code === 'ENOTFOUND' || err.message.includes('EAI_AGAIN')) {
                errorMsg = `❌ <@${userId}>, die IP \`${userBot.options.host}\` konnte nicht gefunden werden. (Server offline oder Tippfehler?)`;
            } else if (err.code === 'ETIMEDOUT') {
                errorMsg = `❌ <@${userId}>, Verbindung zum Server fehlgeschlagen (Timeout).`;
            }

            // Fehlermeldung als Edit senden, falls der Bot gar nicht erst online kam
            await interaction.editReply({ content: errorMsg }).catch(async () => {
                // Falls editReply fehlschlägt (z.B. Interaction abgelaufen), senden wir eine normale Nachricht
                await interaction.channel.send({ content: errorMsg }).catch(console.error);
            });

            // Räumt den Bot aus dem Speicher auf, damit man es neu versuchen kann
            if (activeBots.has(userId)) {
                clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);
            }
        });

        // Feedback, wenn der Bot vom Server fliegt oder gekickt wird
        userBot.on('end', async (reason) => {
            console.log('Bot-Verbindung beendet. Grund:', reason);
            
            // Verhindert eine Nachricht, wenn der Bot absichtlich gestoppt wurde (z.B. disconnect.quitting)
            if (reason && reason !== 'disconnect.quitting') {
                let displayReason = reason;
                
                // Spezielle Erklärung für 'socketClosed' (wichtig bei verdeckten Banns oder Doppel-Logins)
                if (reason === 'socketClosed') {
                    displayReason = 'socketClosed (Verbindung abgebrochen – Du bist eventuell gebannt, bereits eingeloggt oder der Server blockiert den Bot)';
                }

                await interaction.channel.send({ 
                    content: `📴 <@${userId}>s Bot wurde vom Server getrennt!\n**Grund:** \`${displayReason}\`` 
                }).catch(console.error);
            }

            // Stoppt das Sprung-Intervall und löscht den Bot aus der aktiven Liste
            if (activeBots.has(userId)) {
                clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);
            }
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
