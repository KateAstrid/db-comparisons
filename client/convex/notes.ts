import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const list = query({
  args: {},
  handler: async ctx => {
    const notes = await ctx.db.query('notes').collect();
    notes.sort((a, b) => a._creationTime - b._creationTime);
    return notes.map(note => note.body);
  },
});

export const send = mutation({
  args: { body: v.string() },
  handler: async (ctx, { body }) => {
    await ctx.db.insert('notes', { body });
  },
});

export const clear = mutation({
  args: {},
  handler: async ctx => {
    const notes = await ctx.db.query('notes').collect();
    for (const note of notes) await ctx.db.delete(note._id);
  },
});
