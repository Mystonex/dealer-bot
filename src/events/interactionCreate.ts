import {
  Events,
  Interaction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ChannelType,
  TextChannel,
  MessageFlags,
  PermissionFlagsBits,
  Message,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { DraftStore } from '../services/draftStore.js';
import { EventStore, StoredEvent } from '../services/eventStore.js';
import { config } from '../config.js';
import { bumpStarterMessage } from '../services/starterMessage.js';

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction) {
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.client.commands?.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch {
      const msg = { content: '⚠️ Error executing command.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'event:modal') {
    await onModalSubmit(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await onSelect(interaction);
    return;
  }

  if (interaction.isButton()) {
    await onButton(interaction);
    return;
  }
}

/* ----------------------- helpers ----------------------- */

function buildCreateModal() {
  const modal = new ModalBuilder().setCustomId('event:modal').setTitle('Create Event');

  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Event name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const max = new TextInputBuilder()
    .setCustomId('max')
    .setLabel('Max participants (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const desc = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(name),
    new ActionRowBuilder<TextInputBuilder>().addComponents(max),
    new ActionRowBuilder<TextInputBuilder>().addComponents(desc),
  );

  return modal;
}

async function onModalSubmit(inter: ModalSubmitInteraction) {
  if (!inter.guild) return;

  const name = inter.fields.getTextInputValue('name').trim();
  const maxRaw = inter.fields.getTextInputValue('max')?.trim();
  const descriptionRaw = inter.fields.getTextInputValue('description') ?? '';
  const description = descriptionRaw.trim() || undefined;
  const max = maxRaw ? Math.max(1, Math.min(100, Number(maxRaw))) : undefined;

  DraftStore.set(inter.user.id, { guildId: inter.guildId!, name, description, max });

  await inter.reply({
    content: `**Event builder**\n${DraftStore.summary(DraftStore.get(inter.user.id)!)}\n\n**Pick day/hour/minute**`,
    components: DraftStore.rows(DraftStore.get(inter.user.id)!),
    flags: MessageFlags.Ephemeral,
  });
}

async function onSelect(inter: StringSelectMenuInteraction) {
  const d = DraftStore.get(inter.user.id);
  if (!d) {
    await inter.reply({ content: 'Draft expired. Run /events again.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (inter.customId === 'event:day') d.dayISO = inter.values[0];
  else if (inter.customId === 'event:hour') d.hour = inter.values[0];
  else if (inter.customId === 'event:minute') d.minute = inter.values[0];

  DraftStore.set(inter.user.id, d);

  await inter.update({
    content: `**Event builder**\n${DraftStore.summary(d)}\n\n**Pick day/hour/minute**`,
    components: DraftStore.rows(d),
  });
}

function eventLink(ev: StoredEvent) {
  return `https://discord.com/channels/${ev.guildId}/${ev.channelId}/${ev.id}`;
}
function prettyWhen(ev: StoredEvent) {
  if (ev.whenUnix) return `<t:${ev.whenUnix}:F> — <t:${ev.whenUnix}:R>`;
  return ev.whenText ?? '—';
}
function slotLine(ev: StoredEvent) {
  if (ev.max) {
    const left = Math.max(ev.max - ev.participants.size, 0);
    return `Slots: ${ev.participants.size}/${ev.max} (${left} left)`;
  }
  return `Going: ${ev.participants.size}`;
}

async function onButton(inter: ButtonInteraction) {
  if (inter.customId === 'starter:create') {
    const modal = buildCreateModal();
    await inter.showModal(modal);
    return;
  }

  // --- Start Thread ---
  if (inter.customId === 'event:start-thread') {
    let ev = EventStore.get(inter.message.id);
    if (!ev) ev = (await EventStore.hydrate(inter.message.id))!;
    if (!ev) {
      await inter.reply({ content: 'Event not found.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (ev.threadId) {
      await inter.reply({
        content: `Thread already exists: <#${ev.threadId}>`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // only host or moderators
    const isHost = inter.user.id === ev.hostId;
    const perms = inter.memberPermissions;
    const isMod =
      perms?.has(PermissionFlagsBits.ManageThreads) ||
      perms?.has(PermissionFlagsBits.ManageChannels) ||
      perms?.has(PermissionFlagsBits.CreatePublicThreads) ||
      perms?.has(PermissionFlagsBits.CreatePrivateThreads);

    if (!isHost && !isMod) {
      await inter.reply({
        content: 'Only the host or moderators can start the planning thread.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Create a public thread from the event message
    const baseMsg = inter.message as Message;
    const threadName = `${ev.name} — Planning`;
    const thread = await baseMsg.startThread({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: 'Event planning thread',
    });

    // Welcome message with mentions (limit to keep it tidy)
    const mentions = [...ev.participants];
    const allowed = [...new Set([ev.hostId, ...mentions])].slice(0, 25);
    await thread.send({
      content: [
        `⚔️ Thread for **${ev.name}**`,
        `**When:** ${prettyWhen(ev)}`,
        `**Host:** <@${ev.hostId}>`,
        `**Participants:** ${mentions.length ? mentions.map((u) => `<@${u}>`).join(', ') : '—'}`,
        '',
        'Use this space to coordinate together!',
      ].join('\n'),
      allowedMentions: { users: allowed },
    });

    EventStore.setThreadId(ev.id, thread.id);

    // Update the event buttons to show "Open Thread"
    await inter.update({
      embeds: [EventStore.renderEmbed(ev)],
      components: [EventStore.renderButtons(ev)],
    });

    await inter.followUp({
      content: `✅ Thread for an event you've joined was created: <#${thread.id}>`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // --- Join / Leave ---
  if (inter.customId === 'event:join' || inter.customId === 'event:leave') {
    let ev = EventStore.get(inter.message.id);
    if (!ev) ev = (await EventStore.hydrate(inter.message.id))!;
    if (!ev) {
      await inter.reply({
        content: 'Event not found (maybe deleted).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (inter.customId === 'event:join') {
      const res = EventStore.join(ev.id, inter.user.id);
      if (!res.ok) {
        const reason =
          res.reason === 'FULL'
            ? 'Event is full.'
            : res.reason === 'ALREADY'
            ? 'You are already in.'
            : 'Could not join.';
        await inter.reply({ content: `❌ ${reason}`, flags: MessageFlags.Ephemeral });
        return;
      }
    } else {
      const res = EventStore.leave(ev.id, inter.user.id);
      if (!res.ok) {
        const reason = res.reason === 'NOT_IN' ? 'You are not in this event.' : 'Could not leave.';
        await inter.reply({ content: `❌ ${reason}`, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    await inter.update({
      embeds: [EventStore.renderEmbed(ev)],
      components: [EventStore.renderButtons(ev)],
    });

    const verb = inter.customId === 'event:join' ? 'Joined' : 'Left';
    await inter.followUp({
      content: `✅ **${verb}** **${ev.name}**\nWhen: ${prettyWhen(ev)}\n${slotLine(ev)}\n[Open event](${eventLink(ev)})`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // --- Create/Cancel from builder ---
  const d = DraftStore.get(inter.user.id);
  if (!d) {
    await inter.reply({ content: 'Draft expired. Run /events again.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (inter.customId === 'event:cancel') {
    DraftStore.clear(inter.user.id);
    await inter.update({ content: '❎ Cancelled.', components: [] });
    return;
  }

  if (inter.customId === 'event:create') {
    const unix = DraftStore.toUnix(d);
    if (!unix) {
      await inter.reply({ content: 'Please pick day/hour/minute.', flags: MessageFlags.Ephemeral });
      return;
    }

    let channel: TextChannel | null = null;
    try {
      const fetched = await inter.guild!.channels.fetch(config.eventChannelId);
      if (fetched && fetched.type === ChannelType.GuildText) channel = fetched as TextChannel;
    } catch { /* ignore */ }
    if (!channel) {
      await inter.reply({ content: 'Configured event channel not found.', flags: MessageFlags.Ephemeral });
      return;
    }

    const placeholder = await channel.send({ content: 'Creating event…' });

    const ev = EventStore.create({
      id: placeholder.id,
      guildId: channel.guildId,
      channelId: channel.id,
      name: d.name,
      hostId: inter.user.id,
      description: d.description && d.description.trim() ? d.description : undefined,
      whenText: undefined,
      whenUnix: unix,
      max: d.max,
    });

    await placeholder.edit({
      content: '',
      embeds: [EventStore.renderEmbed(ev)],
      components: [EventStore.renderButtons(ev)],
    });

    await bumpStarterMessage(inter.client);
    DraftStore.clear(inter.user.id);
    await inter.update({
      content: `✅ Event **${d.name}** created in ${channel}. https://discord.com/channels/${ev.guildId}/${ev.channelId}/${ev.id}`,
      components: [],
    });
  }
}
