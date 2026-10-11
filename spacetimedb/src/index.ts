import { schema, table, t, SenderError } from 'spacetimedb/server';

const note = table(
  { name: 'note', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    body: t.string(),
  },
);

const spacetimedb = schema({ note });
export default spacetimedb;

export const init = spacetimedb.init(_ctx => {});

export const clearNotes = spacetimedb.reducer(ctx => {
  const ids = [...ctx.db.note.iter()].map(row => row.id);
  for (const id of ids) ctx.db.note.id.delete(id);
});

export const addNote = spacetimedb.reducer({ body: t.string() }, (ctx, { body }) => {
  ctx.db.note.insert({ id: 0n, body });
});

export const cancelNote = spacetimedb.reducer(ctx => {
  ctx.db.note.insert({ id: 0n, body: 'this write is thrown away' });
  throw new SenderError('cancelled on purpose');
});
