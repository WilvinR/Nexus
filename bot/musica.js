const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const play = require('play-dl');

const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, { songs: [], player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } }), connection: null, textChannelId: null });
  }
  return queues.get(guildId);
}

async function resolveQuery(query) {
  if (play.yt_validate(query) === 'video') {
    const info = await play.video_info(query);
    return { title: info.video_details.title, url: info.video_details.url };
  }
  if (play.sp_validate(query) === 'track') {
    const sp = await play.spotify(query);
    const sr = await play.search(`${sp.name} ${sp.artists[0]?.name || ''}`, { limit: 1 });
    if (!sr.length) throw new Error('No encontrado en YouTube');
    return { title: sr[0].title, url: sr[0].url };
  }
  const sr = await play.search(query, { limit: 1 });
  if (!sr.length) throw new Error('Sin resultados');
  return { title: sr[0].title, url: sr[0].url };
}

async function playNext(guildId, log) {
  const q = queues.get(guildId);
  if (!q || !q.songs.length) return;

  const song = q.songs.shift();
  try {
    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    q.player.play(resource);
    if (q.textChannelId && q.client) {
      const ch = await q.client.channels.fetch(q.textChannelId).catch(() => null);
      if (ch?.isTextBased()) {
        await ch.send(`▶️ **${song.title}**`);
      }
    }
  } catch (e) {
    log.warn(`Música stream: ${e.message}`);
    return playNext(guildId, log);
  }
}

function setupPlayer(guildId, log) {
  const q = getQueue(guildId);
  q.player.removeAllListeners(AudioPlayerStatus.Idle);
  q.player.on(AudioPlayerStatus.Idle, () => playNext(guildId, log));
}

async function ensureConnection(ix) {
  const member = ix.member;
  const channel = member?.voice?.channel;
  if (!channel) throw new Error('Debes estar en un canal de voz.');
  const q = getQueue(ix.guildId);
  if (!q.connection) {
    q.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: ix.guildId,
      adapterCreator: ix.guild.voiceAdapterCreator,
    });
    q.connection.subscribe(q.player);
    q.textChannelId = ix.channelId;
    q.client = ix.client;
    await entersState(q.connection, VoiceConnectionStatus.Ready, 15_000);
  }
  return q;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Reproduce música en tu canal de voz')
      .addStringOption((o) => o.setName('busqueda').setDescription('URL o nombre').setRequired(true)),
    async run(ix, { log }) {
      await ix.deferReply();
      const q = await ensureConnection(ix);
      setupPlayer(ix.guildId, log);
      const track = await resolveQuery(ix.options.getString('busqueda'));
      q.songs.push(track);
      if (q.player.state.status === AudioPlayerStatus.Idle) {
        await playNext(ix.guildId, log);
        await ix.editReply(`▶️ Reproduciendo: **${track.title}**`);
      } else {
        await ix.editReply(`➕ En cola (#${q.songs.length}): **${track.title}**`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Salta la canción actual')
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect),
    async run(ix) {
      const q = queues.get(ix.guildId);
      if (!q?.connection) return ix.reply({ content: '❌ No hay reproducción activa.', ephemeral: true });
      q.player.stop();
      await ix.reply({ content: '⏭️ Saltada.', ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('cola').setDescription('Muestra la cola de reproducción'),
    async run(ix) {
      const q = queues.get(ix.guildId);
      if (!q?.songs.length) return ix.reply({ content: 'Cola vacía.', ephemeral: true });
      const embed = new EmbedBuilder()
        .setTitle('🎵 Cola')
        .setDescription(q.songs.map((s, i) => `${i + 1}. ${s.title}`).join('\n').slice(0, 4000))
        .setColor(0x5865f2);
      await ix.reply({ embeds: [embed], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Para la música y limpia la cola')
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect),
    async run(ix) {
      const q = queues.get(ix.guildId);
      if (!q) return ix.reply({ content: '❌ Nada reproduciendo.', ephemeral: true });
      q.songs = [];
      q.player.stop();
      await ix.reply({ content: '⏹️ Detenido.', ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('salir')
      .setDescription('Desconecta el bot del canal de voz')
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect),
    async run(ix) {
      const q = queues.get(ix.guildId);
      if (!q?.connection) return ix.reply({ content: '❌ No estoy en voz.', ephemeral: true });
      q.songs = [];
      q.player.stop();
      q.connection.destroy();
      queues.delete(ix.guildId);
      await ix.reply({ content: '👋 Desconectado.', ephemeral: true });
    },
  },
];

module.exports = {
  id: 'musica',
  commands,

  onInit(_client, { log }) {
    log.info('Módulo música listo (requiere FFmpeg en el host)');
  },

  async handleInteraction(ix, ctx) {
    if (!ix.isChatInputCommand()) return false;
    const cmd = commands.find((c) => c.data.name === ix.commandName);
    if (!cmd) return false;
    try {
      await cmd.run(ix, ctx);
    } catch (e) {
      const msg = { content: `❌ ${e.message}`, ephemeral: true };
      if (ix.deferred || ix.replied) await ix.editReply(msg).catch(() => ix.followUp(msg));
      else await ix.reply(msg);
    }
    return true;
  },
};
