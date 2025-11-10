import { DateTime } from 'luxon';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { config } from '../config.js';

export type Draft = {
  guildId: string;
  name: string;
  description?: string;
  max?: number;
  dayISO?: string;  // e.g. "2025-11-02"
  hour?: string;    // "00".."23"
  minute?: string;  // "00","15","30","45"
};

const drafts = new Map<string, Draft>(); // key = userId

export const DraftStore = {
  set(userId: string, draft: Draft) { drafts.set(userId, draft); },
  get(userId: string) { return drafts.get(userId); },
  clear(userId: string) { drafts.delete(userId); },

  // Build the ephemeral "wizard" rows
  rows(draft: Draft) {
    const zone = config.tzDefault;

    // Day options: Today + next 6 days
    const today = DateTime.now().setZone(zone).startOf('day');
    const dayMenu = new StringSelectMenuBuilder()
      .setCustomId('event:day')
      .setPlaceholder('Pick day')
      .addOptions(
        Array.from({ length: 14 }, (_, i) => {
          const d = today.plus({ days: i });
          const iso = d.toFormat('yyyy-LL-dd');
          const label = i === 0 ? `Today (${d.toFormat('ccc dd LLL')})`
                      : i === 1 ? `Tomorrow (${d.toFormat('ccc dd LLL')})`
                                : d.toFormat('ccc dd LLL');
          return {
            label,
            value: iso,
            default: draft.dayISO === iso
          };
        })
      );

    // Hour options 00..23
    const hourMenu = new StringSelectMenuBuilder()
      .setCustomId('event:hour')
      .setPlaceholder('Hour')
      .addOptions(
        Array.from({ length: 24 }, (_, h) => {
          const v = String(h).padStart(2, '0');
          return { label: v, value: v, default: draft.hour === v };
        })
      );

    // Minute options
    const mins = ['00','15','30','45'];
    const minuteMenu = new StringSelectMenuBuilder()
      .setCustomId('event:minute')
      .setPlaceholder('Minute')
      .addOptions(mins.map(m => ({ label: m, value: m, default: draft.minute === m })));

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dayMenu);
    const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(hourMenu);
    const row3 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(minuteMenu);

    const createBtn = new ButtonBuilder().setCustomId('event:create').setLabel('Create').setStyle(ButtonStyle.Success);
    const cancelBtn = new ButtonBuilder().setCustomId('event:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
    const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(createBtn, cancelBtn);

    return [row1, row2, row3, row4];
  },

  // Summary line for the ephemeral builder
  summary(d: Draft) {
    const ready = d.dayISO && d.hour && d.minute;
    const details = `${d.dayISO ?? '—'} ${d.hour ?? '—'}:${d.minute ?? '—'} (${config.tzDefault})`;
    return `**Name:** ${d.name}\n**Max:** ${d.max ?? '—'}\n**When:** ${details}\n**Desc:** ${d.description ?? '—'}\n${ready ? '✅ Press **Create** to post it.' : '⏳ Pick day, hour and minute.'}`;
  },

  // Turn draft into unix time
  toUnix(d: Draft): number | undefined {
    if (!d.dayISO || !d.hour || !d.minute) return undefined;
    const dt = DateTime.fromISO(`${d.dayISO}T${d.hour}:${d.minute}`, { zone: config.tzDefault });
    return dt.isValid ? Math.floor(dt.toSeconds()) : undefined;
  },
};
