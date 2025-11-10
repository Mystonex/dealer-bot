import {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChatInputCommandInteraction
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('events')              // ← plural name
  .setDescription('Open the event builder (GUI)');

export async function execute(interaction: ChatInputCommandInteraction) {
  const modal = new ModalBuilder()
    .setCustomId('event:modal')
    .setTitle('Create Event');

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

  await interaction.showModal(modal);
}
