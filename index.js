const { createBot } = require('mineflayer');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
const http = require('http');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const activeBots = new Map();

const commands = [
    new SlashCommandBuilder().setName('afk').setDescription('Startet deinen eigenen Minecraft-AFK-Bot'),
    new SlashCommandBuilder().setName('stop').setDescription('Stoppt deinen Minecraft-AFK-Bot'),
    new SlashCommandBuilder()
        .setName('jump')
        .setDescription('Schaltet das automatische Springen ein oder aus')
        .addStringOption(option =>
            option.setName('modus').setDescription('an oder aus').setRequired(true).addChoices({ name: 'an', value: 'an' }, { name: 'aus', value: 'aus' })
        ),
    new SlashCommandBuilder()
        .setName('type')
        .setDescription('Schreibt eine Nachricht in den Minecraft-Chat')
        .addStringOption(option => option.setName('text').setDescription('Die Nachricht').setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Discord Bot ist online auf Wispbyte!');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const session = activeBots.get(userId);

    if (interaction.commandName === 'afk') {
        if (session) {
            return await interaction.reply({ content: '❌ Du hast bereits einen aktiven Bot laufen!', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let codeSent = false;
        let hasResponded = false;

        try {
            console.log(`[Mineflayer] Starte Bot für User ${userId}...`);
            
            const originalWrite = process.stdout.write;
            process.stdout.write = function(chunk, encoding, callback) {
                const text = chunk.toString();
                
                if (text.includes('Signed in with Microsoft') && !hasResponded) {
                    hasResponded = true;
                    interaction.editReply({ content: '🔄 Microsoft-Login erfolgreich! Verbinde jetzt zum Minecraft-Server...' }).catch(() => {});
                }

                const match = text.match(/(?:code|use)\s+([A-Z0-9]{4}-[A-Z0-9]{4}|[A-Z0-9]{8})/i) || text.match(/[A-Z0-9]{8}/);
                
                if (match && !codeSent) {
                    const foundCode = match[1] ? match[1].replace('-', '') : match[0];
                    if (!['microsof', 'username', 'password', 'download', 'progress', 'authenti', 'reify'].includes(foundCode.toLowerCase())) {
                        codeSent = true;
                        interaction.followUp({
                            content: `🔐 <@${userId}> **Bitte verifiziere dich bei Microsoft:**\n1. Gehe auf: https://microsoft.com/link\n2. Code: \`${foundCode.toUpperCase()}\``,
                            flags: MessageFlags.Ephemeral
                        }).catch(err => console.error('Discord Fehler:', err));
                    }
                }
                return originalWrite.apply(process.stdout, arguments);
            };

            const userBot = createBot({
                host: process.env.SERVER_IP,
                version: process.env.MINECRAFT_VERSION || '1.20.1',
                auth: 'microsoft',
                // JEDER USER BEKOMMT SEINEN EIGENEN ORDNER:
                profilesFolder: `./auth_cache/${userId}`, 
                dontPersist: false
            });

            userBot.on('spawn', async () => {
                process.stdout.write = originalWrite;

                if (hasResponded && codeSent) return; 
                hasResponded = true;
                
                const interval = setInterval(() => {
                    if (userBot.entity) {
                        userBot.setControlState('jump', true);
                        setTimeout(() => { if (userBot.entity) userBot.setControlState('jump', false); }, 500);
                    }
                }, 2000);
                
                activeBots.set(userId, { bot: userBot, interval: interval, jumping: true });
                
                if (!codeSent) {
                    await interaction.editReply({ content: `✅ Bereits eingeloggt! Dein Bot betritt den Server.` });
                } else {
                    await interaction.followUp({ content: `✅ Verifizierung erfolgreich! Dein Bot ist auf dem Server.`, flags: MessageFlags.Ephemeral });
                }
                await interaction.channel.send({ content: `👋 <@${userId}>s AFK-Bot hat den Server betreten!` });
            });

            userBot.on('kicked', async (reason) => {
                process.stdout.write = originalWrite;
                if (activeBots.has(userId)) clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);

                if (hasResponded) return;
                hasResponded = true;
                const cleanReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
                await interaction.editReply({ content: `❌ Bot wurde gekickt: ${cleanReason}` }).catch(() => {});
            });

            userBot.on('error', async (err) => {
                process.stdout.write = originalWrite;
                if (activeBots.has(userId)) clearInterval(activeBots.get(userId).interval);
                activeBots.delete(userId);

                if (hasResponded) return;
                hasResponded = true;
                await interaction.editReply({ content: `❌ Minecraft-Fehler: ${err.message}` }).catch(() => {});
            });

        } catch (err) {
            console.error('[System Fehler]:', err);
            process.stdout.write = originalWrite;
        }
    }

    // --- BEFEHL: STOP ---
    if (interaction.commandName === 'stop') {
        if (!session) return await interaction.reply({ content: '❌ Du hast keinen aktiven Bot.', flags: MessageFlags.Ephemeral });
        await interaction.reply({ content: '🛑 Stoppe Bot...', flags: MessageFlags.Ephemeral });
        if (session.interval) clearInterval(session.interval);
        session.bot.quit();
        activeBots.delete(userId);
    }

    // --- BEFEHL: JUMP ---
    if (interaction.commandName === 'jump') {
        if (!session) return await interaction.reply({ content: '❌ Du hast keinen aktiven Bot.', flags: MessageFlags.Ephemeral });
        const modus = interaction.options.getString('modus');

        if (modus === 'an') {
            if (session.interval) clearInterval(session.interval);
            session.interval = setInterval(() => {
                if (session.bot.entity) {
                    session.bot.setControlState('jump', true);
                    setTimeout(() => { if (session.bot.entity) session.bot.setControlState('jump', false); }, 500);
                }
            }, 2000);
            await interaction.reply({ content: '🟢 Automatisches Springen aktiviert.', flags: MessageFlags.Ephemeral });
        } else {
            if (session.interval) clearInterval(session.interval);
            session.bot.setControlState('jump', false);
            await interaction.reply({ content: '🔴 Automatisches Springen deaktiviert.', flags: MessageFlags.Ephemeral });
        }
    }

    // --- BEFEHL: TYPE ---
    if (interaction.commandName === 'type') {
        if (!session) return await interaction.reply({ content: '❌ Du hast keinen aktiven Bot.', flags: MessageFlags.Ephemeral });
        const text = interaction.options.getString('text');
        session.bot.chat(text);
        await interaction.reply({ content: `💬 Nachricht gesendet: *"${text}"*`, flags: MessageFlags.Ephemeral });
    }
});

client.login(process.env.DISCORD_TOKEN);

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(PORT);
